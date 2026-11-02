"""Offline stock-media workflow QA with actual Electron renderer and screenshots."""
import json, os, socket, subprocess, time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.artifacts/stock-media-ui-20261102'
def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0)); port = listener.getsockname()[1]
    env = dict(os.environ)
    for key in ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS']: env.pop(key, None)
    env['TEMP'] = env['TMP'] = str(OUT / 'temp'); (OUT / 'temp').mkdir(exist_ok=True)
    report = {'checks': [], 'captures': [], 'errors': [], 'paidRequests': 0, 'realProviderVerified': False}
    process = None
    def check(name, passed=True):
        report['checks'].append({'name': name, 'passed': bool(passed)}); assert passed, name
    try:
        with (OUT / 'electron.log').open('ab') as log:
            process = subprocess.Popen([str(ROOT / 'node_modules/electron/dist/electron.exe'), '--remote-debugging-port=' + str(port), '--remote-debugging-address=127.0.0.1', str(OUT / 'main.cjs')], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
        with sync_playwright() as playwright:
            browser = None
            for _ in range(80):
                try: browser = playwright.chromium.connect_over_cdp('http://127.0.0.1:' + str(port)); break
                except Exception:
                    if process.poll() is not None: raise RuntimeError('Electron exited before debugger started')
                    time.sleep(.25)
            if browser is None: raise RuntimeError('No Electron CDP connection')
            page = browser.contexts[0].pages[0]; page.on('pageerror', lambda e: report['errors'].append(str(e)))
            page.on('console', lambda message: report['errors'].append(message.text) if message.type == 'error' else None)
            page.goto((OUT / 'index.html').as_uri(), wait_until='load')
            report['pageUrl'] = page.url
            page.set_default_timeout(15000)
            expect(page.get_by_role('heading', name='素材混剪 · 网络素材验收')).to_be_visible()
            expect(page.get_by_text('尚未配置 Pexels 专用 API Key', exact=False)).to_be_visible()
            expect(page.get_by_role('button', name='搜索 Pexels 视频', exact=True)).to_be_disabled(); check('missing dedicated credential blocks provider search')
            page.get_by_role('button', name='添加混剪视频', exact=True).click(); expect(page.get_by_text('D:/test-only/local.mp4', exact=True)).to_be_visible(); check('local material remains usable with no key')
            page.get_by_role('button', name='配置测试凭据', exact=True).click(); page.get_by_role('button', name='刷新凭据状态', exact=True).click()
            page.get_by_label('检索词', exact=True).fill('城市 夜景'); page.get_by_role('button', name='搜索 Pexels 视频', exact=True).click()
            page.get_by_role('button', name='选择视频 1', exact=True).click(); expect(page.get_by_role('button', name='选择视频 1', exact=True)).to_have_attribute('aria-pressed', 'true')
            check('stable ID selection shows source inspector')
            for width, height, theme in [(1440, 900, 'dark'), (1040, 720, 'dark'), (1040, 720, 'light')]:
                if theme == 'light': page.get_by_role('button', name='切换主题', exact=True).click()
                page.set_viewport_size({'width': width, 'height': height})
                page.get_by_role('region', name='Pexels 网络视频素材').scroll_into_view_if_needed()
                check(str(width) + '-' + theme + ' no horizontal overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
                path = OUT / ('search-' + str(width) + '-' + theme + '.png'); page.screenshot(path=str(path), full_page=True, animations='disabled'); report['captures'].append(str(path))
            page.get_by_role('button', name='下载并加入素材池', exact=True).click(); expect(page.get_by_text('D:/test-only/stock-media/1.mp4', exact=True)).to_be_visible(); check('download appends to existing local material pool')
            page.get_by_role('button', name='下载并加入素材池', exact=True).click(); check('duplicate selection stays unique', page.get_by_text('D:/test-only/stock-media/1.mp4', exact=True).count() == 1)
            page.get_by_role('button', name='暂停下载', exact=True).click(); page.get_by_role('button', name='选择视频 2', exact=True).click(); page.get_by_role('button', name='下载并加入素材池', exact=True).click()
            expect(page.get_by_role('button', name='正在下载并校验…', exact=True)).to_be_disabled(); page.get_by_role('button', name='取消下载', exact=True).click(); expect(page.get_by_role('alert')).to_contain_text('已取消素材操作'); check('cancel leaves prior selections and restores controls')
            page.get_by_role('button', name='空结果', exact=True).click(); page.get_by_role('button', name='搜索 Pexels 视频', exact=True).click(); expect(page.get_by_text('本页没有符合条件的素材', exact=False)).to_be_visible(); check('empty results provide recovery paths')
            page.get_by_role('button', name='限流', exact=True).click(); page.get_by_role('button', name='搜索 Pexels 视频', exact=True).click(); expect(page.get_by_role('alert')).to_contain_text('请求频率已达上限'); check('rate limit is visible and selected local files remain')
            expect(page.get_by_text('D:/test-only/local.mp4', exact=True)).to_be_visible(); expect(page.get_by_text('D:/test-only/stock-media/1.mp4', exact=True)).to_be_visible()
            check('no renderer exceptions', not report['errors']); report['status'] = 'passed'; browser.close()
    except Exception as error:
        report['status'] = 'failed'; report['error'] = str(error); raise
    finally:
        (OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        if process and process.poll() is None:
            subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
if __name__ == '__main__': main()
