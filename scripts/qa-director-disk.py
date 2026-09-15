"""Verify production low-disk rejection, unchanged old outputs, and streamed hashes."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import subprocess
import tempfile
import time
import traceback
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / '.artifacts/director-disk-qa'
spec = importlib.util.spec_from_file_location('disk_quality_helpers', ROOT / 'scripts/qa-director-quality.py')
assert spec and spec.loader
quality = importlib.util.module_from_spec(spec)
spec.loader.exec_module(quality)
sound, base = quality.sound, quality.base


def sha256(path):
    with Path(path).open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def main():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix='director-disk-', dir=ROOT / '.codex-audit-temp'))
    audio = profile / 'voice.wav'
    sound.wav_fixture(audio, 330, 8000)
    image = base.create_reference_fixtures(profile / 'images')[0]
    env = os.environ.copy()
    env.update({'NODE_ENV': 'production', 'STORYDREAM_DISK_QA_DIR': str(profile), 'TEMP': str(profile), 'TMP': str(profile)})
    for key in ['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'VITE_DEV_SERVER_URL']:
        env.pop(key, None)
    port = base.available_port()
    flags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0
    with (ARTIFACTS / 'electron.log').open('ab') as log:
        process = subprocess.Popen([str(base.ELECTRON), f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1', '--remote-allow-origins=*', f'--user-data-dir={profile}', str(ROOT / 'scripts/qa-director-disk.cjs')], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=flags)
    report = {'status': 'running', 'startedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'profile': str(profile), 'modes': {}, 'runtimeErrors': [], 'captures': []}
    page = browser = None
    ledger = lambda: json.loads((profile / 'ledger.json').read_text(encoding='utf-8'))
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(base.wait_for_cdp(port, process))
            page = browser.contexts[0].pages[0]
            page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
            base.wait_for_app(page)
            for mode in ['editorial-collage', 'motion-comic']:
                title = '磁盘预算验收 ' + mode
                fixture = sound.seed_project(page, mode, title, image, audio)
                project_id = fixture['id']
                result = page.evaluate('async id => (await window.storydream.renderDirectorProject({ id })).result', project_id)
                saved = quality.document(page, project_id)
                output = next(asset for asset in saved['assets'] if asset['assetId'] == 'director-final-video' and asset['selected'])
                digest = sha256(result['outputPath'])
                assert digest == output['sha256']
                manifest = json.loads(Path(result['outputPath'] + '.render.json').read_text(encoding='utf-8'))
                assert manifest['asset']['sha256'] == digest
                sound.open_project(page, title, mode)
                base.set_window_size(page, 1536, 1024)
                page.get_by_role('tab', name='审片', exact=True).click()
                before = ledger()
                (profile / 'low-disk.flag').write_text('1024 bytes free', encoding='utf-8')
                review = page.get_by_role('region', name='审片质量报告')
                review.get_by_role('button', name='重新生成并审片', exact=True).click()
                expect(page.locator('.director-header-message')).to_contain_text('磁盘空间不足', timeout=30000)
                after = ledger()
                assert after['renderCalls'] == before['renderCalls'] + 1
                assert after['copiedMedia'] == before['copiedMedia'] and after['windows'] == before['windows']
                assert any(check['low'] for check in after['diskChecks'])
                blocked = quality.document(page, project_id)
                assert blocked['assets'] == saved['assets']
                assert len(blocked['providerJobs']) == len(saved['providerJobs']) + 1
                assert blocked['providerJobs'][-1]['status'] == 'failed'
                assert '磁盘空间不足' in blocked['providerJobs'][-1]['error']
                assert sha256(result['outputPath']) == digest
                for width, height in [(1536, 1024), (1040, 720)]:
                    base.set_window_size(page, width, height)
                    page.get_by_role('button', name='查看错误详情', exact=True).click()
                    dialog = page.get_by_role('dialog', name='操作未完成', exact=True)
                    expect(dialog).to_contain_text('预计需要')
                    expect(dialog).to_contain_text('临时片段、混音和成片副本')
                    assert dialog.inner_text().count('诊断号') == 1
                    box = dialog.bounding_box()
                    assert box and box['x'] >= 0 and box['y'] >= 0 and box['x'] + box['width'] <= width + 1 and box['y'] + box['height'] <= height + 1
                    filename = f'{mode}-low-disk-{width}x{height}.png'
                    page.screenshot(path=ARTIFACTS / filename, animations='disabled')
                    report['captures'].append(filename)
                    dialog.get_by_role('button', name='关闭', exact=True).click()
                    expect(dialog).not_to_be_visible()
                (profile / 'low-disk.flag').unlink()
                report['modes'][mode] = {'streamedDigestMatches': True, 'blockedBeforeMediaCopyAndCapture': True, 'oldOutputAndAssetsUnchanged': True, 'failedJobPersisted': True}
            report['ledger'] = ledger()
            assert report['ledger']['externalCalls'] == 0 and not report['runtimeErrors']
            report['status'] = 'passed'
    except Exception as error:
        report.update({'status': 'failed', 'error': repr(error), 'traceback': traceback.format_exc()})
        if page:
            try:
                page.screenshot(path=ARTIFACTS / 'failure.png')
            except Exception:
                pass
    finally:
        if browser:
            try:
                browser.close()
            except Exception:
                pass
        if process.poll() is None:
            process.kill()
            process.wait(timeout=15)
        report['finishedAt'] = time.strftime('%Y-%m-%dT%H:%M:%S%z')
        (ARTIFACTS / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report['status'] != 'passed':
        raise SystemExit(1)


if __name__ == '__main__':
    main()
