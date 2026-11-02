import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runPixelleWorker } from '../src/shared/pixelle-worker';
const root = resolve('.');
const workDir = process.env.STORYDREAM_PIXELLE_VALIDATION_ROOT
  ? resolve(process.env.STORYDREAM_PIXELLE_VALIDATION_ROOT, 'clips')
  : join(root, '.artifacts/pixelle-clips-smoke');
const exec = promisify(execFile);
const python = join(root, 'vendor/python/python.exe');
await mkdir(workDir, { recursive: true });
const ffmpeg = (await exec(python, ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { windowsHide: true })).stdout.trim();
const results: unknown[] = [];
try {
  const videoPath = join(workDir, 'motion-source.mp4'), audioPath = join(workDir, 'narration.wav'), imagePath = join(workDir, 'image.png');
  async function media(args: string[]) { await exec(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true, timeout: 120000 }); }
  await media(['-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=24', '-t', '0.5', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', videoPath]);
  await media(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1:sample_rate=48000', audioPath]);
  await media(['-i', videoPath, '-frames:v', '1', imagePath]);
  const catalog = await runPixelleWorker({ mode: 'catalog', workDir }, { appRoot: root });
  const probe = await runPixelleWorker({ mode: 'probe-video', workDir, videoPath }, { appRoot: root });
  assert.equal(probe.width, 360);
  for (const [name, mediaKind, padStrategy] of [['image_default.html', 'image', 'freeze'], ['video_default.html', 'video', 'freeze'], ['asset_default.html', 'video', 'black']] as const) {
    const templateRef = catalog.templates.find(t => t.ref.path === '1080x1920/' + name)!.ref;
    const result = await runPixelleWorker({ mode: 'render-clip', workDir, templateRef, title: '原版视频核心工程验收', text: '不调用付费生成，不修改用户样片。', imagePath, mediaKind, videoPath, audioPaths: [audioPath, audioPath], durationMs: 2200, padStrategy, output: name + '.mp4' }, { appRoot: root });
    assert.equal(result.width, 1080); assert.equal(result.height, 1920);
    assert(Math.abs(result.durationMs - 2200) <= 150);
    if (mediaKind === 'video') assert(result.warnings.some(w => w.code === 'VIDEO_PADDING_REQUIRED' && w.strategy === padStrategy));
    const script = `import av,json,sys,numpy as np
c=av.open(sys.argv[1]);fs=[f.to_ndarray(format='rgb24')[600:1300,200:880].astype(float) for f in c.decode(video=0)]
print(json.dumps({'frames':len(fs),'motion':float(np.abs(fs[1]-fs[8]).mean()),'tailChange':float(np.abs(fs[-3]-fs[-15]).mean()),'tailMean':float(fs[-3].mean())}))`;
    const frames = JSON.parse((await exec(python, ['-c', script, result.path], { windowsHide: true })).stdout);
    assert(frames.frames >= 50);
    if (mediaKind === 'video') assert(frames.motion > 1, 'Original video movement must survive composition');
    if (mediaKind === 'video' && padStrategy === 'freeze') assert(frames.tailChange < 2 && frames.tailMean > 10, 'Freeze must preserve the final picture');
    if (padStrategy === 'black') assert(frames.tailMean < 2, 'Black strategy must actually pad black frames');
    results.push({ name, result, frames }); console.log('PASS', name, padStrategy, JSON.stringify(frames));
  }
  const ref = catalog.templates.find(t => t.ref.path === '1080x1920/video_default.html')!.ref;
  const output = 'preserved.mp4'; await writeFile(join(workDir, output), 'prior-valid-artifact');
  await assert.rejects(runPixelleWorker({ mode: 'render-clip', workDir, templateRef: ref, title: '', text: '', mediaKind: 'video', videoPath: join(workDir, 'missing.mp4'), audioPath, output }, { appRoot: root }));
  assert.equal(await readFile(join(workDir, output), 'utf8'), 'prior-valid-artifact');
  await writeFile(join(workDir, 'report.json'), JSON.stringify({ status: 'passed', results, atomicFailure: 'passed', paidRequests: 0 }, null, 2));
} catch (error) { await writeFile(join(workDir, 'report.json'), JSON.stringify({ status: 'failed', error: String(error), results }, null, 2)); throw error; }
