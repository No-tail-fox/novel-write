import type {
  AppDeltaReconcileResult,
  AppMutationResult,
  AppState,
  CursorPage,
  DraftTemplate,
  HistoryFamily,
  ImageLabRecord,
  ImageLabSummary,
  PromptTemplate,
  SequencedTaskEvent,
  ShellView,
  Task,
  TaskEvent,
  TaskSummary,
  ViralAnalysisEvent,
  ViralAnalysisRecord,
  ViralAnalysisSummary,
  VoiceLabRecord,
  VoiceLabSummary,
} from './types';
import { MAX_RENDERER_EVENT_HISTORY, type DeltaViewState } from './state-delta';

export interface ReconciliationSlices {
  tasks: Task[];
  events: TaskEvent[];
  viralAnalyses: ViralAnalysisRecord[];
  viralEvents: ViralAnalysisEvent[];
}

export interface BootstrapTemplateSlices {
  promptTemplates: PromptTemplate[];
  draftTemplates: DraftTemplate[];
}

export interface AuthoritativeSnapshotDetailSlices extends BootstrapTemplateSlices {
  tasks: Task[];
}

export interface RequestGenerationGuard {
  begin: (id: string) => number;
  finish: (id: string, token: number) => void;
  invalidate: (id: string) => void;
  isCurrent: (id: string, generation: number) => boolean;
}

export interface RequestGenerationCompletionQueue {
  defer: (id: string, generation: number) => number;
  flushThrough: (completionToken: number) => void;
}

export interface CompletionTrackedState<T> {
  value: T;
  completionToken: number;
}

export interface CompletionTrackedStateUpdate<T> {
  update: T | ((current: T) => T);
  completionToken?: number;
}

export interface HistoryResponseRevision {
  entityRevision: number;
  tombstoneRevision: number;
}

export function historyResponseDisposition(
  captured: HistoryResponseRevision,
  current: HistoryResponseRevision,
): 'accept' | 'retry' | 'discard' {
  if (captured.tombstoneRevision >= 0 || current.tombstoneRevision >= 0) return 'discard';
  return current.entityRevision === captured.entityRevision ? 'accept' : 'retry';
}

export function reduceCompletionTrackedState<T>(
  current: CompletionTrackedState<T>,
  action: CompletionTrackedStateUpdate<T>,
): CompletionTrackedState<T> {
  const value = typeof action.update === 'function'
    ? (action.update as (current: T) => T)(current.value)
    : action.update;
  const completionToken = Math.max(current.completionToken, action.completionToken ?? 0);
  return value === current.value && completionToken === current.completionToken
    ? current
    : { value, completionToken };
}

export function createRequestGenerationGuard(): RequestGenerationGuard {
  const generations = new Map<string, number>();
  let nextToken = 0;
  return {
    begin(id) {
      nextToken += 1;
      generations.set(id, nextToken);
      return nextToken;
    },
    finish(id, token) {
      if (generations.get(id) === token) generations.delete(id);
    },
    invalidate: (id) => { generations.delete(id); },
    isCurrent: (id, generation) => generations.get(id) === generation,
  };
}

export function createRequestGenerationCompletionQueue(
  guard: RequestGenerationGuard,
): RequestGenerationCompletionQueue {
  const pending: Array<{ id: string; generation: number; completionToken: number }> = [];
  let nextCompletionToken = 0;
  return {
    defer(id, generation) {
      nextCompletionToken += 1;
      pending.push({ id, generation, completionToken: nextCompletionToken });
      return nextCompletionToken;
    },
    flushThrough(completionToken) {
      const firstUncommittedIndex = pending.findIndex(
        (completion) => completion.completionToken > completionToken,
      );
      const committedCount = firstUncommittedIndex === -1 ? pending.length : firstUncommittedIndex;
      for (const completion of pending.splice(0, committedCount)) {
        guard.finish(completion.id, completion.generation);
      }
    },
  };
}

export interface HistorySelectionBarrierState {
  selectedTaskId: string | null;
  activeHtmlTaskId: string | null;
  activeViralAnalysisId: string | null;
  activeView: ShellView;
}

export function applyHistorySelectionBarrier(
  current: HistorySelectionBarrierState,
  family: HistoryFamily,
  id: string,
): HistorySelectionBarrierState {
  if (family === 'task') {
    const selectedDeleted = current.selectedTaskId === id;
    const activeHtmlDeleted = current.activeHtmlTaskId === id;
    if (!selectedDeleted && !activeHtmlDeleted) return current;
    return {
      ...current,
      selectedTaskId: selectedDeleted ? null : current.selectedTaskId,
      activeHtmlTaskId: activeHtmlDeleted ? null : current.activeHtmlTaskId,
      activeView: selectedDeleted && current.activeView === 'task-detail' ? 'history' : current.activeView,
    };
  }
  if (family === 'viral-analysis') {
    return {
      ...current,
      activeViralAnalysisId: current.activeViralAnalysisId === id ? null : current.activeViralAnalysisId,
    };
  }
  return current;
}

export function authoritativeMissingRequestedTaskId(
  requestedTaskId: string | null | undefined,
  resultTask: { id: string } | null,
  authoritativeTasks: readonly { id: string }[],
): string | null {
  if (!requestedTaskId || resultTask !== null) return null;
  return authoritativeTasks.some((task) => task.id === requestedTaskId) ? null : requestedTaskId;
}

type MutationState = AppState & { secretStatus?: Partial<Record<string, boolean>> };

export const mutationRevisionSlices = [
  'tasks',
  'viralAnalyses',
  'config',
  'promptTemplates',
  'customStyles',
  'draftTemplates',
  'imageLabRecords',
  'voiceLabRecords',
  'account',
  'activation',
  'ui',
] as const;

export function raiseMutationRevisionFloor(revisions: Map<string, number>, revision: number): void {
  for (const slice of mutationRevisionSlices) {
    if ((revisions.get(slice) ?? -1) < revision) revisions.set(slice, revision);
    if ((revisions.get(`floor:${slice}`) ?? -1) < revision) revisions.set(`floor:${slice}`, revision);
  }
}

function mutationSlices(result: AppMutationResult): string[] {
  if (result.kind === 'task-upsert' || result.kind === 'task-tombstone') return ['tasks'];
  if (result.kind === 'viral-upsert' || result.kind === 'viral-tombstone') return ['viralAnalyses'];
  if (result.kind === 'image-lab-tombstone') return ['imageLabRecords'];
  if (result.kind === 'voice-lab-tombstone') return ['voiceLabRecords'];
  const kind = result.patch.kind;
  if (kind === 'theme-preference') return ['config', 'ui'];
  if (kind === 'prompt-template-upsert' || kind === 'prompt-templates-reset') return ['promptTemplates'];
  if (kind === 'custom-style-upsert') return ['customStyles'];
  if (kind === 'viral-templates-upsert') return ['promptTemplates', 'customStyles'];
  if (kind === 'draft-template-upsert') return ['draftTemplates'];
  if (kind === 'image-lab-upsert') return ['imageLabRecords'];
  if (kind === 'voice-lab-upsert') return ['voiceLabRecords'];
  return [kind];
}

export function historyEntityRevisionKey(family: HistoryFamily, id: string): string {
  return `history:${family}:${id}`;
}

function historyTombstoneRevisionKey(family: HistoryFamily, id: string): string {
  return `history-tombstone:${family}:${id}`;
}

function isHistoryTombstone(result: AppMutationResult): boolean {
  return result.kind === 'task-tombstone'
    || result.kind === 'viral-tombstone'
    || result.kind === 'image-lab-tombstone'
    || result.kind === 'voice-lab-tombstone';
}

function mutationEntity(result: AppMutationResult): { family: HistoryFamily; id: string } | null {
  if (result.kind === 'task-upsert') return { family: 'task', id: result.task.id };
  if (result.kind === 'task-tombstone') return { family: 'task', id: result.id };
  if (result.kind === 'viral-upsert') return { family: 'viral-analysis', id: result.record.id };
  if (result.kind === 'viral-tombstone') return { family: 'viral-analysis', id: result.id };
  if (result.kind === 'image-lab-tombstone') return { family: 'image-lab', id: result.id };
  if (result.kind === 'voice-lab-tombstone') return { family: 'voice-lab', id: result.id };
  if (result.kind !== 'state-patch') return null;
  if (result.patch.kind === 'image-lab-upsert') return { family: 'image-lab', id: result.patch.record.id };
  if (result.patch.kind === 'voice-lab-upsert') return { family: 'voice-lab', id: result.patch.record.id };
  return null;
}

function mutationRevisionFloor(result: AppMutationResult, revisions: Map<string, number>): number {
  const slices = mutationSlices(result);
  const entity = mutationEntity(result);
  if (!entity) return Math.max(...slices.map((slice) => revisions.get(slice) ?? -1));
  return Math.max(
    ...slices.map((slice) => revisions.get(`floor:${slice}`) ?? -1),
    revisions.get(historyEntityRevisionKey(entity.family, entity.id)) ?? -1,
    revisions.get(historyTombstoneRevisionKey(entity.family, entity.id)) ?? -1,
  );
}

function blockedByHistoryTombstone(result: AppMutationResult, revisions: Map<string, number>): boolean {
  const entity = mutationEntity(result);
  return Boolean(
    entity
    && !isHistoryTombstone(result)
    && revisions.has(historyTombstoneRevisionKey(entity.family, entity.id)),
  );
}

function recordMutationRevision(result: AppMutationResult, revisions: Map<string, number>): void {
  for (const slice of mutationSlices(result)) {
    revisions.set(slice, Math.max(revisions.get(slice) ?? -1, result.revision));
  }
  const entity = mutationEntity(result);
  if (!entity) return;
  revisions.set(historyEntityRevisionKey(entity.family, entity.id), result.revision);
  if (isHistoryTombstone(result)) {
    revisions.set(historyTombstoneRevisionKey(entity.family, entity.id), result.revision);
  }
}

export function claimMutationResult(
  result: AppMutationResult,
  revisions: Map<string, number>,
): Map<string, number> | null {
  if (blockedByHistoryTombstone(result, revisions)) return null;
  if (result.revision <= mutationRevisionFloor(result, revisions)) return null;
  const preFloor = new Map(revisions);
  recordMutationRevision(result, revisions);
  return preFloor;
}

function upsertEntity<T extends { id: string }>(items: T[], entity: T): T[] {
  const index = items.findIndex((item) => item.id === entity.id);
  if (index < 0) return [entity, ...items];
  return items.map((item, itemIndex) => itemIndex === index ? entity : item);
}

export function applyAppMutationResult<T extends MutationState>(
  state: T,
  result: AppMutationResult,
  revisions: Map<string, number>,
): T {
  if (blockedByHistoryTombstone(result, revisions)) return state;
  if (result.revision <= mutationRevisionFloor(result, revisions)) return state;
  recordMutationRevision(result, revisions);
  if (result.kind === 'task-tombstone') {
    return {
      ...state,
      tasks: state.tasks.filter((task) => task.id !== result.id),
      events: state.events.filter((event) => event.taskId !== result.id),
    };
  }
  if (result.kind === 'viral-tombstone') {
    return {
      ...state,
      viralAnalyses: state.viralAnalyses.filter((record) => record.id !== result.id),
      viralEvents: state.viralEvents.filter((event) => event.analysisId !== result.id),
    };
  }
  if (result.kind === 'image-lab-tombstone') {
    return { ...state, imageLabRecords: state.imageLabRecords.filter((record) => record.id !== result.id) };
  }
  if (result.kind === 'voice-lab-tombstone') {
    return { ...state, voiceLabRecords: state.voiceLabRecords.filter((record) => record.id !== result.id) };
  }
  if (result.kind === 'task-upsert') {
    const detail = state.tasks.find((task) => task.id === result.task.id);
    return { ...state, tasks: upsertEntity(state.tasks, taskSummaryToTask(result.task, detail)) };
  }
  if (result.kind === 'viral-upsert') {
    const detail = state.viralAnalyses.find((record) => record.id === result.record.id);
    return { ...state, viralAnalyses: upsertEntity(state.viralAnalyses, viralSummaryToRecord(result.record, detail)) };
  }
  const patch = result.patch;
  if (patch.kind === 'config') return { ...state, config: patch.config, secretStatus: patch.secretStatus };
  if (patch.kind === 'theme-preference') return { ...state, config: patch.config, ui: patch.ui };
  if (patch.kind === 'prompt-template-upsert') {
    return { ...state, promptTemplates: upsertEntity(state.promptTemplates, patch.template) };
  }
  if (patch.kind === 'prompt-templates-reset') {
    const current = new Map(state.promptTemplates.map((template) => [template.id, template]));
    const custom = state.promptTemplates.filter((template) => !template.isBuiltin);
    const builtins = patch.templates.map((summary) => {
      const detail = current.get(summary.id);
      return detail?.updatedAt === summary.updatedAt
        ? { ...detail, ...summary }
        : { ...summary, content: '' } as PromptTemplate;
    });
    return { ...state, promptTemplates: [...builtins, ...custom] };
  }
  if (patch.kind === 'custom-style-upsert') return { ...state, customStyles: upsertEntity(state.customStyles, patch.style) };
  if (patch.kind === 'viral-templates-upsert') {
    return {
      ...state,
      promptTemplates: upsertEntity(state.promptTemplates, patch.storyTemplate),
      customStyles: upsertEntity(state.customStyles, patch.imageTemplate),
    };
  }
  if (patch.kind === 'draft-template-upsert') return { ...state, draftTemplates: upsertEntity(state.draftTemplates, patch.template) };
  if (patch.kind === 'image-lab-upsert') {
    const detail = state.imageLabRecords.find((record) => record.id === patch.record.id);
    return { ...state, imageLabRecords: upsertEntity(state.imageLabRecords, imageLabSummaryToRecord(patch.record, detail)) };
  }
  if (patch.kind === 'voice-lab-upsert') {
    const detail = state.voiceLabRecords.find((record) => record.id === patch.record.id);
    return { ...state, voiceLabRecords: upsertEntity(state.voiceLabRecords, voiceLabSummaryToRecord(patch.record, detail)) };
  }
  if (patch.kind === 'account') return { ...state, account: patch.account };
  if (patch.kind === 'activation') return { ...state, activation: patch.activation };
  return { ...state, ui: patch.ui };
}

export function applyLocalMutationResponse<T extends MutationState>(
  state: T,
  result: AppMutationResult,
  revisions: Map<string, number>,
  browserFallback: boolean,
): T {
  return browserFallback ? applyAppMutationResult(state, result, revisions) : state;
}

export function applyBufferedMutationResults<T extends MutationState>(
  state: T,
  results: Iterable<AppMutationResult>,
  snapshotRevision: number,
  revisions: Map<string, number>,
): T {
  raiseMutationRevisionFloor(revisions, snapshotRevision);
  let next = state;
  const ordered = [...results]
    .filter((result) => result.kind === 'state-patch' && result.revision > snapshotRevision)
    .sort((left, right) => left.revision - right.revision);
  for (const result of ordered) next = applyAppMutationResult(next, result, revisions);
  return next;
}

export async function collectCursorPages<T extends { id: string }>(
  first: CursorPage<T>,
  load: (cursor: string) => Promise<CursorPage<T>>,
): Promise<T[]> {
  const byId = new Map(first.items.map((item) => [item.id, item]));
  const seenCursors = new Set<string>();
  let cursor = first.nextCursor;
  while (cursor) {
    if (seenCursors.has(cursor)) throw new Error('CURSOR_LOOP: List pagination returned a repeated cursor.');
    seenCursors.add(cursor);
    const page = await load(cursor);
    page.items.forEach((item) => byId.set(item.id, item));
    cursor = page.nextCursor;
  }
  return [...byId.values()];
}

export async function collectViralEventPages(
  first: CursorPage<ViralAnalysisEvent>,
  load: (cursor: string) => Promise<CursorPage<ViralAnalysisEvent>>,
): Promise<ViralAnalysisEvent[]> {
  const byKey = new Map<string | number, ViralAnalysisEvent>();
  const merge = (items: ViralAnalysisEvent[]) => {
    items.forEach((event) => byKey.set(event.seq ?? event.id ?? `${event.analysisId}:${event.ts}:${event.type}`, event));
  };
  merge(first.items);
  const seenCursors = new Set<string>();
  let cursor = first.nextCursor;
  while (cursor) {
    if (seenCursors.has(cursor)) throw new Error('CURSOR_LOOP: Viral event pagination returned a repeated cursor.');
    seenCursors.add(cursor);
    const page = await load(cursor);
    merge(page.items);
    cursor = page.nextCursor;
  }
  return [...byKey.values()].sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0));
}

export async function collectTaskEventPages(
  first: CursorPage<SequencedTaskEvent>,
  load: (cursor: string) => Promise<CursorPage<SequencedTaskEvent>>,
): Promise<SequencedTaskEvent[]> {
  const bySequence = new Map<number, SequencedTaskEvent>();
  const merge = (items: SequencedTaskEvent[]) => items.forEach((event) => bySequence.set(event.seq, event));
  merge(first.items);
  const seenCursors = new Set<string>();
  let cursor = first.nextCursor;
  while (cursor) {
    if (seenCursors.has(cursor)) throw new Error('CURSOR_LOOP: Task event pagination returned a repeated cursor.');
    seenCursors.add(cursor);
    const page = await load(cursor);
    merge(page.items);
    cursor = page.nextCursor;
  }
  return [...bySequence.values()].sort((left, right) => left.seq - right.seq);
}

export function viralSummaryToRecord(summary: ViralAnalysisSummary, detail?: ViralAnalysisRecord | null): ViralAnalysisRecord {
  return {
    settings: { track: 'general-story', style: 'photo-real', ratio: '9:16', templateId: 'default-portrait-9-16' },
    resultPath: '',
    videoPath: '',
    ...(detail ?? {}),
    ...summary,
  };
}

export function imageLabSummaryToRecord(summary: ImageLabSummary, detail?: ImageLabRecord | null): ImageLabRecord {
  return {
    prompt: summary.promptPreview,
    referenceImagePaths: [],
    referenceImagePath: '',
    ...(detail ?? {}),
    ...summary,
  };
}

export function voiceLabSummaryToRecord(summary: VoiceLabSummary, detail?: VoiceLabRecord | null): VoiceLabRecord {
  return { text: summary.textPreview, ...(detail ?? {}), ...summary };
}

export function taskToSummary(task: Task): TaskSummary {
  const {
    inputText,
    pausePoints: _pausePoints,
    aiSources: _aiSources,
    selectedSources: _selectedSources,
    extraRequirements: _extraRequirements,
    imagePromptReference: _imagePromptReference,
    step3PromptSnapshot: _step3PromptSnapshot,
    musicMv: _musicMv,
    pipelineData: _pipelineData,
    productInfo: _productInfo,
    materialPerson: _materialPerson,
    fixedIntro: _fixedIntro,
    outroCta: _outroCta,
    podcastSpeakers: _podcastSpeakers,
    ...summary
  } = task;
  const normalized = inputText.replace(/\s+/gu, ' ').trim();
  return { ...summary, inputPreview: normalized.length > 160 ? `${normalized.slice(0, 160)}...` : normalized };
}

export function taskSummaryToTask(summary: TaskSummary, detail?: Task | null): Task {
  return {
    ...(detail ?? {
      inputText: summary.inputPreview,
      pausePoints: [],
      aiSources: [],
      selectedSources: [],
      extraRequirements: '',
      imagePromptReference: '',
      step3PromptSnapshot: '',
      musicMv: { rhythmMode: 'lyric-sync', captionStyle: 'karaoke', visualMotif: '', audioPath: '' },
      pipelineData: '{}',
    }),
    ...summary,
  } as Task;
}

function mergeTaskEvents(current: TaskEvent[], incoming: SequencedTaskEvent[]): TaskEvent[] {
  const byKey = new Map<string | number, TaskEvent>();
  current.forEach((event) => byKey.set(event.seq ?? event.id ?? `${event.taskId}:${event.ts}:${event.type}`, event));
  incoming.forEach((event) => byKey.set(event.seq, event));
  return [...byKey.values()]
    .sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0))
    .slice(-MAX_RENDERER_EVENT_HISTORY);
}

function mergeViralEvents(current: ViralAnalysisEvent[], incoming: ViralAnalysisEvent[]): ViralAnalysisEvent[] {
  const byKey = new Map<string | number, ViralAnalysisEvent>();
  current.forEach((event) => byKey.set(event.seq ?? event.id ?? `${event.analysisId}:${event.ts}:${event.type}`, event));
  incoming.forEach((event) => byKey.set(event.seq ?? event.id ?? `${event.analysisId}:${event.ts}:${event.type}`, event));
  return [...byKey.values()]
    .sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0))
    .slice(-MAX_RENDERER_EVENT_HISTORY);
}

export function shouldApplyDeltaViewTransition(
  previous: DeltaViewState | null,
  next: DeltaViewState | null,
): boolean {
  return next !== null && next !== previous;
}

export function mergeDeltaViewSlices<
  T extends {
    tasks: Task[];
    events: TaskEvent[];
    viralAnalyses: ViralAnalysisRecord[];
    viralEvents: ViralAnalysisEvent[];
    imageLabRecords: ImageLabRecord[];
    voiceLabRecords: VoiceLabRecord[];
  },
>(current: T, incoming: DeltaViewState): T {
  const taskDetails = new Map(current.tasks.map((task) => [task.id, task]));
  const viralDetails = new Map(current.viralAnalyses.map((record) => [record.id, record]));
  const imageDetails = new Map(current.imageLabRecords.map((record) => [record.id, record]));
  const voiceDetails = new Map(current.voiceLabRecords.map((record) => [record.id, record]));
  const deletedTasks = new Set(Object.keys(incoming.tombstoneRevisions?.task ?? {}));
  const deletedViral = new Set(Object.keys(incoming.tombstoneRevisions?.['viral-analysis'] ?? {}));
  const taskRunGenerations = new Map(incoming.tasks.map((task) => [task.id, task.runGeneration]));
  return {
    ...current,
    tasks: incoming.tasks.map((summary) => taskSummaryToTask(summary, taskDetails.get(summary.id))),
    events: mergeTaskEvents(current.events, incoming.events).filter((event) => {
      if (deletedTasks.has(event.taskId)) return false;
      const runGeneration = taskRunGenerations.get(event.taskId);
      return runGeneration === undefined
        || event.runGeneration === undefined
        || event.runGeneration === runGeneration;
    }),
    viralAnalyses: incoming.viralAnalyses.map((summary) => viralSummaryToRecord(summary, viralDetails.get(summary.id))),
    viralEvents: current.viralEvents.filter((event) => !deletedViral.has(event.analysisId)),
    imageLabRecords: incoming.imageLabRecords.map((summary) => imageLabSummaryToRecord(summary, imageDetails.get(summary.id))),
    voiceLabRecords: incoming.voiceLabRecords.map((summary) => voiceLabSummaryToRecord(summary, voiceDetails.get(summary.id))),
  };
}

export function mergeReconciliationSlices<T extends ReconciliationSlices>(
  current: T,
  result: Pick<AppDeltaReconcileResult, 'task' | 'taskEvents' | 'viralAnalysis' | 'viralEvents'>,
): Omit<T, keyof ReconciliationSlices> & ReconciliationSlices {
  let tasks = current.tasks;
  if (result.task) {
    const existing = current.tasks.find((task) => task.id === result.task!.id);
    const merged = existing ? taskSummaryToTask(taskToSummary(existing), result.task) : result.task;
    tasks = existing
      ? current.tasks.map((task) => task.id === merged.id ? merged : task)
      : [merged, ...current.tasks];
  }

  let viralAnalyses = current.viralAnalyses;
  if (result.viralAnalysis) {
    const existing = current.viralAnalyses.find((record) => record.id === result.viralAnalysis!.id);
    const merged = existing
      ? {
          ...result.viralAnalysis,
          ...existing,
          settings: result.viralAnalysis.settings,
          resultPath: result.viralAnalysis.resultPath,
          videoPath: result.viralAnalysis.videoPath,
        }
      : result.viralAnalysis;
    viralAnalyses = existing
      ? current.viralAnalyses.map((record) => record.id === merged.id ? merged : record)
      : [merged, ...current.viralAnalyses];
  }

  return {
    ...current,
    tasks,
    events: mergeTaskEvents(
      result.task?.runGeneration === undefined
        ? current.events
        : current.events.filter((event) => event.taskId !== result.task!.id
          || event.runGeneration === undefined
          || event.runGeneration === result.task!.runGeneration),
      result.task?.runGeneration === undefined
        ? result.taskEvents
        : result.taskEvents.filter((event) => event.runGeneration === undefined
          || event.runGeneration === result.task!.runGeneration),
    ),
    viralAnalyses,
    viralEvents: mergeViralEvents(
      result.viralAnalysis?.runGeneration === undefined
        ? current.viralEvents
        : current.viralEvents.filter((event) => event.analysisId !== result.viralAnalysis!.id
          || event.runGeneration === undefined
          || event.runGeneration === result.viralAnalysis!.runGeneration),
      result.viralAnalysis?.runGeneration === undefined
        ? result.viralEvents
        : result.viralEvents.filter((event) => event.runGeneration === undefined
          || event.runGeneration === result.viralAnalysis!.runGeneration),
    ),
  };
}

export function mergeBootstrapTemplateDetails<T extends BootstrapTemplateSlices>(current: BootstrapTemplateSlices, rebuilt: T): T {
  const currentPrompts = new Map(current.promptTemplates.map((template) => [template.id, template]));
  const currentDrafts = new Map(current.draftTemplates.map((template) => [template.id, template]));
  return {
    ...rebuilt,
    promptTemplates: rebuilt.promptTemplates.map((template) => {
      const detail = currentPrompts.get(template.id);
      if (!detail || detail.updatedAt !== template.updatedAt) return template;
      return {
        ...detail,
        ...template,
        content: detail.content,
        stepPrompts: detail.stepPrompts,
        imageSeedPoolsJson: detail.imageSeedPoolsJson,
      };
    }),
    draftTemplates: rebuilt.draftTemplates.map((template) => {
      const detail = currentDrafts.get(template.id);
      if (!detail || detail.updatedAt !== template.updatedAt) return template;
      return {
        ...detail,
        id: template.id,
        name: template.name,
        isDefault: template.isDefault,
        canvas: {
          ...detail.canvas,
          width: template.canvas.width,
          height: template.canvas.height,
          ratio: template.canvas.ratio,
        },
      };
    }),
  };
}

export function mergeAuthoritativeSnapshotDetails<T extends AuthoritativeSnapshotDetailSlices>(
  current: AuthoritativeSnapshotDetailSlices,
  rebuilt: T,
  preserveTemplateDetails = true,
  authoritativeTaskDetailIds?: ReadonlySet<string>,
): T {
  const authoritative = preserveTemplateDetails
    ? mergeBootstrapTemplateDetails(current, rebuilt)
    : rebuilt;
  const currentTasks = new Map(current.tasks.map((task) => [task.id, task]));
  return {
    ...authoritative,
    tasks: authoritative.tasks.map((task) => {
      const detail = authoritativeTaskDetailIds?.has(task.id)
        ? task
        : currentTasks.get(task.id);
      return taskSummaryToTask(taskToSummary(task), detail);
    }),
  };
}

export function taskDetailRefreshKey(task: Task | null | undefined): string {
  if (!task) return '';
  return [task.id, task.status, task.currentStep, task.pipelineStep ?? '', task.lastHeartbeatAt ?? '', task.completedAt ?? ''].join(':');
}

export function viralEventRefreshKey(record: ViralAnalysisSummary | null | undefined): string {
  if (!record) return '';
  return [record.id, record.status, record.currentStage, record.progress, record.lastHeartbeatAt ?? '', record.completedAt ?? ''].join(':');
}
