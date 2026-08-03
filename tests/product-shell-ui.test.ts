import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as reconciliationModule from '../src/shared/state-reconciliation';
import type { AppMutationResult, BootstrapState } from '../src/shared/types';
import { readRendererSources } from './helpers/renderer-source';
import * as rendererSourceHelpers from './helpers/renderer-source';

const rendererSourcesPromise = readRendererSources();
const appStateSourcePromise = readFile(new URL('../src/app/app-state.ts', import.meta.url), 'utf8');
const browserFallbackSourcePromise = readFile(new URL('../src/app/browser-fallback.ts', import.meta.url), 'utf8');
const navigationSourcePromise = readFile(new URL('../src/app/navigation.ts', import.meta.url), 'utf8');
const editorialOptionsSourcePromise = readFile(new URL('../src/shared/editorial-options.ts', import.meta.url), 'utf8');

function stripModuleExports(source: string): string {
  return source.replace(/^export\s+/gmu, '');
}

describe('product shell ui', () => {
  it('loads query-safe task history pages without creating another global delta owner', async () => {
    const sources = await rendererSourcesPromise;
    const main = sources.requiredFile('src/app/App.tsx');
    const routes = sources.requiredFile('src/app/AppRoutes.tsx');
    const pagination = sources.requiredFile('src/components/CursorPagination.tsx');
    const hook = await readFile(new URL('../src/features/history/use-history-page.ts', import.meta.url), 'utf8');
    const history = sources.requiredFile('src/features/tasks/HistoryPage.tsx');
    const appState = await appStateSourcePromise;
    const bootstrap = appState.slice(appState.indexOf('export async function loadCompleteBootstrap'), appState.indexOf('export function cloneState'));
    const app = main;
    const install = app.slice(app.indexOf('const installAuthoritativeSnapshot'), app.indexOf('const recoverSnapshotInstallation'));

    expect(history).toContain("from '../history/use-history-page'");
    expect(main).toContain('isHistoryTombstoned');
    expect(main).toContain('historyFamilyEpochs');
    expect(main).not.toContain('historyTombstoneEpochs');
    expect(history).toContain('familyEpoch');
    expect(history).not.toContain('tombstoneEpoch');
    expect(app).toContain('historyFamilyEpochs={historyFamilyEpochs}');
    expect(routes).toContain('familyEpochs={historyFamilyEpochs}');
    expect(routes).toContain('applyState={applyState}');
    expect(history).toContain('familyEpoch: familyEpochs[family] ?? 0');
    expect(history).toContain('useHistoryPage');
    expect(history).toContain('api.listTasks');
    expect(history).toContain('historyPage.previous');
    expect(history).toContain('historyPage.next');
    expect(history).toContain('historyPage.reload');
    expect(history).toContain('const historyBusy = historyAction.busy || historyPage.loading;');
    expect(history).toContain('disabled={historyBusy || Boolean(pendingDelete)}');
    expect(history).toContain('busy={historyBusy}');
    expect(history).toContain('disabled={historyBusy}');
    expect(history).not.toContain('disabled={historyAction.busy}');
    expect(history).toContain('hasNext={Boolean(historyPage.page?.nextCursor)}');
    expect(pagination).toContain('disabled={busy || !hasNext}');
    expect(history).toContain('className="table-row clickable" key={record.id} role="row"');
    expect(history).toContain('className="table-row" key={record.id} role="row"');
    expect(history).toContain('className="table-row-primary-action"');
    expect(history).toContain('aria-label={`打开任务 ${row.title}`}');
    expect(history).toContain('event.stopPropagation(); openTaskDetail(record.id);');
    expect(history).not.toContain('!historyPage.page || historyPage.page.nextCursor === null');
    expect(history).not.toContain('state.tasks.filter');
    expect(hook).toContain('store.begin(');
    expect(hook).toContain('store.accept(');
    expect(hook).toContain('createHistoryPageRequestController');
    expect(hook).toContain('useLayoutEffect');
    expect(hook).toContain('useSyncExternalStore');
    expect(hook).toContain('useSyncExternalStore(controller.subscribe, controller.current, controller.current)');
    expect(hook).not.toContain('forceRender');
    expect(hook).not.toContain('controller.subscribe(()');
    expect(hook).toContain('controller.activate(');
    expect(hook).toContain('isTombstoned');
    expect(hook).not.toContain('onAppDelta');
    expect(hook).not.toContain('getBootstrap');
    expect(hook).not.toContain('reconcileDeltas');
    expect(hook).toContain('familyEpoch?: number');
    expect(hook).not.toContain('tombstoneEpoch');
    expect(install).toContain('refreshHistoryFamilies(allHistoryFamilies)');
    expect(countOccurrences(app, 'api.onAppDelta(')).toBe(1);
    for (const property of ['tasks', 'viralAnalyses', 'imageLabRecords', 'voiceLabRecords']) {
      expect(bootstrap).not.toContain(`collectCursorPages(bootstrap.${property}`);
    }
  });

  it('exposes persisted task favorites as a history filter and per-row command', async () => {
    const history = (await rendererSourcesPromise).requiredFile('src/features/tasks/HistoryPage.tsx');
    const css = await readFile(new URL('../src/styles/features/task-operations.css', import.meta.url), 'utf8');

    expect(history).toContain("const [favoriteFilter, setFavoriteFilter] = useState<'all' | 'favorites'>('all')");
    expect(history).toContain("favorite: favoriteFilter === 'favorites' ? true : undefined");
    expect(history).toContain('api.setTaskFavorite(task.id, !task.isFavorite)');
    expect(history).toContain('toggleTaskFavorite');
    expect(history).toContain('全部任务');
    expect(history).toContain('收藏任务');
    expect(history).toContain('取消收藏');
    expect(history).toContain('添加收藏');
    expect(history).toContain('<Star');
    expect(css).toContain('.task-history-action.favorite-action');
  });

  it('advances family generations for accepted history identities and snapshots', async () => {
    const appState = await appStateSourcePromise;
    const source = stripModuleExports(appState.slice(appState.indexOf('type HistoryDeltaIdentity'), appState.indexOf('export function mergeDefaultCustomStyles')));
    expect(source).toContain('function advanceHistoryFamilyEpochs');
    expect(source).toContain('const allHistoryFamilies');
    if (!source.includes('function advanceHistoryFamilyEpochs') || !source.includes('const allHistoryFamilies')) return;

    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const helpers = new Function(
      'historyEntityRevisionKey',
      `${compiled}\nreturn { advanceHistoryFamilyEpochs, allHistoryFamilies, registerHistoryDeltaBarrier };`,
    )((family: string, id: string) => `history:${family}:${id}`) as {
      advanceHistoryFamilyEpochs(
        current: Partial<Record<string, number>>,
        families: readonly string[],
      ): Partial<Record<string, number>>;
      allHistoryFamilies: readonly string[];
      registerHistoryDeltaBarrier(
        entities: Map<string, number>,
        tombstones: Map<string, number>,
        delta: AppMutationResult,
        invalidate: (family: string, id: string) => void,
        accepted: (family: string) => void,
      ): void;
    };
    const entities = new Map<string, number>();
    const tombstones = new Map<string, number>();
    const invalidated: string[] = [];
    const accepted: string[] = [];
    let epochs: Partial<Record<string, number>> = {};
    const register = (delta: AppMutationResult) => helpers.registerHistoryDeltaBarrier(
      entities,
      tombstones,
      delta,
      (family, id) => invalidated.push(`${family}:${id}`),
      (family) => {
        accepted.push(family);
        epochs = helpers.advanceHistoryFamilyEpochs(epochs, [family]);
      },
    );

    const taskUpsert = { kind: 'task-upsert', task: { id: 'task-epoch' }, revision: 5 } as AppMutationResult;
    register(taskUpsert);
    expect(epochs).toEqual({ task: 1 });
    expect(invalidated).toEqual([]);
    const acceptedTaskEpoch = epochs;
    register(taskUpsert);
    register({ ...taskUpsert, revision: 4 });
    expect(epochs).toBe(acceptedTaskEpoch);
    expect(accepted).toEqual(['task']);

    register({ kind: 'task-tombstone', id: 'task-epoch', revision: 6 } as AppMutationResult);
    register({ kind: 'viral-upsert', record: { id: 'viral-epoch' }, revision: 7 } as AppMutationResult);
    register({
      kind: 'state-patch',
      patch: { kind: 'image-lab-upsert', record: { id: 'image-epoch' } },
      revision: 8,
    } as AppMutationResult);
    register({
      kind: 'state-patch',
      patch: { kind: 'voice-lab-upsert', record: { id: 'voice-epoch' } },
      revision: 9,
    } as AppMutationResult);
    expect(epochs).toEqual({ task: 2, 'viral-analysis': 1, 'image-lab': 1, 'voice-lab': 1 });
    expect(accepted).toEqual(['task', 'task', 'viral-analysis', 'image-lab', 'voice-lab']);
    expect(invalidated).toEqual(['task:task-epoch']);

    expect(helpers.allHistoryFamilies).toEqual(['task', 'viral-analysis', 'image-lab', 'voice-lab']);
    const forced = helpers.advanceHistoryFamilyEpochs(epochs, helpers.allHistoryFamilies);
    expect(forced).toEqual({ task: 3, 'viral-analysis': 2, 'image-lab': 2, 'voice-lab': 2 });

    epochs = forced;
    const beforePostSnapshotUpsert = epochs;
    const postSnapshotUpsert = {
      kind: 'task-upsert',
      task: { id: 'task-after-snapshot' },
      revision: forced.task,
    } as AppMutationResult;
    register(postSnapshotUpsert);
    expect(epochs).not.toBe(beforePostSnapshotUpsert);
    expect(epochs.task).toBeGreaterThan(beforePostSnapshotUpsert.task ?? 0);
    const afterPostSnapshotUpsert = epochs;
    register(postSnapshotUpsert);
    register({ ...postSnapshotUpsert, revision: (postSnapshotUpsert.revision ?? 0) - 1 });
    expect(epochs).toBe(afterPostSnapshotUpsert);
  });

  it('accepts a same-revision tombstone only once', async () => {
    const appState = await appStateSourcePromise;
    const source = stripModuleExports(appState.slice(appState.indexOf('type HistoryDeltaIdentity'), appState.indexOf('export function mergeDefaultCustomStyles')));
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const helpers = new Function(
      'historyEntityRevisionKey',
      `${compiled}\nreturn { advanceHistoryFamilyEpochs, registerHistoryDeltaBarrier };`,
    )((family: string, id: string) => `history:${family}:${id}`) as {
      advanceHistoryFamilyEpochs(
        current: Partial<Record<string, number>>,
        families: readonly string[],
      ): Partial<Record<string, number>>;
      registerHistoryDeltaBarrier(
        entities: Map<string, number>,
        tombstones: Map<string, number>,
        delta: AppMutationResult,
        invalidate: (family: string, id: string) => void,
        accepted: (family: string) => void,
      ): void;
    };
    const entities = new Map<string, number>();
    const tombstones = new Map<string, number>();
    const invalidated: string[] = [];
    let epochs: Partial<Record<string, number>> = {};
    const register = (delta: AppMutationResult) => helpers.registerHistoryDeltaBarrier(
      entities,
      tombstones,
      delta,
      (family, id) => invalidated.push(`${family}:${id}`),
      (family) => {
        epochs = helpers.advanceHistoryFamilyEpochs(epochs, [family]);
      },
    );
    const upsert = { kind: 'task-upsert', task: { id: 'same-revision' }, revision: 5 } as AppMutationResult;
    const tombstone = { kind: 'task-tombstone', id: 'same-revision', revision: 5 } as AppMutationResult;

    register(upsert);
    const afterUpsert = epochs;
    register(tombstone);
    expect(invalidated).toEqual(['task:same-revision']);
    const afterTombstone = epochs;
    register(tombstone);

    expect(invalidated).toEqual(['task:same-revision']);
    expect(epochs).toBe(afterTombstone);
    expect(afterTombstone).not.toBe(afterUpsert);
    expect(afterTombstone.task).toBeGreaterThan(afterUpsert.task ?? 0);
  });

  it('owns history tombstone revisions in App and rejects late detail responses after deletion', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/app/App.tsx');
    const app = main;
    const taskRefresh = app.slice(app.indexOf('const refreshTaskDetail'), app.indexOf('const refreshViralEvents'));
    const viralRefresh = app.slice(app.indexOf('const refreshViralEvents'), app.indexOf('const onActiveHtmlTaskChange'));
    const incoming = app.slice(app.indexOf('const applyIncomingDelta'), app.indexOf('async function reconcile'));

    expect(app).toContain('historyEntityRevisionsRef');
    expect(app).toContain('historyTombstoneRevisionsRef');
    expect(taskRefresh).toMatch(/captureHistoryResponseRevision\(\s*'task',\s*taskId/u);
    expect(taskRefresh).toContain('historyResponseDisposition(responseRevision, currentRevision)');
    expect(taskRefresh).toContain("if (disposition === 'discard') return;");
    expect(taskRefresh).toContain('taskDetailGuard.finish(taskId, generation)');
    expect(viralRefresh).toMatch(/captureHistoryResponseRevision\(\s*'viral-analysis',\s*analysisId/u);
    expect(viralRefresh).toContain("isHistoryResponseCurrent('viral-analysis', analysisId");
    expect(viralRefresh).toContain('viralDetailGuard.finish(analysisId, generation)');
    const barriers = app.slice(app.indexOf('const applyHistoryEntityBarrier'), app.indexOf('const refreshTaskDetail'));
    expect(barriers).toContain('registerHistoryDeltaBarrier(');
    expect(barriers).toContain('applyHistorySelectionBarrier(');
    expect(barriers).toContain('taskDetailGuard.invalidate(id)');
    expect(barriers).toContain('viralDetailGuard.invalidate(id)');
    expect(barriers).toMatch(/registerHistoryDeltaBarrier\([\s\S]*?applyHistoryEntityBarrier,/u);
    expect(incoming).toContain('applyHistoryBarrier(delta)');
    expect(app).toContain('imageLabRecords: bootstrap.imageLabRecords.items');
    expect(app).toContain('voiceLabRecords: bootstrap.voiceLabRecords.items');
    expect(countOccurrences(app, 'api.onAppDelta(')).toBe(1);
  });

  it('invalidates a deferred detail response through the shared desktop and browser tombstone barrier', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/app/App.tsx');
    const appState = await appStateSourcePromise;
    const source = stripModuleExports(appState.slice(appState.indexOf('type HistoryDeltaIdentity'), appState.indexOf('export function mergeDefaultCustomStyles')));
    expect(source).toContain('function registerHistoryDeltaBarrier');
    if (!source.includes('function registerHistoryDeltaBarrier')) return;

    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const helpers = new Function(
      'historyEntityRevisionKey',
      `${compiled}\nreturn { captureHistoryResponseRevision, isHistoryResponseCurrent, registerHistoryDeltaBarrier };`,
    )((family: string, id: string) => `history:${family}:${id}`) as {
      captureHistoryResponseRevision(
        family: string,
        id: string,
        entities: Map<string, number>,
        tombstones: Map<string, number>,
      ): { entityRevision: number; tombstoneRevision: number };
      isHistoryResponseCurrent(
        family: string,
        id: string,
        captured: { entityRevision: number; tombstoneRevision: number },
        entities: Map<string, number>,
        tombstones: Map<string, number>,
      ): boolean;
      registerHistoryDeltaBarrier(
        entities: Map<string, number>,
        tombstones: Map<string, number>,
        delta: AppMutationResult,
        invalidate: (family: string, id: string) => void,
      ): void;
    };
    const entities = new Map<string, number>();
    const tombstones = new Map<string, number>();
    const stateHelpers = reconciliationModule as unknown as {
      applyAppMutationResult: (
        state: { tasks: Array<{ id: string }>; events: Array<{ taskId: string }>; [key: string]: unknown },
        result: AppMutationResult,
        revisions: Map<string, number>,
      ) => { tasks: Array<{ id: string }>; events: Array<{ taskId: string }>; [key: string]: unknown };
      applyHistorySelectionBarrier?: (
        state: {
          selectedTaskId: string | null;
          activeHtmlTaskId: string | null;
          activeViralAnalysisId: string | null;
          activeView: string;
        },
        family: string,
        id: string,
      ) => {
        selectedTaskId: string | null;
        activeHtmlTaskId: string | null;
        activeViralAnalysisId: string | null;
        activeView: string;
      };
    };
    expect(typeof stateHelpers.applyHistorySelectionBarrier).toBe('function');
    if (!stateHelpers.applyHistorySelectionBarrier) return;

    let selection: {
      selectedTaskId: string | null;
      activeHtmlTaskId: string | null;
      activeViralAnalysisId: string | null;
      activeView: string;
    } = {
      selectedTaskId: 'deferred-task',
      activeHtmlTaskId: 'deferred-task',
      activeViralAnalysisId: null,
      activeView: 'task-detail',
    };
    let rendered = {
      tasks: [{ id: 'deferred-task' }],
      events: [{ taskId: 'deferred-task' }],
      detail: null as { id: string } | null,
    };
    const captured = helpers.captureHistoryResponseRevision('task', 'deferred-task', entities, tombstones);
    let resolveDetail!: () => void;
    const deferredDetail = new Promise<void>((resolve) => { resolveDetail = resolve; }).then(() => {
      if (helpers.isHistoryResponseCurrent('task', 'deferred-task', captured, entities, tombstones)) {
        rendered = {
          tasks: [{ id: 'deferred-task' }],
          events: [{ taskId: 'deferred-task' }],
          detail: { id: 'deferred-task' },
        };
      }
    });
    const invalidated: string[] = [];
    const tombstone = { kind: 'task-tombstone', id: 'deferred-task', revision: 9 } as AppMutationResult;

    helpers.registerHistoryDeltaBarrier(
      entities,
      tombstones,
      tombstone,
      (family, id) => {
        invalidated.push(`${family}:${id}`);
        selection = stateHelpers.applyHistorySelectionBarrier!(selection, family, id);
      },
    );
    rendered = stateHelpers.applyAppMutationResult(rendered, tombstone, new Map()) as typeof rendered;
    resolveDetail();
    await deferredDetail;

    expect(invalidated).toEqual(['task:deferred-task']);
    expect(selection).toEqual({
      selectedTaskId: null,
      activeHtmlTaskId: null,
      activeViralAnalysisId: null,
      activeView: 'history',
    });
    expect(rendered).toEqual({ tasks: [], events: [], detail: null });

    const app = main;
    const incoming = app.slice(app.indexOf('const applyIncomingDelta'), app.indexOf('async function reconcile'));
    const browserApply = app.slice(app.indexOf('function applyState'), app.indexOf('async function openTaskDetail'));
    expect(incoming).toContain('applyHistoryBarrier(delta)');
    expect(browserApply).toContain('applyHistoryBarrier(next)');
    expect(browserApply.indexOf('applyHistoryBarrier(next)')).toBeLessThan(browserApply.indexOf('claimMutationResult(next'));
  });

  it('constructs fallback tombstones exhaustively without AppMutationResult casts', async () => {
    const source = await browserFallbackSourcePromise;

    expect(source).toContain('function fallbackTombstoneResult');
    expect(source).toContain("case 'task':");
    expect(source).toContain("case 'viral-analysis':");
    expect(source).toContain("case 'image-lab':");
    expect(source).toContain("case 'voice-lab':");
    expect(source).not.toContain('as AppMutationResult');
  });

  it('guards reconciliation details against tombstones delivered in the same response', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/app/App.tsx');
    const app = main;
    const reconcile = app.slice(app.indexOf('async function reconcile'), app.indexOf('const coordinator = createAppDeltaCoordinator'));

    expect(reconcile.indexOf('const taskResponseRevision =')).toBeLessThan(reconcile.indexOf('await api.reconcileDeltas'));
    expect(reconcile.indexOf('const viralResponseRevision =')).toBeLessThan(reconcile.indexOf('await api.reconcileDeltas'));
    expect(reconcile).toContain('const guardedResult =');
    expect(reconcile).toContain("isHistoryResponseCurrent('task'");
    expect(reconcile).toContain("isHistoryResponseCurrent('viral-analysis'");
    expect(reconcile).toContain('mergeReconciliationSlices(currentState, guardedResult)');
    expect(reconcile).not.toContain('mergeReconciliationSlices(currentState, result)');
  });

  it('merges coordinator revision ledgers without dropping a not-yet-contiguous tombstone barrier', async () => {
    const appState = await appStateSourcePromise;
    const helper = appState.slice(appState.indexOf('export function replaceHistoryRevisionMap'), appState.indexOf('export function captureHistoryResponseRevision'));

    expect(helper).not.toContain('target.clear()');
    expect(helper).toContain('Math.max(');
    expect(helper).toContain('target.set(');
  });

  it('persists real four-family browser governance and filters tombstoned ids from later local reads', async () => {
    const browserFallback = await browserFallbackSourcePromise;
    const fallback = browserFallback.slice(browserFallback.indexOf('export function makeFallbackApi'));

    expect(browserFallback).toContain("const fallbackGovernanceStorageKey = 'storydream-history-governance-v1'");
    expect(browserFallback).toContain('fallbackEnvelopeVersion');
    expect(fallback).toContain('readFallbackEnvelope()');
    expect(fallback).toContain('commitFallbackEnvelope(');
    expect(fallback).toContain('filterFallbackTombstones(');
    expect(fallback).not.toContain('writeFallbackGovernance(');
    expect(fallback).not.toContain('desktopHistoryGovernanceUnavailable');
    for (const method of [
      'archiveTask',
      'restoreTask',
      'deleteTaskPermanently',
      'archiveViralAnalysis',
      'restoreViralAnalysis',
      'deleteViralAnalysisPermanently',
      'archiveImageLabRecord',
      'restoreImageLabRecord',
      'deleteImageLabRecordPermanently',
      'archiveVoiceLabRecord',
      'restoreVoiceLabRecord',
      'deleteVoiceLabRecordPermanently',
    ]) {
      const start = fallback.indexOf(`async ${method}(`);
      expect(start, `${method} is implemented`).toBeGreaterThan(-1);
      const nextMethod = fallback.indexOf('\n    async ', start + 10);
      const section = fallback.slice(start, nextMethod === -1 ? fallback.length : nextMethod);
      expect(section, `${method} persists a local mutation`).toMatch(/archiveFallbackHistory|restoreFallbackHistory|deleteFallbackHistory/u);
    }
    expect(fallback).toContain("cleanupState: 'unmanaged-legacy'");
    expect(fallback).not.toMatch(/\brm\s*\(/u);
    expect(fallback).not.toMatch(/\bunlink\s*\(/u);
  });

  it('keeps browser tombstones durable across API recreation and blocks a late persisted task snapshot', async () => {
    const browserFallback = await browserFallbackSourcePromise;
    const source = stripModuleExports(browserFallback.slice(browserFallback.indexOf('type FallbackTombstoneEntry')));
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const storage = new Map<string, string>();
    const localStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    };
    const initial = {
      config: {},
      secretStatus: {},
      tasks: [{
        id: 'browser-task',
        title: 'Browser task',
        inputText: 'input',
        status: 'paused',
        archivedAt: null,
        outputDir: 'D:/external-do-not-delete',
      }],
      events: [{ taskId: 'browser-task', type: 'created', detail: '', ts: 1 }],
      viralAnalyses: [],
      viralEvents: [],
      promptTemplates: [],
      draftTemplates: [],
      imageLabRecords: [],
      voiceLabRecords: [],
      customStyles: [],
      customCoverTemplates: [],
      creditTransactions: [],
      minimaxCloneVoices: [],
      account: {},
      activation: {},
      ui: {},
    };
    storage.set('storydream-state', JSON.stringify(initial));
    const makeFallbackApi = new Function(
      'localStorage',
      'initialState',
      'cloneState',
      'hydrateState',
      'stripConfigSecrets',
      'taskToSummary',
      'loadDefaultPromptTemplates',
      `${compiled}\nreturn makeFallbackApi;`,
    )(
      localStorage,
      initial,
      (state: unknown) => structuredClone(state),
      (state: unknown) => structuredClone(state),
      (config: unknown) => config,
      (task: Record<string, unknown>) => ({ ...task, inputPreview: String(task.inputText ?? '') }),
      async () => [],
    ) as (setState: (state: typeof initial) => void) => {
      archiveTask(id: string): Promise<AppMutationResult>;
      deleteTaskPermanently(id: string): Promise<AppMutationResult>;
      getTaskDetail(id: string): Promise<Record<string, unknown> | null>;
      listTaskEvents(id: string): Promise<{ items: unknown[] }>;
      getBootstrap(): Promise<BootstrapState>;
    };

    const states: typeof initial[] = [];
    const firstApi = makeFallbackApi((state) => states.push(state));
    const archived = await firstApi.archiveTask('browser-task');
    const deleted = await firstApi.deleteTaskPermanently('browser-task');
    const duplicate = await firstApi.deleteTaskPermanently('browser-task');

    expect(archived).toMatchObject({ kind: 'task-upsert', revision: 1 });
    expect(deleted).toEqual({ kind: 'task-tombstone', id: 'browser-task', revision: 2 });
    expect(duplicate).toEqual(deleted);
    expect(states.at(-1)?.tasks).toEqual([]);
    expect(states.at(-1)?.events).toEqual([]);
    expect(JSON.parse(storage.get('storydream-history-governance-v1') ?? '{}')).toMatchObject({
      revision: 2,
      tombstones: { task: { 'browser-task': { revision: 2, cleanupState: 'unmanaged-legacy' } } },
    });

    storage.set('storydream-state', JSON.stringify(initial));
    const secondApi = makeFallbackApi(() => undefined);
    expect(await secondApi.getTaskDetail('browser-task')).toBeNull();
    expect((await secondApi.listTaskEvents('browser-task')).items).toEqual([]);
    expect((await secondApi.getBootstrap()).revision).toBe(2);
  });

  it.each([
    { name: 'archive', archivedAt: null, mode: 'governance' as const, action: 'archive' as const },
    { name: 'restore', archivedAt: '2026-01-01T00:00:00.000Z', mode: 'governance' as const, action: 'restore' as const },
    { name: 'ordinary saveUi', archivedAt: null, mode: 'governance' as const, action: 'save-ui' as const },
    { name: 'delete', archivedAt: '2026-01-01T00:00:00.000Z', mode: 'delete-state' as const, action: 'delete' as const },
  ])('keeps browser state, governance, and React unchanged when the $name commit fails', async ({ archivedAt, mode, action }) => {
    const browserFallback = await browserFallbackSourcePromise;
    const source = stripModuleExports(browserFallback.slice(browserFallback.indexOf('type FallbackTombstoneEntry')));
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const base = {
      config: {},
      secretStatus: {},
      tasks: [{
        id: 'atomic-task',
        title: 'Atomic task',
        inputText: 'input',
        status: 'paused',
        archivedAt: null as string | null,
        outputDir: 'D:/external-do-not-delete',
      }],
      events: [{ taskId: 'atomic-task', type: 'created', detail: '', ts: 1 }],
      viralAnalyses: [],
      viralEvents: [],
      promptTemplates: [],
      draftTemplates: [],
      imageLabRecords: [],
      voiceLabRecords: [],
      customStyles: [],
      customCoverTemplates: [],
      creditTransactions: [],
      minimaxCloneVoices: [],
      account: {},
      activation: {},
      ui: { activeView: 'new-task' },
    };
    type FallbackApi = {
      archiveTask(id: string): Promise<AppMutationResult>;
      restoreTask(id: string): Promise<AppMutationResult>;
      deleteTaskPermanently(id: string): Promise<AppMutationResult>;
      saveUiPreferences(ui: Record<string, unknown>): Promise<AppMutationResult | null>;
    };
    const createCase = (archivedAt: string | null, mode: 'governance' | 'delete-state') => {
      const initial = structuredClone({
        ...base,
        tasks: [{ ...base.tasks[0], archivedAt }],
      });
      const storage = new Map<string, string>([
        ['storydream-state', JSON.stringify(initial)],
        ['storydream-history-governance-v1', JSON.stringify({ revision: 0, tombstones: {} })],
      ]);
      let legacyLedgerWritten = false;
      const localStorage = {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (key === 'storydream-history-governance-v1') {
            const parsed = JSON.parse(value) as { version?: number };
            if (mode === 'governance' || parsed.version === 1) throw new Error('injected commit failure');
            storage.set(key, value);
            legacyLedgerWritten = true;
            return;
          }
          if (mode === 'delete-state' && key === 'storydream-state' && legacyLedgerWritten) {
            throw new Error('injected commit failure');
          }
          storage.set(key, value);
        },
        removeItem: (key: string) => storage.delete(key),
      };
      const makeFallbackApi = new Function(
        'localStorage',
        'initialState',
        'cloneState',
        'hydrateState',
        'stripConfigSecrets',
        'taskToSummary',
        'loadDefaultPromptTemplates',
        `${compiled}\nreturn makeFallbackApi;`,
      )(
        localStorage,
        initial,
        (state: unknown) => structuredClone(state),
        (state: unknown) => structuredClone(state),
        (config: unknown) => config,
        (task: Record<string, unknown>) => ({ ...task, inputPreview: String(task.inputText ?? '') }),
        async () => [],
      ) as (setState: (state: typeof initial) => void) => FallbackApi;
      const states: Array<typeof initial> = [];
      return {
        api: makeFallbackApi((state) => states.push(state)),
        before: [...storage.entries()],
        states,
        storage,
      };
    };

    const fixture = createCase(archivedAt, mode);
    const mutation = action === 'archive'
      ? fixture.api.archiveTask('atomic-task')
      : action === 'restore'
        ? fixture.api.restoreTask('atomic-task')
        : action === 'save-ui'
          ? fixture.api.saveUiPreferences({ activeView: 'history' })
          : fixture.api.deleteTaskPermanently('atomic-task');
    await expect(mutation).rejects.toThrow('injected commit failure');
    expect([...fixture.storage.entries()]).toEqual(fixture.before);
    expect(fixture.states).toEqual([]);
  });

  it('reads tracked renderer sources as an aggregate and by exact module', async () => {
    const renderer = await rendererSourcesPromise;
    const reachable = renderer.reachableFrom('src/main.tsx');

    expect(renderer.all).toContain('useAsyncAction');
    expect(renderer.file('src/main.tsx')).toContain('createRoot');
    expect(renderer.file('src/not-present.ts')).toBeNull();
    expect(renderer.requiredFile('src/main.tsx')).toContain('createRoot');
    expect([...reachable.keys()]).toContain('src/app/App.tsx');
    expect(() => renderer.requiredFile('src/not-present.ts')).toThrow('Required renderer source is not tracked: src/not-present.ts');
  });

  it('follows runtime re-exports and rejects unresolved local renderer imports', () => {
    const collectReachableSources = (rendererSourceHelpers as unknown as {
      collectReachableSources?: (sources: ReadonlyMap<string, string>, entryPath: string) => ReadonlyMap<string, string>;
    }).collectReachableSources;
    expect(typeof collectReachableSources).toBe('function');
    if (!collectReachableSources) return;

    const sources = new Map([
      ['src/entry.ts', "export { screen } from './barrel.js';\nvoid import('./lazy.js');"],
      ['src/barrel.ts', "export { screen } from './screen';"],
      ['src/screen.tsx', 'export const screen = null;'],
      ['src/lazy.ts', 'export const lazyScreen = null;'],
    ]);
    expect(new Set(collectReachableSources(sources, 'src/entry.ts').keys())).toEqual(new Set([
      'src/entry.ts',
      'src/barrel.ts',
      'src/screen.tsx',
      'src/lazy.ts',
    ]));
    expect(() => collectReachableSources(
      new Map([['src/entry.ts', "export { missing } from './missing.js';"]]),
      'src/entry.ts',
    )).toThrow("Cannot resolve local renderer import './missing.js' from src/entry.ts");
  });

  it('normalizes privileged IPC failures before they reach renderer actions', async () => {
    const gateway = await readFile(new URL('../electron/ipc.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const helper = await readFile(new URL('../src/ui/async-action.ts', import.meta.url), 'utf8').catch(() => '');

    expect(gateway).toContain('toAppErrorPayload');
    expect(preload).toContain('appErrorFromPayload');
    expect(helper).toContain('export function useAsyncAction');
    expect(helper).toContain('activeRef');
    expect(helper).toContain('isCancellation');
    expect(helper).toContain('finally');
  });

  it('delegates every named privileged async UI handler to the shared action helper', async () => {
    const app = (await rendererSourcesPromise).requiredFile('src/app/App.tsx');
    const sourceFile = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const uncovered: string[] = [];

    function isAsync(node: ts.FunctionLikeDeclaration): boolean {
      return Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword));
    }

    function visit(node: ts.Node): void {
      if (ts.isFunctionDeclaration(node) && node.name && node.body && isAsync(node)) {
        const body = node.body.getText(sourceFile);
        const isStateLoader = node.name.text === 'loadCompleteBootstrap' || node.name.text === 'reconcile';
        if (!isStateLoader && /\bapi\.[A-Za-z0-9_]+\(/u.test(body) && !body.includes('Action.run(')) {
          uncovered.push(node.name.text);
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    expect(uncovered).toEqual([]);
  });

  it('shows local action feedback and reserves a global banner for state failures', async () => {
    const sources = await rendererSourcesPromise;
    const shell = sources.requiredFile('src/app/AppShell.tsx');
    const renderer = sources.all;
    const feedback = sources.requiredFile('src/components/AsyncActionFeedback.tsx');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(renderer).toMatch(/from ["'](?:\.\.\/|\.\/)+ui\/async-action["']/u);
    expect(shell).toContain('InlineActionFeedback');
    expect(shell).toContain('className="global-action-banner"');
    expect(feedback).toContain('className={`inline-action-feedback ${feedback.tone}`}');
    for (const page of [
      'ViralAnalyzerPage',
      'NewTaskPage',
      'MusicMvPage',
      'HtmlVideoPage',
      'QueuePage',
      'TaskDetailPage',
      'ArtifactPreviewContent',
      'ImageGenerationGallery',
      'NarrationPreviewList',
      'PromptTemplatesPage',
      'DraftTemplatesPage',
      'SettingsPage',
      'AccountPage',
      'ActivationPage',
    ]) {
      const start = renderer.indexOf(`function ${page}(`);
      expect(start, `${page} is present`).toBeGreaterThan(-1);
      const nextComponent = renderer.indexOf('\nfunction ', start + 10);
      const section = renderer.slice(start, nextComponent === -1 ? renderer.length : nextComponent);
      expect(section, `${page} owns local feedback`).toContain('<InlineActionFeedback');
    }
    expect(css).toContain('.inline-action-feedback');
    expect(css).toContain('.global-action-banner');
  });

  it('keeps saved provider secrets out of renderer state, DOM values, and browser persistence', async () => {
    const sources = await rendererSourcesPromise;
    const applicationOwners = [
      sources.requiredFile('src/app/App.tsx'),
      sources.requiredFile('src/app/AppShell.tsx'),
      sources.requiredFile('src/app/AppRoutes.tsx'),
    ].join('\n');
    const settingsOwners = [
      sources.requiredFile('src/features/settings/SettingsPage.tsx'),
      sources.requiredFile('src/features/settings/ProviderProfileManagers.tsx'),
      sources.requiredFile('src/features/settings/settings-controls.tsx'),
    ].join('\n');
    const mediaConfigOwners = [
      sources.requiredFile('src/features/music-mv/MusicMvPage.tsx'),
      sources.requiredFile('src/features/viral/ViralAnalyzerPage.tsx'),
    ].join('\n');
    const appState = await appStateSourcePromise;
    const browserFallback = await browserFallbackSourcePromise;
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const electronMain = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const secretSensitiveOwners = `${applicationOwners}\n${settingsOwners}`;

    expect(`${appState}\n${browserFallback}`).toContain('stripConfigSecrets');
    expect(secretSensitiveOwners).not.toContain('stripConfigSecrets(');
    expect(settingsOwners).toContain('../../shared/config-secrets');
    expect(settingsOwners).toContain('secretChanges');
    expect(settingsOwners).toContain('SecretInput');
    expect(settingsOwners).toContain("type={revealed ? 'text' : 'password'}");
    expect(settingsOwners).toContain('Eye');
    expect(settingsOwners).toContain('EyeOff');
    expect(settingsOwners).toContain('onClear');
    expect(mediaConfigOwners).toContain('secretChanges: {}');
    expect(browserFallback).toContain('stripConfigSecrets(next.config)');
    expect(secretSensitiveOwners).not.toContain('function maskConfigured');
    expect(secretSensitiveOwners).not.toContain('value.slice(0, 2)');
    expect(apiContract).toContain('PublicAppState');
    expect(apiContract).toContain('SaveConfigInput');
    expect(preload).toContain('SaveConfigInput');
    expect(electronMain).toContain('ConfigService');
    expect(electronMain).toContain('getPublicState()');
    expect(electronMain).toContain('getRuntimeConfig()');
  });

  it('does not claim that browser preview securely saved edited provider secrets', async () => {
    const settingsPage = (await rendererSourcesPromise).requiredFile('src/features/settings/SettingsPage.tsx');
    const browserFallback = await browserFallbackSourcePromise;
    const fallbackSave = browserFallback.slice(browserFallback.indexOf('async saveConfig(input)'), browserFallback.indexOf('async testLlmConfig'));
    const settingsCommit = settingsPage.slice(settingsPage.indexOf('async function commitAndApplySettingsDraft'), settingsPage.indexOf('function clearProviderModels'));

    expect(fallbackSave).toContain('Object.keys(input.secretChanges).length > 0');
    expect(fallbackSave).toContain('浏览器预览不会安全保存接口密钥');
    expect(settingsCommit).toContain('setConfigTestResult(`[fail]');
    expect(settingsCommit).not.toContain('throw error');
  });

  it('keeps Node-only provider networking out of the browser fallback bundle', async () => {
    const reachable = (await rendererSourcesPromise).reachableFrom('src/main.tsx');
    const browserFallback = await browserFallbackSourcePromise;
    const configUtils = await readFile(new URL('../src/shared/config-utils.ts', import.meta.url), 'utf8');
    const fallbackModels = browserFallback.slice(browserFallback.indexOf('async listProviderModels(request)'), browserFallback.indexOf('async listVolcengineSpeakers'));

    expect([...reachable.keys()]).not.toContain('src/shared/llm-provider.ts');
    expect(configUtils).not.toContain("from './openai-image'");
    expect(configUtils).toContain("await import('./openai-image')");
    expect(fallbackModels).not.toContain('listConfiguredProviderModels');
    expect(fallbackModels).toContain('浏览器预览无法安全加载模型列表');
    expect(fallbackModels).toContain('models: []');
  });

  it('presents the accepted three-category StoryDream sidebar without dropping shell utilities', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/app/AppShell.tsx');
    const navigation = await navigationSourcePromise;
    const shellSource = `${main}\n${navigation}`;
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    for (const text of [
      '创作生产',
      '素材与实验',
      '模板与系统',
      '最近任务',
      '试用剩余',
      '激活管理',
      '账户中心',
      '积分明细',
      '新建任务',
      '任务队列',
      '历史任务',
      '画图实验室',
      '配音实验室',
      '音乐 MV',
      '提示词模板',
      '草稿模板',
      '系统设置',
      '爆款拆解',
    ]) {
      expect(shellSource).toContain(text);
    }

    expect(main).toContain('sidebarNavGroups.map');
    expect(navigation.indexOf("label: '创作生产'")).toBeLessThan(navigation.indexOf("label: '素材与实验'"));
    expect(navigation.indexOf("label: '素材与实验'")).toBeLessThan(navigation.indexOf("label: '模板与系统'"));
    expect(navigation.indexOf('新建任务')).toBeLessThan(navigation.indexOf('爆款拆解'));
    expect(main).toContain('className="trial-activation-bar"');
    expect(main).toContain('className="recent-task-strip"');
    expect(main).toContain('navigate(\'account\')');
    expect(main).toContain('navigate(\'activation\')');
    expect(css).toContain('.trial-activation-bar');
    expect(css).toContain('.recent-task-strip');
    expect(css).toContain('.nav-section-label');
    expect(css).toContain('.account-entry-grid');
  });

  it('keeps all five material and experiment routes together in concept order', async () => {
    const navigation = await navigationSourcePromise;
    const assetStart = navigation.indexOf('export const assetLabNavItems');
    const assetEnd = navigation.indexOf('export const templateSystemNavItems');
    const assetNav = navigation.slice(assetStart, assetEnd);

    for (const view of ['image-lab', 'voice-lab', 'music-mv', 'viral-analyzer', 'html-video']) {
      expect(assetNav).toContain(`view: '${view}'`);
    }
    expect(assetNav).not.toContain("view: 'prompt-templates'");
    expect(assetNav.indexOf("view: 'music-mv'")).toBeLessThan(assetNav.indexOf("view: 'viral-analyzer'"));
    expect(assetNav.indexOf("view: 'viral-analyzer'")).toBeLessThan(assetNav.indexOf("view: 'html-video'"));
  });

  it('exposes local book selection and person asset APIs through preload', async () => {
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const viteEnv = await readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8');
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');

    for (const api of [
      'listBookSelections',
      'saveBookSelection',
      'deleteBookSelection',
      'listPersonAssets',
      'createPersonAsset',
      'renamePersonAsset',
      'deletePersonAsset',
      'importPersonAssetImages',
      'listPersonAssetImages',
    ]) {
      expect(preload).toContain(api);
      expect(apiContract).toContain(api);
    }

    expect(apiContract).not.toContain('Partial<LocalBookPersonAssetApi>');
    expect(apiContract).toContain('& LocalBookPersonAssetApi');
    expect(viteEnv).toContain("import type { StoryDreamApi } from './shared/storydream-api';");
    expect(viteEnv).not.toContain('LocalBookPersonAssetApi');

    for (const channel of [
      'book-selection:list',
      'book-selection:save',
      'book-selection:delete',
      'person-assets:list',
      'person-assets:create',
      'person-assets:rename',
      'person-assets:delete',
      'person-assets:import-images',
      'person-assets:list-images',
    ]) {
      expect(main).toContain(channel);
    }
  });

  it('keeps the full previous book identity until the canonical save response arrives', async () => {
    const page = (await rendererSourcesPromise).requiredFile('src/features/labs/BookSelectionPage.tsx');
    expect(page).toContain('selectedIdentity');
    expect(page).toContain('previousIdentity: selectedIdentity');
    expect(page).toContain("setSelectedIdentity({ theme: record.theme, bookId: record.bookId })");
    expect(page).toContain("setSelectedIdentity({ theme: saved.theme, bookId: saved.bookId })");
    expect(page).not.toContain('bookId: selectedBookId || undefined');
    expect(page).toContain("sessionStorage.setItem('book_product_info', JSON.stringify(record.data))");
  });

  it('adds practical latest Storybound pages and controls to the Chinese shell', async () => {
    const main = (await rendererSourcesPromise).all;
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    for (const text of [
      '选品助手',
      '对标导入',
      '人物素材库',
      '文案把控',
      '固定开头',
      '结尾引导',
      '锁定开头句数',
      '素材来源',
      '本地人物素材',
      '用此文案创建任务',
      '带入新建任务',
    ]) {
      expect(main).toContain(text);
    }

    for (const symbol of [
      'BookSelectionPage',
      'BenchmarkImportPage',
      'PersonAssetsPage',
      'book_product_info',
      'benchmark_search',
      'productInfo',
      'materialPerson',
      'fixedIntro',
      'outroCta',
      'lockIntroSentences',
    ]) {
      expect(main).toContain(symbol);
    }

    for (const symbol of [
      "sessionStorage.removeItem('book_product_info')",
      "sessionStorage.removeItem('benchmark_search')",
      'const selectedMaterialAsset = personAssets.find((asset) => asset.name === materialPerson) ?? null;',
      'const isLocalMaterialInvalid = materialSource === \'local\' && (!materialPerson || !selectedMaterialAsset || selectedMaterialAsset.count <= 0);',
      'api.createAndRunTask',
      '请先选择人物素材。',
      '所选人物素材至少导入 1 张图片后才能创建任务。',
      'const createTaskDisabled = running',
      'disabled={createTaskDisabled}',
      "disabled={activeStage === 'output' ? createTaskDisabled : false}",
      'catch (error)',
      'error instanceof Error ? error.message : String(error)',
    ]) {
      expect(main).toContain(symbol);
    }

    expect(css).toContain('.selection-grid');
    expect(css).toContain('.person-assets-layout');
    expect(css).toContain('.benchmark-import-layout');
  });

  it('keeps sidebar navigation as fixed full-width single-line rows', async () => {
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(css).toContain('grid-template-columns: 18px minmax(0, 1fr);');
    expect(css).toContain('grid-template-rows: 1fr;');
    expect(css).toContain('min-height: 36px;');
    expect(css).toContain('gap: 10px;');
    expect(css).toContain('align-items: center;');
    expect(css).toContain('padding: 0 10px;');
    expect(css).toContain('.nav-item > svg');
    expect(css).toContain('grid-row: 1;');
    expect(css).toContain('.nav-item span {');
    expect(css).toContain('text-overflow: ellipsis;');
    expect(css).toContain('white-space: nowrap;');
    expect(css).toContain('line-height: 20px;');
    expect(css).toContain('display: none;');
  });

  it('uses the stronger accent token for readable active navigation text', async () => {
    const css = await readFile(new URL('../src/styles/shell.css', import.meta.url), 'utf8');
    const activeNavigation = css.match(
      /\.app-shell\[data-editorial-shell\] \.nav-item\.active,[\s\S]*?\}/u,
    )?.[0] ?? '';

    expect(activeNavigation).toContain('color: var(--shell-accent-strong);');
    expect(activeNavigation).not.toContain('color: var(--shell-accent);');
  });

  it('uses an accessible icon-library grip for provider profile cards', async () => {
    const source = (await rendererSourcesPromise).requiredFile('src/features/settings/ProviderProfileManagers.tsx');

    expect(source).toContain('GripVertical');
    expect(source).toContain('<GripVertical aria-hidden="true" className="profile-drag-dot" />');
    expect(source).not.toContain('⋮⋮');
  });

  it('shows the whole sidebar menu and lets the lower task area shrink instead', async () => {
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const navListBlock = css.match(/\.nav-list\s*\{[^}]+\}/)?.[0] ?? '';
    const sidebarBottomBlock = css.match(/\.sidebar-bottom\s*\{[^}]+\}/)?.[0] ?? '';
    const recentTaskBlock = css.match(/\.recent-task-strip\s*\{[^}]+\}/)?.[0] ?? '';

    expect(navListBlock).toContain('flex: 0 0 auto;');
    expect(navListBlock).toContain('overflow: visible;');
    expect(navListBlock).not.toContain('overflow: auto;');
    expect(sidebarBottomBlock).toContain('flex: 1 1 130px;');
    expect(sidebarBottomBlock).toContain('min-height: 130px;');
    expect(sidebarBottomBlock).toContain('overflow: hidden;');
    expect(sidebarBottomBlock).toContain('grid-template-rows: minmax(0, 1fr) auto auto;');
    expect(recentTaskBlock).toContain('min-height: 0;');
    expect(recentTaskBlock).toContain('overflow: auto;');
    expect(css).toContain('@media (max-height: 760px)');
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(css).toContain('flex-basis: 88px;');
    expect(css).toContain('min-height: 88px;');
  });

  it('uses a restrained storyboard-console visual system instead of a generic neon shell', async () => {
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const tokens = await readFile(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');

    for (const token of ['--cyanprint', '--paper-warm', '--timeline-blue', '--surface-ink', '--shadow', '--focus-ring']) {
      expect(tokens).toContain(token);
    }

    expect(css).toContain('.app-shell::before');
    expect(css).toContain('repeating-linear-gradient(90deg');
    expect(css).toContain('.nav-item.active::before');
    expect(css).toContain('.page-head::before');
    expect(css).toContain('.primary-action:hover');
    expect(css).not.toContain('--accent: #12d4a0');
  });

  it('keeps browser preview fallback errors in Chinese', async () => {
    const browserFallback = await browserFallbackSourcePromise;
    const browserSources = browserFallback;

    expect(browserSources).not.toContain('Browser preview cannot');
    expect(browserSources).not.toContain('API key is missing; fill it before testing the model.');
    expect(browserSources).not.toContain('Fallback Jianying effect catalog.');
    expect(browserSources).not.toContain('Viral analysis result is not available in browser preview');
    expect(browserSources).not.toContain('Viral recreation is not available in browser preview');
    expect(browserSources).not.toContain('Python runtime dependency missing');
    expect(browserSources).toContain('浏览器预览无法运行真实供应商流水线');
    expect(browserSources).toContain('浏览器预览无法运行爆款视频拆解');
  });

  it('keeps all visible StoryDream pipeline labels in Chinese', async () => {
    const main = (await rendererSourcesPromise).all;

    for (const text of [
      'Step 0 预审',
      'Step 1 三轮改写自评',
      'Step 2 分镜',
      'Step 3 主角档案与出图提示词',
      'Step 4 批量生图',
      'Step 5 配音',
      'Step 6 草稿导出',
      '暂停后可续跑',
      '重新生成',
      '改写后继续',
      '草稿输出',
    ]) {
      expect(main).toContain(text);
    }
  });

  it('defines the complete StoryDream-style navigation shell', async () => {
    const main = (await rendererSourcesPromise).all;
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    for (const view of ['new-task', 'queue', 'history', 'image-lab', 'voice-lab', 'music-mv', 'viral-analyzer', 'prompt-templates', 'draft-templates', 'settings', 'account', 'activation']) {
      expect(main).toContain(view);
    }
    for (const text of ['新建任务', '任务队列', '历史任务', '画图实验室', '音乐MV', '提示词模板', '草稿模板', '系统设置']) {
      expect(main).toContain(text);
    }
    expect(css).toContain('.app-shell');
    expect(css).toContain('--accent');
  });

  it('keeps the exact seventeen route branches in the application route owner', async () => {
    const routes = (await rendererSourcesPromise).requiredFile('src/app/AppRoutes.tsx');
    const routedViews = [...routes.matchAll(/activeView === '([^']+)'/gu)].map((match) => match[1]);
    expect(routedViews).toEqual([
      'new-task',
      'book-selection',
      'benchmark',
      'person-assets',
      'queue',
      'history',
      'task-detail',
      'image-lab',
      'voice-lab',
      'music-mv',
      'html-video',
      'viral-analyzer',
      'prompt-templates',
      'draft-templates',
      'settings',
      'account',
      'activation',
    ]);
    expect(new Set(routedViews).size).toBe(17);
  });

  it('adds a standalone voice lab for provider voice previews and history playback', async () => {
    const routes = (await rendererSourcesPromise).requiredFile('src/app/AppRoutes.tsx');
    const voiceLab = (await rendererSourcesPromise).requiredFile('src/features/labs/VoiceLabPage.tsx');
    const voiceSources = `${routes}\n${voiceLab}`;
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');

    for (const symbol of [
      'VoiceLabPage',
      'api.generateVoiceLabPreview',
      'voiceLabRecords',
      'voice-lab-layout',
      'voice-lab-text',
      'voice-lab-voices',
      'voice-lab-player',
      'voice-lab-history',
      'voiceProvider',
      'voiceSpeed',
      'ttsVoiceOptionsForProvider',
      'taskSpeakerLabel',
    ]) {
      expect(voiceSources).toContain(symbol);
    }

    expect(preload).toContain('generateVoiceLabPreview');
    expect(css).toContain('.voice-lab-layout');
    expect(css).toContain('.voice-lab-voices');
    expect(css).toContain('.voice-record');
    expect(css).toContain('.voice-lab-player');
  });

  it('adds a complete music MV page and sends MV task settings into task creation', async () => {
    const sources = await rendererSourcesPromise;
    const main = sources.requiredFile('src/app/AppRoutes.tsx');
    const musicPage = sources.requiredFile('src/features/music-mv/MusicMvPage.tsx');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const types = await readFile(new URL('../src/shared/types.ts', import.meta.url), 'utf8');

    expect(main).toContain("'music-mv'");
    expect(main).toContain('MusicMvPage');
    for (const symbol of [
      'music-mv-layout',
      'musicMvRhythmMode',
      'musicMvCaptionStyle',
      'musicMvVisualMotif',
      'musicMvAudioPath',
      "taskKind: 'music-mv'",
      'processingMode',
      'setProcessingMode',
      'musicMv:',
    ]) {
      expect(musicPage).toContain(symbol);
    }

    expect(types).toContain("export type ProcessingMode = 'full-auto' | 'semi-auto' | 'clip-only'");
    expect(types).toContain("export type TaskKind = 'story' | 'music-mv'");
    expect(css).toContain('.music-mv-layout');
    expect(css).toContain('.music-mv-preview');
  });

  it('adds the Storybound HTML animation workspace without routing through the story pipeline', async () => {
    const sources = await rendererSourcesPromise;
    const main = sources.requiredFile('src/app/AppRoutes.tsx');
    const htmlPage = sources.requiredFile('src/features/html-video/HtmlVideoPage.tsx');
    const htmlTabs = sources.requiredFile('src/features/html-video/HtmlVideoTabPanel.tsx');
    const htmlSources = `${main}\n${htmlPage}\n${htmlTabs}`;
    const [css, htmlFeatureCss] = await Promise.all([
      readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/styles/features/html-video.css', import.meta.url), 'utf8'),
    ]);
    const types = await readFile(new URL('../src/shared/types.ts', import.meta.url), 'utf8');
    const workflow = await readFile(new URL('../src/shared/html-video-workflow.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const electronMain = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');

    expect(main).toContain("'html-video'");
    expect(main).toContain('HtmlVideoPage');
    for (const symbol of [
      'hv-studio',
      'createHtmlVideoTask',
      'htmlVideoSteps',
      'htmlVideoTabs',
      'HTML 动画视频',
      '动画预览',
      '逐帧截图',
    ]) {
      expect(htmlPage).toContain(symbol);
    }
    for (const label of ['改写 + 分句', '场景规划', '素材（图片）', '配音', '动画预览', '出片']) {
      expect(workflow).toContain(label);
    }

    expect(htmlSources).not.toContain('HTML Animation');
    expect(htmlSources).not.toContain('Generate HTML Video');
    expect(htmlPage).toContain('safeParseHtmlVideoPipelineData(activeTask?.pipelineData, activeTask?.inputText)');
    expect(htmlPage).toContain('pipelineParse.error');
    expect(htmlPage).toContain('HTML 视频任务数据损坏');
    expect(htmlPage).toContain('useState<TtsProvider>(() => normalizeRuntimeTtsProvider(state.config.tts.provider))');
    expect(htmlPage).toContain('useState(() => defaultTaskSpeakerForProvider(state.config.tts.provider, state.config))');
    expect(htmlPage).toContain('useState<number>(HTML_VIDEO_JOB_DEFAULTS.ttsSpeed)');
    expect(htmlPage).toMatch(/createHtmlVideoTaskInput\(\{[\s\S]*?ttsProvider,[\s\S]*?voiceId,[\s\S]*?ttsSpeed,/u);
    expect(htmlSources).not.toContain("taskKind: 'html-video'");
    expect(types).toContain("export type TaskKind = 'story' | 'music-mv'");
    expect(types).not.toContain("export type TaskKind = 'story' | 'music-mv' | 'html-video'");
    expect(workflow).toContain("taskKind: 'story'");
    expect(workflow).toContain("taskType: 'html-video'");
    expect(workflow).toContain("pipelineStep: 'rewrite'");
    expect(workflow).toContain('pipelineData: JSON.stringify(data)');
    expect(preload).toContain('createHtmlVideoTask');
    expect(electronMain).toContain("trustedHandle('html-video:create-task'");
    const htmlCreateSection = electronMain.slice(electronMain.indexOf("trustedHandle('html-video:create-task'"), electronMain.indexOf("trustedHandle('task:create-and-run'"));
    expect(htmlCreateSection).toContain('startTaskRun');
    for (const symbol of [
      'openHtmlVideoPreview',
      'getHtmlVideoMediaUrl',
      'updateTaskStatus',
      'retryTask',
      'pipelineData.steps',
      '暂停',
      '取消',
      '继续',
      '重试',
      '打开目录',
    ]) {
      expect(htmlPage).toContain(symbol);
    }
    expect(htmlTabs).toContain('<video');
    expect(htmlFeatureCss).toContain('.hv-studio');
    expect(htmlFeatureCss).toContain('.hv-studio-run-rail');
    expect(htmlFeatureCss).toContain('.hv-tab');
    expect(css).toContain('.hv-media-grid');
    expect(htmlFeatureCss).toContain('.hv-run-controls');
  });

  it('keeps HTML video task, step, and pipeline diagnostics visible without expanding long errors', async () => {
    const page = (await rendererSourcesPromise).requiredFile('src/features/html-video/HtmlVideoPage.tsx');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(page).toContain('classifyHtmlVideoTaskMessage(activeTask.status, taskDisplayMessage)');
    expect(page).toMatch(/taskMessageKind === 'error'[\s\S]*?className="hv-workspace-error"\s+role="alert"\s+aria-live="assertive"[\s\S]*?<ErrorSummaryButton/);
    expect(page).toMatch(/taskMessageKind === 'status'[\s\S]*?className="hv-workspace-status"\s+role="status"\s+aria-live="polite"/);
    expect(page).toContain('fullMessage={taskDisplayMessage}');
    expect(page).toMatch(/stepState\.error\s*\?\s*<div\s+className="hv-step-error"\s+role="alert"\s+aria-live="assertive"[\s\S]*?<ErrorSummaryButton/);
    expect(page).toContain('pipelineData.warnings.length');
    expect(page).toContain('className="hv-warning-list" role="status" aria-live="polite"');
    expect(css).toContain('.hv-workspace-error');
    expect(css).toContain('.hv-workspace-status');
    expect(css).toContain('.hv-warning-list');
    expect(css).toMatch(/\.hv-workspace-error[\s\S]*?max-width:\s*100%/);
    expect(css).toMatch(/\.hv-warning-list[\s\S]*?overflow-wrap:\s*anywhere/);
  });

  it('loads HTML video media incrementally from stable primitive effect dependencies', async () => {
    const page = (await rendererSourcesPromise).requiredFile('src/features/html-video/HtmlVideoPage.tsx');
    const mediaEffect = page.slice(page.indexOf('useEffect(() => {\n    const generation ='), page.indexOf('async function createHtmlVideoTask'));

    expect(page).toContain("const mediaTaskId = activeTask?.id ?? '';");
    expect(page).toContain('const mediaPathKey = JSON.stringify(mediaPaths);');
    expect(page).toContain('createHtmlVideoMediaCache()');
    expect(page).toContain('syncHtmlVideoMediaCache(mediaCacheRef.current, mediaTaskId, paths)');
    expect(page).toMatch(/loadHtmlVideoMedia\(\s*cache,\s*mediaTaskId,\s*path,/);
    expect(mediaEffect).toContain('Promise.all');
    expect(mediaEffect).toContain('mediaRequestGeneration.current');
    expect(mediaEffect).toMatch(/disposed\s*\|\|\s*generation\s*!==\s*mediaRequestGeneration\.current/);
    expect(mediaEffect).toContain('setMediaState((current) =>');
    expect(mediaEffect).toMatch(/\}, \[api, isBrowserPreview, mediaPathKey, mediaRetryRevision, mediaTaskId\]\);/);
    expect(mediaEffect).not.toMatch(/\}, \[[^\]]*activeTask[^\]]*\]\);/);
    expect(page).toContain('setMediaRetryRevision((revision) => revision + 1)');
    expect(page).toContain('<RotateCcw size={14} />重新加载媒体');
  });

  it('keeps HTML media in a busy loading state until URL requests settle', async () => {
    const sources = await rendererSourcesPromise;
    const page = [
      sources.requiredFile('src/features/html-video/HtmlVideoPage.tsx'),
      sources.requiredFile('src/features/html-video/HtmlVideoTabPanel.tsx'),
      sources.requiredFile('src/features/html-video/HtmlVideoStoryboundPanels.tsx'),
    ].join('\n');

    expect(page).toContain('failedPaths: string[]');
    expect(page).toContain('const mediaLoading = !isBrowserPreview && mediaPaths.some');
    expect(page).toContain('aria-busy={mediaLoading}');
    expect(page).toContain('htmlVideoMediaStatus(voice.src, mediaUrls, failedMediaPaths, isBrowserPreview)');
    expect(page).toMatch(/voiceStatus === 'loading'[\s\S]*?音频加载中[\s\S]*?voiceStatus === 'unavailable'[\s\S]*?音频文件暂不可用/u);
    expect(page).toMatch(/outputStatus === 'loading'[\s\S]*?视频加载中[\s\S]*?outputStatus === 'unavailable'[\s\S]*?视频文件暂不可用/u);
    expect(page).toMatch(/assetStatus === 'loading'[\s\S]*?图片加载中[\s\S]*?assetStatus === 'unavailable'[\s\S]*?图片加载失败[\s\S]*?本地图片仅桌面端可用/u);
    expect(page).toMatch(/thumbnailStatus === 'loading'[\s\S]*?预览加载中[\s\S]*?thumbnailStatus === 'unavailable'[\s\S]*?预览加载失败[\s\S]*?本地预览仅桌面端可用/u);
    expect(page).toContain('className="hv-media-state hv-media-loading"');
    expect(page).toContain('className="hv-media-state" role="status"');
  });

  it('routes real HTML media element failures through retry generations', async () => {
    const sources = await rendererSourcesPromise;
    const page = [
      sources.requiredFile('src/features/html-video/HtmlVideoPage.tsx'),
      sources.requiredFile('src/features/html-video/HtmlVideoTabPanel.tsx'),
      sources.requiredFile('src/features/html-video/HtmlVideoStoryboundPanels.tsx'),
    ].join('\n');

    expect(page).toContain('mediaElementFailureState');
    expect(page).toContain('generation: mediaRetryRevision');
    expect(page).toContain('onMediaElementError={markMediaElementFailed}');
    expect(page).toContain('onMediaElementReady={markMediaElementReady}');
    expect(countOccurrences(page, 'onError={() => onMediaElementError(')).toBe(5);
    expect(countOccurrences(page, 'onLoad={() => onMediaElementReady(')).toBe(3);
    expect(countOccurrences(page, 'onCanPlay={() => onMediaElementReady(')).toBe(2);
    expect(countOccurrences(page, 'htmlVideoMediaElementKey(task.id,')).toBe(5);
  });

  it('rejects late HTML media errors unless their task, path set, and retry generation are still current', async () => {
    const page = (await rendererSourcesPromise).requiredFile('src/features/html-video/HtmlVideoPage.tsx');
    const failureHandler = page.slice(
      page.indexOf('const markMediaElementFailed'),
      page.indexOf('const markMediaElementReady'),
    );

    expect(page).toContain('currentMediaElementScopeRef');
    expect(failureHandler).toContain('recordHtmlVideoMediaElementFailure');
    expect(countOccurrences(failureHandler, 'currentMediaElementScopeRef.current')).toBeGreaterThanOrEqual(2);
  });

  it('shows the exact HTML video output path with overflow-safe wrapping', async () => {
    const page = (await rendererSourcesPromise).requiredFile('src/features/html-video/HtmlVideoTabPanel.tsx');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(page).toContain('className="hv-output-path"');
    expect(page).toContain('<code>{data.output.path}</code>');
    expect(css).toMatch(/\.hv-output-path code\s*\{[\s\S]*?overflow-wrap:\s*anywhere/u);
    expect(css).toMatch(/\.hv-output-path code\s*\{[\s\S]*?white-space:\s*pre-wrap/u);
    expect(css).toMatch(/\.hv-media-state\s*\{[\s\S]*?height:\s*100%[\s\S]*?place-content:\s*center/u);
  });

  it('labels paused checkpoints and opens the first composition that has an HTML preview', async () => {
    const page = (await rendererSourcesPromise).requiredFile('src/features/html-video/HtmlVideoPage.tsx');

    expect(page).toContain('pipelineData.compositions.find((composition) => Boolean(composition.htmlPath))');
    expect(page).toContain('openPreview(firstPreviewComposition.index)');
    expect(page).not.toContain('onClick={() => openPreview()}');
    expect(page).toContain('htmlVideoStepStatusLabel(pipelineData.steps.render.status, activeTask?.status)');
    expect(page).toContain('htmlVideoStepStatusLabel(stepState.status, activeTask?.status)');
    expect(page).toMatch(/status === 'cancelled' && taskStatus === 'paused'[\s\S]*?'已暂停'/);
  });

  it('uses the shared HTML control manifest without exposing unconsumed editors', async () => {
    const sources = await rendererSourcesPromise;
    const htmlPage = sources.requiredFile('src/features/html-video/HtmlVideoPage.tsx');
    const htmlTabs = sources.requiredFile('src/features/html-video/HtmlVideoTabPanel.tsx');
    const page = `${htmlPage}\n${htmlTabs}`;
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(htmlTabs).toContain("import { HTML_VIDEO_CONTROL_MANIFEST_V1 } from '../../shared/html-video-control-manifest'");
    expect(page).toContain('data-html-video-control="transitionType"');
    expect(page).toContain('HTML_VIDEO_CONTROL_MANIFEST_V1.transitionType.availability');
    expect(page).toContain('data-html-video-control="coverRatio"');
    expect(page).toContain('HTML_VIDEO_CONTROL_MANIFEST_V1.coverRatio.availability');
    expect(page).not.toMatch(/value=\{data\.config\.draftTemplate\}/u);
    const editor = htmlPage.slice(htmlPage.indexOf('function HtmlVideoConfigEditor'));
    const editableFields = [
      'style',
      'voiceId',
      'ttsProvider',
      'ttsSpeed',
      'bgmId',
      'bgmVolume',
      'transitionType',
      'draftTemplate',
      'foreground',
      'maxScenes',
      'ratio',
    ];
    const readOnlyFields: string[] = [];
    for (const field of editableFields) {
      expect(editor).toContain(`data-html-video-edit-field="${field}"`);
      expect(htmlPage).toContain(`data-html-video-create-field="${field}"`);
    }
    for (const field of readOnlyFields) {
      expect(editor).not.toContain(`data-html-video-edit-field="${field}"`);
    }
    expect(editor).toContain('api.updateHtmlVideoConfig(task.id, changes)');
    expect(editor).toContain("task.status === 'pending' || task.status === 'running'");
    expect(editor).toContain("const disabled = task.status === 'pending' || task.status === 'running' || htmlVideoConfigAction.busy;");
    expect(editor).not.toContain('const disabled = isBrowserPreview ||');
    expect(editor).toContain('customStyles: CustomStyle[]');
    expect(editor).toContain('editableHtmlVideoStyleOptions(customStyles, values.style)');
    expect(editor).toContain('values.bgmId && !bgmOptions.some((bgm) => bgm.id === values.bgmId)');
    expect(editor).toContain('<option value={values.bgmId}>{values.bgmId}（素材库中已缺失）</option>');
    expect(page).toContain('bgmVolume,');
    expect(page).toContain('transitionType,');
    const captionEditor = htmlTabs.slice(htmlTabs.indexOf('function HtmlVideoCaptionEditor'), htmlTabs.indexOf('function HtmlVideoCoverEditor'));
    for (const field of ['captionPreset', 'captionAnim', 'captionColors']) {
      expect(captionEditor).toContain(`data-html-video-edit-field="${field}"`);
    }
    expect(captionEditor).toContain('api.updateHtmlVideoConfig(task.id, changes)');
    expect(captionEditor).toContain('HTML_VIDEO_CAPTION_PRESETS');
    expect(captionEditor).toContain('HTML_VIDEO_CAPTION_ANIMATIONS');
    expect(captionEditor).toContain('type="color"');
    expect(captionEditor).toContain('type="text"');
    expect(captionEditor).toContain('value={colors[key]}');
    expect(captionEditor).toContain('maxLength={9}');
    expect(captionEditor).toContain('htmlVideoCaptionPickerColor(colors[key])');
    expect(captionEditor).toContain('value: colorOverrides');
    expect(captionEditor).toContain('delete next[key]');
    expect(captionEditor).not.toContain('.slice(0, 7)');
    const coverEditor = htmlTabs.slice(htmlTabs.indexOf('function HtmlVideoCoverEditor'), htmlTabs.indexOf('export function HtmlVideoTabPanel'));
    expect(coverEditor).toContain('api.importHtmlVideoCover(task.id)');
    expect(coverEditor).toContain('HTML_VIDEO_COVER_MODES');
    expect(coverEditor).toContain('HTML_VIDEO_COVER_RATIOS');
    expect(coverEditor).toContain('data-html-video-edit-field="coverImageMode"');
    expect(coverEditor).toContain('data-html-video-edit-field="coverTemplate"');
    expect(coverEditor).toContain('data-html-video-edit-field="coverRatio"');
    expect(coverEditor).toContain('换本地封面');
    const tabPanel = htmlTabs.slice(htmlTabs.indexOf('export function HtmlVideoTabPanel'), htmlTabs.indexOf('function formatFileSize'));
    expect(tabPanel).toMatch(/if \(tab === 'cover'\)[\s\S]*?<HtmlVideoCoverEditor/u);
    expect(page).toContain('pipelineData.coverAsset?.path');
    expect(tabPanel).toMatch(/if \(tab === 'preview'\)[\s\S]*?<HtmlVideoCaptionEditor/u);
    expect(tabPanel).not.toMatch(/if \(tab === '(?:text|assets|voice|cover)'\)[\s\S]{0,600}<HtmlVideoCaptionEditor/u);
    expect(css).toMatch(/\.hv-config-editor\s*\{[\s\S]*?border-top:\s*1px solid var\(--line\)/u);
    expect(css).toMatch(/\.hv-config-editor-grid\s*\{[\s\S]*?border:\s*0/u);
    expect(css).toMatch(/@media \(max-width: 1180px\)[\s\S]*?\.hv-config-editor-grid[\s\S]*?grid-template-columns:\s*1fr/u);
  });

  it('renders governed six-step HTML progress and seven-step ordinary progress in task lists', async () => {
    const page = (await rendererSourcesPromise).all;
    expect(page).toMatch(/from ["'](?:\.\/|\.\.\/)shared\/html-video-workflow["'];/u);
    expect(page).toContain("{statusLabel(task.status)} · {taskProgressLabel(task)}");
    expect(page).toContain('const progress = taskProgressSnapshot(task);');
  });

  it('owns HTML task creation and output sizing defaults in the shared config module', async () => {
    const sources = await rendererSourcesPromise;
    const htmlPage = sources.requiredFile('src/features/html-video/HtmlVideoPage.tsx');
    const workflow = sources.requiredFile('src/shared/html-video-workflow.ts');
    expect(htmlPage).toContain('useState<string>(HTML_VIDEO_JOB_DEFAULTS.style)');
    expect(htmlPage).toContain('useState<string>(HTML_VIDEO_JOB_DEFAULTS.ratio)');
    expect(htmlPage).toContain('useState<number>(HTML_VIDEO_JOB_DEFAULTS.maxScenes)');
    expect(htmlPage).toContain('useState<boolean>(HTML_VIDEO_JOB_DEFAULTS.foreground)');
    expect(htmlPage).toContain('options={[...HTML_VIDEO_RATIOS]}');
    expect(htmlPage).toContain('useState<number>(HTML_VIDEO_JOB_DEFAULTS.ttsSpeed)');
    expect(workflow).toContain('htmlVideoAspectRatioOrDefault,');
    expect(workflow).toContain('const aspectRatio = htmlVideoAspectRatioOrDefault(ratio);');
  });

  it('exposes accessible HTML video tabs and media with the task output ratio', async () => {
    const sources = await rendererSourcesPromise;
    const page = [
      sources.requiredFile('src/features/html-video/HtmlVideoPage.tsx'),
      sources.requiredFile('src/features/html-video/HtmlVideoTabPanel.tsx'),
      sources.requiredFile('src/features/html-video/HtmlVideoStoryboundPanels.tsx'),
    ].join('\n');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const outputRule = css.match(/\.hv-video-output video,\s*\.hv-video-placeholder\s*\{[\s\S]*?\}/)?.[0] ?? '';

    expect(page).toContain('role="tablist" aria-label="HTML 动画视频内容"');
    for (const attribute of ['role="tab"', 'aria-selected={activeTab === tab.key}', 'tabIndex={activeTab === tab.key ? 0 : -1}', 'aria-controls="html-video-panel"']) {
      expect(page).toContain(attribute);
    }
    expect(page).toContain('role="tabpanel"');
    expect(countOccurrences(page, 'id="html-video-panel"')).toBe(1);
    expect(page).toContain('aria-labelledby={`html-video-tab-${activeTab}`}');
    expect(page).not.toContain('html-video-panel-${tab.key}');
    expect(page).not.toContain('html-video-panel-${activeTab}');
    expect(page).toContain('aria-label={`场景 ${voice.sceneIndex} 配音`}');
    expect(page).toContain('aria-label={`${task.title || \'HTML 动画视频\'}成片预览`}');
    expect(page).toContain('className="hv-media-error" role="alert"');
    expect(page).toContain('fitHtmlVideoOutputSize(Number.POSITIVE_INFINITY, 520, data.config.ratio || task.ratio)');
    expect(page).toContain('maxWidth: outputSize.width');
    expect(page).toContain('maxHeight: outputSize.height');
    expect(page).toContain('aspectRatio: String(outputSize.aspectRatio)');
    expect(countOccurrences(page, 'style={outputStyle}')).toBe(2);
    expect(outputRule).toContain('justify-self: center;');
    expect(outputRule).not.toContain('aspect-ratio:');
    expect(outputRule).not.toContain('max-height: 520px;');
    expect(css).toMatch(/\.hv-media-error[\s\S]*?color:\s*var\(--danger\)/);
  });

  it('moves focus with all standard HTML video tab navigation keys', async () => {
    const page = (await rendererSourcesPromise).requiredFile('src/features/html-video/HtmlVideoPage.tsx');

    expect(page).toContain('nextHtmlVideoTabKey(tabKey, event.key)');
    expect(page).toContain('onKeyDown={(event) => handleHtmlVideoTabKeyDown(event, tab.key)}');
    expect(page).toContain('event.preventDefault();');
    expect(page).toContain('setActiveTab(nextTab);');
    expect(page).toContain('htmlVideoTabRefs.current[nextTab]?.focus();');
    expect(page).toContain('htmlVideoTabRefs.current[tab.key] = element;');
  });

  it('wires the viral analyzer page into the shell with report and selectable follow-up controls', async () => {
    const sources = await rendererSourcesPromise;
    const main = sources.requiredFile('src/app/AppRoutes.tsx');
    const viralPage = sources.requiredFile('src/features/viral/ViralAnalyzerPage.tsx');
    const report = sources.requiredFile('src/features/viral/ViralReport.tsx');
    const viralSources = `${main}\n${viralPage}\n${report}`;
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(viralSources).not.toContain("from './shared/viral-analysis'");
    expect(viralPage).toContain("from '../../shared/viral-template-extraction'");

    expect(main).toContain('ViralAnalyzerPage');
    for (const symbol of [
      'createAndRunViralAnalysis',
      'createProductionTaskFromViral',
      'viral-analyzer-layout',
      'viral-url-input',
      'viral-platform-picker',
      'viral-workbench',
      'viral-progress-list',
      'viral-stage-timeline',
      'viral-stage-node',
      'viral-result-drawer',
      'saveViralTemplates',
      'api.saveViralTemplates',
    ]) {
      expect(viralPage).toContain(symbol);
    }
    for (const symbol of [
      'viral-insight-tabs',
      'viral-frame-insights',
      'viral-copy-breakdown',
      'viral-original-copy',
      'viral-insight-card',
      'viral-report-grid',
      'viral-followup-panel',
      'viral-template-name-grid',
      'viral-followup-actions',
      'viral-create-production-task',
    ]) {
      expect(report).toContain(symbol);
    }
    expect(viralPage).not.toContain('api.savePromptTemplate');
    expect(viralPage).not.toContain('api.saveCustomStyle');

    for (const text of ['爆款拆解', '开头', '结构', '结尾', '爆点', '文案拆解', '原文案', '提示词拆解', '后续操作', '保存为模板', '生成新任务', '故事模板名', '图片模板名']) {
      expect(viralSources).toContain(text);
    }
    expect(viralSources).not.toContain('特效拆解');
    expect(viralSources).not.toContain("type ViralInsightTab = 'prompt' | 'effects'");
    expect(viralPage).toContain('latestViralEventForStage');
    expect(viralPage).not.toContain('selectedEvents.find((event) => event.stage === stage)');

    const viralReport = report.slice(report.indexOf('export function ViralReport'), report.indexOf('function viralTranscriptText'));
    expect(viralReport).toContain('uniqueViralPromptFrames(result.frames)');
    expect(viralReport).not.toContain('slice(0, 8)');
    expect(viralReport).toContain('关键帧数量');
    expect(viralReport).toContain('keyFrameCount');
    expect(viralReport).toContain('setStoryTemplateName(`爆款故事模板 - ${defaultTemplateBaseName}`)');
    expect(viralReport).toContain('setImageTemplateName(`爆款图片模板 - ${defaultTemplateBaseName}`)');

    expect(css).toContain('.viral-analyzer-layout');
    expect(css).toContain('.viral-workbench');
    expect(css).toContain('@media (max-width: 1380px)');
    expect(css).toContain('max-height: min(560px, calc(100vh - 240px))');
    expect(css).toContain('.viral-input-panel');
    expect(css).toContain('overflow: auto');
    expect(css).toContain('.viral-stage-timeline');
    expect(css).toContain('.viral-stage-node');
    expect(css).toContain('.viral-result-drawer');
    expect(css).toContain('.viral-insight-tabs');
    expect(css).toContain('.viral-frame-insights');
    expect(css).toContain('.viral-insight-card');
    expect(css).toContain('.viral-history-item strong');
    expect(css).toContain('-webkit-line-clamp: 2');
    expect(css).toContain('.viral-report-grid');
    expect(css).toContain('.viral-followup-panel');
    expect(css).toContain('.viral-template-name-grid');
    expect(css).toContain('.viral-followup-actions');
    expect(css).toContain('.viral-report-card strong');
    expect(css).toContain('.viral-report-card p');
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).toMatch(/\.viral-report-card\s*\{[\s\S]*?gap: 6px;[\s\S]*?min-height: 128px;[\s\S]*?padding: 12px;/);
    expect(css).toMatch(/\.viral-report-card strong\s*\{[\s\S]*?-webkit-line-clamp: 2;[\s\S]*?font-size: 15px;[\s\S]*?line-height: 1\.28;/);
    expect(css).toMatch(/\.viral-report-card p\s*\{[\s\S]*?-webkit-line-clamp: 3;/);
  });

  it('keeps viral source detection independent from manual platform selection and avoids native select popups', async () => {
    const page = (await rendererSourcesPromise).requiredFile('src/features/viral/ViralAnalyzerPage.tsx');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const platformSnippet = page.slice(page.indexOf('className="segmented viral-platform-picker"'), page.indexOf('<p className="viral-source-status">'));

    expect(page).toContain('sourceMode');
    expect(page).toContain('selectedPlatformForAnalysis');
    expect(page).toContain('viral-choice-grid');
    expect(platformSnippet).not.toContain('<select');
    expect(css).toContain('.viral-source-status');
    expect(css).toContain('.viral-choice-button.active');
  });

  it('uses a compact dropdown for viral analyzer draft templates', async () => {
    const page = (await rendererSourcesPromise).requiredFile('src/features/viral/ViralAnalyzerPage.tsx');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(page).toContain('<Field label="草稿模板">');
    expect(page).toContain('className="viral-draft-template-select"');
    expect(page).toContain('value={templateId}');
    expect(page).toContain('onChange={(event) => setTemplateId(event.target.value)}');
    expect(page).toContain('state.draftTemplates.map((template) => (');
    expect(page).toContain('<option key={template.id} value={template.id}>');
    expect(page).not.toContain('ViralChoiceGroup title="草稿模板"');
    expect(css).toContain('.viral-draft-template-select');
  });

  it('surfaces Douyin login and cookie file controls in the viral analyzer', async () => {
    const page = (await rendererSourcesPromise).requiredFile('src/features/viral/ViralAnalyzerPage.tsx');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(page).toContain('api.openViralLoginWindow');
    expect(page).toContain('api.selectCookieFile');
    expect(page).toContain('const loginCookiePath = await api.openViralLoginWindow();');
    expect(page).toContain('setCookieFilePath(loginCookiePath);');
    expect(page).toContain('已保存 Cookie 文件');
    expect(page).toContain('viral-cookie-tools');
    expect(page).toContain('viral-cookie-input-row');
    expect(page).toContain('打开抖音登录窗口');
    expect(page).toContain('选择 Cookie 文件');
    expect(page).toContain('Cookie 文件');
    expect(css).toContain('.viral-cookie-tools');
    expect(css).toContain('.viral-cookie-input-row');
  });

  it('uses the dark renderer chrome as the only title bar and removes the trial strip', async () => {
    const app = (await rendererSourcesPromise).requiredFile('src/app/App.tsx');
    const shell = (await rendererSourcesPromise).requiredFile('src/app/AppShell.tsx');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');

    expect(shell).toContain('window-control-button');
    expect(app).toContain("api.windowControl('minimize')");
    expect(app).toContain("api.windowControl('toggle-maximize')");
    expect(app).toContain("api.windowControl('close')");
    expect(app).toContain('busy={shellAction.busy}');
    expect(shell).toContain('busy: boolean;');
    expect(shell).toContain('disabled={busy}');
    expect(shell).toContain('item={item} active={activeView === item.view} busy={busy}');
    expect(shell).not.toContain('className="trial-strip"');
    expect(shell).not.toContain('className="activation-link"');
    expect(shell).not.toContain('获取激活码');
    expect(css).toContain('grid-template-rows: 34px 1fr');
    expect(css).toContain('-webkit-app-region: drag');
    expect(css).toContain('-webkit-app-region: no-drag');
    expect(css).not.toContain('.trial-strip');
    expect(css).not.toContain('.activation-link');
    expect(apiContract).toContain("windowControl: (action: 'minimize' | 'toggle-maximize' | 'close') => Promise<void>");
  });

  it('gives the queue task list more horizontal room than the event history pane', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/features/tasks/QueuePage.tsx');
    const css = await readFile(new URL('../src/styles/features/task-operations.css', import.meta.url), 'utf8');

    expect(main).toContain('className="task-operations-view task-queue-view"');
    expect(css).toContain('.task-queue-view');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) 280px;');
  });

  it('presents draft templates as a gallery before opening the editor', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/features/templates/DraftTemplatesPage.tsx');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    for (const text of ['默认竖屏', '竖屏4:3', '横屏16:9', '编辑', '复制', '删除自定义模板', '新模板', '返回模板列表']) {
      expect(main).toContain(text);
    }

    expect(main).toContain('draft-template-gallery');
    expect(main).toContain('setEditingId');
    expect(main).toContain('api.deleteDraftTemplate(template.id)');
    expect(main).toContain('!template.isDefault');
    expect(main).toContain("draft-template-actions${template.isDefault ? '' : ' has-delete'}");
    expect(main).toContain('<Trash2 size={15} />删除');
    expect(main).toContain('<ConfirmDialog');
    expect(css).toContain('.draft-template-gallery');
    expect(css).toContain('.draft-template-thumb');
    expect(css).toContain('.draft-template-card:not(.new-template-card)');
    expect(css).toContain('.draft-template-actions.has-delete');
    expect(css).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
    const qa = await readFile(new URL('../electron/editorial-qa.ts', import.meta.url), 'utf8');
    expect(qa).toContain("labels.join('|') === '编辑|复制|删除'");
    expect(qa).toContain('widthSpread <= 1');
    expect(qa).toContain('.draft-template-card .danger-action');
  });

  it('allows an existing task to preview, persist, and manage its draft template', async () => {
    const [detail, routes, apiContract, preload, main, css] = await Promise.all([
      readFile(new URL('../src/features/tasks/TaskDetailPage.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/app/AppRoutes.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8'),
      readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8'),
      readFile(new URL('../electron/main.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/styles/features/task-operations.css', import.meta.url), 'utf8'),
    ]);

    expect(detail).toContain('选择任务草稿模板');
    expect(detail).toContain('TaskTemplateSelect');
    expect(detail).toContain('aria-haspopup="listbox"');
    expect(detail).toContain('className="task-template-select-menu"');
    expect(detail).toContain('应用模板');
    expect(detail).toContain('管理草稿模板');
    expect(detail).toContain('api.updateTaskTemplate');
    expect(routes).toContain("openTemplateManager={() => navigate('draft-templates')}");
    expect(apiContract).toContain("'task:update-template'");
    expect(apiContract).toContain('updateTaskTemplate: (id: string, templateId: string)');
    expect(preload).toContain("invokeTrusted('task:update-template', { id, templateId })");
    expect(main).toContain("trustedHandle('task:update-template'");
    expect(main).toContain('database.getDraftTemplateDetail(input.templateId)');
    expect(css).toContain('.task-template-switcher');
    expect(css).toContain('.task-template-select-menu');
    expect(css).toContain('background: var(--shell-surface);');
  });

  it('keeps async success feedback readable across shell themes', async () => {
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const start = css.indexOf('.inline-action-feedback.success');
    const rule = css.slice(start, css.indexOf('}', start) + 1);
    expect(start).toBeGreaterThan(-1);
    expect(rule).toContain('background: color-mix(in srgb, var(--ok) 10%, var(--shell-surface-raised));');
    expect(rule).toContain('color: var(--shell-text);');
    expect(rule).not.toContain('#d8f2cc');
  });

  it('imports copied Coze workflow source as a draft template preset', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/features/templates/DraftTemplatesPage.tsx');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const toolbarSnippet = main.slice(main.indexOf('className="panel-title-row draft-template-toolbar"'), main.indexOf('<section className="draft-template-gallery">'));

    expect(main).toContain('convertCozeWorkflowToDraftTemplate');
    expect(main).toContain('convertManyCozeWorkflowsToDraftTemplates');
    expect(main).toContain('cozeImportOpen');
    expect(main).toContain('setCozeImportOpen(true)');
    expect(main).toContain('setCozeImportOpen(false)');
    expect(main).toContain('cozeWorkflowSource');
    expect(main).toContain('cozeImportResult');
    expect(main).toContain('cozeImportResults');
    expect(main).toContain('previewCozeWorkflowTemplate');
    expect(main).toContain('saveCozeWorkflowTemplate');
    expect(main).toContain('saveAllCozeWorkflowTemplates');
    expect(toolbarSnippet).toContain('导入 Coze 模板');
    expect(toolbarSnippet).toContain('role="dialog"');
    expect(toolbarSnippet).toContain('aria-modal="true"');
    expect(toolbarSnippet).toContain('coze-template-import-backdrop');
    expect(toolbarSnippet).toContain('coze-template-import-dialog');
    expect(toolbarSnippet).toContain('onClick={() => setCozeImportOpen(false)}');
    expect(main).toContain('coze-workflow-source');
    expect(main).toContain('api.saveDraftTemplate(template)');
    expect(main).not.toContain('<section className="panel coze-template-import-panel">');
    expect(css).toContain('.coze-template-import-backdrop');
    expect(css).toContain('.coze-template-import-dialog');
    expect(css).toContain('.coze-template-import-panel');
    expect(css).toContain('.coze-diagnostics-list');
  });

  it('supports dragging draft template regions directly on the preview canvas', async () => {
    const sources = await rendererSourcesPromise;
    const main = [
      sources.requiredFile('src/features/templates/DraftTemplatesPage.tsx'),
      sources.requiredFile('src/features/templates/DraftCanvas.tsx'),
    ].join('\n');
    const appState = await appStateSourcePromise;
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(appState).toContain("normalizeDraftTemplate");
    expect(appState).toContain("draftTemplates: (state.draftTemplates ?? builtinDraftTemplates).map(normalizeDraftTemplate)");
    expect(main).toContain('EditableDraftCanvas');
    expect(main).toContain('DraftCanvasLayer');
    expect(main).toContain('handleDraftCanvasPointerDown');
    expect(main).toContain('onPointerMove');
    expect(main).toContain('setPointerCapture');
    expect(main).toContain('updateDraftLayerPosition');
    expect(main).toContain('坐标');
    expect(main).toContain("data-layer={layer}");
    expect(main).toContain('data-layer="image"');
    expect(css).toContain('.editable-draft-canvas');
    expect(css).toContain('.draft-layer');
    expect(css).toContain('.draft-layer.selected');
    expect(css).toContain('.draft-layer-handle');
  });

  it('reveals and scrolls to the matching draft controls when a canvas layer is selected', async () => {
    const [page, accordion] = await Promise.all([
      readFile(new URL('../src/features/templates/DraftTemplatesPage.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/Accordion.tsx', import.meta.url), 'utf8'),
    ]);

    expect(page).toContain('onSelectLayer={handleDraftLayerSelection}');
    expect(page).toContain('ref={draftControlsRef}');
    expect(page).toContain('setLayerPanelScrollRequest');
    expect(page).toContain('const editorReady = Boolean(editingId && draft)');
    expect(page).toContain('controls.scrollTo({');
    expect(page).toContain('controls.scrollTop + panelRect.top - containerRect.top - 8');
    expect(page).not.toContain('scrollIntoView');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.draft-layer > span\s*\{[\s\S]*?color: #f7fafc;/u);
    for (const layer of ['image', 'title', 'subtitle', 'caption', 'disclaimer']) {
      expect(page).toContain(`data-draft-layer-panel="${layer}"`);
      expect(page).toContain(`expanded={expandedLayerPanels.${layer}}`);
    }
    expect(accordion).toContain('expanded?: boolean;');
    expect(accordion).toContain('onExpandedChange?: (expanded: boolean) => void;');
    expect(accordion).toContain('controlledExpanded ?? uncontrolledExpanded');
    const qa = await readFile(new URL('../electron/editorial-qa.ts', import.meta.url), 'utf8');
    expect(qa).toContain('draftLayerPanelReady');
    expect(qa).toContain(".draft-layer[data-layer=\"subtitle\"].selected");
    expect(qa).toContain('page.scrollTop === pageScrollBefore');
    expect(qa).toContain('stage.scrollTop === stageScrollBefore');
  });

  it('renders draft preview layers with visibility and style fields', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/features/templates/DraftCanvas.tsx');

    expect(main).toContain('template.image.visible ?');
    expect(main).toContain('draftTextLayerStyle(template.title');
    expect(main).toContain('template.title.bold ? 800 : 500');
    expect(main).toContain('template.subtitle.text');
    expect(main).toContain('draftTextLayerStyle(template.caption');
    expect(main).toContain("textDecoration: text.underline ? 'underline' : 'none'");
    expect(main).toContain('draftTextLayerStyle(template.subtitle');
    expect(main).toContain('draftTextLayerStyle(template.disclaimer');
    expect(main).toContain('template.disclaimer.fontSize');
    expect(main).toContain('opacity: text.alpha');
    expect(main).toContain("textDecoration: text.underline ? 'underline' : 'none'");
    expect(main).toContain('textDecorationThickness');
    expect(main).toContain('textUnderlineOffset');
    expect(main).toContain("textDecorationSkipInk: 'none'");
    expect(main).toContain('textAlign: draftTextAlign(text.align)');
    expect(main).toContain('letterSpacing: `${text.letterSpacing}px`');
    expect(main).toContain('lineHeight: `${1 + text.lineSpacing / 10}`');
    expect(main).toContain('draftTextAlign');
    expect(main).toContain('colorWithAlpha');
    expect(main).toContain('draftPreviewFontSize');
    expect(main).toContain('cqw');
  });

  it('edits and previews Storybound-compatible camera motion and frame layout', async () => {
    const sources = await rendererSourcesPromise;
    const page = sources.requiredFile('src/features/templates/DraftTemplatesPage.tsx');
    const canvas = sources.requiredFile('src/features/templates/DraftCanvas.tsx');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    for (const text of ['运镜方式', '运镜强度', '分栏画框', '启用画框', '顶部起始色', '顶部结束色', '底部起始色', '底部结束色', '图片边框色', '图片边框宽度', '边框方向']) {
      expect(page).toContain(text);
    }
    expect(page).toContain('draftImageMotions.map');
    expect(page).toContain('min={0.5} max={2} step={0.1}');
    expect(page).toContain('updateDraftFrame');
    expect(canvas).toContain('DraftFrameChrome');
    expect(canvas).toContain('draftImageMotionStyle');
    expect(canvas).toContain('draftImageFrameStyle');
    expect(canvas).toContain('data-motion={template.image.motion');
    expect(css).toContain('@keyframes draft-motion-zoom_in');
    expect(css).toContain('@keyframes draft-motion-pan_right');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('does not reset unsaved draft template drag edits during state refreshes', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/features/templates/DraftTemplatesPage.tsx');

    expect(main).toContain('[editingId]');
    expect(main).toContain('const currentEditingTemplate = state.draftTemplates.find');
    expect(main).not.toContain('[editingId, editingTemplate]');
  });

  it('applies draft canvas ratio changes and selects background images from the editor', async () => {
    const sources = await rendererSourcesPromise;
    const main = [
      sources.requiredFile('src/features/templates/DraftTemplatesPage.tsx'),
      sources.requiredFile('src/features/templates/DraftCanvas.tsx'),
    ].join('\n');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(main).toContain('applyDraftCanvasRatio');
    expect(main).toContain('draftCanvasSizeForRatio');
    expect(main).toContain('selectDraftBackgroundImage');
    expect(main).toContain('selectLocalImage');
    expect(main).toContain('draftTemplateCanvasStyle');
    expect(main).toContain('type="color"');
    expect(main).toContain('backgroundImage:');
    expect(main).toContain('draft-background-field');
    expect(css).toContain('.draft-background-field');
    expect(css).toContain('.draft-background-swatch');
  });

  it('exposes complete grouped controls for draft template layers', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/features/templates/DraftTemplatesPage.tsx');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(main).toContain('ColorField');
    expect(main).toContain('ToggleField');
    expect(main).toContain('RangeField');
    expect(main).toContain('updateDraftTitle');
    expect(main).toContain('updateDraftSubtitle');
    expect(main).toContain('updateDraftCaption');
    expect(main).toContain('updateDraftCaptionBackground');
    expect(main).toContain('updateDraftDisclaimer');
    expect(main).toContain('显示');
    expect(main).toContain('透明度');
    expect(main).toContain('加粗');
    expect(main).toContain('下划线');
    expect(main).toContain('对齐');
    expect(main).toContain('字间距');
    expect(main).toContain('行间距');
    expect(main).toContain('每行字数');
    expect(main).toContain('背景透明度');
    expect(main).toContain('圆角');
    expect(css).toContain('.draft-color-field');
    expect(css).toContain('.draft-range-field');
    expect(css).toContain('.draft-toggle-field');
  });

  it('exposes text border controls and preview stroke for draft text layers', async () => {
    const sources = await rendererSourcesPromise;
    const main = [
      sources.requiredFile('src/features/templates/DraftTemplatesPage.tsx'),
      sources.requiredFile('src/features/templates/DraftCanvas.tsx'),
    ].join('\n');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    for (const symbol of [
      'TextBorderControls',
      'updateDraftTitleBorder',
      'updateDraftSubtitleBorder',
      'updateDraftCaptionBorder',
      'updateDraftDisclaimerBorder',
      'draftTextStrokeStyle',
      'template.title.border',
      'template.subtitle.border',
      'template.caption.border',
      'template.disclaimer.border',
      'textShadow',
    ]) {
      expect(main).toContain(symbol);
    }

    for (const text of ['描边颜色', '描边宽度', '描边透明度']) {
      expect(main).toContain(text);
    }

    expect(css).toContain('.draft-border-controls');
  });

  it('exposes StoryDream text style controls for every draft text layer', async () => {
    const sources = await rendererSourcesPromise;
    const main = [
      sources.requiredFile('src/features/templates/DraftTemplatesPage.tsx'),
      sources.requiredFile('src/features/templates/DraftCanvas.tsx'),
    ].join('\n');

    for (const symbol of [
      'updateDraftTitle({ underline: checked })',
      'updateDraftTitle({ align: Number(event.target.value) })',
      'updateDraftTitle({ letterSpacing: value })',
      'updateDraftTitle({ lineSpacing: value })',
      'updateDraftSubtitle({ underline: checked })',
      'updateDraftSubtitle({ align: Number(event.target.value) })',
      'updateDraftSubtitle({ letterSpacing: value })',
      'updateDraftSubtitle({ lineSpacing: value })',
      'updateDraftDisclaimer({ bold: checked })',
      'updateDraftDisclaimer({ underline: checked })',
      'updateDraftDisclaimer({ align: Number(event.target.value) })',
      'updateDraftDisclaimer({ letterSpacing: value })',
      'updateDraftDisclaimer({ lineSpacing: value })',
      'draftTextLayerStyle(template.title',
      'draftTextLayerStyle(template.subtitle',
      'draftTextLayerStyle(template.disclaimer',
      'text.underline',
      'text.align',
      'text.letterSpacing',
      'text.lineSpacing',
    ]) {
      expect(main).toContain(symbol);
    }
  });

  it('keeps draft layer controls compact instead of rendering oversized checkbox cards', async () => {
    const sources = await rendererSourcesPromise;
    const main = sources.requiredFile('src/features/templates/DraftTemplatesPage.tsx');
    const toggle = sources.requiredFile('src/components/ToggleField.tsx');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(toggle.includes('className="draft-toggle-row"')).toBe(true);
    expect(toggle.includes('draft-toggle-control')).toBe(true);
    expect(toggle.includes('className="draft-toggle-box"')).toBe(true);
    expect(main.includes('className="draft-inline-border-grid"')).toBe(true);
    expect(main.includes('className="draft-border-compact-panel"')).toBe(false);
    expect(main.indexOf('onChange={updateDraftTitleBorder}')).toBeGreaterThan(main.indexOf('onChange={(checked) => updateDraftTitle({ visible: checked })}'));
    expect(main.indexOf('onChange={updateDraftTitleBorder}')).toBeLessThan(main.indexOf('onChange={(checked) => updateDraftSubtitle({ visible: checked })}'));
    expect(main.indexOf('onChange={updateDraftSubtitleBorder}')).toBeGreaterThan(main.indexOf('onChange={(checked) => updateDraftSubtitle({ visible: checked })}'));
    expect(main.indexOf('onChange={updateDraftSubtitleBorder}')).toBeLessThan(main.indexOf('onChange={(checked) => updateDraftCaption({ visible: checked })}'));
    expect(main.indexOf('onChange={updateDraftCaptionBorder}')).toBeGreaterThan(main.indexOf('onChange={(checked) => updateDraftCaption({ visible: checked })}'));
    expect(main.indexOf('onChange={updateDraftCaptionBorder}')).toBeLessThan(main.indexOf('onChange={(checked) => updateDraftDisclaimer({ visible: checked })}'));
    expect(main.indexOf('onChange={updateDraftDisclaimerBorder}')).toBeGreaterThan(main.indexOf('onChange={(checked) => updateDraftDisclaimer({ visible: checked })}'));
    expect(main.includes('<Accordion title="文字描边">')).toBe(false);
    expect(css.includes("input[type='checkbox']")).toBe(true);
    expect(css.includes('width: 16px')).toBe(true);
    expect(css.includes('.draft-toggle-row')).toBe(true);
    expect(css.includes('.draft-toggle-control')).toBe(true);
    expect(css.includes('.draft-toggle-box')).toBe(true);
    expect(css).toMatch(/\.draft-toggle-box \{[\s\S]*?background: var\(--shell-surface-raised\);[\s\S]*?color: var\(--shell-text\);/u);
    expect(css).toMatch(/\.draft-toggle-control input\[type='checkbox'\]:checked \+ \.draft-toggle-box \{[\s\S]*?border-color: var\(--shell-accent\);[\s\S]*?background: var\(--shell-accent\);[\s\S]*?color: var\(--shell-focus-contrast\);/u);
    expect(css.includes('.draft-border-compact-panel')).toBe(false);
    expect(css.includes('.draft-inline-border-grid')).toBe(true);
    expect(css.includes('grid-template-columns: repeat(3, minmax(0, 1fr))')).toBe(true);
  });

  it('keeps the draft canvas visible while the right controls scroll independently', async () => {
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(css).toContain('.draft-editor-shell.focused');
    expect(css).toContain('align-items: start');
    expect(css).toContain('.draft-stage {');
    expect(css).toContain('position: sticky');
    expect(css).toContain('top: 0');
    expect(css).toContain('.draft-controls {');
    expect(css).toContain('max-height: calc(100vh - 150px)');
    expect(css).toContain('max-height: min(calc(100vh - 150px), calc(100vh - 220px))');
    expect(css).toContain('overflow-y: auto');
  });

  it('sizes the focused draft preview to the available viewport height', async () => {
    const sources = await rendererSourcesPromise;
    const main = [
      sources.requiredFile('src/features/templates/DraftTemplatesPage.tsx'),
      sources.requiredFile('src/features/templates/DraftCanvas.tsx'),
    ].join('\n');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(main).toContain("'--draft-canvas-ratio'");
    expect(css).toContain('.draft-editor-shell.focused .draft-preview-large');
    expect(css).toContain('calc((100vh - 310px) * var(--draft-canvas-ratio');
  });

  it('uses a preview-safe text stroke instead of rendering StoryDream 40px borders as giant shadows', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/features/templates/DraftCanvas.tsx');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(main).toContain('draftTextStrokeStyle');
    expect(main).toContain('WebkitTextStroke');
    expect(main).toContain('previewStrokeWidth');
    expect(main).not.toContain('for (let x = -width; x <= width; x += width)');
    expect(css).toContain('.draft-title,');
    expect(css).toContain('white-space: pre-line');
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).toContain('line-height: 1.15');
  });

  it('lets draft template text boxes be resized instead of using a fixed 80 percent width', async () => {
    const sources = await rendererSourcesPromise;
    const main = [
      sources.requiredFile('src/features/templates/DraftTemplatesPage.tsx'),
      sources.requiredFile('src/features/templates/DraftCanvas.tsx'),
    ].join('\n');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(main).toContain('resizeDraftLayerWidth');
    expect(main).toContain('handleDraftCanvasResizePointerDown');
    expect(main).toContain('onResizePointerDown');
    expect(main).toContain('draftTextWidthStyle');
    expect(main).toContain('label="文本框宽度"');
    expect(main).toContain('updateDraftCaptionWidth');
    expect(main).toContain('const DRAFT_TEXT_WIDTH_MAX = 2');
    expect(main).toContain('max={DRAFT_TEXT_WIDTH_MAX}');
    expect(main).toContain('width: `${clamp(width, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) * 100}%`');
    expect(main).toContain('positioned={false}');
    for (const snippet of [
      'value={draft.title.width} onChange={(value) => updateDraftTitle({ width: clamp(value, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) })}',
      'value={draft.subtitle.width} onChange={(value) => updateDraftSubtitle({ width: clamp(value, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) })}',
      'value={draft.caption.width} onChange={updateDraftCaptionWidth}',
      'value={draft.disclaimer.width} onChange={(value) => updateDraftDisclaimer({ width: clamp(value, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) })}',
    ]) {
      expect(main).toContain(snippet);
    }
    expect(main.indexOf('value={draft.title.width}')).toBeLessThan(main.indexOf('value={draft.title.fontSize}'));
    expect(main.indexOf('value={draft.subtitle.width}')).toBeLessThan(main.indexOf('value={draft.subtitle.fontSize}'));
    expect(main.indexOf('value={draft.caption.width}')).toBeLessThan(main.indexOf('value={draft.caption.fontSize}'));
    expect(main.indexOf('value={draft.disclaimer.width}')).toBeLessThan(main.indexOf('value={draft.disclaimer.fontSize}'));
    expect(css).toContain('cursor: ew-resize');
    expect(css).not.toContain('width: 80%;');
  });

  it('shows the full learned Jianying animation list in draft template controls', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/features/templates/DraftTemplatesPage.tsx');
    const templates = await readFile(new URL('../src/shared/templates.ts', import.meta.url), 'utf8');

    expect(main).toContain('options={imageAnimations}');
    expect(main).not.toContain('imageAnimations.slice(0, 8)');
    for (const animation of ['左拉镜', '右拉镜', '弹入旋转', '旋转回吸', '滑滑梯 II', '百叶窗 II', '立方体', '海盗船']) {
      expect(templates).toContain(animation);
    }
  });

  it('wires uploaded BGM management into settings and new task defaults', async () => {
    const main = (await rendererSourcesPromise).all;
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(main).toContain('selectLocalAudio');
    expect(main).toContain('addUploadedBgm');
    expect(main).toContain('resolveDefaultBgmId');
    expect(main).toContain('defaultBgmId');
    expect(main).toContain('无 BGM');
    expect(main).toContain('BGM 库为空');
    expect(main).toContain('volume: 0.25');
    expect(main).toContain('bgm-library-list');
    expect(css).toContain('.bgm-library-list');
    expect(css).toContain('.bgm-library-item');
  });

  it('offers auto-detect and folder-pick actions for the Jianying draft path setting', async () => {
    const settingsPage = (await rendererSourcesPromise).requiredFile('src/features/settings/SettingsPage.tsx');

    expect(settingsPage).toContain('detectJianyingDraftPath');
    expect(settingsPage).toContain('selectLocalFolder');
    expect(settingsPage).toContain('autoDetectJianyingDraftPath');
    expect(settingsPage).toContain('pickJianyingDraftPath');
    expect(settingsPage).toContain('自动检测');
    expect(settingsPage).toContain('选择目录');
  });

  it('loads Jianying effect catalogs and exposes conservative draft effect controls', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/features/templates/DraftTemplatesPage.tsx');

    expect(main).toContain('getJianyingEffectCatalog');
    expect(main).toContain('effectCatalog');
    expect(main).toContain('transitionType');
    expect(main).toContain('transitionDurationMs');
    expect(main).toContain('narrationFadeInMs');
    expect(main).toContain('narrationFadeOutMs');
    expect(main).toContain('bgmFadeInMs');
    expect(main).toContain('filterType');
    expect(main).toContain('videoEffectType');
    expect(main).toContain('audioEffectType');
  });

  it('sizes the draft preview from the canvas ratio instead of a fixed width', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/features/templates/DraftCanvas.tsx');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(main).toContain('draftPreviewWidth');
    expect(main).toContain("'--draft-preview-width'");
    expect(main).toContain('ratioToNumber(template.canvas.ratio)');
    expect(css).toContain('width: min(100%, var(--draft-preview-width');
    expect(css).not.toContain('width: min(100%, 420px)');
  });

  it('auto-matches prompt templates from task track and exposes an advanced override', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/features/tasks/NewTaskPage.tsx');

    expect(main).toContain('resolvePromptTemplateForTrack');
    expect(main).toContain('promptTemplateOverrideId');
    expect(main).toContain('prompt-template-selector');
    expect(main).toContain('提示词模板');
    expect(main).toContain('自动匹配赛道模板');
    expect(main).toContain('promptTemplateId: resolvedPromptTemplate?.id');
    expect(main).toContain("promptTemplateType: 'task'");
  });

  it('manages prompt templates with filters, metadata, variables, and save-as-new-template behavior', async () => {
    const sources = await rendererSourcesPromise;
    const main = [
      sources.requiredFile('src/features/templates/PromptTemplatesPage.tsx'),
      sources.requiredFile('src/features/templates/PromptTemplateEditor.tsx'),
    ].join('\n');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    for (const symbol of [
      'createPromptTemplate',
      'exportPromptTemplateJson',
      'templateTypeFilter',
      'templateTrackFilter',
      'templateMode',
      'prompt-template-gallery',
      'prompt-template-detail',
      'openPromptTemplateDetail',
      'savePromptTemplateDraft',
      'promptTemplateVariables',
    ]) {
      expect(main).toContain(symbol);
    }
    for (const text of ['新建模板', '导出 JSON', '类型筛选', '赛道筛选', '变量', '保存为自定义模板', '保存修改', '自定义模板保存会更新当前模板', '返回模板库', '查看']) {
      expect(main).toContain(text);
    }
    expect(css).toContain('.template-filter-row');
    expect(css).toContain('.variable-chip-row');
    expect(css).toContain('.prompt-template-gallery');
    expect(css).toContain('.prompt-template-detail');
  });

  it('builds prompt template track filters from saved templates so custom tracks remain visible', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/features/templates/PromptTemplatesPage.tsx');
    const filterSnippet = main.slice(main.indexOf('<Field label="赛道筛选">'), main.indexOf('<section className="prompt-template-list story-template-gallery">'));

    expect(main).toContain('promptTemplateTrackOptions');
    expect(main).toContain('buildStoryTemplateTrackOptions(state.promptTemplates)');
    expect(filterSnippet).toContain('promptTemplateTrackOptions.map(([id, label])');
    expect(filterSnippet).not.toContain('contentTracks.map');
  });

  it('preserves custom prompt template ids on save while forking built-in templates', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/features/templates/PromptTemplatesPage.tsx');
    const saveSnippet = main.slice(main.indexOf('async function savePromptTemplateDraft()'), main.indexOf('async function duplicateTemplate'));
    const duplicateSnippet = main.slice(main.indexOf('async function duplicateTemplate'), main.indexOf('async function duplicate()'));

    expect(saveSnippet).toContain('const shouldForkTemplate = Boolean(draft.isBuiltin)');
    expect(saveSnippet).toContain('id: shouldForkTemplate ? crypto.randomUUID() : draft.id');
    expect(saveSnippet).toContain('isBuiltin: false');
    expect(saveSnippet).toContain("origin: 'custom'");
    expect(saveSnippet).not.toContain('id: crypto.randomUUID(),');
    expect(saveSnippet).not.toContain('baseTemplateId');
    expect(duplicateSnippet).not.toContain('baseTemplateId');
    expect(main).not.toContain('<Field label="baseTemplateId">');
  });

  it('uses saved template tracks when binding prompt templates to content tracks', async () => {
    const sources = await rendererSourcesPromise;
    const main = [
      sources.requiredFile('src/features/templates/PromptTemplatesPage.tsx'),
      sources.requiredFile('src/features/templates/PromptTemplateEditor.tsx'),
    ].join('\n');
    const bindingSnippet = main.slice(main.indexOf('<Field label="绑定赛道">'), main.indexOf('</Field>', main.indexOf('<Field label="绑定赛道">')));

    expect(main).toContain('promptTemplateBindingTrackOptions');
    expect(bindingSnippet).toContain('promptTemplateBindingTrackOptions.map(([id, label])');
    expect(bindingSnippet).not.toContain('contentTracks.map');
  });

  it('binds newly created prompt templates to the active track filter when present', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/features/templates/PromptTemplatesPage.tsx');
    const createSnippet = main.slice(main.indexOf('async function createPromptTemplate()'), main.indexOf('async function saveCustomStyleDraft()'));

    expect(createSnippet).toContain("const baseTrack = templateTrackFilter === 'all' ? 'general-story' : templateTrackFilter");
    expect(createSnippet).toContain('baseTrack,');
    expect(createSnippet).not.toContain("baseTrack: 'general-story'");
  });

  it('keeps prompt template pages padded, scrollable, and tolerant of narrow row actions', async () => {
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    const scrollablePageRule = css.match(/\.new-task-scroll,[\s\S]*?\.lab-layout\s*\{[\s\S]*?overflow: auto;[\s\S]*?padding: 20px 26px;[\s\S]*?\}/)?.[0] ?? '';
    expect(scrollablePageRule).toContain('.prompt-template-gallery');
    expect(scrollablePageRule).toContain('.prompt-template-detail');
    expect(css).toMatch(/\.prompt-template-row-actions\s*\{[\s\S]*?flex-wrap: wrap;[\s\S]*?\}/);
  });

  it('opens prompt template details from the whole row without hijacking row action buttons', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/features/templates/PromptTemplatesPage.tsx');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(main).toContain('handlePromptTemplateRowKeyDown');
    expect(main).toContain('role="button"');
    expect(main).toContain('tabIndex={0}');
    expect(main).toContain('onClick={() => openPromptTemplateDetail(template)}');
    expect(main).toContain('event.stopPropagation()');
    expect(css).toMatch(/\.prompt-template-row\s*\{[\s\S]*?cursor: pointer;[\s\S]*?\}/);
  });

  it('lets each task prompt template configure the AI prompts used by every pipeline step', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/features/templates/PromptTemplateEditor.tsx');
    const options = await editorialOptionsSourcePromise;
    const promptSources = `${main}\n${options}`;
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    for (const symbol of ['promptStepEditorDefinitions', 'updatePromptTemplateStepPrompt', 'stepPrompts', 'prompt-step-editor-list', 'prompt-step-editor-card']) {
      expect(promptSources).toContain(symbol);
    }
    for (const text of ['AI 步骤设置', 'Step 0 预审', 'Step 1 改写', 'Step 1 元数据', 'Step 2 分镜', 'Step 3 出图']) {
      expect(promptSources).toContain(text);
    }
    expect(css).toContain('.prompt-step-editor-list');
    expect(css).toContain('.prompt-step-editor-card');
  });

  it('keeps prompt editing to a single content entry while preserving image seed pools', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/features/templates/PromptTemplateEditor.tsx');
    const storage = await readFile(new URL('../src/shared/storage.ts', import.meta.url), 'utf8');

    for (const symbol of [
      'imageSeedPoolsJson',
      'prompt-template-seed-pools',
    ]) {
      expect(main).toContain(symbol);
    }

    expect(main).not.toContain('prompt-template-reference-fields');
    expect(main).not.toContain('参考提示词内容');
    expect(main).not.toContain("draft.type === 'task' ? '任务总指令'");
    expect(main).toContain('key="task-template-content"');

    expect(storage).toContain('imageSeedPoolsJson');
  });

  it('presents prompt template details as basics, content settings, and step default prompts', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/features/templates/PromptTemplateEditor.tsx');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    for (const symbol of [
      'prompt-template-basics-card',
      'prompt-template-default-style-pills',
      'prompt-template-settings-card',
      'prompt-template-content-settings',
      'prompt-step-editor-section-title',
    ]) {
      expect(main).toContain(symbol);
      expect(css).toContain(`.${symbol}`);
    }

    for (const text of ['模板名', '描述（一句话说明这个模板的特点）', '默认画风', '设置内容', '步骤默认提示词']) {
      expect(main).toContain(text);
    }
  });

  it('uses Chinese labels for prompt template types and variable insertion chips', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/features/templates/PromptTemplateEditor.tsx');
    const options = await editorialOptionsSourcePromise;
    const promptSources = `${main}\n${options}`;
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(main).toContain('promptTemplateTypeLabels');
    expect(main).toContain('promptTemplateTypeLabel(type)');
    expect(main).toContain('promptTemplateVariableDefinitions');
    expect(main).toContain('prompt-template-variable-chip');
    expect(css).toContain('.prompt-template-variable-chip');

    for (const text of ['任务模板', '预审提示词', '改写提示词', '出图提示词', '原文素材', '联网资料', '预审结果', '改写正文', '额外要求']) {
      expect(promptSources).toContain(text);
    }
    expect(main).not.toContain('>{`{{${item}}}`}</button>');
  });

  it('documents the canonical StoryDream runtime variables in the template editor', async () => {
    const options = await editorialOptionsSourcePromise;

    for (const key of [
      'taskTemplateName',
      'defaultStyles',
      'defaultDraftTemplateId',
      'characterPolicy',
      'step3SkeletonModules',
      'referenceKind',
      'stylePrefix',
      'styleSuffix',
      'styleAllowColor',
      'styleNegativePrompt',
      'referenceImagePath',
      'imagePromptReference',
      'characterCard',
      'imageSeedPoolsJson',
    ]) {
      expect(options).toContain(`key: '${key}'`);
    }
  });

  it('keeps targetLength and storyboard scene count out of visible prompt variable scopes', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/features/templates/PromptTemplateEditor.tsx');
    const options = await editorialOptionsSourcePromise;

    expect(options).not.toContain("key: 'targetLength'");
    expect(options).not.toContain("key: 'targetLengthRange'");
    expect(options).not.toContain("key: 'storyboardSceneCount'");
    expect(main).toContain("step.type === 'review' || step.type === 'rewrite'");
    expect(main).toContain('<PromptVariablePicker');
    expect(main).toContain('scope={step.type}');
  });

  it('splits prompt template management into story and image template tabs', async () => {
    const sources = await rendererSourcesPromise;
    const main = [
      sources.requiredFile('src/features/templates/PromptTemplatesPage.tsx'),
      sources.requiredFile('src/features/templates/PromptTemplateEditor.tsx'),
    ].join('\n');
    const appState = await appStateSourcePromise;
    const promptSources = `${main}\n${appState}`;
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    for (const symbol of [
      'promptTemplateLibraryTab',
      'story-template-gallery',
      'image-template-gallery',
      'openImageTemplateDetail',
      'saveCustomStyleDraft',
      'generateCustomStyleDraft',
      'imageTemplateAiPrompt',
      'baseImageTemplateId',
      'mergeDefaultCustomStyles',
    ]) {
      expect(promptSources).toContain(symbol);
    }
    for (const text of ['故事模板', '图像模板', 'AI 快速生成', '基于系统风格', '前缀（prefix）', '后缀（suffix）', '负面提示词（negativePrompt）', '色彩模式']) {
      expect(main).toContain(text);
    }
    expect(css).toContain('.prompt-template-tabs');
    expect(css).toContain('.image-template-quick-card');
    expect(css).toContain('.image-template-field-grid');
  });

  it('shows visible feedback while generating image template fields', async () => {
    const sources = await rendererSourcesPromise;
    const main = [
      sources.requiredFile('src/features/templates/PromptTemplatesPage.tsx'),
      sources.requiredFile('src/features/templates/PromptTemplateEditor.tsx'),
    ].join('\n');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    for (const symbol of [
      'imageTemplateAiStatus',
      'imageTemplateAiGenerating',
      'image-template-ai-status',
      'aria-live="polite"',
      '正在生成字段',
      '已生成字段',
      '生成失败',
      '请先输入风格描述',
    ]) {
      expect(main).toContain(symbol);
    }
    expect(main).toContain('disabled={imageTemplateAiGenerating}');
    expect(css).toContain('.image-template-ai-status');
  });

  it('keeps prompt variables usable inside every template textarea', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/features/templates/PromptTemplateEditor.tsx');
    const options = await editorialOptionsSourcePromise;
    const promptSources = `${main}\n${options}`;
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    for (const symbol of [
      'VariableAwareTextarea',
      'insertPromptVariable',
      'prompt-variable-suggest',
      'onVariableInsert',
      'placeholder="输入 // 选择变量"',
      '{{${item.key}}',
      '英文变量',
      'PromptTemplateVariableScope',
      'promptTemplateVariablesForScope',
      "scopes: ['task']",
      "scopes: ['rewrite']",
      "scopes: ['image-prompt']",
      'variables={promptTemplateVariablesForScope',
      'variables.map((item) =>',
      'rewriteIntensity',
      'narrativePov',
      'keepPromotion',
      'aiKeyword',
    ]) {
      expect(promptSources).toContain(symbol);
    }
    expect(main).not.toContain('promptTemplateVariableDefinitions.map((item) => (');
    expect(css).toContain('.prompt-variable-suggest');
    expect(css).toContain('.prompt-variable-token');
  });

  it('supports import, export, and clone for story and image templates without overwriting existing ids', async () => {
    const sources = await rendererSourcesPromise;
    const main = [
      sources.requiredFile('src/features/templates/PromptTemplatesPage.tsx'),
      sources.requiredFile('src/features/templates/PromptTemplateEditor.tsx'),
    ].join('\n');

    for (const symbol of [
      'exportPromptTemplateJson',
      'importPromptTemplateJson',
      'exportImageTemplateJson',
      'importImageTemplateJson',
      'templateJsonDraft',
      'imageTemplateJsonDraft',
      'resolveImportedTemplateId',
      'duplicateTemplate',
      'duplicateImageTemplate',
    ]) {
      expect(main).toContain(symbol);
    }
    expect(main).toContain('state.promptTemplates.some((template) => template.id === imported.id)');
    expect(main).toContain('state.customStyles.some((style) => style.id === imported.id)');
  });

  it('syncs all story template defaults when changing story templates in new task', async () => {
    const main = (await rendererSourcesPromise).all;

    expect(main).toContain('handleStoryTemplateChange');
    expect(main).toContain('setTrack(nextTrack)');
    expect(main).toContain('setPromptTemplateOverrideId(nextTemplateId)');
    expect(main).toContain('promptTemplateManuallyOverridden');
    expect(main).toContain('styleManuallyOverridden');
    expect(main).toContain('draftTemplateManuallyOverridden');
    expect(main).toContain('resolvePromptTemplateDefaultStyleId');
    expect(main).toContain('resolvePromptTemplateDefaultDraftTemplateId');
    expect(main).toContain('handleDraftTemplateChange');
    expect(main).toContain('draftTemplateImageRatio');
    expect(main).toContain('模板默认项');
    expect(main).toContain('主角档案');
    expect(main).toContain('默认草稿模板');
    expect(main).toContain('参考图类型');
    expect(main).toContain('Step 3 骨架');
    expect(main).toContain('setRatio(draftTemplateImageRatio');
    expect(main).toContain('defaultStyles: [style.id]');
    expect(main).toContain('defaultDraftTemplateId');
    expect(main).not.toContain('toggleArray(resolvePromptTemplateDefaultStyleIds(draft), style.id)');
    expect(main).not.toContain('OptionCloud title="草稿模板" options={state.draftTemplates.map((template) => [template.id, template.name, `出图 ${template.image.ratio}`])} value={templateId} onChange={setTemplateId}');
  });

  it('keeps new-task draft template choices limited to the saved default/user templates', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/features/tasks/NewTaskPage.tsx');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(main).toContain('defaultTaskDraftTemplateId');
    expect(main).toContain('state.draftTemplates.map((template) => <option key={template.id} value={template.id}>');
    expect(main).not.toContain('feishuCozeDraftTemplateBundle');
    expect(main).not.toContain('bundledDraftTemplateOptionIds');
    expect(main).not.toContain('isBundledDraftTemplateOption');
    expect(main).not.toContain('primaryDraftTemplates');
    expect(main).not.toContain('alternateDraftTemplates');
    expect(main).not.toContain('draft-template-alternate-select');
    expect(main).not.toContain('<option value="">选择备选模板</option>');
    expect(main).not.toContain("const initialDraftTemplateId = state.draftTemplates[0]?.id ?? 'default-portrait-9-16'");
    expect(css).not.toContain('.draft-template-alternate-select');
  });

  it('supports opening a selected task in a screenshot-style pipeline detail view', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/app/App.tsx');
    const routes = (await rendererSourcesPromise).requiredFile('src/app/AppRoutes.tsx');
    const settingsPage = (await rendererSourcesPromise).requiredFile('src/features/settings/SettingsPage.tsx');
    const detail = (await rendererSourcesPromise).requiredFile('src/features/tasks/TaskDetailPage.tsx');
    const artifact = (await rendererSourcesPromise).requiredFile('src/features/tasks/TaskArtifactPreview.tsx');
    const types = await readFile(new URL('../src/shared/types.ts', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(types).toContain("'task-detail'");
    expect(main).toContain('selectedTaskId');
    expect(main).toContain('openTaskDetail');
    expect(routes).toContain('TaskDetailPage');
    expect(detail).toContain('taskProgressStages(activeTask)');
    expect(detail).toContain('{progress.total} 步流水线');
    for (const text of ['历史任务', '任务详情', '结果', '分镜', '图片', '配音', '事件', '等待当前步骤产物落盘']) {
      expect(`${main}\n${routes}\n${detail}\n${artifact}`).toContain(text);
    }
    expect(css).toContain('.task-detail-shell');
    expect(css).toContain('.pipeline-step');
    expect(css).toContain('.artifact-preview');
  });

  it('loads and renders all pipeline artifact steps in task detail preview tabs', async () => {
    const detail = (await rendererSourcesPromise).requiredFile('src/features/tasks/TaskDetailPage.tsx');
    const artifact = (await rendererSourcesPromise).requiredFile('src/features/tasks/TaskArtifactPreview.tsx');
    const taskSources = `${detail}\n${artifact}`;
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const electronMain = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');

    expect(preload).toContain('getTaskArtifacts');
    expect(electronMain).toContain('task:get-artifacts');
    expect(taskSources).toContain('getTaskArtifacts');
    expect(taskSources).toContain('ArtifactPreviewContent');
    for (const text of ['文案预审', '改写产物', '封面信息', '分镜分句', '绘图提示词', '批量生图', '配音字幕', '草稿输出']) {
      expect(taskSources).toContain(text);
    }
    expect(css).toContain('.artifact-section');
    expect(css).toContain('.artifact-text-block');
    expect(css).toContain('.artifact-scene-list');
  });

  it('renders per-scene image provider errors below the matching storyboard gallery card', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/features/tasks/TaskArtifactPreview.tsx');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(main).toContain('const imageErrors = snapshot?.assets.imageErrors ?? []');
    expect(main).toContain('imageErrors={imageErrors}');
    expect(main).toContain('className="artifact-image-error"');
    expect(css).toContain('.artifact-image-error');
  });

  it('shows per-step rerun controls in artifact preview sections', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/features/tasks/TaskArtifactPreview.tsx');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');

    expect(preload).toContain('rerunTaskStep');
    expect(main).toContain('rerunTaskStep');
    expect(main).toContain('ArtifactStepActions');
    expect(main).toContain('重新生成');
    expect(main).toContain('改写后继续');
    expect(main).toContain('actions={artifactStepActions(1)}');
    expect(main).toContain('actions={artifactStepActions(6)}');
    expect(css).toContain('.artifact-section-actions');
  });

  it('refreshes task artifact snapshots while image generation is still running', async () => {
    const detail = (await rendererSourcesPromise).requiredFile('src/features/tasks/TaskDetailPage.tsx');
    const artifact = (await rendererSourcesPromise).requiredFile('src/features/tasks/TaskArtifactPreview.tsx');
    const main = `${detail}\n${artifact}`;

    expect(main).toContain('artifactRefreshKey');
    expect(main).toContain('artifactRefreshTick');
    expect(main).toContain('latestEvent?.id');
    expect(main).toContain('snapshotImageCount');
    expect(main).toContain('snapshotStepStatus(snapshot, 4)');
    expect(main).toContain('imageProgressLabel');
    expect(main).toContain('图片进度');
  });

  it('keeps storyboard sentences and generated images in independent task detail tabs', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/features/tasks/TaskArtifactPreview.tsx');

    const storyboardStart = main.indexOf("{tab === 'storyboard' ? (");
    const imagesStart = main.indexOf("{tab === 'images' ? (", storyboardStart);
    const audioStart = main.indexOf("{tab === 'audio' ? (", imagesStart);
    const storyboardBranch = main.slice(storyboardStart, imagesStart);
    const imagesBranch = main.slice(imagesStart, audioStart);

    expect(storyboardStart).toBeGreaterThan(-1);
    expect(imagesStart).toBeGreaterThan(storyboardStart);
    expect(audioStart).toBeGreaterThan(imagesStart);
    expect(storyboardBranch).toContain('ArtifactSceneList');
    expect(storyboardBranch).not.toContain('ImageGenerationGallery');
    expect(imagesBranch).toContain('ArtifactSection title="批量生图"');
    expect(imagesBranch).toContain('ImageGenerationGallery');
    expect(imagesBranch).not.toContain('ArtifactSceneList');
    expect(storyboardBranch).not.toContain('storyboard-gallery-hero');
    expect(storyboardBranch).not.toContain('ArtifactSection title="绘图提示词"');
  });

  it('does not keep the duplicate legacy artifact preview card in task detail', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/features/tasks/TaskDetailPage.tsx');

    expect(main).not.toContain('legacy-artifact-preview');
    expect(countOccurrences(main, '<ArtifactPreviewContent')).toBe(1);
  });

  it('uses one bootstrap and delta updates without a one-second full-state heartbeat', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/app/App.tsx');
    const settingsPage = (await rendererSourcesPromise).requiredFile('src/features/settings/SettingsPage.tsx');
    const detail = (await rendererSourcesPromise).requiredFile('src/features/tasks/TaskDetailPage.tsx');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(main).toContain('api.getBootstrap()');
    expect(main).toContain('api.onAppDelta');
    expect(main).toContain('api.reconcileDeltas');
    expect(main).not.toContain('liveRefreshMs');
    expect(main).not.toContain('api.getState()');
    expect(detail).toContain('liveNow');
    expect(settingsPage).toContain('testCurrentConfig');
    expect(settingsPage).toContain('保存并测试');
    expect(settingsPage).not.toContain('测试模型可用性');
    expect(css).toContain('.test-result');
  });

  it('preserves governed history pages through bootstrap and constructs complete browser fallback pages', async () => {
    const appState = await appStateSourcePromise;
    const browserFallback = await browserFallbackSourcePromise;
    const loader = appState.slice(appState.indexOf('export async function loadCompleteBootstrap'), appState.indexOf('export function cloneState'));
    const pageFactory = browserFallback.slice(browserFallback.indexOf('function fallbackHistoryPage'), browserFallback.indexOf('export function makeFallbackApi'));
    const fallback = browserFallback.slice(browserFallback.indexOf('export function makeFallbackApi'));
    const bootstrap = fallback.slice(fallback.indexOf('async getBootstrap()'), fallback.indexOf('async reconcileDeltas'));
    const families = [
      ['tasks', 'listTasks', 'task'],
      ['viralAnalyses', 'listViralAnalyses', 'viral-analysis'],
      ['imageLabRecords', 'listImageLabRecords', 'image-lab'],
      ['voiceLabRecords', 'listVoiceLabRecords', 'voice-lab'],
    ] as const;

    expect(loader).toContain('...bootstrap');
    expect(loader).toContain('collectCursorPages(bootstrap.promptTemplates');
    expect(loader).toContain('collectCursorPages(bootstrap.draftTemplates');
    expect(pageFactory).toContain('family: F');
    expect(pageFactory).toContain('totalCount: items.length');
    expect(pageFactory).toContain('hasMore: false');
    expect(pageFactory).toContain('nextCursor: null');

    for (const [property, method, family] of families) {
      expect(loader, `${property} keeps the server-owned first page`).not.toContain(`collectCursorPages(bootstrap.${property}`);
      expect(loader, `${property} metadata is not overwritten`).not.toContain(`${property}:`);
      expect(bootstrap, `browser bootstrap owns ${property}`).toMatch(
        new RegExp(`${property}:\\s*fallbackHistoryPage\\(\\s*'${family}'`, 'u'),
      );
      const methodStart = fallback.indexOf(`async ${method}`);
      const methodEnd = fallback.indexOf('\n    async ', methodStart + 10);
      expect(methodStart, `${method} fallback exists`).toBeGreaterThan(-1);
      expect(fallback.slice(methodStart, methodEnd), `${method} constructs a complete page`).toMatch(
        new RegExp(`fallbackHistoryPage\\(\\s*'${family}'`, 'u'),
      );
    }
  });

  it('queues reconciliation gaps that arrive in flight and preserves loaded template details on reset', async () => {
    const sources = await rendererSourcesPromise;
    const main = sources.requiredFile('src/app/App.tsx');
    const app = main;

    expect(app).toContain('let reconcileAgain = false');
    expect(app).toContain('let reconcileAgainWithReset = false');
    expect(app).toMatch(/if \(reconciling\) \{\s+reconcileAgain = true;\s+reconcileAgainWithReset \|\|= forceReset;\s+return;\s+\}/u);
    expect(app).toMatch(/if \(reconcileAgain && !disposed && !snapshotInstalling && !reconciling\) \{\s+reconcileAgain = false;\s+const reset = reconcileAgainWithReset;\s+reconcileAgainWithReset = false;\s+void reconcile\(undefined, reset\);\s+\}/u);
    expect(app).toMatch(/mergeAuthoritativeSnapshotDetails\(\s*current,\s*rebuiltState,\s*preserveTemplateDetails,/u);
    expect(app).toContain('authoritativeTaskDetailIds?: ReadonlySet<string>');
    expect(app).toContain('guardedResult.task ? new Set([guardedResult.task.id]) : undefined');
  });

  it('invalidates requested detail before installing a reset that confirms authoritative task absence', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/app/App.tsx');
    const app = main;
    const refreshTask = app.slice(app.indexOf('const refreshTaskDetail'), app.indexOf('const refreshViralEvents'));
    const reset = app.slice(app.indexOf('if (result.resetRequired)'), app.indexOf('result.deltas.forEach'));

    expect(refreshTask).toMatch(/dispatchState\(\{[\s\S]*?update: \(current\) => taskDetailGuard\.isCurrent\(taskId, generation\)[\s\S]*?mergeReconciliationSlices[\s\S]*?completionToken,[\s\S]*?\}\);/u);
    expect(refreshTask).toMatch(/const completionToken = taskDetailCompletionQueue\.defer\(taskId, generation\)[\s\S]*?dispatchState\(/u);
    expect(app).toContain('const taskDetailCompletionEpoch = trackedState.completionToken');
    expect(app).not.toContain('setTaskDetailCompletionEpoch');
    expect(refreshTask).toContain('attempt < MAX_TASK_DETAIL_REVISION_ATTEMPTS');
    expect(refreshTask).toContain('historyResponseDisposition(responseRevision, currentRevision)');
    expect(refreshTask).toContain("if (disposition === 'discard') return;");
    expect(refreshTask).toContain("if (disposition === 'retry') continue;");
    expect(app).not.toContain('[task-detail-trace]');
    expect(refreshTask).toMatch(/finally \{\s+if \(!completionDeferred\) taskDetailGuard\.finish\(taskId, generation\);\s+\}/u);
    expect(app).toContain('taskDetailCompletionQueue.flushThrough(taskDetailCompletionEpoch)');
    expect(app).not.toContain('taskDetailCompletionQueue.flush()');
    expect(reset).toContain('authoritativeMissingRequestedTaskId(');
    expect(reset).toMatch(/authoritativeMissingRequestedTaskId\(\s*requestedTaskId,\s*result\.task,\s*rebuiltResetState\.tasks/u);
    expect(reset).toMatch(/if \(missingRequestedTaskId\) \{[\s\S]*?applyHistoryEntityBarrier\('task', missingRequestedTaskId\);[\s\S]*?\}\s*installAuthoritativeSnapshot/u);
  });

  it('buffers bounded state patches across authoritative snapshot installation and error recovery', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/app/App.tsx');
    const app = main;

    expect(main).toContain('MAX_RENDERER_DELTA_BUFFER');
    expect(main).toContain('applyBufferedMutationResults');
    expect(main).toContain('raiseMutationRevisionFloor');
    expect(app).toContain('let snapshotInstalling = true');
    expect(app).toContain('const bufferedMutationResults = new Map<number, AppMutationResult>()');
    expect(app).toContain('bufferedMutationResults.size >= MAX_RENDERER_DELTA_BUFFER');
    expect(app).toContain("delta.kind !== 'task-event'");
    expect(app).toContain('installAuthoritativeSnapshot');
    expect(app).toContain('recoverSnapshotInstallation');
    expect(countOccurrences(app, 'recoverSnapshotInstallation(')).toBeGreaterThanOrEqual(2);
    expect(app).toContain('requestReconciliation(true)');
  });

  it('uses app deltas as the sole Electron mutation owner and keeps response application local to browser fallback', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/app/App.tsx');
    const browserFallback = await browserFallbackSourcePromise;
    const applyState = main.slice(main.indexOf('function applyState('), main.indexOf('async function openTaskDetail'));
    const fallback = browserFallback.slice(browserFallback.indexOf('export function makeFallbackApi('));

    expect(main).toContain('applyLocalMutationResponse');
    expect(applyState).toContain('if (isBrowserPreview && next)');
    expect(applyState).toContain('applyLocalMutationResponse(current, next, new Map(claimedRevisions), true)');
    expect(applyState).not.toContain('applyAppMutationResult(');
    expect(fallback).toContain('setState(sanitized)');
  });

  it('keeps authoritative snapshot replay updaters pure under StrictMode double invocation', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/app/App.tsx');
    const app = main;
    const install = app.slice(app.indexOf('const installAuthoritativeSnapshot'), app.indexOf('const recoverSnapshotInstallation'));
    const recover = app.slice(app.indexOf('const recoverSnapshotInstallation'), app.indexOf('const applyIncomingDelta'));

    for (const section of [install, recover]) {
      expect(section).toContain('const replayRevisionFloor = new Map(mutationRevisionsRef.current)');
      expect(section).toContain('const finalRevision = Math.max(');
      expect(section).toContain('raiseMutationRevisionFloor(mutationRevisionsRef.current, finalRevision)');
      expect(section).toContain('const localMutationRevisions = new Map(replayRevisionFloor)');
      expect(section).toContain('localMutationRevisions,');
      const updater = section.slice(section.indexOf('setState((current) => {'));
      expect(updater).not.toContain('raiseMutationRevisionFloor(mutationRevisionsRef.current');
      expect(updater).not.toContain('applyBufferedMutationResults(\n          current,\n          buffered,\n          snapshotRevision,\n          mutationRevisionsRef.current');
    }
  });

  it('claims live and browser mutations before scheduling pure state updaters', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/app/App.tsx');
    const app = main;
    const livePatch = app.slice(app.indexOf('const applyMutationDelta'), app.indexOf('const requestReconciliation'));
    const browserApply = app.slice(app.indexOf('function applyState('), app.indexOf('async function openTaskDetail'));

    expect(main).toContain('claimMutationResult');
    for (const section of [livePatch, browserApply]) {
      expect(section).toContain('const claimedRevisions = claimMutationResult(');
      expect(section).toContain('if (!claimedRevisions) return');
      expect(section).toContain('new Map(claimedRevisions)');
      const updater = section.slice(section.indexOf('setState((current) =>'));
      expect(updater).not.toContain('mutationRevisionsRef.current');
    }
  });

  it('loads active HTML task details on bootstrap and checkpoint summary changes', async () => {
    const sources = await rendererSourcesPromise;
    const main = sources.requiredFile('src/app/App.tsx');
    const app = main;
    const htmlPage = sources.requiredFile('src/features/html-video/HtmlVideoPage.tsx');

    expect(app).toContain('activeHtmlTaskIdRef');
    expect(app).toContain('refreshTaskDetail');
    expect(htmlPage).toContain('taskDetailRefreshKey(activeTask)');
    expect(htmlPage).toContain('refreshTaskDetail(activeTask.id)');
    expect(htmlPage).toContain('onActiveTaskChange(activeTask.id)');
  });

  it('loads active viral events and includes both active entities in reconciliation', async () => {
    const sources = await rendererSourcesPromise;
    const main = sources.requiredFile('src/app/App.tsx');
    const app = main;
    const viralPage = sources.requiredFile('src/features/viral/ViralAnalyzerPage.tsx');

    expect(app).toContain('viralAnalysisId: requestedViralId ?? undefined');
    expect(app).toContain('mergeReconciliationSlices');
    expect(app).toContain('refreshViralEvents');
    expect(viralPage).toContain('viralEventRefreshKey(selected)');
    expect(viralPage).toContain('refreshViralEvents(selected.id)');
    expect(viralPage).toContain('onActiveAnalysisChange(selected.id)');
  });

  it('shows save and test actions for each settings configuration section', async () => {
    const sources = await rendererSourcesPromise;
    const settingsPage = sources.requiredFile('src/features/settings/SettingsPage.tsx');
    const settingsManagers = sources.requiredFile('src/features/settings/ProviderProfileManagers.tsx');
    const settingsOwners = `${settingsPage}\n${settingsManagers}`;
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const electronMain = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');

    expect(apiContract).toContain('testAppConfig');
    expect(preload).toContain('config:test');
    expect(electronMain).toContain('config:test');
    expect(settingsPage).toContain('testCurrentConfig');
    expect(settingsPage).toContain('保存并测试');
    expect(settingsPage).toContain('buildConfigForSelectedProfileTest');
    expect(settingsPage).toContain('activateSelectedProviderProfileForTarget');
    expect(settingsPage).toContain('const saveAction = useAsyncAction();');
    const saveSnippet = settingsPage.slice(settingsPage.indexOf('async function commitAndApplySettingsDraft'), settingsPage.indexOf('function clearProviderModels'));
    expect(saveSnippet).toContain('await saveAction.run(');
    expect(saveSnippet).not.toContain('await settingsAction.run(');
    expect(settingsPage).toContain('disabled={savingConfig || saveAction.busy}');
    const testSnippet = settingsPage.slice(settingsPage.indexOf('async function testCurrentConfig()'), settingsPage.indexOf('async function refreshProviderModels'));
    const secureSaveCall = 'api.saveConfig({ config: normalizeEditableConfigProviders(nextDraft), secretChanges })';
    expect(testSnippet.indexOf('const nextDraft = activateSelectedProviderProfileForTarget')).toBeLessThan(testSnippet.indexOf(secureSaveCall));
    expect(testSnippet.indexOf(secureSaveCall)).toBeLessThan(testSnippet.indexOf('api.testAppConfig(target, testConfig)'));
    expect(settingsOwners).toContain('selectedLlmProfileId');
    expect(settingsOwners).toContain('selectedImageProfileId');
    expect(settingsOwners).toContain('selectedTtsProfileId');
    expect(settingsOwners).toContain('onSelectedProfileIdChange');
    expect(settingsOwners).toContain('GPT Image 接口地址');
    expect(settingsOwners).toContain('GPT Image 模型');
    expect(settingsOwners).toContain('自定义接口密钥');
    expect(settingsOwners).toContain('自定义模型');
    expect(settingsOwners).toContain('即梦访问密钥 ID');
    expect(settingsOwners).toContain('即梦访问密钥 Secret');
    expect(settingsOwners).toContain('即梦请求 Key');
    expect(settingsOwners).toContain('MiniMax 模型');
    expect(settingsOwners).toContain('MiniMax 音色 ID');
  });

  it('tests the selected LLM profile without mutating the saved configuration', async () => {
    const settingsPage = (await rendererSourcesPromise).requiredFile('src/features/settings/SettingsPage.tsx');
    const testSnippet = settingsPage.slice(
      settingsPage.indexOf('async function testSelectedLlmConfig()'),
      settingsPage.indexOf('async function refreshProviderModels'),
    );

    expect(settingsPage).toContain('仅测试当前 LLM');
    expect(testSnippet).toContain('api.testLlmConfig(selectedLlmTestConfig.llm)');
    expect(testSnippet).toContain('if (selectedLlmTestBlocked)');
    expect(testSnippet).toContain('setConfigTestResult(`[${result.status}] ${result.detail}`)');
    expect(testSnippet).not.toContain('api.saveConfig');
    expect(settingsPage).toContain("section === 'llm'");
    expect(settingsPage).toContain('hasPendingLlmSecretChange(secretChanges, selectedLlmTestConfig.llm.id)');
    expect(settingsPage).toContain('const selectedLlmProfilePersisted = state.config.llmProfiles.some((profile) => profile.id === selectedLlmTestConfig.llm.id)');
    expect(settingsPage).toContain('const selectedLlmTestBlocked = selectedLlmSecretPending || !selectedLlmProfilePersisted;');
    expect(settingsPage).toContain('disabled={testingConfig || savingConfig || settingsAction.busy || selectedLlmTestBlocked}');

    const electronMain = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const mainHandler = electronMain.slice(electronMain.indexOf("trustedHandle('llm:test-config'"), electronMain.indexOf("trustedHandle('models:list'"));
    expect(mainHandler).not.toContain('?? runtime.llm');
    expect(mainHandler).toContain('LLM_TEST_PROFILE_NOT_PERSISTED');
  });

  it('keeps renderer command owners attached to their route modules', async () => {
    const sources = await rendererSourcesPromise;
    const expectations: Array<[string, string[]]> = [
      ['src/app/App.tsx', ['saveUiPreferences', 'windowControl']],
      ['src/features/account/AccountPage.tsx', ['saveAccount']],
      ['src/features/account/ActivationPage.tsx', ['saveActivation']],
      ['src/features/settings/SettingsPage.tsx', ['runDiagnostics', 'saveConfig', 'testAppConfig']],
      ['src/features/tasks/NewTaskPage.tsx', ['createAndRunTask', 'searchWebSources']],
      ['src/features/tasks/TaskArtifactPreview.tsx', ['regenerateTaskNarration', 'rerunTaskStep', 'updateTaskImagePrompt']],
      ['src/features/templates/PromptTemplatesPage.tsx', ['resetPromptTemplates']],
      ['src/features/viral/ViralAnalyzerPage.tsx', ['retryViralAnalysis', 'selectCookieFile', 'updateViralAnalysisStatus']],
    ];

    for (const [path, methods] of expectations) {
      const source = sources.requiredFile(path);
      for (const method of methods) expect(source, `${path} owns ${method}`).toContain(`api.${method}`);
    }
  });

  it('adds speech-to-text API settings for viral analyzer transcription', async () => {
    const sources = await rendererSourcesPromise;
    const settingsPage = sources.requiredFile('src/features/settings/SettingsPage.tsx');
    const viralPage = sources.requiredFile('src/features/viral/ViralAnalyzerPage.tsx');

    for (const text of [
      '语音转文字',
      '转写 API',
      '接口地址',
      '接口密钥',
      '转写模型',
      '语言',
      '提示词',
      '响应格式',
      '温度',
      '时间戳',
      '段落级',
      '词级',
      '切分策略',
      '请求超时',
      'SiliconFlow',
      'FunAudioLLM/SenseVoiceSmall',
      'TeleAI/TeleSpeechASR',
    ]) {
      expect(settingsPage).toContain(text);
    }

    expect(settingsPage).toContain("configTargetStatus('speechToText', draftWithCredentialStatus)");
    expect(settingsPage).toContain("section === 'speechToText'");
    expect(settingsPage).toContain('updateSpeechToTextConfig');

    expect(viralPage).not.toContain('whisperModel');
    expect(viralPage).not.toContain('huggingFaceEndpoint');
  });

  it('loads model lists from configured provider URLs before selecting a model', async () => {
    const sources = await rendererSourcesPromise;
    const settingsOwners = [
      sources.requiredFile('src/features/settings/SettingsPage.tsx'),
      sources.requiredFile('src/features/settings/ProviderProfileManagers.tsx'),
      sources.requiredFile('src/features/settings/settings-controls.tsx'),
    ].join('\n');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const electronMain = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');

    expect(preload).toContain('listProviderModels');
    expect(electronMain).toContain('models:list');
    expect(settingsOwners).toContain('ModelPicker');
    expect(settingsOwners).toContain('LlmProfileManager');
    expect(settingsOwners).toContain('refreshProviderModels');
    expect(settingsOwners).toContain('clearProviderModels');
    expect(settingsOwners).toContain('listProviderModels');
    expect(settingsOwners).toContain('获取模型');
    expect(settingsOwners).toContain('key={`llm-${selectedProfile.id}`}');
    expect(settingsOwners).toContain('key={`gpt-image-${selectedProfile.id}`}');
    expect(settingsOwners).toContain('key={`custom-image-${selectedProfile.id}`}');
    expect(settingsOwners).toContain("clearProviderModels('llm')");
    expect(settingsOwners).toContain("onClearModels('gpt-image')");
    expect(settingsOwners).toContain("onClearModels('custom-image')");
    expect(css).toContain('.model-picker');
    expect(css).toContain('.model-list-status');
  });

  it('keeps unsaved settings edits when app state refreshes in the background', async () => {
    const settingsPage = (await rendererSourcesPromise).requiredFile('src/features/settings/SettingsPage.tsx');

    expect(settingsPage).toContain('settingsDirty');
    expect(settingsPage).toContain('setSettingsDraft');
    expect(settingsPage).toContain('commitSettingsDraft');
    expect(settingsPage).toContain('lastAppliedConfigSignature');
    expect(settingsPage).toContain('if (settingsDirty) return');
  });

  it('manages multiple LLM configuration profiles from a switcher-style list', async () => {
    const sources = await rendererSourcesPromise;
    const settingsOwners = `${sources.requiredFile('src/features/settings/SettingsPage.tsx')}\n${sources.requiredFile('src/features/settings/ProviderProfileManagers.tsx')}`;
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(settingsOwners).toContain('LlmProfileManager');
    expect(settingsOwners).toContain('activateLlmProfile');
    expect(settingsOwners).toContain('activeLlmProfileId');
    expect(settingsOwners).toContain('enableLlmProfile');
    expect(settingsOwners).toContain('addLlmProfile');
    expect(settingsOwners).toContain('copyLlmProfile');
    expect(settingsOwners).toContain('removeLlmProfile');
    expect(settingsOwners).toContain('新增配置');
    expect(settingsOwners).toContain('启用');
    expect(settingsOwners).toContain('data-profile-card');
    expect(css).toContain('.profile-switcher-list');
    expect(css).toContain('.provider-profile-card');
    expect(css).toContain('.provider-profile-card.active');
  });

  it('manages image and TTS providers with the same profile activation pattern', async () => {
    const sources = await rendererSourcesPromise;
    const settingsOwners = `${sources.requiredFile('src/features/settings/SettingsPage.tsx')}\n${sources.requiredFile('src/features/settings/ProviderProfileManagers.tsx')}`;

    expect(settingsOwners).toContain('ImageProfileManager');
    expect(settingsOwners).toContain('TtsProfileManager');
    expect(settingsOwners).toContain('activateImageProfile');
    expect(settingsOwners).toContain('activateTtsProfile');
    expect(settingsOwners).toContain('activeImageProfileId');
    expect(settingsOwners).toContain('activeTtsProfileId');
    expect(settingsOwners).toContain('enableImageProfile');
    expect(settingsOwners).toContain('enableTtsProfile');
    expect(settingsOwners).toContain('commitAndApplySettingsDraft');
  });

  it('scopes provider-specific settings instead of showing every credential at once', async () => {
    const sources = await rendererSourcesPromise;
    const settingsOwners = [
      sources.requiredFile('src/features/settings/SettingsPage.tsx'),
      sources.requiredFile('src/features/settings/ProviderProfileManagers.tsx'),
      sources.requiredFile('src/features/settings/settings-controls.tsx'),
    ].join('\n');

    for (const branch of [
      "selectedProvider === 'openai'",
      'OpenAI 兼容 LLM',
      "provider === 'gpt_image'",
      "provider === 'jimeng'",
      "provider === 'custom'",
      "provider === 'volcengine'",
      "provider === 'minimax'",
    ]) {
      expect(settingsOwners).toContain(branch);
    }
    expect(settingsOwners).toContain("options={['openai', 'custom', 'anthropic']}");
    expect(settingsOwners).toContain("options={['gpt_image', 'jimeng', 'custom']}");
    expect(settingsOwners).toContain("options={['volcengine', 'minimax']}");
    expect(settingsOwners).toContain('normalizeEditableConfigProviders');
    expect(settingsOwners).not.toContain("options={['gpt_image', 'jimeng', 'custom', 'mock']}");
    expect(settingsOwners).not.toContain("options={['volcengine', 'minimax', 'mock']}");
    expect(settingsOwners).not.toContain("draft.imageProvider === 'mock'");
    expect(settingsOwners).not.toContain("draft.tts.provider === 'mock'");
    expect(settingsOwners).not.toContain('即梦 SESSION ID');
    expect(settingsOwners).not.toContain('代理 URL');
    expect(settingsOwners).toContain('activeImageResolution');
    expect(settingsOwners).toContain('setImageResolution');
    expect(settingsOwners).toContain('ProviderConfigNote');
  });

  it('exposes explicit Volcengine V3 and legacy TTS settings without dropping either parameter set', async () => {
    const sources = await rendererSourcesPromise;
    const managers = sources.requiredFile('src/features/settings/ProviderProfileManagers.tsx');
    const controls = sources.requiredFile('src/features/settings/settings-controls.tsx');
    const settingsOwners = `${managers}\n${controls}`;
    const options = await editorialOptionsSourcePromise;

    expect(controls).toContain('volcengineVoicePresets');
    expect(managers).toContain("options={['v3', 'legacy']}");
    expect(managers).toContain("labels={['新版 V3', '旧版接口']}");
    expect(managers).toContain('火山 TTS 接口密钥');
    expect(managers).toContain('V3 Resource ID');
    expect(managers).toContain('V3 接口地址');
    expect(managers).toContain('音色列表访问密钥 ID');
    expect(managers).toContain('音色列表访问密钥 Secret');
    expect(managers).toContain('旧版 App ID');
    expect(managers).toContain('旧版 Access Token');
    expect(managers).toContain('旧版 Cluster');
    expect(managers).toContain('旧版接口地址');
    expect(managers).not.toContain('加载全部音色');
    expect(settingsOwners).toContain('V3 HTTP Chunked');
    expect(settingsOwners).toContain('旧版 JSON 接口');
    expect(settingsOwners).toContain('volcenginePresetVoiceValue');
    expect(managers).toContain('默认音色');
    expect(managers).toContain('自定义 voice_type');
    expect(managers).toContain('voice_type');
    expect(options).toContain('zh_female_vv_uranus_bigtts');
  });

  it('uses provider-specific task voice defaults in the new task form', async () => {
    const settings = (await rendererSourcesPromise).requiredFile('src/features/settings/SettingsPage.tsx');
    const newTask = (await rendererSourcesPromise).requiredFile('src/features/tasks/NewTaskPage.tsx');
    const voices = await readFile(new URL('../src/shared/tts-voices.ts', import.meta.url), 'utf8');

    for (const symbol of [
      'ttsProvider',
      'setTtsProvider',
      'ttsVoiceOptionsForProvider',
      'defaultTaskSpeakerForProvider',
      'taskSpeakerLabel',
      "labels={['豆包', 'MiniMax']}",
      'zh_female_vv_uranus_bigtts',
      'male-qn-qingse',
    ]) {
      expect(newTask + voices).toContain(symbol);
    }
    expect(newTask).not.toContain("const voiceOptions = ['东方浩然', '灿博小叔', '温柔小雅', '爽快思思', '更多音色...'];");
    expect(newTask).not.toContain('>更多音色...</button>');
  });

  it('syncs new-task content and style choices from story and image templates', async () => {
    const main = (await rendererSourcesPromise).all;

    expect(main).toContain('buildStoryTemplateTrackOptions');
    expect(main).toContain('buildStoryTemplateOptions');
    expect(main).toContain('buildTaskPromptTemplateOptions');
    expect(main).toContain('buildImageTemplateStyleOptions');
    expect(main).toContain('storyTemplateOptions');
    expect(main).toContain('taskPromptTemplateOptions');
    expect(main).toContain('imageTemplateStyleOptions');
    expect(main).toContain('options={storyTemplateOptions}');
    expect(main).toContain('value={selectedStoryTemplateId}');
    expect(main).toContain('handleStoryTemplateChange');
    expect(main).toContain('imageTemplateStyleOptions.map(([id, label, hint])');
    expect(main).toContain('onChange={(event) => handleStyleChange(event.target.value)}');
    expect(main).toContain('state.draftTemplates.map((template) => <option');
    expect(main).toContain('onChange={(event) => handleDraftTemplateChange(event.target.value)}');
    expect(main).toContain('buildTaskPromptTemplateOptions(state.promptTemplates, track)');
    expect(main).toContain('taskPromptTemplateOptions.map(([id, label, hint])');
    expect(main).toContain('value={promptTemplateOverrideId || resolvedPromptTemplate?.id || \'\'}');
    expect(main).not.toContain('OptionCloud title="内容赛道" options={contentTracks}');
    expect(main).not.toContain('OptionCloud title="画面风格" options={styleOptions}');
  });

  it('exposes StoryDream cover and podcast image controls in the new task form', async () => {
    const page = (await rendererSourcesPromise).requiredFile('src/features/tasks/NewTaskPage.tsx');

    expect(page).toContain('封面模板');
    expect(page).toContain('封面生成');
    expect(page).toContain('播客配图');
    expect(page).toContain('cinematic-poster');
    expect(page).toContain('podcast-cover');
    expect(page).toContain('coverTemplateId');
    expect(page).toContain('coverImageMode');
    expect(page).toContain('podcastImageMode');
    expect(page).toContain('state.customCoverTemplates.map');
    expect(page).toContain('buildTaskCreateInput');
    expect(page).not.toContain('keepPromotion: keepPromotion || Boolean(productInfo)');
    expect(page).toContain('导入手动封面');
    expect(page).toContain('api.importOrdinaryTaskCover');
    expect(page).toContain("coverImageMode === 'manual' && !manualCoverAsset");
    expect(page).toContain('启用后保留原素材中的商品与推广信息');
    expect(page).not.toContain('改写时删除带货段落');
  });

  it('wires new task reference image upload and task LLM model selection into task creation', async () => {
    const page = (await rendererSourcesPromise).requiredFile('src/features/tasks/NewTaskPage.tsx');

    expect(page).toContain('selectedTaskLlmProfileId');
    expect(page).toContain('llmProfileId: selectedTaskLlmProfileId');
    expect(page).toContain('selectTaskReferenceImage');
    expect(page).toContain('api.selectLocalImage()');
    expect(page).toContain('onClick={selectTaskReferenceImage}');
    expect(page).toContain('value={selectedTaskLlmProfileId}');
    expect(page).toContain('onChange={(event) => setSelectedTaskLlmProfileId(event.target.value)}');
  });

  it('keeps target word and scene controls visible in the new task form', async () => {
    const css = await readFile(new URL('../src/styles/features/new-task.css', import.meta.url), 'utf8');
    const page = (await rendererSourcesPromise).requiredFile('src/features/tasks/NewTaskPage.tsx');

    expect(page).toContain('targetLength');
    expect(page).toContain('字（±20%，留空跟随原文）');
    expect(page).toContain('setTargetLength');
    expect(page).toContain('publishMode');
    expect(page).toContain("options={['review-rewrite', 'direct-copy']}");
    expect(page).toContain('value={targetLength}');
    expect(page).toContain('type="number"');
    expect(page).toContain('min="1"');
    expect(page).toContain('max="60"');
    expect(page).toContain('targetLength: normalizeTaskTargetLength(targetLength) ?? undefined');
    expect(page).toContain('targetScenes: normalizeTaskStoryboardSceneCount(storyboardSceneCount)');
    expect(page).toContain('ContentMetricsSummary text={inputText}');
    expect(page).toContain('storyboardSceneCountPreviewRange');
    expect(page).toContain('自动（');
    expect(page).toContain('placeholder={storyboardScenePreviewRange ?');
    expect(page).toContain('setInputText(event.target.value);');
    expect(page).not.toContain('options={targetLengthOptions.map(String)}');
    const outputStage = page.slice(page.indexOf("activeStage === 'output'"));
    const creativeStage = page.slice(page.indexOf("activeStage === 'creative'"), page.indexOf("activeStage === 'output'"));
    const targetControlsIndex = outputStage.indexOf('<label className="target-number-field">');
    const advancedIndex = creativeStage.indexOf('className="advanced-toggle"');
    expect(targetControlsIndex).toBeGreaterThan(-1);
    expect(advancedIndex).toBeGreaterThan(-1);
    expect(outputStage).toContain('data-create-fields={NEW_TASK_CREATE_FIELDS_BY_STAGE.output.join');
    expect(creativeStage).toContain('data-create-fields={NEW_TASK_CREATE_FIELDS_BY_STAGE.creative.join');

    expect(css).toContain('.new-task-field-grid {');
    expect(css).toContain('display: grid;');
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(css).toContain('align-items: start;');
    expect(css).toContain('gap: 12px;');
    expect(css).toContain('.new-task-stage-panel .target-number-field {');
    expect(css).toContain('display: grid;');
    expect(css).toContain('gap: 5px;');
    expect(css).toContain('font-size: 12px;');
    expect(css).toContain('font-size: 11px;');
    expect(css).toContain('overflow-wrap: anywhere;');
    expect(css).toContain('.new-task-stage-panel .segmented button');
    expect(css).toContain('min-height: 30px;');
    expect(css).toContain('@media (max-width: 760px)');
    expect((await rendererSourcesPromise).requiredFile('src/components/SegmentedControl.tsx'))
      .toContain('label ? <span>{label}</span> : null');
  });

  it('replicates the StoryDream video form controls for narration and two-host podcast tasks', async () => {
    const page = (await rendererSourcesPromise).requiredFile('src/features/tasks/NewTaskPage.tsx');

    for (const text of ['视频形态', '旁白视频', '双人播客', '配图方式', '按分镜配图', '单图封面', '主播组合', '咔仔 x 大壹', '刘飞 x 潇磊']) {
      expect(page).toContain(text);
    }
    expect(page).toContain('videoForm');
    expect(page).toContain("setVideoForm('two-host-podcast')");
    expect(page).toContain('podcastSpeakers');
    expect(page).toContain('podcastSpeakerA');
    expect(page).toContain('podcastSpeakerB');
    expect(page).toContain('defaultPodcastSpeakersForProvider');
    expect(page).not.toContain('主播 A 音色 ID');
    expect(page).not.toContain('主播 B 音色 ID');
    expect(page).not.toContain('Host A voice id');
    expect(page).not.toContain('Host B voice id');
    expect(page).toContain("scriptFormat: videoForm === 'two-host-podcast' ? 'dialogue' : 'narration'");
    expect(page).toContain('Segmented label="配音模型"');
    expect(page).toContain('Segmented label="配音语速"');
  });

  it('keeps task errors compact with a click-through detail dialog', async () => {
    const sources = await rendererSourcesPromise;
    const errorOwners = [
      sources.requiredFile('src/features/tasks/TaskDetailPage.tsx'),
      sources.requiredFile('src/features/html-video/HtmlVideoPage.tsx'),
      sources.requiredFile('src/features/viral/ViralAnalyzerPage.tsx'),
    ].join('\n');
    const artifact = sources.requiredFile('src/features/tasks/TaskArtifactPreview.tsx');
    const errors = sources.requiredFile('src/components/ErrorDetails.tsx');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(errorOwners).toContain('ErrorSummaryButton');
    expect(errors).toContain('function ErrorDetailDialog');
    expect(errors).toContain('closeButtonRef.current?.focus()');
    expect(errors).toContain('previouslyFocused?.focus()');
    expect(errors).toContain("if (event.key === 'Tab')");
    expect(errors).toContain('data-dialog-focus');
    expect(artifact).toContain('summarizeErrorMessage');
    expect(errors).toContain('Python 运行时缺少依赖');
    expect(errors).toContain('Python 运行时依赖缺失');
    expect(errors).toContain('图片服务暂无可用账号');
    expect(errorOwners).toContain('className="mini-button viral-retry-button"');
    expect(errorOwners).toContain('fullMessage');
    expect(errorOwners).not.toContain('<small className="danger-text">{task.errorMessage}</small>');
    expect(errorOwners).not.toContain("stepEvent?.detail ?? statusLabelForStep(status)");
    expect(css).toContain('.error-summary-button');
    expect(css).toContain('.error-dialog');
    expect(css).toContain('.error-summary-button > span:last-child');
    expect(css).toContain('.viral-retry-button');
    const errorSummaryStart = css.lastIndexOf('\n.error-summary-button {') + 1;
    const errorSummaryRule = css.slice(errorSummaryStart, css.indexOf('}', errorSummaryStart) + 1);
    const inlineFeedbackStart = css.indexOf('.inline-action-feedback {');
    const inlineFeedbackRule = css.slice(inlineFeedbackStart, css.indexOf('}', inlineFeedbackStart) + 1);
    const errorDialogStart = css.indexOf('.error-dialog {');
    const errorDialogRule = css.slice(errorDialogStart, css.indexOf('}', errorDialogStart) + 1);
    expect(errorSummaryRule).toContain('color: var(--danger);');
    expect(errorSummaryRule).toContain('background: color-mix(in srgb, var(--danger) 8%, var(--shell-surface-raised));');
    expect(errorSummaryRule).toContain('border: 1px solid color-mix(in srgb, var(--danger) 36%, var(--shell-border));');
    expect(inlineFeedbackRule).toContain('color: var(--danger);');
    expect(inlineFeedbackRule).toContain('background: color-mix(in srgb, var(--danger) 8%, var(--shell-surface-raised));');
    expect(errorSummaryRule).not.toContain('#ffd7d8');
    expect(inlineFeedbackRule).not.toContain('#ffd7d8');
    expect(errorDialogRule).toContain('color: var(--media-text);');
    expect(css).toContain('section.error-dialog .error-dialog-head > div > strong {');
    expect(css).toContain('.error-dialog-head .mini-button {');
    expect(css).toContain('.error-summary-button .error-mark {');
    expect(css).toContain('.error-dialog .error-mark {');
    expect(errors).not.toContain('error-mark-text');
    expect(css).not.toContain('.error-mark-text');
  });

  it('keeps the desktop task-detail identity and actions on one row before the compact breakpoint', async () => {
    const css = await readFile(new URL('../src/styles/features/task-operations.css', import.meta.url), 'utf8');
    const barStart = css.indexOf('.task-detail-shell[data-task-operations="detail"] .task-detail-bar {');
    const barRule = css.slice(barStart, css.indexOf('}', barStart) + 1);
    const identityStart = css.indexOf('.task-detail-identity {', barStart);
    const identityRule = css.slice(identityStart, css.indexOf('}', identityStart) + 1);
    const actionsStart = css.indexOf('.task-detail-actions {', identityStart);
    const actionsRule = css.slice(actionsStart, css.indexOf('}', actionsStart) + 1);

    expect(barRule).toContain('flex-wrap: nowrap;');
    expect(identityRule).toContain('flex: 1 1 380px;');
    expect(actionsRule).toContain('flex: 0 1 auto;');
    expect(actionsRule).toContain('flex-wrap: nowrap;');
    expect(actionsRule).toContain('justify-content: flex-end;');
    expect(css).toMatch(/@media \(max-width: 1180px\)[\s\S]*?\.task-detail-shell\[data-task-operations="detail"\] \.task-detail-bar,[\s\S]*?flex-direction: column;/u);
  });

  it('keeps shared operational controls theme-owned across every shell surface', async () => {
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const labs = await readFile(new URL('../src/styles/features/local-labs.css', import.meta.url), 'utf8');

    const scrollbarRule = css.slice(css.indexOf('* {\n  scrollbar-width:'), css.indexOf('.source-textarea {'));
    const iconButtonStart = css.lastIndexOf('\n.icon-button {') + 1;
    const iconButtonRule = css.slice(iconButtonStart, css.indexOf('}', iconButtonStart) + 1);
    const emptyStateStart = css.indexOf('.empty-state {');
    const emptyStateRule = css.slice(emptyStateStart, css.indexOf('}', emptyStateStart) + 1);
    const statusPillStart = css.indexOf('.status-pill {');
    const statusPillRule = css.slice(statusPillStart, css.indexOf('}', statusPillStart) + 1);

    expect(scrollbarRule).toContain('scrollbar-color: color-mix(in srgb, var(--shell-muted) 58%, transparent) var(--shell-surface);');
    expect(scrollbarRule).toContain('background: var(--shell-surface);');
    expect(iconButtonRule).toContain('background: var(--shell-surface-raised);');
    expect(iconButtonRule).toContain('color: var(--shell-muted);');
    expect(css).toContain('.icon-button:hover:not(:disabled) {');
    expect(css).toContain('input:hover:not(:disabled)');
    expect(css).toContain('.option-pill:hover:not(:disabled)');
    expect(emptyStateRule).toContain('background: color-mix(in srgb, var(--shell-muted) 4%, var(--shell-surface-raised));');
    expect(css).toContain('.empty-state > svg {');
    expect(statusPillRule).toContain('background: color-mix(in srgb, var(--shell-muted) 10%, var(--shell-surface-raised));');
    expect(css).toMatch(/\.ai-search-results \{[\s\S]*?background: var\(--shell-surface-raised\);/u);
    expect(css).toMatch(/\.search-source-card \{[\s\S]*?background: var\(--shell-surface\);/u);
    expect(css).toMatch(/\.search-source-card p \{[\s\S]*?color: var\(--shell-text\);/u);
    expect(css).toContain(".app-shell[data-shell-view='account'] .account-panel {");
    expect(css).toContain(".app-shell[data-shell-view='activation'] .two-column {");
    expect(labs).toContain('.voice-lab-history > .empty-state {');
    expect(labs).toContain('.image-lab-recent > .empty-state {');
  });

  it('keeps compact settings contextual and separates account actions from local information', async () => {
    const sources = await rendererSourcesPromise;
    const account = sources.requiredFile('src/features/account/AccountPage.tsx');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(account).toContain('className="account-actions"');
    expect(css).toMatch(/@media \(max-width: 1120px\)[\s\S]*?\.settings-layout\s*\{[\s\S]*?grid-template-columns:\s*190px minmax\(0, 1fr\);/u);
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.settings-layout\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/u);
    expect(css).toMatch(/\.account-actions\s*\{[\s\S]*?border-bottom:\s*1px solid var\(--line\);/u);
    expect(css).toContain('.account-panel > .local-info {');
  });

  it('lets AI creation search real web sources and select them for generation', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/features/tasks/NewTaskPage.tsx');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const composeSection = main.slice(main.indexOf('async function composeResearchCopy()'), main.indexOf('async function addBgmFromTask'));

    expect(main).toContain('searchWebSources');
    expect(main).toContain('composeResearchCopy');
    expect(main).toContain('必应、百度、搜狗、头条与正文来源');
    expect(main).toContain("useState<WebSearchProvider[]>(() => WEB_SEARCH_PROVIDER_OPTIONS.map((option) => option.id))");
    expect(main).toContain('webSearchProviders,');
    expect(main).toContain('values.webSearchProviders.filter(isWebSearchProvider)');
    expect(main).toContain('const searchAction = useAsyncAction()');
    expect(main).toContain('searchRequestIdRef.current += 1');
    expect(main).toContain('handleAiKeywordChange(event.target.value)');
    expect(main).toContain('api.searchWebSources({ query: keyword, providers: webSearchProviders })');
    expect(main).toContain('searchContext.query === aiKeyword.trim()');
    expect(main).toContain('实际查询：{searchContext.query}');
    expect(main).toContain('searchContext.providerStatuses.map');
    expect(main).toContain('webSearchProviderLabel(source.provider)');
    expect(main).toContain('selectedSearchSourceIds');
    expect(main).toContain('selectedSources');
    expect(main).toContain('ai-search-results');
    expect(main).toContain('ai-search-results-scroll');
    expect(main).toContain('ai-search-actions');
    expect(main).toContain("setMode('paste')");
    expect(main).toContain('setInputText(result.copy)');
    expect(main).toContain('setTitle(result.title');
    expect(composeSection).toContain('targetLength: normalizeTaskTargetLength(targetLength) ?? undefined');
    expect(main).toContain('结合所选页面信息生成文案');
    expect(main).toContain('网页候选（前 10 条）');
    expect(css).toContain('.ai-search-results');
    expect(css).toContain('.ai-search-results-scroll');
    expect(css).toContain('.ai-search-actions');
    expect(css).toContain('.extra-requirements-input');
    expect(css).toContain('::-webkit-scrollbar');
    expect(css).toContain('.search-source-card');
    expect(css).toContain('.web-search-provider-statuses');
    expect(css).toContain('.search-source-provider');
  });

  it('runs image lab requests through real generation and renders returned image records', async () => {
    const page = (await rendererSourcesPromise).requiredFile('src/features/labs/ImageLabPage.tsx');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(page).toContain('api.generateImageLab');
    expect(page).not.toContain("status: state.config.image.apiKey ? 'generated' : 'mock'");
    expect(page).not.toContain('预计消耗：本地模拟');
    expect(page).toContain('record.imagePath ?');
    expect(page).toContain("record.status === 'failed'");
    expect(css).toContain('.image-record img');
    expect(css).toContain('.image-record.failed');
  });

  it('matches Storybound playground batch, provider switching, and recovery tools without dropping existing parameters', async () => {
    const page = (await rendererSourcesPromise).requiredFile('src/features/labs/ImageLabPage.tsx');
    const helpers = (await rendererSourcesPromise).requiredFile('src/features/labs/image-lab-helpers.ts');
    const css = await readFile(new URL('../src/styles/features/local-labs.css', import.meta.url), 'utf8');

    expect(page).toContain('buildImageLabBatchInputs');
    expect(page).toContain('selectedRatios');
    expect(page).toContain('selectedStyles');
    expect(page).toContain('provider');
    expect(page).toContain('batchRequestCount');
    expect(page).toContain('retryImageLabRecord');
    expect(page).toContain('retryFailedImageLabRecords');
    expect(page).toContain('refillImageLabPrompt');
    expect(page).toContain('copyImageLabTaskId');
    expect(page).toContain('api.openImageLabOutputDirectory(record.id)');
    expect(page).toContain('api.getImageLabRecordDetail(record.id)');
    expect(page).toContain('applyState(nextState)');
    for (const text of ['多选比例', '多选风格', '每组合数量', '重试全部失败项', '重试', '回填提示词', '复制任务 ID', '打开目录']) {
      expect(page).toContain(text);
    }
    for (const parameter of ['prompt', 'ratio', 'style', 'provider', 'resolution', 'smartMode', 'referenceImagePath', 'referenceImagePaths']) {
      expect(helpers).toContain(parameter);
    }
    expect(css).toContain('.image-lab-style-grid');
    expect(css).toContain('.image-record-actions');
    expect(css).toContain('.image-lab-batch-summary');
  });

  it('imports a completed local image into image lab history with the current parameters', async () => {
    const page = (await rendererSourcesPromise).requiredFile('src/features/labs/ImageLabPage.tsx');
    const importSnippet = page.slice(
      page.indexOf('async function importCompletedImage()'),
      page.indexOf('return ('),
    );

    expect(page).toContain('导入成品');
    expect(importSnippet).toContain('const imagePath = await api.selectLocalImage()');
    expect(importSnippet).toContain('api.addImageLabRecord({');
    for (const parameter of [
      'prompt,',
      'ratio: selectedRatios[0],',
      'style: selectedStyles[0],',
      'provider,',
      'imagePath,',
      'resolution,',
      'smartMode: resolvedSmartMode,',
      'referenceImagePath: references[0] ?? \'\',',
      'referenceImagePaths: references,',
    ]) {
      expect(importSnippet).toContain(parameter);
    }
    for (const mainProcessOwnedField of ['id:', 'managedStorageKey:', 'status:', 'finishedAt:']) {
      expect(importSnippet).not.toContain(mainProcessOwnedField);
    }
    expect(importSnippet.indexOf('api.selectLocalImage()')).toBeLessThan(importSnippet.indexOf('api.addImageLabRecord({'));
    expect(importSnippet).toContain('applyState(nextState)');
  });

  it('exposes the StoryDream smart image modes in image lab generation', async () => {
    const page = (await rendererSourcesPromise).requiredFile('src/features/labs/ImageLabPage.tsx');
    const helpers = (await rendererSourcesPromise).requiredFile('src/features/labs/image-lab-helpers.ts');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    for (const text of ['智慧生图', '文生图', '图像参考', '参考图', '需求描述', '每组合数量', '多选比例', '多选风格', '分辨率', '最近生成']) {
      expect(page).toContain(text);
    }
    expect(page).not.toContain('className="image-lab-header"');
    expect(page).toContain('smartMode');
    expect(page).toContain('referenceLimit');
    expect(page).toContain('imageLabOutputCount');
    expect(page).toContain('image-lab-dropzone');
    expect(page).toContain('selectImageLabReferenceImage');
    expect(page).toContain('api.selectLocalImage()');
    expect(page).toContain('onClick={selectImageLabReferenceImage}');
    expect(page).toContain('removeReferenceImagePath');
    expect(page).toContain('setExpandedReferenceImage');
    expect(page).toContain('image-lab-reference-list');
    expect(page).toContain('image-lab-reference-thumb');
    expect(page).toContain('hiddenReferenceCount');
    expect(page).toContain('image-lab-ratio-grid');
    expect(page).toContain('referenceImagePaths');
    expect(page).toContain('resolveImageLabSmartMode(tab, baseSmartMode, references)');
    expect(helpers).toContain("tab === 'smart' && references.length > 0 ? 'reference-edit'");
    expect(page).toContain("Math.min(10, imageLabOutputCount)");
    expect(page).toContain('max={10}');
    expect(css).toContain('.image-lab-workbench');
    expect(css).toContain('.image-lab-dropzone');
    expect(css).toContain('.image-lab-reference-list');
    expect(css).toContain('.image-lab-reference-grid');
    expect(css).toContain('.image-lab-reference-thumb');
    expect(css).toContain('.image-lab-preview-dialog');
    expect(css).toContain('.image-lab-ratio-grid');
    expect(css).toContain('.image-lab-recent');
    expect(css).toContain('.reference-image-list');
  });

  it('separates smart generation and reference editing modes in image lab copy', async () => {
    const page = (await rendererSourcesPromise).requiredFile('src/features/labs/ImageLabPage.tsx');
    const helpers = (await rendererSourcesPromise).requiredFile('src/features/labs/image-lab-helpers.ts');

    expect(page).toContain('referenceModeDescription');
    expect(page).toContain('智慧生图');
    expect(page).toContain('图像参考');
    expect(page).toContain('智能规划多张图，可带参考图');
    expect(page).toContain('参考图编辑/延展，需要先添加参考图');
    expect(helpers).toContain("tab === 'reference' ? 'reference-edit'");
  });

  it('keeps the image lab page padded and scrollable under the fixed page header', async () => {
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const scrollablePageRule = css.match(/\.new-task-scroll,[\s\S]*?\.image-lab-page\s*\{[\s\S]*?\}/)?.[0] ?? '';

    expect(scrollablePageRule).toContain('.image-lab-page');
    expect(scrollablePageRule).toContain('overflow: auto');
    expect(scrollablePageRule).toContain('padding: 20px 26px');
  });

  it('reuses the React root across Vite hot reloads', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/main.tsx');

    expect(main).toContain('__storydreamReactRoot');
    expect(main).toContain('window.__storydreamReactRoot ??=');
    expect(main).not.toContain("createRoot(document.getElementById('root')!).render(<App />)");
  });

  it('blocks real task execution in browser preview mode and avoids fake running states', async () => {
    const main = (await rendererSourcesPromise).all;

    expect(main).toContain('isBrowserPreview');
    expect(main).toContain('浏览器预览不能执行真实流水线');
    expect(main).toContain("const taskLocked = isBrowserPreview || task.status === 'running' || task.status === 'pending'");
    expect(main).toContain('continueTask');
    expect(main).toContain('retryFailedTask');
    expect(main).not.toContain("task.status === 'paused' ? 'running' : 'paused'");
  });

  it('shows live image thumbnails with concurrency context and per-scene regeneration controls', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/features/tasks/TaskArtifactPreview.tsx');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');

    expect(preload).toContain('readAssetDataUrl');
    expect(preload).toContain('regenerateTaskImage');
    expect(preload).toContain('regenerateTaskImages');
    expect(preload).toContain('replaceTaskImage');
    expect(preload).toContain('importTaskImages');
    expect(preload).toContain('referenceEditTaskImage');
    expect(preload).toContain('updateTaskImagePrompt');
    expect(main).toContain('ImageGenerationGallery');
    expect(main).toContain('readAssetDataUrl');
    expect(main).toContain('regenerateTaskImage');
    expect(main).toContain('regenerateTaskImages');
    expect(main).toContain('replaceTaskImage');
    expect(main).toContain('importTaskImages');
    expect(main).toContain('referenceEditTaskImage');
    expect(main).toContain('updateTaskImagePrompt');
    expect(main).toContain('修改提示词');
    expect(main).toContain('保存并重绘');
    expect(main).toContain('参考图编辑');
    expect(main).toContain('素材库选图');
    expect(main).toContain('批量导入');
    expect(main).toContain('复制图');
    expect(main).toContain('粘贴图');
    expect(main).toContain('取消');
    expect(main).toContain('activeImageConcurrency');
    expect(main).toContain('imagePreviewUrls');
    expect(main).toContain("const taskLocked = isBrowserPreview || task.status === 'running' || task.status === 'pending'");
    expect(main).toContain('重新生成');
    expect(css).toContain('.image-preview-grid');
    expect(css).toContain('.image-preview-card');
    expect(css).toContain('.image-thumb');
    expect(css).toContain('.image-card-action-panel');
    expect(css).toContain('.image-library-dialog');
    expect(css).toContain('.image-gallery-editor-dialog');
  });

  it('shows playable narration previews with per-scene regeneration controls', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/features/tasks/TaskArtifactPreview.tsx');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');

    expect(preload).toContain('regenerateTaskNarration');
    expect(main).toContain('NarrationPreviewList');
    expect(main).toContain('<audio controls');
    expect(main).toContain('audioPreviewUrls');
    expect(main).toContain('regenerateTaskNarration');
    expect(main).toContain('重新生成配音');
    expect(css).toContain('.narration-preview-list');
    expect(css).toContain('.narration-preview-card');
    expect(css).toContain('.narration-player');
  });

  it('applies persistent themes before reveal and exposes a real settings selector', async () => {
    const main = (await rendererSourcesPromise).requiredFile('src/app/App.tsx');
    const settings = (await rendererSourcesPromise).requiredFile('src/features/settings/SettingsPage.tsx');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    const tokens = await readFile(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
    const base = await readFile(new URL('../src/styles/base.css', import.meta.url), 'utf8');
    const bootstrap = main.slice(main.indexOf('api.getBootstrap()'), main.indexOf('const reconciliationTimer'));
    expect(main).toContain('applyStoredTheme(defaultUiPreferences.theme)');
    expect(main).toContain('applyStoredTheme(state.ui.theme)');
    expect(bootstrap).toContain('applyStoredTheme(bootstrap.ui.theme)');
    expect(bootstrap.indexOf('applyStoredTheme(bootstrap.ui.theme)')).toBeLessThan(bootstrap.indexOf('revealThemedApplication()'));
    expect(settings).toContain("['appearance', Palette, '外观'");
    expect(settings).toContain("api.saveUiPreferences({ theme: nextTheme })");
    expect(settings).toContain('changeRuntimeTheme');
    expect(settings).toContain("section === 'appearance'");
    expect(tokens).toContain(":root[data-theme='light']");
    expect(base).toContain(":root:not([data-theme-ready='true']) #root");
    expect(css).toContain("@import './styles/tokens.css'");
  });
});

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}
