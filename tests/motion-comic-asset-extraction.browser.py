"""Real component; mock callbacks only; blocks all non-local traffic."""
import functools
import http.server
import json
from pathlib import Path
import subprocess
import threading
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts' / 'asset-extraction-ui'
OUT.mkdir(parents=True, exist_ok=True)
subprocess.run(['node', '--input-type=module', '-e', "import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:'artifacts/asset-extraction-ui',emptyOutDir:false,lib:{entry:'tests/motion-comic-asset-extraction.harness.tsx',name:'extractionQA',formats:['iife'],fileName:()=> 'harness.js',cssFileName:'harness'}}});"], cwd=ROOT, check=True)
(OUT / 'index.html').write_text('<!doctype html><html data-theme="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="harness.css"><body><div id="root"></div><script src="harness.js"></script></body></html>', encoding='utf-8')
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
report = {'scope': 'real component / offline mock only / no LLM', 'checks': [], 'errors': []}
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
        page = browser.new_page(viewport={'width': 1600, 'height': 1040})
        page.on('pageerror', lambda error: report['errors'].append(str(error)))
        page.route('**/*', lambda route: route.continue_() if urlparse(route.request.url).hostname == '127.0.0.1' and urlparse(route.request.url).port == server.server_port else route.abort())
        url = f'http://127.0.0.1:{server.server_port}'
        page.goto(url)
        page.get_by_role('button', name='从剧本提取人物', exact=True).click()
        dialog = page.get_by_role('dialog')
        generate = dialog.get_by_role('button', name='保存并生成人物候选', exact=True)
        expect(generate).to_be_disabled()
        dialog.get_by_label('来源分集', exact=True).select_option('ep2')
        generate.click()
        assert page.evaluate("window.extractionQA.calls.filter(c=>c.method==='propose').length") == 0
        page.evaluate('window.extractionQA.failSave()')
        expect(dialog.get_by_role('alert')).to_contain_text('请求尚未发送')
        expect(generate).to_be_enabled()
        generate.evaluate('(el)=>{el.click();el.click()}')
        assert page.evaluate("window.extractionQA.calls.filter(c=>c.method==='propose').length") == 0
        page.evaluate('window.extractionQA.finishSave()')
        expect(dialog.get_by_text('身形清瘦的年轻旅人', exact=False).first).to_be_visible()
        calls = page.evaluate("window.extractionQA.calls.filter(c=>c.method==='propose')")
        assert len(calls) == 1 and calls[0]['input']['sourceEpisodeId'] == 'ep2' and calls[0]['input']['category'] == 'characters'
        assert calls[0]['input']['updatedAt'] == '2026-01-02T00:00:00Z'
        expect(dialog.get_by_text('不应出现在人物列表的铜钥匙', exact=False)).to_have_count(0)
        report['checks'].append('Explicit source; failed save and pending save send zero requests; double click sends exactly one; category isolated')
        apply = dialog.get_by_role('button', name='保存并入库 0 项', exact=True)
        expect(apply).to_be_disabled()
        dialog.get_by_label('选入库：阿青', exact=True).check()
        apply = dialog.get_by_role('button', name='保存并入库 1 项', exact=True)
        expect(apply).to_be_disabled()
        dialog.get_by_label('阿青入库方式', exact=True).select_option('existing')
        expect(apply).to_be_disabled()
        dialog.get_by_label('阿青复用目标', exact=True).select_option('existing-a')
        expect(apply).to_be_enabled()
        expect(dialog.get_by_text('人物不新增候选造型', exact=False)).to_be_visible()
        dialog.get_by_label('选入库：掌柜', exact=True).check()
        dialog.get_by_label('掌柜入库方式', exact=True).select_option('new')
        for width in [1600, 1040]:
            page.set_viewport_size({'width': width, 'height': 1040})
            box = dialog.bounding_box()
            assert box and box['x'] >= 0 and box['x'] + box['width'] <= width + 1
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.screenshot(path=str(OUT / f'offline-candidates-{width}.png'), full_page=True)
        dialog.get_by_role('button', name='关闭', exact=True).click()
        page.get_by_role('button', name='从剧本提取人物', exact=True).click()
        expect(dialog.get_by_label('选入库：阿青', exact=True)).to_be_checked()
        dialog.get_by_role('button', name='保存并入库 2 项', exact=True).evaluate('(el)=>{el.click();el.click()}')
        assert page.evaluate("window.extractionQA.calls.filter(c=>c.method==='apply').length") == 0
        page.evaluate('window.extractionQA.finishSave()')
        expect(dialog.get_by_role('alert')).to_contain_text('服务器明确未接受')
        expect(dialog.get_by_role('button', name='保存并入库 2 项', exact=True)).to_be_enabled()
        assert page.evaluate("window.extractionQA.calls.filter(c=>c.method==='apply').length") == 1
        dialog.get_by_role('button', name='保存并入库 2 项', exact=True).click()
        page.evaluate('window.extractionQA.finishSave()')
        expect(dialog.get_by_text('已入库 · 人物候选', exact=True)).to_be_visible()
        applies = page.evaluate("window.extractionQA.calls.filter(c=>c.method==='apply')")
        assert len(applies) == 2 and applies[0]['input'] == applies[1]['input'] and applies[0]['input']['selections'] == [{'key': 'a', 'mode': 'existing', 'existingId': 'existing-a'}, {'key': 'b', 'mode': 'new'}]
        report['checks'].append('Explicit existing target/new choice, no auto matching, empty apply blocked, reopen retains candidates; double click emits one apply; explicit busy rejection permits user-confirmed retry with identical input; 1600/1040 screenshots')
        page.reload()
        page.get_by_role('button', name='从剧本提取人物', exact=True).click()
        dialog.get_by_label('来源分集', exact=True).select_option('ep1')
        dialog.get_by_role('button', name='保存并生成人物候选', exact=True).click()
        page.evaluate('window.extractionQA.finishSave()')
        expect(dialog.get_by_label('选入库：阿青', exact=True)).to_be_visible()
        dialog.get_by_label('选入库：阿青', exact=True).check()
        dialog.get_by_label('阿青入库方式', exact=True).select_option('new')
        page.evaluate('window.extractionQA.staleApply()')
        dialog.get_by_role('button', name='保存并入库 1 项', exact=True).click()
        page.evaluate('window.extractionQA.finishSave()')
        expect(dialog.get_by_role('alert')).to_contain_text('候选已过期，请重新提取')
        expect(dialog.get_by_text('已过期 · 人物候选', exact=True)).to_be_visible()
        assert page.evaluate("window.extractionQA.calls.filter(c=>c.method==='refresh').length") == 0
        assert page.evaluate("sessionStorage.getItem('motion-comic-asset-extraction:extraction-offline:characters')") is None
        expect(dialog.get_by_role('button', name='保存并生成人物候选', exact=True)).to_be_enabled()
        dialog.get_by_role('button', name='保存并生成人物候选', exact=True).click()
        assert page.evaluate("window.extractionQA.calls.filter(c=>c.method==='propose').length") == 1
        page.evaluate('window.extractionQA.finishSave()')
        expect(dialog.get_by_text('待确认 · 人物候选', exact=True)).to_be_visible()
        assert page.evaluate("window.extractionQA.calls.filter(c=>c.method==='propose').length") == 2
        report['checks'].append('Stale apply clears receipt without success or refresh; old candidate disabled; explicit fresh extraction allowed only after save')
        page.reload()
        page.get_by_role('button', name='从剧本提取人物', exact=True).click()
        dialog.get_by_label('来源分集', exact=True).select_option('ep1')
        page.evaluate('window.extractionQA.unknown()')
        dialog.get_by_role('button', name='保存并生成人物候选', exact=True).click()
        page.evaluate('window.extractionQA.finishSave()')
        expect(dialog.get_by_role('alert')).to_contain_text('结果未知')
        dialog.get_by_role('button', name='读取服务器候选', exact=True).click()
        expect(dialog.get_by_role('button', name='保存并生成人物候选', exact=True)).to_be_disabled()
        assert page.evaluate("window.extractionQA.calls.filter(c=>c.method==='propose').length") == 1
        dialog.get_by_role('button', name='关闭', exact=True).click()
        page.get_by_role('button', name='从剧本提取人物', exact=True).click()
        expect(dialog.get_by_role('button', name='保存并生成人物候选', exact=True)).to_be_disabled()
        dialog.get_by_role('button', name='关闭', exact=True).click()
        page.get_by_role('button', name='切换项目', exact=True).click()
        page.get_by_role('button', name='从剧本提取人物', exact=True).click()
        dialog.get_by_label('来源分集', exact=True).select_option('ep1')
        expect(dialog.get_by_role('button', name='保存并生成人物候选', exact=True)).to_be_enabled()
        report['checks'].append('Unknown receipt survives reopen; read never re-dispatches; project isolation')
        assert not report['errors'], report['errors']
        browser.close()
finally:
    server.shutdown()
    (OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
