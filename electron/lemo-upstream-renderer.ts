import { BrowserWindow, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { encodeHtmlFrames } from './html-video-frame-stream';
import { htmlVideoFrameCaptureTimeoutMs } from '../src/shared/video-render-budget';
import { serveLemoUpstreamProject, type LemoSourceOptions } from './lemo-upstream-source';

export interface LemoUpstreamReviewOptions extends LemoSourceOptions {
  outputDir: string;
  times: number[];
  width?: number;
  height?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}
export interface LemoUpstreamReviewReceipt {
  revision: string;
  entry: string;
  durationSeconds?: number;
  width: number;
  height: number;
  frames: Array<{ time: number; path: string }>;
  errors: string[];
  missingResources: Array<{ path: string; status: number }>;
  failedFonts: string[];
  technicalPassed: boolean;
  aestheticReview: false;
}

export interface LemoUpstreamExportOptions extends Omit<LemoUpstreamReviewOptions, 'times'> {
  durationSeconds: number;
  fps?: number;
}

export async function exportLemoUpstreamProject(options: LemoUpstreamExportOptions): Promise<{ outputPath: string; receipt: LemoUpstreamReviewReceipt }> {
  const fps = options.fps ?? 30;
  if (!Number.isInteger(fps) || fps < 1 || fps > 60 || !Number.isFinite(options.durationSeconds) || options.durationSeconds <= 0) throw new Error('LEMO_EXPORT_CLOCK');
  const count = Math.ceil(options.durationSeconds * fps);
  const outputPath = join(options.outputDir, 'native-picture.mp4');
  const receipt = await runLemoUpstreamProject({ ...options, times: [0], timeoutMs: options.timeoutMs ?? htmlVideoFrameCaptureTimeoutMs(count) + 120000 }, { fps, count, duration: options.durationSeconds, outputPath });
  if (!receipt.technicalPassed) throw new Error('LEMO_EXPORT_FAILED: ' + [...receipt.errors, ...receipt.missingResources.map(r => r.path)].join('; '));
  return { outputPath, receipt };
}

export function reviewLemoUpstreamProject(options: LemoUpstreamReviewOptions): Promise<LemoUpstreamReviewReceipt> {
  return runLemoUpstreamProject(options);
}

/** Run an unchanged upstream/native film with Electron's bundled Chromium, without a second browser installation. */
async function runLemoUpstreamProject(options: LemoUpstreamReviewOptions, video?: { fps: number; count: number; duration: number; outputPath: string }): Promise<LemoUpstreamReviewReceipt> {
  const width = options.width ?? 1920, height = options.height ?? 1080;
  if (![width, height].every(value => Number.isInteger(value) && value >= 16 && value <= 8192)) throw new Error('LEMO_CANVAS_SIZE');
  if (!options.times.length || options.times.some(time => !Number.isFinite(time) || time < 0)) throw new Error('LEMO_SAMPLE_TIME');
  options.signal?.throwIfAborted();
  const source = await serveLemoUpstreamProject(options);
  let window: BrowserWindow | undefined;
  const receipt: LemoUpstreamReviewReceipt = { revision: source.manifest.revision, entry: options.filmDir, width, height,
    frames: [], errors: [], missingResources: source.failures, failedFonts: [], technicalPassed: false, aestheticReview: false };
  const partition = session.fromPartition(`lemo-upstream-${randomUUID()}`);
  const captureError = (message: string) => { if (receipt.errors.length < 100 && !receipt.errors.includes(message)) receipt.errors.push(message); };
  const controller = new AbortController();
  const signal = controller.signal;
  const destroy = () => { if (window && !window.isDestroyed()) window.destroy(); };
  const aborted = () => controller.abort(options.signal?.reason);
  const stopped = new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => { destroy(); reject(signal.reason); }, { once: true });
  });
  // Electron can leave executeJavaScript pending when a renderer is destroyed.
  // Race each browser operation, then await the work/encoder cleanup before returning.
  void stopped.catch(() => {});
  const browser = <T>(operation: Promise<T>): Promise<T> => Promise.race([operation, stopped]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await mkdir(options.outputDir, { recursive: true });
    partition.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    partition.setPermissionCheckHandler(() => false);
    partition.on('will-download', event => event.preventDefault());
    partition.webRequest.onBeforeRequest((details, callback) => {
      const allowed = details.url.startsWith(`${source.origin}/`) || /^(data:|blob:)/.test(details.url);
      if (!allowed) captureError(`LEMO_EXTERNAL_RESOURCE: ${details.url.slice(0, 300)}`);
      callback({ cancel: !allowed });
    });
    window = new BrowserWindow({ show: false, width, height, useContentSize: true, backgroundColor: '#000000',
      webPreferences: { session: partition, nodeIntegration: false, contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('console-message', details => {
      if (details.level === 'error') captureError(details.message.slice(0, 1500));
    });
    window.webContents.on('render-process-gone', (_event, details) => captureError(`LEMO_RENDER_PROCESS: ${details.reason}`));
    options.signal?.addEventListener('abort', aborted, { once: true });
    if (options.signal?.aborted) aborted();
    signal.throwIfAborted();
    const active = window;
    const timeoutMs = options.timeoutMs ?? 90_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('LEMO_REVIEW_TIMEOUT_VALUE');
    timer = setTimeout(() => controller.abort(new Error(`LEMO_REVIEW_TIMEOUT: ${timeoutMs}ms`)), timeoutMs);
    const work = async () => {
      await browser(active.loadURL(source.pageUrl));
      await browser(active.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        const start = Date.now();
        const failedFonts = () => [...document.fonts].filter(f => f.status === 'error').map(f => f.family);
        const check = () => {
          if (window.READY === true && typeof window.render === 'function') return resolve(true);
          if (failedFonts().length) return reject(new Error('LEMO_FONT_LOAD_FAILED: ' + failedFonts().join(', ')));
          if (Date.now() - start > ${Math.min(timeoutMs, 60_000)}) return reject(new Error('LEMO_READY_TIMEOUT'));
          setTimeout(check, 50);
        }; check();
      })`));
      const metadata = await browser(active.webContents.executeJavaScript(`({ duration: window.DUR, fonts: [...document.fonts].filter(f => f.status === 'error').map(f => f.family) })`)) as { duration: number; fonts: string[] };
      if (!(metadata.duration > 0) || !Number.isFinite(metadata.duration)) throw new Error('LEMO_DURATION_INVALID');
      receipt.durationSeconds = metadata.duration;
      receipt.failedFonts = metadata.fonts;
      const capture = async (time: number) => {
        signal.throwIfAborted();
        if (time >= metadata.duration) throw new Error(`LEMO_SAMPLE_OUTSIDE_FILM: ${time} >= ${metadata.duration}`);
        await browser(active.webContents.executeJavaScript(`Promise.resolve(window.render(${JSON.stringify(time)})).then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))))`));
        const image = await browser(active.webContents.capturePage());
        const size = image.getSize();
        if (size.width !== width || size.height !== height) throw new Error(`LEMO_CAPTURE_SIZE: ${size.width}x${size.height}`);
        return image;
      };
      const sample = async (time: number, image: Awaited<ReturnType<typeof capture>>) => {
        const path = join(options.outputDir, `frame-${receipt.frames.length}-${time.toFixed(3)}.png`);
        await writeFile(path, image.toPNG()); receipt.frames.push({ time, path });
      };
      if (video) {
        if (Math.abs(metadata.duration - video.duration) > 1 / video.fps) throw new Error('LEMO_EXPORT_DURATION_MISMATCH');
        await mkdir(join(options.outputDir, 'frames'), { recursive: true });
        const samples = new Set([0, Math.floor(video.count / 2), video.count - 1]);
        await encodeHtmlFrames({ mode: 'encode_render_scene', work_dir: options.outputDir, output_path: video.outputPath,
          scene: { frames_dir: join(options.outputDir, 'frames'), audio_path: '', audio_clips: [], fps: video.fps, duration_s: video.duration, video_frame_count: video.count } }, async writeFrame => {
          for (let index = 0; index < video.count; index++) {
            const time = Math.min(index / video.fps, metadata.duration - 0.000001);
            const image = await capture(time);
            if (samples.has(index)) await sample(time, image);
            if (receipt.errors.length || receipt.missingResources.length) throw new Error('LEMO_EXPORT_RUNTIME_ERRORS');
            await writeFrame(index, image.toJPEG(95));
          }
        }, signal);
      } else {
        for (const time of options.times) await sample(time, await capture(time));
      }
    };
    await work();
    // Missing optional files remain visible in the receipt; they cannot be mistaken for a complete render.
    receipt.technicalPassed = !receipt.errors.length && !receipt.missingResources.length && !receipt.failedFonts.length;
  } catch (error) {
    captureError(error instanceof Error ? error.message : String(error));
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener('abort', aborted);
    controller.abort();
    destroy();
    partition.webRequest.onBeforeRequest(null);
    await source.close();
    await writeFile(join(options.outputDir, 'review.json'), JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  }
  options.signal?.throwIfAborted();
  return receipt;
}

