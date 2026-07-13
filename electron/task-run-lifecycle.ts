export type TaskRunIntent = 'paused' | 'cancelled' | 'restart';

export interface TaskRunIntentState {
  controller: AbortController;
  intent: TaskRunIntent | null;
}

interface CompletableTaskRun extends TaskRunIntentState {
  completion: Promise<void>;
}

export async function runLatestTaskControlRequest<T>(
  requests: Map<string, symbol>,
  taskId: string,
  operation: (isCurrent: () => boolean) => Promise<T>,
): Promise<T> {
  const token = Symbol(taskId);
  requests.set(taskId, token);
  const isCurrent = () => requests.get(taskId) === token;
  try {
    return await operation(isCurrent);
  } finally {
    if (isCurrent()) requests.delete(taskId);
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
