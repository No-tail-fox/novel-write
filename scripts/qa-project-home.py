"""Project management through production Electron, IPC and an isolated 500-task DB."""
from __future__ import annotations

import importlib.util
from contextlib import nullcontext
import json
import os
import shutil
from pathlib import Path
import subprocess
import tempfile
import time
import traceback

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/storydream-web-redesign/r2-project-home-20260912'
spec = importlib.util.spec_from_file_location('project_qa_base', ROOT / 'scripts/qa-director-desk.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix='profile-', dir=OUTPUT))
    env = {**os.environ, 'NODE_ENV': 'production', 'STORYDREAM_PROJECT_QA_DIR': str(profile), 'PYTHONIOENCODING': 'utf-8'}
    for key in ['NODE_OPTIONS', 'VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE']:
        env.pop(key, None)
    fixture = OUTPUT / 'fixture'
    if not (fixture / 'seed.json').exists():
        subprocess.run(['node', str(ROOT / 'node_modules/tsx/dist/cli.mjs'), str(ROOT / 'scripts/qa-project-home-seed.ts'), str(fixture)], cwd=ROOT, env=env, check=True)
    shutil.copytree(fixture, profile, dirs_exist_ok=True)
    report = {'status': 'running', 'checks': [], 'captures': [], 'runtimeErrors': [], 'profile': str(profile)}
    report['database'] = json.loads((profile / 'seed.json').read_text(encoding='utf-8'))
    process = browser = page = playwright = None

    def controls(**values):
        (profile / 'controls.json').write_text(json.dumps(values), encoding='utf-8')

    def ledger():
        return json.loads((profile / 'ledger.json').read_text(encoding='utf-8'))

    def passed(label):
        report['checks'].append(label)
        print(label, flush=True)

    def wait_list_count(count):
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if len(ledger()['lists']) >= count:
                return
            page.wait_for_timeout(100)
        raise AssertionError('List request did not arrive')

    def ready():
        expect(page.locator('[aria-label="项目分页"] [aria-label="重新加载"]')).to_be_enabled(timeout=20000)

    def launch(playwright):
        port = base.free_port()
        with (OUTPUT / 'electron.log').open('ab') as log:
            child = subprocess.Popen([str(base.ELECTRON), f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1', f'--user-data-dir={profile}', str(ROOT / 'scripts/qa-project-home.cjs')], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            connected = playwright.chromium.connect_over_cdp(base.wait_cdp(port, child))
            deadline = time.monotonic() + 30
            while not connected.contexts[0].pages and time.monotonic() < deadline:
                time.sleep(.1)
            current = connected.contexts[0].pages[0]
            current.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
            base.wait_app(current)
            current.wait_for_selector('[data-project-home]')
            return child, connected, current
        except Exception:
            child.kill()
            child.wait(timeout=10)
            raise

    def capture(name, width, height):
        base.set_size(page, width, height)
        page.locator('.project-home').evaluate('(node) => node.closest(".content-area")?.scrollTo(0, 0)')
        metrics = page.evaluate('''() => {
          const boxes = [...document.querySelectorAll('.project-card')].map(n => n.getBoundingClientRect());
          const badButtons = [...document.querySelectorAll('.project-card-actions button')].filter(n => n.scrollWidth > n.clientWidth + 1);
          return { width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth + 1,
            count: boxes.length, minCardHeight: Math.min(...boxes.map(b => b.height)), clippedButtons: badButtons.length };
        }''')
        assert not metrics['overflow'] and metrics['clippedButtons'] == 0 and metrics['minCardHeight'] > 65, metrics
        filename = f'{name}-{width}x{height}.png'
        page.screenshot(path=OUTPUT / filename, animations='disabled')
        assert base.screenshot_variance(OUTPUT / filename) > 10
        report['captures'].append({'file': filename, **metrics})

    try:
        with nullcontext(sync_playwright().start()) as playwright:
            process, browser, page = launch(playwright)
            ready()
            expect(page.locator('[data-project-home]')).to_have_attribute('data-project-count', '50')
            expect(page.locator('.project-home-summary')).to_contain_text('500 个项目')
            assert 'task:get-detail' not in ledger()['calls'], ledger()['calls']
            assert all(not item['heavy'] and item['count'] <= 50 for item in ledger()['lists'])
            passed('500 projects: first page has 50 summaries, no detail reads or heavy fields')
            missing = page.locator('[data-project-id="' + report['database']['projects'][495]['id'] + '"]')
            missing.scroll_into_view_if_needed()
            expect(missing.locator('.project-card-cover-empty')).to_be_visible()
            expect(missing.locator('img')).to_have_count(0)
            passed('missing cover returns to empty preview')

            for width, height in [(1440, 900), (1024, 768), (390, 844)]:
                capture('grid', width, height)
            base.set_size(page, 1440, 900)
            page.get_by_role('tab', name='列表', exact=True).click()
            for width, height in [(1440, 900), (1024, 768), (390, 844)]:
                capture('list', width, height)
            base.set_size(page, 1440, 900)

            page.get_by_role('button', name='下一页', exact=True).click()
            ready()
            page_ids = page.locator('.project-card').evaluate_all('(nodes) => nodes.map(n => n.dataset.projectId)')
            first = page.locator('.project-card-open').first
            first.focus()
            first.press('Enter')
            page.wait_for_selector('.app-shell[data-shell-view="task-detail"]')
            page.get_by_role('button', name='返回项目', exact=True).click()
            ready()
            assert page.locator('.project-card').evaluate_all('(nodes) => nodes.map(n => n.dataset.projectId)') == page_ids
            expect(page.locator('[data-project-layout]')).to_have_attribute('data-project-layout', 'list')
            expect(page.get_by_role('button', name='上一页', exact=True)).to_be_enabled()
            passed('keyboard open and return restore second page and list layout')

            search = page.get_by_role('textbox', name='搜索项目', exact=True)
            controls(delayQuery='分页')
            n = len(ledger()['lists'])
            search.fill('分页')
            wait_list_count(n + 1)
            expect(search).to_be_enabled()
            search.fill('分页项目 123')
            expect(page.locator('[data-project-home]')).to_have_attribute('data-project-count', '1')
            ready()
            page.wait_for_timeout(1900)
            expect(search).to_have_value('分页项目 123')
            expect(page.locator('.project-card-body strong')).to_have_text('分页项目 123')
            passed('search stays editable during IPC and ignores older delayed results')
            controls()
            page.locator('.project-card-open').click()
            page.get_by_role('button', name='返回项目', exact=True).click()
            ready()
            expect(search).to_have_value('分页项目 123')
            expect(page.locator('[data-project-home]')).to_have_attribute('data-project-count', '1')
            passed('project return preserves search')

            request_count = len(ledger()['lists'])
            search.dispatch_event('compositionstart')
            search.fill('分页项目 124')
            page.wait_for_timeout(350)
            assert len(ledger()['lists']) == request_count
            search.dispatch_event('compositionend')
            expect(page.locator('.project-card-body strong')).to_have_text('分页项目 124')
            ready()
            passed('Chinese IME composition issues no partial search')

            search.fill('不存在的项目')
            expect(page.get_by_text('没有符合条件的项目', exact=True)).to_be_visible()
            page.get_by_role('button', name='清除筛选', exact=True).click()
            ready()
            type_filter = page.locator('.project-home-toolbar select').first
            for kind in ['story', 'music-mv', 'html-video', 'editorial-collage', 'motion-comic']:
                type_filter.select_option(kind)
                ready()
                assert ledger()['lists'][-1]['request']['taskType'] == kind
                expect(page.locator('[data-project-home]')).to_have_attribute('data-project-count', '50' if kind == 'story' else '1')
            type_filter.select_option('all')
            ready()
            passed('five type filters query the corresponding persisted projects')
            search.fill('分页项目 123')
            expect(page.locator('[data-project-home]')).to_have_attribute('data-project-count', '1')
            ready()
            project_id = page.locator('.project-card').get_attribute('data-project-id')
            page.get_by_role('button', name='收藏项目', exact=True).click()
            ready()
            page.get_by_role('tab', name='收藏', exact=True).click()
            ready()
            expect(page.locator('.project-card')).to_have_count(1)
            page.get_by_role('button', name='归档项目', exact=True).click()
            expect(page.locator('.project-card')).to_have_count(0)
            page.get_by_role('tab', name='已归档', exact=True).click()
            ready()
            expect(page.locator('.project-card')).to_have_count(1)
            page.get_by_role('button', name='恢复项目', exact=True).click()
            expect(page.locator('.project-card')).to_have_count(0)
            page.get_by_role('tab', name='活跃项目', exact=True).click()
            ready()
            expect(page.locator('.project-card')).to_have_count(1)
            passed('search empty state, favorite, archive and restore use persisted data')

            page.get_by_role('button', name='归档项目', exact=True).click()
            expect(page.locator('.project-card')).to_have_count(0)
            page.get_by_role('tab', name='已归档', exact=True).click()
            ready()
            page.get_by_role('button', name='永久删除', exact=True).click()
            dialog = page.get_by_role('dialog')
            expect(dialog.get_by_role('button', name='取消', exact=True)).to_be_enabled()
            dialog.get_by_role('button', name='取消', exact=True).click()
            expect(dialog).to_have_count(0)
            page.get_by_role('button', name='永久删除', exact=True).click()
            controls(failDelete=True)
            dialog.get_by_role('button', name='永久删除', exact=True).click()
            expect(dialog).to_contain_text('失败')
            expect(dialog.get_by_role('button', name='取消', exact=True)).to_be_enabled()
            page.screenshot(path=OUTPUT / 'delete-failure.png')
            controls()
            dialog.get_by_role('button', name='永久删除', exact=True).click()
            expect(dialog).to_have_count(0)
            expect(page.locator('.project-card')).to_have_count(0)
            assert page.evaluate('async id => await window.storydream.getTaskDetail(id)', project_id) is None
            passed('delete dialog cancels, reports failure, retries and removes the persisted record')

            page.get_by_role('tab', name='活跃项目', exact=True).click()
            page.get_by_role('button', name='清除筛选', exact=True).click()
            ready()
            controls(failList=True)
            page.get_by_role('button', name='重新加载', exact=True).click()
            expect(page.get_by_text('项目加载失败', exact=True)).to_be_visible()
            controls()
            page.locator('.empty-state').get_by_role('button', name='重新加载', exact=True).click()
            ready()
            expect(page.get_by_text('项目加载失败', exact=True)).to_have_count(0)
            passed('list error recovers with retry')

            for kind, title, target in [('music-mv', '音乐 MV 重开验证', 'task-detail'), ('html-video', 'HTML 重开验证', 'html-video'), ('editorial-collage', 'VOX 重开验证', 'editorial-collage'), ('motion-comic', '漫剧重开验证', 'motion-comic')]:
                search.fill(title)
                expect(page.locator('[data-project-home]')).to_have_attribute('data-project-count', '1')
                ready()
                page.locator('.project-card-open').click()
                page.wait_for_selector(f'.app-shell[data-shell-view="{target}"]')
                if target in ['editorial-collage', 'motion-comic']:
                    page.wait_for_selector('.director-desk')
                    expect(page.locator('.director-desk')).to_contain_text(title)
                else:
                    expect(page.locator('.app-shell')).to_contain_text(title)
                if target in ['editorial-collage', 'motion-comic', 'task-detail']:
                    page.get_by_role('button', name='返回项目', exact=True).click()
                else:
                    page.locator('[data-nav-view="projects"]').first.click()
                ready()
                expect(search).to_have_value(title)
                passed(f'{kind}: saved project reopens in its workspace and returns with filter')

            report['ledger'] = ledger()
            page.evaluate('() => window.storydream.windowControl("close")')
            process.wait(timeout=15)
            browser.close()
            process, browser, page = launch(playwright)
            ready()
            expect(page.locator('.project-home-summary')).to_contain_text('499 个项目')
            assert page.evaluate('async id => await window.storydream.getTaskDetail(id)', project_id) is None
            page.get_by_role('textbox', name='搜索项目', exact=True).fill('VOX 重开验证')
            expect(page.locator('[data-project-home]')).to_have_attribute('data-project-count', '1')
            ready()
            page.locator('.project-card-open').click()
            page.wait_for_selector('.director-desk')
            expect(page.locator('.director-desk')).to_contain_text('VOX 重开验证')
            page.get_by_role('button', name='返回项目', exact=True).click()
            ready()
            report['restartLedger'] = ledger()
            passed('Electron restart preserves deletion and reopens saved VOX project')
            assert not report['runtimeErrors'], report['runtimeErrors']
            assert report['ledger']['blockedGeneration'] == 0
            assert report['restartLedger']['blockedGeneration'] == 0
            report['status'] = 'passed'
    except Exception:
        report['status'] = 'failed'
        report['failure'] = traceback.format_exc()
        if page:
            try:
                page.screenshot(path=OUTPUT / 'failure.png', timeout=5000)
            except Exception:
                pass
        raise
    finally:
        controls()
        if page:
            try:
                page.evaluate('() => window.storydream.windowControl("close")')
            except Exception:
                pass
        if browser:
            browser.close()
        if process:
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=10)
        if playwright:
            playwright.stop()
        (OUTPUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'status': report['status'], 'checks': len(report['checks']), 'captures': len(report['captures'])}), flush=True)


if __name__ == '__main__':
    main()
