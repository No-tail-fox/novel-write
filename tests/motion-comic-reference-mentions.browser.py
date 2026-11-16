"""Real React + shared compiler offline acceptance; no provider or external generation."""
import functools
import http.server
import json
from pathlib import Path
import subprocess
import threading
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.artifacts' / 'reference-mentions-ui'
OUT.mkdir(parents=True, exist_ok=True)
subprocess.run(['node', '--input-type=module', '-e', "import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:'.artifacts/reference-mentions-ui',emptyOutDir:false,lib:{entry:'tests/motion-comic-reference-mentions.harness.tsx',name:'referenceQA',formats:['iife'],fileName:()=> 'harness.js',cssFileName:'harness'}}});"], cwd=ROOT, check=True)
(OUT / 'index.html').write_text('<!doctype html><html data-theme="dark" data-theme-ready="true"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="harness.css"><body><div id="root"></div><script src="harness.js"></script></body></html>', encoding='utf-8')
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
report = {'scope': 'Offline real Readiness/TextArea + motionComicVideoReferences + stable token helper + buildMotionComicShotVideoRequest; no Page/Workspace/IPC/provider', 'checks': [], 'errors': [], 'externalRequests': []}
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
        page = browser.new_page(viewport={'width': 1040, 'height': 1100})
        page.on('pageerror', lambda error: report['errors'].append(str(error)))
        def route_request(route):
            parsed = urlparse(route.request.url)
            if parsed.hostname == '127.0.0.1' and parsed.port == server.server_port:
                route.continue_()
            else:
                report['externalRequests'].append(route.request.url)
                route.abort()
        page.route('**/*', route_request)
        page.goto(f'http://127.0.0.1:{server.server_port}')
        rows = page.get_by_role('list', name='实际提交参考列表').locator('li')
        expect(rows).to_have_count(6)
        expect(rows.nth(0)).to_contain_text('参考图 1 · 版本 opening-v1')
        expect(rows.nth(1)).to_contain_text('参考图 2 · 版本 look-a-v1')
        expect(rows.nth(0).get_by_role('button')).to_have_count(0)
        expect(rows.nth(5).get_by_role('button')).to_have_count(0)
        expect(page.get_by_role('button', name='插入引用：参考图 2 · 同名人物 / 雨衣', exact=True)).to_have_count(1)
        expect(page.get_by_role('button', name='插入引用：参考图 3 · 同名人物 / 雨衣', exact=True)).to_have_count(1)
        tokens = page.evaluate('referenceFixture.references.map(r => r.token || null)')
        assert tokens == [None, '@{look:look-a}', '@{look:look-b}', '@{scene:scene-station}', '@{prop:prop-letter}', None], tokens
        report['checks'].append('actual ordered helper references reserve opening #1; character #2; opening/ending have no insert buttons; duplicate names retain distinct look IDs')
        prompt = page.get_by_role('textbox', name='运动提示词')
        rows.nth(1).get_by_role('button').focus()
        page.keyboard.press('Enter')
        expect(prompt).to_have_value('缓慢推进。 @{look:look-a} ')
        assert page.evaluate('referenceFixture.counts.insert') == 1
        report['checks'].append('keyboard Enter inserts exactly once')
        for index in [2, 3, 4]:
            rows.nth(index).get_by_role('button').click()
        stable = '缓慢推进。 @{look:look-a} @{look:look-b} @{scene:scene-station} @{prop:prop-letter} '
        expect(prompt).to_have_value(stable)
        state = page.evaluate('referenceFixture')
        assert state['counts']['insert'] == 4
        assert state['error'] == '', state['error']
        for text in ['同名人物 / 雨衣（参考图2）', '同名人物 / 雨衣（参考图3）', '雨夜车站（参考图4）', '旧信封（参考图5）']:
            assert text in state['compiled'], (text, state['compiled'])
        assert '@{' not in state['compiled']
        assert state['doc']['episodes'][0]['scenes'][0]['shots'][0]['motionPrompt'] == stable
        assert state['doc']['episodes'][0]['scenes'][0]['shots'][0]['prompt'] == '雨中相遇。'
        report['checks'].append('four stable IDs append into React state; real request compiles names and exact image numbers without mutating authored prompts')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert rows.evaluate_all('(rows) => rows.every(r => r.scrollWidth <= r.clientWidth)')
        page.screenshot(path=str(OUT / 'references-1040.png'), full_page=True)
        report['checks'].append('1040 viewport and reference rows have no horizontal overflow; screenshot captured with app/Director/motion-comic CSS')
        page.get_by_role('button', name='切换忙碌状态').click()
        for index in [1, 2, 3, 4]:
            button = rows.nth(index).get_by_role('button')
            expect(button).to_be_disabled()
            button.evaluate('(button) => button.click()')
        assert page.evaluate('referenceFixture.counts.insert') == 4
        expect(prompt).to_have_value(stable)
        report['checks'].append('busy disables every insert button and native click dispatch causes no callback')
        page.get_by_role('button', name='切换忙碌状态').click()
        page.get_by_label('参考输入方式', exact=True).select_option('frames')
        expect(page.get_by_role('list', name='实际提交参考列表')).to_have_count(0)
        expect(prompt).to_have_value(stable)
        assert 'DIRECTOR_VIDEO_MENTION_MODE' in page.evaluate('referenceFixture.error')
        page.screenshot(path=str(OUT / 'frames-1040.png'), full_page=True)
        report['checks'].append('frames switch removes reference list and keeps authored tokens; real compiler reports mode error')
        assert not report['errors'], report['errors']
        assert not report['externalRequests'], report['externalRequests']
        report['passed'] = True
        browser.close()
finally:
    server.shutdown()
    (OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
