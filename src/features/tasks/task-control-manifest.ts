import { CUSTOM_COVER_TEMPLATE_FIELDS } from '../../shared/editorial-data-contracts';
import { pauseOptions } from '../../shared/editorial-options';
import type { CreateTaskInput, CustomCoverTemplate, Task } from '../../shared/types';

export type NewTaskFieldStage = 'material' | 'creative' | 'output' | 'system';

export const NEW_TASK_CREATE_FIELD_STAGE = {
  title: 'material',
  inputText: 'material',
  taskKind: 'system',
  processingMode: 'creative',
  publishMode: 'creative',
  mode: 'material',
  aiKeyword: 'material',
  aiSources: 'material',
  selectedSources: 'material',
  extraRequirements: 'material',
  imagePromptReference: 'system',
  track: 'creative',
  style: 'creative',
  speaker: 'output',
  ratio: 'output',
  templateId: 'creative',
  bgmId: 'output',
  pausePoints: 'output',
  promptTemplateId: 'creative',
  promptTemplateType: 'system',
  referenceImagePath: 'output',
  rewriteIntensity: 'creative',
  narrativePov: 'creative',
  keepPromotion: 'creative',
  ttsProvider: 'output',
  ttsSpeed: 'output',
  storyboardSceneCount: 'output',
  step3PromptSnapshot: 'system',
  musicMv: 'system',
  videoForm: 'creative',
  llmProfileId: 'output',
  materialSource: 'material',
  productInfo: 'material',
  materialPerson: 'material',
  draftDir: 'system',
  fixedIntro: 'material',
  outroCta: 'material',
  lockIntroSentences: 'material',
  taskType: 'system',
  pipelineStep: 'system',
  pipelineData: 'system',
  targetLength: 'output',
  targetScenes: 'output',
  scriptFormat: 'system',
  podcastImageMode: 'creative',
  podcastSpeakers: 'creative',
  podcastSpeakerA: 'system',
  podcastSpeakerB: 'system',
  coverImageMode: 'output',
  coverTemplateId: 'output',
  htmlVideoForeground: 'system',
} as const satisfies Record<keyof CreateTaskInput, NewTaskFieldStage>;

export const NEW_TASK_CREATE_FIELDS_BY_STAGE = {
  material: Object.keys(NEW_TASK_CREATE_FIELD_STAGE).filter((field) => NEW_TASK_CREATE_FIELD_STAGE[field as keyof CreateTaskInput] === 'material'),
  creative: Object.keys(NEW_TASK_CREATE_FIELD_STAGE).filter((field) => NEW_TASK_CREATE_FIELD_STAGE[field as keyof CreateTaskInput] === 'creative'),
  output: Object.keys(NEW_TASK_CREATE_FIELD_STAGE).filter((field) => NEW_TASK_CREATE_FIELD_STAGE[field as keyof CreateTaskInput] === 'output'),
  system: Object.keys(NEW_TASK_CREATE_FIELD_STAGE).filter((field) => NEW_TASK_CREATE_FIELD_STAGE[field as keyof CreateTaskInput] === 'system'),
} as const;

// The legacy `custom` value has no step selector. Keep it readable from old tasks,
// but do not offer a control that cannot produce a complete configuration.
export const NEW_TASK_PAUSE_OPTIONS = pauseOptions.filter(([id]) => id !== 'custom');

export const ORDINARY_COVER_MODE_MANIFEST = {
  off: { label: '关闭', available: true },
  auto: { label: '自动', available: true },
  manual: { label: '手动封面', available: false },
} as const;

export type OrdinaryCoverMode = keyof typeof ORDINARY_COVER_MODE_MANIFEST;

export const ORDINARY_AVAILABLE_COVER_MODES = (Object.keys(ORDINARY_COVER_MODE_MANIFEST) as OrdinaryCoverMode[])
  .filter((mode) => ORDINARY_COVER_MODE_MANIFEST[mode].available);

export function parseOrdinaryCoverMode(value: unknown): OrdinaryCoverMode {
  if (typeof value === 'string' && value in ORDINARY_COVER_MODE_MANIFEST) {
    return value as OrdinaryCoverMode;
  }
  throw new Error(`ORDINARY_COVER_MODE_INVALID: Unsupported ordinary cover mode: ${String(value)}`);
}

export function resolveOrdinaryCoverTemplate(
  modeInput: unknown,
  templateId: string | null | undefined,
  templates: CustomCoverTemplate[],
): CustomCoverTemplate | null {
  const mode = parseOrdinaryCoverMode(modeInput ?? 'off');
  if (mode === 'off') return null;
  if (mode === 'manual') {
    throw new Error('ORDINARY_MANUAL_COVER_UNAVAILABLE: 手动封面暂不可用，请先使用关闭或自动封面。');
  }
  const selected = templates.find((template) => template.id === templateId);
  if (!selected) {
    throw new Error(`ORDINARY_COVER_TEMPLATE_NOT_FOUND: Cover template does not exist: ${templateId ?? ''}`);
  }
  for (const field of Object.keys(CUSTOM_COVER_TEMPLATE_FIELDS) as Array<keyof CustomCoverTemplate>) {
    if (typeof selected[field] !== 'string' || selected[field].trim().length === 0) {
      throw new Error(`ORDINARY_COVER_TEMPLATE_INVALID: Cover template field is empty: ${field}`);
    }
  }
  return selected;
}

export function isOrdinaryTask(task: Pick<Task, 'taskKind' | 'taskType'>): boolean {
  return (task.taskType ?? task.taskKind) === 'story';
}
