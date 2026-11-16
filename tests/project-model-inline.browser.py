"""Offline model dropdown interaction check; no provider requests."""
import functools, http.server, threading, subprocess, json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/project-model-inline'
OUT.mkdir(parents=True, exist_ok=True)
subprocess.run(['I:/nodejs/node.exe', '--input-type=module', '-e', "import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:process.argv[1],emptyOutDir:false,lib:{entry:'tests/project-model-inline.harness.tsx',name:'modelQA',formats:['iife'],fileName:()=> 'harness.js',cssFileName:'harness'}}});", str(OUT)], cwd=ROOT, check=True)
(OUT/'index.html').write_text('<!doctype html><html data-theme="dark" data-theme-ready="true"><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><div id="root"></div><script src="harness.js"></script></html>', encoding='utf-8')
server = http.server.ThreadingHTTPServer(('127.0.0.1',0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe',headless=True)
        page = browser.new_page(viewport={'width':1100,'height':300})
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(f'http://127.0.0.1:{server.server_port}')
        page.wait_for_timeout(300)
        assert not errors, errors
        for label,value in [('LLM模型','llm-1'),('生图模型','image-1'),('视频模型','video-1')]:
            field=page.get_by_role('combobox',name=label,exact=True)
            expect(field).to_be_enabled()
            field.select_option(value)
            expect(field).to_have_value(value)
        assert page.evaluate('window.modelQA.changes.length')==3
        assert page.evaluate('window.modelQA.changes[2]')=={'llmProfileId':'llm-1','imageProfileId':'image-1','videoProviderId':'video-1'}
        assert not errors,errors
        page.screenshot(path=str(OUT/'selected-models.png'))
        print(json.dumps({'changes':3,'errors':errors}))
        browser.close()
finally:
    server.shutdown();server.server_close()
