/**
 * VideoSpec / Timeline v1 —— 三条路线（模板 / HTML / 创意）共用的唯一分镜数据模型（backlog O-2，底座 L3）。
 *
 * 设计要点（详见 docs/design/2026-11-10-video-spec.md）：
 * - **整数帧是唯一事实源**：场景、字幕 cue、音频片段一律用整数帧表示；毫秒只由 `msAt()` 推导，
 *   48 kHz 采样数由 `sampleAt()` 推导（24/30 fps 下每帧恰好 2000/1600 个采样，没有小数）。
 * - **只用于新项目**（ADR-03）：`projectUsesVideoSpec(project)` 只对带 `videoSpecVersion` 的新项目为真；
 *   旧项目继续走旧路径。本模块只导出模型与转换函数，不接入任何现有执行器（接入属于 O-3）。
 * - **fps 只允许 24 / 30**，创建时锁定（ADR-15）；色彩标签 tv + bt709（ADR-10）；
 *   响度默认 −14 LUFS / 真峰值 −1 dBTP（ADR-01，复用 ./loudness 的 FINAL_FILM_LOUDNESS）。
 * - 纯模块：不引入 Node / Electron，渲染进程、主进程和测试都能用。现有类型只做 `import type`，不改动。
 */
import { z } from 'zod';
import { AppError } from './app-error';
import { FINAL_FILM_LOUDNESS } from './loudness';
import { htmlVideoBgmTargetDb } from './html-video-config';
import type { DirectorTransition } from './director-transitions';
import type {
  HtmlVideoPipelineDataV2,
  HtmlVideoTimedCaptionCue,
  StoryboardScene,
  SubtitleCue,
  TaskArtifactAssetPreview,
  TaskArtifactVideoPreview,
} from './types';

// ───────────────────────────── 版本与常量 ─────────────────────────────

/** 当前 VideoSpec 版本。不兼容的结构变化必须升版本并在 `migrateVideoSpec` 里写迁移。 */
export const VIDEO_SPEC_VERSION = 1 as const;
export const VIDEO_SPEC_FPS_OPTIONS = [24, 30] as const;
export type VideoSpecFps = (typeof VIDEO_SPEC_FPS_OPTIONS)[number];
/** 音频时钟（底座 §8.2）：全程 48 kHz。 */
export const VIDEO_SPEC_SAMPLE_RATE = 48_000 as const;
export const VIDEO_SPEC_ROUTES = ['template', 'html', 'creative'] as const;
export type VideoSpecRoute = (typeof VIDEO_SPEC_ROUTES)[number];
export const VIDEO_SPEC_ADAPTER_KINDS = ['hyperframes', 'lemo', 'template', 'video', 'still'] as const;
export type VideoSpecAdapterKind = (typeof VIDEO_SPEC_ADAPTER_KINDS)[number];
export const VIDEO_SPEC_TRANSITION_TYPES = ['cut', 'fade', 'dissolve', 'wipeleft', 'wiperight', 'slideleft', 'slideright'] as const;
export const VIDEO_SPEC_AUDIO_TRACK_KINDS = ['narration', 'music', 'sfx'] as const;
/** 单条片子的上限（2 小时），防止离谱的帧号溢出到后续计算。 */
const MAX_TOTAL_FRAMES = 30 * 60 * 60 * 2;
const MAX_TEXT = 20_000;
const MAX_REF = 4_096;

// ───────────────────────────── 时间换算 ─────────────────────────────

function assertFps(fps: number): asserts fps is VideoSpecFps {
  if (fps !== 24 && fps !== 30) throw new AppError('VIDEO_SPEC_FPS_INVALID', `fps 只支持 24 或 30（收到 ${String(fps)}）。`);
}

/**
 * 毫秒 → 帧号（四舍五入，0.5 进位；与现有 `allocateHtmlVideoSceneFrameCounts` 的 `floor(x + 0.5)` 一致）。
 * 整数毫秒走纯整数运算，没有浮点漂移。
 */
export function frameAt(ms: number, fps: VideoSpecFps): number {
  assertFps(fps);
  if (!Number.isFinite(ms) || ms < 0) throw new AppError('VIDEO_SPEC_TIME_INVALID', `时间必须是非负有限毫秒数（收到 ${String(ms)}）。`);
  return Math.floor((ms * fps + 500) / 1000);
}

/** 帧号 → 毫秒（精确有理数换算，24 fps 下会有小数，例如第 1 帧 = 41.666… ms）。`frameAt(msAt(n)) === n` 恒成立。 */
export function msAt(frame: number, fps: VideoSpecFps): number {
  assertFps(fps);
  assertFrame(frame, '帧号');
  return (frame * 1000) / fps;
}

/** 帧号 → 48 kHz 采样数。24/30 fps 下恒为整数（2000 / 1600 采样每帧）。 */
export function sampleAt(frame: number, fps: VideoSpecFps): number {
  assertFps(fps);
  assertFrame(frame, '帧号');
  return (frame * VIDEO_SPEC_SAMPLE_RATE) / fps;
}

function assertFrame(frame: number, label: string) {
  if (!Number.isSafeInteger(frame) || frame < 0) throw new AppError('VIDEO_SPEC_TIME_INVALID', `${label}必须是非负整数（收到 ${String(frame)}）。`);
}

/**
 * 按累计时钟分配整数帧（音频优先：边界 = frameAt(累计毫秒)，每段至少 1 帧）。
 * 这是规范实现（O-3 统一执行器只用它）。与 `src/shared/html-video.ts` 的 `allocateHtmlVideoSceneFrameCounts` 算法相同，
 * 但**不逐值相同**（tests/frame-allocation-equivalence.test.ts）：30 fps 下累计时长恰好落在半帧时（如 2050 ms = 61.5 帧），
 * 旧函数的秒浮点累加会向下取整、这里按整数运算 0.5 进位；旧函数还接受 25 fps 等任意 fps、抛普通 Error。
 * 因此旧函数保持原样、不委托到这里（ADR-03：旧项目输出逐字节不变）。
 */
export function allocateFrameCounts(durationsMs: readonly number[], fps: VideoSpecFps, startOffsetMs = 0): number[] {
  assertFps(fps);
  if (!Number.isFinite(startOffsetMs) || startOffsetMs < 0) throw new AppError('VIDEO_SPEC_TIME_INVALID', '起始偏移必须是非负毫秒数。');
  let elapsedMs = startOffsetMs;
  let previousEnd = startOffsetMs > 0 ? Math.max(1, frameAt(startOffsetMs, fps)) : 0;
  return durationsMs.map((duration, index) => {
    if (!Number.isFinite(duration) || duration <= 0) throw new AppError('VIDEO_SPEC_TIME_INVALID', `第 ${index + 1} 段时长必须是正数毫秒（收到 ${String(duration)}）。`);
    elapsedMs += duration;
    const end = Math.max(previousEnd + 1, frameAt(elapsedMs, fps));
    const count = end - previousEnd;
    previousEnd = end;
    return count;
  });
}

// ───────────────────────────── schema ─────────────────────────────

const frameNumber = (label: string) => z
  .number({ error: `${label}必须是数字` })
  .int(`${label}必须是整数帧（VideoSpec 只用整数帧计时）`)
  .min(0, `${label}不能为负数`)
  .max(MAX_TOTAL_FRAMES, `${label}超出上限（${MAX_TOTAL_FRAMES} 帧）`);
const positiveFrames = (label: string) => frameNumber(label).min(1, `${label}至少为 1 帧`);
const idString = (label: string) => z
  .string({ error: `${label}必须是字符串` })
  .min(1, `${label}不能为空`)
  .max(64, `${label}最长 64 个字符`)
  .regex(/^[A-Za-z0-9_.:-]+$/u, `${label}只能包含字母、数字和 _ . : -`);
const refString = (label: string) => z
  .string({ error: `${label}必须是字符串` })
  .trim()
  .min(1, `${label}不能为空`)
  .max(MAX_REF, `${label}过长`);
const textString = (label: string) => z.string({ error: `${label}必须是字符串` }).max(MAX_TEXT, `${label}过长（最多 ${MAX_TEXT} 字）`);
const gainDb = (label: string) => z.number({ error: `${label}必须是数字（dB）` }).min(-60, `${label}不能低于 -60 dB`).max(12, `${label}不能高于 +12 dB`);

export const videoSpecFpsSchema = z.union([z.literal(24), z.literal(30)], { error: 'fps 只支持 24 或 30（ADR-15：创建项目时二选一后锁定）' });

const colorSchema = z.strictObject({
  range: z.literal('tv', { error: '色彩范围必须是 tv（ADR-10）' }).default('tv'),
  primaries: z.literal('bt709', { error: '色彩 primaries 必须是 bt709（ADR-10）' }).default('bt709'),
  matrix: z.literal('bt709', { error: '色彩矩阵必须是 bt709（ADR-10）' }).default('bt709'),
  transfer: z.literal('iec61966-2-1', { error: 'transfer 必须是 iec61966-2-1（ADR-10，沿用场景段的 sRGB）' }).default('iec61966-2-1'),
});

const canvasDimension = (label: string) => z
  .number({ error: `${label}必须是数字` })
  .int(`${label}必须是整数像素`)
  .min(16, `${label}至少 16 像素`)
  .max(8192, `${label}最多 8192 像素`)
  .refine(value => value % 2 === 0, `${label}必须是偶数（yuv420p 编码要求）`);

export const videoSpecCanvasSchema = z.strictObject({
  width: canvasDimension('画布宽度'),
  height: canvasDimension('画布高度'),
  fps: videoSpecFpsSchema,
  color: colorSchema.default({ range: 'tv', primaries: 'bt709', matrix: 'bt709', transfer: 'iec61966-2-1' }),
});

export const videoSpecLoudnessSchema = z.strictObject({
  /** false = 保留原始电平（例如 Music MV 显式保留歌曲音量）。 */
  normalize: z.boolean({ error: 'loudness.normalize 必须是布尔值' }).default(true),
  integratedLufs: z.number({ error: '积分响度必须是数字（LUFS）' }).min(-30, '积分响度不能低于 -30 LUFS').max(-5, '积分响度不能高于 -5 LUFS').default(FINAL_FILM_LOUDNESS.integratedLufs),
  truePeakDb: z.number({ error: '真峰值必须是数字（dBTP）' }).min(-9, '真峰值不能低于 -9 dBTP').max(0, '真峰值不能高于 0 dBTP').default(FINAL_FILM_LOUDNESS.truePeakDb),
  lra: z.number({ error: '响度范围必须是数字（LU）' }).min(1, '响度范围不能小于 1 LU').max(20, '响度范围不能大于 20 LU').default(FINAL_FILM_LOUDNESS.lra),
});

const transitionSchema = z.strictObject({
  type: z.enum(VIDEO_SPEC_TRANSITION_TYPES, { error: `转场类型只支持 ${VIDEO_SPEC_TRANSITION_TYPES.join(' / ')}` }),
  durationFrames: frameNumber('转场时长'),
});

const wordSchema = z.strictObject({
  text: textString('词文本').min(1, '词文本不能为空'),
  startFrame: frameNumber('词开始帧'),
  endFrame: frameNumber('词结束帧'),
});

/** 字幕 cue：帧号相对所属场景的开始帧（场景可以整体平移而不改 cue）。区间为 [startFrame, endFrame)。 */
export const videoSpecCueSchema = z.strictObject({
  text: textString('字幕文本').min(1, '字幕文本不能为空'),
  startFrame: frameNumber('字幕开始帧'),
  endFrame: frameNumber('字幕结束帧'),
  source: z.enum(['tts', 'asr', 'estimated', 'manual'], { error: '字幕来源只支持 tts / asr / estimated / manual' }).optional(),
  confidence: z.number().min(0, '置信度在 0 到 1 之间').max(1, '置信度在 0 到 1 之间').optional(),
  words: z.array(wordSchema).optional(),
});

const sourceRefSchema = z.strictObject({
  role: z.enum(['background', 'foreground', 'image', 'video', 'audio', 'html', 'code', 'reference'], { error: '素材角色只支持 background / foreground / image / video / audio / html / code / reference' }),
  ref: refString('素材引用'),
  slot: z.number().int('素材槽位必须是整数').min(0, '素材槽位不能为负数').optional(),
});

const adapterSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('hyperframes'),
    sceneTemplate: refString('HyperFrames 场景模板').optional(),
    compositionRef: refString('HyperFrames composition 引用').optional(),
    motion: refString('镜头运动').optional(),
  }),
  z.strictObject({
    kind: z.literal('lemo'),
    codeRef: refString('Lemo 场景代码引用').optional(),
    styleId: refString('Lemo 风格 id').optional(),
  }),
  z.strictObject({
    kind: z.literal('template'),
    templateId: refString('模板 id'),
    params: z.record(z.string(), z.unknown()).optional(),
  }),
  z.strictObject({
    kind: z.literal('video'),
    videoRef: refString('视频素材引用'),
    trimStartFrame: frameNumber('视频裁切起点').default(0),
    fit: z.enum(['cover', 'contain'], { error: '视频适配方式只支持 cover / contain' }).default('cover'),
    /** 视频素材的原声一律不进混音；声音只来自 AudioTimeline。 */
    muted: z.literal(true, { error: '视频素材必须静音（声音只来自 AudioTimeline）' }).default(true),
  }),
  z.strictObject({
    kind: z.literal('still'),
    imageRef: refString('图片素材引用'),
    motion: refString('镜头运动').optional(),
  }),
], { error: `场景适配器 kind 只支持 ${VIDEO_SPEC_ADAPTER_KINDS.join(' / ')}` });

export const videoSpecSceneSchema = z.strictObject({
  id: idString('场景 id'),
  title: textString('场景标题').optional(),
  /** 旧数据里的场景编号，只用于追溯。 */
  sourceSceneId: z.union([z.number().int(), z.string().max(64)]).optional(),
  startFrame: frameNumber('场景开始帧'),
  durationFrames: positiveFrames('场景时长'),
  transitionIn: transitionSchema.optional(),
  adapter: adapterSchema,
  sources: z.array(sourceRefSchema).default([]),
  narration: z.strictObject({
    text: textString('旁白文本'),
    clipId: idString('旁白片段 id').optional(),
  }).optional(),
  cues: z.array(videoSpecCueSchema).default([]),
});

/** 音频片段：startFrame 是整条时间线上的绝对帧号。 */
export const videoSpecAudioClipSchema = z.strictObject({
  id: idString('音频片段 id'),
  ref: refString('音频文件引用'),
  sceneId: idString('音频片段所属场景 id').optional(),
  startFrame: frameNumber('音频开始帧'),
  durationFrames: positiveFrames('音频时长'),
  /** 从源文件的哪个位置开始取（毫秒，源文件自身的时钟，不受项目 fps 约束）。 */
  sourceStartMs: z.number().int('源文件起点必须是整数毫秒').min(0, '源文件起点不能为负数').default(0),
  gainDb: gainDb('片段增益').default(0),
  fadeInFrames: frameNumber('淡入时长').default(0),
  fadeOutFrames: frameNumber('淡出时长').default(0),
  /** 源文件比片段短时是否循环（BGM 常用）。 */
  loop: z.boolean().default(false),
});

const duckingSchema = z.strictObject({
  /** 这些轨道有声音时压低本轨（侧链闪避）。 */
  triggerTrackIds: z.array(idString('闪避触发轨道 id')).min(1, '闪避规则至少要有 1 条触发轨道'),
  reductionDb: z.number({ error: '闪避量必须是数字（dB）' }).min(1, '闪避量至少 1 dB').max(40, '闪避量最多 40 dB'),
  attackMs: z.number().int('闪避起效时间必须是整数毫秒').min(0, '闪避起效时间不能为负数').max(2000, '闪避起效时间最多 2000 ms').default(50),
  releaseMs: z.number().int('闪避恢复时间必须是整数毫秒').min(0, '闪避恢复时间不能为负数').max(5000, '闪避恢复时间最多 5000 ms').default(300),
});

export const videoSpecAudioTrackSchema = z.strictObject({
  id: idString('音轨 id'),
  kind: z.enum(VIDEO_SPEC_AUDIO_TRACK_KINDS, { error: '音轨类型只支持 narration / music / sfx' }),
  gainDb: gainDb('音轨增益').default(0),
  /** 混音前把本轨归一到的目标电平（dB，沿用现有 `bgm_target_db` 语义）；缺省表示不做轨级归一。 */
  targetDb: z.number().min(-60, '目标电平不能低于 -60 dB').max(0, '目标电平不能高于 0 dB').optional(),
  ducking: duckingSchema.optional(),
  clips: z.array(videoSpecAudioClipSchema).default([]),
});

export const videoSpecAudioSchema = z.strictObject({
  sampleRate: z.literal(VIDEO_SPEC_SAMPLE_RATE, { error: '音频采样率必须是 48000 Hz' }).default(VIDEO_SPEC_SAMPLE_RATE),
  tracks: z.array(videoSpecAudioTrackSchema).default([]),
});

export const videoSpecOutputSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('mp4'),
    videoCodec: z.literal('h264').default('h264'),
    pixelFormat: z.literal('yuv420p').default('yuv420p'),
    audioCodec: z.literal('aac').default('aac'),
    /** 字幕默认在画面里烧录（底座 §8.3）。 */
    burnCaptions: z.boolean().default(true),
    path: refString('成片路径').optional(),
  }),
  z.strictObject({ kind: z.literal('srt'), path: refString('字幕文件路径').optional() }),
  z.strictObject({ kind: z.literal('jianying-draft'), path: refString('剪映草稿目录').optional() }),
  z.strictObject({ kind: z.literal('cover'), ref: refString('封面图片引用').optional() }),
], { error: '输出类型只支持 mp4 / srt / jianying-draft / cover' });

const baseVideoSpecSchema = z.strictObject({
  specVersion: z.literal(VIDEO_SPEC_VERSION, { error: `specVersion 必须是 ${VIDEO_SPEC_VERSION}` }),
  route: z.enum(VIDEO_SPEC_ROUTES, { error: '路线只支持 template / html / creative' }),
  title: textString('标题').optional(),
  canvas: videoSpecCanvasSchema,
  style: z.strictObject({ styleId: refString('风格 id'), packVersion: refString('风格包版本').optional() }).optional(),
  /** 整条片子的总帧数，必须等于最后一个场景的结束帧。 */
  durationFrames: positiveFrames('总时长'),
  scenes: z.array(videoSpecSceneSchema).min(1, '至少要有 1 个场景'),
  audio: videoSpecAudioSchema.default({ sampleRate: VIDEO_SPEC_SAMPLE_RATE, tracks: [] }),
  loudness: videoSpecLoudnessSchema.default({ normalize: true, ...FINAL_FILM_LOUDNESS }),
  outputs: z.array(videoSpecOutputSchema).min(1, '至少要有 1 个输出').default([{ kind: 'mp4', videoCodec: 'h264', pixelFormat: 'yuv420p', audioCodec: 'aac', burnCaptions: true }]),
});

export const videoSpecSchema = baseVideoSpecSchema.superRefine((spec, ctx) => {
  for (const issue of collectVideoSpecInvariantIssues(spec)) {
    ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
  }
});

export type VideoSpec = z.output<typeof videoSpecSchema>;
export type VideoSpecInput = z.input<typeof videoSpecSchema>;
export type VideoSpecScene = VideoSpec['scenes'][number];
export type VideoSpecSceneInput = z.input<typeof videoSpecSceneSchema>;
export type VideoSpecCue = z.output<typeof videoSpecCueSchema>;
export type VideoSpecAdapter = VideoSpecScene['adapter'];
export type VideoSpecAudioTrack = z.output<typeof videoSpecAudioTrackSchema>;
export type VideoSpecAudioTrackInput = z.input<typeof videoSpecAudioTrackSchema>;
export type VideoSpecAudioClip = z.output<typeof videoSpecAudioClipSchema>;
export type VideoSpecOutput = z.output<typeof videoSpecOutputSchema>;
export type VideoSpecOutputInput = z.input<typeof videoSpecOutputSchema>;
export type VideoSpecCanvas = z.output<typeof videoSpecCanvasSchema>;

// ───────────────────────────── 不变式 ─────────────────────────────

interface InvariantIssue { path: (string | number)[]; message: string }

/** 跨字段不变式（schema 形状通过之后才检查）。每条都有对应测试。 */
function collectVideoSpecInvariantIssues(spec: z.output<typeof baseVideoSpecSchema>): InvariantIssue[] {
  const issues: InvariantIssue[] = [];
  const add = (path: (string | number)[], message: string) => issues.push({ path, message });
  const sceneIds = new Set<string>();
  const narrationClipIds = new Set<string>();
  for (const track of spec.audio.tracks) if (track.kind === 'narration') for (const clip of track.clips) narrationClipIds.add(clip.id);

  let previousEnd = 0;
  let maxEnd = 0;
  spec.scenes.forEach((scene, index) => {
    const label = `场景 "${scene.id}"`;
    if (sceneIds.has(scene.id)) add(['scenes', index, 'id'], `${label} 的 id 重复；场景 id 必须唯一`);
    sceneIds.add(scene.id);
    const end = scene.startFrame + scene.durationFrames;
    if (index === 0) {
      if (scene.startFrame !== 0) add(['scenes', 0, 'startFrame'], `第一个场景必须从第 0 帧开始（现在是第 ${scene.startFrame} 帧）`);
    } else {
      const previous = spec.scenes[index - 1];
      if (scene.startFrame <= previous.startFrame) {
        add(['scenes', index, 'startFrame'], `${label} 的开始帧 ${scene.startFrame} 不晚于上一场景 "${previous.id}"（${previous.startFrame}）；scenes 必须按时间顺序排列`);
      } else if (scene.startFrame > previousEnd) {
        add(['scenes', index, 'startFrame'], `${label} 从第 ${scene.startFrame} 帧开始，但上一场景在第 ${previousEnd} 帧就结束了，中间有 ${scene.startFrame - previousEnd} 帧空白；主轨不允许空隙`);
      } else if (scene.startFrame < previousEnd) {
        const overlap = previousEnd - scene.startFrame;
        const transition = scene.transitionIn;
        if (!transition || transition.type === 'cut' || transition.durationFrames === 0) {
          add(['scenes', index, 'startFrame'], `${label} 与上一场景 "${previous.id}" 重叠 ${overlap} 帧，但没有声明转场；主轨上的场景只有在转场时才能重叠`);
        } else if (overlap > transition.durationFrames) {
          add(['scenes', index, 'transitionIn', 'durationFrames'], `${label} 与上一场景重叠 ${overlap} 帧，超过了转场时长 ${transition.durationFrames} 帧`);
        }
        if (overlap >= scene.durationFrames || overlap >= previous.durationFrames) {
          add(['scenes', index, 'startFrame'], `${label} 与上一场景重叠 ${overlap} 帧，不能覆盖任一场景的全部时长`);
        }
      }
    }
    if (scene.transitionIn && scene.transitionIn.durationFrames > scene.durationFrames) {
      add(['scenes', index, 'transitionIn', 'durationFrames'], `${label} 的转场时长 ${scene.transitionIn.durationFrames} 帧超过了场景时长 ${scene.durationFrames} 帧`);
    }
    let previousCueEnd = 0;
    scene.cues.forEach((cue, cueIndex) => {
      const cuePath = ['scenes', index, 'cues', cueIndex];
      if (cue.endFrame <= cue.startFrame) add([...cuePath, 'endFrame'], `${label} 第 ${cueIndex + 1} 条字幕的结束帧 ${cue.endFrame} 必须大于开始帧 ${cue.startFrame}`);
      if (cue.endFrame > scene.durationFrames) add([...cuePath, 'endFrame'], `${label} 第 ${cueIndex + 1} 条字幕结束于场景内第 ${cue.endFrame} 帧，超出了场景时长 ${scene.durationFrames} 帧；字幕必须落在所属场景之内`);
      if (cue.startFrame < previousCueEnd) add([...cuePath, 'startFrame'], `${label} 第 ${cueIndex + 1} 条字幕与上一条重叠或顺序颠倒（开始帧 ${cue.startFrame} < 上一条结束帧 ${previousCueEnd}）`);
      previousCueEnd = Math.max(previousCueEnd, cue.endFrame);
      cue.words?.forEach((word, wordIndex) => {
        if (word.startFrame < cue.startFrame || word.endFrame > cue.endFrame || word.endFrame < word.startFrame) {
          add([...cuePath, 'words', wordIndex], `${label} 第 ${cueIndex + 1} 条字幕的第 ${wordIndex + 1} 个词（${word.text}）时间 [${word.startFrame}, ${word.endFrame}] 不在字幕区间 [${cue.startFrame}, ${cue.endFrame}] 内`);
        }
      });
    });
    if (scene.narration?.clipId && !narrationClipIds.has(scene.narration.clipId)) {
      add(['scenes', index, 'narration', 'clipId'], `${label} 引用的旁白片段 "${scene.narration.clipId}" 不在任何 narration 音轨里`);
    }
    previousEnd = Math.max(previousEnd, end);
    maxEnd = Math.max(maxEnd, end);
  });
  if (spec.durationFrames !== maxEnd) {
    add(['durationFrames'], `总时长 ${spec.durationFrames} 帧必须等于最后一个场景的结束帧 ${maxEnd}`);
  }

  const trackIds = new Set<string>();
  const clipIds = new Set<string>();
  spec.audio.tracks.forEach((track, trackIndex) => {
    if (trackIds.has(track.id)) add(['audio', 'tracks', trackIndex, 'id'], `音轨 id "${track.id}" 重复`);
    trackIds.add(track.id);
  });
  spec.audio.tracks.forEach((track, trackIndex) => {
    const trackPath = ['audio', 'tracks', trackIndex];
    track.ducking?.triggerTrackIds.forEach((triggerId, triggerIndex) => {
      if (triggerId === track.id) add([...trackPath, 'ducking', 'triggerTrackIds', triggerIndex], `音轨 "${track.id}" 不能用自己触发闪避`);
      else if (!trackIds.has(triggerId)) add([...trackPath, 'ducking', 'triggerTrackIds', triggerIndex], `音轨 "${track.id}" 的闪避触发轨道 "${triggerId}" 不存在`);
    });
    const ordered = track.clips.map((clip, clipIndex) => ({ clip, clipIndex })).sort((a, b) => a.clip.startFrame - b.clip.startFrame);
    let previousClipEnd = -1;
    let previousClipId = '';
    for (const { clip, clipIndex } of ordered) {
      const clipPath = [...trackPath, 'clips', clipIndex];
      const clipEnd = clip.startFrame + clip.durationFrames;
      if (clipIds.has(clip.id)) add([...clipPath, 'id'], `音频片段 id "${clip.id}" 重复（所有音轨之间也必须唯一）`);
      clipIds.add(clip.id);
      if (clipEnd > spec.durationFrames) add([...clipPath, 'durationFrames'], `音频片段 "${clip.id}" 结束于第 ${clipEnd} 帧，超出了总时长 ${spec.durationFrames} 帧`);
      if (clip.sceneId && !sceneIds.has(clip.sceneId)) add([...clipPath, 'sceneId'], `音频片段 "${clip.id}" 所属场景 "${clip.sceneId}" 不存在`);
      if (clip.fadeInFrames + clip.fadeOutFrames > clip.durationFrames) add([...clipPath, 'fadeInFrames'], `音频片段 "${clip.id}" 的淡入加淡出（${clip.fadeInFrames + clip.fadeOutFrames} 帧）超过了片段时长 ${clip.durationFrames} 帧`);
      if (track.kind !== 'sfx' && clip.startFrame < previousClipEnd) {
        add([...clipPath, 'startFrame'], `${track.kind === 'narration' ? '旁白' : '音乐'}音轨 "${track.id}" 上的片段 "${clip.id}" 与 "${previousClipId}" 重叠；同一条旁白/音乐轨不允许重叠（需要叠放请拆成多条音轨）`);
      }
      if (clipEnd > previousClipEnd) { previousClipEnd = clipEnd; previousClipId = clip.id; }
    }
  });

  const outputKinds = new Set<string>();
  spec.outputs.forEach((output, index) => {
    if (outputKinds.has(output.kind)) add(['outputs', index, 'kind'], `输出类型 "${output.kind}" 重复`);
    outputKinds.add(output.kind);
  });
  return issues;
}

// ───────────────────────────── 校验入口 ─────────────────────────────

export interface VideoSpecIssue {
  /** 例如 `scenes[2].cues[0].endFrame`；顶层为空字符串。 */
  path: string;
  message: string;
}

export type VideoSpecValidationResult =
  | { ok: true; spec: VideoSpec; issues: [] }
  | { ok: false; issues: VideoSpecIssue[] };

export class VideoSpecValidationError extends AppError {
  constructor(readonly issues: VideoSpecIssue[]) {
    super('VIDEO_SPEC_INVALID', `VideoSpec 不合法：${issues.slice(0, 5).map(formatVideoSpecIssue).join('；')}${issues.length > 5 ? `；另有 ${issues.length - 5} 处问题` : ''}`);
  }
}

export function formatVideoSpecIssue(issue: VideoSpecIssue): string {
  return issue.path ? `${issue.path}：${issue.message}` : issue.message;
}

function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((text, key) => typeof key === 'number' ? `${text}[${key}]` : text ? `${text}.${String(key)}` : String(key), '');
}

const CJK = /[\u4e00-\u9fff]/u;

/** zod 自带的英文提示统一翻成中文；schema 里写好的中文提示原样保留。 */
function translateZodIssue(issue: z.core.$ZodIssue): string {
  if (CJK.test(issue.message)) return issue.message;
  switch (issue.code) {
    case 'invalid_type':
      return /received undefined/u.test(issue.message) ? '缺少必填字段' : `类型不对，应为 ${issue.expected}`;
    case 'unrecognized_keys':
      return `未知字段：${issue.keys.join('、')}（VideoSpec 是严格结构，不接受多余字段）`;
    case 'invalid_value':
      return `取值必须是 ${issue.values.map(value => JSON.stringify(value)).join(' / ')} 之一`;
    case 'invalid_union':
      return '不符合任何允许的结构';
    case 'too_small':
      return `不能小于 ${String(issue.minimum)}`;
    case 'too_big':
      return `不能大于 ${String(issue.maximum)}`;
    default:
      return `不合法（${issue.message}）`;
  }
}

/** 校验并补默认值。从不抛异常；`ok: false` 时 issues 全是中文提示。 */
export function validateVideoSpec(input: unknown): VideoSpecValidationResult {
  if (input && typeof input === 'object' && 'specVersion' in input) {
    const version = (input as { specVersion: unknown }).specVersion;
    if (typeof version === 'number' && Number.isInteger(version) && version > VIDEO_SPEC_VERSION) {
      return { ok: false, issues: [{ path: 'specVersion', message: `VideoSpec 版本 ${version} 比当前程序支持的版本 ${VIDEO_SPEC_VERSION} 新，请升级应用后再打开` }] };
    }
  }
  const result = videoSpecSchema.safeParse(migrateVideoSpecInput(input));
  if (result.success) return { ok: true, spec: result.data, issues: [] };
  return { ok: false, issues: result.error.issues.map(issue => ({ path: formatPath(issue.path), message: translateZodIssue(issue) })) };
}

/** 校验失败时抛 `VideoSpecValidationError`（code `VIDEO_SPEC_INVALID`）。 */
export function parseVideoSpec(input: unknown): VideoSpec {
  const result = validateVideoSpec(input);
  if (!result.ok) throw new VideoSpecValidationError(result.issues);
  return result.spec;
}

/**
 * 版本迁移挂钩。v1 是第一个版本，没有需要迁移的旧格式；以后升 v2 时在这里把 v1 结构转换为 v2。
 * 只做结构转换，不做校验（校验由 schema 负责）。
 */
function migrateVideoSpecInput(input: unknown): unknown {
  return input;
}

// ───────────────────────────── 新项目开关 ─────────────────────────────

export function isSupportedVideoSpecVersion(version: unknown): version is typeof VIDEO_SPEC_VERSION {
  return version === VIDEO_SPEC_VERSION;
}

/**
 * 项目是否走 VideoSpec 新架构（ADR-03：只用于新项目）。
 * 只有创建时就写入了 `videoSpecVersion`（正整数）的项目才为真；旧项目没有这个字段，恒为假。
 * 版本号比当前程序新的项目也返回真（它确实是新架构项目），读取时由 `validateVideoSpec` 给出“请升级”的明确提示，
 * 而不是悄悄退回旧管线。本函数目前**没有接入任何执行器**（接入属于 O-3）。
 */
export function projectUsesVideoSpec(project: unknown): boolean {
  if (!project || typeof project !== 'object') return false;
  const version = (project as { videoSpecVersion?: unknown }).videoSpecVersion;
  return typeof version === 'number' && Number.isSafeInteger(version) && version >= 1;
}

/** 新建项目时打上新架构标记（只给新项目用，不要对旧项目调用）。 */
export function withVideoSpecVersion<T extends object>(project: T): T & { videoSpecVersion: typeof VIDEO_SPEC_VERSION } {
  return { ...project, videoSpecVersion: VIDEO_SPEC_VERSION };
}

// ───────────────────────────── 查询 helper ─────────────────────────────

export function sceneEndFrame(scene: Pick<VideoSpecScene, 'startFrame' | 'durationFrames'>): number {
  return scene.startFrame + scene.durationFrames;
}

export function videoSpecDurationMs(spec: Pick<VideoSpec, 'durationFrames' | 'canvas'>): number {
  return msAt(spec.durationFrames, spec.canvas.fps);
}

/**
 * 返回覆盖第 `frame` 帧的场景（区间 [startFrame, end)）。转场重叠区内返回**后开始**的场景（正在转入的那个）。
 * 超出 [0, durationFrames) 或不是整数时返回 undefined。
 */
export function sceneAt(spec: Pick<VideoSpec, 'scenes' | 'durationFrames'>, frame: number): VideoSpecScene | undefined {
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= spec.durationFrames) return undefined;
  for (let index = spec.scenes.length - 1; index >= 0; index -= 1) {
    const scene = spec.scenes[index];
    if (scene.startFrame <= frame && frame < sceneEndFrame(scene)) return scene;
  }
  return undefined;
}

// ───────────────────────────── createVideoSpec ─────────────────────────────

export type CreateVideoSpecSceneInput = Omit<VideoSpecSceneInput, 'startFrame' | 'durationFrames'> & (
  | { durationFrames: number; durationMs?: never }
  | { durationMs: number; durationFrames?: never }
);

export interface CreateVideoSpecInput {
  route: VideoSpecRoute;
  title?: string;
  canvas: { width: number; height: number; fps: VideoSpecFps };
  style?: VideoSpecInput['style'];
  /** 场景按顺序首尾相接排在主轨上（不重叠）。时长给帧数或毫秒；毫秒按累计时钟分帧，不会逐段累积误差。 */
  scenes: readonly CreateVideoSpecSceneInput[];
  audio?: { tracks: VideoSpecAudioTrackInput[] };
  loudness?: VideoSpecInput['loudness'];
  outputs?: VideoSpecOutputInput[];
}

/** 由场景列表构造 VideoSpec：自动排 startFrame、算总时长，然后完整校验（不合法抛 `VideoSpecValidationError`）。 */
export function createVideoSpec(input: CreateVideoSpecInput): VideoSpec {
  const fps = input.canvas.fps;
  assertFps(fps);
  let cursorFrame = 0;
  // 毫秒时长按累计时钟分帧；遇到直接给帧数的场景时，把毫秒游标对齐到该场景的结束帧。
  let cursorMs = 0;
  const scenes = input.scenes.map((scene, index) => {
    const { durationFrames: givenFrames, durationMs, ...rest } = scene;
    let durationFrames: number;
    if (typeof givenFrames === 'number') {
      durationFrames = givenFrames;
      if (Number.isSafeInteger(givenFrames) && givenFrames > 0) cursorMs = msAt(cursorFrame + givenFrames, fps);
    } else {
      if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) {
        throw new VideoSpecValidationError([{ path: `scenes[${index}].durationMs`, message: `场景 "${scene.id}" 的时长必须是正数毫秒` }]);
      }
      cursorMs += durationMs;
      durationFrames = Math.max(1, frameAt(cursorMs, fps) - cursorFrame);
    }
    const built = { ...rest, startFrame: cursorFrame, durationFrames };
    cursorFrame += Number.isSafeInteger(durationFrames) ? durationFrames : 0;
    return built;
  });
  return parseVideoSpec({
    specVersion: VIDEO_SPEC_VERSION,
    route: input.route,
    ...(input.title !== undefined ? { title: input.title } : {}),
    canvas: { width: input.canvas.width, height: input.canvas.height, fps },
    ...(input.style ? { style: input.style } : {}),
    durationFrames: cursorFrame,
    scenes,
    audio: { sampleRate: VIDEO_SPEC_SAMPLE_RATE, tracks: input.audio?.tracks ?? [] },
    ...(input.loudness ? { loudness: input.loudness } : {}),
    ...(input.outputs ? { outputs: input.outputs } : {}),
  });
}

// ───────────────────────────── 适配器：旧数据 → VideoSpec（只读） ─────────────────────────────

interface TimedText {
  text: string;
  /** 相对所属场景开始的毫秒。 */
  startMs: number;
  endMs: number;
  source?: VideoSpecCue['source'];
  confidence?: number;
  words?: Array<{ text: string; startMs: number; endMs: number }>;
}

interface SceneClock { startMs: number; startFrame: number; durationFrames: number }

/**
 * 把场景内毫秒时间换成场景内帧号：先换成全局帧再减去场景开始帧，保证和场景边界用的是同一个累计时钟。
 * 越界的部分钳到场景内；顺序颠倒或重叠的 cue 顺延；钳完没有时长的 cue 丢弃（TTS/估算时间常有几毫秒的越界）。
 */
function toSceneCues(clock: SceneClock, items: readonly TimedText[], fps: VideoSpecFps): VideoSpecCue[] {
  const toFrame = (relativeMs: number) => {
    const global = frameAt(Math.max(0, clock.startMs + (Number.isFinite(relativeMs) ? relativeMs : 0)), fps);
    return Math.min(clock.durationFrames, Math.max(0, global - clock.startFrame));
  };
  const cues: VideoSpecCue[] = [];
  let previousEnd = 0;
  for (const item of [...items].sort((a, b) => a.startMs - b.startMs)) {
    const text = item.text.trim();
    if (!text) continue;
    const startFrame = Math.max(previousEnd, toFrame(item.startMs));
    let endFrame = toFrame(item.endMs);
    if (endFrame <= startFrame) endFrame = Math.min(clock.durationFrames, startFrame + 1);
    if (endFrame <= startFrame) continue;
    const words = item.words
      ?.filter(word => word.text.trim())
      .map(word => {
        const wordStart = Math.min(endFrame, Math.max(startFrame, toFrame(word.startMs)));
        return { text: word.text.trim(), startFrame: wordStart, endFrame: Math.min(endFrame, Math.max(wordStart, toFrame(word.endMs))) };
      });
    cues.push({
      text,
      startFrame,
      endFrame,
      ...(item.source ? { source: item.source } : {}),
      ...(item.confidence !== undefined && Number.isFinite(item.confidence) ? { confidence: Math.min(1, Math.max(0, item.confidence)) } : {}),
      ...(words?.length ? { words } : {}),
    });
    previousEnd = endFrame;
  }
  return cues;
}

/** 没有时间戳的字幕行：按字数比例均分到场景时长（来源标为 estimated）。 */
function estimatedTimedTexts(lines: readonly string[], durationMs: number): TimedText[] {
  const clean = lines.map(line => line.trim()).filter(Boolean);
  const weights = clean.map(line => Math.max(1, [...line].length));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = 0;
  return clean.map((text, index) => {
    const startMs = cursor;
    cursor = index === clean.length - 1 ? durationMs : cursor + (durationMs * weights[index]) / total;
    return { text, startMs, endMs: cursor, source: 'estimated' as const };
  });
}

function sceneClocks(durationsMs: readonly number[], fps: VideoSpecFps, startOffsetMs: number): SceneClock[] {
  const counts = allocateFrameCounts(durationsMs, fps, startOffsetMs);
  let startMs = startOffsetMs;
  let startFrame = startOffsetMs > 0 ? Math.max(1, frameAt(startOffsetMs, fps)) : 0;
  return counts.map((durationFrames, index) => {
    const clock = { startMs, startFrame, durationFrames };
    startMs += durationsMs[index];
    startFrame += durationFrames;
    return clock;
  });
}

function incompleteSource(message: string): AppError {
  return new AppError('VIDEO_SPEC_SOURCE_INCOMPLETE', message);
}

/** 默认的 BGM 闪避：旁白出现时压低 12 dB（新架构默认值，旧路线的 BGM 没有闪避）。 */
export const DEFAULT_MUSIC_DUCKING = Object.freeze({ reductionDb: 12, attackMs: 50, releaseMs: 300 });

export interface HtmlVideoStateToVideoSpecInput {
  title?: string;
  /** HTML 路线的持久化状态（只读）；需要 scenes + voices，assets/compositions 可选。 */
  state: Pick<HtmlVideoPipelineDataV2, 'scenes' | 'voices' | 'config'> & Partial<Pick<HtmlVideoPipelineDataV2, 'assets' | 'compositions'>>;
  /** 画布与帧率由调用方给出（新项目创建时锁定）；不在这里根据 ratio/longEdge 推算。 */
  canvas: { width: number; height: number; fps: VideoSpecFps };
  /** 已解析好的 BGM 文件（state.config.bgmId → 路径由调用方解析）。 */
  bgm?: { ref: string; ducking?: boolean };
  /**
   * 封面片头（现有运行时：封面 1.4 s 排在第一个场景之前，并且第一个场景至少 6 s 用于开场蒙太奇）。
   * 这里把封面建成一个独立的 still 场景。
   */
  cover?: { ref: string; durationMs?: number; openingMinMs?: number };
  outputs?: VideoSpecOutputInput[];
}

/**
 * HTML 视频路线（HyperFrames）状态 → VideoSpec。时长规则与现有 `buildRuntimeComposition` 一致：
 * 场景时长 = max(800 ms, 配音时长)，配音从场景开始处起播；字幕优先用配音自带的时间戳 cue。
 */
export function videoSpecFromHtmlVideoState(input: HtmlVideoStateToVideoSpecInput): VideoSpec {
  const { state, canvas } = input;
  const fps = canvas.fps;
  assertFps(fps);
  if (!state.scenes.length) throw incompleteSource('HTML 视频还没有分镜，无法生成 VideoSpec。');
  const voices = state.scenes.map(scene => {
    const voice = state.voices.find(clip => clip.sceneIndex === scene.index);
    if (!voice || !Number.isFinite(voice.durationSec) || voice.durationSec <= 0) throw incompleteSource(`场景 ${scene.index} 缺少有效配音，无法确定时长（新架构先配音后分镜）。`);
    return voice;
  });
  const coverMs = input.cover ? Math.max(1, Math.round(input.cover.durationMs ?? 1400)) : 0;
  const openingMinMs = input.cover ? Math.max(0, Math.round(input.cover.openingMinMs ?? 6000)) : 0;
  const durationsMs = voices.map((voice, index) => Math.max(800, Math.round(voice.durationSec * 1000), index === 0 ? openingMinMs : 0));
  const allDurations = coverMs ? [coverMs, ...durationsMs] : durationsMs;
  const clocks = sceneClocks(allDurations, fps, 0);
  const sceneClockList = coverMs ? clocks.slice(1) : clocks;
  const assets = state.assets ?? [];
  const transitionType = state.config.transitionType && (VIDEO_SPEC_TRANSITION_TYPES as readonly string[]).includes(state.config.transitionType)
    ? state.config.transitionType as (typeof VIDEO_SPEC_TRANSITION_TYPES)[number]
    : 'fade';
  // 现有运行时固定 0.3 s 转场，渲染层完成，不改变场景时钟（不重叠）。
  const transitionFrames = frameAt(300, fps);

  const scenes: Array<VideoSpecSceneInput> = [];
  if (input.cover && coverMs) {
    scenes.push({
      id: 'cover',
      title: input.title ?? '封面',
      startFrame: 0,
      durationFrames: clocks[0].durationFrames,
      adapter: { kind: 'still', imageRef: input.cover.ref },
      sources: [{ role: 'image', ref: input.cover.ref }],
      cues: [],
    });
  }
  const narrationClips: z.input<typeof videoSpecAudioClipSchema>[] = [];
  state.scenes.forEach((plan, index) => {
    const clock = sceneClockList[index];
    const voice = voices[index];
    const id = `scene-${plan.index}`;
    const clipId = `narration-${plan.index}`;
    const hiddenSlots = new Set(plan.hiddenElementSlots ?? []);
    const background = assets.find(asset => asset.sceneIndex === plan.index && asset.kind === 'bg');
    const foregrounds = plan.foregroundHidden ? [] : assets
      .filter(asset => asset.sceneIndex === plan.index && asset.kind === 'fg' && !hiddenSlots.has(asset.slot)
        // 与运行时一致：不透明的“棋盘格”前景和抠图未通过的前景不算可用图层。
        && asset.transparency !== 'opaque' && (!asset.backgroundRemoval || asset.backgroundRemoval.quality === 'passed'))
      .sort((a, b) => a.slot - b.slot);
    const composition = state.compositions?.find(item => item.index === plan.index);
    const voiceMs = Math.round(voice.durationSec * 1000);
    const timed: TimedText[] = voice.captionCues?.length
      ? voice.captionCues.map(htmlCueToTimedText)
      : estimatedTimedTexts(plan.captions.length ? plan.captions : [plan.narration], voiceMs);
    scenes.push({
      id,
      title: plan.title,
      sourceSceneId: plan.index,
      startFrame: clock.startFrame,
      durationFrames: clock.durationFrames,
      ...(scenes.length > 0 ? { transitionIn: { type: transitionType, durationFrames: Math.min(transitionFrames, clock.durationFrames) } } : {}),
      adapter: {
        kind: 'hyperframes',
        sceneTemplate: plan.sceneTemplate,
        ...(composition?.htmlPath ? { compositionRef: composition.htmlPath } : {}),
        ...(state.config.sceneMotion ? { motion: state.config.sceneMotion } : {}),
      },
      sources: [
        ...(background ? [{ role: 'background' as const, ref: background.src, slot: background.slot }] : []),
        ...foregrounds.map(asset => ({ role: 'foreground' as const, ref: asset.src, slot: asset.slot })),
        ...(composition?.htmlPath ? [{ role: 'html' as const, ref: composition.htmlPath }] : []),
      ],
      narration: { text: voice.text ?? plan.narration, clipId },
      cues: toSceneCues(clock, timed, fps),
    });
    narrationClips.push({
      id: clipId,
      ref: voice.src,
      sceneId: id,
      startFrame: clock.startFrame,
      durationFrames: Math.min(clock.durationFrames, Math.max(1, frameAt(clock.startMs + voiceMs, fps) - clock.startFrame)),
    });
  });
  const durationFrames = clocks.reduce((sum, clock) => sum + clock.durationFrames, 0);
  const tracks: VideoSpecAudioTrackInput[] = [{ id: 'narration', kind: 'narration', clips: narrationClips }];
  if (input.bgm) {
    tracks.push({
      id: 'music',
      kind: 'music',
      targetDb: htmlVideoBgmTargetDb(state.config.bgmVolume),
      ...(input.bgm.ducking === false ? {} : { ducking: { triggerTrackIds: ['narration'], ...DEFAULT_MUSIC_DUCKING } }),
      clips: [{ id: 'music-1', ref: input.bgm.ref, startFrame: 0, durationFrames, loop: true }],
    });
  }
  return parseVideoSpec({
    specVersion: VIDEO_SPEC_VERSION,
    route: 'html',
    ...(input.title !== undefined ? { title: input.title } : {}),
    canvas: { width: canvas.width, height: canvas.height, fps },
    durationFrames,
    scenes,
    audio: { sampleRate: VIDEO_SPEC_SAMPLE_RATE, tracks },
    outputs: input.outputs ?? [{ kind: 'mp4' }, ...(input.cover ? [{ kind: 'cover' as const, ref: input.cover.ref }] : [])],
  });
}

function htmlCueToTimedText(cue: HtmlVideoTimedCaptionCue): TimedText {
  return {
    text: cue.text,
    startMs: cue.startSec * 1000,
    endMs: cue.endSec * 1000,
    source: cue.source,
    confidence: cue.confidence,
    ...(cue.words?.length ? { words: cue.words.map(word => ({ text: word.text, startMs: word.startSec * 1000, endMs: word.endSec * 1000 })) } : {}),
  };
}

export interface StoryboardToVideoSpecInput {
  title?: string;
  canvas: { width: number; height: number; fps: VideoSpecFps };
  /** 模板路线的分镜（PipelineArtifact.scenes，只读）。场景时长来自配音测得的 durationMs。 */
  scenes: readonly StoryboardScene[];
  /** PipelineArtifact.subtitles.cues：全局毫秒时间（`buildSubtitleTrack` 产物），按 sceneId 归到场景。 */
  subtitleCues?: readonly Pick<SubtitleCue, 'sceneId' | 'startMs' | 'endMs' | 'text'>[];
  /** 每个场景的旁白音频（TaskArtifactSnapshot.assets.narration）。 */
  narration: readonly Pick<TaskArtifactAssetPreview, 'sceneId' | 'path' | 'text'>[];
  /** 实测的旁白音频时长；缺省视为与场景等长。 */
  narrationDurationsMs?: readonly { sceneId: number; durationMs: number }[];
  images?: readonly Pick<TaskArtifactAssetPreview, 'sceneId' | 'path'>[];
  videos?: readonly Pick<TaskArtifactVideoPreview, 'sceneId' | 'path' | 'trimStartMs' | 'fit'>[];
  /** 给出时图片场景用 `template` 适配器（模板动画），否则用 `still`。 */
  templateId?: string;
  bgm?: { ref: string; targetDb?: number; ducking?: boolean };
  transition?: DirectorTransition;
  outputs?: VideoSpecOutputInput[];
}

/** 模板路线分镜（StoryboardScene + 旁白时长 + 字幕）→ VideoSpec。 */
export function videoSpecFromStoryboard(input: StoryboardToVideoSpecInput): VideoSpec {
  const fps = input.canvas.fps;
  assertFps(fps);
  if (!input.scenes.length) throw incompleteSource('分镜为空，无法生成 VideoSpec。');
  const durationsMs = input.scenes.map(scene => {
    const duration = Math.round(Number(scene.durationMs));
    if (!Number.isFinite(duration) || duration <= 0) throw incompleteSource(`分镜 ${scene.id} 的时长无效（${String(scene.durationMs)} ms），需要先完成配音测时。`);
    return duration;
  });
  const clocks = sceneClocks(durationsMs, fps, 0);
  const transition = input.transition && input.transition.type !== 'cut' && input.transition.durationMs > 0 ? input.transition : undefined;
  const narrationClips: z.input<typeof videoSpecAudioClipSchema>[] = [];
  const scenes: VideoSpecSceneInput[] = input.scenes.map((scene, index) => {
    const clock = clocks[index];
    const id = `scene-${scene.id}`;
    const narration = input.narration.find(item => item.sceneId === scene.id);
    if (!narration) throw incompleteSource(`分镜 ${scene.id} 缺少旁白音频。`);
    const video = input.videos?.find(item => item.sceneId === scene.id);
    const image = input.images?.find(item => item.sceneId === scene.id);
    const clipId = `narration-${scene.id}`;
    const narrationMs = input.narrationDurationsMs?.find(item => item.sceneId === scene.id)?.durationMs ?? durationsMs[index];
    narrationClips.push({
      id: clipId,
      ref: narration.path,
      sceneId: id,
      startFrame: clock.startFrame,
      durationFrames: Math.min(clock.durationFrames, Math.max(1, frameAt(clock.startMs + Math.max(0, narrationMs), fps) - clock.startFrame)),
    });
    let adapter: VideoSpecSceneInput['adapter'];
    if (video) {
      adapter = { kind: 'video', videoRef: video.path, trimStartFrame: frameAt(Math.max(0, video.trimStartMs), fps), fit: video.fit, muted: true };
    } else if (input.templateId) {
      adapter = { kind: 'template', templateId: input.templateId, params: { caption: scene.cap, ...(image ? { imageRef: image.path } : {}) } };
    } else if (image) {
      adapter = { kind: 'still', imageRef: image.path };
    } else {
      throw incompleteSource(`分镜 ${scene.id} 既没有图片也没有视频素材，且未指定模板。`);
    }
    const sceneStart = clock.startMs;
    const cues = (input.subtitleCues ?? [])
      .filter(cue => cue.sceneId === scene.id || (cue.sceneId === undefined && (cue.startMs + cue.endMs) / 2 >= sceneStart && (cue.startMs + cue.endMs) / 2 < sceneStart + durationsMs[index]))
      .map(cue => ({ text: cue.text, startMs: cue.startMs - sceneStart, endMs: cue.endMs - sceneStart }));
    return {
      id,
      title: scene.cap,
      sourceSceneId: scene.id,
      startFrame: clock.startFrame,
      durationFrames: clock.durationFrames,
      ...(transition && index > 0 ? { transitionIn: { type: 'dissolve' as const, durationFrames: Math.min(clock.durationFrames, frameAt(transition.durationMs, fps)) } } : {}),
      adapter,
      sources: [
        ...(image ? [{ role: 'image' as const, ref: image.path }] : []),
        ...(video ? [{ role: 'video' as const, ref: video.path }] : []),
      ],
      narration: { text: narration.text ?? scene.cap, clipId },
      cues: toSceneCues(clock, cues.length ? cues : estimatedTimedTexts([scene.cap], durationsMs[index]), fps),
    };
  });
  const durationFrames = clocks.reduce((sum, clock) => sum + clock.durationFrames, 0);
  const tracks: VideoSpecAudioTrackInput[] = [{ id: 'narration', kind: 'narration', clips: narrationClips }];
  if (input.bgm) {
    tracks.push({
      id: 'music',
      kind: 'music',
      ...(input.bgm.targetDb !== undefined ? { targetDb: input.bgm.targetDb } : {}),
      ...(input.bgm.ducking === false ? {} : { ducking: { triggerTrackIds: ['narration'], ...DEFAULT_MUSIC_DUCKING } }),
      clips: [{ id: 'music-1', ref: input.bgm.ref, startFrame: 0, durationFrames, loop: true }],
    });
  }
  return parseVideoSpec({
    specVersion: VIDEO_SPEC_VERSION,
    route: 'template',
    ...(input.title !== undefined ? { title: input.title } : {}),
    canvas: { width: input.canvas.width, height: input.canvas.height, fps },
    durationFrames,
    scenes,
    audio: { sampleRate: VIDEO_SPEC_SAMPLE_RATE, tracks },
    outputs: input.outputs ?? [{ kind: 'mp4' }, { kind: 'srt' }],
  });
}
