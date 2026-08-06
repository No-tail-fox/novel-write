import { describe, expect, it } from 'vitest';
import { normalizeRangeValue, rangeProgressPercent } from '../src/components/RangeField';

describe('RangeField value normalization', () => {
  it('draws no filled track when zero is the minimum value', () => {
    expect(rangeProgressPercent(0, 0, 20)).toBe(0);
    expect(rangeProgressPercent(0.1, 0.1, 1)).toBe(0);
  });

  it('positions zero in the middle of a signed range', () => {
    expect(rangeProgressPercent(0, -1, 1)).toBe(50);
  });

  it('clamps stale values so a controlled slider remains draggable', () => {
    expect(normalizeRangeValue(-5, 0, 1)).toBe(0);
    expect(normalizeRangeValue(5, 0, 1)).toBe(1);
    expect(normalizeRangeValue(Number.NaN, 0.1, 1)).toBe(0.1);
  });
});
