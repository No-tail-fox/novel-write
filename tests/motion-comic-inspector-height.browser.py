"""Offline production inspector regression; build with motion-comic-shell.browser.py first."""
import functools, http.server, threading, json, os
from pathlib import Path
from playwright.sync_api import sync_playwright
OUT = Path(os.environ.get('STORYDREAM_SHELL_QA_OUTPUT', 'E:/StoryDream-QA/inspector-fix-20260906'))

def run():
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    report = {'screens': [], 'errors': [], 'blocked': []}
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
            page = browser.new_page()
            page.on('pageerror', lambda e: report['errors'].append(str(e)))
            def route(r):
                if r.request.url.startswith(f'http://127.0.0.1:{server.server_port}/'): r.continue_()
                else: report['blocked'].append(r.request.url); r.abort()
            page.route('**/*', route)
            for w, h in [(1040, 720), (1536, 1024)]:
                page.set_viewport_size({'width': w, 'height': h})
                page.goto(f'http://127.0.0.1:{server.server_port}/')
                page.get_by_role('region', name='漫剧项目总览').get_by_role('button', name='继续制作', exact=True).click()
                page.get_by_role('tablist', name='漫剧项目功能区').get_by_role('tab', name='生产', exact=True).click()
                pane = page.locator('.director-inspector-pane')
                page.screenshot(path=str(OUT / f'inspector-{w}x{h}-top.png'))
                data = pane.evaluate('''e => {const box=n=>{let r=n.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,scrollHeight:n.scrollHeight,overflow:getComputedStyle(n).overflowY}};return {pane:box(e),children:[...e.children].map(n=>({class:n.className,...box(n)})),scrolls:[e,...e.querySelectorAll('*')].filter(n=>n.scrollHeight>n.clientHeight+2&&['auto','scroll'].includes(getComputedStyle(n).overflowY)).map(n=>n.className),sidebar:box(document.querySelector('.sidebar')),columns:[...document.querySelectorAll('.director-left-pane,.director-center-pane,.director-inspector-pane')].map(box),documentWidth:document.documentElement.scrollWidth}}''')
                data['size'] = [w,h]
                assert data['documentWidth'] == w
                assert data['sidebar']['w'] == (64 if w == 1040 else 224)
                assert len(data['columns']) == 3 and all(c['w'] > 100 and c['h'] > 100 for c in data['columns'])
                if h == 720:
                    # The shared bottom timeline reserves its own row; verify a usable
                    # inspector viewport and every control's scroll reachability below.
                    assert data['pane']['h'] >= 180
                    assert len(data['scrolls']) == 1 and 'director-inspector-pane' in data['scrolls'][0].split(), data['scrolls']
                controls = pane.locator('button, input, select, textarea')
                data['controls'] = []
                for i in range(controls.count()):
                    el = controls.nth(i)
                    if not el.is_visible(): continue
                    el.evaluate("e=>e.scrollIntoView({block:'center',inline:'nearest'})")
                    result = el.evaluate('''e=>{let r=e.getBoundingClientRect(),p=e.closest('.director-inspector-pane').getBoundingClientRect(),t=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {label:e.innerText||e.getAttribute('aria-label')||e.tagName,disabled:!!e.disabled,y:r.y,h:r.height,full:r.top>=p.top-1&&r.bottom<=p.bottom+1&&r.left>=p.left-1&&r.right<=p.right+1,hit:!!t&&e.contains(t)}}''')
                    data['controls'].append(result)
                    assert result['full'] and result['hit'], result
                for label, selector in [('readiness','.motion-comic-video-readiness'),('actions','.director-action-footer'),('queue','.director-queue-panel')]:
                    el = pane.locator(selector).first
                    if el.count():
                        el.evaluate("e=>e.scrollIntoView({block:'start'})")
                        page.screenshot(path=str(OUT / f'inspector-{w}x{h}-{label}.png'))
                data['api'] = page.evaluate('window.comicShellQA')
                assert not data['api']['forbiddenCalls']
                report['screens'].append(data)
            browser.close()
        assert not report['errors'] and not report['blocked']
    finally:
        server.shutdown(); server.server_close()
        (OUT / 'inspector-height-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'sizes': len(report['screens']), 'controls': [len(s['controls']) for s in report['screens']], 'errors': report['errors'], 'blocked': report['blocked']}))

if __name__ == '__main__': run()
