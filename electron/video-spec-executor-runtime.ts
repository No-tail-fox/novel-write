/**
 * 统一执行器的主进程运行时（backlog O-3）：把 `src/shared/video-spec-executor.ts` 的依赖接到真实实现上——
 *   - 场景：可采集的适配器（hyperframes / lemo / template）走 CaptureHost（Electron 离屏窗口）逐帧采集，
 *     帧直接写进 ffmpeg stdin 编成无损中间片段；still / video 场景由 ffmpeg 直接生成定长片段；
 *   - 音频：`renderAudioTimeline` 整条时间线一次渲染；
 *   - 封装：场景片段 concat + 音频 → H.264 / AAC 成片，统一 bt709 / tv 色彩标签（与 Storybound sidecar 相同）；
 *   - 复检：`runFinalFilmGateSafely`（只做提示，从不抛错）。
 * TTS / LLM 创作由调用方注入，这里不接任何服务商。
 *
 * 只用于 VideoSpec 新项目（ADR-03，`videoSpecExecutorStrategy`）；**没有接入任何现有 IPC / 路线**，旧项目继续走
 * vox-production-runtime 与 html-video-runner。
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AppError } from '../src/shared/app-error';
import { summarizeFinalFilmGate, type FinalFilmGateRoute } from '../src/shared/final-film-gate';
import { runBoundedProcess } from '../src/shared/process-runner';
import { sceneCapturePlan } from '../src/shared/scene-runtime';
import { projectUsesVideoSpec, videoSpecDurationMs, type VideoSpec, type VideoSpecScene } from '../src/shared/video-spec';
import {
  parseVideoSpecExecutorCheckpoint,
  runVideoSpecExecutor,
  videoSpecExecutorHash,
  type SceneAuthorResult,
  type VideoSpecExecutorCheckpoint,
  type VideoSpecExecutorDeps,
  type VideoSpecExecutorOptions,
  type VideoSpecExecutorResult,
} from '../src/shared/video-spec-executor';
import { renderAudioTimeline } from './audio-timeline-renderer';
import {
  CaptureHost,
  captureVideoSpecScene,
  createWritableFrameSink,
  ffmpegFrameInputArgs,
  type CaptureFrameFormat,
  type CaptureTimeouts,
  type CaptureWindowFactory,
} from './capture-host';
import { resolveFinalFilmFfmpeg, runFinalFilmGateSafely } from './final-film-gate-runner';

// ───────────────────────────── 策略 ─────────────────────────────

export type VideoSpecExecutorStrategy = 'unified' | 'legacy';

/** ADR-03：只有带 `videoSpecVersion` 的新项目走统一执行器；旧项目一律 legacy（原有执行器，行为不变）。 */
export function videoSpecExecutorStrategy(project: unknown): VideoSpecExecutorStrategy {
  return projectUsesVideoSpec(project) ? 'unified' : 'legacy';
}

// ───────────────────────────── ffmpeg 参数 ─────────────────────────────

/** 与 `SIDECAR_OUTPUT_COLOR_ARGS`（storybound-sidecar）相同的输出色彩标签（ADR-10）。 */
export const VIDEO_SPEC_OUTPUT_COLOR_ARGS = Object.freeze(['-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1'] as const);

/**
 * 帧级色彩标签。实测随应用打包的 ffmpeg 7.1 只靠 `-color_primaries/-color_trc` 输出参数写不进码流
 * （探测为 `bt709/unknown/unknown`），必须同时用 setparams 给帧打标签（与 storybound-sidecar / lemo 相同做法）。
 */
export const VIDEO_SPEC_SETPARAMS_FILTER = 'setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=iec61966-2-1';

/** RGB/JPEG → yuv420p（bt709 矩阵、tv 范围）。CaptureHost 的 JPEG 是 JFIF（bt601 全范围）。 */
function toBt709Filter(input: 'rgb' | 'jpeg'): string {
  const from = input === 'jpeg' ? 'in_color_matrix=bt601:in_range=pc:' : '';
  return `scale=${from}out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p,${VIDEO_SPEC_SETPARAMS_FILTER}`;
}

/** 中间片段：无损 H.264（qp 0），只在最终封装时有损编码一次。 */
function segmentEncodeArgs(frames: number, fps: number, outputPath: string): string[] {
  return ['-an', '-frames:v', String(frames), '-r', String(fps), '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', '-pix_fmt', 'yuv420p', ...VIDEO_SPEC_OUTPUT_COLOR_ARGS, '-f', 'mp4', outputPath];
}

function fitFilter(width: number, height: number, fit: 'cover' | 'contain'): string {
  return fit === 'cover'
    ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`
    : `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
}

function fileInput(path: string): string {
  // eslint-disable-next-line no-control-regex
  if (!path || /[\u0000-\u001f]/u.test(path)) throw new AppError('VIDEO_SPEC_EXECUTOR_INPUT_INVALID', `素材路径无效：${JSON.stringify(path)}`);
  return path.startsWith('file:') ? path : `file:${path}`;
}

function tail(text: string, lines = 4): string {
  return text.split(/\r?\n/u).map(line => line.trim()).filter(Boolean).slice(-lines).join(' | ').slice(0, 800);
}

const DEFAULT_PROCESS_TIMEOUT_MS = 30 * 60_000;

async function runFfmpeg(ffmpegPath: string, args: string[], options: { cwd: string; signal?: AbortSignal; timeoutMs?: number; label: string }): Promise<void> {
  const result = await runBoundedProcess(ffmpegPath, ['-hide_banner', '-nostdin', '-y', ...args], {
    cwd: options.cwd, timeoutMs: options.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS, maxStdoutBytes: 1024 * 1024, maxStderrBytes: 8 * 1024 * 1024, ...(options.signal ? { signal: options.signal } : {}),
  });
  if (result.code !== 0) throw new AppError('VIDEO_SPEC_EXECUTOR_FFMPEG_FAILED', `${options.label}失败（ffmpeg 退出码 ${String(result.code)}）：${tail(result.stderr)}`);
}

async function atomicOutput<T>(outputPath: string, work: (tempPath: string) => Promise<T>): Promise<T> {
  await mkdir(dirname(outputPath), { recursive: true });
  const temp = `${outputPath}.${process.pid}.${Date.now().toString(36)}.tmp.mp4`;
  try {
    const value = await work(temp);
    await rename(temp, outputPath);
    return value;
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
}

// ───────────────────────────── 场景片段 ─────────────────────────────

/** 把 CaptureHost 的帧流（stdin）编码为无损片段。 */
function spawnFrameEncoder(ffmpegPath: string, args: string[], options: { cwd: string; signal?: AbortSignal; timeoutMs?: number }) {
  const child = spawn(ffmpegPath, ['-hide_banner', '-nostdin', '-y', ...args], { cwd: options.cwd, stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true, shell: false });
  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-64 * 1024); });
  const kill = () => { if (child.exitCode === null && !child.killed) child.kill(); };
  const timer = setTimeout(kill, options.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS);
  timer.unref?.();
  options.signal?.addEventListener('abort', kill, { once: true });
  const done = new Promise<void>((resolvePromise, reject) => {
    child.once('error', error => reject(new AppError('VIDEO_SPEC_EXECUTOR_FFMPEG_FAILED', `无法启动 ffmpeg：${error.message}`)));
    child.once('close', code => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', kill);
      if (code === 0) resolvePromise();
      else reject(new AppError('VIDEO_SPEC_EXECUTOR_FFMPEG_FAILED', `场景编码失败（ffmpeg 退出码 ${String(code)}）：${tail(stderr)}`));
    });
  });
  void done.catch(() => {});
  // stdin 的 EPIPE 等错误由 close 事件统一报告。
  child.stdin.on('error', () => {});
  return { stdin: child.stdin, done, kill };
}

export interface CapturedSceneSegmentOptions {
  host: CaptureHost;
  spec: VideoSpec;
  scene: VideoSpecScene;
  url: string;
  outputPath: string;
  ffmpegPath: string;
  format?: CaptureFrameFormat;
  timeouts?: Partial<CaptureTimeouts>;
  signal?: AbortSignal;
  onProgress?: (progress: { captured: number; total: number }) => void;
  timeoutMs?: number;
}

export async function encodeCapturedSceneSegment(options: CapturedSceneSegmentOptions): Promise<{ ref: string; frames: number }> {
  const { spec, scene } = options;
  const format = options.format ?? 'bgra';
  const { width, height, fps } = spec.canvas;
  return atomicOutput(options.outputPath, async temp => {
    const encoder = spawnFrameEncoder(options.ffmpegPath, [
      ...ffmpegFrameInputArgs({ format, width, height, fps }),
      '-vf', toBt709Filter(format === 'jpeg' ? 'jpeg' : 'rgb'),
      ...segmentEncodeArgs(scene.durationFrames, fps, temp),
    ], { cwd: dirname(options.outputPath), ...(options.signal ? { signal: options.signal } : {}), ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) });
    try {
      const captured = await captureVideoSpecScene(spec, scene.id, {
        host: options.host,
        url: options.url,
        format,
        sink: createWritableFrameSink(encoder.stdin),
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.timeouts ? { timeouts: options.timeouts } : {}),
        ...(options.onProgress ? { onProgress: (progress: { captured: number; total: number }) => options.onProgress!({ captured: progress.captured, total: progress.total }) } : {}),
      });
      encoder.stdin.end();
      await encoder.done;
      return { ref: options.outputPath, frames: captured.framesCaptured };
    } catch (error) {
      encoder.kill();
      await encoder.done.catch(() => {});
      throw error;
    }
  });
}

export interface StillSceneSegmentOptions { ffmpegPath: string; imagePath: string; width: number; height: number; fps: number; frames: number; outputPath: string; signal?: AbortSignal; timeoutMs?: number }

/** 静态图片 → 定长片段（cover 适配；镜头运动暂不实现）。 */
export async function renderStillSceneSegment(options: StillSceneSegmentOptions): Promise<{ ref: string; frames: number }> {
  return atomicOutput(options.outputPath, async temp => {
    await runFfmpeg(options.ffmpegPath, [
      '-loop', '1', '-framerate', String(options.fps), '-i', fileInput(options.imagePath),
      '-vf', `${fitFilter(options.width, options.height, 'cover')},${toBt709Filter('rgb')}`,
      ...segmentEncodeArgs(options.frames, options.fps, temp),
    ], { cwd: dirname(options.outputPath), label: '静态场景编码', ...(options.signal ? { signal: options.signal } : {}), ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) });
    return { ref: options.outputPath, frames: options.frames };
  });
}

export interface VideoSceneSegmentOptions extends StillSceneSegmentOptions { trimStartSeconds: number; fit: 'cover' | 'contain' }

/** 视频素材 → 定长片段：裁切起点、适配画布、转成项目 fps，素材不够长时定格最后一帧补齐；原声丢弃。 */
export async function renderVideoSceneSegment(options: VideoSceneSegmentOptions): Promise<{ ref: string; frames: number }> {
  const videoPath = options.imagePath;
  return atomicOutput(options.outputPath, async temp => {
    await runFfmpeg(options.ffmpegPath, [
      ...(options.trimStartSeconds > 0 ? ['-ss', options.trimStartSeconds.toFixed(6)] : []), '-i', fileInput(videoPath),
      '-vf', `${fitFilter(options.width, options.height, options.fit)},fps=${options.fps},tpad=stop_mode=clone:stop=-1,${toBt709Filter('rgb')}`,
      ...segmentEncodeArgs(options.frames, options.fps, temp),
    ], { cwd: dirname(options.outputPath), label: '视频场景编码', ...(options.signal ? { signal: options.signal } : {}), ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) });
    return { ref: options.outputPath, frames: options.frames };
  });
}

// ───────────────────────────── 封装 ─────────────────────────────

export interface MuxVideoSpecFilmOptions {
  ffmpegPath: string;
  /** 按时间顺序的场景片段（同尺寸、同 fps、yuv420p）。 */
  segmentPaths: readonly string[];
  audioPath: string;
  outputPath: string;
  fps: number;
  totalFrames: number;
  crf?: number;
  audioBitrate?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** concat 文件里的路径：绝对路径、统一正斜杠、加 `file:` 前缀（避免盘符被当成协议）并转义单引号。 */
export function concatListLine(path: string): string {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/u.test(path)) throw new AppError('VIDEO_SPEC_EXECUTOR_INPUT_INVALID', `片段路径包含控制字符：${JSON.stringify(path)}`);
  return `file 'file:${resolve(path).replace(/\\/gu, '/').replace(/'/gu, `'\\''`)}'`;
}

/** ffmpeg 封装参数（不含 `-i` 输入列表之前的全局参数），导出供测试核对。 */
export function muxVideoSpecFilmArgs(options: { listPath: string; audioPath: string; outputPath: string; fps: number; totalFrames: number; crf?: number; audioBitrate?: string }): string[] {
  return [
    '-f', 'concat', '-safe', '0', '-i', fileInput(options.listPath),
    '-i', fileInput(options.audioPath),
    '-map', '0:v:0', '-map', '1:a:0', '-vf', VIDEO_SPEC_SETPARAMS_FILTER,
    '-frames:v', String(options.totalFrames), '-r', String(options.fps),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', String(options.crf ?? 18), '-pix_fmt', 'yuv420p', ...VIDEO_SPEC_OUTPUT_COLOR_ARGS,
    '-c:a', 'aac', '-b:a', options.audioBitrate ?? '256k', '-ar', '48000',
    '-movflags', '+faststart', '-f', 'mp4', options.outputPath,
  ];
}

export async function muxVideoSpecFilm(options: MuxVideoSpecFilmOptions): Promise<{ ref: string }> {
  if (!options.segmentPaths.length) throw new AppError('VIDEO_SPEC_EXECUTOR_INPUT_INVALID', '没有可封装的场景片段。');
  if (!Number.isSafeInteger(options.totalFrames) || options.totalFrames < 1) throw new AppError('VIDEO_SPEC_EXECUTOR_INPUT_INVALID', '总帧数必须是正整数。');
  return atomicOutput(options.outputPath, async temp => {
    const listPath = `${temp}.concat.txt`;
    try {
      await writeFile(listPath, `ffconcat version 1.0\n${options.segmentPaths.map(concatListLine).join('\n')}\n`, 'utf8');
      await runFfmpeg(options.ffmpegPath, muxVideoSpecFilmArgs({ ...options, listPath, outputPath: temp }), {
        cwd: dirname(options.outputPath), label: '成片封装', ...(options.signal ? { signal: options.signal } : {}), ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      });
    } finally {
      await rm(listPath, { force: true }).catch(() => {});
    }
    return { ref: options.outputPath };
  });
}

// ───────────────────────────── 检查点文件 ─────────────────────────────

export async function saveVideoSpecExecutorCheckpointFile(path: string, checkpoint: VideoSpecExecutorCheckpoint): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now().toString(36)}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
}

/** 文件不存在返回 undefined；内容损坏时抛错（不悄悄从头开始，避免重发收费请求）。 */
export async function loadVideoSpecExecutorCheckpointFile(path: string): Promise<VideoSpecExecutorCheckpoint | undefined> {
  let text: string;
  try { text = await readFile(path, 'utf8'); } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return undefined;
    throw error;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = undefined; }
  const checkpoint = parseVideoSpecExecutorCheckpoint(parsed);
  if (!checkpoint) throw new AppError('VIDEO_SPEC_EXECUTOR_CHECKPOINT_INVALID', `执行检查点已损坏：${path}`);
  return checkpoint;
}

// ───────────────────────────── 依赖装配 ─────────────────────────────

export interface VideoSpecExecutorRuntimeOptions {
  /** 本次渲染的工作目录（场景片段、音频、成片）。 */
  workDir: string;
  /** 注入：TTS（不在这里接服务商）。 */
  synthesizeVoice: VideoSpecExecutorDeps['synthesizeVoice'];
  /** 注入：场景创作（LLM）。缺省不做创作，场景页面来自 spec 里的引用。 */
  authorScene?: VideoSpecExecutorDeps['authorScene'];
  recover?: VideoSpecExecutorDeps['recover'];
  /** 检查点文件；缺省不落盘（只在内存里，崩溃后无法恢复）。 */
  checkpointPath?: string;
  /** spec 里的素材引用 → 本地路径；缺省原样使用。 */
  resolveSourcePath?: (ref: string) => string;
  /** 可采集场景的页面 URL；缺省用创作结果的 ref，或 hyperframes compositionRef / lemo codeRef。 */
  resolveScenePageUrl?: (input: { spec: VideoSpec; scene: VideoSpecScene; authored: SceneAuthorResult }) => string | Promise<string>;
  /** 缺省使用 Electron 离屏窗口（capture-host-electron，按需加载）。 */
  createCaptureWindow?: CaptureWindowFactory;
  captureFormat?: CaptureFrameFormat;
  captureTimeouts?: Partial<CaptureTimeouts>;
  ffmpegPath?: string;
  pythonRoot?: string;
  /** false 关闭成片复检。 */
  gate?: false | { route?: FinalFilmGateRoute; timeoutMs?: number; reportPath?: string | null };
  processTimeoutMs?: number;
  log?: (line: string) => void;
}

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//iu;

function safeFileStem(id: string): string {
  return `${id.replace(/[^A-Za-z0-9_.-]/gu, '_').slice(0, 48)}-${videoSpecExecutorHash(id).slice(0, 8)}`;
}

function gateRoute(spec: VideoSpec): FinalFilmGateRoute {
  // 【未核实】creative 路线暂按 html 处理（复检规则对三条路线相同，只影响报告里的 route 字段）。
  return spec.route === 'template' ? 'template' : 'html';
}

export function createVideoSpecExecutorRuntimeDeps(options: VideoSpecExecutorRuntimeOptions): VideoSpecExecutorDeps {
  const workDir = resolve(options.workDir);
  const sourcePath = (ref: string) => options.resolveSourcePath?.(ref) ?? ref;
  let ffmpeg: Promise<string> | undefined;
  const ffmpegPath = () => {
    ffmpeg ??= resolveFinalFilmFfmpeg({ ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}), ...(options.pythonRoot ? { pythonRoot: options.pythonRoot } : {}) }).then(found => {
      if (!found) throw new AppError('VIDEO_SPEC_EXECUTOR_FFMPEG_MISSING', '找不到随应用打包的 ffmpeg，无法渲染。');
      return found.ffmpegPath;
    });
    ffmpeg.catch(() => { ffmpeg = undefined; });
    return ffmpeg;
  };
  let host: Promise<CaptureHost> | undefined;
  const captureHost = () => {
    host ??= (async () => {
      const createWindow = options.createCaptureWindow ?? (await import('./capture-host-electron')).createElectronCaptureWindowFactory();
      return new CaptureHost({ createWindow });
    })();
    return host;
  };
  const pageUrl = async (spec: VideoSpec, scene: VideoSpecScene, authored: SceneAuthorResult): Promise<string> => {
    if (options.resolveScenePageUrl) return options.resolveScenePageUrl({ spec, scene, authored });
    const adapter = scene.adapter;
    const ref = authored?.ref ?? (adapter.kind === 'hyperframes' ? adapter.compositionRef : adapter.kind === 'lemo' ? adapter.codeRef : undefined);
    if (!ref) throw new AppError('VIDEO_SPEC_EXECUTOR_SCENE_PAGE_MISSING', `场景 "${scene.id}"（${adapter.kind}）没有可采集的页面。`);
    return URL_SCHEME.test(ref) ? ref : pathToFileURL(resolve(sourcePath(ref))).href;
  };
  const timeoutMs = options.processTimeoutMs;

  return {
    synthesizeVoice: request => options.synthesizeVoice(request),
    ...(options.authorScene ? { authorScene: options.authorScene } : {}),
    ...(options.recover ? { recover: options.recover } : {}),
    ...(options.checkpointPath ? { saveCheckpoint: (checkpoint: VideoSpecExecutorCheckpoint) => saveVideoSpecExecutorCheckpointFile(options.checkpointPath!, checkpoint) } : {}),

    async renderScene(request) {
      const { spec, scene } = request;
      const outputPath = join(workDir, 'scenes', `${safeFileStem(scene.id)}.mp4`);
      const ffmpegBinary = await ffmpegPath();
      const { width, height, fps } = spec.canvas;
      const plan = sceneCapturePlan(scene.adapter.kind);
      if (plan.capturable) {
        return encodeCapturedSceneSegment({
          host: await captureHost(), spec, scene, url: await pageUrl(spec, scene, request.authored), outputPath, ffmpegPath: ffmpegBinary,
          signal: request.signal, onProgress: request.onProgress,
          ...(options.captureFormat ? { format: options.captureFormat } : {}),
          ...(options.captureTimeouts ? { timeouts: options.captureTimeouts } : {}),
          ...(timeoutMs ? { timeoutMs } : {}),
        });
      }
      const adapter = scene.adapter;
      if (adapter.kind === 'still') {
        return renderStillSceneSegment({ ffmpegPath: ffmpegBinary, imagePath: sourcePath(adapter.imageRef), width, height, fps, frames: scene.durationFrames, outputPath, signal: request.signal, ...(timeoutMs ? { timeoutMs } : {}) });
      }
      if (adapter.kind === 'video') {
        return renderVideoSceneSegment({
          ffmpegPath: ffmpegBinary, imagePath: sourcePath(adapter.videoRef), width, height, fps, frames: scene.durationFrames, outputPath, signal: request.signal,
          trimStartSeconds: adapter.trimStartFrame / fps, fit: adapter.fit, ...(timeoutMs ? { timeoutMs } : {}),
        });
      }
      throw new AppError('VIDEO_SPEC_EXECUTOR_ADAPTER_UNSUPPORTED', `场景 "${scene.id}" 的适配器 ${adapter.kind} 无法渲染。`);
    },

    async renderAudio(request) {
      const inputs = new Map<string, string>();
      for (const track of request.spec.audio.tracks) for (const clip of track.clips) inputs.set(clip.id, sourcePath(clip.ref));
      const result = await renderAudioTimeline({
        spec: request.spec, inputs, outputPath: join(workDir, 'audio', 'timeline.wav'), signal: request.signal,
        ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}), ...(options.pythonRoot ? { pythonRoot: options.pythonRoot } : {}),
        ...(options.log ? { log: options.log } : {}),
      });
      return { ref: result.outputPath, durationSamples: result.durationSamples };
    },

    async mux(request) {
      const mp4 = request.spec.outputs.find(output => output.kind === 'mp4');
      const outputPath = mp4 && mp4.kind === 'mp4' && mp4.path ? resolve(sourcePath(mp4.path)) : join(workDir, 'output', 'film.mp4');
      return muxVideoSpecFilm({
        ffmpegPath: await ffmpegPath(), segmentPaths: request.segments.map(segment => segment.ref), audioPath: request.audioRef, outputPath,
        fps: request.spec.canvas.fps, totalFrames: request.spec.durationFrames, signal: request.signal, ...(timeoutMs ? { timeoutMs } : {}),
      });
    },

    ...(options.gate === false ? {} : {
      async gate(request: Parameters<NonNullable<VideoSpecExecutorDeps['gate']>>[0]) {
        const gateOptions = options.gate || {};
        const spec = request.spec;
        const report = await runFinalFilmGateSafely({
          route: gateOptions.route ?? gateRoute(spec),
          filmPath: request.filmRef,
          expected: {
            durationMs: videoSpecDurationMs(spec), fps: spec.canvas.fps, width: spec.canvas.width, height: spec.canvas.height,
            audioExpected: spec.audio.tracks.some(track => track.clips.length > 0), loudnessTarget: spec.loudness.normalize,
          },
          signal: request.signal,
          ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}), ...(options.pythonRoot ? { pythonRoot: options.pythonRoot } : {}),
          ...(gateOptions.timeoutMs ? { timeoutMs: gateOptions.timeoutMs } : {}),
          ...(gateOptions.reportPath !== undefined ? { reportPath: gateOptions.reportPath } : {}),
          ...(options.log ? { log: options.log } : {}),
        });
        return { status: report.status, summary: summarizeFinalFilmGate(report) };
      },
    }),
  };
}

/**
 * 新项目的入口：策略不是 unified（旧项目）时直接拒绝，绝不改变旧项目的执行路径。
 * 检查点：显式传入的优先，否则从 `checkpointPath` 读取。
 */
export async function runVideoSpecExecutorForProject(
  project: unknown,
  specInput: unknown,
  runtime: VideoSpecExecutorRuntimeOptions,
  executorOptions: VideoSpecExecutorOptions = {},
): Promise<VideoSpecExecutorResult> {
  if (videoSpecExecutorStrategy(project) !== 'unified') {
    throw new AppError('VIDEO_SPEC_EXECUTOR_LEGACY_PROJECT', '旧项目不使用统一执行器（ADR-03），请走原有的生成流程。');
  }
  const checkpoint = executorOptions.checkpoint ?? (runtime.checkpointPath ? await loadVideoSpecExecutorCheckpointFile(runtime.checkpointPath) : undefined);
  return runVideoSpecExecutor(specInput, createVideoSpecExecutorRuntimeDeps(runtime), { ...executorOptions, ...(checkpoint !== undefined ? { checkpoint } : {}) });
}
