"""Measure authored subtitle geometry in actual Electron MP4 exports, with local media."""
from __future__ import annotations

import importlib.util
import json
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path(os.environ.get('STORYDREAM_QA_OUTPUT', str(ROOT / '.artifacts/director-subtitle-layout-qa')))
MIXED_LONG_TITLE = '東京의 城市更新 · 2026：一个很长的中英日韩标题与Supercalifragilisticexpialidocious混排边界样例'
spec = importlib.util.spec_from_file_location('subtitle_qa', ROOT / 'scripts/qa-director-quality-confirmation.py')
assert spec and spec.loader
qa = importlib.util.module_from_spec(spec); spec.loader.exec_module(qa)
qa.ARTIFACTS = OUTPUT; qa.quality.ARTIFACTS = OUTPUT


def configure(page, task_id, mode, ratio, overflow, overlap=False, glyph_missing=False, long_title=False, empty_subtitles=False, documentary=False, mixed_long_title=False):
    page.evaluate(r'''async ({ id, mode, ratio, overflow, overlap, glyphMissing, longTitle, emptySubtitles, documentary, mixedLongTitle }) => {
      const document = JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData);
      document.ratio = ratio;
      const vox = mode === 'editorial-collage';
      const owner = vox ? document.beats[0] : document.episodes[0].scenes[0];
      const title = mixedLongTitle ? '東京의 城市更新 · 2026：一个很长的中英日韩标题与Supercalifragilisticexpialidocious混排边界样例' : longTitle ? '这是一个用于验证长标题在横屏竖屏与纪录片版式下仍能完整落在安全区内的超长标题样例，不能被裁切，也不能覆盖字幕或播放控件。' : '真实字幕排版检验';
      owner.title = title;
      if (!vox) owner.shots.forEach(shot => { shot.title = title; });
      if (documentary && !vox) owner.shots.forEach(shot => { shot.layoutTemplate = '纪录片 · 纯画面'; });
      const cues = vox ? owner.subtitleCues : document.episodes[0].dialogueCues;
      if (emptySubtitles) {
        if (vox) {
          owner.subtitleCues = [];
          owner.shots.forEach(shot => { shot.subtitleCueIds = []; });
          document.timeline.clips.forEach(clip => { clip.subtitleCueIds = []; });
        } else {
          document.episodes[0].dialogueCues = [];
          document.episodes[0].scenes.forEach(scene => scene.shots.forEach(shot => { shot.dialogueCueIds = []; }));
          document.episodes[0].timeline.clips.forEach(clip => { clip.subtitleCueIds = []; });
        }
      } else {
        cues.find(cue => cue.id === 'qa-recheck-cue-2').text = overflow ? '超长字幕需要复核画面边界。'.repeat(140) : '中文第一行\n\n中文第三行';
        cues.find(cue => cue.id === 'qa-recheck-cue-3').text = glyphMissing ? String.fromCodePoint(0x10ffff) : 'Supercalifragilisticexpialidocious'.repeat(3);
        cues.find(cue => cue.id === 'qa-recheck-cue-3').startMs = cues.find(cue => cue.id === 'qa-recheck-cue-2').startMs + (overlap ? 500 : 1400);
      }
      await (vox ? window.storydream.saveEditorialCollage : window.storydream.saveMotionComic)({ id, expectedUpdatedAt: document.updatedAt, document });
    }''', {'id': task_id, 'mode': mode, 'ratio': ratio, 'overflow': overflow, 'overlap': overlap, 'glyphMissing': glyph_missing, 'longTitle': long_title, 'emptySubtitles': empty_subtitles, 'documentary': documentary, 'mixedLongTitle': mixed_long_title})


def capture_preview_consistency(page, name, layout, report, expected_layout='comic', expected_title='真实字幕排版检验', title_tolerance=.008):
    page.set_viewport_size({'width': 1536, 'height': 1024})
    page.locator('.director-filmstrip-card').nth(1).click()
    page.get_by_role('tab', name='字幕', exact=True).click()
    for size in [(1536, 1024), (1040, 720)]:
        page.set_viewport_size({'width': size[0], 'height': size[1]})
        if size[0] <= 1180 and page.locator('.director-desk').get_attribute('data-left-pane-open') == 'true':
            page.get_by_role('button', name='显示项目与镜头', exact=True).click()
        for cue_id in ['qa-recheck-cue-2', 'qa-recheck-cue-3']:
            page.get_by_role('combobox', name='字幕句子', exact=True).select_option(cue_id)
            page.get_by_role('button', name='定位本句', exact=True).click()
            preview = page.locator('.director-media-preview')
            preview.scroll_into_view_if_needed()
            expect(preview).to_have_class(re.compile(rf'director-layout-{expected_layout}'))
            expect(page.locator(f'[data-active-subtitle-cue="{cue_id}"]')).to_be_visible()
            data = preview.evaluate('''root => {
              const box = root.getBoundingClientRect();
              const normalize = rect => rect && ({ x: (rect.x - box.x) / box.width, y: (rect.y - box.y) / box.height,
                width: rect.width / box.width, height: rect.height / box.height });
              const textRect = element => {
                const range = document.createRange(); range.selectNodeContents(element);
                return normalize(range.getBoundingClientRect());
              };
              const title = root.querySelector('.director-preview-title');
              const controls = document.querySelector('.director-preview-transport');
              const transport = controls.getBoundingClientRect();
              return { ratio: box.width / box.height, layoutClass: root.className, title: title.textContent, titleBounds: textRect(title),
                titleComputed: { fontSize: getComputedStyle(title).fontSize, lineHeight: getComputedStyle(title).lineHeight, width: title.getBoundingClientRect().width },
                width: box.width, height: box.height, transportOutside: transport.top >= box.bottom - 1,
                visible: box.top >= 56 && transport.bottom <= innerHeight - 38,
                controlsFit: [...controls.querySelectorAll('button,input')].every(element => {
                  const rect = element.getBoundingClientRect(); return rect.left >= transport.left - 1 && rect.right <= transport.right + 1;
                }),
                overflow: document.documentElement.scrollWidth > innerWidth,
                cues: [...root.querySelectorAll('[data-preview-subtitle-cue]')].map(element => ({
                  id: element.dataset.previewSubtitleCue, active: !element.hidden,
                  bounds: normalize(element.getBoundingClientRect()),
                  fontSize: parseFloat(getComputedStyle(element).fontSize) / box.height,
                  fontFamily: getComputedStyle(element).fontFamily })) };
            }''')
            assert abs(data['ratio'] - layout['width'] / layout['height']) < .001, data
            assert data['title'] == expected_title, data
            assert data['transportOutside'] and data['visible'] and data['controlsFit'] and not data['overflow'], data
            expected_active = sum(cue['startMs'] <= next(item['startMs'] for item in layout['cues'] if item['cueId'] == cue_id) < cue['endMs'] for cue in layout['cues'])
            assert sum(cue['active'] for cue in data['cues']) == expected_active, data
            comparisons = [('title', data['titleBounds'], layout['titleBounds'])]
            for actual, expected in zip(data['cues'], layout['cues'], strict=True):
                assert actual['id'] == expected['cueId'] and actual['fontFamily'] == expected['fontFamily'], actual
                assert abs(actual['fontSize'] - expected['fontSize'] / layout['height']) < .001, actual
                comparisons.append((actual['id'], actual['bounds'], expected['bounds']))
            for label, actual, expected in comparisons:
                for key, dimension in [('x', 'width'), ('y', 'height'), ('width', 'width'), ('height', 'height')]:
                    tolerance = title_tolerance if label == 'title' else (.05 if 'long-title' in name else .008)
                    assert abs(actual[key] - expected[key] / layout[dimension]) < tolerance, (name, label, key, actual, expected)
            filename = f'preview-{name}-{cue_id}-{size[0]}x{size[1]}.png'
            page.screenshot(path=OUTPUT / filename, animations='disabled')
            preview.screenshot(path=OUTPUT / ('canvas-' + filename), animations='disabled')
            report.setdefault('previewComparisons', []).append({'file': filename, **data})
    page.set_viewport_size({'width': 1536, 'height': 1024})


def main():
    cases = os.environ.get('STORYDREAM_QA_SUBTITLE_CASES', 'normal,overflow,overlap').split(',')
    assert cases and all(case in ['normal', 'overflow', 'overlap', 'visibility-failure', 'glyph-missing', 'long-title', 'mixed-long-title', 'empty', 'documentary'] for case in cases), cases
    OUTPUT.mkdir(parents=True, exist_ok=True)
    qa.quality.TEMP_ROOT.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix='subtitle-layout-', dir=qa.quality.TEMP_ROOT))
    voice = profile / 'voice.wav'; qa.sound.wav_fixture(voice, 330, 8000)
    image = qa.base.create_reference_fixtures(profile / 'images')[0]
    ffmpeg = next((ROOT / 'vendor/python/Lib/site-packages/imageio_ffmpeg/binaries').glob('ffmpeg*.exe'))
    env = {**os.environ, 'NODE_ENV': 'production', 'TEMP': str(qa.quality.TEMP_ROOT), 'TMP': str(qa.quality.TEMP_ROOT),
           'STORYDREAM_QA_LIFECYCLE_LOG': str(OUTPUT / 'lifecycle.jsonl'), 'STORYDREAM_QA_FAULT_DIR': str(profile)}
    for key in ['NODE_OPTIONS', 'VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE']: env.pop(key, None)
    report = {'status': 'running', 'startedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'profile': str(profile),
              'runtimeErrors': [], 'captures': [], 'projects': [], 'renders': [], 'paidGenerationCalls': None}
    child = browser = page = None
    playwright = sync_playwright().start()

    def launch():
        nonlocal child, browser, page
        port = qa.base.available_port()
        with (OUTPUT / 'electron.log').open('ab') as log:
            child = subprocess.Popen([str(qa.base.ELECTRON), f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1',
                '--remote-allow-origins=*', f'--user-data-dir={profile}', str(ROOT / 'scripts/qa-director-lifecycle.cjs')], cwd=ROOT, env=env,
                stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP)
        browser = playwright.chromium.connect_over_cdp(qa.base.wait_for_cdp(port, child))
        page = browser.contexts[0].pages[0]
        page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
        page.on('crash', lambda: report['runtimeErrors'].append('Renderer crashed'))
        qa.base.wait_for_app(page)

    def stop():
        nonlocal child, browser, page
        if browser: browser.close()
        if child and child.poll() is None:
            child.terminate()
            try: child.wait(timeout=15)
            except subprocess.TimeoutExpired: child.kill(); child.wait(timeout=10)
        child = browser = page = None

    try:
        launch()
        for mode in ['editorial-collage', 'motion-comic']:
            for ratio in ['16:9', '9:16']:
                title = '字幕排版验收 ' + mode + ' ' + ratio
                fixture = qa.sound.seed_project(page, mode, title, image, voice)
                task_id = fixture['id']; qa.add_navigation_fixture(page, task_id, mode)
                for case in cases:
                    name = mode + '-' + ratio.replace(':', 'x') + '-' + case
                    report['phase'] = name
                    configure(page, task_id, mode, ratio, case == 'overflow', case == 'overlap', case == 'glyph-missing', case in ['long-title', 'mixed-long-title'], case == 'empty', case == 'documentary', case == 'mixed-long-title')
                    try:
                        if case == 'visibility-failure':
                            (profile / 'subtitle-visibility-fail.flag').write_text('fail', encoding='utf-8')
                        result = page.evaluate('async id => (await window.storydream.renderDirectorProject({ id })).result', task_id)
                    except Exception as error:
                        if case == 'empty' and 'DIRECTOR_RENDER_QUALITY_GATE_FAILED' in str(error):
                            report.setdefault('boundaryRejections', []).append({'name': name, 'reason': 'empty-subtitle-quality-gate'})
                            continue
                        raise
                    saved = qa.doc(page, task_id); entry = saved['qualityReports'][-1]
                    assert entry == json.loads(Path(result['outputPath'] + '.render.json').read_text(encoding='utf-8'))['report']
                    layout = entry['evidence']['subtitleLayout']
                    assert len(layout['scenes']) == 2 and all(scene['status'] == 'ok' for scene in layout['scenes']), layout
                    second = layout['scenes'][1]
                    expected_size = (1920, 1080) if ratio == '16:9' else (1080, 1920)
                    assert (second['width'], second['height']) == expected_size
                    assert [cue['startMs'] for cue in second['cues']] == ([] if case == 'empty' else [3000, 3500 if case == 'overlap' else 4400])
                    check = next(item for item in entry['checks'] if item['id'] == 'subtitle-text-safety')
                    glyph_check = next(item for item in entry['checks'] if item['id'] == 'subtitle-glyphs')
                    all_cues = [cue for scene in layout['scenes'] for cue in scene['cues']]
                    if case == 'glyph-missing':
                        assert glyph_check['status'] == 'failed', glyph_check
                        assert any(cue['glyphCoverage']['status'] == 'failed' and cue['glyphCoverage']['missingCodePoints']
                                   for cue in all_cues), layout
                    elif case == 'empty':
                        assert glyph_check['status'] in ('pending', 'passed'), glyph_check
                    else:
                        assert glyph_check['status'] == 'passed', glyph_check
                        assert all(cue.get('glyphCoverage', {}).get('status') == 'ok'
                                   and cue['glyphCoverage']['renderedCodePointCount'] >= cue['glyphCoverage']['codePointCount']
                                   and cue['glyphCoverage'].get('verification') == 'font-engine'
                                   and cue['glyphCoverage'].get('glyphCount', 0) >= cue['glyphCoverage']['codePointCount']
                                   and cue['glyphCoverage'].get('fontFamilies')
                                   and not cue['glyphCoverage']['missingCodePoints']
                                   for cue in all_cues), layout
                    if case == 'empty':
                        assert not all_cues and check['status'] == 'passed', (layout, check)
                        assert glyph_check['status'] == 'passed', glyph_check
                    elif case in ['normal', 'long-title', 'mixed-long-title', 'documentary']:
                        assert check['status'] == 'passed', check
                        assert not second['titleOutsideSafeArea'], second
                        if case != 'long-title':
                            assert second['cues'][0]['lineCount'] == 3, second['cues'][0]
                            assert 2 <= second['cues'][1]['lineCount'] <= 3, second['cues'][1]
                        assert not any(cue['issues'] for cue in second['cues']), second
                    elif case == 'overflow':
                        assert check['status'] == 'failed', check
                        assert 'qa-recheck-second' in check['recheckScope']['shotIds']
                        assert 'qa-recheck-cue-2' in check['recheckScope']['cueIds']
                        assert second['cues'][0]['lineCount'] > 3 and 'outside-safe-area' in second['cues'][0]['issues']
                    elif case == 'overlap':
                        assert check['status'] == 'failed', check
                        assert check['recheckScope']['shotIds'] == ['qa-recheck-second'], check
                        assert set(check['recheckScope']['cueIds']) == {'qa-recheck-cue-2', 'qa-recheck-cue-3'}, check
                        assert all('cue-overlap' in cue['issues'] for cue in second['cues']), second
                    for stamp in [3.5, 5]:
                        frame_path = OUTPUT / f'{name}-{stamp}.png'
                        subprocess.run([str(ffmpeg), '-v', 'error', '-ss', str(stamp), '-i', result['outputPath'], '-frames:v', '1', '-y', str(frame_path)], check=True, capture_output=True)
                    qa.open_project(page, title, mode)
                    region = qa.review(page, 'current', entry['id'])
                    expect(region).to_contain_text('2/2 镜头')
                    expect(region.locator('.director-quality-badge')).to_have_text('已通过' if case in ['normal', 'long-title', 'mixed-long-title', 'empty', 'documentary'] else '可导出 · 待复核')
                    qa.quality.capture_review(page, name, report)
                    if case in ['overflow', 'overlap']:
                        region.locator('.director-quality-check').filter(has_text='字幕、标题排版与画面安全区').get_by_role('button', name='定位复检范围', exact=True).click()
                        expect(page.get_by_role('combobox', name='字幕句子', exact=True)).to_have_value('qa-recheck-cue-2')
                    if case == 'visibility-failure':
                        visibility_check = next(item for item in entry['checks'] if item['id'] == 'subtitle-visibility')
                        assert visibility_check['status'] == 'pending', visibility_check
                        assert visibility_check.get('recheckScope', {}).get('kind') == 'subtitle', visibility_check
                    assert qa.doc(page, task_id)['qualityReports'][-1] == entry
                    if case in ['normal', 'long-title', 'mixed-long-title', 'documentary', 'overlap']:
                        expected_title = MIXED_LONG_TITLE if case == 'mixed-long-title' else ('这是一个用于验证长标题在横屏竖屏与纪录片版式下仍能完整落在安全区内的超长标题样例，不能被裁切，也不能覆盖字幕或播放控件。' if case == 'long-title' else '真实字幕排版检验')
                        capture_preview_consistency(page, name, second, report, 'documentary' if case == 'documentary' and mode != 'editorial-collage' else ('collage' if mode == 'editorial-collage' else 'comic'), expected_title, .008)
                    report['renders'].append({'name': name, 'reportId': entry['id'], 'geometryStatus': check['status'], 'layout': layout})
                report['projects'].append({'id': task_id, 'title': title, 'mode': mode, 'reports': qa.doc(page, task_id)['qualityReports']})
        if 'empty' in cases:
            report['phase'] = 'boundary-complete'
            report['boundaryOnly'] = True
            report['status'] = 'passed'
            return
        report['phase'] = 'measurement-failure'
        project = report['projects'][-1]
        configure(page, project['id'], project['mode'], '9:16', False)
        (profile / 'subtitle-measurement-fail.flag').write_text('fail', encoding='utf-8')
        page.evaluate('async id => window.storydream.renderDirectorProject({ id })', project['id'])
        entry = qa.doc(page, project['id'])['qualityReports'][-1]
        assert next(item for item in entry['checks'] if item['id'] == 'subtitle-text-safety')['status'] == 'pending'
        assert entry['evidence']['subtitleLayout']['scenes'][0]['status'] == 'failed'
        qa.open_project(page, project['title'], project['mode'])
        qa.review(page, 'current', entry['id']); qa.quality.capture_review(page, 'measurement-failure', report)
        project['reports'] = qa.doc(page, project['id'])['qualityReports']
        report['measurementFailureVerified'] = True
        report['phase'] = 'restart'
        stop(); launch()
        for project in report['projects']:
            assert qa.doc(page, project['id'])['qualityReports'] == project['reports']
            project['restartVerified'] = True
        report['paidGenerationCalls'] = sum(job['capability'] != 'deterministic-render' for project in report['projects'] for job in qa.doc(page, project['id'])['providerJobs'])
        events = [json.loads(line) for line in (OUTPUT / 'lifecycle.jsonl').read_text(encoding='utf-8').splitlines()]
        assert sum(event['event'] == 'subtitle-measurement-fail' for event in events) == 1
        assert not any(event['event'] in ['network-blocked', 'render-process-gone', 'child-process-gone'] for event in events)
        assert not report['runtimeErrors'] and report['paidGenerationCalls'] == 0
        report['status'] = 'passed'
    except Exception as error:
        report['status'] = 'failed'; report['error'] = str(error)
        report['failureProcessExitCode'] = child.poll() if child else None
        if page and not page.is_closed(): page.screenshot(path=OUTPUT / 'failure.png')
        raise
    finally:
        stop(); playwright.stop()
        report['finishedAt'] = time.strftime('%Y-%m-%dT%H:%M:%S%z')
        (OUTPUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({'status': report['status'], 'report': str(OUTPUT / 'report.json')}))


if __name__ == '__main__': main()
