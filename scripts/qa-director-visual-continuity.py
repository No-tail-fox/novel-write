"""Verify real cut-frame evidence, review navigation and subtitle rechecks in Electron."""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path

import imageio_ffmpeg
from PIL import Image, ImageDraw
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path(os.environ.get('STORYDREAM_QA_OUTPUT', str(ROOT / '.artifacts' / ('director-visual-cuts-' + time.strftime('%Y%m%d-%H%M%S')))))
spec = importlib.util.spec_from_file_location('visual_qa_helpers', ROOT / 'scripts/qa-director-quality-confirmation.py')
assert spec and spec.loader
qa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa)
qa.ARTIFACTS = OUTPUT


def set_dark_second(page, task_id, black):
    page.evaluate('''async ({ id, black }) => {
      const doc = JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData);
      doc.assets.find(asset => asset.id === 'qa-recheck-image').localPath = black;
      const vox = doc.workflowKind === 'editorial-collage';
      const shots = vox ? doc.beats[0].shots : doc.episodes[0].scenes[0].shots;
      shots.forEach(shot => { shot.layoutTemplate = '纪录片 · 纯画面'; });
      await (vox ? window.storydream.saveEditorialCollage : window.storydream.saveMotionComic)({ id, expectedUpdatedAt: doc.updatedAt, document: doc });
    }''', {'id': task_id, 'black': str(black)})


def create_semantic_fixtures(directory: Path) -> tuple[Path, Path]:
    """Create two text-free frames with one repeated subject and location cues."""
    directory.mkdir(parents=True, exist_ok=True)
    paths = []
    for index, (sky, building, light) in enumerate([
        ((116, 157, 190), (56, 72, 86), (238, 188, 83)),
        ((79, 107, 142), (45, 58, 76), (247, 202, 111)),
    ], start=1):
        image = Image.new('RGB', (960, 540), sky)
        draw = ImageDraw.Draw(image)
        draw.rectangle((0, 310, 960, 540), fill=(38, 45, 54))
        for x in (80, 300, 520, 740):
            draw.rectangle((x, 170, x + 120, 340), fill=building)
            for row in range(3):
                draw.rectangle((x + 18, 195 + row * 40, x + 42, 217 + row * 40), fill=light)
                draw.rectangle((x + 72, 195 + row * 40, x + 96, 217 + row * 40), fill=light)
        # Same person in both frames: blue umbrella, orange coat, dark trousers.
        draw.ellipse((426, 170, 534, 278), fill=(229, 181, 139))
        draw.pieslice((350, 105, 610, 315), 180, 360, fill=(35, 92, 146))
        draw.rectangle((438, 270, 522, 422), fill=(205, 103, 52))
        draw.rectangle((448, 422, 474, 510), fill=(35, 42, 52))
        draw.rectangle((486, 422, 512, 510), fill=(35, 42, 52))
        draw.line((480, 270, 480, 510), fill=(238, 188, 83), width=5)
        path = directory / f'semantic-scene-{index}.png'
        image.save(path, format='PNG')
        paths.append(path)
    return paths[0], paths[1]


def set_semantic_second(page, task_id, image_path):
    page.evaluate('''async ({ id, imagePath }) => {
      const document = JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData);
      const asset = document.assets.find(item => item.id === 'qa-recheck-image');
      if (!asset) throw new Error('Semantic fixture asset missing.');
      asset.localPath = imagePath;
      const vox = document.workflowKind === 'editorial-collage';
      await (vox ? window.storydream.saveEditorialCollage : window.storydream.saveMotionComic)({ id, expectedUpdatedAt: document.updatedAt, document });
    }''', {'id': task_id, 'imagePath': str(image_path)})


def main():
    OUTPUT.mkdir(parents=True, exist_ok=False)
    qa.quality.TEMP_ROOT.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix='visual-cuts-', dir=qa.quality.TEMP_ROOT))
    voice = profile / 'voice.wav'
    qa.sound.wav_fixture(voice, 330, 8000)
    image, second_image = create_semantic_fixtures(profile / 'images')
    black = profile / 'black.png'
    Image.new('RGB', (1920, 1080), (0, 0, 0)).save(black)
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    env = os.environ.copy()
    env.update({'NODE_ENV': 'production', 'TEMP': str(qa.quality.TEMP_ROOT), 'TMP': str(qa.quality.TEMP_ROOT),
                'STORYDREAM_QA_LIFECYCLE_LOG': str(OUTPUT / 'lifecycle.jsonl')})
    for key in ['VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS']:
        env.pop(key, None)
    report = {'status': 'running', 'profile': str(profile), 'startedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
              'runtimeErrors': [], 'paidGenerationCalls': 0, 'projects': {}, 'captures': []}
    child = browser = page = None
    playwright = sync_playwright().start()

    def launch():
        nonlocal child, browser, page
        port = qa.base.available_port()
        with (OUTPUT / 'electron.log').open('ab') as log:
            child = subprocess.Popen([str(qa.base.ELECTRON), f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1',
                '--remote-allow-origins=*', f'--user-data-dir={profile}', str(ROOT / 'scripts/qa-director-lifecycle.cjs')],
                cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP)
        browser = playwright.chromium.connect_over_cdp(qa.base.wait_for_cdp(port, child))
        page = browser.contexts[0].pages[0]
        page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
        page.on('crash', lambda: report['runtimeErrors'].append('Renderer crashed'))
        qa.base.wait_for_app(page)

    def stop():
        nonlocal child, browser, page
        if browser:
            try: browser.close()
            except Exception: pass
        if child and child.poll() is None:
            child.terminate()
            try: child.wait(timeout=15)
            except subprocess.TimeoutExpired: child.kill(); child.wait(timeout=10)
        child = browser = page = None

    try:
        launch()
        for mode in ['editorial-collage', 'motion-comic']:
            title = '切点帧验收 ' + mode
            task_id = qa.sound.seed_project(page, mode, title, image, voice)['id']
            qa.add_navigation_fixture(page, task_id, mode)
            set_semantic_second(page, task_id, second_image)
            project = {'id': task_id, 'title': title, 'renders': []}
            report['projects'][mode] = project
            report.setdefault('semanticFixture', {'subject': '同一人物：蓝色雨伞、橙色外套、深色长裤', 'scene': '同一城市街区：楼体和窗户布局保持一致', 'frames': []})
            for case in ['normal', 'dark']:
                report['phase'] = mode + '-' + case
                print(report['phase'], flush=True)
                if case == 'dark': set_dark_second(page, task_id, black)
                result = page.evaluate('async id => (await window.storydream.renderDirectorProject({ id })).result', task_id)
                doc = qa.doc(page, task_id)
                entry = doc['qualityReports'][-1]
                evidence = entry['evidence']['visualContinuity']
                assert evidence['status'] == 'ok' and len(evidence['cuts']) == 1, evidence
                cut = evidence['cuts'][0]
                assert cut['atMs'] == 3000 and [frame['index'] for frame in cut['frames']] == [70, 71, 72, 73], cut
                check = next(item for item in entry['checks'] if item['id'] == 'visual-continuity')
                assert check['status'] == ('passed' if case == 'normal' else 'failed'), (check, evidence)
                assert check['severity'] == 'warning' and entry['status'] == 'passed', entry
                assert json.loads(Path(result['outputPath'] + '.render.json').read_text(encoding='utf-8'))['report'] == entry
                assert result['visualContinuity'] == evidence
                assert not list(Path(result['outputPath']).parent.glob('*.filter'))
                for index in [70, 72]:
                    subprocess.run([ffmpeg, '-v', 'error', '-i', result['outputPath'], '-vf', f'select=eq(n\\,{index})',
                        '-frames:v', '1', '-y', str(OUTPUT / f'{mode}-{case}-frame-{index}.png')], check=True, capture_output=True)
                report['semanticFixture']['frames'].append({'mode': mode, 'case': case, 'before': f'{mode}-{case}-frame-70.png', 'after': f'{mode}-{case}-frame-72.png'})
                qa.open_project(page, title, mode)
                region = qa.review(page, 'current', entry['id'])
                visual = region.get_by_role('region', name='切点帧证据')
                expect(visual.locator('tbody tr')).to_have_count(4)
                expect(visual.get_by_role('combobox', name='切点', exact=True)).to_have_value('3000')
                for width, height in [(1536, 1024), (1040, 720)]:
                    qa.base.set_window_size(page, width, height)
                    if page.locator('.director-desk').get_attribute('data-left-pane-open') == 'true':
                        page.get_by_role('button', name='显示项目与镜头', exact=True).click()
                    button = visual.get_by_role('button', name='定位此切点', exact=True)
                    qa.capture_action(page, button, f'{mode}-{case}-{width}x{height}.png', report)
                    button.click()
                    # Native range values snap to the 100 ms step; the React value retains the exact playback clock.
                    expect(page.get_by_role('slider', name='播放进度', exact=True)).to_have_attribute('value', str(cut['frames'][0]['timeMs']))
                    expect(page.locator('.director-shot-row[aria-pressed="true"] .director-shot-row__index')).to_have_text('01')
                    expect(page.get_by_role('tab', name='审片', exact=True)).to_have_attribute('aria-selected', 'true')
                project['renders'].append({'case': case, 'outputPath': result['outputPath'], 'report': entry, 'navigationVerified': True})

            # Await the actual IPC result, then verify unchanged visual/report ownership.
            report['phase'] = mode + '-subtitle-recheck'
            before = qa.doc(page, task_id)
            original = before['qualityReports'][-1]
            renders_dir = Path(project['renders'][-1]['outputPath']).parents[2]
            directories = set(renders_dir.iterdir())
            request = {'id': task_id, 'reportId': original['id'], 'renderFingerprint': original['renderFingerprint'],
                       'shotIds': ['qa-recheck-second'], 'cueIds': ['qa-recheck-cue-2'], 'expectedUpdatedAt': before['updatedAt']}
            if mode == 'motion-comic': request['episodeId'] = before['activeEpisodeId']
            rechecked = page.evaluate('async request => window.storydream.recheckDirectorSubtitles(request)', request)
            saved = qa.doc(page, task_id)
            assert rechecked['reportId'] == original['id'] and rechecked['result']['outputPath'] == ''
            assert saved['assets'] == before['assets'] and saved['providerJobs'] == before['providerJobs']
            assert saved['qualityReports'][-1]['evidence']['visualContinuity'] == original['evidence']['visualContinuity']
            assert saved['qualityReports'][-1]['evidence']['subtitleLayout']['scenes'][0] == original['evidence']['subtitleLayout']['scenes'][0]
            measured = next(scene for scene in saved['qualityReports'][-1]['evidence']['subtitleLayout']['scenes'] if scene['shotId'] == 'qa-recheck-second')
            assert {cue['cueId'] for cue in measured['cues']} == {'qa-recheck-cue-2', 'qa-recheck-cue-3'}, measured
            assert set(renders_dir.iterdir()) == directories
            assert not list(renders_dir.parent.glob('.rq-*'))
            failure = page.evaluate('async request => { try { await window.storydream.recheckDirectorSubtitles(request); return "accepted"; } catch (error) { return String(error); } }', request)
            assert failure != 'accepted'
            # Fail after staging begins, and prove both the report and temporary directories survive correctly.
            request['expectedUpdatedAt'] = saved['updatedAt']
            missing_voice = voice.with_suffix('.unavailable')
            voice.rename(missing_voice)
            try:
                failure = page.evaluate('async request => { try { await window.storydream.recheckDirectorSubtitles(request); return "accepted"; } catch (error) { return String(error); } }', request)
                assert failure != 'accepted'
                assert qa.doc(page, task_id)['qualityReports'] == saved['qualityReports']
                assert not list(renders_dir.parent.glob('.rq-*'))
            finally:
                missing_voice.rename(voice)
            project['recheckFailureCleanupVerified'] = True
            project['subtitleRecheckVerified'] = True
            project['savedReports'] = saved['qualityReports']
            # Media recheck executes the selected shots through the real local
            # renderer and updates the same report, while preserving assets/jobs.
            report['phase'] = mode + '-media-recheck'
            media_before = qa.doc(page, task_id)
            media_original = media_before['qualityReports'][-1]
            media_shots = media_before['beats'][0]['shots'] if mode == 'editorial-collage' else media_before['episodes'][0]['scenes'][0]['shots']
            media_first_id = next(shot['id'] for shot in media_shots if shot['id'] != 'qa-recheck-second')
            media_request = {'id': task_id, 'reportId': media_original['id'], 'renderFingerprint': media_original['renderFingerprint'],
                             'shotIds': [media_first_id, 'qa-recheck-second'], 'startMs': 0, 'endMs': 6000,
                             'expectedUpdatedAt': media_before['updatedAt']}
            if mode == 'motion-comic': media_request['episodeId'] = media_before['activeEpisodeId']
            media_result = page.evaluate('async request => window.storydream.recheckDirectorMedia(request)', media_request)
            media_saved = qa.doc(page, task_id)
            assert media_result['reportId'] == media_original['id'] and media_result['result']['outputPath'] == ''
            assert media_result['checkedShotIds'] == [media_first_id, 'qa-recheck-second']
            assert media_saved['assets'] == media_before['assets'] and media_saved['providerJobs'] == media_before['providerJobs']
            assert media_saved['qualityReports'][-1]['id'] == media_original['id']
            assert media_saved['qualityReports'][-1]['evidence']['visualContinuity']['cuts']
            assert media_saved['qualityReports'][-1]['evidence']['visualContinuity']['cuts'][0]['atMs'] == 3000
            assert set(renders_dir.iterdir()) == directories
            assert not list(renders_dir.parent.glob('.rq-*'))
            project['mediaRecheckVerified'] = True
            project['savedReports'] = media_saved['qualityReports']
            report['paidGenerationCalls'] += sum(job['capability'] != 'deterministic-render' for job in saved['providerJobs'])
            assert all(Path(item['outputPath']).is_file() for item in project['renders'])

        report['phase'] = 'restart'
        stop()
        launch()
        for mode, project in report['projects'].items():
            assert qa.doc(page, project['id'])['qualityReports'] == project['savedReports']
            qa.open_project(page, project['title'], mode)
            qa.review(page, 'current', project['savedReports'][-1]['id'])
            project['restartVerified'] = True
            page.get_by_role('tab', name='字幕', exact=True).click()
            page.get_by_role('textbox', name='字幕内容', exact=True).fill('编辑后报告必须过期。')
            qa.review(page, 'stale', project['savedReports'][-1]['id'])
            qa.save_if_dirty(page)
        stop()
        launch()
        for mode, project in report['projects'].items():
            qa.open_project(page, project['title'], mode)
            qa.review(page, 'stale', project['savedReports'][-1]['id'])
            project['staleRestartVerified'] = True
        events = [json.loads(line) for line in (OUTPUT / 'lifecycle.jsonl').read_text(encoding='utf-8').splitlines()]
        report['blockedNetworkCalls'] = sum(event['event'] == 'network-blocked' for event in events)
        assert not report['runtimeErrors'] and report['paidGenerationCalls'] == 0 and report['blockedNetworkCalls'] == 0
        report['status'] = 'passed'
    except Exception as error:
        report['status'] = 'failed'
        report['error'] = str(error)
        report['failureProcessExitCode'] = child.poll() if child else None
        if page:
            try: page.screenshot(path=OUTPUT / 'failure.png')
            except Exception: pass
        raise
    finally:
        stop()
        playwright.stop()
        report['finishedAt'] = time.strftime('%Y-%m-%dT%H:%M:%S%z')
        (OUTPUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({'status': report['status'], 'report': str(OUTPUT / 'report.json')}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
