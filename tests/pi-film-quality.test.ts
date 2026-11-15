import { describe, expect, it } from 'vitest';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan } from '../src/shared/editorial-collage';
import { directorCanvasForRatio, directorDocumentRenderFingerprint, evaluateDirectorQuality, type DirectorRenderResult } from '../src/shared/director-render';
import { piFilmStateSchema } from '../src/shared/creative-animation/pi-film';
import { newCodeVideoPolicy } from '../src/shared/creative-animation/production-policy';
import { productionNarrationAlignmentEvidenceSchema } from '../src/shared/production-audio-alignment';
import { buildPiFilmExportScenes } from '../electron/pi-film-export-scenes';
import { evaluatePiFilmQuality, piFilmNarrationAlignment } from '../electron/pi-film-quality';
import type { PiNarrationTimelineResult } from '../electron/pi-narration-timeline';
import { nativeSettings } from './lemo-native.fixture';

function fixture() {
  const now = '2026-09-09T00:00:00.000Z', h = 'a'.repeat(64);
  const document = createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'pi', title: 'Film', now }), 'Speech.', now);
  document.assets.push({ id: 'voice', assetId: 'voice', kind: 'audio', durationMs: 4000, createdAt: now });
  document.productionRun = { version: 1, id: 'run', authoringVersion: 4, status: 'running', settings: nativeSettings({ lockedShotIds: [] }), sourceHash: '', runtimeIdentity: 'test', nodes: [], createdAt: now, updatedAt: now };
  const timeline: PiNarrationTimelineResult = { baselineHash: h, documentHash: h, durationMs: 6000, cues: [{ id: 'cue', text: 'Speech.', startMs: 0, endMs: 2000, sentenceEnd: true }], audioSlices: [{ path: 'voice.wav', startMs: 0, sourceStartMs: 1000, durationMs: 2000 }], materials: [{ path: 'voice.wav', assetVersionId: 'voice', sha256: h }], lockedWindows: [], pauses: [], acceptedChanges: 0, baselinePath: '', timelinePath: '', integration: { status: 'external-timeline-required', reason: 'test' } };
  document.piFilm = piFilmStateSchema.parse({ version: 1, authoringVersion: 4, runId: 'run', styleId: 'impasto', policy: newCodeVideoPolicy(), sessionRef: 'sessions/test.jsonl', phase: 'ready', segment: 1, completedModelRequests: 0, sourceHash: h, timelineHash: h, assetHash: h, actualDurationSeconds: 6, narrationPauses: [], acceptedPauseChanges: 0, message: '', audioMaster: { path: 'audio/master.wav', sha256: h, sourceHash: h, timelineHash: h, durationSeconds: 6, sampleRate: 48000, channels: 2 }, evidence: { sourceHash: h, timelineHash: h, assetHash: h, renderIdentity: { engine: 'lemo-upstream', browserVersion: 'test', sourceHash: h, timelineHash: h, assetHash: h, width: 1920, height: 1080, fps: 24, captionMode: 'film' }, technicalPassed: true, readingPassed: true, audioPassed: true, contactSheetPasses: 2, previewRef: 'out/preview.mp4', creditsPassed: true } });
  const scenes = buildPiFilmExportScenes(document, 'film.mp4', 'master.wav', timeline);
  const result: DirectorRenderResult = { outputPath: 'director-renders/test/exports/final.mp4', durationMs: 6000, sizeBytes: 5000, ...directorCanvasForRatio(document.ratio), hasAudio: true, hasVideo: true, hasNonBlackVideo: true, audioQualityStatus: 'ok', audioMeanVolumeDb: -20, audioPeakDb: -3, audioLufs: -16, audioTruePeakDb: -2, blackDetectionStatus: 'ok', blackIntervalsMs: [] };
  return { document, timeline, scenes, result };
}
function checks(f: ReturnType<typeof fixture>) { return evaluatePiFilmQuality(f.document, f.scenes, f.result, directorDocumentRenderFingerprint(f.document), f.timeline); }
function check(f: ReturnType<typeof fixture>, id: string) { return checks(f).find(item => item.id === id)!; }

describe('Pi film quality adapter', () => {
  it('validates real film scenes without mutating the authored document or treating musical tail as speech', () => {
    const f = fixture(), before = structuredClone(f.document);
    for (const id of ['timeline-continuity', 'dialogue-coverage', 'narration-alignment']) expect(check(f, id).status).toBe('passed');
    const alignment = piFilmNarrationAlignment(f.document, f.timeline);
    expect(alignment.samples[0]).toMatchObject({ actualDurationMs: 2000, audioAssetVersionIds: ['voice'], status: 'aligned' });
    expect(productionNarrationAlignmentEvidenceSchema.safeParse(alignment).success).toBe(true);
    expect(f.document).toEqual(before);
  });
  it('measures split speech around an inserted pause without counting the pause or musical tail', () => {
    const f = fixture();
    f.timeline.audioSlices = [{ path: 'voice.wav', startMs: 0, sourceStartMs: 1000, durationMs: 1000 }, { path: 'voice.wav', startMs: 1500, sourceStartMs: 2000, durationMs: 1000 }];
    f.timeline.cues = [{ id: 'a', text: 'First.', startMs: 0, endMs: 1000, sentenceEnd: true }, { id: 'b', text: 'Second.', startMs: 1500, endMs: 2500, sentenceEnd: true }];
    const alignment = piFilmNarrationAlignment(f.document, f.timeline);
    expect(alignment.status).toBe('passed');
    expect(alignment.samples.map(sample => sample.actualDurationMs)).toEqual([1000, 1000]);
  });
  it('keeps missing measured speech duration pending even with a measured master', () => {
    const f = fixture(); delete f.document.assets.find(asset => asset.id === 'voice')!.durationMs;
    expect(check(f, 'narration-alignment').status).toBe('pending');
  });
  it.each(['offset', 'duration', 'material', 'overlap', 'cue'] as const)('rejects malformed speech %s', kind => {
    const f = fixture();
    if (kind === 'offset') f.timeline.audioSlices[0].sourceStartMs = 3000;
    if (kind === 'duration') f.timeline.audioSlices[0].durationMs = -1;
    if (kind === 'material') f.timeline.materials = [];
    if (kind === 'overlap') f.timeline.audioSlices.push({ ...f.timeline.audioSlices[0] });
    if (kind === 'cue') f.timeline.cues[0].endMs = 9000;
    expect(check(f, 'narration-alignment')).toMatchObject({ status: 'failed', severity: 'blocking' });
    expect(check(f, 'narration-alignment').detail).toBeTruthy();
  });
  it.each(['scene', 'master', 'trim', 'empty'] as const)('rejects malformed render %s', kind => {
    const f = fixture();
    if (kind === 'scene') f.scenes[0].durationMs = 5000;
    if (kind === 'master') f.document.piFilm!.audioMaster!.durationSeconds = 2;
    if (kind === 'trim') f.scenes[0].audioClips![0].sourceStartMs = 100;
    if (kind === 'empty') f.scenes = [];
    expect(check(f, 'timeline-continuity').status).toBe('failed');
  });
  it.each(['empty', 'reading', 'stale'] as const)('requires nonempty current film reading evidence: %s', kind => {
    const f = fixture();
    if (kind === 'empty') f.timeline.cues = [];
    if (kind === 'reading') f.document.piFilm!.evidence!.readingPassed = false;
    if (kind === 'stale') f.document.piFilm!.evidence!.sourceHash = 'b'.repeat(64);
    expect(check(f, 'dialogue-coverage').status).toBe('failed');
  });
  it('retains every actual quality check, including failed media, missing assets, loudness and black frames', () => {
    const f = fixture(); f.result.sizeBytes = 0; f.result.audioLufs = -50; f.result.blackIntervalsMs = [{ startMs: 0, endMs: 1000 }]; f.scenes[0].videoPath = '';
    const base = evaluateDirectorQuality(f.document, f.scenes, f.result, directorDocumentRenderFingerprint(f.document));
    const adapted = checks(f);
    for (const item of base.filter(item => !['timeline-continuity', 'dialogue-coverage', 'narration-alignment'].includes(item.id))) expect(adapted.find(check => check.id === item.id)).toEqual(item);
    for (const id of ['media-output', 'asset-integrity', 'audio-level', 'black-intervals']) expect(check(f, id).status).toBe('failed');
  });
  it('requires exact host captions and retains normal subtitle timing/layout checks', () => {
    const f = fixture(); f.document.piFilm!.policy.captionMode = 'host'; f.document.piFilm!.evidence!.renderIdentity.captionMode = 'host';
    f.scenes = buildPiFilmExportScenes(f.document, 'film.mp4', 'master.wav', f.timeline);
    expect(check(f, 'dialogue-coverage').status).toBe('passed');
    f.scenes[0].subtitleCues![0].endMs = 7000;
    expect(check(f, 'subtitle-timing').status).toBe('failed');
    expect(check(f, 'dialogue-coverage').status).toBe('failed');
    f.scenes[0].subtitleCues = [];
    expect(check(f, 'dialogue-coverage').status).toBe('failed');
  });
});
