"""Sound editing QA: isolated Electron profile, local files, no synthesis calls."""
from __future__ import annotations

import importlib.util
import io
import json
import math
import os
import shutil
import struct
import subprocess
import tempfile
import time
import wave
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = Path(os.environ.get('STORYDREAM_QA_OUTPUT', str(ROOT / '.artifacts' / 'director-sound')))
TEMP_ROOT = Path(os.environ.get('STORYDREAM_QA_TEMP_ROOT', str(ROOT / '.artifacts' / 'subtitle-validation-temp')))
spec = importlib.util.spec_from_file_location('sound_qa_helpers', ROOT / 'scripts' / 'qa-motion-comic.py')
assert spec and spec.loader
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def wav_fixture(path: Path, frequency: int, amplitude: int, seconds: int = 5) -> None:
    with wave.open(str(path), 'wb') as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(32000)
        stream.writeframes(b''.join(struct.pack('<h', int(amplitude * math.sin(index * 2 * math.pi * frequency / 32000))) for index in range(32000 * seconds)))


def open_project(page, title: str, mode: str) -> None:
    if page.locator('.director-desk').is_visible():
        page.get_by_role('button', name='返回全部任务', exact=True).click()
        page.wait_for_selector("[data-task-operations='history']", timeout=30000)
    else:
        base.navigate_sidebar(page, 'history', "[data-task-operations='history']")
    page.get_by_role('textbox', name='搜索历史记录').fill(title)
    page.get_by_role('button', name=f'打开任务 {title}', exact=True).click()
    page.wait_for_selector(f"[data-{mode}-workbench='true'] .director-desk", timeout=30000)
    page.get_by_role('tab', name='声音', exact=True).click()
    expect(page.locator('[data-director-sound-inspector]')).to_be_visible()


def seed_project(page, mode: str, title: str, image_path: Path, speech: Path) -> dict:
    return page.evaluate("""async ({ mode, title, imagePath, speech }) => {
      if (mode === 'editorial-collage') await window.storydream.createEditorialCollage({ title, sourceText: '雨夜的城市渐渐安静。灯光照亮街道。人们沿着街角走远。', ratio: '16:9' });
      else await window.storydream.createMotionComic({ title, premise: '女孩在雨夜收到一封来信。', episodeTitle: '第一集', ratio: '16:9' });
      const tasks = await window.storydream.listTasks({ taskType: mode, limit: 50 });
      const id = tasks.items.find(item => item.title === title).id;
      const task = await window.storydream.getTaskDetail(id); const document = JSON.parse(task.pipelineData);
      const image = { id: 'qa-sound-image', assetId: 'qa-sound-image', kind: 'image', localPath: imagePath, provider: 'local-import', createdAt: document.createdAt, selected: true };
      const voice = { id: 'qa-sound-speech', assetId: 'qa-sound-speech', kind: 'audio', localPath: speech, provider: 'local-import', createdAt: document.createdAt, selected: true, durationMs: 3000 };
      document.assets.push(image, voice);
      const shot = mode === 'editorial-collage' ? document.beats[0].shots[0] : document.episodes[0].scenes[0].shots[0];
      shot.durationMs = 3000; shot.voiceAssetVersionId = voice.id;
      const cue = { id: 'qa-sound-cue', shotId: shot.id, startMs: 0, endMs: 3000, text: '雨夜的城市渐渐安静。' };
      const timeline = { durationMs: 3000, clips: [{ id: 'clip-' + shot.id, shotId: shot.id, startMs: 0, durationMs: 3000, assetVersionIds: [image.id], subtitleCueIds: [cue.id], source: 'deterministic' }], audioAssetVersionIds: [voice.id] };
      if (mode === 'editorial-collage') {
        shot.renderStrategy = 'deterministic-layers'; shot.subtitleCueIds = [cue.id];
        shot.layers = [{ ...shot.layers[0], assetVersionId: image.id, motion: [{ atMs: 0, x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 }, { atMs: 3000, x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 }] }];
        shot.camera = [{ atMs: 0, x: 0.5, y: 0.5, zoom: 1 }, { atMs: 3000, x: 0.5, y: 0.5, zoom: 1 }];
        document.beats = [{ ...document.beats[0], shots: [shot], startMs: 0, durationMs: 3000, subtitleCues: [{ id: cue.id, startMs: 0, endMs: 3000, text: cue.text }] }];
        document.timeline = timeline;
        await window.storydream.saveEditorialCollage({ id, expectedUpdatedAt: document.updatedAt, document });
      } else {
        shot.firstFrameAssetVersionId = image.id; shot.dialogueCueIds = [cue.id];
        const episode = document.episodes[0]; episode.scenes = [{ ...episode.scenes[0], shots: [shot] }];
        episode.dialogueCues = [{ ...cue, emotion: '自然' }]; episode.timeline = timeline; document.episodes = [episode];
        await window.storydream.saveMotionComic({ id, expectedUpdatedAt: document.updatedAt, document });
      }
      return { id, shotId: shot.id };
    }""", {'mode': mode, 'title': title, 'imagePath': str(image_path), 'speech': str(speech)})


def save(page) -> None:
    page.get_by_role('button', name='保存版本', exact=True).click()
    expect(page.get_by_role('button', name='保存版本', exact=True)).to_be_disabled(timeout=15000)


def state(page, task_id: str) -> dict:
    return page.evaluate("""async id => {
      const task = await window.storydream.getTaskDetail(id); const document = JSON.parse(task.pipelineData);
      const timeline = document.workflowKind === 'editorial-collage' ? document.timeline : document.episodes[0].timeline;
      return { clips: timeline.audioClips || [], timelineClips: timeline.clips, durationMs: timeline.durationMs, assets: document.assets, stage: document.stage, jobs: document.providerJobs, reports: document.qualityReports };
    }""", task_id)


def edit_number(page, name: str, value: int) -> None:
    field = page.get_by_role('spinbutton', name=name, exact=True)
    field.scroll_into_view_if_needed()
    field.fill(str(value))
    field.press('Enter')


def capture(page, name: str, size: tuple[int, int]) -> dict:
    base.set_window_size(page, *size)
    panel = page.locator('[data-director-sound-inspector]')
    page.locator('.director-inspector-scroll').evaluate('node => { node.scrollTop = 0; }')
    page.screenshot(path=ARTIFACTS / f'{name}-{size[0]}x{size[1]}-top.png', animations='disabled')
    checks = []
    for target in panel.locator('input, select, button').all():
        if not target.is_visible():
            continue
        target.scroll_into_view_if_needed()
        result = target.evaluate("""node => {
          const r = node.getBoundingClientRect(); const hit = document.elementFromPoint(r.x+r.width/2, r.y+r.height/2);
          return { label: node.getAttribute('aria-label') || node.textContent || node.type,
            fits: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
            hit: node === hit || node.contains(hit) };
        }""")
        if not result['fits'] or not result['hit']:
            raise AssertionError(f'Unreachable sound control: {result}')
        checks.append(result)
    overflow = page.evaluate('() => document.documentElement.scrollWidth > innerWidth')
    if overflow:
        raise AssertionError('Document horizontal overflow')
    page.screenshot(path=ARTIFACTS / f'{name}-{size[0]}x{size[1]}-bottom.png', animations='disabled')
    return {'size': size, 'controls': checks, 'horizontalOverflow': overflow}


def render_and_measure(page, task_id: str, mode: str, envelope: bool = False) -> dict:
    base.set_window_size(page, 1536, 1024)
    page.get_by_role('tab', name='生成', exact=True).click()
    render_button = page.get_by_role('button', name='生成成片', exact=True)
    expect(render_button).to_be_enabled()
    render_button.scroll_into_view_if_needed()
    render_button.focus()
    render_button.press('Enter')
    expect(render_button).to_be_disabled(timeout=5000)
    deadline = time.monotonic() + 90
    output = {}
    while time.monotonic() < deadline:
        output = state(page, task_id)
        asset = next((item for item in output['assets'] if item['assetId'] == 'director-final-video' and item.get('selected')), None)
        render_job = next((item for item in reversed(output['jobs']) if item['capability'] == 'deterministic-render'), None)
        if asset or (render_job and render_job['status'] == 'failed'):
            break
        page.wait_for_timeout(250)
    if not asset:
        raise AssertionError(f'No exported video: {output}')
    alignment = next((report.get('evidence', {}).get('narrationAlignment') for report in reversed(output.get('reports', [])) if report.get('stage') == 'export'), None)
    if not alignment or alignment.get('status') != 'passed':
        raise AssertionError(f'Real render did not persist passed narration alignment evidence: {alignment}')
    exported = ARTIFACTS / f'{mode}-sound-mix.mp4'
    shutil.copy2(asset['localPath'], exported)
    import imageio_ffmpeg
    result = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-i', str(exported), '-vn', '-ar', '32000', '-ac', '1', '-f', 'wav', 'pipe:1'], capture_output=True, check=True)
    with wave.open(io.BytesIO(result.stdout), 'rb') as stream:
        raw = stream.readframes(stream.getnframes())
        rate = stream.getframerate()
    samples = struct.unpack(f'<{len(raw)//2}h', raw)
    def rms(start: float, end: float) -> float:
        chunk = samples[int(rate*start):int(rate*end)]
        return math.sqrt(sum((value/32768)**2 for value in chunk)/len(chunk))
    measured = {'before': rms(.1, .4), 'middle': rms(.9, 1.3), 'after': rms(2, 2.8), 'durationSec': len(samples)/rate}
    # Narration was explicitly muted. Only the trimmed, -6dB sound should remain.
    # 7000-peak mono sine, -6dB mix, equal-power stereo conversion; allow AAC rounding.
    expected_rms = 7000 / 32768 * math.pow(10, -6 / 20) / 2
    if not envelope:
        measured['expectedMiddleRms'] = expected_rms
    if envelope:
        windows = []
        for start, end in [(.2, .4), (1.2, 1.4), (1.45, 1.55), (1.7, 2), (2.65, 2.75), (2.85, 2.99)]:
            gains = []
            for index in range(int(start*32000), int(end*32000)):
                elapsed = index/32000 - .2
                gains.append(min(1, elapsed/2) * min(1, (2.6-elapsed)/1.8) if 0 <= elapsed < 2.6 else 0)
            expected = 7000/32768 * math.pow(10, -9/20)/2 * math.sqrt(sum(gain*gain for gain in gains)/len(gains))
            actual = rms(start, end)
            windows.append({'start': start, 'end': end, 'expectedRms': expected, 'actualRms': actual})
            if abs(actual-expected) > max(.0004, expected*.025):
                raise AssertionError(f'Split fade mismatch in actual MP4: {windows[-1]}')
        measured['envelopeWindows'] = windows
    elif measured['before'] > .005 or measured['after'] > .005 or abs(measured['middle']-expected_rms) > expected_rms*.08:
        raise AssertionError(f'Actual MP4 does not match edited sound: {measured}')
    if abs(measured['durationSec']-3) > .15:
        raise AssertionError(f'Unexpected exported duration: {measured}')
    return {'path': str(exported), 'measurements': measured, 'narrationAlignment': alignment}


def exercise_audio_structure(page, image_path: Path, speech: Path) -> dict:
    title = '镜头音频结构验收'
    mode = 'editorial-collage'
    fixture = seed_project(page, mode, title, image_path, speech)
    open_project(page, title, mode)
    panel = page.locator('[data-director-sound-inspector]')
    panel.get_by_role('checkbox', name='静音此片段', exact=True).check()
    panel.get_by_role('button', name='导入本地音频', exact=True).click()
    choice = panel.get_by_role('combobox', name='声音片段', exact=True)
    expect(choice.locator('option')).to_have_count(2, timeout=20000)
    choice.select_option(index=1)
    for name, value in [('片段时长（毫秒）', 2800), ('源使用时长（毫秒）', 2600), ('源裁剪起点（毫秒）', 500),
                        ('镜头内起点（毫秒）', 200), ('音量（dB）', -9), ('淡入（毫秒）', 2000), ('淡出（毫秒）', 1800)]:
        edit_number(page, name, value)
    save(page)
    original = state(page, fixture['id'])
    exports = {'original': render_and_measure(page, fixture['id'], 'structure-original', envelope=True)}
    open_project(page, title, mode)
    base.set_window_size(page, 1536, 1024)
    page.get_by_role('button', name='拆分当前镜头', exact=True).click()
    expect(page.locator('.director-shot-row')).to_have_count(2)
    save(page)
    split = state(page, fixture['id'])
    music = [clip for clip in split['clips'] if clip['trackType'] == 'music']
    narration = [clip for clip in split['clips'] if clip['trackType'] == 'narration']
    assert [clip['durationMs'] for clip in music] == [1300, 1500]
    assert [clip['sourceStartMs'] for clip in music] == [500, 1800]
    assert [clip['sourceDurationMs'] for clip in music] == [1300, 1300]
    assert [clip['fadeEnvelope']['offsetMs'] for clip in music] == [0, 1300]
    assert len(narration) == 2 and all(clip['muted'] for clip in narration)
    assert not any(asset.get('selected') for asset in split['assets'] if asset['assetId'] == 'director-final-video')
    open_project(page, title, mode)
    assert state(page, fixture['id'])['clips'] == split['clips']
    page.locator('.director-shot-row').nth(1).click()
    choice.select_option(music[1]['id'])
    expect(page.get_by_role('spinbutton', name='源裁剪起点（毫秒）', exact=True)).to_have_value('1800')
    captures = [capture(page, 'structure-split', size) for size in [(1536, 1024), (1040, 720)]]
    panel.get_by_role('button', name='定位片段', exact=True).click()
    page.locator('.director-preview-transport').get_by_role('button', name='播放', exact=True).click()
    page.wait_for_function("""id => { const audio = [...document.querySelectorAll('audio[data-audio-clip-id]')].find(node => node.dataset.audioClipId === id);
        return audio && !audio.paused && audio.currentTime >= 1.8 && audio.currentTime < 2.9; }""", arg=music[1]['id'], timeout=10000)
    page.locator('.director-preview-transport').get_by_role('button', name='暂停', exact=True).click()
    exports['split'] = render_and_measure(page, fixture['id'], 'structure-split', envelope=True)
    open_project(page, title, mode)
    page.locator('.director-shot-row').nth(0).click()
    page.get_by_role('button', name='合并当前镜头与下一镜头', exact=True).click()
    expect(page.locator('.director-shot-row')).to_have_count(1)
    save(page)
    merged = state(page, fixture['id'])
    assert len(merged['clips']) == 4 and len({clip['shotId'] for clip in merged['clips']}) == 1
    exports['merged'] = render_and_measure(page, fixture['id'], 'structure-merged', envelope=True)
    open_project(page, title, mode)
    page.get_by_role('button', name='新增镜头', exact=True).click()
    expect(page.locator('.director-shot-row')).to_have_count(2)
    page.get_by_role('button', name='上移当前镜头', exact=True).click()
    save(page)
    moved = state(page, fixture['id'])
    assert moved['durationMs'] == 6000
    assert [clip['startMs'] for clip in moved['clips'] if clip['trackType'] == 'music'] == [3200, 4500]
    page.get_by_role('button', name='删除当前镜头', exact=True).click()
    page.get_by_role('button', name='删除镜头', exact=True).click()
    expect(page.locator('.director-shot-row')).to_have_count(1)
    save(page)
    open_project(page, title, mode)
    restored = state(page, fixture['id'])
    assert restored['durationMs'] == 3000 and restored['clips'] == merged['clips']
    return {'original': original['clips'], 'split': split['clips'], 'merged': merged['clips'], 'moved': moved['clips'],
            'captures': captures, 'exports': exports, 'previewSourceResumed': True, 'savedReopened': True, 'oldExportInvalidated': True}


def main() -> None:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    TEMP_ROOT.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix='director-sound-', dir=TEMP_ROOT))
    sound = profile / 'rain-tone.wav'
    speech = profile / 'speech-tone.wav'
    wav_fixture(sound, 660, 7000)
    wav_fixture(speech, 330, 5000, seconds=3)
    image_path = base.create_reference_fixtures(profile / 'images')[0]
    preload = profile / 'sound-dialog.cjs'
    preload.write_text("setImmediate(()=>{ const {app,dialog}=require('electron');\n"
        "globalThis.fetch=()=>Promise.reject(new Error('Sound QA has no network requests'));\n"
        "app.whenReady().then(()=>{ dialog.showOpenDialog=async()=>({canceled:false,filePaths:[" + json.dumps(str(sound)) + "]}); }); });\n", encoding='utf-8')
    env = os.environ.copy()
    env.update({'NODE_ENV': 'production', 'NODE_OPTIONS': f'--require="{preload.as_posix()}"', 'TEMP': str(TEMP_ROOT), 'TMP': str(TEMP_ROOT)})
    env.pop('VITE_DEV_SERVER_URL', None)
    env.pop('ELECTRON_RUN_AS_NODE', None)
    port = base.available_port()
    flags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0
    process = subprocess.Popen([str(base.ELECTRON), f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1', '--remote-allow-origins=*', f'--user-data-dir={profile}', str(ROOT)], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=flags)
    report = {'status': 'running', 'modes': {}, 'paidGenerationCalls': 0, 'runtimeErrors': []}
    page = None
    try:
        endpoint = base.wait_for_cdp(port, process)
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(endpoint)
            page = browser.contexts[0].pages[0]
            try:
                page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
                base.wait_for_app(page)
                for mode in ['editorial-collage', 'motion-comic']:
                    title = '声音设计验收 · ' + mode
                    fixture = seed_project(page, mode, title, image_path, speech)
                    open_project(page, title, mode)
                    panel = page.locator('[data-director-sound-inspector]')
                    panel.get_by_role('checkbox', name='静音此片段', exact=True).check()
                    panel.get_by_role('button', name='导入本地音频', exact=True).click()
                    expect(panel.get_by_role('combobox', name='声音片段', exact=True).locator('option')).to_have_count(2, timeout=20000)
                    panel.get_by_role('combobox', name='声音片段', exact=True).select_option(index=1)
                    edit_number(page, '片段时长（毫秒）', 1000)
                    edit_number(page, '源使用时长（毫秒）', 1000)
                    edit_number(page, '源裁剪起点（毫秒）', 250)
                    edit_number(page, '镜头内起点（毫秒）', 500)
                    edit_number(page, '音量（dB）', -6)
                    edit_number(page, '淡入（毫秒）', 100)
                    edit_number(page, '淡出（毫秒）', 100)
                    panel.get_by_role('combobox', name='片段轨道', exact=True).select_option('sfx')
                    edit_number(page, '镜头内起点（毫秒）', 2900)
                    expect(panel.locator('p[role="alert"]')).to_contain_text('声音编辑失败')
                    edit_number(page, '镜头内起点（毫秒）', 500)
                    save(page)
                    before = state(page, fixture['id'])
                    open_project(page, title, mode)
                    after = state(page, fixture['id'])
                    if before != after:
                        raise AssertionError('Sound mix changed after save/reopen')
                    clips = after['clips']
                    assert clips[0]['muted'] is True and clips[1]['gainDb'] == -6 and clips[1]['startMs'] == 500
                    assert clips[1]['sourceStartMs'] == 250 and clips[1]['sourceDurationMs'] == 1000 and clips[1]['sourceMediaDurationMs'] == 5000
                    audio_asset = next(item for item in after['assets'] if item['id'] == clips[1]['assetVersionId'])
                    assert Path(audio_asset['localPath']).is_file() and audio_asset['localPath'] != str(sound)
                    panel.get_by_role('combobox', name='声音片段', exact=True).select_option(index=1)
                    checks = [capture(page, mode, size) for size in [(1536, 1024), (1040, 720)]]
                    panel.get_by_role('button', name='定位片段', exact=True).click()
                    page.locator('.director-preview-transport').get_by_role('button', name='播放', exact=True).click()
                    page.wait_for_function("""() => { const clips=[...document.querySelectorAll('audio[data-audio-clip-id]')]; return clips.length===2 && clips[0].paused && !clips[1].paused && clips[1].currentTime>.3; }""", timeout=15000)
                    page.locator('.director-preview-transport').get_by_role('button', name='暂停', exact=True).click()
                    expect(page.locator('audio[data-audio-clip-id]')).to_have_count(2)
                    exported = render_and_measure(page, fixture['id'], mode)
                    page.get_by_role('button', name='配音字幕', exact=True).click()
                    page.get_by_role('tab', name='声音', exact=True).click()
                    panel.get_by_role('combobox', name='声音片段', exact=True).select_option(index=1)
                    panel.get_by_role('button', name='移除片段', exact=True).click()
                    save(page)
                    removed = state(page, fixture['id'])
                    assert len(removed['clips']) == 1 and removed['clips'][0]['muted']
                    assert not any(item.get('selected') for item in removed['assets'] if item['assetId'] == 'director-final-video')
                    report['modes'][mode] = {'persisted': after, 'captures': checks, 'export': exported, 'removedSoundInvalidatedExport': True}
                report['audioStructure'] = exercise_audio_structure(page, image_path, speech)
                if report['runtimeErrors']:
                    raise AssertionError(report['runtimeErrors'])
                report['status'] = 'passed'
            except Exception:
                page.screenshot(path=ARTIFACTS / '99-failure.png')
                report['failureText'] = page.locator('body').inner_text()[-7000:]
                raise
            finally:
                browser.close()
    except Exception as error:
        report['status'] = 'failed'
        report['error'] = str(error)
        raise
    finally:
        report['finishedAt'] = time.strftime('%Y-%m-%dT%H:%M:%S%z')
        (ARTIFACTS / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        if process.poll() is None:
            process.terminate()
        try:
            stdout, stderr = process.communicate(timeout=15)
        except subprocess.TimeoutExpired:
            process.kill()
            stdout, stderr = process.communicate()
        (ARTIFACTS / 'electron.log').write_bytes(stdout + stderr)


if __name__ == '__main__':
    main()
