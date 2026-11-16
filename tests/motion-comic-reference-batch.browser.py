"""Real component acceptance with exclusively offline fake data and callbacks."""
import functools
import http.server
import json
from pathlib import Path
import subprocess
import threading
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts' / 'reference-batch-ui'
OUT.mkdir(parents=True, exist_ok=True)
subprocess.run(['node', '--input-type=module', '-e', "import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:'artifacts/reference-batch-ui',emptyOutDir:false,lib:{entry:'tests/motion-comic-reference-batch.harness.tsx',name:'referenceBatchQA',formats:['iife'],fileName:()=> 'harness.js',cssFileName:'harness'}}});"], cwd=ROOT, check=True)
(OUT / 'index.html').write_text('<!doctype html><html data-theme="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="harness.css"><body><div id="root"></div><script src="harness.js"></script></body></html>', encoding='utf-8')
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
report = {'scope': 'Real reference batch component; OFFLINE FAKE DATA; mock callbacks only; no production API', 'checks': [], 'errors': []}
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
        page = browser.new_page(viewport={'width': 1600, 'height': 1040})
        page.on('pageerror', lambda error: report['errors'].append(str(error)))
        page.route('**/*', lambda route: route.continue_() if urlparse(route.request.url).hostname == '127.0.0.1' and urlparse(route.request.url).port == server.server_port else route.abort())
        page.goto(f'http://127.0.0.1:{server.server_port}')
        # A paused batch keeps its history collapsed; open it before reaching its controls.
        page.locator('details.comic-reference-batch__history > summary').click()
        expect(page.get_by_role('button', name='继续未提交', exact=True)).to_be_disabled()
        page.get_by_label('模拟模型离线').check()
        expect(page.get_by_role('button', name='选择并批量生成…', exact=True)).to_be_disabled()
        query = page.get_by_role('button', name='恢复查询', exact=True)
        expect(query).to_be_enabled()
        query.click()
        expect(query).to_be_enabled()
        controls = page.evaluate("window.batchQA.calls.filter(c => c.method === 'control')")
        assert controls == [{'method': 'control', 'value': {'id': 'offline-unknown', 'action': 'reconcile'}}], controls
        assert not page.evaluate("window.batchQA.calls.some(c => c.method === 'submit')")
        report['checks'].append('Unknown cannot resume; disabled provider still permits reconcile; query emits only one reconcile and no submit')
        page.get_by_label('模拟模型离线').uncheck()
        page.get_by_role('button', name='选择并批量生成…', exact=True).click()
        dialog = page.get_by_role('dialog', name='批量生成人物造型参考图')
        expect(dialog).to_be_visible()
        expect(dialog.get_by_role('checkbox', name='缺图造型', exact=False)).to_be_checked()
        candidate = dialog.get_by_role('checkbox', name='已有候选造型', exact=False)
        expect(candidate).not_to_be_checked()
        for width in [1600, 1040, 375]:
            page.set_viewport_size({'width': width, 'height': 1000})
            box = dialog.bounding_box()
            assert box and box['x'] >= 0 and box['x'] + box['width'] <= width + 1, box
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.screenshot(path=str(OUT / f'offline-dialog-{width}.png'), full_page=True)
        report['checks'].append('Dialog screenshots at 1600/1040/375; contained viewport; missing preferred look checked, candidate unchecked')
        candidate.check()
        submit = dialog.get_by_role('button', name='保存并提交 6 次生成', exact=True)
        submit.click()
        expect(dialog.get_by_role('button', name='保存并提交中…', exact=True)).to_be_disabled()
        assert page.evaluate("window.batchQA.calls.filter(c => c.method === 'prepare').length") == 1
        assert page.evaluate("window.batchQA.calls.filter(c => c.method === 'submit').length") == 0
        page.evaluate('window.batchQA.finishSave()')
        expect(dialog).not_to_be_visible()
        submits = page.evaluate("window.batchQA.calls.filter(c => c.method === 'submit')")
        assert len(submits) == 1 and submits[0]['value'] == {'updatedAt': 'saved-offline', 'targets': [{'kind': 'look', 'id': 'look-0'}, {'kind': 'look', 'id': 'look-1'}]}, submits
        report['checks'].append('Explicit redraw selection; save awaits completion; disabled busy button; exactly one submit with persisted version and two targets')
        page.get_by_role('button', name='选择并批量生成…', exact=True).click()
        expect(dialog.get_by_role('button', name='保存并提交 3 次生成', exact=True)).to_be_visible()
        page.evaluate('window.batchQA.failSubmit()')
        dialog.get_by_role('button', name='保存并提交 3 次生成', exact=True).click()
        page.evaluate('window.batchQA.finishSave()')
        expect(dialog.get_by_role('alert')).to_have_text('参考图任务提交失败，请重试。')
        assert '__STORYDREAM_SAFE_APP_ERROR_V1__' not in page.locator('body').inner_text()
        report['checks'].append('Real request counts before submit; bridged errors decoded into readable message')
        assert not report['errors'], report['errors']
        browser.close()
finally:
    server.shutdown()
    (OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
