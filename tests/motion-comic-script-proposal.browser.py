"""Offline single-beat component acceptance; all external network is blocked."""
import functools
import http.server
import json
from pathlib import Path
import subprocess
import threading
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts' / 'script-proposal-ui'
OUT.mkdir(parents=True, exist_ok=True)
subprocess.run(['node', '--input-type=module', '-e', "import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:'artifacts/script-proposal-ui',emptyOutDir:false,lib:{entry:'tests/motion-comic-script-proposal.harness.tsx',name:'proposalQA',formats:['iife'],fileName:()=> 'harness.js',cssFileName:'harness'}}});"], cwd=ROOT, check=True)
(OUT / 'index.html').write_text('<!doctype html><html data-theme="dark" data-theme-ready="true"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="harness.css"><body><div id="root"></div><script src="harness.js"></script></body></html>', encoding='utf-8')
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
report = {'checks': [], 'errors': [], 'scope': 'isolated component with offline fake callbacks, not real Workspace CAS integration'}
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
        page = browser.new_page(viewport={'width': 1280, 'height': 900})
        page.on('pageerror', lambda error: report['errors'].append(str(error)))
        page.route('**/*', lambda route: route.continue_() if urlparse(route.request.url).hostname == '127.0.0.1' and urlparse(route.request.url).port == server.server_port else route.abort())
        page.goto(f'http://127.0.0.1:{server.server_port}')
        submit = page.get_by_role('button', name='生成单段候选', exact=True)
        expect(submit).to_be_disabled()
        page.get_by_label('这个段落的修改要求', exact=True).fill('加强悬念')
        page.get_by_role('button', name='切换未保存状态').click()
        expect(submit).to_be_disabled()
        page.get_by_role('button', name='切换未保存状态').click()
        submit.click()
        expect(page.get_by_role('button', name='正在提交提案…')).to_be_disabled()
        adopt = page.get_by_role('button', name='采用此段候选', exact=True)
        expect(adopt).to_be_enabled()
        expect(page.locator('.comic-script-proposal__comparison')).to_contain_text('开门')
        expect(page.locator('.comic-script-proposal__comparison')).to_contain_text('缓缓推开门')
        assert len(page.evaluate('window.proposalCalls')) == 1
        report['checks'].append('empty/dirty disabled, pending disabled, single request and before/after')
        page.screenshot(path=str(OUT / 'ready-1280.png'), full_page=True)
        adopt.click()
        expect(page.get_by_role('button', name='正在采用…')).to_be_disabled()
        expect(page.locator('.comic-script-proposal')).to_contain_text('已采用 · 基准 r3 → r4')
        expect(adopt).to_be_disabled()
        report['checks'].append('ready adoption updates revision and disables applied candidate')
        page.get_by_role('button', name='切换失败模拟').click()
        submit.click()
        expect(page.get_by_role('alert')).to_contain_text('不会自动重发')
        assert len(page.evaluate('window.proposalCalls')) == 3
        assert page.evaluate('window.proposalCalls[0] !== window.proposalCalls[2]')
        expect(submit).to_be_disabled()
        expect(adopt).to_be_disabled()
        page.get_by_role('button', name='读取服务器状态并核对').click()
        expect(page.get_by_role('alert')).to_contain_text('保持锁定')
        expect(submit).to_be_disabled()
        assert len(page.evaluate('window.proposalCalls')) == 3
        report['checks'].append('ambiguous error locks writes; read-only refresh without matching record keeps lock')
        report['checks'].append('failure explicit without retry; fresh requestId')
        page.set_viewport_size({'width': 375, 'height': 812})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.screenshot(path=str(OUT / 'failed-375.png'), full_page=True)
        report['checks'].append('375px no horizontal overflow')
        page.get_by_role('button', name='模拟服务器已确认失败').click()
        page.get_by_role('button', name='读取服务器状态并核对').click()
        expect(submit).to_be_enabled()
        assert len(page.evaluate('window.proposalCalls')) == 3
        report['checks'].append('matching terminal request record unlocks without repeating paid operation')
        assert page.evaluate("sessionStorage.getItem('comic-script-proposal-pending:standalone')") is None
        page.evaluate("sessionStorage.setItem('comic-script-proposal-pending:standalone', JSON.stringify({kind:'propose',requestId:'persisted-unknown'}))")
        page.reload()
        page.get_by_label('这个段落的修改要求', exact=True).fill('重载后要求')
        expect(submit).to_be_disabled()
        expect(page.get_by_role('button', name='读取服务器状态并核对')).to_be_visible()
        assert page.evaluate('window.proposalCalls.length') == 0
        report['checks'].append('sessionStorage receipt restores lock after reload; terminal refresh clears receipt')
        page.evaluate("sessionStorage.removeItem('comic-script-proposal-pending:standalone')")
        page.reload()
        page.get_by_label('这个段落的修改要求', exact=True).fill('存储失败')
        page.evaluate("() => { window.originalStorageSetItem = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new Error('offline storage failure'); }; }")
        submit.click()
        expect(page.get_by_role('alert')).to_contain_text('已阻止提交')
        expect(submit).to_be_disabled()
        assert page.evaluate('window.proposalCalls.length') == 0
        report['checks'].append('storage failure blocks operation before callback')
        expect(page.get_by_role('button', name='读取服务器状态并核对')).to_have_count(0)
        page.get_by_role('button', name='重新检查本地存储').click()
        expect(submit).to_be_disabled()
        assert page.evaluate('window.proposalCalls.length') == 0
        page.evaluate('() => { Storage.prototype.setItem = window.originalStorageSetItem; }')
        page.get_by_role('button', name='重新检查本地存储').click()
        expect(submit).to_be_enabled()
        assert page.evaluate('window.proposalCalls.length') == 0
        submit.click()
        expect(page.get_by_role('button', name='采用此段候选', exact=True)).to_be_enabled()
        assert page.evaluate('window.proposalCalls.length') == 1
        report['checks'].append('known unsent storage failure recovers via local-only probe then submits once')
        assert not report['errors'], report['errors']
        browser.close()
finally:
    server.shutdown()
    (OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
