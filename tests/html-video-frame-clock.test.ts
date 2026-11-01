import { describe, expect, it } from 'vitest';
import { allocateHtmlVideoSceneFrameCounts, htmlVideoSceneFrameTime } from '../src/shared/html-video';

describe('HTML video audio-clock frame allocation', () => {
  it.each([24, 25, 30])('bounds every cut to half a frame at %s fps, including the cover', fps => {
    for (const offset of [0, 0.137, 0.83]) {
      const durations = Array.from({ length: 100 }, (_, i) => [0.83, 1.071, 0.583][i % 3]);
      const frames = allocateHtmlVideoSceneFrameCounts(durations, fps, offset);
      let clock = offset, endFrame = Math.round(offset * fps);
      frames.forEach((count, i) => {
        clock += durations[i]; endFrame += count;
        expect(Number.isInteger(count) && count > 0).toBe(true);
        expect(Math.abs(endFrame / fps - clock)).toBeLessThanOrEqual(0.5 / fps + 1e-10);
      });
    }
  });
  it('does not round each scene independently', () => {
    const counts = allocateHtmlVideoSceneFrameCounts(Array(20).fill(0.83), 24);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(398);
    expect(counts).toContain(19);
  });
  it('samples subtitle and animation time on the global audio grid, not a reset local grid', () => {
    const fps = 24, cover = .137, durations = Array(20).fill(.83);
    const counts = allocateHtmlVideoSceneFrameCounts(durations, fps, cover);
    let firstFrame = Math.round(cover * fps), start = cover;
    for (const [index, count] of counts.entries()) {
      for (let frame = 0; frame < count; frame++) {
        const time = htmlVideoSceneFrameTime(frame, fps, firstFrame, start);
        expect(time).toBeGreaterThanOrEqual(0);
        if (time > 0) expect(start + time).toBeCloseTo((firstFrame + frame) / fps, 10);
        else expect(Math.abs(firstFrame / fps - start)).toBeLessThanOrEqual(.5 / fps);
      }
      firstFrame += count; start += durations[index];
    }
  });
  it('rejects invalid clocks and durations', () => {
    expect(() => allocateHtmlVideoSceneFrameCounts([1], 0)).toThrow();
    expect(() => allocateHtmlVideoSceneFrameCounts([0], 24)).toThrow();
    expect(() => allocateHtmlVideoSceneFrameCounts([1], 24, -1)).toThrow();
  });
});
