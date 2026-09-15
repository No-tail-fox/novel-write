"""Compare all four creation-page back buttons in the live browser preview."""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/workspace-back-navigation/browser-preview'
URL = 'http://127.0.0.1:5173/'
WORKSPACES = [('vox', 'editorial-collage'), ('motion-comic', 'motion-comic'), ('html-video', 'html-video'), ('music-mv', 'music-mv')]


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    report = {'url': URL, 'status': 'running', 'captures': [], 'runtimeErrors': []}
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel='chrome', headless=True)
            try:
                page = browser.new_page(viewport={'width': 1440, 'height': 900})
                page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
                page.goto(URL)
                page.wait_for_selector('.new-task-type-picker')
                expect(page.locator('.app-shell')).to_have_attribute('data-runtime', 'browser-fallback')
                positions = {}
                for theme in ['dark', 'light']:
                    if page.locator('html').get_attribute('data-theme') != theme:
                        page.locator('.theme-toggle').click()
                    expect(page.locator('html')).to_have_attribute('data-theme', theme)
                    for creation_type, view in WORKSPACES:
                        page.locator(f'[data-task-creation-type="{creation_type}"]').click()
                        page.wait_for_selector(f'[data-shell-view="{view}"]')
                        if creation_type in ['vox', 'motion-comic']:
                            expect(page.locator('[data-director-create-wizard]')).to_be_visible()
                            expect(page.locator('.director-create-header button')).to_have_count(0)
                        back = page.get_by_role('button', name='返回新建任务', exact=True)
                        expect(back).to_have_count(1)
                        for width, height in [(1440, 900), (1040, 720), (390, 844)]:
                            page.set_viewport_size({'width': width, 'height': height})
                            expect(back).to_be_visible()
                            box = back.bounding_box()
                            position = tuple(box[key] for key in ['x', 'y', 'width', 'height'])
                            assert position == positions.setdefault((width, height), position), (view, position, positions)
                            assert box['width'] == box['height'] == 36
                            assert not page.evaluate('document.documentElement.scrollWidth > innerWidth + 1')
                            path = OUTPUT / f'{view}-{theme}-{width}x{height}.png'
                            page.screenshot(path=path, animations='disabled')
                            report['captures'].append({'file': str(path), 'theme': theme, 'view': view, 'viewport': [width, height], 'back': box})
                        page.set_viewport_size({'width': 1440, 'height': 900})
                        back.click()
                        page.wait_for_selector('.new-task-type-picker')
                        print(f'{theme}: {view} shared header and return passed', flush=True)
                assert not report['runtimeErrors'], report['runtimeErrors']
                comparison = Image.new('RGB', (700, 88 * len(WORKSPACES)))
                for index, (_, view) in enumerate(WORKSPACES):
                    with Image.open(OUTPUT / f'{view}-dark-1440x900.png') as shot:
                        comparison.paste(shot.crop((223, 0, 923, 88)), (0, index * 88))
                comparison.save(OUTPUT / 'shared-back-headers.png')
                report['status'] = 'passed'
            finally:
                browser.close()
    finally:
        (OUTPUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
