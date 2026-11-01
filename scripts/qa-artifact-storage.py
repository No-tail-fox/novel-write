"""Offline QA of the real storage settings page in isolated Electron."""
import functools
import http.server
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import urllib.request

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / '.artifacts/artifact-storage-settings'
ART.mkdir(parents=True, exist_ok=True)
(ROOT / '.codex-temp').mkdir(exist_ok=True)
profile = Path(tempfile.mkdtemp(prefix='artifact-storage-qa-', dir=ROOT / '.codex-temp'))
node = shutil.which('node')
assert node, 'Node.js is required'
build = subprocess.run([node, '--input-type=module', '-e',
    "import {build} from 'vite';await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:process.argv[2],emptyOutDir:false,target:'chrome120',lib:{entry:process.argv[1],name:'storageQA',formats:['es'],fileName:()=> 'harness.js',cssFileName:'harness'}}});",
    str(ROOT / 'tests/artifact-storage.harness.tsx'), str(profile)], cwd=ROOT, capture_output=True, text=True, encoding='utf8')
(ART / 'build.log').write_text(build.stdout + build.stderr, encoding='utf8')
build.check_returncode()
(profile / 'index.html').write_text('<!doctype html><html data-theme="dark" data-theme-ready="true"><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><style>.settings-layout{height:100vh}</style><body><div id="root"></div><script type="module" src="harness.js"></script></body></html>', encoding='utf8')

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(profile)))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{server.server_port}'
(profile / 'main.cjs').write_text("""
const {app,BrowserWindow,session}=require('electron');
app.disableHardwareAcceleration();app.whenReady().then(()=>{
  session.defaultSession.webRequest.onBeforeRequest((d,cb)=>cb({cancel:!d.url.startsWith(LOCAL)&&!d.url.startsWith('data:')&&!d.url.startsWith('blob:')}));
  const w=new BrowserWindow({width:1536,height:1024,show:false,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});
  w.loadURL(LOCAL);
});
""".replace('LOCAL', json.dumps(url)), encoding='utf8')
(profile / 'package.json').write_text('{"name":"artifact-storage-qa","version":"1.0.0","main":"main.cjs"}', encoding='utf8')
with socket.socket() as listener:
    listener.bind(('127.0.0.1', 0))
    port = listener.getsockname()[1]
env = os.environ.copy()
for name in ('ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS'):
    env.pop(name, None)
log = (ART / 'electron.log').open('w', encoding='utf8')
process = subprocess.Popen([str(ROOT / 'node_modules/electron/dist/electron.exe'), f'--remote-debugging-port={port}', f'--user-data-dir={profile}', str(profile)], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
report = {'surface':'real SettingsPage in isolated Electron; directory chooser mocked', 'checks':[], 'screenshots':[], 'errors':[]}

def check(name, passed):
    report['checks'].append({'name':name, 'passed':bool(passed)})
    assert passed, name

try:
    deadline = time.monotonic() + 30
    while True:
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/json/version', timeout=1) as response:
                endpoint = json.load(response)['webSocketDebuggerUrl']
            break
        except Exception:
            if process.poll() is not None or time.monotonic() > deadline:
                raise RuntimeError('Electron debugger did not start')
            time.sleep(.2)
    with sync_playwright() as pw:
        browser = pw.chromium.connect_over_cdp(endpoint)
        page = browser.contexts[0].pages[0]
        page.on('pageerror', lambda error: report['errors'].append(str(error)))
        def visit(mode='normal', theme='dark', size=(1536,1024)):
            page.set_viewport_size({'width':size[0], 'height':size[1]})
            page.goto(f'{url}/?mode={mode}&theme={theme}')
            page.wait_for_selector('.settings-layout')
        def capture(name):
            page.screenshot(path=str(ART / (name + '.png')))
            report['screenshots'].append(name + '.png')
        for theme in ('dark','light'):
            for size, suffix in [((1536,1024),'desktop'), ((1040,720),'compact')]:
                visit(theme=theme, size=size)
                choose = page.get_by_role('button', name='选择存储文件夹', exact=True)
                expect(choose).to_be_in_viewport()
                expect(page.get_by_label('当前存储位置', exact=True)).to_have_attribute('readonly', '')
                expect(page.get_by_role('button', name='保存配置', exact=True)).to_have_count(0)
                check(theme + ' ' + suffix + ' no horizontal overflow', page.locator('.settings-content').evaluate('e=>e.scrollWidth<=e.clientWidth+1'))
                choose.click()
                expect(page.get_by_role('button', name='取消切换', exact=True)).to_be_in_viewport()
                expect(page.get_by_label('重启后使用的位置', exact=True)).to_be_visible()
                check(theme + ' ' + suffix + ' long path fits', page.locator('.settings-content').evaluate('e=>e.scrollWidth<=e.clientWidth+1'))
                page.get_by_role('button', name='重新选择文件夹', exact=True).focus()
                page.keyboard.press('Tab')
                expect(page.get_by_role('button', name='取消切换', exact=True)).to_be_focused()
                check(theme + ' ' + suffix + ' keyboard reaches cancel', True)
                capture(theme + '-' + suffix + '-pending')
                page.get_by_role('button', name='取消切换', exact=True).click()
                expect(choose).to_be_visible()
                check(theme + ' ' + suffix + ' cancel restores current location', page.get_by_label('重启后使用的位置', exact=True).count() == 0)
        visit()
        choose = page.get_by_role('button', name='选择存储文件夹', exact=True)
        expect(choose).to_be_visible()
        page.evaluate('artifactStorageQA.cancelChooser=true')
        choose.click()
        expect(page.get_by_label('重启后使用的位置', exact=True)).to_have_count(0)
        page.evaluate('artifactStorageQA.cancelChooser=false;artifactStorageQA.delayChoose=true')
        choose.click()
        expect(choose).to_be_disabled()
        check('directory chooser disables repeated submissions', True)
        page.evaluate('artifactStorageQA.releaseChoose()')
        expect(page.get_by_role('button', name='取消切换', exact=True)).to_be_enabled()
        page.get_by_role('button', name='取消切换', exact=True).click()
        page.evaluate('artifactStorageQA.delayChoose=false;artifactStorageQA.failChoose=true')
        choose.click()
        expect(page.get_by_role('alert').filter(has_text='该文件夹没有写入权限')).to_be_visible()
        check('write permission error is actionable', True)
        visit('migration-error', 'light', (1040,720))
        expect(page.get_by_role('alert')).to_contain_text('当前仍使用原目录')
        check('migration error wraps within compact window', page.locator('.settings-content').evaluate('e=>e.scrollWidth<=e.clientWidth+1'))
        capture('light-compact-migration-error')
        page.get_by_role('button', name='取消切换', exact=True).click()
        expect(page.get_by_role('alert')).to_have_count(0)
        visit('load-error')
        expect(page.get_by_role('button', name='重新读取', exact=True)).to_be_visible()
        page.evaluate('artifactStorageQA.failLoad=false')
        page.get_by_role('button', name='重新读取', exact=True).click()
        expect(page.get_by_role('button', name='选择存储文件夹', exact=True)).to_be_visible()
        check('load failure retries successfully', True)
        visit('loading')
        expect(page.get_by_role('status')).to_contain_text('正在读取')
        page.evaluate('artifactStorageQA.releaseLoad()')
        expect(page.get_by_role('button', name='选择存储文件夹', exact=True)).to_be_visible()
        check('loading resolves to usable controls', True)
        visit('browser')
        expect(page.get_by_text('请在 StoryDream 桌面端设置产物存储位置。', exact=True)).to_be_visible()
        expect(page.get_by_role('button', name='选择存储文件夹', exact=True)).to_have_count(0)
        check('browser fallback explains desktop requirement', True)
        check('no runtime errors', not report['errors'])
        browser.close()
finally:
    if process.poll() is None:
        process.terminate()
        process.wait(timeout=10)
    server.shutdown()
    log.close()
    (ART / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
print(json.dumps({'checks':len(report['checks']), 'screenshots':len(report['screenshots']), 'errors':report['errors']}, ensure_ascii=False))
