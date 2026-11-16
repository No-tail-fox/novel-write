"""Local-only real browser audio capture and production sidecar mixing."""
import functools
import http.server
import importlib.util
import json
import math
import pathlib
import struct
import sys
import threading
import wave
from playwright.sync_api import sync_playwright

out = pathlib.Path(sys.argv[1])
rate = 44100
with wave.open(str(out / 'tone.wav'), 'wb') as wav:
    wav.setparams((2, 2, rate, rate * 8, 'NONE', 'not compressed'))
    wav.writeframes(b''.join(struct.pack('<hh', *([round(12000 * math.sin(2 * math.pi * 440 * i / rate))] * 2)) for i in range(rate * 8)))
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(out))
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='msedge', headless=True, args=['--autoplay-policy=no-user-gesture-required'])
        try:
            page = browser.new_page()
            page.goto(f'http://127.0.0.1:{server.server_port}/')
            page.wait_for_function('window.runAudio !== undefined')
            fixture = page.evaluate('window.fixture')
            measurements = page.evaluate('window.runAudio()')
        finally:
            browser.close()
finally:
    server.shutdown()
    server.server_close()
    thread.join()

(out/'browser-capture.json').write_text(json.dumps({'fixture': fixture, 'measurements': measurements}, indent=2), encoding='utf-8')
spec = importlib.util.spec_from_file_location('production_sidecar', sys.argv[2])
sidecar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sidecar)
commands = []
real_run = sidecar.run_ffmpeg
# Record commands without altering implementation or replacing ffmpeg.
def logged_run(args, **kwargs):
    commands.append(args)
    return real_run(args, **kwargs)
sidecar.run_ffmpeg = logged_run
clips = fixture['exported']
for clip in clips:
    clip['path'] = str(out / 'tone.wav')
mix = sidecar.scene_audio_input({'audio_clips': clips}, 8, str(out), 0)
second = sidecar.scene_audio_input({'audio_clips': [c for c in clips if c['id'] == 'second']}, 8, str(out), 1)
control = dict(clips[1], fadeEnvelope=None, fadeInMs=0, fadeOutMs=0)
reference = sidecar.scene_audio_input({'audio_clips': [control]}, 8, str(out), 2)
negative = dict(clips[1], fadeEnvelope=None)
negative_path = sidecar.scene_audio_input({'audio_clips': [negative]}, 8, str(out), 3)
def rms(path, time):
    with wave.open(str(path), 'rb') as wav:
        # Centered 50ms window = 22 cycles at 440Hz, avoiding phase bias.
        wav.setpos(round((time - .025) * wav.getframerate()))
        raw = wav.readframes(round(.05 * wav.getframerate()))
        values = struct.unpack('<' + 'h' * (len(raw) // 2), raw)
        return math.sqrt(sum(v*v for v in values) / len(values)) / 32768
rows = []
for item in measurements['captures']:
    time = item['time']
    baseline = rms(reference, time)
    row = {'time': time, 'expected': min(time/4, 1), 'browserRatio': item['ratio'], 'browserNegativeRatio': item['negativeRatio'], 'exportMixedRatio': rms(mix,time)/baseline, 'exportSecondRatio': rms(second,time)/baseline, 'exportNegativeRatio': rms(negative_path,time)/baseline}
    row['pass'] = all(abs(row[key]-row['expected']) < .006 for key in ['browserRatio','exportMixedRatio','exportSecondRatio'])
    rows.append(row)
report = {'passed': all(r['pass'] for r in rows) and not measurements['errors'], 'fixture': fixture, 'browser': measurements, 'comparisons': rows, 'ffmpeg': sidecar.ffmpeg_exe(), 'ffmpegCommands': commands, 'limitations': ['DirectorAudioClip requires real-time HTMLAudioElement; OfflineAudioContext was used for WAV decoding only.', 'Real AudioContext capture uses an analyser tap attached to the actual production GainNode. Each sample holds the supplied timeline time constant to measure its gain, with the constant-amplitude WAV continuing to play. This does not validate continuously advancing UI transport timing.', 'Only the preview URL was mapped to a local HTTP WAV; Electron custom asset protocol and authorization were not exercised.', 'Export invokes the generated production sidecar scene_audio_input function, before final loudness normalization/AAC mux. No full video export or human listening acceptance is claimed.']}
(out/'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
lines = ['# Real motion-comic audio verification', '', f"Result: {'PASS' if report['passed'] else 'FAIL'}", '', '8s 440Hz stereo PCM16 WAV, 44.1kHz, amplitude 12000/32768; 4s fade-in split at 2s using production sliceProductionAudioClip. Actual motionComicPreviewAudioClips and buildDirectorRenderScenes produce the inputs.', '', '|Time (s)|Expected|Browser actual component|Sidecar full split mix|Sidecar second only|Browser without envelope|Export without envelope|', '|---|---|---|---|---|---|---|']
for r in rows:
    lines.append('|'+ '|'.join(f'{r[k]:.6f}' for k in ['time','expected','browserRatio','exportMixedRatio','exportSecondRatio','browserNegativeRatio','exportNegativeRatio'])+'|')
lines += ['', 'Tolerance: absolute ratio error < 0.006. Export RMS windows are centered 50ms (22 cycles); browser uses twelve 8192-sample analyser windows after media playback advances 250ms and a further 250ms settling. Identical unfaded control removes channel conversion amplitude factors.', '', '## Scope and limitations', ''] + ['- '+x for x in report['limitations']] + ['', 'Reproduce from repository root: `node node_modules/tsx/dist/cli.mjs scripts/verify-comic-real-audio.ts`', '', 'All HTTP serving is loopback-only. Browser and server are closed in finally blocks. No production source was modified.']
(out/'report.md').write_text('\n'.join(lines)+'\n', encoding='utf-8')
print(json.dumps({'passed': report['passed'], 'comparisons': rows}, indent=2))
if not report['passed']:
    raise SystemExit(1)
