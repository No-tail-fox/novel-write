import { describe, expect, it } from 'vitest';
import { estimateVideoRenderDiskBudget } from '../src/shared/video-render-budget';
import { preflightVideoRenderDisk } from '../electron/video-render-preflight';

const input = { width: 1920, height: 1080, fps: 24, durations: Array(60).fill(10) as number[] };

describe('segmented video render disk budget', () => {
  it('budgets one scene of JPEGs while retaining full-length segments and two output copies', () => {
    const long = estimateVideoRenderDiskBudget(input);
    const single = estimateVideoRenderDiskBudget({ ...input, durations: [10] });
    expect(long.peakFrameBytes).toBe(single.peakFrameBytes);
    expect(long.peakMixBytes).toBe(single.peakMixBytes);
    expect(long.compositionAudioBytes).toBeGreaterThanOrEqual(600 * 44100 * 8);
    expect(single.compositionAudioBytes).toBe(0);
    expect(long.segmentBytes).toBe(single.segmentBytes * 60);
    expect(long.outputCopyBytes).toBe(single.outputCopyBytes * 60);
    expect(long.requiredBytes).toBeGreaterThan(long.segmentBytes + long.outputCopyBytes * 2 + long.peakFrameBytes);
    expect(long.requiredBytes).toBeLessThan(input.width * input.height * .45 * long.totalFrames);
  });

  it('includes cover duration, a longer output, and all staged media copies', () => {
    const normal = estimateVideoRenderDiskBudget(input);
    const extended = estimateVideoRenderDiskBudget({ ...input, coverDurationS: 2, outputDurationS: 1200, stagedMediaBytes: 1024 ** 3 });
    expect(extended.peakFrameBytes).toBe(normal.peakFrameBytes);
    expect(extended.segmentBytes).toBeGreaterThan(normal.segmentBytes);
    expect(extended.outputCopyBytes).toBe(normal.outputCopyBytes * 2);
    expect(extended.requiredBytes - normal.requiredBytes).toBeGreaterThan(1024 ** 3 + normal.outputCopyBytes * 2);
  });

  it('uses the largest scene and rounds up fractional scene frames', () => {
    const budget = estimateVideoRenderDiskBudget({ ...input, durations: [.01, 10.01] });
    expect(budget.totalFrames).toBe(242);
    expect(budget.peakFrameBytes).toBe(Math.ceil(241 * input.width * input.height * .45));
    expect(budget.peakMixBytes).toBeGreaterThan(10 * 44100 * 4);
  });

  it.each([0, NaN, Infinity, -1])('rejects invalid media duration %s', (duration) => {
    expect(() => estimateVideoRenderDiskBudget({ ...input, durations: [duration] })).toThrow();
  });

  it('rejects invalid geometry, source size, and excessive numeric capacity', () => {
    expect(() => estimateVideoRenderDiskBudget({ ...input, width: Infinity })).toThrow();
    expect(() => estimateVideoRenderDiskBudget({ ...input, stagedMediaBytes: -1 })).toThrow();
    expect(() => estimateVideoRenderDiskBudget({ ...input, durations: [Number.MAX_VALUE] })).toThrow();
  });

  it('checks the budget boundary and rejects unknown free space', async () => {
    const budget = estimateVideoRenderDiskBudget(input);
    for (const available of [budget.requiredBytes - 1, NaN, Infinity]) {
      await expect(preflightVideoRenderDisk('I:/render', input, { getAvailableDiskBytes: async () => available })).rejects.toMatchObject({ code: 'VIDEO_RENDER_DISK_SPACE_LOW' });
    }
    await expect(preflightVideoRenderDisk('I:/render', input, { getAvailableDiskBytes: async () => budget.requiredBytes })).resolves.toEqual(budget);
  });
});
