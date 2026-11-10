/**
 * 统一执行器（backlog O-3）：VideoSpec 新项目的唯一编排器。只用于 `projectUsesVideoSpec(project)` 为真的新项目（ADR-03）；
 * 旧的 VOX 生产 DAG（electron/vox-production-runtime.ts）和 HTML 视频 runner（src/shared/html-video-runner.ts）保持原样。
 *
 * 阶段（先配音后分镜）：
 *   1. voice   —— 每个有旁白的场景一次 TTS（收费）。全部拿到实测时长后，用唯一的分帧函数 `allocateFrameCounts`
 *                 把时长换成整数帧窗口，得到新的 VideoSpec（不修改输入，返回新对象）。
 *   2. scenes  —— 每个场景 author（可选，LLM，收费）→ render（本地采集，免费），按并发上限并行；
 *                 失败隔离：一个场景失败不取消其他场景，失败场景带错误码上报，可单独重试（`retryScenes`）。
 *   3. audio   —— 整条音频时间线渲染一次（免费）。
 *   4. mux     —— 场景片段 + 音频封装/编码成片（免费）。
 *   5. gate    —— 成片复检，**只做提示**（advisory），从不阻塞交付。
 *
 * 重试一律走 retry-budget（G-7）：收费且结果未知的节点**永远不会被自动重发**；先尝试免费的回执核对，
 * 否则停在 `unknown` 等人确认（`resendUnknownNodeIds`）。
 *
 * 检查点是纯 JSON：每个节点有 status（received / rejected / unknown / not-sent）、attempts、回执 id、幂等键。
 * 收费节点在**发出请求之前**先把状态落盘为 `unknown`，所以进程崩溃后恢复不会重发可能已计费的请求；
 * 免费节点崩溃后恢复时重置为 `not-sent` 直接重跑。节点 id 由场景 id 决定，hash 由内容决定；
 * 内容没变且已 received 的节点在恢复时直接跳过。
 *
 * 纯模块：不引入 Node / Electron，所有副作用（TTS、LLM、采集、ffmpeg、落盘）都通过依赖注入。
 */
import { AppError, isCancellation } from './app-error';
import { classifyProviderFailure, providerBackoffMs, type ProviderFailureOutcome, type ProviderRetryPolicy } from './provider-failure';
import {
  UNKNOWN_NODE_ACTION_TEXT,
  consumeRetryBudget,
  createRetryBudget,
  decideUnknownNodeAction,
  parseRetryBudget,
  provenFailureOutcome,
  type RetryBudget,
  type RetryBudgetLimits,
  type UnknownNodeAction,
} from './retry-budget';
import {
  allocateFrameCounts,
  formatVideoSpecIssue,
  frameAt,
  parseVideoSpec,
  validateVideoSpec,
  type VideoSpec,
  type VideoSpecAudioClip,
  type VideoSpecAudioTrack,
  type VideoSpecCue,
  type VideoSpecScene,
} from './video-spec';

// ───────────────────────────── 类型 ─────────────────────────────

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export const VIDEO_SPEC_EXECUTOR_CHECKPOINT_KIND = 'video-spec-executor' as const;
export const VIDEO_SPEC_EXECUTOR_CHECKPOINT_VERSION = 1 as const;
export const VIDEO_SPEC_EXECUTOR_NODE_KINDS = ['voice', 'author', 'render', 'audio', 'mux', 'gate'] as const;
export type VideoSpecExecutorNodeKind = (typeof VIDEO_SPEC_EXECUTOR_NODE_KINDS)[number];
export const VIDEO_SPEC_EXECUTOR_NODE_STATUSES = ['not-sent', 'received', 'rejected', 'unknown'] as const;
/**
 * - `not-sent`：还没发出，或可以证明没离开本机 —— 可以安全地（重新）发送；
 * - `received`：已拿到结果（result 里有）；
 * - `rejected`：明确失败（服务商拒绝 / 本地步骤失败），没有产生计费结果；只在显式重试时重跑；
 * - `unknown`：已发出但结果未知（含进行中崩溃）。收费节点从不自动重发。
 */
export type VideoSpecExecutorNodeStatus = (typeof VIDEO_SPEC_EXECUTOR_NODE_STATUSES)[number];
export type VideoSpecExecutorStage = 'voice' | 'scenes' | 'audio' | 'mux' | 'gate';

export interface VideoSpecExecutorNodeErrorInfo {
  code: string;
  message: string;
  action: UnknownNodeAction | 'cancelled';
  outcome: ProviderFailureOutcome;
}

export interface VideoSpecExecutorNodeState {
  id: string;
  kind: VideoSpecExecutorNodeKind;
  sceneId?: string;
  /** 内容 hash；与当前计算值不同表示节点已过期，会被重置。 */
  hash: string;
  status: VideoSpecExecutorNodeStatus;
  /** 真正发出的次数（含自动重试、手动重试）。 */
  attempts: number;
  /** 消耗重试预算的自动重试次数。 */
  autoRetries: number;
  /** 每次发出时传给依赖的确定性幂等键（`<id>@<hash>#<attempt>`），回执核对用。 */
  idempotencyKeys: string[];
  /** 服务商返回的回执 / 任务 id。 */
  receiptIds: string[];
  recoveryAttempted: boolean;
  result?: JsonValue;
  error?: VideoSpecExecutorNodeErrorInfo;
  updatedAt?: number;
}

export interface VideoSpecExecutorCheckpoint {
  kind: typeof VIDEO_SPEC_EXECUTOR_CHECKPOINT_KIND;
  version: typeof VIDEO_SPEC_EXECUTOR_CHECKPOINT_VERSION;
  /** 输入 spec 的 hash（仅供诊断；是否复用以节点 hash 为准）。 */
  specHash: string;
  nodes: Record<string, VideoSpecExecutorNodeState>;
  retryBudget: RetryBudget;
  updatedAt: number;
}

// —— 依赖接口 ——

interface NodeCallContext {
  nodeId: string;
  attempt: number;
  /** 确定性幂等键；支持幂等/回执查询的服务商应原样带上。 */
  idempotencyKey: string;
  signal: AbortSignal;
}

export interface VoiceSynthesisRequest extends NodeCallContext { sceneId: string; text: string; voiceProfile?: string }
export interface VoiceSynthesisResult {
  /** 本地音频文件引用（路径）。 */
  ref: string;
  /** 实测时长（毫秒，正数）。 */
  durationMs: number;
  receiptId?: string;
  /** 相对本段配音开头的字幕时间（毫秒）。 */
  cues?: Array<{ text: string; startMs: number; endMs: number }>;
}

export interface SceneAuthorRequest extends NodeCallContext { spec: VideoSpec; scene: VideoSpecScene }
/** `null` 表示该场景不需要创作（例如 still / video 场景）。 */
export type SceneAuthorResult = { ref?: string; receiptId?: string; data?: JsonValue } | null;

export interface SceneRenderRequest extends NodeCallContext {
  spec: VideoSpec;
  scene: VideoSpecScene;
  authored: SceneAuthorResult;
  onProgress: (progress: { captured: number; total: number }) => void;
}
export interface SceneRenderResult { ref: string; frames: number }

export interface AudioRenderRequest extends NodeCallContext { spec: VideoSpec }
export interface AudioRenderResult { ref: string; durationSamples?: number }

export interface MuxSegment { sceneId: string; ref: string; startFrame: number; durationFrames: number }
export interface MuxRequest extends NodeCallContext { spec: VideoSpec; segments: MuxSegment[]; audioRef: string }
export interface MuxResult { ref: string }

export interface GateRequest extends NodeCallContext { spec: VideoSpec; filmRef: string }
export interface GateResult { status: 'passed' | 'warning' | 'failed' | 'error'; summary?: string }

export interface RecoverRequest { nodeId: string; idempotencyKeys: string[]; receiptIds: string[]; signal: AbortSignal }

export interface VideoSpecExecutorDeps {
  synthesizeVoice(request: VoiceSynthesisRequest): Promise<VoiceSynthesisResult>;
  authorScene?(request: SceneAuthorRequest): Promise<SceneAuthorResult>;
  renderScene(request: SceneRenderRequest): Promise<SceneRenderResult>;
  renderAudio(request: AudioRenderRequest): Promise<AudioRenderResult>;
  mux(request: MuxRequest): Promise<MuxResult>;
  gate?(request: GateRequest): Promise<GateResult>;
  /** 免费、只读的回执核对；返回 null 表示查不到结果（仍视为未知，不会自动重发）。 */
  recover?: {
    voice?(request: RecoverRequest): Promise<VoiceSynthesisResult | null>;
    author?(request: RecoverRequest): Promise<SceneAuthorResult | undefined | null>;
  };
  /** 每次节点状态变化后调用（串行，顺序与调用一致）。收费请求发出前会等待它完成。 */
  saveCheckpoint?(checkpoint: VideoSpecExecutorCheckpoint): void | Promise<void>;
  delay?(ms: number, signal: AbortSignal): Promise<void>;
  now?(): number;
}

export type VideoSpecExecutorEvent =
  | { type: 'stage'; stage: VideoSpecExecutorStage; state: 'start' | 'done' | 'blocked' | 'skipped' }
  | {
    type: 'node';
    nodeId: string;
    kind: VideoSpecExecutorNodeKind;
    sceneId?: string;
    state: VideoSpecExecutorNodeStatus | 'running' | 'skipped' | 'retrying' | 'recovered';
    attempt: number;
    completed: number;
    total: number;
    error?: VideoSpecExecutorNodeErrorInfo;
  }
  | { type: 'scene-progress'; sceneId: string; captured: number; total: number };

export interface VideoSpecExecutorOptions {
  /** 上次运行保存的检查点（崩溃恢复 / 单场景重试）。不合法时抛错而不是悄悄从头开始（避免重发收费请求）。 */
  checkpoint?: unknown;
  signal?: AbortSignal;
  onProgress?: (event: VideoSpecExecutorEvent) => void;
  /** 场景并发上限，默认 2，范围 1–16。 */
  sceneConcurrency?: number;
  /** TTS 并发上限，默认 2，范围 1–16。 */
  voiceConcurrency?: number;
  retryBudget?: Partial<RetryBudgetLimits>;
  retryDelayMs?: (attempt: number, nodeId: string) => number;
  /** 显式重试这些场景（author + render 节点，含 rejected 状态的）。 */
  retryScenes?: readonly string[];
  /** 显式重试这些节点（rejected 状态只有列在这里才会重跑）。 */
  retryNodeIds?: readonly string[];
  /** 人工核对后确认可以重发的 unknown 收费节点。 */
  resendUnknownNodeIds?: readonly string[];
  timing?: VoiceTimingOptions;
  /** 参与 voice 节点 hash 的音色标识（换音色 = 重新配音）。 */
  voiceProfile?: string;
  /** TTS 每个节点只发一个请求（默认 true）；只有这样 `not-sent` 才能证明整个节点未计费。 */
  voiceSingleRequest?: boolean;
  /** TTS 服务商对重发去重（默认 false）。 */
  voiceIdempotent?: boolean;
  authorSingleRequest?: boolean;
  authorIdempotent?: boolean;
}

export interface VideoSpecExecutorFailure {
  nodeId: string;
  kind: VideoSpecExecutorNodeKind;
  sceneId?: string;
  status: VideoSpecExecutorNodeStatus;
  code: string;
  message: string;
  action: UnknownNodeAction | 'cancelled';
  /** 给 UI 的中文说明。 */
  hint: string;
}

export interface VideoSpecExecutorResult {
  /** completed = 成片已产出（复检只做提示）；blocked = 有节点失败/未知；cancelled = 被取消。 */
  status: 'completed' | 'blocked' | 'cancelled';
  /** 配音定时后的 spec（配音阶段未完成时为 undefined）。 */
  spec?: VideoSpec;
  filmRef?: string;
  gate?: GateResult & { advisory: true };
  failures: VideoSpecExecutorFailure[];
  checkpoint: VideoSpecExecutorCheckpoint;
}

/** 依赖可抛出此错误，显式声明请求是否发出、回执 id、能否重试。 */
export class VideoSpecExecutorNodeError extends AppError {
  readonly outcome?: ProviderFailureOutcome;
  readonly retry?: ProviderRetryPolicy;
  readonly receiptId?: string;
  constructor(code: string, message: string, details: { outcome?: ProviderFailureOutcome; retry?: ProviderRetryPolicy; receiptId?: string; retryable?: boolean; cause?: unknown } = {}) {
    super(code, message, details.retryable ?? details.retry === 'always');
    if (details.outcome) this.outcome = details.outcome;
    if (details.retry) this.retry = details.retry;
    if (details.receiptId) this.receiptId = details.receiptId;
    if (details.cause !== undefined) Object.defineProperty(this, 'cause', { value: details.cause, enumerable: false });
  }
}

// ───────────────────────────── 确定性 id / hash ─────────────────────────────

export const videoSpecExecutorNodeId = {
  voice: (sceneId: string) => `voice:${sceneId}`,
  author: (sceneId: string) => `author:${sceneId}`,
  render: (sceneId: string) => `render:${sceneId}`,
  audio: () => 'audio',
  mux: () => 'mux',
  gate: () => 'gate',
} as const;

const NODE_ID_PATTERN = /^(?:(?:voice|author|render):[A-Za-z0-9_.:-]{1,64}|audio|mux|gate)$/u;

/** 键排序的 JSON（undefined 字段省略），用于内容 hash。 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return 'null';
    return value === undefined ? 'null' : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(item => stableStringify(item === undefined ? null : item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter(key => record[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/** FNV-1a 64 位（UTF-8），16 位十六进制。纯 JS，主进程 / 渲染进程结果一致。 */
export function videoSpecExecutorHash(value: unknown): string {
  const bytes = new TextEncoder().encode(stableStringify(value));
  let hash = FNV_OFFSET;
  for (const byte of bytes) hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & MASK_64;
  return hash.toString(16).padStart(16, '0');
}

// ───────────────────────────── 配音定时（先配音后分镜） ─────────────────────────────

export interface VoiceTiming {
  ref: string;
  durationMs: number;
  cues?: ReadonlyArray<{ text: string; startMs: number; endMs: number }>;
}

export interface VoiceTimingOptions {
  /** 有旁白场景的最短时长（毫秒），默认 800（与 HTML 路线现有规则一致）。 */
  minSceneMs?: number;
  /** 旁白后的尾部留白（毫秒），默认 0。 */
  tailPadMs?: number;
}

function timingError(message: string): AppError {
  return new AppError('VIDEO_SPEC_EXECUTOR_TIMING_INVALID', message);
}

function sanitizeMs(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw timingError(`${label}必须是非负毫秒数（收到 ${String(value)}）。`);
  return value;
}

function clampCues(cues: readonly VideoSpecCue[], durationFrames: number): VideoSpecCue[] {
  const result: VideoSpecCue[] = [];
  let previousEnd = 0;
  for (const cue of cues) {
    const startFrame = Math.max(previousEnd, Math.min(cue.startFrame, durationFrames));
    const endFrame = Math.min(cue.endFrame, durationFrames);
    if (endFrame <= startFrame) continue;
    const words = cue.words
      ?.map(word => {
        const wordStart = Math.min(endFrame, Math.max(startFrame, word.startFrame));
        return { ...word, startFrame: wordStart, endFrame: Math.min(endFrame, Math.max(wordStart, word.endFrame)) };
      });
    result.push({ ...cue, startFrame, endFrame, ...(words ? { words } : {}) });
    previousEnd = endFrame;
  }
  return result;
}

/**
 * 把实测配音时长写进 spec：每一段连续的有旁白场景用 `allocateFrameCounts`（唯一的分帧函数）按累计时钟分帧，
 * 时钟从该段第一个场景的开始帧起算（整数帧对齐，纯整数运算）；没有旁白的场景保持原帧数。
 * 主轨按首尾相接重排（不保留原来的转场重叠），旁白片段放在场景开头，其他音频片段按所属场景平移、
 * 铺满全片的片段（例如 BGM）随总时长伸缩。不修改输入，返回经过完整校验的新 spec。
 */
export function applyVoiceTimings(spec: VideoSpec, timings: ReadonlyMap<string, VoiceTiming>, options: VoiceTimingOptions = {}): VideoSpec {
  const fps = spec.canvas.fps;
  const minSceneMs = sanitizeMs(options.minSceneMs ?? 800, '最短场景时长');
  const tailPadMs = sanitizeMs(options.tailPadMs ?? 0, '尾部留白');
  for (const [sceneId, timing] of timings) {
    if (!spec.scenes.some(scene => scene.id === sceneId)) throw timingError(`配音结果指向不存在的场景 "${sceneId}"。`);
    if (typeof timing.ref !== 'string' || !timing.ref.trim()) throw timingError(`场景 "${sceneId}" 的配音缺少文件引用。`);
    if (!Number.isFinite(timing.durationMs) || timing.durationMs <= 0) throw timingError(`场景 "${sceneId}" 的配音时长无效（${String(timing.durationMs)} ms）。`);
  }

  // 1. 帧窗口
  interface Window { startFrame: number; durationFrames: number; runStartFrame: number; clockMs: number }
  const windows: Window[] = [];
  let cursor = 0;
  for (let index = 0; index < spec.scenes.length;) {
    if (!timings.has(spec.scenes[index].id)) {
      windows.push({ startFrame: cursor, durationFrames: spec.scenes[index].durationFrames, runStartFrame: cursor, clockMs: 0 });
      cursor += spec.scenes[index].durationFrames;
      index += 1;
      continue;
    }
    let end = index;
    while (end < spec.scenes.length && timings.has(spec.scenes[end].id)) end += 1;
    const run = spec.scenes.slice(index, end);
    const durationsMs = run.map(scene => Math.max(minSceneMs, timings.get(scene.id)!.durationMs + tailPadMs));
    const counts = allocateFrameCounts(durationsMs, fps);
    const runStartFrame = cursor;
    let clockMs = 0;
    run.forEach((_scene, offset) => {
      windows.push({ startFrame: cursor, durationFrames: counts[offset], runStartFrame, clockMs });
      cursor += counts[offset];
      clockMs += durationsMs[offset];
    });
    index = end;
  }
  const oldTotal = spec.durationFrames;
  const newTotal = cursor;

  // 2. 旁白片段 id
  const narratedIds = new Set(timings.keys());
  const replacedClipIds = new Set<string>();
  for (const scene of spec.scenes) if (narratedIds.has(scene.id) && scene.narration?.clipId) replacedClipIds.add(scene.narration.clipId);
  const usedClipIds = new Set<string>();
  for (const track of spec.audio.tracks) for (const clip of track.clips) if (!replacedClipIds.has(clip.id)) usedClipIds.add(clip.id);
  const clipIdFor = new Map<string, string>();
  for (const scene of spec.scenes) {
    if (!narratedIds.has(scene.id)) continue;
    let id = scene.narration?.clipId;
    if (!id) {
      const base = `vo-${scene.id}`.slice(0, 64);
      id = base;
      for (let n = 2; usedClipIds.has(id); n += 1) id = `vo${n}-${scene.id}`.slice(0, 64);
    }
    usedClipIds.add(id);
    clipIdFor.set(scene.id, id);
  }

  // 3. 场景
  const toLocalFrame = (window: Window, relativeMs: number) => {
    const local = frameAt(window.clockMs + Math.max(0, relativeMs), fps) - (window.startFrame - window.runStartFrame);
    return Math.min(window.durationFrames, Math.max(0, local));
  };
  const oldStart = new Map(spec.scenes.map(scene => [scene.id, scene.startFrame]));
  const newStart = new Map<string, number>();
  const newEnd = new Map<string, number>();
  const scenes = spec.scenes.map((scene, index) => {
    const window = windows[index];
    newStart.set(scene.id, window.startFrame);
    newEnd.set(scene.id, window.startFrame + window.durationFrames);
    const timing = timings.get(scene.id);
    let cues: VideoSpecCue[];
    if (timing?.cues?.length) {
      cues = [];
      let previousEnd = 0;
      for (const cue of [...timing.cues].sort((a, b) => a.startMs - b.startMs)) {
        const text = typeof cue.text === 'string' ? cue.text.trim() : '';
        if (!text) continue;
        const startFrame = Math.max(previousEnd, toLocalFrame(window, cue.startMs));
        let endFrame = toLocalFrame(window, cue.endMs);
        if (endFrame <= startFrame) endFrame = Math.min(window.durationFrames, startFrame + 1);
        if (endFrame <= startFrame) continue;
        cues.push({ text, startFrame, endFrame, source: 'tts' });
        previousEnd = endFrame;
      }
    } else {
      cues = clampCues(scene.cues, window.durationFrames);
    }
    const { transitionIn, narration, ...rest } = scene;
    return {
      ...rest,
      startFrame: window.startFrame,
      durationFrames: window.durationFrames,
      ...(transitionIn ? { transitionIn: { ...transitionIn, durationFrames: Math.min(transitionIn.durationFrames, window.durationFrames) } } : {}),
      ...(timing ? { narration: { text: narration?.text ?? '', clipId: clipIdFor.get(scene.id)! } } : narration ? { narration } : {}),
      cues,
    };
  });

  // 4. 音频
  const fitFades = (clip: VideoSpecAudioClip, durationFrames: number): VideoSpecAudioClip => {
    const fadeOutFrames = Math.min(clip.fadeOutFrames, durationFrames);
    const fadeInFrames = Math.min(clip.fadeInFrames, durationFrames - fadeOutFrames);
    return { ...clip, durationFrames, fadeInFrames, fadeOutFrames };
  };
  const moveClip = (clip: VideoSpecAudioClip): VideoSpecAudioClip | null => {
    let startFrame = clip.startFrame;
    let durationFrames = clip.durationFrames;
    if (clip.sceneId && oldStart.has(clip.sceneId)) {
      startFrame = Math.max(0, clip.startFrame + newStart.get(clip.sceneId)! - oldStart.get(clip.sceneId)!);
    } else if (clip.startFrame + clip.durationFrames === oldTotal) {
      durationFrames = newTotal - clip.startFrame;
    }
    if (startFrame >= newTotal) return null;
    durationFrames = Math.min(durationFrames, newTotal - startFrame);
    if (durationFrames < 1) return null;
    return fitFades({ ...clip, startFrame }, durationFrames);
  };
  const isPlaceholderNarration = (track: VideoSpecAudioTrack, clip: VideoSpecAudioClip) =>
    replacedClipIds.has(clip.id) || (track.kind === 'narration' && !!clip.sceneId && narratedIds.has(clip.sceneId));
  let narrationTrackIndex = spec.audio.tracks.findIndex(track => track.kind === 'narration' && track.clips.some(clip => replacedClipIds.has(clip.id)));
  if (narrationTrackIndex < 0) narrationTrackIndex = spec.audio.tracks.findIndex(track => track.kind === 'narration');
  const tracks = spec.audio.tracks.map(track => ({
    ...track,
    clips: track.clips.filter(clip => !isPlaceholderNarration(track, clip)).map(moveClip).filter((clip): clip is VideoSpecAudioClip => clip !== null),
  }));
  const narrationClips: VideoSpecAudioClip[] = scenes.flatMap((scene, index) => {
    const timing = timings.get(scene.id);
    if (!timing) return [];
    const window = windows[index];
    return [{
      id: clipIdFor.get(scene.id)!,
      ref: timing.ref,
      sceneId: scene.id,
      startFrame: window.startFrame,
      durationFrames: Math.max(1, toLocalFrame(window, timing.durationMs)),
      sourceStartMs: 0,
      gainDb: 0,
      fadeInFrames: 0,
      fadeOutFrames: 0,
      loop: false,
    }];
  });
  if (narrationClips.length) {
    if (narrationTrackIndex >= 0) {
      const track = tracks[narrationTrackIndex];
      tracks[narrationTrackIndex] = { ...track, clips: [...track.clips, ...narrationClips].sort((a, b) => a.startFrame - b.startFrame) };
    } else {
      const ids = new Set(tracks.map(track => track.id));
      let id = 'narration';
      for (let n = 2; ids.has(id); n += 1) id = `narration-${n}`;
      tracks.unshift({ id, kind: 'narration', gainDb: 0, clips: narrationClips });
    }
  }

  const result = validateVideoSpec({ ...spec, durationFrames: newTotal, scenes, audio: { ...spec.audio, tracks } });
  if (!result.ok) throw timingError(`配音定时后的 VideoSpec 不合法：${result.issues.slice(0, 5).map(formatVideoSpecIssue).join('；')}`);
  return result.spec;
}

// ───────────────────────────── 检查点 ─────────────────────────────

const MAX_KEYS = 50;
const MAX_NODES = 5_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isShortString = (value: unknown, max = 512): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;

function parseNode(id: string, value: unknown): VideoSpecExecutorNodeState | undefined {
  if (!isRecord(value) || value.id !== id || !NODE_ID_PATTERN.test(id)) return undefined;
  if (!(VIDEO_SPEC_EXECUTOR_NODE_KINDS as readonly unknown[]).includes(value.kind)) return undefined;
  if (!(VIDEO_SPEC_EXECUTOR_NODE_STATUSES as readonly unknown[]).includes(value.status)) return undefined;
  if (!isShortString(value.hash, 64) || !isCount(value.attempts) || !isCount(value.autoRetries) || typeof value.recoveryAttempted !== 'boolean') return undefined;
  const keys = (list: unknown) => Array.isArray(list) && list.length <= MAX_KEYS && list.every(item => isShortString(item)) ? [...list] as string[] : undefined;
  const idempotencyKeys = keys(value.idempotencyKeys);
  const receiptIds = keys(value.receiptIds);
  if (!idempotencyKeys || !receiptIds) return undefined;
  if (value.sceneId !== undefined && !isShortString(value.sceneId, 64)) return undefined;
  let error: VideoSpecExecutorNodeErrorInfo | undefined;
  if (value.error !== undefined) {
    const raw = value.error;
    if (!isRecord(raw) || typeof raw.code !== 'string' || typeof raw.message !== 'string' || typeof raw.action !== 'string' || typeof raw.outcome !== 'string') return undefined;
    error = { code: raw.code, message: raw.message, action: raw.action as VideoSpecExecutorNodeErrorInfo['action'], outcome: raw.outcome as ProviderFailureOutcome };
  }
  const status = value.status as VideoSpecExecutorNodeStatus;
  if (status === 'received' && value.result === undefined) return undefined;
  return {
    id,
    kind: value.kind as VideoSpecExecutorNodeKind,
    ...(value.sceneId !== undefined ? { sceneId: value.sceneId as string } : {}),
    hash: value.hash,
    status,
    attempts: value.attempts,
    autoRetries: value.autoRetries,
    idempotencyKeys,
    receiptIds,
    recoveryAttempted: value.recoveryAttempted,
    ...(value.result !== undefined ? { result: toJson(value.result) } : {}),
    ...(error ? { error } : {}),
    ...(isCount(value.updatedAt) ? { updatedAt: value.updatedAt } : {}),
  };
}

/** 严格读取持久化的检查点；任何结构问题都返回 undefined。 */
export function parseVideoSpecExecutorCheckpoint(value: unknown): VideoSpecExecutorCheckpoint | undefined {
  if (!isRecord(value) || value.kind !== VIDEO_SPEC_EXECUTOR_CHECKPOINT_KIND || value.version !== VIDEO_SPEC_EXECUTOR_CHECKPOINT_VERSION) return undefined;
  if (!isShortString(value.specHash, 64) || !isRecord(value.nodes)) return undefined;
  const retryBudget = parseRetryBudget(value.retryBudget);
  if (!retryBudget) return undefined;
  const entries = Object.entries(value.nodes);
  if (entries.length > MAX_NODES) return undefined;
  const nodes: Record<string, VideoSpecExecutorNodeState> = {};
  for (const [id, raw] of entries) {
    const node = parseNode(id, raw);
    if (!node) return undefined;
    Object.defineProperty(nodes, id, { value: node, enumerable: true, writable: true, configurable: true });
  }
  return { kind: VIDEO_SPEC_EXECUTOR_CHECKPOINT_KIND, version: VIDEO_SPEC_EXECUTOR_CHECKPOINT_VERSION, specHash: value.specHash, nodes, retryBudget, updatedAt: isCount(value.updatedAt) ? value.updatedAt : 0 };
}

function toJson(value: unknown): JsonValue {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

// ───────────────────────────── 执行 ─────────────────────────────

const PAID_KINDS: ReadonlySet<VideoSpecExecutorNodeKind> = new Set(['voice', 'author']);

function boundedConcurrency(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? Math.min(16, value) : fallback;
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(done, ms);
    function done() { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }
    signal.addEventListener('abort', done, { once: true });
  });
}

async function mapWithConcurrency<T>(items: readonly T[], limit: number, signal: AbortSignal, worker: (item: T) => Promise<void>, onError: (error: unknown) => void): Promise<void> {
  let next = 0;
  const runner = async () => {
    while (next < items.length && !signal.aborted) {
      const item = items[next];
      next += 1;
      try { await worker(item); } catch (error) { onError(error); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
}

interface ClassifiedError {
  outcome: ProviderFailureOutcome;
  retry: ProviderRetryPolicy;
  code: string;
  message: string;
  receiptId?: string;
  retryAfterMs?: number;
}

function classifyNodeError(error: unknown, paid: boolean, resultReceived: boolean): ClassifiedError {
  const record = (typeof error === 'object' && error !== null ? error : {}) as { code?: unknown; message?: unknown; retryable?: unknown; outcome?: unknown; retry?: unknown; receiptId?: unknown };
  const explicitOutcome = error instanceof VideoSpecExecutorNodeError ? error.outcome : undefined;
  const explicitRetry = error instanceof VideoSpecExecutorNodeError ? error.retry : undefined;
  const failure = classifyProviderFailure({ error });
  const outcome = resultReceived ? 'unknown' : explicitOutcome ?? provenFailureOutcome(failure);
  // 免费的本地步骤（采集 / ffmpeg）只看 AppError.retryable；收费步骤用服务商失败分类。
  const retry = explicitRetry ?? (paid ? failure.retry : record.retryable === true ? 'always' : 'never');
  const code = typeof record.code === 'string' && record.code ? record.code : `PROVIDER_${failure.kind.toUpperCase().replace(/-/gu, '_')}`;
  const message = (typeof record.message === 'string' && record.message ? record.message : failure.label).slice(0, 500);
  return {
    outcome,
    retry,
    code,
    message,
    ...(typeof record.receiptId === 'string' && record.receiptId ? { receiptId: record.receiptId.slice(0, 512) } : {}),
    ...(failure.retryAfterMs !== undefined ? { retryAfterMs: failure.retryAfterMs } : {}),
  };
}

function failureHint(node: VideoSpecExecutorNodeState): string {
  const action = node.error?.action;
  if (action === 'cancelled') return node.status === 'unknown' ? '运行被取消时该收费请求已发出，结果未知；不会自动重发，请核对服务商记录后确认。' : '运行已取消，下次运行会继续。';
  if (node.status === 'unknown') return UNKNOWN_NODE_ACTION_TEXT['await-user'];
  if (node.status === 'not-sent') return '请求未发出，下次运行会自动重新发送。';
  return action ? UNKNOWN_NODE_ACTION_TEXT[action] : UNKNOWN_NODE_ACTION_TEXT.fail;
}

function readVoice(result: JsonValue | undefined): VoiceTiming | undefined {
  if (!isRecord(result) || typeof result.ref !== 'string' || typeof result.durationMs !== 'number') return undefined;
  const cues = Array.isArray(result.cues)
    ? result.cues.filter((cue): cue is { text: string; startMs: number; endMs: number } => isRecord(cue) && typeof cue.text === 'string' && typeof cue.startMs === 'number' && typeof cue.endMs === 'number')
    : undefined;
  return { ref: result.ref, durationMs: result.durationMs, ...(cues ? { cues } : {}) };
}

function readRef(result: JsonValue | undefined): string | undefined {
  return isRecord(result) && typeof result.ref === 'string' && result.ref ? result.ref : undefined;
}

interface NodeDefinition<R> {
  id: string;
  kind: VideoSpecExecutorNodeKind;
  sceneId?: string;
  hash: string;
  singleRequest?: boolean;
  idempotent?: boolean;
  call(context: NodeCallContext): Promise<R>;
  /** 校验依赖返回值；抛错时视为“结果已到但不可用”（收费节点 → unknown，不自动重发）。 */
  validate?(result: R): void;
  recover?(request: RecoverRequest): Promise<R | null | undefined>;
}

type NodeOutcome = { ok: true; result: JsonValue } | { ok: false };

/** 运行统一执行器。只抛出输入/检查点/落盘错误；节点失败体现在 `failures` 和 `status: 'blocked'` 里。 */
export async function runVideoSpecExecutor(specInput: unknown, deps: VideoSpecExecutorDeps, options: VideoSpecExecutorOptions = {}): Promise<VideoSpecExecutorResult> {
  const spec = parseVideoSpec(specInput);
  const now = deps.now ?? (() => Date.now());
  const delay = deps.delay ?? abortableDelay;
  let prior: VideoSpecExecutorCheckpoint | undefined;
  if (options.checkpoint !== undefined && options.checkpoint !== null) {
    prior = parseVideoSpecExecutorCheckpoint(options.checkpoint);
    if (!prior) throw new AppError('VIDEO_SPEC_EXECUTOR_CHECKPOINT_INVALID', '执行检查点已损坏或版本不符；为避免重复提交收费请求，已停止。请人工核对后清除检查点再运行。');
  }
  const specHash = videoSpecExecutorHash(spec);
  const sceneLimit = boundedConcurrency(options.sceneConcurrency, 2);
  const voiceLimit = boundedConcurrency(options.voiceConcurrency, 2);
  const retryTargets = new Set<string>(options.retryNodeIds ?? []);
  for (const sceneId of options.retryScenes ?? []) {
    retryTargets.add(videoSpecExecutorNodeId.author(sceneId));
    retryTargets.add(videoSpecExecutorNodeId.render(sceneId));
  }
  const resendUnknown = new Set<string>(options.resendUnknownNodeIds ?? []);

  // —— 取消：外部 signal + 内部致命错误（落盘失败）——
  const controller = new AbortController();
  const signal = controller.signal;
  let fatal: unknown;
  const onExternalAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) controller.abort(options.signal.reason);
  else options.signal?.addEventListener('abort', onExternalAbort, { once: true });

  const emit = (event: VideoSpecExecutorEvent) => { try { options.onProgress?.(event); } catch { /* 进度回调不能影响执行 */ } };

  // —— 节点表：先放入上次的节点（内容 hash 不变的会被复用），本次规划之外的节点在落盘时剪掉 ——
  const nodes = new Map<string, VideoSpecExecutorNodeState>();
  const priorNodes = prior?.nodes ?? {};
  const narrated = spec.scenes.filter(scene => scene.narration?.text.trim());
  const plannedIds = new Set<string>([
    ...narrated.map(scene => videoSpecExecutorNodeId.voice(scene.id)),
    ...(deps.authorScene ? spec.scenes.map(scene => videoSpecExecutorNodeId.author(scene.id)) : []),
    ...spec.scenes.map(scene => videoSpecExecutorNodeId.render(scene.id)),
    'audio', 'mux', ...(deps.gate ? ['gate'] : []),
  ]);
  for (const [id, node] of Object.entries(priorNodes)) if (plannedIds.has(id)) nodes.set(id, node);
  let budget: RetryBudget = prior?.retryBudget ?? createRetryBudget(options.retryBudget);
  const total = plannedIds.size;
  const completed = () => [...nodes.values()].filter(node => node.status === 'received' && plannedIds.has(node.id)).length;

  const snapshot = (): VideoSpecExecutorCheckpoint => {
    const record: Record<string, VideoSpecExecutorNodeState> = {};
    for (const [id, node] of nodes) if (plannedIds.has(id)) Object.defineProperty(record, id, { value: toJson(node), enumerable: true, writable: true, configurable: true });
    return { kind: VIDEO_SPEC_EXECUTOR_CHECKPOINT_KIND, version: VIDEO_SPEC_EXECUTOR_CHECKPOINT_VERSION, specHash, nodes: record, retryBudget: toJson(budget) as unknown as RetryBudget, updatedAt: now() };
  };
  let saveChain: Promise<void> = Promise.resolve();
  const persist = (): Promise<void> => {
    const checkpoint = snapshot();
    const next = saveChain.then(() => deps.saveCheckpoint?.(checkpoint));
    saveChain = next.then(() => undefined, () => undefined);
    return next.then(() => undefined, error => {
      if (!fatal) {
        fatal = new AppError('VIDEO_SPEC_EXECUTOR_CHECKPOINT_FAILED', `无法保存执行检查点：${error instanceof Error ? error.message : String(error)}`);
        controller.abort(fatal);
      }
      throw fatal;
    });
  };

  const update = (id: string, patch: Partial<VideoSpecExecutorNodeState>): VideoSpecExecutorNodeState => {
    const current = nodes.get(id)!;
    const next: VideoSpecExecutorNodeState = { ...current, ...patch, updatedAt: now() };
    if ('error' in patch && patch.error === undefined) delete next.error;
    if ('result' in patch && patch.result === undefined) delete next.result;
    nodes.set(id, next);
    return next;
  };
  const emitNode = (node: VideoSpecExecutorNodeState, state: Extract<VideoSpecExecutorEvent, { type: 'node' }>['state']) => emit({
    type: 'node', nodeId: node.id, kind: node.kind, ...(node.sceneId ? { sceneId: node.sceneId } : {}), state, attempt: node.attempts,
    completed: completed(), total, ...(node.error ? { error: node.error } : {}),
  });

  /** 取得（或新建）节点；hash 变了的节点重置为新的 not-sent；崩溃时停在 unknown 的免费节点重置为 not-sent。 */
  const ensureNode = (id: string, kind: VideoSpecExecutorNodeKind, hash: string, sceneId?: string): VideoSpecExecutorNodeState => {
    const existing = nodes.get(id);
    if (existing && existing.hash === hash && existing.kind === kind) {
      if (existing.status === 'unknown' && !PAID_KINDS.has(kind)) return update(id, { status: 'not-sent', error: undefined });
      return existing;
    }
    const fresh: VideoSpecExecutorNodeState = {
      id, kind, ...(sceneId ? { sceneId } : {}), hash, status: 'not-sent', attempts: 0, autoRetries: 0, idempotencyKeys: [], receiptIds: [], recoveryAttempted: false, updatedAt: now(),
    };
    nodes.set(id, fresh);
    return fresh;
  };

  const tryRecover = async <R>(definition: NodeDefinition<R>): Promise<NodeOutcome> => {
    const node = update(definition.id, { recoveryAttempted: true });
    let recovered: R | null | undefined;
    try {
      recovered = await definition.recover!({ nodeId: node.id, idempotencyKeys: [...node.idempotencyKeys], receiptIds: [...node.receiptIds], signal });
      if (recovered !== null && recovered !== undefined) definition.validate?.(recovered);
    } catch {
      recovered = undefined;
    }
    if (recovered === null || recovered === undefined) {
      await persist();
      return { ok: false };
    }
    const result = toJson(recovered);
    const receiptId = isRecord(result) && typeof result.receiptId === 'string' ? result.receiptId : undefined;
    const done = update(definition.id, { status: 'received', result, error: undefined, receiptIds: receiptId ? [...node.receiptIds, receiptId].slice(-MAX_KEYS) : node.receiptIds });
    await persist();
    emitNode(done, 'recovered');
    return { ok: true, result };
  };

  /** 按 retry-budget 规则执行一个节点。依赖抛出的错误都在这里消化，只有落盘失败会向外抛。 */
  const executeNode = async <R>(definition: NodeDefinition<R>): Promise<NodeOutcome> => {
    const paid = PAID_KINDS.has(definition.kind);
    let node = ensureNode(definition.id, definition.kind, definition.hash, definition.sceneId);
    if (node.status === 'received') {
      emitNode(node, 'skipped');
      return { ok: true, result: node.result ?? null };
    }
    if (node.status === 'unknown' && !resendUnknown.has(node.id)) {
      if (definition.recover && !node.recoveryAttempted && (node.idempotencyKeys.length || node.receiptIds.length)) {
        const recovered = await tryRecover(definition);
        if (recovered.ok) return recovered;
      }
      emitNode(nodes.get(definition.id)!, 'unknown');
      return { ok: false };
    }
    if (node.status === 'rejected' && !retryTargets.has(node.id)) {
      emitNode(node, 'rejected');
      return { ok: false };
    }
    for (;;) {
      if (signal.aborted) return { ok: false };
      const attempt = node.attempts + 1;
      const idempotencyKey = `${node.id}@${node.hash}#${attempt}`;
      // 发出前先落盘为 unknown：崩溃后恢复时收费请求不会被重发（免费节点恢复时会重置为 not-sent 重跑）。
      node = update(node.id, { status: 'unknown', attempts: attempt, idempotencyKeys: [...node.idempotencyKeys, idempotencyKey].slice(-MAX_KEYS), recoveryAttempted: false, error: undefined });
      await persist();
      if (signal.aborted) {
        node = update(node.id, { status: 'not-sent', attempts: attempt - 1 });
        return { ok: false };
      }
      emitNode(node, 'running');
      let resultReceived = false;
      try {
        const raw = await definition.call({ nodeId: node.id, attempt, idempotencyKey, signal });
        resultReceived = true;
        definition.validate?.(raw);
        const result = toJson(raw);
        const receiptId = isRecord(result) && typeof result.receiptId === 'string' ? result.receiptId : undefined;
        node = update(node.id, { status: 'received', result, receiptIds: receiptId ? [...node.receiptIds, receiptId].slice(-MAX_KEYS) : node.receiptIds });
        await persist();
        emitNode(node, 'received');
        return { ok: true, result };
      } catch (error) {
        if (fatal) throw fatal;
        const classified = classifyNodeError(error, paid, resultReceived);
        const receiptIds = classified.receiptId ? [...node.receiptIds, classified.receiptId].slice(-MAX_KEYS) : node.receiptIds;
        if (signal.aborted || isCancellation(error)) {
          const status: VideoSpecExecutorNodeStatus = paid && classified.outcome !== 'not-sent' ? 'unknown' : 'not-sent';
          node = update(node.id, { status, receiptIds, error: { code: 'VIDEO_SPEC_EXECUTOR_CANCELLED', message: '运行已取消。', action: 'cancelled', outcome: status === 'unknown' ? 'unknown' : 'not-sent' } });
          await persist().catch(() => {});
          emitNode(node, status);
          return { ok: false };
        }
        node = update(node.id, { receiptIds });
        let recoveryAttempted = false;
        for (;;) {
          const action = decideUnknownNodeAction({
            paid,
            kind: definition.kind,
            hasReceipt: node.receiptIds.length > 0 || node.idempotencyKeys.length > 0,
            recoverable: !!definition.recover,
            outcome: classified.outcome,
            retry: classified.retry,
            singleRequest: definition.singleRequest === true,
            idempotent: definition.idempotent === true,
            recoveryAttempted,
            budget,
            nodeId: node.id,
          });
          const nodeError: VideoSpecExecutorNodeErrorInfo = { code: classified.code, message: classified.message, action, outcome: classified.outcome };
          if (action === 'recover-from-receipt') {
            recoveryAttempted = true;
            const recovered = await tryRecover(definition);
            if (recovered.ok) return recovered;
            node = nodes.get(node.id)!;
            continue;
          }
          if (action === 'auto-retry') {
            budget = consumeRetryBudget(budget, node.id);
            node = update(node.id, { status: 'not-sent', autoRetries: node.autoRetries + 1, error: nodeError });
            await persist();
            emitNode(node, 'retrying');
            await delay(options.retryDelayMs?.(node.autoRetries, node.id) ?? providerBackoffMs(node.autoRetries, { baseMs: 1000, maxMs: 15_000, retryAfterMs: classified.retryAfterMs }), signal);
            break;
          }
          // await-user / fail
          const status: VideoSpecExecutorNodeStatus = !paid ? 'rejected' : classified.outcome === 'not-sent' ? 'not-sent' : classified.outcome === 'rejected' ? 'rejected' : 'unknown';
          node = update(node.id, { status, error: nodeError, recoveryAttempted: recoveryAttempted || node.recoveryAttempted });
          await persist();
          emitNode(node, status);
          return { ok: false };
        }
      }
    }
  };

  const stage = (name: VideoSpecExecutorStage, state: Extract<VideoSpecExecutorEvent, { type: 'stage' }>['state']) => emit({ type: 'stage', stage: name, state });
  const onTaskError = (error: unknown) => {
    if (!fatal) {
      fatal = error;
      controller.abort(error);
    }
  };

  let timed: VideoSpec | undefined;
  let filmRef: string | undefined;
  let gate: (GateResult & { advisory: true }) | undefined;
  try {
    // 1. 配音
    stage('voice', 'start');
    await mapWithConcurrency(narrated, voiceLimit, signal, async scene => {
      const text = scene.narration!.text;
      await executeNode<VoiceSynthesisResult>({
        id: videoSpecExecutorNodeId.voice(scene.id),
        kind: 'voice',
        sceneId: scene.id,
        hash: videoSpecExecutorHash({ text, voiceProfile: options.voiceProfile ?? null }),
        singleRequest: options.voiceSingleRequest ?? true,
        idempotent: options.voiceIdempotent ?? false,
        call: context => deps.synthesizeVoice({ ...context, sceneId: scene.id, text, ...(options.voiceProfile ? { voiceProfile: options.voiceProfile } : {}) }),
        validate: result => {
          const voice = readVoice(toJson(result));
          if (!voice || !Number.isFinite(voice.durationMs) || voice.durationMs <= 0 || !voice.ref.trim()) throw new AppError('VIDEO_SPEC_EXECUTOR_RESULT_INVALID', `场景 "${scene.id}" 的配音结果缺少文件或时长。`);
        },
        ...(deps.recover?.voice ? { recover: (request: RecoverRequest) => deps.recover!.voice!(request) } : {}),
      });
    }, onTaskError);
    const timings = new Map<string, VoiceTiming>();
    for (const scene of narrated) {
      const voice = nodes.get(videoSpecExecutorNodeId.voice(scene.id));
      const timing = voice?.status === 'received' ? readVoice(voice.result) : undefined;
      if (timing) timings.set(scene.id, timing);
    }
    if (!signal.aborted && timings.size === narrated.length) {
      stage('voice', 'done');
      timed = applyVoiceTimings(spec, timings, options.timing);
    } else {
      stage('voice', signal.aborted ? 'skipped' : 'blocked');
    }

    // 2. 场景（并行 + 失败隔离）
    if (timed && !signal.aborted) {
      const timedSpec = timed;
      stage('scenes', 'start');
      await mapWithConcurrency(timedSpec.scenes, sceneLimit, signal, async scene => {
        let authored: SceneAuthorResult = null;
        let authorHash: string | null = null;
        if (deps.authorScene) {
          const authorId = videoSpecExecutorNodeId.author(scene.id);
          const hash = videoSpecExecutorHash({ scene, canvas: timedSpec.canvas, style: timedSpec.style ?? null, route: timedSpec.route });
          const outcome = await executeNode<SceneAuthorResult>({
            id: authorId,
            kind: 'author',
            sceneId: scene.id,
            hash,
            singleRequest: options.authorSingleRequest ?? false,
            idempotent: options.authorIdempotent ?? false,
            call: context => deps.authorScene!({ ...context, spec: timedSpec, scene }),
            ...(deps.recover?.author ? { recover: (request: RecoverRequest) => deps.recover!.author!(request) } : {}),
          });
          if (!outcome.ok) return;
          authored = (outcome.result ?? null) as SceneAuthorResult;
          const authorNode = nodes.get(authorId)!;
          authorHash = videoSpecExecutorHash({ hash: authorNode.hash, attempts: authorNode.attempts, result: authorNode.result ?? null });
        }
        await executeNode<SceneRenderResult>({
          id: videoSpecExecutorNodeId.render(scene.id),
          kind: 'render',
          sceneId: scene.id,
          hash: videoSpecExecutorHash({ scene, canvas: timedSpec.canvas, authored: authorHash }),
          call: context => deps.renderScene({
            ...context, spec: timedSpec, scene, authored,
            onProgress: progress => emit({ type: 'scene-progress', sceneId: scene.id, captured: progress.captured, total: progress.total }),
          }),
          validate: result => {
            if (!result || typeof result.ref !== 'string' || !result.ref) throw new AppError('VIDEO_SPEC_EXECUTOR_RESULT_INVALID', `场景 "${scene.id}" 的渲染结果缺少片段文件。`);
            if (result.frames !== scene.durationFrames) throw new AppError('VIDEO_SPEC_EXECUTOR_FRAME_MISMATCH', `场景 "${scene.id}" 渲染了 ${String(result.frames)} 帧，VideoSpec 要求 ${scene.durationFrames} 帧。`);
          },
        });
      }, onTaskError);
      if (fatal) throw fatal;
      const renders = timedSpec.scenes.map(scene => nodes.get(videoSpecExecutorNodeId.render(scene.id)));
      stage('scenes', signal.aborted ? 'skipped' : renders.every(node => node?.status === 'received') ? 'done' : 'blocked');

      // 3. 音频时间线（不依赖场景，场景失败时也照常渲染，单场景重试后可以直接复用）
      let audioRef: string | undefined;
      if (!signal.aborted) {
        stage('audio', 'start');
        const audio = await executeNode<AudioRenderResult>({
          id: 'audio',
          kind: 'audio',
          hash: videoSpecExecutorHash({ audio: timedSpec.audio, durationFrames: timedSpec.durationFrames, fps: timedSpec.canvas.fps, loudness: timedSpec.loudness }),
          call: context => deps.renderAudio({ ...context, spec: timedSpec }),
          validate: result => { if (!result || typeof result.ref !== 'string' || !result.ref) throw new AppError('VIDEO_SPEC_EXECUTOR_RESULT_INVALID', '音频时间线渲染结果缺少文件。'); },
        });
        audioRef = audio.ok ? readRef(audio.result) : undefined;
        stage('audio', audioRef ? 'done' : signal.aborted ? 'skipped' : 'blocked');
      }

      // 4. 封装 / 编码
      if (!signal.aborted && audioRef && renders.every(node => node?.status === 'received' && readRef(node.result))) {
        stage('mux', 'start');
        const audioNode = nodes.get('audio')!;
        const segments: MuxSegment[] = timedSpec.scenes.map((scene, index) => ({ sceneId: scene.id, ref: readRef(renders[index]!.result)!, startFrame: scene.startFrame, durationFrames: scene.durationFrames }));
        const audioPath = audioRef;
        const mux = await executeNode<MuxResult>({
          id: 'mux',
          kind: 'mux',
          hash: videoSpecExecutorHash({
            renders: renders.map(node => ({ id: node!.id, hash: node!.hash, attempts: node!.attempts, result: node!.result ?? null })),
            audio: { hash: audioNode.hash, attempts: audioNode.attempts, result: audioNode.result ?? null },
            canvas: timedSpec.canvas,
            outputs: timedSpec.outputs,
            durationFrames: timedSpec.durationFrames,
          }),
          call: context => deps.mux({ ...context, spec: timedSpec, segments, audioRef: audioPath }),
          validate: result => { if (!result || typeof result.ref !== 'string' || !result.ref) throw new AppError('VIDEO_SPEC_EXECUTOR_RESULT_INVALID', '封装结果缺少成片文件。'); },
        });
        filmRef = mux.ok ? readRef(mux.result) : undefined;
        stage('mux', filmRef ? 'done' : signal.aborted ? 'skipped' : 'blocked');
      } else if (!signal.aborted) {
        stage('mux', 'blocked');
      }

      // 5. 成片复检（只做提示）
      if (filmRef && deps.gate && !signal.aborted) {
        stage('gate', 'start');
        const muxNode = nodes.get('mux')!;
        const film = filmRef;
        const outcome = await executeNode<GateResult>({
          id: 'gate',
          kind: 'gate',
          hash: videoSpecExecutorHash({ mux: muxNode.hash, attempts: muxNode.attempts, result: muxNode.result ?? null }),
          call: context => deps.gate!({ ...context, spec: timedSpec, filmRef: film }),
        });
        const gateNode = nodes.get('gate')!;
        if (outcome.ok && isRecord(outcome.result) && typeof outcome.result.status === 'string') {
          gate = { status: outcome.result.status as GateResult['status'], ...(typeof outcome.result.summary === 'string' ? { summary: outcome.result.summary } : {}), advisory: true };
        } else {
          gate = { status: 'error', summary: gateNode.error ? `${gateNode.error.code}: ${gateNode.error.message}` : '成片复检未完成。', advisory: true };
        }
        stage('gate', 'done');
      }
    }
  } finally {
    options.signal?.removeEventListener('abort', onExternalAbort);
  }
  if (fatal) throw fatal;
  await persist();

  const failures: VideoSpecExecutorFailure[] = [];
  for (const id of plannedIds) {
    const node = nodes.get(id);
    if (!node || node.status === 'received' || id === 'gate') continue;
    if (node.status === 'not-sent' && !node.error) continue;
    failures.push({
      nodeId: node.id, kind: node.kind, ...(node.sceneId ? { sceneId: node.sceneId } : {}), status: node.status,
      code: node.error?.code ?? (node.status === 'unknown' ? 'VIDEO_SPEC_EXECUTOR_RESULT_UNKNOWN' : 'VIDEO_SPEC_EXECUTOR_NODE_FAILED'),
      message: node.error?.message ?? (node.status === 'unknown' ? '上次运行时请求已发出但结果未知（可能是进程中断）。' : '节点失败。'),
      action: node.error?.action ?? (node.status === 'unknown' ? 'await-user' : 'fail'),
      hint: failureHint(node),
    });
  }
  const status: VideoSpecExecutorResult['status'] = options.signal?.aborted ? 'cancelled' : filmRef ? 'completed' : 'blocked';
  return { status, ...(timed ? { spec: timed } : {}), ...(filmRef ? { filmRef } : {}), ...(gate ? { gate } : {}), failures, checkpoint: snapshot() };
}
