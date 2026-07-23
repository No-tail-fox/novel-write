import type {
  AiSourceContext,
  NarrativePov,
  OrdinaryTaskCoverSelection,
  PausePoint,
  PodcastSpeakerPair,
  ProcessingMode,
  RewriteIntensity,
  TaskMode,
  TaskVideoForm,
} from '../../shared/types';
import type { RuntimeTtsProvider } from '../../shared/tts-voices';
import type { OrdinaryCoverMode } from './task-control-manifest';

export const NEW_TASK_DRAFT_STORAGE_KEY = 'storydream.new-task-draft.v1';

export type NewTaskStage = 'material' | 'creative' | 'output';

export interface NewTaskDraftValues {
  title?: string;
  inputText?: string;
  mode?: TaskMode;
  aiKeyword?: string;
  aiSources?: string[];
  extraRequirements?: string;
  track?: string;
  style?: string;
  templateId?: string;
  ratio?: string;
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
  manualCoverAsset?: OrdinaryTaskCoverSelection;
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

function isNewTaskStage(value: unknown): value is NewTaskStage {
  return value === 'material' || value === 'creative' || value === 'output';
}
