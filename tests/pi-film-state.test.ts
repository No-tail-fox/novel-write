import { describe, expect, it } from 'vitest';
import { piArtifactRefSchema, piFilmReadyErrors, piFilmStateSchema } from '../src/shared/creative-animation/pi-film';
import { newCodeVideoPolicy } from '../src/shared/creative-animation/production-policy';
const h = 'a'.repeat(64);
function ready() {
  return piFilmStateSchema.parse({ version: 1, authoringVersion: 4, runId: 'run', styleId: 'impasto', policy: newCodeVideoPolicy(), sessionRef: 'sessions/film.jsonl', phase: 'ready', segment: 1, completedModelRequests: 2,
    sourceHash: h, timelineHash: h, assetHash: h, actualDurationSeconds: 60, narrationPauses: [], acceptedPauseChanges: 0, message: '',
    evidence: { sourceHash: h, timelineHash: h, assetHash: h, renderIdentity: { engine: 'lemo-upstream', browserVersion: 'test', sourceHash: h, timelineHash: h, assetHash: h, width: 1920, height: 1080, fps: 24, captionMode: 'film' }, technicalPassed: true, readingPassed: true, audioPassed: true, contactSheetPasses: 2, previewRef: 'out/preview.mp4', creditsPassed: true },
  });
}
describe('separate Pi film state', () => {
  it('requires current evidence while distinguishing human review', () => {
    const film = ready();
    expect(piFilmReadyErrors(film)).toEqual([]);
    expect(film.evidence?.humanReviewed).toBe(false);
    expect(piFilmReadyErrors({ ...film, timelineHash: 'b'.repeat(64) })).toContain('PI_FILM_EVIDENCE_STALE');
    expect(piFilmReadyErrors({ ...film, policy: { ...film.policy, captionMode: 'host' } })).toContain('PI_FILM_EVIDENCE_STALE');
    expect(piFilmReadyErrors({ ...film, phase: 'reconciliation-required' })).toContain('PI_FILM_NOT_READY');
    expect(piFilmReadyErrors({ ...film, evidence: undefined })).toContain('PI_FILM_EVIDENCE_MISSING');
  });
  it('rejects external artifact references before persistence', () => {
    for (const ref of ['../secret', '/absolute', 'C:/secret', 'out/../secret', 'out\\secret', 'out//secret']) expect(piArtifactRefSchema.safeParse(ref).success).toBe(false);
    expect(piArtifactRefSchema.parse('out/stems/music.wav')).toBe('out/stems/music.wav');
  });
  it('does not accept v3 journals as Pi state', () => {
    expect(piFilmStateSchema.safeParse({ ...ready(), authoringVersion: 3 }).success).toBe(false);
  });
});
