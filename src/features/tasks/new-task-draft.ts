import type {
  AiSourceContext,
  ContentPlatform,
  ImageGenerationQuality,
  NarrativePov,
  OrdinaryTaskCoverSelection,
  PausePoint,
  PodcastSpeakerPair,
  ProcessingMode,
  RewriteIntensity,
  TaskMode,
  TaskVideoForm,
  WebSearchProvider,
} from '../../shared/types';
import type { RuntimeTtsProvider } from '../../shared/tts-voices';
import type { OrdinaryCoverMode } from './task-control-manifest';

export const NEW_TASK_DRAFT_STORAGE_KEY = 'storydream.new-task-draft.v1';
export const NEW_TASK_PRESET_STORAGE_KEY = 'storydream.new-task-presets.v1';
export const MAX_NEW_TASK_PRESETS = 12;

export type NewTaskStage = 'material' | 'creative' | 'output';

export interface NewTaskDraftValues {
  title?: string;
  inputText?: string;
  mode?: TaskMode;
  aiKeyword?: string;
  aiSources?: string[];
  webSearchProviders?: WebSearchProvider[];
  extraRequirements?: string;
  track?: string;
  style?: string;
  templateId?: string;
  ratio?: string;
  imageQuality?: 'default' | ImageGenerationQuality;
  selectedTaskLlmProfileId?: string;
  promptTemplateOverrideId?: string;
  promptTemplateManuallyOverridden?: boolean;
  styleManuallyOverridden?: boolean;
  draftTemplateManuallyOverridden?: boolean;
  ratioManuallyOverridden?: boolean;
  ttsProvider?: RuntimeTtsProvider;
  speaker?: string;
  bgmId?: string;
  referenceImagePath?: string;
  pausePoint?: PausePoint;
  processingMode?: ProcessingMode;
  platformVariants?: ContentPlatform[];
  versionsPerPlatform?: number;
  rewriteIntensity?: RewriteIntensity;
  narrativePov?: NarrativePov;
  keepPromotion?: boolean;
  productInfo?: string | null;
  materialSource?: 'ai' | 'local';
  materialPerson?: string;
  fixedIntro?: string;
  outroCta?: string;
  lockIntroSentences?: string;
  ttsSpeed?: number;
  targetLength?: string;
  storyboardSceneCount?: string;
  publishMode?: 'review-rewrite' | 'direct-copy';
  videoForm?: TaskVideoForm;
  coverImageMode?: OrdinaryCoverMode;
  coverTemplateId?: string;
  coverPageEnabled?: boolean;
  coverPageText?: string;
  manualCoverAsset?: OrdinaryTaskCoverSelection;
  autoBorrowImage?: boolean;
  podcastImageMode?: string;
  podcastSpeakers?: PodcastSpeakerPair;
  selectedSearchSourceIds?: string[];
  selectedSources?: AiSourceContext['sections'];
  researchCopy?: string;
}

export interface NewTaskDraftSnapshot {
  version: 1;
  savedAt: string;
  activeStage: NewTaskStage;
  values: NewTaskDraftValues;
}

export interface NewTaskPreset {
  id: string;
  name: string;
  savedAt: string;
  snapshot: NewTaskDraftSnapshot;
}

interface NewTaskPresetCollection {
  version: 1;
  presets: NewTaskPreset[];
}

export function readNewTaskDraft(storage: Pick<Storage, 'getItem'>): NewTaskDraftSnapshot | null {
  try {
    const raw = storage.getItem(NEW_TASK_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<NewTaskDraftSnapshot>;
    if (
      value.version !== 1
      || typeof value.savedAt !== 'string'
      || !isNewTaskStage(value.activeStage)
      || !value.values
      || typeof value.values !== 'object'
      || Array.isArray(value.values)
    ) {
      return null;
    }
    return value as NewTaskDraftSnapshot;
  } catch {
    return null;
  }
}

export function writeNewTaskDraft(
  storage: Pick<Storage, 'setItem'>,
  draft: NewTaskDraftSnapshot,
): void {
  storage.setItem(NEW_TASK_DRAFT_STORAGE_KEY, JSON.stringify(draft));
}

export function clearNewTaskDraft(storage: Pick<Storage, 'removeItem'>): void {
  storage.removeItem(NEW_TASK_DRAFT_STORAGE_KEY);
}

export function createNewTaskPreset(input: { id: string; name: string; snapshot: NewTaskDraftSnapshot }): NewTaskPreset {
  const id = input.id.trim();
  const name = normalizePresetName(input.name);
  if (!id) throw new Error('NEW_TASK_PRESET_ID_INVALID: Preset id is required.');
  return {
    id,
    name,
    savedAt: input.snapshot.savedAt,
    snapshot: snapshotForPreset(input.snapshot),
  };
}

export function readNewTaskPresets(storage: Pick<Storage, 'getItem'>): NewTaskPreset[] {
  try {
    const raw = storage.getItem(NEW_TASK_PRESET_STORAGE_KEY);
    if (!raw) return [];
    const value = JSON.parse(raw) as Partial<NewTaskPresetCollection>;
    if (value.version !== 1 || !Array.isArray(value.presets)) return [];
    return value.presets.map((preset) => createNewTaskPreset(preset)).slice(0, MAX_NEW_TASK_PRESETS);
  } catch {
    return [];
  }
}

export function writeNewTaskPresets(
  storage: Pick<Storage, 'setItem'>,
  presets: readonly NewTaskPreset[],
): void {
  const collection: NewTaskPresetCollection = {
    version: 1,
    presets: presets.map((preset) => createNewTaskPreset(preset)).slice(0, MAX_NEW_TASK_PRESETS),
  };
  storage.setItem(NEW_TASK_PRESET_STORAGE_KEY, JSON.stringify(collection));
}

export function upsertNewTaskPreset(
  presets: readonly NewTaskPreset[],
  preset: NewTaskPreset,
): NewTaskPreset[] {
  return [preset, ...presets.filter((item) => item.id !== preset.id)]
    .slice(0, MAX_NEW_TASK_PRESETS);
}

export function deleteNewTaskPreset(presets: readonly NewTaskPreset[], id: string): NewTaskPreset[] {
  return presets.filter((preset) => preset.id !== id);
}

function snapshotForPreset(snapshot: NewTaskDraftSnapshot): NewTaskDraftSnapshot {
  return {
    ...snapshot,
    values: {
      ...snapshot.values,
      // Imported manual-cover IDs are one-use IPC staging tokens and cannot survive preset reuse.
      manualCoverAsset: undefined,
    },
  };
}

function normalizePresetName(value: string): string {
  const name = value.trim().replace(/\s+/gu, ' ').slice(0, 60);
  if (!name) throw new Error('NEW_TASK_PRESET_NAME_INVALID: Preset name is required.');
  return name;
}

function isNewTaskStage(value: unknown): value is NewTaskStage {
  return value === 'material' || value === 'creative' || value === 'output';
}
