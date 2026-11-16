"""Offline acceptance: production HTML capture and unmodified production compositor."""
import importlib.util
import json
import math
import pathlib
import struct
import subprocess
import sys
import wave
from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

out = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location('production_sidecar', sys.argv[2])
sidecar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sidecar)
commands = []
real_run = sidecar.run_ffmpeg
def logged(args, **kwargs):
    commands.append(args)
    return real_run(args, **kwargs)
sidecar.run_ffmpeg = logged

def tone(name, frequency, seconds):
    rate = 48000
    with wave.open(str(out / name), 'wb') as w:
        w.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
        w.writeframes(b''.join(struct.pack('<h', round(7000 * math.sin(2 * math.pi * frequency * i / rate))) for i in range(round(rate * seconds))))

if sys.argv[3] == 'fixtures':
    Image.new('RGB', (640, 360), '#777777').save(out / 'reference.png')
    tone('dialogue-red.wav', 440, 2.5)
    tone('dialogue-blue.wav', 660, 2.5)
    tone('music.wav', 220, 5)
    for color in ['red', 'blue']:
        # Fixture creation only. Final mux, audio mix and encoding use production sidecar unchanged.
        sidecar.run_ffmpeg(['-f', 'lavfi', '-i', f'color=c={color}:s=640x360:r=24:d=2.5', '-i', str(out / f'dialogue-{color}.wav'), '-t', '2.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', str(out / f'{color}.mp4')])
    raise SystemExit(0)

fixture = json.loads((out / 'fixture.json').read_text(encoding='utf-8'))
captures = []
compose_scenes = []
with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True, args=['--allow-file-access-from-files'])
    try:
        page = browser.new_page(viewport={'width': 640, 'height': 360}, device_scale_factor=1)
        for index, scene in enumerate(fixture['scenes']):
            frames = out / f'frames-{index}'
            frames.mkdir(exist_ok=True)
            page.goto((out / f'scene-{index}.html').as_uri())
            page.wait_for_function('window.__ready === true || window.__mediaError')
            assert not page.evaluate('window.__mediaError')
            for n in range(60):
                page.evaluate('(t) => window.__tl.seek(t)', n / 24)
                page.screenshot(path=str(frames / f'frame_{n+1:04d}.jpg'), type='jpeg', quality=95)
            page.evaluate('window.__tl.seek(1)')
            visible = page.locator('.caption:not([hidden])').inner_text()
            assert visible == scene['subtitleCues'][0]['text']
            page.screenshot(path=str(out / f'caption-{index}.png'))
            page.locator('.caption').evaluate_all('(nodes) => nodes.forEach(n => n.style.visibility="hidden")')
            page.screenshot(path=str(out / f'no-caption-{index}.png'))
            diff = ImageChops.difference(Image.open(out / f'caption-{index}.png').convert('RGB'), Image.open(out / f'no-caption-{index}.png').convert('RGB'))
            changed = sum(max(pixel) > 30 for pixel in diff.getdata())
            assert changed > 100
            captures.append({'scene': index, 'subtitleText': visible, 'subtitleChangedPixels': changed})
            compose_scenes.append({'frames_dir': str(frames), 'audio_path': scene['audioPath'], 'audio_clips': scene.get('audioClips', []), 'fps': 24, 'duration_s': 2.5, 'video_frame_count': 60})
    finally:
        browser.close()
payload = {'mode': 'compose_render', 'work_dir': str(out), 'scenes': compose_scenes, 'output_path': str(out / 'sample.mp4'), 'total_duration_s': 5, 'canvas_w': 640, 'canvas_h': 360, 'normalize_audio': True, 'transition': {'type': 'cut', 'duration': 0}}
(out / 'compose-input.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')
result = sidecar.generate_compose_render(payload)
probe = sidecar.probe_media({'work_dir': str(out), 'media_path': str(out / 'sample.mp4'), 'analyze_quality': True, 'require_nonblack': True, 'visual_continuity_points_ms': [2500], 'visual_continuity_fps': 24})
assert probe['visual_continuity']['status'] == 'ok'
ffprobe = sidecar.ffprobe_exe()
if not ffprobe:
    ffprobe = str(pathlib.Path('.tmp/video-shotcraft-analysis-src/workbench/node_modules/@remotion/compositor-win32-x64-msvc/ffprobe.exe').resolve())
assert pathlib.Path(ffprobe).is_file(), 'Existing ffprobe required for final acceptance'
completed = subprocess.run([ffprobe, '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(out / 'sample.mp4')], capture_output=True, text=True, check=True, timeout=60)
stream_probe = json.loads(completed.stdout)
(out / 'ffprobe.json').write_text(completed.stdout, encoding='utf-8')
assert {s['codec_type'] for s in stream_probe['streams']} >= {'video', 'audio'}
assert abs(float(stream_probe['format']['duration']) - 5) < .16
assert probe['audio_is_silent'] is False and probe['audio_mean_volume_db'] > -40
samples = []
for t, expected in [(0.25, 'blue'), (1, 'blue'), (2.45, 'blue'), (2.55, 'red'), (3.5, 'red'), (4.75, 'red')]:
    image = out / f'sample-{t}.png'
    sidecar.run_ffmpeg(['-ss', str(t), '-i', str(out / 'sample.mp4'), '-frames:v', '1', str(image)])
    im = Image.open(image).convert('RGB')
    pixels = list(im.crop((160, 80, 480, 150)).getdata())
    rgb = [sum(p[c] for p in pixels) / len(pixels) for c in range(3)]
    assert rgb[2 if expected == 'blue' else 0] > max(rgb[1], rgb[0 if expected == 'blue' else 2]) + 80
    # White glyphs in lower central region are absent outside the cue interval.
    white = sum(min(p) > 200 for p in im.crop((70, 210, 570, 335)).getdata())
    samples.append({'time': t, 'expected': expected, 'meanRGB': rgb, 'subtitleWhitePixels': white})
assert samples[1]['subtitleWhitePixels'] > samples[0]['subtitleWhitePixels'] + 100
assert samples[4]['subtitleWhitePixels'] > samples[5]['subtitleWhitePixels'] + 100
sidecar.run_ffmpeg(['-i', str(out / 'sample.mp4'), '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', str(out / 'decoded.wav')])
audio = []
with wave.open(str(out / 'decoded.wav'), 'rb') as w:
    for t in [1, 3.5]:
        w.setpos(round(t * w.getframerate()))
        raw = w.readframes(4800)
        values = struct.unpack('<' + 'h' * (len(raw) // 2), raw)
        rms = math.sqrt(sum(v*v for v in values) / len(values)) / 32768
        frequencies = {str(f): abs(sum(v * complex(math.cos(2*math.pi*f*n/48000), -math.sin(2*math.pi*f*n/48000)) for n,v in enumerate(values))) / len(values) for f in [220, 440, 660]}
        assert rms > .01 and frequencies['220'] > 20
        assert frequencies['660' if t == 1 else '440'] > frequencies['440' if t == 1 else '660'] * 10
        audio.append({'time': t, 'rms': rms, 'toneMagnitudes': frequencies})
limitations = ['Offline synthetic fixture jobs only; no remote model output, paid calls, character continuity, lip sync or intelligible spoken dialogue is claimed.', 'Electron trusted IPC, license, project database persistence and UI clicks are not exercised or bypassed. Pure adoption and production shared renderer/sidecar run in an independent test harness.', 'Browser capture uses existing Playwright/MS Edge with production HTML __tl.seek at 24fps and 640x360; Electron capture transport and production 1920x1080 canvas are outside this acceptance.', 'Subtitles are burned into video frames; no separate subtitle stream is expected. Final decoded white glyph pixels are compared inside/outside cue timing, and browser caption visibility has a pixel difference control.']
report = {'passed': True, 'schemaValidated': fixture['schemaValidated'], 'paidCalls': 0, 'path': 'buildDirectorRenderScenes -> buildDirectorSceneHtml -> real Edge frame capture -> generated production sidecar generate_compose_render (audio mix, H264/AAC mux, loudnorm)', 'adoption': fixture['adoption'], 'captures': captures, 'samples': samples, 'audio': audio, 'probe': probe, 'ffprobe': stream_probe, 'ffmpegExecutable': sidecar.ffmpeg_exe(), 'ffprobeExecutable': ffprobe, 'productionBug': {'originalFailure': 'Bundled FFmpeg 9.0.2 rejects -filter_complex_script', 'fix': 'Cached version-aware file-valued options for FFmpeg 7+; legacy flags for older builds', 'authorizedBy': 'parent agent'}, 'result': result, 'ffmpegCommands': commands, 'limitations': limitations}
(out / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
lines = ['# Local motion-comic final MP4 acceptance', '', 'Result: PASS', '', 'Two real 2.5s local color videos, native dialogue-test tones (red=440Hz, blue=660Hz) and a 220Hz music bed. Final 5s MP4 contains H.264 video, AAC audio and burned-in timed subtitles.', '', '## Production path', '', report['path'], '', 'Document and adopted document pass motionComicPipelineSchema. adoptMotionComicVideoVersion changes shot and timeline from video-0/red to video-history/blue; the second shot remains red. Real final decoded frames prove blue then red. Audio frequency evidence also proves the adopted blue native soundtrack (660Hz), followed by red (440Hz), alongside the 220Hz music bed.', '', '## Measurements', '', f"Duration: {stream_probe['format']['duration']}s. Audio mean: {probe['audio_mean_volume_db']} dB; non-silent: {not probe['audio_is_silent']}.", '', '|Time|Expected picture|Mean RGB|Subtitle white pixels|', '|---|---|---|---|']
for row in samples:
    lines.append(f"|{row['time']}|{row['expected']}|{[round(v, 1) for v in row['meanRGB']]}|{row['subtitleWhitePixels']}|")
lines += ['', '## Boundaries', ''] + ['- ' + x for x in limitations] + ['', 'Reproduce: `node node_modules/tsx/dist/cli.mjs scripts/verify-comic-final-export.ts`', '', 'One narrow production compatibility fix was authorized after discovering that bundled FFmpeg 9 rejects removed -filter_complex_script/-filter_script:v options. The sidecar now selects file-valued filter options for FFmpeg 7+ and preserves legacy flags for older builds. Browser is closed in finally; subprocesses have timeouts.']
(out / 'report.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
print(json.dumps({'passed': True, 'probe': probe, 'samples': samples, 'audio': audio}, indent=2))
