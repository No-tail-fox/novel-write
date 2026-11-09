"""Offline retry/recovery interaction checks on the real editor in isolated Electron."""
import functools
import http.server
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / '.artifacts/vox-production-retry'
ART.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location('qa_base', ROOT / 'scripts/qa-motion-comic.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
profile = Path(tempfile.mkdtemp(prefix='vox-retry-', dir=ROOT / '.codex-temp'))
source = (ROOT / 'tests/editorial-dual-chain.harness.tsx').read_text(encoding='utf8')
source = source.replace("'../src/", "'" + ROOT.as_posix() + '/src/')
entry = profile / 'retry.tsx'
entry.write_text(source, encoding='utf8')
node = 'I:/nodejs/node.exe'
build = subprocess.run([node, '--input-type=module', '-e',
    "import {build} from 'vite';await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:process.argv[2],emptyOutDir:false,target:'chrome120',lib:{entry:process.argv[1],name:'retryQA',formats:['es'],fileName:()=> 'harness.js',cssFileName:'harness'}}});", str(entry), str(profile)], cwd=ROOT, capture_output=True, text=True, encoding='utf8')
(ART / 'build.log').write_text(build.stdout + build.stderr, encoding='utf8')
build.check_returncode()
subprocess.run([node, '--input-type=module', '-e',
    "import {build} from 'esbuild';await build({entryPoints:['src/features/vox-animation/runtime.tsx'],outfile:process.argv[1],bundle:true,platform:'browser',format:'iife',target:'chrome120',define:{'process.env.NODE_ENV':JSON.stringify('production')},minify:true,logLevel:'warning'});", str(profile / 'runtime.js')], cwd=ROOT, check=True)
(profile / 'index.html').write_text('<!doctype html><html data-theme="dark" data-theme-ready="true"><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><style>[data-editorial-collage-workbench]{height:100vh;min-height:0;overflow:hidden}</style><body><div id="root"></div><script type="module" src="harness.js"></script></body></html>', encoding='utf8')
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(profile)))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{server.server_port}'
(profile / 'main.cjs').write_text("""
const {app,BrowserWindow,session}=require('electron');
app.disableHardwareAcceleration();app.whenReady().then(()=>{
session.defaultSession.webRequest.onBeforeRequest((d,cb)=>cb({cancel:!d.url.startsWith(LOCAL)&&!d.url.startsWith('data:')&&!d.url.startsWith('blob:')}));
const w=new BrowserWindow({width:1536,height:1024,show:false,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});w.loadURL(LOCAL);
});
""".replace('LOCAL', json.dumps(url)), encoding='utf8')
(profile / 'package.json').write_text('{"name":"vox-retry-qa","version":"1.0.0","main":"main.cjs"}', encoding='utf8')
env = os.environ.copy()
for name in (*base.PAID_API_ENV_VARS, 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS'):
    env.pop(name, None)
port = base.available_port()
log = (ART / 'electron.log').open('w', encoding='utf8')
process = subprocess.Popen([str(base.ELECTRON), f'--remote-debugging-port={port}', f'--user-data-dir={profile}', str(profile)], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
report = {'paidCalls': 0, 'checks': [], 'screenshots': [], 'errors': []}
try:
    with sync_playwright() as pw:
        browser = pw.chromium.connect_over_cdp(base.wait_for_cdp(port, process))
        page = browser.contexts[0].pages[0]
        page.on('pageerror', lambda e: report['errors'].append(str(e)))
        page.wait_for_selector('.director-desk')

        def fixture(scenario):
            page.evaluate('(s)=>window.editorialDualChainQA.productionFixture(s)', scenario)
            expect(page.locator('.vox-project-action-bar')).to_be_visible()

        def check(name, result):
            report['checks'].append({'name': name, 'passed': bool(result)})
            assert result, name

        def capture(name):
            page.evaluate('''async()=>{await document.fonts.ready;await Promise.allSettled(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>a.finished));}''')
            page.screenshot(path=str(ART / f'{name}.png'))
            report['screenshots'].append(f'{name}.png')
            check(name + ' no horizontal overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))

        for name, width, height in [('desktop', 1536, 1024), ('compact', 1040, 720)]:
            page.set_viewport_size({'width': width, 'height': height})
            fixture('running')
            phase = page.locator('.vox-project-phase')
            expect(phase).to_be_visible()
            before_step = phase.locator('b').inner_text()
            page.evaluate('window.editorialDualChainQA.advanceProduction()')
            expect(phase.locator('b')).not_to_have_text(before_step)
            expect(phase).to_contain_text('执行中')
            check(name + ' updates step count immediately from task-upsert', phase.locator('b').inner_text() != before_step)

            fixture('legacy')
            expect(phase).to_be_visible()
            expect(phase.locator('b')).to_contain_text('第 ')
            expect(phase.locator('b')).to_contain_text(' / ')
            expect(phase).to_contain_text('失败 · 素材生成或导入')
            check(name + ' displays current step and total', page.evaluate("document.querySelector('.vox-project-phase b').textContent.trim().endsWith('步')"))
            check(name + ' displays current production phase', page.evaluate("document.querySelector('.vox-project-phase').getBoundingClientRect().bottom < innerHeight"))
            retry = page.get_by_role('button', name='重试失败步骤', exact=True)
            expect(retry).to_be_enabled()
            expect(retry).to_be_in_viewport()
            capture(name + '-retry-footer')
            retry.click()
            expect(page.get_by_role('button', name='暂停制作', exact=True)).to_be_visible()
            check(name + ' footer resumes once', page.evaluate('window.editorialDualChainQA.productionCalls.map(c=>c.action)') == ['resume'])

            fixture('legacy')
            page.get_by_role('button', name='制作进度', exact=True).click()
            dialog = page.get_by_role('dialog', name='自动制作进度')
            retry = dialog.get_by_role('button', name='重试失败步骤', exact=True)
            expect(retry).to_be_in_viewport()
            expect(dialog.get_by_role('button', name='核对此步骤')).to_have_count(0)
            expect(dialog.get_by_role('alert')).to_have_text('图片服务未返回图片')
            dialog.get_by_text('错误详情', exact=True).click()
            expect(dialog.get_by_text('Image provider API error (400):', exact=False).last).to_be_visible()
            capture(name + '-retry-details')
            expect(retry).to_be_in_viewport()
            page.evaluate('window.editorialDualChainQA.holdProduction=true')
            retry.click()
            expect(retry).to_be_disabled()
            check(name + ' dialog sends one resume while busy', page.evaluate('window.editorialDualChainQA.productionCalls.map(c=>c.action)') == ['resume'])
            page.evaluate('window.editorialDualChainQA.finishProductionControl()')
            expect(retry).to_have_count(0)
            dialog.get_by_role('button', name='关闭', exact=True).click()

            fixture('unknown')
            expect(page.locator('.vox-project-phase')).to_contain_text('等待核对 · 素材生成或导入')
            recovery = page.get_by_role('button', name='查看失败与恢复', exact=True)
            expect(recovery).to_be_enabled()
            recovery.click()
            dialog = page.get_by_role('dialog', name='自动制作进度')
            expect(dialog.get_by_role('button', name='重试失败步骤')).to_have_count(0)
            expect(dialog.get_by_role('button', name='核对此步骤')).to_have_count(1)
            direct_retry = dialog.get_by_role('button', name='直接重试此步骤', exact=True)
            expect(direct_retry).to_be_enabled()
            expect(dialog.get_by_text('可能重复计费', exact=False)).to_be_visible()
            page.evaluate('window.editorialDualChainQA.holdProduction=true')
            direct_retry.click()
            expect(direct_retry).to_be_disabled()
            expect(dialog.get_by_text('其他恢复选项', exact=True)).to_be_visible()
            page.evaluate('window.editorialDualChainQA.finishProductionControl()')
            check(name + ' unknown directly retries only selected step', page.evaluate('window.editorialDualChainQA.productionCalls.map(c=>({action:c.action,nodeId:c.nodeId}))') == [{'action': 'retry-unknown', 'nodeId': page.evaluate('window.editorialDualChainQA.snapshot().document.productionRun.nodes.find(n=>n.status==="unknown").id')}])
            dialog.get_by_role('button', name='关闭', exact=True).click()

            fixture('unknown')
            recovery = page.get_by_role('button', name='查看失败与恢复', exact=True)
            recovery.click()
            dialog = page.get_by_role('dialog', name='自动制作进度')
            expect(dialog.get_by_role('button', name='直接重试此步骤', exact=True)).to_be_enabled()
            dialog.get_by_text('其他恢复选项', exact=True).click()
            unlock = dialog.get_by_role('button', name='记录核对并解锁此步骤', exact=True)
            expect(unlock).to_be_disabled()
            dialog.get_by_role('textbox', name='服务商核对依据', exact=True).fill('已在服务商请求记录核对确认没有结果')
            dialog.get_by_role('checkbox', name='已确认没有结果；继续制作可能再次计费', exact=True).check()
            expect(unlock).to_be_enabled()
            capture(name + '-unknown-recovery')
            dialog.get_by_role('button', name='关闭', exact=True).click()
            check(name + ' unknown opens recovery without submission', page.evaluate('window.editorialDualChainQA.productionCalls.length') == 0)

        fixture('paused')
        expect(page.get_by_role('button', name='继续自动制作', exact=True)).to_be_enabled()
        page.get_by_role('button', name='制作进度', exact=True).click()
        dialog = page.get_by_role('dialog', name='自动制作进度')
        expect(dialog.get_by_role('button', name='继续自动制作', exact=True)).to_be_enabled()
        dialog.get_by_role('button', name='关闭', exact=True).click()
        fixture('completed')
        page.get_by_role('button', name='制作进度', exact=True).click()
        dialog = page.get_by_role('dialog', name='自动制作进度')
        expect(dialog.get_by_role('button', name='重试失败步骤')).to_have_count(0)
        expect(dialog.get_by_role('button', name='继续自动制作')).to_have_count(0)
        check('no renderer exceptions', not report['errors'])
finally:
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)
    server.shutdown()
    log.close()
    (ART / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
print(json.dumps(report, ensure_ascii=False, indent=2))
