"""Exercise report ownership in production Electron with local media only."""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = Path(os.environ.get('STORYDREAM_QA_OUTPUT', str(ROOT / '.artifacts/director-quality-ownership-qa')))
spec = importlib.util.spec_from_file_location('quality_helpers', ROOT / 'scripts/qa-director-quality.py')
assert spec and spec.loader
quality = importlib.util.module_from_spec(spec)
spec.loader.exec_module(quality)
quality.ARTIFACTS = ARTIFACTS
sound, base = quality.sound, quality.base


def review(page, freshness, report_id=None):
    page.get_by_role('tab', name='审片', exact=True).click()
    region = page.get_by_role('region', name='审片质量报告')
    expect(region).to_have_attribute('data-quality-freshness', freshness)
    if report_id:
        expect(region).to_have_attribute('data-quality-report-id', report_id)
    labels = {'current': '可导出 · 待复核', 'stale': '报告已过期', 'unverified': '版本待核对', 'missing': '待审片'}
    expect(region.locator('.director-quality-badge')).to_have_text(labels[freshness])
    return region


def save_if_dirty(page):
    save = page.locator('.director-desk-header').get_by_role('button', name='保存版本', exact=True)
    if save.is_enabled():
        save.click()
        expect(save).to_be_disabled(timeout=15000)


def confirm_current_review(page, task_id, report_id):
    region = review(page, 'current', report_id)
    confirm = region.get_by_role('button', name='确认已复核当前版本', exact=True)
    expect(confirm).to_be_enabled()
    confirm.click()
    expect(region).to_have_attribute('data-quality-confirmed', 'true')
    document = quality.document(page, task_id)
    saved = next(item for item in document['qualityReports'] if item['id'] == report_id)
    assert saved['manualReview']['reportId'] == report_id
    assert saved['manualReview']['renderFingerprint'] == saved['renderFingerprint']
    assert saved['manualReview']['scope']['kind'] == 'project'
    return saved['manualReview']


def export(page, task_id, episode_id=None):
    result = page.evaluate('async input => (await window.storydream.renderDirectorProject(input)).result',
                           {'id': task_id, **({'episodeId': episode_id} if episode_id else {})})
    doc = quality.document(page, task_id)
    report = doc['qualityReports'][-1]
    job = next(job for job in doc['providerJobs'] if job['id'] == report['providerJobId'])
    assert report['renderFingerprint'] == job['renderFingerprint']
    assert report.get('episodeId') == job.get('episodeId') == episode_id
    assert report == json.loads(Path(result['outputPath'] + '.render.json').read_text(encoding='utf-8'))['report']
    assert report['status'] == 'passed', report
    return report


def main():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    quality.TEMP_ROOT.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix='quality-ownership-', dir=quality.TEMP_ROOT))
    voice = profile / 'voice.wav'
    sound.wav_fixture(voice, 330, 8000)
    image = base.create_reference_fixtures(profile / 'images')[0]
    env = os.environ.copy()
    lifecycle = ROOT / 'scripts/qa-director-lifecycle.cjs'
    env.update({'NODE_ENV': 'production',
                'STORYDREAM_QA_LIFECYCLE_LOG': str(ARTIFACTS / 'lifecycle.jsonl'), 'TEMP': str(quality.TEMP_ROOT), 'TMP': str(quality.TEMP_ROOT)})
    for key in ['VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS']:
        env.pop(key, None)
    report = {'status': 'running', 'startedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'profile': str(profile),
              'runtimeErrors': [], 'captures': [], 'projects': {}, 'paidGenerationCalls': 0}
    process = browser = page = None

    def launch(playwright):
        port = base.available_port()
        flags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0
        with (ARTIFACTS / 'electron.log').open('ab') as log:
            child = subprocess.Popen([str(base.ELECTRON), f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1',
                '--remote-allow-origins=*', f'--user-data-dir={profile}', str(lifecycle)], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=flags)
        try:
            connected = playwright.chromium.connect_over_cdp(base.wait_for_cdp(port, child))
            current = connected.contexts[0].pages[0]
            current.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
            current.on('crash', lambda: report['runtimeErrors'].append('Renderer crashed'))
            current.on('close', lambda: report.setdefault('lifecycle', []).append({'event': 'page-close', 'phase': report.get('phase'), 'exitCode': child.poll()}))
            connected.on('disconnected', lambda: report.setdefault('lifecycle', []).append({'event': 'cdp-disconnected', 'phase': report.get('phase'), 'exitCode': child.poll()}))
            base.wait_for_app(current)
            return child, connected, current
        except Exception:
            child.kill()
            child.wait(timeout=10)
            raise

    def stop():
        if browser:
            try:
                browser.close()
            except Exception as error:
                report.setdefault('cleanupErrors', []).append(str(error))
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=10)

    try:
        with sync_playwright() as playwright:
            process, browser, page = launch(playwright)
            for mode in ['editorial-collage', 'motion-comic']:
                report['phase'] = mode
                title = '审片归属验收 ' + mode
                fixture = sound.seed_project(page, mode, title, image, voice)
                task_id = fixture['id']
                initial = quality.document(page, task_id)
                first_id = initial['episodes'][0]['id'] if mode == 'motion-comic' else None
                report['phase'] = mode + '-first-render'
                first_report = export(page, task_id, first_id)
                report['phase'] = mode + '-confirm-and-edit'
                sound.open_project(page, title, mode)
                manual_review = confirm_current_review(page, task_id, first_report['id'])
                first_report['manualReview'] = manual_review
                quality.capture_review(page, mode + '-current', report)

                page.get_by_role('tab', name='字幕', exact=True).click()
                page.get_by_role('textbox', name='字幕内容', exact=True).fill('修改后的字幕内容。')
                review(page, 'stale', first_report['id'])
                expect(page.get_by_role('button', name='修复阻断项后再确认', exact=True)).to_be_disabled()
                assert quality.document(page, task_id)['qualityReports'][-1] == first_report
                quality.capture_review(page, mode + '-unsaved-stale', report)
                save_if_dirty(page)
                sound.open_project(page, title, mode)
                review(page, 'stale', first_report['id'])

                if mode == 'editorial-collage':
                    page.evaluate('''async ({ id, original }) => {
                      const doc = JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData);
                      const reports = doc.qualityReports; const jobs = doc.providerJobs; const assets = doc.assets;
                      Object.assign(doc, original, { id, qualityReports: reports, providerJobs: jobs, assets, updatedAt: doc.updatedAt });
                      await window.storydream.saveEditorialCollage({ id, expectedUpdatedAt: doc.updatedAt, document: doc });
                    }''', {'id': task_id, 'original': initial})
                    report['phase'] = mode + '-repeat-render'
                    fresh_report = export(page, task_id)
                    report['phase'] = mode + '-repeat-confirm'
                    sound.open_project(page, title, mode)
                    manual_review = confirm_current_review(page, task_id, fresh_report['id'])
                    page.get_by_role('tab', name='字幕', exact=True).click()
                    page.get_by_role('textbox', name='字幕内容', exact=True).fill('再次修改并在重启后复核。')
                    review(page, 'stale', fresh_report['id'])
                    expect(page.get_by_role('button', name='修复阻断项后再确认', exact=True)).to_be_disabled()
                    save_if_dirty(page)
                    expected_freshness, expected_id = 'stale', fresh_report['id']
                else:
                    # Restore the exact original inputs, including subtitle alignment metadata.
                    second_id = page.evaluate('''async ({ id, firstEpisode }) => {
                      const doc = JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData);
                      doc.episodes[0] = firstEpisode;
                      const second = structuredClone(doc.episodes[0]); second.id = 'quality-second'; second.number = 2; second.title = '第二集';
                      const oldShot = second.scenes[0].shots[0].id; const shotId = 'quality-second-shot';
                      second.scenes[0].id = 'quality-second-scene'; second.scenes[0].episodeId = second.id;
                      second.scenes[0].shots[0].id = shotId; second.scenes[0].shots[0].sceneId = second.scenes[0].id; second.scenes[0].shots[0].episodeId = second.id;
                      const cueId = 'quality-second-cue'; second.dialogueCues[0].id = cueId; second.dialogueCues[0].shotId = shotId;
                      second.scenes[0].shots[0].dialogueCueIds = [cueId];
                      second.timeline.clips[0].id = 'clip-' + shotId; second.timeline.clips[0].shotId = shotId; second.timeline.clips[0].subtitleCueIds = [cueId];
                      for (const clip of second.timeline.audioClips || []) { clip.id += '-second'; if (clip.shotId === oldShot) clip.shotId = shotId; }
                      doc.episodes.push(second);
                      await window.storydream.saveMotionComic({ id, expectedUpdatedAt: doc.updatedAt, document: doc });
                      return second.id;
                    }''', {'id': task_id, 'firstEpisode': initial['episodes'][0]})
                    sound.open_project(page, title, mode)
                    expect(review(page, 'current', first_report['id'])).to_have_attribute('data-quality-confirmed', 'true')
                    base.set_window_size(page, 1536, 1024)
                    page.locator('.director-episode-row').nth(1).click()
                    review(page, 'missing')
                    quality.capture_review(page, 'comic-second-without-report', report)
                    save_if_dirty(page)
                    report['phase'] = mode + '-second-episode-render'
                    second_report = export(page, task_id, second_id)
                    report['phase'] = mode + '-legacy-review'
                    sound.open_project(page, title, mode)
                    review(page, 'current', second_report['id'])
                    base.set_window_size(page, 1536, 1024)
                    page.locator('.director-episode-row').nth(0).click()
                    review(page, 'current', first_report['id'])
                    save_if_dirty(page)
                    page.evaluate('''async id => {
                      const doc = JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData);
                      const second = doc.qualityReports.find(report => report.episodeId === 'quality-second');
                      if (!second) throw new Error('Missing second episode report');
                      delete second.providerJobId; delete second.episodeId; delete second.renderFingerprint;
                      doc.qualityReports.push({ id: 'unassigned-legacy', workflowKind: 'motion-comic', stage: 'export', status: 'passed', checks: [], createdAt: new Date().toISOString() });
                      await window.storydream.saveMotionComic({ id, expectedUpdatedAt: doc.updatedAt, document: doc });
                    }''', task_id)
                    sound.open_project(page, title, mode)
                    base.set_window_size(page, 1536, 1024)
                    page.locator('.director-episode-row').nth(1).click()
                    inferred = review(page, 'current', second_report['id'])
                    expect(inferred).to_have_attribute('data-quality-confirmed', 'false')
                    expect(inferred.get_by_role('button', name='修复阻断项后再确认', exact=True)).to_be_disabled()
                    quality.capture_review(page, 'comic-legacy-inferred', report)
                    base.set_window_size(page, 1536, 1024)
                    page.locator('.director-episode-row').nth(0).click()
                    save_if_dirty(page)
                    region = review(page, 'current', first_report['id'])
                    expect(region).to_contain_text('1 份历史报告的分集或版本归属无法核对')
                    quality.capture_review(page, 'comic-first-confirmed-with-legacy', report)
                    expected_freshness, expected_id = 'current', first_report['id']

                doc = quality.document(page, task_id)
                report['projects'][mode] = {'id': task_id, 'title': title, 'expectedFreshness': expected_freshness, 'expectedReportId': expected_id, 'reportsBeforeRestart': doc['qualityReports'], 'manualReview': manual_review}
                report['paidGenerationCalls'] += sum(job['capability'] != 'deterministic-render' for job in doc['providerJobs'])

            legacy = sound.seed_project(page, 'editorial-collage', '无版本历史报告验收', image, voice)
            page.evaluate('''async id => {
              const doc = JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData);
              doc.qualityReports.push({ id: 'old-unknown-report', workflowKind: 'editorial-collage', stage: 'export', status: 'passed', checks: [], createdAt: new Date().toISOString() });
              await window.storydream.saveEditorialCollage({ id, expectedUpdatedAt: doc.updatedAt, document: doc });
            }''', legacy['id'])
            sound.open_project(page, '无版本历史报告验收', 'editorial-collage')
            review(page, 'unverified')
            quality.capture_review(page, 'vox-unverified-history', report)
            stop()
            process, browser, page = launch(playwright)
            for mode, project in report['projects'].items():
                sound.open_project(page, project['title'], mode)
                review(page, project['expectedFreshness'], project['expectedReportId'])
                assert quality.document(page, project['id'])['qualityReports'] == project['reportsBeforeRestart']
                persisted_review = next(item for item in quality.document(page, project['id'])['qualityReports'] if item['id'] == project['expectedReportId']).get('manualReview')
                assert persisted_review == project['manualReview']
                if project['expectedFreshness'] == 'current':
                    expect(review(page, 'current', project['expectedReportId'])).to_have_attribute('data-quality-confirmed', 'true')
                project['restartVerified'] = True
                quality.capture_review(page, mode + '-after-restart', report)
            assert not report['runtimeErrors'] and report['paidGenerationCalls'] == 0, report
            report['status'] = 'passed'
            stop()
            process = browser = page = None
    except Exception as error:
        report['status'] = 'failed'; report['error'] = str(error)
        report['failureProcessExitCode'] = process.poll() if process else None
        if page:
            try:
                page.screenshot(path=ARTIFACTS / 'failure.png')
            except Exception:
                pass
        raise
    finally:
        if process and process.poll() is None:
            process.terminate(); process.wait(timeout=15)
        report['finishedAt'] = time.strftime('%Y-%m-%dT%H:%M:%S%z')
        (ARTIFACTS / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({'status': report['status'], 'report': str(ARTIFACTS / 'report.json')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
