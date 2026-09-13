import { describe, expect, it } from 'vitest';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, insertEditorialShot, mergeEditorialShots, parseEditorialCollagePipelineData, rebuildEditorialTimeline, removeEditorialShot, reorderEditorialShot, splitEditorialShot } from '../src/shared/editorial-collage';
import { productionAudioClipGainAtTime } from '../src/shared/production-audio';
import { buildDirectorRenderScenes } from '../src/shared/director-render';
import { updateDirectorAudioClip } from '../src/shared/director-audio-edit';

function project() {
  const document = createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'audio-structure', title: 'Audio structure' }), '开场。背景。证据。结论。');
  document.assets = [
    { id: 'voice', assetId: 'voice', kind: 'audio', localPath: 'C:/fixture/voice.wav', createdAt: document.createdAt },
    { id: 'sound', assetId: 'sound', kind: 'audio', localPath: 'C:/fixture/sound.wav', createdAt: document.createdAt },
    { id: 'image', assetId: 'image', kind: 'image', localPath: 'C:/fixture/image.png', createdAt: document.createdAt },
  ];
  document.beats.forEach((beat) => beat.shots.forEach((shot) => {
    shot.voiceAssetVersionId = 'voice';
    shot.layers.forEach((layer) => { layer.assetVersionId = 'image'; });
  }));
  document.timeline!.audioClips = [
    { id: 'music', shotId: document.beats[0].shots[0].id, assetVersionId: 'sound', trackType: 'music', startMs: 200, durationMs: 2800, sourceStartMs: 500, sourceDurationMs: 2600, sourceMediaDurationMs: 5000, gainDb: -9, fadeInMs: 2000, fadeOutMs: 1800 },
    { id: 'muted', shotId: document.beats[0].shots[0].id, assetVersionId: 'sound', trackType: 'sfx', startMs: 1800, durationMs: 200, muted: true },
    { id: 'later', shotId: document.beats[1].shots[0].id, assetVersionId: 'sound', trackType: 'ambience', startMs: 3300, durationMs: 500 },
  ];
  return rebuildEditorialTimeline(document);
}

describe('editorial audio structure', () => {
  it('moves attached sounds with shots and later beats without changing source trims', () => {
    const source = project();
    const inserted = insertEditorialShot(source, source.beats[0].id, 0, undefined, 1000);
    const moved = inserted.timeline!.audioClips!.find((clip) => clip.id === 'music')!;
    expect(moved).toMatchObject({ startMs: 1200, sourceStartMs: 500, sourceDurationMs: 2600, gainDb: -9 });
    expect(inserted.timeline!.audioClips!.find((clip) => clip.id === 'later')?.startMs).toBe(4300);
    const reordered = reorderEditorialShot(inserted, source.beats[0].shots[0].id, 0);
    expect(reordered.timeline!.audioClips!.find((clip) => clip.id === 'music')?.startMs).toBe(200);
    const removed = removeEditorialShot(reordered, inserted.beats[0].shots[0].id);
    expect(removed.timeline!.audioClips).toEqual(source.timeline!.audioClips);
    expect(() => parseEditorialCollagePipelineData(removed)).not.toThrow();
  });

  it('splits narration and sound source ranges while retaining the original fade envelope', () => {
    const source = project();
    const before = source.timeline!.audioClips![0];
    const split = splitEditorialShot(source, source.beats[0].shots[0].id, 1500);
    const [first, second] = split.beats[0].shots;
    const music = split.timeline!.audioClips!.filter((clip) => clip.trackType === 'music');
    expect(music).toHaveLength(2);
    expect(music[0]).toMatchObject({ shotId: first.id, startMs: 200, durationMs: 1300, sourceStartMs: 500, sourceDurationMs: 1300 });
    expect(music[1]).toMatchObject({ shotId: second.id, startMs: 1500, durationMs: 1500, sourceStartMs: 1800, sourceDurationMs: 1300 });
    for (const atMs of [200, 400, 1200, 1499, 1500, 1700, 2400, 2700, 2850]) {
      const gain = music.reduce((sum, clip) => sum + productionAudioClipGainAtTime(clip, atMs), 0);
      expect(gain).toBeCloseTo(productionAudioClipGainAtTime(before, atMs), 10);
    }
    const speech = split.timeline!.audioClips!.filter((clip) => clip.trackType === 'narration');
    expect(speech).toMatchObject([{ shotId: first.id, sourceStartMs: 0, durationMs: 1500 }, { shotId: second.id, sourceStartMs: 1500, durationMs: 1500 }]);
    expect(split.timeline!.audioClips!.find((clip) => clip.id === 'muted')).toMatchObject({ shotId: second.id, muted: true, startMs: 1800 });
    expect(() => parseEditorialCollagePipelineData(split)).not.toThrow();
    expect(buildDirectorRenderScenes(split).slice(0, 2).every((scene) => scene.audioClips?.some((clip) => clip.trackType === 'narration'))).toBe(true);
    expect(source.beats[0].shots[0].voiceAssetVersionId).toBe('voice');
  });

  it('preserves per-shot narration and sound offsets when merging and removes only deleted shot sounds', () => {
    const source = project();
    const split = splitEditorialShot(source, source.beats[0].shots[0].id, 1500);
    const [first, second] = split.beats[0].shots;
    const merged = mergeEditorialShots(split, first.id, second.id);
    expect(merged.timeline!.audioClips!.filter((clip) => clip.trackType === 'music').map((clip) => clip.startMs)).toEqual([200, 1500]);
    expect(merged.timeline!.audioClips!.filter((clip) => clip.trackType === 'narration').every((clip) => clip.shotId === first.id)).toBe(true);
    expect(() => parseEditorialCollagePipelineData(merged)).not.toThrow();
    const removed = removeEditorialShot(split, first.id);
    expect(removed.timeline!.audioClips!.some((clip) => clip.shotId === first.id)).toBe(false);
    expect(removed.timeline!.audioClips!.find((clip) => clip.id === 'later')?.startMs).toBe(1800);
    expect(removed.assets).toEqual(source.assets);
  });

  it('retains the original envelope across repeated cuts and keeps the exhausted source tail silent', () => {
    const source = project();
    const split = splitEditorialShot(source, source.beats[0].shots[0].id, 1500);
    const repeated = splitEditorialShot(split, split.beats[0].shots[1].id, 1200);
    const final = splitEditorialShot(repeated, repeated.beats[0].shots[2].id, 150);
    const music = final.timeline!.audioClips!.filter((clip) => clip.trackType === 'music');
    expect(new Set(final.timeline!.audioClips!.map((clip) => clip.id)).size).toBe(final.timeline!.audioClips!.length);
    expect(music.at(-1)).toMatchObject({ startMs: 2850, durationMs: 150, sourceStartMs: 3100, sourceDurationMs: 0 });
    for (let atMs = 0; atMs < 3000; atMs += 13) {
      expect(music.reduce((sum, clip) => sum + productionAudioClipGainAtTime(clip, atMs), 0)).toBeCloseTo(productionAudioClipGainAtTime(source.timeline!.audioClips![0], atMs), 10);
    }
    expect(() => parseEditorialCollagePipelineData(JSON.stringify(final))).not.toThrow();
    expect(buildDirectorRenderScenes(final)[3].audioClips!.find((clip) => clip.trackType === 'music')?.sourceDurationMs).toBe(0);
  });

  it('materializes both unsplit legacy recordings and freezes implicit sound duration before merging', () => {
    const source = project();
    const inserted = insertEditorialShot(source, source.beats[0].id, 1, undefined, 1000);
    const [first, second] = inserted.beats[0].shots;
    second.voiceAssetVersionId = 'voice';
    inserted.timeline!.audioClips!.push({ id: 'implicit', shotId: first.id, assetVersionId: 'sound', trackType: 'sfx', startMs: 2500 });
    const merged = mergeEditorialShots(inserted, first.id, second.id);
    expect(merged.timeline!.audioClips!.filter((clip) => clip.trackType === 'narration')).toMatchObject([
      { startMs: 0, durationMs: 3000 }, { startMs: 3000, durationMs: 1000 },
    ]);
    expect(merged.timeline!.audioClips!.find((clip) => clip.id === 'implicit')).toMatchObject({ startMs: 2500, durationMs: 500 });
  });

  it('keeps the inherited envelope for mix edits and resets it for new authored fades', () => {
    const source = project();
    const split = splitEditorialShot(source, source.beats[0].shots[0].id, 1500);
    const clip = split.timeline!.audioClips!.find((item) => item.trackType === 'music' && item.startMs === 1500)!;
    const adjusted = updateDirectorAudioClip(split, clip.shotId!, clip.id, { gainDb: -6, muted: true });
    expect(adjusted.timeline!.audioClips!.find((item) => item.id === clip.id)?.fadeEnvelope).toEqual(clip.fadeEnvelope);
    const authored = updateDirectorAudioClip(adjusted, clip.shotId!, clip.id, { fadeInMs: 100, muted: false });
    expect(authored.timeline!.audioClips!.find((item) => item.id === clip.id)?.fadeEnvelope).toBeUndefined();
    expect(() => parseEditorialCollagePipelineData(authored)).not.toThrow();
    const corrupt = structuredClone(split);
    corrupt.timeline!.audioClips!.find((item) => item.id === clip.id)!.fadeEnvelope!.offsetMs = 2000;
    expect(() => parseEditorialCollagePipelineData(corrupt)).toThrow('fade envelope');
  });

  it('keeps old exports in history while invalidating their current-version selection', () => {
    const source = project();
    source.stage = 'completed';
    source.assets.push({ id: 'final', assetId: 'director-final-video', kind: 'video', localPath: 'C:/fixture/final.mp4', createdAt: source.createdAt, selected: true, pinned: true });
    const edited = splitEditorialShot(source, source.beats[0].shots[0].id, 1500);
    expect(edited.stage).toBe('assets');
    expect(edited.assets.find((asset) => asset.id === 'final')).toMatchObject({ selected: false, pinned: false, localPath: 'C:/fixture/final.mp4' });
    expect(source.assets.at(-1)).toMatchObject({ selected: true, pinned: true });
  });
});
