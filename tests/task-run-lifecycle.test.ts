import { readFile } from 'node:fs/promises';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import * as taskRunLifecycle from '../electron/task-run-lifecycle';
import {
  finalizeTaskRunIntent,
  requestTaskRunIntent,
  type TaskRunIntentState,
} from '../electron/task-run-lifecycle';

type LoadedTaskRunHandlers = Awaited<ReturnType<typeof loadTaskRunHandlers>>;

const restartCommands = [
  {
    label: 'regenerate image',
    invoke: (handlers: LoadedTaskRunHandlers, id: string) => handlers.regenerateImage(undefined, { id, sceneId: 1 }),
  },
  {
    label: 'regenerate narration',
    invoke: (handlers: LoadedTaskRunHandlers, id: string) => handlers.regenerateNarration(undefined, { id, sceneId: 1 }),
  },
  {
    label: 'rerun step',
    invoke: (handlers: LoadedTaskRunHandlers, id: string) => handlers.rerunStep(undefined, {
      id,
      step: 2,
      mode: 'regenerate',
    }),
  },
] as const;

describe('task run lifecycle intent coordination', () => {
  it('lets cancel supersede pause without changing the first abort reason', async () => {
    const gate = deferred<void>();
    const run = taskRun();
    const applied: string[] = [];
    const completion = finalizeAfter(gate.promise, run, applied);

    requestTaskRunIntent(run, 'paused', '用户暂停');
    requestTaskRunIntent(run, 'cancelled', '用户取消');
    expect(run.controller.signal.reason).toBe('用户暂停');

    gate.resolve();
    await completion;

    expect(applied).toEqual(['cancelled']);
  });

  it('lets retry supersede an in-flight cancellation after the old run settles', async () => {
    const gate = deferred<void>();
    const run = taskRun();
    const applied: string[] = [];
    const completion = finalizeAfter(gate.promise, run, applied);

    requestTaskRunIntent(run, 'cancelled', '用户取消');
    requestTaskRunIntent(run, 'restart', '用户重试');
    expect(run.controller.signal.reason).toBe('用户取消');

    gate.resolve();
    await completion;

    expect(applied).toEqual(['restart']);
  });

  it('does not restart when a later cancellation supersedes retry', async () => {
    const gate = deferred<void>();
    const run = taskRun();
    const applied: string[] = [];
    const completion = finalizeAfter(gate.promise, run, applied);

    requestTaskRunIntent(run, 'restart', '用户重试');
    requestTaskRunIntent(run, 'cancelled', '用户取消');

    gate.resolve();
    await completion;

    expect(applied).toEqual(['cancelled']);
  });

  it('drains a newer intent that arrives while the previous intent is being applied', async () => {
    const run = taskRun();
    const applyStarted = deferred<void>();
    const releaseApply = deferred<void>();
    const applied: string[] = [];
    requestTaskRunIntent(run, 'paused', '用户暂停');

    const finalization = finalizeTaskRunIntent(run, async (intent) => {
      applied.push(intent);
      if (intent === 'paused') {
        applyStarted.resolve();
        await releaseApply.promise;
      }
      return `applied:${intent}`;
    });
    await applyStarted.promise;

    requestTaskRunIntent(run, 'cancelled', '用户取消');
    releaseApply.resolve();

    await expect(finalization).resolves.toEqual({
      intent: 'cancelled',
      result: 'applied:cancelled',
    });
    expect(applied).toEqual(['paused', 'cancelled']);
  });

  it.each([
    {
      label: 'retry then cancel',
      order: ['retry', 'cancel'] as const,
      initialRun: true,
      expectedFinalIntent: 'cancelled',
      expectedStarts: 0,
      expectedPendingWrites: 0,
    },
    {
      label: 'cancel then retry',
      order: ['cancel', 'retry'] as const,
      initialRun: true,
      expectedFinalIntent: 'restart',
      expectedStarts: 1,
      expectedPendingWrites: 0,
    },
    {
      label: 'retry then cancel without an owner',
      order: ['retry', 'cancel'] as const,
      initialRun: false,
      expectedFinalIntent: null,
      expectedStarts: 0,
      expectedPendingWrites: 0,
    },
    {
      label: 'continue then cancel without an owner',
      order: ['continue', 'cancel'] as const,
      initialRun: false,
      expectedFinalIntent: null,
      expectedStarts: 0,
      expectedPendingWrites: 0,
    },
    {
      label: 'cancel then retry without an owner',
      order: ['cancel', 'retry'] as const,
      initialRun: false,
      expectedFinalIntent: null,
      expectedStarts: 1,
      expectedPendingWrites: 1,
    },
    {
      label: 'cancel then continue without an owner',
      order: ['cancel', 'continue'] as const,
      initialRun: false,
      expectedFinalIntent: null,
      expectedStarts: 1,
      expectedPendingWrites: 1,
    },
  ])(
    'preserves $label arrival order while both task lookups are blocked',
    async ({
      order,
      initialRun,
      expectedFinalIntent,
      expectedStarts,
      expectedPendingWrites,
    }) => {
      const taskId = 'task-retry-cancel-race';
      const run = initialRun ? taskRun() : null;
      const runningTasks = new Map<string, TaskRunIntentState>();
      if (run) runningTasks.set(taskId, run);
      const taskLookupStarted = [deferred<void>(), deferred<void>()];
      const releaseTaskLookups = deferred<{ tasks: Array<{
        id: string;
        errorMessage: string;
        failedStep: number | null;
        currentStep: number;
        retryFromStep: number | null;
      }> }>();
      const persisted: Array<{ id: string; status?: string; errorMessage?: string }> = [];
      let lookupCount = 0;
      let starts = 0;
      const database = {
        getState() {
          taskLookupStarted[lookupCount]?.resolve();
          lookupCount += 1;
          return releaseTaskLookups.promise;
        },
        async updateTask(
          id: string,
          patch: { status?: string; errorMessage?: string },
        ) {
          persisted.push({ id, ...patch });
        },
      };
      const handlers = await loadTaskRunHandlers({
        runningTasks,
        async getDb() {
          return database;
        },
        startTaskRun(_database, task) {
          starts += 1;
          runningTasks.set(task.id, taskRun());
          return true;
        },
      });
      const invoke = (command: 'retry' | 'continue' | 'cancel') => {
        if (command === 'retry') return handlers.retry(undefined, taskId);
        return handlers.updateStatus(undefined, {
          id: taskId,
          status: command === 'continue' ? 'running' : 'cancelled',
        });
      };

      const first = invoke(order[0]);
      await taskLookupStarted[0].promise;
      const second = invoke(order[1]);
      await taskLookupStarted[1].promise;

      const finalized = run
        ? await finalizeTaskRunIntent(run, async (intent) => intent)
        : null;
      if (run && runningTasks.get(taskId) === run) runningTasks.delete(taskId);
      if (finalized?.intent === 'restart') {
        handlers.startTaskRun(database, { id: taskId });
      }
      releaseTaskLookups.resolve({
        tasks: [{
          id: taskId,
          errorMessage: '',
          failedStep: null,
          currentStep: 2,
          retryFromStep: null,
        }],
      });
      await Promise.all([first, second]);

      const currentRun = runningTasks.get(taskId);
      if (currentRun) {
        const lateFinalized = await finalizeTaskRunIntent(currentRun, async (intent) => intent);
        if (lateFinalized?.intent === 'restart') {
          handlers.startTaskRun(database, { id: taskId });
        }
      }

      expect(finalized?.intent ?? null).toBe(expectedFinalIntent);
      expect(starts).toBe(expectedStarts);
      expect(persisted.filter((item) => item.status === 'pending')).toHaveLength(expectedPendingWrites);
    },
  );

  it.each(['retry', 'continue'] as const)(
    'does not start an ownerless %s request when cancel arrives during the pending write',
    async (command) => {
      const taskId = `task-ownerless-${command}-cancel`;
      const runningTasks = new Map<string, TaskRunIntentState>();
      const pendingWriteStarted = deferred<void>();
      const cancelLookupStarted = deferred<void>();
      const releasePendingWrite = deferred<void>();
      const persisted: Array<{ id: string; status?: string }> = [];
      const state = {
        tasks: [{
          id: taskId,
          errorMessage: '',
          failedStep: null,
          currentStep: 2,
          retryFromStep: null,
        }],
      };
      let pendingWrite: Promise<void> | null = null;
      let starts = 0;
      const database = {
        async getState() {
          if (pendingWrite) {
            cancelLookupStarted.resolve();
            await pendingWrite;
          }
          return state;
        },
        async updateTask(id: string, patch: { status?: string }) {
          persisted.push({ id, ...patch });
          if (patch.status === 'pending') {
            pendingWrite = releasePendingWrite.promise;
            pendingWriteStarted.resolve();
            await pendingWrite;
            pendingWrite = null;
          }
        },
      };
      const handlers = await loadTaskRunHandlers({
        runningTasks,
        async getDb() {
          return database;
        },
        startTaskRun(_database, task) {
          starts += 1;
          runningTasks.set(task.id, taskRun());
          return true;
        },
      });

      const first = command === 'retry'
        ? handlers.retry(undefined, taskId)
        : handlers.updateStatus(undefined, { id: taskId, status: 'running' });
      await pendingWriteStarted.promise;
      const cancellation = handlers.updateStatus(undefined, { id: taskId, status: 'cancelled' });
      await cancelLookupStarted.promise;
      releasePendingWrite.resolve();
      await Promise.all([first, cancellation]);

      expect(starts).toBe(0);
      expect(runningTasks.has(taskId)).toBe(false);
      expect(persisted.at(-1)).toMatchObject({ id: taskId, status: 'cancelled' });
    },
  );

  it('validates an ownerless task before retry and still allows a later valid retry', async () => {
    const taskId = 'task-ownerless-validation';
    const runningTasks = new Map<string, TaskRunIntentState>();
    const tasks: Array<{
      id: string;
      errorMessage: string;
      failedStep: number | null;
      currentStep: number;
      retryFromStep: number | null;
    }> = [];
    const persisted: Array<{ id: string; status?: string }> = [];
    let starts = 0;
    const database = {
      async getState() {
        return { tasks };
      },
      async updateTask(id: string, patch: { status?: string }) {
        persisted.push({ id, ...patch });
      },
    };
    const handlers = await loadTaskRunHandlers({
      runningTasks,
      async getDb() {
        return database;
      },
      startTaskRun(_database, task) {
        starts += 1;
        runningTasks.set(task.id, taskRun());
        return true;
      },
    });

    await handlers.retry(undefined, taskId);
    expect(starts).toBe(0);
    expect(persisted).toEqual([]);

    tasks.push({
      id: taskId,
      errorMessage: '',
      failedStep: null,
      currentStep: 2,
      retryFromStep: null,
    });
    await handlers.retry(undefined, taskId);

    expect(starts).toBe(1);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ id: taskId, status: 'pending' });
  });

  it('cancels a new run that appears while an ownerless cancel write is pending', async () => {
    const taskId = 'task-ownerless-cancel-late-owner';
    const runningTasks = new Map<string, TaskRunIntentState>();
    const cancelWriteStarted = deferred<void>();
    const releaseCancelWrite = deferred<void>();
    const database = {
      async getState() {
        return {
          tasks: [{
            id: taskId,
            errorMessage: '',
            failedStep: null,
            currentStep: 2,
            retryFromStep: null,
          }],
        };
      },
      async updateTask(_id: string, patch: { status?: string }) {
        if (patch.status === 'cancelled') {
          cancelWriteStarted.resolve();
          await releaseCancelWrite.promise;
        }
      },
    };
    const handlers = await loadTaskRunHandlers({
      runningTasks,
      async getDb() {
        return database;
      },
      startTaskRun() {
        throw new Error('Cancel must not start a task.');
      },
    });

    const cancellation = handlers.updateStatus(undefined, { id: taskId, status: 'cancelled' });
    await cancelWriteStarted.promise;
    const lateRun = taskRun();
    runningTasks.set(taskId, lateRun);
    releaseCancelWrite.resolve();
    await cancellation;

    expect(lateRun.intent).toBe('cancelled');
    expect(lateRun.controller.signal.aborted).toBe(true);
    expect(lateRun.controller.signal.reason).toBe('用户取消');
  });

  it.each(restartCommands)(
    'lets a newer ownerless cancel supersede $label while its artifact operation is pending',
    async ({ invoke, label }) => {
      const fixture = await createRestartRaceFixture(`artifact-${label}`);
      const artifactStarted = deferred<void>();
      const releaseArtifact = deferred<void>();
      fixture.setArtifactOperation(async () => {
        artifactStarted.resolve();
        await releaseArtifact.promise;
      });

      const restart = invoke(fixture.handlers, fixture.task.id);
      await artifactStarted.promise;
      await fixture.handlers.updateStatus(undefined, { id: fixture.task.id, status: 'cancelled' });
      releaseArtifact.resolve();
      await restart;

      expect(fixture.starts).toBe(0);
      expect(fixture.task.status).toBe('cancelled');
      expect(fixture.patches.filter((patch) => patch.status === 'pending')).toHaveLength(0);
    },
  );

  it.each(restartCommands)(
    'lets a newer ownerless cancel supersede $label while its pending database write is blocked',
    async ({ invoke, label }) => {
      const fixture = await createRestartRaceFixture(`database-${label}`);
      const pendingWriteStarted = deferred<void>();
      const releasePendingWrite = deferred<void>();
      fixture.setPendingWriteGate(pendingWriteStarted, releasePendingWrite);

      const restart = invoke(fixture.handlers, fixture.task.id);
      await pendingWriteStarted.promise;
      const cancellation = fixture.handlers.updateStatus(undefined, {
        id: fixture.task.id,
        status: 'cancelled',
      });
      releasePendingWrite.resolve();
      await Promise.all([restart, cancellation]);

      expect(fixture.starts).toBe(0);
      expect(fixture.task.status).toBe('cancelled');
      expect(fixture.patches.at(-1)).toMatchObject({ status: 'cancelled' });
    },
  );

  it.each(restartCommands)(
    'lets a newer ownerless $label supersede an older blocked cancel and starts exactly once',
    async ({ invoke, label }) => {
      const fixture = await createRestartRaceFixture(`reverse-${label}`);
      const firstLookupStarted = deferred<void>();
      const releaseFirstLookup = deferred<void>();
      fixture.setFirstLookupGate(firstLookupStarted, releaseFirstLookup);

      const cancellation = fixture.handlers.updateStatus(undefined, {
        id: fixture.task.id,
        status: 'cancelled',
      });
      await firstLookupStarted.promise;
      const restart = invoke(fixture.handlers, fixture.task.id);
      releaseFirstLookup.resolve();
      await Promise.all([cancellation, restart]);

      expect(fixture.starts).toBe(1);
      expect(fixture.task.status).toBe('pending');
      expect(fixture.patches.filter((patch) => patch.status === 'cancelled')).toHaveLength(0);
    },
  );

  it.each(restartCommands)(
    'keeps the existing owner intent cancelled when a newer cancel supersedes $label',
    async ({ invoke, label }) => {
      const fixture = await createRestartRaceFixture(`owned-cancel-${label}`, true);
      const artifactStarted = deferred<void>();
      const releaseArtifact = deferred<void>();
      fixture.setArtifactOperation(async () => {
        artifactStarted.resolve();
        await releaseArtifact.promise;
      });

      const restart = invoke(fixture.handlers, fixture.task.id);
      await artifactStarted.promise;
      await fixture.handlers.updateStatus(undefined, { id: fixture.task.id, status: 'cancelled' });
      releaseArtifact.resolve();
      await restart;

      expect(fixture.owner?.intent).toBe('cancelled');
      expect(fixture.starts).toBe(0);
    },
  );

  it.each(restartCommands)(
    'keeps the existing owner intent restart when a newer $label supersedes cancel',
    async ({ invoke, label }) => {
      const fixture = await createRestartRaceFixture(`owned-restart-${label}`, true);
      const firstLookupStarted = deferred<void>();
      const releaseFirstLookup = deferred<void>();
      fixture.setFirstLookupGate(firstLookupStarted, releaseFirstLookup);

      const cancellation = fixture.handlers.updateStatus(undefined, {
        id: fixture.task.id,
        status: 'cancelled',
      });
      await firstLookupStarted.promise;
      const restart = invoke(fixture.handlers, fixture.task.id);
      releaseFirstLookup.resolve();
      await Promise.all([cancellation, restart]);

      expect(fixture.owner?.intent).toBe('restart');
      expect(fixture.starts).toBe(0);
    },
  );

  it.each(restartCommands)(
    'cleans the command token when $label fails so a later retry can start',
    async ({ invoke, label }) => {
      const fixture = await createRestartRaceFixture(`error-${label}`);
      const failure = new Error(`${label} failed`);
      fixture.setArtifactOperation(async () => {
        throw failure;
      });

      await expect(invoke(fixture.handlers, fixture.task.id)).rejects.toBe(failure);
      await fixture.handlers.retry(undefined, fixture.task.id);

      expect(fixture.starts).toBe(1);
      expect(fixture.latestRequests.size).toBe(0);
    },
  );

  it('provides one latest-command helper that cleans its token after an error', async () => {
    const helper = Reflect.get(taskRunLifecycle, 'runLatestTaskControlRequest');
    expect(typeof helper).toBe('function');
    if (typeof helper !== 'function') return;
    const requests = new Map<string, symbol>();
    const failure = new Error('handler failed');

    await expect(helper(requests, 'task-helper-error', async (isCurrent: () => boolean) => {
      expect(isCurrent()).toBe(true);
      throw failure;
    })).rejects.toBe(failure);

    expect(requests.size).toBe(0);
  });

  it('stops and waits for the current owner before an artifact mutation begins', async () => {
    const helper = Reflect.get(taskRunLifecycle, 'stopTaskRunBeforeArtifactMutation');
    expect(helper).toBeTypeOf('function');
    if (typeof helper !== 'function') return;
    const owner = taskRun() as TaskRunIntentState & { completion: Promise<void> };
    const completion = deferred<void>();
    owner.completion = completion.promise;
    let currentOwner: typeof owner | undefined = owner;
    const waiting = (helper as (
      readOwner: () => typeof owner | undefined,
      isCurrent: () => boolean,
    ) => Promise<boolean>)(() => currentOwner, () => true);

    await Promise.resolve();
    expect(owner.intent).toBe('paused');
    expect(owner.controller.signal.aborted).toBe(true);
    currentOwner = undefined;
    completion.resolve();
    await expect(waiting).resolves.toBe(true);
  });

  it('abandons an artifact mutation superseded while its owner is stopping', async () => {
    const helper = Reflect.get(taskRunLifecycle, 'stopTaskRunBeforeArtifactMutation');
    expect(helper).toBeTypeOf('function');
    if (typeof helper !== 'function') return;
    const owner = taskRun() as TaskRunIntentState & { completion: Promise<void> };
    const completion = deferred<void>();
    owner.completion = completion.promise;
    let current = true;
    const waiting = (helper as (
      readOwner: () => typeof owner | undefined,
      isCurrent: () => boolean,
    ) => Promise<boolean>)(() => owner, () => current);

    expect(owner.intent).toBe('paused');
    current = false;
    completion.resolve();
    await expect(waiting).resolves.toBe(false);
  });

  it('wires every artifact mutation handler through latest-command ownership before changing the cache', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    for (const [channel, mutation] of [
      ['task:regenerate-image', 'markSceneImageForRegeneration'],
      ['task:regenerate-narration', 'markSceneNarrationForRegeneration'],
      ['task:update-image-prompt', 'updateSceneImagePrompt'],
      ['task:rerun-step', 'markTaskStepForRerun'],
    ] as const) {
      const handlerStart = main.indexOf(`trustedHandle('${channel}'`);
      const handlerEnd = main.indexOf('\ntrustedHandle(', handlerStart + 1);
      const section = main.slice(handlerStart, handlerEnd);
      const latest = section.indexOf('return runLatestTaskControlRequest(');
      const stop = section.indexOf('await stopTaskRunBeforeArtifactMutation(');
      const mutate = section.indexOf(`await ${mutation}(`);
      expect(latest).toBeGreaterThan(-1);
      expect(stop).toBeGreaterThan(-1);
      expect(mutate).toBeGreaterThan(stop);
    }
  });

  it('releases the same run owner when applying its final intent fails', async () => {
    const taskId = 'task-final-intent-write-failure';
    const applyError = new Error('final intent persistence failed');
    const executeStarted = deferred<void>();
    const releaseExecute = deferred<void>();
    const runningTasks = new Map<string, OwnedTaskRun>();
    let starts = 0;
    const cleanupLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const startOwnedTaskRun = await loadStartOwnedTaskRun({
        runningTasks,
        async applyTaskRunIntent() {
          throw applyError;
        },
        startTaskRun() {
          starts += 1;
          return true;
        },
      });

      expect(startOwnedTaskRun(
        {},
        { id: taskId },
        'Test task',
        async () => {
          executeStarted.resolve();
          await releaseExecute.promise;
        },
      )).toBe(true);
      await executeStarted.promise;
      const run = runningTasks.get(taskId);
      expect(run).toBeDefined();
      requestTaskRunIntent(run!, 'restart', '用户重试');
      releaseExecute.resolve();

      await expect(run!.completion).rejects.toBe(applyError);
      await Promise.resolve();

      expect(runningTasks.has(taskId)).toBe(false);
      expect(starts).toBe(0);
      expect(cleanupLog).toHaveBeenCalledWith('Background task cleanup failed', applyError);
    } finally {
      cleanupLog.mockRestore();
    }
  });
});

interface RestartRaceTask {
  id: string;
  artifactStatePath: string;
  errorMessage: string;
  failedStep: number | null;
  currentStep: number;
  retryFromStep: number | null;
  status: 'paused' | 'pending' | 'cancelled';
}

async function createRestartRaceFixture(label: string, withOwner = false) {
  const task: RestartRaceTask = {
    id: `task-${label}`,
    artifactStatePath: `artifact-${label}.json`,
    errorMessage: '',
    failedStep: 2,
    currentStep: 2,
    retryFromStep: 2,
    status: 'paused',
  };
  const owner = withOwner ? taskRun() : null;
  const runningTasks = new Map<string, TaskRunIntentState>();
  if (owner) runningTasks.set(task.id, owner);
  const patches: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  let starts = 0;
  let artifactOperation: () => Promise<void> = async () => undefined;
  let writeTail = Promise.resolve();
  let pendingWriteGate: {
    started: ReturnType<typeof deferred<void>>;
    release: ReturnType<typeof deferred<void>>;
  } | null = null;
  let firstLookupGate: {
    started: ReturnType<typeof deferred<void>>;
    release: ReturnType<typeof deferred<void>>;
  } | null = null;

  const database = {
    async getState() {
      const lookupGate = firstLookupGate;
      if (lookupGate) {
        firstLookupGate = null;
        lookupGate.started.resolve();
        await lookupGate.release.promise;
      }
      await writeTail;
      return { tasks: [task] };
    },
    updateTask(id: string, patch: Record<string, unknown>) {
      const operation = writeTail.then(async () => {
        patches.push({ id, ...patch });
        const gate = patch.status === 'pending' ? pendingWriteGate : null;
        if (gate) {
          pendingWriteGate = null;
          gate.started.resolve();
          await gate.release.promise;
        }
        Object.assign(task, patch);
      });
      writeTail = operation.catch(() => undefined);
      return operation;
    },
    addTaskEvent(_id: string, event: Record<string, unknown>) {
      const operation = writeTail.then(() => {
        events.push(event);
      });
      writeTail = operation.catch(() => undefined);
      return operation;
    },
  };
  const handlers = await loadTaskRunHandlers({
    runningTasks,
    async getDb() {
      return database;
    },
    async markSceneImageForRegeneration() {
      await artifactOperation();
    },
    async markSceneNarrationForRegeneration() {
      await artifactOperation();
    },
    async markTaskStepForRerun(_path, _step, mode) {
      await artifactOperation();
      return { mode, clearedSteps: [2] };
    },
    startTaskRun(_database, startedTask) {
      starts += 1;
      runningTasks.set(startedTask.id, taskRun());
      return true;
    },
  });

  return {
    database,
    events,
    handlers,
    latestRequests: handlers.latestRequests,
    owner,
    patches,
    runningTasks,
    get starts() {
      return starts;
    },
    task,
    setArtifactOperation(operation: () => Promise<void>) {
      artifactOperation = operation;
    },
    setFirstLookupGate(
      started: ReturnType<typeof deferred<void>>,
      release: ReturnType<typeof deferred<void>>,
    ) {
      firstLookupGate = { started, release };
    },
    setPendingWriteGate(
      started: ReturnType<typeof deferred<void>>,
      release: ReturnType<typeof deferred<void>>,
    ) {
      pendingWriteGate = { started, release };
    },
  };
}

interface OwnedTaskRun extends TaskRunIntentState {
  completion: Promise<void>;
}

interface TaskRunHandlerDependencies {
  runningTasks: Map<string, TaskRunIntentState>;
  getDb: () => Promise<{
    getState: () => Promise<unknown>;
    updateTask: (
      id: string,
      patch: Record<string, unknown>,
    ) => Promise<void>;
    addTaskEvent?: (id: string, event: Record<string, unknown>) => Promise<void>;
  }>;
  markSceneImageForRegeneration?: (path: string, sceneId: number) => Promise<void>;
  markSceneNarrationForRegeneration?: (path: string, sceneId: number) => Promise<void>;
  markTaskStepForRerun?: (
    path: string,
    step: number,
    mode: 'regenerate' | 'rewrite',
  ) => Promise<{ mode: 'regenerate' | 'rewrite'; clearedSteps: number[] }>;
  startTaskRun: (
    database: unknown,
    task: { id: string },
  ) => boolean;
}

interface StartOwnedTaskRunDependencies {
  runningTasks: Map<string, OwnedTaskRun>;
  applyTaskRunIntent: (
    database: unknown,
    taskId: string,
    intent: 'paused' | 'cancelled' | 'restart',
  ) => Promise<unknown>;
  startTaskRun: (database: unknown, task: { id: string }) => boolean;
}

async function loadStartOwnedTaskRun(dependencies: StartOwnedTaskRunDependencies) {
  const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
  const FunctionConstructor = Function as unknown as new (
    ...args: string[]
  ) => (...args: unknown[]) => unknown;
  const compiledSource = transpileModule(
    extractFunctionSource(
      main,
      'function startOwnedTaskRun',
      'async function applyTaskRunIntent',
    ),
    {
      compilerOptions: {
        target: ScriptTarget.ES2022,
        module: ModuleKind.None,
      },
    },
  ).outputText;
  const factory = new FunctionConstructor(
    'isShuttingDown',
    'runningTasks',
    'finalizeTaskRunIntent',
    'applyTaskRunIntent',
    'startTaskRun',
    'sendTaskState',
    `${compiledSource}\nreturn startOwnedTaskRun;`,
  );
  const compiled = factory(
    false,
    dependencies.runningTasks,
    finalizeTaskRunIntent,
    dependencies.applyTaskRunIntent,
    dependencies.startTaskRun,
    async () => undefined,
  ) as (
    database: unknown,
    task: { id: string },
    label: string,
    execute: (controller: AbortController) => Promise<void>,
  ) => boolean;

  return (
    database: unknown,
    task: { id: string },
    label: string,
    execute: (controller: AbortController) => Promise<void>,
  ) => compiled(database, task, label, execute);
}

async function loadTaskRunHandlers(dependencies: TaskRunHandlerDependencies) {
  const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
  const latestTaskControlRequests = new Map<string, symbol>();
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
  ) => (...args: unknown[]) => Promise<unknown>;
  const resumeTaskRunBody = extractFunctionBody(
    main,
    'async function resumeTaskRun',
    'async function resumeLatestTaskRun',
  );
  const compiledResumeTaskRun = new AsyncFunction(
    'database',
    'task',
    'isShuttingDown',
    'runningTasks',
    'requestTaskRunIntent',
    'shouldStart',
    'startTaskRun',
    resumeTaskRunBody,
  );
  const resumeTaskRun = (
    database: unknown,
    task: { id: string },
    shouldStart: () => boolean = () => true,
  ) => compiledResumeTaskRun(
    database,
    task,
    false,
    dependencies.runningTasks,
    requestTaskRunIntent,
    shouldStart,
      dependencies.startTaskRun,
    );
  const resumeLatestTaskRunBody = extractFunctionBody(
    main,
    'async function resumeLatestTaskRun',
    'function startViralAnalysisRun',
  );
  const compiledResumeLatestTaskRun = new AsyncFunction(
    'database',
    'taskId',
    'isCurrent',
    'resumeTaskRun',
    resumeLatestTaskRunBody,
  );
  const resumeLatestTaskRun = (
    database: unknown,
    taskId: string,
    isCurrent: () => boolean,
  ) => compiledResumeLatestTaskRun(database, taskId, isCurrent, resumeTaskRun);
  const compiledUpdateStatus = new AsyncFunction(
    '_event',
    'input',
    'getDb',
    'getPublicState',
    'runningTasks',
    'latestTaskControlRequests',
    'runLatestTaskControlRequest',
    'requestTaskRunIntent',
    'resumeTaskRun',
    extractHandlerBody(main, 'task:update-status'),
  );
  const compiledRetry = new AsyncFunction(
    '_event',
    'id',
    'getDb',
    'getPublicState',
    'runningTasks',
    'latestTaskControlRequests',
    'runLatestTaskControlRequest',
    'requestTaskRunIntent',
    'resumeTaskRun',
    extractHandlerBody(main, 'task:retry'),
  );
  const actualLatestRequestRunner = Reflect.get(taskRunLifecycle, 'runLatestTaskControlRequest');
  const runLatestTaskControlRequest = typeof actualLatestRequestRunner === 'function'
    ? actualLatestRequestRunner
    : async <T>(
      requests: Map<string, symbol>,
      taskId: string,
      operation: (isCurrent: () => boolean) => Promise<T>,
    ): Promise<T> => {
      const token = Symbol(taskId);
      requests.set(taskId, token);
      const isCurrent = () => requests.get(taskId) === token;
      try {
        return await operation(isCurrent);
      } finally {
        if (isCurrent()) requests.delete(taskId);
      }
    };
  const compileRestartHandler = (channel: string, dependencyNames: string[]) => new AsyncFunction(
    '_event',
    'input',
    'getDb',
    'getPublicState',
    'latestTaskControlRequests',
    'runLatestTaskControlRequest',
    'runningTasks',
    'stopTaskRunBeforeArtifactMutation',
    'resumeTaskRun',
    'resumeLatestTaskRun',
    'taskWorkDir',
    ...dependencyNames,
    extractHandlerBody(main, channel),
  );
  const compiledRegenerateImage = compileRestartHandler('task:regenerate-image', [
    'markSceneImageForRegeneration',
  ]);
  const compiledRegenerateNarration = compileRestartHandler('task:regenerate-narration', [
    'markSceneNarrationForRegeneration',
  ]);
  const compiledRerunStep = compileRestartHandler('task:rerun-step', [
    'markTaskStepForRerun',
    'pipelineStepAgents',
  ]);
  const restartHandlerDependencies = [
    dependencies.getDb,
    () => ({}),
    latestTaskControlRequests,
    runLatestTaskControlRequest,
    dependencies.runningTasks,
    async (_readOwner: () => TaskRunIntentState | undefined, isCurrent: () => boolean) => isCurrent(),
    resumeTaskRun,
    resumeLatestTaskRun,
    (task: { id: string }) => `work/${task.id}`,
  ] as const;
  const markSceneImageForRegeneration = dependencies.markSceneImageForRegeneration
    ?? (async () => undefined);
  const markSceneNarrationForRegeneration = dependencies.markSceneNarrationForRegeneration
    ?? (async () => undefined);
  const markTaskStepForRerun = dependencies.markTaskStepForRerun
    ?? (async (_path: string, _step: number, mode: 'regenerate' | 'rewrite') => ({ mode, clearedSteps: [] }));

  return {
    latestRequests: latestTaskControlRequests,
    startTaskRun: dependencies.startTaskRun,
    updateStatus(
      event: unknown,
      input: { id: string; status: 'paused' | 'cancelled' | 'running' },
    ) {
      return compiledUpdateStatus(
        event,
        input,
        dependencies.getDb,
        () => ({}),
        dependencies.runningTasks,
        latestTaskControlRequests,
        runLatestTaskControlRequest,
        requestTaskRunIntent,
        resumeTaskRun,
      );
    },
    retry(event: unknown, id: string) {
      return compiledRetry(
        event,
        id,
        dependencies.getDb,
        () => ({}),
        dependencies.runningTasks,
        latestTaskControlRequests,
        runLatestTaskControlRequest,
        requestTaskRunIntent,
        resumeTaskRun,
      );
    },
    regenerateImage(event: unknown, input: { id: string; sceneId: number }) {
      return compiledRegenerateImage(
        event,
        input,
        ...restartHandlerDependencies,
        markSceneImageForRegeneration,
      );
    },
    regenerateNarration(event: unknown, input: { id: string; sceneId: number }) {
      return compiledRegenerateNarration(
        event,
        input,
        ...restartHandlerDependencies,
        markSceneNarrationForRegeneration,
      );
    },
    rerunStep(event: unknown, input: { id: string; step: number; mode: 'regenerate' | 'rewrite' }) {
      return compiledRerunStep(
        event,
        input,
        ...restartHandlerDependencies,
        markTaskStepForRerun,
        { 2: 'Storyboard' },
      );
    },
  };
}

function extractHandlerBody(source: string, channel: string): string {
  const handlerStart = source.indexOf(`trustedHandle('${channel}'`);
  const bodyStart = source.indexOf(') => {', handlerStart) + ') => {'.length;
  const nextHandler = source.indexOf('\ntrustedHandle(', bodyStart);
  const handlerBoundary = nextHandler < 0 ? source.length : nextHandler;
  const bodyEnd = source.lastIndexOf('\n});', handlerBoundary);
  if (handlerStart < 0 || bodyStart < ') => {'.length || bodyEnd < 0) {
    throw new Error(`Unable to locate the ${channel} handler.`);
  }
  return source.slice(bodyStart, bodyEnd);
}

function extractFunctionBody(source: string, marker: string, nextMarker: string): string {
  const functionStart = source.indexOf(marker);
  const nextFunction = source.indexOf(nextMarker, functionStart);
  const bodyStart = source.indexOf('{', functionStart) + 1;
  const bodyEnd = source.lastIndexOf('\n}', nextFunction);
  if (functionStart < 0 || nextFunction < 0 || bodyStart < 1 || bodyEnd < bodyStart) {
    throw new Error(`Unable to locate ${marker}.`);
  }
  return source.slice(bodyStart, bodyEnd);
}

function extractFunctionSource(source: string, marker: string, nextMarker: string): string {
  const functionStart = source.indexOf(marker);
  const nextFunction = source.indexOf(nextMarker, functionStart);
  if (functionStart < 0 || nextFunction < 0) {
    throw new Error(`Unable to locate ${marker}.`);
  }
  return source.slice(functionStart, nextFunction);
}

async function finalizeAfter(
  completion: Promise<void>,
  run: TaskRunIntentState,
  applied: string[],
): Promise<void> {
  await completion;
  await finalizeTaskRunIntent(run, async (intent) => {
    applied.push(intent);
  });
}

function taskRun(): TaskRunIntentState {
  return {
    controller: new AbortController(),
    intent: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
