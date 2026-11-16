import { describe, expect, it } from 'vitest';
import { measureProductionNarrationAlignment, productionNarrationAlignmentEvidenceSchema } from '../src/shared/production-audio-alignment';

describe('production narration alignment evidence', () => {
  it('records planned and measured speaking speed from real asset duration', () => {
    const evidence = measureProductionNarrationAlignment([
      { id: 'shot-1', durationMs: 3_000, subtitleCues: [{ text: '城市证据', startMs: 0, endMs: 2_000 }], audioAssetVersionIds: ['voice-1'] },
    ], new Map([['voice-1', { durationMs: 2_100 }]]), '2026-09-10T00:00:00.000Z');
    expect(evidence.status).toBe('passed');
    expect(evidence.samples[0]).toMatchObject({
      actualDurationMs: 2_100,
      plannedDurationMs: 2_000,
      graphemeCount: 4,
      plannedCharactersPerSecond: 2,
      deltaMs: 100,
      status: 'aligned',
    });
    expect(evidence.samples[0].actualCharactersPerSecond).toBeCloseTo(4 / 2.1, 5);
    expect(productionNarrationAlignmentEvidenceSchema.parse(evidence)).toEqual(evidence);
  });

  it('keeps missing duration pending and never treats the estimate as actual audio timing', () => {
    const evidence = measureProductionNarrationAlignment([
      { id: 'shot-1', durationMs: 2_000, subtitleCues: [{ text: '长文', startMs: 0, endMs: 1_000 }], audioAssetVersionIds: ['voice-missing'] },
    ], new Map(), '2026-09-10T00:00:00.000Z');
    expect(evidence.status).toBe('pending');
    expect(evidence.samples[0]).toMatchObject({ status: 'unavailable' });
    expect(evidence.samples[0].actualDurationMs).toBeUndefined();
  });

  it('does not measure native mixed speech from container or clipped playback duration', () => {
    const evidence = measureProductionNarrationAlignment([
      { id: 'spoken-native', durationMs: 9_000, subtitleCues: [{ text: '这一次，我一定会守约。', startMs: 3278, endMs: 5723 }], audioAssetVersionIds: ['native-video'], audioDurationsMs: [9_000], speechTimingUnavailable: true },
      { id: 'action-native', durationMs: 6_000, subtitleCues: [], audioAssetVersionIds: ['action-video'], speechTimingUnavailable: true },
    ], new Map([['native-video', { durationMs: 9_420 }], ['action-video', { durationMs: 6_580 }]]));
    expect(evidence.status).toBe('pending');
    expect(evidence.samples[0]).toMatchObject({ status: 'unavailable', plannedDurationMs: 2445, audioAssetVersionIds: ['native-video'], detail: expect.stringContaining('请人工核对') });
    expect(evidence.samples[0].actualDurationMs).toBeUndefined();
    expect(evidence.samples[0].actualCharactersPerSecond).toBeUndefined();
    expect(evidence.samples[0].deltaMs).toBeUndefined();
    expect(evidence.samples[1].status).toBe('not-applicable');
    expect(productionNarrationAlignmentEvidenceSchema.parse(evidence)).toEqual(evidence);
  });

  it('marks a materially different recording as a manual mismatch', () => {
    const evidence = measureProductionNarrationAlignment([
      { id: 'shot-1', durationMs: 2_000, subtitleCues: [{ text: '一段需要复核的旁白', startMs: 0, endMs: 1_000 }], audioAssetVersionIds: ['voice-1'] },
    ], new Map([['voice-1', { durationMs: 2_400 }]]));
    expect(evidence.status).toBe('failed');
    expect(evidence.samples[0].status).toBe('mismatch');
    expect(evidence.samples[0].detail).toMatch(/实测音频/);
  });

  it('uses effective clip durations when one source asset is split across shots', () => {
    const evidence = measureProductionNarrationAlignment([
      { id: 'shot-1-a', durationMs: 1_500, subtitleCues: [{ text: '前半句', startMs: 0, endMs: 1_500 }], audioAssetVersionIds: ['voice-1'], audioDurationsMs: [1_500] },
      { id: 'shot-1-b', durationMs: 1_500, subtitleCues: [{ text: '后半句', startMs: 0, endMs: 1_500 }], audioAssetVersionIds: ['voice-1'], audioDurationsMs: [1_500] },
    ], new Map([['voice-1', { durationMs: 3_000 }]]));
    expect(evidence.status).toBe('passed');
    expect(evidence.samples.map((sample) => sample.actualDurationMs)).toEqual([1_500, 1_500]);
  });
});
