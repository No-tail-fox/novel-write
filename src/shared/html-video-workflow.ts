import { AppError } from './app-error';
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
  TaskStatus,
} from './types';

export const MAX_HTML_VIDEO_PIPELINE_JSON_CHARS = 1_000_000;
export const MAX_HTML_VIDEO_PIPELINE_FILE_BYTES = MAX_HTML_VIDEO_PIPELINE_JSON_CHARS * 4;
export const MAX_HTML_VIDEO_SCENES = 30;
export const MAX_HTML_VIDEO_SOURCE_CHARS = 16_384;
export const MAX_HTML_VIDEO_ELEMENTS_PER_SCENE = 4;
export const MAX_HTML_VIDEO_CAPTIONS_PER_SCENE = 32;
export const MAX_HTML_VIDEO_PLANNING_TEXT_CHARS = MAX_HTML_VIDEO_SOURCE_CHARS * 4 + 4096;
export const MAX_HTML_VIDEO_WARNINGS = 64;
export const MAX_HTML_VIDEO_WARNING_CHARS = 1024;
export const MAX_HTML_VIDEO_PATH_CHARS = 4096;

const MAX_HTML_VIDEO_DISPLAY_LIST_ITEMS = 32;
const MAX_HTML_VIDEO_DISPLAY_TEXT_CHARS = 1024;
const MAX_HTML_VIDEO_CONFIG_ENTRIES = 32;

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
const htmlVideoRatioPattern = /^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/u;

type UnknownRecord = Record<string, unknown>;

interface TextBudget {
  total: number;
  maximum: number;
  label: string;
}

interface CompatibilityProjection {
  videoTitle?: string;
  scenesCompleted?: number;
  htmlPaths?: string[];
  cover?: CoverMetadata | null;
}

type HtmlVideoRetrySource = Pick<
  Task,
  | 'bgmId'
  | 'coverImageMode'
  | 'coverTemplateId'
  | 'htmlVideoForeground'
  | 'inputText'
  | 'pipelineData'
  | 'ratio'
  | 'speaker'
  | 'storyboardSceneCount'
  | 'style'
  | 'targetScenes'
  | 'ttsProvider'
  | 'ttsSpeed'
>;

export interface HtmlVideoPipelineRetryPatch {
  pipelineData: string;
  pipelineStep: 'rewrite';
  currentStep: 0;
  failedStep: null;
  retryFromStep: null;
}

export function tabForHtmlVideoStep(step: string | undefined): HtmlVideoTabKey {
  return stepToTab[step || 'rewrite'] ?? 'text';
}

export function nextHtmlVideoTabKey(current: HtmlVideoTabKey, key: string): HtmlVideoTabKey | null {
  if (key === 'Home') return htmlVideoTabs[0].key;
  if (key === 'End') return htmlVideoTabs[htmlVideoTabs.length - 1].key;
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
  const currentIndex = htmlVideoTabs.findIndex((tab) => tab.key === current);
  const offset = key === 'ArrowRight' ? 1 : -1;
  return htmlVideoTabs[(currentIndex + offset + htmlVideoTabs.length) % htmlVideoTabs.length].key;
}

export function classifyHtmlVideoTaskMessage(
  status: TaskStatus,
  message: string,
): 'error' | 'status' | null {
  if (!message.trim()) return null;
  return status === 'failed' ? 'error' : 'status';
}

export function fitHtmlVideoOutputSize(
  containerWidth: number,
  maxHeight: number,
  ratio: string | undefined,
): { width: number; height: number; aspectRatio: number } {
  const aspectRatio = parseHtmlVideoAspectRatio(ratio);
  const availableWidth = containerWidth > 0 ? containerWidth : 0;
  const availableHeight = Number.isFinite(maxHeight) && maxHeight > 0 ? maxHeight : 0;
  const width = Math.min(availableWidth, availableHeight * aspectRatio);
  return { width, height: width / aspectRatio, aspectRatio };
}

function parseHtmlVideoAspectRatio(ratio: string | undefined): number {
  const match = ratio?.trim().match(htmlVideoRatioPattern);
  if (!match) return 9 / 16;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : 9 / 16;
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

export function safeParseHtmlVideoPipelineData(
  value: string | undefined,
  fallbackCopy = '',
): { data: HtmlVideoPipelineData; error: string } {
  try {
    return { data: parseHtmlVideoPipelineData(value), error: '' };
  } catch (error) {
    const displayCopy = fallbackCopy.slice(0, MAX_HTML_VIDEO_SOURCE_CHARS);
    return {
      data: createHtmlVideoPipelineData(displayCopy, {}),
      error: error instanceof Error ? error.message : 'HTML video pipeline data is invalid.',
    };
  }
}

export function recoverHtmlVideoPipelineDataForRetry(
  task: HtmlVideoRetrySource,
): HtmlVideoPipelineRetryPatch | null {
  if (task.inputText.length > MAX_HTML_VIDEO_SOURCE_CHARS) {
    throw new AppError(
      'HTML_VIDEO_SOURCE_TOO_LARGE',
      `HTML 视频原始文案超过 ${MAX_HTML_VIDEO_SOURCE_CHARS} 字符上限，请缩短文案后重试。`,
      false,
      undefined,
      'inputText',
    );
  }
  try {
    parseHtmlVideoPipelineData(task.pipelineData);
    return null;
  } catch {
    const requestedMaxScenes = task.targetScenes ?? task.storyboardSceneCount;
    const validRequestedMaxScenes = Number.isSafeInteger(requestedMaxScenes) && Number(requestedMaxScenes) > 0
      ? Number(requestedMaxScenes)
      : undefined;
    const maxScenes = validRequestedMaxScenes === undefined
      ? undefined
      : Math.min(validRequestedMaxScenes, MAX_HTML_VIDEO_SCENES);
    const data = createHtmlVideoPipelineData(task.inputText, {
      ratio: task.ratio,
      style: task.style,
      ttsProvider: task.ttsProvider,
      voiceId: task.speaker,
      ttsSpeed: Number.isFinite(task.ttsSpeed) && task.ttsSpeed > 0 ? task.ttsSpeed : 1,
      bgmId: task.bgmId,
      maxScenes,
      foreground: task.htmlVideoForeground ?? true,
      transitionType: 'fade',
      coverImageMode: task.coverImageMode ?? 'titled',
      coverTemplate: task.coverTemplateId ?? 'cinematic-poster',
      coverRatio: '3:4',
    });
    data.warnings.push('检测到 HTML 视频任务快照损坏，已从原始文案和任务配置重建。');
    if (validRequestedMaxScenes !== undefined && validRequestedMaxScenes > MAX_HTML_VIDEO_SCENES) {
      data.warnings.push(`旧任务的场景上限过大，已限制为 ${MAX_HTML_VIDEO_SCENES} 个场景。`);
    }
    return {
      pipelineData: JSON.stringify(data),
      pipelineStep: 'rewrite',
      currentStep: 0,
      failedStep: null,
      retryFromStep: null,
    };
  }
}

export function createHtmlVideoPipelineData(
  copy: string,
  config: HtmlVideoJobConfig = {},
): HtmlVideoPipelineData {
  if (copy.length > MAX_HTML_VIDEO_SOURCE_CHARS) {
    throw invalidPipeline(`source text exceeds ${MAX_HTML_VIDEO_SOURCE_CHARS} characters`);
  }
  const scenes = planHtmlVideoScenes(copy, config.maxScenes ?? 8);
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
  ttsProvider?: Task['ttsProvider'];
  voiceId?: string;
  ttsSpeed?: number;
  bgmId?: string;
  maxScenes?: number;
  foreground?: boolean;
}): CreateTaskInput {
  const data = createHtmlVideoPipelineData(input.copy, {
    ratio: input.ratio,
    style: input.style,
    ttsProvider: input.ttsProvider,
    voiceId: input.voiceId,
    ttsSpeed: input.ttsSpeed,
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
    speaker: input.voiceId,
    ttsProvider: input.ttsProvider,
    ttsSpeed: input.ttsSpeed,
    ratio: input.ratio,
    bgmId: input.bgmId ?? '',
    targetScenes: input.maxScenes,
    coverImageMode: 'titled',
    coverTemplateId: 'cinematic-poster',
    htmlVideoForeground: input.foreground ?? true,
  };
}

export function isHtmlVideoTask(task: Pick<Task, 'taskType'>): boolean {
  return task.taskType === 'html-video';
}

export function validateHtmlVideoScenePlans(
  value: unknown,
  maxScenes = MAX_HTML_VIDEO_SCENES,
): HtmlVideoScenePlan[] {
  const sceneLimit = requireHtmlVideoMaxScenes(maxScenes, 'maxScenes');
  const scenes = parseHtmlVideoScenePlanArray(value, 'scenes', false, sceneLimit);
  if (scenes.length === 0) throw invalidPipeline('scenes must not be empty');
  requireContiguousSceneIndexes(scenes, 'scenes');
  return scenes;
}

export function validateHtmlVideoAssets(
  value: unknown,
  scenes: HtmlVideoScenePlan[],
  config: Pick<HtmlVideoJobConfig, 'foreground'> = {},
  field = 'assets',
): HtmlVideoAsset[] {
  const maximum = scenes.length * (1 + MAX_HTML_VIDEO_ELEMENTS_PER_SCENE);
  const rawAssets = requireBoundedArray(value, field, maximum);
  if (rawAssets.length === 0) return [];

  const expected = new Set<string>();
  for (const scene of scenes) {
    expected.add(assetKey(scene.index, 'bg', 0));
    if (config.foreground !== false) {
      for (const element of scene.elements) expected.add(assetKey(scene.index, 'fg', element.slot));
    }
  }
  if (rawAssets.length !== expected.size) {
    throw invalidPipeline(`${field} does not contain the complete expected asset set`);
  }

  const assets = rawAssets.map((asset, index) => parseAsset(asset, `${field}[${index}]`));
  const seen = new Set<string>();
  for (const asset of assets) {
    const key = assetKey(asset.sceneIndex, asset.kind, asset.slot);
    if (!expected.has(key)) throw invalidPipeline(`${field} contains an unknown scene, kind, or slot`);
    if (seen.has(key)) throw invalidPipeline(`${field} contains a duplicate scene, kind, or slot`);
    seen.add(key);
  }
  return assets;
}

export function validateHtmlVideoVoices(
  value: unknown,
  scenes: HtmlVideoScenePlan[],
  field = 'voices',
): HtmlVideoVoiceClip[] {
  const rawVoices = requireBoundedArray(value, field, scenes.length);
  if (rawVoices.length === 0) return [];
  if (rawVoices.length !== scenes.length) {
    throw invalidPipeline(`${field} does not contain one voice for every scene`);
  }

  const expected = new Set(scenes.map((scene) => scene.index));
  const voices = rawVoices.map((voice, index) => parseVoice(voice, `${field}[${index}]`));
  const seen = new Set<number>();
  for (const voice of voices) {
    if (!expected.has(voice.sceneIndex)) throw invalidPipeline(`${field} contains an unknown scene`);
    if (seen.has(voice.sceneIndex)) throw invalidPipeline(`${field} contains a duplicate scene`);
    seen.add(voice.sceneIndex);
  }
  return voices;
}

export function validateHtmlVideoCompositions(
  value: unknown,
  scenes: HtmlVideoScenePlan[],
  field = 'compositions',
): HtmlVideoCompositionSnapshot[] {
  const rawCompositions = requireBoundedArray(value, field, scenes.length);
  if (rawCompositions.length === 0) return [];
  if (rawCompositions.length !== scenes.length) {
    throw invalidPipeline(`${field} does not contain one completed preview for every scene`);
  }

  const expected = new Set(scenes.map((scene) => scene.index));
  const textBudget = createTextBudget(MAX_HTML_VIDEO_PLANNING_TEXT_CHARS, `${field} caption text`);
  const compositions = rawCompositions.map((composition, index) => (
    parseComposition(composition, `${field}[${index}]`, textBudget)
  ));
  const seen = new Set<number>();
  for (const composition of compositions) {
    if (!expected.has(composition.index)) throw invalidPipeline(`${field} contains an unknown scene`);
    if (seen.has(composition.index)) throw invalidPipeline(`${field} contains a duplicate scene`);
    seen.add(composition.index);
  }
  return compositions;
}

function parsePipelineV2(value: UnknownRecord): HtmlVideoPipelineDataV2 {
  const config = parseConfig(value.config, 'config');
  const sceneLimit = config.maxScenes ?? MAX_HTML_VIDEO_SCENES;
  const current = requirePipelineStep(value.current, 'current');
  const stepsValue = requireRecord(value.steps, 'steps');
  const unexpectedStep = Object.keys(stepsValue).find((key) => !htmlVideoVisibleSteps.includes(key as HtmlVideoVisibleStep));
  if (unexpectedStep) throw invalidPipeline('steps contains a terminal or unknown key');

  const steps = {} as Record<HtmlVideoVisibleStep, HtmlVideoStepState>;
  for (const step of htmlVideoVisibleSteps) {
    steps[step] = parseStepState(stepsValue[step], `steps.${step}`);
  }

  const scenes = parseHtmlVideoScenePlanArray(value.scenes, 'scenes', false, sceneLimit);
  const assets = validateHtmlVideoAssets(value.assets, scenes, config);
  const voices = validateHtmlVideoVoices(value.voices, scenes);
  const compositions = validateHtmlVideoCompositions(value.compositions, scenes);

  return {
    version: 2,
    revision: requireNonNegativeInteger(value.revision, 'revision'),
    current,
    warnings: requireBoundedStringArray(
      value.warnings,
      'warnings',
      MAX_HTML_VIDEO_WARNINGS,
      MAX_HTML_VIDEO_WARNING_CHARS,
    ),
    steps,
    scenes,
    assets,
    voices,
    compositions,
    ...(value.output === undefined ? {} : { output: parseOutput(value.output) }),
    config,
  };
}

function migrateLegacyPipeline(value: UnknownRecord): HtmlVideoPipelineData {
  const config = parseConfig(value._cfg ?? {}, '_cfg');
  const sceneLimit = config.maxScenes ?? MAX_HTML_VIDEO_SCENES;
  const scenes = parseHtmlVideoScenePlanArray(
    value.scenes === undefined ? [] : value.scenes,
    'scenes',
    true,
    sceneLimit,
  );
  const assets = validateHtmlVideoAssets(value.assetImages ?? [], scenes, config, 'assetImages');
  const voices = validateHtmlVideoVoices(value.voiceClips ?? [], scenes, 'voiceClips');
  const compositions = validateHtmlVideoCompositions(value.compositions ?? [], scenes);
  const current = legacyPipelineStep(value.current ?? value.pipelineStep);
  const htmlPaths = value.htmlPaths === undefined
    ? []
    : requireBoundedStringArray(
        value.htmlPaths,
        'htmlPaths',
        MAX_HTML_VIDEO_SCENES,
        MAX_HTML_VIDEO_PATH_CHARS,
      );
  const cover = parseLegacyCover(value.cover);
  const data: HtmlVideoPipelineDataV2 = {
    version: 2,
    revision: optionalNonNegativeInteger(value.revision, 'revision') ?? 0,
    current,
    warnings: value.warnings === undefined
      ? []
      : requireBoundedStringArray(
          value.warnings,
          'warnings',
          MAX_HTML_VIDEO_WARNINGS,
          MAX_HTML_VIDEO_WARNING_CHARS,
        ),
    steps: createStepStates(current),
    scenes,
    assets,
    voices,
    compositions,
    config,
  };
  return withCompatibilityProjection(data, {
    videoTitle: optionalBoundedString(value.videoTitle, 'videoTitle', MAX_HTML_VIDEO_DISPLAY_TEXT_CHARS) ?? '',
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
    ...(optionalBoundedString(record.inputHash, `${field}.inputHash`, 128) === undefined ? {} : { inputHash: String(record.inputHash) }),
    ...(optionalBoundedString(record.artifactPath, `${field}.artifactPath`, MAX_HTML_VIDEO_PATH_CHARS) === undefined ? {} : { artifactPath: String(record.artifactPath) }),
    ...(optionalBoundedNonNegativeInteger(
      record.artifactSize,
      `${field}.artifactSize`,
      MAX_HTML_VIDEO_PIPELINE_FILE_BYTES,
    ) === undefined ? {} : { artifactSize: Number(record.artifactSize) }),
    ...(optionalBoundedString(record.error, `${field}.error`, MAX_HTML_VIDEO_WARNING_CHARS) === undefined ? {} : { error: String(record.error) }),
    ...(optionalNonNegativeInteger(record.startedAt, `${field}.startedAt`) === undefined ? {} : { startedAt: Number(record.startedAt) }),
    ...(optionalNonNegativeInteger(record.completedAt, `${field}.completedAt`) === undefined ? {} : { completedAt: Number(record.completedAt) }),
  };
}

function parseScenePlan(
  value: unknown,
  field: string,
  legacy: boolean,
  textBudget: TextBudget,
  defaultIndex: number,
): HtmlVideoScenePlan {
  const scene = requireRecord(value, field);
  const index = legacy
    ? optionalPositiveInteger(scene.index, `${field}.index`) ?? defaultIndex
    : requirePositiveInteger(scene.index, `${field}.index`);
  const narration = requireBudgetedString(
    legacy && scene.narration === undefined ? '' : scene.narration,
    `${field}.narration`,
    MAX_HTML_VIDEO_SOURCE_CHARS,
    textBudget,
  );
  const title = requireBudgetedString(
    legacy && scene.title === undefined ? shortSceneTitle(narration, index) : scene.title,
    `${field}.title`,
    MAX_HTML_VIDEO_SOURCE_CHARS,
    textBudget,
  );
  const captions = scene.captions === undefined && legacy
    ? splitCaptionLines(narration).map((caption, captionIndex) => consumeTextBudget(
        caption,
        `${field}.captions[${captionIndex}]`,
        textBudget,
      ))
    : requireBudgetedStringArray(
        scene.captions,
        `${field}.captions`,
        MAX_HTML_VIDEO_CAPTIONS_PER_SCENE,
        MAX_HTML_VIDEO_SOURCE_CHARS,
        textBudget,
      );
  const background = scene.background === undefined && legacy ? {} : requireRecord(scene.background, `${field}.background`);
  const backgroundPrompt = requireBudgetedString(
    legacy && background.prompt === undefined ? narration : background.prompt,
    `${field}.background.prompt`,
    MAX_HTML_VIDEO_SOURCE_CHARS,
    textBudget,
  );
  const elements = scene.elements === undefined && legacy ? [] : requireArray(scene.elements, `${field}.elements`);
  if (elements.length > MAX_HTML_VIDEO_ELEMENTS_PER_SCENE) {
    throw invalidPipeline(`${field}.elements exceeds the maximum of ${MAX_HTML_VIDEO_ELEMENTS_PER_SCENE} elements`);
  }

  const sceneTemplate = requireBudgetedString(
    legacy && scene.sceneTemplate === undefined ? 'cinematic-title' : scene.sceneTemplate,
    `${field}.sceneTemplate`,
    MAX_HTML_VIDEO_SOURCE_CHARS,
    textBudget,
  );
  const parsedElements = elements.map((item, slot) => {
    const element = requireRecord(item, `${field}.elements[${slot}]`);
    return {
      slot: legacy
        ? optionalNonNegativeInteger(element.slot, `${field}.elements[${slot}].slot`) ?? slot
        : requireNonNegativeInteger(element.slot, `${field}.elements[${slot}].slot`),
      prompt: requireBudgetedString(
        legacy && element.prompt === undefined ? narration : element.prompt,
        `${field}.elements[${slot}].prompt`,
        MAX_HTML_VIDEO_SOURCE_CHARS,
        textBudget,
      ),
    };
  });
  if (new Set(parsedElements.map((element) => element.slot)).size !== parsedElements.length) {
    throw invalidPipeline(`${field}.elements contains duplicate slots`);
  }

  return {
    index,
    narration,
    title,
    captions,
    sceneTemplate,
    background: { prompt: backgroundPrompt },
    elements: parsedElements,
  };
}

function parseAsset(value: unknown, field: string): HtmlVideoAsset {
  const asset = requireRecord(value, field);
  if (asset.kind !== 'bg' && asset.kind !== 'fg') throw invalidPipeline(`${field}.kind is invalid`);
  return {
    sceneIndex: requirePositiveInteger(asset.sceneIndex, `${field}.sceneIndex`),
    kind: asset.kind,
    slot: requireNonNegativeInteger(asset.slot, `${field}.slot`),
    src: requireBoundedString(asset.src, `${field}.src`, MAX_HTML_VIDEO_PATH_CHARS),
    ...(optionalBoundedString(asset.prompt, `${field}.prompt`, MAX_HTML_VIDEO_SOURCE_CHARS) === undefined ? {} : { prompt: String(asset.prompt) }),
    ...(optionalNonNegativeInteger(asset.sizeBytes, `${field}.sizeBytes`) === undefined ? {} : { sizeBytes: Number(asset.sizeBytes) }),
  };
}

function parseVoice(value: unknown, field: string): HtmlVideoVoiceClip {
  const voice = requireRecord(value, field);
  return {
    sceneIndex: requirePositiveInteger(voice.sceneIndex, `${field}.sceneIndex`),
    src: requireBoundedString(voice.src, `${field}.src`, MAX_HTML_VIDEO_PATH_CHARS),
    durationSec: requireNonNegativeNumber(voice.durationSec, `${field}.durationSec`),
    ...(optionalBoundedString(voice.text, `${field}.text`, MAX_HTML_VIDEO_SOURCE_CHARS) === undefined ? {} : { text: String(voice.text) }),
    ...(optionalNonNegativeInteger(voice.sizeBytes, `${field}.sizeBytes`) === undefined ? {} : { sizeBytes: Number(voice.sizeBytes) }),
  };
}

function parseComposition(value: unknown, field: string, textBudget: TextBudget): HtmlVideoCompositionSnapshot {
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
      src: requireBoundedString(audio.src, `${field}.audio.src`, MAX_HTML_VIDEO_PATH_CHARS),
      durationSec: requireNonNegativeNumber(audio.durationSec, `${field}.audio.durationSec`),
    },
    background: { src: requireBoundedString(background.src, `${field}.background.src`, MAX_HTML_VIDEO_PATH_CHARS) },
    captions: requireBoundedArray(
      composition.captions,
      `${field}.captions`,
      MAX_HTML_VIDEO_CAPTIONS_PER_SCENE,
    ).map((item, index) => {
      const caption = requireRecord(item, `${field}.captions[${index}]`);
      return {
        id: requireBudgetedString(
          caption.id,
          `${field}.captions[${index}].id`,
          MAX_HTML_VIDEO_DISPLAY_TEXT_CHARS,
          textBudget,
        ),
        text: requireBudgetedString(
          caption.text,
          `${field}.captions[${index}].text`,
          MAX_HTML_VIDEO_SOURCE_CHARS,
          textBudget,
        ),
        startSec: requireNonNegativeNumber(caption.startSec, `${field}.captions[${index}].startSec`),
        durationSec: requireNonNegativeNumber(caption.durationSec, `${field}.captions[${index}].durationSec`),
      };
    }),
    ...(optionalBoundedString(composition.htmlPath, `${field}.htmlPath`, MAX_HTML_VIDEO_PATH_CHARS) === undefined ? {} : { htmlPath: String(composition.htmlPath) }),
    ...(optionalBoundedString(composition.thumbnailPath, `${field}.thumbnailPath`, MAX_HTML_VIDEO_PATH_CHARS) === undefined ? {} : { thumbnailPath: String(composition.thumbnailPath) }),
    ...(optionalNonNegativeInteger(composition.rev, `${field}.rev`) === undefined ? {} : { rev: Number(composition.rev) }),
  };
}

function parseOutput(value: unknown): HtmlVideoOutput {
  const output = requireRecord(value, 'output');
  return {
    path: requireBoundedString(output.path, 'output.path', MAX_HTML_VIDEO_PATH_CHARS),
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
    const parsed = optionalBoundedString(config[key], `${field}.${key}`, MAX_HTML_VIDEO_DISPLAY_TEXT_CHARS);
    if (parsed !== undefined) result[key] = parsed;
  }
  const ttsSpeed = optionalNonNegativeNumber(config.ttsSpeed, `${field}.ttsSpeed`);
  if (ttsSpeed !== undefined) result.ttsSpeed = ttsSpeed;
  const maxScenes = optionalHtmlVideoMaxScenes(config.maxScenes, `${field}.maxScenes`);
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
    requireRecordEntryLimit(colors, `${field}.captionColors`, MAX_HTML_VIDEO_CONFIG_ENTRIES);
    result.captionColors = Object.fromEntries(Object.entries(colors).map(([key, color]) => [
      requireBoundedString(key, `${field}.captionColors key`, 128),
      requireBoundedString(color, `${field}.captionColors.${key}`, MAX_HTML_VIDEO_DISPLAY_TEXT_CHARS),
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
    title: requireBoundedString(cover.title, 'cover.title', MAX_HTML_VIDEO_DISPLAY_TEXT_CHARS),
    subtitle: requireBoundedStringArray(
      cover.subtitle,
      'cover.subtitle',
      MAX_HTML_VIDEO_DISPLAY_LIST_ITEMS,
      MAX_HTML_VIDEO_DISPLAY_TEXT_CHARS,
    ),
    summary: requireBoundedString(cover.summary, 'cover.summary', MAX_HTML_VIDEO_SOURCE_CHARS),
    tags: requireBoundedStringArray(
      cover.tags,
      'cover.tags',
      MAX_HTML_VIDEO_DISPLAY_LIST_ITEMS,
      MAX_HTML_VIDEO_DISPLAY_TEXT_CHARS,
    ),
    comments: requireBoundedStringArray(
      cover.comments,
      'cover.comments',
      MAX_HTML_VIDEO_DISPLAY_LIST_ITEMS,
      MAX_HTML_VIDEO_DISPLAY_TEXT_CHARS,
    ),
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

function requireBoundedArray(value: unknown, field: string, maximum: number): unknown[] {
  const items = requireArray(value, field);
  if (items.length > maximum) {
    throw invalidPipeline(`${field} exceeds the maximum of ${maximum} items`);
  }
  return items;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw invalidPipeline(`${field} must be a string`);
  return value;
}

function requireBoundedString(value: unknown, field: string, maximum: number): string {
  const text = requireString(value, field);
  if (text.length > maximum) {
    throw invalidPipeline(`${field} exceeds the maximum of ${maximum} characters`);
  }
  return text;
}

function optionalBoundedString(value: unknown, field: string, maximum: number): string | undefined {
  return value === undefined ? undefined : requireBoundedString(value, field, maximum);
}

function requireBoundedStringArray(
  value: unknown,
  field: string,
  maximumItems: number,
  maximumCharacters: number,
): string[] {
  return requireBoundedArray(value, field, maximumItems)
    .map((item, index) => requireBoundedString(item, `${field}[${index}]`, maximumCharacters));
}

function requireBudgetedStringArray(
  value: unknown,
  field: string,
  maximumItems: number,
  maximumCharacters: number,
  budget: TextBudget,
): string[] {
  return requireBoundedArray(value, field, maximumItems).map((item, index) => requireBudgetedString(
    item,
    `${field}[${index}]`,
    maximumCharacters,
    budget,
  ));
}

function createTextBudget(maximum: number, label: string): TextBudget {
  return { total: 0, maximum, label };
}

function consumeTextBudget(text: string, field: string, budget: TextBudget): string {
  budget.total += text.length;
  if (budget.total > budget.maximum) {
    throw invalidPipeline(`${budget.label} exceeds the maximum text budget of ${budget.maximum} characters at ${field}`);
  }
  return text;
}

function requireBudgetedString(
  value: unknown,
  field: string,
  maximumCharacters: number,
  budget: TextBudget,
): string {
  return consumeTextBudget(requireBoundedString(value, field, maximumCharacters), field, budget);
}

function requireRecordEntryLimit(record: UnknownRecord, field: string, maximum: number): void {
  let count = 0;
  for (const key in record) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    count += 1;
    if (count > maximum) throw invalidPipeline(`${field} exceeds the maximum of ${maximum} entries`);
  }
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

function optionalBoundedNonNegativeInteger(
  value: unknown,
  field: string,
  maximum: number,
): number | undefined {
  const parsed = optionalNonNegativeInteger(value, field);
  if (parsed !== undefined && parsed > maximum) {
    throw invalidPipeline(`${field} exceeds the maximum of ${maximum}`);
  }
  return parsed;
}

function requirePositiveInteger(value: unknown, field: string): number {
  const parsed = requireNonNegativeInteger(value, field);
  if (parsed < 1) throw invalidPipeline(`${field} must be positive`);
  return parsed;
}

function optionalPositiveInteger(value: unknown, field: string): number | undefined {
  return value === undefined ? undefined : requirePositiveInteger(value, field);
}

function optionalHtmlVideoMaxScenes(value: unknown, field: string): number | undefined {
  return value === undefined ? undefined : requireHtmlVideoMaxScenes(value, field);
}

function requireHtmlVideoMaxScenes(value: unknown, field: string): number {
  const parsed = requirePositiveInteger(value, field);
  if (parsed > MAX_HTML_VIDEO_SCENES) {
    throw invalidPipeline(`${field} exceeds the maximum of ${MAX_HTML_VIDEO_SCENES} scenes`);
  }
  return parsed;
}

function parseHtmlVideoScenePlanArray(
  value: unknown,
  field: string,
  legacy: boolean,
  maxScenes = MAX_HTML_VIDEO_SCENES,
): HtmlVideoScenePlan[] {
  const scenes = requireArray(value, field);
  if (scenes.length > maxScenes) {
    throw invalidPipeline(`${field} exceeds the maximum of ${maxScenes} scenes`);
  }
  const textBudget = createTextBudget(MAX_HTML_VIDEO_PLANNING_TEXT_CHARS, `${field} planning text`);
  const parsed = scenes.map((scene, index) => (
    parseScenePlan(scene, `${field}[${index}]`, legacy, textBudget, index + 1)
  ));
  requireContiguousSceneIndexes(parsed, field);
  return parsed;
}

function requireContiguousSceneIndexes(scenes: HtmlVideoScenePlan[], field: string): void {
  for (const [index, scene] of scenes.entries()) {
    if (scene.index !== index + 1) {
      throw invalidPipeline(`${field} scene indexes must be contiguous from 1`);
    }
  }
}

function invalidPipeline(reason: string): Error {
  return new Error(`HTML video pipeline ${reason}.`);
}

export function planHtmlVideoScenes(copy: string, maxScenes: number): HtmlVideoScenePlan[] {
  const sceneLimit = requireHtmlVideoMaxScenes(maxScenes, 'maxScenes');
  if (copy.length > MAX_HTML_VIDEO_SOURCE_CHARS) {
    throw invalidPipeline(`source text exceeds ${MAX_HTML_VIDEO_SOURCE_CHARS} characters`);
  }
  const chunks = splitCopyIntoSceneTexts(copy, sceneLimit);
  return chunks.map((text, index) => ({
    index: index + 1,
    narration: text,
    title: shortSceneTitle(text, index + 1),
    captions: splitCaptionLines(text),
    sceneTemplate: index % 2 === 0 ? 'cinematic-title' : 'foreground-card',
    background: {
      prompt: appendBoundedSuffix(text, '，电影感背景，适合 HTML 动画视频'),
    },
    elements: [
      {
        slot: 0,
        prompt: appendBoundedSuffix(text, ' 的关键人物或物件，透明 PNG 前景素材'),
      },
    ],
  }));
}

function splitCopyIntoSceneTexts(copy: string, limit: number): string[] {
  const paragraphs = collectSceneTextChunks(copy, /\n{2,}/gu, Math.max(2, limit), false);
  if (paragraphs.length > 1) return paragraphs.slice(0, limit);
  return collectSceneTextChunks(copy, /[。！？!?；;]\s*/gu, limit, true);
}

function collectSceneTextChunks(
  copy: string,
  separator: RegExp,
  limit: number,
  includeSeparator: boolean,
): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (chunks.length < limit) {
    const match = separator.exec(copy);
    if (!match) break;
    const nextStart = match.index + match[0].length;
    const chunkEnd = includeSeparator ? nextStart : match.index;
    const chunk = copy.slice(start, chunkEnd).trim();
    if (chunk) chunks.push(chunk);
    start = nextStart;
  }
  if (chunks.length < limit) {
    const remainder = copy.slice(start).trim();
    if (remainder) chunks.push(remainder);
  }
  return chunks;
}

function splitCaptionLines(text: string): string[] {
  if (!text) return [];
  const lines: string[] = [];
  const separator = /[。！？!?；;]\s*/gu;
  let start = 0;
  while (lines.length < MAX_HTML_VIDEO_CAPTIONS_PER_SCENE - 1) {
    const match = separator.exec(text);
    if (!match) break;
    const end = match.index + match[0].length;
    const line = text.slice(start, end);
    if (line) lines.push(line);
    start = end;
  }
  const remainder = text.slice(start);
  if (remainder) lines.push(remainder);
  return lines.length ? lines : [text];
}

function appendBoundedSuffix(text: string, suffix: string): string {
  if (suffix.length >= MAX_HTML_VIDEO_SOURCE_CHARS) return suffix.slice(0, MAX_HTML_VIDEO_SOURCE_CHARS);
  return `${text.slice(0, MAX_HTML_VIDEO_SOURCE_CHARS - suffix.length)}${suffix}`;
}

function assetKey(sceneIndex: number, kind: HtmlVideoAsset['kind'], slot: number): string {
  return `${sceneIndex}:${kind}:${slot}`;
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
