// Run: scripts\run-npm-node.cmd node_modules/tsx/dist/cli.mjs scripts/smoke-pi-film-pipeline.ts
// No provider/model calls. Every run retains its own evidence directory.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { runBoundedProcess } from '../src/shared/process-runner';

async function pipeline(root: string, out: string) {
  const { resolveLemoUpstreamRenderRuntime, stageLemoUpstreamRenderRoot, runProcess, probeLemoMedia } = await import('../electron/lemo-upstream-video');
  const { renderPiScore } = await import('../electron/pi-score-renderer');
  const { masterPiAudio } = await import('../electron/pi-audio-master');
  const { listInstalledInstruments } = await import('../services/lemo-audio/starter-pack');
  const { reviewPiFilm, piCaptionSampleErrors } = await import('../electron/pi-film-review');
  const { runPiFilmReadcheck } = await import('../electron/pi-film-readcheck');
  const { exportLemoUpstreamProject } = await import('../electron/lemo-upstream-renderer');
  const { piFilmSourceHash } = await import('../electron/pi-film-fingerprint');
  const durationSeconds = 4, fps = 12, width = 480, height = 270;
  const pythonRoot = join(root, 'vendor/python'), cacheDir = join(out, 'cache'), filmDir = join(out, 'film');
  await mkdir(filmDir, { recursive: true });
  const report: Record<string, unknown> = { paidRequests: 0, aestheticReview: false, out };
  const save = async (phase: string) => { report.phase = phase; await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2)); };
  try {
    // Optional verified cache seed avoids Windows antivirus rename locks on fresh staging.
    // Copy into this run's private cache; never let the smoke write to the seed.
    if (process.env.PI_FILM_SMOKE_CACHE_SEED) {
      await cp(resolve(process.env.PI_FILM_SMOKE_CACHE_SEED), join(cacheDir, 'render-root'), { recursive: true, dereference: true });
      report.cacheSeed = resolve(process.env.PI_FILM_SMOKE_CACHE_SEED);
    }
    const runtime = await resolveLemoUpstreamRenderRuntime({ pythonRoot, cacheDir });
    const library = { upstreamRoot: join(root, 'vendor/lemo-upstream'), threeRoot: join(root, 'node_modules/three'), pythonRoot, cacheDir };
    const upstreamRoot = await stageLemoUpstreamRenderRoot({ ...library, playwrightCorePath: runtime.playwrightCorePath });
    const cues = [{ id: 'one', text: 'First.', startSeconds: 0, endSeconds: 1.5 }, { id: 'two', text: 'Second.', startSeconds: 2, endSeconds: 4 }];
    await writeFile(join(filmDir, 'index.html'), `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden}canvas{display:block}</style><canvas width="480" height="270"></canvas><script>
const c=document.querySelector('canvas'),ctx=c.getContext('2d'),cues=${JSON.stringify(cues)};
const captions=new URLSearchParams(location.search).get('captions')==='1';
window.DUR=4;window.EV=[{t:.25,type:'pulse'}];
window.TEXTS=t=>[{id:'title',text:'Test',x0:40,y0:35,x1:150,y1:65},...cues.filter(q=>captions&&t>=q.startSeconds&&t<q.endSeconds).map(q=>({id:'cap:'+q.id,text:q.text,x0:40,y0:210,x1:220,y1:240}))];
window.render=t=>{ctx.fillStyle='#142331';ctx.fillRect(0,0,480,270);ctx.fillStyle='#59b8cc';ctx.fillRect(40+t*70,100,40,40);ctx.fillStyle='#ffffff';ctx.font='24px sans-serif';for(const b of window.TEXTS(t))ctx.fillText(b.text,b.x0,b.y1-5);};window.READY=true;
</script>`, 'utf8');
    const sourceHash = await piFilmSourceHash(filmDir); report.sourceHash = sourceHash;
    await save('fixture');
    const instrumentsRoot = join(root, 'vendor/lemo-instrument-starter/instruments');
    const installed = await listInstalledInstruments(instrumentsRoot); assert.ok(installed.length);
    const score = await renderPiScore({ durationSeconds, score: { version: 1, tracks: [{ instrument: installed[0], notes: [{ time: .25, duration: 1, midi: 60, velocity: .6 }, { time: 2, duration: 1.5, midi: 67, velocity: .5 }] }] }, foley: { version: 1, events: [{ time: .25, duration: .1, preset: 'click', gain: .2 }] } }, { pythonRoot, instrumentsRoot, outputDir: join(out, 'score'), runtime, trustedScriptPath: join(root, 'services/lemo-audio/render-score.py') });
    report.score = score; await save('score');
    // Synthetic narration has a deliberate half-second pause, with source resumed at 1.5s.
    const voice = join(out, 'voice.wav');
    const made = await runProcess(runtime.ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3.5', '-ac', '2', voice], { timeoutMs: 30000 }); assert.equal(made.code, 0, made.stderr);
    const master = await masterPiAudio({ durationSeconds, stems: score.stems, mix: { version: 1, stems: { music: { gainDb: -12 }, ambience: { gainDb: 0 }, sfx: { gainDb: -6 } }, duck: { under: 'narration', music: -12, attackMs: 10, releaseMs: 100 }, silences: [{ t0: 1.5, t1: 2, reason: 'Synthetic narration pause' }], transitions: [] }, narration: [{ path: voice, sourceStartSeconds: 0, t0: 0, t1: 1.5 }, { path: voice, sourceStartSeconds: 1.5, t0: 2, t1: 4 }], approvedPauses: [{ t0: 1.5, t1: 2 }] }, { pythonRoot, outputDir: join(out, 'audio'), runtime, trustedScriptPath: join(root, 'services/lemo-audio/master.py') });
    assert.equal(master.master.sampleRate, 48000); assert.equal(master.master.channels, 2); assert.equal(master.master.nonFiniteSamples, 0); assert.equal(master.master.durationSeconds, 4); assert.ok(master.master.peakAmplitude > 0 && master.master.peakAmplitude <= 1);
    report.master = master; await save('master');
    const base = { runtime, upstreamRoot, filmDir, durationSeconds, fps, width, height, captionMode: 'film' as const };
    const reviews = [];
    for (let pass = 0; pass < 2; pass++) {
      const review = await reviewPiFilm({ ...base, outputDir: join(out, `review-${pass}`), times: [0, .75, 1.75, 2.5, 3.75] });
      assert.equal(review.technicalPassed, true, JSON.stringify(review));
      assert.deepEqual(piCaptionSampleErrors(review.page, cues.map(q => ({ id: q.id, text: q.text, startMs: q.startSeconds * 1000, endMs: q.endSeconds * 1000 })), 'film'), []);
      reviews.push(review);
    }
    report.reviews = reviews; await save('review');
    const reading = await runPiFilmReadcheck({ ...base, cues }); report.reading = reading;
    assert.equal(reading.readingPassed, true, JSON.stringify(reading.errors));
    assert.deepEqual(reading.modes.map(m => m.sampledFrames), [48, 48]);
    await save('readcheck');
    const picture = await exportLemoUpstreamProject({ ...library, filmDir, outputDir: join(out, 'export'), durationSeconds, fps, width, height, engine: 'upstream', captions: 1, workers: 1 });
    report.picture = picture;
    assert.equal(await piFilmSourceHash(filmDir), sourceHash);
    const finalPath = join(out, 'final.mp4');
    const mux = await runProcess(runtime.ffmpegPath, ['-y', '-i', picture.outputPath, '-i', master.outputPath, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-ar', '48000', '-t', '4', finalPath], { timeoutMs: 30000 }); assert.equal(mux.code, 0, mux.stderr);
    const probe = await probeLemoMedia(runtime.ffmpegPath, finalPath); report.probe = probe; assert.equal(probe.video?.width, width); assert.equal(probe.video?.height, height); assert.equal(probe.audio?.sampleRate, 48000); assert.equal(probe.video?.fps, fps); assert.ok(Math.abs(probe.durationSeconds! - durationSeconds) <= 1 / fps);
    const decodedPath = join(out, 'final-decoded.f32');
    const decoded = await runProcess(runtime.ffmpegPath, ['-y', '-i', finalPath, '-map', '0:a:0', '-f', 'f32le', '-acodec', 'pcm_f32le', decodedPath], { timeoutMs: 30000 }); assert.equal(decoded.code, 0, decoded.stderr);
    const bytes = await readFile(decodedPath); let peak = 0, nonFinite = 0, sum = 0, pausePeak = 0;
    for (let i = 0; i < bytes.length / 4; i++) { const v = bytes.readFloatLE(i * 4); if (!Number.isFinite(v)) nonFinite++; else { peak = Math.max(peak, Math.abs(v)); sum += v * v; const t = i / 2 / 48000; if (t >= 1.6 && t < 1.9) pausePeak = Math.max(pausePeak, Math.abs(v)); } }
    const decodedSeconds = bytes.length / 4 / 2 / 48000;
    assert.equal(nonFinite, 0); assert.ok(peak > 0 && peak <= 1); assert.ok(Math.abs(decodedSeconds - durationSeconds) <= 1024 / 48000); assert.ok(pausePeak < .001);
    report.final = { path: finalPath, decodedPath, decodedFrames: bytes.length / 8, sampleRate: 48000, channels: 2, decodedSeconds, nonFiniteSamples: nonFinite, peakAmplitude: peak, rms: Math.sqrt(sum / (bytes.length / 4)), pausePeak, mux: 'ffmpeg copy picture + AAC master; director compositor not exercised' };
    await save('passed');
  } catch (error) { report.error = error instanceof Error ? error.stack : String(error); await save('failed'); throw error; }
}

async function main() {
  const root = resolve('.');
  const parent = join(root, '.artifacts/pi-film-pipeline'); await mkdir(parent, { recursive: true });
  const out = await mkdtemp(join(parent, 'run-')); console.log('Pi film evidence: ' + out);
  const bundle = join(out, 'runner.mjs');
  await build({ entryPoints: [join(root, 'scripts/smoke-pi-film-pipeline.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'esm', target: 'node22', external: ['esbuild'], logLevel: 'silent', plugins: [{ name: 'unused-electron-branch', setup(b) { b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'unused-electron' })); b.onLoad({ filter: /.*/, namespace: 'unused-electron' }, () => ({ contents: `export class BrowserWindow { constructor(){throw Error('Unexpected Electron renderer branch')} } export const session=new Proxy({}, {get(){throw Error('Unexpected Electron session branch')}});` })); } }] });
  const electron = createRequire(join(root, 'package.json'))('electron') as string;
  const run = await runBoundedProcess(electron, [bundle, '--worker', root, out], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeoutMs: 600000, maxStdoutBytes: 1024 * 1024, maxStderrBytes: 1024 * 1024 });
  if (run.code !== 0) throw new Error(`Pipeline failed (${run.code}): ${run.stderr}\nEvidence: ${out}`);
  const report = JSON.parse(await readFile(join(out, 'report.json'), 'utf8'));
  console.log(JSON.stringify({ phase: report.phase, reportPath: join(out, 'report.json'), probe: report.probe, final: report.final }, null, 2));
}
(process.argv[2] === '--worker' ? pipeline(process.argv[3], process.argv[4]) : main()).catch(error => { console.error(error); process.exitCode = 1; });
