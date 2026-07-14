import type { AppDelta, SequencedTaskEvent, TaskSummary, ViralAnalysisSummary } from './types';

export interface DeltaViewState {
  revision: number;
  tasks: TaskSummary[];
  events: SequencedTaskEvent[];
  viralAnalyses: ViralAnalysisSummary[];
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

function upsertById<T extends { id: string }>(items: T[], incoming: T): T[] {
  const index = items.findIndex((item) => item.id === incoming.id);
  if (index < 0) return [incoming, ...items];
  const next = [...items];
  next[index] = { ...items[index], ...incoming };
  return next;
}

export function reduceAppDelta(state: DeltaViewState, delta: AppDelta): DeltaViewState {
  if (delta.revision <= state.revision) return state;
  if (delta.kind === 'task-upsert') {
    return { ...state, revision: delta.revision, tasks: upsertById(state.tasks, delta.task) };
  }
  if (delta.kind === 'viral-upsert') {
    return { ...state, revision: delta.revision, viralAnalyses: upsertById(state.viralAnalyses, delta.record) };
  }
  if (delta.kind === 'state-patch') return { ...state, revision: delta.revision };
  const bySeq = new Map<number, SequencedTaskEvent>(state.events.map((event) => [event.seq, event]));
  bySeq.set(delta.event.seq, delta.event);
  const events = [...bySeq.values()]
    .sort((left, right) => left.seq - right.seq)
    .slice(-MAX_RENDERER_EVENT_HISTORY);
  return {
    ...state,
    revision: delta.revision,
    events,
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

  const mergeStaleEvent = (current: DeltaViewState, delta: AppDelta): DeltaViewState => {
    if (delta.kind !== 'task-event') return current;
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
    if (delta.revision <= state.revision) return state;
    if (delta.revision > state.revision + 1) {
      if (buffer(outOfOrder, delta)) reportNextGap();
      return state;
    }
    return applyContiguous(delta);
  };

  return {
    bootstrap(next) {
      state = next;
      bufferOverflowed = false;
      for (const revision of outOfOrder.keys()) {
        if (revision <= state.revision) outOfOrder.delete(revision);
      }
      drainBuffered();
      const queued = [...pending.values()].sort((left, right) => left.revision - right.revision);
      pending.clear();
      for (const delta of queued) {
        if (delta.revision <= state.revision) state = mergeStaleEvent(state, delta);
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
      state = {
        ...next,
        events: [...bySeq.values()]
          .sort((left, right) => left.seq - right.seq)
          .slice(-MAX_RENDERER_EVENT_HISTORY),
      };
      for (const delta of live) {
        if (delta.revision <= state.revision) state = mergeStaleEvent(state, delta);
        else receive(delta);
      }
      return state;
    },
    receive,
    current: () => state,
  };
}
