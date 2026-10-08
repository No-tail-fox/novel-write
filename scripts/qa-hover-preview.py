from pathlib import Path
import functools, http.server, json, threading, subprocess
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.artifacts/vox-hover-preview-qa'
subprocess.run(['I:/nodejs/node.exe', 'node_modules/tsx/dist/cli.mjs', 'scripts/qa-hover-preview.ts'], cwd=ROOT, check=True)
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_): pass
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(OUT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}'
report = {'checks': [], 'errors': []}
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
        page = browser.new_page(viewport={'width': 1536, 'height': 1024})
        page.on('pageerror', lambda error: report['errors'].append(str(error)))
        for theme in ['dark', 'light']:
            for width, height in [(1536, 1024), (1040, 720)]:
                page.set_viewport_size({'width': width, 'height': height}); page.goto(base + '/?theme=' + theme)
                page.get_by_role('button', name='打开详细预览', exact=True).hover()
                tooltip = page.get_by_role('tooltip'); expect(tooltip).to_be_visible()
                expect(tooltip.locator('[data-motion-ready="true"]')).to_have_count(1)
                page.wait_for_timeout(750)
                assert tooltip.get_attribute('data-preview-side') == 'left'
                bounds = tooltip.bounding_box(); assert 0 <= bounds['x'] and bounds['x'] + bounds['width'] <= width
                page.screenshot(path=str(OUT / f'hover-{theme}-{width}.png'))
                page.mouse.move(width / 2, 50); expect(tooltip).to_have_count(0); assert page.locator('iframe').count() == 0
                page.get_by_role('button', name='边缘动作', exact=True).hover(); expect(tooltip).to_be_visible()
                assert tooltip.get_attribute('data-preview-side') == 'right'
                page.get_by_role('button', name='边缘动作', exact=True).click()
                expect(page.get_by_role('dialog', name='详细预览测试')).to_be_visible(); expect(tooltip).to_have_count(0)
                page.get_by_role('button', name='关闭详情').click(); page.mouse.move(width / 2, 50)
                combo = page.get_by_role('combobox', name='叙事动作', exact=True); combo.click()
                options = page.get_by_role('option')
                first_label = options.nth(0).inner_text(); second_label = options.nth(1).inner_text()
                old_value = page.evaluate('hoverQA.value()')
                options.nth(1).hover(); expect(tooltip).to_be_visible(); expect(tooltip).to_contain_text(second_label)
                expect(tooltip.locator('[data-motion-ready="true"]')).to_have_count(1)
                assert second_label in tooltip.inner_text(); assert page.evaluate('hoverQA.value()') == old_value
                assert page.locator('.sd-hover-preview').count() == 1
                page.keyboard.press('Escape'); expect(tooltip).to_have_count(0)
                assert options.count() > 0
                page.keyboard.press('Escape'); expect(page.get_by_role('listbox')).not_to_be_visible()
                combo.focus(); combo.press('ArrowDown'); combo.press('Home'); combo.press('ArrowDown')
                expect(tooltip).to_be_visible(); expect(tooltip).to_contain_text(second_label)
                assert page.evaluate('hoverQA.value()') == old_value
                combo.press('Enter'); expect(page.get_by_role('listbox')).not_to_be_visible(); expect(tooltip).to_have_count(0)
                assert combo.inner_text() == second_label
                report['checks'].append(f'{theme} {width}: left preview, edge flip, unload, single mount, hover isolation, keyboard, detailed dialog')
        page.emulate_media(reduced_motion='reduce'); page.goto(base)
        page.get_by_role('button', name='打开详细预览', exact=True).hover()
        tooltip = page.get_by_role('tooltip'); expect(tooltip.locator('[data-motion-ready="true"]')).to_have_count(1)
        frame = page.frame_locator('.sd-hover-preview iframe')
        state = frame.locator('body').inner_html(); page.wait_for_timeout(500)
        assert frame.locator('body').inner_html() == state
        report['checks'].append('reduced-motion: static representative frame')
        assert not report['errors'], report['errors']
        browser.close()
finally:
    server.shutdown(); (OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
