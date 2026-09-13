import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runBoundedProcess } from '../src/shared/process-runner';
import { resolvePythonRuntimeInfo } from '../src/shared/python-runtime';
import { writeStoryboundSidecarScript } from '../src/shared/storybound-sidecar';

describe('large sidecar compositions', () => {
  it.each([24, 30])('matches monolithic cut timing and PCM across fractional group boundaries at %s fps', async (fps) => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-compose-fractional-'));
    try {
      const script = await writeStoryboundSidecarScript(dir);
      const result = await runBoundedProcess(resolvePythonRuntimeInfo().command, ['-c', `
import array, csv, json, math, os, re, runpy, subprocess, sys, wave
from fractions import Fraction
from pathlib import Path
from PIL import Image
namespace = runpy.run_path(sys.argv[1])
root = Path(sys.argv[2])
fps = int(sys.argv[3])
segments = []
for index, color in enumerate([(200,68,82), (48,162,112)]):
    directory = root / str(index)
    directory.mkdir()
    Image.new('RGB', (32,32), color).save(directory / 'frame.png')
    voice = directory / 'voice.wav'
    pcm = array.array('h', [round((4000+index*4000)*math.sin(n*440*math.tau/44100)) for n in range(44100)])
    with wave.open(str(voice),'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(44100)
        output.writeframes(pcm.tobytes())
    segment = str(directory / 'segment.mp4')
    namespace['encode_render_scene']({'frames_dir':str(directory), 'audio_path':str(voice), 'duration_s':1, 'fps':fps}, str(directory), segment)
    segments.append(segment)
paths = [segments[index%2] for index in range(17)]
durations = [.11, .19, .24, .39, .51, .66, .75, .81]*2 + [.29]
grouped, reference = str(root/'grouped.mp4'), str(root/'reference.mp4')
context = namespace['_compose_with_hard_cuts'].__globals__
original = context['run_bounded_subprocess']
input_counts = []
def observed(command, **kwargs):
    input_counts.append(command.count('-i'))
    return original(command, **kwargs)
context['run_bounded_subprocess'] = observed
namespace['_compose_with_hard_cuts'](paths, grouped, durations, fps)
context['run_bounded_subprocess'] = original
assert max(input_counts) <= 8
assert not list(root.glob('compose-groups-*'))
inputs, filters = namespace['hard_cut_filter_graph'](paths, durations)
namespace['run_ffmpeg']([*inputs,'-filter_complex',';'.join(filters),'-map','[vout]','-map','[aout]','-pix_fmt','yuv420p','-c:v','libx264','-c:a','aac',reference])
def decode(path, kind):
    options = ['-f','s16le','-ac','2','-ar','44100'] if kind == 'audio' else ['-f','rawvideo','-pix_fmt','rgb24']
    return subprocess.check_output([namespace['ffmpeg_exe'](),'-v','error','-i',path,*options,'-'],timeout=10)
current_audio, expected_audio = [array.array('h',decode(path,'audio')) for path in [grouped,reference]]
assert len(current_audio) == len(expected_audio), (len(current_audio),len(expected_audio))
assert max(abs(a-b) for a,b in zip(current_audio,expected_audio)) <= 2
current_video, expected_video = [decode(path,'video') for path in [grouped,reference]]
assert len(current_video) == len(expected_video), (len(current_video),len(expected_video))
assert sum(abs(a-b) for a,b in zip(current_video,expected_video))/len(current_video) < 2
def timestamps(path):
    data = subprocess.check_output([namespace['ffmpeg_exe'](),'-v','error','-i',path,'-map','0:v:0','-c:v','copy','-f','framecrc','-'],timeout=10).decode()
    timebase = Fraction(re.search(r'#tb 0: ([0-9]+/[0-9]+)', data).group(1))
    return sorted(int(row[2])*timebase for row in csv.reader(line for line in data.splitlines() if not line.startswith('#')))
actual_pts, expected_pts = timestamps(grouped), timestamps(reference)
assert len(actual_pts) == len(expected_pts)
assert max(abs(a-b) for a,b in zip(actual_pts, expected_pts)) <= Fraction(1,10000)
prior = root/'prior.mp4'
prior.write_bytes(b'prior output')
try:
    namespace['_compose_with_hard_cuts']([*paths[:8],str(root/'missing.mp4')],str(prior),durations[:9],fps)
    raise AssertionError('missing second-group media was accepted')
except RuntimeError:
    pass
assert prior.read_bytes() == b'prior output'
assert not list(root.glob('compose-groups-*'))
print(json.dumps({'maxInputs':max(input_counts),'frames':len(current_video)//(32*32*3),'audioSamples':len(current_audio)//2}))
`, script, dir, String(fps)], { cwd: dir, timeoutMs: 30_000, maxStdoutBytes: 65536, maxStderrBytes: 65536 });
      expect(result.code, result.stderr).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.maxInputs).toBe(8);
      expect(report.frames).toBeGreaterThan(fps * 7);
      expect(report.audioSamples).toBeGreaterThan(330_000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 45_000);

  it('preserves input identity and filters and removes only owned scratch files on failures', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-compose-paths-'));
    try {
      const script = await writeStoryboundSidecarScript(dir);
      const result = await runBoundedProcess(resolvePythonRuntimeInfo().command, ['-c', `
import json, os, runpy, sys, types
from pathlib import Path
namespace = runpy.run_path(sys.argv[1])
compose = namespace['run_composition_ffmpeg']
context = compose.__globals__
root = Path(sys.argv[2]).resolve()
inputs = [root / 'media files' / str(i % 2) / ('clip %s.mp4' % i) for i in range(10)]
for path in inputs:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(str(path), encoding='utf-8')
output = root / 'out files' / 'result.mp4'
output.parent.mkdir()
sentinel = output.parent / 'other.filter'
sentinel.write_text('unrelated', encoding='utf-8')
graph = '[0:v]null[vout];[0:a]anull[aout]'
args = [item for path in inputs for item in ['-i', os.path.relpath(path)]]
args += ['-filter_complex', graph, '-map', '[vout]', '-map', '[aout]', os.path.relpath(output)]
original_args = args[:]
scripts = []
def capture(command, cwd=None):
    actual = [Path(cwd, command[i+1]).resolve() for i, value in enumerate(command[:-1]) if value == '-i']
    assert actual == inputs
    for path in actual:
        assert path.read_text(encoding='utf-8') == str(path)
    assert Path(command[-1]) == output
    script_path = Path(command[command.index('-filter_complex_script')+1])
    assert script_path.read_text(encoding='utf-8') == graph
    assert '-filter_complex' not in command
    scripts.append(script_path)
    output.write_bytes(b'partial output')
    if mode == 'timeout':
        raise TimeoutError('composition timed out')
    return types.SimpleNamespace(returncode=1 if mode == 'exit' else 0, stdout='', stderr='composition failed')
context['run_bounded_subprocess'] = capture
for mode in ['success', 'exit', 'timeout']:
    try:
        compose(args)
        assert mode == 'success'
    except (RuntimeError, TimeoutError):
        assert mode != 'success'
    assert output.exists() == (mode == 'success')
    assert sorted(output.parent.glob('*.filter')) == [sentinel]
    assert args == original_args
assert len(set(scripts)) == 3
original_temporary_file = context['tempfile'].NamedTemporaryFile
class FailedWrite:
    def __init__(self, **kwargs):
        self.file = original_temporary_file(**kwargs)
        self.name = self.file.name
    def __enter__(self):
        return self
    def write(self, value):
        raise OSError('disk full while writing filter')
    def __exit__(self, *args):
        self.file.close()
context['tempfile'].NamedTemporaryFile = FailedWrite
try:
    compose(args)
    raise AssertionError('write failure was swallowed')
except OSError as error:
    assert 'disk full' in str(error)
assert sorted(output.parent.glob('*.filter')) == [sentinel]
print(json.dumps({'cases': 4, 'inputsPreserved': len(inputs)}))
`, script, dir], { cwd: dir, timeoutMs: 15_000, maxStdoutBytes: 65536, maxStderrBytes: 65536 });
      expect(result.code, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ cases: 4, inputsPreserved: 10 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.each(['cut', 'fade'])('keeps real %s media identical to the original filter invocation above eight inputs', async (transition) => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-compose-equivalence-'));
    try {
      const script = await writeStoryboundSidecarScript(dir);
      const result = await runBoundedProcess(resolvePythonRuntimeInfo().command, ['-c', `
import array, json, math, os, runpy, subprocess, sys, wave
from pathlib import Path
from PIL import Image
namespace = runpy.run_path(sys.argv[1])
root, transition = Path(sys.argv[2]), sys.argv[3]
segments = []
for i, color in enumerate([(200, 68, 82), (48, 162, 112)]):
    directory = root / ('media files %s' % i)
    directory.mkdir()
    Image.new('RGB', (32,32), color).save(directory / 'frame.png')
    segment = str(directory / 'segment.mp4')
    voice = directory / 'voice.wav'
    samples = array.array('h', [round((4000 if i == 0 else 8000)*math.sin(n*440*math.tau/44100)) for n in range(22050)])
    with wave.open(str(voice), 'wb') as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(44100)
        audio.writeframes(samples.tobytes())
    namespace['encode_render_scene']({'frames_dir':str(directory), 'duration_s':.5, 'fps':24, 'audio_path':str(voice)}, str(directory), segment)
    segments.append(segment)
paths = [segments[i%2] for i in range(10)]
compose = namespace['_compose_with_hard_cuts' if transition == 'cut' else '_compose_with_xfade']
options = [[.5]*10] if transition == 'cut' else ['fade', .125]
current = str(root / 'current.mp4')
previous = str(root / 'previous.mp4')
current_runner = compose.__globals__['run_composition_ffmpeg']
input_counts = []
def observed(command):
    input_counts.append(command.count('-i'))
    return current_runner(command)
compose.__globals__['run_composition_ffmpeg'] = observed if transition == 'fade' else namespace['run_ffmpeg']
compose(paths, previous, *options)
compose(paths, current, *options)
compose.__globals__['run_composition_ffmpeg'] = current_runner
assert Path(current).read_bytes() == Path(previous).read_bytes()
assert not list(root.rglob('*.filter'))
assert not list(root.glob('compose-xfade-groups-*'))
if transition == 'fade':
    assert input_counts and max(input_counts) <= 8, input_counts
pcm = array.array('h', subprocess.check_output([namespace['ffmpeg_exe'](), '-v', 'error', '-i', current, '-f', 's16le', '-ac', '1', '-ar', '44100', '-'], timeout=10))
expected_duration = 5 if transition == 'cut' else 3.875
assert abs(len(pcm)/44100-expected_duration) < .03
for i in range(10):
    start = i*(.5 if transition == 'cut' else .375)+.2
    values = pcm[round(start*44100):round((start+.04)*44100)]
    level = math.sqrt(sum(v*v for v in values)/len(values))
    expected = (4000 if i%2 == 0 else 8000)/2
    assert abs(level-expected)/expected < .1, (i, level, expected)
print(json.dumps({'equal':True, 'duration':namespace['media_duration_s'](current)}))
`, script, dir, transition], { cwd: dir, timeoutMs: 30_000, maxStdoutBytes: 65536, maxStderrBytes: 65536 });
      expect(result.code, result.stderr).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.equal).toBe(true);
      expect(report.duration).toBeCloseTo(transition === 'cut' ? 5 : 3.875, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 75_000);
});
