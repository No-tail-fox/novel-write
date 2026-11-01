from __future__ import annotations
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import traceback
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/project-models-qa'
spec = importlib.util.spec_from_file_location('project_models_qa_base', ROOT / 'scripts/qa-director-desk.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix='profile-', dir=OUTPUT))
    env = {**os.environ, 'NODE_ENV': 'production', 'STORYDREAM_PROJECT_QA_DIR': str(profile), 'PYTHONIOENCODING': 'utf-8'}
    for key in ['NODE_OPTIONS', 'VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE']:
        env.pop(key, None)
    subprocess.run(['node', str(ROOT / 'node_modules/tsx/dist/cli.mjs'), str(ROOT / 'scripts/qa-project-models-seed.ts'), str(profile)], cwd=ROOT, env=env, check=True)
    seed = json.loads((profile / 'seed.json').read_text(encoding='utf-8'))
    (profile / 'controls.json').write_text(json.dumps({'delayBootstrap': 2500, 'failBootstrapOnce': True}), encoding='utf-8')
    report = {'checks': [], 'captures': [], 'runtimeErrors': [], 'profile': str(profile)}
    process = browser = None
    def passed(label):
        report['checks'].append(label)
        print(label, flush=True)
    try:
        port = base.free_port()
        with (OUTPUT / 'electron.log').open('ab') as log:
            process = subprocess.Popen([str(base.ELECTRON), f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1', f'--user-data-dir={profile}', str(ROOT / 'scripts/qa-project-home.cjs')], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(base.wait_cdp(port, process))
            context = browser.contexts[0]
            page = context.pages[0] if context.pages else context.wait_for_event('page', timeout=30000)
            page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
            expect(page.locator('.route-loading-state')).to_be_visible()
            expect(page.locator('.project-model-fields')).to_have_count(0)
            expect(page.locator('.route-loading-state')).to_contain_text('正在尝试重新连接', timeout=15000)
            page.wait_for_selector('[data-project-home]', timeout=30000)
            expect(page.locator('.global-action-banner')).to_have_count(0)
            (profile / 'controls.json').write_text('{}', encoding='utf-8')
            passed('Startup waits for saved settings and recovers an initial bootstrap failure without mounting creation forms')
            def capture(name, width=1536, height=1024, focus=None):
                base.set_size(page, width, height)
                if focus is not None:
                    focus.scroll_into_view_if_needed()
                metrics = page.evaluate("""() => ({overflow: document.documentElement.scrollWidth > innerWidth + 1, width: innerWidth, height: innerHeight})""")
                assert not metrics['overflow'], metrics
                file = f'{name}-{width}x{height}.png'
                page.screenshot(path=OUTPUT / file, animations='disabled')
                assert base.screenshot_variance(OUTPUT / file) > 10
                report['captures'].append({'file': file, **metrics})
            def navigate(route):
                page.evaluate('async route => { await window.storydream.saveUiPreferences({activeView: route}); }', route)
                page.reload(wait_until='domcontentloaded')
                base.wait_app(page)
            normal = seed['projects'][0]['id']
            page.locator(f'[data-project-id="{normal}"]').get_by_role('button', name='项目模型', exact=True).click()
            dialog = page.get_by_role('dialog')
            expect(dialog).to_be_visible()
            expect(dialog.get_by_label('语言模型', exact=True)).to_have_value('llm-a')
            capture('model-dialog-light')
            capture('model-dialog-light-compact', 1040, 720)
            dialog.get_by_label('语言模型', exact=True).select_option('llm-b')
            dialog.get_by_label('生图模型', exact=True).select_option('image-b')
            dialog.get_by_label('视频模型', exact=True).select_option('video-b')
            dialog.get_by_role('button', name='保存项目模型', exact=True).click()
            expect(dialog).not_to_be_visible()
            actual = page.evaluate('async id => (await window.storydream.getTaskDetail(id)).projectModels', normal)
            assert actual == {'llmProfileId': 'llm-b', 'imageProfileId': 'image-b', 'videoProviderId': 'video-b'}, actual
            passed('Desktop IPC persists all three project choices from the dialog')
            page.locator(f'[data-project-id="{normal}"]').get_by_role('button', name='项目模型', exact=True).click()
            expect(dialog.get_by_label('语言模型', exact=True)).to_have_value('llm-b')
            dialog.get_by_role('button', name='取消', exact=True).click()
            page.get_by_role('button', name='切换深色主题', exact=True).click()
            page.locator(f'[data-project-id="{normal}"]').get_by_role('button', name='项目模型', exact=True).click()
            capture('model-dialog-dark')
            capture('model-dialog-dark-compact', 1040, 720)
            dialog.get_by_role('button', name='取消', exact=True).click()
            missing = next(p['id'] for p in seed['projects'] if p['title'].startswith('配置已删除'))
            page.locator(f'[data-project-id="{missing}"]').get_by_role('button', name='项目模型', exact=True).click()
            expect(dialog.get_by_label('生图模型', exact=True)).to_have_value('image-missing')
            dialog.get_by_role('button', name='保存项目模型', exact=True).click()
            expect(dialog.get_by_role('alert')).to_contain_text('PROJECT_IMAGE_PROFILE_MISSING')
            capture('missing-profile', 1040, 720)
            dialog.get_by_role('button', name='取消', exact=True).click()
            passed('Deleted profile remains explicit and cannot silently fall back')
            paused = next(p['id'] for p in seed['projects'] if p['title'].startswith('暂停项目'))
            page.locator(f'[data-project-id="{paused}"]').get_by_role('button', name='项目模型', exact=True).click()
            expect(dialog.get_by_role('button', name='保存项目模型', exact=True)).to_be_disabled()
            expect(dialog.get_by_label('语言模型', exact=True)).to_be_disabled()
            capture('locked-project', 1040, 720)
            dialog.get_by_role('button', name='取消', exact=True).click()
            passed('Paused projects expose read only model choices')
            page.get_by_role('tab', name='已归档', exact=True).click()
            archived = next(p['id'] for p in seed['projects'] if p['title'].startswith('归档项目'))
            page.locator(f'[data-project-id="{archived}"]').get_by_role('button', name='项目模型', exact=True).click()
            expect(dialog.get_by_role('button', name='保存项目模型', exact=True)).to_be_disabled()
            capture('archived-project', 1040, 720)
            dialog.get_by_role('button', name='取消', exact=True).click()
            page.get_by_role('tab', name='活跃项目', exact=True).click()
            passed('Archived projects retain visible model choices with editing disabled')
            page.locator(f'[data-project-id="{normal}"] .project-card-open').click()
            expect(page.locator('.project-model-bar')).to_contain_text('语言配置 B')
            page.locator('.project-model-bar').get_by_role('button', name='项目模型', exact=True).click()
            dialog.get_by_label('语言模型', exact=True).select_option('llm-a')
            dialog.get_by_role('button', name='保存项目模型', exact=True).click()
            expect(page.locator('.project-model-bar')).to_contain_text('语言配置 A')
            capture('ordinary-project-workspace', 1040, 720)
            passed('Workspace updates its displayed model immediately after saving')
            for route in ['new-task', 'editorial-collage', 'motion-comic', 'html-video', 'music-mv']:
                navigate(route)
                if route == 'new-task':
                    page.get_by_role('tab', name='3 制作设置', exact=True).click()
                fields = page.locator('.project-model-fields').first
                expect(fields).to_be_visible()
                fields.scroll_into_view_if_needed()
                expect(fields.get_by_label('语言模型', exact=True)).to_have_value('llm-a')
                capture(f'create-{route}', 1040, 720)
                passed(f'{route} creation exposes one model set for the whole project')
            navigate('projects')
            for project in seed['projects'][1:4]:
                page.locator(f'[data-project-id="{project["id"]}"] .project-card-open').click()
                expect(page.locator('.project-model-bar')).to_be_visible()
                capture(f'workspace-{project["taskType"]}', 1040, 720)
                navigate('projects')
            passed('Creative animation, comic, and HTML workspaces expose project model settings')
            navigate('settings')
            capture('global-settings', 1536, 1024)
            navigate('image-lab')
            image_choice = page.get_by_label('生图模型', exact=True)
            expect(image_choice).to_have_value('image-a')
            image_choice.select_option('image-b')
            expect(image_choice).to_have_value('image-b')
            page.wait_for_function("() => JSON.parse(localStorage.getItem('storydream.image-lab-workspace.v1') || '{}').imageProfileId === 'image-b'")
            page.reload(wait_until='domcontentloaded')
            expect(image_choice).to_have_value('image-b')
            image_choice.scroll_into_view_if_needed()
            capture('standalone-image-models', 1040, 720, focus=image_choice)
            passed('Standalone image generation retains the selected saved profile across reloads')
            assert not report['runtimeErrors'], report['runtimeErrors']
            ledger = json.loads((profile / 'ledger.json').read_text(encoding='utf-8'))
            assert ledger['blockedGeneration'] == 0, ledger
            passed('No model generation or rendering was triggered during desktop QA')
            report['status'] = 'passed'
    except Exception:
        report['status'] = 'failed'
        report['failure'] = traceback.format_exc()
        print(report['failure'], flush=True)
        raise
    finally:
        (OUTPUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        if browser:
            try: browser.close()
            except Exception: pass
        if process and process.poll() is None:
            process.terminate()
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired: process.kill()

if __name__ == '__main__': main()
