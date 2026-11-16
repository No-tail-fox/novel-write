// Run: scripts\run-npm-node.cmd node_modules/tsx/dist/cli.mjs scripts/smoke-pi-director-export.ts
// Real Electron compositor; no providers, mocks, app attachment, or fixture mutation.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { runBoundedProcess } from '../src/shared/process-runner';

async function worker(root: string, out: string, fixturePath: string) {
  const { app } = await import('electron');
  app.setPath('userData', join(out, 'user-data'));
  app.on('window-all-closed', () => {});
  const report: Record<string, any> = { paidRequests: 0, phase: 'starting', out, fixturePath,
    integration: 'buildPiFilmExportScenes -> renderDirectorVideo (actual Electron); preparePiFilmExport not exercised',
    evidenceScope: 'Offline fixture assertions, not production readiness or human aesthetic approval', scenarios: [] };
  const save = async (phase: string) => { report.phase = phase; await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2), 'utf8'); };
  try {
    await app.whenReady(); // Must be inside async main, never module top-level await.
    const { renderDirectorVideo } = await import('../electron/director-renderer');
    const { buildPiFilmExportScenes } = await import('../electron/pi-film-export-scenes');
    const { setDefaultPythonRuntimeAppRoot, resolvePythonRuntimeInfo } = await import('../src/shared/python-runtime');
    const { resolveLemoUpstreamRenderRuntime, probeLemoMedia, runProcess } = await import('../electron/lemo-upstream-video');
    const { exportLemoUpstreamProject } = await import('../electron/lemo-upstream-renderer');
    const { piDataHash, piFilmSourceHash } = await import('../electron/pi-film-fingerprint');
    const { sha256File } = await import('../electron/lemo-upstream-assets');
    const { createEditorialCollageDraft } = await import('../src/shared/editorial-collage');
    const { voxProductionSettings } = await import('../src/shared/vox-production');
    const { piFilmStateSchema } = await import('../src/shared/creative-animation/pi-film');
    const { newCodeVideoPolicy } = await import('../src/shared/creative-animation/production-policy');
    const { directorVisualFps } = await import('../src/shared/production-visual-continuity');
    const { directorCanvasForRatio } = await import('../src/shared/director-render');
    setDefaultPythonRuntimeAppRoot(root);
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
    assert.equal(fixture.phase, 'passed'); assert.equal(fixture.paidRequests, 0);
    assert.equal(fixture.picture.receipt.durationSeconds, 4);
    assert.equal(fixture.master.master.durationSeconds, 4);
    assert.equal(fixture.master.master.sampleRate, 48000);
    assert.equal(fixture.master.master.channels, 2);
    assert.equal(fixture.reading.modes.find((mode: any) => mode.captions === 0)?.captionFrames, 0);
    const filmDir = fixture.picture.receipt.entry, masterPath = fixture.master.outputPath;
    const sourceHash = await piFilmSourceHash(filmDir);
    assert.equal(sourceHash, fixture.sourceHash);
    const masterHash = await sha256File(masterPath), pictureHash = await sha256File(fixture.picture.outputPath);
    const cacheDir = join(out, 'cache');
    if (fixture.cacheSeed) await cp(fixture.cacheSeed, join(cacheDir, 'render-root'), { recursive: true, dereference: true });
    const library = { upstreamRoot: join(root, 'vendor/lemo-upstream'), threeRoot: join(root, 'node_modules/three'), pythonRoot: join(root, 'vendor/python'), cacheDir };
    const runtime = await resolveLemoUpstreamRenderRuntime(library);
    report.runtime = { electron: process.versions.electron, chromium: process.versions.chrome, python: resolvePythonRuntimeInfo(), ffmpeg: runtime.ffmpegPath };
    const timeline = {
      baselineHash: piDataHash(fixture.master.narration), documentHash: sourceHash, durationMs: 4000,
      cues: [{ id: 'one', text: 'First.', startMs: 0, endMs: 1500, sentenceEnd: true }, { id: 'two', text: 'Second.', startMs: 2000, endMs: 4000, sentenceEnd: true }],
      audioSlices: [], materials: [{ assetVersionId: 'master', path: masterPath, sha256: masterHash }], lockedWindows: [], pauses: [], acceptedChanges: 0,
      baselinePath: join(out, 'timeline.json'), timelinePath: join(out, 'timeline.json'),
      integration: { status: 'external-timeline-required' as const, reason: 'Preserved four-second upstream fixture with synthetic narration and a half-second pause' },
    };
    await writeFile(timeline.timelinePath, JSON.stringify(timeline, null, 2));
    const timelineHash = piDataHash(timeline), assetHash = piDataHash(timeline.materials);
    report.inputs = { sourceHash, timelineHash, assetHash, masterPath, masterHash, pictureHash };
    await save('fixture-verified');
    for (const captionMode of ['film', 'host'] as const) {
      const scenario: Record<string, any> = { captionMode, normalizeAudio: false, audioSampleRate: 48000 }; report.scenarios.push(scenario);
      await save(`rendering-${captionMode}`);
      const picture = captionMode === 'film' ? fixture.picture : await exportLemoUpstreamProject({ ...library, filmDir,
        outputDir: join(out, 'host-picture'), durationSeconds: 4, fps: 12, width: 480, height: 270, engine: 'upstream', captions: 0, workers: 1 });
      scenario.picture = picture;
      const document = createEditorialCollageDraft({ id: 'pi-director-smoke', title: 'Pi director export smoke', ratio: '16:9' });
      document.productionRun = { version: 1, id: 'smoke', authoringVersion: 4, status: 'completed', settings: voxProductionSettings(), sourceHash, runtimeIdentity: 'offline-fixture', nodes: [], createdAt: document.createdAt, updatedAt: document.updatedAt };
      document.piFilm = piFilmStateSchema.parse({ version: 1, authoringVersion: 4, runId: 'smoke', styleId: 'impasto', policy: { ...newCodeVideoPolicy(), captionMode },
        sessionRef: 'sessions/offline-fixture.jsonl', phase: 'ready', segment: 1, completedModelRequests: 0, sourceHash, timelineHash, assetHash,
        actualDurationSeconds: 4, narrationPauses: [], acceptedPauseChanges: 0, message: 'Synthetic readiness fixture backed by preserved upstream technical evidence',
        audioMaster: { path: 'audio/master.wav', sha256: masterHash, sourceHash, timelineHash, durationSeconds: 4, sampleRate: 48000, channels: 2 },
        evidence: { sourceHash, timelineHash, assetHash, renderIdentity: { engine: 'lemo-upstream', browserVersion: process.versions.chrome,
          sourceHash, timelineHash, assetHash, width: 480, height: 270, fps: 12, captionMode }, technicalPassed: fixture.picture.receipt.technicalPassed,
          readingPassed: fixture.reading.readingPassed, audioPassed: fixture.master.master.nonFiniteSamples === 0,
          contactSheetPasses: fixture.reviews.length, previewRef: 'export/native-picture.mp4', creditsPassed: true } });
      const scenes = buildPiFilmExportScenes(document, picture.outputPath, masterPath, timeline);
      assert.equal(scenes.length, 1); assert.equal(scenes[0].preserveSourcePicture, true);
      assert.equal(scenes[0].audioPath, ''); assert.equal(scenes[0].caption, '');
      assert.equal(scenes[0].audioClips?.length, 1); assert.equal(scenes[0].audioClips?.[0].path, masterPath);
      assert.equal(scenes[0].audioClips?.[0].gainDb, 0);
      assert.equal(scenes[0].audioClips?.[0].sourceStartMs, 0);
      assert.equal(scenes[0].audioClips?.[0].durationMs, 4000);
      assert.equal(scenes[0].audioClips?.[0].sourceDurationMs, 4000);
      assert.equal(scenes[0].subtitleCues?.length, captionMode === 'film' ? 0 : 2);
      scenario.scenes = scenes;
      await writeFile(join(out, `${captionMode}-fixture.json`), JSON.stringify({ document, timeline, scenes }, null, 2));
      const result = await renderDirectorVideo({ workDir: join(out, captionMode), projectTitle: document.title, modeLabel: 'Offline compositor smoke', ratio: document.ratio,
        scenes, normalizeAudio: false, audioSampleRate: 48000, signal: AbortSignal.timeout(110000), finalFilmGate: false });
      scenario.result = result;
      const probe = await probeLemoMedia(runtime.ffmpegPath, result.outputPath); scenario.probe = probe;
      const canvas = directorCanvasForRatio(document.ratio), fps = directorVisualFps(scenes);
      assert.equal(probe.durationSeconds, 4); assert.equal(result.durationMs, 4000);
      assert.equal(probe.video?.fps, fps); assert.equal(probe.video?.width, canvas.width); assert.equal(probe.video?.height, canvas.height);
      assert.equal(probe.audio?.sampleRate, 48000);
      const frameHashesPath = join(out, `${captionMode}-frames.md5`);
      const videoDecode = await runProcess(runtime.ffmpegPath, ['-y', '-i', result.outputPath, '-map', '0:v:0', '-f', 'framemd5', frameHashesPath], { timeoutMs: 30000 });
      assert.equal(videoDecode.code, 0, videoDecode.stderr);
      const frameHashes = (await readFile(frameHashesPath, 'utf8')).split(/\r?\n/).filter(line => line.trim() && !line.startsWith('#'));
      assert.equal(frameHashes.length, 4 * fps);
      const uniqueFrames = new Set(frameHashes.map(line => line.split(',').at(-1)?.trim())).size;
      assert.ok(uniqueFrames > 20, 'Moving upstream picture must not freeze during capture');
      scenario.videoDecode = { frameHashesPath, decodedFrames: frameHashes.length, uniqueFrames, fps };
      const samplePath = join(out, `${captionMode}-caption-sample.png`);
      const sample = await runProcess(runtime.ffmpegPath, ['-y', '-ss', '0.75', '-i', result.outputPath, '-frames:v', '1', samplePath], { timeoutMs: 30000 });
      assert.equal(sample.code, 0, sample.stderr); scenario.captionSamplePath = samplePath;
      const decodedPath = join(out, `${captionMode}-decoded.f32`);
      const decoded = await runProcess(runtime.ffmpegPath, ['-y', '-i', result.outputPath, '-map', '0:a:0', '-f', 'f32le', '-acodec', 'pcm_f32le', decodedPath], { timeoutMs: 30000 });
      assert.equal(decoded.code, 0, decoded.stderr);
      const bytes = await readFile(decodedPath); let peak = 0, nonFinite = 0, square = 0, pausePeak = 0;
      for (let i = 0; i < bytes.length / 4; i++) { const v = bytes.readFloatLE(i * 4); if (!Number.isFinite(v)) nonFinite++; else { peak = Math.max(peak, Math.abs(v)); square += v * v; const t = i / 96000; if (t >= 1.6 && t < 1.9) pausePeak = Math.max(pausePeak, Math.abs(v)); } }
      scenario.audio = { decodedPath, decodedFrames: bytes.length / 8, decodedSeconds: bytes.length / 384000, peak, nonFinite, pausePeak, rms: Math.sqrt(square / (bytes.length / 4)) };
      assert.equal(nonFinite, 0); assert.ok(peak > .05 && peak < 1); assert.ok(pausePeak < .001);
      assert.ok(Math.abs(scenario.audio.decodedSeconds - 4) <= 1024 / 48000);
      assert.ok(Math.abs(peak - fixture.master.master.peakAmplitude) < .05, 'Master gain must survive without second normalization');
      assert.ok(result.subtitleLayout);
      assert.equal(result.subtitleLayout.scenes.length, 1);
      assert.ok(result.subtitleLayout.scenes.every(s => s.status === 'ok'), JSON.stringify(result.subtitleLayout));
      const measured = result.subtitleLayout.scenes[0];
      if (measured.status === 'ok') {
        assert.equal(measured.cues.length, captionMode === 'film' ? 0 : 2);
        assert.ok(measured.cues.every(cue => cue.issues.length === 0), JSON.stringify(measured.cues));
        if (captionMode === 'film') assert.deepEqual(measured.visibilitySamples, []);
        else {
          assert.ok(measured.visibilitySamples?.some(sample => sample.activeCueIds.length === 0));
          assert.ok(measured.visibilitySamples?.some(sample => sample.activeCueIds.length === 1));
        }
      }
      scenario.outputHash = await sha256File(result.outputPath);
      scenario.pictureHash = await sha256File(picture.outputPath);
      if (captionMode === 'host') {
        assert.notEqual(scenario.pictureHash, pictureHash, 'captions=0 upstream picture must differ from film-caption source');
        assert.ok(Math.abs(scenario.audio.rms - report.scenarios[0].audio.rms) < .0001, 'Caption policy must not change the master mix');
      }
      scenario.passed = true;
      await save(`${captionMode}-passed`);
    }
    assert.equal(await piFilmSourceHash(filmDir), sourceHash); assert.equal(await sha256File(masterPath), masterHash);
    assert.equal(await sha256File(fixture.picture.outputPath), pictureHash);
    await save('passed'); app.exit(0);
  } catch (error) { report.error = error instanceof Error ? error.stack : String(error); await save('failed'); console.error(error); app.exit(1); }
}

async function main() {
  const root = resolve('.'), parent = join(root, '.artifacts/pi-director-export');
  await mkdir(parent, { recursive: true }); const out = await mkdtemp(join(parent, 'run-'));
  const fixture = resolve(process.env.PI_DIRECTOR_FIXTURE_REPORT ?? '.artifacts/pi-film-pipeline/run-Uy1e1S/report.json');
  console.log('Pi director evidence: ' + out);
  const bundle = join(out, 'runner.mjs');
  await build({ entryPoints: [join(root, 'scripts/smoke-pi-director-export.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'esm', target: 'node22',
    packages: 'external', external: ['electron', 'esbuild'], banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" }, logLevel: 'silent' });
  const electron = createRequire(join(root, 'package.json'))('electron') as string;
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  try {
    const run = await runBoundedProcess(electron, [bundle, '--worker', root, out, fixture], { cwd: root, env, timeoutMs: 120000, maxStdoutBytes: 4 * 1024 * 1024, maxStderrBytes: 4 * 1024 * 1024 });
    await writeFile(join(out, 'electron.log'), run.stdout + '\n' + run.stderr);
    assert.equal(run.code, 0, `Electron failed: ${run.stderr}\nEvidence: ${out}`);
    const report = JSON.parse(await readFile(join(out, 'report.json'), 'utf8')); assert.equal(report.phase, 'passed');
    console.log(JSON.stringify({ reportPath: join(out, 'report.json'), phase: report.phase, paidRequests: report.paidRequests, scenarios: report.scenarios.map((s: any) => ({ captionMode: s.captionMode, outputPath: s.result.outputPath, probe: s.probe, audio: s.audio })) }, null, 2));
  } catch (error) { await writeFile(join(out, 'launcher-error.txt'), String(error)); throw error; }
}
void (process.argv[2] === '--worker' ? worker(process.argv[3], process.argv[4], process.argv[5]) : main()).catch(error => { console.error(error); process.exitCode = 1; });
