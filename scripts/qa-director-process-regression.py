"""Offline production-Electron regression for the shared comic director/dialog.

The old eight-stage suite predates the separate asset section. This focused
suite selects current stages by accessible name and checks the shared surfaces
changed for Vox; it does not replace the full comic production acceptance.
"""
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('comic_qa', ROOT / 'scripts/qa-motion-comic.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
base.PROJECT_TITLE = 'Vox 改版共享导演台回归'
ART = ROOT / 'docs/design/2026-10-22-vox-generation-simplification/implementation-evidence/comic-regression'
ART.mkdir(parents=True, exist_ok=True)
profile = Path(tempfile.mkdtemp(prefix='comic-director-regression-', dir=ROOT / '.codex-temp'))
image = ROOT / 'src/assets/director-desk/shot-alley.png'
video = base.create_video_fixture(image, profile / 'fixture.mp4')
audit = base.create_offline_electron_entry(profile)
port = base.available_port()
env = os.environ.copy()
env['NODE_ENV'] = 'production'
for name in (*base.PAID_API_ENV_VARS, 'VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS'):
    env.pop(name, None)
process = subprocess.Popen(
    [str(base.ELECTRON), f'--remote-debugging-port={port}', f'--user-data-dir={profile}', str(profile)],
    cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    creationflags=subprocess.CREATE_NO_WINDOW,
)
report = {'surface': 'production Electron, isolated profile, offline comic fixture', 'checks': [], 'screenshots': [], 'errors': [], 'paidCalls': 0}


def check(name, value):
    report['checks'].append({'name': name, 'passed': bool(value)})
    assert value, name


try:
    with sync_playwright() as pw:
        browser = pw.chromium.connect_over_cdp(base.wait_for_cdp(port, process))
        context = browser.contexts[0]
        page = context.pages[0] if context.pages else context.wait_for_event('page', timeout=30000)
        page.on('pageerror', lambda e: report['errors'].append(str(e)))
        base.wait_for_app(page)
        base.set_window_size(page, 1536, 1024)
        task_id = page.evaluate('''async title => (await window.storydream.createMotionComic({
            title, premise:'核对共享导演台布局和弹窗', ratio:'16:9',
            source:{kind:'script', adaptationMode:'faithful-script', originalText:'林夏在雨夜收到一封来自未来的信。',
            episodes:[{title:'雨夜来信',sourceText:'林夏在雨夜收到一封来自未来的信。'}]}
        })).task.id''', base.PROJECT_TITLE)
        base.seed_structured_motion_comic(page, task_id, image, video)
        base.reopen_created_project(page)
        page.get_by_role('button', name=re.compile(r'^\d+\. 分镜图，')).click()
        page.wait_for_selector('.director-desk')
        check('comic retains preview-first composition', page.locator('.director-desk').get_attribute('data-workspace-layout') == 'preview-first')
        check('Vox outline not injected into comic', page.locator('.vox-process-pane').count() == 0)
        check('comic retains shot filmstrip', page.locator('.director-filmstrip').is_visible())
        check('Vox project footer not injected into comic', page.locator('.vox-project-action-bar').count() == 0)
        for theme in ['dark', 'light']:
            base.set_theme(page, theme)
            for width, height in [(1536, 1024), (1040, 720)]:
                base.set_window_size(page, width, height)
                base.inspect_director_workspace_layout(page, 'storyboard')
                check(f'{theme}-{width} no page horizontal overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth+1'))
                name = f'{theme}-{width}.png'
                page.screenshot(path=str(ART / name), animations='disabled')
                report['screenshots'].append(name)
        base.set_window_size(page, 1536, 1024)
        opener = page.get_by_role('button', name='预览设置', exact=True)
        opener.click()
        dialog = page.get_by_role('dialog', name='预览设置', exact=True)
        expect(dialog).to_be_visible()
        for _ in range(8):
            page.keyboard.press('Tab')
            check('comic dialog focus remains trapped', page.evaluate('!!document.activeElement.closest("[role=dialog]")'))
        page.keyboard.press('Escape')
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
        check('controlled comic dialog restores external opener', True)
        expect(page.locator('.director-inspector-pane')).to_be_visible()
        check('closing preview dialog preserves comic inspector', True)
        page.get_by_role('button', name='批量生成', exact=True).click()
        batch = page.get_by_role('dialog', name='批量生成计划', exact=True)
        expect(batch).to_be_visible()
        page.get_by_role('button', name='取消', exact=True).click()
        expect(batch).to_be_hidden()
        check('comic batch dialog opens and cancels', True)
        snapshot = base.persisted_workflow_snapshot(page, task_id)
        check('no new provider jobs', len(snapshot['providerJobs']) == 3 and all(job['providerId'] == 'qa-offline-fixture' for job in snapshot['providerJobs']))
        check('no page errors', not report['errors'])
        report['networkAudit'] = base.read_json_lines(audit)
        check('no external provider requests', not report['networkAudit'])
        report['status'] = 'passed'
        browser.close()
except Exception as error:
    report['status'] = 'failed'
    report['error'] = repr(error)
finally:
    (ART / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
    process.terminate()
print(json.dumps(report, ensure_ascii=False))
if report['status'] != 'passed':
    raise SystemExit(1)
