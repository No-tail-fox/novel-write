"""Verify project status deltas through production IPC in an isolated Electron profile."""
from __future__ import annotations

import importlib.util
from contextlib import nullcontext
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import traceback

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/project-activity-qa'
spec = importlib.util.spec_from_file_location('activity_qa_base', ROOT / 'scripts/qa-director-desk.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix='profile-', dir=OUTPUT))
    env = {**os.environ, 'NODE_ENV': 'production', 'STORYDREAM_PROJECT_QA_DIR': str(profile), 'PYTHONIOENCODING': 'utf-8'}
    for key in ['NODE_OPTIONS', 'VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE']:
        env.pop(key, None)
    subprocess.run(['node', str(ROOT / 'node_modules/tsx/dist/cli.mjs'), str(ROOT / 'scripts/qa-project-activity-seed.ts'), str(profile)], cwd=ROOT, env=env, check=True)
    ids = json.loads((profile / 'seed.json').read_text(encoding='utf-8'))
    report = {'status': 'running', 'checks': [], 'captures': [], 'runtimeErrors': [], 'profile': str(profile)}
    child = browser = page = playwright = None

    def passed(label):
        report['checks'].append(label)
        print(label, flush=True)

    def launch(playwright):
        port = base.free_port()
        with (OUTPUT / 'electron.log').open('ab') as log:
            process = subprocess.Popen([str(base.ELECTRON), f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1', f'--user-data-dir={profile}', str(ROOT / 'scripts/qa-project-home.cjs')], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            connected = playwright.chromium.connect_over_cdp(base.wait_cdp(port, process))
            deadline = time.monotonic() + 30
            while not connected.contexts[0].pages and time.monotonic() < deadline:
                time.sleep(.1)
            current = connected.contexts[0].pages[0]
            current.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
            base.wait_app(current)
            current.wait_for_selector('[data-project-home]')
            return process, connected, current
        except Exception:
            process.kill()
            process.wait(timeout=10)
            raise

    def card(key):
        return page.locator(f'[data-project-id="{ids[key]}"]')

    def capture(name, width, height):
        base.set_size(page, width, height)
        metrics = page.evaluate('''() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1,
          clipped: [...document.querySelectorAll('.project-card-actions button')].filter(n => n.scrollWidth > n.clientWidth + 1).length })''')
        assert not metrics['overflow'] and not metrics['clipped'], metrics
        path = OUTPUT / f'{name}-{width}x{height}.png'
        page.screenshot(path=path, animations='disabled')
        assert base.screenshot_variance(path) > 10
        report['captures'].append(str(path))

    try:
        with nullcontext(sync_playwright().start()) as playwright:
            child, browser, page = launch(playwright)
            expect(card('paused')).to_contain_text('剧本队列已暂停')
            expect(card('review')).to_contain_text('待审核')
            expect(card('completed')).to_contain_text('成片已完成')
            passed('persisted script queue, review and final completion appear on project cards')
            batch = page.evaluate('''async projectId => window.storydream.createDirectorBatch({
              workflowKind: 'director', projectId, status: 'running', concurrency: 1,
              plan: { scope: 'missing', capabilities: { image: true, video: false, voice: false, render: false }, outputReady: false, renderFailed: false, shots: [] },
              nodes: [{ id: 'image', capability: 'image', title: '画面', status: 'running', estimatedCost: 0, dependencies: [] }]
            })''', ids['vox'])
            expect(card('vox')).to_contain_text('运行中')
            expect(card('vox')).to_contain_text('正在批量生成 · 0/1')
            passed('actual batch-create IPC updates the open project list without reload')
            for width, height in [(1440, 900), (1024, 768)]:
                capture('running', width, height)
            page.evaluate('async id => window.storydream.updateDirectorBatch(id, {status: "completed", nodes: [{id: "image", capability: "image", title: "画面", status: "completed", estimatedCost: 0, dependencies: []}]})', batch['id'])
            expect(card('vox')).to_contain_text('素材已生成，可继续制作')
            passed('completed assets update immediately and do not claim final film completion')
            page.evaluate('async id => window.storydream.updateDirectorBatch(id, {status: "running"})', batch['id'])
            expect(card('vox')).to_contain_text('运行中')
            ledger = json.loads((profile / 'ledger.json').read_text(encoding='utf-8'))
            assert 'task:get-detail' not in ledger['calls'], ledger['calls']
            assert all(not item['heavy'] for item in ledger['lists'])
            assert ledger['blockedGeneration'] == 0
            report['ledger'] = ledger
            passed('status refreshes use lightweight summaries with no project detail reads or generation calls')
            page.evaluate('() => window.storydream.windowControl("close")')
            child.wait(timeout=15)
            browser.close()
            child, browser, page = launch(playwright)
            expect(card('vox')).to_contain_text('批量生成已暂停，可继续')
            expect(card('paused')).to_contain_text('剧本队列已暂停')
            capture('recovered', 1440, 900)
            passed('restart recovers interrupted batches to paused and keeps script pause state')
            assert not report['runtimeErrors'], report['runtimeErrors']
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
        if page:
            try:
                page.evaluate('() => window.storydream.windowControl("close")')
            except Exception:
                pass
        if browser:
            browser.close()
        if child:
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=10)
        if playwright:
            playwright.stop()
        (OUTPUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'status': report['status'], 'checks': len(report['checks']), 'captures': len(report['captures'])}), flush=True)


if __name__ == '__main__':
    main()
