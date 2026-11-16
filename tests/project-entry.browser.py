"""Offline real React ProjectHomePage entry regression; no providers or desktop data."""
import functools
import http.server
import json
import os
from pathlib import Path
import subprocess
import threading
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path(os.environ['PROJECT_ENTRY_OUTPUT'])
OUTPUT.mkdir(parents=True, exist_ok=True)
subprocess.run(['I:/nodejs/node.exe', '--input-type=module', '-e', "import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:process.argv[1],emptyOutDir:false,lib:{entry:'tests/project-entry.harness.tsx',name:'entryQA',formats:['iife'],fileName:()=> 'harness.js'}}});", str(OUTPUT)], cwd=ROOT, check=True)
(OUTPUT / 'index.html').write_text('<html><meta charset="utf-8"><body><div id="root"></div><script src="harness.js"></script></body></html>', encoding='utf-8')
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUTPUT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
report = {'checks': [], 'runtimeErrors': []}
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
        page = browser.new_page()
        page.on('pageerror', lambda e: report['runtimeErrors'].append(str(e)))
        page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(f'http://127.0.0.1:{server.server_port}/') else route.abort())
        page.goto(f'http://127.0.0.1:{server.server_port}/')
        page.wait_for_function('window.entryQA?.requests.length === 1')
        assert page.evaluate('entryQA.requests') == [{'filter': 'archived', 'query': 'kept', 'taskType': 'motion-comic', 'favorite': True, 'limit': 50, 'cursor': None}], page.evaluate('entryQA.requests')
        expect(page.get_by_label('制作类型', exact=True)).to_have_value('motion-comic')
        report['checks'].append('initial mount requests motion-comic exactly once, preserving archive/query/favorite/layout')
        page.evaluate("entryQA.request('all')")
        page.wait_for_function('entryQA.requests.length === 2')
        page.evaluate("entryQA.request('motion-comic')")
        page.wait_for_function('entryQA.requests.length === 3')
        page.evaluate('entryQA.resolve(2, 3)')
        expect(page.locator('.project-home-summary')).to_contain_text('3 个项目')
        page.evaluate('entryQA.resolve(0, 101); entryQA.resolve(1, 202)')
        expect(page.locator('.project-home-summary')).to_contain_text('3 个项目')
        report['checks'].append('mounted view updates and out-of-order responses cannot overwrite current page')
        page.evaluate("entryQA.request('motion-comic')")
        expect(page.get_by_label('制作类型', exact=True)).to_have_value('motion-comic')
        page.wait_for_function('entryQA.session.filterRevision === 4')
        assert page.evaluate('entryQA.requests.length') == 3
        report['checks'].append('repeated sidebar intent consumes revision without duplicate unchanged request')
        page.get_by_label('制作类型', exact=True).select_option('story')
        page.wait_for_function('entryQA.requests.length === 4')
        page.wait_for_function("entryQA.session.view.taskType === 'story'")
        page.evaluate('entryQA.mount(false)')
        expect(page.locator('[data-project-home]')).to_have_count(0)
        page.evaluate('entryQA.mount(true)')
        page.wait_for_function('entryQA.requests.length === 5')
        expect(page.get_by_label('制作类型', exact=True)).to_have_value('story')
        assert page.evaluate('entryQA.requests[4].taskType') == 'story'
        report['checks'].append('ordinary remount retains manual filter instead of replaying consumed sidebar request')
        page.evaluate("entryQA.request('motion-comic')")
        page.wait_for_function('entryQA.requests.length === 6')
        expect(page.get_by_label('制作类型', exact=True)).to_have_value('motion-comic')
        assert page.evaluate('entryQA.session.view.layout') == 'list'
        assert page.evaluate('entryQA.session.view.query') == 'kept'
        report['checks'].append('sidebar works again while projects already mounted and retains list/search state')
        assert not report['runtimeErrors'], report
        report['requests'] = page.evaluate('entryQA.requests')
        browser.close()
finally:
    server.shutdown()
    (OUTPUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
