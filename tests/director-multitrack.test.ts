import { describe, expect, it } from 'vitest';
import { projectDirectorTimeline, timelinePixelsAtTime, timelineTimeAtPixel, timelineTimeLabel, type TimelineShot } from '../src/features/director-desk/director-multitrack';

const shot = (id: string, extra: Partial<TimelineShot> = {}): TimelineShot => ({ id, index: 1, title: id, durationMs: 3000, ...extra });

describe('real director multitrack projection', () => {
  it('keeps episode-global milliseconds on later shots and never invents subtitle or voice clips', () => {
    const result = projectDirectorTimeline([shot('first'), shot('second', { subtitleCues: [{ id: 'cue', text: '真实字幕', startMs: 3250, endMs: 4250 }] })]);
    expect(result.durationMs).toBe(6000);
    expect(result.items.map(({ lane, startMs, endMs }) => [lane, startMs, endMs])).toEqual([['video', 0, 3000], ['video', 3000, 6000], ['subtitle', 3250, 4250]]);
  });
  it('deduplicates preview audio by clip identity, keeps mute/missing metadata, and stacks overlaps', () => {
    const result = projectDirectorTimeline([shot('s', { soundClips: [
      { id: 'music-a', assetVersionId: 'asset', trackType: 'music', startMs: 100, durationMs: 1000, title: '音乐A', available: true, muted: true },
      { id: 'music-b', assetVersionId: 'asset', trackType: 'music', startMs: 500, durationMs: 1000, title: '音乐B', available: false },
    ], audioClips: [{ id: 'music-a', url: '/a.wav', startMs: 100, durationMs: 1000 }, { id: 'native', trackType: 'native', url: '/v.mp4', startMs: 0, durationMs: 3000 }] })]);
    const music = result.items.filter((item) => item.lane === 'music');
    expect(music).toHaveLength(2);
    expect(music.map((item) => item.row)).toEqual([0, 1]);
    expect(music[0].muted).toBe(true);
    expect(music[1].detail).toContain('文件不可用');
    expect(result.items.find((item) => item.sourceId === 'native')?.label).toBe('视频原声');
  });
  it('uses real preview track types without editable sound metadata and preserves unknown audio', () => {
    const result = projectDirectorTimeline([shot('s', { audioClips: [
      { id: 'voice', trackType: 'dialogue', url: '/v.wav', startMs: 0, durationMs: 500 },
      { id: 'foley', trackType: 'foley', url: '/f.wav', startMs: 500, durationMs: 500 },
      { id: 'unknown', url: '/u.wav', startMs: 1000, durationMs: 500 },
    ] })]);
    expect(result.items.slice(1).map((item) => [item.lane, item.editableSound])).toEqual([['dialogue', undefined], ['sfx', undefined], ['other', undefined]]);
  });
  it('clips invalid ranges to their owning shot without mutating input or bleeding into another shot', () => {
    const shots = [shot('s', { subtitleCues: [{ id: 'long', text: '长', startMs: -100, endMs: 8000 }, { id: 'bad', text: '错', startMs: 2500, endMs: 2000 }] }), shot('next')];
    const before = JSON.stringify(shots);
    const result = projectDirectorTimeline(shots);
    expect(result.items.find((item) => item.sourceId === 'long')).toMatchObject({ startMs: 0, endMs: 3000 });
    expect(result.items.some((item) => item.sourceId === 'bad')).toBe(false);
    expect(JSON.stringify(shots)).toBe(before);
    expect(projectDirectorTimeline([])).toEqual({ items: [], durationMs: 0 });
  });
  it('uses one linear transform at every zoom and after scroll translation', () => {
    for (const scale of [10, 20, 40, 80, 160, 320]) {
      const pixel = timelinePixelsAtTime(42375, scale);
      const scrollLeft = 200;
      const viewportX = pixel - scrollLeft;
      expect(timelineTimeAtPixel(viewportX + scrollLeft, scale, 90000)).toBe(42375);
    }
    expect(timelineTimeAtPixel(-1, 40, 6000)).toBe(0);
    expect(timelineTimeAtPixel(99999, 40, 6000)).toBe(6000);
    expect(timelineTimeAtPixel(1, 0, 6000)).toBe(0);
    expect(timelineTimeLabel(62345)).toBe('01:02.345');
  });
});
