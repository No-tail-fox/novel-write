import React, { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import type { AppDelta, AppMutationResult, HistoryFamily, ShellView, ThemeName } from "../shared/types";
import { createAppDeltaCoordinator, MAX_RENDERER_DELTA_BUFFER, type DeltaViewState, type RevisionGap } from "../shared/state-delta";
import { applyAppMutationResult, applyBufferedMutationResults, applyHistorySelectionBarrier, applyLocalMutationResponse, authoritativeMissingRequestedTaskId, claimMutationResult, collectTaskEventPages, collectViralEventPages, createRequestGenerationCompletionQueue, createRequestGenerationGuard, historyEntityRevisionKey, historyResponseDisposition, mergeAuthoritativeSnapshotDetails, mergeReconciliationSlices, raiseMutationRevisionFloor, reduceCompletionTrackedState, shouldApplyDeltaViewTransition } from "../shared/state-reconciliation";
import { applyStoredTheme, changeRuntimeTheme, revealThemedApplication, transitionRendererTheme } from "../features/settings/theme-controller";
import { defaultUiPreferences } from "../shared/config";
import { useAsyncAction } from "../ui/async-action";
import { StoryDreamProvider } from "../ui";
import { advanceHistoryFamilyEpochs, allHistoryFamilies, bootstrapToState, captureHistoryResponseRevision, cloneState, initialState, isHistoryResponseCurrent, loadCompleteBootstrap, MAX_TASK_DETAIL_REVISION_ATTEMPTS, mergeDeltaView, registerHistoryDeltaBarrier, replaceHistoryRevisionMap, type HistoryFamilyEpochs } from "./app-state";
import { makeFallbackApi } from "./browser-fallback";
import type { RendererAppState as AppState } from "./route-types";
import { AppRoutes } from './AppRoutes';
import { AppShell } from './AppShell';
import { taskWorkspaceView } from './navigation';
import { RouteErrorBoundary } from './RouteErrorBoundary';

applyStoredTheme(defaultUiPreferences.theme);

export function App() {
  const [trackedState, dispatchState] = useReducer(
    reduceCompletionTrackedState<AppState>,
    { value: cloneState(initialState), completionToken: 0 },
  );
  const state = trackedState.value;
  const taskDetailCompletionEpoch = trackedState.completionToken;
  const setState = useCallback((update: React.SetStateAction<AppState>) => {
    dispatchState({ update });
  }, []);
  const [activeView, setActiveView] = useState<ShellView>('new-task');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [requestedEditorialCollageTaskId, setRequestedEditorialCollageTaskId] = useState('');
  const [requestedMotionComicTaskId, setRequestedMotionComicTaskId] = useState('');
  const [requestedHtmlTaskId, setRequestedHtmlTaskId] = useState('');
  const [historyFamilyEpochs, setHistoryFamilyEpochs] = useState<HistoryFamilyEpochs>({});
  const [saveTone, setSaveTone] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const isBrowserPreview = !window.storydream && !window.storybound;
  const api = useMemo(() => window.storydream ?? window.storybound ?? makeFallbackApi(setState), []);
  const shellAction = useAsyncAction();
  const runtimeThemeRef = useRef<ThemeName>(state.ui.theme);
  const revisionRef = useRef(0);
  const mutationRevisionsRef = useRef(new Map<string, number>());
  const historyEntityRevisionsRef = useRef(new Map<string, number>());
  const historyTombstoneRevisionsRef = useRef(new Map<string, number>());
  const activeViewRef = useRef<ShellView>('new-task');
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
  }, [state.ui.theme]);
  const synchronizeThemeState = useCallback((expectedTheme: ThemeName, nextTheme: ThemeName) => {
    if (runtimeThemeRef.current !== expectedTheme) return false;
    runtimeThemeRef.current = nextTheme;
    setState((current) => transitionRendererTheme(current, expectedTheme, nextTheme));
    return expectedTheme !== nextTheme;
  }, [setState]);
  useEffect(() => {
    const revealTimer = window.setTimeout(revealThemedApplication, 1_200);
    return () => window.clearTimeout(revealTimer);
  }, []);
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
      setActiveView(bootstrap.ui.activeView);
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
  }, [api, applyHistoryBarrier, refreshHistoryFamilies, refreshTaskDetail, refreshViralEvents, shellAction.reportError]);

  useEffect(() => {
    if (!selectedTaskId) return;
    void refreshTaskDetail(selectedTaskId);
  }, [refreshTaskDetail, selectedTaskId]);

  async function navigate(view: ShellView) {
    startTransition(() => {
      setRequestedEditorialCollageTaskId('');
      setRequestedMotionComicTaskId('');
      setRequestedHtmlTaskId('');
      if (view !== 'task-detail') {
        setSelectedTaskId(null);
      }
      setActiveView(view);
    });
    setSaveTone('saving');
    const result = await shellAction.run(async () => {
      const next = await api.saveUiPreferences({ activeView: view });
      applyState(next);
      setSaveTone('saved');
    });
    if (!result.ok) {
      setSaveTone('dirty');
    }
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

  async function openTaskDetail(taskId: string) {
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

  function closeWindow() {
    void shellAction.run(() => api.windowControl('close'));
  }

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
        state={state}
        saveTone={saveTone}
        isBrowserPreview={isBrowserPreview}
        busy={shellAction.busy}
        feedback={shellAction.feedback}
        navigate={navigate}
        openTaskDetail={openTaskDetail}
        minimizeWindow={minimizeWindow}
        toggleMaximizeWindow={toggleMaximizeWindow}
        closeWindow={closeWindow}
        toggleTheme={toggleTheme}
      >
        <RouteErrorBoundary resetKey={activeView} onNavigate={navigate}>
          <AppRoutes
            activeView={activeView}
            api={api}
            state={state}
            selectedTask={selectedTask}
            applyState={applyState}
            synchronizeThemeState={synchronizeThemeState}
            navigate={navigate}
            openTaskDetail={openTaskDetail}
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
          />
        </RouteErrorBoundary>
      </AppShell>
    </StoryDreamProvider>
  );
}
