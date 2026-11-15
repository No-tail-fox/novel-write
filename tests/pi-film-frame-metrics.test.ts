import { describe, expect, it } from 'vitest';
import { piFrameSequenceMetrics } from '../electron/pi-film-frame-metrics';

const frame = (time: number, fill: number | ((i: number) => number)) => {
  const width = 8, height = 8, bitmap = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const v = typeof fill === 'number' ? fill : fill(i);
    bitmap[i * 4] = v; bitmap[i * 4 + 1] = v; bitmap[i * 4 + 2] = v; bitmap[i * 4 + 3] = 255;
  }
  return { time, width, height, bitmap };
};

describe('Pi advisory frame metrics', () => {
  it('flags an almost white frame as highlight heavy and flat', () => {
    const { metrics, advisories } = piFrameSequenceMetrics([frame(1, 255)]);
    expect(metrics[0].highlightRatio).toBe(1);
    expect(advisories.map(a => a.code)).toEqual(expect.arrayContaining(['HIGHLIGHT_HEAVY', 'LOW_CONTRAST']));
  });
  it('flags a black frame as very dark', () => {
    const { advisories } = piFrameSequenceMetrics([frame(0, 0)]);
    expect(advisories.map(a => a.code)).toContain('VERY_DARK');
  });
  it('flags a repeated frame but not the first one, and leaves the first change measure unset', () => {
    const gradient = (i: number) => i * 4;
    const { metrics, advisories } = piFrameSequenceMetrics([frame(0, gradient), frame(2, gradient)]);
    expect(metrics[0].changeFromPrevious).toBeUndefined();
    expect(metrics[1].changeFromPrevious).toBe(0);
    expect(advisories.filter(a => a.code === 'NEAR_DUPLICATE').map(a => a.time)).toEqual([2]);
  });
  it('raises no advisory for a varied, moving sequence', () => {
    const { advisories } = piFrameSequenceMetrics([frame(0, i => i * 4), frame(2, i => 252 - i * 4)]);
    expect(advisories).toEqual([]);
  });
  it('rejects a bitmap smaller than its declared size', () => {
    expect(() => piFrameSequenceMetrics([{ time: 0, width: 8, height: 8, bitmap: new Uint8Array(4) }])).toThrow('PI_FRAME_METRICS_BITMAP');
  });
});
