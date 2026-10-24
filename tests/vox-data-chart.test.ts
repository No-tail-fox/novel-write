import { describe, expect, it } from 'vitest';
import { formatVoxDataValue, voxBarGeometry, voxDataBarProgress, voxDataPresentation } from '../src/shared/vox-data-chart';

describe('sourced Vox bar charts', () => {
  it('places positive and negative values around one shared zero', () => {
    expect(voxBarGeometry(-2, [-2, 6])).toEqual({ zero: 25, left: 0, width: 25 });
    expect(voxBarGeometry(6, [-2, 6])).toEqual({ zero: 25, left: 25, width: 75 });
    expect(voxBarGeometry(-2, [-2, 6], .5)).toEqual({ zero: 25, left: 12.5, width: 12.5 });
    expect(voxBarGeometry(-2, [-2, -1]).zero).toBe(100);
    expect(voxBarGeometry(0, [0, 0])).toEqual({ zero: -0, left: 0, width: 0 });
  });
  it('preserves source precision at rest, including small and negative values', () => {
    expect([.39, .72, 1.01, 1.28].map(value => formatVoxDataValue(value))).toEqual(['0.39', '0.72', '1.01', '1.28']);
    expect(formatVoxDataValue(-.012)).toBe('-0.012');
    expect(formatVoxDataValue(1e-7)).toBe('0.0000001');
    expect(formatVoxDataValue(12000)).toBe('12,000');
    expect(formatVoxDataValue(-2, 0)).toBe('0');
  });
  it('focuses only supplied labels mentioned by a relative sentence cue', () => {
    expect(voxDataPresentation(['2000 年', '2010 年', '2024 年'], [
      { text: '二零零零年是零点三九摄氏度。', startMs: 9000, endMs: 11000 },
      { text: '二零一零年是零点七二摄氏度。', startMs: 11000, endMs: 13000 },
      { text: '这里展示的是观测记录。', startMs: 13000, endMs: 14000 },
    ], 9000, false)).toEqual({ reveal: false, cues: [
      { startMs: 0, endMs: 2000, labels: ['2000 年'] },
      { startMs: 2000, endMs: 4000, labels: ['2010 年'] },
    ] });
    expect(voxDataBarProgress(24, 24, 3, true)).toBe(1);
    expect(voxDataBarProgress(0, 24, 3, false)).toBe(1);
  });
});
