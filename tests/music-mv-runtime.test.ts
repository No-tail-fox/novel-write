import { describe, expect, it } from 'vitest';
import { buildMusicMvPlan } from '@shared/runner';
import { createMusicMvDocument } from '@shared/music-mv-production';
import { parseEditorialCollagePipelineData } from '@shared/editorial-collage';
import type { CreateTaskInput, Task } from '@shared/types';
import { directorNarrationAlignment, type DirectorRenderScene } from '@shared/director-render';
import { setDirectorShotNarration } from '@shared/director-subtitle-structure';

const song = { rhythmMode: 'lyric-sync', captionStyle: 'minimal', visualMotif: 'neon rain', audioPath: 'song.wav' } as const;
const input = (inputText = 'One\nTwo\nThree'): CreateTaskInput => ({ title: 'Timestamp MV', inputText, taskKind: 'music-mv', track: 'music-mv', style: 'cel-anime-80s', ratio: '16:9', storyboardSceneCount: 2, musicMv: song });
const plan = (text: string, durationMs: number) => buildMusicMvPlan(input(text) as Task, durationMs);
const document = (text = 'One\nTwo\nThree', durationMs = 8000, extra: Partial<CreateTaskInput> = {}) => createMusicMvDocument('mv-test', { ...input(text), ...extra }, durationMs, '2026-10-28T01:00:00.000Z');

describe('Music MV runtime contract', () => {
  it('retains every timed lyric even when there are fewer visual shots', () => {
    expect(plan('[00:01.00]First\n[00:03.50]Second\n[00:06.00]Third', 8000).segments).toEqual([
      expect.objectContaining({ lyric: 'First', startMs: 1000, durationMs: 2500 }),
      expect.objectContaining({ lyric: 'Second', startMs: 3500, durationMs: 2500 }),
      expect.objectContaining({ lyric: 'Third', startMs: 6000, durationMs: 2000 }),
    ]);
  });
  it('allocates all untimed lyrics across the measured song and marks timing as estimated', () => {
    expect(plan('One\nTwo\nThree', 6000)).toMatchObject({
      timingSource: 'estimated',
      segments: [{ startMs: 0, durationMs: 2000 }, { startMs: 2000, durationMs: 2000 }, { startMs: 4000, durationMs: 2000 }],
    });
  });
  it('expands repeated LRC timestamps and skips song metadata and section headings', () => {
    expect(plan('[ti:Song]\n[Verse]\n[00:01.00][00:03.00]Again\n[Chorus]\n[00:05.00]End', 7000).segments.map(s => [s.lyric, s.startMs])).toEqual([['Again', 1000], ['Again', 3000], ['End', 5000]]);
  });
  it('rejects mixed, overlapping and out-of-song timestamps instead of silently changing them', () => {
    expect(() => plan('[00:01.00]One\nTwo', 5000)).toThrow('MIXED');
    expect(() => plan('[00:01.00]One\n[00:01.00]Two', 5000)).toThrow('TIMING');
    expect(() => plan('[00:05.00]One', 5000)).toThrow('TIMING');
  });
  it('honors empty LRC end markers and instrumental gaps', () => {
    const result = plan('[00:01.00]One\n[00:02.50]\n[00:05.00]Two\n[00:07.00]', 7000);
    expect(result.segments.map(s => [s.lyric, s.startMs, s.durationMs])).toEqual([['One', 1000, 1500], ['Two', 5000, 2000]]);
    const doc = document('[00:01.00]One\n[00:02.50]\n[00:05.00]Two\n[00:07.00]', 7000);
    expect(doc.beats.flatMap(b => b.subtitleCues).map(c => [c.startMs, c.endMs])).toEqual([[1000, 2500], [5000, 7000]]);
  });
  it('reports unsupported offsets and malformed timing instead of rendering or ignoring them', () => {
    expect(() => plan('[offset:500]\n[00:01.00]One', 5000)).toThrow('LRC_OFFSET');
    expect(() => plan('[00:61.00]One', 5000)).toThrow('LRC_FORMAT');
    expect(() => plan('[00:01.00]<00:01.00>One', 5000)).toThrow('LRC_FORMAT');
    expect(plan('[offset:0]\n[00:01.00]One', 5000).segments[0].startMs).toBe(1000);
  });
  it('creates a validated Lemo timeline with continuous original music and no narration', () => {
    const doc = document('[00:01.00]One\n[00:03.50]Two\n[00:06.00]Three');
    expect(() => parseEditorialCollagePipelineData(doc)).not.toThrow();
    expect(doc.sourceText).toBe('One\nTwo\nThree');
    expect(doc.productionSettings).toMatchObject({ narration: false, generateImages: false, authoring: { mode: 'ai-code' }, music: { durationMs: 8000, gainDb: 0, loop: false, fadeInMs: 0, fadeOutMs: 0 } });
    const shots = doc.beats.flatMap(b => b.shots);
    expect(shots.map(s => s.durationMs)).toEqual([3500, 4500]);
    expect(doc.beats.flatMap(b => b.subtitleCues).map(c => [c.text, c.startMs, c.endMs])).toEqual([['One', 1000, 3500], ['Two', 3500, 6000], ['Three', 6000, 8000]]);
    expect(doc.timeline!.audioClips).toEqual([
      expect.objectContaining({ trackType: 'music', startMs: 0, sourceStartMs: 0, durationMs: 3500, gainDb: 0 }),
      expect.objectContaining({ trackType: 'music', startMs: 3500, sourceStartMs: 3500, durationMs: 4500, gainDb: 0 }),
    ]);
    expect(doc.timeline!.audioClips?.every(c => c.trackType === 'music')).toBe(true);
    expect(doc.assets.some(a => a.localPath === 'song.wav')).toBe(true);
  });
  it('snaps cuts to nearby lyric-line starts and records whether subtitle timing is estimated', () => {
    const doc = createMusicMvDocument('mv-cut-sync', {
      ...input('[00:00.00]First\n[00:02.50]Second\n[00:06.80]Third\n[00:09.10]Fourth'),
      storyboardSceneCount: 3,
    }, 12_000, '2026-10-28T01:00:00.000Z');
    const shots = doc.beats.flatMap(beat => beat.shots);
    const cutTimes = shots.slice(0, -1).map((_, index) => shots.slice(0, index + 1).reduce((sum, item) => sum + item.durationMs, 0));
    expect(cutTimes).toEqual([2500, 9100]);
    expect(doc.beats.flatMap(beat => beat.subtitleCues).every(cue => cue.alignmentSource === 'manual' && !cue.tokens)).toBe(true);

    const estimated = document('First\nSecond', 8000, { musicMv: { ...song, captionStyle: 'karaoke' } });
    const estimatedCues = estimated.beats.flatMap(beat => beat.subtitleCues);
    expect(estimatedCues).toHaveLength(0);
    expect(estimated.sourceText).toBe('First\nSecond');
    expect(estimated.beats.flatMap(beat => beat.shots).map(shot => shot.scenePrompt).join(' ')).toContain('First');
  });
  it('does not use estimated lyric starts to move visual cuts away from the requested rhythm', () => {
    const doc = createMusicMvDocument('mv-estimated-cut-rhythm', {
      ...input('First\nSecond\nThird\nFourth'),
      storyboardSceneCount: 3,
    }, 12_000, '2026-10-28T01:00:00.000Z');
    const shots = doc.beats.flatMap(beat => beat.shots);
    const cutTimes = shots.slice(0, -1).map((_, index) => shots.slice(0, index + 1).reduce((sum, item) => sum + item.durationMs, 0));
    expect(cutTimes).toEqual([4000, 8000]);
    expect(doc.beats.flatMap(beat => beat.subtitleCues)).toHaveLength(0);
  });
  it('treats lyrics over an original song as inapplicable to spoken narration checks', () => {
    const doc = document('One\nTwo', 8000);
    const scenes: DirectorRenderScene[] = doc.beats.flatMap(beat => beat.shots.map(shot => ({
      id: shot.id, index: 1, title: 'MV', caption: '', durationMs: shot.durationMs,
      subtitleCues: beat.subtitleCues, renderStrategy: 'deterministic-layers', layers: [], camera: [], audioPath: 'song.wav',
    })));
    expect(directorNarrationAlignment(doc, scenes)).toMatchObject({
      status: 'passed', samples: [{ status: 'not-applicable' }, { status: 'not-applicable' }],
    });
  });
  it('keeps song offsets and shot duration intact when editing lyrics', () => {
    const doc = document('[00:00.00]One\n[00:04.00]Two', 8000);
    const edited = setDirectorShotNarration(doc, doc.beats[0].shots[0].id, 'Changed lyric');
    expect(edited.timeline!.audioClips).toEqual(doc.timeline!.audioClips);
    expect(edited.timeline!.durationMs).toBe(8000);
    expect(edited.beats[0].subtitleCues[0]).toMatchObject({ text: 'Changed lyric', startMs: 0, endMs: 4000 });
  });
  it('honors no-subtitle mode without inventing estimated karaoke tokens', () => {
    const silent = document(undefined, 8000, { musicMv: { ...song, captionStyle: 'none' } });
    expect(silent.beats.flatMap(b => b.subtitleCues)).toHaveLength(0);
    const karaoke = document('回家\n等你', 8000, { musicMv: { ...song, captionStyle: 'karaoke' } });
    expect(karaoke.beats.flatMap(beat => beat.subtitleCues)).toHaveLength(0);
    expect(karaoke.sourceText).toBe('回家\n等你');
    const timed = document('[00:01.00]回家\n[00:04.00]等你', 8000, { musicMv: { ...song, captionStyle: 'karaoke' } });
    expect(timed.beats[0].subtitleCues[0]).toMatchObject({ alignmentSource: 'manual', text: '回家' });
    expect(timed.beats[0].subtitleCues[0].tokens).toBeUndefined();
  });
  it('extends the visual shot count for long songs without losing duration', () => {
    const doc = document('One\nTwo', 221200);
    const shots = doc.beats.flatMap(b => b.shots);
    expect(shots).toHaveLength(15);
    expect(shots.every(s => s.durationMs <= 15000)).toBe(true);
    expect(shots.reduce((n,s) => n+s.durationMs,0)).toBe(221200);
  });
});
