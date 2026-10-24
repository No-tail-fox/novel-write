"""Refine a completed data run via production IPC; block default-session HTTP(S)."""
from __future__ import annotations
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.artifacts' / 'vox-production-data'
PROFILE = OUT / 'profile'
spec = importlib.util.spec_from_file_location('vox_base', ROOT / 'scripts/qa-director-desk.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def main():
    seed = json.loads((PROFILE / 'seed.json').read_text(encoding='utf8'))
    original = json.loads((OUT / 'document.json').read_text(encoding='utf8'))
    assert original['productionRun']['status'] == 'completed'
    expected_paid = {n['id']: n['requestId'] for n in original['productionRun']['nodes'] if n['paid']}
    for name in ['report.json', 'document.json', 'media-report.json', 'nasa-temperature-auto.mp4', 'contact-sheet.jpg']:
        source = OUT / name
        backup = OUT / f'first-pass-{name}'
        if source.exists() and not backup.exists():
            shutil.copyfile(source, backup)
    env = {**os.environ, 'NODE_ENV': 'production', 'VOX_PRODUCTION_QA_DIR': str(PROFILE), 'VOX_QA_OFFLINE_REUSE': '1'}
    for key in ['NODE_OPTIONS', 'VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE']:
        env.pop(key, None)
    port = base.free_port()
    log_path = OUT / 'refinement-electron.log'
    with log_path.open('wb') as log:
        process = subprocess.Popen([str(base.ELECTRON), f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1', f'--user-data-dir={PROFILE}', str(ROOT / 'scripts/qa-vox-production.cjs')], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
    report = {'status': 'running', 'paidProviderCalls': 0, 'networkPolicy': 'HTTP(S) requests blocked in Electron default session; paid request IDs and attempts must remain unchanged', 'checks': [], 'errors': [], 'states': []}
    def save():
        (OUT / 'refinement-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
    with sync_playwright() as pw:
        browser = pw.chromium.connect_over_cdp(base.wait_cdp(port, process))
        context = browser.contexts[0]
        page = context.pages[0] if context.pages else context.wait_for_event('page', timeout=90_000)
        page.on('pageerror', lambda e: report['errors'].append(str(e)))
        # Only this isolated, completed QA project is being closed. Accept its
        # unsaved-navigation prompt so the production window can actually exit.
        page.on('dialog', lambda dialog: dialog.accept())
        base.wait_app(page)
        def snapshot():
            return page.evaluate('async id => JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData)', seed['id'])
        before = snapshot()
        assert {n['id']: n['requestId'] for n in before['productionRun']['nodes'] if n['paid']} == expected_paid
        run = page.evaluate('async input => window.storydream.startVoxProduction(input)', {'id': seed['id'], 'expectedUpdatedAt': before['updatedAt'], 'settings': before['productionSettings']})
        assert all(n['status'] == 'completed' and n['requestId'] == expected_paid[n['id']] for n in run['nodes'] if n['paid'])
        report['checks'].append('new local refinement run reuses every completed plan and voice request')
        deadline = time.monotonic() + 600
        previous = None
        while time.monotonic() < deadline:
            d = snapshot()
            active = d['productionRun']
            state = [(n['id'], n['status'], n['attempt']) for n in active['nodes']]
            if state != previous:
                previous = state
                report['states'].append({'status': active['status'], 'completed': sum(n['status'] == 'completed' for n in active['nodes']), 'active': next((n for n in active['nodes'] if n['status'] in ['running', 'failed', 'unknown']), None)})
                save()
                print(report['states'][-1], flush=True)
            if active['status'] != 'running':
                break
            page.wait_for_timeout(1000)
        assert active['status'] == 'completed', active.get('message', active['status'])
        assert {n['id']: n['requestId'] for n in active['nodes'] if n['paid']} == expected_paid
        assert all(n['attempt'] == 1 for n in active['nodes'] if n['paid'])
        assert not report['errors'], report['errors']
        (OUT / 'document.json').write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding='utf8')
        report['checks'].append('refined animation/compile/render/verify completed with unchanged paid request IDs and attempts')
        page.evaluate('() => window.storydream.windowControl("close")')
        process.wait(timeout=30)
        browser.close()
    assert 'VOX_QA_BLOCKED_NETWORK' not in log_path.read_text(encoding='utf8', errors='replace'), 'Unexpected remote dispatch was blocked; inspect log'
    report['checks'].append('no HTTP(S) requests attempted in Electron default session during local refinement')
    report['status'] = 'passed'
    save()


if __name__ == '__main__':
    main()
