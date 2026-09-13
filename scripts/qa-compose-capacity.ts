import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { writeStoryboundSidecarScript } from '../src/shared/storybound-sidecar';
import { resolvePythonRuntimeInfo, setDefaultPythonRuntimeAppRoot } from '../src/shared/python-runtime';
import { runBoundedProcess } from '../src/shared/process-runner';

const root = resolve('.');
const long1080p = process.argv.includes('--long-1080p');
const artifacts = join(root, long1080p ? '.artifacts/compose-long-1080p-qa' : '.artifacts/compose-capacity-qa');
await mkdir(artifacts, { recursive: true });
setDefaultPythonRuntimeAppRoot(root);
const script = await writeStoryboundSidecarScript(artifacts);
const result = await runBoundedProcess(resolvePythonRuntimeInfo().command, ['-c', `
import array, ctypes, json, math, os, runpy, subprocess, sys, time
from ctypes import wintypes
from io import BytesIO
from PIL import Image, ImageDraw
namespace = runpy.run_path(sys.argv[1])
compose = namespace['_compose_with_hard_cuts']
directory, output, preserved = sys.argv[2:]
frame = os.path.join(directory, 'frame.png')
segment = os.path.join(directory, 'segment.mp4')
count, duration = (500, 10) if preserved else (500, .25)
if preserved:
    segments = [os.path.join(preserved, 'segment-%s.mp4' % i) for i in range(count)]
    assert all(os.path.isfile(path) and os.path.getsize(path) > 0 for path in segments), 'long-1080p mode requires 500 numbered segments'
else:
    Image.new('RGB', (32, 32), (200, 70, 60)).save(frame)
    namespace['encode_render_scene']({'frames_dir': directory, 'duration_s': duration, 'fps': 24, 'audio_clips': []}, directory, segment)
    segments = [segment]*count
original = namespace['run_composition_ffmpeg'].__globals__['run_bounded_subprocess']
report = {'platform': os.name, 'inputs': count, 'fixtureResolution': [1920, 1080] if preserved else [32, 32], 'peakFfmpegWorkingSetBytes': 0}
original_popen = subprocess.Popen
if os.name == 'nt':
    class MemoryCounters(ctypes.Structure):
        _fields_ = [('cb', wintypes.DWORD), ('PageFaultCount', wintypes.DWORD)] + [(name, ctypes.c_size_t) for name in ['PeakWorkingSetSize', 'WorkingSetSize', 'QuotaPeakPagedPoolUsage', 'QuotaPagedPoolUsage', 'QuotaPeakNonPagedPoolUsage', 'QuotaNonPagedPoolUsage', 'PagefileUsage', 'PeakPagefileUsage']]
    memory_info = ctypes.WinDLL('psapi').GetProcessMemoryInfo
    memory_info.argtypes = [wintypes.HANDLE, ctypes.POINTER(MemoryCounters), wintypes.DWORD]
    memory_info.restype = wintypes.BOOL
    class MeasuredProcess(original_popen):
        def poll(self):
            counters = MemoryCounters()
            counters.cb = ctypes.sizeof(counters)
            if memory_info(wintypes.HANDLE(int(self._handle)), ctypes.byref(counters), counters.cb):
                report['peakFfmpegWorkingSetBytes'] = max(report['peakFfmpegWorkingSetBytes'], counters.PeakWorkingSetSize)
            return super().poll()
    subprocess.Popen = MeasuredProcess
def measured(command, **kwargs):
    report['commandCharacters'] = len(subprocess.list2cmdline(command))
    report['inputArguments'] = command.count('-i')
    report['maxInputArguments'] = max(report.get('maxInputArguments', 0), report['inputArguments'])
    report['compositionProcessCount'] = report.get('compositionProcessCount', 0) + 1
    report['cwd'] = kwargs.get('cwd')
    assert report['commandCharacters'] < 32767
    return original(command, **kwargs)
namespace['run_composition_ffmpeg'].__globals__['run_bounded_subprocess'] = measured
started = time.monotonic()
try:
    compose(segments, output, [duration]*count)
except Exception as error:
    report.update(status='failed', error=str(error), elapsedSeconds=time.monotonic()-started)
    with open(os.path.join(directory, 'report.json'), 'w', encoding='utf-8') as target:
        json.dump(report, target, indent=2)
    raise
finally:
    subprocess.Popen = original_popen
report['elapsedSeconds'] = time.monotonic()-started
report['composeCommandCharacters'] = report['commandCharacters']
namespace['run_composition_ffmpeg'].__globals__['run_bounded_subprocess'] = original
report['expectedInputs'] = count
report['duration'] = namespace['media_duration_s'](output)
assert abs(report['duration'] - duration*count) < .1
assert not any(path.endswith('.filter') for path in os.listdir(directory))
if preserved:
    times = [.5, 4.9, 5.1, 9.9, 10.1, 19.9, 20.1, 599.5]
    colors = [(200,68,82), (48,162,112), (56,122,204)]
    sheet = Image.new('RGB', (960,1200), 'white')
    draw = ImageDraw.Draw(sheet)
    for i, t in enumerate(times):
        raw = subprocess.check_output([namespace['ffmpeg_exe'](), '-v', 'error', '-ss', str(t), '-i', output, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-threads', '1', '-'], timeout=30)
        image = Image.open(BytesIO(raw)).convert('RGB')
        assert image.size == (1920, 1080)
        assert max(abs(a-b) for a,b in zip(image.getpixel((1860,50)),colors[int(t//10)%3])) <= 8
        image.thumbnail((480,270))
        x,y = (i%2)*480,(i//2)*300
        sheet.paste(image,(x,y))
        draw.text((x+8,y+275),str(t)+' s',fill='black')
    sheet.save(os.path.join(directory, 'frame-checks.png'))
    samples = array.array('h', subprocess.check_output([namespace['ffmpeg_exe'](), '-v', 'error', '-i', output, '-f', 's16le', '-ac', '1', '-ar', '16000', '-'], timeout=90))
    def rms(start, end):
        values = samples[round(start*16000):round(end*16000)]
        return math.sqrt(sum(v*v for v in values)/len(values))/32768
    levels = []
    for i in range(count):
        assert rms(i*10+.03,i*10+.17) < .001
        levels.append(rms(i*10+.6,i*10+1.2))
        assert levels[-1] > .02
        assert abs(levels[-1]/levels[0]-(10**(-6/20) if i%2 else 1)) < .025
    report.update(checkedFrames=len(times), checkedSilentSceneStarts=count, sceneAudioRms=levels)
report.update(status='passed', filterFilesRemaining=0)
print(json.dumps(report))
`, script, artifacts, join(artifacts, 'result.mp4'), long1080p ? join(root, '.artifacts/html-video-long-1080p-qa/segments') : ''], { cwd: artifacts, timeoutMs: long1080p ? 30 * 60_000 : 120000, maxStdoutBytes: 1024 * 1024, maxStderrBytes: 65536 });
if (result.code !== 0) throw new Error(result.stderr);
const report = JSON.parse(result.stdout);
await writeFile(join(artifacts, 'report.json'), JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2), 'utf8');
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
