import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { createHtmlVideoFrameSeekScript } from '../electron/html-video-frame-seek';

function execute(time: number, window: Record<string, unknown>, media: unknown[] = []) {
  return runInNewContext(createHtmlVideoFrameSeekScript(time), {
    window,
    document: { querySelectorAll: () => media },
    requestAnimationFrame: (callback: () => void) => queueMicrotask(callback),
  });
}

describe('HTML export frame timing', () => {
  it('uses runtime clip gates for forward and backward seeks and waits for adapters', async () => {
    let visible = false;
    let settledAt = -1;
    let pending = Promise.resolve();
    const rawSeek = vi.fn();
    const window = {
      __tl: { seek: rawSeek },
      __player: {
        renderSeek(time: number) {
          visible = time >= .4 && time < 2;
          pending = Promise.resolve().then(() => { settledAt = time; });
        },
      },
      __hfWaitForSeekCompletion: () => pending,
    };
    for (const time of [0, .5, 3, .1, 1]) {
      await execute(time, window);
      expect(visible).toBe(time >= .4 && time < 2);
      expect(settledAt).toBe(time);
    }
    expect(rawSeek).not.toHaveBeenCalled();
  });

  it('waits for media seek completion before capturing', async () => {
    const media = Object.assign(new EventTarget(), { seeking: true });
    let finished = false;
    const operation = execute(1, { __player: { renderSeek() {} } }, [media]).then(() => { finished = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(finished).toBe(false);
    media.seeking = false;
    media.dispatchEvent(new Event('seeked'));
    await operation;
    expect(finished).toBe(true);
  });

  it('preserves native GSAP support without awaiting its paused thenable', async () => {
    const then = vi.fn();
    const timeline = { seek: vi.fn(() => timeline), then };
    await execute(.5, { __tl: timeline });
    expect(timeline.seek).toHaveBeenCalledWith(.5, false);
    expect(then).not.toHaveBeenCalled();
  });

  it('propagates asynchronous seek failures instead of capturing a stale frame', async () => {
    const window = {
      __player: { renderSeek() {} },
      __hfWaitForSeekCompletion: async () => { throw new Error('adapter failed'); },
    };
    await expect(execute(1, window)).rejects.toThrow('adapter failed');
  });
});
