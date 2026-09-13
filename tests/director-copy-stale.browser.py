"""Exercise delayed copy responses on the real director creation forms."""
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
OUTPUT = Path(os.environ.get('STORYDREAM_QA_OUTPUT', 'E:/StoryDream-QA/r02-tests/copy-browser'))


def run() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    environment = {**os.environ, 'TEMP': str(OUTPUT), 'TMP': str(OUTPUT)}
    subprocess.run([
        'I:/nodejs/node.exe', '--input-type=module', '-e',
        "import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:process.argv[1],emptyOutDir:false,target:'chrome120',lib:{entry:'tests/director-copy-stale.harness.tsx',name:'directorCopyQA',formats:['iife'],fileName:()=> 'harness.js',cssFileName:'harness'}}});",
        str(OUTPUT),
    ], cwd=ROOT, env=environment, check=True)
    (OUTPUT / 'index.html').write_text('<!doctype html><html data-theme="dark" data-theme-ready="true"><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><body><div id="root"></div><script src="harness.js"></script></body></html>', encoding='utf-8')
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUTPUT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    checks: list[str] = []
    errors: list[str] = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, env=environment, executable_path=os.environ.get('STORYDREAM_QA_BROWSER', 'C:/Program Files/Google/Chrome/Application/chrome.exe'))
            page = browser.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(f'http://127.0.0.1:{server.server_port}/') else route.abort())
            for width, height in [(1536, 1024), (1040, 720)]:
                page.set_viewport_size({'width': width, 'height': height})
                for mode in ['vox', 'comic']:
                    page.goto(f'http://127.0.0.1:{server.server_port}/?mode={mode}')
                    title = page.get_by_label('项目标题' if mode == 'vox' else '系列名称', exact=True)
                    copy = page.get_by_label('原始文案' if mode == 'vox' else '核心设定', exact=True)
                    title.fill('Original title')
                    copy.fill('Original copy')
                    page.get_by_role('button', name='AI 修改', exact=True).click()
                    page.wait_for_function('window.directorCopyQA.pending.length === 1')
                    copy.fill('Newer user copy')
                    page.evaluate('window.directorCopyQA.release("Older AI copy")')
                    expect(copy).to_have_value('Newer user copy')
                    expect(page.locator('[data-director-copy-assist] [role=alert]')).to_contain_text('已保留当前内容')
                    checks.append(f'{mode} {width}: newer copy survives delayed revision')
                    page.screenshot(path=str(OUTPUT / f'{mode}-{width}x{height}-stale-copy.png'))

                    page.get_by_role('button', name='AI 创作', exact=True).click()
                    page.wait_for_function('window.directorCopyQA.pending.length === 1')
                    title.fill('A replacement subject')
                    page.evaluate('window.directorCopyQA.release("Wrong subject copy")')
                    expect(title).to_have_value('A replacement subject')
                    expect(copy).to_have_value('Newer user copy')
                    expect(page.locator('[data-director-copy-assist] [role=alert]')).to_contain_text('已保留当前内容')
                    checks.append(f'{mode} {width}: changed title rejects delayed creation')

                    page.get_by_role('button', name='AI 修改', exact=True).click()
                    page.wait_for_function('window.directorCopyQA.pending.length === 1')
                    page.evaluate('window.directorCopyQA.release("Accepted AI copy")')
                    expect(copy).to_have_value('Accepted AI copy')
                    checks.append(f'{mode} {width}: unchanged input accepts response')

                    page.get_by_role('button', name='AI 修改', exact=True).click()
                    page.wait_for_function('window.directorCopyQA.pending.length === 1')
                    page.evaluate('window.directorCopyQA.remount()')
                    expect(copy).to_have_value('')
                    title.fill('New workspace')
                    copy.fill('New workspace copy')
                    page.evaluate('window.directorCopyQA.release("Departed workspace copy")')
                    expect(copy).to_have_value('New workspace copy')
                    checks.append(f'{mode} {width}: departed page cannot receive response')
            assert not errors, errors
            browser.close()
    finally:
        server.shutdown()
        (OUTPUT / 'report.json').write_text(json.dumps({'checks': checks, 'runtimeErrors': errors, 'paidGenerationCalls': 0}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'passed': len(checks), 'runtimeErrors': errors, 'output': str(OUTPUT)}, ensure_ascii=False))


if __name__ == '__main__':
    run()
