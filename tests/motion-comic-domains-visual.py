"""Capture each production domain in the isolated script-hierarchy fixture (no DB/API/paid calls).
Run after tests/motion-comic-script-hierarchy.browser.py has built artifacts/script-hierarchy."""
import functools, http.server, json, sys, threading
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'artifacts/script-hierarchy'
OUT = ROOT / 'artifacts/domains-visual' / (sys.argv[1] if len(sys.argv) > 1 else 'current')
OUT.mkdir(parents=True, exist_ok=True)
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(SRC)))
threading.Thread(target=server.serve_forever, daemon=True).start()
report = {'shots': [], 'errors': [], 'blocked': [], 'failures': []}
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, channel='msedge')
        for width, height in [(1714, 975), (1040, 720)]:
            page = browser.new_page(viewport={'width': width, 'height': height})
            page.on('pageerror', lambda e: report['errors'].append(str(e)))
            def route(r):
                u = urlparse(r.request.url)
                if u.hostname == '127.0.0.1' and u.port == server.server_port: r.continue_()
                else: report['blocked'].append(r.request.url); r.abort()
            page.route('**/*', route)
            page.goto(f'http://127.0.0.1:{server.server_port}/')
            expect(page.get_by_role('region', name='漫剧项目总览')).to_be_visible()
            page.screenshot(path=str(OUT / f'overview-{width}.png'))
            page.get_by_role('button', name='继续制作', exact=True).click()
            for tab in ['资产', '分镜', '生产', '预览']:
                try:
                    t = page.get_by_role('tab', name=tab, exact=True)
                    if t.is_disabled():
                        report['shots'].append({'tab': tab, 'width': width, 'disabled': True}); continue
                    t.click(); page.wait_for_timeout(400)
                    page.screenshot(path=str(OUT / f'{tab}-{width}.png'))
                    sw = page.evaluate('document.documentElement.scrollWidth')
                    report['shots'].append({'tab': tab, 'width': width, 'scrollWidth': sw})
                except Exception as e:
                    report['failures'].append({'tab': tab, 'width': width, 'error': str(e)[:300]})
            page.close()
        browser.close()
finally:
    server.shutdown()
print(json.dumps(report, ensure_ascii=False, indent=1))
