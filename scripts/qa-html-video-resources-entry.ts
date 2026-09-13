/// <reference lib="dom" />
import { app, BrowserWindow } from 'electron';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';
import { createElectronHtmlVideoRenderer } from '../electron/html-video-renderer';
import { setDefaultPythonRuntimeAppRoot, resolvePythonRuntimeInfo } from '../src/shared/python-runtime';
import { runStoryboundMediaSidecar } from '../src/shared/storybound-sidecar';
import { runBoundedProcess } from '../src/shared/process-runner';
import type { HtmlVideoExportInput } from '../src/shared/html-video';
import { preflightVideoRenderDisk } from '../electron/video-render-preflight';

const { root, artifacts, tempRoot, faultsOnly, long1080p, groupedSmoke } = JSON.parse(process.env.STORYDREAM_RESOURCE_QA!);
const workDir = join(tempRoot, 'render');
const report: Record<string, unknown> = { status: 'running', startedAt: new Date().toISOString(), externalCalls: 0 };
const colors = ['#c84452', '#30a270', '#387acc'];
const sceneCount = long1080p ? 60 : groupedSmoke ? 17 : 12;
const duration = long1080p ? 10 : groupedSmoke ? 2 : 15;
const fps = 24;
const width = long1080p ? 1920 : 960;
const height = long1080p ? 1080 : 540;
const frameMaxByScene = new Map<string, { bytes: number; count: number }>();
let peakFrames = 0;
let peakTemporary = 0;
let maxFrameDirectories = 0;
let peakElectronWorkingSetKb = 0;
let peakGeneratedBytes = 0;
let peakProcessTreeBytes = 0;
let peakFfmpegBytes = 0;
let processSamples = 0;
let ffmpegSamples = 0;
let processSample: Promise<void> | undefined;
let processTimer: ReturnType<typeof setInterval> | undefined;
let currentOutput = '';
let peakProcesses: unknown[] = [];
let captureWindows = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let keepAlive: BrowserWindow;

app.disableHardwareAcceleration();
app.setPath('userData', join(tempRoot, 'profile'));
setDefaultPythonRuntimeAppRoot(root);
globalThis.fetch = async () => { report.externalCalls = Number(report.externalCalls) + 1; throw new Error('External requests are disabled in resource QA'); };

function sampleResources() {
  const scenes = new Map<string, { bytes: number; count: number }>();
  let temporary = 0;
  const walk = (directory: string) => {
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      let bytes;
      try { bytes = statSync(path).size; } catch { continue; }
      temporary += bytes;
      if (/^frame_\d+\.jpg$/.test(entry.name)) {
        const scene = scenes.get(directory) ?? { bytes: 0, count: 0 };
        scene.bytes += bytes;
        scene.count += 1;
        scenes.set(directory, scene);
      }
    }
  };
  for (const entry of readdirSync(workDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('render-segments-')) walk(join(workDir, entry.name));
  }
  maxFrameDirectories = Math.max(maxFrameDirectories, scenes.size);
  peakFrames = Math.max(peakFrames, [...scenes.values()].reduce((sum, scene) => sum + scene.bytes, 0));
  peakTemporary = Math.max(peakTemporary, temporary);
  let persistent = 0;
  for (const path of [join(workDir, '_source.mp4'), currentOutput]) {
    try { persistent += statSync(path).size; } catch { /* Not written yet. */ }
  }
  peakGeneratedBytes = Math.max(peakGeneratedBytes, temporary + persistent);
  for (const [path, scene] of scenes) {
    if (scene.count >= (frameMaxByScene.get(path)?.count ?? 0)) frameMaxByScene.set(path, scene);
  }
  peakElectronWorkingSetKb = Math.max(peakElectronWorkingSetKb, app.getAppMetrics().reduce((sum, metric) => sum + metric.memory.workingSetSize, 0));
}

async function sampleProcessTree() {
  if (process.platform !== 'win32') return;
  const result = await runBoundedProcess('pwsh', ['-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize | ConvertTo-Json -Compress'],
  { cwd: root, timeoutMs: 15_000, maxStdoutBytes: 2 * 1024 * 1024, maxStderrBytes: 64 * 1024 });
  assert.equal(result.code, 0, result.stderr);
  const all = JSON.parse(result.stdout) as Array<{ ProcessId: number; ParentProcessId: number; Name: string; WorkingSetSize: string }>;
  const owned = new Set([process.pid]);
  let added = true;
  while (added) {
    added = false;
    for (const item of all) if (owned.has(item.ParentProcessId) && !owned.has(item.ProcessId)) { owned.add(item.ProcessId); added = true; }
  }
  const pipeline = all.filter((item) => owned.has(item.ProcessId) && /electron|python|ffmpeg/i.test(item.Name));
  const total = pipeline.reduce((sum, item) => sum + Number(item.WorkingSetSize), 0);
  const ffmpeg = pipeline.filter((item) => /ffmpeg/i.test(item.Name)).reduce((sum, item) => sum + Number(item.WorkingSetSize), 0);
  processSamples += 1;
  if (ffmpeg) ffmpegSamples += 1;
  if (total > peakProcessTreeBytes) { peakProcessTreeBytes = total; peakProcesses = pipeline; }
  peakFfmpegBytes = Math.max(peakFfmpegBytes, ffmpeg);
  report.live = { elapsedMs: Date.now() - renderStarted, capturedScenes: frameMaxByScene.size, peakFrameBytes: peakFrames, peakGeneratedBytes, peakProcessTreeBytes, peakFfmpegBytes };
  await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
}

let renderStarted = 0;

function tone(durationMs: number, frequency: number) {
  const sampleRate = 16000;
  const samples = Math.round(durationMs * sampleRate / 1000);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i += 1) buffer.writeInt16LE(Math.round(4500 * Math.sin(i * frequency * Math.PI * 2 / sampleRate)), 44 + i * 2);
  return buffer;
}

async function run() {
  await mkdir(workDir, { recursive: true });
  await writeFile(join(artifacts, 'report.json'), JSON.stringify(report), 'utf8');
  keepAlive = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  app.on('browser-window-created', (_event, window) => {
    captureWindows += 1;
    window.once('closed', sampleResources);
  });
  const source = join(workDir, 'voice.wav');
  await writeFile(source, tone(16000, 440));
  const photo = join(workDir, 'photo.png');
  if (long1080p) await copyFile(join(root, 'src/assets/director-desk/preview-city.png'), photo);
  currentOutput = join(artifacts, long1080p ? 'ten-minute-1080p.mp4' : groupedSmoke ? 'grouped-smoke.mp4' : 'three-minute.mp4');
  const input: HtmlVideoExportInput = {
    workDir, outputPath: currentOutput, title: 'Resource QA', fps, canvas_w: width, canvas_h: height,
    totalDurationS: sceneCount * duration, transition: { type: 'cut', duration: 0 },
    scenes: Array.from({ length: sceneCount }, (_, index) => ({
      sceneId: index + 1, title: `Scene ${index + 1}`, caption: '', description: '', imagePath: '', audioPath: '', duration, durationMs: duration * 1000,
      audioClips: [{ id: `audio-${index}`, path: source, trackType: 'narration', startMs: 250, sourceStartMs: 500, sourceDurationMs: duration * 1000 - 500, durationMs: duration * 1000 - 500, gainDb: index % 2 ? -6 : 0, fadeInMs: 100, fadeOutMs: 100 }],
      html: `<!doctype html><html><head><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${colors[index % 3]};font-family:Arial;color:white}#photo{position:absolute;left:15%;top:20%;width:70%;height:60%;object-fit:cover}#title{position:absolute;left:8%;top:10%;font-size:40px}#cue{position:absolute;left:8%;bottom:12%;font-size:28px}#marker{position:absolute;top:40%;width:40px;height:40px;background:white}</style></head><body>${long1080p ? `<img id="photo" src="${pathToFileURL(photo)}">` : ''}<div id="title">Scene ${index + 1}</div><div id="cue"></div><div id="marker"></div><script>window.__ready=true;window.__tl={seek(t){document.getElementById('marker').style.left=(8+t/${duration}*75)+'%';document.getElementById('cue').textContent='Cue '+(t<${duration / 2}?'A':'B');const photo=document.getElementById('photo');if(photo)photo.style.transform='scale('+(1+t/${duration}*.12)+')';},pause(){},play(){}};window.__tl.seek(0);</script></body></html>`,
    })),
  };
  if (faultsOnly) {
    await runFaultCases(input);
    report.status = 'passed';
    return;
  }
  report.diskBudget = await preflightVideoRenderDisk(workDir, { width, height, fps, durations: input.scenes.map((scene) => scene.duration), outputDurationS: input.totalDurationS });
  timer = setInterval(sampleResources, 200);
  const started = renderStarted = Date.now();
  if (long1080p) processTimer = setInterval(() => {
    if (!processSample) processSample = sampleProcessTree().catch((error) => { report.processSamplingError = String(error); }).finally(() => { processSample = undefined; });
  }, 2000);
  const result = await createElectronHtmlVideoRenderer().render(input);
  report.elapsedMs = Date.now() - started;
  clearInterval(timer);
  timer = undefined;
  if (processTimer) clearInterval(processTimer);
  processTimer = undefined;
  await processSample;
  sampleResources();
  assert.equal(captureWindows, sceneCount);
  assert.equal(maxFrameDirectories, 1);
  assert.equal(frameMaxByScene.size, sceneCount);
  assert([...frameMaxByScene.values()].every((scene) => scene.count === duration * fps));
  const allFrameBytes = [...frameMaxByScene.values()].reduce((sum, scene) => sum + scene.bytes, 0);
  assert(peakFrames < allFrameBytes / 8);
  assert(!(await readdir(workDir)).some((name) => name.startsWith('render-segments-')));
  const probe = await runStoryboundMediaSidecar({ mode: 'probe_media', work_dir: workDir, media_path: result.outputPath, require_nonblack: true });
  assert(probe.has_audio && probe.has_video && probe.has_nonblack_video);
  assert.equal(probe.width, width); assert.equal(probe.height, height);
  assert(Math.abs(probe.duration! - sceneCount * duration) < .1);
  assert(peakGeneratedBytes < (report.diskBudget as { requiredBytes: number }).requiredBytes);
  if (long1080p && process.platform === 'win32') assert(processSamples > 0 && ffmpegSamples > 0 && !report.processSamplingError);
  report.resources = { peakFrameBytes: peakFrames, cumulativeFrameBytes: allFrameBytes, peakTemporaryBytes: peakTemporary, peakGeneratedBytes, maxFrameDirectories, peakElectronWorkingSetKb, peakProcessTreeBytes, peakFfmpegBytes, processSamples, ffmpegSamples, peakProcesses, processSampleIntervalMs: 2000, sampleIntervalMs: 200, scenes: frameMaxByScene.size, frames: sceneCount * duration * fps, temporaryDirectoriesRemaining: 0 };
  report.output = { ...probe, path: result.outputPath, fps, scenes: sceneCount };
  await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  const inspection = await runBoundedProcess(resolvePythonRuntimeInfo().command, ['-c', `
import array, json, math, subprocess, sys, imageio_ffmpeg
from PIL import Image, ImageDraw
from io import BytesIO
path, outdir, duration, count, width = sys.argv[1:]
fps, duration, count, width = 24, float(duration), int(count), int(width)
times = [0.5, duration/2-.1, duration/2+.1, duration-.1, duration+.1, duration*2-.1, duration*2+.1, duration*count-.5]
expected = [(200,68,82), (48,162,112), (56,122,204)]
tiles, pixels = [], []
for t in times:
    raw = subprocess.check_output([imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-ss', str(t), '-i', path, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-threads', '1', '-'], timeout=30)
    image = Image.open(BytesIO(raw)).convert('RGB')
    pixel = image.getpixel((width-60, 50))
    target = expected[int(t // duration) % 3]
    assert max(abs(a-b) for a,b in zip(pixel, target)) <= 8, (t, pixel, target)
    pixels.append({'time':t,'pixel':pixel})
    image.thumbnail((480,270))
    tiles.append(image)
sheet = Image.new('RGB',(960, len(tiles)//2*300),'white')
draw = ImageDraw.Draw(sheet)
for i, tile in enumerate(tiles):
    x,y = (i%2)*480,(i//2)*300
    sheet.paste(tile,(x,y)); draw.text((x+8,y+275),str(times[i])+' s',fill='black')
sheet.save(outdir+'/frame-checks.png')
pcm = subprocess.check_output([imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-i', path, '-f', 's16le', '-ac', '1', '-ar', '16000', '-'], timeout=45)
samples = array.array('h', pcm)
def rms(start, end):
    values = samples[round(start*16000):round(end*16000)]
    return math.sqrt(sum(v*v for v in values)/len(values))/32768
levels = []
for i in range(count):
    start = i*duration
    quiet, audible = rms(start+.03,start+.17), rms(start+.6,start+1.2)
    assert quiet < .001, (i, 'gap', quiet)
    assert audible > .02, (i, 'sound', audible)
    levels.append(audible)
for i in range(1,count):
    ratio = levels[i]/levels[0]
    assert abs(ratio-(10**(-6/20) if i%2 else 1)) < .025, (i, ratio)
print(json.dumps({'checkedFrames':pixels,'sceneAudioRms':levels,'checkedSilentSceneStarts':count}))
`, result.outputPath, artifacts, String(duration), String(sceneCount), String(width)], { cwd: root, timeoutMs: 90_000, maxStdoutBytes: 1024 * 1024, maxStderrBytes: 1024 * 1024 });
  assert.equal(inspection.code, 0, inspection.stderr);
  report.frameChecks = JSON.parse(inspection.stdout);
  assert.equal(report.externalCalls, 0);
  report.status = 'passed';
}

async function runFaultCases(input: HtmlVideoExportInput) {
  const small: HtmlVideoExportInput = {
    ...input, fps: 4, totalDurationS: 1.6, outputPath: join(workDir, 'prior-output.mp4'),
    scenes: input.scenes.slice(0, 2).map((scene) => ({
      ...scene, duration: .8, durationMs: 800,
      audioClips: scene.audioClips!.map((clip) => ({ ...clip, startMs: 100, durationMs: 400, sourceDurationMs: 400 })),
    })),
  };
  const sourcePath = join(workDir, '_source.mp4');
  await writeFile(small.outputPath, 'prior output');
  await writeFile(sourcePath, 'prior source');
  const corruptAudio = join(workDir, 'corrupt.wav');
  await writeFile(corruptAudio, 'not an audio stream');
  const failed = structuredClone(small);
  failed.scenes[0].audioClips![0].path = corruptAudio;
  await assert.rejects(createElectronHtmlVideoRenderer().render(failed));
  assert.equal(captureWindows, 1);
  await assertClean();
  const cases: unknown[] = [{ mode: 'invalid-audio', capturedScenes: captureWindows, temporaryDirectoriesRemaining: 0 }];
  const childProcess = createRequire(import.meta.url)('node:child_process') as typeof import('node:child_process');
  const originalSpawn = childProcess.spawn;
  for (const mode of ['encode_render_scene', 'compose_render']) {
    const controller = new AbortController();
    const calls: string[] = [];
    let cancelledPid = 0;
    const beforeWindows: number = captureWindows;
    childProcess.spawn = ((command: string, args: string[], options: import('node:child_process').SpawnOptions) => {
      const child = originalSpawn(command, args, options);
      if (args?.[1]?.endsWith('input.json')) {
        const payload = JSON.parse(readFileSync(args[1], 'utf8'));
        calls.push(payload.mode);
        if (payload.mode === mode) child.once('spawn', () => {
          cancelledPid = child.pid!;
          controller.abort(new DOMException('QA cancellation during ' + mode, 'AbortError'));
        });
      }
      return child;
    }) as typeof childProcess.spawn;
    syncBuiltinESMExports();
    try {
      await assert.rejects(createElectronHtmlVideoRenderer().render(small, { signal: controller.signal }), (error: unknown) => {
        assert.equal((error as { code: string }).code, 'PROCESS_ABORTED');
        return true;
      });
    } finally { childProcess.spawn = originalSpawn; syncBuiltinESMExports(); }
    assert(cancelledPid > 0);
    assert.throws(() => process.kill(cancelledPid, 0), (error: unknown) => (error as { code: string }).code === 'ESRCH');
    assert.equal(captureWindows - beforeWindows, mode === 'encode_render_scene' ? 1 : 2);
    await assertClean();
    cases.push({ mode, calls, cancelledPid, processExited: true, capturedScenes: captureWindows - beforeWindows, temporaryDirectoriesRemaining: 0 });
  }
  const grouped = { ...small, totalDurationS: 17 * .8, scenes: Array.from({ length: 17 }, (_, index) => ({ ...small.scenes[index % 2], sceneId: index + 1 })) };
  const marker = join(workDir, 'deep-cancel-pid.json');
  const progress = join(workDir, 'deep-cancel-progress.txt');
  const controller = new AbortController();
  let deepTimer: ReturnType<typeof setInterval> | undefined;
  let deepPid = 0;
  let encodedFrames = 0;
  childProcess.spawn = ((command: string, args: string[], options: import('node:child_process').SpawnOptions) => {
    if (args?.[1]?.endsWith('input.json') && JSON.parse(readFileSync(args[1], 'utf8')).mode === 'compose_render') {
      const source = readFileSync(args[0], 'utf8');
      const launch = '    process = subprocess.Popen([str(item) for item in command], **popen_options)';
      assert(source.includes(launch));
      const instrumented = source.replace(launch, [
        '    deep_cancel = str(command[-1]).endswith("audio-1.wav")',
        '    if deep_cancel:',
        `        command = [command[0], "-progress", ${JSON.stringify(progress)}, "-stats_period", "0.05", "-re", *command[1:]]`,
        launch,
        '    if deep_cancel:',
        `        with open(${JSON.stringify(marker)}, "w", encoding="utf-8") as target:`,
        '            json.dump({"pid": process.pid}, target)',
      ].join('\n'));
      writeFileSync(args[0], instrumented, 'utf8');
      const deadline = Date.now() + 30_000;
      deepTimer = setInterval(() => {
        try {
          deepPid = JSON.parse(readFileSync(marker, 'utf8')).pid;
          const frames = [...readFileSync(progress, 'utf8').matchAll(/^frame=(\d+)$/gm)].map((match) => Number(match[1]));
          encodedFrames = Math.max(0, ...frames);
          if (encodedFrames > 0) {
            process.kill(deepPid, 0);
            controller.abort(new DOMException('QA cancellation inside second group encoder', 'AbortError'));
          }
        } catch { /* Wait for the real encoder's first progress frame. */ }
        if (Date.now() > deadline) controller.abort(new DOMException('Deep cancellation observation timed out', 'AbortError'));
      }, 50);
    }
    return originalSpawn(command, args, options);
  }) as typeof childProcess.spawn;
  syncBuiltinESMExports();
  try {
    await assert.rejects(createElectronHtmlVideoRenderer().render(grouped, { signal: controller.signal }), (error: unknown) => (error as { code: string }).code === 'PROCESS_ABORTED');
  } finally {
    if (deepTimer) clearInterval(deepTimer);
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
  }
  assert(deepPid > 0 && encodedFrames > 0);
  assert.throws(() => process.kill(deepPid, 0), (error: unknown) => (error as { code: string }).code === 'ESRCH');
  await assertClean();
  cases.push({ mode: 'second-group-encoding', cancelledFfmpegPid: deepPid, encodedFrames, processExited: true, temporaryDirectoriesRemaining: 0 });
  report.cases = cases;
  assert.equal(report.externalCalls, 0);

  async function assertClean() {
    assert(!(await readdir(workDir)).some((name) => name.startsWith('render-segments-')));
    assert.equal(await readFile(sourcePath, 'utf8'), 'prior source');
    assert.equal(await readFile(small.outputPath, 'utf8'), 'prior output');
    assert.equal(BrowserWindow.getAllWindows().length, 1);
  }
}

app.whenReady().then(run).catch((error) => { report.status = 'failed'; report.error = error?.stack ?? String(error); }).finally(async () => {
  if (timer) clearInterval(timer);
  if (processTimer) clearInterval(processTimer);
  await processSample;
  report.finishedAt = new Date().toISOString();
  await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  if (keepAlive && !keepAlive.isDestroyed()) keepAlive.destroy();
  app.exit(report.status === 'passed' ? 0 : 1);
});
