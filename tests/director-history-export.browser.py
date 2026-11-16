"""Real Workspace history export contract; local route fulfillment, no server/provider."""
from __future__ import annotations
import json
import os
from pathlib import Path
import subprocess
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'tests/qa-history-export-output'

def run():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    subprocess.run(['I:/nodejs/node.exe', '--input-type=module', '-e',
        "import {build} from 'esbuild'; await build({entryPoints:['tests/director-history-export.harness.tsx'],bundle:true,outfile:process.argv[1],format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':JSON.stringify('production')},loader:{'.woff2':'dataurl','.woff':'dataurl','.ttf':'dataurl','.svg':'dataurl','.png':'dataurl'}});",
        str(OUTPUT / 'harness.js')], cwd=ROOT, check=True)
    checks, errors, external = [], [], []
    html = '<!doctype html><html data-theme="dark" data-theme-ready="true"><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><body><div id="root"></div><script src="harness.js"></script></body></html>'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path=os.environ.get('STORYDREAM_QA_BROWSER', 'C:/Program Files/Google/Chrome/Application/chrome.exe'))
        try:
            page = browser.new_page(viewport={'width':1040, 'height':720})
            page.on('pageerror', lambda error: errors.append(str(error)))
            def route_request(route):
                url = route.request.url
                if url == 'http://history-qa.local/': route.fulfill(body=html, content_type='text/html')
                elif url == 'http://history-qa.local/harness.js': route.fulfill(path=str(OUTPUT / 'harness.js'), content_type='text/javascript')
                elif url == 'http://history-qa.local/harness.css': route.fulfill(path=str(OUTPUT / 'harness.css'), content_type='text/css')
                else:
                    external.append(url)
                    route.abort()
            page.route('**/*', route_request)
            page.goto('http://history-qa.local/')
            page.get_by_role('button', name='成片历史', exact=True).click()
            dialog = page.get_by_role('dialog', name='成片历史')
            expect(dialog).to_be_visible()
            version = dialog.get_by_role('combobox', name='成片版本', exact=True)
            save = dialog.get_by_role('button', name='另存此版本', exact=True)
            success = dialog.get_by_text('此版本已另存。', exact=True)
            failure = dialog.get_by_text('QA export destination unavailable', exact=True)
            a, b = 'asset-history-A-exact', 'asset-history-B-exact'
            def requests(): return page.evaluate('window.historyExportQA.requests')
            def release(value):
                page.evaluate('(value) => window.historyExportQA.release(value)', value)
                expect(save).to_be_enabled()
            for expected_id in [a,b]:
                version.select_option(expected_id)
                save.click()
                assert requests()[-1] == expected_id
                expect(dialog.get_by_role('button', name='正在另存…')).to_be_disabled()
                release(True)
                expect(success).to_be_visible()
            checks.append('Both history selections deliver exact assetVersionId and show success')
            save.click()
            expect(success).to_have_count(0)
            release(False)
            expect(success).to_have_count(0)
            expect(failure).to_have_count(0)
            checks.append('false cancellation clears prior success and produces no success/error')
            save.click()
            page.evaluate('window.historyExportQA.fail()')
            expect(failure).to_be_visible()
            expect(save).to_be_enabled()
            page.screenshot(path=str(OUTPUT / 'error-retry-1040.png'))
            save.click()
            expect(failure).to_have_count(0)
            release(True)
            expect(success).to_be_visible()
            checks.append('throw displays original error; retry clears error and succeeds')
            before = len(requests())
            save.dblclick()
            assert len(requests()) == before + 1
            assert page.evaluate('window.historyExportQA.pending.length') == 1
            release(False)
            # Same-turn DOM clicks additionally exercise the synchronous lock.
            before = len(requests())
            save.evaluate('(button) => { button.click(); button.click(); }')
            assert len(requests()) == before + 1
            release(False)
            checks.append('native doubleclick and same-turn double click each issue one callback')
            for outcome in ['success', 'error', 'cancel']:
                version.select_option(a)
                save.click()
                version.select_option(b)
                expect(version).to_have_value(b)
                expect(dialog.get_by_role('button', name='正在另存…')).to_be_disabled()
                assert requests()[-1] == a
                if outcome == 'error':
                    page.evaluate('window.historyExportQA.fail()')
                    expect(save).to_be_enabled()
                else: release(outcome == 'success')
                expect(success).to_have_count(0)
                expect(failure).to_have_count(0)
                if outcome == 'success': page.screenshot(path=str(OUTPUT / 'switched-version-1040.png'))
                version.select_option(a)
                if outcome == 'success': expect(success).to_be_visible()
                elif outcome == 'error': expect(failure).to_be_visible()
                else:
                    expect(success).to_have_count(0)
                    expect(failure).to_have_count(0)
                checks.append(f'pending A -> B {outcome}: no feedback leaks to B; A owns result')
            assert not errors, errors
            assert not external, external
            assert page.evaluate('window.historyExportQA.pending.length') == 0
            report = {'checks':checks, 'requests':requests(), 'pageErrors':errors, 'externalRequests':external, 'viewport':{'width':1040,'height':720}, 'productionModified':False}
            (OUTPUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
            print(json.dumps(report, ensure_ascii=False, indent=2))
        finally: browser.close()

if __name__ == '__main__': run()
