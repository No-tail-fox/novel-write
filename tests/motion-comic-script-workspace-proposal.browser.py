"""Real Workspace/Review/Proposal browser integration; NOT Electron IPC or real backend.
Run: C:/Users/foxnotail/AppData/Local/Programs/Python/Python313/python.exe tests/motion-comic-script-workspace-proposal.browser.py
Only loopback static assets are allowed; no LLM, paid request or authorization.
"""
import functools
import http.server
import json
from pathlib import Path
import subprocess
import threading
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts' / 'script-workspace-proposal-ui'
OUT.mkdir(parents=True, exist_ok=True)
subprocess.run(['node', '--input-type=module', '-e', "import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:'artifacts/script-workspace-proposal-ui',emptyOutDir:false,lib:{entry:'tests/motion-comic-script-workspace-proposal.harness.tsx',name:'workspaceProposalQA',formats:['iife'],fileName:()=> 'harness.js',cssFileName:'harness'}}});"], cwd=ROOT, check=True)
(OUT / 'index.html').write_text('<!doctype html><html data-theme="dark" data-theme-ready="true"><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><body><div id="root"></div><script src="harness.js"></script></body></html>', encoding='utf-8')
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
report = {'scope': 'Real MotionComicScriptWorkspace + Review + Proposal + draft/navigation hooks; local schema-validated mock StoryDreamApi. NOT Electron IPC, real store, auth or backend CAS.', 'checks': [], 'errors': [], 'blocked_external': [], 'status': 'running'}
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
        context = browser.new_context(viewport={'width': 1440, 'height': 1050})
        page = context.new_page()
        page.on('pageerror', lambda error: report['errors'].append(str(error)))
        def route_request(route):
            url = urlparse(route.request.url)
            if url.hostname == '127.0.0.1' and url.port == server.server_port:
                route.continue_()
            else:
                report['blocked_external'].append(route.request.url)
                route.abort()
        page.route('**/*', route_request)
        url = f'http://127.0.0.1:{server.server_port}'
        def start():
            page.goto(url)
            page.evaluate('localStorage.clear(); sessionStorage.clear()')
            page.reload()
            page.get_by_role('button', name='编辑第 1 条', exact=True).click()
            expect(page.get_by_label('剧情内容', exact=True)).to_have_value('查看来信')
            page.get_by_role('button', name='EP 01 · 门外来信', exact=False).click()
            page.get_by_role('button', name='编辑第 1 条', exact=True).click()
            expect(editor()).to_have_value('开门')
            page.get_by_label('这个段落的修改要求', exact=True).fill('加强悬念，保留原意')
        def editor(): return page.get_by_label('剧情内容', exact=True)
        def submit(): return page.get_by_role('button', name='生成单段候选', exact=True)
        def adopt(): return page.get_by_role('button', name='采用此段候选', exact=True)
        def revert(): return page.get_by_role('button', name='撤销此次采用', exact=True)
        def state(): return page.evaluate('window.workspaceFixture.state()')
        def calls(method): return page.evaluate('(method) => window.workspaceFixture.calls.filter(c => c.method === method)', method)
        def release(reject=False):
            page.wait_for_function('window.workspaceFixture.pending()')
            page.evaluate('window.workspaceFixture.reject()' if reject else 'window.workspaceFixture.release()')
        def propose():
            submit().click()
            expect(page.get_by_role('button', name='正在提交提案…')).to_be_disabled()
            expect(editor()).to_be_disabled()
            release()
            expect(adopt()).to_be_enabled()
        start()
        original = state()['originals']
        before = state()['candidates']
        propose()
        assert state()['candidates'] == before
        expect(editor()).to_have_value('开门')
        assert calls('propose')[0]['input']['taskId'] == 'task-0'
        assert calls('propose')[0]['input']['outputRevision'] == 3
        assert len(calls('withSavedProject')) == 1
        report['checks'].append('Select task-0 from task-1; propose uses saved project/revision; ready candidate leaves current script unchanged')
        page.screenshot(path=str(OUT / '01-ready.png'), full_page=True)
        editor().fill('未保存的本地草稿')
        expect(submit()).to_be_disabled(); expect(adopt()).to_be_disabled()
        assert len(calls('adopt')) == 0
        page.get_by_role('button', name='撤销本地修改', exact=True).click()
        expect(editor()).to_have_value('开门'); expect(adopt()).to_be_enabled()
        report['checks'].append('Real dirty editor disables generation and adoption; undo restores eligibility without API calls')
        adopt().click()
        expect(page.get_by_role('button', name='正在采用…')).to_be_disabled()
        expect(editor()).to_be_disabled()
        release()
        expect(editor()).to_have_value('缓缓推开门')
        expect(page.locator('.comic-script-proposal')).to_contain_text('当前基准 r4')
        expect(page.get_by_role('button', name='保存修改并校验', exact=True)).to_be_disabled()
        expect(page.get_by_role('button', name='撤销本地修改', exact=True)).to_be_disabled()
        assert state()['candidates'][0]['outputRevision'] == 4
        assert state()['tasks'][0]['outputRevision'] == 4
        assert state()['originals'] == original
        saved = page.locator('details').filter(has=page.locator('summary', has_text='查看已保存剧情'))
        original_view = page.locator('details').filter(has=page.locator('summary', has_text='首次生成原稿'))
        saved.locator('summary').click(); original_view.locator('summary').click()
        expect(saved).to_contain_text('缓缓推开门'); expect(original_view).to_contain_text('开门')
        assert '缓缓推开门' not in original_view.inner_text()
        editor().fill('r4 上的本地修改')
        page.get_by_role('button', name='撤销本地修改', exact=True).click()
        expect(editor()).to_have_value('缓缓推开门')
        report['checks'].append('Adopt r3→r4 hydrates editor AND history baseline, saved read-only view; original immutable; undo uses r4')
        page.screenshot(path=str(OUT / '02-adopted-r4.png'), full_page=True)
        expect(revert()).to_be_enabled()
        editor().fill('撤销前未保存草稿')
        expect(revert()).to_be_disabled(); assert not calls('revert')
        page.get_by_role('button', name='撤销本地修改', exact=True).click()
        # Two same-tick clicks must issue exactly one write.
        revert().evaluate('(button) => { button.click(); button.click(); }')
        expect(page.get_by_role('button', name='正在撤销采用…')).to_be_disabled()
        expect(editor()).to_be_disabled()
        receipt = page.evaluate("JSON.parse(sessionStorage.getItem('comic-script-proposal-pending:offline-workspace:task-0'))")
        assert receipt['kind'] == 'revert' and receipt['proposalId'] == state()['proposals'][0]['id']
        assert len(calls('revert')) == 1
        release()
        expect(editor()).to_have_value('开门')
        expect(page.locator('.comic-script-proposal')).to_contain_text('当前基准 r5')
        expect(page.locator('.comic-script-proposal')).to_contain_text('已撤销采用')
        expect(page.locator('.comic-script-proposal')).to_contain_text('重新审阅')
        expect(page.get_by_role('button', name='保存修改并校验', exact=True)).to_be_disabled()
        expect(page.get_by_role('button', name='撤销本地修改', exact=True)).to_be_disabled()
        assert state()['originals'] == original and state()['candidates'][0]['outputRevision'] == 5
        assert state()['proposals'][0]['revertedRevision'] == 5
        assert calls('revert')[0]['input']['outputRevision'] == 4
        editor().fill('r5 本地稿'); page.get_by_role('button', name='撤销本地修改', exact=True).click()
        expect(editor()).to_have_value('开门')
        report['checks'].append('Revert r4→r5 restores text, immutable original, fresh history baseline/review; dirty disabled; same-tick duplicate emits exactly one request and typed prewrite receipt')
        page.screenshot(path=str(OUT / '05-reverted-r5.png'), full_page=True)
        # Later server edits and missing legacy hash disallow revert.
        start(); propose(); adopt().click(); release(); expect(revert()).to_be_enabled()
        page.evaluate('window.workspaceFixture.loseHash()')
        expect(revert()).to_be_disabled(timeout=7000)
        expect(page.locator('.comic-script-proposal')).to_contain_text('缺少采用时的校验信息')
        assert not calls('revert')
        start(); propose(); adopt().click(); release(); expect(revert()).to_be_enabled()
        page.evaluate('window.workspaceFixture.advance()')
        expect(page.get_by_role('button', name='载入当前版本并放弃本地改动')).to_be_visible(timeout=7000)
        page.get_by_role('button', name='载入当前版本并放弃本地改动').click()
        expect(revert()).to_be_disabled()
        expect(page.locator('.comic-script-proposal')).to_contain_text('采用后已有后续版本')
        assert not calls('revert')
        report['checks'].append('Revert disabled for missing applied hash, server revision conflict and later saved revision')
        # Failed/unknown revert must not use the old applied status to unlock.
        start(); propose(); adopt().click(); release(); expect(revert()).to_be_enabled()
        revert().click(); release(True)
        expect(editor()).to_have_value('缓缓推开门')
        expect(revert()).to_be_disabled()
        editor().fill('未知撤销后的本地草稿')
        page.get_by_role('button', name='读取服务器状态并核对').click()
        expect(page.locator('.comic-script-proposal')).to_contain_text('保持锁定')
        assert page.evaluate("sessionStorage.getItem('comic-script-proposal-pending:offline-workspace:task-0')")
        assert state()['proposals'][0]['status'] == 'applied' and len(calls('revert')) == 1
        expect(editor()).to_have_value('未知撤销后的本地草稿')
        # Remount retains receipt and draft; read-only confirmation of reverted clears receipt only.
        page.get_by_role('button', name='EP 02 · 第二集', exact=False).click()
        page.get_by_role('button', name='EP 01 · 门外来信', exact=False).click()
        page.get_by_role('button', name='编辑第 1 条', exact=True).click()
        expect(editor()).to_have_value('未知撤销后的本地草稿'); expect(revert()).to_be_disabled()
        page.evaluate('window.workspaceFixture.confirmRevert()')
        page.get_by_role('button', name='读取服务器状态并核对').click()
        expect(page.get_by_role('button', name='读取服务器状态并核对')).to_have_count(0)
        expect(editor()).to_have_value('未知撤销后的本地草稿')
        assert len(calls('revert')) == 1 and state()['originals'] == original
        assert not page.evaluate("sessionStorage.getItem('comic-script-proposal-pending:offline-workspace:task-0')")
        report['checks'].append('Unknown revert remains locked on applied, survives task remount, never retries; reverted read-only confirmation preserves dirty draft')
        # Legacy id-only adoption receipts reconcile safely; unknown intents remain locked.
        start(); propose(); adopt().click(); release(); expect(revert()).to_be_enabled()
        page.evaluate("sessionStorage.setItem('comic-script-proposal-pending:offline-workspace:task-0', JSON.stringify({kind: window.workspaceFixture.state().proposals[0].id}))")
        page.get_by_role('button', name='EP 02 · 第二集', exact=False).click()
        page.get_by_role('button', name='EP 01 · 门外来信', exact=False).click()
        expect(revert()).to_be_disabled()
        page.get_by_role('button', name='读取服务器状态并核对').click()
        expect(revert()).to_be_enabled()
        page.evaluate("sessionStorage.setItem('comic-script-proposal-pending:offline-workspace:task-0', JSON.stringify({kind: 'unknown-intent', proposalId: window.workspaceFixture.state().proposals[0].id}))")
        page.get_by_role('button', name='EP 02 · 第二集', exact=False).click()
        page.get_by_role('button', name='EP 01 · 门外来信', exact=False).click()
        page.get_by_role('button', name='读取服务器状态并核对').click()
        expect(page.locator('.comic-script-proposal')).to_contain_text('保持锁定')
        expect(revert()).to_be_disabled(); assert not calls('revert')
        report['checks'].append('Legacy id-only adopt receipt safely reconciles applied; unknown explicit receipt intent remains locked')
        # A late ready response built from an older revision is not adoptable.
        start(); page.evaluate('window.workspaceFixture.stale()'); submit().click(); release()
        expect(page.locator('.comic-script-proposal')).to_contain_text('基准版本已变化')
        expect(adopt()).to_be_disabled(); assert not calls('adopt')
        report['checks'].append('Late ready candidate with obsolete baseRevision rejected by real UI adoption guard')
        page.screenshot(path=str(OUT / '03-late-stale.png'), full_page=True)
        page.evaluate('window.workspaceFixture.markStale()')
        expect(page.locator('.comic-script-proposal')).to_contain_text('此候选已过期，不能采用。', timeout=7000)
        expect(adopt()).to_be_disabled(); assert not calls('adopt')
        report['checks'].append('Polling schema-valid stale status also disables adoption without write calls')
        # In-flight proposal may resolve while another task has a draft: do not clobber it.
        start(); submit().click()
        page.get_by_role('button', name='EP 02 · 第二集', exact=False).click()
        expect(page.get_by_role('button', name='编辑第 1 条剧情', exact=True)).to_contain_text('查看来信')
        expect(page.get_by_role('button', name='编辑第 1 条', exact=True)).to_be_disabled()
        release(True)
        page.get_by_role('button', name='编辑第 1 条', exact=True).click()
        expect(editor()).to_be_enabled(); editor().fill('第二集保留草稿')
        page.get_by_role('button', name='EP 01 · 门外来信', exact=False).click()
        expect(page.locator('.comic-script-proposal')).to_contain_text('上次请求结果未明')
        expect(submit()).to_be_disabled()
        page.get_by_role('button', name='EP 02 · 第二集', exact=False).click()
        page.get_by_role('button', name='编辑第 1 条', exact=True).click()
        expect(editor()).to_have_value('第二集保留草稿')
        assert len(calls('propose')) == 1
        report['checks'].append('Pending proposal locks editor; rejected response after task switch does not lose task-scoped draft; uncertain receipt locks original task')
        # Actual dirty draft save rejection: remains both in editor and local storage.
        page.get_by_role('button', name='保存修改并校验', exact=True).click()
        expect(editor()).to_be_disabled(); expect(editor()).to_have_value('第二集保留草稿')
        release(True)
        expect(editor()).to_be_enabled(); expect(editor()).to_have_value('第二集保留草稿')
        assert '第二集保留草稿' in page.evaluate('JSON.stringify(localStorage)')
        expect(submit()).to_be_disabled()
        report['checks'].append('Dirty draft survives pending/rejected edit request in editor and localStorage; generation stays disabled')
        page.screenshot(path=str(OUT / '04-rejected-draft.png'), full_page=True)
        # Adoption rejection must keep the saved editor and original, with no automatic retry.
        start(); propose(); adopt().click(); release(True)
        expect(page.locator('.comic-script-proposal')).to_contain_text('不会自动重发')
        expect(editor()).to_have_value('开门'); expect(adopt()).to_be_disabled()
        assert state()['candidates'][0]['outputRevision'] == 3
        assert state()['originals'] == original
        assert len(calls('adopt')) == 1
        report['checks'].append('Rejected adoption keeps current r3 and original, locks uncertain request and never automatically retries')
        assert not report['errors'], report['errors']
        assert not report['blocked_external'], report['blocked_external']
        report['status'] = 'passed'
        browser.close()
except Exception as error:
    report['status'] = 'failed'; report['failure'] = str(error)
    try: page.screenshot(path=str(OUT / 'failure.png'), full_page=True)
    except Exception: pass
    raise
finally:
    server.shutdown()
    (OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
