import {
  HTML_VIDEO_CONTROL_FIELDS,
  HTML_VIDEO_CONTROL_MANIFEST_V1,
  type HtmlVideoControlField,
} from './html-video-control-manifest';
import type { HtmlVideoJobConfig, HtmlVideoSceneMotion, HtmlVideoVisibleStep } from './types';
import {
  validateHtmlVideoCaptionAnimation,
  validateHtmlVideoCaptionColors,
  validateHtmlVideoCaptionPreset,
} from './html-video-captions';
import { normalizeHtmlVideoCoverMode, normalizeHtmlVideoCoverRatio } from './html-video-cover';

export const HTML_VIDEO_MAX_SCENES = 30;
export const HTML_VIDEO_TTS_SPEED_MIN = 0.1;
export const HTML_VIDEO_TTS_SPEED_MAX = 10;
export const HTML_VIDEO_TTS_PROVIDERS = ['volcengine', 'minimax', 'mock'] as const;
export const HTML_VIDEO_BGM_VOLUMES = ['soft', 'medium', 'loud'] as const;
export const HTML_VIDEO_TRANSITIONS = [
  'fade',
  'dissolve',
  'wipeleft',
  'wiperight',
  'slideleft',
  'slideright',
] as const;
export const HTML_VIDEO_SCENE_MOTIONS = [
  'auto',
  'none',
  'zoom_in',
  'zoom_out',
  'zoom_pan_up',
  'zoom_pan_down',
  'pan_left',
  'pan_right',
] as const satisfies readonly HtmlVideoSceneMotion[];
export const HTML_VIDEO_TTS_PROVIDER_LABELS = {
  volcengine: '火山引擎',
  minimax: 'MiniMax',
  mock: '模拟配音',
} as const satisfies Record<(typeof HTML_VIDEO_TTS_PROVIDERS)[number], string>;
export const HTML_VIDEO_TRANSITION_LABELS = {
  fade: '淡入淡出',
  dissolve: '叠化',
  wipeleft: '向左擦除',
  wiperight: '向右擦除',
  slideleft: '向左滑动',
  slideright: '向右滑动',
} as const satisfies Record<(typeof HTML_VIDEO_TRANSITIONS)[number], string>;
export const HTML_VIDEO_SCENE_MOTION_LABELS = {
  auto: '跟随画面预设',
  none: '无镜头运动',
  zoom_in: '缓慢推进',
  zoom_out: '缓慢拉远',
  zoom_pan_up: '推进上移',
  zoom_pan_down: '推进下移',
  pan_left: '向左横移',
  pan_right: '向右横移',
} as const satisfies Record<HtmlVideoSceneMotion, string>;
export const HTML_VIDEO_RATIOS = ['9:16', '16:9', '1:1', '4:3'] as const;

type HtmlVideoDefaultedField =
  | 'style'
  | 'voiceId'
  | 'ttsProvider'
  | 'ttsSpeed'
  | 'bgmId'
  | 'transitionType'
  | 'sceneMotion'
  | 'coverImageMode'
  | 'coverTemplate'
  | 'coverRatio'
  | 'foreground'
  | 'maxScenes'
  | 'ratio';

type HtmlVideoMissingCompatibleField = Exclude<HtmlVideoControlField, HtmlVideoDefaultedField>;

export type HtmlVideoNewJobConfig = HtmlVideoJobConfig & Required<Pick<HtmlVideoJobConfig, HtmlVideoDefaultedField>>;

const MAX_CONFIG_STRING_CHARS = 1024;
const HTML_VIDEO_DEFAULTED_FIELDS: readonly HtmlVideoDefaultedField[] = [
  'style',
  'voiceId',
  'ttsProvider',
  'ttsSpeed',
  'bgmId',
  'transitionType',
  'sceneMotion',
  'coverImageMode',
  'coverTemplate',
  'coverRatio',
  'foreground',
  'maxScenes',
  'ratio',
];
const HTML_VIDEO_MISSING_COMPATIBLE_FIELDS: readonly HtmlVideoMissingCompatibleField[] = [
  'captionPreset',
  'captionAnim',
  'captionColors',
  'bgmVolume',
  'coverPrompt',
  'draftTemplate',
];

export const HTML_VIDEO_JOB_DEFAULTS = {
  style: 'modern-film',
  voiceId: '',
  ttsProvider: 'volcengine',
  ttsSpeed: 1,
  bgmId: '',
  captionPreset: undefined,
  captionAnim: undefined,
  captionColors: undefined,
  bgmVolume: undefined,
  transitionType: 'fade',
  sceneMotion: 'auto',
  coverImageMode: 'off',
  coverTemplate: 'cinematic-poster',
  coverRatio: '3:4',
  coverPrompt: undefined,
  draftTemplate: undefined,
  foreground: true,
  maxScenes: 8,
  ratio: '9:16',
} as const satisfies Record<HtmlVideoControlField, unknown>;

export function createHtmlVideoJobConfig(
  overrides: HtmlVideoJobConfig = {},
): HtmlVideoNewJobConfig {
  const parsed = preserveHtmlVideoJobConfig(overrides);
  return preserveHtmlVideoJobConfig({ ...HTML_VIDEO_JOB_DEFAULTS, ...parsed }) as HtmlVideoNewJobConfig;
}

export function preserveHtmlVideoJobConfig(value: unknown): HtmlVideoJobConfig {
  if (!isRecord(value)) throw invalidConfig('must be an object');
  const unknownField = Object.keys(value).find(
    (field) => !HTML_VIDEO_CONTROL_FIELDS.includes(field as HtmlVideoControlField),
  );
  if (unknownField) throw invalidConfig(`contains unknown field ${unknownField}`);

  const result: HtmlVideoJobConfig = {};
  for (const field of HTML_VIDEO_CONTROL_FIELDS) {
    const current = value[field];
    if (current === undefined) continue;
    if (field === 'ttsProvider') {
      result.ttsProvider = requireEnum(current, field, HTML_VIDEO_TTS_PROVIDERS);
    } else if (field === 'ttsSpeed') {
      result.ttsSpeed = requireFiniteRange(
        current,
        field,
        HTML_VIDEO_TTS_SPEED_MIN,
        HTML_VIDEO_TTS_SPEED_MAX,
      );
    } else if (field === 'bgmVolume') {
      result.bgmVolume = requireEnum(current, field, HTML_VIDEO_BGM_VOLUMES);
    } else if (field === 'transitionType') {
      result.transitionType = requireEnum(current, field, HTML_VIDEO_TRANSITIONS);
    } else if (field === 'sceneMotion') {
      result.sceneMotion = requireEnum(current, field, HTML_VIDEO_SCENE_MOTIONS);
    } else if (field === 'foreground') {
      if (typeof current !== 'boolean') throw invalidConfig(`${field} is invalid`);
      result.foreground = current;
    } else if (field === 'maxScenes') {
      if (!Number.isSafeInteger(current) || Number(current) < 1 || Number(current) > HTML_VIDEO_MAX_SCENES) {
        throw invalidConfig(`${field} must be an integer from 1 to ${HTML_VIDEO_MAX_SCENES}`);
      }
      result.maxScenes = Number(current);
    } else if (field === 'ratio') {
      result.ratio = requireEnum(current, field, HTML_VIDEO_RATIOS);
    } else if (field === 'captionPreset') {
      result.captionPreset = validateHtmlVideoCaptionPreset(current);
    } else if (field === 'captionAnim') {
      result.captionAnim = validateHtmlVideoCaptionAnimation(current);
    } else if (field === 'captionColors') {
      result.captionColors = validateHtmlVideoCaptionColors(current) as Record<string, string>;
    } else if (field === 'coverImageMode') {
      try {
        result.coverImageMode = normalizeHtmlVideoCoverMode(current);
      } catch {
        throw invalidConfig(`${field} is invalid`);
      }
    } else if (field === 'coverRatio') {
      try {
        result.coverRatio = normalizeHtmlVideoCoverRatio(current);
      } catch {
        throw invalidConfig(`${field} is invalid`);
      }
    } else if (field === 'coverPrompt') {
      result.coverPrompt = requireBoundedString(current, field, 16_384);
    } else {
      result[field] = requireBoundedString(current, field);
    }
  }
  return result;
}

export function recoverHtmlVideoJobConfig(overrides: HtmlVideoJobConfig): {
  config: HtmlVideoNewJobConfig;
  defaultedFields: HtmlVideoDefaultedField[];
  missingCompatibleFields: HtmlVideoMissingCompatibleField[];
  warnings: string[];
} {
  const parsed = preserveHtmlVideoJobConfig(overrides);
  const defaultedFields = HTML_VIDEO_DEFAULTED_FIELDS.filter((field) => parsed[field] === undefined);
  const missingCompatibleFields = HTML_VIDEO_MISSING_COMPATIBLE_FIELDS.filter(
    (field) => parsed[field] === undefined,
  );
  return {
    config: createHtmlVideoJobConfig(parsed),
    defaultedFields: [...defaultedFields],
    missingCompatibleFields: [...missingCompatibleFields],
    warnings: [
      ...(defaultedFields.length ? [`HTML 视频配置恢复时使用默认值：${defaultedFields.join(', ')}`] : []),
      ...(missingCompatibleFields.length
        ? [`HTML 视频配置无法从任务镜像恢复，已保持缺失：${missingCompatibleFields.join(', ')}`]
        : []),
    ],
  };
}

export function htmlVideoConfigForStage(
  config: HtmlVideoJobConfig,
  stage: HtmlVideoVisibleStep,
): HtmlVideoJobConfig {
  const parsed = createHtmlVideoJobConfig(config);
  const projected: HtmlVideoJobConfig = {};
  for (const field of HTML_VIDEO_CONTROL_FIELDS) {
    const contract = HTML_VIDEO_CONTROL_MANIFEST_V1[field];
    const isDependency = contract.promptDependencyStages.includes(stage as 'rewrite' | 'planning')
      || contract.consumerStages.includes(stage);
    if (parsed[field] === undefined || !isDependency) continue;
    Object.assign(projected, { [field]: parsed[field] });
  }
  return cloneHtmlVideoJobConfig(projected);
}

export function htmlVideoConfigEnvelopeForStage(
  config: HtmlVideoJobConfig,
  stage: HtmlVideoVisibleStep,
): { config: HtmlVideoJobConfig; configSnapshot: HtmlVideoJobConfig } {
  return {
    config: htmlVideoConfigForStage(config, stage),
    configSnapshot: cloneHtmlVideoJobConfig(createHtmlVideoJobConfig(config)),
  };
}

export function htmlVideoRatioOrDefault(value: string | undefined): typeof HTML_VIDEO_RATIOS[number] {
  return HTML_VIDEO_RATIOS.includes(value as typeof HTML_VIDEO_RATIOS[number])
    ? value as typeof HTML_VIDEO_RATIOS[number]
    : HTML_VIDEO_JOB_DEFAULTS.ratio as typeof HTML_VIDEO_RATIOS[number];
}

export function htmlVideoAspectRatioOrDefault(value: string | undefined): number {
  const match = value?.trim().match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/u);
  if (match) {
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (width > 0 && height > 0) return width / height;
  }
  const [width, height] = HTML_VIDEO_JOB_DEFAULTS.ratio.split(':').map(Number);
  return width / height;
}

export function htmlVideoBgmTargetDb(volume: HtmlVideoJobConfig['bgmVolume']): number {
  if (volume === 'loud') return -16;
  if (volume === 'medium') return -22;
  return -28;
}

function cloneHtmlVideoJobConfig(config: HtmlVideoJobConfig): HtmlVideoJobConfig {
  return {
    ...config,
    ...(config.captionColors ? { captionColors: { ...config.captionColors } } : {}),
  };
}

function requireBoundedString(value: unknown, field: string, maximum = MAX_CONFIG_STRING_CHARS): string {
  if (typeof value !== 'string' || value.length > maximum) throw invalidConfig(`${field} is invalid`);
  return value;
}

function requireFiniteRange(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw invalidConfig(`${field} must be from ${minimum} to ${maximum}`);
  }
  return value;
}

function requireEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw invalidConfig(`${field} is invalid`);
  return value as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidConfig(reason: string): Error {
  return new Error(`HTML video config ${reason}.`);
}
