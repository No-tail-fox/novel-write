/**
 * AudioTimeline（backlog E-3，底座 §8.2）：把 VideoSpec v1 的整条音频时间线编译成**一张** ffmpeg filter graph。
 *
 * - 只用于新项目（ADR-03）：调用方用 `audioTimelineStrategy(project)` 判断；旧路线的混音
 *   （lemo-upstream-video `buildMuxAudioFilter`、Storybound sidecar、director-renderer）一律不动。
 * - **采样数是唯一时钟**：片段起点 = `sampleAt(startFrame)`、长度 = `sampleAt(durationFrames)`，
 *   淡入淡出也按整数采样（`afade ss/ns`），延迟用 `adelay=…S`（采样单位），没有浮点毫秒漂移。
 * - 全程 48 kHz / float / 立体声；每条音轨先混成一路并补齐到整片长度，music 等轨按 `ducking` 做
 *   `sidechaincompress` 侧链闪避，最后总混 → apad/atrim 到精确总采样数 → loudnorm（第二遍）→ 48 kHz。
 *   单声道素材按 ffmpeg 默认的等功率方式升成立体声（每声道 −3 dB）。
 * - 纯模块：不引入 Node / Electron；只产出参数和 graph 文本，执行在 electron/audio-timeline-renderer.ts。
 */
import { AppError } from './app-error';
import {
  loudnormApplyFilter, loudnormMeasureFilter, isUsableLoudnormMeasurement,
  type LoudnessTarget, type LoudnormMeasurement,
} from './loudness';
import {
  VIDEO_SPEC_SAMPLE_RATE, formatVideoSpecIssue, projectUsesVideoSpec, sampleAt, validateVideoSpec,
  type VideoSpec, type VideoSpecAudioClip, type VideoSpecAudioTrack, type VideoSpecIssue,
} from './video-spec';

// ───────────────────────────── 错误 ─────────────────────────────

export type AudioTimelineErrorCode =
  | 'AUDIO_TIMELINE_SPEC_INVALID'
  | 'AUDIO_TIMELINE_INPUT_MISSING'
  | 'AUDIO_TIMELINE_INPUT_INVALID'
  | 'AUDIO_TIMELINE_FFMPEG_MISSING'
  | 'AUDIO_TIMELINE_MEASURE_FAILED'
  | 'AUDIO_TIMELINE_RENDER_FAILED'
  | 'AUDIO_TIMELINE_OUTPUT_INVALID'
  | 'AUDIO_TIMELINE_DURATION_MISMATCH'
  | 'AUDIO_TIMELINE_TIMEOUT'
  | 'AUDIO_TIMELINE_CANCELLED';

export class AudioTimelineError extends AppError {
  constructor(code: AudioTimelineErrorCode, message: string, readonly issues: VideoSpecIssue[] = [], retryable = false) {
    super(code, message, retryable);
  }
}

// ───────────────────────────── 策略开关 ─────────────────────────────

export type AudioTimelineStrategy = 'timeline' | 'legacy';

/** ADR-03：只有带 `videoSpecVersion` 的新项目走整条时间线混音；旧项目继续用各路线原有的混音。尚未接入任何路线。 */
export function audioTimelineStrategy(project: unknown): AudioTimelineStrategy {
  return projectUsesVideoSpec(project) ? 'timeline' : 'legacy';
}

// ───────────────────────────── 常量 ─────────────────────────────

export const AUDIO_TIMELINE_CHANNEL_LAYOUT = 'stereo' as const;
export const AUDIO_TIMELINE_CHANNELS = 2 as const;
/** 输出标签（`-map [aout]`）。 */
export const AUDIO_TIMELINE_OUTPUT_LABEL = 'aout' as const;

/**
 * 闪避 → sidechaincompress 参数映射。spec 只给“压低多少 dB”，压缩器要的是阈值 + 比率：
 * 阈值固定在 −50 dBFS（任何正常的旁白都会越过），按“名义旁白电平 −20 dBFS（RMS）时恰好压低 reductionDb”
 * 反推比率：reduction = (nominal − threshold) × (1 − 1/ratio)。比率上限 20（ffmpeg 限制），
 * 因此单次最多约 28.5 dB。【未核实听感】旁白实际电平偏离名义值时，闪避量按 (1 − 1/ratio) 的斜率随之变化。
 */
export const AUDIO_TIMELINE_DUCKING = Object.freeze({ thresholdDb: -50, nominalTriggerDb: -20, maxRatio: 20 });

// ───────────────────────────── 结果类型 ─────────────────────────────

export type AudioTimelineLoudnormMode = 'measure' | 'apply' | 'skip' | 'off';

export interface AudioTimelineClipPlan {
  clipId: string;
  trackId: string;
  inputIndex: number;
  path: string;
  /** 在整条时间线上的起点（48 kHz 采样）。 */
  delaySamples: number;
  lengthSamples: number;
  sourceStartSamples: number;
  fadeInSamples: number;
  fadeOutSamples: number;
  gainDb: number;
  loop: boolean;
  label: string;
}

export interface AudioTimelineTrackPlan {
  trackId: string;
  kind: VideoSpecAudioTrack['kind'];
  clipIds: string[];
  /** gainDb + targetDb（targetDb 沿用旧 `bgm_target_db` 语义：固定增益，见文件说明）。 */
  gainDb: number;
  /** 实际生效的闪避（触发轨没有片段时不生效）。 */
  ducking: { triggerTrackIds: string[]; ratio: number; thresholdDb: number; attackMs: number; releaseMs: number; reductionDb: number } | null;
  label: string;
}

export interface AudioTimelineGraph {
  /** 完整的 ffmpeg 输入参数（按输入序号排列，例如 `['-i', 'file:a.wav', '-stream_loop', '-1', '-i', 'file:bgm.mp3']`）。 */
  inputs: string[];
  /** 每个输入序号对应的原始文件路径。 */
  inputPaths: string[];
  filterComplex: string;
  outputLabel: typeof AUDIO_TIMELINE_OUTPUT_LABEL;
  durationSamples: number;
  sampleRate: typeof VIDEO_SPEC_SAMPLE_RATE;
  channels: typeof AUDIO_TIMELINE_CHANNELS;
  loudnorm: AudioTimelineLoudnormMode;
  loudnessTarget: LoudnessTarget;
  clips: AudioTimelineClipPlan[];
  tracks: AudioTimelineTrackPlan[];
  /** 校验后（补齐默认值）的 spec。 */
  spec: VideoSpec;
}

export interface BuildAudioTimelineGraphOptions {
  /**
   * loudnorm 第二遍的测量值：
   * - `undefined`：生成第一遍测量用的 graph（`print_format=json`）；
   * - 测量对象：线性应用（`linear=true`）；
   * - `null`：静音或低于门限、无法测量 → 跳过标准化。
   * `spec.loudness.normalize === false` 时一律不做 loudnorm。
   */
  loudnorm?: LoudnormMeasurement | null;
}

// ───────────────────────────── 构建 ─────────────────────────────

const fmt = (value: number) => {
  if (!Number.isFinite(value)) throw new AudioTimelineError('AUDIO_TIMELINE_SPEC_INVALID', `filter 参数必须是有限数字（收到 ${String(value)}）`);
  const text = String(Number(value.toFixed(6)));
  return text === '-0' ? '0' : text;
};

/** ffmpeg 输入路径：拒绝空路径和控制字符；统一加 `file:` 前缀，避免被当成选项（`-x`）或协议（`concat:`、`http:`）。 */
export function ffmpegInputUrl(path: string): string {
  if (typeof path !== 'string' || !path.trim()) throw new AudioTimelineError('AUDIO_TIMELINE_INPUT_INVALID', '音频文件路径为空。');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/u.test(path)) throw new AudioTimelineError('AUDIO_TIMELINE_INPUT_INVALID', `音频文件路径包含控制字符：${JSON.stringify(path)}`);
  return path.startsWith('file:') ? path : `file:${path}`;
}

function parseSpec(input: unknown): VideoSpec {
  const result = validateVideoSpec(input);
  if (result.ok) return result.spec;
  const shown = result.issues.slice(0, 5).map(formatVideoSpecIssue).join('；');
  throw new AudioTimelineError('AUDIO_TIMELINE_SPEC_INVALID', `VideoSpec 不合法，无法生成音频时间线：${shown}${result.issues.length > 5 ? `；另有 ${result.issues.length - 5} 处问题` : ''}`, result.issues);
}

function resolveClipPath(clip: VideoSpecAudioClip, inputs: ReadonlyMap<string, string>): string {
  const path = inputs.get(clip.id) ?? inputs.get(clip.ref);
  if (path === undefined) throw new AudioTimelineError('AUDIO_TIMELINE_INPUT_MISSING', `音频片段 "${clip.id}" 没有对应的本地文件（引用：${clip.ref}）。`);
  return path;
}

function duckingRatio(reductionDb: number): number {
  const headroom = AUDIO_TIMELINE_DUCKING.nominalTriggerDb - AUDIO_TIMELINE_DUCKING.thresholdDb;
  const fraction = reductionDb / headroom;
  if (fraction >= 1 - 1 / AUDIO_TIMELINE_DUCKING.maxRatio) return AUDIO_TIMELINE_DUCKING.maxRatio;
  return Math.max(1, Number((1 / (1 - fraction)).toFixed(4)));
}

/** 第一遍（测量）/第二遍（应用）都用这一张 graph；只有最后的 loudnorm 段不同。 */
export function buildAudioTimelineGraph(specInput: unknown, inputs: ReadonlyMap<string, string>, options: BuildAudioTimelineGraphOptions = {}): AudioTimelineGraph {
  const spec = parseSpec(specInput);
  const fps = spec.canvas.fps;
  const total = sampleAt(spec.durationFrames, fps);
  const samplesPerMs = VIDEO_SPEC_SAMPLE_RATE / 1000; // 48，整数
  const target: LoudnessTarget = { integratedLufs: spec.loudness.integratedLufs, truePeakDb: spec.loudness.truePeakDb, lra: spec.loudness.lra };
  const normalizeChain = `aresample=${VIDEO_SPEC_SAMPLE_RATE},aformat=sample_fmts=fltp:sample_rates=${VIDEO_SPEC_SAMPLE_RATE}:channel_layouts=${AUDIO_TIMELINE_CHANNEL_LAYOUT}`;
  const exact = (samples: number) => `apad=whole_len=${samples},atrim=end_sample=${samples},asetpts=PTS-STARTPTS`;

  const inputArgs: string[] = [];
  const inputPaths: string[] = [];
  const segments: string[] = [];
  const clips: AudioTimelineClipPlan[] = [];
  const trackPlans: AudioTimelineTrackPlan[] = [];

  // 1) 片段：每个片段一个输入（同一文件被多个片段引用时也各开一路，避免 asplit 在长延迟下堆积缓冲）。
  const trackClipLabels = new Map<string, string[]>();
  spec.audio.tracks.forEach((track, trackIndex) => {
    const labels: string[] = [];
    const ordered = track.clips.map((clip, index) => ({ clip, index })).sort((a, b) => a.clip.startFrame - b.clip.startFrame || a.index - b.index);
    for (const { clip } of ordered) {
      const path = resolveClipPath(clip, inputs);
      const inputIndex = inputPaths.length;
      if (clip.loop) inputArgs.push('-stream_loop', '-1');
      inputArgs.push('-i', ffmpegInputUrl(path));
      inputPaths.push(path);
      const length = sampleAt(clip.durationFrames, fps);
      const delay = sampleAt(clip.startFrame, fps);
      const sourceStart = clip.sourceStartMs * samplesPerMs;
      const fadeIn = sampleAt(clip.fadeInFrames, fps);
      const fadeOut = sampleAt(clip.fadeOutFrames, fps);
      const label = `c${trackIndex}_${clips.length}`;
      const chain = [
        normalizeChain,
        'asetpts=PTS-STARTPTS',
        `atrim=start_sample=${sourceStart}:end_sample=${sourceStart + length}`,
        'asetpts=PTS-STARTPTS',
        // 源文件比片段短（且不循环）时补静音，保证片段恰好 length 个采样。
        exact(length),
        ...(clip.gainDb !== 0 ? [`volume=${fmt(clip.gainDb)}dB`] : []),
        ...(fadeIn > 0 ? [`afade=t=in:ss=0:ns=${fadeIn}`] : []),
        ...(fadeOut > 0 ? [`afade=t=out:ss=${length - fadeOut}:ns=${fadeOut}`] : []),
        ...(delay > 0 ? [`adelay=delays=${delay}S:all=1`] : []),
      ];
      segments.push(`[${inputIndex}:a:0]${chain.join(',')}[${label}]`);
      clips.push({ clipId: clip.id, trackId: track.id, inputIndex, path, delaySamples: delay, lengthSamples: length, sourceStartSamples: sourceStart, fadeInSamples: fadeIn, fadeOutSamples: fadeOut, gainDb: clip.gainDb, loop: clip.loop, label });
      labels.push(label);
    }
    trackClipLabels.set(track.id, labels);
  });

  // 2) 轨内混音 + 轨增益 + 补齐到整片长度。
  const activeTracks = spec.audio.tracks.filter(track => (trackClipLabels.get(track.id) ?? []).length > 0);
  const activeIds = new Set(activeTracks.map(track => track.id));
  const trackLabel = new Map<string, string>();
  activeTracks.forEach(track => {
    const index = spec.audio.tracks.indexOf(track);
    const labels = trackClipLabels.get(track.id)!;
    const label = `t${index}`;
    const gain = track.gainDb + (track.targetDb ?? 0);
    const mix = labels.length > 1
      ? `${labels.map(item => `[${item}]`).join('')}amix=inputs=${labels.length}:duration=longest:dropout_transition=0:normalize=0`
      : `[${labels[0]}]anull`;
    segments.push(`${mix},${gain !== 0 ? `volume=${fmt(gain)}dB,` : ''}${exact(total)}[${label}]`);
    trackLabel.set(track.id, label);
  });

  // 3) 侧链闪避：触发轨用“闪避前”的信号（避免环形依赖）；需要多路时 asplit。
  const duckPlans = new Map<string, NonNullable<AudioTimelineTrackPlan['ducking']>>();
  for (const track of activeTracks) {
    if (!track.ducking) continue;
    const triggers = track.ducking.triggerTrackIds.filter(id => activeIds.has(id) && id !== track.id);
    if (!triggers.length) continue;
    duckPlans.set(track.id, {
      triggerTrackIds: triggers,
      ratio: duckingRatio(track.ducking.reductionDb),
      thresholdDb: AUDIO_TIMELINE_DUCKING.thresholdDb,
      attackMs: Math.max(0.01, track.ducking.attackMs),
      releaseMs: Math.max(0.01, track.ducking.releaseMs),
      reductionDb: track.ducking.reductionDb,
    });
  }
  const consumers = new Map<string, string[]>();
  for (const track of activeTracks) consumers.set(track.id, ['mix']);
  for (const [duckedId, plan] of duckPlans) for (const trigger of plan.triggerTrackIds) consumers.get(trigger)!.push(`sc:${duckedId}`);
  const tapLabel = new Map<string, string>(); // `${trackId}|${consumer}` → label
  for (const track of activeTracks) {
    const base = trackLabel.get(track.id)!;
    const list = consumers.get(track.id)!;
    if (list.length === 1) { tapLabel.set(`${track.id}|mix`, base); continue; }
    const outs = list.map((_, index) => `${base}s${index}`);
    segments.push(`[${base}]asplit=${list.length}${outs.map(item => `[${item}]`).join('')}`);
    list.forEach((consumer, index) => tapLabel.set(`${track.id}|${consumer}`, outs[index]));
  }
  const finalTrackLabels: string[] = [];
  for (const track of activeTracks) {
    const index = spec.audio.tracks.indexOf(track);
    const main = tapLabel.get(`${track.id}|mix`)!;
    const plan = duckPlans.get(track.id);
    if (!plan) { finalTrackLabels.push(main); continue; }
    const taps = plan.triggerTrackIds.map(trigger => tapLabel.get(`${trigger}|sc:${track.id}`)!);
    let side = taps[0];
    if (taps.length > 1) {
      side = `sc${index}`;
      segments.push(`${taps.map(item => `[${item}]`).join('')}amix=inputs=${taps.length}:duration=longest:dropout_transition=0:normalize=0[${side}]`);
    }
    const ducked = `d${index}`;
    const threshold = 10 ** (plan.thresholdDb / 20);
    segments.push(`[${main}][${side}]sidechaincompress=threshold=${fmt(threshold)}:ratio=${fmt(plan.ratio)}:attack=${fmt(plan.attackMs)}:release=${fmt(plan.releaseMs)}:makeup=1:detection=rms,${exact(total)}[${ducked}]`);
    finalTrackLabels.push(ducked);
  }
  for (const track of spec.audio.tracks) {
    trackPlans.push({
      trackId: track.id,
      kind: track.kind,
      clipIds: clips.filter(clip => clip.trackId === track.id).map(clip => clip.clipId),
      gainDb: track.gainDb + (track.targetDb ?? 0),
      ducking: duckPlans.get(track.id) ?? null,
      label: trackLabel.get(track.id) ?? '',
    });
  }

  // 4) 总混 → 精确长度 → loudnorm → 48 kHz → 再次精确长度（loudnorm 内部升到 192 kHz）。
  let mixHead: string;
  if (!finalTrackLabels.length) mixHead = `anullsrc=r=${VIDEO_SPEC_SAMPLE_RATE}:cl=${AUDIO_TIMELINE_CHANNEL_LAYOUT}`;
  else if (finalTrackLabels.length === 1) mixHead = `[${finalTrackLabels[0]}]anull`;
  else mixHead = `${finalTrackLabels.map(item => `[${item}]`).join('')}amix=inputs=${finalTrackLabels.length}:duration=longest:dropout_transition=0:normalize=0`;
  segments.push(`${mixHead},${exact(total)},aresample=${VIDEO_SPEC_SAMPLE_RATE}[mix]`);

  let mode: AudioTimelineLoudnormMode;
  let loudnormFilter: string;
  if (!spec.loudness.normalize) { mode = 'off'; loudnormFilter = 'anull'; }
  else if (options.loudnorm === undefined) { mode = 'measure'; loudnormFilter = loudnormMeasureFilter(target); }
  else if (options.loudnorm === null || !isUsableLoudnormMeasurement(options.loudnorm)) { mode = 'skip'; loudnormFilter = 'anull'; }
  else { mode = 'apply'; loudnormFilter = loudnormApplyFilter(options.loudnorm, target); }
  segments.push(`[mix]${loudnormFilter},${normalizeChain},${exact(total)}[${AUDIO_TIMELINE_OUTPUT_LABEL}]`);

  return {
    inputs: inputArgs,
    inputPaths,
    filterComplex: segments.join(';'),
    outputLabel: AUDIO_TIMELINE_OUTPUT_LABEL,
    durationSamples: total,
    sampleRate: VIDEO_SPEC_SAMPLE_RATE,
    channels: AUDIO_TIMELINE_CHANNELS,
    loudnorm: mode,
    loudnessTarget: target,
    clips,
    tracks: trackPlans,
    spec,
  };
}
