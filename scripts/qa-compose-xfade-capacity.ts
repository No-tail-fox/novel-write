import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { writeStoryboundSidecarScript } from '../src/shared/storybound-sidecar';
import { resolvePythonRuntimeInfo, setDefaultPythonRuntimeAppRoot } from '../src/shared/python-runtime';
import { runBoundedProcess } from '../src/shared/process-runner';

const root = resolve('.');
const long1080p = process.argv.includes('--long-1080p');
const artifacts = join(root, long1080p ? '.artifacts/compose-xfade-long-1080p-qa' : '.artifacts/compose-xfade-capacity-qa');
await mkdir(artifacts, { recursive: true });
setDefaultPythonRuntimeAppRoot(root);
const script = await writeStoryboundSidecarScript(artifacts);
const result = await runBoundedProcess(resolvePythonRuntimeInfo().command, ['-c', `
import array, json, math, os, runpy, subprocess, sys, wave
from pathlib import Path
from PIL import Image

namespace = runpy.run_path(sys.argv[1])
root, output = Path(sys.argv[2]), Path(sys.argv[3])
root.mkdir(parents=True, exist_ok=True)
if sys.argv[4]:
    segments = [str(path) for path in sorted(Path(sys.argv[4]).glob('segment-*.mp4'), key=lambda path: int(path.stem.split('-')[-1]))]
    assert len(segments) == 500, len(segments)
    count, segment_duration, transition_duration = 500, 10, .3
else:
    segments = []
    for index, color in enumerate([(200, 68, 82), (48, 162, 112)]):
        directory = root / ('source-%s' % index)
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
        namespace['encode_render_scene']({'frames_dir': str(directory), 'duration_s': .5, 'fps': 24, 'audio_path': str(voice)}, str(directory), str(segment))
        segments.append(str(segment))
    count, segment_duration, transition_duration = 65, .5, .125
paths = segments if sys.argv[4] else [segments[index % 2] for index in range(count)]
report = {
    'inputs': count,
    'segmentDuration': segment_duration,
    'transitionDuration': transition_duration,
    'expectedDuration': count * segment_duration - (count - 1) * transition_duration,
    'maxInputArguments': 0,
    'compositionProcessCount': 0,
    'maxCommandCharacters': 0,
}
context = namespace['_compose_with_xfade'].__globals__
original = context['run_composition_ffmpeg']
def measured(command):
    report['maxInputArguments'] = max(report['maxInputArguments'], command.count('-i'))
    report['maxCommandCharacters'] = max(report['maxCommandCharacters'], len(subprocess.list2cmdline(command)))
    report['compositionProcessCount'] += 1
    if report['maxCommandCharacters'] >= 32767:
        raise AssertionError('composition command exceeded Windows command line budget')
    return original(command)
context['run_composition_ffmpeg'] = measured
baseline_filter_files = {str(path) for path in root.rglob('*.filter')}
baseline_xfade_scratch_dirs = {str(path) for path in root.glob('compose-xfade-groups-*')}
started = namespace['time'].monotonic()
namespace['_compose_with_xfade'](paths, str(output), 'fade', transition_duration)
report['elapsedSeconds'] = namespace['time'].monotonic() - started
report['duration'] = namespace['media_duration_s'](str(output))
assert abs(report['duration'] - report['expectedDuration']) < .08, report
assert report['maxInputArguments'] <= 8, report
if not sys.argv[4]:
    assert report['compositionProcessCount'] == 10, report
assert output.is_file() and output.stat().st_size > 0
subprocess.check_call([namespace['ffmpeg_exe'](), '-v', 'error', '-i', str(output), '-map', '0:v:0', '-f', 'null', '-'], stdout=subprocess.DEVNULL)
subprocess.check_call([namespace['ffmpeg_exe'](), '-v', 'error', '-i', str(output), '-map', '0:a:0', '-f', 'null', '-'], stdout=subprocess.DEVNULL)
remaining_filter_files = {str(path) for path in root.rglob('*.filter')} - baseline_filter_files
remaining_xfade_scratch_dirs = {str(path) for path in root.glob('compose-xfade-groups-*')} - baseline_xfade_scratch_dirs
report['filterFilesRemaining'] = len(remaining_filter_files)
report['xfadeScratchDirsRemaining'] = len(remaining_xfade_scratch_dirs)
report['baselineFilterFiles'] = len(baseline_filter_files)
report['baselineXfadeScratchDirs'] = len(baseline_xfade_scratch_dirs)
assert report['filterFilesRemaining'] == 0
assert report['xfadeScratchDirsRemaining'] == 0
context['run_composition_ffmpeg'] = original
report['status'] = 'passed'
print(json.dumps(report))
`, script, artifacts, join(artifacts, 'result.mp4'), long1080p ? join(root, '.artifacts/html-video-long-1080p-qa/segments') : ''], { cwd: artifacts, timeoutMs: long1080p ? 120 * 60_000 : 180_000, maxStdoutBytes: 65536, maxStderrBytes: 65536 });
if (result.code !== 0) throw new Error(result.stderr);
const report = JSON.parse(result.stdout);
await writeFile(join(artifacts, 'report.json'), JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2), 'utf8');
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
