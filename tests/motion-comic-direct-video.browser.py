"""Real canonical video readiness UI; isolated loopback server, no model calls."""
import functools
import http.server
import json
import os
from pathlib import Path
import subprocess
import threading
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/qa-direct-video-output'
OUT.mkdir(exist_ok=True)
NODE = os.environ.get('STORYDREAM_QA_NODE', r'C:\Users\foxnotail\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe')
subprocess.run([NODE, '--input-type=module', '-e', "import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:process.argv[1],emptyOutDir:false,lib:{entry:'tests/motion-comic-direct-video.harness.tsx',name:'directVideoQA',formats:['iife'],fileName:()=> 'harness.js',cssFileName:'harness'}}});", str(OUT)], cwd=ROOT, check=True)
(OUT / 'index.html').write_text('<!doctype html><html data-theme="dark" data-theme-ready="true"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="harness.css"><body><div id="root"></div><script src="harness.js"></script></body></html>', encoding='utf-8')
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
report = {'states': [], 'errors': [], 'externalRequests': []}

def capture(page, state, width, height):
    metrics = page.evaluate('''() => ({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,panes:[...document.querySelectorAll('.comic-make__list,.comic-make__info,.comic-make__preview')].map(e=>{const r=e.getBoundingClientRect();return {className:e.className,x:r.x,right:r.right,bottom:r.bottom,clientWidth:e.clientWidth,scrollWidth:e.scrollWidth}}),button:(()=>{const r=document.querySelector('.comic-make__generate').getBoundingClientRect();return {x:r.x,right:r.right,bottom:r.bottom}})()})''')
    assert metrics['scrollWidth'] <= width, metrics
    assert metrics['scrollHeight'] <= height, metrics
    for pane in metrics['panes']:
        assert pane['x'] >= 0 and pane['right'] <= width and pane['bottom'] <= height, metrics
        assert pane['scrollWidth'] <= pane['clientWidth'] + 1, metrics
    assert metrics['button']['bottom'] <= height, metrics
    screenshot = OUT / f'{state}-{width}x{height}.png'
    page.screenshot(path=str(screenshot))
    report['states'].append({'state':state,'size':[width,height],'metrics':metrics,'screenshot':str(screenshot),'canonical':page.evaluate('({mode:directVideoQA.canonicalMode,ready:directVideoQA.ready,reason:directVideoQA.reason})')})

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='msedge', headless=True)
        for width, height in [(1536,1024),(1040,720)]:
            page = browser.new_page(viewport={'width':width,'height':height})
            page.on('pageerror', lambda error: report['errors'].append(str(error)))
            page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(f'http://127.0.0.1:{server.server_port}/') else (report['externalRequests'].append(route.request.url), route.abort())[-1])
            page.goto(f'http://127.0.0.1:{server.server_port}/')
            video = page.get_by_role('button', name='生成视频', exact=True)
            optional = page.locator('.comic-make__frames')
            expect(video).to_be_enabled()
            assert page.evaluate('directVideoQA.canonicalMode') == 'references'
            assert optional.get_attribute('open') is None
            capture(page,'references-default',width,height)
            video.click()
            page.wait_for_function('directVideoQA.requests.length === 1')
            request = page.evaluate('directVideoQA.requests[0]')
            assert request['referenceImages'] and 'firstFramePath' not in request, request
            optional.locator('summary').focus()
            optional.locator('summary').press('Enter')
            expect(page.get_by_role('button',name='生成分镜图（可选）',exact=True)).to_be_visible()
            assert optional.get_attribute('open') is not None
            page.locator('.motion-comic-video-readiness__settings > summary').click()
            page.get_by_label('参考输入方式',exact=True).select_option('frames')
            expect(video).to_be_disabled()
            assert page.evaluate('directVideoQA.canonicalMode') == 'frames'
            assert 'FIRST_FRAME_REQUIRED' in page.evaluate('directVideoQA.reason')
            assert page.locator('.comic-make__frames').get_attribute('open') is not None
            expect(page.get_by_role('button',name='生成首帧分镜图',exact=True)).to_be_visible()
            capture(page,'frames-required',width,height)
            page.get_by_label('参考输入方式',exact=True).select_option('references')
            expect(video).to_be_enabled()
            assert page.evaluate('directVideoQA.canonicalMode') == 'references'
            assert page.locator('.comic-make__frames').get_attribute('open') is None
            page.locator('.comic-make__frames summary').focus()
            page.locator('.comic-make__frames summary').press('Space')
            image = page.get_by_role('button',name='生成分镜图（可选）',exact=True)
            image.click()
            expect(page.get_by_role('alert')).to_have_text('生图服务暂时不可用，请重试。')
            page.get_by_role('alert').scroll_into_view_if_needed()
            expect(page.get_by_role('alert')).to_be_in_viewport()
            expect(video).to_be_enabled()
            capture(page,'image-error',width,height)
            page.evaluate("directVideoQA.imageMode = 'pending'")
            image.click()
            expect(page.get_by_role('button',name='正在生成分镜图…',exact=True)).to_be_disabled()
            expect(video).to_be_disabled()
            expect(page.get_by_label('参考输入方式',exact=True)).to_be_disabled()
            expect(page.get_by_label('镜头标题',exact=True)).to_be_disabled()
            expect(page.get_by_role('alert')).to_have_count(0)
            assert page.evaluate('directVideoQA.imageCalls') == 2
            capture(page,'image-busy',width,height)
            page.evaluate('directVideoQA.finish()')
            expect(video).to_be_enabled()
            expect(image).to_be_enabled()
            video.click()
            page.wait_for_function('directVideoQA.requests.length === 2')
            page.close()
        browser.close()
    assert not report['errors'], report['errors']
    assert not report['externalRequests'], report['externalRequests']
    report['passed'] = True
finally:
    server.shutdown()
    server.server_close()
    (OUT / 'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
