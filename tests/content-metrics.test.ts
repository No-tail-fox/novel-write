import { describe, expect, it } from 'vitest';
import {
  countVisibleCharacters,
  resolveEffectiveStoryboardSceneCount,
  storyboardSceneCountPreviewRange,
  storyboardSceneCountRange,
  targetWordCountRange,
} from '../src/shared/content-metrics';

describe('Storybound content metrics', () => {
  it('counts visible characters without whitespace', () => {
    expect(countVisibleCharacters(' 一 二\n三\t四 ')).toBe(4);
  });

  it('controls review and rewrite word count with a plus/minus 20 percent range', () => {
    expect(targetWordCountRange(900, '')).toEqual({ target: 900, min: 720, max: 1080 });
    expect(targetWordCountRange('', '一 二\n三四五')).toEqual({ target: 5, min: 4, max: 6 });
  });

  it('uses Storybound scene-count ranges for explicit storyboard targets', () => {
    expect(storyboardSceneCountRange('', 12)).toEqual({ target: 12, min: 10, max: 14, explicit: true });
    expect(storyboardSceneCountRange('', 2)).toEqual({ target: 2, min: 3, max: 3, explicit: true });
  });

  it('derives automatic storyboard count from rewritten-copy length', () => {
    const range = storyboardSceneCountRange('字'.repeat(500));

    expect(range).toEqual({ target: 17, min: 12, max: 22, explicit: false });
    expect(resolveEffectiveStoryboardSceneCount('字'.repeat(500))).toBe(17);
  });

  it('prefers target length when previewing automatic storyboard count', () => {
    expect(storyboardSceneCountPreviewRange('字'.repeat(100), 500)).toEqual({
      target: 17,
      min: 12,
      max: 22,
      explicit: false,
    });
  });
});
