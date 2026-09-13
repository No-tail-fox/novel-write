"""Real React template navigation regression with local, delayed API fixtures."""
from __future__ import annotations

import functools
import http.server
import json
import os
from pathlib import Path
import subprocess
import threading

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path(os.environ.get('STORYDREAM_QA_OUTPUT', 'E:/StoryDream-QA/template-unsaved'))


def run() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    environment = {**os.environ, 'TEMP': str(OUTPUT), 'TMP': str(OUTPUT)}
    subprocess.run([
        'I:/nodejs/node.exe', str(ROOT / 'node_modules/esbuild/bin/esbuild'),
        str(ROOT / 'tests/template-unsaved.harness.tsx'), '--bundle', '--format=iife', '--platform=browser',
        '--target=chrome120', '--loader:.css=empty', f'--outfile={OUTPUT / "harness.js"}',
    ], cwd=ROOT, env=environment, check=True)
    (OUTPUT / 'index.html').write_text('<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script src="harness.js"></script></body></html>', encoding='utf-8')
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUTPUT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    checks: list[str] = []
    errors: list[str] = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, env=environment, executable_path=os.environ.get('STORYDREAM_QA_BROWSER', 'C:/Program Files/Google/Chrome/Application/chrome.exe'))
            page = browser.new_page(viewport={'width': 1536, 'height': 1024})
            page.on('pageerror', lambda error: errors.append(str(error)))

            def load(mode='prompt', delay=False):
                page.goto(f'http://127.0.0.1:{server.server_port}/?mode={mode}' + ('&delayDetail=1' if delay else ''))
                expect(page.get_by_test_id('dirty')).to_have_text('false')

            def open_editor(mode):
                if mode == 'draft':
                    page.get_by_role('button', name='编辑 Draft A', exact=True).click()
                    return page.locator('.template-name-input')
                if mode == 'image':
                    page.get_by_role('button', name='图像模板', exact=True).click()
                page.get_by_role('button', name='查看', exact=True).click()
                return page.locator('.prompt-template-detail input').first

            for mode in ['draft', 'prompt', 'image']:
                load('draft' if mode == 'draft' else 'prompt')
                field = open_editor(mode)
                original = field.input_value()
                field.fill(original + ' edited')
                expect(page.get_by_test_id('dirty')).to_have_text('true')
                page.get_by_role('button', name='返回模板列表' if mode == 'draft' else '返回模板库', exact=True).click()
                expect(page.get_by_role('dialog')).to_be_visible()
                page.get_by_role('button', name='继续编辑', exact=True).click()
                expect(field).to_have_value(original + ' edited')
                checks.append(f'{mode}: internal return keeps draft on cancel')

                page.evaluate('window.templateQA.failSave = true')
                page.get_by_test_id('leave').click()
                page.get_by_role('button', name='保存并离开', exact=True).click()
                expect(page.get_by_role('dialog')).to_be_visible()
                expect(page.get_by_role('dialog').get_by_role('alert')).to_be_visible()
                expect(field).to_have_value(original + ' edited')
                expect(page.get_by_test_id('destination')).to_have_count(0)
                checks.append(f'{mode}: failed save preserves draft and route')
                page.evaluate('window.templateQA.failSave = false')
                page.get_by_role('button', name='保存并离开', exact=True).click()
                expect(page.get_by_test_id('destination')).to_be_visible()
                checks.append(f'{mode}: successful save leaves')

                load('draft' if mode == 'draft' else 'prompt')
                field = open_editor(mode)
                original = field.input_value()
                field.fill(original + ' first')
                page.evaluate('window.templateQA.delaySave = true')
                page.get_by_role('button', name='保存' if mode == 'draft' else '保存修改', exact=True).click()
                page.wait_for_function('window.templateQA.pendingSaves.length === 1')
                field.fill(original + ' newer')
                page.evaluate('window.templateQA.releaseSaves()')
                expect(field).to_have_value(original + ' newer')
                expect(page.get_by_test_id('dirty')).to_have_text('true')
                page.get_by_test_id('leave').click()
                expect(page.get_by_role('dialog')).to_be_visible()
                page.get_by_role('button', name='放弃改动并离开', exact=True).click()
                expect(page.get_by_test_id('destination')).to_be_visible()
                checks.append(f'{mode}: delayed save keeps newer edits dirty')

            for mode in ['draft', 'prompt']:
                load(mode, delay=True)
                if mode == 'draft':
                    page.get_by_role('button', name='编辑 Draft A', exact=True).click()
                else:
                    page.get_by_role('button', name='查看', exact=True).click()
                expect(page.locator('.template-name-input, .prompt-template-detail')).to_have_count(0)
                page.get_by_test_id('leave').click()
                expect(page.get_by_test_id('destination')).to_be_visible()
                page.evaluate('window.templateQA.releaseDetails()')
                expect(page.get_by_test_id('destination')).to_be_visible()
                expect(page.locator('.template-name-input, .prompt-template-detail')).to_have_count(0)
                checks.append(f'{mode}: late detail does not reopen departed editor')

            assert not errors, errors
            browser.close()
    finally:
        server.shutdown()
        (OUTPUT / 'report.json').write_text(json.dumps({'checks': checks, 'runtimeErrors': errors}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'passed': len(checks), 'runtimeErrors': errors, 'output': str(OUTPUT)}, ensure_ascii=False))


if __name__ == '__main__':
    run()
