import type { HtmlVideoEditableConfigField, HtmlVideoJobConfig, HtmlVideoVisibleStep } from './types';

export const HTML_VIDEO_CONTROL_MANIFEST_VERSION = 1 as const;

export const HTML_VIDEO_CONTROL_FIELDS = [
  'style',
  'voiceId',
  'ttsProvider',
  'ttsSpeed',
  'bgmId',
  'captionPreset',
  'captionAnim',
  'captionColors',
  'bgmVolume',
  'transitionType',
  'coverImageMode',
  'coverTemplate',
  'coverRatio',
  'draftTemplate',
  'foreground',
  'maxScenes',
  'ratio',
] as const satisfies readonly (keyof HtmlVideoJobConfig)[];

export type HtmlVideoControlField = typeof HTML_VIDEO_CONTROL_FIELDS[number];
export const HTML_VIDEO_EDITABLE_CONTROL_FIELDS = [
  'style',
  'voiceId',
  'ttsProvider',
  'ttsSpeed',
  'bgmId',
  'captionPreset',
  'captionAnim',
  'captionColors',
  'bgmVolume',
  'transitionType',
  'coverImageMode',
  'coverTemplate',
  'coverRatio',
  'foreground',
  'maxScenes',
  'ratio',
] as const satisfies readonly HtmlVideoEditableConfigField[];
export type HtmlVideoControlAvailability = 'editable' | 'read-only-compatible';
export type HtmlVideoControlUiLocation = 'parameters' | 'voice' | 'caption' | 'render' | 'cover' | 'draft';

export interface HtmlVideoControlManifestEntry {
  defaultResolver: HtmlVideoControlField;
  schema: string;
  uiLocation: HtmlVideoControlUiLocation;
  persistencePath: 'pipelineData.config';
  legacyMirror: string | null;
  promptStages: readonly Extract<HtmlVideoVisibleStep, 'rewrite' | 'planning'>[];
  promptDependencyStages: readonly Extract<HtmlVideoVisibleStep, 'rewrite' | 'planning'>[];
  consumerStages: readonly HtmlVideoVisibleStep[];
  invalidateFrom: HtmlVideoVisibleStep | null;
  availability: HtmlVideoControlAvailability;
  tests: readonly string[];
}

function entry(
  field: HtmlVideoControlField,
  options: Omit<
    HtmlVideoControlManifestEntry,
    'defaultResolver' | 'persistencePath' | 'promptStages' | 'promptDependencyStages' | 'tests'
  > & Pick<Partial<HtmlVideoControlManifestEntry>, 'promptDependencyStages'>,
): HtmlVideoControlManifestEntry {
  return {
    defaultResolver: field,
    persistencePath: 'pipelineData.config',
    promptStages: ['rewrite', 'planning'],
    promptDependencyStages: [],
    tests: [`html-video-control-manifest:${field}`],
    ...options,
  };
}

export const HTML_VIDEO_CONTROL_MANIFEST_V1 = {
  style: entry('style', {
    schema: 'bounded-string', uiLocation: 'parameters', legacyMirror: 'style',
    consumerStages: ['assets'], invalidateFrom: 'assets', availability: 'editable',
  }),
  voiceId: entry('voiceId', {
    schema: 'bounded-string', uiLocation: 'voice', legacyMirror: 'speaker',
    consumerStages: ['voice'], invalidateFrom: 'voice', availability: 'editable',
  }),
  ttsProvider: entry('ttsProvider', {
    schema: 'tts-provider', uiLocation: 'voice', legacyMirror: 'ttsProvider',
    consumerStages: ['voice'], invalidateFrom: 'voice', availability: 'editable',
  }),
  ttsSpeed: entry('ttsSpeed', {
    schema: 'tts-speed', uiLocation: 'voice', legacyMirror: 'ttsSpeed',
    consumerStages: ['voice'], invalidateFrom: 'voice', availability: 'editable',
  }),
  bgmId: entry('bgmId', {
    schema: 'bounded-string', uiLocation: 'render', legacyMirror: 'bgmId',
    consumerStages: ['render'], invalidateFrom: 'render', availability: 'editable',
  }),
  captionPreset: entry('captionPreset', {
    schema: 'caption-preset', uiLocation: 'caption', legacyMirror: null,
    consumerStages: ['preview', 'render'], invalidateFrom: 'preview', availability: 'editable',
  }),
  captionAnim: entry('captionAnim', {
    schema: 'caption-animation', uiLocation: 'caption', legacyMirror: null,
    consumerStages: ['preview', 'render'], invalidateFrom: 'preview', availability: 'editable',
  }),
  captionColors: entry('captionColors', {
    schema: 'caption-colors', uiLocation: 'caption', legacyMirror: null,
    consumerStages: ['preview', 'render'], invalidateFrom: 'preview', availability: 'editable',
  }),
  bgmVolume: entry('bgmVolume', {
    schema: 'bgm-volume', uiLocation: 'render', legacyMirror: null,
    consumerStages: ['render'], invalidateFrom: 'render', availability: 'editable',
  }),
  transitionType: entry('transitionType', {
    schema: 'transition', uiLocation: 'render', legacyMirror: null,
    consumerStages: ['render'], invalidateFrom: 'render', availability: 'editable',
  }),
  coverImageMode: entry('coverImageMode', {
    schema: 'cover-mode', uiLocation: 'cover', legacyMirror: 'coverImageMode',
    consumerStages: ['render'], invalidateFrom: 'render', availability: 'editable',
  }),
  coverTemplate: entry('coverTemplate', {
    schema: 'cover-template-id', uiLocation: 'cover', legacyMirror: 'coverTemplateId',
    consumerStages: ['render'], invalidateFrom: 'render', availability: 'editable',
  }),
  coverRatio: entry('coverRatio', {
    schema: 'cover-ratio', uiLocation: 'cover', legacyMirror: null,
    consumerStages: ['render'], invalidateFrom: 'render', availability: 'editable',
  }),
  draftTemplate: entry('draftTemplate', {
    schema: 'compatible-string', uiLocation: 'draft', legacyMirror: null,
    consumerStages: [], invalidateFrom: null, availability: 'read-only-compatible',
  }),
  foreground: entry('foreground', {
    schema: 'boolean', uiLocation: 'parameters', legacyMirror: 'htmlVideoForeground',
    consumerStages: ['assets'], invalidateFrom: 'assets', availability: 'editable',
  }),
  maxScenes: entry('maxScenes', {
    schema: 'scene-count', uiLocation: 'parameters', legacyMirror: 'targetScenes|storyboardSceneCount',
    promptDependencyStages: ['rewrite', 'planning'],
    consumerStages: ['rewrite', 'planning'], invalidateFrom: 'rewrite', availability: 'editable',
  }),
  ratio: entry('ratio', {
    schema: 'ratio', uiLocation: 'parameters', legacyMirror: 'ratio',
    consumerStages: ['assets', 'preview', 'render'], invalidateFrom: 'assets', availability: 'editable',
  }),
} as const satisfies { [K in keyof HtmlVideoJobConfig]-?: HtmlVideoControlManifestEntry };
