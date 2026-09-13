import { describe, expect, it } from 'vitest';
import { alignSubtitleCue, isSubtitleAlignmentValid } from '../src/shared/audio-alignment';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, insertEditorialBeat, insertEditorialShot, mergeEditorialShots, moveEditorialShot, parseEditorialCollagePipelineData, rebuildEditorialTimeline, removeEditorialBeat, reorderEditorialBeat, reorderEditorialShot, splitEditorialShot } from '../src/shared/editorial-collage';
import { directorCameraStyle, directorLayerStyle } from '../src/features/director-desk/DirectorDeskWorkspace';

function expectSameTransform(actual: string | undefined, expected: string | undefined) {
  const numbers = (value: string | undefined) => (value ?? '').match(/-?\d*\.?\d+(?:e[+-]?\d+)?/gu)?.map(Number) ?? [];
  const values = numbers(actual);
  expect(values).toHaveLength(numbers(expected).length);
  numbers(expected).forEach((value, index) => expect(values[index]).toBeCloseTo(value, 10));
}

function project() {
  const source = createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'timing', title: 'Timing' }), '开场。背景。证据。结论。');
  source.beats[0].shots[0].camera = [{ atMs: 0, x: .5, y: .5, zoom: 1 }, { atMs: 1500, x: .6, y: .4, zoom: 1.3 }, { atMs: 3000, x: .4, y: .6, zoom: 1.1 }];
  source.beats.forEach((beat) => { beat.subtitleCues = beat.subtitleCues.map((cue) => alignSubtitleCue(cue)); });
  return rebuildEditorialTimeline(source);
}

describe('editorial structure timing', () => {
  it.each(['up', 'down'] as const)('preserves every shot-local cue, token and audio offset when crossing %s', (direction) => {
    let source = project();
    for (const beatId of source.beats.slice(0, 2).map((beat) => beat.id)) source = insertEditorialShot(source, beatId, 1, undefined, 1000);
    source.beats = source.beats.map((beat) => {
      let start = beat.startMs;
      const subtitleCues = beat.shots.flatMap((shot) => {
        const cues = [100, 400].map((offset, index) => alignSubtitleCue({ id: `${shot.id}-clock-${index}`, text: '时间保持', startMs: start + offset, endMs: start + offset + 200, ...(index === 0 ? { shotId: shot.id } : {}) }));
        start += shot.durationMs;
        return cues;
      });
      return { ...beat, subtitleCues, shots: beat.shots.map((shot) => ({ ...shot, subtitleCueIds: [0, 1].map((index) => `${shot.id}-clock-${index}`) })) };
    });
    source.assets.push({ id: 'clock-audio', assetId: 'clock-audio', kind: 'audio', createdAt: source.createdAt });
    source.timeline!.audioClips = source.timeline!.clips.map((clip) => ({ id: `${clip.shotId}-audio`, assetVersionId: 'clock-audio', shotId: clip.shotId, trackType: 'sfx', startMs: clip.startMs + 150, durationMs: 300, sourceStartMs: 85, gainDb: -6 }));
    source = parseEditorialCollagePipelineData(rebuildEditorialTimeline(source));
    const snapshot = structuredClone(source);
    const moving = direction === 'up' ? source.beats[1].shots[0] : source.beats[0].shots.at(-1)!;
    const next = moveEditorialShot(source, moving.id, direction);
    expect(source).toEqual(snapshot);
    expect(next.beats.flatMap((beat) => beat.shots.map((shot) => shot.id))).toEqual(source.beats.flatMap((beat) => beat.shots.map((shot) => shot.id)));
    for (const clip of source.timeline!.clips) {
      const nextClip = next.timeline!.clips.find((item) => item.shotId === clip.shotId)!;
      const shift = nextClip.startMs - clip.startMs;
      const beat = next.beats.find((item) => item.shots.some((shot) => shot.id === clip.shotId))!;
      for (const cue of source.beats.flatMap((item) => item.subtitleCues).filter((item) => clip.subtitleCueIds.includes(item.id))) {
        const after = beat.subtitleCues.find((item) => item.id === cue.id)!;
        expect(after).toMatchObject({ shotId: clip.shotId, text: cue.text, startMs: cue.startMs + shift, endMs: cue.endMs + shift });
        expect(after.tokens).toEqual(cue.tokens!.map((token) => ({ ...token, startMs: token.startMs + shift, endMs: token.endMs + shift })));
        expect(isSubtitleAlignmentValid(after)).toBe(true);
      }
      const audio = source.timeline!.audioClips!.find((item) => item.shotId === clip.shotId)!;
      expect(next.timeline!.audioClips!.find((item) => item.id === audio.id)).toEqual({ ...audio, startMs: audio.startMs + shift });
    }
    expect(() => parseEditorialCollagePipelineData(next)).not.toThrow();
  });
  it('allows an extended opening and moves later aligned cues with their beats', () => {
    const source = project();
    const next = insertEditorialShot(source, source.beats[0].id, 1, undefined, 3000);
    expect(() => parseEditorialCollagePipelineData(next)).not.toThrow();
    expect(next.beats[0].durationMs).toBe(6000);
    const before = source.beats[1].subtitleCues[0];
    const after = next.beats[1].subtitleCues[0];
    expect(after.startMs).toBe(before.startMs + 3000);
    expect(after.tokens?.[0].startMs).toBe(before.tokens![0].startMs + 3000);
    expect(isSubtitleAlignmentValid(after)).toBe(true);
  });

  it('preserves the sampled camera and layer motion when splitting a shot', () => {
    const source = project();
    const original = source.beats[0].shots[0];
    const split = splitEditorialShot(source, original.id, 1000);
    expect(() => parseEditorialCollagePipelineData(split)).not.toThrow();
    const [first, second] = split.beats[0].shots;
    for (const [shot, offset, samples] of [[first, 0, [0, 250, 999]], [second, 1000, [0, 250, 1500, 2000]]] as const) {
      for (const atMs of samples) {
        expectSameTransform(directorCameraStyle(shot.camera, atMs, shot.durationMs).transform, directorCameraStyle(original.camera, atMs + offset, original.durationMs).transform);
        expectSameTransform(directorLayerStyle({ ...shot.layers[0], src: '' }, atMs).transform, directorLayerStyle({ ...original.layers[0], src: '' }, atMs + offset).transform);
      }
    }
    expect(split.beats[0].subtitleCues.filter((cue) => cue.id.endsWith('-a') || cue.id.endsWith('-b')).every((cue) => !cue.tokens && !cue.alignmentSource)).toBe(true);
  });

  it('plays merged layers sequentially and preserves the second shot subtitle offsets', () => {
    const source = project();
    const split = splitEditorialShot(source, source.beats[0].shots[0].id, 1000);
    const [first, second] = split.beats[0].shots;
    second.camera = [{ atMs: 0, x: .8, y: .5, zoom: 1.5 }, { atMs: 2000, x: .6, y: .5, zoom: 1.2 }];
    const merged = mergeEditorialShots(split, first.id, second.id);
    expect(() => parseEditorialCollagePipelineData(merged)).not.toThrow();
    expect(merged.beats[0].subtitleCues.map((cue) => [cue.startMs, cue.endMs])).toEqual(split.beats[0].subtitleCues.map((cue) => [cue.startMs, cue.endMs]));
    const shot = merged.beats[0].shots[0];
    expect(directorLayerStyle({ ...shot.layers[0], src: '' }, 1000).opacity).toBe(0);
    expect(directorLayerStyle({ ...shot.layers[first.layers.length], src: '' }, 999).opacity).toBe(0);
    expect(directorLayerStyle({ ...shot.layers[first.layers.length], src: '' }, 1000).opacity).toBe(second.layers[0].motion[0].opacity);
    expect(directorCameraStyle(shot.camera, 1000, shot.durationMs)).toEqual(directorCameraStyle(second.camera, 0, second.durationMs));
  });

  it('keeps aligned tokens valid when shots are reordered', () => {
    const source = project();
    const inserted = insertEditorialShot(source, source.beats[1].id, 1, undefined, 1000);
    const original = inserted.beats[1].shots[0];
    const reordered = reorderEditorialShot(inserted, original.id, 1);
    expect(() => parseEditorialCollagePipelineData(reordered)).not.toThrow();
    const before = inserted.beats[1].subtitleCues[0];
    const after = reordered.beats[1].subtitleCues[0];
    expect(after.startMs).toBe(before.startMs + 1000);
    expect(isSubtitleAlignmentValid(after)).toBe(true);
  });

  it('supports beat insertion, ordering and deletion while shifting all downstream clocks', () => {
    const source = project();
    const inserted = insertEditorialBeat(source, 1, undefined, 4000, '补充证据', '新增一段完整证据。');
    expect(inserted.beats).toHaveLength(5);
    expect(inserted.beats[1]).toMatchObject({ index: 2, title: '补充证据', durationMs: 4000 });
    expect(inserted.beats[2].startMs).toBe(source.beats[1].startMs + 4000);
    expect(inserted.beats[2].subtitleCues[0].startMs).toBe(source.beats[1].subtitleCues[0].startMs + 4000);
    const moved = reorderEditorialBeat(inserted, inserted.beats[1].id, 4);
    expect(moved.beats.map((beat) => beat.index)).toEqual([1, 2, 3, 4, 5]);
    expect(moved.beats[4].title).toBe('补充证据');
    expect(() => parseEditorialCollagePipelineData(moved)).not.toThrow();
    const removed = removeEditorialBeat(moved, moved.beats[4].id);
    expect(removed.beats).toHaveLength(4);
    expect(removed.timeline!.durationMs).toBe(source.timeline!.durationMs);
    expect(removed.beats.map((beat) => beat.subtitleCues.map((cue) => cue.text))).toEqual(source.beats.map((beat) => beat.subtitleCues.map((cue) => cue.text)));
  });

  it('keeps a new beat empty until the author supplies narration', () => {
    const source = project();
    const added = insertEditorialBeat(source, 1);
    expect(added.beats[1]).toMatchObject({ narration: '', subtitleCues: [], shots: [{ subtitleCueIds: [] }] });
    expect(added.sourceText).toBe(source.sourceText);
    const explicitEmpty = insertEditorialBeat(source, 1, undefined, 3000, '空节拍', '   ');
    expect(explicitEmpty.beats[1].subtitleCues).toEqual([]);
    expect(() => parseEditorialCollagePipelineData(added)).not.toThrow();
  });

  it('moves a boundary shot across adjacent beats and keeps cue, audio and ownership clocks valid', () => {
    const source = project();
    const expanded = insertEditorialShot(source, source.beats[0].id, 1, undefined, 1000);
    const shot = expanded.beats[0].shots[1];
    const cueId = `${shot.id}-cue`;
    const alignedCue = alignSubtitleCue({ id: cueId, startMs: 3250, endMs: 3900, text: '跨节拍字幕', shotId: shot.id });
    const withCue = rebuildEditorialTimeline({
      ...expanded,
      beats: expanded.beats.map((beat) => beat.id === expanded.beats[0].id
        ? { ...beat, subtitleCues: [...beat.subtitleCues, alignedCue], shots: beat.shots.map((candidate) => candidate.id === shot.id ? { ...candidate, subtitleCueIds: [...candidate.subtitleCueIds, cueId] } : candidate) }
        : beat),
      assets: [...expanded.assets, { id: 'audio-1', assetId: 'audio-1', kind: 'audio', createdAt: expanded.createdAt }],
      timeline: { ...expanded.timeline!, audioClips: [...(expanded.timeline?.audioClips ?? []), { id: `${shot.id}-audio`, assetVersionId: 'audio-1', shotId: shot.id, trackType: 'narration', startMs: 3200, sourceStartMs: 200, durationMs: 650 }] },
    });
    const moved = moveEditorialShot(withCue, shot.id, 'down');
    expect(moved.beats[0].shots).toHaveLength(1);
    expect(moved.beats[1].shots[0].id).toBe(shot.id);
    expect(moved.beats[1].shots[0].beatId).toBe(moved.beats[1].id);
    const movedCue = moved.beats[1].subtitleCues.find((cue) => cue.id === cueId)!;
    expect(movedCue).toMatchObject({ shotId: shot.id, startMs: moved.beats[1].startMs + 250, endMs: moved.beats[1].startMs + 900 });
    expect(movedCue.tokens?.[0].startMs).toBe(moved.beats[1].startMs + 250);
    expect((moved.timeline?.audioClips ?? []).find((clip) => clip.shotId === shot.id)).toMatchObject({ startMs: moved.beats[1].startMs + 200, durationMs: 650 });
    expect(isSubtitleAlignmentValid(movedCue)).toBe(true);
    expect(() => parseEditorialCollagePipelineData(moved)).not.toThrow();
    expect(() => moveEditorialShot(moved, moved.beats[0].shots[0].id, 'up')).toThrow('节拍');
  });

  it('moves a shot back across the beat boundary without retiming the other beat content', () => {
    const source = project();
    const expanded = insertEditorialShot(source, source.beats[0].id, 1, undefined, 1000);
    const shot = expanded.beats[0].shots[1];
    const targetBeat = expanded.beats[1];
    const targetShot = targetBeat.shots[0];
    const movedCueId = `${shot.id}-reverse-cue`;
    const targetCueId = `${targetShot.id}-target-cue`;
    const withContent = rebuildEditorialTimeline({
      ...expanded,
      beats: expanded.beats.map((beat) => {
        if (beat.id === expanded.beats[0].id) {
          const cue = alignSubtitleCue({ id: movedCueId, startMs: beat.startMs + 3250, endMs: beat.startMs + 3900, text: '待回移字幕', shotId: shot.id });
          return { ...beat, subtitleCues: [...beat.subtitleCues, cue], shots: beat.shots.map((candidate) => candidate.id === shot.id ? { ...candidate, subtitleCueIds: [...candidate.subtitleCueIds, movedCueId] } : candidate) };
        }
        if (beat.id !== targetBeat.id) return beat;
        const cue = alignSubtitleCue({ id: targetCueId, startMs: beat.startMs + 250, endMs: beat.startMs + 700, text: '目标节拍原字幕', shotId: targetShot.id });
        return { ...beat, subtitleCues: [...beat.subtitleCues, cue], shots: beat.shots.map((candidate) => candidate.id === targetShot.id ? { ...candidate, subtitleCueIds: [...candidate.subtitleCueIds, targetCueId] } : candidate) };
      }),
      assets: [...expanded.assets, { id: 'audio-reverse', assetId: 'audio-reverse', kind: 'audio', createdAt: expanded.createdAt }],
      timeline: { ...expanded.timeline!, audioClips: [
        ...(expanded.timeline?.audioClips ?? []),
        { id: `${shot.id}-reverse-audio`, assetVersionId: 'audio-reverse', shotId: shot.id, trackType: 'narration', startMs: 3200, sourceStartMs: 200, durationMs: 650 },
        { id: `${targetShot.id}-target-audio`, assetVersionId: 'audio-reverse', shotId: targetShot.id, trackType: 'narration', startMs: targetBeat.startMs + 300, sourceStartMs: 40, durationMs: 420 },
      ] },
    });
    const down = moveEditorialShot(withContent, shot.id, 'down');
    const targetCueAfterDown = down.beats[1].subtitleCues.find((cue) => cue.id === targetCueId)!;
    const targetAudioAfterDown = down.timeline!.audioClips!.find((clip) => clip.id === `${targetShot.id}-target-audio`)!;
    const back = moveEditorialShot(down, shot.id, 'up');
    expect(back.beats[0].shots.at(-1)?.id).toBe(shot.id);
    expect(back.beats[0].subtitleCues.find((cue) => cue.id === movedCueId)).toMatchObject({ shotId: shot.id, startMs: expanded.beats[0].startMs + 3250, endMs: expanded.beats[0].startMs + 3900 });
    expect(targetCueAfterDown.startMs - down.beats[1].startMs).toBe(1250);
    expect(back.beats[1].subtitleCues.find((cue) => cue.id === targetCueId)).toMatchObject({ shotId: targetShot.id, startMs: back.beats[1].startMs + 250, endMs: back.beats[1].startMs + 700 });
    expect(targetAudioAfterDown.startMs - down.beats[1].startMs).toBe(1300);
    expect(back.timeline!.audioClips!.find((clip) => clip.id === `${targetShot.id}-target-audio`)).toMatchObject({ shotId: targetShot.id, startMs: back.beats[1].startMs + 300, sourceStartMs: 40, durationMs: 420 });
    expect(isSubtitleAlignmentValid(back.beats[0].subtitleCues.find((cue) => cue.id === movedCueId)!)).toBe(true);
    expect(isSubtitleAlignmentValid(back.beats[1].subtitleCues.find((cue) => cue.id === targetCueId)!)).toBe(true);
    expect(() => parseEditorialCollagePipelineData(back)).not.toThrow();
  });
});
