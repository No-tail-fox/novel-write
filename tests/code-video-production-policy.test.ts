import { describe, expect, it } from 'vitest';
import { assessCodeVideoDuration, codeVideoCaptionMode, codeVideoFrameSchedule, codeVideoPolicySchema, newCodeVideoPolicy } from '../src/shared/creative-animation/production-policy';

describe('code video production policy', () => {
  it('keeps legacy host captions while new projects opt into film captions', () => {
    expect(codeVideoCaptionMode()).toBe('host');
    expect(codeVideoCaptionMode(newCodeVideoPolicy())).toBe('film');
    expect(newCodeVideoPolicy()).toMatchObject({ targetDurationSeconds: 60, longTextMode: 'split', allowNarrationPauses: true });
  });
  it('validates custom duration boundaries without silently clipping', () => {
    for (const duration of [15, 30, 60, 90, 120, 180]) expect(codeVideoPolicySchema.parse({ ...newCodeVideoPolicy(), targetDurationSeconds: duration }).targetDurationSeconds).toBe(duration);
    for (const duration of [14, 181, 15.5, NaN, Infinity]) expect(() => codeVideoPolicySchema.parse({ ...newCodeVideoPolicy(), targetDurationSeconds: duration })).toThrow();
  });
  it('reports overflow before authoring and never changes the actual duration', () => {
    expect(assessCodeVideoDuration(180, 198).status).toBe('within-target');
    expect(assessCodeVideoDuration(180, 198.001).status).toBe('over-limit');
    expect(assessCodeVideoDuration(60, 40)).toMatchObject({ status: 'short', actualDurationSeconds: 40 });
    expect(() => assessCodeVideoDuration(60, NaN)).toThrow();
  });
  it('uses frame indices for random seek and never samples at the film end', () => {
    const clock = codeVideoFrameSchedule(1.01, 24);
    expect(clock.frameCount).toBe(25);
    expect(clock.frameTime(24)).toBe(1);
    expect(clock.frameTime(0)).toBe(0);
    expect(clock.frameTime(24)).toBe(1);
    expect(clock.durationSeconds - 1.01).toBeLessThan(1 / 24);
    expect(() => clock.frameTime(25)).toThrow();
    expect(() => clock.frameTime(-1)).toThrow();
    expect(() => codeVideoFrameSchedule(1, 0)).toThrow();
  });
});
