"""Desktop visual QA for Agent Search settings and sourced results."""
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
OUTPUT = ROOT / '.artifacts' / 'agent-search-ui'
spec = importlib.util.spec_from_file_location('qa_base', ROOT / 'scripts' / 'qa-director-desk.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def capture(page, report, name: str, width: int, height: int, selector: str):
    base.set_size(page, width, height)
    metrics = page.evaluate("""selector => {
      const root = document.querySelector(selector);
      return {
        width: innerWidth,
        pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        rootOverflow: root ? root.scrollWidth > root.clientWidth + 1 : null,
      };
    }""", selector)
    assert metrics['rootOverflow'] is not None, metrics
    assert not metrics['pageOverflow'] and not metrics['rootOverflow'], metrics
    path = OUTPUT / f'{name}-{width}.png'
    page.screenshot(path=path, animations='disabled')
    assert base.screenshot_variance(path) > 10
    report['captures'].append({'file': str(path), **metrics})


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix='profile-', dir=OUTPUT))
    env = {
        **os.environ,
        'NODE_ENV': 'production',
        'STORYDREAM_PROJECT_QA_DIR': str(profile),
        'PYTHONIOENCODING': 'utf-8',
    }
    for key in ['NODE_OPTIONS', 'VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE']:
        env.pop(key, None)
    report = {'status': 'running', 'checks': [], 'captures': [], 'runtimeErrors': [], 'paidCalls': 0}
    process = None
    try:
        with sync_playwright() as pw:
            port = base.free_port()
            with (OUTPUT / 'electron.log').open('wb') as log:
                process = subprocess.Popen(
                    [str(base.ELECTRON), f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1', f'--user-data-dir={profile}', str(ROOT / 'scripts' / 'qa-project-home.cjs')],
                    cwd=ROOT,
                    env=env,
                    stdout=log,
                    stderr=log,
                    creationflags=subprocess.CREATE_NO_WINDOW,
                )
            browser = pw.chromium.connect_over_cdp(base.wait_cdp(port, process))
            page = browser.contexts[0].pages[0]
            page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
            base.wait_app(page)

            page.locator('.nav-list [data-nav-view="settings"]').click()
            expect(page.locator('.app-shell')).to_have_attribute('data-shell-view', 'settings')
            page.locator('.settings-tab', has_text='联网搜索').click()
            expect(page.get_by_role('switch', name='启用 Agent Search 聚合搜索')).to_be_checked()
            expect(page.get_by_text('搜索顺序：Agent Search → SearXNG → Tavily Keyless → 兼容搜索源。', exact=False)).to_be_visible()
            for width, height in [(1440, 900), (1040, 720)]:
                capture(page, report, 'settings', width, height, '.settings-layout')

            base.set_size(page, 1440, 900)
            page.locator('.nav-list [data-nav-view="person-assets"]').click()
            expect(page.locator('.nav-list [data-nav-view="copy-studio"]')).to_be_visible()
            page.locator('.nav-list [data-nav-view="copy-studio"]').click()
            expect(page.locator('.app-shell')).to_have_attribute('data-shell-view', 'copy-studio')
            page.get_by_label('搜索主题', exact=True).fill('OpenAI GPT-5')
            page.get_by_role('button', name='搜索来源', exact=True).click()
            expect(page.locator('.copy-studio-backend-status[data-state="ready"]')).to_be_visible(timeout=30_000)
            expect(page.locator('.copy-studio-source-list .copy-studio-source').first).to_be_visible()
            source_label = page.locator('.copy-studio-source-list .copy-studio-source small').first.inner_text()
            assert source_label.startswith('Agent Search'), source_label
            for width, height in [(1440, 900), (1040, 720)]:
                capture(page, report, 'copy-studio', width, height, '[data-copy-studio]')

            report['checks'].append('Agent Search is enabled and the configured fallback order is visible')
            report['checks'].append(f'Live result attribution is visible as {source_label}')
            report['checks'].append('Settings and Copy Studio have no horizontal overflow at 1440x900 or 1040x720')
            assert not report['runtimeErrors'], report['runtimeErrors']
            report['status'] = 'passed'
    except Exception:
        report['status'] = 'failed'
        report['error'] = traceback.format_exc()
        raise
    finally:
        (OUTPUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        if process and process.poll() is None:
            process.kill()
            process.wait(timeout=10)


if __name__ == '__main__':
    main()
