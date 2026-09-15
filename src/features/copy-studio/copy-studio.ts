import type { AiSourceSection } from '../../shared/types';
import { NEW_TASK_DRAFT_STORAGE_KEY, type NewTaskDraftSnapshot } from '../tasks/new-task-draft';

export const COPY_STUDIO_STORAGE_KEY = 'storydream.copy-studio.v1';

export type CopyRevisionKind = 'draft' | 'refine' | 'track';

export interface CopyRevision {
  id: string;
  kind: CopyRevisionKind;
  label: string;
  instruction: string;
  text: string;
  createdAt: string;
}

export interface CopyStudioDocument {
  version: 1;
  topic: string;
  requirements: string;
  track: string;
  sourceIds: string[];
  sources: AiSourceSection[];
  revisions: CopyRevision[];
  activeRevisionId: string;
  updatedAt: string;
}

export function copySourceKey(source: AiSourceSection): string {
  return `${source.provider || source.source}::${source.url || ''}::${source.title}`;
}

export function readCopyStudioDocument(storage: Pick<Storage, 'getItem'>): CopyStudioDocument | null {
  try {
    const value = JSON.parse(storage.getItem(COPY_STUDIO_STORAGE_KEY) || 'null') as Partial<CopyStudioDocument> | null;
    if (!value || value.version !== 1 || !Array.isArray(value.revisions) || typeof value.topic !== 'string') return null;
    return {
      version: 1,
      topic: value.topic,
      requirements: typeof value.requirements === 'string' ? value.requirements : '',
      track: typeof value.track === 'string' ? value.track : '人物故事',
      sourceIds: Array.isArray(value.sourceIds) ? value.sourceIds.filter((item): item is string => typeof item === 'string') : [],
      sources: Array.isArray(value.sources) ? value.sources : [],
      revisions: value.revisions.filter((item): item is CopyRevision => Boolean(item && typeof item.id === 'string' && typeof item.text === 'string')),
      activeRevisionId: typeof value.activeRevisionId === 'string' ? value.activeRevisionId : '',
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeCopyStudioDocument(storage: Pick<Storage, 'setItem'>, document: CopyStudioDocument): void {
  storage.setItem(COPY_STUDIO_STORAGE_KEY, JSON.stringify(document));
}

export function createCopyRevision(input: Omit<CopyRevision, 'id' | 'createdAt'>, now = new Date()): CopyRevision {
  return { ...input, id: `copy-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, createdAt: now.toISOString() };
}

export function handoffCopyToVideo(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  input: { title: string; copy: string; topic: string; requirements: string; track: string; sources: AiSourceSection[]; skipReview: boolean },
  now = new Date(),
): NewTaskDraftSnapshot {
  const existing = (() => {
    try { return JSON.parse(storage.getItem(NEW_TASK_DRAFT_STORAGE_KEY) || 'null') as NewTaskDraftSnapshot | null; }
    catch { return null; }
  })();
  const snapshot: NewTaskDraftSnapshot = {
    version: 1,
    savedAt: now.toISOString(),
    activeStage: 'creative',
    values: {
      ...(existing?.version === 1 ? existing.values : {}),
      title: input.title.trim() || input.topic.trim().slice(0, 42) || '未命名文案',
      inputText: input.copy.trim(),
      mode: 'paste',
      aiKeyword: input.topic.trim(),
      extraRequirements: input.requirements.trim(),
      track: input.track.trim() || 'character-story',
      selectedSources: input.sources,
      selectedSearchSourceIds: input.sources.map(copySourceKey),
      researchCopy: input.copy.trim(),
      publishMode: input.skipReview ? 'direct-copy' : 'review-rewrite',
    },
  };
  storage.setItem(NEW_TASK_DRAFT_STORAGE_KEY, JSON.stringify(snapshot));
  return snapshot;
}
