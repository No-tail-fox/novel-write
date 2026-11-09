import { describe, expect, it, vi } from 'vitest';
import { withHtmlGraphicsRecovery } from '../electron/html-video-capture-recovery';

describe('local compositor recovery', () => {
  it('reopens after a Viz crash and resumes only the uncommitted frame', async () => {
    const windows: number[] = [], captures: number[] = [], writes: number[] = [];
    let frame = 0, crash = true;
    await withHtmlGraphicsRecovery(async () => {
      windows.push(1);
      try { for (; frame < 4; frame++) {
        captures.push(frame);
        if (frame === 2 && crash) { crash = false; throw Error('UnknownVizError'); }
        writes.push(frame);
      } } finally { windows.pop(); }
    });
    expect(captures).toEqual([0, 1, 2, 2, 3]);
    expect(writes).toEqual([0, 1, 2, 3]);
    expect(windows).toEqual([]);
  });
  it('bounds restarts and reports a graphics error rather than a content error', async () => {
    const cause = Error('UnknownVizError'), operation = vi.fn(async () => { throw cause; });
    await expect(withHtmlGraphicsRecovery(operation)).rejects.toMatchObject({ code: 'HTML_VIDEO_GRAPHICS_UNAVAILABLE', retryable: true, cause });
    expect(operation).toHaveBeenCalledTimes(3);
  });
  it.each(['CREATIVE_LAYOUT: 17px', 'LEMO_TEXTS: wrong timing', 'HTML capture timed out.', 'ENOSPC'])('does not retry %s', async message => {
    const error = Error(message), operation = vi.fn(async () => { throw error; });
    await expect(withHtmlGraphicsRecovery(operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });
  it('preserves cancellation and never reopens after abort', async () => {
    const controller = new AbortController(), reason = Error('User cancelled');
    const operation = vi.fn(async () => { controller.abort(reason); throw Error('UnknownVizError'); });
    await expect(withHtmlGraphicsRecovery(operation, controller.signal)).rejects.toBe(reason);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
