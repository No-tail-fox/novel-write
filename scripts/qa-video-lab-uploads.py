"""Browser QA for first/last-frame and multimodal reference uploads."""
from pathlib import Path
import functools
import http.server
import json
import subprocess
import threading

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.artifacts/video-lab-uploads'
OUT.mkdir(parents=True, exist_ok=True)
subprocess.run([
    'I:/nodejs/node.exe', '--input-type=module', '-e',
    "import {build} from 'vite';await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:process.argv[1],emptyOutDir:false,target:'chrome120',lib:{entry:'tests/video-lab-uploads.harness.tsx',formats:['es'],fileName:()=> 'harness.js',cssFileName:'harness'}}});",
    str(OUT),
], cwd=ROOT, check=True, capture_output=True)
(OUT / 'index.html').write_text(
    '<!doctype html><html data-theme-ready="true"><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="harness.css"><div id="root"></div><script type="module" src="harness.js"></script></html>',
    encoding='utf-8',
)


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def guess_type(self, path):
        mime = super().guess_type(path)
        if mime.startswith('text/') or mime in ('application/javascript', 'application/json'):
            return f'{mime}; charset=utf-8'
        return mime


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
            if route.request.url.startswith(base) or route.request.url.startswith('data:'):
                route.continue_()
            else:
                report['externalRequests'].append(route.request.url)
                route.abort()

        page.route('**/*', route_request)
        for theme in ['dark', 'light']:
            for width, height in [(1440, 960), (980, 720)]:
                page.set_viewport_size({'width': width, 'height': height})
                page.goto(f'{base}/?theme={theme}')
                page.wait_for_function('window.videoUploadQA')

                frames_mode = page.get_by_role('tab', name='首尾帧', exact=True)
                expect(frames_mode).to_be_enabled()
                frames_mode.click()
                expect(page.get_by_role('button', name='选择首帧', exact=True)).to_be_enabled()
                expect(page.get_by_role('button', name='选择尾帧', exact=True)).to_be_enabled()
                expect(page.get_by_text('当前服务尚未声明首尾帧支持', exact=False)).to_be_visible()
                page.get_by_role('button', name='选择首帧', exact=True).click()
                expect(page.get_by_role('button', name='更换首帧', exact=True)).to_be_visible()
                page.get_by_role('button', name='选择尾帧', exact=True).click()
                expect(page.get_by_role('button', name='更换尾帧', exact=True)).to_be_visible()
                expect(page.locator('.video-lab-frame img')).to_have_count(2)
                page.screenshot(path=str(OUT / f'frames-{theme}-{width}.png'), full_page=True)

                references_mode = page.get_by_role('tab', name='多模态参考', exact=True)
                expect(references_mode).to_be_enabled()
                references_mode.click()
                for label in ['添加图片', '添加视频', '添加音频']:
                    expect(page.get_by_role('button', name=label, exact=True)).to_be_enabled()
                expect(page.get_by_text('当前服务尚未声明多模态参考支持', exact=False)).to_be_visible()
                page.get_by_role('button', name='添加图片', exact=True).click()
                page.get_by_role('button', name='添加图片', exact=True).click()
                expect(page.locator('.video-lab-reference-row')).to_have_count(2)
                page.get_by_role('button', name='添加视频', exact=True).click()
                page.get_by_role('button', name='添加音频', exact=True).click()
                expect(page.get_by_text('reference-motion.mp4', exact=True)).to_be_visible()
                expect(page.get_by_text('reference-rhythm.mp3', exact=True)).to_be_visible()
                page.screenshot(path=str(OUT / f'references-{theme}-{width}.png'), full_page=True)

                calls = page.evaluate('videoUploadQA.calls')
                assert calls == ['selectLocalImage:video-reference'] * 4 + ['selectLocalVideo', 'selectLocalAudio:video-reference'], calls
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                report['checks'].append(
                    f'{theme} {width}: first frame, last frame, two reference images, reference video and reference audio selected with legacy capability config'
                )

        browser.close()
    assert not report['runtimeErrors'], report['runtimeErrors']
    assert not report['externalRequests'], report['externalRequests']
    report['passed'] = True
finally:
    (OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    server.shutdown()

print(json.dumps(report, ensure_ascii=False))
