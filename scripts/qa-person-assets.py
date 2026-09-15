"""Verify asset navigation, preview limitations, and real desktop filesystem operations."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/person-assets'


def open_assets(page):
    page.locator('[data-nav-level="primary"][data-nav-view="person-assets"]').click()
    expect(page.locator('.app-shell')).to_have_attribute('data-shell-view', 'person-assets')
    expect(page.get_by_role('heading', name='人物素材库')).to_be_visible()


def screenshot(page, name, report):
    page.screenshot(path=OUTPUT / f'{name}.png', full_page=True)
    report['screenshots'].append(name)
    geometry = page.evaluate('''() => {
      const nodes = [...document.querySelectorAll('.person-assets-layout, .person-list-panel, .person-assets-panel, .person-create-row, .person-image-grid')];
      return {
        viewport:innerWidth, document:document.documentElement.scrollWidth,
        overflow:nodes.filter(n => n.scrollWidth > n.clientWidth + 2).map(n => n.className),
      };
    }''')
    assert geometry['document'] <= geometry['viewport'] + 2, geometry
    assert not geometry['overflow'], geometry
    assert page.locator('.person-assets-panel .primary-action').evaluate('''button =>
      getComputedStyle(button.querySelector('.sd-button__content')).color === getComputedStyle(button).color
    '''), 'Primary action text must inherit its control contrast color'


def layouts(page, prefix, report):
    for theme in ['dark', 'light']:
        if page.locator('html').get_attribute('data-theme') != theme:
            page.locator('.theme-toggle').click()
        for width, height in [(1440, 900), (1040, 720), (390, 844)]:
            page.set_viewport_size({'width': width, 'height': height})
            page.wait_for_timeout(350)
            screenshot(page, f'{prefix}-{theme}-{width}', report)
    page.set_viewport_size({'width': 1440, 'height': 900})


def browser_checks(pw, report):
    browser = pw.chromium.launch(channel='chrome', headless=True)
    try:
        page = browser.new_page(viewport={'width': 1440, 'height': 900})
        page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
        page.goto('http://127.0.0.1:5173/')
        page.wait_for_selector('.app-shell')
        open_assets(page)
        expect(page.locator('.person-preview-notice')).to_be_visible()
        expect(page.locator('.person-create-row input')).to_be_disabled()
        expect(page.get_by_role('button', name='创建', exact=True)).to_be_disabled()
        expect(page.get_by_role('button', name='导入图片', exact=True)).to_be_disabled()
        expect(page.get_by_text('已创建人物素材库。', exact=True)).to_have_count(0)
        report['checks'].append('Preview disables unsupported mutations and shows the desktop prerequisite')
        layouts(page, 'browser-empty', report)
        for view in ['image-lab', 'voice-lab']:
            page.locator(f'[data-nav-level="secondary"][data-nav-view="{view}"]').click()
            expect(page.locator('.app-shell')).to_have_attribute('data-shell-view', view)
            open_assets(page)
        report['checks'].append('Primary library and both secondary labs remain reachable')
    finally:
        browser.close()


def desktop_checks(pw, report):
    spec = importlib.util.spec_from_file_location('asset_qa_base', ROOT / 'scripts/qa-director-desk.py')
    base = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(base)
    profile = Path(tempfile.mkdtemp(prefix='profile-', dir=OUTPUT))
    fixtures = profile / 'fixtures'
    fixtures.mkdir()
    shutil.copyfile(ROOT / 'src/assets/director-desk/preview-city.png', fixtures / 'asset-preview.png')
    env = {**os.environ, 'NODE_ENV': 'production', 'STORYDREAM_PROJECT_QA_DIR': str(profile)}
    for key in ['NODE_OPTIONS', 'VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE']:
        env.pop(key, None)
    process = None
    browser = None

    def controls(**values):
        (profile / 'asset-controls.json').write_text(json.dumps(values), encoding='utf-8')

    try:
        port = base.free_port()
        with (OUTPUT / 'electron.log').open('wb') as log:
            process = subprocess.Popen(
                [str(base.ELECTRON), f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1', f'--user-data-dir={profile}', str(ROOT / 'scripts/qa-person-assets.cjs')],
                cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW,
            )
        browser = pw.chromium.connect_over_cdp(base.wait_cdp(port, process))
        deadline = time.monotonic() + 30
        while not browser.contexts[0].pages and time.monotonic() < deadline:
            time.sleep(.1)
        page = browser.contexts[0].pages[0]
        page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
        base.wait_app(page)
        open_assets(page)
        expect(page.locator('.person-preview-notice')).to_have_count(0)
        expect(page.locator('.person-create-row input')).to_be_enabled()
        expect(page.get_by_role('button', name='创建', exact=True)).to_be_disabled()
        screenshot(page, 'desktop-empty', report)
        page.locator('.person-create-row input').fill('素材验证人物')
        page.get_by_role('button', name='创建', exact=True).click()
        expect(page.locator('.person-list-item')).to_have_count(1)
        expect(page.locator('.person-list-item.active')).to_contain_text('素材验证人物')
        expect(page.locator('.person-list-item.active')).to_have_attribute('aria-pressed', 'true')
        expect(page.locator('.person-asset-feedback [role="status"]')).to_have_text('已创建人物素材库。')
        report['checks'].append('Desktop creates and selects a real library')

        controls(cancelImport=True)
        page.get_by_role('button', name='导入图片', exact=True).click()
        expect(page.locator('.person-asset-feedback [role="status"]')).to_have_text('没有导入新图片。')
        expect(page.locator('.person-image-card')).to_have_count(0)
        controls(failImport=True)
        page.get_by_role('button', name='导入图片', exact=True).click()
        expect(page.locator('.person-asset-feedback [role="alert"]')).to_contain_text('图片导入失败')
        expect(page.get_by_role('button', name='导入图片', exact=True)).to_be_enabled()
        screenshot(page, 'desktop-import-error', report)
        controls()
        page.get_by_role('button', name='导入图片', exact=True).click()
        expect(page.locator('.person-image-card img')).to_have_count(1)
        page.wait_for_function('() => [...document.querySelectorAll(".person-image-card img")].every(i => i.complete && i.naturalWidth > 0)')
        expect(page.locator('.person-asset-feedback [role="status"]')).to_have_text('已导入 1 张图片。')
        expect(page.locator('.person-list-item.active')).to_contain_text('1 张图片')
        original_image = page.locator('.person-image-card span').get_attribute('title')
        assert Path(original_image).read_bytes() == (fixtures / 'asset-preview.png').read_bytes()
        report['checks'].append('Desktop import cancellation, failure, retry, real file copy and thumbnail rendering')
        layouts(page, 'desktop-populated', report)

        page.locator('.person-asset-tools input').fill('已重命名素材')
        page.get_by_role('button', name='重命名', exact=True).click()
        expect(page.locator('.person-list-item.active')).to_contain_text('已重命名素材')
        expect(page.locator('.person-asset-feedback [role="status"]')).to_have_text('已重命名人物素材库。')
        page.wait_for_function('() => document.querySelector(".person-image-card span")?.title.includes("已重命名素材")')
        renamed_image = Path(page.locator('.person-image-card span').get_attribute('title'))
        assert renamed_image.is_file() and not Path(original_image).exists()
        page.get_by_role('button', name='打开目录', exact=True).click()
        expect(page.get_by_role('button', name='打开目录', exact=True)).to_be_enabled()
        assert Path(json.loads((profile / 'opened-directory.json').read_text(encoding='utf-8'))['path']) == renamed_image.parent
        report['checks'].append('Rename preserves the image and open-directory resolves the actual asset folder')

        controls(failUsage=True)
        page.get_by_role('button', name='删除', exact=True).click()
        expect(page.locator('.person-asset-feedback [role="alert"]')).to_contain_text('素材引用查询失败')
        expect(page.locator('.person-list-item')).to_have_count(1)
        expect(page.get_by_role('button', name='删除', exact=True)).to_be_enabled()
        screenshot(page, 'desktop-usage-error', report)
        controls()
        page.get_by_role('button', name='删除', exact=True).click()
        expect(page.get_by_role('button', name='确认删除', exact=True)).to_be_enabled()
        expect(page.locator('.person-list-item')).to_have_count(1)
        page.get_by_role('button', name='确认删除', exact=True).click()
        expect(page.locator('.person-list-item')).to_have_count(0)
        expect(page.get_by_role('button', name='撤销删除', exact=True)).to_be_enabled()
        assert not renamed_image.exists()
        screenshot(page, 'desktop-deleted', report)
        page.get_by_role('button', name='撤销删除', exact=True).click()
        expect(page.locator('.person-list-item.active')).to_contain_text('已重命名素材')
        expect(page.locator('.person-asset-feedback [role="status"]')).to_have_text('已撤销删除，人物素材库已恢复。')
        assert renamed_image.read_bytes() == (fixtures / 'asset-preview.png').read_bytes()
        report['checks'].append('Failed usage check is visible and retry, two-step delete, and undo preserve the image')

        base.reload_app(page)
        open_assets(page)
        expect(page.locator('.person-list-item.active')).to_contain_text('已重命名素材')
        expect(page.locator('.person-image-card img')).to_have_count(1)
        page.wait_for_function('() => document.querySelector(".person-image-card img")?.naturalWidth > 0')
        screenshot(page, 'desktop-reloaded', report)
        report['checks'].append('Reload restores the persisted library and image')
        ledger = json.loads((profile / 'ledger.json').read_text(encoding='utf-8'))
        assert ledger['blockedGeneration'] == 0
        for channel in ['create', 'import-images', 'rename', 'usage', 'delete', 'restore', 'list-images', 'open-directory']:
            assert f'person-assets:{channel}' in ledger['calls'], channel
        report['paidGenerationCalls'] = 0
        report['profile'] = str(profile)
    finally:
        if browser:
            browser.close()
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=10)


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    report = {'status': 'running', 'checks': [], 'screenshots': [], 'runtimeErrors': []}
    try:
        with sync_playwright() as pw:
            browser_checks(pw, report)
            desktop_checks(pw, report)
        assert not report['runtimeErrors'], report['runtimeErrors']
        report['status'] = 'passed'
    except Exception as error:
        report.update(status='failed', error=str(error))
        raise
    finally:
        (OUTPUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
