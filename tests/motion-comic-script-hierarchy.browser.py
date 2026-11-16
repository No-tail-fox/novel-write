"""Script workspace hierarchy visual check; fixture API only.
Run: vendor/python/python.exe tests/motion-comic-script-hierarchy.browser.py"""
import functools, http.server, json, os, subprocess, threading
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path(os.environ.get('STORYDREAM_QA_OUTPUT', str(ROOT / 'artifacts/script-hierarchy')))

def run():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, 'TEMP': str(OUTPUT), 'TMP': str(OUTPUT)}
    subprocess.run([os.environ.get('STORYDREAM_QA_NODE', 'I:/nodejs/node.exe'), '--input-type=module', '-e', "import {build} from 'vite'; await build({configFile:false,logLevel:'warn',define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:process.argv[1],emptyOutDir:false,lib:{entry:'tests/motion-comic-script-hierarchy.harness.tsx',name:'scriptHierarchyQA',formats:['iife'],fileName:()=> 'harness.js',cssFileName:'harness'}}});", str(OUTPUT)], cwd=ROOT, env=env, check=True)
    (OUTPUT / 'index.html').write_text('<!doctype html><html data-theme="dark" data-theme-ready="true"><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><div id="root"></div><script src="harness.js"></script></html>', encoding='utf-8')
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUTPUT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    report = {'checks': [], 'failures': [], 'runtimeErrors': [], 'blockedNetwork': [], 'layout': []}
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, channel='msedge')
            for width, height in [(1714, 975), (1366, 860), (1040, 720)]:
                page = browser.new_page(viewport={'width': width, 'height': height})
                page.on('pageerror', lambda e: report['runtimeErrors'].append(str(e)))
                def route(r):
                    u = urlparse(r.request.url)
                    if u.hostname == '127.0.0.1' and u.port == server.server_port: r.continue_()
                    else: report['blockedNetwork'].append(r.request.url); r.abort()
                page.route('**/*', route)
                try:
                    page.goto(f'http://127.0.0.1:{server.server_port}/')
                    expect(page.get_by_role('region', name='漫剧项目总览')).to_be_visible()
                    page.get_by_role('button', name='继续制作', exact=True).click()
                    page.get_by_role('tab', name='剧本', exact=True).click()
                    page.locator('[data-motion-comic-script-workspace]').wait_for()
                    # Selected episode cycles through the real states present in the fixture.
                    for label, title in [('running', 'EP 01'), ('queued', 'EP 02'), ('failed', 'EP 03')]:
                        page.locator('.comic-script-source-row', has_text=title).first.click()
                        expect(page.locator('.comic-script-source-card')).to_be_visible()
                        expect(page.locator('.comic-script-awaiting-card')).to_be_visible()
                        page.wait_for_timeout(150)
                        page.screenshot(path=str(OUTPUT / f'{label}-{width}x{height}.png'))
                        m = page.evaluate('''() => {
                          const box = s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return {top:r.top,bottom:r.bottom,height:r.height,width:r.width}; };
                          return { scrollWidth: document.documentElement.scrollWidth, header: box('.motion-comic-production__header.is-unified'),
                            tabs: box('.motion-comic-production__header.is-unified [role=tablist]'), controlsRow: !!document.querySelector('.comic-project-controls'),
                            source: box('.comic-script-source-card'), awaiting: box('.comic-script-awaiting-card'),
                            paragraphs: document.querySelectorAll('.comic-script-paragraphs li').length };
                        }''')
                        report['layout'].append({'viewport': f'{width}x{height}', 'state': label, **m})
                        assert m['scrollWidth'] <= width, f'horizontal overflow {m}'
                        assert m['header'] and not m['controlsRow'], 'project controls must live in the single header'
                        assert m['tabs']['top'] >= m['header']['top'] - 1 and m['tabs']['bottom'] <= m['header']['bottom'] + 1, 'domain tabs inside header'
                        assert m['paragraphs'] == 9, 'source paragraphs rendered individually'
                        report['checks'].append(f'{width}x{height} {label}')
                    page.get_by_role('tab', name='原文与边界', exact=True).click()
                    expect(page.get_by_text('拆分依据', exact=True)).to_be_visible()
                    page.screenshot(path=str(OUTPUT / f'source-tab-{width}x{height}.png'))
                    report['checks'].append(f'{width}x{height} source tab')
                    calls = page.evaluate('window.scriptHierarchyQA')
                    assert not calls['forbiddenCalls'], calls['forbiddenCalls']
                except Exception as error:
                    report['failures'].append({'viewport': f'{width}x{height}', 'error': str(error)})
                    page.screenshot(path=str(OUTPUT / f'failure-{width}x{height}.png'))
                page.close()
            browser.close()
    finally:
        server.shutdown()
    (OUTPUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k: (v if k != 'layout' else len(v)) for k, v in report.items()}, ensure_ascii=False, indent=2))
    if report['failures'] or report['runtimeErrors'] or report['blockedNetwork']: raise SystemExit(1)

if __name__ == '__main__':
    run()
