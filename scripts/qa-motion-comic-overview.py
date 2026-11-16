"""Offline smoke check of the actual project overview and fixed shell."""
import importlib.util
import json
import os
import subprocess
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('comic_qa', ROOT / 'scripts/qa-motion-comic.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
ART = ROOT / '.artifacts/comic-approved-design'
ART.mkdir(parents=True, exist_ok=True)
profile = Path(tempfile.mkdtemp(prefix='comic-overview-'))
subprocess.run([str(ROOT / 'scripts/run-npm-node.cmd'), 'node_modules/tsx/dist/cli.mjs', 'scripts/qa-motion-comic-script-fixture.ts', str(profile)], cwd=ROOT, check=True)
fixture = json.loads((profile / 'script-fixture.json').read_text(encoding='utf8'))
audit = base.create_offline_electron_entry(profile)
env = os.environ.copy()
env['NODE_ENV'] = 'production'
for key in (*base.PAID_API_ENV_VARS, 'VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS'):
    env.pop(key, None)
port = base.available_port()
process = subprocess.Popen([str(base.ELECTRON), f'--remote-debugging-port={port}', f'--user-data-dir={profile}', str(profile)], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
report = {'checks': [], 'screenshots': [], 'errors': [], 'profile': str(profile)}
try:
    with sync_playwright() as pw:
        browser = pw.chromium.connect_over_cdp(base.wait_for_cdp(port, process))
        context = browser.contexts[0]
        page = context.pages[0] if context.pages else context.wait_for_event('page', timeout=30000)
        page.on('pageerror', lambda error: report['errors'].append(str(error)))
        try:
            base.wait_for_app(page)
        except Exception:
            report['startup'] = {'url': page.url, 'text': page.locator('body').inner_text(), 'pages': [p.url for p in context.pages]}
            page.screenshot(path=str(ART / 'startup-failure.png'))
            raise
        base.set_window_size(page, 1600, 1000)
        base.navigate_sidebar(page, 'history', "[data-task-operations='history']")
        page.get_by_role('textbox', name='搜索历史记录').fill('后台分集剧本流程验收')
        page.get_by_role('button', name='打开任务 后台分集剧本流程验收', exact=True).click()
        overview = page.get_by_role('region', name='漫剧项目总览')
        expect(overview).to_be_visible(timeout=30000)
        expect(page.locator('.sidebar')).to_be_visible()
        expect(overview.get_by_role('article')).to_have_count(24)
        page.screenshot(path=str(ART / 'project-overview.png'))
        report['screenshots'].append(str(ART / 'project-overview.png'))
        overview.get_by_role('button', name='编辑剧本', exact=True).first.click()
        expect(page.locator('[data-motion-comic-script-workspace]')).to_be_visible(timeout=30000)
        tabs = page.get_by_role('tablist', name='漫剧项目功能区')
        for label in ['剧本', '资产', '分镜', '生产', '预览']:
            expect(tabs.get_by_role('tab', name=label, exact=True)).to_be_visible()
        page.screenshot(path=str(ART / 'script-domains.png'))
        report['screenshots'].append(str(ART / 'script-domains.png'))
        tabs.get_by_role('tab', name='资产', exact=True).click()
        expect(page.locator('[data-motion-comic-production]')).to_have_attribute('data-stage', 'assets')
        page.get_by_role('button', name='返回项目总览', exact=True).click()
        expect(overview).to_be_visible()
        report['checks'].extend(['24 source episodes visible in overview', 'global sidebar retained', 'five domain navigation', 'unstructured episode opens script', 'assets returns to project overview'])
        assert not report['errors'], report['errors']
        browser.close()
finally:
    process.terminate()
    process.wait(timeout=15)
    report['externalRequests'] = base.read_json_lines(audit)
    (ART / 'overview-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
print(json.dumps(report, ensure_ascii=False))
