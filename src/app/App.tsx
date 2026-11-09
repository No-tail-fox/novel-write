import React, { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, Suspense } from "react";
import type { AppDelta, AppMutationResult, HistoryFamily, ShellView, ThemeName } from "../shared/types";
import { createAppDeltaCoordinator, MAX_RENDERER_DELTA_BUFFER, type DeltaViewState, type RevisionGap } from "../shared/state-delta";
import { applyAppMutationResult, applyBufferedMutationResults, applyHistorySelectionBarrier, applyLocalMutationResponse, authoritativeMissingRequestedTaskId, claimMutationResult, collectTaskEventPages, collectViralEventPages, createRequestGenerationCompletionQueue, createRequestGenerationGuard, historyEntityRevisionKey, historyResponseDisposition, mergeAuthoritativeSnapshotDetails, mergeReconciliationSlices, raiseMutationRevisionFloor, reduceCompletionTrackedState, shouldApplyDeltaViewTransition } from "../shared/state-reconciliation";
import { applyStoredTheme, changeRuntimeTheme, revealThemedApplication, transitionRendererTheme, withRuntimeTheme } from "../features/settings/theme-controller";
import { defaultUiPreferences } from "../shared/config";
import { useAsyncAction } from "../ui/async-action";
import { Button, StoryDreamProvider } from "../ui";
import { AsyncActionFeedback } from "../components/AsyncActionFeedback";
import { Minus, Square, X } from "lucide-react";
import { advanceHistoryFamilyEpochs, allHistoryFamilies, bootstrapToState, captureHistoryResponseRevision, cloneState, initialState, isHistoryResponseCurrent, loadCompleteBootstrap, MAX_TASK_DETAIL_REVISION_ATTEMPTS, mergeDeltaView, registerHistoryDeltaBarrier, replaceHistoryRevisionMap, type HistoryFamilyEpochs } from "./app-state";
import { makeLazyFallbackApi } from './lazy-browser-fallback';
import type { RendererAppState as AppState } from "./route-types";
import { AppRoutes } from './AppRoutes';
import { AppShell } from './AppShell';
import { taskWorkspaceView, workspaceReturnViewForNavigation } from './navigation';
import { RouteErrorBoundary } from './RouteErrorBoundary';
import { RouteLoadingState } from './RouteLoadingState';
import type { SettingsSection } from '../features/settings/SettingsPage';
import { WorkspaceNavigationProvider, WorkspaceLeaveDialog, useNativeWindowLeaveGuard, useWorkspaceNavigation } from './workspace-navigation';
import type { LicenseStatus, UpdateStatus } from '../shared/licensing';
import type { StoryDreamApi } from '../shared/storydream-api';
import { routeComponents } from './route-registry';

applyStoredTheme(defaultUiPreferences.theme);

export function App() {
  const desktopApi = window.storydream ?? window.storybound;
  if (!desktopApi) return <main role="alert" style={{ minHeight: '100vh', display: 'grid', alignContent: 'center', justifyItems: 'center', gap: 12, padding: 24, background: 'var(--shell-bg)', color: 'var(--shell-text)', textAlign: 'center' }}><h1>授权服务不可用</h1><p>无法验证本机授权，程序功能已锁定。请在 StoryDream 桌面端完成授权后使用。</p></main>;
  return <DesktopLicenseGate api={desktopApi} />;
}

function DesktopLicenseGate({ api }: { api: StoryDreamApi }) {
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const licenseRequestRef = useRef(0);
  const windowAction = useAsyncAction();
  const controlWindow = (action: 'minimize' | 'toggle-maximize' | 'close') => windowAction.run(() => api.windowControl(action));
  const publishLicenseStatus = useCallback((next: LicenseStatus) => { licenseRequestRef.current++; setLicense(next); setStatusError(''); }, []);
  const readLicense = useCallback(async () => {
    const requestId = ++licenseRequestRef.current;
    try {
      const next = await api.getLicenseStatus();
      if (requestId !== licenseRequestRef.current) return;
      setLicense(next);
      setStatusError('');
    } catch (error) {
      if (requestId !== licenseRequestRef.current) return;
      setLicense(null);
      setStatusError(error instanceof Error ? error.message : '无法验证授权状态。');
    }
  }, [api]);

  useEffect(() => {
    void readLicense();
    const timer = window.setInterval(() => { void readLicense(); }, 5000);
    return () => window.clearInterval(timer);
  }, [readLicense]);

  const canOpenWorkspace = Boolean(license?.configured && ['active', 'offline'].includes(license.status));
  useLayoutEffect(() => {
    if (canOpenWorkspace) return;
    applyStoredTheme('dark');
    revealThemedApplication();
  }, [canOpenWorkspace]);

  if (canOpenWorkspace) {
    return <WorkspaceNavigationProvider><AppWorkspace /></WorkspaceNavigationProvider>;
  }

  return (
    <StoryDreamProvider theme="dark">
      <main className="license-gate">
        <header className="license-gate-header"><div className="app-mark">S</div><div className="license-gate-brand"><strong>StoryDream</strong><span>授权验证</span></div><div className="license-gate-controls" role="toolbar" aria-label="窗体控制"><Button type="button" aria-label="最小化" title="最小化" icon={<Minus size={14} />} variant="subtle" density="compact" disabled={windowAction.busy} onClick={() => { void controlWindow('minimize'); }} /><Button type="button" aria-label="最大化或还原" title="最大化或还原" icon={<Square size={14} />} variant="subtle" density="compact" disabled={windowAction.busy} onClick={() => { void controlWindow('toggle-maximize'); }} /><Button type="button" aria-label="关闭" title="关闭" icon={<X size={14} />} variant="subtle" density="compact" disabled={windowAction.busy} onClick={() => { void controlWindow('close'); }} /></div></header>
        <AsyncActionFeedback feedback={windowAction.feedback} />
        {statusError ? <p className="license-gate-error" role="alert">{statusError} 未验证通过前，程序功能保持锁定。</p> : null}
        <Suspense fallback={<RouteLoadingState label="正在加载授权界面" />}><routeComponents.activation api={api} onLicenseStatusChange={publishLicenseStatus} /></Suspense>
      </main>
    </StoryDreamProvider>
  );
}

function AppWorkspace() {
  const navigation = useWorkspaceNavigation();
  const [trackedState, dispatchState] = useReducer(
    reduceCompletionTrackedState<AppState>,
    { value: cloneState(initialState), completionToken: 0 },
  );
  // A window's explicit theme choice survives unrelated persisted preference updates.
  const [runtimeTheme, setRuntimeTheme] = useState<ThemeName | null>(null);
  const state = useMemo(() => withRuntimeTheme(trackedState.value, runtimeTheme), [trackedState.value, runtimeTheme]);
  const taskDetailCompletionEpoch = trackedState.completionToken;
  const setState = useCallback((update: React.SetStateAction<AppState>) => {
    dispatchState({ update });
  }, []);
  const [activeView, setActiveView] = useState<ShellView>('new-task');
  const [bootstrapReady, setBootstrapReady] = useState(false);
  const bootstrapReadyRef = useRef(false);
  const [settingsEntry, setSettingsEntry] = useState<{ section: SettingsSection; returnView: ShellView; taskId?: string; taskReturnView: ShellView } | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskDetailReturnView, setTaskDetailReturnView] = useState<ShellView>('projects');
  const [requestedEditorialCollageTaskId, setRequestedEditorialCollageTaskId] = useState('');
  const [requestedMotionComicTaskId, setRequestedMotionComicTaskId] = useState('');
  const [requestedHtmlTaskId, setRequestedHtmlTaskId] = useState('');
  const [historyFamilyEpochs, setHistoryFamilyEpochs] = useState<HistoryFamilyEpochs>({});
  const [saveTone, setSaveTone] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const isBrowserPreview = !window.storydream && !window.storybound;
  const api = useMemo(() => window.storydream ?? window.storybound ?? makeLazyFallbackApi(setState), []);
  const shellAction = useAsyncAction();
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [updateAction, setUpdateAction] = useState<'checking' | 'downloading' | 'installing' | null>(null);
  const updateStatusRequestRef = useRef(0);
  const updateActionActiveRef = useRef(false);
  const [updateActionBusy, setUpdateActionBusy] = useState(false);
  const runtimeThemeRef = useRef<ThemeName>(state.ui.theme);
  const revisionRef = useRef(0);
  const mutationRevisionsRef = useRef(new Map<string, number>());
  const historyEntityRevisionsRef = useRef(new Map<string, number>());
  const historyTombstoneRevisionsRef = useRef(new Map<string, number>());
  const activeViewRef = useRef<ShellView>('new-task');
  const viewPreferencePersistenceRef = useRef<Promise<void>>(Promise.resolve());
  const selectedTaskIdRef = useRef<string | null>(null);
  const activeHtmlTaskIdRef = useRef<string | null>(null);
  const activeViralAnalysisIdRef = useRef<string | null>(null);
  const taskDetailGuard = useMemo(() => createRequestGenerationGuard(), []);
  const taskDetailCompletionQueue = useMemo(
    () => createRequestGenerationCompletionQueue(taskDetailGuard),
    [taskDetailGuard],
  );
  const viralDetailGuard = useMemo(() => createRequestGenerationGuard(), []);
  useLayoutEffect(() => {
    runtimeThemeRef.current = state.ui.theme;
    applyStoredTheme(state.ui.theme);
  }, [state]);
  const synchronizeThemeState = useCallback((expectedTheme: ThemeName, nextTheme: ThemeName) => {
    if (runtimeThemeRef.current !== expectedTheme) return false;
    runtimeThemeRef.current = nextTheme;
    setRuntimeTheme(nextTheme);
    setState((current) => transitionRendererTheme(current, expectedTheme, nextTheme));
    return expectedTheme !== nextTheme;
  }, [setState]);
  useEffect(() => {
    const revealTimer = window.setTimeout(revealThemedApplication, 1_200);
    return () => window.clearTimeout(revealTimer);
  }, []);
  const refreshUpdateStatus = useCallback(async () => {
    const requestId = ++updateStatusRequestRef.current;
    try {
      const next = await api.getUpdateStatus();
      if (requestId === updateStatusRequestRef.current) setUpdateStatus(next);
    } catch {
      // Update checks must not block the workspace.
    }
  }, [api]);
  useEffect(() => {
    void refreshUpdateStatus();
    const pending = updateActionBusy || ['checking', 'downloading', 'installing'].includes(updateStatus?.phase ?? '');
    const timer = window.setInterval(() => { void refreshUpdateStatus(); }, pending ? 1000 : 60_000);
    return () => window.clearInterval(timer);
  }, [refreshUpdateStatus, updateActionBusy, updateStatus?.phase]);
  const runUpdateAction = useCallback(async (
    phase: 'checking' | 'downloading' | 'installing',
    operation: () => Promise<UpdateStatus>,
  ) => {
    if (updateActionActiveRef.current) return;
    updateActionActiveRef.current = true;
    updateStatusRequestRef.current++;
    setUpdateAction(phase);
    setUpdateActionBusy(true);
    try {
      const next = await operation();
      updateStatusRequestRef.current++;
      setUpdateStatus(next);
    } catch (error) {
      shellAction.reportError(error);
      const requestId = ++updateStatusRequestRef.current;
      try {
        const next = await api.getUpdateStatus();
        if (requestId === updateStatusRequestRef.current) setUpdateStatus(next);
      } catch { /* Preserve the last known update status. */ }
    } finally {
      updateActionActiveRef.current = false;
      setUpdateAction(null);
      setUpdateActionBusy(false);
    }
  }, [api, shellAction.reportError]);
  const isHistoryTombstoned = useCallback((family: HistoryFamily, id: string) => (
    historyTombstoneRevisionsRef.current.has(historyEntityRevisionKey(family, id))
  ), []);
  const refreshHistoryFamilies = useCallback((
    families: readonly HistoryFamily[],
  ) => {
    setHistoryFamilyEpochs((current) => advanceHistoryFamilyEpochs(current, families));
  }, []);

  useEffect(() => {
    taskDetailCompletionQueue.flushThrough(taskDetailCompletionEpoch);
  }, [taskDetailCompletionEpoch, taskDetailCompletionQueue]);

  const applyHistoryEntityBarrier = useCallback((family: HistoryFamily, id: string) => {
    const selection = applyHistorySelectionBarrier({
      selectedTaskId: selectedTaskIdRef.current,
      activeHtmlTaskId: activeHtmlTaskIdRef.current,
      activeViralAnalysisId: activeViralAnalysisIdRef.current,
      activeView: activeViewRef.current,
    }, family, id);
    selectedTaskIdRef.current = selection.selectedTaskId;
    activeHtmlTaskIdRef.current = selection.activeHtmlTaskId;
    activeViralAnalysisIdRef.current = selection.activeViralAnalysisId;
    activeViewRef.current = selection.activeView;
    setSelectedTaskId(selection.selectedTaskId);
    setActiveView(selection.activeView);
    if (family === 'task') {
      taskDetailGuard.invalidate(id);
    } else if (family === 'viral-analysis') {
      viralDetailGuard.invalidate(id);
    }
  }, [taskDetailGuard, viralDetailGuard]);

  const applyHistoryBarrier = useCallback((delta: AppDelta) => {
    registerHistoryDeltaBarrier(
      historyEntityRevisionsRef.current,
      historyTombstoneRevisionsRef.current,
      delta,
      applyHistoryEntityBarrier,
      (family) => refreshHistoryFamilies([family]),
    );
  }, [applyHistoryEntityBarrier, refreshHistoryFamilies]);

  const refreshTaskDetail = useCallback(async (taskId: string) => {
    const generation = taskDetailGuard.begin(taskId);
    let completionDeferred = false;
    try {
      for (let attempt = 0; attempt < MAX_TASK_DETAIL_REVISION_ATTEMPTS; attempt += 1) {
        const responseRevision = captureHistoryResponseRevision(
          'task',
          taskId,
          historyEntityRevisionsRef.current,
          historyTombstoneRevisionsRef.current,
        );
        if (responseRevision.tombstoneRevision >= 0) return;
        const [detail, eventPage] = await Promise.all([
          api.getTaskDetail(taskId),
          api.listTaskEvents(taskId, { limit: 100 }),
        ]);
        const taskEvents = await collectTaskEventPages(
          eventPage,
          (cursor) => api.listTaskEvents(taskId, { cursor, limit: 100 }),
        );
        if (!taskDetailGuard.isCurrent(taskId, generation) || !detail) return;
        const currentRevision = captureHistoryResponseRevision(
          'task',
          taskId,
          historyEntityRevisionsRef.current,
          historyTombstoneRevisionsRef.current,
        );
        const disposition = historyResponseDisposition(responseRevision, currentRevision);
        if (disposition === 'discard') return;
        if (disposition === 'retry') continue;

        const completionToken = taskDetailCompletionQueue.defer(taskId, generation);
        completionDeferred = true;
        dispatchState({
          update: (current) => taskDetailGuard.isCurrent(taskId, generation)
            ? mergeReconciliationSlices(current, {
                task: detail,
                taskEvents,
                viralAnalysis: null,
                viralEvents: [],
              })
            : current,
          completionToken,
        });
        return;
      }
    } catch (error) {
      if (taskDetailGuard.isCurrent(taskId, generation)) shellAction.reportError(error);
    } finally {
      if (!completionDeferred) taskDetailGuard.finish(taskId, generation);
    }
  }, [api, shellAction.reportError, taskDetailCompletionQueue, taskDetailGuard]);

  const refreshViralEvents = useCallback(async (analysisId: string) => {
    const generation = viralDetailGuard.begin(analysisId);
    const responseRevision = captureHistoryResponseRevision(
      'viral-analysis',
      analysisId,
      historyEntityRevisionsRef.current,
      historyTombstoneRevisionsRef.current,
    );
    try {
      if (responseRevision.tombstoneRevision >= 0) return;
      const [detail, eventPage] = await Promise.all([
        api.getViralAnalysisDetail(analysisId),
        api.listViralEvents(analysisId, { limit: 100 }),
      ]);
      const events = await collectViralEventPages(eventPage, (cursor) => api.listViralEvents(analysisId, { cursor, limit: 100 }));
      if (!viralDetailGuard.isCurrent(analysisId, generation)
        || !isHistoryResponseCurrent('viral-analysis', analysisId, responseRevision, historyEntityRevisionsRef.current, historyTombstoneRevisionsRef.current)) return;
      setState((current) => isHistoryResponseCurrent(
        'viral-analysis',
        analysisId,
        responseRevision,
        historyEntityRevisionsRef.current,
        historyTombstoneRevisionsRef.current,
      ) ? mergeReconciliationSlices(current, {
          task: null,
          taskEvents: [],
          viralAnalysis: detail,
          viralEvents: events.filter((event) => detail?.runGeneration === undefined
            || event.runGeneration === undefined
            || event.runGeneration === detail.runGeneration),
        }) : current);
    } catch (error) {
      if (viralDetailGuard.isCurrent(analysisId, generation)) shellAction.reportError(error);
    } finally {
      viralDetailGuard.finish(analysisId, generation);
    }
  }, [api, shellAction.reportError, viralDetailGuard]);

  const onActiveHtmlTaskChange = useCallback((taskId: string) => {
    activeHtmlTaskIdRef.current = taskId || null;
  }, []);

  const onRequestedHtmlTaskHandled = useCallback((taskId: string) => {
    setRequestedHtmlTaskId((current) => current === taskId ? '' : current);
  }, []);

  const onRequestedEditorialCollageTaskHandled = useCallback((taskId: string) => {
    setRequestedEditorialCollageTaskId((current) => current === taskId ? '' : current);
  }, []);

  const onRequestedMotionComicTaskHandled = useCallback((taskId: string) => {
    setRequestedMotionComicTaskId((current) => current === taskId ? '' : current);
  }, []);

  const onActiveViralAnalysisChange = useCallback((analysisId: string) => {
    activeViralAnalysisIdRef.current = analysisId || null;
  }, []);

  useEffect(() => {
    selectedTaskIdRef.current = selectedTaskId;
  }, [selectedTaskId]);

  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);

  useEffect(() => {
    let disposed = false;
    let reconciling = false;
    let reconcileAgain = false;
    let reconcileAgainWithReset = false;
    let resetInProgress = false;
    let resetRecoveryRevision = 0;
    let snapshotInstalling = true;
    let mutationBufferOverflowed = false;
    const bufferedMutationResults = new Map<number, AppMutationResult>();
    const applyDeltaState = (
      next: DeltaViewState | null,
      previous?: DeltaViewState | null,
    ) => {
      if (!next || disposed) return;
      if (previous !== undefined && !shouldApplyDeltaViewTransition(previous, next)) return;
      revisionRef.current = next.revision;
      replaceHistoryRevisionMap(historyEntityRevisionsRef.current, next.entityRevisions);
      replaceHistoryRevisionMap(historyTombstoneRevisionsRef.current, next.tombstoneRevisions);
      setState((current) => mergeDeltaView(current, next));
    };
    const applyMutationDelta = (delta: AppMutationResult) => {
      const claimedRevisions = claimMutationResult(delta, mutationRevisionsRef.current);
      if (!claimedRevisions) return;
      setState((current) => applyAppMutationResult(current, delta, new Map(claimedRevisions)));
    };
    const requestReconciliation = (forceReset = false) => {
      if (disposed) return;
      if (snapshotInstalling || reconciling) {
        reconcileAgain = true;
        reconcileAgainWithReset ||= forceReset;
        return;
      }
      void reconcile(undefined, forceReset);
    };
    const flushQueuedReconciliation = () => {
      if (reconcileAgain && !disposed && !snapshotInstalling && !reconciling) {
        reconcileAgain = false;
        const reset = reconcileAgainWithReset;
        reconcileAgainWithReset = false;
        void reconcile(undefined, reset);
      }
    };
    const bufferMutationResult = (result: AppMutationResult) => {
      if (mutationBufferOverflowed) return;
      if (!bufferedMutationResults.has(result.revision) && bufferedMutationResults.size >= MAX_RENDERER_DELTA_BUFFER) {
        mutationBufferOverflowed = true;
        requestReconciliation(true);
        return;
      }
      bufferedMutationResults.set(result.revision, result);
    };
    const takeBufferedMutationResults = () => {
      const buffered = [...bufferedMutationResults.values()];
      bufferedMutationResults.clear();
      mutationBufferOverflowed = false;
      return buffered;
    };
    const beginSnapshotInstallation = () => {
      snapshotInstalling = true;
      mutationBufferOverflowed = false;
      bufferedMutationResults.clear();
    };
    const installAuthoritativeSnapshot = (
      rebuiltState: AppState,
      snapshotRevision: number,
      replayedRevision: number,
      preserveTemplateDetails: boolean,
      authoritativeTaskDetailIds?: ReadonlySet<string>,
    ) => {
      const buffered = takeBufferedMutationResults();
      raiseMutationRevisionFloor(mutationRevisionsRef.current, snapshotRevision);
      const replayRevisionFloor = new Map(mutationRevisionsRef.current);
      const finalRevision = Math.max(
        snapshotRevision,
        replayedRevision,
        buffered.reduce((revision, result) => Math.max(revision, result.revision), snapshotRevision),
      );
      raiseMutationRevisionFloor(mutationRevisionsRef.current, finalRevision);
      snapshotInstalling = false;
      setState((current) => {
        const localMutationRevisions = new Map(replayRevisionFloor);
        const authoritative = mergeAuthoritativeSnapshotDetails(
          current,
          rebuiltState,
          preserveTemplateDetails,
          authoritativeTaskDetailIds,
        );
        const replayed = applyBufferedMutationResults(
          authoritative,
          buffered,
          snapshotRevision,
          localMutationRevisions,
        );
        return replayed;
      });
      if (!bootstrapReadyRef.current) {
        bootstrapReadyRef.current = true;
        setActiveView(rebuiltState.ui.activeView);
        setBootstrapReady(true);
        shellAction.clearFeedback();
      }
      refreshHistoryFamilies(allHistoryFamilies);
    };
    const recoverSnapshotInstallation = (snapshotRevision: number, replayedRevision: number) => {
      const buffered = takeBufferedMutationResults();
      raiseMutationRevisionFloor(mutationRevisionsRef.current, snapshotRevision);
      const replayRevisionFloor = new Map(mutationRevisionsRef.current);
      const finalRevision = Math.max(
        snapshotRevision,
        replayedRevision,
        buffered.reduce((revision, result) => Math.max(revision, result.revision), snapshotRevision),
      );
      raiseMutationRevisionFloor(mutationRevisionsRef.current, finalRevision);
      snapshotInstalling = false;
      setState((current) => {
        const localMutationRevisions = new Map(replayRevisionFloor);
        const recovered = applyBufferedMutationResults(
          current,
          buffered,
          snapshotRevision,
          localMutationRevisions,
        );
        return recovered;
      });
    };
    const applyIncomingDelta = (delta: AppDelta) => {
      applyHistoryBarrier(delta);
      if (delta.kind !== 'task-event') {
        if (snapshotInstalling) bufferMutationResult(delta);
        else applyMutationDelta(delta);
      }
      const previous = coordinator.current();
      applyDeltaState(coordinator.receive(delta), previous);
    };
    async function reconcile(_gap?: RevisionGap, forceReset = false) {
      if (disposed) return;
      if (reconciling) {
        reconcileAgain = true;
        reconcileAgainWithReset ||= forceReset;
        return;
      }
      if (snapshotInstalling) {
        reconcileAgain = true;
        reconcileAgainWithReset ||= forceReset;
        return;
      }
      reconciling = true;
      try {
        const requestedTaskId = selectedTaskIdRef.current ?? activeHtmlTaskIdRef.current;
        const requestedViralId = activeViralAnalysisIdRef.current;
        const taskResponseRevision = requestedTaskId
          ? captureHistoryResponseRevision('task', requestedTaskId, historyEntityRevisionsRef.current, historyTombstoneRevisionsRef.current)
          : null;
        const viralResponseRevision = requestedViralId
          ? captureHistoryResponseRevision('viral-analysis', requestedViralId, historyEntityRevisionsRef.current, historyTombstoneRevisionsRef.current)
          : null;
        const result = await api.reconcileDeltas({
          sinceRevision: revisionRef.current,
          taskId: requestedTaskId ?? undefined,
          viralAnalysisId: requestedViralId ?? undefined,
          forceReset,
        });
        if (disposed) return;
        if (result.resetRequired) {
          coordinator.beginReset();
          resetInProgress = true;
          resetRecoveryRevision = revisionRef.current;
          beginSnapshotInstallation();
          const bootstrap = await loadCompleteBootstrap(api, await api.getBootstrap());
          const replayed = coordinator.reset({
            revision: bootstrap.revision,
            tasks: bootstrap.tasks.items,
            events: result.taskEvents,
            viralAnalyses: bootstrap.viralAnalyses.items,
            imageLabRecords: bootstrap.imageLabRecords.items,
            voiceLabRecords: bootstrap.voiceLabRecords.items,
          });
          revisionRef.current = replayed.revision;
          const guardedResult = {
            ...result,
            task: requestedTaskId && taskResponseRevision
              && isHistoryResponseCurrent('task', requestedTaskId, taskResponseRevision, historyEntityRevisionsRef.current, historyTombstoneRevisionsRef.current)
              ? result.task
              : null,
            taskEvents: requestedTaskId && taskResponseRevision
              && isHistoryResponseCurrent('task', requestedTaskId, taskResponseRevision, historyEntityRevisionsRef.current, historyTombstoneRevisionsRef.current)
              ? result.taskEvents
              : [],
            viralAnalysis: requestedViralId && viralResponseRevision
              && isHistoryResponseCurrent('viral-analysis', requestedViralId, viralResponseRevision, historyEntityRevisionsRef.current, historyTombstoneRevisionsRef.current)
              ? result.viralAnalysis
              : null,
            viralEvents: requestedViralId && viralResponseRevision
              && isHistoryResponseCurrent('viral-analysis', requestedViralId, viralResponseRevision, historyEntityRevisionsRef.current, historyTombstoneRevisionsRef.current)
              ? result.viralEvents
              : [],
          };
          const rebuiltResetState = mergeReconciliationSlices(mergeDeltaView(bootstrapToState(bootstrap), replayed), guardedResult);
          const missingRequestedTaskId = authoritativeMissingRequestedTaskId(
            requestedTaskId,
            result.task,
            rebuiltResetState.tasks,
          );
          if (missingRequestedTaskId) {
            applyHistoryEntityBarrier('task', missingRequestedTaskId);
          }
          installAuthoritativeSnapshot(
            rebuiltResetState,
            bootstrap.revision,
            replayed.revision,
            true,
            guardedResult.task ? new Set([guardedResult.task.id]) : undefined,
          );
          resetInProgress = false;
          const activeTaskId = selectedTaskIdRef.current ?? activeHtmlTaskIdRef.current;
          if (activeTaskId) void refreshTaskDetail(activeTaskId);
          const activeViralId = activeViralAnalysisIdRef.current;
          if (activeViralId) void refreshViralEvents(activeViralId);
          return;
        }
        result.deltas.forEach(applyIncomingDelta);
        const guardedResult = {
          ...result,
          task: requestedTaskId && taskResponseRevision
            && isHistoryResponseCurrent('task', requestedTaskId, taskResponseRevision, historyEntityRevisionsRef.current, historyTombstoneRevisionsRef.current)
            ? result.task
            : null,
          taskEvents: requestedTaskId && taskResponseRevision
            && isHistoryResponseCurrent('task', requestedTaskId, taskResponseRevision, historyEntityRevisionsRef.current, historyTombstoneRevisionsRef.current)
            ? result.taskEvents
            : [],
          viralAnalysis: requestedViralId && viralResponseRevision
            && isHistoryResponseCurrent('viral-analysis', requestedViralId, viralResponseRevision, historyEntityRevisionsRef.current, historyTombstoneRevisionsRef.current)
            ? result.viralAnalysis
            : null,
          viralEvents: requestedViralId && viralResponseRevision
            && isHistoryResponseCurrent('viral-analysis', requestedViralId, viralResponseRevision, historyEntityRevisionsRef.current, historyTombstoneRevisionsRef.current)
            ? result.viralEvents
            : [],
        };
        const current = coordinator.current();
        if (current && result.revision === current.revision) {
          const eventsBySeq = new Map(current.events.map((event) => [event.seq, event]));
          guardedResult.taskEvents.forEach((event) => eventsBySeq.set(event.seq, event));
          const synced = coordinator.bootstrap({
            ...current,
            revision: result.revision,
            events: [...eventsBySeq.values()].sort((left, right) => left.seq - right.seq),
          });
          applyDeltaState(synced);
        }
        setState((currentState) => mergeReconciliationSlices(currentState, guardedResult));
      } catch (error) {
        if (resetInProgress) {
          const current = coordinator.current();
          const replayed = current ? coordinator.reset(current) : null;
          if (replayed) applyDeltaState(replayed);
          recoverSnapshotInstallation(resetRecoveryRevision, replayed?.revision ?? resetRecoveryRevision);
          resetInProgress = false;
        }
        shellAction.reportError(error);
      } finally {
        reconciling = false;
        flushQueuedReconciliation();
      }
    }
    const coordinator = createAppDeltaCoordinator(
      (gap) => {
        if (gap) requestReconciliation();
      },
      () => {
        requestReconciliation(true);
      },
    );
    const unsubscribe = api.onAppDelta((delta: AppDelta) => {
      try {
        applyIncomingDelta(delta);
      } catch (error) {
        shellAction.reportError(error);
      }
    });
    api.getBootstrap().then((initialBootstrap) => loadCompleteBootstrap(api, initialBootstrap)).then((bootstrap) => {
      if (disposed) return;
      applyStoredTheme(bootstrap.ui.theme);
      revealThemedApplication();
      const replayed = coordinator.bootstrap({
        revision: bootstrap.revision,
        tasks: bootstrap.tasks.items,
        events: [],
        viralAnalyses: bootstrap.viralAnalyses.items,
        imageLabRecords: bootstrap.imageLabRecords.items,
        voiceLabRecords: bootstrap.voiceLabRecords.items,
      });
      revisionRef.current = replayed.revision;
      installAuthoritativeSnapshot(
        mergeDeltaView(bootstrapToState(bootstrap), replayed),
        bootstrap.revision,
        replayed.revision,
        false,
      );
      flushQueuedReconciliation();
    }).catch((error) => {
      if (disposed) return;
      revealThemedApplication();
      recoverSnapshotInstallation(revisionRef.current, coordinator.current()?.revision ?? revisionRef.current);
      shellAction.reportError(error);
      requestReconciliation(true);
    });
    const reconciliationTimer = window.setInterval(() => {
      requestReconciliation();
    }, 30_000);
    return () => {
      disposed = true;
      window.clearInterval(reconciliationTimer);
      unsubscribe();
    };
  }, [api, applyHistoryBarrier, refreshHistoryFamilies, refreshTaskDetail, refreshViralEvents, shellAction.clearFeedback, shellAction.reportError]);

  useEffect(() => {
    if (!selectedTaskId) return;
    void refreshTaskDetail(selectedTaskId);
  }, [refreshTaskDetail, selectedTaskId]);

  function persistActiveViewPreference(view: ShellView) {
    viewPreferencePersistenceRef.current = viewPreferencePersistenceRef.current
      .catch(() => undefined)
      .then(async () => {
        const next = await api.saveUiPreferences({ activeView: view });
        applyState(next);
      })
      .catch((error) => {
        shellAction.reportError(error);
      });
  }

  function navigate(view: ShellView) {
    if (view === activeViewRef.current) return;
    void navigation.requestLeave(() => navigateNow(view));
  }

  function navigateNow(view: ShellView) {
    const from = activeViewRef.current;
    activeViewRef.current = view;
    setTaskDetailReturnView((current) => workspaceReturnViewForNavigation(from, view, current));
    startTransition(() => {
      setRequestedEditorialCollageTaskId('');
      setRequestedMotionComicTaskId('');
      setRequestedHtmlTaskId('');
      if (view !== 'task-detail') {
        setSelectedTaskId(null);
      }
      setActiveView(view);
    });
    persistActiveViewPreference(view);
  }

  function openSettings(section: SettingsSection, returnView: ShellView, taskId?: string) {
    void navigation.requestLeave(() => {
      setSettingsEntry({ section, returnView, taskId, taskReturnView: taskDetailReturnView });
      navigateNow('settings');
    });
  }

  function returnFromSettings() {
    const entry = settingsEntry;
    void navigation.requestLeave(async () => {
      setSettingsEntry(null);
      if (entry?.taskId) await openTaskDetailNow(entry.taskId, entry.taskReturnView);
      else navigateNow(entry?.returnView ?? 'new-task');
    });
  }

  function applyState(next: AppMutationResult | null) {
    if (isBrowserPreview && next) {
      applyHistoryBarrier(next);
      const claimedRevisions = claimMutationResult(next, mutationRevisionsRef.current);
      if (!claimedRevisions) return;
      setState((current) => applyLocalMutationResponse(current, next, new Map(claimedRevisions), true));
    }
    setSaveTone('saved');
  }

  async function openTaskDetail(taskId: string, returnView: ShellView = 'history') {
    await navigation.requestLeave(() => openTaskDetailNow(taskId, returnView));
  }

  async function openTaskDetailNow(taskId: string, returnView: ShellView = 'history') {
    let task = state.tasks.find((candidate) => candidate.id === taskId) ?? null;
    if (!task) {
      const lookup = await shellAction.run(async () => {
        const detail = await api.getTaskDetail(taskId);
        if (!detail) throw new Error('任务不存在或已被移除。');
        return detail;
      });
      if (!lookup.ok) return;
      task = lookup.value;
    }
    const targetView = taskWorkspaceView(task.taskType);
    setTaskDetailReturnView(returnView);
    selectedTaskIdRef.current = targetView === 'task-detail' ? taskId : null;
    activeHtmlTaskIdRef.current = targetView === 'html-video' ? taskId : null;
    activeViewRef.current = targetView;
    startTransition(() => {
      setSelectedTaskId(targetView === 'task-detail' ? taskId : null);
      setRequestedEditorialCollageTaskId(targetView === 'editorial-collage' ? taskId : '');
      setRequestedMotionComicTaskId(targetView === 'motion-comic' ? taskId : '');
      setRequestedHtmlTaskId(targetView === 'html-video' ? taskId : '');
      setActiveView(targetView);
    });
    setSaveTone('saving');
    const result = await shellAction.run(async () => {
      const next = await api.saveUiPreferences({ activeView: targetView });
      applyState(next);
      setSaveTone('saved');
    });
    if (!result.ok) {
      setSaveTone('dirty');
    }
  }

  function minimizeWindow() {
    void shellAction.run(() => api.windowControl('minimize'));
  }

  function toggleMaximizeWindow() {
    void shellAction.run(() => api.windowControl('toggle-maximize'));
  }

  const requestCloseWindow = useNativeWindowLeaveGuard(() => api.windowControl('close'), !isBrowserPreview);
  function closeWindow() { void requestCloseWindow().catch(shellAction.reportError); }

  function toggleTheme() {
    const currentTheme = runtimeThemeRef.current;
    const theme = currentTheme === 'light' ? 'dark' : 'light';
    void shellAction.run(async () => {
      const changed = await changeRuntimeTheme({
        currentTheme,
        nextTheme: theme,
        synchronizeState: synchronizeThemeState,
        persist: () => api.saveUiPreferences({ theme }),
      });
      applyState(changed.mutation);
    });
  }

  const selectedTask = selectedTaskId
    ? state.tasks.find((task) => task.id === selectedTaskId) ?? null
    : activeView === 'task-detail'
      ? null
      : state.tasks[0] ?? null;
  return (
    <StoryDreamProvider theme={state.ui.theme}>
      <AppShell
        activeView={activeView}
        returnView={taskDetailReturnView}
        state={state}
        saveTone={navigation.submitting ? 'saving' : navigation.dirty ? 'dirty' : saveTone}
        isBrowserPreview={isBrowserPreview}
        busy={shellAction.busy}
        feedback={shellAction.feedback}
        navigate={navigate}
        openTaskDetail={openTaskDetail}
        minimizeWindow={minimizeWindow}
        toggleMaximizeWindow={toggleMaximizeWindow}
        closeWindow={closeWindow}
        toggleTheme={toggleTheme}
        updateStatus={updateStatus}
        updateBusy={updateActionBusy}
        updateAction={updateAction}
        openAnnouncements={() => { if (!isBrowserPreview) void runUpdateAction('checking', () => api.checkForUpdate()); }}
        checkForUpdate={() => { void runUpdateAction('checking', () => api.checkForUpdate()); }}
        downloadUpdate={() => { void runUpdateAction('downloading', () => api.downloadUpdate()); }}
        installUpdate={() => { void runUpdateAction('installing', () => api.installUpdate()); }}
      >
        <RouteErrorBoundary resetKey={activeView} onNavigate={navigate}>
          {bootstrapReady ? <AppRoutes
            activeView={activeView}
            api={api}
            state={state}
            selectedTask={selectedTask}
            applyState={applyState}
            synchronizeThemeState={synchronizeThemeState}
            navigate={navigate}
            openSettings={openSettings}
            initialSettingsSection={settingsEntry?.section}
            settingsReturnView={settingsEntry?.returnView}
            returnFromSettings={returnFromSettings}
            openTaskDetail={openTaskDetail}
            taskDetailReturnView={taskDetailReturnView}
            isHistoryTombstoned={isHistoryTombstoned}
            historyFamilyEpochs={historyFamilyEpochs}
            refreshTaskDetail={refreshTaskDetail}
            requestedEditorialCollageTaskId={requestedEditorialCollageTaskId}
            requestedMotionComicTaskId={requestedMotionComicTaskId}
            requestedHtmlTaskId={requestedHtmlTaskId}
            onRequestedEditorialCollageTaskHandled={onRequestedEditorialCollageTaskHandled}
            onRequestedMotionComicTaskHandled={onRequestedMotionComicTaskHandled}
            onRequestedHtmlTaskHandled={onRequestedHtmlTaskHandled}
            onActiveHtmlTaskChange={onActiveHtmlTaskChange}
            refreshViralEvents={refreshViralEvents}
            onActiveViralAnalysisChange={onActiveViralAnalysisChange}
            isBrowserPreview={isBrowserPreview}
          /> : <RouteLoadingState label={shellAction.feedback?.tone === 'error'
            ? '加载配置失败，正在尝试重新连接。'
            : '正在加载项目和模型配置'} />}
        </RouteErrorBoundary>
      </AppShell>
      <WorkspaceLeaveDialog />
    </StoryDreamProvider>
  );
}
