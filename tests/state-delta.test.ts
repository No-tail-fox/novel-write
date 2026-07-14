import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigService } from '../electron/config-service';
import { defaultConfig, defaultPromptTemplates } from '@shared/config';
import { createAppDeltaCoordinator, type DeltaViewState } from '@shared/state-delta';
import * as reconciliationModule from '@shared/state-reconciliation';
import {
  mergeBootstrapTemplateDetails,
  mergeReconciliationSlices,
  taskDetailRefreshKey,
  taskSummaryToTask,
  viralSummaryToRecord,
  viralEventRefreshKey,
} from '@shared/state-reconciliation';
import { FileDatabase } from '@shared/storage';
import { draftTemplates as builtinDraftTemplates } from '@shared/templates';
import type {
  AppDelta,
  AppDeltaReconcileResult,
  AppMutationResult,
  DraftTemplate,
  ImageLabSummary,
  PromptTemplate,
  TaskSummary,
  ViralAnalysisSummary,
} from '@shared/types';

function taskSummary(id: string, status: TaskSummary['status'] = 'pending'): TaskSummary {
  return {
    id,
    title: id,
    inputPreview: 'preview',
    taskKind: 'story',
    processingMode: 'full-auto',
    publishMode: 'review-rewrite',
    status,
    currentStep: 0,
    track: 'character-story',
    style: 'photo-real',
    speaker: 'voice',
    ratio: '9:16',
    templateId: 'default-portrait-9-16',
    bgmId: '',
    outputDir: '',
    errorMessage: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    startedAt: null,
    lastHeartbeatAt: null,
    mode: 'paste',
    aiKeyword: '',
    promptTemplateId: null,
    promptTemplateType: null,
    referenceImagePath: '',
    rewriteIntensity: 'standard',
    narrativePov: 'keep-original',
    keepPromotion: false,
    ttsProvider: 'mock',
    ttsSpeed: 1,
    failedStep: null,
    retryFromStep: null,
    artifactStatePath: '',
  };
}

function viewState(revision: number, tasks: TaskSummary[] = []): DeltaViewState {
  return { revision, tasks, events: [], viralAnalyses: [] };
}

function viralSummary(id: string, progress = 0): ViralAnalysisSummary {
  return {
    id,
    url: `https://example.com/${id}`,
    platform: 'douyin',
    title: id,
    status: progress >= 1 ? 'completed' : 'running',
    currentStage: progress >= 1 ? 'completed' : 'downloading',
    progress,
    errorMessage: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: null,
    completedAt: null,
    lastHeartbeatAt: null,
  };
}

function mutationState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    config: defaultConfig,
    secretStatus: {},
    tasks: [],
    viralAnalyses: [],
    promptTemplates: [],
    customStyles: [],
    draftTemplates: [],
    imageLabRecords: [],
    voiceLabRecords: [],
    account: {},
    activation: {},
    ui: {},
    ...overrides,
  };
}

describe('app state delta coordination', () => {
  it('consumes every cursor page without duplicating summaries', async () => {
    const collectCursorPages = (reconciliationModule as unknown as {
      collectCursorPages?: <T>(
        first: { items: T[]; nextCursor: string | null },
        load: (cursor: string) => Promise<{ items: T[]; nextCursor: string | null }>,
      ) => Promise<T[]>;
    }).collectCursorPages;
    const pages = new Map([
      ['page-2', { items: Array.from({ length: 50 }, (_, index) => ({ id: `item-${index + 51}` })), nextCursor: 'page-3' }],
      ['page-3', { items: [{ id: 'item-101' }, { id: 'item-100' }], nextCursor: null }],
    ]);

    const items = await collectCursorPages?.(
      { items: Array.from({ length: 50 }, (_, index) => ({ id: `item-${index + 1}` })), nextCursor: 'page-2' },
      async (cursor) => pages.get(cursor) ?? { items: [], nextCursor: null },
    );

    expect(items).toHaveLength(101);
    expect(new Set(items?.map((item) => item.id)).size).toBe(101);
  });

  it('buffers deltas registered before bootstrap and replays them by revision', () => {
    const coordinator = createAppDeltaCoordinator(() => undefined);
    coordinator.receive({ kind: 'task-upsert', task: taskSummary('task-1', 'running'), revision: 2 });

    expect(coordinator.current()).toBeNull();
    coordinator.bootstrap(viewState(1, [taskSummary('task-1')]));

    expect(coordinator.current()).toMatchObject({
      revision: 2,
      tasks: [{ id: 'task-1', status: 'running' }],
    });
  });

  it('ignores stale revisions and merges sequenced events once in ascending order', () => {
    const coordinator = createAppDeltaCoordinator(() => undefined);
    coordinator.bootstrap(viewState(3, [taskSummary('task-1', 'running')]));
    coordinator.receive({
      kind: 'task-event',
      revision: 4,
      event: { seq: 12, taskId: 'task-1', type: 'tick', step: 1, agent: null, tool: null, detail: 'new', dataJson: null, ts: 12 },
    });
    coordinator.receive({
      kind: 'task-event',
      revision: 4,
      event: { seq: 12, taskId: 'task-1', type: 'tick', step: 1, agent: null, tool: null, detail: 'duplicate', dataJson: null, ts: 12 },
    });
    coordinator.receive({ kind: 'task-upsert', task: taskSummary('task-1', 'pending'), revision: 2 });
    coordinator.receive({
      kind: 'task-event',
      revision: 5,
      event: { seq: 11, taskId: 'task-1', type: 'tick', step: 1, agent: null, tool: null, detail: 'older seq', dataJson: null, ts: 11 },
    });

    expect(coordinator.current()?.events.map((event) => event.seq)).toEqual([11, 12]);
    expect(coordinator.current()?.tasks[0].status).toBe('running');
  });

  it('retains detail-loaded event history across task-only delta views', () => {
    type DeltaSlices = {
      tasks: ReturnType<typeof taskSummaryToTask>[];
      events: Array<{ seq: number; taskId: string; type: string; detail: string; ts: number }>;
      viralAnalyses: ReturnType<typeof viralSummaryToRecord>[];
    };
    const mergeDeltaViewSlices = (reconciliationModule as unknown as {
      mergeDeltaViewSlices?: (current: DeltaSlices, incoming: DeltaViewState) => DeltaSlices;
    }).mergeDeltaViewSlices;
    const history = Array.from({ length: 100 }, (_, index) => ({
      seq: index + 1,
      taskId: 'task-1',
      type: 'history',
      detail: `history-${index + 1}`,
      ts: index + 1,
    }));
    const current: DeltaSlices = {
      tasks: [taskSummaryToTask(taskSummary('task-1', 'running'))],
      events: history,
      viralAnalyses: [],
    };

    const merged = mergeDeltaViewSlices?.(current, viewState(7, [taskSummary('task-1', 'completed')]));

    expect(merged?.tasks[0].status).toBe('completed');
    expect(merged?.events).toEqual(history);
  });

  it('bounds merged renderer task events to the latest 512 unique sequences', () => {
    type DeltaSlices = {
      tasks: ReturnType<typeof taskSummaryToTask>[];
      events: Array<{ seq: number; taskId: string; type: string; detail: string; ts: number }>;
      viralAnalyses: ReturnType<typeof viralSummaryToRecord>[];
    };
    const mergeDeltaViewSlices = (reconciliationModule as unknown as {
      mergeDeltaViewSlices?: (current: DeltaSlices, incoming: DeltaViewState) => DeltaSlices;
    }).mergeDeltaViewSlices;
    const history = Array.from({ length: 520 }, (_, index) => ({
      seq: index + 1,
      taskId: 'task-1',
      type: 'history',
      detail: `history-${index + 1}`,
      ts: index + 1,
    }));
    const incomingEvent = {
      seq: 521,
      taskId: 'task-1',
      type: 'live',
      step: null,
      agent: null,
      tool: null,
      detail: 'live-521',
      dataJson: null,
      ts: 521,
    };

    const merged = mergeDeltaViewSlices?.(
      { tasks: [taskSummaryToTask(taskSummary('task-1'))], events: history, viralAnalyses: [] },
      { ...viewState(521, [taskSummary('task-1')]), events: [incomingEvent] },
    );

    expect(merged?.events).toHaveLength(512);
    expect(merged?.events[0].seq).toBe(10);
    expect(merged?.events.at(-1)?.seq).toBe(521);
  });

  it('holds out-of-order deltas until a gap is replayed and reports each independent gap once', () => {
    const gaps: Array<{ expectedRevision: number; receivedRevision: number }> = [];
    const coordinator = createAppDeltaCoordinator((gap) => gaps.push(gap));
    coordinator.bootstrap({ ...viewState(5, [taskSummary('task-existing')]), viralAnalyses: [viralSummary('viral-existing')] });

    coordinator.receive({ kind: 'task-upsert', task: taskSummary('task-late', 'completed'), revision: 8 });
    coordinator.receive({ kind: 'viral-upsert', record: viralSummary('viral-late', 1), revision: 9 });

    expect(coordinator.current()?.revision).toBe(5);
    expect(coordinator.current()?.tasks.some((task) => task.id === 'task-late')).toBe(false);
    expect(coordinator.current()?.viralAnalyses.some((record) => record.id === 'viral-late')).toBe(false);
    expect(gaps).toEqual([{ expectedRevision: 6, receivedRevision: 8 }]);

    coordinator.receive({ kind: 'task-upsert', task: taskSummary('task-replayed', 'running'), revision: 6 });
    coordinator.receive({ kind: 'viral-upsert', record: viralSummary('viral-replayed', 0.5), revision: 7 });

    expect(coordinator.current()?.revision).toBe(9);
    expect(coordinator.current()?.tasks.map((task) => task.id)).toEqual(expect.arrayContaining(['task-late', 'task-replayed']));
    expect(coordinator.current()?.viralAnalyses.map((record) => record.id)).toEqual(expect.arrayContaining(['viral-late', 'viral-replayed']));

    coordinator.receive({ kind: 'task-upsert', task: taskSummary('task-next-gap'), revision: 12 });
    coordinator.receive({ kind: 'task-event', event: { seq: 10, taskId: 'task-existing', type: 'ten', step: null, agent: null, tool: null, detail: 'ten', dataJson: null, ts: 10 }, revision: 10 });
    coordinator.receive({ kind: 'task-event', event: { seq: 11, taskId: 'task-existing', type: 'eleven', step: null, agent: null, tool: null, detail: 'eleven', dataJson: null, ts: 11 }, revision: 11 });

    expect(coordinator.current()?.revision).toBe(12);
    expect(coordinator.current()?.tasks.some((task) => task.id === 'task-next-gap')).toBe(true);
    expect(gaps).toEqual([
      { expectedRevision: 6, receivedRevision: 8 },
      { expectedRevision: 10, receivedRevision: 12 },
    ]);
  });

  it('keeps future deltas buffered when reconciliation bootstraps before their missing revision', () => {
    const gaps: Array<{ expectedRevision: number; receivedRevision: number }> = [];
    const coordinator = createAppDeltaCoordinator((gap) => gaps.push(gap));
    coordinator.bootstrap(viewState(5));

    coordinator.receive({ kind: 'task-upsert', task: taskSummary('task-revision-8'), revision: 8 });
    coordinator.receive({ kind: 'task-upsert', task: taskSummary('task-revision-10', 'running'), revision: 10 });
    coordinator.receive({ kind: 'viral-upsert', record: viralSummary('viral-revision-11', 1), revision: 11 });

    coordinator.bootstrap(viewState(8, [taskSummary('task-revision-8')]));

    expect(coordinator.current()?.revision).toBe(8);
    expect(gaps).toEqual([
      { expectedRevision: 6, receivedRevision: 8 },
      { expectedRevision: 9, receivedRevision: 10 },
    ]);

    coordinator.receive({ kind: 'task-upsert', task: taskSummary('task-revision-9', 'completed'), revision: 9 });

    expect(coordinator.current()?.revision).toBe(11);
    expect(coordinator.current()?.tasks.map((task) => task.id)).toEqual(expect.arrayContaining([
      'task-revision-8',
      'task-revision-9',
      'task-revision-10',
    ]));
    expect(coordinator.current()?.viralAnalyses.map((record) => record.id)).toContain('viral-revision-11');
  });

  it('drains buffered future deltas when reconciliation bootstraps through the missing revision', () => {
    const gaps: Array<{ expectedRevision: number; receivedRevision: number }> = [];
    const coordinator = createAppDeltaCoordinator((gap) => gaps.push(gap));
    coordinator.bootstrap(viewState(5));

    coordinator.receive({ kind: 'task-upsert', task: taskSummary('task-revision-8'), revision: 8 });
    coordinator.receive({ kind: 'task-upsert', task: taskSummary('task-revision-10', 'running'), revision: 10 });
    coordinator.receive({ kind: 'viral-upsert', record: viralSummary('viral-revision-11', 1), revision: 11 });

    coordinator.bootstrap(viewState(9, [taskSummary('task-revision-9')]));

    expect(coordinator.current()?.revision).toBe(11);
    expect(coordinator.current()?.tasks.map((task) => task.id)).toEqual(expect.arrayContaining([
      'task-revision-9',
      'task-revision-10',
    ]));
    expect(coordinator.current()?.viralAnalyses.map((record) => record.id)).toContain('viral-revision-11');
    expect(gaps).toEqual([{ expectedRevision: 6, receivedRevision: 8 }]);
  });

  it('forces one reset when pending or out-of-order delta buffers exceed 512 entries', () => {
    const pendingResets: number[] = [];
    const pending = createAppDeltaCoordinator(() => undefined, () => pendingResets.push(1));
    for (let revision = 1; revision <= 513; revision += 1) {
      pending.receive({ kind: 'task-upsert', task: taskSummary(`pending-${revision}`), revision });
    }
    expect(pendingResets).toEqual([1]);
    pending.bootstrap(viewState(513));
    expect(pending.current()?.tasks).toEqual([]);

    const outOfOrderResets: number[] = [];
    const outOfOrder = createAppDeltaCoordinator(() => undefined, () => outOfOrderResets.push(1));
    outOfOrder.bootstrap(viewState(1));
    for (let revision = 3; revision <= 515; revision += 1) {
      outOfOrder.receive({ kind: 'task-upsert', task: taskSummary(`future-${revision}`), revision });
    }
    expect(outOfOrderResets).toEqual([1]);
    expect(outOfOrder.current()?.revision).toBe(1);
  });

  it('replays live task events buffered while an authoritative reset bootstrap is loading', () => {
    const coordinator = createAppDeltaCoordinator(() => undefined);
    coordinator.bootstrap(viewState(1, [taskSummary('task-1', 'running')]));
    const resetCapable = coordinator as typeof coordinator & {
      beginReset?: () => void;
      reset?: (state: DeltaViewState) => DeltaViewState;
    };

    resetCapable.beginReset?.();
    coordinator.receive({
      kind: 'task-event',
      revision: 5,
      event: { seq: 99, taskId: 'task-1', type: 'live', step: 4, agent: null, tool: null, detail: 'preview ready', dataJson: null, ts: 99 },
    });
    const reset = resetCapable.reset?.(viewState(5, [taskSummary('task-1', 'completed')]));

    expect(reset?.revision).toBe(5);
    expect(reset?.events.map((event) => event.seq)).toEqual([99]);
  });

  it('invalidates older detail requests for the same entity without affecting other ids', () => {
    const createRequestGenerationGuard = (reconciliationModule as unknown as {
      createRequestGenerationGuard?: () => {
        begin: (id: string) => number;
        isCurrent: (id: string, generation: number) => boolean;
      };
    }).createRequestGenerationGuard;
    const guard = createRequestGenerationGuard?.();
    const first = guard?.begin('html-1') ?? 0;
    const other = guard?.begin('html-2') ?? 0;
    const second = guard?.begin('html-1') ?? 0;

    expect(guard?.isCurrent('html-1', first)).toBe(false);
    expect(guard?.isCurrent('html-1', second)).toBe(true);
    expect(guard?.isCurrent('html-2', other)).toBe(true);
  });

  it('ignores an older revisioned mutation response for the same state slice', () => {
    const applyAppMutationResult = (reconciliationModule as unknown as {
      applyAppMutationResult?: (
        state: Record<string, unknown>,
        result: { revision: number; patch: Record<string, unknown> },
        revisions: Map<string, number>,
      ) => Record<string, unknown>;
    }).applyAppMutationResult;
    const revisions = new Map<string, number>();
    const initial = { config: { marker: 'initial' }, ui: { marker: 'initial' } };
    const newest = applyAppMutationResult?.(initial, {
      revision: 2,
      patch: { kind: 'config', config: { marker: 'new' }, secretStatus: {} },
    }, revisions);
    const stale = applyAppMutationResult?.(newest ?? initial, {
      revision: 1,
      patch: { kind: 'config', config: { marker: 'old' }, secretStatus: {} },
    }, revisions);
    const otherSlice = applyAppMutationResult?.(stale ?? initial, {
      revision: 1,
      patch: { kind: 'ui', ui: { marker: 'ui-new' } },
    }, revisions);

    expect(stale?.config).toEqual({ marker: 'new' });
    expect(otherSlice?.ui).toEqual({ marker: 'ui-new' });
  });

  it('replays a state patch received while the initial bootstrap snapshot is installing', () => {
    const helpers = reconciliationModule as unknown as {
      applyBufferedMutationResults?: (
        state: Record<string, unknown>,
        results: Iterable<AppMutationResult>,
        snapshotRevision: number,
        revisions: Map<string, number>,
      ) => Record<string, unknown>;
      raiseMutationRevisionFloor?: (revisions: Map<string, number>, revision: number) => void;
    };
    expect(typeof helpers.applyBufferedMutationResults).toBe('function');
    expect(typeof helpers.raiseMutationRevisionFloor).toBe('function');
    if (!helpers.applyBufferedMutationResults || !helpers.raiseMutationRevisionFloor) return;

    const coordinator = createAppDeltaCoordinator(() => undefined);
    const liveConfig = { ...defaultConfig, llm: { ...defaultConfig.llm, model: 'live-revision-11' } };
    const patch: AppMutationResult = {
      kind: 'state-patch',
      revision: 11,
      patch: { kind: 'config', config: liveConfig, secretStatus: { 'llm/@active/apiKey': true } },
    };
    const buffered = new Map<number, AppMutationResult>();
    buffered.set(patch.revision, patch);
    coordinator.receive(patch);

    const replayed = coordinator.bootstrap(viewState(10));
    const revisions = new Map<string, number>();
    const installed = helpers.applyBufferedMutationResults(
      mutationState({ config: { ...defaultConfig, llm: { ...defaultConfig.llm, model: 'snapshot-revision-10' } } }),
      buffered.values(),
      10,
      revisions,
    );
    helpers.raiseMutationRevisionFloor(revisions, replayed.revision);

    expect(replayed.revision).toBe(11);
    expect((installed.config as typeof defaultConfig).llm.model).toBe('live-revision-11');
    expect(installed.secretStatus).toEqual({ 'llm/@active/apiKey': true });
    expect(revisions.get('config')).toBe(11);
  });

  it('replays template and lab patches received while an authoritative reset is installing', () => {
    const helpers = reconciliationModule as unknown as {
      applyBufferedMutationResults?: (
        state: Record<string, unknown>,
        results: Iterable<AppMutationResult>,
        snapshotRevision: number,
        revisions: Map<string, number>,
      ) => Record<string, unknown>;
      raiseMutationRevisionFloor?: (revisions: Map<string, number>, revision: number) => void;
    };
    expect(typeof helpers.applyBufferedMutationResults).toBe('function');
    expect(typeof helpers.raiseMutationRevisionFloor).toBe('function');
    if (!helpers.applyBufferedMutationResults || !helpers.raiseMutationRevisionFloor) return;

    const prompt: PromptTemplate = {
      ...defaultPromptTemplates[0],
      id: 'live-prompt-revision-11',
      name: 'Live prompt',
      content: 'live prompt detail',
      updatedAt: '2026-01-02T00:00:00.000Z',
    };
    const image: ImageLabSummary = {
      id: 'live-image-revision-12',
      promptPreview: 'live image prompt',
      ratio: '9:16',
      style: 'photo-real',
      provider: 'mock',
      imagePath: 'live.png',
      status: 'generated',
      errorMessage: '',
      resolution: '1K',
      smartMode: 'text-to-image',
      upstreamTaskId: null,
      createdAt: '2026-01-02T00:00:00.000Z',
      finishedAt: '2026-01-02T00:00:01.000Z',
    };
    const promptPatch: AppMutationResult = {
      kind: 'state-patch',
      revision: 11,
      patch: { kind: 'prompt-template-upsert', template: prompt },
    };
    const imagePatch: AppMutationResult = {
      kind: 'state-patch',
      revision: 12,
      patch: { kind: 'image-lab-upsert', record: image },
    };
    const buffered = new Map<number, AppMutationResult>([
      [imagePatch.revision, imagePatch],
      [promptPatch.revision, promptPatch],
    ]);
    const coordinator = createAppDeltaCoordinator(() => undefined);
    coordinator.bootstrap(viewState(10));
    coordinator.beginReset();
    coordinator.receive(promptPatch);
    coordinator.receive(imagePatch);

    const replayed = coordinator.reset(viewState(10));
    const revisions = new Map<string, number>();
    const installed = helpers.applyBufferedMutationResults(mutationState(), buffered.values(), 10, revisions);
    helpers.raiseMutationRevisionFloor(revisions, replayed.revision);

    expect(replayed.revision).toBe(12);
    expect(installed.promptTemplates).toEqual([prompt]);
    expect(installed.imageLabRecords).toEqual([expect.objectContaining({ id: image.id, prompt: image.promptPreview })]);
    expect(revisions.get('promptTemplates')).toBe(12);
    expect(revisions.get('imageLabRecords')).toBe(12);
  });

  it('raises every mutation slice floor when an authoritative snapshot is installed', () => {
    const helpers = reconciliationModule as unknown as {
      applyAppMutationResult?: (
        state: Record<string, unknown>,
        result: AppMutationResult,
        revisions: Map<string, number>,
      ) => Record<string, unknown>;
      mutationRevisionSlices?: readonly string[];
      raiseMutationRevisionFloor?: (revisions: Map<string, number>, revision: number) => void;
    };
    expect(typeof helpers.applyAppMutationResult).toBe('function');
    expect(typeof helpers.raiseMutationRevisionFloor).toBe('function');
    expect(helpers.mutationRevisionSlices).toEqual(expect.arrayContaining([
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
    ]));
    if (!helpers.applyAppMutationResult || !helpers.raiseMutationRevisionFloor || !helpers.mutationRevisionSlices) return;

    const revisions = new Map<string, number>([['config', 12]]);
    helpers.raiseMutationRevisionFloor(revisions, 10);
    const snapshotConfig = { ...defaultConfig, llm: { ...defaultConfig.llm, model: 'snapshot-revision-10' } };
    const staleConfig = { ...defaultConfig, llm: { ...defaultConfig.llm, model: 'stale-response-revision-9' } };
    const installed = mutationState({ config: snapshotConfig });
    const staleResult = helpers.applyAppMutationResult(installed, {
      kind: 'state-patch',
      revision: 9,
      patch: { kind: 'config', config: staleConfig, secretStatus: {} },
    }, revisions);

    expect((staleResult.config as typeof defaultConfig).llm.model).toBe('snapshot-revision-10');
    expect(revisions.get('config')).toBe(12);
    for (const slice of helpers.mutationRevisionSlices) {
      expect(revisions.get(slice), slice).toBeGreaterThanOrEqual(10);
    }
  });

  it('lets deltas exclusively own Electron mutation state while browser fallback applies responses', () => {
    const helpers = reconciliationModule as unknown as {
      applyAppMutationResult?: (
        state: Record<string, unknown>,
        result: AppMutationResult,
        revisions: Map<string, number>,
      ) => Record<string, unknown>;
      applyLocalMutationResponse?: (
        state: Record<string, unknown>,
        result: AppMutationResult,
        revisions: Map<string, number>,
        browserFallback: boolean,
      ) => Record<string, unknown>;
      raiseMutationRevisionFloor?: (revisions: Map<string, number>, revision: number) => void;
    };
    expect(typeof helpers.applyAppMutationResult).toBe('function');
    expect(typeof helpers.applyLocalMutationResponse).toBe('function');
    expect(typeof helpers.raiseMutationRevisionFloor).toBe('function');
    if (!helpers.applyAppMutationResult || !helpers.applyLocalMutationResponse || !helpers.raiseMutationRevisionFloor) return;

    const snapshotConfig = { ...defaultConfig, llm: { ...defaultConfig.llm, model: 'snapshot-revision-10' } };
    const liveConfig = { ...defaultConfig, llm: { ...defaultConfig.llm, model: 'delta-revision-11' } };
    const mutation: AppMutationResult = {
      kind: 'state-patch',
      revision: 11,
      patch: { kind: 'config', config: liveConfig, secretStatus: {} },
    };

    const earlyRevisions = new Map<string, number>();
    const beforeBootstrap = mutationState({ config: defaultConfig });
    const ignoredEarlyResponse = helpers.applyLocalMutationResponse(beforeBootstrap, mutation, earlyRevisions, false);
    expect(ignoredEarlyResponse).toBe(beforeBootstrap);
    expect(earlyRevisions.size).toBe(0);
    helpers.raiseMutationRevisionFloor(earlyRevisions, 10);
    const earlyDeltaApplied = helpers.applyAppMutationResult(mutationState({ config: snapshotConfig }), mutation, earlyRevisions);
    expect((earlyDeltaApplied.config as typeof defaultConfig).llm.model).toBe('delta-revision-11');

    const lateRevisions = new Map<string, number>();
    helpers.raiseMutationRevisionFloor(lateRevisions, 10);
    const installedSnapshot = mutationState({ config: snapshotConfig });
    const ignoredLateResponse = helpers.applyLocalMutationResponse(installedSnapshot, mutation, lateRevisions, false);
    expect(ignoredLateResponse).toBe(installedSnapshot);
    expect(lateRevisions.get('config')).toBe(10);
    const lateDeltaApplied = helpers.applyAppMutationResult(ignoredLateResponse, mutation, lateRevisions);
    expect((lateDeltaApplied.config as typeof defaultConfig).llm.model).toBe('delta-revision-11');

    const browserRevisions = new Map<string, number>();
    const browserApplied = helpers.applyLocalMutationResponse(
      mutationState({ config: snapshotConfig }),
      mutation,
      browserRevisions,
      true,
    );
    expect((browserApplied.config as typeof defaultConfig).llm.model).toBe('delta-revision-11');
    expect(browserRevisions.get('config')).toBe(11);
  });

  it('replays authoritative buffered patches identically when a React updater is invoked twice', () => {
    const helpers = reconciliationModule as unknown as {
      applyBufferedMutationResults?: (
        state: Record<string, unknown>,
        results: Iterable<AppMutationResult>,
        snapshotRevision: number,
        revisions: Map<string, number>,
      ) => Record<string, unknown>;
      raiseMutationRevisionFloor?: (revisions: Map<string, number>, revision: number) => void;
    };
    expect(typeof helpers.applyBufferedMutationResults).toBe('function');
    expect(typeof helpers.raiseMutationRevisionFloor).toBe('function');
    if (!helpers.applyBufferedMutationResults || !helpers.raiseMutationRevisionFloor) return;

    const snapshotConfig = { ...defaultConfig, llm: { ...defaultConfig.llm, model: 'snapshot-revision-10' } };
    const liveConfig = { ...defaultConfig, llm: { ...defaultConfig.llm, model: 'buffered-revision-11' } };
    const patch: AppMutationResult = {
      kind: 'state-patch',
      revision: 11,
      patch: { kind: 'config', config: liveConfig, secretStatus: {} },
    };
    const sharedRevisions = new Map<string, number>();
    helpers.raiseMutationRevisionFloor(sharedRevisions, 10);
    const replayRevisionFloor = new Map(sharedRevisions);
    helpers.raiseMutationRevisionFloor(sharedRevisions, 11);
    const updater = (state: Record<string, unknown>) => {
      const localMutationRevisions = new Map(replayRevisionFloor);
      return helpers.applyBufferedMutationResults?.(state, [patch], 10, localMutationRevisions) ?? state;
    };
    const snapshot = mutationState({ config: snapshotConfig });

    const first = updater(snapshot);
    const second = updater(snapshot);

    expect(first).toEqual(second);
    expect((first.config as typeof defaultConfig).llm.model).toBe('buffered-revision-11');
    expect((second.config as typeof defaultConfig).llm.model).toBe('buffered-revision-11');
    expect(sharedRevisions.get('config')).toBe(11);
  });

  it('claims a live state patch once before a pure updater is invoked twice', () => {
    const helpers = reconciliationModule as unknown as {
      applyAppMutationResult?: (
        state: Record<string, unknown>,
        result: AppMutationResult,
        revisions: Map<string, number>,
      ) => Record<string, unknown>;
      claimMutationResult?: (
        result: AppMutationResult,
        revisions: Map<string, number>,
      ) => Map<string, number> | null;
    };
    expect(typeof helpers.applyAppMutationResult).toBe('function');
    expect(typeof helpers.claimMutationResult).toBe('function');
    if (!helpers.applyAppMutationResult || !helpers.claimMutationResult) return;

    const liveConfig = { ...defaultConfig, llm: { ...defaultConfig.llm, model: 'live-patch-revision-11' } };
    const patch: AppMutationResult = {
      kind: 'state-patch',
      revision: 11,
      patch: { kind: 'config', config: liveConfig, secretStatus: {} },
    };
    const sharedRevisions = new Map<string, number>([['config', 10]]);
    const claimedPreFloor = helpers.claimMutationResult(patch, sharedRevisions);
    expect(claimedPreFloor?.get('config')).toBe(10);
    expect(sharedRevisions.get('config')).toBe(11);
    expect(helpers.claimMutationResult(patch, sharedRevisions)).toBeNull();
    if (!claimedPreFloor) return;
    const updater = (state: Record<string, unknown>) => helpers.applyAppMutationResult?.(
      state,
      patch,
      new Map(claimedPreFloor),
    ) ?? state;
    const snapshot = mutationState({ config: defaultConfig });

    const first = updater(snapshot);
    const second = updater(snapshot);

    expect(first).toEqual(second);
    expect((first.config as typeof defaultConfig).llm.model).toBe('live-patch-revision-11');
    expect((second.config as typeof defaultConfig).llm.model).toBe('live-patch-revision-11');
    expect(sharedRevisions.get('config')).toBe(11);
  });

  it('claims a browser fallback response once before a pure updater is invoked twice', () => {
    const helpers = reconciliationModule as unknown as {
      applyLocalMutationResponse?: (
        state: Record<string, unknown>,
        result: AppMutationResult,
        revisions: Map<string, number>,
        browserFallback: boolean,
      ) => Record<string, unknown>;
      claimMutationResult?: (
        result: AppMutationResult,
        revisions: Map<string, number>,
      ) => Map<string, number> | null;
    };
    expect(typeof helpers.applyLocalMutationResponse).toBe('function');
    expect(typeof helpers.claimMutationResult).toBe('function');
    if (!helpers.applyLocalMutationResponse || !helpers.claimMutationResult) return;

    const liveConfig = { ...defaultConfig, llm: { ...defaultConfig.llm, model: 'browser-response-revision-12' } };
    const response: AppMutationResult = {
      kind: 'state-patch',
      revision: 12,
      patch: { kind: 'config', config: liveConfig, secretStatus: {} },
    };
    const sharedRevisions = new Map<string, number>([['config', 11]]);
    const claimedPreFloor = helpers.claimMutationResult(response, sharedRevisions);
    expect(claimedPreFloor?.get('config')).toBe(11);
    expect(sharedRevisions.get('config')).toBe(12);
    expect(helpers.claimMutationResult(response, sharedRevisions)).toBeNull();
    if (!claimedPreFloor) return;
    const updater = (state: Record<string, unknown>) => helpers.applyLocalMutationResponse?.(
      state,
      response,
      new Map(claimedPreFloor),
      true,
    ) ?? state;
    const snapshot = mutationState({ config: defaultConfig });

    const first = updater(snapshot);
    const second = updater(snapshot);

    expect(first).toEqual(second);
    expect((first.config as typeof defaultConfig).llm.model).toBe('browser-response-revision-12');
    expect((second.config as typeof defaultConfig).llm.model).toBe('browser-response-revision-12');
    expect(sharedRevisions.get('config')).toBe(12);
  });

  it('builds bootstrap state without prompt bodies, all events, or provider secrets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-bootstrap-'));
    const database = await FileDatabase.open(join(dir, 'app.db'));
    try {
      await database.upsertConfig({ ...defaultConfig, llm: { ...defaultConfig.llm, apiKey: 'database-secret' } });
      await database.upsertPromptTemplate({
        id: 'private-template',
        name: 'Private template',
        type: 'task',
        content: 'prompt-body-must-be-lazy',
      });
      const task = await database.createTask({
        title: 'Task',
        inputText: `${'preview '.repeat(30)}full-input-tail-must-be-lazy`,
        track: 'story',
        style: 'photo-real',
        speaker: 'voice',
      });
      await database.addTaskEvent(task.id, { type: 'private', detail: 'event-detail-must-be-lazy' });
      await database.createViralAnalysis({
        url: 'https://example.com/private',
        settings: { track: 'story', style: 'photo-real', ratio: '9:16', templateId: 'default-portrait-9-16', extraRequirements: 'viral-heavy-must-be-lazy' },
      });
      await database.addImageLabRecord({ prompt: `${'image '.repeat(100)}image-heavy-tail-must-be-lazy`, ratio: '9:16', style: 'photo-real', provider: 'mock' });
      await database.addVoiceLabRecord({ text: `${'voice '.repeat(100)}voice-heavy-tail-must-be-lazy`, provider: 'mock', voiceId: 'voice', speed: 1 });
      const service = new ConfigService({
        database,
        dataDir: dir,
        vault: {
          load: async () => ({ 'llm/@active/apiKey': 'vault-secret' }),
          save: async () => undefined,
        },
      });

      const bootstrap = await service.getBootstrapState(17);
      const serialized = JSON.stringify(bootstrap);

      expect(bootstrap.revision).toBe(17);
      expect(serialized).not.toContain('prompt-body-must-be-lazy');
      expect(serialized).not.toContain('event-detail-must-be-lazy');
      expect(serialized).not.toContain('viral-heavy-must-be-lazy');
      expect(serialized).not.toContain('image-heavy-tail-must-be-lazy');
      expect(serialized).not.toContain('voice-heavy-tail-must-be-lazy');
      expect(bootstrap.tasks.items[0].inputPreview.length).toBeLessThanOrEqual(160);
      expect(serialized).not.toContain('full-input-tail-must-be-lazy');
      expect(serialized).not.toContain('database-secret');
      expect(serialized).not.toContain('vault-secret');
    } finally {
      await database.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('merges reset reconciliation details and latest task and viral events into bootstrap slices', () => {
    const htmlSummary = { ...taskSummary('html-task', 'running'), taskType: 'html-video', lastHeartbeatAt: '2026-01-01T00:00:01.000Z' };
    const placeholder = taskSummaryToTask(htmlSummary);
    const detail = {
      ...placeholder,
      status: 'pending' as const,
      inputText: 'full html source',
      pipelineData: JSON.stringify({ version: 2, current: 'preview', scenes: [{ index: 1 }], assets: [{ src: 'asset.png' }], voices: [{ src: 'voice.wav' }], output: { path: 'final.mp4' } }),
    };
    const currentViral = viralSummaryToRecord(viralSummary('viral-active', 0.75));
    const result: AppDeltaReconcileResult = {
      revision: 50,
      deltas: [],
      resetRequired: true,
      task: detail,
      taskEvents: [{ seq: 205, taskId: detail.id, type: 'checkpoint', step: 4, agent: null, tool: null, detail: 'preview ready', dataJson: null, ts: 205 }],
      viralAnalysis: { ...currentViral, progress: 1, status: 'completed', currentStage: 'completed' },
      viralEvents: [{ seq: 305, analysisId: currentViral.id, type: 'completed', stage: 'completed', detail: 'viral ready', dataJson: null, ts: 305 }],
    };

    const merged = mergeReconciliationSlices({
      tasks: [placeholder],
      events: [],
      viralAnalyses: [currentViral],
      viralEvents: [],
    }, result);

    expect(merged.tasks[0].status).toBe('running');
    expect(merged.tasks[0].pipelineData).toContain('final.mp4');
    expect(merged.events.map((event) => event.seq)).toEqual([205]);
    expect(merged.viralAnalyses[0]).toMatchObject({ id: 'viral-active', progress: 0.75 });
    expect(merged.viralEvents.map((event) => event.seq)).toEqual([305]);
  });

  it('preserves loaded prompt and draft details while accepting same-version reset summary metadata', () => {
    type TemplateState = {
      source: 'current' | 'reset';
      promptTemplates: PromptTemplate[];
      draftTemplates: DraftTemplate[];
    };
    const currentPrompt: PromptTemplate = {
      ...defaultPromptTemplates[0],
      id: 'custom-prompt',
      name: 'Loaded prompt',
      description: 'old summary',
      content: 'private prompt body',
      isBuiltin: false,
      updatedAt: '2026-01-01T00:00:00.000Z',
      stepPrompts: { rewrite: 'loaded rewrite prompt' },
      imageSeedPoolsJson: '{"portrait":["seed-a"]}',
    };
    const resetPrompt: PromptTemplate = {
      ...currentPrompt,
      name: 'Renamed prompt',
      description: 'new summary',
      updatedAt: currentPrompt.updatedAt,
      content: '',
      stepPrompts: undefined,
      imageSeedPoolsJson: undefined,
    };
    const newPrompt: PromptTemplate = {
      ...resetPrompt,
      id: 'new-prompt',
      name: 'New prompt placeholder',
    };
    const currentDraft: DraftTemplate = structuredClone(builtinDraftTemplates[0]);
    currentDraft.id = 'custom-draft';
    currentDraft.name = 'Loaded draft';
    currentDraft.isDefault = false;
    currentDraft.updatedAt = '2026-01-01T00:00:00.000Z';
    currentDraft.canvas.backgroundColor = '#123456';
    currentDraft.canvas.backgroundImage = 'loaded-background.png';
    currentDraft.title.color = '#abcdef';
    currentDraft.image.animation = 'loaded-animation';
    currentDraft.audio.transitionType = 'loaded-transition';
    const resetDraft: DraftTemplate = structuredClone(builtinDraftTemplates[0]);
    resetDraft.id = currentDraft.id;
    resetDraft.name = 'Renamed draft';
    resetDraft.isDefault = true;
    resetDraft.updatedAt = currentDraft.updatedAt;
    resetDraft.canvas.width = 1920;
    resetDraft.canvas.height = 1080;
    resetDraft.canvas.ratio = '16:9';
    const newDraft: DraftTemplate = structuredClone(builtinDraftTemplates[0]);
    newDraft.id = 'new-draft';
    newDraft.name = 'New draft placeholder';

    const currentState: TemplateState = {
      source: 'current',
      promptTemplates: [currentPrompt],
      draftTemplates: [currentDraft],
    };
    const resetState: TemplateState = {
      source: 'reset',
      promptTemplates: [resetPrompt, newPrompt],
      draftTemplates: [resetDraft, newDraft],
    };
    const merged = mergeBootstrapTemplateDetails(currentState, resetState);

    expect(merged.source).toBe('reset');
    expect(merged.promptTemplates[0]).toMatchObject({
      id: 'custom-prompt',
      name: 'Renamed prompt',
      description: 'new summary',
      updatedAt: '2026-01-01T00:00:00.000Z',
      content: 'private prompt body',
      stepPrompts: { rewrite: 'loaded rewrite prompt' },
      imageSeedPoolsJson: '{"portrait":["seed-a"]}',
    });
    expect(merged.draftTemplates[0]).toMatchObject({
      id: 'custom-draft',
      name: 'Renamed draft',
      isDefault: true,
      canvas: {
        width: 1920,
        height: 1080,
        ratio: '16:9',
        backgroundColor: '#123456',
        backgroundImage: 'loaded-background.png',
      },
      title: { color: '#abcdef' },
      image: { animation: 'loaded-animation' },
      audio: { transitionType: 'loaded-transition' },
    });
    expect(merged.promptTemplates[1]).toEqual(newPrompt);
    expect(merged.draftTemplates[1]).toEqual(newDraft);
  });

  it('invalidates loaded prompt and draft details when reset summary versions change', () => {
    const currentPrompt: PromptTemplate = {
      ...defaultPromptTemplates[0],
      id: 'versioned-prompt',
      content: 'stale private prompt body',
      updatedAt: '2026-01-01T00:00:00.000Z',
      stepPrompts: { rewrite: 'stale rewrite prompt' },
      imageSeedPoolsJson: '{"portrait":["stale-seed"]}',
    };
    const resetPrompt: PromptTemplate = {
      ...currentPrompt,
      name: 'Updated prompt summary',
      content: '',
      updatedAt: '2026-01-02T00:00:00.000Z',
      stepPrompts: undefined,
      imageSeedPoolsJson: undefined,
    };
    const currentDraft: DraftTemplate = structuredClone(builtinDraftTemplates[0]);
    currentDraft.id = 'versioned-draft';
    currentDraft.updatedAt = '2026-01-01T00:00:00.000Z';
    currentDraft.canvas.backgroundColor = '#123456';
    currentDraft.canvas.backgroundImage = 'stale-background.png';
    const resetDraft: DraftTemplate = structuredClone(builtinDraftTemplates[0]);
    resetDraft.id = currentDraft.id;
    resetDraft.name = 'Updated draft summary';
    resetDraft.updatedAt = '2026-01-02T00:00:00.000Z';

    const merged = mergeBootstrapTemplateDetails(
      { promptTemplates: [currentPrompt], draftTemplates: [currentDraft] },
      { promptTemplates: [resetPrompt], draftTemplates: [resetDraft] },
    );

    expect(merged.promptTemplates[0]).toEqual(resetPrompt);
    expect(merged.draftTemplates[0]).toEqual(resetDraft);
  });

  it('changes narrow detail refresh keys when HTML checkpoints or viral progress advance', () => {
    const html = taskSummaryToTask({ ...taskSummary('html-task', 'running'), taskType: 'html-video', lastHeartbeatAt: '2026-01-01T00:00:01.000Z' });
    expect(taskDetailRefreshKey({ ...html, pipelineData: '{"heavy":"ignored"}' })).toBe(taskDetailRefreshKey(html));
    expect(taskDetailRefreshKey({ ...html, lastHeartbeatAt: '2026-01-01T00:00:02.000Z' })).not.toBe(taskDetailRefreshKey(html));

    const viral = viralSummary('viral-active', 0.25);
    expect(viralEventRefreshKey({ ...viral, progress: 0.5 })).not.toBe(viralEventRefreshKey(viral));
  });
});
