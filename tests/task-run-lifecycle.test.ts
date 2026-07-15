import { readFile } from 'node:fs/promises';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { HistoryActivityRegistry } from '../electron/history-activity-registry';
import * as taskRunLifecycle from '../electron/task-run-lifecycle';
import {
  finalizeTaskRunIntent,
  requestTaskRunIntent,
  runLatestTaskControlRequest,
  takeHistoryActivityReservation,
  type HistoryActivityReservationOwner,
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
  it('releases an untransferred active reservation when a control request fails', async () => {
    const failure = new Error('pending status persistence failed');
    const reservation = { release: vi.fn() };

    await expect(runLatestTaskControlRequest(
      new Map(),
      'task-reservation-failure',
      async () => {
        throw failure;
      },
      reservation,
    )).rejects.toBe(failure);

    expect(reservation.release).toHaveBeenCalledTimes(1);
  });

  it('hands an active reservation to the background owner exactly once', async () => {
    const reservation = { release: vi.fn() };
    let transferred: { release(): void } | null = null;

    await runLatestTaskControlRequest(
      new Map(),
      'task-reservation-transfer',
      async (_isCurrent, transferReservation) => {
        transferred = transferReservation();
        expect(() => transferReservation()).toThrow(/transferred|reservation/i);
      },
      reservation,
    );

    expect(transferred).toBe(reservation);
    expect(reservation.release).not.toHaveBeenCalled();
    reservation.release();
    expect(reservation.release).toHaveBeenCalledTimes(1);
  });

  it('hands an ownerless active lease to the latest control request without a release gap', async () => {
    const registry = new HistoryActivityRegistry();
    const requests = new Map();
    const firstStarted = deferred<void>();
    const releaseFirst = deferred<void>();
    const secondStarted = deferred<void>();
    const releaseSecond = deferred<void>();

    const first = runLatestTaskControlRequest(
      requests,
      'task-latest-lease',
      async (isCurrent) => {
        firstStarted.resolve();
        await releaseFirst.promise;
        expect(isCurrent()).toBe(false);
      },
      () => registry.reserveActive('task', 'task-latest-lease'),
    );
    await firstStarted.promise;
    const second = runLatestTaskControlRequest(
      requests,
      'task-latest-lease',
      async (isCurrent) => {
        secondStarted.resolve();
        await releaseSecond.promise;
        expect(isCurrent()).toBe(true);
      },
      () => registry.reserveActive('task', 'task-latest-lease'),
    );
    await secondStarted.promise;

    releaseFirst.resolve();
    const [firstResult] = await Promise.allSettled([first]);
    let governanceDuringSecond: { release(): void } | null = null;
    try {
      governanceDuringSecond = registry.reserveGovernance('task', 'task-latest-lease');
    } catch {
      // Expected while the latest request owns the active lease.
    }
    governanceDuringSecond?.release();
    releaseSecond.resolve();
    const [secondResult] = await Promise.allSettled([second]);

    expect(firstResult.status).toBe('fulfilled');
    expect(secondResult.status).toBe('fulfilled');
    expect(governanceDuringSecond).toBeNull();
    const afterLatest = registry.reserveGovernance('task', 'task-latest-lease');
    afterLatest.release();
  });

  it('cleans the latest request token when active lease acquisition fails', async () => {
    const requests = new Map();
    const failure = new Error('active lease acquisition failed');
    const operation = vi.fn(async () => undefined);

    await expect(runLatestTaskControlRequest(
      requests,
      'task-acquisition-failure',
      operation,
      () => {
        throw failure;
      },
    )).rejects.toBe(failure);

    expect(operation).not.toHaveBeenCalled();
    expect(requests.size).toBe(0);
  });

  it('holds an ownerless task status mutation against governance', async () => {
    const id = 'task-ownerless-status';
    const registry = new HistoryActivityRegistry();
    const updateStarted = deferred<void>();
    const releaseUpdate = deferred<void>();
    const handlers = await loadTaskRunHandlers({
      runningTasks: new Map(),
      historyActivityRegistry: registry,
      async getDb() {
        return {
          async getState() {
            return {
              tasks: [{ id, status: 'pending', errorMessage: '', currentStep: 1 }],
            };
          },
          async updateTask() {
            updateStarted.resolve();
            await releaseUpdate.promise;
          },
        };
      },
      startTaskRun: () => false,
    });

    const cancellation = handlers.updateStatus(undefined, { id, status: 'cancelled' });
    await updateStarted.promise;
    expect(() => registry.reserveGovernance('task', id)).toThrow(/active/i);
    releaseUpdate.resolve();
    await cancellation;
    const governance = registry.reserveGovernance('task', id);
    governance.release();
  });

  it('keeps an inherited task lease until a superseding cancel and the active runtime settle', async () => {
    const id = 'task-active-cancel-handoff';
    const registry = new HistoryActivityRegistry();
    const releaseRuntime = deferred<void>();
    const runningTasks = new Map<string, OwnedTaskRun>();
    let run!: OwnedTaskRun;
    run = {
      activityReservation: null,
      controller: new AbortController(),
      intent: null,
      completion: releaseRuntime.promise.then(() => {
        if (runningTasks.get(id) === run) runningTasks.delete(id);
      }),
    };
    runningTasks.set(id, run);
    const handlers = await loadTaskRunHandlers({
      runningTasks,
      historyActivityRegistry: registry,
      async getDb() {
        return {
          async getState() {
            return { tasks: [{ id, status: 'running', errorMessage: '', currentStep: 1 }] };
          },
          async updateTask() {},
        };
      },
      startTaskRun: () => false,
    });
    seedLatestActivityReservation(
      handlers.latestRequests,
      id,
      registry.reserveActive('task', id),
    );

    const cancellation = handlers.updateStatus(undefined, { id, status: 'cancelled' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    let governanceDuringRuntime: { release(): void } | null = null;
    try {
      governanceDuringRuntime = registry.reserveGovernance('task', id);
    } catch {
      // Expected until both the newer control and the runtime have settled.
    }
    governanceDuringRuntime?.release();
    releaseRuntime.resolve();
    await cancellation;

    expect(governanceDuringRuntime).toBeNull();
    const governance = registry.reserveGovernance('task', id);
    governance.release();
  });

  it.each([
    {
      label: 'running status',
      invoke: (handlers: LoadedTaskRunHandlers, id: string) =>
        handlers.updateStatus(undefined, { id, status: 'running' }),
    },
    {
      label: 'retry',
      invoke: (handlers: LoadedTaskRunHandlers, id: string) => handlers.retry(undefined, id),
    },
  ])('returns an inherited task lease to the active runtime before $label requests restart', async ({ invoke }) => {
    const id = 'task-active-restart-handoff';
    const registry = new HistoryActivityRegistry();
    const reservation = registry.reserveActive('task', id);
    const run: OwnedTaskRun = {
      activityReservation: null,
      controller: new AbortController(),
      intent: null,
      completion: Promise.resolve(),
    };
    const handlers = await loadTaskRunHandlers({
      runningTasks: new Map([[id, run]]),
      historyActivityRegistry: registry,
      async getDb() {
        return {
          async getState() {
            return { tasks: [{ id, status: 'running', errorMessage: '', currentStep: 1 }] };
          },
          async updateTask() {},
        };
      },
      startTaskRun: () => false,
    });
    seedLatestActivityReservation(handlers.latestRequests, id, reservation);

    await invoke(handlers, id);

    expect(run.intent).toBe('restart');
    expect(run.activityReservation).toBe(reservation);
    expect(() => registry.reserveGovernance('task', id)).toThrow(/active/i);
    takeHistoryActivityReservation(run).release();
  });

  it('keeps a task reservation until terminal persistence settles and releases execution failures', async () => {
    const taskId = 'task-terminal-reservation';
    const runningTasks = new Map<string, OwnedTaskRun>();
    const terminalWriteStarted = deferred<void>();
    const releaseTerminalWrite = deferred<void>();
    const reservation = { release: vi.fn() };
    const startOwnedTaskRun = await loadStartOwnedTaskRun({
      runningTasks,
      async applyTaskRunIntent() {
        return null;
      },
      startTaskRun() {
        return false;
      },
    });

    expect(startOwnedTaskRun(
      {},
      { id: taskId },
      reservation,
      'Terminal task',
      async () => {
        terminalWriteStarted.resolve();
        await releaseTerminalWrite.promise;
      },
    )).toBe(true);
    await terminalWriteStarted.promise;
    expect(reservation.release).not.toHaveBeenCalled();

    const run = runningTasks.get(taskId);
    releaseTerminalWrite.resolve();
    await run?.completion;
    expect(reservation.release).toHaveBeenCalledTimes(1);

    const failedReservation = { release: vi.fn() };
    const failureLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      startOwnedTaskRun(
        {},
        { id: 'task-execution-failure' },
        failedReservation,
        'Failing task',
        async () => {
          throw new Error('runner failed before terminal update');
        },
      );
      await runningTasks.get('task-execution-failure')?.completion;
      expect(failedReservation.release).toHaveBeenCalledTimes(1);
    } finally {
      failureLog.mockRestore();
    }
  });

  it('holds viral activity through terminal writes and releases provider or database failures', async () => {
    const terminalStarted = deferred<void>();
    const releaseTerminal = deferred<void>();
    const registry = new HistoryActivityRegistry();
    const successHarness = await loadViralRunHarness({
      async runViralAnalysis() {
        return {
          resultPath: 'result.json',
          videoPath: 'video.mp4',
          result: { source: { title: 'Completed title' } },
        };
      },
      async updateViralAnalysis(_id, patch) {
        if (patch.status === 'completed') {
          terminalStarted.resolve();
          await releaseTerminal.promise;
        }
      },
    });
    const active = registry.reserveActive('viral-analysis', 'viral-terminal');
    expect(successHarness.start(successHarness.database, viralRecord('viral-terminal'), 'work/viral', active)).toBe(true);
    const completion = successHarness.running.get('viral-terminal')?.completion;
    await terminalStarted.promise;
    expect(() => registry.reserveGovernance('viral-analysis', 'viral-terminal')).toThrow(/active/i);
    releaseTerminal.resolve();
    await completion;
    const governance = registry.reserveGovernance('viral-analysis', 'viral-terminal');
    governance.release();

    const failureRegistry = new HistoryActivityRegistry();
    const databaseFailure = new Error('failed status persistence failed');
    const failureHarness = await loadViralRunHarness({
      async runViralAnalysis() {
        throw new Error('provider failed');
      },
      async updateViralAnalysis(_id, patch) {
        if (patch.status === 'failed') throw databaseFailure;
      },
    });
    const failureLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const failureActive = failureRegistry.reserveActive('viral-analysis', 'viral-failure');
      failureHarness.start(failureHarness.database, viralRecord('viral-failure'), 'work/viral', failureActive);
      await expect(failureHarness.running.get('viral-failure')?.completion).rejects.toBe(databaseFailure);
      const afterFailure = failureRegistry.reserveGovernance('viral-analysis', 'viral-failure');
      afterFailure.release();
    } finally {
      failureLog.mockRestore();
    }
  });

  it.each([
    {
      channel: 'image-lab:generate',
      family: 'image-lab' as const,
      generatorName: 'generateImageLabRecord',
      workDirName: 'imageLabWorkDir',
      summaryName: 'imageLabSummary',
      id: 'image-terminal',
      input: { id: 'image-terminal', prompt: 'prompt', ratio: '9:16', style: 'photo-real' },
    },
    {
      channel: 'voice-lab:generate',
      family: 'voice-lab' as const,
      generatorName: 'generateConfiguredVoicePreview',
      workDirName: 'voiceLabWorkDir',
      summaryName: 'voiceLabSummary',
      id: 'voice-terminal',
      input: { id: 'voice-terminal', text: 'voice', provider: 'mock', voiceId: 'voice', speed: 1 },
    },
  ])('holds $family activity through provider and terminal writes and releases failures', async (spec) => {
    const providerStarted = deferred<void>();
    const releaseProvider = deferred<void>();
    const terminalStarted = deferred<void>();
    const releaseTerminal = deferred<void>();
    const registry = new HistoryActivityRegistry();
    const database = labDatabase(async () => {
      terminalStarted.resolve();
      await releaseTerminal.promise;
    });
    const handler = await loadLabGenerateHandler(spec, {
      registry,
      database,
      async generate() {
        providerStarted.resolve();
        await releaseProvider.promise;
        return { status: 'generated', finishedAt: '2026-07-16T00:00:00.000Z' };
      },
    });

    const generation = handler(spec.input);
    await providerStarted.promise;
    expect(() => registry.reserveGovernance(spec.family, spec.id)).toThrow(/active/i);
    releaseProvider.resolve();
    await terminalStarted.promise;
    expect(() => registry.reserveGovernance(spec.family, spec.id)).toThrow(/active/i);
    releaseTerminal.resolve();
    await generation;
    const governance = registry.reserveGovernance(spec.family, spec.id);
    governance.release();

    const failureRegistry = new HistoryActivityRegistry();
    const terminalFailure = new Error(`${spec.family} failed status persistence failed`);
    const failureHandler = await loadLabGenerateHandler(spec, {
      registry: failureRegistry,
      database: labDatabase(async () => {
        throw terminalFailure;
      }),
      async generate() {
        throw new Error(`${spec.family} provider failed`);
      },
    });
    await expect(failureHandler(spec.input)).rejects.toBe(terminalFailure);
    const afterFailure = failureRegistry.reserveGovernance(spec.family, spec.id);
    afterFailure.release();
  });

  it.each([
    { channel: 'html-video:create-task', family: 'task' as const, id: 'created-task', input: { inputText: 'html' } },
    { channel: 'task:create-and-run', family: 'task' as const, id: 'created-task', input: { inputText: 'task' } },
    { channel: 'viral:create-and-run', family: 'viral-analysis' as const, id: 'created-viral', input: { url: 'https://example.test', settings: {} } },
    { channel: 'viral:create-production-task', family: 'task' as const, id: 'created-task', input: { id: 'source-viral' } },
  ])('releases $channel reservations when background ownership is not transferred', async (spec) => {
    for (const startFailure of [null, new Error(`${spec.channel} start failed`)] as const) {
      const registry = new HistoryActivityRegistry();
      const handler = await loadCreatedRunHandler(spec.channel, registry, startFailure);
      if (startFailure) {
        await expect(handler(spec.input)).rejects.toBe(startFailure);
      } else {
        await expect(handler(spec.input)).resolves.toBeNull();
      }
      const governance = registry.reserveGovernance(spec.family, spec.id);
      governance.release();
    }
  });

  it('keeps viral analysis cancelled when a later cancel supersedes a blocked retry', async () => {
    const id = 'viral-retry-cancel-race';
    const registry = new HistoryActivityRegistry();
    const releaseRuntime = deferred<void>();
    const running = new Map<string, {
      activityReservation: { release(): void } | null;
      completion: Promise<void>;
      controller: AbortController;
    }>();
    const record = { ...viralRecord(id), status: 'running', errorMessage: '' };
    let currentRecord = record;
    let restartCount = 0;
    let oldRun!: (typeof running extends Map<string, infer T> ? T : never);
    oldRun = {
      activityReservation: registry.reserveActive('viral-analysis', id),
      controller: new AbortController(),
      completion: releaseRuntime.promise.then(() => {
        if (running.get(id) === oldRun) running.delete(id);
      }),
    };
    running.set(id, oldRun);
    const database = {
      async getState() {
        return { viralAnalyses: [currentRecord] };
      },
      async updateViralAnalysis(_id: string, patch: Record<string, unknown>) {
        currentRecord = { ...currentRecord, ...patch } as typeof currentRecord;
      },
    };
    const handlers = await loadViralControlHandlers({
      registry,
      running,
      database,
      async resumeViralAnalysisRun(runtimeDatabase, runtimeRecord) {
        restartCount += 1;
        await runtimeDatabase.updateViralAnalysis(runtimeRecord.id, {
          status: 'pending',
          currentStage: 'queued',
        });
        return false;
      },
    });

    const retry = handlers.retry(id);
    await vi.waitFor(() => expect(oldRun.controller.signal.aborted).toBe(true));
    const cancellation = handlers.updateStatus({ id, status: 'cancelled' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(() => registry.reserveGovernance('viral-analysis', id)).toThrow(/active/i);

    releaseRuntime.resolve();
    await Promise.all([retry, cancellation]);

    expect(currentRecord.status).toBe('cancelled');
    expect(restartCount).toBe(0);
    const governance = registry.reserveGovernance('viral-analysis', id);
    governance.release();
  });

  it('starts viral analysis once when a later retry supersedes a blocked cancel', async () => {
    const id = 'viral-cancel-retry-race';
    const registry = new HistoryActivityRegistry();
    const firstLookupStarted = deferred<void>();
    const releaseFirstLookup = deferred<void>();
    const resumeStarted = deferred<void>();
    const releaseResume = deferred<void>();
    const record = { ...viralRecord(id), status: 'running', errorMessage: '' };
    let currentRecord = record;
    let firstLookup = true;
    let restartCount = 0;
    const handlers = await loadViralControlHandlers({
      registry,
      running: new Map(),
      database: {
        async getState() {
          if (firstLookup) {
            firstLookup = false;
            firstLookupStarted.resolve();
            await releaseFirstLookup.promise;
          }
          return { viralAnalyses: [currentRecord] };
        },
        async updateViralAnalysis(_id, patch) {
          currentRecord = { ...currentRecord, ...patch } as typeof currentRecord;
        },
      },
      async resumeViralAnalysisRun(runtimeDatabase, runtimeRecord) {
        restartCount += 1;
        resumeStarted.resolve();
        await releaseResume.promise;
        await runtimeDatabase.updateViralAnalysis(runtimeRecord.id, {
          status: 'pending',
          currentStage: 'queued',
        });
        return false;
      },
    });

    const cancellation = handlers.updateStatus({ id, status: 'cancelled' });
    await firstLookupStarted.promise;
    const retry = handlers.retry(id);
    await resumeStarted.promise;
    expect(() => registry.reserveGovernance('viral-analysis', id)).toThrow(/active/i);
    releaseResume.resolve();
    await retry;
    releaseFirstLookup.resolve();
    await cancellation;

    expect(currentRecord.status).toBe('pending');
    expect(restartCount).toBe(1);
    const governance = registry.reserveGovernance('viral-analysis', id);
    governance.release();
  });

  it('does not abort an active viral runtime for a non-control status refresh', async () => {
    const id = 'viral-terminal-refresh';
    const registry = new HistoryActivityRegistry();
    const releaseRuntime = deferred<void>();
    const running = new Map<string, {
      activityReservation: { release(): void } | null;
      completion: Promise<void>;
      controller: AbortController;
    }>();
    const record = { ...viralRecord(id), status: 'running', errorMessage: '' };
    let run!: (typeof running extends Map<string, infer T> ? T : never);
    run = {
      activityReservation: registry.reserveActive('viral-analysis', id),
      controller: new AbortController(),
      completion: releaseRuntime.promise.then(() => {
        if (running.get(id) === run) running.delete(id);
      }),
    };
    running.set(id, run);
    const resumeViralAnalysisRun = vi.fn(async () => false);
    const handlers = await loadViralControlHandlers({
      registry,
      running,
      database: {
        async getState() {
          return { viralAnalyses: [record] };
        },
        async updateViralAnalysis() {},
      },
      resumeViralAnalysisRun,
    });

    const refresh = handlers.updateStatus({ id, status: 'completed' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const abortedDuringRefresh = run.controller.signal.aborted;
    releaseRuntime.resolve();
    await refresh;

    expect(abortedDuringRefresh).toBe(false);
    expect(resumeViralAnalysisRun).not.toHaveBeenCalled();
    run.activityReservation?.release();
    run.activityReservation = null;
  });

  it.each([
    { label: 'image provider', family: 'image-lab' as const },
    { label: 'voice provider', family: 'voice-lab' as const },
    { label: 'task artifact mutation', family: 'task' as const },
    { label: 'viral retry control', family: 'viral-analysis' as const },
  ])('waits for a deferred $label lease before closing the database', async ({ family }) => {
    const registry = new HistoryActivityRegistry();
    const reservation = registry.reserveActive(family, `shutdown-${family}`);
    const close = vi.fn(async () => undefined);
    const shutdownApplication = await loadShutdownApplication(registry, close);

    const shutdown = shutdownApplication();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(close).not.toHaveBeenCalled();
    expect(() => registry.reserveGovernance(family, `shutdown-late-${family}`)).toThrow(/closed|shutdown/i);
    reservation.release();
    await shutdown;
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('does not throw when an app delta races a destroyed renderer window', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const compiledSource = transpileModule(
      extractFunctionSource(main, 'function publishAppDelta', 'function enqueueAppDelta'),
      {
        compilerOptions: {
          target: ScriptTarget.ES2022,
          module: ModuleKind.None,
        },
      },
    ).outputText;
    const FunctionConstructor = Function;
    const factory = new FunctionConstructor(
      'appRevision',
      'appDeltaHistory',
      'appDeltaHistoryLimit',
      'mainWindow',
      `${compiledSource}\nreturn publishAppDelta;`,
    ) as (
      revision: number,
      history: unknown[],
      limit: number,
      mainWindow: unknown,
    ) => (payload: unknown) => unknown;
    const payload = { kind: 'task-upsert', task: { id: 'task-1' } };
    const destroyedSend = vi.fn(() => {
      throw new Error('Object has been destroyed');
    });

    const publishToDestroyedWindow = factory(0, [], 512, {
      isDestroyed: () => true,
      webContents: { isDestroyed: () => false, send: destroyedSend },
    });
    expect(() => publishToDestroyedWindow(payload)).not.toThrow();
    expect(destroyedSend).not.toHaveBeenCalled();

    const racedSend = vi.fn(() => {
      throw new Error('Object has been destroyed');
    });
    const publishDuringCloseRace = factory(0, [], 512, {
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, send: racedSend },
    });
    expect(() => publishDuringCloseRace(payload)).not.toThrow();
  });

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
    const owner = taskRun() as unknown as TaskRunIntentState & { completion: Promise<void> };
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
    const owner = taskRun() as unknown as TaskRunIntentState & { completion: Promise<void> };
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
    const reservation = { release: vi.fn() };
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
        reservation,
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
      expect(reservation.release).toHaveBeenCalledTimes(1);
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

interface OwnedTaskRun extends TaskRunIntentState, HistoryActivityReservationOwner {
  completion: Promise<void>;
}

function seedLatestActivityReservation(
  requests: Map<string, symbol>,
  id: string,
  activityReservation: { release(): void },
): void {
  const states = requests as unknown as Map<string, {
    token: symbol;
    activityReservation: { release(): void } | null;
  }>;
  states.set(id, { token: Symbol(id), activityReservation });
}

interface TaskRunHandlerDependencies {
  runningTasks: Map<string, TaskRunIntentState>;
  historyActivityRegistry?: HistoryActivityRegistry;
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
    workDir?: string,
    reservation?: { release(): void },
  ) => boolean;
}

interface StartOwnedTaskRunDependencies {
  runningTasks: Map<string, OwnedTaskRun>;
  applyTaskRunIntent: (
    database: unknown,
    taskId: string,
    intent: 'paused' | 'cancelled' | 'restart',
  ) => Promise<unknown>;
  startTaskRun: (
    database: unknown,
    task: { id: string },
    workDir: string,
    reservation: { release(): void },
  ) => boolean;
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
    'takeHistoryActivityReservation',
    'publishTaskUpsert',
    `${compiledSource}\nreturn startOwnedTaskRun;`,
  );
  const compiled = factory(
    false,
    dependencies.runningTasks,
    finalizeTaskRunIntent,
    dependencies.applyTaskRunIntent,
    dependencies.startTaskRun,
    takeHistoryActivityReservation,
    async () => undefined,
  ) as (
    database: unknown,
    task: { id: string },
    workDir: string,
    activityReservation: { release(): void },
    label: string,
    execute: (controller: AbortController) => Promise<void>,
  ) => boolean;

  return (
    database: unknown,
    task: { id: string },
    activityReservation: { release(): void },
    label: string,
    execute: (controller: AbortController) => Promise<void>,
  ) => compiled(database, task, `work/${task.id}`, activityReservation, label, execute);
}

async function loadTaskRunHandlers(dependencies: TaskRunHandlerDependencies) {
  const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
  const latestTaskControlRequests = new Map<string, symbol>();
  const historyActivityRegistry = dependencies.historyActivityRegistry ?? {
    reserveActive: () => ({ release: vi.fn() }),
  };
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
    'workDir',
    'isShuttingDown',
    'runningTasks',
    'requestTaskRunIntent',
    'shouldStart',
    'transferReservation',
    'startTaskRun',
    resumeTaskRunBody,
  );
  const resumeTaskRun = (
    database: unknown,
    task: { id: string },
    workDir: string,
    shouldStart: () => boolean = () => true,
    transferReservation?: () => { release(): void },
  ) => compiledResumeTaskRun(
    database,
    task,
    workDir,
    false,
    dependencies.runningTasks,
    requestTaskRunIntent,
    shouldStart,
    transferReservation,
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
    'workDir',
    'isCurrent',
    'transferReservation',
    'resumeTaskRun',
    resumeLatestTaskRunBody,
  );
  const resumeLatestTaskRun = (
    database: unknown,
    taskId: string,
    workDir: string,
    isCurrent: () => boolean,
    transferReservation: () => { release(): void },
  ) => compiledResumeLatestTaskRun(database, taskId, workDir, isCurrent, transferReservation, resumeTaskRun);
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
    'publishTaskUpsert',
    'historyActivityRegistry',
    'takeHistoryActivityReservation',
    'taskWorkDir',
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
    'publishTaskUpsert',
    'historyActivityRegistry',
    'taskWorkDir',
    extractHandlerBody(main, 'task:retry'),
  );
  const actualLatestRequestRunner = Reflect.get(taskRunLifecycle, 'runLatestTaskControlRequest');
  const runLatestTaskControlRequest = typeof actualLatestRequestRunner === 'function'
    ? actualLatestRequestRunner
    : async <T>(
      requests: Map<string, symbol>,
      taskId: string,
      operation: (
        isCurrent: () => boolean,
        transferReservation: () => { release(): void },
      ) => Promise<T>,
      activityReservation?: { release(): void },
    ): Promise<T> => {
      const token = Symbol(taskId);
      requests.set(taskId, token);
      const isCurrent = () => requests.get(taskId) === token;
      let ownedReservation = activityReservation;
      const transferReservation = () => {
        if (!ownedReservation) throw new Error('Reservation is unavailable.');
        const transferred = ownedReservation;
        ownedReservation = undefined;
        return transferred;
      };
      try {
        return await operation(isCurrent, transferReservation);
      } finally {
        if (isCurrent()) requests.delete(taskId);
        ownedReservation?.release();
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
    'historyActivityRegistry',
    'takeHistoryActivityReservation',
    'stopTaskRunBeforeArtifactMutation',
    'resumeTaskRun',
    'resumeLatestTaskRun',
    'taskWorkDir',
    'publishTaskEvent',
    'publishTaskUpsert',
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
    historyActivityRegistry,
    takeHistoryActivityReservation,
    async (_readOwner: () => TaskRunIntentState | undefined, isCurrent: () => boolean) => isCurrent(),
    resumeTaskRun,
    resumeLatestTaskRun,
    (task: { id: string }) => `work/${task.id}`,
    async () => undefined,
    async () => null,
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
        async () => undefined,
        historyActivityRegistry,
        takeHistoryActivityReservation,
        (task: { id: string }) => `work/${task.id}`,
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
        async () => undefined,
        historyActivityRegistry,
        (task: { id: string }) => `work/${task.id}`,
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

interface ViralRunHarnessDependencies {
  runViralAnalysis: () => Promise<{
    resultPath: string;
    videoPath: string;
    result: { source: { title: string } };
  }>;
  updateViralAnalysis: (id: string, patch: Record<string, unknown>) => Promise<void>;
}

interface ViralControlHarnessDependencies {
  registry: HistoryActivityRegistry;
  running: Map<string, {
    activityReservation: { release(): void } | null;
    completion: Promise<void>;
    controller: AbortController;
  }>;
  database: {
    getState(): Promise<{ viralAnalyses: Array<ReturnType<typeof viralRecord> & { errorMessage: string }> }>;
    updateViralAnalysis(id: string, patch: Record<string, unknown>): Promise<void>;
  };
  resumeViralAnalysisRun(
    database: ViralControlHarnessDependencies['database'],
    record: ReturnType<typeof viralRecord>,
  ): Promise<boolean>;
}

async function loadViralControlHandlers(dependencies: ViralControlHarnessDependencies) {
  const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
  const AsyncFunction = Object.getPrototypeOf(async function noop() {}).constructor as new (
    ...args: string[]
  ) => (...args: unknown[]) => Promise<unknown>;
  const dependencyNames = [
    'runningViralAnalyses',
    'latestViralControlRequests',
    'runLatestTaskControlRequest',
    'historyActivityRegistry',
    'takeHistoryActivityReservation',
    'getDb',
    'viralAnalysisWorkDir',
    'resumeViralAnalysisRun',
    'publishViralUpsert',
  ];
  const latestViralControlRequests = new Map<string, unknown>();
  const dependencyValues = [
    dependencies.running,
    latestViralControlRequests,
    runLatestTaskControlRequest,
    dependencies.registry,
    takeHistoryActivityReservation,
    async () => dependencies.database,
    () => 'work/viral',
    dependencies.resumeViralAnalysisRun,
    async () => null,
  ];
  const updateStatus = new AsyncFunction(
    '_event',
    'input',
    ...dependencyNames,
    extractHandlerBody(main, 'viral:update-status'),
  );
  const retry = new AsyncFunction(
    '_event',
    'id',
    ...dependencyNames,
    extractHandlerBody(main, 'viral:retry'),
  );

  return {
    updateStatus: (input: {
      id: string;
      status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
    }) =>
      updateStatus(undefined, input, ...dependencyValues),
    retry: (id: string) => retry(undefined, id, ...dependencyValues),
  };
}

async function loadShutdownApplication(
  registry: HistoryActivityRegistry,
  close: () => Promise<void>,
): Promise<() => Promise<void>> {
  const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
  const FunctionConstructor = Function as unknown as new (
    ...args: string[]
  ) => (...args: unknown[]) => unknown;
  const compiledSource = transpileModule(
    extractFunctionSource(main, 'async function shutdownApplication', 'if (isPrimaryInstance)'),
    {
      compilerOptions: {
        target: ScriptTarget.ES2022,
        module: ModuleKind.None,
      },
    },
  ).outputText;
  const factory = new FunctionConstructor(
    'isShuttingDown',
    'acceptingAppDeltas',
    'runningTasks',
    'runningViralAnalyses',
    'historyActivityRegistry',
    'deltaPublishQueue',
    'db',
    'configService',
    `${compiledSource}\nreturn shutdownApplication;`,
  );
  return factory(
    false,
    true,
    new Map(),
    new Map(),
    registry,
    Promise.resolve(),
    { close },
    null,
  ) as () => Promise<void>;
}

async function loadViralRunHarness(dependencies: ViralRunHarnessDependencies) {
  const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
  const running = new Map<string, {
    activityReservation: { release(): void } | null;
    completion: Promise<void>;
    controller: AbortController;
  }>();
  const database = {
    addViralAnalysisEvent: async () => undefined,
    updateViralAnalysis: dependencies.updateViralAnalysis,
  };
  const FunctionConstructor = Function as unknown as new (
    ...args: string[]
  ) => (...args: unknown[]) => unknown;
  const compiledSource = transpileModule(
    extractFunctionSource(main, 'function startViralAnalysisRun', 'async function resumeViralAnalysisRun'),
    {
      compilerOptions: {
        target: ScriptTarget.ES2022,
        module: ModuleKind.None,
      },
    },
  ).outputText;
  const factory = new FunctionConstructor(
    'isShuttingDown',
    'runningViralAnalyses',
    'getConfigService',
    'publishViralUpsert',
    'runViralAnalysis',
    'createViralRuntimeProviders',
    `${compiledSource}\nreturn startViralAnalysisRun;`,
  );
  const start = factory(
    false,
    running,
    async () => ({ getRuntimeConfig: async () => ({}) }),
    async () => undefined,
    dependencies.runViralAnalysis,
    () => ({}),
  ) as (
    database: unknown,
    record: ReturnType<typeof viralRecord>,
    workDir: string,
    reservation: { release(): void },
  ) => boolean;
  return { database, running, start };
}

function viralRecord(id: string) {
  return {
    id,
    title: 'Viral record',
    status: 'pending',
    currentStage: 'queued',
    progress: 0,
  };
}

interface LabHandlerSpec {
  channel: string;
  family: 'image-lab' | 'voice-lab';
  generatorName: string;
  workDirName: string;
  summaryName: string;
}

interface LabHandlerDependencies {
  registry: HistoryActivityRegistry;
  database: ReturnType<typeof labDatabase>;
  generate: () => Promise<Record<string, unknown>>;
}

async function loadLabGenerateHandler(
  spec: LabHandlerSpec,
  dependencies: LabHandlerDependencies,
) {
  const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
  const FunctionConstructor = Function as unknown as new (
    ...args: string[]
  ) => (...args: unknown[]) => unknown;
  const compiledSource = transpileModule(
    `async function labGenerateHandler(_event, input) {${extractHandlerBody(main, spec.channel)}\n}`,
    {
      compilerOptions: {
        target: ScriptTarget.ES2022,
        module: ModuleKind.None,
      },
    },
  ).outputText;
  const factory = new FunctionConstructor(
    'randomUUID',
    'historyActivityRegistry',
    'getDb',
    'getConfigService',
    spec.generatorName,
    spec.workDirName,
    'publishStatePatch',
    spec.summaryName,
    `${compiledSource}\nreturn labGenerateHandler;`,
  );
  const compiled = factory(
    () => 'generated-id',
    dependencies.registry,
    async () => dependencies.database,
    async () => ({ getRuntimeConfig: async () => ({}) }),
    dependencies.generate,
    () => 'work/managed-key',
    async () => null,
    (record: Record<string, unknown>) => record,
  ) as (_event: unknown, input: Record<string, unknown>) => Promise<unknown>;
  return (input: Record<string, unknown>) => compiled(undefined, input);
}

function labDatabase(
  onTerminalUpdate: (patch: Record<string, unknown>) => Promise<void>,
) {
  let record: Record<string, unknown> = {};
  return {
    async addImageLabRecord(input: Record<string, unknown>) {
      record = { ...input, managedStorageKey: 'managed-key' };
      return record;
    },
    async addVoiceLabRecord(input: Record<string, unknown>) {
      record = { ...input, managedStorageKey: 'managed-key' };
      return record;
    },
    async updateImageLabRecord(_id: string, patch: Record<string, unknown>) {
      await onTerminalUpdate(patch);
      record = { ...record, ...patch };
      return record;
    },
    async updateVoiceLabRecord(_id: string, patch: Record<string, unknown>) {
      await onTerminalUpdate(patch);
      record = { ...record, ...patch };
      return record;
    },
  };
}

async function loadCreatedRunHandler(
  channel: string,
  registry: HistoryActivityRegistry,
  startFailure: Error | null,
) {
  const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
  const FunctionConstructor = Function as unknown as new (
    ...args: string[]
  ) => (...args: unknown[]) => unknown;
  const compiledSource = transpileModule(
    `async function createdRunHandler(_event, input) {${extractHandlerBody(main, channel)}\n}`,
    {
      compilerOptions: {
        target: ScriptTarget.ES2022,
        module: ModuleKind.None,
      },
    },
  ).outputText;
  const factory = new FunctionConstructor(
    'getDb',
    'historyActivityRegistry',
    'taskWorkDir',
    'publishTaskUpsert',
    'startTaskRun',
    'viralAnalysisWorkDir',
    'publishViralUpsert',
    'startViralAnalysisRun',
    'detectViralPlatform',
    'readFile',
    'createViralProductionTaskInput',
    `${compiledSource}\nreturn createdRunHandler;`,
  );
  const database = {
    async createTask() {
      return { id: 'created-task', managedStorageKey: 'task-key' };
    },
    async createViralAnalysis() {
      return { id: 'created-viral', managedStorageKey: 'viral-key' };
    },
    async getState() {
      return {
        viralAnalyses: [{ id: 'source-viral', resultPath: 'source.json' }],
      };
    },
  };
  const start = () => {
    if (startFailure) throw startFailure;
    return false;
  };
  const compiled = factory(
    async () => database,
    registry,
    () => 'work/task',
    async () => null,
    start,
    () => 'work/viral',
    async () => null,
    start,
    () => 'unknown',
    async () => '{}',
    () => ({ inputText: 'production task' }),
  ) as (_event: unknown, input: Record<string, unknown>) => Promise<unknown>;
  return (input: Record<string, unknown>) => compiled(undefined, input);
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

function taskRun(): TaskRunIntentState & HistoryActivityReservationOwner {
  return {
    activityReservation: { release: vi.fn() },
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
