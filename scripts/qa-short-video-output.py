"""Real isolated Electron UI checks; no model calls and no user project mutations."""
import importlib.util
from contextlib import nullcontext
import json
import os
from pathlib import Path
import subprocess
import tempfile
import traceback
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.artifacts/short-video-output-ui'
spec = importlib.util.spec_from_file_location('short_video_qa_base', ROOT / 'scripts/qa-director-desk.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix='profile-', dir=OUT))
    env = {**os.environ, 'NODE_ENV': 'production', 'STORYDREAM_PROJECT_QA_DIR': str(profile), 'PYTHONIOENCODING': 'utf-8'}
    for key in ['NODE_OPTIONS', 'VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE']:
        env.pop(key, None)
    subprocess.run(['I:/nodejs/node.exe', str(ROOT / 'node_modules/tsx/dist/cli.mjs'), str(ROOT / 'scripts/qa-short-video-output-seed.ts'), str(profile)], check=True, cwd=ROOT, env=env)
    subprocess.run(['I:/nodejs/node.exe', str(ROOT / 'scripts/qa-short-video-output-build.mjs')], check=True, cwd=ROOT, env=env)
    env['STORYDREAM_PROJECT_QA_MAIN'] = str(OUT / 'main.mjs')
    seed = json.loads((profile / 'seed.json').read_text(encoding='utf-8'))
    report = {'checks': [], 'captures': [], 'runtimeErrors': [], 'profile': str(profile), 'paidRequests': 0, 'licenseFixture': True}
    process = browser = pw = None
    def check(name, value=True):
        report['checks'].append({'name': name, 'passed': bool(value)})
        assert value, name
    try:
        with nullcontext(sync_playwright().start()) as pw:
            port = base.free_port()
            with (OUT / 'electron.log').open('ab') as log:
                process = subprocess.Popen([str(base.ELECTRON), f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1', f'--user-data-dir={profile}', str(ROOT / 'scripts/qa-project-home.cjs')], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
            browser = pw.chromium.connect_over_cdp(base.wait_cdp(port, process))
            context = browser.contexts[0]
            page = context.pages[0] if context.pages else context.wait_for_event('page')
            page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
            page.set_default_timeout(20000)
            base.wait_app(page)
            def capture(name):
                check(name + ' no horizontal overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
                path = OUT / (name + '.png')
                page.screenshot(path=str(path), animations='disabled')
                report['captures'].append(str(path))
            def shell():
                back = page.get_by_role('button', name='返回项目', exact=True)
                if back.is_visible(): back.click()
                page.locator('[data-nav-view="projects"]').first.click()
            for width, height in [(1440, 900), (1040, 720)]:
                base.set_size(page, width, height)
                page.locator('[data-nav-view="new-task"]').first.click()
                expect(page.locator('[data-new-task-workbench]')).to_be_visible()
                page.get_by_role('tab', name='2 内容', exact=True).click()
                page.get_by_label('文案内容', exact=True).fill('双输出界面验收，不执行任何付费生成。')
                page.get_by_role('tab', name='3 制作设置', exact=True).click()
                mp4 = page.get_by_role('checkbox', name='直接成片 MP4', exact=True)
                draft = page.get_by_role('checkbox', name='剪映草稿', exact=True)
                expect(mp4).to_be_checked()
                expect(draft).not_to_be_checked()
                check(str(width) + ' defaults to MP4')
                for button in page.get_by_role('button', name='创建并开始生成', exact=True).all():
                    expect(button).to_be_enabled()
                expect(page.locator('.new-task-readiness')).not_to_contain_text('剪映目录')
                draft.check()
                expect(mp4).to_be_checked()
                expect(draft).to_be_checked()
                check(str(width) + ' supports both outputs')
                mp4.uncheck()
                expect(draft).to_be_checked()
                check(str(width) + ' supports draft only')
                draft.uncheck()
                expect(page.get_by_text('请选择至少一种输出方式。', exact=True)).to_be_visible()
                buttons = page.get_by_role('button', name='创建并开始生成', exact=True)
                expect(buttons).to_have_count(2)
                for button in buttons.all():
                    expect(button).to_be_disabled()
                check(str(width) + ' empty selection prevents creation')
                mp4.check()
                draft.check()
                capture(f'output-selection-{width}')
                page.get_by_role('tab', name='2 内容', exact=True).click()
                page.get_by_role('tab', name='3 制作设置', exact=True).click()
                expect(mp4).to_be_checked()
                expect(draft).to_be_checked()
                check(str(width) + ' preserves selections between stages')
                draft.uncheck()
                shell()
                for project in seed['projects']:
                    page.get_by_role('button', name='打开项目：' + project['title'], exact=True).click()
                    panel = page.locator('.task-output-deliverables')
                    if project['state'] == 'legacy':
                        expect(panel).to_have_count(0)
                        check(str(width) + ' historical task retains legacy delivery')
                    else:
                        panel.scroll_into_view_if_needed()
                        expect(panel.locator('[data-output-target="jianying-draft"]')).to_have_attribute('data-output-status', 'completed')
                        if project['state'] == 'completed':
                            video = panel.get_by_label('短片 MP4 成片预览', exact=True)
                            expect(video).to_be_visible()
                            check(str(width) + ' player leaves room for delivery status', video.bounding_box()['height'] <= height - 280 + 1)
                            page.wait_for_function('()=>{const v=document.querySelector(".task-output-video");return v && v.readyState>=2 && v.videoWidth>0}')
                            metadata = video.evaluate('(v)=>({duration:v.duration,width:v.videoWidth,height:v.videoHeight,error:v.error?.code})')
                            check(str(width) + ' real MP4 metadata loads', metadata['width'] == 1080 and metadata['height'] == 1920 and not metadata.get('error'))
                            video.evaluate('async v=>{v.muted=true;await v.play()}')
                            page.wait_for_function('()=>document.querySelector(".task-output-video").currentTime > 0.2')
                            video.evaluate('v=>v.pause()')
                            check(str(width) + ' real MP4 playback advances')
                        else:
                            expect(panel.locator('[data-output-target="mp4"]')).to_have_attribute('data-output-status', 'failed')
                            expect(panel.get_by_role('alert')).to_contain_text('编码失败')
                            expect(panel.locator('video')).to_have_count(0)
                            check(str(width) + ' partial failure retains successful draft')
                    capture(f"delivery-{project['state']}-{width}")
                    shell()
            check('no renderer runtime errors', not report['runtimeErrors'])
            ledger = json.loads((profile / 'ledger.json').read_text(encoding='utf-8'))
            check('no generation actions invoked', ledger['blockedGeneration'] == 0)
            report['status'] = 'passed'
    except Exception:
        report['status'] = 'failed'
        report['error'] = traceback.format_exc()
        if 'page' in locals():
            try:
                page.screenshot(path=str(OUT / 'failure.png'))
                (OUT / 'failure-dom.txt').write_text(page.locator('body').inner_text(), encoding='utf-8')
            except Exception: pass
        raise
    finally:
        (OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        if browser:
            try: browser.close()
            except Exception: pass
        if pw:
            try: pw.stop()
            except Exception: pass
        if process and process.poll() is None:
            process.terminate()
            process.wait(timeout=15)
        print(json.dumps({'status': report.get('status'), 'checks': len(report['checks'])}, ensure_ascii=False))

if __name__ == '__main__': main()
