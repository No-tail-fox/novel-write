import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildDirectorSceneHtml } from '../src/shared/director-render';

const base = { title: '字幕导出', caption: '旧整段字幕', imageUrl: 'file:///local.png', durationMs: 2000, modeLabel: 'VOX', index: 1 };

describe('director timed subtitle render', () => {
  it('escapes cue content and preserves authored spaces around timed words', () => {
    const html = buildDirectorSceneHtml({ ...base, subtitleCues: [{ id: 'cue-1', text: 'Hello <world>', startMs: 0, endMs: 1500, tokens: [{ text: 'Hello', startMs: 0, endMs: 500 }, { text: '<world>', startMs: 500, endMs: 1500 }] }] });
    expect(html).toContain('data-cue-start="0" data-cue-end="1500" hidden');
    expect(html).toContain('>Hello</span> <span');
    expect(html).toContain('&lt;world&gt;</span>');
    expect(html).not.toContain('旧整段字幕');
    expect(html).not.toContain('<world>');
  });

  it('updates cue visibility and highlighted words on deterministic seeks and silence gaps', () => {
    const words = [
      { dataset: { wordStart: '0', wordEnd: '400', activeWord: '' } },
      { dataset: { wordStart: '400', wordEnd: '800', activeWord: '' } },
    ];
    const cues = [
      { hidden: true, dataset: { cueStart: '0', cueEnd: '800' }, querySelectorAll: () => words },
      { hidden: true, dataset: { cueStart: '1200', cueEnd: '1900' }, querySelectorAll: () => [] },
    ];
    const window: { __tl?: { seek: (seconds: number) => Promise<void> }; __ready?: boolean } = {};
    const html = buildDirectorSceneHtml({ ...base, subtitleCues: [] });
    const script = html.match(/<script nonce="director-render">([\s\S]+)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    runInNewContext(script!, {
      window,
      document: { getElementById: (id: string) => id === 'scene-video' ? null : { style: {} }, querySelectorAll: () => cues, querySelector: () => ({ style: {} }) },
      performance: { now: () => 0 }, requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
    });
    expect(window.__ready).toBe(true);
    expect(cues.map((cue) => cue.hidden)).toEqual([false, true]);
    expect(words.map((word) => word.dataset.activeWord)).toEqual(['true', 'false']);
    window.__tl!.seek(0.5);
    expect(words.map((word) => word.dataset.activeWord)).toEqual(['false', 'true']);
    window.__tl!.seek(1);
    expect(cues.every((cue) => cue.hidden)).toBe(true);
    window.__tl!.seek(1.5);
    expect(cues.map((cue) => cue.hidden)).toEqual([true, false]);
    window.__tl!.seek(2);
    expect(cues.every((cue) => cue.hidden)).toBe(true);
  });

  it('rejects out-of-shot cue times instead of burning invalid subtitles into video', () => {
    expect(() => buildDirectorSceneHtml({ ...base, subtitleCues: [{ id: 'bad', text: '越界', startMs: -1, endMs: 400 }] })).toThrow('SUBTITLE_RANGE');
    expect(() => buildDirectorSceneHtml({ ...base, subtitleCues: [{ id: 'bad', text: '越界', startMs: 0, endMs: 2100 }] })).toThrow('SUBTITLE_RANGE');
    expect(buildDirectorSceneHtml({ ...base, subtitleCues: [] })).not.toContain('旧整段字幕');
  });
});
