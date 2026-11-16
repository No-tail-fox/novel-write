"""Offline acceptance of the real gallery component; no IPC/auth/provider access."""
import functools
import http.server
import json
from pathlib import Path
import subprocess
import threading
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts' / 'asset-gallery-ui'
OUT.mkdir(parents=True, exist_ok=True)
subprocess.run(['node', '--input-type=module', '-e', "import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:'artifacts/asset-gallery-ui',emptyOutDir:false,lib:{entry:'tests/motion-comic-asset-gallery.harness.tsx',name:'galleryQA',formats:['iife'],fileName:()=> 'harness.js',cssFileName:'harness'}}});"], cwd=ROOT, check=True)
(OUT / 'index.html').write_text('<!doctype html><html data-theme="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="harness.css"><body><div id="root"></div><script src="harness.js"></script></body></html>', encoding='utf-8')
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
report = {'scope': 'Real gallery component, offline synthetic fixtures; not full Page/Electron/backend acceptance', 'checks': [], 'errors': []}
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
        page = browser.new_page(viewport={'width': 1600, 'height': 1040})
        page.on('pageerror', lambda error: report['errors'].append(str(error)))
        page.route('**/*', lambda route: route.continue_() if urlparse(route.request.url).hostname == '127.0.0.1' and urlparse(route.request.url).port == server.server_port else route.abort())
        page.goto(f'http://127.0.0.1:{server.server_port}')
        broken = page.get_by_role('button', name='打开陈叔详情', exact=True)
        expect(broken).to_contain_text('参考图加载失败')
        expect(broken).to_contain_text('固定图加载失败')
        expect(broken.locator('img')).to_have_count(0)
        report['checks'].append('Broken local image renders recovery copy and removes broken img')
        card = page.get_by_role('button', name='打开林晚详情', exact=True)
        card.focus()
        page.keyboard.press('Enter')
        expect(page.get_by_label('打开记录')).to_have_text('person-0')
        page.keyboard.press('Space')
        expect(page.get_by_label('打开记录')).to_have_text('person-0,person-0')
        report['checks'].append('Native Enter and Space each invoke onOpen exactly once with character id')
        expect(card).to_contain_text('2 个造型')
        expect(card).to_contain_text('1 个造型缺固定图')
        page.screenshot(path=str(OUT / 'gallery-1600.png'), full_page=True)
        for width in [1040, 375]:
            page.set_viewport_size({'width': width, 'height': 900})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.screenshot(path=str(OUT / f'gallery-{width}.png'), full_page=True)
        report['checks'].append('1600/1040/375 screenshots; 1040/375 have no horizontal overflow')
        page.get_by_label('搜索资产').fill('晚装')
        expect(page.locator('.comic-gallery-card')).to_have_count(1)
        page.get_by_label('搜索资产').fill('未知')
        expect(page.locator('.comic-gallery-empty [role="status"]')).to_have_text('没有匹配的人物')
        page.get_by_label('搜索资产').fill('')
        page.get_by_role('button', name='场景', exact=True).click()
        expect(page.get_by_role('button', name='打开雨夜街道详情')).to_be_visible()
        expect(page.get_by_role('button', name='打开林晚详情')).to_have_count(0)
        page.get_by_role('button', name='道具', exact=True).click()
        expect(page.locator('.comic-gallery-empty [role="status"]')).to_have_text('暂无道具资产')
        page.get_by_role('button', name='新增道具').click()
        expect(page.get_by_label('打开记录')).to_have_text('person-0,person-0,add')
        report['checks'].append('All-look search, no-results, category isolation, empty state and onAdd work')
        assert not report['errors'], report['errors']
        browser.close()
finally:
    server.shutdown()
    (OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
