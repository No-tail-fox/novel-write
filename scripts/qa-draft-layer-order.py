"""Verify text stays editable above full-canvas image transform surfaces."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
LAYERS = ['title', 'subtitle', 'caption', 'disclaimer']


def hit_layer(locator):
    return locator.evaluate('''node => {
      const r = node.getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('[data-layer]')?.dataset.layer;
    }''')


def drag(page, locator, dx, dy):
    box = locator.bounding_box()
    x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + dx, y + dy, steps=8)
    page.mouse.up()


def select_image(page, target):
    panel = page.locator('[data-draft-layer-panel="image"]')
    toggle = panel.locator('.accordion > button').first
    if toggle.get_attribute('aria-expanded') != 'true':
        toggle.click()
    panel.get_by_role('button', name='展示框' if target == 'image-frame' else '实际图片', exact=True).click()
    expect(page.locator(f'[data-layer="{target}"]')).to_have_attribute('data-selected', 'true')
    page.wait_for_timeout(350)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--before', action='store_true')
    args = parser.parse_args()
    directory = ROOT / '.artifacts/draft-layer-order' / ('before' if args.before else 'after')
    directory.mkdir(parents=True, exist_ok=True)
    report = {'status': 'running', 'checks': [], 'runtimeErrors': []}
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel='chrome', headless=True)
            try:
                page = browser.new_page(viewport={'width': 1440, 'height': 1000})
                page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
                page.goto('http://127.0.0.1:5173/')
                page.wait_for_selector('.new-task-type-picker')
                page.locator('[data-nav-view="prompt-templates"]').first.click()
                page.locator('[data-nav-view="draft-templates"]').click()
                page.locator('.draft-template-thumb').first.click()
                canvas = page.locator('.editable-draft-canvas')
                expect(canvas).to_be_visible()
                if args.before:
                    select_image(page, 'image-frame')
                    hits = {layer: hit_layer(canvas.locator(f'[data-layer="{layer}"]')) for layer in LAYERS}
                    report['checks'].append(hits)
                    page.screenshot(path=directory / 'image-covers-text.png')
                    print(json.dumps(hits), flush=True)
                    report['status'] = 'captured'
                    return

                # Separate the built-in caption/subtitle overlap through a real drag.
                caption = canvas.locator('[data-layer="caption"]')
                bounds = canvas.bounding_box()
                caption_bounds = caption.bounding_box()
                drag(page, caption, 0, bounds['y'] + bounds['height'] * .8 - caption_bounds['y'] - caption_bounds['height'] / 2)

                for theme in ['dark', 'light']:
                    if page.locator('html').get_attribute('data-theme') != theme:
                        page.locator('.theme-toggle').click()
                    for width, height in [(1440, 1000), (1040, 720)]:
                        page.set_viewport_size({'width': width, 'height': height})
                        for target in ['image-frame', 'image-media']:
                            for layer in LAYERS:
                                select_image(page, target)
                                text = canvas.locator(f'[data-layer="{layer}"]')
                                assert hit_layer(text) == layer, (target, layer, hit_layer(text))
                                before = text.bounding_box()
                                image_style = canvas.locator(f'[data-layer="{target}"]').get_attribute('style')
                                drag(page, text, 6, 5)
                                expect(text).to_have_class('draft-layer text-layer selected')
                                after = text.bounding_box()
                                assert abs(after['x'] - before['x'] - 6) < 1, (layer, before, after)
                                assert abs(after['y'] - before['y'] - 5) < 1, (layer, before, after)
                                assert canvas.locator(f'[data-layer="{target}"]').get_attribute('style') == image_style
                                panel = page.locator(f'[data-draft-layer-panel="{layer}"]')
                                expect(panel.locator('.accordion > button')).to_have_attribute('aria-expanded', 'true')
                                before_width = text.bounding_box()['width']
                                drag(page, text.locator('.draft-layer-handle'), -4, 0)
                                assert text.bounding_box()['width'] < before_width - 3, layer
                                drag(page, text.locator('.draft-layer-handle'), 4, 0)
                                drag(page, text, -6, -5)
                                report['checks'].append(f'{theme}-{width}-{target}-{layer}: select, drag, resize and panel passed')
                            page.screenshot(path=directory / f'{theme}-{width}-{target}-text-selected.png')
                            select_image(page, target)
                            box = canvas.locator(f'[data-layer="{target}"]')
                            before = box.bounding_box()
                            drag(page, box.locator('[data-resize-handle="se"]'), -10, -10)
                            assert box.bounding_box()['width'] < before['width'], target
                            # An empty image area remains a move target after shrinking.
                            before_style = box.get_attribute('style')
                            bounds = box.bounding_box()
                            page.mouse.move(bounds['x'] + bounds['width'] / 2, bounds['y'] + bounds['height'] * .25)
                            page.mouse.down()
                            page.mouse.move(bounds['x'] + bounds['width'] / 2 + 5, bounds['y'] + bounds['height'] * .25 + 5, steps=5)
                            page.mouse.up()
                            assert box.get_attribute('style') != before_style, target
                            page.screenshot(path=directory / f'{theme}-{width}-{target}-image-selected.png')
                            report['checks'].append(f'{theme}-{width}-{target}: image resize and move passed')
                            panel = page.locator('[data-draft-layer-panel="image"]')
                            if target == 'image-frame':
                                for label, value in [('水平位置', '0'), ('垂直位置', '0'), ('展示框宽度', '1'), ('展示框高度', '1')]:
                                    panel.get_by_role('spinbutton', name=label + '数值', exact=True).fill(value)
                            else:
                                for label, value in [('图片缩放', '1'), ('水平取景', '0.5'), ('垂直取景', '0.5')]:
                                    panel.get_by_role('spinbutton', name=label + '数值', exact=True).fill(value)
                assert not report['runtimeErrors'], report['runtimeErrors']
                report['status'] = 'passed'
                print(f"Passed {len(report['checks'])} checks", flush=True)
            finally:
                browser.close()
    except Exception as error:
        report.update(status='failed', error=str(error))
        raise
    finally:
        (directory / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
