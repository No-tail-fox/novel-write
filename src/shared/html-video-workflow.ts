import type {
  CoverMetadata,
  CreateTaskInput,
  HtmlVideoAsset,
  HtmlVideoCompositionSnapshot,
  HtmlVideoJobConfig,
  HtmlVideoOutput,
  HtmlVideoPipelineData,
  HtmlVideoPipelineDataV2,
  HtmlVideoPipelineStep,
  HtmlVideoScenePlan,
  HtmlVideoStepState,
  HtmlVideoStepStatus,
  HtmlVideoTabKey,
  HtmlVideoVisibleStep,
  HtmlVideoVoiceClip,
  Task,
} from './types';

export const MAX_HTML_VIDEO_PIPELINE_JSON_CHARS = 1_000_000;

export const htmlVideoVisibleSteps = [
  'rewrite',
  'planning',
  'assets',
  'voice',
  'preview',
  'render',
] as const satisfies readonly HtmlVideoVisibleStep[];

export const htmlVideoTabs: Array<{ key: HtmlVideoTabKey; label: string }> = [
  { key: 'text', label: '文案' },
  { key: 'assets', label: '素材' },
  { key: 'voice', label: '配音' },
  { key: 'preview', label: '动画预览' },
  { key: 'cover', label: '封面' },
  { key: 'output', label: '出片' },
];

export const htmlVideoSteps = [
  { key: 'rewrite', name: '改写 + 分句', sub: '口播版 + 切分场景' },
  { key: 'planning', name: '场景规划', sub: '选版式 / 标题 / 字幕 / 提示词' },
  { key: 'assets', name: '素材（图片）', sub: '背景图 / 透明前景图' },
  { key: 'voice', name: '配音', sub: '配音旁白' },
  { key: 'preview', name: '动画预览', sub: '每场景隐藏窗口渲染' },
  { key: 'render', name: '出片', sub: '逐帧截图后合成视频' },
] as const satisfies ReadonlyArray<{ key: HtmlVideoVisibleStep; name: string; sub: string }>;

const stepToTab: Record<string, HtmlVideoTabKey> = {
  plan: 'text',
  rewrite: 'text',
  planning: 'text',
  assets: 'assets',
  voice: 'voice',
  preview: 'preview',
  render: 'output',
  done: 'output',
};

const stepStatuses = new Set<HtmlVideoStepStatus>(['pending', 'running', 'completed', 'failed', 'cancelled']);

type UnknownRecord = Record<string, unknown>;

interface CompatibilityProjection {
  videoTitle?: string;
  scenesCompleted?: number;
  htmlPaths?: string[];
  cover?: CoverMetadata | null;
}

export function tabForHtmlVideoStep(step: string | undefined): HtmlVideoTabKey {
  return stepToTab[step || 'rewrite'] ?? 'text';
}

export function parseHtmlVideoPipelineData(value: string | undefined): HtmlVideoPipelineData {
  if (!value?.trim()) return createHtmlVideoPipelineData('', {});
  if (value.length > MAX_HTML_VIDEO_PIPELINE_JSON_CHARS) {
    throw new Error('HTML video pipeline JSON is too large.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw invalidPipeline('JSON is invalid');
  }
  if (!isRecord(parsed)) throw invalidPipeline('root must be an object');

  if (parsed.version === 2) {
    return withCompatibilityProjection(parsePipelineV2(parsed));
  }
  if (parsed.version !== undefined && parsed.version !== 1) {
    throw invalidPipeline('version is unsupported');
  }
  return migrateLegacyPipeline(parsed);
}

export function createHtmlVideoPipelineData(
  copy: string,
  config: HtmlVideoJobConfig = {},
): HtmlVideoPipelineData {
  const scenes = buildHtmlVideoScenePlans(copy, config.maxScenes ?? 8);
  const data: HtmlVideoPipelineDataV2 = {
    version: 2,
    revision: 0,
    current: 'rewrite',
    warnings: [],
    steps: createStepStates('rewrite'),
    scenes,
    assets: [],
    voices: [],
    compositions: [],
    config: cloneConfig(config),
  };
  return withCompatibilityProjection(data, { videoTitle: titleFromCopy(copy) });
}

export function createHtmlVideoTaskInput(input: {
  copy: string;
  ratio: string;
  style: string;
  bgmId?: string;
  maxScenes?: number;
  foreground?: boolean;
}): CreateTaskInput {
  const data = createHtmlVideoPipelineData(input.copy, {
    ratio: input.ratio,
    style: input.style,
    bgmId: input.bgmId ?? '',
    maxScenes: input.maxScenes,
    foreground: input.foreground ?? true,
    transitionType: 'fade',
    coverImageMode: 'titled',
    coverTemplate: 'cinematic-poster',
    coverRatio: '3:4',
  });
  return {
    title: `${dateStamp()} · ${data.videoTitle}`,
    inputText: input.copy.trim(),
    taskKind: 'story',
    taskType: 'html-video',
    pipelineStep: 'rewrite',
    pipelineData: JSON.stringify(data),
    materialSource: 'paste',
    track: 'character-story',
    style: input.style,
    ratio: input.ratio,
    bgmId: input.bgmId ?? '',
  };
}

export function isHtmlVideoTask(task: Pick<Task, 'taskType'>): boolean {
  return task.taskType === 'html-video';
}

function parsePipelineV2(value: UnknownRecord): HtmlVideoPipelineDataV2 {
  const current = requirePipelineStep(value.current, 'current');
  const stepsValue = requireRecord(value.steps, 'steps');
  const unexpectedStep = Object.keys(stepsValue).find((key) => !htmlVideoVisibleSteps.includes(key as HtmlVideoVisibleStep));
  if (unexpectedStep) throw invalidPipeline('steps contains a terminal or unknown key');

  const steps = {} as Record<HtmlVideoVisibleStep, HtmlVideoStepState>;
  for (const step of htmlVideoVisibleSteps) {
    steps[step] = parseStepState(stepsValue[step], `steps.${step}`);
  }

  return {
    version: 2,
    revision: requireNonNegativeInteger(value.revision, 'revision'),
    current,
    warnings: requireStringArray(value.warnings, 'warnings'),
    steps,
    scenes: requireArray(value.scenes, 'scenes').map((scene, index) => parseScenePlan(scene, `scenes[${index}]`, false)),
    assets: requireArray(value.assets, 'assets').map((asset, index) => parseAsset(asset, `assets[${index}]`)),
    voices: requireArray(value.voices, 'voices').map((voice, index) => parseVoice(voice, `voices[${index}]`)),
    compositions: requireArray(value.compositions, 'compositions').map((composition, index) => parseComposition(composition, `compositions[${index}]`)),
    ...(value.output === undefined ? {} : { output: parseOutput(value.output) }),
    config: parseConfig(value.config, 'config'),
  };
}

function migrateLegacyPipeline(value: UnknownRecord): HtmlVideoPipelineData {
  const scenes = optionalArray(value.scenes, 'scenes').map((scene, index) => parseScenePlan(scene, `scenes[${index}]`, true));
  const assets = optionalArray(value.assetImages, 'assetImages').map((asset, index) => parseAsset(asset, `assetImages[${index}]`));
  const voices = optionalArray(value.voiceClips, 'voiceClips').map((voice, index) => parseVoice(voice, `voiceClips[${index}]`));
  const compositions = optionalArray(value.compositions, 'compositions').map((composition, index) => parseComposition(composition, `compositions[${index}]`));
  const current = legacyPipelineStep(value.current ?? value.pipelineStep);
  const htmlPaths = optionalStringArray(value.htmlPaths, 'htmlPaths');
  const cover = parseLegacyCover(value.cover);
  const data: HtmlVideoPipelineDataV2 = {
    version: 2,
    revision: optionalNonNegativeInteger(value.revision, 'revision') ?? 0,
    current,
    warnings: value.warnings === undefined ? [] : requireStringArray(value.warnings, 'warnings'),
    steps: createStepStates(current),
    scenes,
    assets,
    voices,
    compositions,
    config: parseConfig(value._cfg ?? {}, '_cfg'),
  };
  return withCompatibilityProjection(data, {
    videoTitle: optionalString(value.videoTitle, 'videoTitle') ?? '',
    scenesCompleted: optionalNonNegativeInteger(value.scenesCompleted, 'scenesCompleted') ?? compositions.length,
    htmlPaths,
    cover,
  });
}

function createStepStates(current: HtmlVideoPipelineStep): Record<HtmlVideoVisibleStep, HtmlVideoStepState> {
  const currentIndex = current === 'done' ? htmlVideoVisibleSteps.length : htmlVideoVisibleSteps.indexOf(current);
  return Object.fromEntries(htmlVideoVisibleSteps.map((step, index) => [
    step,
    { status: index < currentIndex ? 'completed' : 'pending' } satisfies HtmlVideoStepState,
  ])) as Record<HtmlVideoVisibleStep, HtmlVideoStepState>;
}

function withCompatibilityProjection(
  data: HtmlVideoPipelineDataV2,
  compatibility: CompatibilityProjection = {},
): HtmlVideoPipelineData {
  const view = data as HtmlVideoPipelineData;
  Object.defineProperties(view, {
    scenesPlanned: { enumerable: false, get: () => data.scenes.length },
    scenesCompleted: { enumerable: false, get: () => compatibility.scenesCompleted ?? data.compositions.length },
    videoTitle: { enumerable: false, get: () => compatibility.videoTitle || data.scenes[0]?.title || '' },
    assetImages: { enumerable: false, get: () => data.assets },
    voiceClips: { enumerable: false, get: () => data.voices },
    htmlPaths: {
      enumerable: false,
      get: () => compatibility.htmlPaths ?? data.compositions.flatMap((composition) => composition.htmlPath ? [composition.htmlPath] : []),
    },
    cover: { enumerable: false, get: () => compatibility.cover ?? data.output?.cover ?? null },
    _cfg: { enumerable: false, get: () => data.config },
  });
  return view;
}

function parseStepState(value: unknown, field: string): HtmlVideoStepState {
  const record = requireRecord(value, field);
  if (typeof record.status !== 'string' || !stepStatuses.has(record.status as HtmlVideoStepStatus)) {
    throw invalidPipeline(`${field}.status is invalid`);
  }
  return {
    status: record.status as HtmlVideoStepStatus,
    ...(optionalString(record.inputHash, `${field}.inputHash`) === undefined ? {} : { inputHash: String(record.inputHash) }),
    ...(optionalString(record.artifactPath, `${field}.artifactPath`) === undefined ? {} : { artifactPath: String(record.artifactPath) }),
    ...(optionalNonNegativeInteger(record.artifactSize, `${field}.artifactSize`) === undefined ? {} : { artifactSize: Number(record.artifactSize) }),
    ...(optionalString(record.error, `${field}.error`) === undefined ? {} : { error: String(record.error) }),
    ...(optionalNonNegativeInteger(record.startedAt, `${field}.startedAt`) === undefined ? {} : { startedAt: Number(record.startedAt) }),
    ...(optionalNonNegativeInteger(record.completedAt, `${field}.completedAt`) === undefined ? {} : { completedAt: Number(record.completedAt) }),
  };
}

function parseScenePlan(value: unknown, field: string, legacy: boolean): HtmlVideoScenePlan {
  const scene = requireRecord(value, field);
  const index = legacy
    ? optionalPositiveInteger(scene.index, `${field}.index`) ?? 1
    : requirePositiveInteger(scene.index, `${field}.index`);
  const narration = legacy ? optionalString(scene.narration, `${field}.narration`) ?? '' : requireString(scene.narration, `${field}.narration`);
  const title = legacy ? optionalString(scene.title, `${field}.title`) ?? shortSceneTitle(narration, index) : requireString(scene.title, `${field}.title`);
  const captions = scene.captions === undefined && legacy
    ? splitCaptionLines(narration)
    : requireStringArray(scene.captions, `${field}.captions`);
  const background = scene.background === undefined && legacy ? {} : requireRecord(scene.background, `${field}.background`);
  const backgroundPrompt = legacy
    ? optionalString(background.prompt, `${field}.background.prompt`) ?? narration
    : requireString(background.prompt, `${field}.background.prompt`);
  const elements = scene.elements === undefined && legacy ? [] : requireArray(scene.elements, `${field}.elements`);

  return {
    index,
    narration,
    title,
    captions,
    sceneTemplate: legacy
      ? optionalString(scene.sceneTemplate, `${field}.sceneTemplate`) ?? 'cinematic-title'
      : requireString(scene.sceneTemplate, `${field}.sceneTemplate`),
    background: { prompt: backgroundPrompt },
    elements: elements.map((item, slot) => {
      const element = requireRecord(item, `${field}.elements[${slot}]`);
      return {
        slot: legacy
          ? optionalNonNegativeInteger(element.slot, `${field}.elements[${slot}].slot`) ?? slot
          : requireNonNegativeInteger(element.slot, `${field}.elements[${slot}].slot`),
        prompt: legacy
          ? optionalString(element.prompt, `${field}.elements[${slot}].prompt`) ?? narration
          : requireString(element.prompt, `${field}.elements[${slot}].prompt`),
      };
    }),
  };
}

function parseAsset(value: unknown, field: string): HtmlVideoAsset {
  const asset = requireRecord(value, field);
  if (asset.kind !== 'bg' && asset.kind !== 'fg') throw invalidPipeline(`${field}.kind is invalid`);
  return {
    sceneIndex: requirePositiveInteger(asset.sceneIndex, `${field}.sceneIndex`),
    kind: asset.kind,
    slot: requireNonNegativeInteger(asset.slot, `${field}.slot`),
    src: requireString(asset.src, `${field}.src`),
    ...(optionalString(asset.prompt, `${field}.prompt`) === undefined ? {} : { prompt: String(asset.prompt) }),
    ...(optionalNonNegativeInteger(asset.sizeBytes, `${field}.sizeBytes`) === undefined ? {} : { sizeBytes: Number(asset.sizeBytes) }),
  };
}

function parseVoice(value: unknown, field: string): HtmlVideoVoiceClip {
  const voice = requireRecord(value, field);
  return {
    sceneIndex: requirePositiveInteger(voice.sceneIndex, `${field}.sceneIndex`),
    src: requireString(voice.src, `${field}.src`),
    durationSec: requireNonNegativeNumber(voice.durationSec, `${field}.durationSec`),
    ...(optionalString(voice.text, `${field}.text`) === undefined ? {} : { text: String(voice.text) }),
    ...(optionalNonNegativeInteger(voice.sizeBytes, `${field}.sizeBytes`) === undefined ? {} : { sizeBytes: Number(voice.sizeBytes) }),
  };
}

function parseComposition(value: unknown, field: string): HtmlVideoCompositionSnapshot {
  const composition = requireRecord(value, field);
  const canvas = requireRecord(composition.canvas, `${field}.canvas`);
  const audio = requireRecord(composition.audio, `${field}.audio`);
  const background = requireRecord(composition.background, `${field}.background`);
  return {
    index: requirePositiveInteger(composition.index, `${field}.index`),
    durationSec: requireNonNegativeNumber(composition.durationSec, `${field}.durationSec`),
    canvas: {
      w: requirePositiveInteger(canvas.w, `${field}.canvas.w`),
      h: requirePositiveInteger(canvas.h, `${field}.canvas.h`),
    },
    audio: {
      src: requireString(audio.src, `${field}.audio.src`),
      durationSec: requireNonNegativeNumber(audio.durationSec, `${field}.audio.durationSec`),
    },
    background: { src: requireString(background.src, `${field}.background.src`) },
    captions: requireArray(composition.captions, `${field}.captions`).map((item, index) => {
      const caption = requireRecord(item, `${field}.captions[${index}]`);
      return {
        id: requireString(caption.id, `${field}.captions[${index}].id`),
        text: requireString(caption.text, `${field}.captions[${index}].text`),
        startSec: requireNonNegativeNumber(caption.startSec, `${field}.captions[${index}].startSec`),
        durationSec: requireNonNegativeNumber(caption.durationSec, `${field}.captions[${index}].durationSec`),
      };
    }),
    ...(optionalString(composition.htmlPath, `${field}.htmlPath`) === undefined ? {} : { htmlPath: String(composition.htmlPath) }),
    ...(optionalNonNegativeInteger(composition.rev, `${field}.rev`) === undefined ? {} : { rev: Number(composition.rev) }),
  };
}

function parseOutput(value: unknown): HtmlVideoOutput {
  const output = requireRecord(value, 'output');
  return {
    path: requireString(output.path, 'output.path'),
    sizeBytes: requireNonNegativeInteger(output.sizeBytes, 'output.sizeBytes'),
    ...(optionalNonNegativeNumber(output.durationSec, 'output.durationSec') === undefined ? {} : { durationSec: Number(output.durationSec) }),
    ...(output.cover === undefined ? {} : { cover: parseLegacyCover(output.cover) }),
  };
}

function parseConfig(value: unknown, field: string): HtmlVideoJobConfig {
  const config = requireRecord(value, field);
  const result: HtmlVideoJobConfig = {};
  const stringKeys = [
    'style',
    'voiceId',
    'ttsProvider',
    'bgmId',
    'captionPreset',
    'captionAnim',
    'transitionType',
    'coverImageMode',
    'coverTemplate',
    'coverRatio',
    'draftTemplate',
    'ratio',
  ] as const;
  for (const key of stringKeys) {
    const parsed = optionalString(config[key], `${field}.${key}`);
    if (parsed !== undefined) result[key] = parsed;
  }
  const ttsSpeed = optionalNonNegativeNumber(config.ttsSpeed, `${field}.ttsSpeed`);
  if (ttsSpeed !== undefined) result.ttsSpeed = ttsSpeed;
  const maxScenes = optionalPositiveInteger(config.maxScenes, `${field}.maxScenes`);
  if (maxScenes !== undefined) result.maxScenes = maxScenes;
  if (config.foreground !== undefined) {
    if (typeof config.foreground !== 'boolean') throw invalidPipeline(`${field}.foreground is invalid`);
    result.foreground = config.foreground;
  }
  if (config.bgmVolume !== undefined) {
    if (config.bgmVolume !== 'soft' && config.bgmVolume !== 'medium' && config.bgmVolume !== 'loud') {
      throw invalidPipeline(`${field}.bgmVolume is invalid`);
    }
    result.bgmVolume = config.bgmVolume;
  }
  if (config.captionColors !== undefined) {
    const colors = requireRecord(config.captionColors, `${field}.captionColors`);
    result.captionColors = Object.fromEntries(Object.entries(colors).map(([key, color]) => [
      key,
      requireString(color, `${field}.captionColors.${key}`),
    ]));
  }
  return result;
}

function cloneConfig(config: HtmlVideoJobConfig): HtmlVideoJobConfig {
  return {
    ...config,
    ...(config.captionColors ? { captionColors: { ...config.captionColors } } : {}),
  };
}

function parseLegacyCover(value: unknown): CoverMetadata | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const cover = requireRecord(value, 'cover');
  return {
    title: requireString(cover.title, 'cover.title'),
    subtitle: requireStringArray(cover.subtitle, 'cover.subtitle'),
    summary: requireString(cover.summary, 'cover.summary'),
    tags: requireStringArray(cover.tags, 'cover.tags'),
    comments: requireStringArray(cover.comments, 'cover.comments'),
  };
}

function legacyPipelineStep(value: unknown): HtmlVideoPipelineStep {
  if (value === undefined || value === 'plan') return 'planning';
  return requirePipelineStep(value, 'current');
}

function requirePipelineStep(value: unknown, field: string): HtmlVideoPipelineStep {
  if (typeof value !== 'string' || (!htmlVideoVisibleSteps.includes(value as HtmlVideoVisibleStep) && value !== 'done')) {
    throw invalidPipeline(`${field} is invalid`);
  }
  return value as HtmlVideoPipelineStep;
}

function requireRecord(value: unknown, field: string): UnknownRecord {
  if (!isRecord(value)) throw invalidPipeline(`${field} must be an object`);
  return value;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw invalidPipeline(`${field} must be an array`);
  return value;
}

function optionalArray(value: unknown, field: string): unknown[] {
  return value === undefined ? [] : requireArray(value, field);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw invalidPipeline(`${field} must be a string`);
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : requireString(value, field);
}

function requireStringArray(value: unknown, field: string): string[] {
  return requireArray(value, field).map((item, index) => requireString(item, `${field}[${index}]`));
}

function optionalStringArray(value: unknown, field: string): string[] {
  return value === undefined ? [] : requireStringArray(value, field);
}

function requireNonNegativeNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw invalidPipeline(`${field} must be a non-negative number`);
  return value;
}

function optionalNonNegativeNumber(value: unknown, field: string): number | undefined {
  return value === undefined ? undefined : requireNonNegativeNumber(value, field);
}

function requireNonNegativeInteger(value: unknown, field: string): number {
  const parsed = requireNonNegativeNumber(value, field);
  if (!Number.isSafeInteger(parsed)) throw invalidPipeline(`${field} must be an integer`);
  return parsed;
}

function optionalNonNegativeInteger(value: unknown, field: string): number | undefined {
  return value === undefined ? undefined : requireNonNegativeInteger(value, field);
}

function requirePositiveInteger(value: unknown, field: string): number {
  const parsed = requireNonNegativeInteger(value, field);
  if (parsed < 1) throw invalidPipeline(`${field} must be positive`);
  return parsed;
}

function optionalPositiveInteger(value: unknown, field: string): number | undefined {
  return value === undefined ? undefined : requirePositiveInteger(value, field);
}

function invalidPipeline(reason: string): Error {
  return new Error(`HTML video pipeline ${reason}.`);
}

function buildHtmlVideoScenePlans(copy: string, maxScenes: number): HtmlVideoScenePlan[] {
  const chunks = splitCopyIntoSceneTexts(copy).slice(0, Math.max(1, maxScenes));
  return chunks.map((text, index) => ({
    index: index + 1,
    narration: text,
    title: shortSceneTitle(text, index + 1),
    captions: splitCaptionLines(text),
    sceneTemplate: index % 2 === 0 ? 'cinematic-title' : 'foreground-card',
    background: {
      prompt: `${text}，电影感背景，适合 HTML 动画视频`,
    },
    elements: [
      {
        slot: 0,
        prompt: `${text} 的关键人物或物件，透明 PNG 前景素材`,
      },
    ],
  }));
}

function splitCopyIntoSceneTexts(copy: string): string[] {
  const paragraphs = copy
    .split(/\n{2,}/u)
    .map((item) => item.trim())
    .filter(Boolean);
  if (paragraphs.length > 1) return paragraphs;
  return copy
    .split(/(?<=[。！？!?；;])\s*/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitCaptionLines(text: string): string[] {
  const lines = text
    .split(/[。！？!?；;]\s*/u)
    .map((item) => item.trim())
    .filter(Boolean);
  return lines.length ? lines : [text.trim()].filter(Boolean);
}

function titleFromCopy(copy: string): string {
  return copy.trim().replace(/\s+/g, '').slice(0, 12) || 'HTML动画视频';
}

function shortSceneTitle(text: string, index: number): string {
  const cleaned = text.replace(/\s+/g, '').slice(0, 12);
  return cleaned || `场景 ${index}`;
}

function dateStamp(): string {
  const date = new Date();
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}
