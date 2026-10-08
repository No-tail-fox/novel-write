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
OUTPUT = ROOT / '.artifacts' / 'motion-comic-episode-create'


def run() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    environment = {**os.environ, 'TEMP': str(OUTPUT), 'TMP': str(OUTPUT)}
    subprocess.run([
        'I:/nodejs/node.exe', '--input-type=module', '-e',
        "import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:process.argv[1],emptyOutDir:true,target:'chrome120',lib:{entry:'tests/motion-comic-episode-create.harness.tsx',formats:['es'],fileName:()=> 'harness.js',cssFileName:'harness'}}});",
        str(OUTPUT),
    ], cwd=ROOT, env=environment, check=True, capture_output=True)
    (OUTPUT / 'index.html').write_text(
        '<!doctype html><html data-theme-ready="true"><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="harness.css"><body><div id="root"></div><script type="module" src="harness.js"></script></body></html>',
        encoding='utf-8',
    )
    server = http.server.ThreadingHTTPServer(
        ('127.0.0.1', 0),
        functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUTPUT)),
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()
    report: dict[str, object] = {'status': 'running', 'captures': [], 'runtimeErrors': [], 'externalRequests': [], 'paidGenerationCalls': 0}
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                headless=True,
                env=environment,
                executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe',
            )
            for theme in ('dark', 'light'):
                for width, height in ((1536, 1024), (1040, 720)):
                    page = browser.new_page(viewport={'width': width, 'height': height})
                    page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
                    page.on('request', lambda request: report['externalRequests'].append(request.url) if request.url.startswith(('http://', 'https://')) and f'127.0.0.1:{server.server_port}' not in request.url else None)
                    page.goto(f'http://127.0.0.1:{server.server_port}/?theme={theme}')
                    expect(page.locator('[data-motion-comic-create-flow]')).to_be_visible()
                    expect(page.locator('.motion-comic-episode-draft')).to_have_count(2)
                    expect(page.locator('.motion-comic-ai-split-result')).to_contain_text('自动修复后已通过校验')
                    expect(page.get_by_role('textbox', name='第 1 集源文（按边界重建）')).to_have_attribute('readonly', '')
                    footer = page.locator('.motion-comic-create__footer')
                    bounds = footer.bounding_box()
                    if not bounds or bounds['y'] < 0 or bounds['y'] + bounds['height'] > height + 1:
                        raise AssertionError(f'Create footer is clipped at {width}x{height}: {bounds}')
                    if page.evaluate('document.documentElement.scrollWidth > innerWidth'):
                        raise AssertionError(f'Horizontal overflow at {width}x{height}')
                    fields = page.locator('.motion-comic-create__fields')
                    if fields.evaluate('(element) => element.scrollHeight > element.clientHeight'):
                        fields.hover()
                        page.mouse.wheel(0, 900)
                        page.wait_for_timeout(120)
                        if fields.evaluate('(element) => element.scrollTop') <= 0:
                            raise AssertionError(f'AI episode list does not scroll at {width}x{height}')
                    name = f'ai-episode-preview-{theme}-{width}x{height}.png'
                    page.screenshot(path=str(OUTPUT / name), full_page=False, animations='disabled')
                    report['captures'].append({'name': name, 'theme': theme, 'width': width, 'height': height})
                    page.close()
            browser.close()
        if report['runtimeErrors'] or report['externalRequests']:
            raise AssertionError(str(report))
        report['status'] = 'passed'
    except Exception as error:
        report['status'] = 'failed'
        report['error'] = str(error)
        raise
    finally:
        server.shutdown()
        (OUTPUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'status': report['status'], 'captures': len(report['captures'])}, ensure_ascii=False))


if __name__ == '__main__':
    run()
