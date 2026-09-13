import { describe, expect, it } from 'vitest';
import {
  audioClipsAtTime,
  normalizeProductionAudioClips,
  resolveProductionAudioClips,
  productionAudioClipsForShot,
  validateProductionAudioTimeline,
  type ProductionAudioClip,
} from '../src/shared/production-audio';

describe('production audio clips', () => {
  const clips: ProductionAudioClip[] = [
    { id: 'dialogue-1', assetVersionId: 'voice', trackType: 'dialogue', startMs: 120, sourceStartMs: 400, sourceDurationMs: 900, gainDb: -3 },
    { id: 'sfx-1', assetVersionId: 'sfx', trackType: 'sfx', startMs: 600, durationMs: 300, gainDb: 2 },
  ];

  it('normalizes clip timing, gain and mute without mutating source data', () => {
    const normalized = normalizeProductionAudioClips([
      ...clips,
      { id: 'muted', assetVersionId: 'voice', trackType: 'narration', startMs: -20, durationMs: 100, muted: true },
    ], 1000);
    expect(normalized).toHaveLength(2);
    expect(normalized[0]).toMatchObject({ startMs: 120, sourceStartMs: 400, gainDb: -3 });
    expect(normalized[1]).toMatchObject({ startMs: 600, durationMs: 300, gainDb: 2 });
    expect(clips[0].startMs).toBe(120);
  });

  it('resolves only valid local audio assets and clips to the scene bounds', () => {
    const assets = new Map([
      ['voice', { id: 'voice', assetId: 'voice', kind: 'audio' as const, localPath: 'C:/voice.wav', createdAt: '2026-01-01' }],
      ['sfx', { id: 'sfx', assetId: 'sfx', kind: 'audio' as const, localPath: 'C:/sfx.wav', createdAt: '2026-01-01' }],
      ['image', { id: 'image', assetId: 'image', kind: 'image' as const, localPath: 'C:/image.png', createdAt: '2026-01-01' }],
    ]);
    expect(() => resolveProductionAudioClips([{ id: 'bad', assetVersionId: 'image', trackType: 'sfx', startMs: 0 }], assets, 1000)).toThrow('DIRECTOR_AUDIO_ASSET_MISSING');
    const resolved = resolveProductionAudioClips(clips, assets, 1000);
    expect(resolved).toHaveLength(2);
    expect(resolved[0]).toMatchObject({ path: 'C:/voice.wav', durationMs: 880 });
    expect(resolved[1]).toMatchObject({ path: 'C:/sfx.wav', durationMs: 300 });
  });

  it('provides the same audible-at-time projection used by preview controls', () => {
    expect(audioClipsAtTime(clips, 200).map((clip) => clip.id)).toEqual(['dialogue-1']);
    expect(audioClipsAtTime(clips, 650).map((clip) => clip.id)).toEqual(['dialogue-1', 'sfx-1']);
    expect(audioClipsAtTime(clips, 1100)).toEqual([]);
  });

  it('keeps legacy narration alongside SFX but respects explicitly muted speech', () => {
    const timeline = { durationMs: 2000, clips: [{ id: 'scene', shotId: 'shot', startMs: 1000, durationMs: 1000, assetVersionIds: [], subtitleCueIds: [], source: 'local' as const }], audioAssetVersionIds: ['voice', 'sfx'], audioClips: [{ ...clips[1], shotId: 'shot', startMs: 1200 }] };
    const shot = { id: 'shot', durationMs: 1000, voiceAssetVersionId: 'voice' };
    expect(productionAudioClipsForShot(timeline, shot)?.map((clip) => clip.trackType)).toEqual(['narration', 'sfx']);
    expect(productionAudioClipsForShot(timeline, shot)?.[0]).toMatchObject({ startMs: 1000, durationMs: 1000, assetVersionId: 'voice' });
    const muted = { ...timeline, audioClips: [{ ...clips[0], shotId: 'shot', startMs: 1000, muted: true }] };
    expect(productionAudioClipsForShot(muted, shot)).toEqual(muted.audioClips);
    expect(resolveProductionAudioClips(muted.audioClips, new Map(), 2000)).toEqual([]);
  });

  it('rejects cross-shot placements and dangling or non-audio references', () => {
    const timeline = { durationMs: 2000, clips: [{ id: 'scene', shotId: 'shot', startMs: 1000, durationMs: 1000, assetVersionIds: [], subtitleCueIds: [], source: 'local' as const }], audioAssetVersionIds: [], audioClips: [{ ...clips[0], shotId: 'shot', startMs: 0 }] };
    const issues = validateProductionAudioTimeline(timeline, new Map());
    expect(issues.some((issue) => issue.message.includes('owning shot'))).toBe(true);
    expect(issues.some((issue) => issue.message.includes('audio asset'))).toBe(true);
  });
});
