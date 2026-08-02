import { AppError } from './app-error';
import type {
  CoverMetadata,
  CreateTaskInput,
  HtmlVideoAsset,
  HtmlVideoCompositionSnapshot,
  HtmlVideoConfigChange,
  HtmlVideoEditableConfigField,
  HtmlVideoJobConfig,
  HtmlVideoOutput,
  HtmlVideoPipelineData,
  HtmlVideoPipelineDataV2,
  HtmlVideoPipelineStep,
  HtmlVideoScenePlan,
  HtmlVideoSceneChange,
  HtmlVideoStepState,
  HtmlVideoStepStatus,
  HtmlVideoTabKey,
  HtmlVideoVisibleStep,
  HtmlVideoVoiceClip,
  Task,
  TaskStatus,
} from './types';
import {
  HTML_VIDEO_CONTROL_MANIFEST_V1,
  HTML_VIDEO_EDITABLE_CONTROL_FIELDS,
} from './html-video-control-manifest';
import {
  htmlVideoAspectRatioOrDefault,
  createHtmlVideoJobConfig,
  HTML_VIDEO_JOB_DEFAULTS,
  HTML_VIDEO_MAX_SCENES,
  preserveHtmlVideoJobConfig,
  recoverHtmlVideoJobConfig,
} from './html-video-config';
import { htmlVideoCaptionColorsEqual } from './html-video-captions';
import { normalizeHtmlVideoCoverMode, validateHtmlVideoCoverAsset } from './html-video-cover';

export const MAX_HTML_VIDEO_PIPELINE_JSON_CHARS = 1_000_000;
export const MAX_HTML_VIDEO_PIPELINE_FILE_BYTES = MAX_HTML_VIDEO_PIPELINE_JSON_CHARS * 4;
export const MAX_HTML_VIDEO_SCENES = HTML_VIDEO_MAX_SCENES;
export const MAX_HTML_VIDEO_SOURCE_CHARS = 16_384;
export const MAX_HTML_VIDEO_ELEMENTS_PER_SCENE = 4;
export const MAX_HTML_VIDEO_CAPTIONS_PER_SCENE = 32;
export const MAX_HTML_VIDEO_PLANNING_TEXT_CHARS = MAX_HTML_VIDEO_SOURCE_CHARS * 4 + 4096;
export const MAX_HTML_VIDEO_WARNINGS = 64;
export const MAX_HTML_VIDEO_WARNING_CHARS = 1024;
export const MAX_HTML_VIDEO_PATH_CHARS = 4096;

const MAX_HTML_VIDEO_DISPLAY_LIST_ITEMS = 32;
const MAX_HTML_VIDEO_DISPLAY_TEXT_CHARS = 1024;
const sha256Pattern = /^[a-f0-9]{64}$/u;

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

export function taskProgressLabel(task: Pick<Task, 'taskType' | 'currentStep'>): string {
  const total = task.taskType === 'html-video' ? htmlVideoVisibleSteps.length : 7;
  return `${Math.max(0, Math.min(task.currentStep, total))}/${total}`;
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

const legacyHtmlVideoStepFailureLabels: Record<string, string> = {
  rewrite: '文案改写',
  plan: '场景规划',
  planning: '场景规划',
  assets: '素材生成',
  voice: '配音生成',
  preview: '动画预览',
  render: '出片',
};

export function htmlVideoUserFacingError(message: string): string {
  const match = /^HTML video (rewrite|plan|planning|assets|voice|preview|render) step failed\.?$/iu.exec(message.trim());
  if (!match) return message;
  const label = legacyHtmlVideoStepFailureLabels[match[1].toLowerCase()];
  return `${label}失败。请从${label}重试。`;
}

export function fitHtmlVideoOutputSize(
  containerWidth: number,
  maxHeight: number,
  ratio: string | undefined,
): { width: number; height: number; aspectRatio: number } {
  const aspectRatio = htmlVideoAspectRatioOrDefault(ratio);
  const availableWidth = containerWidth > 0 ? containerWidth : 0;
  const availableHeight = Number.isFinite(maxHeight) && maxHeight > 0 ? maxHeight : 0;
  const width = Math.min(availableWidth, availableHeight * aspectRatio);
  return { width, height: width / aspectRatio, aspectRatio };
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
    const recovered = recoverHtmlVideoJobConfig({
      ratio: task.ratio,
      style: task.style,
      ttsProvider: task.ttsProvider,
      voiceId: task.speaker,
      ttsSpeed: Number.isFinite(task.ttsSpeed) && task.ttsSpeed > 0
        ? task.ttsSpeed
        : HTML_VIDEO_JOB_DEFAULTS.ttsSpeed,
      bgmId: task.bgmId,
      maxScenes,
      foreground: task.htmlVideoForeground ?? HTML_VIDEO_JOB_DEFAULTS.foreground,
      coverImageMode: normalizeHtmlVideoCoverMode(task.coverImageMode ?? HTML_VIDEO_JOB_DEFAULTS.coverImageMode),
      coverTemplate: task.coverTemplateId ?? HTML_VIDEO_JOB_DEFAULTS.coverTemplate,
    });
    const data = createHtmlVideoPipelineData(task.inputText, recovered.config);
    data.warnings.push('检测到 HTML 视频任务快照损坏，已从原始文案和任务配置重建。');
    data.warnings.push(...recovered.warnings);
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
  const resolvedConfig = createHtmlVideoJobConfig(config);
  const scenes = planHtmlVideoScenes(copy, resolvedConfig.maxScenes);
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
    config: resolvedConfig,
  };
  return withCompatibilityProjection(data, { videoTitle: titleFromCopy(copy) });
}

export function createHtmlVideoTaskInput(input: { copy: string } & HtmlVideoJobConfig): CreateTaskInput {
  const { copy, ...requestedConfig } = input;
  const data = createHtmlVideoPipelineData(copy, requestedConfig);
  const config = data.config;
  return {
    title: `${dateStamp()} · ${data.videoTitle}`,
    inputText: copy.trim(),
    taskKind: 'story',
    taskType: 'html-video',
    pipelineStep: 'rewrite',
    pipelineData: JSON.stringify(data),
    materialSource: 'paste',
    track: 'character-story',
    style: config.style,
    speaker: config.voiceId,
    ttsProvider: config.ttsProvider as Task['ttsProvider'],
    ttsSpeed: config.ttsSpeed,
    ratio: config.ratio,
    bgmId: config.bgmId,
    targetScenes: config.maxScenes,
    coverImageMode: config.coverImageMode,
    coverTemplateId: config.coverTemplate,
    htmlVideoForeground: config.foreground,
  };
}

export interface HtmlVideoConfigChangeResult {
  pipeline: HtmlVideoPipelineDataV2;
  changedFields: HtmlVideoEditableConfigField[];
  invalidateFrom: HtmlVideoVisibleStep;
  legacyMirrors: Partial<Pick<
    Task,
    | 'style'
    | 'speaker'
    | 'ttsProvider'
    | 'ttsSpeed'
    | 'bgmId'
    | 'coverImageMode'
    | 'coverTemplateId'
    | 'htmlVideoForeground'
    | 'targetScenes'
    | 'storyboardSceneCount'
    | 'ratio'
  >>;
}

export function applyHtmlVideoConfigChanges(
  value: HtmlVideoPipelineDataV2,
  changes: readonly HtmlVideoConfigChange[],
): HtmlVideoConfigChangeResult {
  if (changes.length < 1 || changes.length > HTML_VIDEO_EDITABLE_CONTROL_FIELDS.length) {
    throw new AppError(
      'HTML_VIDEO_CONFIG_PATCH_INVALID',
      `HTML 视频配置更新必须包含 1 到 ${HTML_VIDEO_EDITABLE_CONTROL_FIELDS.length} 个字段。`,
    );
  }

  const pipeline = parseHtmlVideoPipelineData(JSON.stringify(value));
  const seen = new Set<string>();
  const configChanges: HtmlVideoJobConfig = {};
  const changedFields: HtmlVideoEditableConfigField[] = [];
  for (const change of changes as ReadonlyArray<{ field: string; value: unknown }>) {
    if (seen.has(change.field)) {
      throw new AppError('HTML_VIDEO_CONFIG_PATCH_DUPLICATE', `HTML 视频配置字段重复：${change.field}`);
    }
    seen.add(change.field);
    if (!HTML_VIDEO_EDITABLE_CONTROL_FIELDS.includes(change.field as HtmlVideoEditableConfigField)
      || HTML_VIDEO_CONTROL_MANIFEST_V1[change.field as keyof typeof HTML_VIDEO_CONTROL_MANIFEST_V1]?.availability !== 'editable') {
      throw new AppError('HTML_VIDEO_CONFIG_READ_ONLY', `HTML 视频配置字段不可编辑：${change.field}`);
    }
    const parsed = preserveHtmlVideoJobConfig({ [change.field]: change.value });
    Object.assign(configChanges, parsed);
    const currentValue = pipeline.config[change.field as keyof HtmlVideoJobConfig];
    const nextValue = parsed[change.field as keyof HtmlVideoJobConfig];
    const unchanged = change.field === 'captionColors'
      ? htmlVideoCaptionColorsEqual(
          currentValue as HtmlVideoJobConfig['captionColors'],
          nextValue as HtmlVideoJobConfig['captionColors'],
        )
      : currentValue === nextValue;
    if (!unchanged) {
      changedFields.push(change.field as HtmlVideoEditableConfigField);
    }
  }
  if (changedFields.length === 0) {
    throw new AppError('HTML_VIDEO_CONFIG_UNCHANGED', 'HTML 视频配置没有发生变化。');
  }

  const invalidateFrom = changedFields.reduce<HtmlVideoVisibleStep>((earliest, field) => {
    const candidate = HTML_VIDEO_CONTROL_MANIFEST_V1[field].invalidateFrom;
    if (!candidate) throw new AppError('HTML_VIDEO_CONFIG_READ_ONLY', `HTML 视频配置字段不可编辑：${field}`);
    return htmlVideoVisibleSteps.indexOf(candidate) < htmlVideoVisibleSteps.indexOf(earliest)
      ? candidate
      : earliest;
  }, HTML_VIDEO_CONTROL_MANIFEST_V1[changedFields[0]].invalidateFrom as HtmlVideoVisibleStep);
  const invalidated = invalidateHtmlVideoPipeline(pipeline, invalidateFrom);
  invalidated.config = { ...invalidated.config, ...configChanges };
  invalidated.revision = pipeline.revision + 1;
  delete invalidated.configSnapshotHash;

  const legacyMirrors: HtmlVideoConfigChangeResult['legacyMirrors'] = {};
  for (const field of changedFields) {
    const nextValue = invalidated.config[field];
    if (field === 'style') legacyMirrors.style = String(nextValue);
    else if (field === 'voiceId') legacyMirrors.speaker = String(nextValue);
    else if (field === 'ttsProvider') legacyMirrors.ttsProvider = nextValue as Task['ttsProvider'];
    else if (field === 'ttsSpeed') legacyMirrors.ttsSpeed = Number(nextValue);
    else if (field === 'bgmId') legacyMirrors.bgmId = String(nextValue);
    else if (field === 'coverImageMode') legacyMirrors.coverImageMode = String(nextValue);
    else if (field === 'coverTemplate') legacyMirrors.coverTemplateId = String(nextValue);
    else if (field === 'foreground') legacyMirrors.htmlVideoForeground = Boolean(nextValue);
    else if (field === 'maxScenes') {
      legacyMirrors.targetScenes = Number(nextValue);
      legacyMirrors.storyboardSceneCount = Number(nextValue);
    } else if (field === 'ratio') legacyMirrors.ratio = String(nextValue);
  }

  return { pipeline: invalidated, changedFields, invalidateFrom, legacyMirrors };
}

export function invalidateHtmlVideoPipeline(
  value: HtmlVideoPipelineDataV2,
  fromStep: HtmlVideoVisibleStep,
): HtmlVideoPipelineDataV2 {
  const state = parseHtmlVideoPipelineData(JSON.stringify(value));
  const fromIndex = htmlVideoVisibleSteps.indexOf(fromStep);
  if (fromIndex < 0) throw new AppError('HTML_VIDEO_STEP_INVALID', 'HTML video rerun step is invalid.');

  for (const step of htmlVideoVisibleSteps.slice(fromIndex)) state.steps[step] = { status: 'pending' };
  if (fromIndex <= htmlVideoVisibleSteps.indexOf('planning')) state.scenes = [];
  if (fromIndex <= htmlVideoVisibleSteps.indexOf('assets')) state.assets = [];
  if (fromIndex <= htmlVideoVisibleSteps.indexOf('voice')) state.voices = [];
  if (fromIndex <= htmlVideoVisibleSteps.indexOf('preview')) state.compositions = [];
  if (fromIndex <= htmlVideoVisibleSteps.indexOf('render')) delete state.output;
  state.current = fromStep;
  return state;
}

export function applyHtmlVideoSceneChanges(
  pipeline: HtmlVideoPipelineDataV2,
  sceneIndex: number,
  changes: readonly HtmlVideoSceneChange[],
): HtmlVideoPipelineDataV2 {
  const next = structuredClone(pipeline);
  const scene = next.scenes.find((item) => item.index === sceneIndex);
  if (!scene) throw new AppError('HTML_VIDEO_SCENE_NOT_FOUND', `HTML 视频场景 ${sceneIndex} 不存在。`);
  for (const change of changes) {
    switch (change.field) {
      case 'narration': scene.narration = change.value; break;
      case 'title': scene.title = change.value; break;
      case 'titleHidden': scene.titleHidden = change.value; break;
      case 'captions': scene.captions = [...change.value]; break;
      case 'sceneTemplate': scene.sceneTemplate = change.value; break;
      case 'foregroundHidden': scene.foregroundHidden = change.value; break;
      case 'backgroundPrompt': scene.background.prompt = change.value; break;
      case 'addElement': {
        if (scene.elements.length >= MAX_HTML_VIDEO_ELEMENTS_PER_SCENE) {
          throw new AppError('HTML_VIDEO_ELEMENT_LIMIT', `场景 ${sceneIndex} 最多包含 ${MAX_HTML_VIDEO_ELEMENTS_PER_SCENE} 个前景。`);
        }
        const usedSlots = new Set(scene.elements.map((element) => element.slot));
        const slot = Array.from({ length: MAX_HTML_VIDEO_ELEMENTS_PER_SCENE }, (_, index) => index)
          .find((candidate) => !usedSlots.has(candidate));
        if (slot === undefined) throw new AppError('HTML_VIDEO_ELEMENT_LIMIT', `场景 ${sceneIndex} 没有可用的前景槽位。`);
        scene.elements.push({ slot, prompt: change.value });
        scene.elements.sort((left, right) => left.slot - right.slot);
        break;
      }
      case 'titleScale': scene.titleScale = change.value; break;
      case 'titleTopOverride': scene.titleTopOverride = change.value; break;
      case 'captionScale': scene.captionScale = change.value; break;
      case 'captionYOverride': scene.captionYOverride = change.value; break;
      case 'elementHidden': {
        const slots = new Set(scene.hiddenElementSlots ?? []);
        if (change.value) slots.add(change.slot);
        else slots.delete(change.slot);
        scene.hiddenElementSlots = [...slots].sort((left, right) => left - right);
        break;
      }
      case 'elementPrompt': {
        const element = scene.elements.find((item) => item.slot === change.slot);
        if (!element) throw new AppError('HTML_VIDEO_ELEMENT_NOT_FOUND', `场景 ${sceneIndex} 的前景槽位 ${change.slot} 不存在。`);
        element.prompt = change.value;
        break;
      }
    }
  }
  next.scenes = validateHtmlVideoScenePlans(next.scenes, next.config.maxScenes ?? MAX_HTML_VIDEO_SCENES);
  next.revision = pipeline.revision + 1;
  delete next.configSnapshotHash;
  return next;
}

export function prepareHtmlVideoPipelineForRerender(
  pipeline: HtmlVideoPipelineDataV2,
): HtmlVideoPipelineDataV2 {
  const next = parseHtmlVideoPipelineData(JSON.stringify(pipeline));
  if (next.compositions.length === 0) {
    throw new AppError('HTML_VIDEO_PREVIEW_MISSING', '请先生成动画预览，再重新出片。');
  }
  next.steps.render = { status: 'pending' };
  next.current = 'render';
  delete next.output;
  next.revision += 1;
  delete next.configSnapshotHash;
  return next;
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
  const configSnapshotHash = optionalBoundedString(value.configSnapshotHash, 'configSnapshotHash', 64);
  if (configSnapshotHash !== undefined && !sha256Pattern.test(configSnapshotHash)) {
    throw invalidPipeline('configSnapshotHash must be a SHA-256 digest');
  }
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
    ...(configSnapshotHash === undefined ? {} : { configSnapshotHash }),
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
    ...(value.coverAsset === undefined ? {} : { coverAsset: validateHtmlVideoCoverAsset(value.coverAsset) }),
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
  const artifactHash = optionalBoundedString(record.artifactHash, `${field}.artifactHash`, 64);
  if (artifactHash !== undefined && !sha256Pattern.test(artifactHash)) {
    throw invalidPipeline(`${field}.artifactHash must be a SHA-256 digest`);
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
    ...(artifactHash === undefined ? {} : { artifactHash }),
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
  const hiddenElementSlots = scene.hiddenElementSlots === undefined
    ? undefined
    : requireBoundedArray(
        scene.hiddenElementSlots,
        `${field}.hiddenElementSlots`,
        MAX_HTML_VIDEO_ELEMENTS_PER_SCENE,
      ).map((slot, index) => requireNonNegativeInteger(slot, `${field}.hiddenElementSlots[${index}]`));
  if (hiddenElementSlots && new Set(hiddenElementSlots).size !== hiddenElementSlots.length) {
    throw invalidPipeline(`${field}.hiddenElementSlots contains duplicate slots`);
  }

  return {
    index,
    narration,
    title,
    ...(optionalBoolean(scene.titleHidden, `${field}.titleHidden`) === undefined ? {} : { titleHidden: Boolean(scene.titleHidden) }),
    captions,
    sceneTemplate,
    ...(optionalBoolean(scene.foregroundHidden, `${field}.foregroundHidden`) === undefined ? {} : { foregroundHidden: Boolean(scene.foregroundHidden) }),
    ...(hiddenElementSlots === undefined ? {} : { hiddenElementSlots }),
    ...(optionalBoundedNumber(scene.titleScale, `${field}.titleScale`, 0.25, 3) === undefined ? {} : { titleScale: Number(scene.titleScale) }),
    ...(optionalBoundedNumber(scene.titleTopOverride, `${field}.titleTopOverride`, 0, 100) === undefined ? {} : { titleTopOverride: Number(scene.titleTopOverride) }),
    ...(optionalBoundedNumber(scene.captionScale, `${field}.captionScale`, 0.25, 3) === undefined ? {} : { captionScale: Number(scene.captionScale) }),
    ...(optionalBoundedNumber(scene.captionYOverride, `${field}.captionYOverride`, 0, 100) === undefined ? {} : { captionYOverride: Number(scene.captionYOverride) }),
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
    ...(output.draft === undefined ? {} : { draft: parseHtmlVideoDraftOutput(output.draft) }),
  };
}

function parseHtmlVideoDraftOutput(value: unknown): NonNullable<HtmlVideoOutput['draft']> {
  const draft = requireRecord(value, 'output.draft');
  return {
    draftDir: requireBoundedString(draft.draftDir, 'output.draft.draftDir', MAX_HTML_VIDEO_PATH_CHARS),
    draftContentPath: requireBoundedString(draft.draftContentPath, 'output.draft.draftContentPath', MAX_HTML_VIDEO_PATH_CHARS),
    draftMetaPath: requireBoundedString(draft.draftMetaPath, 'output.draft.draftMetaPath', MAX_HTML_VIDEO_PATH_CHARS),
    ...(optionalBoundedString(draft.draftId, 'output.draft.draftId', MAX_HTML_VIDEO_DISPLAY_TEXT_CHARS) === undefined ? {} : { draftId: String(draft.draftId) }),
    ...(optionalBoundedString(draft.sourceVideoPath, 'output.draft.sourceVideoPath', MAX_HTML_VIDEO_PATH_CHARS) === undefined ? {} : { sourceVideoPath: String(draft.sourceVideoPath) }),
  };
}

function parseConfig(value: unknown, field: string): HtmlVideoJobConfig {
  try {
    return preserveHtmlVideoJobConfig(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : `${field} is invalid`;
    throw invalidPipeline(message);
  }
}

function cloneConfig(config: HtmlVideoJobConfig): HtmlVideoJobConfig {
  return preserveHtmlVideoJobConfig(config);
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

function requireNonNegativeNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw invalidPipeline(`${field} must be a non-negative number`);
  return value;
}

function optionalNonNegativeNumber(value: unknown, field: string): number | undefined {
  return value === undefined ? undefined : requireNonNegativeNumber(value, field);
}

function optionalBoundedNumber(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw invalidPipeline(`${field} must be a number in the range ${minimum}-${maximum}`);
  }
  return value;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw invalidPipeline(`${field} must be a boolean`);
  return value;
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
