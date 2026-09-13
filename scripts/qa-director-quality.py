"""Production quality gate QA with local media and an isolated Electron profile."""
from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = Path(os.environ.get('STORYDREAM_QA_OUTPUT', str(ROOT / '.artifacts' / 'director-quality-qa')))
TEMP_ROOT = ROOT / '.codex-audit-temp'
spec = importlib.util.spec_from_file_location('quality_sound_helpers', ROOT / 'scripts' / 'qa-director-sound.py')
assert spec and spec.loader
sound = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sound)
base = sound.base


def document(page, task_id):
    return page.evaluate('async id => JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData)', task_id)


def capture_review(page, name, report):
    for width, height in [(1536, 1024), (1040, 720)]:
        base.set_window_size(page, width, height)
        review = page.get_by_role('region', name='审片质量报告')
        expect(review).to_be_visible()
        review.locator('.director-quality-review__heading').scroll_into_view_if_needed()
        filename = f'{name}-{width}x{height}.png'
        page.screenshot(path=ARTIFACTS / filename, animations='disabled')
        action = review.get_by_role('button', name='重新生成并审片', exact=True)
        action.scroll_into_view_if_needed()
        geometry = action.evaluate('''element => {
          const box = element.getBoundingClientRect();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          const pane = element.closest('.director-inspector-scroll');
          return { reachable: !!hit && element.contains(hit), horizontalOverflow: pane.scrollWidth > pane.clientWidth + 1,
            viewport: { width: innerWidth, height: innerHeight }, scrollHeight: pane.scrollHeight, clientHeight: pane.clientHeight };
        }''')
        assert geometry['reachable'] and not geometry['horizontalOverflow'], geometry
        page.screenshot(path=ARTIFACTS / f'{name}-bottom-{width}x{height}.png', animations='disabled')
        report['captures'].append({'file': filename, **geometry})


def check_audio_policy(page, mode, profile, image, normal_audio, report):
    silence_audio = profile / 'silence.wav'
    loud_audio = profile / 'loud.wav'
    sound.wav_fixture(silence_audio, 330, 0)
    sound.wav_fixture(loud_audio, 330, 32767)
    fixture = sound.seed_project(page, mode, '静音配置验收 ' + mode, image, silence_audio)
    task_id = fixture['id']
    cases = []
    for case in ['unexpected-silence', 'configured-silence', 'background-only', 'excessive-level']:
        report['phase'] = mode + ':' + case
        if case != 'unexpected-silence':
            page.evaluate('''async ({ id, background, audioPath, gainDb }) => {
              const doc = JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData);
              const vox = doc.workflowKind === 'editorial-collage';
              const unit = vox ? doc.beats[0] : doc.episodes[0];
              const shot = vox ? unit.shots[0] : unit.scenes[0].shots[0];
              const timeline = vox ? doc.timeline : unit.timeline;
              const voice = doc.assets.find(asset => asset.id === 'qa-sound-speech');
              if (background) {
                voice.localPath = audioPath;
                delete shot.voiceAssetVersionId;
                if (vox) { unit.narration = ''; unit.subtitleCues = []; shot.subtitleCueIds = []; }
                else { unit.dialogueCues = []; shot.dialogueCueIds = []; }
                timeline.clips[0].subtitleCueIds = [];
              }
              timeline.audioClips = [{ id: 'quality-audio', shotId: shot.id, assetVersionId: voice.id,
                trackType: background ? 'ambience' : 'narration', startMs: 0, muted: !background, gainDb }];
              const save = vox ? window.storydream.saveEditorialCollage : window.storydream.saveMotionComic;
              await save({ id, expectedUpdatedAt: doc.updatedAt, document: doc });
            }''', {'id': task_id, 'background': case in ['background-only', 'excessive-level'], 'audioPath': str(loud_audio if case == 'excessive-level' else normal_audio), 'gainDb': 6 if case == 'excessive-level' else 0})
        result = page.evaluate('async id => (await window.storydream.renderDirectorProject({ id })).result', task_id)
        saved = document(page, task_id)
        quality = saved['qualityReports'][-1]
        level = next(check for check in quality['checks'] if check['id'] == 'audio-level')
        warning = case in ['unexpected-silence', 'excessive-level']
        silent = case in ['unexpected-silence', 'configured-silence']
        assert level['status'] == ('failed' if warning else 'passed'), level
        assert quality['status'] == 'passed', quality
        assert all(check['status'] == 'passed' for check in quality['checks'] if check['severity'] == 'blocking'), quality
        assert quality['evidence']['audioIsSilent'] == silent, quality
        if silent:
            assert 'audioLufs' not in quality['evidence'] and 'audioTruePeakDb' not in quality['evidence'], quality
        if case == 'excessive-level':
            assert quality['evidence']['audioTruePeakDb'] > -1, quality
            assert 'dBTP' in level['detail'], level
        manifest = json.loads(Path(result['outputPath'] + '.render.json').read_text(encoding='utf-8'))
        assert manifest['report'] == quality
        sound.open_project(page, '静音配置验收 ' + mode, mode)
        page.get_by_role('tab', name='审片', exact=True).click()
        review = page.get_by_role('region', name='审片质量报告')
        if silent:
            expect(review.get_by_role('definition').filter(has_text='全静音，不适用')).to_have_count(2)
        expect(review.locator('.director-quality-badge')).to_have_text('可导出 · 待复核' if warning else '已通过')
        capture_review(page, mode + '-' + case, report)
        assert document(page, task_id)['qualityReports'][-1] == quality
        cases.append({'case': case, 'report': quality, 'savedAndReopened': True, 'manifestMatches': True})
    report.setdefault('audioPolicy', {})[mode] = cases


def main():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    TEMP_ROOT.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix='director-quality-', dir=TEMP_ROOT))
    normal_audio, quiet_audio = profile / 'normal.wav', profile / 'quiet.wav'
    sound.wav_fixture(normal_audio, 330, 8000)
    sound.wav_fixture(quiet_audio, 330, 30)
    image = base.create_reference_fixtures(profile / 'images')[0]
    preload = profile / 'block-network.cjs'
    preload.write_text("setImmediate(() => { globalThis.fetch = () => Promise.reject(new Error('Quality QA forbids network generation')); });\n", encoding='utf-8')
    env = os.environ.copy()
    env.update({'NODE_ENV': 'production', 'NODE_OPTIONS': f'--require="{preload.as_posix()}"', 'TEMP': str(TEMP_ROOT), 'TMP': str(TEMP_ROOT)})
    env.pop('VITE_DEV_SERVER_URL', None)
    env.pop('ELECTRON_RUN_AS_NODE', None)
    port = base.available_port()
    flags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0
    process = subprocess.Popen([str(base.ELECTRON), f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1', '--remote-allow-origins=*', f'--user-data-dir={profile}', str(ROOT)], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=flags)
    report = {'status': 'running', 'startedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'runtimeErrors': [], 'paidGenerationCalls': 0, 'modes': {}, 'captures': [], 'buildModifiedAt': (ROOT / 'dist-renderer' / 'index.html').stat().st_mtime}
    page = None
    try:
        endpoint = base.wait_for_cdp(port, process)
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(endpoint)
            page = browser.contexts[0].pages[0]
            page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
            page.on('crash', lambda: report['runtimeErrors'].append('Renderer process crashed'))
            base.wait_for_app(page)
            for mode, audio in [('editorial-collage', quiet_audio), ('motion-comic', normal_audio)]:
                report['phase'] = mode + ':baseline'
                title = '媒体审片验收 ' + mode
                fixture = sound.seed_project(page, mode, title, image, audio)
                task_id = fixture['id']
                sound.open_project(page, title, mode)
                result = page.evaluate('async id => (await window.storydream.renderDirectorProject({ id })).result', task_id)
                saved = document(page, task_id)
                quality = saved['qualityReports'][-1]
                assert quality['status'] == 'passed', quality
                assert quality['evidence']['audioQualityStatus'] == 'ok', quality
                assert quality['evidence']['blackDetectionStatus'] == 'ok', quality
                assert quality['evidence']['blackIntervalsMs'] == [], quality
                assert quality['evidence']['audioIsSilent'] is False, quality
                assert next(check for check in quality['checks'] if check['id'] == 'timeline-continuity')['status'] == 'passed', quality
                level = next(check for check in quality['checks'] if check['id'] == 'audio-level')
                assert level['status'] == ('failed' if mode == 'editorial-collage' else 'passed'), level
                assert any(asset['assetId'] == 'director-final-video' and asset.get('selected') for asset in saved['assets'])
                manifest = json.loads(Path(result['outputPath'] + '.render.json').read_text(encoding='utf-8'))
                assert manifest['report']['evidence'] == quality['evidence']
                shutil.copy2(result['outputPath'], ARTIFACTS / f'{mode}.mp4')
                sound.open_project(page, title, mode)
                page.get_by_role('tab', name='审片', exact=True).click()
                review = page.get_by_role('region', name='审片质量报告')
                expect(review.get_by_role('definition').filter(has_text='dBFS')).to_have_count(2)
                if mode == 'editorial-collage':
                    expect(review).to_contain_text('1 项警告')
                    expect(review).not_to_contain_text('1 项阻断')
                    expect(review.locator('.director-quality-badge')).to_have_text('可导出 · 待复核')
                else:
                    expect(review.locator('.director-quality-badge')).to_have_text('可导出 · 待复核')
                capture_review(page, mode, report)
                assert document(page, task_id)['qualityReports'][-1] == quality
                report['paidGenerationCalls'] += len([job for job in saved['providerJobs'] if job['capability'] != 'deterministic-render'])
                report['modes'][mode] = {'report': quality, 'savedAndReopened': True, 'manifestMatches': True, 'output': result}

                if mode == 'editorial-collage':
                    page.evaluate('''async id => {
                      const doc = JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData);
                      doc.beats[0].narration = '';
                      doc.beats[0].subtitleCues = [];
                      doc.beats[0].shots[0].subtitleCueIds = [];
                      doc.timeline.clips[0].subtitleCueIds = [];
                      await window.storydream.saveEditorialCollage({ id, expectedUpdatedAt: doc.updatedAt, document: doc });
                    }''', task_id)
                    failure = page.evaluate('''async id => {
                      try { await window.storydream.renderDirectorProject({ id }); return ''; }
                      catch (error) { return error.message; }
                    }''', task_id)
                    assert 'DIRECTOR_RENDER_QUALITY_GATE_FAILED' in failure, failure
                    assert 'REGISTRATION_FAILED' not in failure, failure
                    blocked = document(page, task_id)
                    assert len(blocked['qualityReports']) == len(saved['qualityReports']) + 1, blocked['qualityReports']
                    assert blocked['qualityReports'][-1]['status'] == 'failed'
                    assert not any(asset.get('selected') for asset in blocked['assets'] if asset['assetId'] == 'director-final-video')
                    sound.open_project(page, title, mode)
                    page.get_by_role('tab', name='审片', exact=True).click()
                    expect(page.locator('.director-quality-summary')).to_contain_text('1 项阻断')
                    capture_review(page, 'blocking-dialogue', report)
                    report['blockingGate'] = {'error': failure, 'report': blocked['qualityReports'][-1], 'noSelectedOutput': True, 'singleFailureReport': True}
                else:
                    page.evaluate('''async id => {
                      const doc = JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData);
                      doc.qualityReports.push({
                        id: 'qa-analysis-unavailable', workflowKind: 'motion-comic', stage: 'export', status: 'passed', createdAt: new Date().toISOString(),
                        providerJobId: doc.qualityReports.at(-1).providerJobId, episodeId: doc.qualityReports.at(-1).episodeId, renderFingerprint: doc.qualityReports.at(-1).renderFingerprint,
                        evidence: { audioQualityStatus: 'failed', audioQualityError: '分析超时' },
                        checks: [
                          { id: 'audio-level', label: '音频电平没有明显削顶或过低', status: 'failed', severity: 'warning', detail: '响度探测失败：分析超时', recheckScope: { kind: 'audio' } },
                          { id: 'black-intervals', label: '成片没有未解释的长黑帧区间', status: 'pending', severity: 'warning', detail: '尚未获得黑帧探测结果', recheckScope: { kind: 'media' } }
                        ]
                      });
                      await window.storydream.saveMotionComic({ id, expectedUpdatedAt: doc.updatedAt, document: doc });
                    }''', task_id)
                    sound.open_project(page, title, mode)
                    page.get_by_role('tab', name='审片', exact=True).click()
                    expect(page.locator('.director-quality-summary')).to_contain_text('1 项警告、1 项待处理')
                    expect(page.locator('.director-quality-summary')).not_to_contain_text('阻断')
                    expect(page.locator('.director-quality-evidence')).not_to_contain_text('未检出')
                    expect(page.locator('.director-quality-evidence')).not_to_contain_text('dBFS')
                    capture_review(page, 'analysis-unavailable-fixture', report)
                    report['analysisUnavailableUi'] = {'source': 'persisted fixture', 'pendingDistinctFromPassed': True, 'noFakeNumbers': True}
            for mode in ['editorial-collage', 'motion-comic']:
                check_audio_policy(page, mode, profile, image, normal_audio, report)
            assert not report['runtimeErrors'], report['runtimeErrors']
            assert report['paidGenerationCalls'] == 0
            report['status'] = 'passed'
            browser.close()
    except Exception as error:
        report['status'] = 'failed'
        report['error'] = str(error)
        if page:
            try:
                page.screenshot(path=ARTIFACTS / 'failure.png')
                report['failureText'] = page.locator('body').inner_text()[-8000:]
            except Exception:
                pass
        raise
    finally:
        report['processExitCodeBeforeCleanup'] = process.poll()
        if process.poll() is None:
            process.terminate()
        try:
            stdout, stderr = process.communicate(timeout=15)
        except subprocess.TimeoutExpired:
            process.kill()
            stdout, stderr = process.communicate(timeout=15)
        (ARTIFACTS / 'electron.log').write_bytes(stdout + stderr)
        report['finishedAt'] = time.strftime('%Y-%m-%dT%H:%M:%S%z')
        (ARTIFACTS / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({'status': report['status'], 'report': str(ARTIFACTS / 'report.json')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
