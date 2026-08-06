import { describe, expect, it } from 'vitest';
import {
  HTML_VIDEO_TRANSITION_LABELS,
  HTML_VIDEO_TRANSITIONS,
  HTML_VIDEO_TTS_PROVIDER_LABELS,
  HTML_VIDEO_TTS_PROVIDERS,
} from '@shared/html-video-config';

describe('HTML video option labels', () => {
  it('keeps runtime values stable while exposing complete Chinese labels', () => {
    expect(HTML_VIDEO_TTS_PROVIDERS).toEqual(['volcengine', 'minimax', 'mock']);
    expect(HTML_VIDEO_TTS_PROVIDER_LABELS).toEqual({
      volcengine: '火山引擎',
      minimax: 'MiniMax',
      mock: '模拟配音',
    });

    expect(HTML_VIDEO_TRANSITIONS).toEqual([
      'fade',
      'dissolve',
      'wipeleft',
      'wiperight',
      'slideleft',
      'slideright',
    ]);
    expect(HTML_VIDEO_TRANSITION_LABELS).toEqual({
      fade: '淡入淡出',
      dissolve: '叠化',
      wipeleft: '向左擦除',
      wiperight: '向右擦除',
      slideleft: '向左滑动',
      slideright: '向右滑动',
    });
  });
});
