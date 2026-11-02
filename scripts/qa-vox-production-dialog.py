"""Exercise production feedback in an isolated Electron fixture, without providers."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('STORYDREAM_QA_ARTIFACT_DIR', ROOT / '.artifacts/vox-production-dialog')).resolve()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    node = shutil.which('node')
    assert node, 'Node.js is required'
    build = subprocess.run([node, '--input-type=module', '-e',
        "import {build} from 'vite';await build({configFile:false,base:'./',define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:process.argv[1],emptyOutDir:false,target:'chrome120',lib:{entry:'tests/vox-production-dialog.harness.tsx',name:'productionFeedbackQA',formats:['iife'],fileName:()=> 'harness.js',cssFileName:'harness'}}});", str(OUT)],
        cwd=ROOT, capture_output=True, text=True, encoding='utf-8')
    (OUT / 'build.log').write_text(build.stdout + build.stderr, encoding='utf-8')
    build.check_returncode()
    (OUT / 'index.html').write_text('<!DOCTYPE html><html lang="zh-CN" data-theme="dark" data-theme-ready="true"><head><meta charset="UTF-8"><link rel="stylesheet" href="harness.css"></head><body style="margin:0"><div id="root"></div><script src="harness.js"></script></body></html>', encoding='utf-8')
    (OUT / 'main.cjs').write_text("const {app,BrowserWindow,session}=require('electron');app.disableHardwareAcceleration();app.setPath('userData',__dirname+'/profile');app.whenReady().then(()=>{session.defaultSession.webRequest.onBeforeRequest((details,done)=>done({cancel:/^https?:/.test(details.url)}));const w=new BrowserWindow({width:1440,height:1000,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});w.loadFile(__dirname+'/index.html');});app.on('window-all-closed',()=>app.quit());", encoding='utf-8')
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    env = dict(os.environ)
    for key in ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS']:
        env.pop(key, None)
    report = {'checks': [], 'screenshots': [], 'errors': [], 'paidRequests': 0, 'realProviderVerified': False}
    process = None

    def check(name, passed=True):
        report['checks'].append({'name': name, 'passed': bool(passed)})
        assert passed, name

    try:
        with (OUT / 'electron.log').open('wb') as log:
            process = subprocess.Popen([str(ROOT / 'node_modules/electron/dist/electron.exe'), '--remote-debugging-port=' + str(port), '--remote-debugging-address=127.0.0.1', str(OUT / 'main.cjs')], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
        with sync_playwright() as playwright:
            browser = None
            for _ in range(80):
                try:
                    browser = playwright.chromium.connect_over_cdp('http://127.0.0.1:' + str(port))
                    break
                except Exception:
                    if process.poll() is not None:
                        raise RuntimeError('Electron exited before its debugger was available')
                    time.sleep(.25)
            assert browser is not None, 'Electron debugger connection timed out'
            page = browser.contexts[0].pages[0]
            page.on('pageerror', lambda error: report['errors'].append(str(error)))
            page.on('console', lambda message: report['errors'].append(message.text) if message.type == 'error' else None)
            page.set_default_timeout(15000)
            page.goto((OUT / 'index.html').as_uri(), wait_until='load')
            opener = page.get_by_role('button', name='自动制作…', exact=True)
            dialog = page.get_by_role('dialog', name='自动制作设置', exact=True)
            start = dialog.get_by_role('button', name='按此风格创作全片', exact=True)
            alert = dialog.get_by_role('alert')
            current_theme = 'dark'
            for width, height, theme in [(1440, 1000, 'dark'), (1040, 720, 'dark'), (1040, 720, 'light'), (1440, 1000, 'light')]:
                if theme != current_theme:
                    page.get_by_role('button', name='切换主题', exact=True).click()
                    current_theme = theme
                page.set_viewport_size({'width': width, 'height': height})
                opener.click()
                expect(dialog).to_be_visible()
                expect(dialog.get_by_label('动画创作要求', exact=True)).to_have_value('')
                dialog.get_by_label('动画创作要求', exact=True).fill('大字开场，节奏克制。')
                start.click()
                expect(alert).to_contain_text('尚未完成 Lemo 能力验证')
                expect(dialog.get_by_text('请先保存设置，再在页面顶部', exact=False)).to_be_visible()
                expect(start).to_be_enabled()
                check(f'{width}-{theme}: failure remains in modal and retry is available')
                expect(dialog.get_by_label('动画创作要求', exact=True)).to_have_value('大字开场，节奏克制。')
                check(f'{width}-{theme}: unsaved requirements survive failure')
                for edge in ['top', 'bottom']:
                    dialog.locator('.fui-DialogContent').evaluate('(e,edge) => {e.scrollTop = edge === "top" ? 0 : e.scrollHeight;}', edge)
                    check(f'{width}-{theme}: footer visible at content {edge}', alert.evaluate('(e) => {const r=e.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight && r.left>=0 && r.right<=innerWidth;}'))
                check(f'{width}-{theme}: no overflow or clipped dialog', dialog.evaluate('(e) => {const r=e.getBoundingClientRect();return e.scrollWidth<=e.clientWidth+1 && r.left>=0 && r.right<=innerWidth+1 && r.top>=0 && r.bottom<=innerHeight+1;}'))
                check(f'{width}-{theme}: feedback does not cover buttons', alert.bounding_box()['y'] + alert.bounding_box()['height'] <= start.bounding_box()['y'])
                path = OUT / f'failure-{width}-{theme}.png'
                page.screenshot(path=str(path), animations='disabled')
                report['screenshots'].append(str(path))
                page.keyboard.press('Escape')
                expect(dialog).to_have_count(0)
                expect(page.locator('#root')).not_to_have_attribute('aria-hidden', 'true')
                expect(opener).to_be_focused()
                check(f'{width}-{theme}: Escape returns keyboard focus')

            opener.click()
            page.evaluate('window.productionFeedbackQA.hold = true')
            before = page.evaluate('window.productionFeedbackQA.calls.length')
            start.evaluate('(e) => {e.click();e.click();}')
            expect(dialog.get_by_role('button', name='准备中…', exact=True)).to_be_disabled()
            expect(dialog.get_by_role('button', name='保存设置', exact=True)).to_be_disabled()
            expect(dialog.get_by_label('动画创作要求', exact=True)).to_be_disabled()
            page.keyboard.press('Escape')
            expect(dialog).to_be_visible()
            check('busy state prevents duplicate requests and dismissal', page.evaluate('window.productionFeedbackQA.calls.length') == before + 1)
            page.evaluate('window.productionFeedbackQA.hold=false;window.productionFeedbackQA.finish()')
            expect(alert).to_contain_text('尚未完成 Lemo 能力验证')
            check('startup failure restores retry', start.is_enabled())
            page.evaluate('window.productionFeedbackQA.failure="SAVE_FAILED: 项目保存失败，请重试。"')
            dialog.get_by_role('button', name='保存设置', exact=True).click()
            expect(alert).to_contain_text('项目保存失败，请重试。')
            check('save failure remains visible inside modal')
            page.evaluate('window.productionFeedbackQA.failure="NETWORK_ERROR: 网络连接失败，请稍后重试。"')
            start.click()
            expect(alert).to_contain_text('网络连接失败，请稍后重试。')
            expect(dialog.get_by_text('请先保存设置，再在页面顶部', exact=False)).to_have_count(0)
            check('new failure replaces previous message and protocol-only advice')
            dialog.get_by_label('动画创作要求', exact=True).fill('保留这个尚未保存的创作要求。')
            page.evaluate('window.productionFeedbackQA.failure="";window.productionFeedbackQA.hold=true')
            start.click()
            expect(dialog.get_by_role('button', name='准备中…', exact=True)).to_be_disabled()
            expect(alert).to_have_count(0)
            check('retry clears previous feedback while pending')
            page.evaluate('window.productionFeedbackQA.hold=false;window.productionFeedbackQA.finish()')
            expect(dialog).to_have_count(0)
            check('successful start closes modal only after completion')
            check('retry submits preserved requirements', page.evaluate('window.productionFeedbackQA.calls.at(-1).settings.authoring.brief') == '保留这个尚未保存的创作要求。')
            opener.click()
            expect(dialog.get_by_label('动画创作要求', exact=True)).to_have_value('保留这个尚未保存的创作要求。')
            dialog.get_by_role('button', name='保存设置', exact=True).click()
            expect(dialog).to_have_count(0)
            expect(opener).to_be_focused()
            check('reopening uses saved settings and successful save restores focus')
            check('no renderer exceptions', not report['errors'])
            report['status'] = 'passed'
            browser.close()
    except Exception as error:
        report['status'] = 'failed'
        report['error'] = str(error)
        try:
            page.screenshot(path=str(OUT / 'failure.png'), animations='disabled')
        except Exception:
            pass
        raise
    finally:
        (OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        if process and process.poll() is None:
            subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
    print(json.dumps({'status': report['status'], 'checks': len(report['checks']), 'output': str(OUT)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
