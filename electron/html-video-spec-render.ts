/**
 * O-3 / E-1：HTML 视频新架构出片（2026-11-10 用户决定“所有新建 HTML 视频默认走新架构”）。
 *
 * 由 html-video-runtime.ts 的 `renderVideoSpec` 在出片暂存目录里调用：场景 HTML 与动画运行时已经落盘，
 * 这里只负责 VideoSpec → 统一执行器 → 成片文件，发布 final.mp4 / 复检 / 可信摘要仍由 html-video-runtime 完成。
 *
 *  - 配音：执行器的 synthesizeVoice 原样回放配音步骤已经生成并实测时长的文件，不发任何 TTS 请求；
 *  - 场景：CaptureHost + hyperframes 适配器逐帧采集（页面契约与旧渲染相同：__ready / __player.renderSeek /
 *    __tl.seek），URL 带 `?storydream-render=1`，字幕本来就烧录在场景 DOM 里，随画面一起采集；
 *  - 采集校验与旧渲染保持一致：页面 console 报错、本机缺少的 local() 字体、页面声明时长与 spec 的差异都不中断
 *    出片（旧渲染器同样不检查），页面错误写进日志；
 *  - 请求白名单：只放行 data: / blob: 和任务目录内的 file:（旧渲染器只限制导航，这里更严）；
 *  - 失败一律抛 `VIDEO_SPEC_RENDER_*`，绝不在运行中途改走旧渲染，也不会重跑配音 / 生图。
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { AppError } from '../src/shared/app-error';
import {
  buildHtmlVideoSpecForRender,
  htmlVideoSpecFps,
  HTML_VIDEO_SPEC_VERSION,
} from '../src/shared/html-video-spec';
import type { HtmlVideoAsset, HtmlVideoJobConfig, HtmlVideoScenePlan, HtmlVideoVoiceClip } from '../src/shared/types';
import { videoSpecDurationMs, type VideoSpec } from '../src/shared/video-spec';
import type { VideoSpecExecutorFailure, VideoSpecExecutorResult } from '../src/shared/video-spec-executor';
import type { CaptureTimeouts, CaptureWindowFactory } from './capture-host';
import { runVideoSpecExecutorForProject } from './video-spec-executor-runtime';

export interface HtmlVideoSpecFilmRequest {
  /** 出片暂存目录（执行器的中间文件放在它下面的 video-spec/）。 */
  stageDir: string;
  /** 任务目录：采集窗口只允许读取这里面的文件。 */
  workDir: string;
  title: string;
  scenes: readonly HtmlVideoScenePlan[];
  voices: readonly HtmlVideoVoiceClip[];
  assets: readonly HtmlVideoAsset[];
  config: HtmlVideoJobConfig;
  scenePagePaths: ReadonlyMap<number, string>;
  canvas: { width: number; height: number };
  /** html-video-runtime 的运行时帧率（场景页面声明的协议帧率）。 */
  runtimeFps: number;
  outputPath: string;
  bgmPath?: string;
  coverPath?: string;
  signal?: AbortSignal;
}

export interface HtmlVideoSpecFilmResult {
  outputPath: string;
  spec: VideoSpec;
  durationMs: number;
  fps: number;
  width: number;
  height: number;
  loudnessNormalized: boolean;
}

export type HtmlVideoSpecFilmRenderer = (request: HtmlVideoSpecFilmRequest) => Promise<HtmlVideoSpecFilmResult>;

export interface HtmlVideoSpecFilmRendererOptions {
  /** 缺省：Electron 离屏窗口（capture-host-electron，按需加载），白名单限定在任务目录。 */
  createCaptureWindow?: CaptureWindowFactory;
  captureTimeouts?: Partial<CaptureTimeouts>;
  ffmpegPath?: string;
  pythonRoot?: string;
  log?: (line: string) => void;
}

/** 采集窗口的请求白名单：data: / blob:，以及任务目录内的 file:。 */
export function htmlVideoSpecCaptureRequestAllowed(url: string, taskRoot: string): boolean {
  if (/^(?:data|blob):/iu.test(url)) return true;
  let target: URL;
  try { target = new URL(url); } catch { return false; }
  if (target.protocol !== 'file:' || target.username || target.password) return false;
  try {
    const path = relative(resolve(taskRoot), resolve(fileURLToPath(target)));
    return path === '' || (!path.startsWith('..') && !isAbsolute(path));
  } catch {
    return false;
  }
}

const FAILURE_CODES: Record<string, string> = {
  voice: 'VIDEO_SPEC_RENDER_VOICE_FAILED',
  author: 'VIDEO_SPEC_RENDER_SCENE_FAILED',
  render: 'VIDEO_SPEC_RENDER_SCENE_FAILED',
  audio: 'VIDEO_SPEC_RENDER_AUDIO_FAILED',
  mux: 'VIDEO_SPEC_RENDER_MUX_FAILED',
  gate: 'VIDEO_SPEC_RENDER_GATE_FAILED',
};

/** 执行器 blocked 结果 → 普通任务错误（可重试；不会自动改走旧渲染）。 */
export function htmlVideoSpecRenderError(result: Pick<VideoSpecExecutorResult, 'failures'>): AppError {
  const failure: VideoSpecExecutorFailure | undefined = result.failures.find(item => item.action !== 'cancelled') ?? result.failures[0];
  const code = failure ? FAILURE_CODES[failure.kind] ?? 'VIDEO_SPEC_RENDER_FAILED' : 'VIDEO_SPEC_RENDER_FAILED';
  const where = failure?.sceneId ? `场景 ${failure.sceneId}：` : '';
  const detail = failure ? `${where}${failure.message}（${failure.code}）` : '执行器没有产出成片。';
  return new AppError(code, `新版渲染引擎出片失败（${code}）：${detail}`.slice(0, 2000), true);
}

function abortError(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

export function createHtmlVideoSpecFilmRenderer(options: HtmlVideoSpecFilmRendererOptions = {}): HtmlVideoSpecFilmRenderer {
  return async (request) => {
    if (request.signal?.aborted) throw abortError(request.signal);
    const fps = htmlVideoSpecFps(request.runtimeFps);
    const build = buildHtmlVideoSpecForRender({
      title: request.title,
      scenes: request.scenes,
      voices: request.voices,
      assets: request.assets,
      config: request.config,
      canvas: request.canvas,
      fps,
      scenePagePaths: request.scenePagePaths,
      outputPath: request.outputPath,
      ...(request.bgmPath ? { bgmPath: request.bgmPath } : {}),
      ...(request.coverPath ? { coverPath: request.coverPath } : {}),
    });
    const taskRoot = request.workDir;
    let factory: Promise<CaptureWindowFactory> | undefined;
    const createCaptureWindow: CaptureWindowFactory = options.createCaptureWindow ?? (async (windowRequest) => {
      factory ??= import('./capture-host-electron').then(module => module.createElectronCaptureWindowFactory({
        allowRequest: (url) => htmlVideoSpecCaptureRequestAllowed(url, taskRoot),
      }));
      return (await factory)(windowRequest);
    });
    let result: VideoSpecExecutorResult;
    try {
      result = await runVideoSpecExecutorForProject({ videoSpecVersion: HTML_VIDEO_SPEC_VERSION }, build.spec, {
        workDir: join(request.stageDir, 'video-spec'),
        // 只回放配音步骤已有的文件和实测时长；找不到就是数据损坏，按失败处理（绝不重新配音）。
        synthesizeVoice: async (voiceRequest) => {
          const timing = build.timings.get(voiceRequest.sceneId);
          if (!timing) throw new AppError('VIDEO_SPEC_RENDER_VOICE_MISSING', `场景 ${voiceRequest.sceneId} 没有已生成的配音。`);
          return { ref: timing.ref, durationMs: timing.durationMs, ...(timing.cues ? { cues: [...timing.cues] } : {}) };
        },
        resolveScenePageUrl: ({ scene }) => {
          const ref = scene.adapter.kind === 'hyperframes' ? scene.adapter.compositionRef : undefined;
          if (!ref) throw new AppError('VIDEO_SPEC_RENDER_SCENE_PAGE_MISSING', `场景 ${scene.id} 没有可采集的 HTML 页面。`);
          return `${pathToFileURL(ref).href}?storydream-render=1`;
        },
        createCaptureWindow,
        captureRequest: { failOnPageErrors: false, requireFonts: false, durationToleranceFrames: null },
        ...(options.captureTimeouts ? { captureTimeouts: options.captureTimeouts } : {}),
        transitions: 'xfade',
        // 复检在发布 final.mp4 之后由 html-video-runtime 统一做（quality-gate.json 与旧路径同位置）。
        gate: false,
        ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}),
        ...(options.pythonRoot ? { pythonRoot: options.pythonRoot } : {}),
        ...(options.log ? { log: options.log } : {}),
      }, {
        ...(request.signal ? { signal: request.signal } : {}),
        timing: build.timing,
        // 采集窗口很重，与旧渲染一样一次只采一个场景。
        sceneConcurrency: 1,
        voiceConcurrency: 4,
      });
    } catch (error) {
      if (request.signal?.aborted) throw abortError(request.signal);
      if (error instanceof AppError && error.code.startsWith('VIDEO_SPEC_RENDER_')) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new AppError('VIDEO_SPEC_RENDER_FAILED', `新版渲染引擎出片失败（VIDEO_SPEC_RENDER_FAILED）：${message}`.slice(0, 2000), true);
    }
    if (result.status === 'cancelled' || request.signal?.aborted) throw abortError(request.signal);
    if (result.status !== 'completed' || !result.filmRef || !result.spec) throw htmlVideoSpecRenderError(result);
    if (resolve(result.filmRef) !== resolve(request.outputPath)) {
      throw new AppError('VIDEO_SPEC_RENDER_OUTPUT_INVALID', '新版渲染引擎的成片路径与预期不一致。', true);
    }
    return {
      outputPath: result.filmRef,
      spec: result.spec,
      durationMs: videoSpecDurationMs(result.spec),
      fps: result.spec.canvas.fps,
      width: result.spec.canvas.width,
      height: result.spec.canvas.height,
      loudnessNormalized: result.spec.loudness.normalize,
    };
  };
}
