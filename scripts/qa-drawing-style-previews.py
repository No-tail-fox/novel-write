"""Real ordinary-video and shared drawing-style entry points; isolated read-only fixtures."""
from pathlib import Path
import functools, http.server, json, subprocess, threading
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.artifacts/drawing-style-previews'
OUT.mkdir(parents=True, exist_ok=True)
subprocess.run(['I:/nodejs/node.exe', '--input-type=module', '-e',
    "import {build} from 'vite';await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:process.argv[1],emptyOutDir:false,target:'chrome120',lib:{entry:'tests/drawing-style-previews.harness.tsx',formats:['es'],fileName:()=> 'harness.js',cssFileName:'harness'}}});", str(OUT)], cwd=ROOT, check=True, capture_output=True)
(OUT / 'index.html').write_text('<!doctype html><html data-theme-ready="true"><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="harness.css"><div id="root"></div><script type="module" src="harness.js"></script></html>', encoding='utf-8')
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(OUT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}'
report = {'checks': [], 'runtimeErrors': [], 'externalRequests': []}
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
        page = browser.new_page()
        page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
        def route_request(route):
            if route.request.url.startswith(base) or route.request.url.startswith('data:'): route.continue_()
            else:
                report['externalRequests'].append(route.request.url)
                route.abort()
        page.route('**/*', route_request)
        def load(name, theme):
            page.goto(f'{base}/?page={name}&theme={theme}')
            page.wait_for_function('window.drawingPreviewQA')
        def image_ready(image):
            expect(image).to_be_visible()
            image.evaluate('(e)=>e.decode()')
            assert image.evaluate('(e)=>e.naturalWidth>=512&&e.naturalHeight>0')
        def tooltip_image(label):
            tip = page.get_by_role('tooltip')
            expect(tip).to_be_visible()
            expect(tip).to_contain_text(label)
            image_ready(tip.locator('img'))
            assert tip.evaluate('(e)=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}')
            return tip
        for theme in ['dark', 'light']:
            for width, height in [(1536, 1024), (1040, 720)]:
                page.set_viewport_size({'width': width, 'height': height})
                load('new-task', theme)
                page.locator('[data-task-creation-type="smart-video"]').click()
                field = page.get_by_role('combobox', name='画面风格', exact=True)
                field.scroll_into_view_if_needed()
                image_ready(page.locator('.image-style-selected-preview img'))
                original = page.evaluate('drawingPreviewQA.draft().values.style')
                original_name = field.inner_text()
                field.hover()
                tooltip_image(original_name)
                page.keyboard.press('Escape')
                expect(page.get_by_role('tooltip')).to_have_count(0)
                field.click()
                styles = page.evaluate('drawingPreviewQA.styles')
                assert len(styles) == 15 and all(style.get('src') for style in styles)
                expect(page.get_by_role('listbox').get_by_role('option')).to_have_count(15)
                for style in styles:
                    option = page.get_by_role('option', name=style['name'], exact=True)
                    option.hover()
                    tooltip_image(style['name'])
                    assert page.evaluate('drawingPreviewQA.draft().values.style') == original
                page.screenshot(path=str(OUT / f'ordinary-hover-{theme}-{width}.png'))
                page.keyboard.press('Escape')
                expect(page.get_by_role('tooltip')).to_have_count(0)
                expect(page.get_by_role('listbox')).to_be_visible()
                page.keyboard.press('Escape')
                expect(page.get_by_role('listbox')).to_have_count(0)
                field.focus()
                page.keyboard.press('ArrowDown')
                page.keyboard.press('Home')
                tooltip_image(styles[0]['name'])
                assert page.evaluate('drawingPreviewQA.draft().values.style') == original
                page.keyboard.press('Enter')
                expect(field).to_have_text(styles[0]['name'])
                page.wait_for_function('drawingPreviewQA.draft().values.style === "cinematic"')
                image_ready(page.locator('.image-style-selected-preview img'))
                page.mouse.move(0, 0)
                page.get_by_role('button', name=f'查看{styles[0]["name"]}示例图', exact=True).click()
                detail = page.get_by_role('dialog', name=f'{styles[0]["name"]} · 风格示例', exact=True)
                image_ready(detail.locator('img'))
                page.screenshot(path=str(OUT / f'ordinary-detail-{theme}-{width}.png'))
                detail.get_by_role('button', name='关闭', exact=True).click()
                assert page.evaluate('drawingPreviewQA.calls') == []
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                report['checks'].append(f'ordinary {theme} {width}: 14 built-in + saved custom template, cached samples, hover, selection, keyboard, detail, no model calls')

                load('templates', theme)
                page.get_by_role('button', name='查看', exact=True).first.click()
                default_style = page.get_by_role('combobox', name='默认画风', exact=True)
                default_style.click()
                page.get_by_role('option', name='我的电影画风', exact=True).hover()
                tooltip_image('我的电影画风')
                page.get_by_role('option', name='我的电影画风', exact=True).click()
                expect(default_style).to_contain_text('我的电影画风')
                load('templates', theme)
                page.get_by_role('button', name='图像模板', exact=True).click()
                gallery = page.locator('.image-template-gallery')
                expect(gallery.locator('.prompt-template-row')).to_have_count(15)
                for image in gallery.locator('img').all():
                    image.scroll_into_view_if_needed(); image_ready(image)
                first = gallery.locator('.prompt-template-row').first
                first.hover(); tooltip_image(styles[0]['name'])
                page.screenshot(path=str(OUT / f'templates-{theme}-{width}.png'))
                first.get_by_role('button', name='查看', exact=True).click()
                image_ready(page.locator('.prompt-template-detail-stack > .sd-hover-preview-anchor img'))
                base_field = page.get_by_role('combobox', name='基于系统风格', exact=True)
                base_field.click()
                page.get_by_role('option', name=styles[-1]['name'], exact=True).hover()
                tooltip_image(styles[-1]['name'])
                page.keyboard.press('Escape'); page.keyboard.press('Escape')
                assert page.evaluate('drawingPreviewQA.calls') == []
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                report['checks'].append(f'templates {theme} {width}: built-in + saved custom gallery thumbnails, hover, editor sample, base-style preview')

                load('image-lab', theme)
                grid = page.locator('.image-lab-style-grid')
                expect(grid.locator('button')).to_have_count(15)
                for image in grid.locator('img').all():
                    image.scroll_into_view_if_needed(); image_ready(image)
                item = grid.locator('button').first
                before = grid.locator('[aria-pressed="true"]').count()
                item.hover(); tooltip_image(item.locator('strong').inner_text())
                assert grid.locator('[aria-pressed="true"]').count() == before
                page.screenshot(path=str(OUT / f'image-lab-{theme}-{width}.png'))
                assert page.evaluate('drawingPreviewQA.calls') == []
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                custom_item = grid.locator('button').filter(has_text='我的电影画风')
                custom_item.click()
                assert custom_item.get_attribute('aria-pressed') == 'true'
                report['checks'].append(f'image-lab {theme} {width}: built-in + saved custom thumbnails, custom selection, hover isolation')

                load('html-video', theme)
                field = page.get_by_role('combobox', name='画面风格', exact=True)
                field.scroll_into_view_if_needed()
                image_ready(page.locator('.image-style-selected-preview img'))
                field.click()
                page.get_by_role('option', name=styles[-1]['name'], exact=True).hover()
                tooltip_image(styles[-1]['name'])
                page.screenshot(path=str(OUT / f'html-video-{theme}-{width}.png'))
                page.keyboard.press('Escape'); page.keyboard.press('Escape')
                assert page.evaluate('drawingPreviewQA.calls') == []
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                report['checks'].append(f'html-video {theme} {width}: selected cached image, option hover')

                load('html-workspace', theme)
                page.locator('.hv-reference-task-settings > summary').click()
                field = page.get_by_role('combobox', name='画面风格', exact=True)
                field.scroll_into_view_if_needed()
                image_ready(page.locator('.image-style-selected-preview img'))
                field.click()
                page.get_by_role('option', name=styles[-1]['name'], exact=True).hover()
                tooltip_image(styles[-1]['name'])
                page.screenshot(path=str(OUT / f'html-workspace-{theme}-{width}.png'))
                page.keyboard.press('Escape'); page.keyboard.press('Escape')
                assert page.evaluate('drawingPreviewQA.calls') == []
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                report['checks'].append(f'html-workspace {theme} {width}: current task parameters cached image and option hover')

                for page_name, field_name in [('music-mv', '画面风格'), ('viral', '风格')]:
                    load(page_name, theme)
                    if page_name == 'viral': page.get_by_role('tab', name='快速概览', exact=True).click()
                    field = page.get_by_role('combobox', name=field_name, exact=True)
                    field.scroll_into_view_if_needed(); field.click()
                    page.get_by_role('option', name='我的电影画风', exact=True).click()
                    expect(field).to_contain_text('我的电影画风')
                    image_ready(page.locator('.image-style-selected-preview img'))
                    assert page.evaluate('drawingPreviewQA.calls') == []
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                    report['checks'].append(f'{page_name} {theme} {width}: saved custom template is selectable with cached preview')
        browser.close()
    assert not report['runtimeErrors'], report['runtimeErrors']
    assert not report['externalRequests'], report['externalRequests']
    report['passed'] = True
finally:
    (OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    server.shutdown()
print(json.dumps(report, ensure_ascii=False))
