/**
 * O-3 / E-1：新建 HTML 视频默认走 VideoSpec 新架构（2026-11-10 用户决定）。
 *
 * 只换“出片”后端：分镜、生图、配音、场景 HTML、字幕 / BGM / 封面配置和工作室编辑全部沿用旧流程；
 * 出片步骤把持久化状态转成 VideoSpec，交给统一执行器（CaptureHost 采集 + AudioTimeline + xfade 封装）。
 *
 *  - 标记：创建时（主进程 `html-video:create-task`）按设置给 V2 pipeline 写 `videoSpecVersion: 1`；
 *    旧任务、没有标记的任务一律走旧渲染器，不迁移。
 *  - 设置：`AppConfig.htmlVideoVideoSpecRender`，缺省 = 开；关掉只影响之后新建的任务。
 *  - 构建：`buildHtmlVideoSpecForRender` 只做纯数据转换（可单测）；执行与发布在 electron/html-video-spec-render.ts
 *    与 html-video-runtime.ts 的 `renderVideoSpec`。
 */
import { AppError } from './app-error';
import type { AppConfig, HtmlVideoAsset, HtmlVideoCompositionSnapshot, HtmlVideoJobConfig, HtmlVideoScenePlan, HtmlVideoVoiceClip } from './types';
import { applyVoiceTimings, type VoiceTiming, type VoiceTimingOptions } from './video-spec-executor';
import { parseVideoSpec, projectUsesVideoSpec, videoSpecFromHtmlVideoState, type VideoSpec, type VideoSpecFps } from './video-spec';

/** 新建任务写入的 VideoSpec 版本号。 */
export const HTML_VIDEO_SPEC_VERSION = 1;

/** 设置“新建 HTML 视频使用新版渲染引擎”：缺省（undefined）= 开，只有显式 false 才关。 */
export function htmlVideoVideoSpecRenderEnabled(config: Pick<AppConfig, 'htmlVideoVideoSpecRender'> | null | undefined): boolean {
  return config?.htmlVideoVideoSpecRender !== false;
}

/**
 * 创建任务时按设置给 pipelineData 打标记。只处理“全新创建”的 V2 pipeline（`createHtmlVideoPipelineData` 的形态：
 * revision 0、还没有素材 / 配音 / 场景页面 / 封面 / 成片）；其它任何形态（例如从已有任务复制出来的 pipeline）
 * 原样返回，所以复制的旧任务保持旧版渲染（不会被打标记，也不会被删标记）。
 * 全新创建时：开 → 写 `videoSpecVersion: 1`；关 → 去掉渲染进程可能带来的标记（标记只能由主进程按设置写入）。
 */
export function markHtmlVideoPipelineDataForCreation(pipelineData: string | undefined, enabled: boolean): string | undefined {
  if (typeof pipelineData !== 'string') return pipelineData;
  let parsed: unknown;
  try { parsed = JSON.parse(pipelineData); } catch { return pipelineData; }
  if (!isFreshHtmlVideoPipeline(parsed)) return pipelineData;
  const record = { ...parsed };
  if (enabled) record.videoSpecVersion = HTML_VIDEO_SPEC_VERSION;
  else if ('videoSpecVersion' in record) delete record.videoSpecVersion;
  else return pipelineData;
  return JSON.stringify(record);
}

/** `createHtmlVideoPipelineData` 刚生成、还没跑过任何媒体步骤的 V2 pipeline。 */
export function isFreshHtmlVideoPipeline(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const empty = (key: string) => record[key] === undefined || (Array.isArray(record[key]) && (record[key] as unknown[]).length === 0);
  return record.version === 2
    && record.revision === 0
    && empty('assets') && empty('voices') && empty('compositions')
    && record.output === undefined && record.coverAsset === undefined;
}

/** 这个 HTML 视频任务的出片是否走新架构（读 pipeline 上的标记）。 */
export function htmlVideoUsesVideoSpec(state: unknown): boolean {
  return projectUsesVideoSpec(state);
}

/**
 * 新架构的帧率：HTML 场景页面声明的协议帧率就是运行时帧率（旧渲染默认 24），HyperFrames 运行时会把 seek
 * 时间吸附到这个帧率，所以按它采集；只有运行时明确是 30 时才用 30（VideoSpec 只支持 24 / 30）。
 */
export function htmlVideoSpecFps(runtimeFps: number): VideoSpecFps {
  return runtimeFps === 30 ? 30 : 24;
}

export interface HtmlVideoSpecBuildInput {
  title: string;
  scenes: readonly HtmlVideoScenePlan[];
  /** 已解析成本地绝对路径的配音（时长为配音步骤实测值）。 */
  voices: readonly HtmlVideoVoiceClip[];
  assets: readonly HtmlVideoAsset[];
  config: HtmlVideoJobConfig;
  canvas: { width: number; height: number };
  fps: VideoSpecFps;
  /** 场景编号 → 已落盘的场景 HTML（保存的 composition 源码，或按旧规则生成的页面）。 */
  scenePagePaths: ReadonlyMap<number, string>;
  /** 成片输出路径（绝对路径）。 */
  outputPath: string;
  bgmPath?: string;
  coverPath?: string;
}

export interface HtmlVideoSpecBuild {
  /** 配音定时之前的 spec（交给执行器；执行器会用 `timings` 重新定时）。 */
  spec: VideoSpec;
  /** 场景 id → 实测配音（执行器的 synthesizeVoice 原样回放，不发任何收费请求）。 */
  timings: Map<string, VoiceTiming>;
  timing: VoiceTimingOptions;
  /** 与执行器相同的定时结果（`applyVoiceTimings`），用于测试和预估。 */
  timedSpec: VideoSpec;
  /** 是否有开场蒙太奇（封面 1.4 s + 第一个场景至少 6 s）。 */
  opening: boolean;
}

const MIN_SCENE_MS = 800;
const OPENING_MIN_MS = 6000;
const OPENING_COVER_MS = 1400;

/**
 * 旧渲染 `buildRuntimeComposition` / `buildHtmlVideoExportInput` 的时长规则：
 *  - 场景时长 = max(800 ms, 配音时长)；
 *  - 有封面且前 4 个场景里至少 2 张背景图时开启开场蒙太奇：封面 1.4 s，第一个场景至少 6 s；
 *  - 有封面但没有蒙太奇时，旧 sidecar 的封面时长取第一个场景的时长（`cover_duration_s` 缺省规则），这里照搬。
 * 转场：配置 cut / none → 硬切；其余类型 0.3 s（帧数上限见 `videoSpecTransitionPlan`）。
 */
export function buildHtmlVideoSpecForRender(input: HtmlVideoSpecBuildInput): HtmlVideoSpecBuild {
  if (!input.scenes.length) throw new AppError('VIDEO_SPEC_RENDER_SPEC_INVALID', 'HTML 视频还没有分镜，无法用新版渲染引擎出片。');
  const voiceFor = (index: number) => {
    const voice = input.voices.find(clip => clip.sceneIndex === index);
    if (!voice || !Number.isFinite(voice.durationSec) || voice.durationSec <= 0) {
      throw new AppError('VIDEO_SPEC_RENDER_SPEC_INVALID', `场景 ${index} 缺少有效配音，无法用新版渲染引擎出片。`);
    }
    return voice;
  };
  const backgrounds = new Map<number, string>();
  for (const asset of input.assets) if (asset.kind === 'bg') backgrounds.set(asset.sceneIndex, asset.src);
  const opening = Boolean(input.coverPath)
    && input.scenes.slice(0, 4).filter(scene => backgrounds.has(scene.index)).length > 1;
  const firstSceneMs = Math.max(MIN_SCENE_MS, Math.round(voiceFor(input.scenes[0].index).durationSec * 1000));
  const coverMs = input.coverPath ? (opening ? OPENING_COVER_MS : firstSceneMs) : 0;

  const compositions = input.scenes.map((scene) => {
    const htmlPath = input.scenePagePaths.get(scene.index);
    if (!htmlPath) throw new AppError('VIDEO_SPEC_RENDER_SPEC_INVALID', `场景 ${scene.index} 没有可采集的 HTML 页面。`);
    return { index: scene.index, htmlPath } as HtmlVideoCompositionSnapshot;
  });
  let spec: VideoSpec;
  try {
    spec = videoSpecFromHtmlVideoState({
      title: input.title,
      state: {
        scenes: [...input.scenes],
        voices: [...input.voices],
        config: input.config,
        assets: [...input.assets],
        compositions,
      },
      canvas: { width: input.canvas.width, height: input.canvas.height, fps: input.fps },
      // 旧渲染的 BGM 没有闪避，用户选的 BGM 音量（bgmVolume → targetDb）按原样生效；成片整体仍做 −14 LUFS / −1 dBTP 归一。
      ...(input.bgmPath ? { bgm: { ref: input.bgmPath, ducking: false } } : {}),
      ...(input.coverPath ? { cover: { ref: input.coverPath, durationMs: coverMs, openingMinMs: opening ? OPENING_MIN_MS : 0 } } : {}),
      outputs: [{ kind: 'mp4', path: input.outputPath }, ...(input.coverPath ? [{ kind: 'cover' as const, ref: input.coverPath }] : [])],
    });
  } catch (error) {
    if (error instanceof AppError && error.code.startsWith('VIDEO_SPEC_RENDER_')) throw error;
    throw new AppError('VIDEO_SPEC_RENDER_SPEC_INVALID', `无法生成 VideoSpec：${error instanceof Error ? error.message : String(error)}`);
  }
  const transitionType = input.config.transitionType ?? 'fade';
  if (transitionType === 'cut' || transitionType === 'none') {
    spec = parseVideoSpec({ ...spec, scenes: spec.scenes.map(({ transitionIn: _transitionIn, ...scene }) => scene) });
  }

  const timings = new Map<string, VoiceTiming>();
  for (const scene of input.scenes) {
    const voice = voiceFor(scene.index);
    timings.set(`scene-${scene.index}`, {
      ref: voice.src,
      durationMs: Math.round(voice.durationSec * 1000),
      ...(voice.captionCues?.length ? { cues: voice.captionCues.map(cue => ({ text: cue.text, startMs: Math.round(cue.startSec * 1000), endMs: Math.round(cue.endSec * 1000) })) } : {}),
    });
  }
  const timing: VoiceTimingOptions = {
    minSceneMs: MIN_SCENE_MS,
    ...(opening ? { minSceneMsById: { [`scene-${input.scenes[0].index}`]: OPENING_MIN_MS } } : {}),
  };
  return { spec, timings, timing, timedSpec: applyVoiceTimings(spec, timings, timing), opening };
}
