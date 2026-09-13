"""Verify fingerprint-bound manual review confirmation in production Electron."""
from __future__ import annotations

import importlib.util
from contextlib import nullcontext
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = Path(os.environ.get('STORYDREAM_QA_OUTPUT', str(ROOT / '.artifacts/director-quality-confirmation-qa')))
quality_spec = importlib.util.spec_from_file_location('quality_helpers', ROOT / 'scripts/qa-director-quality.py')
sound_spec = importlib.util.spec_from_file_location('sound_helpers', ROOT / 'scripts/qa-director-sound.py')
assert quality_spec and quality_spec.loader and sound_spec and sound_spec.loader
quality = importlib.util.module_from_spec(quality_spec); quality_spec.loader.exec_module(quality)
sound = importlib.util.module_from_spec(sound_spec); sound_spec.loader.exec_module(sound)
base = sound.base


def doc(page, task_id):
    return page.evaluate('async id => JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData)', task_id)


def review(page, freshness, report_id):
    page.get_by_role('tab', name='审片', exact=True).click()
    region = page.get_by_role('region', name='审片质量报告')
    expect(region).to_have_attribute('data-quality-freshness', freshness)
    expect(region).to_have_attribute('data-quality-report-id', report_id)
    return region


def save_if_dirty(page):
    save = page.locator('.director-desk-header').get_by_role('button', name='保存版本', exact=True)
    if save.is_enabled():
        save.click()
        expect(save).to_be_disabled(timeout=15000)


def open_project(page, title, mode):
    if page.locator('.director-desk').is_visible():
        page.get_by_role('button', name='返回全部任务', exact=True).click()
        page.wait_for_selector("[data-task-operations='history']", timeout=30000)
    else:
        base.navigate_sidebar(page, 'history', "[data-task-operations='history']")
    page.get_by_role('textbox', name='搜索历史记录').fill(title)
    page.get_by_role('button', name=f'打开任务 {title}', exact=True).click()
    page.wait_for_selector(f"[data-{mode}-workbench='true'] .director-desk", timeout=30000)


def add_navigation_fixture(page, task_id, mode):
    page.evaluate('''async ({ id, mode }) => {
      const document = JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData);
      const vox = mode === 'editorial-collage';
      const owner = vox ? document.beats[0] : document.episodes[0].scenes[0];
      const timeline = vox ? document.timeline : document.episodes[0].timeline;
      const first = owner.shots[0]; const second = structuredClone(first);
      second.id = 'qa-recheck-second';
      const cues = [{ id: 'qa-recheck-cue-2', shotId: second.id, text: '第二镜头第一句。', startMs: 3000, endMs: 4400 },
        { id: 'qa-recheck-cue-3', shotId: second.id, text: '第二镜头第二句。', startMs: 4400, endMs: 6000 }];
      const image = { ...document.assets.find(asset => asset.id === 'qa-sound-image'), id: 'qa-recheck-image', assetId: 'qa-recheck-image' };
      document.assets.push(image);
      if (vox) {
        second.subtitleCueIds = cues.map(cue => cue.id); second.layers[0].assetVersionId = image.id;
        owner.subtitleCues.push(...cues); owner.durationMs = 6000;
      } else {
        second.index = 2; second.title = '第二个镜头';
        second.dialogueCueIds = cues.map(cue => cue.id); second.firstFrameAssetVersionId = image.id;
        document.episodes[0].dialogueCues.push(...cues.map(cue => ({ ...cue, emotion: '自然' })));
      }
      owner.shots.push(second); timeline.durationMs = 6000;
      timeline.clips.push({ ...timeline.clips[0], id: 'clip-' + second.id, shotId: second.id, startMs: 3000,
        assetVersionIds: [image.id], subtitleCueIds: cues.map(cue => cue.id) });
      await (vox ? window.storydream.saveEditorialCollage : window.storydream.saveMotionComic)({ id, expectedUpdatedAt: document.updatedAt, document });
    }''', {'id': task_id, 'mode': mode})


def set_review_fixture(page, task_id, mode, pending):
    page.evaluate('''async ({ id, mode, pending }) => {
      const document = JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData);
      const report = document.qualityReports.at(-1);
      report.checks = report.checks.filter(check => !check.id.startsWith('qa-'));
      report.checks.push({ id: 'qa-subtitle', label: 'QA 字幕复检范围', severity: 'manual', status: 'pending',
        recheckScope: { kind: 'subtitle', cueIds: ['qa-recheck-cue-3', 'qa-sound-cue'], startMs: 200 } });
      report.checks.push({ id: 'qa-asset', label: 'QA 素材复检范围', severity: 'manual', status: 'pending',
        recheckScope: { kind: 'asset', assetVersionIds: ['qa-recheck-image'] } });
      if (pending) report.checks.push({ id: 'qa-blocking', label: 'QA 待完成阻断检查', status: 'pending', severity: 'blocking' });
      await (mode === 'editorial-collage' ? window.storydream.saveEditorialCollage : window.storydream.saveMotionComic)({ id, expectedUpdatedAt: document.updatedAt, document });
    }''', {'id': task_id, 'mode': mode, 'pending': pending})


def capture_action(page, action, filename, report):
    action.scroll_into_view_if_needed()
    geometry = action.evaluate('''element => {
      const box = element.getBoundingClientRect(); const pane = element.closest('.director-inspector-scroll');
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      const back = document.querySelector('.director-desk-header button[aria-label="返回全部任务"]');
      const backBox = back.getBoundingClientRect();
      const backHit = document.elementFromPoint(backBox.x + backBox.width / 2, backBox.y + backBox.height / 2);
      return { reachable: !!hit && element.contains(hit), horizontalOverflow: pane.scrollWidth > pane.clientWidth + 1,
        headerBackReachable: !!backHit && back.contains(backHit),
        viewport: { width: innerWidth, height: innerHeight } };
    }''')
    assert geometry['reachable'] and geometry['headerBackReachable'] and not geometry['horizontalOverflow'], geometry
    page.screenshot(path=ARTIFACTS / filename, animations='disabled')
    report['captures'].append({'file': filename, **geometry})


def main():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    quality.TEMP_ROOT.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix='quality-confirm-', dir=quality.TEMP_ROOT))
    voice = profile / 'voice.wav'; sound.wav_fixture(voice, 330, 8000)
    image = base.create_reference_fixtures(profile / 'images')[0]
    env = os.environ.copy(); env.update({'NODE_ENV': 'production', 'TEMP': str(quality.TEMP_ROOT), 'TMP': str(quality.TEMP_ROOT),
        'STORYDREAM_QA_LIFECYCLE_LOG': str(ARTIFACTS / 'lifecycle.jsonl'), 'STORYDREAM_QA_CONFIRMATION_FAULT_DIR': str(profile)})
    env.pop('VITE_DEV_SERVER_URL', None); env.pop('ELECTRON_RUN_AS_NODE', None); env.pop('NODE_OPTIONS', None)
    report = {'status': 'running', 'startedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'profile': str(profile), 'runtimeErrors': [], 'paidGenerationCalls': 0, 'projects': {}, 'captures': [], 'syntheticReviewScopes': True}
    process = browser = page = None

    def launch(playwright):
        port = base.available_port()
        flags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0
        with (ARTIFACTS / 'electron.log').open('ab') as log:
            child = subprocess.Popen([str(base.ELECTRON), f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1', '--remote-allow-origins=*', f'--user-data-dir={profile}', str(ROOT / 'scripts/qa-director-lifecycle.cjs')], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=flags)
        connected = playwright.chromium.connect_over_cdp(base.wait_for_cdp(port, child))
        current = connected.contexts[0].pages[0]
        current.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
        current.on('crash', lambda: report['runtimeErrors'].append('Renderer crashed'))
        current.on('close', lambda: report.setdefault('lifecycle', []).append({'event': 'page-close', 'phase': report.get('phase'), 'exitCode': child.poll()}))
        base.wait_for_app(current)
        return child, connected, current

    def stop():
        nonlocal process, browser
        if browser:
            try: browser.close()
            except Exception: pass
        if process and process.poll() is None:
            process.terminate()
            try: process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait(timeout=10)
        browser = process = None

    playwright = sync_playwright().start()
    try:
        with nullcontext(playwright):
            process, browser, page = launch(playwright)
            for mode in ['editorial-collage', 'motion-comic']:
                report['phase'] = mode + '-render'
                local_recheck_verified = False
                title = '人工复核验收 ' + mode
                fixture = sound.seed_project(page, mode, title, image, voice)
                task_id = fixture['id']
                add_navigation_fixture(page, task_id, mode)
                episode_id = doc(page, task_id).get('activeEpisodeId') if mode == 'motion-comic' else None
                result = page.evaluate('async input => (await window.storydream.renderDirectorProject(input)).result', {'id': task_id, **({'episodeId': episode_id} if episode_id else {})})
                saved = doc(page, task_id); report_entry = saved['qualityReports'][-1]
                assert report_entry['status'] == 'passed'
                assert report_entry == json.loads(Path(result['outputPath'] + '.render.json').read_text(encoding='utf-8'))['report']
                set_review_fixture(page, task_id, mode, True)
                open_project(page, title, mode)
                region = review(page, 'current', report_entry['id'])
                expect(region.get_by_role('button', name='修复阻断项后再确认', exact=True)).to_be_disabled()
                set_review_fixture(page, task_id, mode, False)
                open_project(page, title, mode)
                region = review(page, 'current', report_entry['id'])
                local_recheck = region.locator('.director-quality-check').filter(has_text='QA 字幕复检范围').get_by_role('button', name='局部复检', exact=True)
                expect(local_recheck).to_be_enabled()
                local_recheck.click()
                rechecked = doc(page, task_id)['qualityReports'][-1]
                deadline = time.monotonic() + 30
                while time.monotonic() < deadline:
                    layout = rechecked.get('evidence', {}).get('subtitleLayout', {})
                    if any(scene.get('shotId') == 'qa-recheck-second' for scene in layout.get('scenes', [])):
                        break
                    page.wait_for_timeout(250)
                    rechecked = doc(page, task_id)['qualityReports'][-1]
                assert rechecked['id'] == report_entry['id']
                layout = rechecked.get('evidence', {}).get('subtitleLayout', {})
                assert any(scene.get('shotId') == 'qa-recheck-second' for scene in layout.get('scenes', [])), layout
                local_recheck_verified = True
                confirm = region.get_by_role('button', name='确认已复核当前版本', exact=True)
                report['phase'] = mode + '-save-failure'
                base.set_window_size(page, 1536, 1024)
                capture_action(page, confirm, f'{mode}-before-confirm-1536x1024.png', report)
                (profile / 'fail.flag').write_text('fail', encoding='utf-8')
                expect(confirm).to_be_enabled(); confirm.click()
                expect(confirm).to_be_disabled()
                expect(region).to_have_attribute('data-quality-confirmed', 'false')
                assert not doc(page, task_id)['qualityReports'][-1].get('manualReview')
                expect(page.locator('.director-inspector-scroll').get_by_role('alert')).to_contain_text('操作失败')
                expect(confirm).to_be_enabled()
                expect(region).to_have_attribute('data-quality-confirmed', 'false')
                assert not doc(page, task_id)['qualityReports'][-1].get('manualReview')
                capture_action(page, confirm, f'{mode}-save-failed-1536x1024.png', report)
                report['phase'] = mode + '-save-retry'
                base.set_window_size(page, 1040, 720)
                capture_action(page, confirm, f'{mode}-before-confirm-1040x720.png', report)
                (profile / 'delay.flag').write_text('delay', encoding='utf-8')
                confirm.click()
                expect(confirm).to_be_disabled()
                expect(region).to_have_attribute('data-quality-confirmed', 'false')
                expect(region).to_have_attribute('data-quality-confirmed', 'true')
                confirmed = doc(page, task_id)['qualityReports'][-1]['manualReview']
                assert confirmed['reportId'] == report_entry['id'] and confirmed['renderFingerprint'] == report_entry['renderFingerprint']
                assert confirmed['scope'] == {'kind': 'project'}
                for width, height in [(1536, 1024), (1040, 720)]:
                    base.set_window_size(page, width, height)
                    region = review(page, 'current', report_entry['id'])
                    region.locator('.director-quality-review__heading').scroll_into_view_if_needed()
                    page.screenshot(path=ARTIFACTS / f'{mode}-confirmed-{width}x{height}.png', animations='disabled')
                    overflow = region.locator('.director-quality-checks').evaluate('e => e.closest(\'.director-inspector-scroll\').scrollWidth > e.closest(\'.director-inspector-scroll\').clientWidth + 1')
                    assert not overflow
                    report['captures'].append({'file': f'{mode}-confirmed-{width}x{height}.png', 'confirmed': True, 'viewport': {'width': width, 'height': height}, 'horizontalOverflow': overflow})
                report['projects'][mode] = {'id': task_id, 'title': title, 'reportId': report_entry['id'], 'manualReview': confirmed, 'saveFailureVerified': True, 'pendingBlockingRejected': True, 'localRecheckVerified': local_recheck_verified}
            report['phase'] = 'restart-current'
            stop(); process, browser, page = launch(playwright)
            for mode, project in report['projects'].items():
                task_id = project['id']
                open_project(page, project['title'], mode)
                region = review(page, 'current', project['reportId'])
                expect(region).to_have_attribute('data-quality-confirmed', 'true')
                assert doc(page, task_id)['qualityReports'][-1]['manualReview'] == project['manualReview']
                project['currentRestartVerified'] = True
                report['phase'] = mode + '-scope-navigation'
                for width, height in [(1536, 1024), (1040, 720)]:
                    base.set_window_size(page, width, height)
                    if not page.get_by_role('textbox', name='搜索镜头', exact=True).is_visible():
                        page.get_by_role('button', name='显示项目与镜头', exact=True).click()
                    page.get_by_role('textbox', name='搜索镜头', exact=True).fill('不存在的镜头')
                    expect(page.locator('.director-shot-row')).to_have_count(0)
                    region = review(page, 'current', project['reportId'])
                    action = region.locator('.director-quality-check').filter(has_text='QA 字幕复检范围').get_by_role('button', name='定位复检范围', exact=True)
                    capture_action(page, action, f'{mode}-scope-before-{width}x{height}.png', report)
                    action.click()
                    expect(page.get_by_role('textbox', name='搜索镜头', exact=True)).to_have_value('')
                    expect(page.locator('.director-shot-row[aria-pressed="true"] .director-shot-row__index')).to_have_text('02')
                    expect(page.get_by_role('combobox', name='字幕句子', exact=True)).to_have_value('qa-recheck-cue-3')
                    expect(page.get_by_role('textbox', name='字幕内容', exact=True)).to_have_value('第二镜头第二句。')
                    capture_action(page, page.get_by_role('button', name='定位本句', exact=True), f'{mode}-scope-after-{width}x{height}.png', report)
                    region = review(page, 'current', project['reportId'])
                    region.locator('.director-quality-check').filter(has_text='QA 素材复检范围').get_by_role('button', name='定位复检范围', exact=True).click()
                    expect(page.get_by_role('tab', name='生成', exact=True)).to_have_attribute('aria-selected', 'true')
                    expect(page.locator('.director-shot-row[aria-pressed="true"] .director-shot-row__index')).to_have_text('02')
                project['scopeNavigationVerified'] = True
                region = review(page, 'current', project['reportId'])
                region.locator('.director-quality-check').filter(has_text='QA 字幕复检范围').get_by_role('button', name='定位复检范围', exact=True).click()
                page.get_by_role('combobox', name='字幕句子', exact=True).select_option('qa-recheck-cue-2')
                page.get_by_role('textbox', name='字幕内容', exact=True).fill('编辑后确认必须失效。')
                expect(page.get_by_role('combobox', name='字幕句子', exact=True)).to_have_value('qa-recheck-cue-2')
                expect(page.get_by_role('textbox', name='字幕内容', exact=True)).to_have_value('编辑后确认必须失效。')
                stale = review(page, 'stale', project['reportId'])
                expect(stale.get_by_role('button', name='修复阻断项后再确认', exact=True)).to_be_disabled()
                expect(stale).to_have_attribute('data-quality-confirmed', 'false')
                save_if_dirty(page); open_project(page, project['title'], mode)
                review(page, 'stale', project['reportId'])
                project['editedStale'] = True
                report['paidGenerationCalls'] += sum(job['capability'] != 'deterministic-render' for job in doc(page, task_id)['providerJobs'])
            report['phase'] = 'restart-stale'
            stop(); process, browser, page = launch(playwright)
            for mode, project in report['projects'].items():
                open_project(page, project['title'], mode)
                region = review(page, 'stale', project['reportId'])
                persisted = next(item for item in doc(page, project['id'])['qualityReports'] if item['id'] == project['reportId'])['manualReview']
                assert persisted == project['manualReview']
                expect(region).to_have_attribute('data-quality-confirmed', 'false')
                project['restartVerified'] = True
            assert not report['runtimeErrors'] and report['paidGenerationCalls'] == 0
            events = [json.loads(line) for line in (ARTIFACTS / 'lifecycle.jsonl').read_text(encoding='utf-8').splitlines()]
            assert sum(event['event'] == 'confirmation-save-fail' for event in events) == 2
            assert sum(event['event'] == 'confirmation-save-delay' for event in events) == 2
            report['blockedNetworkCalls'] = sum(event['event'] == 'network-blocked' for event in events)
            assert report['blockedNetworkCalls'] == 0
            report['status'] = 'passed'
            report['phase'] = 'shutdown'
            stop()
    except Exception as error:
        report['status'] = 'failed'; report['error'] = str(error)
        report['failureProcessExitCode'] = process.poll() if process else None
        if page:
            try: page.screenshot(path=ARTIFACTS / 'failure.png')
            except Exception: pass
        raise
    finally:
        stop()
        playwright.stop()
        report['finishedAt'] = time.strftime('%Y-%m-%dT%H:%M:%S%z')
        (ARTIFACTS / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({'status': report['status'], 'report': str(ARTIFACTS / 'report.json')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
