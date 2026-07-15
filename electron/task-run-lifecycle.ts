import type { HistoryActivityReservation } from './history-activity-registry';

export type TaskRunIntent = 'paused' | 'cancelled' | 'restart';

export interface TaskRunIntentState {
  controller: AbortController;
  intent: TaskRunIntent | null;
}

export interface HistoryActivityReservationOwner {
  activityReservation: HistoryActivityReservation | null;
}

export function takeHistoryActivityReservation(
  owner: HistoryActivityReservationOwner,
): HistoryActivityReservation {
  if (!owner.activityReservation) {
    throw new Error('HISTORY_ACTIVITY_RESERVATION_TRANSFERRED: The active reservation is unavailable.');
  }
  const reservation = owner.activityReservation;
  owner.activityReservation = null;
  return reservation;
}

interface CompletableTaskRun extends TaskRunIntentState {
  completion: Promise<void>;
}

export interface LatestTaskControlRequestState {
  token: symbol;
  activityReservation: HistoryActivityReservation | null;
}

type ActivityReservationSource = HistoryActivityReservation | (() => HistoryActivityReservation);

function acquireHistoryActivityReservation(source: ActivityReservationSource): HistoryActivityReservation {
  return typeof source === 'function' ? source() : source;
}

export async function runLatestTaskControlRequest<T>(
  requests: Map<string, LatestTaskControlRequestState> | Map<string, symbol>,
  taskId: string,
  operation: (
    isCurrent: () => boolean,
    transferReservation: () => HistoryActivityReservation,
  ) => Promise<T>,
  activityReservationSource?: ActivityReservationSource,
): Promise<T> {
  const requestStates = requests as Map<string, LatestTaskControlRequestState | symbol>;
  const previousValue = requestStates.get(taskId);
  const previous = typeof previousValue === 'object' ? previousValue : undefined;
  const request: LatestTaskControlRequestState = {
    token: Symbol(taskId),
    activityReservation: previous?.activityReservation ?? null,
  };
  if (previous) previous.activityReservation = null;
  requestStates.set(taskId, request);
  const isCurrent = () => {
    const current = requestStates.get(taskId);
    return typeof current === 'object' && current.token === request.token;
  };
  const transferReservation = () => {
    if (!request.activityReservation) {
      throw new Error('HISTORY_ACTIVITY_RESERVATION_TRANSFERRED: The active reservation is unavailable.');
    }
    const transferred = request.activityReservation;
    request.activityReservation = null;
    return transferred;
  };
  try {
    if (!request.activityReservation && activityReservationSource) {
      request.activityReservation = acquireHistoryActivityReservation(activityReservationSource);
    }
    return await operation(isCurrent, transferReservation);
  } finally {
    if (isCurrent()) requestStates.delete(taskId);
    request.activityReservation?.release();
    request.activityReservation = null;
  }
}

export function requestTaskRunIntent(
  run: TaskRunIntentState,
  intent: TaskRunIntent,
  abortReason: unknown,
): void {
  run.intent = intent;
  if (!run.controller.signal.aborted) run.controller.abort(abortReason);
}

export async function stopTaskRunBeforeArtifactMutation(
  readOwner: () => CompletableTaskRun | undefined,
  isCurrent: () => boolean,
): Promise<boolean> {
  while (isCurrent()) {
    const owner = readOwner();
    if (!owner) return true;
    requestTaskRunIntent(owner, 'paused', '用户修改任务产物');
    await owner.completion;
    if (!isCurrent()) return false;
    if (readOwner() === owner) {
      throw new Error('Task run owner was not released after completion.');
    }
  }
  return false;
}

export async function finalizeTaskRunIntent<T>(
  run: TaskRunIntentState,
  apply: (intent: TaskRunIntent) => Promise<T>,
): Promise<{ intent: TaskRunIntent; result: T } | null> {
  let finalized: { intent: TaskRunIntent; result: T } | null = null;
  while (run.intent) {
    const intent = run.intent;
    run.intent = null;
    finalized = { intent, result: await apply(intent) };
  }
  return finalized;
}
