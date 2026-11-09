import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createHtmlVideoSceneReadyScript } from '../electron/html-video-scene-ready';

function execute(video: unknown) {
  return runInNewContext(createHtmlVideoSceneReadyScript(), {
    window: { __ready: true, __tl: { seek() {} } },
    document: { readyState: 'complete', images: [], querySelectorAll: () => [video] },
    HTMLMediaElement: { HAVE_CURRENT_DATA: 2 },
    requestAnimationFrame: (callback: () => void) => queueMicrotask(callback),
    setInterval, clearInterval,
  });
}

describe('HTML first-frame readiness', () => {
  it('waits for trim seeked when loadeddata already fired', async () => {
    const video = Object.assign(new EventTarget(), { readyState: 1, seeking: true, error: null });
    let settled = false;
    const operation = execute(video).then(() => { settled = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
    video.readyState = 4;
    video.dispatchEvent(new Event('canplay'));
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
    video.seeking = false;
    video.dispatchEvent(new Event('seeked'));
    await operation;
    expect(settled).toBe(true);
  });

  it('does not confuse HAVE_CURRENT_DATA with seek completion', async () => {
    const video = Object.assign(new EventTarget(), { readyState: 4, seeking: true, error: null });
    let settled = false;
    const operation = execute(video).then(() => { settled = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
    video.seeking = false;
    video.dispatchEvent(new Event('seeked'));
    await operation;
  });

  it('rejects video errors even when a previous frame was decoded', async () => {
    const video = Object.assign(new EventTarget(), { readyState: 4, seeking: false, error: { code: 3 } });
    await expect(execute(video)).rejects.toThrow('video failed to load');
  });

  it('rejects an asynchronous media error while awaiting the first frame', async () => {
    const video = Object.assign(new EventTarget(), { readyState: 1, seeking: true, error: null as unknown });
    const operation = execute(video);
    video.error = { code: 3 };
    video.dispatchEvent(new Event('error'));
    await expect(operation).rejects.toThrow('video failed to load');
  });
});
