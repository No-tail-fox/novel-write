"""Inspect license/update UI fixtures in an isolated production Electron host."""
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
OUTPUT = ROOT / '.artifacts/license-qa'
spec = importlib.util.spec_from_file_location('license_qa_base', ROOT / 'scripts/qa-director-desk.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix='profile-', dir=OUTPUT))
    control_file = profile / 'controls.json'
    now = int(time.time())
    device = 'a123456789abcdef' * 4
    inactive = dict(configured=True, status='inactive', deviceId=device, deviceLabel='StoryDream-QA',
                    expiresAt=None, validUntil=None, devices=[], message='\u672c\u673a\u5c1a\u672a\u6fc0\u6d3b\u3002')
    active = {**inactive, 'status': 'active', 'message': '\u6388\u6743\u6709\u6548\u3002',
              'expiresAt': '2027-10-23T00:00:00Z', 'validUntil': '2026-10-23T06:10:00Z',
              'devices': [dict(deviceId=device, label='StoryDream-QA', lastSeen=now)]}
    release = dict(schemaVersion=1, kind='release', sequence=2, version='1.1.0', minimumVersion='0.0.0',
                   platform='win32', arch='x64', filename='StoryDream-Setup-1.1.0-aaaaaaaaaaaa.exe',
                   sha256='a' * 64, size=104857600, notes='\u4fee\u590d\u751f\u6210\u961f\u5217\uff0c\u6539\u8fdb\u5bfc\u51fa\u7a33\u5b9a\u6027\u3002',
                   issuedAt=now, validUntil=now + 86400)
    idle = dict(currentVersion='1.0.0', phase='idle', release=None, downloaded=0, required=False, message='')
    ready = {**idle, 'phase': 'ready', 'release': release, 'downloaded': release['size'], 'message': '\u5b89\u88c5\u5305\u5df2\u9a8c\u8bc1\u3002'}
    state = dict(license={**inactive, 'configured': False, 'status': 'unconfigured', 'message': '\u6388\u6743\u670d\u52a1\u5c1a\u672a\u914d\u7f6e\u3002'},
                 update=idle, active=active, inactive=inactive, ready=ready,
                 busyMessage='\u6709\u4efb\u52a1\u6b63\u5728\u8fd0\u884c\uff0c\u8bf7\u7b49\u5f85\u5b8c\u6210\u6216\u6682\u505c\u540e\u518d\u5b89\u88c5\u3002')

    def write_state():
        control_file.write_text(json.dumps(state, ensure_ascii=False), encoding='utf-8')

    write_state()
    report = dict(status='running', checks=[], captures=[], runtimeErrors=[], fixtureOnly=True)
    env = {**os.environ, 'NODE_ENV': 'production', 'STORYDREAM_LICENSE_QA_DIR': str(profile), 'PYTHONIOENCODING': 'utf-8'}
    for key in ['NODE_OPTIONS', 'VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE']:
        env.pop(key, None)
    child = browser = page = None

    def capture(name, width, height):
        base.set_size(page, width, height)
        metrics = page.locator('.license-settings').evaluate('''root => ({
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          controls: [...root.querySelectorAll('button,input')].filter(n => {
            const r = n.getBoundingClientRect(); return r.width && (r.left < 0 || r.right > innerWidth + 1 || n.scrollWidth > n.clientWidth + 2);
          }).length,
          text: [...root.querySelectorAll('dd,p')].filter(n => n.scrollWidth > n.clientWidth + 2).length
        })''')
        assert metrics == dict(overflow=False, controls=0, text=0), metrics
        path = OUTPUT / f'{name}-{width}x{height}.png'
        page.screenshot(path=path, animations='disabled')
        assert base.screenshot_variance(path) > 10
        report['captures'].append(str(path))

    def changed(license=None, update=None):
        if license is not None:
            state['license'] = license
        if update is not None:
            state['update'] = update
        write_state()
        page.wait_for_timeout(1800)

    try:
        with sync_playwright() as playwright:
            port = base.free_port()
            with (OUTPUT / 'electron.log').open('wb') as log:
                child = subprocess.Popen([str(base.ELECTRON), f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1',
                                          f'--user-data-dir={profile}', str(ROOT / 'scripts/qa-license.cjs')], cwd=ROOT, env=env,
                                         stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
            browser = playwright.chromium.connect_over_cdp(base.wait_cdp(port, child))
            context = browser.contexts[0]
            page = context.pages[0] if context.pages else context.wait_for_event('page', timeout=30000)
            page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
            base.wait_app(page)
            page.wait_for_selector('.license-settings')
            field = page.get_by_role('textbox', name='\u6fc0\u6d3b\u7801')
            activate = page.get_by_role('button', name='\u6fc0\u6d3b\u672c\u673a', exact=True)
            expect(field).to_be_disabled()
            expect(activate).to_be_disabled()
            for dimensions in [(1440, 900), (1024, 768)]:
                capture('unconfigured', *dimensions)
            report['checks'].append('unconfigured controls fail closed at desktop and compact sizes')

            changed(license=inactive)
            field.fill('invalid')
            expect(activate).to_be_disabled()
            field.fill('SD-AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD')
            expect(activate).to_be_enabled()
            activate.click()
            expect(page.locator('#license-heading').locator('..')).to_contain_text('\u5df2\u6fc0\u6d3b')
            expect(field).to_have_value('')
            capture('active', 1440, 900)
            release_button = page.get_by_role('button', name='\u89e3\u7ed1\u672c\u673a', exact=True)
            release_button.click()
            expect(page.get_by_role('dialog')).to_be_visible()
            page.get_by_role('button', name='\u53d6\u6d88', exact=True).click()
            expect(release_button).to_be_enabled()
            release_button.click()
            page.get_by_role('button', name='\u786e\u8ba4\u89e3\u7ed1', exact=True).click()
            expect(page.locator('#license-heading').locator('..')).to_contain_text('\u672a\u6fc0\u6d3b')
            report['checks'].append('activation validates code and unbind requires confirmation')

            changed(license={**inactive, 'status': 'locked', 'message': '\u672c\u673a\u5df2\u88ab\u7ba1\u7406\u5458\u9501\u5b9a\u3002'})
            expect(release_button).to_be_disabled()
            capture('locked', 1024, 768)
            changed(license=active, update={**idle, 'phase': 'downloading', 'release': release, 'downloaded': 41943040, 'required': True})
            expect(page.get_by_role('progressbar')).to_have_attribute('value', '41943040')
            capture('downloading', 1440, 900)
            changed(update=ready)
            install = page.get_by_role('button', name='\u5b89\u88c5\u5e76\u9000\u51fa', exact=True)
            expect(install).to_be_enabled()
            capture('ready', 1024, 768)
            install.click()
            expect(page.get_by_role('dialog')).to_be_visible()
            capture('install-confirmation', 1024, 768)
            page.get_by_role('button', name='\u786e\u8ba4\u5b89\u88c5', exact=True).click()
            expect(page.get_by_role('alert')).to_contain_text(state['busyMessage'])
            capture('install-busy', 1440, 900)
            report['checks'].append('lock, download progress, verified installer and busy-install rejection are visible')
            assert not report['runtimeErrors'], report['runtimeErrors']
            report['status'] = 'passed'
            page.evaluate('() => window.storydream.windowControl("close")')
            child.wait(timeout=15)
            browser.close()
            browser = None
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
        if child and child.poll() is None:
            child.kill()
            child.wait(timeout=10)
        (OUTPUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'status': report['status'], 'checks': len(report['checks']), 'captures': len(report['captures'])}), flush=True)


if __name__ == '__main__':
    main()
