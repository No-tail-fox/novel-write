"""Exercise retry controls in the actual workspace with isolated, local callbacks."""
from pathlib import Path
import functools, http.server, json, subprocess, threading
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.artifacts/director-retry-qa'
OUT.mkdir(parents=True, exist_ok=True)
subprocess.run(['I:/nodejs/node.exe', 'node_modules/tsx/dist/cli.mjs', 'scripts/qa-director-retry.ts'], cwd=ROOT, check=True)
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}'
report = {'checks': [], 'errors': [], 'paidCalls': 0}
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
        page = browser.new_page(viewport={'width': 1536, 'height': 1024})
        page.on('pageerror', lambda error: report['errors'].append(str(error)))

        def open_page(scenario='single'):
            page.goto(base + '/?scenario=' + scenario)
            page.wait_for_function('window.retryQA')
            toggle = page.get_by_role('button', name='显示镜头检查器', exact=True)
            if toggle.is_visible() and toggle.get_attribute('aria-expanded') == 'false':
                toggle.click()

        open_page()
        page.get_by_role('button', name='重试视频', exact=True).click()
        page.wait_for_function('retryQA.calls.length === 1 && document.querySelector("[data-job-id=attempt-1].is-completed")')
        assert page.evaluate('retryQA.calls') == ['shot-video']
        page.get_by_role('button', name='重试旁白', exact=True).click()
        page.wait_for_function('retryQA.calls.length === 2 && document.querySelector("[data-job-id=attempt-2].is-completed")')
        assert page.evaluate('retryQA.calls') == ['shot-video', 'shot-voice']
        report['checks'].append('video and voice retry dispatch only their own capability')
        page.get_by_role('button', name='重试合成', exact=True).click()
        expect(page.locator('.director-header-message')).to_contain_text('缺少透明主体', timeout=10000)
        assert page.evaluate('retryQA.calls') == ['shot-video', 'shot-voice', 'project-render']
        report['checks'].append('render retry reports missing materials and never generates images')
        page.get_by_role('button', name='查看补齐计划', exact=True).click()
        missing_plan = page.get_by_role('dialog', name='批量生成计划', exact=True)
        expect(missing_plan).to_be_visible()
        assert page.evaluate('retryQA.calls.length') == 3
        missing_plan.get_by_role('button', name='取消', exact=True).click()
        page.evaluate('retryQA.disconnectVideo()')
        page.get_by_role('button', name='重试视频', exact=True).click()
        expect(page.locator('.director-header-message')).to_contain_text('视频服务已离线')
        assert page.evaluate('retryQA.calls.length') == 3
        report['checks'].append('blocked retry explains unavailable video provider without a request')

        for theme in ['dark', 'light']:
            page.evaluate('(theme) => retryQA.setTheme(theme)', theme)
            for width, height in [(1536, 1024), (1040, 720)]:
                page.set_viewport_size({'width': width, 'height': height})
                toggle = page.get_by_role('button', name='显示镜头检查器', exact=True)
                if toggle.is_visible() and toggle.get_attribute('aria-expanded') == 'false':
                    toggle.click()
                page.locator('[data-job-id="job-project-render"]').scroll_into_view_if_needed()
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                page.screenshot(path=str(OUT / f'queue-{theme}-{width}.png'))

        page.set_viewport_size({'width': 1536, 'height': 1024})
        open_page('missing')
        page.get_by_role('button', name='查看补齐计划', exact=True).click()
        missing_plan = page.get_by_role('dialog', name='批量生成计划', exact=True)
        expect(missing_plan).to_be_visible()
        assert page.evaluate('retryQA.calls') == []
        page.screenshot(path=str(OUT / 'missing-materials-plan.png'))
        missing_plan.get_by_role('button', name='取消', exact=True).click()
        report['checks'].append('persisted render preflight failure opens missing-material plan without submitting requests')
        open_page('batch')
        page.get_by_role('button', name='批量生成', exact=True).click()
        dialog = page.get_by_role('dialog', name='批量生成计划', exact=True)
        dialog.get_by_role('button', name='开始批量生成', exact=True).click()
        expect(page.get_by_role('button', name='重试失败项', exact=True)).to_be_visible(timeout=10000)
        assert page.evaluate('retryQA.calls') == ['shot-video']
        page.evaluate('retryQA.disconnectUnrelated()')
        page.get_by_role('button', name='重试失败项', exact=True).click()
        expect(page.locator('.director-batch-node.is-completed')).to_have_count(2, timeout=10000)
        assert page.evaluate('retryQA.calls') == ['shot-video', 'shot-video', 'project-render']
        report['checks'].append('batch retry executes failed video and skipped render with image and voice services offline')
        page.locator('.director-batch-run').scroll_into_view_if_needed()
        page.screenshot(path=str(OUT / 'batch-retried.png'))
        assert not report['errors'], report['errors']
        report['status'] = 'passed'
        browser.close()
finally:
    server.shutdown()
    (OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
