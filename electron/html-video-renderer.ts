import { BrowserWindow } from 'electron';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  HtmlVideoCapturedScene,
  HtmlVideoExportInput,
  HtmlVideoExportResult,
} from '../src/shared/html-video';
import { createHtmlVideoComposePayload, type HtmlVideoComposePayload } from '../src/shared/html-video';
import { runStoryboundMediaSidecar } from '../src/shared/storybound-sidecar';
import type {
  HtmlVideoCanvas,
  HtmlVideoPreviewCaptureInput,
  HtmlVideoRuntimeRenderer,
} from './html-video-runtime';
import { attachLocalHtmlSecurity, isAllowedLocalHtmlNavigation } from './security';

const sidecarFramePattern = 'frame_%04d.jpg';
const hiddenWindowReadyTimeoutMs = 30_000;
const hiddenFrameTimeoutMs = 15_000;
const hiddenSceneTimeoutMs = 30 * 60 * 1_000;
const visiblePreviewMaxHeight = 900;
const visiblePreviewMaxWidth = 900;
const windowSignals = new WeakMap<BrowserWindow, AbortSignal | undefined>();
const visiblePreviewWindows = new Set<BrowserWindow>();
const hiddenCaptureQueue: HiddenCaptureWaiter[] = [];
let hiddenCaptureLocked = false;

interface HiddenCaptureWaiter {
  signal?: AbortSignal;
  abort: () => void;
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
}

export interface ElectronHtmlVideoRenderer extends HtmlVideoRuntimeRenderer {
  openPreview(input: {
    workDir: string;
    htmlPath: string;
    canvas: HtmlVideoCanvas;
    signal?: AbortSignal;
  }): Promise<void>;
}

export function createElectronHtmlVideoRenderer(): ElectronHtmlVideoRenderer {
  return {
    render: renderHtmlVideo,
    capturePreview,
    openPreview,
  };
}

export async function cleanupHtmlVideoFrameDirectories(
  framesDirs: readonly string[],
  primaryError?: { error: unknown },
  removeDirectory: (path: string) => Promise<void> = async (framesDir) => {
    await rm(framesDir, { recursive: true, force: true });
  },
): Promise<void> {
  const cleanupErrors: unknown[] = [];
  for (const framesDir of framesDirs) {
    try {
      await removeDirectory(framesDir);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length === 0) return;
  if (primaryError) {
    throw new AggregateError(
      [primaryError.error, ...cleanupErrors],
      'HTML video rendering and frame cleanup both failed.',
    );
  }
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  throw new AggregateError(cleanupErrors, 'HTML video frame cleanup failed.');
}

async function renderHtmlVideo(
  input: HtmlVideoExportInput,
  options: { signal?: AbortSignal } = {},
): Promise<HtmlVideoExportResult> {
  const signal = options.signal;
  const framesDirs: string[] = [];
  const capturedScenes: HtmlVideoCapturedScene[] = [];
  const htmlSceneDir = join(input.workDir, 'html-scenes');
  let primaryError: { error: unknown } | undefined;
  await mkdir(htmlSceneDir, { recursive: true });
  try {
    await withHiddenCaptureLock(signal, async () => {
      for (const scene of input.scenes) {
        throwIfAborted(signal);
        const sceneDir = join(input.workDir, `frames-${String(scene.sceneId).padStart(3, '0')}`);
        await rm(sceneDir, { recursive: true, force: true });
        await mkdir(sceneDir, { recursive: true });
        framesDirs.push(sceneDir);
        const htmlPath = join(htmlSceneDir, `scene-${String(scene.sceneId).padStart(3, '0')}.html`);
        await writeFile(htmlPath, scene.html, 'utf8');
        let window: BrowserWindow | null = null;
        try {
          window = await openHiddenHtmlWindow({
            workDir: input.workDir,
            htmlPath,
            canvas: { width: input.canvas_w, height: input.canvas_h },
            signal,
          });
          const totalFrames = Math.max(1, Math.ceil(scene.duration * input.fps));
          const sceneDeadline = Date.now() + hiddenSceneTimeoutMs;
          for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
            throwIfAborted(signal);
            const time = frameIndex / input.fps;
            const frameNumber = frameIndex + 1;
            if (Date.now() >= sceneDeadline) throw new Error(`HTML scene ${scene.sceneId} capture timed out.`);
            await seekHiddenHtmlSceneFrame(window, time);
            const remainingSceneMs = Math.max(1, sceneDeadline - Date.now());
            const image = await withRendererTimeout(
              window.webContents.capturePage(),
              Math.min(hiddenFrameTimeoutMs, remainingSceneMs),
              `HTML scene ${scene.sceneId} frame ${frameNumber} capture`,
              signal,
            );
            const framePath = join(sceneDir, sidecarFramePattern.replace('%04d', String(frameNumber).padStart(4, '0')));
            await writeFile(framePath, image.toJPEG(92));
          }
          capturedScenes.push({
            sceneId: scene.sceneId,
            framesDir: sceneDir,
            audioPath: scene.audioPath,
            fps: input.fps,
          });
        } finally {
          if (window && !window.isDestroyed()) window.destroy();
        }
      }
    });
    throwIfAborted(signal);
    const payload: HtmlVideoComposePayload = createHtmlVideoComposePayload(input, capturedScenes);
    const result = await runStoryboundMediaSidecar(payload, { signal });
    throwIfAborted(signal);
    return {
      outputPath: result.output_path ?? input.outputPath,
      sourceVideoPath: result.source_path ?? join(input.workDir, '_source.mp4'),
      duration: input.totalDurationS,
      taskDir: input.workDir,
      framesDirs,
    };
  } catch (error) {
    primaryError = { error };
    throw error;
  } finally {
    await cleanupHtmlVideoFrameDirectories(framesDirs, primaryError);
  }
}

async function capturePreview(input: HtmlVideoPreviewCaptureInput): Promise<string> {
  throwIfAborted(input.signal);
  await mkdir(dirname(input.outputPath), { recursive: true });
  return withHiddenCaptureLock(input.signal, async () => {
    let window: BrowserWindow | null = null;
    try {
      window = await openHiddenHtmlWindow(input);
      await seekHiddenHtmlSceneFrame(window, 0);
      const image = await withRendererTimeout(
        window.webContents.capturePage(),
        hiddenFrameTimeoutMs,
        'HTML preview capture',
        input.signal,
      );
      await writeFile(input.outputPath, image.toJPEG(88));
      return input.outputPath;
    } finally {
      if (window && !window.isDestroyed()) window.destroy();
    }
  });
}

async function openPreview(input: {
  workDir: string;
  htmlPath: string;
  canvas: HtmlVideoCanvas;
  signal?: AbortSignal;
}): Promise<void> {
  throwIfAborted(input.signal);
  const scale = Math.min(
    1,
    visiblePreviewMaxWidth / input.canvas.width,
    visiblePreviewMaxHeight / input.canvas.height,
  );
  const window = new BrowserWindow({
    show: false,
    width: Math.max(360, Math.round(input.canvas.width * scale)),
    height: Math.max(480, Math.round(input.canvas.height * scale)),
    useContentSize: true,
    title: 'HTML 动画预览',
    backgroundColor: '#090b0d',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  windowSignals.set(window, input.signal);
  visiblePreviewWindows.add(window);
  window.once('closed', () => visiblePreviewWindows.delete(window));
  try {
    const htmlUrl = checkedLocalHtmlUrl(input.htmlPath, input.workDir);
    attachLocalHtmlSecurity(window, input.workDir);
    await withRendererTimeout(window.loadURL(htmlUrl), hiddenWindowReadyTimeoutMs, 'HTML preview load', input.signal);
    await waitForHiddenHtmlSceneReady(window);
    window.webContents.setZoomFactor(scale);
    window.show();
    await withRendererTimeout(
      window.webContents.executeJavaScript('Promise.resolve(window.__tl.play()).then(() => true)'),
      hiddenFrameTimeoutMs,
      'HTML preview play',
      input.signal,
    );
  } catch (error) {
    if (!window.isDestroyed()) window.destroy();
    throw error;
  }
}

async function openHiddenHtmlWindow(input: {
  workDir: string;
  htmlPath: string;
  canvas: HtmlVideoCanvas;
  signal?: AbortSignal;
}): Promise<BrowserWindow> {
  throwIfAborted(input.signal);
  const window = new BrowserWindow({
    show: false,
    width: input.canvas.width,
    height: input.canvas.height,
    useContentSize: true,
    backgroundColor: '#000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  windowSignals.set(window, input.signal);
  try {
    const htmlUrl = checkedLocalHtmlUrl(input.htmlPath, input.workDir);
    attachLocalHtmlSecurity(window, input.workDir);
    await withRendererTimeout(window.loadURL(htmlUrl), hiddenWindowReadyTimeoutMs, 'HTML scene load', input.signal);
    await waitForHiddenHtmlSceneReady(window);
    return window;
  } catch (error) {
    if (!window.isDestroyed()) window.destroy();
    throw error;
  }
}

function checkedLocalHtmlUrl(htmlPath: string, workDir: string): string {
  const htmlUrl = pathToFileURL(htmlPath).toString();
  if (!isAllowedLocalHtmlNavigation(htmlUrl, workDir)) {
    throw new Error('HTML scene path must stay inside the task work directory.');
  }
  return htmlUrl;
}

async function waitForHiddenHtmlSceneReady(window: BrowserWindow): Promise<void> {
  await withRendererTimeout(window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const isReady = () => document.readyState !== 'loading'
      && window.__ready === true
      && window.__tl
      && typeof window.__tl.seek === 'function';
    const finish = () => {
      const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
      const imagesReady = Promise.all(Array.from(document.images).map((image) => {
        const imageError = () => new Error('HTML scene image failed to load. Verify the task image assets and retry.');
        if (image.complete) {
          return image.naturalWidth > 0 ? Promise.resolve() : Promise.reject(imageError());
        }
        return new Promise((imageResolve, imageReject) => {
          image.addEventListener('load', () => {
            if (image.naturalWidth > 0) imageResolve();
            else imageReject(imageError());
          }, { once: true });
          image.addEventListener('error', () => imageReject(imageError()), { once: true });
        });
      }));
      Promise.all([fontsReady, imagesReady]).then(
        () => requestAnimationFrame(() => resolve(true)),
        reject,
      );
    };
    if (isReady()) {
      finish();
      return;
    }
    const timer = setInterval(() => {
      if (isReady()) {
        clearInterval(timer);
        finish();
      }
    }, 16);
  })`), hiddenWindowReadyTimeoutMs, 'HTML scene ready', windowSignals.get(window));
}

async function seekHiddenHtmlSceneFrame(window: BrowserWindow, time: number): Promise<void> {
  await withRendererTimeout(window.webContents.executeJavaScript(`Promise.resolve(window.__tl.seek(${JSON.stringify(time)})).then(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
  }))`), hiddenFrameTimeoutMs, 'HTML scene frame seek', windowSignals.get(window));
}

function withRendererTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      complete();
    };
    const abort = () => finish(() => reject(abortReason(signal)));
    const timeout = setTimeout(() => finish(() => reject(new Error(`${label} timed out.`))), timeoutMs);
    timeout.unref?.();
    signal?.addEventListener('abort', abort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

async function withHiddenCaptureLock<T>(
  signal: AbortSignal | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  const release = await acquireHiddenCaptureLock(signal);
  try {
    throwIfAborted(signal);
    return await operation();
  } finally {
    release();
  }
}

function acquireHiddenCaptureLock(signal: AbortSignal | undefined): Promise<() => void> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const waiter: HiddenCaptureWaiter = {
      signal,
      abort: () => {
        const index = hiddenCaptureQueue.indexOf(waiter);
        if (index < 0) return;
        hiddenCaptureQueue.splice(index, 1);
        signal?.removeEventListener('abort', waiter.abort);
        reject(abortReason(signal));
      },
      resolve,
      reject,
    };
    signal?.addEventListener('abort', waiter.abort, { once: true });
    hiddenCaptureQueue.push(waiter);
    grantNextHiddenCaptureWaiter();
  });
}

function grantNextHiddenCaptureWaiter(): void {
  if (hiddenCaptureLocked) return;
  while (hiddenCaptureQueue.length > 0) {
    const waiter = hiddenCaptureQueue.shift()!;
    waiter.signal?.removeEventListener('abort', waiter.abort);
    if (waiter.signal?.aborted) {
      waiter.reject(abortReason(waiter.signal));
      continue;
    }
    hiddenCaptureLocked = true;
    let released = false;
    waiter.resolve(() => {
      if (released) return;
      released = true;
      hiddenCaptureLocked = false;
      grantNextHiddenCaptureWaiter();
    });
    return;
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal | undefined): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException('The HTML video operation was cancelled.', 'AbortError');
}
