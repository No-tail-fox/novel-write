"""Exercise real Electron theme persistence and a controlled disk-write failure."""
import importlib.util
import json
import os
import subprocess
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/theme-qa'
spec = importlib.util.spec_from_file_location('qa_base', ROOT / 'scripts/qa-director-desk.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix='profile-', dir=OUTPUT))
    controls = profile / 'controls.json'
    controls.write_text(json.dumps({'failThemeSave': False}), encoding='utf-8')
    report = {'checks': [], 'captures': [], 'runtimeErrors': [], 'profile': str(profile)}
    environment = {**os.environ, 'NODE_ENV': 'production', 'STORYDREAM_THEME_QA_DIR': str(profile)}
    for key in ['VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS']:
        environment.pop(key, None)
    process = browser = page = playwright = None

    def theme(value):
        expect(page.locator('html')).to_have_attribute('data-theme', value)
        expect(page.locator('.storydream-provider')).to_have_attribute('data-storydream-theme', value)
        expect(page.locator('.theme-toggle')).to_have_accessible_name(
            '切换深色主题' if value == 'light' else '切换浅色主题')

    def idle():
        expect(page.locator('.theme-toggle')).to_be_enabled()

    def persisted(value):
        saved = page.evaluate('''async () => {
          const state = await window.storydream.getBootstrap();
          return {ui: state.ui.theme, config: state.config.ui.theme};
        }''')
        assert saved == {'ui': value, 'config': value}, saved

    def select_appearance():
        page.locator('[data-nav-view="settings"]').first.click()
        page.locator('.settings-navigation').get_by_role('tab', name='外观').click()
        expect(page.locator('.settings-heading h2')).to_have_text('外观')

    def select_theme(value):
        page.get_by_role('tablist', name='主题', exact=True).get_by_role(
            'tab', name='浅色' if value == 'light' else '深色', exact=True).click()

    try:
        playwright = sync_playwright().start()
        port = base.free_port()
        with (profile / 'electron.log').open('wb') as log:
            process = subprocess.Popen([
                str(base.ELECTRON), f'--remote-debugging-port={port}',
                '--remote-debugging-address=127.0.0.1', f'--user-data-dir={profile}',
                str(ROOT / 'scripts/qa-theme.cjs'),
            ], cwd=ROOT, env=environment, stdout=log, stderr=log,
                creationflags=subprocess.CREATE_NO_WINDOW)
        browser = playwright.chromium.connect_over_cdp(base.wait_cdp(port, process))
        context = browser.contexts[0]
        page = context.pages[0] if context.pages else context.wait_for_event('page')
        page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
        base.wait_app(page)
        base.set_size(page, 1440, 900)
        theme('dark')
        page.locator('.theme-toggle').click()
        idle()
        theme('light')
        persisted('light')
        report['checks'].append('shell toggle updates DOM, Fluent provider and persisted canonical pair')
        base.reload_app(page)
        theme('light')
        report['checks'].append('light theme survives renderer reload')
        select_appearance()
        select_theme('dark')
        theme('dark')
        expect(page.get_by_role('tab', name='深色', exact=True)).to_be_enabled()
        persisted('dark')
        select_theme('light')
        theme('light')
        expect(page.get_by_role('tab', name='浅色', exact=True)).to_be_enabled()
        persisted('light')
        report['checks'].append('appearance selector changes both directions and saves')
        for width, height in [(1440, 900), (1024, 768)]:
            base.set_size(page, width, height)
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
            shot = OUTPUT / f'light-settings-{width}.png'
            page.screenshot(path=shot, animations='disabled')
            report['captures'].append(str(shot))
        base.set_size(page, 1440, 900)
        select_theme('dark')
        expect(page.get_by_role('tab', name='深色', exact=True)).to_be_enabled()
        persisted('dark')

        controls.write_text(json.dumps({'failThemeSave': True}), encoding='utf-8')
        page.locator('.theme-toggle').click()
        idle()
        theme('light')
        expect(page.get_by_text('主题已应用，但未能保存', exact=False).first).to_be_visible()
        persisted('dark')
        page.locator('[data-nav-view="queue"]').first.click()
        idle()
        theme('light')
        base.wait_for_async_condition(page, '''async () =>
          (await window.storydream.getBootstrap()).ui.activeView === 'queue'
        ''', arg=None)
        theme('light')
        report['checks'].append('failed shell save keeps light theme after navigation preference delta')
        select_appearance()
        select_theme('dark')
        expect(page.get_by_role('tab', name='深色', exact=True)).to_be_enabled()
        theme('dark')
        select_theme('light')
        expect(page.get_by_role('tab', name='浅色', exact=True)).to_be_enabled()
        theme('light')
        expect(page.get_by_text('主题已应用，但未能保存', exact=False).first).to_be_visible()
        shot = OUTPUT / 'light-save-failure.png'
        page.screenshot(path=shot, animations='disabled')
        report['captures'].append(str(shot))
        report['checks'].append('failed appearance save retains current selection and gives save feedback')

        controls.write_text(json.dumps({'failThemeSave': False}), encoding='utf-8')
        select_theme('dark')
        expect(page.get_by_role('tab', name='深色', exact=True)).to_be_enabled()
        select_theme('light')
        expect(page.get_by_role('tab', name='浅色', exact=True)).to_be_enabled()
        persisted('light')
        base.reload_app(page)
        theme('light')
        report['checks'].append('theme saves again after storage recovers and survives reload')
        assert not report['runtimeErrors'], report['runtimeErrors']
        report['status'] = 'passed'
    except Exception as error:
        report['status'] = 'failed'
        report['error'] = str(error)
        if page:
            try:
                page.screenshot(path=OUTPUT / 'failure.png')
            except Exception:
                pass
        raise
    finally:
        if page:
            try:
                page.evaluate('window.storydream.windowControl("close")')
            except Exception:
                pass
        if browser:
            try:
                browser.close()
            except Exception:
                pass
        if playwright:
            playwright.stop()
        if process:
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.terminate()
                process.wait(timeout=10)
        (OUTPUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
