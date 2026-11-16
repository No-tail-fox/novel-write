import functools
import http.server
import json
from pathlib import Path
import subprocess
import threading
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts' / 'motion-comic-create-style'
OUTPUT.mkdir(parents=True, exist_ok=True)
subprocess.run(['I:/nodejs/node.exe', '--input-type=module', '-e', "import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:process.argv[1],emptyOutDir:false,target:'chrome120',lib:{entry:'tests/motion-comic-create-style.harness.tsx',formats:['es'],fileName:()=> 'harness.js',cssFileName:'harness'}}});", str(OUTPUT)], cwd=ROOT, check=True)
(OUTPUT / 'index.html').write_text('<!doctype html><html data-theme-ready="true"><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="harness.css"><body><div id="root"></div><script type="module" src="harness.js"></script></body></html>', encoding='utf-8')
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUTPUT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
report = {'status': 'running', 'captures': [], 'runtimeErrors': [], 'externalRequests': [], 'paidGenerationCalls': 0}
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
        for theme in ('dark', 'light'):
            page = browser.new_page(viewport={'width': 1040, 'height': 720})
            page.on('pageerror', lambda e: report['runtimeErrors'].append(str(e)))
            page.on('request', lambda r: report['externalRequests'].append(r.url) if r.url.startswith(('http://', 'https://')) and f'127.0.0.1:{server.server_port}' not in r.url else None)
            page.goto(f'http://127.0.0.1:{server.server_port}/?theme={theme}')
            select = page.get_by_role('combobox', name='视觉风格（可选）', exact=True)
            expect(select).to_have_value('')
            select.select_option(label='水彩治愈')
            expect(page.locator('.motion-comic-create__summary')).to_contain_text('水彩治愈')
            select.select_option('custom')
            custom = page.get_by_role('textbox', name='自定义视觉风格（可选）', exact=True)
            expect(custom).to_be_visible()
            custom.fill('铅笔线稿，保留纸张颗粒与柔和光影')
            expect(page.locator('.motion-comic-create__summary')).to_contain_text('铅笔线稿，保留纸张颗粒与柔和光影')
            assert not page.evaluate('document.documentElement.scrollWidth > innerWidth'), 'page overflow'
            for control in (select, custom):
                box = control.bounding_box()
                assert box and box['x'] >= 0 and box['x'] + box['width'] <= 1041, box
            name = f'create-custom-{theme}-1040.png'
            page.screenshot(path=str(OUTPUT / name), animations='disabled')
            report['captures'].append(name)
            page.get_by_role('button', name='下一步', exact=True).click()
            expect(page.locator('.creation-chapters__row')).to_have_count(149)
            expect(page.locator('.creation-chapters__editor')).to_have_count(0)
            expect(page.locator('input[type=checkbox]')).to_have_count(0)
            for width, height in ((1040, 720), (1024, 668)):
                page.set_viewport_size({'width': width, 'height': height})
                visible_rows = page.locator('.creation-chapters__row').evaluate_all('(rows) => rows.filter(r => {const b=r.getBoundingClientRect();const p=r.closest(".motion-comic-create__fields").getBoundingClientRect();return b.top >= p.top && b.bottom <= p.bottom;}).length')
                assert visible_rows >= 3, visible_rows
                footer = page.get_by_role('button', name='下一步', exact=True).bounding_box()
                assert footer and footer['y'] + footer['height'] <= height, footer
                assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
                name = f'chapters-{theme}-{width}x{height}.png'
                page.screenshot(path=str(OUTPUT / name), animations='disabled')
                report['captures'].append(name)
            page.get_by_role('button', name='预览编辑第 1 集', exact=True).click()
            title = page.get_by_role('textbox', name='第 1 集标题', exact=True)
            title.fill('修改后的第一章')
            source = page.get_by_role('textbox', name='第 1 集源文', exact=True)
            source.fill('保留这段草稿。')
            page.get_by_role('button', name='预览编辑第 2 集', exact=True).click()
            expect(page.locator('.creation-chapters__editor')).to_have_count(1)
            page.get_by_role('button', name='预览编辑第 1 集', exact=True).click()
            expect(title).to_have_value('修改后的第一章')
            expect(source).to_have_value('保留这段草稿。')
            title.fill('')
            expect(page.get_by_role('button', name='下一步', exact=True)).to_be_disabled()
            expect(page.locator('.creation-chapters__status').first).to_have_text('标题待补充')
            title.fill('修改后的第一章')
            source.fill(' ')
            expect(page.get_by_role('button', name='下一步', exact=True)).to_be_disabled()
            source.fill('保留这段草稿。')
            page.get_by_role('button', name='下一步', exact=True).click()
            expect(page.locator('.motion-comic-create__summary')).to_contain_text('铅笔线稿，保留纸张颗粒与柔和光影')
            page.get_by_role('button', name='上一步', exact=True).click()
            page.get_by_role('button', name='上一步', exact=True).click()
            expect(custom).to_have_value('铅笔线稿，保留纸张颗粒与柔和光影')
            select.select_option('')
            expect(custom).to_have_count(0)
            expect(page.locator('.motion-comic-create__summary')).to_contain_text('暂不指定')
            page.close()
        page = browser.new_page(viewport={'width': 1024, 'height': 668})
        page.goto(f'http://127.0.0.1:{server.server_port}/?ai=1')
        page.get_by_role('button', name='下一步', exact=True).click()
        page.get_by_role('button', name='预览编辑第 1 集', exact=True).click()
        expect(page.get_by_role('textbox', name='第 1 集源文（按边界重建）', exact=True)).to_have_attribute('readonly', '')
        expect(page.get_by_role('textbox', name='第 1 集标题', exact=True)).to_be_editable()
        expect(page.get_by_role('button', name='下一步', exact=True)).to_be_enabled()
        page.close()
        browser.close()
    assert not report['runtimeErrors'] and not report['externalRequests'], report
    report['status'] = 'passed'
finally:
    server.shutdown()
    (OUTPUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
