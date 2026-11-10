/**
 * CaptureHost —— 唯一的逐帧采集实现（backlog E-2，底座 §8.1）。只用于 VideoSpec 新项目（ADR-03），
 * **没有接入任何现有路线**：旧的 renderHtmlVideo / reviewHtmlAnimationFrames / Lemo 采集循环保持原样。
 *
 * 流程：建窗口 → loadURL → 注入 SceneRuntime 启动脚本 → `__sd.ready()`（超时）→ 读 `__sd.describe()` 并校验协议、
 * 字体 → 对每一帧 `__sd.seekFrame(n)` 并核对回传帧号 → capturePage → 校验尺寸（DPR=1，不悄悄缩放）→
 * 按选项转成原始 BGRA 或 JPEG（ADR-16 未定，两者都支持）→ 交给 sink（回调 / ffmpeg stdin，带背压）。
 *
 * 每个窗口操作都有超时，并和 AbortSignal、渲染进程崩溃赛跑（Electron 在渲染进程销毁后可能让 executeJavaScript 永远挂起）。
 * 所有失败都是 `CaptureHostError`（AppError），错误码以 `CAPTURE_HOST_` 开头，并带上已收集的页面错误。
 *
 * 窗口由可注入的工厂创建，本文件不 import 'electron'；Electron 实现在 `./capture-host-electron.ts`。
 */
import { AppError } from '../src/shared/app-error';
import {
  buildSceneRuntimeBootstrap,
  sceneCapturePlan,
  sceneCaptureStrategy,
  sceneRuntimeScripts,
  validateSceneRuntimeDescriptor,
  type SceneRuntimeAdapter,
  type SceneRuntimeDescriptor,
  type SceneRuntimeError,
} from '../src/shared/scene-runtime';
import type { VideoSpec } from '../src/shared/video-spec';

export { sceneCaptureStrategy };

// ───────────────────────────── 窗口抽象 ─────────────────────────────

export interface CaptureImage {
  getSize(): { width: number; height: number };
  /** 原始像素（Electron 为 BGRA，每像素 4 字节）。 */
  toBitmap(): Uint8Array;
  toJPEG(quality: number): Uint8Array;
}

export interface CaptureWindow {
  loadURL(url: string): Promise<unknown>;
  executeJavaScript(code: string): Promise<unknown>;
  capturePage(): Promise<CaptureImage>;
  /** 页面 console.error / 被拦截的外部请求等。 */
  onPageError(listener: (message: string) => void): void;
  /** 渲染进程崩溃 / 被杀。 */
  onCrash(listener: (reason: string) => void): void;
  destroy(): void;
  isDestroyed(): boolean;
}

export interface CaptureWindowRequest {
  width: number;
  height: number;
  pageUrl: string;
}

export type CaptureWindowFactory = (request: CaptureWindowRequest) => CaptureWindow | Promise<CaptureWindow>;

// ───────────────────────────── 帧与 sink ─────────────────────────────

export type CaptureFrameFormat = 'bgra' | 'jpeg';

export interface CapturedFrame {
  /** 本次采集里的序号（0 起，连续）。 */
  index: number;
  /** 场景内帧号（传给 `__sd.seekFrame` 的 n）。 */
  frame: number;
  /** 整条时间线上的帧号 = timelineOffset + frame。 */
  timelineFrame: number;
  format: CaptureFrameFormat;
  width: number;
  height: number;
  data: Uint8Array;
}

/** sink 返回的 Promise 构成背压：上一帧没处理完不会采下一帧。 */
export type CaptureFrameSink = (frame: CapturedFrame) => void | Promise<void>;

/** 最小的可写流接口（node:stream Writable / ChildProcess.stdin 都满足）。 */
export interface FrameWritable {
  write(chunk: Uint8Array): boolean;
  once(event: 'drain' | 'error' | 'close', listener: (...args: unknown[]) => void): unknown;
  removeListener(event: 'drain' | 'error' | 'close', listener: (...args: unknown[]) => void): unknown;
  readonly destroyed?: boolean;
}

/** 把帧顺序写进可写流（例如 ffmpeg stdin），尊重背压：write 返回 false 时等 drain；流出错或关闭则失败。 */
export function createWritableFrameSink(stream: FrameWritable): CaptureFrameSink {
  return frame => {
    if (stream.destroyed) throw new CaptureHostError('CAPTURE_HOST_SINK_FAILED', '帧输出流已关闭。', { frame: frame.frame });
    if (stream.write(frame.data)) return;
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        stream.removeListener('drain', onDrain);
        stream.removeListener('error', onError);
        stream.removeListener('close', onClose);
      };
      const onDrain = () => { cleanup(); resolve(); };
      const onError = (error: unknown) => { cleanup(); reject(error instanceof Error ? error : new Error(String(error))); };
      const onClose = () => { cleanup(); reject(new Error('帧输出流在背压等待中被关闭。')); };
      stream.once('drain', onDrain);
      stream.once('error', onError);
      stream.once('close', onClose);
    });
  };
}

/** ffmpeg 读取 CaptureHost 帧流的输入参数（`-i -` 之前的部分加 `-i -`）。 */
export function ffmpegFrameInputArgs(options: { format: CaptureFrameFormat; width: number; height: number; fps: number }): string[] {
  const { format, width, height, fps } = options;
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0)) throw new RangeError('ffmpeg 输入尺寸必须是正整数');
  if (!Number.isFinite(fps) || fps <= 0) throw new RangeError('ffmpeg 输入 fps 必须是正数');
  return format === 'bgra'
    ? ['-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${width}x${height}`, '-framerate', String(fps), '-i', '-']
    : ['-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', '-'];
}

// ───────────────────────────── 错误 ─────────────────────────────

export const CAPTURE_HOST_ERROR_CODES = [
  'CAPTURE_HOST_OPTIONS_INVALID',
  'CAPTURE_HOST_ABORTED',
  'CAPTURE_HOST_WINDOW_FAILED',
  'CAPTURE_HOST_LOAD_TIMEOUT',
  'CAPTURE_HOST_LOAD_FAILED',
  'CAPTURE_HOST_INJECT_FAILED',
  'CAPTURE_HOST_READY_TIMEOUT',
  'CAPTURE_HOST_READY_FAILED',
  'CAPTURE_HOST_PROTOCOL_INVALID',
  'CAPTURE_HOST_DURATION_MISMATCH',
  'CAPTURE_HOST_FONTS_FAILED',
  'CAPTURE_HOST_PAGE_ERROR',
  'CAPTURE_HOST_FRAME_RANGE',
  'CAPTURE_HOST_SEEK_TIMEOUT',
  'CAPTURE_HOST_SEEK_FAILED',
  'CAPTURE_HOST_FRAME_MISMATCH',
  'CAPTURE_HOST_CAPTURE_TIMEOUT',
  'CAPTURE_HOST_CAPTURE_FAILED',
  'CAPTURE_HOST_SIZE_MISMATCH',
  'CAPTURE_HOST_SINK_TIMEOUT',
  'CAPTURE_HOST_SINK_FAILED',
  'CAPTURE_HOST_RENDERER_GONE',
  'CAPTURE_HOST_SCENE_NOT_FOUND',
  'CAPTURE_HOST_NOT_CAPTURABLE',
] as const;
export type CaptureHostErrorCode = (typeof CAPTURE_HOST_ERROR_CODES)[number];

const RETRYABLE: ReadonlySet<CaptureHostErrorCode> = new Set([
  'CAPTURE_HOST_WINDOW_FAILED', 'CAPTURE_HOST_LOAD_TIMEOUT', 'CAPTURE_HOST_READY_TIMEOUT', 'CAPTURE_HOST_SEEK_TIMEOUT',
  'CAPTURE_HOST_CAPTURE_TIMEOUT', 'CAPTURE_HOST_CAPTURE_FAILED', 'CAPTURE_HOST_RENDERER_GONE',
]);

export class CaptureHostError extends AppError {
  readonly pageErrors: string[];
  readonly frame?: number;
  constructor(code: CaptureHostErrorCode, message: string, details: { pageErrors?: string[]; frame?: number; cause?: unknown } = {}) {
    super(code, message, RETRYABLE.has(code));
    this.pageErrors = details.pageErrors ?? [];
    if (details.frame !== undefined) this.frame = details.frame;
    if (details.cause !== undefined) Object.defineProperty(this, 'cause', { value: details.cause, enumerable: false });
  }
}

// ───────────────────────────── 请求与结果 ─────────────────────────────

export interface CaptureTimeouts {
  windowMs: number;
  loadMs: number;
  injectMs: number;
  readyMs: number;
  seekMs: number;
  captureMs: number;
  sinkMs: number;
}

export const DEFAULT_CAPTURE_TIMEOUTS: Readonly<CaptureTimeouts> = Object.freeze({
  windowMs: 15_000,
  loadMs: 30_000,
  injectMs: 5_000,
  readyMs: 60_000,
  seekMs: 15_000,
  captureMs: 15_000,
  sinkMs: 60_000,
});

export interface CaptureSceneRequest {
  url: string;
  adapter: SceneRuntimeAdapter;
  width: number;
  height: number;
  fps: number;
  /** 权威总帧数（VideoSpec）；缺省时由页面声明的时长换算。 */
  durationFrames?: number;
  /** 要采的场景内帧号（升序/任意顺序都按给定顺序采）；缺省为 [0, durationFrames)。 */
  frames?: readonly number[];
  format: CaptureFrameFormat;
  /** JPEG 质量，默认 95（ADR-16 候选）。 */
  jpegQuality?: number;
  sink: CaptureFrameSink;
  signal?: AbortSignal;
  timeouts?: Partial<CaptureTimeouts>;
  /** 页面出现错误（console.error、onerror、unhandledrejection、场景回调异常）即失败；默认 true。 */
  failOnPageErrors?: boolean;
  /** 字体失败或未就绪即失败；默认 true。 */
  requireFonts?: boolean;
  /** 页面声明时长与 durationFrames 的允许差（帧）；默认 1，null 表示不核对。 */
  durationToleranceFrames?: number | null;
  /** PRNG 种子来源。 */
  sceneId?: string;
  /** 整条时间线上的起始帧（只影响 CapturedFrame.timelineFrame）。 */
  timelineOffset?: number;
  onProgress?: (progress: { captured: number; total: number; frame: number }) => void;
}

export interface CaptureSceneResult {
  framesCaptured: number;
  durationFrames: number;
  descriptor: SceneRuntimeDescriptor;
  /** 宿主收集到的页面错误（failOnPageErrors=false 时可能非空）。 */
  pageErrors: string[];
  elapsedMs: number;
}

// ───────────────────────────── CaptureHost ─────────────────────────────

export interface CaptureHostOptions {
  createWindow: CaptureWindowFactory;
  now?: () => number;
}

function invalid(message: string): CaptureHostError {
  return new CaptureHostError('CAPTURE_HOST_OPTIONS_INVALID', message);
}

function validateRequest(request: CaptureSceneRequest): CaptureTimeouts {
  if (typeof request.url !== 'string' || !request.url) throw invalid('缺少页面 URL。');
  if (![request.width, request.height].every(value => Number.isSafeInteger(value) && value >= 16 && value <= 8192)) throw invalid(`画布尺寸无效：${String(request.width)}x${String(request.height)}`);
  if (!Number.isFinite(request.fps) || request.fps <= 0 || request.fps > 240) throw invalid(`fps 无效：${String(request.fps)}`);
  if (request.durationFrames !== undefined && (!Number.isSafeInteger(request.durationFrames) || request.durationFrames < 1)) throw invalid('durationFrames 必须是正整数。');
  if (request.format !== 'bgra' && request.format !== 'jpeg') throw invalid(`帧格式只支持 bgra / jpeg（收到 ${String(request.format)}）`);
  const quality = request.jpegQuality ?? 95;
  if (!Number.isSafeInteger(quality) || quality < 1 || quality > 100) throw invalid('jpegQuality 必须是 1–100 的整数。');
  if (typeof request.sink !== 'function') throw invalid('缺少帧 sink。');
  if (request.frames && request.frames.some(frame => !Number.isSafeInteger(frame) || frame < 0)) throw invalid('frames 必须全是非负整数。');
  if (request.frames && request.frames.length === 0) throw invalid('frames 不能为空。');
  if (request.timelineOffset !== undefined && (!Number.isSafeInteger(request.timelineOffset) || request.timelineOffset < 0)) throw invalid('timelineOffset 必须是非负整数。');
  const tolerance = request.durationToleranceFrames;
  if (tolerance !== undefined && tolerance !== null && (!Number.isSafeInteger(tolerance) || tolerance < 0)) throw invalid('durationToleranceFrames 必须是非负整数或 null。');
  const timeouts = { ...DEFAULT_CAPTURE_TIMEOUTS, ...request.timeouts };
  for (const [key, value] of Object.entries(timeouts)) {
    if (!Number.isFinite(value) || value <= 0) throw invalid(`超时 ${key} 必须是正数毫秒。`);
  }
  return timeouts;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class CaptureHost {
  private readonly createWindow: CaptureWindowFactory;
  private readonly now: () => number;

  constructor(options: CaptureHostOptions) {
    if (typeof options?.createWindow !== 'function') throw invalid('CaptureHost 需要窗口工厂 createWindow。');
    this.createWindow = options.createWindow;
    this.now = options.now ?? (() => Date.now());
  }

  async captureScene(request: CaptureSceneRequest): Promise<CaptureSceneResult> {
    const timeouts = validateRequest(request);
    const started = this.now();
    const pageErrors: string[] = [];
    const addPageError = (message: string) => { if (pageErrors.length < 200) pageErrors.push(message.slice(0, 1500)); };
    const fail = (code: CaptureHostErrorCode, message: string, extra: { frame?: number; cause?: unknown } = {}) =>
      new CaptureHostError(code, message, { pageErrors: [...pageErrors], ...extra });

    // 统一的“停止”信号：外部取消 / 渲染进程崩溃。所有窗口操作都和它赛跑。
    let stopError: CaptureHostError | undefined;
    let stopReject: ((error: CaptureHostError) => void) | undefined;
    const stopped = new Promise<never>((_resolve, reject) => { stopReject = reject; });
    void stopped.catch(() => {});
    const stop = (error: CaptureHostError) => {
      if (stopError) return;
      stopError = error;
      stopReject?.(error);
    };
    const onAbort = () => stop(fail('CAPTURE_HOST_ABORTED', '采集已取消。', { cause: request.signal?.reason }));
    if (request.signal?.aborted) throw fail('CAPTURE_HOST_ABORTED', '采集已取消。', { cause: request.signal.reason });
    request.signal?.addEventListener('abort', onAbort, { once: true });

    const guard = async <T>(
      operation: () => Promise<T> | T,
      ms: number,
      timeoutCode: CaptureHostErrorCode,
      failureCode: CaptureHostErrorCode,
      label: string,
      frame?: number,
    ): Promise<T> => {
      if (stopError) throw stopError;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(fail(timeoutCode, `${label}超时（${ms} ms）。`, { frame })), ms);
      });
      try {
        return await Promise.race([Promise.resolve().then(operation), timeout, stopped]);
      } catch (error) {
        if (error instanceof CaptureHostError) throw error;
        throw fail(failureCode, `${label}失败：${messageOf(error)}`, { frame, cause: error });
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    let window: CaptureWindow | undefined;
    try {
      window = await guard(() => this.createWindow({ width: request.width, height: request.height, pageUrl: request.url }),
        timeouts.windowMs, 'CAPTURE_HOST_WINDOW_FAILED', 'CAPTURE_HOST_WINDOW_FAILED', '创建采集窗口');
      const active = window;
      active.onPageError(addPageError);
      active.onCrash(reason => stop(fail('CAPTURE_HOST_RENDERER_GONE', `采集页面的渲染进程退出：${reason}`)));
      if (stopError) throw stopError;

      await guard(() => active.loadURL(request.url), timeouts.loadMs, 'CAPTURE_HOST_LOAD_TIMEOUT', 'CAPTURE_HOST_LOAD_FAILED', '加载场景页面');
      const bootstrap = buildSceneRuntimeBootstrap(request.adapter, {
        fps: request.fps,
        width: request.width,
        height: request.height,
        ...(request.durationFrames !== undefined ? { durationFrames: request.durationFrames } : {}),
        ...(request.sceneId !== undefined ? { sceneId: request.sceneId } : {}),
      });
      await guard(() => active.executeJavaScript(bootstrap), timeouts.injectMs, 'CAPTURE_HOST_INJECT_FAILED', 'CAPTURE_HOST_INJECT_FAILED', '注入 SceneRuntime');

      try {
        await guard(() => active.executeJavaScript(sceneRuntimeScripts.ready), timeouts.readyMs, 'CAPTURE_HOST_READY_TIMEOUT', 'CAPTURE_HOST_READY_FAILED', '等待场景就绪');
      } catch (error) {
        if (error instanceof CaptureHostError && error.code === 'CAPTURE_HOST_READY_FAILED' && /SCENE_RUNTIME_FONT_FAILED/u.test(error.message)) {
          throw fail('CAPTURE_HOST_FONTS_FAILED', error.message.replace(/^等待场景就绪失败：/u, '字体加载失败：'), { cause: error });
        }
        throw error;
      }

      const rawDescriptor = await guard(() => active.executeJavaScript(sceneRuntimeScripts.describe), timeouts.injectMs, 'CAPTURE_HOST_PROTOCOL_INVALID', 'CAPTURE_HOST_PROTOCOL_INVALID', '读取 SceneRuntime 状态');
      const validation = validateSceneRuntimeDescriptor(rawDescriptor, {
        adapter: request.adapter,
        fps: request.fps,
        width: request.width,
        height: request.height,
        ...(request.durationFrames !== undefined ? { durationFrames: request.durationFrames } : {}),
      });
      if (!validation.ok) throw fail('CAPTURE_HOST_PROTOCOL_INVALID', `SceneRuntime 协议不符：${validation.issues.join('；')}`);
      const descriptor = validation.descriptor;
      const durationFrames = descriptor.durationFrames;

      const tolerance = request.durationToleranceFrames === undefined ? 1 : request.durationToleranceFrames;
      if (tolerance !== null && request.durationFrames !== undefined && descriptor.pageDurationSeconds !== null) {
        const pageFrames = Math.round(descriptor.pageDurationSeconds * request.fps);
        if (Math.abs(pageFrames - request.durationFrames) > tolerance) {
          throw fail('CAPTURE_HOST_DURATION_MISMATCH', `页面声明 ${descriptor.pageDurationSeconds} 秒（${pageFrames} 帧），VideoSpec 是 ${request.durationFrames} 帧，超过容差 ${tolerance} 帧。`);
        }
      }
      if (request.requireFonts !== false) {
        if (descriptor.fonts.failed.length) throw fail('CAPTURE_HOST_FONTS_FAILED', `字体加载失败：${descriptor.fonts.failed.join(', ')}`);
        if (!descriptor.fonts.ready) throw fail('CAPTURE_HOST_FONTS_FAILED', '页面字体在就绪后仍未加载完成。');
      }

      let knownErrors = 0;
      const syncPageErrors = async (count: number, frame?: number) => {
        if (count <= knownErrors) return;
        const fresh = await guard(() => active.executeJavaScript(sceneRuntimeScripts.errors(knownErrors)), timeouts.injectMs,
          'CAPTURE_HOST_PROTOCOL_INVALID', 'CAPTURE_HOST_PROTOCOL_INVALID', '读取页面错误', frame) as SceneRuntimeError[];
        knownErrors = count;
        for (const item of Array.isArray(fresh) ? fresh : []) addPageError(`[${item.source}${item.frame === null ? '' : `@${item.frame}`}] ${item.message}`);
      };
      const checkPageErrors = (frame?: number) => {
        if (request.failOnPageErrors !== false && pageErrors.length) {
          throw fail('CAPTURE_HOST_PAGE_ERROR', `场景页面报错：${pageErrors.slice(0, 3).join(' | ')}`, { frame });
        }
      };
      await syncPageErrors(descriptor.errorCount);
      checkPageErrors();

      const frames = request.frames ? [...request.frames] : Array.from({ length: durationFrames }, (_, index) => index);
      const outside = frames.find(frame => frame >= durationFrames);
      if (outside !== undefined) throw fail('CAPTURE_HOST_FRAME_RANGE', `帧号 ${outside} 超出场景范围 [0, ${durationFrames})。`, { frame: outside });

      const quality = request.jpegQuality ?? 95;
      const offset = request.timelineOffset ?? 0;
      for (let index = 0; index < frames.length; index += 1) {
        const frame = frames[index];
        if (stopError) throw stopError;
        const seek = await guard(() => active.executeJavaScript(sceneRuntimeScripts.seek(frame)), timeouts.seekMs,
          'CAPTURE_HOST_SEEK_TIMEOUT', 'CAPTURE_HOST_SEEK_FAILED', `跳到第 ${frame} 帧`, frame) as { frame?: unknown; errorCount?: unknown } | null;
        if (!seek || seek.frame !== frame) throw fail('CAPTURE_HOST_FRAME_MISMATCH', `请求第 ${frame} 帧，页面回传 ${String(seek?.frame)}。`, { frame });
        if (typeof seek.errorCount === 'number') await syncPageErrors(seek.errorCount, frame);
        checkPageErrors(frame);
        const image = await guard(() => active.capturePage(), timeouts.captureMs, 'CAPTURE_HOST_CAPTURE_TIMEOUT', 'CAPTURE_HOST_CAPTURE_FAILED', `截取第 ${frame} 帧`, frame);
        const size = image.getSize();
        if (size.width !== request.width || size.height !== request.height) {
          throw fail('CAPTURE_HOST_SIZE_MISMATCH', `第 ${frame} 帧尺寸 ${size.width}x${size.height} ≠ 画布 ${request.width}x${request.height}（要求 DPR=1，不做缩放）。`, { frame });
        }
        const data = request.format === 'bgra' ? image.toBitmap() : image.toJPEG(quality);
        if (request.format === 'bgra' && data.length !== request.width * request.height * 4) {
          throw fail('CAPTURE_HOST_SIZE_MISMATCH', `第 ${frame} 帧位图 ${data.length} 字节，应为 ${request.width * request.height * 4}。`, { frame });
        }
        if (!data.length) throw fail('CAPTURE_HOST_CAPTURE_FAILED', `第 ${frame} 帧编码结果为空。`, { frame });
        await guard(() => request.sink({ index, frame, timelineFrame: offset + frame, format: request.format, width: request.width, height: request.height, data }),
          timeouts.sinkMs, 'CAPTURE_HOST_SINK_TIMEOUT', 'CAPTURE_HOST_SINK_FAILED', `输出第 ${frame} 帧`, frame);
        request.onProgress?.({ captured: index + 1, total: frames.length, frame });
      }
      if (stopError) throw stopError;
      return { framesCaptured: frames.length, durationFrames, descriptor, pageErrors: [...pageErrors], elapsedMs: this.now() - started };
    } finally {
      request.signal?.removeEventListener('abort', onAbort);
      if (window && !window.isDestroyed()) {
        try { window.destroy(); } catch { /* 窗口已经不可用；不掩盖原始错误。 */ }
      }
    }
  }
}

// ───────────────────────────── VideoSpec 场景 ─────────────────────────────

export interface CaptureVideoSpecSceneOptions extends Omit<CaptureSceneRequest, 'adapter' | 'width' | 'height' | 'fps' | 'durationFrames' | 'sceneId' | 'timelineOffset'> {
  host: CaptureHost;
}

/**
 * 按 VideoSpec 采一个场景：画布、fps、总帧数都取自 spec（整数帧，不从秒换算）；适配器由 `sceneCapturePlan` 决定。
 * video / still 场景由 ffmpeg 合成，这里直接抛 `CAPTURE_HOST_NOT_CAPTURABLE` 并说明原因。
 */
export function captureVideoSpecScene(spec: VideoSpec, sceneId: string, options: CaptureVideoSpecSceneOptions): Promise<CaptureSceneResult> {
  const scene = spec.scenes.find(item => item.id === sceneId);
  if (!scene) return Promise.reject(new CaptureHostError('CAPTURE_HOST_SCENE_NOT_FOUND', `VideoSpec 里没有场景 "${sceneId}"。`));
  const plan = sceneCapturePlan(scene.adapter.kind);
  if (!plan.capturable) return Promise.reject(new CaptureHostError('CAPTURE_HOST_NOT_CAPTURABLE', `场景 "${sceneId}"（${scene.adapter.kind}）不经过浏览器采集：${plan.reason}`));
  const { host, ...request } = options;
  return host.captureScene({
    ...request,
    adapter: plan.runtime,
    width: spec.canvas.width,
    height: spec.canvas.height,
    fps: spec.canvas.fps,
    durationFrames: scene.durationFrames,
    sceneId: scene.id,
    timelineOffset: scene.startFrame,
  });
}
