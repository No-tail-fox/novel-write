import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  CAPTURE_HOST_ERROR_CODES,
  CaptureHost,
  CaptureHostError,
  captureVideoSpecScene,
  createWritableFrameSink,
  ffmpegFrameInputArgs,
  sceneCaptureStrategy,
  type CaptureImage,
  type CaptureSceneRequest,
  type CaptureWindow,
  type CaptureWindowRequest,
  type CapturedFrame,
} from '../electron/capture-host';
import { buildSceneRuntimeBootstrap } from '../src/shared/scene-runtime';
import { createVideoSpec } from '../src/shared/video-spec';
import { createFakePage, type FakePage, type FakePageOptions } from './helpers/fake-scene-page';

const W = 32;
const H = 18;
const FPS = 30;

interface FakeWindowControls {
  /** 页面工厂：每次 loadURL 新建一个 vm 页面。 */
  page?: () => FakePage;
  hangLoad?: boolean;
  hangCaptureAt?: number;
  captureSize?: { width: number; height: number };
  /** 拦截 executeJavaScript（返回 undefined 表示不拦截）。 */
  intercept?: (code: string, page: FakePage) => unknown;
  /** seek 第 n 帧之后，在 capturePage 前触发。 */
  afterSeek?: (frame: number, window: FakeWindow) => void;
}

interface FakeWindow extends CaptureWindow {
  readonly request: CaptureWindowRequest;
  readonly page?: FakePage;
  readonly destroyed: boolean;
  readonly captures: number[];
  emitPageError(message: string): void;
  crash(reason: string): void;
}

/** Lemo 契约的假页面：render(t) 把“当前绘制帧”写进 window.__painted；capturePage 把它编码进像素。 */
function lemoPage(options: { dur?: number; ready?: boolean; renderHangAt?: number; extra?: FakePageOptions } = {}): () => FakePage {
  return () => {
    const page = createFakePage({
      ...options.extra,
      globals: {
        READY: options.ready ?? true,
        DUR: options.dur ?? 1,
        renders: [] as number[],
        ...options.extra?.globals,
      },
    });
    page.render = (t: number) => {
      const frame = Math.round(t * FPS);
      if (frame === options.renderHangAt) return new Promise(() => undefined);
      page.renders.push(frame);
      page.__painted = frame;
      return undefined;
    };
    return page;
  };
}

function createFakeWindowFactory(controls: FakeWindowControls = {}) {
  const windows: FakeWindow[] = [];
  const factory = (request: CaptureWindowRequest): FakeWindow => {
    const pageErrorListeners: Array<(message: string) => void> = [];
    const crashListeners: Array<(reason: string) => void> = [];
    let page: FakePage | undefined;
    let destroyed = false;
    const captures: number[] = [];
    const window: FakeWindow = {
      request,
      get page() { return page; },
      get destroyed() { return destroyed; },
      captures,
      loadURL: async () => {
        if (controls.hangLoad) return new Promise(() => undefined);
        page = (controls.page ?? lemoPage())();
        return undefined;
      },
      executeJavaScript: async (code: string) => {
        if (!page) throw new Error('no page loaded');
        const intercepted = controls.intercept?.(code, page);
        if (intercepted !== undefined) return intercepted;
        const result = await page.run(code);
        const seek = /seekFrame\((\d+)\)/u.exec(code);
        if (seek) controls.afterSeek?.(Number(seek[1]), window);
        // Structured clone across the IPC boundary.
        return result === undefined ? undefined : JSON.parse(JSON.stringify(result));
      },
      capturePage: async (): Promise<CaptureImage> => {
        const frame = Number(page?.__painted ?? -1);
        if (frame === controls.hangCaptureAt) return new Promise(() => undefined);
        captures.push(frame);
        const size = controls.captureSize ?? { width: request.width, height: request.height };
        return {
          getSize: () => size,
          toBitmap: () => new Uint8Array(size.width * size.height * 4).fill(frame & 0xff),
          toJPEG: (quality: number) => new TextEncoder().encode(`jpeg:q${quality}:frame${frame}`),
        };
      },
      onPageError: listener => { pageErrorListeners.push(listener); },
      onCrash: listener => { crashListeners.push(listener); },
      destroy: () => { destroyed = true; page?.close(); },
      isDestroyed: () => destroyed,
      emitPageError: message => pageErrorListeners.forEach(listener => listener(message)),
      crash: reason => crashListeners.forEach(listener => listener(reason)),
    };
    windows.push(window);
    return window;
  };
  return { factory, windows };
}

function collectingSink() {
  const frames: CapturedFrame[] = [];
  return { frames, sink: (frame: CapturedFrame) => { frames.push(frame); } };
}

function baseRequest(overrides: Partial<CaptureSceneRequest> = {}): CaptureSceneRequest {
  return { url: 'file:///scene/index.html', adapter: 'lemo', width: W, height: H, fps: FPS, format: 'bgra', sink: () => undefined, ...overrides };
}

async function captureError(promise: Promise<unknown>): Promise<CaptureHostError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CaptureHostError);
    return error as CaptureHostError;
  }
  throw new Error('expected the capture to fail');
}

describe('CaptureHost frame loop', () => {
  it('captures every frame in order and hands N BGRA frames to the sink', async () => {
    const { factory, windows } = createFakeWindowFactory({ page: lemoPage({ dur: 1 }) });
    const { frames, sink } = collectingSink();
    const progress: number[] = [];
    const host = new CaptureHost({ createWindow: factory });
    const result = await host.captureScene(baseRequest({ durationFrames: 30, sink, timelineOffset: 100, onProgress: p => progress.push(p.captured) }));
    expect(result.framesCaptured).toBe(30);
    expect(result.durationFrames).toBe(30);
    expect(result.pageErrors).toEqual([]);
    expect(result.descriptor).toMatchObject({ adapter: 'lemo', fps: 30, durationFrames: 30, pageDurationSeconds: 1, width: W, height: H });
    expect(frames.map(frame => frame.frame)).toEqual(Array.from({ length: 30 }, (_, index) => index));
    expect(frames.map(frame => frame.index)).toEqual(Array.from({ length: 30 }, (_, index) => index));
    expect(frames[5]).toMatchObject({ timelineFrame: 105, format: 'bgra', width: W, height: H });
    for (const frame of frames) {
      expect(frame.data.length).toBe(W * H * 4);
      expect(frame.data[0]).toBe(frame.frame); // the pixel content is the frame that was painted before capture
    }
    expect(windows[0].page!.renders).toEqual(Array.from({ length: 30 }, (_, index) => index));
    expect(windows[0].request).toEqual({ width: W, height: H, pageUrl: 'file:///scene/index.html' });
    expect(windows[0].destroyed).toBe(true);
    expect(progress.at(-1)).toBe(30);
  });

  it('derives the frame count from the page when VideoSpec gives none, and supports JPEG', async () => {
    const { factory } = createFakeWindowFactory({ page: lemoPage({ dur: 0.2 }) });
    const { frames, sink } = collectingSink();
    const result = await new CaptureHost({ createWindow: factory }).captureScene(baseRequest({ format: 'jpeg', jpegQuality: 90, sink }));
    expect(result.durationFrames).toBe(6);
    expect(frames.map(frame => new TextDecoder().decode(frame.data))).toEqual([0, 1, 2, 3, 4, 5].map(n => `jpeg:q90:frame${n}`));
    expect(frames.every(frame => frame.format === 'jpeg')).toBe(true);
  });

  it('captures an explicit frame list in the given order and rejects frames outside the scene', async () => {
    const { factory } = createFakeWindowFactory();
    const { frames, sink } = collectingSink();
    const host = new CaptureHost({ createWindow: factory });
    await host.captureScene(baseRequest({ durationFrames: 30, frames: [29, 0, 15], sink }));
    expect(frames.map(frame => [frame.index, frame.frame, frame.data[0]])).toEqual([[0, 29, 29], [1, 0, 0], [2, 15, 15]]);
    const error = await captureError(host.captureScene(baseRequest({ durationFrames: 30, frames: [30] })));
    expect(error.code).toBe('CAPTURE_HOST_FRAME_RANGE');
  });

  it('validates options before opening a window', async () => {
    const { factory, windows } = createFakeWindowFactory();
    const host = new CaptureHost({ createWindow: factory });
    for (const patch of [{ width: 15 }, { fps: 0 }, { format: 'png' as never }, { durationFrames: 0 }, { frames: [1.5] }, { jpegQuality: 0 }, { timeouts: { seekMs: 0 } }]) {
      const error = await captureError(host.captureScene(baseRequest(patch)));
      expect(error.code, JSON.stringify(patch)).toBe('CAPTURE_HOST_OPTIONS_INVALID');
    }
    expect(windows).toHaveLength(0);
  });
});

describe('CaptureHost cancellation', () => {
  it('stops after the current frame when aborted and destroys the window', async () => {
    const { factory, windows } = createFakeWindowFactory();
    const controller = new AbortController();
    const frames: number[] = [];
    const error = await captureError(new CaptureHost({ createWindow: factory }).captureScene(baseRequest({
      durationFrames: 30,
      signal: controller.signal,
      sink: frame => { frames.push(frame.frame); if (frames.length === 3) controller.abort(new Error('user cancelled')); },
    })));
    expect(error.code).toBe('CAPTURE_HOST_ABORTED');
    expect(frames).toEqual([0, 1, 2]);
    expect(windows[0].destroyed).toBe(true);
  });

  it('interrupts a hung page operation immediately on abort', async () => {
    const { factory, windows } = createFakeWindowFactory({ page: lemoPage({ renderHangAt: 2 }) });
    const controller = new AbortController();
    const pending = new CaptureHost({ createWindow: factory }).captureScene(baseRequest({ durationFrames: 30, signal: controller.signal, timeouts: { seekMs: 60_000 } }));
    setTimeout(() => controller.abort(), 150);
    const started = Date.now();
    const error = await captureError(pending);
    expect(error.code).toBe('CAPTURE_HOST_ABORTED');
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(windows[0].destroyed).toBe(true);
  });

  it('does not open a window for an already aborted signal', async () => {
    const { factory, windows } = createFakeWindowFactory();
    const controller = new AbortController();
    controller.abort();
    const error = await captureError(new CaptureHost({ createWindow: factory }).captureScene(baseRequest({ signal: controller.signal })));
    expect(error.code).toBe('CAPTURE_HOST_ABORTED');
    expect(windows).toHaveLength(0);
  });
});

describe('CaptureHost bounded timeouts', () => {
  const fast = { loadMs: 80, readyMs: 80, seekMs: 80, captureMs: 80, sinkMs: 80, injectMs: 500, windowMs: 80 };

  it.each([
    ['CAPTURE_HOST_LOAD_TIMEOUT', { hangLoad: true }, {}],
    ['CAPTURE_HOST_READY_TIMEOUT', { page: lemoPage({ ready: false }) }, {}],
    ['CAPTURE_HOST_SEEK_TIMEOUT', { page: lemoPage({ renderHangAt: 4 }) }, {}],
    ['CAPTURE_HOST_CAPTURE_TIMEOUT', { hangCaptureAt: 7 }, {}],
    ['CAPTURE_HOST_SINK_TIMEOUT', {}, { sink: (frame: CapturedFrame) => (frame.frame === 2 ? new Promise<void>(() => undefined) : undefined) }],
  ] as const)('%s', async (code, controls, overrides) => {
    const { factory, windows } = createFakeWindowFactory(controls as FakeWindowControls);
    const error = await captureError(new CaptureHost({ createWindow: factory }).captureScene(baseRequest({ durationFrames: 30, timeouts: fast, ...overrides })));
    expect(error.code).toBe(code);
    expect(error.retryable).toBe(code !== 'CAPTURE_HOST_SINK_TIMEOUT');
    expect(windows[0].destroyed).toBe(true);
  });

  it('times out a window factory that never resolves', async () => {
    const error = await captureError(new CaptureHost({ createWindow: () => new Promise<CaptureWindow>(() => undefined) }).captureScene(baseRequest({ timeouts: fast })));
    expect(error.code).toBe('CAPTURE_HOST_WINDOW_FAILED');
  });
});

describe('CaptureHost page health', () => {
  it('fails on console errors reported by the window, with the collected messages', async () => {
    const { factory } = createFakeWindowFactory({ afterSeek: (frame, window) => { if (frame === 2) window.emitPageError('Uncaught TypeError: boom'); } });
    const frames: number[] = [];
    const error = await captureError(new CaptureHost({ createWindow: factory }).captureScene(baseRequest({ durationFrames: 30, sink: frame => { frames.push(frame.frame); } })));
    expect(error.code).toBe('CAPTURE_HOST_PAGE_ERROR');
    expect(error.frame).toBe(2);
    expect(error.pageErrors).toEqual(['Uncaught TypeError: boom']);
    expect(frames).toEqual([0, 1]);
  });

  it('fails on errors collected by __sd (scene callbacks, onerror)', async () => {
    const { factory } = createFakeWindowFactory({ afterSeek: (frame, window) => { if (frame === 1) window.page!.dispatch('error', { message: 'ReferenceError: foo' }); } });
    const error = await captureError(new CaptureHost({ createWindow: factory }).captureScene(baseRequest({ durationFrames: 30 })));
    // The error event arrives after seek #1 resolved, so the host sees it on the next seek's error count.
    expect(error.code).toBe('CAPTURE_HOST_PAGE_ERROR');
    expect(error.pageErrors[0]).toMatch(/\[error\] ReferenceError: foo/u);
  });

  it('can collect page errors without failing when failOnPageErrors is false', async () => {
    const { factory } = createFakeWindowFactory({ afterSeek: (frame, window) => { if (frame === 0) window.emitPageError('warning-level error'); } });
    const result = await new CaptureHost({ createWindow: factory }).captureScene(baseRequest({ durationFrames: 30, frames: [0, 1, 2, 3, 4], failOnPageErrors: false }));
    expect(result.framesCaptured).toBe(5);
    expect(result.pageErrors).toEqual(['warning-level error']);
  });

  it('verifies fonts: failed faces stop the capture', async () => {
    const { factory } = createFakeWindowFactory({ page: lemoPage({ extra: { fonts: [{ family: 'Noto Serif SC', status: 'error' }] } }) });
    const error = await captureError(new CaptureHost({ createWindow: factory }).captureScene(baseRequest({ durationFrames: 30 })));
    expect(error.code).toBe('CAPTURE_HOST_FONTS_FAILED');
    expect(error.message).toContain('Noto Serif SC');
  });

  it('reports a renderer crash as CAPTURE_HOST_RENDERER_GONE', async () => {
    const { factory } = createFakeWindowFactory({ afterSeek: (frame, window) => { if (frame === 3) window.crash('crashed'); } });
    const error = await captureError(new CaptureHost({ createWindow: factory }).captureScene(baseRequest({ durationFrames: 30 })));
    expect(error.code).toBe('CAPTURE_HOST_RENDERER_GONE');
    expect(error.retryable).toBe(true);
  });

  it('refuses silently scaled captures (DPR must be 1)', async () => {
    const { factory } = createFakeWindowFactory({ captureSize: { width: W * 2, height: H * 2 } });
    const error = await captureError(new CaptureHost({ createWindow: factory }).captureScene(baseRequest({ durationFrames: 30 })));
    expect(error.code).toBe('CAPTURE_HOST_SIZE_MISMATCH');
  });

  it('checks that the page echoes the requested frame', async () => {
    const { factory } = createFakeWindowFactory({ intercept: code => (code.includes('seekFrame(') ? { frame: 999, errorCount: 0 } : undefined) });
    const error = await captureError(new CaptureHost({ createWindow: factory }).captureScene(baseRequest({ durationFrames: 30 })));
    expect(error.code).toBe('CAPTURE_HOST_FRAME_MISMATCH');
  });

  it('rejects a page whose SceneRuntime does not match the request (protocol)', async () => {
    // The page already installed __sd at 24 fps; the host's 30 fps bootstrap is a no-op, so describe() disagrees.
    const { factory } = createFakeWindowFactory({
      page: () => {
        const page = lemoPage()();
        page.run(buildSceneRuntimeBootstrap('lemo', { fps: 24 }));
        return page;
      },
    });
    const error = await captureError(new CaptureHost({ createWindow: factory }).captureScene(baseRequest({ durationFrames: 30 })));
    expect(error.code).toBe('CAPTURE_HOST_PROTOCOL_INVALID');
    expect(error.message).toMatch(/fps 是 24/u);
  });

  it('rejects when the page duration disagrees with VideoSpec beyond the tolerance', async () => {
    const { factory } = createFakeWindowFactory({ page: lemoPage({ dur: 5 }) });
    const host = new CaptureHost({ createWindow: factory });
    const error = await captureError(host.captureScene(baseRequest({ durationFrames: 30 })));
    expect(error.code).toBe('CAPTURE_HOST_DURATION_MISMATCH');
    await expect(host.captureScene(baseRequest({ durationFrames: 3, durationToleranceFrames: null }))).resolves.toMatchObject({ framesCaptured: 3 });
  });

  it('maps a failing sink to CAPTURE_HOST_SINK_FAILED', async () => {
    const { factory } = createFakeWindowFactory();
    const error = await captureError(new CaptureHost({ createWindow: factory }).captureScene(baseRequest({ durationFrames: 30, sink: () => { throw new Error('EPIPE'); } })));
    expect(error.code).toBe('CAPTURE_HOST_SINK_FAILED');
    expect(error.message).toContain('EPIPE');
  });

  it('every error code is CAPTURE_HOST_ prefixed', () => {
    expect(CAPTURE_HOST_ERROR_CODES.every(code => code.startsWith('CAPTURE_HOST_'))).toBe(true);
  });
});

describe('captureVideoSpecScene', () => {
  const spec = createVideoSpec({
    route: 'creative',
    canvas: { width: W, height: H, fps: 30 },
    scenes: [
      { id: 'cover', adapter: { kind: 'still', imageRef: 'cover.png' }, durationFrames: 12 },
      { id: 'lemo-1', adapter: { kind: 'lemo', codeRef: 'scene.js' }, durationFrames: 30 },
    ],
  });

  it('uses the VideoSpec canvas, fps and integer frame count, and offsets timeline frames', async () => {
    const { factory, windows } = createFakeWindowFactory({ page: lemoPage({ dur: 1 }) });
    const { frames, sink } = collectingSink();
    const result = await captureVideoSpecScene(spec, 'lemo-1', { host: new CaptureHost({ createWindow: factory }), url: 'file:///scene/lemo-1.html', format: 'bgra', sink });
    expect(result.durationFrames).toBe(30);
    expect(windows[0].request).toMatchObject({ width: W, height: H });
    expect(frames).toHaveLength(30);
    expect(frames[0].timelineFrame).toBe(12);
    expect(frames[29].timelineFrame).toBe(41);
  });

  it('refuses ffmpeg-composited and unknown scenes with explicit codes', async () => {
    const host = new CaptureHost({ createWindow: createFakeWindowFactory().factory });
    const still = await captureError(captureVideoSpecScene(spec, 'cover', { host, url: 'file:///x.html', format: 'jpeg', sink: () => undefined }));
    expect(still.code).toBe('CAPTURE_HOST_NOT_CAPTURABLE');
    expect(still.message).toMatch(/ffmpeg/u);
    const missing = await captureError(captureVideoSpecScene(spec, 'nope', { host, url: 'file:///x.html', format: 'jpeg', sink: () => undefined }));
    expect(missing.code).toBe('CAPTURE_HOST_SCENE_NOT_FOUND');
  });

  it('re-exports the ADR-03 strategy switch', () => {
    expect(sceneCaptureStrategy({ videoSpecVersion: 1 })).toBe('capture-host');
    expect(sceneCaptureStrategy({ id: 'old-project' })).toBe('legacy');
  });
});

describe('frame sinks', () => {
  class FakeStdin extends EventEmitter {
    chunks: Uint8Array[] = [];
    destroyed = false;
    full = false;
    write(chunk: Uint8Array) { this.chunks.push(chunk); return !this.full; }
  }
  const frame = (n: number): CapturedFrame => ({ index: n, frame: n, timelineFrame: n, format: 'bgra', width: 1, height: 1, data: new Uint8Array([n, 0, 0, 255]) });

  it('writes frames and waits for drain under backpressure', async () => {
    const stdin = new FakeStdin();
    const sink = createWritableFrameSink(stdin);
    await sink(frame(0));
    stdin.full = true;
    let settled = false;
    const pending = Promise.resolve(sink(frame(1))).then(() => { settled = true; });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    stdin.emit('drain');
    await pending;
    expect(stdin.chunks.map(chunk => chunk[0])).toEqual([0, 1]);
    expect(stdin.listenerCount('drain') + stdin.listenerCount('error') + stdin.listenerCount('close')).toBe(0);
  });

  it('fails when the stream errors or closes during backpressure, or is already destroyed', async () => {
    const stdin = new FakeStdin();
    stdin.full = true;
    const sink = createWritableFrameSink(stdin);
    const failing = sink(frame(0));
    stdin.emit('error', new Error('EPIPE'));
    await expect(failing).rejects.toThrow('EPIPE');
    const closing = sink(frame(1));
    stdin.emit('close');
    await expect(closing).rejects.toThrow(/关闭/u);
    stdin.destroyed = true;
    expect(() => sink(frame(2))).toThrow(CaptureHostError);
  });

  it('builds ffmpeg stdin input args for both capture formats (ADR-16 pending)', () => {
    expect(ffmpegFrameInputArgs({ format: 'bgra', width: 1920, height: 1080, fps: 30 })).toEqual(['-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', '1920x1080', '-framerate', '30', '-i', '-']);
    expect(ffmpegFrameInputArgs({ format: 'jpeg', width: 1920, height: 1080, fps: 24 })).toEqual(['-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', '24', '-i', '-']);
    expect(() => ffmpegFrameInputArgs({ format: 'bgra', width: 0, height: 1, fps: 30 })).toThrow();
  });
});
