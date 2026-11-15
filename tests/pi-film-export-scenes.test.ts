import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativePictureDocument, nativeSettings } from './lemo-native.fixture';
import { buildPiFilmExportScenes } from '../electron/pi-film-export-scenes';
import { piDataHash, piFilmSourceHash } from '../electron/pi-film-fingerprint';
import { piFilmStateSchema } from '../src/shared/creative-animation/pi-film';
import { newCodeVideoPolicy } from '../src/shared/creative-animation/production-policy';
import { lemoReservedWindows } from '../src/shared/lemo-locked-shots';
import { stagePiNarrationTimeline, requestPiNarrationPauses } from '../electron/pi-narration-timeline';
import { rebuildEditorialTimeline } from '../src/shared/editorial-collage';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pi-export-scenes-')); roots.push(root);
  const voice = join(root, 'voice.wav'); await writeFile(voice, 'immutable synthetic voice bytes (timeline does not decode)');
  let document = nativePictureDocument(); const shots = document.beats.flatMap(b => b.shots);
  document.assets.push({ id: 'voice', assetId: 'voice', kind: 'audio', localPath: voice, durationMs: 30000, createdAt: document.createdAt });
  for (const shot of shots) shot.voiceAssetVersionId = 'voice';
  document.productionRun = { version: 1, id: 'run', authoringVersion: 4, status: 'running', settings: nativeSettings({ narration: true, lockedShotIds: [shots[0].id] }), sourceHash: '', runtimeIdentity: 'test', nodes: [], createdAt: document.createdAt, updatedAt: document.updatedAt };
  document = rebuildEditorialTimeline(document);
  const stateRoot = join(root, 'private');
  const before = await stagePiNarrationTimeline({ document, resolveAudioPath: () => voice, outputDirectory: join(root, 'narration'), stateRoot, allowNarrationPauses: true, targetDurationSeconds: 30 });
  const lock = lemoReservedWindows(document)![0];
  const cue = before.cues.find(c => c.sentenceEnd && c.endMs >= lock.endMs)!;
  const timeline = await requestPiNarrationPauses({ stateRoot, document, requested: [{ afterCueId: cue.id, ms: 500, reason: 'Reading pause after protected picture' }] });
  const h = 'a'.repeat(64), timelineHash = piDataHash(timeline);
  document.piFilm = piFilmStateSchema.parse({ version: 1, authoringVersion: 4, runId: 'run', styleId: 'impasto', policy: newCodeVideoPolicy(), sessionRef: 'sessions/synthetic.jsonl', phase: 'ready', segment: 1, completedModelRequests: 0, sourceHash: h, timelineHash, assetHash: h, actualDurationSeconds: timeline.durationMs / 1000, narrationPauses: timeline.pauses, acceptedPauseChanges: 1, message: '', audioMaster: { path: 'audio/master.wav', sha256: h, sourceHash: h, timelineHash, durationSeconds: timeline.durationMs / 1000, sampleRate: 48000, channels: 2 }, evidence: { sourceHash: h, timelineHash, assetHash: h, renderIdentity: { engine: 'lemo-upstream', browserVersion: 'test', sourceHash: h, timelineHash, assetHash: h, width: 1920, height: 1080, fps: 24, captionMode: 'film' }, technicalPassed: true, readingPassed: true, audioPassed: true, contactSheetPasses: 2, previewRef: 'out/preview.mp4', creditsPassed: true } });
  return { document, timeline, before, lock, root };
}

describe('Pi v4 export assembly', () => {
  it('preserves locked pictures and consumes exact master offsets across an approved pause', async () => {
    const { document, timeline, before, lock } = await fixture();
    const original = structuredClone(document);
    const scenes = buildPiFilmExportScenes(document, 'film.mp4', 'master.wav', timeline);
    expect(timeline.durationMs).toBe(before.durationMs + 500);
    expect(scenes[0].id).toBe(lock.shotId);
    expect(scenes[0].durationMs).toBe(lock.endMs - lock.startMs);
    expect(scenes[0].videoPath).not.toBe('film.mp4');
    let elapsed = 0;
    for (const scene of scenes) {
      expect(scene.audioPath).toBe(''); expect(scene.caption).toBe('');
      if (scene.id === lock.shotId) expect(scene.subtitleCues?.length).toBeGreaterThan(0);
      else expect(scene.subtitleCues).toEqual([]);
      expect(scene.transitionIn).toEqual({ type: 'cut', durationMs: 0 });
      expect(scene.audioClips).toEqual([{ id: `pi-master-${scene.index}`, assetVersionId: 'pi-master', path: 'master.wav', trackType: 'narration', startMs: 0, durationMs: scene.durationMs, sourceStartMs: elapsed, sourceDurationMs: scene.durationMs, sourceMediaDurationMs: timeline.durationMs, gainDb: 0 }]);
      if (scene.id !== lock.shotId) expect(scene.videoStartMs).toBe(elapsed);
      elapsed += scene.durationMs;
    }
    expect(elapsed).toBe(timeline.durationMs); expect(document).toEqual(original);
  });
  it('host mode clips absolute cues to local windows without changing audio or adding duplicate film captions', async () => {
    const { document, timeline } = await fixture();
    const film = buildPiFilmExportScenes(document, 'film.mp4', 'master.wav', timeline);
    document.piFilm!.policy.captionMode = 'host'; document.piFilm!.evidence!.renderIdentity.captionMode = 'host';
    const host = buildPiFilmExportScenes(document, 'film.mp4', 'master.wav', timeline);
    expect(host.map(s => s.audioClips)).toEqual(film.map(s => s.audioClips));
    let start = 0;
    for (const scene of host) {
      const end = start + scene.durationMs;
      expect(scene.subtitleCues).toEqual(timeline.cues.filter(c => c.startMs < end && c.endMs > start).map(c => ({ id: c.id, text: c.text, startMs: Math.max(start, c.startMs) - start, endMs: Math.min(end, c.endMs) - start })));
      start = end;
    }
    expect(host.flatMap(s => s.subtitleCues ?? []).length).toBeGreaterThan(0);
  });
  it('rejects stale master, duration, run, and caption evidence', async () => {
    const { document, timeline } = await fixture();
    const cases = [
      () => { document.piFilm!.audioMaster!.timelineHash = 'b'.repeat(64); },
      () => { document.piFilm!.actualDurationSeconds += .1; },
      () => { document.piFilm!.runId = 'other'; },
      () => { document.piFilm!.policy.captionMode = 'host'; },
    ];
    const saved = structuredClone(document.piFilm);
    for (const change of cases) { document.piFilm = structuredClone(saved); change(); expect(() => buildPiFilmExportScenes(document, 'film.mp4', 'master.wav', timeline)).toThrow(/PI_EXPORT/); }
  });
  it('fingerprints authored picture, score, and mix edits while excluding host outputs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-export-fingerprint-')); roots.push(root);
    await mkdir(join(root, 'audio')); await mkdir(join(root, 'out'));
    await writeFile(join(root, 'index.html'), '<canvas/>'); await writeFile(join(root, 'audio/score.json'), '{}'); await writeFile(join(root, 'audio/mix.json'), '{}');
    let hash = await piFilmSourceHash(root);
    await writeFile(join(root, 'out/preview.mp4'), 'host output'); expect(await piFilmSourceHash(root)).toBe(hash);
    for (const file of ['index.html', 'audio/score.json', 'audio/mix.json']) { await writeFile(join(root, file), 'changed'); const next = await piFilmSourceHash(root); expect(next).not.toBe(hash); hash = next; }
    expect(piDataHash({ durationMs: 4000, pauses: [] })).not.toBe(piDataHash({ durationMs: 4500, pauses: [{ ms: 500 }] }));
  });
});
