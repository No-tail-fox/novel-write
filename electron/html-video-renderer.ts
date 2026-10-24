import { BrowserWindow, type NativeImage } from 'electron';
import { mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  HtmlVideoCapturedScene,
  HtmlVideoExportInput,
  HtmlVideoExportResult,
} from '../src/shared/html-video';
import { createHtmlVideoComposePayload, type HtmlVideoComposePayload } from '../src/shared/html-video';
import { AppError } from '../src/shared/app-error';
import { runStoryboundMediaSidecar } from '../src/shared/storybound-sidecar';
import type {
  HtmlVideoCanvas,
  HtmlVideoPreviewCaptureInput,
  HtmlVideoRuntimeRenderer,
} from './html-video-runtime';
import { attachLocalHtmlSecurity, isAllowedLocalHtmlNavigation } from './security';
import { CREATIVE_REVIEW_REVISION, creativeUnsupportedClaims, creativeMinimumFontSize, creativeBackgroundMatches } from '../src/shared/creative-animation/review';

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

export function createElectronHtmlVideoRenderer(options: {
  inspectScene?: (window: BrowserWindow, scene: HtmlVideoExportInput['scenes'][number]) => Promise<void>;
} = {}): ElectronHtmlVideoRenderer {
  return {
    render: (input, renderOptions) => renderHtmlVideo(input, renderOptions, options.inspectScene),
    capturePreview,
    openPreview,
  };
}

/** Same isolated capture host as final rendering. This checks execution/layout, not aesthetic quality. */
export async function reviewHtmlAnimationFrames(input: {
  workDir: string; htmlPath: string; canvas: HtmlVideoCanvas; durationMs: number;
  approvedText?: string;
  expectedBackground?: string;
}): Promise<string[]> {
  return withHiddenCaptureLock(undefined, async () => {
    const window = await openHiddenHtmlWindow(input);
    try {
      const paths: string[] = [];
      for (const fraction of [0.15, 0.5, 0.85]) {
        await seekHiddenHtmlSceneFrame(window, input.durationMs / 1000 * fraction);
        const layout = await withRendererTimeout(window.webContents.executeJavaScript(`(() => {
          const issues=[], texts=[], root=document.querySelector('#root');
          if(!root) return {issues:['未找到动画内容'],text:''};
          const minimumFontSize=${creativeMinimumFontSize(input.canvas.width, input.canvas.height)};
          const backgroundCandidates=Array.from(root.querySelectorAll('*')).flatMap(element=>{
            const r=element.getBoundingClientRect(),s=getComputedStyle(element);
            return r.left<=2&&r.top<=2&&r.right>=innerWidth-2&&r.bottom>=innerHeight*.8&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>=.95&&s.backgroundColor!=='rgba(0, 0, 0, 0)'?[s.backgroundColor]:[];
          });
          const caption=document.querySelector('.caption'), captionRect=caption?.getBoundingClientRect();
          const safeBottom=Math.min(innerHeight*.84,captionRect&&captionRect.height>0?captionRect.top:innerHeight);
          const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
          let node;
          while(node=walker.nextNode()) {
            const element=node.parentElement, text=node.textContent?.trim();
            if(!element||!text||element.closest('.caption,script,style,defs')) continue;
            let visible=true;
            for(let parent=element;parent;parent=parent.parentElement){const s=getComputedStyle(parent);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)<.1){visible=false;break;}}
            if(!visible) continue;
            const range=document.createRange();range.selectNodeContents(node);const r=range.getBoundingClientRect();
            if(r.width<1||r.height<1) continue;
            texts.push(text);
            const s=getComputedStyle(element),fontSize=parseFloat(s.fontSize),elementRect=element.getBoundingClientRect();
            const svgMatrix=typeof element.getScreenCTM==='function'?element.getScreenCTM():null;
            const renderedScale=element.offsetHeight?elementRect.height/element.offsetHeight:svgMatrix?Math.hypot(svgMatrix.c,svgMatrix.d):1;
            const renderedFontSize=fontSize*renderedScale;
            if(renderedFontSize<minimumFontSize-.5) issues.push('文字过小（'+Math.round(renderedFontSize)+'px，至少'+Math.ceil(minimumFontSize)+'px）：'+text.slice(0,50));
            if(element.scrollWidth>element.clientWidth+6 || element.scrollHeight>element.clientHeight+6) issues.push('文字容器溢出：'+text.slice(0,50));
            if(r.left< -2||r.top< -2||r.right>innerWidth+2||r.bottom>innerHeight+2) issues.push('文字超出画布：'+text.slice(0,50));
            if(r.bottom>safeBottom+2) issues.push('文字侵入字幕保留区：'+text.slice(0,50));
          }
          return {issues:issues.slice(0,8),text:texts.join(' '),background:backgroundCandidates.at(-1)};
        })()`), hiddenFrameTimeoutMs, 'Creative frame layout review');
        const captured = await withRendererTimeout(window.webContents.capturePage(), hiddenFrameTimeoutMs, 'Creative review capture');
        const image = normalizeCapturedHtmlSceneImage(captured, input.canvas);
        const pixels = image.resize({ width: 64, height: 36 }).toBitmap();
        let minimum = 255, maximum = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          const value = (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
          minimum = Math.min(minimum, value); maximum = Math.max(maximum, value);
        }
        if (maximum - minimum < 8) throw new Error('CREATIVE_EMPTY_FRAME: 抽帧接近纯色，未发现可辨识内容。');
        const output = join(input.workDir, `review-${Math.round(fraction * 100)}.jpg`);
        await writeFile(output, image.toJPEG(90)); paths.push(output);
        const unsupported = input.approvedText === undefined ? [] : creativeUnsupportedClaims(layout.text, input.approvedText);
        if (input.expectedBackground && layout.background && !creativeBackgroundMatches(layout.background, input.expectedBackground)) layout.issues.push(`背景未遵循所选风格：${layout.background}，预期 ${input.expectedBackground}`);
        if (layout.issues.length || unsupported.length) {
          await writeFile(join(input.workDir, 'review.json'), JSON.stringify({ version: CREATIVE_REVIEW_REVISION, passed: false, aestheticReview: false, factualReview: 'limited-patterns-only', layoutIssues: layout.issues, unsupported, paths }, null, 2), 'utf8');
          if (layout.issues.length) throw new Error(`CREATIVE_LAYOUT: ${layout.issues.join('；')}`);
          throw new Error(`CREATIVE_CONTENT: 未提供依据的标注：${unsupported.join('；')}`);
        }
      }
      await writeFile(join(input.workDir, 'review.json'), JSON.stringify({ version: CREATIVE_REVIEW_REVISION, kind: 'browser-execution-layout-frames', passed: true, aestheticReview: false, factualReview: 'limited-patterns-only', paths }, null, 2), 'utf8');
      return paths;
    } finally { if (!window.isDestroyed()) window.destroy(); }
  });
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
): Promise<HtmlVideoExportResult> {
  const signal = options.signal;
  const framesDirs: string[] = [];
  const capturedScenes: HtmlVideoCapturedScene[] = [];
  const htmlSceneDir = join(input.workDir, 'html-scenes');
  let primaryError: { error: unknown } | undefined;
  await mkdir(htmlSceneDir, { recursive: true });
  const scratchDir = await mkdtemp(join(input.workDir, 'render-segments-'));
  try {
    await withHiddenCaptureLock(signal, async () => {
      for (const scene of input.scenes) {
        throwIfAborted(signal);
        const sceneWorkDir = join(scratchDir, `scene-${capturedScenes.length}`);
        const sceneDir = join(sceneWorkDir, 'frames');
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
          if (inspectScene) await withRendererTimeout(inspectScene(window, scene), hiddenFrameTimeoutMs, 'HTML scene inspection', signal);
          const totalFrames = Math.max(1, Math.ceil(scene.duration * input.fps));
          const sceneDeadline = Date.now() + hiddenSceneTimeoutMs;
          for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
            throwIfAborted(signal);
            const time = frameIndex / input.fps;
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
            const framePath = join(sceneDir, sidecarFramePattern.replace('%04d', String(frameNumber).padStart(4, '0')));
            await writeFile(framePath, image.toJPEG(92));
          }
        } finally {
          if (window && !window.isDestroyed()) window.destroy();
        }
        throwIfAborted(signal);
        const segmentPath = join(scratchDir, `segment-${capturedScenes.length}.mp4`);
        await runStoryboundMediaSidecar({
          mode: 'encode_render_scene',
          work_dir: sceneWorkDir,
          scene: {
            frames_dir: sceneDir,
            audio_path: scene.audioPath,
            ...(scene.audioClips !== undefined ? { audio_clips: scene.audioClips } : {}),
            fps: input.fps,
            duration_s: scene.duration,
          },
          output_path: segmentPath,
        }, { signal });
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
        });
      }
    });
    throwIfAborted(signal);
    const payload: HtmlVideoComposePayload = createHtmlVideoComposePayload(input, capturedScenes);
    payload.work_dir = join(scratchDir, 'compose');
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
  return withHiddenCaptureLock(input.signal, async () => {
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
    if (!window.isDestroyed()) window.destroy();
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
  await withRendererTimeout(window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const mediaFailure = () => {
      const error = window.__mediaError || window.__htmlVideoMediaError;
      return typeof error === 'string' && error ? new Error(error) : null;
    };
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
      const videosReady = Promise.all(Array.from(document.querySelectorAll('video')).map((video) => {
        const videoError = () => new Error('HTML scene video failed to load. Verify the task video asset and retry.');
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
        if (video.error) return Promise.reject(videoError());
        return new Promise((videoResolve, videoReject) => {
          video.addEventListener('loadeddata', () => videoResolve(), { once: true });
          video.addEventListener('error', () => videoReject(videoError()), { once: true });
        });
      }));
      Promise.all([fontsReady, imagesReady, videosReady]).then(
        () => requestAnimationFrame(() => resolve(true)),
        reject,
      );
    };
    const initialFailure = mediaFailure();
    if (initialFailure) {
      reject(initialFailure);
      return;
    }
    if (isReady()) {
      finish();
      return;
    }
    const timer = setInterval(() => {
      const failure = mediaFailure();
      if (failure) {
        clearInterval(timer);
        reject(failure);
        return;
      }
      if (isReady()) {
        clearInterval(timer);
        finish();
      }
    }, 16);
  })`), hiddenWindowReadyTimeoutMs, 'HTML scene ready', windowSignals.get(window));
}

async function seekHiddenHtmlSceneFrame(window: BrowserWindow, time: number): Promise<void> {
  await withRendererTimeout(window.webContents.executeJavaScript(`(() => {
    const timeline = window.__tl;
    const result = timeline.seek(${JSON.stringify(time)}, false);
    // GSAP returns its thenable timeline; only media seeks need asynchronous completion.
    return Promise.resolve(result === timeline ? undefined : result).then(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
    }));
  })()`), hiddenFrameTimeoutMs, 'HTML scene frame seek', windowSignals.get(window));
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
