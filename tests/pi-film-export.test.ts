import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { nativeDocument, nativeHtml, nativeSettings } from './lemo-native.fixture';
import { parseEditorialCollagePipelineData, rebuildEditorialTimeline } from '../src/shared/editorial-collage';
import { piFilmStateSchema } from '../src/shared/creative-animation/pi-film';
import { newCodeVideoPolicy } from '../src/shared/creative-animation/production-policy';
import { preparePiFilmExport } from '../electron/pi-film-export';
import { piProductionPaths } from '../electron/pi-production-paths';
import { piDataHash, piFilmSourceHash } from '../electron/pi-film-fingerprint';
import { sha256File, verifyLemoAssets } from '../electron/lemo-upstream-assets';
import { requestPiNarrationPauses, stagePiNarrationTimeline } from '../electron/pi-narration-timeline';
import { defaultLemoUpstreamRenderCacheDir, probeLemoMedia, resolveLemoUpstreamRenderRuntime } from '../electron/lemo-upstream-video';

// Only the unused legacy Electron branch is mocked. Chromium, video.mjs and FFmpeg stay real.
vi.mock('electron', () => ({ BrowserWindow: class { constructor() { throw new Error('Unexpected Electron renderer'); } }, session: {} , app: { isPackaged: false, getAppPath: () => process.cwd() } }));
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const library = { upstreamRoot: resolve('vendor/lemo-upstream'), threeRoot: resolve('node_modules/three'), pythonRoot: resolve('vendor/python'), cacheDir: defaultLemoUpstreamRenderCacheDir() };

// Same PCM fixture construction as pi-narration-timeline: no transient artifacts or providers.
function wav(seconds: number) {
  const rate = 48000, channels = 2, bytes = Buffer.alloc(44 + seconds * rate * channels * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * channels * 2, 28);
  bytes.writeUInt16LE(channels * 2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  return bytes;
}
async function fixture() {
  const work = await mkdtemp(join(tmpdir(), 'pi-film-export-')); roots.push(work);
  const paths = piProductionPaths(work, 'fixture-export');
  await mkdir(paths.project, { recursive: true }); await mkdir(paths.audio, { recursive: true });
  const voice = join(work, 'voice.wav'), master = join(paths.audio, 'master.wav');
  await writeFile(voice, wav(3.5)); await writeFile(master, wav(4));
  let document = nativeDocument();
  const beat = document.beats[0], shot = beat.shots[0];
  beat.shots = [shot]; document.beats = [beat]; shot.durationMs = 3500; beat.durationMs = 3500;
  beat.subtitleCues = [{ id: 'first', text: 'First sentence.', startMs: 0, endMs: 1500 }, { id: 'second', text: 'Second sentence.', startMs: 1500, endMs: 3500 }];
  shot.subtitleCueIds = ['first', 'second']; shot.voiceAssetVersionId = 'voice';
  document.sourceText = 'First sentence. Second sentence.';
  document.assets.push({ id: 'voice', assetId: 'voice', kind: 'audio', localPath: voice, durationMs: 3500, createdAt: document.createdAt });
  document.productionRun = { version: 1, id: 'fixture-export', authoringVersion: 4, status: 'completed', settings: nativeSettings({ narration: true }), sourceHash: '', runtimeIdentity: 'synthetic-export-fixture', nodes: [], createdAt: document.createdAt, updatedAt: document.updatedAt };
  document = parseEditorialCollagePipelineData(rebuildEditorialTimeline(document));
  const resolveAudioPath = vi.fn(async () => voice);
  const staging = { document, resolveAudioPath, stateRoot: paths.narrationState, outputDirectory: paths.narration, allowNarrationPauses: true, targetDurationSeconds: 15 };
  await stagePiNarrationTimeline(staging);
  const timeline = await requestPiNarrationPauses({ stateRoot: paths.narrationState, document, requested: [{ afterCueId: 'first', ms: 500, reason: 'Synthetic timing fixture' }] });
  await writeFile(join(paths.project, 'index.html'), nativeHtml(4000).replace('./core/lib.js', '/core/lib.js'), 'utf8');
  await writeFile(join(paths.project, 'TREATMENT.md'), '# Synthetic export fixture\nMechanics only; no artistic, speech intelligibility, or human approval claims.\n', 'utf8');
  await mkdir(join(paths.project, 'assets'));
  const manifest = { storydream: 'lemo-assets', version: 1, fps: 24, rules: [], assets: [] };
  await writeFile(join(paths.project, 'assets/MANIFEST.json'), JSON.stringify(manifest));
  const sourceHash = await piFilmSourceHash(paths.project), timelineHash = piDataHash(timeline), assetHash = piDataHash(await verifyLemoAssets(paths.project));
  // Readiness evidence is explicitly synthetic gate input, not a claim of artistic acceptance.
  document.piFilm = piFilmStateSchema.parse({ version: 1, authoringVersion: 4, runId: 'fixture-export', styleId: 'watercolor', policy: { ...newCodeVideoPolicy(), targetDurationSeconds: 15, allowNarrationPauses: true }, sessionRef: 'sessions/fixture.jsonl', phase: 'ready', segment: 1, completedModelRequests: 0,
    sourceHash, timelineHash, assetHash, actualDurationSeconds: 4, narrationPauses: timeline.pauses, acceptedPauseChanges: 1, message: 'Synthetic readiness fixture; not artistic approval',
    audioMaster: { path: 'audio/master.wav', sha256: await sha256File(master), sourceHash, timelineHash, durationSeconds: 4, sampleRate: 48000, channels: 2 },
    evidence: { sourceHash, timelineHash, assetHash, renderIdentity: { engine: 'lemo-upstream', browserVersion: 'synthetic-readiness-fixture', sourceHash, timelineHash, assetHash, width: 1920, height: 1080, fps: 24, captionMode: 'film' }, technicalPassed: true, readingPassed: true, audioPassed: true, contactSheetPasses: 2, previewRef: 'out/fixture.mp4', creditsPassed: true, humanReviewed: false } });
  return { work, paths, document, master, timeline, staging, manifest, options: { document, work, library, resolveAudioPath } };
}

describe('preparePiFilmExport integration (local synthetic fixtures, no paid services)', () => {
  it.each(['source', 'timeline', 'assets', 'master'] as const)('rejects changed %s before rendering', async kind => {
    const f = await fixture();
    const errors = { source: 'PI_EXPORT_SOURCE_CHANGED', timeline: 'PI_EXPORT_TIMELINE_OR_ASSETS_CHANGED', assets: 'PI_EXPORT_TIMELINE_OR_ASSETS_CHANGED', master: 'PI_EXPORT_AUDIO_CHANGED' };
    if (kind === 'source') await writeFile(join(f.paths.project, 'TREATMENT.md'), 'Changed fixture source');
    if (kind === 'master') await writeFile(f.master, wav(3));
    if (kind === 'timeline') await requestPiNarrationPauses({ stateRoot: f.paths.narrationState, document: f.document, requested: [{ afterCueId: 'first', ms: 400, reason: 'Changed fixture pause' }] });
    if (kind === 'assets') await writeFile(join(f.paths.project, 'assets/MANIFEST.json'), JSON.stringify({ ...f.manifest, rules: ['changed fixture manifest'] }));
    await expect(preparePiFilmExport(f.options)).rejects.toThrow(errors[kind]);
    expect(existsSync(join(f.paths.root, 'exports'))).toBe(false);
  });

  it.skipIf(!existsSync(library.pythonRoot) || !existsSync(join(library.upstreamRoot, 'core/render/video.mjs')))(
    'exports real 1080p H.264, writes paused SRT, and reloads narration after an export asset is appended', async () => {
      const f = await fixture();
      const result = await preparePiFilmExport(f.options);
      expect(result.durationMs).toBe(4000); expect(result.timeline).toEqual(f.timeline);
      expect(await readFile(result.subtitlePath, 'utf8')).toBe('1\n00:00:00,000 --> 00:00:01,500\nFirst sentence.\n\n2\n00:00:02,000 --> 00:00:04,000\nSecond sentence.\n');
      expect((await stat(result.picturePath)).size).toBeGreaterThan(1000);
      const receipt = JSON.parse(await readFile(join(dirname(result.picturePath), 'review.json'), 'utf8'));
      expect(receipt).toMatchObject({ engine: 'upstream-video.mjs', technicalPassed: true, aestheticReview: false, width: 1920, height: 1080, durationSeconds: 4 });
      expect(receipt.frames).toHaveLength(3);
      const runtime = await resolveLemoUpstreamRenderRuntime({ pythonRoot: library.pythonRoot, cacheDir: library.cacheDir });
      const media = await probeLemoMedia(runtime.ffmpegPath, result.picturePath);
      expect(media.video).toMatchObject({ codec: 'h264', width: 1920, height: 1080 });
      expect(media.durationSeconds).toBeCloseTo(4, 1);
      expect(result.scenes.reduce((sum, scene) => sum + scene.durationMs, 0)).toBe(4000);
      expect(result.scenes.flatMap(scene => scene.audioClips ?? []).every(clip => clip.path === f.master)).toBe(true);
      expect(result.scenes.flatMap(scene => scene.subtitleCues ?? [])).toEqual([]);
      f.document.assets.push({ id: 'export-fixture', assetId: 'export-fixture', kind: 'video', localPath: result.picturePath, durationMs: 4000, createdAt: f.document.createdAt });
      const reloaded = parseEditorialCollagePipelineData(JSON.parse(JSON.stringify(f.document)));
      const staged = await stagePiNarrationTimeline({ ...f.staging, document: reloaded });
      expect(staged).toEqual(result.timeline); expect(piDataHash(staged)).toBe(reloaded.piFilm!.timelineHash);
      expect(await sha256File(f.master)).toBe(reloaded.piFilm!.audioMaster!.sha256);
      expect(f.options.resolveAudioPath).toHaveBeenCalledOnce();
    }, 180_000);
});
