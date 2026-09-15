"""Book-source UI regression with captured live responses and isolated real storage.

Setup: npm exec -- tsx scripts/qa-book-sources-live.ts
Build: npm run build
Run: vendor/python/python.exe scripts/qa-book-sources.py
Replays the captured responses; real source checks run separately in the setup.
"""
from __future__ import annotations
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import traceback
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/book-sources'
spec = importlib.util.spec_from_file_location('book_qa_base', ROOT / 'scripts/qa-director-desk.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix='profile-', dir=OUTPUT))
    env = {**os.environ, 'NODE_ENV': 'production', 'STORYDREAM_PROJECT_QA_DIR': str(profile)}
    for key in ['NODE_OPTIONS', 'VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE']:
        env.pop(key, None)
    report = {'status': 'running', 'profile': str(profile), 'checks': [], 'captures': [], 'runtimeErrors': []}
    process = None

    def controls(**values):
        (profile / 'controls.json').write_text(json.dumps(values), encoding='utf-8')

    def ledger():
        return json.loads((profile / 'ledger.json').read_text(encoding='utf-8'))

    def ready():
        expect(page.get_by_role('button', name='搜索图书', exact=True)).to_be_enabled(timeout=15000)

    def capture(name):
        metrics = page.evaluate('''() => {
          const table=document.querySelector('.selection-ranking-table').getBoundingClientRect();
          const body=document.querySelector('.selection-ranking-body');
          const filter=document.querySelector('.selection-filter-panel').getBoundingClientRect();
          const search=document.querySelector('.selection-search-suggestion')?.getBoundingClientRect();
          return {width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+1,
            table:{top:table.top,bottom:table.bottom,height:table.height},filterBottom:filter.bottom,
            suggestionBottom:search?.bottom,bodyHeight:body.clientHeight,bodyOverflow:body.scrollWidth>body.clientWidth+1};
        }''')
        path = OUTPUT / f'{name}.png'
        page.screenshot(path=path, animations='disabled')
        report['captures'].append({'file': str(path), **metrics})
        assert not metrics['overflow'], metrics
        assert metrics['table']['height'] > 110, metrics
        assert metrics['table']['top'] >= metrics['filterBottom'] - 1, metrics
        assert metrics['table']['bottom'] <= metrics['height'], metrics

    try:
        with sync_playwright() as pw:
            port = base.free_port()
            with (OUTPUT / 'electron.log').open('wb') as log:
                process = subprocess.Popen([str(base.ELECTRON), f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1', f'--user-data-dir={profile}', str(ROOT / 'scripts/qa-book-sources.cjs')], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
            browser = pw.chromium.connect_over_cdp(base.wait_cdp(port, process))
            deadline = time.monotonic() + 30
            while not browser.contexts[0].pages and time.monotonic() < deadline:
                time.sleep(.1)
            page = browser.contexts[0].pages[0]
            page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
            base.wait_app(page)
            base.set_size(page, 1440, 900)
            if page.get_by_role('button', name='切换浅色主题', exact=True).count():
                page.get_by_role('button', name='切换浅色主题', exact=True).click()
            page.locator('.nav-list [data-nav-view="hot-board"][data-nav-level="primary"]').click()
            page.locator('.nav-list [data-nav-view="book-selection"]').click()
            ready()
            sources = page.get_by_role('group', name='搜索来源', exact=True)
            expect(sources.get_by_role('checkbox', checked=True)).to_have_count(3)
            page.get_by_label('书名、作者或选书主题', exact=True).fill('经营')
            page.get_by_label('书名、作者或选书主题', exact=True).press('Enter')
            expect(page.get_by_role('button', name='搜索图书', exact=True)).to_be_disabled()
            expect(sources.get_by_role('checkbox').first).to_be_disabled()
            ready()
            expect(page.locator('.selection-ranking-row')).to_have_count(24)
            assert ledger()['searches'][-1] == {'query': '经营', 'track': '全部图书', 'limit': 24, 'sources': ['dangdang', 'weread', 'douban']}
            capture('books-1440')
            base.set_size(page, 1040, 720)
            capture('books-1040')
            page.get_by_label('筛选当前结果', exact=True).fill('小狗钱钱')
            expect(page.get_by_text('当前筛选没有匹配图书', exact=True)).to_be_visible()
            capture('filter-empty-1040')
            page.get_by_role('button', name='跨来源搜索此书', exact=True).click()
            ready()
            expect(page.get_by_label('筛选当前结果', exact=True)).to_have_value('')
            expect(page.get_by_label('书名、作者或选书主题', exact=True)).to_have_value('小狗钱钱')
            expect(page.locator('.selection-ranking-row')).to_have_count(24)
            report['checks'].append('Enter submits once; loading disables sources; cross-source search clears the local filter')
            base.set_size(page, 1440, 900)
            sources.get_by_role('checkbox', name='当当', exact=True).uncheck()
            sources.get_by_role('checkbox', name='豆瓣', exact=True).uncheck()
            expect(sources.get_by_role('checkbox', name='微信读书', exact=True)).to_be_disabled()
            page.get_by_role('button', name='搜索图书', exact=True).click()
            ready()
            assert ledger()['searches'][-1]['sources'] == ['weread']
            expect(page.locator('.selection-source-results')).not_to_contain_text('当当')
            first = page.locator('.selection-ranking-row').first
            title = first.locator('.selection-book-title strong').inner_text()
            first.get_by_role('button', name=f'收藏 {title}', exact=True).click()
            expect(first.get_by_role('button', name=f'取消收藏 {title}', exact=True)).to_be_enabled()
            saved = page.evaluate('async () => window.storydream.listBookSelections()')
            assert len(saved) == 1 and saved[0]['data']['source'] == 'weread', saved
            assert saved[0]['data']['url'].startswith('https://weread.qq.com/'), saved
            first.get_by_role('button', name=f'加入对比 {title}', exact=True).click()
            page.get_by_role('tab', name='对比台 1/4', exact=True).click()
            expect(page.locator('.selection-comparison-table')).to_contain_text(title)
            page.get_by_role('tab', name='图书搜索结果', exact=True).click()
            report['checks'].append('Source selection reaches IPC; new-source favorite uses real storage; compare retains the book')
            # Reload to verify the saved book survives a renderer restart.
            base.reload_app(page)
            page.locator('.nav-list [data-nav-view="hot-board"][data-nav-level="primary"]').click()
            page.locator('.nav-list [data-nav-view="book-selection"]').click()
            ready()
            page.get_by_role('button', name='已存书单 (1)', exact=True).click()
            expect(page.locator('.selection-ranking-row')).to_have_count(1)
            expect(page.locator('.selection-ranking-row')).to_contain_text(title)
            page.get_by_label('带货潜力', exact=True).select_option('very-high')
            page.get_by_label('创作状态', exact=True).select_option('rejected')
            page.get_by_label('筛选当前结果', exact=True).fill('经营')
            page.get_by_role('button', name='跨来源搜索“经营”', exact=True).click()
            ready()
            expect(page.get_by_label('带货潜力', exact=True)).to_have_value('all')
            expect(page.get_by_label('创作状态', exact=True)).to_have_value('all')
            expect(page.get_by_role('checkbox', name='只看收藏', exact=True)).not_to_be_checked()
            expect(page.locator('.selection-ranking-row')).to_have_count(24)
            controls(failSource='dangdang')
            page.get_by_role('button', name='搜索图书', exact=True).click()
            ready()
            expect(page.locator('.selection-source-results')).to_contain_text('当当 · 暂不可用')
            assert page.locator('.selection-ranking-row').count() > 0
            capture('partial-outage-1440')
            controls(empty=True)
            page.get_by_role('button', name='搜索图书', exact=True).click()
            ready()
            expect(page.get_by_text('这些来源暂无匹配图书', exact=True)).to_be_visible()
            controls(failed=True)
            page.get_by_role('button', name='搜索图书', exact=True).click()
            ready()
            expect(page.get_by_text('所选来源暂时不可用', exact=True)).to_be_visible()
            capture('all-sources-failed-1440')
            controls()
            page.get_by_role('button', name='重新搜索', exact=True).click()
            ready()
            expect(page.locator('.selection-ranking-row')).to_have_count(24)
            page.get_by_role('button', name='切换深色主题', exact=True).click()
            base.set_size(page, 1040, 720)
            capture('books-dark-1040')
            report['checks'].append('Saved books survive reload; cross-source search resets stale filters; partial/empty/failed sources are distinct and retry recovers')
            base.set_size(page, 1440, 900)
            chosen = page.locator('.selection-ranking-row').filter(has_text='微信读书搜索第 1 位').first
            chosen_title = chosen.locator('.selection-book-title strong').inner_text()
            # Observe the existing transfer before NewTaskPage consumes it.
            page.evaluate('''() => {
              const original=Storage.prototype.setItem;
              Storage.prototype.setItem=function(key,value) {
                if(this===sessionStorage && key==='book_product_info') window.__bookHandoff=JSON.parse(value);
                return original.call(this,key,value);
              };
            }''')
            chosen.get_by_role('button', name='去创作', exact=True).click()
            expect(page.locator('.app-shell')).to_have_attribute('data-shell-view', 'new-task')
            page.locator('[data-new-task-stage-tab="creative"]').click()
            page.wait_for_function('title => [...document.querySelectorAll("input")].some(input => input.value === title)', arg=chosen_title)
            handoff = page.evaluate('() => window.__bookHandoff')
            assert handoff['source'] == 'weread' and handoff['name'] == chosen_title, handoff
            assert handoff['url'].startswith('https://weread.qq.com/')
            report['checks'].append('Creation handoff retains source and URL and pre-fills the actual new-task form')
            assert not report['runtimeErrors'], report['runtimeErrors']
            assert ledger()['blockedGeneration'] == 0
            report['status'] = 'passed'
    except Exception:
        report['status'] = 'failed'
        report['error'] = traceback.format_exc()
        raise
    finally:
        (OUTPUT / 'ui-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        if process and process.poll() is None:
            process.kill()
            process.wait(timeout=10)


if __name__ == '__main__':
    main()
