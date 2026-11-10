import { describe, expect, it } from 'vitest';
import type { RawFrame } from '@shared/frame-hash';
import { adviseMotionComicContinuity, continuityPairScore } from '@shared/motion-comic-continuity';

function frame(paint: (x: number, y: number) => number, width = 32, height = 32): RawFrame {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const value = paint(x, y);
    data.set([value, value, value, 255], (y * width + x) * 4);
  }
  return { data, width, height };
}

const leftBright = frame((x) => (x < 16 ? 220 : 30));
// Same composition, slightly brighter (encoder/grade drift).
const leftBrightNoisy = frame((x) => (x < 16 ? 226 : 36));
const topBright = frame((_x, y) => (y < 16 ? 220 : 30));

describe('motion-comic advisory continuity', () => {
  it('scores near-identical cuts high and unrelated frames low', () => {
    expect(continuityPairScore(leftBright, leftBrightNoisy).score).toBeGreaterThan(0.9);
    expect(continuityPairScore(leftBright, topBright).score).toBeLessThan(0.7);
  });

  it('is advisory only and flags a review when the cut or reference drifts', () => {
    const ok = adviseMotionComicContinuity({ previousLastFrame: leftBright, firstFrame: leftBrightNoisy, characterReference: leftBright });
    expect(ok).toMatchObject({ advisory: true, level: 'ok' });
    const drift = adviseMotionComicContinuity({ previousLastFrame: leftBright, firstFrame: topBright });
    expect(drift.level).toBe('review');
    expect(drift.notes.join('')).toContain('建议人工核对');
    expect(drift.notes.join('')).toContain('不代表角色身份或口型已验收');
    expect(adviseMotionComicContinuity({ firstFrame: leftBright })).toMatchObject({ level: 'unknown' });
  });
});
