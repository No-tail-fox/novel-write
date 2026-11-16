import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { formatVoiceSampleDuration, MotionComicCharacterVoiceSample } from '../src/features/motion-comic/MotionComicCharacterVoiceSample';

describe('character voice sample presentation', () => {
  it('formats duration and never renders invalid metadata as a valid duration', () => {
    expect(formatVoiceSampleDuration(12500)).toBe('12.5 秒');
    expect(formatVoiceSampleDuration(60000)).toBe('60 秒');
    for (const value of [undefined, NaN, Infinity, -1, 0]) expect(formatVoiceSampleDuration(value)).toBe('时长未知');
  });
  it('does not resolve media or mutate data during rendering', () => {
    const unexpected = async () => { throw new Error('No side effects during rendering'); };
    const html = renderToStaticMarkup(createElement(MotionComicCharacterVoiceSample, {
      characterName: '林溪', sample: { id: 'a', localPath: 'C:\\samples\\voice.wav', durationMs: 12000 },
      onImport: unexpected, onUnlink: unexpected, getMediaUrl: unexpected,
    }));
    expect(html).toContain('voice.wav');
    expect(html).toContain('当前视频与TTS不会自动采用');
    expect(html).toContain('preload="none"');
    expect(html).not.toContain('src=');
  });
});
