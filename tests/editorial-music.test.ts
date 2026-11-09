import { describe, expect, it } from 'vitest';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, mergeEditorialShots, parseEditorialCollagePipelineData, rebuildEditorialTimeline, reorderEditorialShot, splitEditorialShot } from '../src/shared/editorial-collage';
import { fitEditorialNarrationTiming } from '../src/shared/editorial-narration-timing';
import { PROJECT_MUSIC_PREFIX } from '../src/shared/editorial-music';
import { productionAudioClipGainAtTime, productionAudioClipsForShot } from '../src/shared/production-audio';
import { voxProductionSettings, voxProjectMusicSchema } from '../src/shared/vox-production';
import { directorSoundClips } from '../src/features/director-desk/director-sound';

function fixture(durationMs = 7000, loop = true) {
  const document = createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'music', title: '音乐连续性' }), '开场。背景。证据。结论。');
  return rebuildEditorialTimeline({ ...document, productionSettings: { ...voxProductionSettings(), music: voxProjectMusicSchema.parse({ id: 'track', title: '本地音乐', path: 'I:/fixture/music.wav', durationMs, loop }) } });
}

describe('whole-project background music', () => {
  it.each([1000, 7000, 60000])('keeps one source clock across shots and loops (%s ms source)', durationMs => {
    const document = fixture(durationMs);
    const clips = document.timeline!.audioClips!;
    let cursor = 0;
    for (const clip of clips) {
      expect(clip.startMs).toBe(cursor);
      expect(clip.sourceStartMs).toBe(cursor % durationMs);
      expect(clip.sourceStartMs! + clip.sourceDurationMs!).toBeLessThanOrEqual(durationMs);
      cursor += clip.durationMs!;
    }
    expect(cursor).toBe(document.timeline!.durationMs);
    expect(parseEditorialCollagePipelineData(document)).toEqual(document);
    expect(rebuildEditorialTimeline(document)).toEqual(document);
    const firstShot = document.beats[0].shots[0];
    expect(productionAudioClipsForShot(document.timeline, firstShot)).toEqual(clips.filter(clip => clip.shotId === firstShot.id));
    expect(directorSoundClips(document, firstShot.id)).toEqual([]);
  });

  it('does not restart fades at a shot boundary, including repeated structural cuts', () => {
    const document = fixture(60000);
    const split = splitEditorialShot(document, document.beats[0].shots[0].id, 500);
    const clips = split.timeline!.audioClips!;
    const gain = (time: number) => clips.reduce((sum, clip) => sum + productionAudioClipGainAtTime(clip, time), 0);
    const level = Math.pow(10, -18 / 20);
    expect(gain(0)).toBe(0);
    expect(gain(499)).toBeCloseTo(level * 499 / 800);
    expect(gain(500)).toBeCloseTo(level * 500 / 800);
    expect(gain(3000)).toBeCloseTo(level);
    expect(gain(split.timeline!.durationMs - 600)).toBeCloseTo(level / 2);
    expect(parseEditorialCollagePipelineData(split)).toEqual(split);
  });

  it('ends non-looping music at its measured source duration', () => {
    const document = fixture(7000, false);
    const clips = document.timeline!.audioClips!;
    expect(clips.at(-1)!.startMs + clips.at(-1)!.durationMs!).toBe(7000);
    expect(parseEditorialCollagePipelineData(document)).toEqual(document);
  });

  it('keeps the project clock after reordering and merging shots', () => {
    const document = fixture();
    const split = splitEditorialShot(document, document.beats[0].shots[0].id, 1000);
    const reordered = reorderEditorialShot(split, split.beats[0].shots[1].id, 0);
    const merged = mergeEditorialShots(reordered, reordered.beats[0].shots[0].id, reordered.beats[0].shots[1].id);
    for (const edited of [reordered, merged]) {
      const clips = edited.timeline!.audioClips!.filter(clip => clip.id.startsWith(PROJECT_MUSIC_PREFIX));
      let cursor = 0;
      for (const clip of clips) {
        expect(clip.startMs).toBe(cursor);
        expect(clip.sourceStartMs).toBe(cursor % 7000);
        cursor += clip.durationMs!;
      }
      expect(cursor).toBe(edited.timeline!.durationMs);
      expect(parseEditorialCollagePipelineData(edited)).toEqual(edited);
    }
  });

  it('reflows after measured narration without retaining estimate gaps or duplicating audio', () => {
    const document = fixture();
    const shot = document.beats[0].shots[0];
    shot.voiceAssetVersionId = 'voice';
    document.assets.push({ id: 'voice', assetId: 'voice', kind: 'audio', localPath: 'I:/fixture/voice.wav', durationMs: 1000, createdAt: document.createdAt });
    const fitted = fitEditorialNarrationTiming(document);
    expect(fitted.beats[0].shots[0].durationMs).toBe(1166);
    const music = fitted.timeline!.audioClips!.filter(clip => clip.id.startsWith(PROJECT_MUSIC_PREFIX));
    expect(music[1].startMs).toBe(1166);
    expect(music[1].sourceStartMs).toBe(1166);
    expect(parseEditorialCollagePipelineData(fitted)).toEqual(fitted);
    expect(fitEditorialNarrationTiming(fitted)).toBe(fitted);
    const removed = rebuildEditorialTimeline({ ...fitted, productionSettings: { ...fitted.productionSettings!, music: undefined } });
    expect(removed.timeline!.audioClips!.every(clip => !clip.id.startsWith(PROJECT_MUSIC_PREFIX))).toBe(true);
    expect(removed.timeline!.audioClips!.some(clip => clip.assetVersionId === 'voice')).toBe(true);
    expect(parseEditorialCollagePipelineData(removed)).toEqual(removed);
  });
});


