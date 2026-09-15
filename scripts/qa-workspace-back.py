"""Shared back navigation through production Electron and an isolated local DB."""
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
OUTPUT = ROOT / '.artifacts/workspace-back-navigation'
spec = importlib.util.spec_from_file_location('back_qa_base', ROOT / 'scripts/qa-director-desk.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix='profile-', dir=OUTPUT))
    env = {**os.environ, 'NODE_ENV': 'production', 'STORYDREAM_PROJECT_QA_DIR': str(profile), 'PYTHONIOENCODING': 'utf-8'}
    for key in ['NODE_OPTIONS', 'VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE']:
        env.pop(key, None)
    subprocess.run(['node', str(ROOT / 'node_modules/tsx/dist/cli.mjs'), str(ROOT / 'scripts/qa-workspace-back-seed.ts'), str(profile)], cwd=ROOT, env=env, check=True)
    report = {'status': 'running', 'checks': [], 'captures': [], 'runtimeErrors': [], 'profile': str(profile)}
    process = browser = page = None
    back_positions = {}

    def passed(label):
        report['checks'].append(label)
        print(label, flush=True)

    def ready(view):
        page.wait_for_selector(f'.app-shell[data-shell-view="{view}"]')
        expect(page.locator('.app-shell')).to_have_attribute('aria-busy', 'false')

    def back(label):
        button = page.locator('.page-head .page-back-button')
        expect(button).to_have_attribute('aria-label', label)
        expect(button).to_be_enabled()
        return button

    def capture(name, label, widths=((1440, 900), (1040, 720), (390, 844))):
        for width, height in widths:
            base.set_size(page, width, height)
            button = back(label)
            metrics = button.evaluate('''button => {
              const r = button.getBoundingClientRect();
              const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
              const title = document.querySelector('.page-head-title').getBoundingClientRect();
              return {width: innerWidth, height: innerHeight, buttonX: r.x, buttonY: r.y, buttonWidth: r.width, buttonHeight: r.height,
                visible: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
                hit: button === hit || button.contains(hit), overlap: r.right > title.left,
                overflow: document.documentElement.scrollWidth > innerWidth + 1};
            }''')
            assert metrics['visible'] and metrics['hit'] and not metrics['overlap'] and not metrics['overflow'], metrics
            assert metrics['buttonWidth'] == metrics['buttonHeight'] == 36, metrics
            position = (metrics['buttonX'], metrics['buttonY'])
            assert position == back_positions.setdefault((width, height), position), metrics
            expect(page.get_by_role('button', name=label, exact=True)).to_have_count(1)
            path = OUTPUT / f'{name}-{width}x{height}.png'
            page.screenshot(path=path, animations='disabled')
            assert base.screenshot_variance(path) > 10
            report['captures'].append({'file': str(path), **metrics})
        base.set_size(page, 1440, 900)

    try:
        with sync_playwright() as pw:
            port = base.free_port()
            with (OUTPUT / 'electron.log').open('wb') as log:
                process = subprocess.Popen([str(base.ELECTRON), f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1', f'--user-data-dir={profile}', str(ROOT / 'scripts/qa-project-home.cjs')], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
            browser = pw.chromium.connect_over_cdp(base.wait_cdp(port, process))
            deadline = time.monotonic() + 30
            while not browser.contexts[0].pages and time.monotonic() < deadline:
                time.sleep(.1)
            page = browser.contexts[0].pages[0]
            page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
            base.wait_app(page)
            ready('projects')
            page.get_by_role('tab', name='列表', exact=True).click()
            for query, view in [('音乐 MV 返回验证', 'task-detail'), ('HTML 返回验证', 'html-video')]:
                search = page.get_by_role('textbox', name='搜索项目', exact=True)
                search.fill(query)
                expect(page.locator('[data-project-home]')).to_have_attribute('data-project-count', '1')
                page.locator('.project-card-open').click()
                ready(view)
                capture(view + '-project', '返回项目')
                if view == 'html-video':
                    page.get_by_role('button', name='可视编排', exact=True).click()
                    expect(page.locator('.hv-authoring-workspace')).to_be_visible()
                    expect(page.locator('.hv-authoring-empty')).not_to_contain_text('__STORYDREAM_SAFE_APP_ERROR')
                    capture('html-authoring-missing-source', '返回项目', ((1440, 900), (1040, 720)))
                    page.get_by_role('button', name='自动制作', exact=True).click()
                    page.get_by_role('tab', name='动画预览', exact=True).click()
                    capture('html-animation-preview', '返回项目', ((1440, 900), (1040, 720)))
                back('返回项目').focus()
                back('返回项目').press('Enter')
                ready('projects')
                expect(search).to_have_value(query)
                expect(page.locator('[data-project-layout]')).to_have_attribute('data-project-layout', 'list')
                passed(view + ': keyboard return preserves project search and list layout')
            page.get_by_role('textbox', name='搜索项目', exact=True).fill('')

            for view, field_selector in [
                ('html-video', '.hv-create-page textarea'), ('music-mv', '.music-mv-layout input'),
                ('editorial-collage', '.director-create-fields input'), ('motion-comic', '.director-create-fields input'),
            ]:
                page.locator(f'.nav-list [data-nav-view="{view}"]').click()
                ready(view)
                capture(view + '-create-light', '返回项目')
                page.get_by_role('button', name='切换深色主题', exact=True).click()
                capture(view + '-create-dark', '返回项目')
                page.get_by_role('button', name='切换浅色主题', exact=True).click()
                field = page.locator(field_selector).first
                draft = view + ' retained draft'
                field.fill(draft)
                back('返回项目').click()
                expect(page.get_by_role('dialog')).to_be_visible()
                page.get_by_role('button', name='继续编辑', exact=True).click()
                expect(field).to_have_value(draft)
                back('返回项目').click()
                page.get_by_role('button', name='保存并离开', exact=True).click()
                ready('projects')
                page.locator(f'.nav-list [data-nav-view="{view}"]').click()
                ready(view)
                expect(field).to_have_value(draft)
                field.fill(draft + ' discarded')
                back('返回项目').click()
                page.get_by_role('button', name='放弃改动并离开', exact=True).click()
                ready('projects')
                page.locator(f'.nav-list [data-nav-view="{view}"]').click()
                ready(view)
                expect(field).to_have_value(draft)
                back('返回项目').click()
                ready('projects')
                passed(view + ': back guards cancel, save, restore and discard')

                page.locator('.new-task-button').click()
                ready('new-task')
                creation_type = 'vox' if view == 'editorial-collage' else view
                page.locator(f'[data-task-creation-type="{creation_type}"]').click()
                ready(view)
                back('返回新建任务').click()
                ready('new-task')
                back('返回项目').click()
                ready('projects')
                passed(view + ': creation picker returns one level at a time')

            page.locator('.nav-list [data-nav-view="queue"]').click()
            page.locator('.nav-list [data-nav-view="history"]').click()
            ready('history')
            page.get_by_role('button', name='打开任务 HTML 返回验证', exact=True).click()
            ready('html-video')
            back('返回历史任务').click()
            ready('history')
            passed('existing HTML task returns to history when opened there')
            ledger = json.loads((profile / 'ledger.json').read_text(encoding='utf-8'))
            assert ledger['blockedGeneration'] == 0
            assert not report['runtimeErrors'], report['runtimeErrors']
            report['paidGenerationCalls'] = 0
            report['status'] = 'passed'
    except Exception:
        report['status'] = 'failed'
        report['error'] = traceback.format_exc()
        raise
    finally:
        (OUTPUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        if process and process.poll() is None:
            process.kill()
            process.wait(timeout=10)


if __name__ == '__main__':
    main()
