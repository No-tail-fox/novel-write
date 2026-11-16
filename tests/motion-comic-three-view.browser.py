import functools, http.server, json, subprocess, threading
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts' / 'motion-comic-three-view'
OUT.mkdir(parents=True, exist_ok=True)
subprocess.run(['node', '--input-type=module', '-e', "import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:'artifacts/motion-comic-three-view',emptyOutDir:false,lib:{entry:'tests/motion-comic-three-view.harness.tsx',name:'threeViewQA',formats:['iife'],fileName:()=> 'harness.js',cssFileName:'harness'}}});"], cwd=ROOT, check=True)
(OUT / 'index.html').write_text('<!doctype html><html data-theme="dark"><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><body><div id="root"></div><script src="harness.js"></script></body></html>', encoding='utf-8')
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
errors = []
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
        page = browser.new_page(viewport={'width': 1428, 'height': 1000})
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(f'http://127.0.0.1:{server.server_port}')
        expect(page.locator('.comic-reference-slot.is-empty')).to_have_count(3)
        expect(page.get_by_role('button', name='上传参考图（可多选）')).to_have_count(0)
        page.screenshot(path=str(OUT / 'empty-1428.png'), full_page=True)
        page.get_by_role('button', name='模拟生成状态').click()
        expect(page.get_by_role('status').filter(has_text='正在生成三视图')).to_be_visible()
        page.get_by_role('tab', name='战斗', exact=True).click()
        expect(page.get_by_role('heading', name='战斗造型')).to_be_visible()
        page.get_by_label('生图提示词').fill('仍然可以编辑提示词')
        page.get_by_role('button', name='删除生图参考图 1').click()
        expect(page.get_by_alt_text('生图输入参考图 1')).to_have_count(0)
        page.get_by_role('button', name='显示候选').click()
        for role in ['正面', '侧面', '背面']:
            column = page.get_by_role('listitem', name=role + '视图', exact=True)
            expect(column.locator('.comic-reference-candidate')).to_have_count(1)
            expect(column.get_by_role('button', name='固定为' + role, exact=True)).to_be_enabled()
        page.get_by_role('button', name='固定为正面', exact=True).click()
        page.get_by_role('checkbox').check()
        page.get_by_role('button', name='确认固定为正面', exact=True).click()
        expect(page.get_by_role('button', name='移除正面参考图', exact=True)).to_be_visible()
        page.screenshot(path=str(OUT / 'candidates-1428.png'), full_page=True)
        page.set_viewport_size({'width': 900, 'height': 900})
        page.screenshot(path=str(OUT / 'candidates-900.png'), full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
        page.get_by_role('button', name='移除正面参考图', exact=True).click()
        page.get_by_role('button', name='移除出列表', exact=True).click()
        expect(page.get_by_role('listitem', name='正面视图', exact=True).locator('.comic-reference-slot.is-empty')).to_have_count(1)
        assert not errors, errors
        browser.close()
    (OUT / 'report.json').write_text(json.dumps({'checks': ['three persistent empty slots', 'role candidate grouping', 'pending generation permits tabs/prompt/input deletion', 'review and pinned removal', 'normal/compact screenshots and no horizontal overflow'], 'errors': errors}, ensure_ascii=False, indent=2), encoding='utf-8')
finally:
    server.shutdown()
