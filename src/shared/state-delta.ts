import type {
  AppDelta,
  HistoryFamily,
  ImageLabSummary,
  SequencedTaskEvent,
  TaskSummary,
  ViralAnalysisSummary,
  VoiceLabSummary,
} from './types';

export type HistoryRevisionLedger = Partial<Record<HistoryFamily, Record<string, number>>>;

export interface DeltaViewState {
  revision: number;
  tasks: TaskSummary[];
  events: SequencedTaskEvent[];
  viralAnalyses: ViralAnalysisSummary[];
  imageLabRecords: ImageLabSummary[];
  voiceLabRecords: VoiceLabSummary[];
  entityRevisions?: HistoryRevisionLedger;
  tombstoneRevisions?: HistoryRevisionLedger;
}

export interface RevisionGap {
  expectedRevision: number;
  receivedRevision: number;
}

export interface AppDeltaCoordinator {
  bootstrap: (state: DeltaViewState) => DeltaViewState;
  beginReset: () => void;
  reset: (state: DeltaViewState) => DeltaViewState;
  receive: (delta: AppDelta) => DeltaViewState | null;
  current: () => DeltaViewState | null;
}

export const MAX_RENDERER_DELTA_BUFFER = 512;
export const MAX_RENDERER_EVENT_HISTORY = 512;

const historyFamilies: HistoryFamily[] = ['task', 'viral-analysis', 'image-lab', 'voice-lab'];

function upsertById<T extends { id: string }>(items: T[], incoming: T): T[] {
  const index = items.findIndex((item) => item.id === incoming.id);
  if (index < 0) return [incoming, ...items];
  const next = [...items];
  next[index] = { ...items[index], ...incoming };
  return next;
}

function cloneLedger(ledger: HistoryRevisionLedger | undefined): HistoryRevisionLedger {
  const cloned: HistoryRevisionLedger = {};
  for (const family of historyFamilies) {
    if (ledger?.[family]) cloned[family] = { ...ledger[family] };
  }
  return cloned;
}

function ledgerRevision(ledger: HistoryRevisionLedger, family: HistoryFamily, id: string): number {
  return ledger[family]?.[id] ?? -1;
}

function setLedgerRevision(
  ledger: HistoryRevisionLedger,
  family: HistoryFamily,
  id: string,
  revision: number,
): void {
  (ledger[family] ??= {})[id] = revision;
}

function deleteLedgerRevision(ledger: HistoryRevisionLedger, family: HistoryFamily, id: string): void {
  const familyLedger = ledger[family];
  if (!familyLedger) return;
  delete familyLedger[id];
  if (Object.keys(familyLedger).length === 0) delete ledger[family];
}

function historyUpsert(delta: AppDelta): { family: HistoryFamily; id: string } | null {
  if (delta.kind === 'task-upsert') return { family: 'task', id: delta.task.id };
  if (delta.kind === 'viral-upsert') return { family: 'viral-analysis', id: delta.record.id };
  if (delta.kind !== 'state-patch') return null;
  if (delta.patch.kind === 'image-lab-upsert') return { family: 'image-lab', id: delta.patch.record.id };
  if (delta.patch.kind === 'voice-lab-upsert') return { family: 'voice-lab', id: delta.patch.record.id };
  return null;
}

function historyTombstone(delta: AppDelta): { family: HistoryFamily; id: string } | null {
  if (delta.kind === 'task-tombstone') return { family: 'task', id: delta.id };
  if (delta.kind === 'viral-tombstone') return { family: 'viral-analysis', id: delta.id };
  if (delta.kind === 'image-lab-tombstone') return { family: 'image-lab', id: delta.id };
  if (delta.kind === 'voice-lab-tombstone') return { family: 'voice-lab', id: delta.id };
  return null;
}

function seedEntityRevisions(state: DeltaViewState): HistoryRevisionLedger {
  if (state.entityRevisions) return cloneLedger(state.entityRevisions);
  const ledger: HistoryRevisionLedger = {};
  for (const item of state.tasks) setLedgerRevision(ledger, 'task', item.id, state.revision);
  for (const item of state.viralAnalyses) setLedgerRevision(ledger, 'viral-analysis', item.id, state.revision);
  for (const item of state.imageLabRecords ?? []) setLedgerRevision(ledger, 'image-lab', item.id, state.revision);
  for (const item of state.voiceLabRecords ?? []) setLedgerRevision(ledger, 'voice-lab', item.id, state.revision);
  return ledger;
}

function removeHistoryEntity(state: DeltaViewState, family: HistoryFamily, id: string): DeltaViewState {
  if (family === 'task') {
    return {
      ...state,
      tasks: state.tasks.filter((task) => task.id !== id),
      events: state.events.filter((event) => event.taskId !== id),
    };
  }
  if (family === 'viral-analysis') {
    return { ...state, viralAnalyses: state.viralAnalyses.filter((record) => record.id !== id) };
  }
  if (family === 'image-lab') {
    return { ...state, imageLabRecords: (state.imageLabRecords ?? []).filter((record) => record.id !== id) };
  }
  return { ...state, voiceLabRecords: (state.voiceLabRecords ?? []).filter((record) => record.id !== id) };
}

function filterKnownTombstones(state: DeltaViewState): DeltaViewState {
  let filtered = state;
  for (const family of historyFamilies) {
    for (const id of Object.keys(state.tombstoneRevisions?.[family] ?? {})) {
      filtered = removeHistoryEntity(filtered, family, id);
    }
  }
  return filtered;
}

function filterTaskEventsByGeneration(
  tasks: TaskSummary[],
  events: SequencedTaskEvent[],
): SequencedTaskEvent[] {
  const generations = new Map(tasks.map((task) => [task.id, task.runGeneration]));
  return events.filter((event) => {
    const runGeneration = generations.get(event.taskId);
    return runGeneration === undefined
      || event.runGeneration === undefined
      || event.runGeneration === runGeneration;
  });
}

function advanceDeltaRevision(
  state: DeltaViewState,
  delta: AppDelta,
  entityRevisions: HistoryRevisionLedger,
  tombstoneRevisions: HistoryRevisionLedger,
): DeltaViewState {
  if (delta.revision <= state.revision) return state;
  return { ...state, revision: delta.revision, entityRevisions, tombstoneRevisions };
}

function prepareSnapshot(
  snapshot: DeltaViewState,
  previous: DeltaViewState | null,
  buffered: Iterable<AppDelta>,
): DeltaViewState {
  const tombstoneRevisions = cloneLedger(previous?.tombstoneRevisions);
  for (const delta of buffered) {
    const tombstone = historyTombstone(delta);
    if (!tombstone || delta.revision > snapshot.revision) continue;
    if (delta.revision >= ledgerRevision(tombstoneRevisions, tombstone.family, tombstone.id)) {
      setLedgerRevision(tombstoneRevisions, tombstone.family, tombstone.id, delta.revision);
    }
  }
  const prepared = filterKnownTombstones({
    ...snapshot,
    imageLabRecords: snapshot.imageLabRecords ?? [],
    voiceLabRecords: snapshot.voiceLabRecords ?? [],
    entityRevisions: undefined,
    tombstoneRevisions,
  });
  const generationFiltered = {
    ...prepared,
    events: filterTaskEventsByGeneration(prepared.tasks, prepared.events),
  };
  return { ...generationFiltered, entityRevisions: seedEntityRevisions(generationFiltered) };
}

export function reduceAppDelta(state: DeltaViewState, delta: AppDelta): DeltaViewState {
  const entityRevisions = seedEntityRevisions(state);
  const tombstoneRevisions = cloneLedger(state.tombstoneRevisions);
  const tombstone = historyTombstone(delta);
  if (tombstone) {
    const currentRevision = Math.max(
      ledgerRevision(entityRevisions, tombstone.family, tombstone.id),
      ledgerRevision(tombstoneRevisions, tombstone.family, tombstone.id),
    );
    if (delta.revision < currentRevision) return state;
    setLedgerRevision(tombstoneRevisions, tombstone.family, tombstone.id, delta.revision);
    deleteLedgerRevision(entityRevisions, tombstone.family, tombstone.id);
    return removeHistoryEntity({
      ...state,
      revision: Math.max(state.revision, delta.revision),
      entityRevisions,
      tombstoneRevisions,
    }, tombstone.family, tombstone.id);
  }

  const upsert = historyUpsert(delta);
  if (upsert) {
    const entityRevision = ledgerRevision(entityRevisions, upsert.family, upsert.id);
    const tombstoneRevision = ledgerRevision(tombstoneRevisions, upsert.family, upsert.id);
    if (tombstoneRevision >= 0 || delta.revision <= entityRevision) {
      return advanceDeltaRevision(state, delta, entityRevisions, tombstoneRevisions);
    }
    setLedgerRevision(entityRevisions, upsert.family, upsert.id, delta.revision);
    const next = {
      ...state,
      revision: Math.max(state.revision, delta.revision),
      entityRevisions,
      tombstoneRevisions,
    };
    if (delta.kind === 'task-upsert') return {
      ...next,
      tasks: upsertById(state.tasks, delta.task),
      events: delta.task.runGeneration === undefined
        ? state.events
        : state.events.filter((event) => event.taskId !== delta.task.id
          || event.runGeneration === undefined
          || event.runGeneration === delta.task.runGeneration),
    };
    if (delta.kind === 'viral-upsert') return { ...next, viralAnalyses: upsertById(state.viralAnalyses, delta.record) };
    if (delta.kind === 'state-patch' && delta.patch.kind === 'image-lab-upsert') {
      return { ...next, imageLabRecords: upsertById(state.imageLabRecords ?? [], delta.patch.record) };
    }
    if (delta.kind === 'state-patch' && delta.patch.kind === 'voice-lab-upsert') {
      return { ...next, voiceLabRecords: upsertById(state.voiceLabRecords ?? [], delta.patch.record) };
    }
  }

  if (delta.revision <= state.revision) return state;
  if (delta.kind === 'state-patch') {
    return { ...state, revision: delta.revision, entityRevisions, tombstoneRevisions };
  }
  if (delta.kind !== 'task-event') return state;
  if (ledgerRevision(tombstoneRevisions, 'task', delta.event.taskId) >= 0) {
    return advanceDeltaRevision(state, delta, entityRevisions, tombstoneRevisions);
  }
  const task = state.tasks.find((item) => item.id === delta.event.taskId);
  if (task?.runGeneration !== undefined
    && delta.event.runGeneration !== undefined
    && delta.event.runGeneration !== task.runGeneration) {
    return advanceDeltaRevision(state, delta, entityRevisions, tombstoneRevisions);
  }
  const bySeq = new Map<number, SequencedTaskEvent>(state.events.map((event) => [event.seq, event]));
  bySeq.set(delta.event.seq, delta.event);
  const events = [...bySeq.values()]
    .sort((left, right) => left.seq - right.seq)
    .slice(-MAX_RENDERER_EVENT_HISTORY);
  return {
    ...state,
    revision: delta.revision,
    events,
    entityRevisions,
    tombstoneRevisions,
  };
}

export function createAppDeltaCoordinator(
  onGap: (gap: RevisionGap) => void,
  onOverflow: () => void = () => undefined,
): AppDeltaCoordinator {
  let state: DeltaViewState | null = null;
  const pending = new Map<number, AppDelta>();
  const outOfOrder = new Map<number, AppDelta>();
  const resetLive = new Map<number, AppDelta>();
  let reportedGapRevision: number | null = null;
  let bufferOverflowed = false;
  let resetting = false;

  const overflow = (): void => {
    if (bufferOverflowed) return;
    bufferOverflowed = true;
    pending.clear();
    outOfOrder.clear();
    resetLive.clear();
    reportedGapRevision = null;
    onOverflow();
  };

  const buffer = (target: Map<number, AppDelta>, delta: AppDelta): boolean => {
    if (bufferOverflowed) return false;
    target.set(delta.revision, delta);
    if (target.size > MAX_RENDERER_DELTA_BUFFER) {
      overflow();
      return false;
    }
    return true;
  };

  const reportNextGap = (): void => {
    if (!state) return;
    if (reportedGapRevision !== null && outOfOrder.has(reportedGapRevision)) return;
    reportedGapRevision = null;
    let receivedRevision: number | null = null;
    for (const revision of outOfOrder.keys()) {
      if (receivedRevision === null || revision < receivedRevision) receivedRevision = revision;
    }
    if (receivedRevision === null || receivedRevision <= state.revision + 1) return;
    reportedGapRevision = receivedRevision;
    onGap({ expectedRevision: state.revision + 1, receivedRevision });
  };

  const drainBuffered = (): DeltaViewState => {
    while (outOfOrder.has(state!.revision + 1)) {
      const next = outOfOrder.get(state!.revision + 1)!;
      outOfOrder.delete(next.revision);
      state = reduceAppDelta(state!, next);
    }
    reportNextGap();
    return state!;
  };

  const applyContiguous = (delta: AppDelta): DeltaViewState => {
    state = reduceAppDelta(state!, delta);
    return drainBuffered();
  };

  const mergeStaleHistoryDelta = (current: DeltaViewState, delta: AppDelta): DeltaViewState => {
    return historyTombstone(delta) || historyUpsert(delta) ? reduceAppDelta(current, delta) : current;
  };

  const mergeStaleBootstrapDelta = (current: DeltaViewState, delta: AppDelta): DeltaViewState => {
    const historyMerged = mergeStaleHistoryDelta(current, delta);
    if (historyMerged !== current || delta.kind !== 'task-event') return historyMerged;
    if (ledgerRevision(current.tombstoneRevisions ?? {}, 'task', delta.event.taskId) >= 0) return current;
    const task = current.tasks.find((item) => item.id === delta.event.taskId);
    if (task?.runGeneration !== undefined
      && delta.event.runGeneration !== undefined
      && delta.event.runGeneration !== task.runGeneration) return current;
    const bySeq = new Map(current.events.map((event) => [event.seq, event]));
    bySeq.set(delta.event.seq, delta.event);
    return {
      ...current,
      events: [...bySeq.values()]
        .sort((left, right) => left.seq - right.seq)
        .slice(-MAX_RENDERER_EVENT_HISTORY),
    };
  };

  const receive = (delta: AppDelta): DeltaViewState | null => {
    if (resetting) {
      buffer(resetLive, delta);
      return state;
    }
    if (!state) {
      buffer(pending, delta);
      return null;
    }
    if (bufferOverflowed) return state;
    if (delta.revision <= state.revision) {
      state = mergeStaleHistoryDelta(state, delta);
      return state;
    }
    if (delta.revision > state.revision + 1) {
      if (buffer(outOfOrder, delta)) reportNextGap();
      return state;
    }
    return applyContiguous(delta);
  };

  return {
    bootstrap(next) {
      state = prepareSnapshot(next, state, [...pending.values(), ...outOfOrder.values()]);
      bufferOverflowed = false;
      for (const revision of outOfOrder.keys()) {
        if (revision <= state.revision) outOfOrder.delete(revision);
      }
      drainBuffered();
      const queued = [...pending.values()].sort((left, right) => left.revision - right.revision);
      pending.clear();
      for (const delta of queued) {
        if (delta.revision <= state.revision) state = mergeStaleBootstrapDelta(state, delta);
        else receive(delta);
      }
      return state;
    },
    beginReset() {
      if (resetting) return;
      resetting = true;
      resetLive.clear();
    },
    reset(next) {
      const preservedEvents = state?.events ?? [];
      const live = [...resetLive.values()].sort((left, right) => left.revision - right.revision);
      resetting = false;
      resetLive.clear();
      pending.clear();
      outOfOrder.clear();
      reportedGapRevision = null;
      bufferOverflowed = false;
      const bySeq = new Map<number, SequencedTaskEvent>();
      [...preservedEvents, ...next.events].forEach((event) => bySeq.set(event.seq, event));
      state = prepareSnapshot({
        ...next,
        events: [...bySeq.values()]
          .sort((left, right) => left.seq - right.seq)
          .slice(-MAX_RENDERER_EVENT_HISTORY),
      }, state, live);
      for (const delta of live) {
        if (delta.revision <= state.revision) state = mergeStaleBootstrapDelta(state, delta);
        else receive(delta);
      }
      return state;
    },
    receive,
    current: () => state,
  };
}
