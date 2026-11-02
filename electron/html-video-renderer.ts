import { createHtmlVideoSceneReadyScript } from './html-video-scene-ready';
import { nativeFrameDetailCoverage, nativeCompositionIssue, type NativeCompositionSample } from '../src/shared/creative-animation/composition-review';
import { encodeHtmlFrames } from './html-video-frame-stream';
import { htmlVideoFrameCaptureTimeoutMs } from '../src/shared/video-render-budget';
import { withHtmlGraphicsRecovery } from './html-video-capture-recovery';
import { createHtmlVideoFrameSeekScript } from './html-video-frame-seek';
import { measureLemoSubtitleLayout } from '../src/shared/creative-animation/native-subtitles';
import { creativeLayoutInspectionScript } from '../src/shared/creative-animation/layout-review';
import { BrowserWindow, type NativeImage } from 'electron';
import { mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  HtmlVideoCapturedScene,
  HtmlVideoExportInput,
  HtmlVideoExportResult,
} from '../src/shared/html-video';
import { allocateHtmlVideoSceneFrameCounts, htmlVideoSceneFrameTime, createHtmlVideoComposePayload, type HtmlVideoComposePayload } from '../src/shared/html-video';
import { AppError } from '../src/shared/app-error';
import { runStoryboundMediaSidecar } from '../src/shared/storybound-sidecar';
import type {
  HtmlVideoCanvas,
  HtmlVideoPreviewCaptureInput,
  HtmlVideoRuntimeRenderer,
} from './html-video-runtime';
import { attachLocalHtmlSecurity, isAllowedLocalHtmlNavigation } from './security';
import { CREATIVE_REVIEW_REVISION, creativeUnsupportedClaims, creativeMinimumFontSize, creativeBackgroundMatches, creativeReviewSampleTimes, nativeFrameHasArtwork } from '../src/shared/creative-animation/review';

const hiddenWindowReadyTimeoutMs = 30_000;
const hiddenFrameTimeoutMs = 15_000;
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

export function createElectronHtmlVideoRenderer(options: {
  inspectScene?: (window: BrowserWindow, scene: HtmlVideoExportInput['scenes'][number]) => Promise<void>;
  inspectionTimeoutMs?: number;
} = {}): ElectronHtmlVideoRenderer {
  return {
    render: (input, renderOptions) => renderHtmlVideo(input, renderOptions, options.inspectScene, options.inspectionTimeoutMs),
    capturePreview,
    openPreview,
  };
}

/** Same isolated capture host as final rendering. This checks execution/layout, not aesthetic quality. */
export async function reviewHtmlAnimationFrames(input: {
  workDir: string; htmlPath: string; canvas: HtmlVideoCanvas; durationMs: number;
  approvedText?: string;
  expectedBackground?: string;
  native?: boolean;
  cues?: readonly { id?: string; text: string; startMs: number; endMs: number }[];
}): Promise<string[]> {
  return withHiddenCaptureLock(undefined, () => withHtmlGraphicsRecovery(async () => {
    const window = await openHiddenHtmlWindow(input);
    try {
      const paths: string[] = [];
      let nonemptyFrames = 0;
      const compositionSamples: NativeCompositionSample[] = [];
      if (input.native) {
        const measurement = await withRendererTimeout(window.webContents.executeJavaScript(
          '(' + measureLemoSubtitleLayout.toString() + ')(' + JSON.stringify({ shotId: 'native-review', startMs: 0, durationMs: input.durationMs, ...input.canvas, cues: input.cues ?? [] }) + ')'
        ), 120_000, 'Native subtitle review');
        if (measurement.status !== 'ok' || measurement.cues.some((cue: {issues: string[]}) => cue.issues.length)) throw new Error('LEMO_TEXTS: 原生字幕测量失败或超出画布。');
        for (const sample of measurement.visibilitySamples ?? []) {
          const expected = (input.cues ?? []).flatMap((cue, index) => cue.startMs <= sample.atMs && sample.atMs < cue.endMs ? [cue.id ?? '#' + index] : []);
          if (JSON.stringify([...expected].sort()) !== JSON.stringify([...sample.activeCueIds].sort())) throw new Error('LEMO_TEXTS: 字幕可见区间与歌词/旁白时间不一致（' + sample.atMs + 'ms；应显示 cueId=' + JSON.stringify(expected) + '；实际 cueId=' + JSON.stringify(sample.activeCueIds) + '）。请使用时间轴 cues[].id，保持 [startMs,endMs) 可见，避免场景与装配层重复字幕。');
        }
      }
      const sampleTimes = input.native
        ? [...new Set([0, .1, .25, .5, .75, .9, .999].map(fraction => Math.min(Math.max(0, input.durationMs - 1), input.durationMs * fraction)))]
        : creativeReviewSampleTimes(input.durationMs);
      for (const atMs of sampleTimes) {
        await seekHiddenHtmlSceneFrame(window, atMs / 1000);
        const layout = await withRendererTimeout(window.webContents.executeJavaScript(creativeLayoutInspectionScript(creativeMinimumFontSize(input.canvas.width, input.canvas.height))), hiddenFrameTimeoutMs, 'Creative frame layout review');
        // Captions must not make an otherwise empty scene pass the visual guard.
        if (!input.native) await withRendererTimeout(window.webContents.executeJavaScript(`(() => {
          document.querySelectorAll('.caption').forEach(e => e.style.visibility='hidden');
          return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        })()`), hiddenFrameTimeoutMs, 'Creative review caption hide');
        let captured: NativeImage;
        try { captured = await withRendererTimeout(window.webContents.capturePage(), hiddenFrameTimeoutMs, 'Creative review capture'); }
        finally { if (!input.native) await window.webContents.executeJavaScript(`document.querySelectorAll('.caption').forEach(e => e.style.removeProperty('visibility'))`); }
        const image = normalizeCapturedHtmlSceneImage(captured, input.canvas);
        const pixels = image.resize({ width: 64, height: 36 }).toBitmap();
        const channels = [[], [], []] as number[][];
        for (let index = 0; index < pixels.length; index += 4) {
          for (let channel = 0; channel < 3; channel += 1) channels[channel].push(pixels[index + channel]);
        }
        // Ignore sparse compositor/resizing edge noise on otherwise uniform frames.
        const centralRanges = channels.map(values => {
          values.sort((left, right) => left - right);
          return values[Math.floor(values.length * .95)] - values[Math.floor(values.length * .05)];
        });
        const output = join(input.workDir, `review-${Math.round(atMs)}ms.jpg`);
        await writeFile(output, image.toJPEG(90)); paths.push(output);
        const nonempty = input.native ? nativeFrameHasArtwork(image.resize({ width: 320, height: 180 }).toBitmap(), 320, 180) : centralRanges.some(range => range >= 8);
        if (nonempty) nonemptyFrames++;
        if (input.native) compositionSamples.push({ atMs, coverage: nativeFrameDetailCoverage(image.resize({ width: 320, height: 180 }).toBitmap(), 320, 180) });
        if (!input.native && !nonempty) {
          await writeFile(join(input.workDir, 'review.json'), JSON.stringify({ version: CREATIVE_REVIEW_REVISION, passed: false, atMs, reason: 'empty-artwork', paths }, null, 2), 'utf8');
          throw new Error(`CREATIVE_EMPTY_FRAME: ${Math.round(atMs)} 毫秒画面接近纯色，未发现可辨识内容；首尾帧需保留完整画面。`);
        }
        const unsupported = input.approvedText === undefined ? [] : creativeUnsupportedClaims(layout.text, input.approvedText);
        if (input.expectedBackground && layout.background && !creativeBackgroundMatches(layout.background, input.expectedBackground)) layout.issues.push(`背景未遵循所选风格：${layout.background}，预期 ${input.expectedBackground}`);
        if (layout.issues.length || unsupported.length) {
          await writeFile(join(input.workDir, 'review.json'), JSON.stringify({ version: CREATIVE_REVIEW_REVISION, passed: false, aestheticReview: false, factualReview: 'limited-patterns-only', layoutIssues: layout.issues, unsupported, paths }, null, 2), 'utf8');
          if (layout.issues.length) throw new Error(`CREATIVE_LAYOUT: ${layout.issues.join('；')}`);
          throw new Error(`CREATIVE_CONTENT: 未提供依据的标注：${unsupported.join('；')}`);
        }
      }
      if (input.native && nonemptyFrames === 0) throw new Error('CREATIVE_EMPTY_FRAME: 全部原生采样帧均接近纯色，未发现可辨识内容。');
      const compositionIssue = input.native ? nativeCompositionIssue(compositionSamples, input.durationMs) : undefined;
      if (compositionIssue) {
        await writeFile(join(input.workDir, 'review.json'), JSON.stringify({ version: CREATIVE_REVIEW_REVISION, passed: false, aestheticReview: false, compositionSamples, paths, reason: compositionIssue }, null, 2), 'utf8');
        throw new Error(compositionIssue);
      }
      await writeFile(join(input.workDir, 'review.json'), JSON.stringify({ version: CREATIVE_REVIEW_REVISION, compositionSamples, kind: 'browser-execution-layout-frames', passed: true, aestheticReview: false, factualReview: 'limited-patterns-only', paths }, null, 2), 'utf8');
      return paths;
    } finally { if (!window.isDestroyed()) window.destroy(); }
  }));
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
  inspectScene?: (window: BrowserWindow, scene: HtmlVideoExportInput['scenes'][number]) => Promise<void>,
  inspectionTimeoutMs = hiddenFrameTimeoutMs,
): Promise<HtmlVideoExportResult> {
  const signal = options.signal;
  const framesDirs: string[] = [];
  const capturedScenes: HtmlVideoCapturedScene[] = [];
  const coverDuration = input.coverPath ? input.coverDurationS ?? input.scenes[0]?.duration ?? 0 : 0;
  const videoFrameCounts = allocateHtmlVideoSceneFrameCounts(input.scenes.map((scene) => scene.duration), input.fps, coverDuration);
  const htmlSceneDir = join(input.workDir, 'html-scenes');
  let primaryError: { error: unknown } | undefined;
  await mkdir(htmlSceneDir, { recursive: true });
  const scratchDir = await mkdtemp(join(input.workDir, 'render-segments-'));
  try {
    await withHiddenCaptureLock(signal, async () => {
      for (const [sceneIndex, scene] of input.scenes.entries()) {
        throwIfAborted(signal);
        const videoFrameCount = videoFrameCounts[sceneIndex];
        const firstFrame = (coverDuration > 0 ? Math.max(1, Math.round(coverDuration * input.fps)) : 0)
          + videoFrameCounts.slice(0, sceneIndex).reduce((sum, count) => sum + count, 0);
        const sceneStartSeconds = coverDuration + input.scenes.slice(0, sceneIndex).reduce((sum, previous) => sum + previous.duration, 0);
        const sceneWorkDir = join(scratchDir, `scene-${capturedScenes.length}`);
        const sceneDir = join(sceneWorkDir, 'frames');
        await mkdir(sceneDir, { recursive: true });
        framesDirs.push(sceneDir);
        const htmlPath = join(htmlSceneDir, `scene-${String(scene.sceneId).padStart(3, '0')}.html`);
        await writeFile(htmlPath, scene.html, 'utf8');
        const segmentPath = join(scratchDir, `segment-${capturedScenes.length}.mp4`);
        const encodeInput = { mode: 'encode_render_scene' as const, work_dir: sceneWorkDir,
          scene: { frames_dir: sceneDir, audio_path: scene.audioPath,
            ...(scene.audioClips !== undefined ? { audio_clips: scene.audioClips } : {}),
            fps: input.fps, duration_s: scene.duration, video_frame_count: videoFrameCount }, output_path: segmentPath };
        let nextFrame = 0;
        const sceneDeadline = Date.now() + htmlVideoFrameCaptureTimeoutMs(videoFrameCount);
        await encodeHtmlFrames(encodeInput, writeFrame => withHtmlGraphicsRecovery(async () => {
          let window: BrowserWindow | null = null;
          try {
            window = await openHiddenHtmlWindow({
              workDir: input.workDir,
              htmlPath,
              canvas: { width: input.canvas_w, height: input.canvas_h },
              signal,
            });
            if (inspectScene) await withRendererTimeout(inspectScene(window, scene), Math.min(600_000, Math.max(hiddenFrameTimeoutMs, inspectionTimeoutMs)), 'HTML scene inspection', signal);
            const totalFrames = videoFrameCount;
            // Resume at the failed frame; previously written frames are not captured again.
            for (; nextFrame < totalFrames; nextFrame += 1) {
              const frameIndex = nextFrame;
              throwIfAborted(signal);
              const time = htmlVideoSceneFrameTime(frameIndex, input.fps, firstFrame, sceneStartSeconds);
              const frameNumber = frameIndex + 1;
              if (Date.now() >= sceneDeadline) throw new Error(`HTML scene ${scene.sceneId} capture timed out.`);
              await seekHiddenHtmlSceneFrame(window, time);
              const remainingSceneMs = Math.max(1, sceneDeadline - Date.now());
              const capturedImage = await withRendererTimeout(
                window.webContents.capturePage(),
                Math.min(hiddenFrameTimeoutMs, remainingSceneMs),
                `HTML scene ${scene.sceneId} frame ${frameNumber} capture`,
                signal,
              );
              const image = normalizeCapturedHtmlSceneImage(capturedImage, { width: input.canvas_w, height: input.canvas_h });
              await writeFrame(frameIndex, image.toJPEG(92));
            }
          } finally {
            if (window && !window.isDestroyed()) window.destroy();
          }
        }, signal), signal);
        throwIfAborted(signal);
        const segment = await stat(segmentPath);
        if (!segment.isFile() || segment.size === 0) throw new Error(`HTML scene ${scene.sceneId} encoding produced no video.`);
        // Release frames and mixed WAVs before capturing another scene.
        await cleanupHtmlVideoFrameDirectories([sceneWorkDir]);
        capturedScenes.push({
          sceneId: scene.sceneId,
          framesDir: sceneDir,
          segmentPath,
          audioPath: scene.audioPath,
          fps: input.fps,
          videoFrameCount,
        });
      }
    });
    throwIfAborted(signal);
    const payload: HtmlVideoComposePayload = createHtmlVideoComposePayload(input, capturedScenes);
    payload.work_dir = join(scratchDir, 'compose');
    payload.consume_owned_segments = true;
    const result = await runStoryboundMediaSidecar(payload, { signal });
    throwIfAborted(signal);
    const sourceVideoPath = join(input.workDir, '_source.mp4');
    await rename(join(payload.work_dir, '_source.mp4'), sourceVideoPath);
    return {
      outputPath: result.output_path ?? input.outputPath,
      sourceVideoPath,
      duration: input.totalDurationS,
      taskDir: input.workDir,
      framesDirs,
    };
  } catch (error) {
    primaryError = { error };
    throw error;
  } finally {
    await cleanupHtmlVideoFrameDirectories([scratchDir], primaryError);
  }
}

async function capturePreview(input: HtmlVideoPreviewCaptureInput): Promise<string> {
  throwIfAborted(input.signal);
  await mkdir(dirname(input.outputPath), { recursive: true });
  return withHiddenCaptureLock(input.signal, () => withHtmlGraphicsRecovery(async () => {
    let window: BrowserWindow | null = null;
    try {
      window = await openHiddenHtmlWindow(input);
      await seekHiddenHtmlSceneFrame(window, 0);
      const capturedImage = await withRendererTimeout(
        window.webContents.capturePage(),
        hiddenFrameTimeoutMs,
        'HTML preview capture',
        input.signal,
      );
      const image = normalizeCapturedHtmlSceneImage(capturedImage, input.canvas);
      await writeFile(input.outputPath, image.toJPEG(88));
      return input.outputPath;
    } finally {
      if (window && !window.isDestroyed()) window.destroy();
    }
  }, input.signal));
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
      window.webContents.executeJavaScript('(() => { window.__tl.play(); return true; })()'),
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
      offscreen: true,
      sandbox: true,
    },
  });
  windowSignals.set(window, input.signal);
  try {
    const htmlUrl = `${checkedLocalHtmlUrl(input.htmlPath, input.workDir)}?storydream-render=1`;
    attachLocalHtmlSecurity(window, input.workDir);
    await withRendererTimeout(window.loadURL(htmlUrl), hiddenWindowReadyTimeoutMs, 'HTML scene load', input.signal);
    await waitForHiddenHtmlSceneReady(window);
    return window;
  } catch (error) {
    let readiness: unknown;
    if (!input.signal?.aborted && !window.isDestroyed()) {
      try {
        readiness = await withRendererTimeout(window.webContents.executeJavaScript(
          'JSON.stringify({ready:window.__ready,mediaError:window.__mediaError,playerReady:!!window.__playerReady,renderReady:window.__renderReady,timeline:!!window.__tl,images:Array.from(document.images).map(i=>({complete:i.complete,width:i.naturalWidth})),videos:Array.from(document.querySelectorAll("video")).map(v=>({state:v.readyState,error:v.error?.code,time:v.currentTime,seeking:v.seeking}))})'),
        1500, 'HTML readiness diagnostics');
      } catch { /* Preserve the original failure when the renderer is unresponsive. */ }
    }
    if (!window.isDestroyed()) window.destroy();
    if (typeof readiness === 'string' && readiness) {
      // Renderer errors may belong to another JS realm. Keep their message
      // intact and retain local paths/diagnostics in the cause for debugging.
      const message = error !== null && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
        ? error.message : String(error);
      throw new Error(message, { cause: { error, htmlPath: input.htmlPath, readiness } });
    }
    throw error;
  }
}

function normalizeCapturedHtmlSceneImage(image: NativeImage, canvas: HtmlVideoCanvas): NativeImage {
  const size = image.getSize();
  if (size.width === canvas.width && size.height === canvas.height) return image;
  const widthScale = size.width / canvas.width;
  const heightScale = size.height / canvas.height;
  const proportionalDpiScale = widthScale >= 1.05
    && widthScale <= 4
    && heightScale >= 1.05
    && heightScale <= 4
    && Math.abs(widthScale - heightScale) <= 0.015;
  if (proportionalDpiScale) {
    const normalized = image.resize({ width: canvas.width, height: canvas.height, quality: 'best' });
    const normalizedSize = normalized.getSize();
    if (normalizedSize.width === canvas.width && normalizedSize.height === canvas.height) return normalized;
  }
  throw new AppError(
    'HTML_VIDEO_CAPTURE_SIZE_MISMATCH',
    `HTML 视频捕获画布尺寸异常：期望 ${canvas.width}x${canvas.height}，实际 ${size.width}x${size.height}。`,
    true,
  );
}

function checkedLocalHtmlUrl(htmlPath: string, workDir: string): string {
  const htmlUrl = pathToFileURL(htmlPath).toString();
  if (!isAllowedLocalHtmlNavigation(htmlUrl, workDir)) {
    throw new Error('HTML scene path must stay inside the task work directory.');
  }
  return htmlUrl;
}

async function waitForHiddenHtmlSceneReady(window: BrowserWindow): Promise<void> {
  await withRendererTimeout(window.webContents.executeJavaScript(createHtmlVideoSceneReadyScript()), hiddenWindowReadyTimeoutMs, 'HTML scene ready', windowSignals.get(window));
}

async function seekHiddenHtmlSceneFrame(window: BrowserWindow, time: number): Promise<void> {
  await withRendererTimeout(window.webContents.executeJavaScript(createHtmlVideoFrameSeekScript(time)), hiddenFrameTimeoutMs, 'HTML scene frame seek', windowSignals.get(window));
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
