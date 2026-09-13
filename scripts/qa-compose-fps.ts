import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { writeStoryboundSidecarScript } from '../src/shared/storybound-sidecar';
import { resolvePythonRuntimeInfo, setDefaultPythonRuntimeAppRoot } from '../src/shared/python-runtime';
import { runBoundedProcess } from '../src/shared/process-runner';

const root = resolve('.');
const artifacts = join(root, '.artifacts/compose-fps-qa');
await mkdir(artifacts, { recursive: true });
setDefaultPythonRuntimeAppRoot(root);
const script = await writeStoryboundSidecarScript(artifacts);
const result = await runBoundedProcess(resolvePythonRuntimeInfo().command, ['-c', `
import array, json, math, os, re, runpy, subprocess, sys, wave
from fractions import Fraction
from pathlib import Path
from PIL import Image

namespace = runpy.run_path(sys.argv[1])
root = Path(sys.argv[2])
root.mkdir(parents=True, exist_ok=True)
ffmpeg = namespace['ffmpeg_exe']()
fps_values = [1, 2, 7.5, 29.97]
results = []
for fps in fps_values:
    source_paths = []
    for index, color in enumerate([(200, 68, 82), (48, 162, 112)]):
        directory = root / ('fps-%s-source-%s' % (str(fps).replace('.', '_'), index))
        directory.mkdir(exist_ok=True)
        Image.new('RGB', (32, 32), color).save(directory / 'frame.png')
        voice = directory / 'voice.wav'
        pcm = array.array('h', [round((4000 + index * 3000) * math.sin(n * 440 * math.tau / 44100)) for n in range(44100)])
        with wave.open(str(voice), 'wb') as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(44100)
            audio.writeframes(pcm.tobytes())
        segment = directory / 'segment.mp4'
        namespace['encode_render_scene']({'frames_dir': str(directory), 'duration_s': .75, 'fps': fps, 'audio_path': str(voice)}, str(directory), str(segment))
        source_paths.append(str(segment))
    paths = [source_paths[index % 2] for index in range(10)]
    for transition, duration in [('cut', 0), ('fade', .125)]:
        output = root / ('fps-%s-%s.mp4' % (str(fps).replace('.', '_'), transition))
        if transition == 'cut':
            namespace['_compose_with_hard_cuts'](paths, str(output), [.75] * len(paths), fps)
            expected = 7.5
        else:
            namespace['_compose_with_xfade'](paths, str(output), 'fade', duration, [.75] * len(paths))
            expected = 7.5 - 9 * duration
        actual = namespace['media_duration_s'](str(output))
        probe = subprocess.run([ffmpeg, '-hide_banner', '-i', str(output)], text=True, capture_output=True).stderr
        match = re.search(r'Stream #.*Video:.*?([0-9]+(?:/[0-9]+|\\.[0-9]+)?) fps', probe)
        assert match, probe
        stream_rate = match.group(1)
        actual_fps = float(Fraction(stream_rate))
        assert abs(actual - expected) < .12, (fps, transition, actual, expected)
        assert abs(actual_fps - fps) < .08, (fps, transition, actual_fps, probe)
        subprocess.check_call([namespace['ffmpeg_exe'](), '-v', 'error', '-i', str(output), '-map', '0:v:0', '-f', 'null', '-'], stdout=subprocess.DEVNULL)
        subprocess.check_call([namespace['ffmpeg_exe'](), '-v', 'error', '-i', str(output), '-map', '0:a:0', '-f', 'null', '-'], stdout=subprocess.DEVNULL)
        results.append({'fps': fps, 'transition': transition, 'duration': actual, 'expectedDuration': expected, 'outputFps': actual_fps, 'streamRate': stream_rate})
report = {
    'status': 'passed',
    'fpsValues': fps_values,
    'transitions': ['cut', 'fade'],
    'results': results,
    'filterFilesRemaining': len(list(root.rglob('*.filter'))),
    'xfadeScratchDirsRemaining': len(list(root.glob('compose-xfade-groups-*'))),
    'hardCutScratchDirsRemaining': len(list(root.glob('compose-groups-*'))),
}
assert report['filterFilesRemaining'] == 0
assert report['xfadeScratchDirsRemaining'] == 0
assert report['hardCutScratchDirsRemaining'] == 0
print(json.dumps(report))
`, script, artifacts], { cwd: artifacts, timeoutMs: 300_000, maxStdoutBytes: 131072, maxStderrBytes: 65536 });
if (result.code !== 0) throw new Error(result.stderr);
const report = JSON.parse(result.stdout);
await writeFile(join(artifacts, 'report.json'), JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2), 'utf8');
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
