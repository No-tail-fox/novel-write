"""Visual and interaction QA for model-specific video generation controls."""
from pathlib import Path
import functools
import http.server
import json
import subprocess
import threading

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.artifacts/video-lab-models'
OUT.mkdir(parents=True, exist_ok=True)
subprocess.run([
    'I:/nodejs/node.exe', '--input-type=module', '-e',
    "import {build} from 'vite';await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:process.argv[1],emptyOutDir:true,target:'chrome120',lib:{entry:'tests/video-lab-models.harness.tsx',formats:['es'],fileName:()=> 'harness.js',cssFileName:'harness'}}});",
    str(OUT),
], cwd=ROOT, check=True, capture_output=True)
(OUT / 'index.html').write_text('<!doctype html><html data-theme-ready="true"><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><div id="root"></div><script type="module" src="harness.js"></script></html>', encoding='utf-8')

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass
    def guess_type(self, path):
        mime = super().guess_type(path)
        return f'{mime}; charset=utf-8' if mime.startswith('text/') or mime in ('application/javascript', 'application/json') else mime

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(OUT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}'
report = {'checks': [], 'runtimeErrors': [], 'externalRequests': []}

try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
        page = browser.new_page()
        page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
        page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(base) or route.request.url.startswith('data:') else (report['externalRequests'].append(route.request.url), route.abort()))
        for width, height in [(1440, 960), (980, 720)]:
            page.set_viewport_size({'width': width, 'height': height})
            page.goto(f'{base}/?theme=dark')
            page.wait_for_function('window.videoModelsQA')
            model = page.get_by_label('视频模型', exact=True)
            expect(model).to_have_value('h3')
            expect(page.get_by_label('分辨率', exact=True).locator('option')).to_have_text(['768P', '2K'])
            duration = page.get_by_label('时长（秒）', exact=True)
            expect(duration).to_have_attribute('min', '4')
            expect(duration).to_have_attribute('max', '15')
            page.get_by_role('tab', name='多模态参考', exact=True).click()
            page.get_by_role('button', name='人物素材库', exact=True).click()
            expect(page.get_by_role('dialog')).to_be_visible()
            page.get_by_role('button', name='阿宁：正面.png', exact=True).click()
            page.screenshot(path=str(OUT / f'person-picker-{width}.png'))
            page.get_by_role('button', name='添加已选图片（1）', exact=True).click()
            reference_preview = page.get_by_role('img', name='参考图片 1', exact=True)
            expect(reference_preview).to_be_visible()
            page.wait_for_function('(image) => image.complete && image.naturalWidth > 0', arg=reference_preview.element_handle())
            page.get_by_label('图片 1 用途', exact=True).select_option('opening')
            page.get_by_label('图片 1 参考内容', exact=True).fill('开场保持人物站在窗边的构图')
            page.get_by_role('button', name='插入 参考图片 1', exact=True).click()
            expect(page.get_by_label('视频描述', exact=True)).to_contain_text('参考图片 1 用于开场画面')
            model.select_option('seedance-2.5')
            expect(page.get_by_label('使用服务', exact=True)).to_have_value('qa-seedance-25')
            expect(page.get_by_label('时长（秒）', exact=True)).to_have_attribute('max', '30')
            expect(page.get_by_label('分辨率', exact=True).locator('option')).to_have_text(['480P', '720P', '1080P'])
            expect(page.get_by_text('最多 30 图 / 10 视频 / 10 音频', exact=False)).to_be_visible()
            page.get_by_label('地址素材类型', exact=True).select_option('video')
            page.get_by_label('素材地址或 ID', exact=True).fill('asset://seedance/reference-motion')
            page.get_by_role('button', name='添加地址素材', exact=True).click()
            expect(page.get_by_text('reference-motion', exact=True)).to_be_visible()
            expect(page.locator('.video-lab-media-references small[title="asset://seedance/reference-motion"]')).to_have_count(1)
            page.locator('.video-lab-editor').evaluate('(node) => { node.scrollTop = node.scrollHeight; }')
            page.screenshot(path=str(OUT / f'multimodal-seedance-{width}.png'))
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            report['checks'].append(f'{width}: H3 limits, person library, opening reference, Seedance 2.5 limits and asset video')
        browser.close()
    assert not report['runtimeErrors'], report['runtimeErrors']
    assert not report['externalRequests'], report['externalRequests']
    report['passed'] = True
finally:
    (OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    server.shutdown()

print(json.dumps(report, ensure_ascii=False))
