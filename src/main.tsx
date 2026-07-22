import React, { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  Bell,
  Bot,
  Coins,
  Copy,
  Database,
  Eye,
  EyeOff,
  FolderOpen,
  Image as ImageIcon,
  Info,
  KeyRound,
  Loader2,
  Maximize2,
  Mic2,
  Minus,
  Palette,
  Play,
  Plus,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X,
  XCircle,
} from 'lucide-react';
import type {
  ActivationState,
  AppDelta,
  AppMutationResult,
  AppConfig,
  ConfigTestTarget,
  HistoryFamily,
  ImageProviderProfile,
  ImaKnowledgeResult,
  ProviderModel,
  ProviderModelListRequest,
  ShellView,
  TtsProviderProfile,
  VolcengineSpeaker,
} from './shared/types';
import type { StoryDreamApi } from './shared/storydream-api';
import { NewTaskPage } from './features/tasks/NewTaskPage';
import { QueuePage } from './features/tasks/QueuePage';
import { HistoryPage } from './features/tasks/HistoryPage';
import { TaskDetailPage } from './features/tasks/TaskDetailPage';
import { ArtifactEmpty } from './features/tasks/TaskArtifactPreview';
import { BookSelectionPage } from './features/labs/BookSelectionPage';
import { BenchmarkImportPage } from './features/labs/BenchmarkImportPage';
import { PersonAssetsPage } from './features/labs/PersonAssetsPage';
import { ImageLabPage } from './features/labs/ImageLabPage';
import { VoiceLabPage } from './features/labs/VoiceLabPage';
import { MusicMvPage } from './features/music-mv/MusicMvPage';
import { HtmlVideoPage } from './features/html-video/HtmlVideoPage';
import { ViralAnalyzerPage } from './features/viral/ViralAnalyzerPage';
import { PromptTemplatesPage } from './features/templates/PromptTemplatesPage';
import { DraftTemplatesPage } from './features/templates/DraftTemplatesPage';
import {
  addUploadedBgm,
  resolveDefaultBgmId,
  validBgmItems,
} from './features/tasks/task-formatters';
import {
  createAppDeltaCoordinator,
  MAX_RENDERER_DELTA_BUFFER,
  type DeltaViewState,
  type RevisionGap,
} from './shared/state-delta';
import {
  applyAppMutationResult,
  applyBufferedMutationResults,
  applyHistorySelectionBarrier,
  applyLocalMutationResponse,
  authoritativeMissingRequestedTaskId,
  claimMutationResult,
  collectTaskEventPages,
  collectViralEventPages,
  createRequestGenerationCompletionQueue,
  createRequestGenerationGuard,
  historyEntityRevisionKey,
  historyResponseDisposition,
  mergeAuthoritativeSnapshotDetails,
  mergeReconciliationSlices,
  raiseMutationRevisionFloor,
  reduceCompletionTrackedState,
  shouldApplyDeltaViewTransition,
} from './shared/state-reconciliation';
import type { SecretChanges, SecretId } from './shared/config-secrets';
import {
  applyStoredTheme,
  changeRuntimeTheme,
  revealThemedApplication,
} from './features/settings/theme-controller';
import { configTargetStatus } from './shared/config-utils';
import {
  activeImageProfileId,
  activeLlmProfileId,
  activeTtsProfileId,
  activateSelectedProviderProfileForTarget,
  addImageProfile,
  addLlmProfile,
  addTtsProfile,
  buildConfigForSelectedProfileTest,
  copyImageProfile,
  copyLlmProfile,
  copyTtsProfile,
  editableLlmProfileProvider,
  enableImageProfile,
  enableLlmProfile,
  enableTtsProfile,
  imageProfileCustomImage,
  imageProfileGptImage,
  imageProfileJimeng,
  normalizeEditableConfigProviders,
  normalizedImageProfiles,
  normalizedTtsProfiles,
  removeImageProfile,
  removeLlmProfile,
  removeTtsProfile,
  saveImageProfile,
  saveLlmProfile,
  saveTtsProfile,
  ttsProfileMinimax,
  ttsProfileVolcengine,
} from './shared/provider-profile-utils';
import { defaultConfig, defaultUiPreferences } from './shared/config';
import { taskProgressLabel } from './shared/html-video-workflow';
import { useAsyncAction } from './ui/async-action';
import { FormField as Field } from './components/FormField';
import { SegmentedControl as Segmented } from './components/SegmentedControl';
import { ToggleField } from './components/ToggleField';
import { RangeField } from './components/RangeField';
import { AsyncActionFeedback as InlineActionFeedback } from './components/AsyncActionFeedback';
import { StatusBadge as StatusPill, taskStatusLabel as statusLabel } from './components/StatusBadge';
import {
  navigationItemForView,
  newTaskPrimaryAction,
  pageSubtitle,
  primaryNavItems,
  secondaryNavItems,
  type NavigationItem as NavItem,
} from './app/navigation';
import {
  advanceHistoryFamilyEpochs,
  allHistoryFamilies,
  bootstrapToState,
  captureHistoryResponseRevision,
  cloneState,
  configFromMutation,
  initialState,
  isHistoryResponseCurrent,
  loadCompleteBootstrap,
  MAX_TASK_DETAIL_REVISION_ATTEMPTS,
  mergeDeltaView,
  registerHistoryDeltaBarrier,
  replaceHistoryRevisionMap,
  type HistoryFamilyEpochs,
} from './app/app-state';
import { makeFallbackApi } from './app/browser-fallback';
import type { ApplyMutationResult, RendererAppState as AppState } from './app/route-types';
import {
  siliconFlowSpeechToTextBaseUrl,
  siliconFlowSpeechToTextModels,
  volcengineVoicePresets,
} from './shared/editorial-options';
import './styles.css';

type ModelListKey = 'llm' | 'gpt-image' | 'custom-image';
type SecretEditor = {
  value: (id: SecretId) => string;
  configured: (id: SecretId) => boolean;
  reference: (id: SecretId) => { value: string; secretId?: string };
  change: (id: SecretId, value: string | null) => void;
};

function profileSecretId(domain: 'llm' | 'image' | 'tts', profileId: string | undefined, suffix: string): SecretId {
  const stableId = profileId?.trim();
  if (!stableId) throw new Error('Provider profile requires a stable id.');
  return `${domain}/${encodeURIComponent(stableId)}/${suffix}` as SecretId;
}

function App() {
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
  const [historyFamilyEpochs, setHistoryFamilyEpochs] = useState<HistoryFamilyEpochs>({});
  const [saveTone, setSaveTone] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const isBrowserPreview = !window.storydream && !window.storybound;
  const api = useMemo(() => window.storydream ?? window.storybound ?? makeFallbackApi(setState), []);
  const shellAction = useAsyncAction();
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
    applyStoredTheme(state.ui.theme);
  }, [state.ui.theme]);
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
    if (view !== 'task-detail') {
      setSelectedTaskId(null);
    }
    setActiveView(view);
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
    setSelectedTaskId(taskId);
    setActiveView('task-detail');
    setSaveTone('saving');
    const result = await shellAction.run(async () => {
      const next = await api.saveUiPreferences({ activeView: 'task-detail' });
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

  const selectedTask = selectedTaskId
    ? state.tasks.find((task) => task.id === selectedTaskId) ?? null
    : activeView === 'task-detail'
      ? null
      : state.tasks[0] ?? null;
  const recentTasks = state.tasks.slice(0, 3);
  const trialDaysLabel = state.activation.expiresAt
    ? `${Math.max(0, Math.ceil((new Date(state.activation.expiresAt).getTime() - Date.now()) / 86400000))} 天`
    : '本地试用';
  const activeNav = navigationItemForView(activeView);
  const NewTaskIcon = newTaskPrimaryAction.icon;

  return (
    <main className="app-shell">
      <div className="window-line">
        <div className="window-title">
          <div className="app-mark">S</div>
          <strong>StoryDream</strong>
        </div>
        <div className="window-controls" aria-label="窗体控制">
          <button className="window-control-button" type="button" aria-label="最小化" onClick={minimizeWindow}>
            <Minus size={14} />
          </button>
          <button className="window-control-button" type="button" aria-label="最大化" onClick={toggleMaximizeWindow}>
            <Maximize2 size={14} />
          </button>
          <button className="window-control-button close" type="button" aria-label="关闭" onClick={closeWindow}>
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="shell-grid">
        <aside className="sidebar">
          <div className="brand-block">
            <div className="brand-logo">S</div>
            <div>
              <strong>StoryDream</strong>
              <span>v0.10.4 · beta</span>
            </div>
            <Bell size={16} className="brand-bell" />
          </div>

          <button className="new-task-button" onClick={() => navigate(newTaskPrimaryAction.view)}>
            <NewTaskIcon size={16} />
            <span>{newTaskPrimaryAction.label}</span>
            <kbd>Ctrl+N</kbd>
          </button>

          <nav className="nav-list">
            <span className="nav-section-label">主线工作流</span>
            {primaryNavItems.map((item) => (
              <NavButton key={item.view} item={item} active={activeView === item.view} navigate={navigate} />
            ))}
            <span className="nav-section-label secondary">扩展工具</span>
            {secondaryNavItems.map((item) => (
              <NavButton key={item.view} item={item} active={activeView === item.view} navigate={navigate} />
            ))}
          </nav>

          <div className="sidebar-bottom">
            <section className="recent-task-strip">
              <span className="nav-section-label">最近任务</span>
              {recentTasks.length === 0 ? <small>暂无任务</small> : null}
              {recentTasks.map((task) => (
                <button key={task.id} className="recent-task-item" onClick={() => openTaskDetail(task.id)}>
                  <strong>{task.title || '未命名任务'}</strong>
                  <span>{statusLabel(task.status)} · {taskProgressLabel(task)}</span>
                </button>
              ))}
            </section>
            <button className="trial-activation-bar" onClick={() => navigate('activation')}>
              <KeyRound size={15} />
              <span>试用剩余</span>
              <strong>{trialDaysLabel}</strong>
            </button>
            <div className="account-entry-grid">
              <button className="credit-chip" onClick={() => navigate('account')}>
                <Coins size={15} />
                积分明细
                <span>{state.account.balance.toFixed(2)}</span>
              </button>
              <button className="feedback-link" onClick={() => navigate('account')}>
                <Info size={14} />
                账户中心
              </button>
            </div>
          </div>
        </aside>

        <section className="content">
          <header className="page-head">
          <div>
            <h1>{activeNav.label}</h1>
            <p>{pageSubtitle(activeView)}</p>
            {isBrowserPreview ? <span className="local-note">浏览器预览不能执行真实流水线，请在 Electron 应用中运行任务。</span> : null}
          </div>
            <div className="top-notice">
              <Info size={16} />
              <span>{state.config.jianying.draftPath ? `剪映草稿目录：${state.config.jianying.draftPath}` : '尚未配齐：剪映草稿目录'}</span>
            </div>
            <div className={`save-state ${saveTone}`}>
              <span />
              {saveTone === 'saving' ? '保存中' : saveTone === 'dirty' ? '有未保存改动' : '所有改动已保存'}
            </div>
          </header>
          {shellAction.feedback ? (
            <div className="global-action-banner">
              <InlineActionFeedback feedback={shellAction.feedback} />
            </div>
          ) : null}

          {activeView === 'new-task' ? <NewTaskPage api={api} state={state} applyState={applyState} openTaskDetail={openTaskDetail} isBrowserPreview={isBrowserPreview} /> : null}
          {activeView === 'book-selection' ? <BookSelectionPage api={api} navigate={navigate} /> : null}
          {activeView === 'benchmark' ? <BenchmarkImportPage api={api} applyState={applyState} openTaskDetail={openTaskDetail} isBrowserPreview={isBrowserPreview} /> : null}
          {activeView === 'person-assets' ? <PersonAssetsPage api={api} isBrowserPreview={isBrowserPreview} /> : null}
          {activeView === 'queue' ? <QueuePage api={api} state={state} applyState={applyState} openNewTask={() => navigate('new-task')} openTaskDetail={openTaskDetail} isBrowserPreview={isBrowserPreview} /> : null}
          {activeView === 'history' ? (
            <HistoryPage
              api={api}
              openTaskDetail={openTaskDetail}
              isTombstoned={isHistoryTombstoned}
              familyEpoch={historyFamilyEpochs.task ?? 0}
            />
          ) : null}
          {activeView === 'task-detail' ? <TaskDetailPage api={api} state={state} task={selectedTask} applyState={applyState} close={() => navigate('history')} isBrowserPreview={isBrowserPreview} /> : null}
          {activeView === 'image-lab' ? <ImageLabPage api={api} state={state} applyState={applyState} /> : null}
          {activeView === 'voice-lab' ? <VoiceLabPage api={api} state={state} applyState={applyState} /> : null}
          {activeView === 'music-mv' ? <MusicMvPage api={api} state={state} applyState={applyState} openTaskDetail={openTaskDetail} isBrowserPreview={isBrowserPreview} /> : null}
          {activeView === 'html-video' ? <HtmlVideoPage api={api} state={state} applyState={applyState} refreshTaskDetail={refreshTaskDetail} onActiveTaskChange={onActiveHtmlTaskChange} isBrowserPreview={isBrowserPreview} /> : null}
          {activeView === 'viral-analyzer' ? <ViralAnalyzerPage api={api} state={state} applyState={applyState} refreshViralEvents={refreshViralEvents} onActiveAnalysisChange={onActiveViralAnalysisChange} openTaskDetail={openTaskDetail} isBrowserPreview={isBrowserPreview} /> : null}
          {activeView === 'prompt-templates' ? <PromptTemplatesPage api={api} state={state} applyState={applyState} /> : null}
          {activeView === 'draft-templates' ? <DraftTemplatesPage api={api} state={state} applyState={applyState} /> : null}
          {activeView === 'settings' ? <SettingsPage api={api} state={state} applyState={applyState} navigate={navigate} /> : null}
          {activeView === 'account' ? <AccountPage api={api} state={state} applyState={applyState} /> : null}
          {activeView === 'activation' ? <ActivationPage api={api} state={state} applyState={applyState} /> : null}
        </section>
      </div>
    </main>
  );
}

function NavButton({ item, active, navigate }: { item: NavItem; active: boolean; navigate: (view: ShellView) => void }) {
  const Icon = item.icon;
  return (
    <button className={active ? 'nav-item active' : 'nav-item'} onClick={() => navigate(item.view)}>
      <Icon size={16} />
      <span>{item.label}</span>
      <small>{item.hint}</small>
    </button>
  );
}

function SettingsPage({ api, state, applyState, navigate }: { api: StoryDreamApi; state: AppState; applyState: ApplyMutationResult; navigate: (view: ShellView) => void }) {
  const [section, setSection] = useState('llm');
  const [draft, setDraft] = useState<AppConfig>(() => normalizeEditableConfigProviders(state.config));
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [secretChanges, setSecretChanges] = useState<SecretChanges>({});
  const [lastAppliedConfigSignature, setLastAppliedConfigSignature] = useState(() => settingsConfigSignature(state.config));
  const [diagnostics, setDiagnostics] = useState('');
  const [configTestResult, setConfigTestResult] = useState('');
  const [imaKnowledgeResult, setImaKnowledgeResult] = useState<ImaKnowledgeResult | null>(null);
  const [testingConfig, setTestingConfig] = useState(false);
  const [modelLists, setModelLists] = useState<Record<ModelListKey, ProviderModel[]>>({ llm: [], 'gpt-image': [], 'custom-image': [] });
  const [modelListStatus, setModelListStatus] = useState<Partial<Record<ModelListKey, string>>>({});
  const [loadingModelList, setLoadingModelList] = useState<ModelListKey | null>(null);
  const [volcengineSpeakers, setVolcengineSpeakers] = useState<VolcengineSpeaker[]>([]);
  const [volcengineSpeakerStatus, setVolcengineSpeakerStatus] = useState('');
  const [loadingVolcengineSpeakers, setLoadingVolcengineSpeakers] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [selectedLlmProfileId, setSelectedLlmProfileId] = useState(() => activeLlmProfileId(state.config));
  const [selectedImageProfileId, setSelectedImageProfileId] = useState(() => activeImageProfileId(state.config));
  const [selectedTtsProfileId, setSelectedTtsProfileId] = useState(() => activeTtsProfileId(state.config));
  const settingsAction = useAsyncAction();
  const themeAction = useAsyncAction();
  useEffect(() => {
    if (settingsDirty) return;
    const nextSignature = settingsConfigSignature(state.config);
    if (nextSignature === lastAppliedConfigSignature) return;
    setDraft(normalizeEditableConfigProviders(state.config));
    setSecretChanges({});
    setLastAppliedConfigSignature(nextSignature);
  }, [lastAppliedConfigSignature, settingsDirty, state.config]);
  function setSettingsDraft(next: AppConfig | ((current: AppConfig) => AppConfig)) {
    setSettingsDirty(true);
    setDraft(next);
  }
  function commitSettingsDraft(next: AppConfig) {
    const normalized = normalizeEditableConfigProviders(next);
    setDraft(normalized);
    setSettingsDirty(false);
    setSecretChanges({});
    setLastAppliedConfigSignature(settingsConfigSignature(normalized));
  }
  const persistSettingsDraft = async (nextDraft: AppConfig, successMessage: string) => {
    setSavingConfig(true);
    try {
      const next = await api.saveConfig({ config: normalizeEditableConfigProviders(nextDraft), secretChanges });
      const savedConfig = configFromMutation(next);
      commitSettingsDraft(savedConfig);
      applyState(next);
      setConfigTestResult(`[pass] ${successMessage}`);
      return savedConfig;
    } finally {
      setSavingConfig(false);
    }
  };
  async function commitAndApplySettingsDraft(nextDraft: AppConfig, successMessage = '配置已保存') {
    const result = await settingsAction.run(
      () => persistSettingsDraft(nextDraft, successMessage),
      { onError: (error) => setConfigTestResult(`[fail] ${error.message}`) },
    );
    return result.ok ? result.value : undefined;
  }
  function clearProviderModels(key: ModelListKey) {
    setModelLists((current) => ({ ...current, [key]: [] }));
    setModelListStatus((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }
  function changeSecret(id: SecretId, value: string | null) {
    setSettingsDirty(true);
    setSecretChanges((current) => {
      const next = { ...current };
      if (value === '') delete next[id];
      else next[id] = value;
      return next;
    });
  }
  function secretValue(id: SecretId): string {
    const value = secretChanges[id];
    return typeof value === 'string' ? value : '';
  }
  function isSecretConfigured(id: SecretId): boolean {
    const value = secretChanges[id];
    if (value === null) return false;
    if (typeof value === 'string') return value.length > 0;
    return state.secretStatus[id] === true;
  }
  function secretReference(id: SecretId): { value: string; secretId?: string } {
    if (secretChanges[id] === null) return { value: '' };
    return { value: secretValue(id), secretId: id };
  }
  const secrets: SecretEditor = {
    value: secretValue,
    configured: isSecretConfigured,
    reference: secretReference,
    change: changeSecret,
  };
  async function save() {
    await commitAndApplySettingsDraft(activateSelectedProviderProfileForTarget(draft, section as ConfigTestTarget, {
      llm: selectedLlmProfileId,
      image: selectedImageProfileId,
      tts: selectedTtsProfileId,
    }));
  }
  async function activateLlmProfile(id: string) {
    await commitAndApplySettingsDraft(enableLlmProfile(draft, id), '已启用 LLM 配置档案');
  }
  async function activateImageProfile(id: string) {
    await commitAndApplySettingsDraft(enableImageProfile(draft, id), '已启用绘图配置档案');
  }
  async function activateTtsProfile(id: string) {
    await commitAndApplySettingsDraft(enableTtsProfile(draft, id), '已启用 TTS 配置档案');
  }
  async function testCurrentConfig() {
    const target: ConfigTestTarget =
      section === 'llm' || section === 'image' || section === 'tts' || section === 'speechToText' || section === 'jianying' || section === 'creative'
        ? section
        : 'llm';
    await settingsAction.run(async () => {
      setTestingConfig(true);
      setSavingConfig(true);
      setConfigTestResult('正在保存并测试当前配置...');
      try {
        const nextDraft = activateSelectedProviderProfileForTarget(draft, target, {
          llm: selectedLlmProfileId,
          image: selectedImageProfileId,
          tts: selectedTtsProfileId,
        });
        const next = await api.saveConfig({ config: normalizeEditableConfigProviders(nextDraft), secretChanges });
        const savedConfig = configFromMutation(next);
        commitSettingsDraft(savedConfig);
        applyState(next);
        const testConfig = buildConfigForSelectedProfileTest(savedConfig, target, selectedProviderProfileIds);
        const result = await api.testAppConfig(target, testConfig);
        setConfigTestResult(`[${result.status}] ${result.detail}`);
      } finally {
        setSavingConfig(false);
        setTestingConfig(false);
      }
    }, { onError: (error) => setConfigTestResult(`[fail] ${error.message}`) });
  }
  async function refreshProviderModels(
    key: ModelListKey,
    request: ProviderModelListRequest,
    currentModel: string,
    applyModel?: (config: AppConfig, model: string) => AppConfig,
  ) {
    if (key === 'custom-image' && !request.baseUrl.trim()) {
      setModelListStatus((current) => ({ ...current, [key]: '[失败] 拉取模型前需要填写接口地址。' }));
      return;
    }
    await settingsAction.run(async () => {
      setLoadingModelList(key);
      setModelListStatus((current) => ({ ...current, [key]: '正在获取模型清单...' }));
      try {
        const result = await api.listProviderModels(request);
        setModelListStatus((current) => ({ ...current, [key]: `[${result.status}] ${result.detail}` }));
        if (result.models.length) {
          setModelLists((current) => ({ ...current, [key]: result.models }));
          if (!currentModel.trim()) {
            setSettingsDraft((current) => (applyModel ? applyModel(current, result.models[0].id) : setDraftModel(current, key, result.models[0].id)));
          }
        }
      } finally {
        setLoadingModelList((current) => (current === key ? null : current));
      }
    }, { onError: (error) => setModelListStatus((current) => ({ ...current, [key]: `[fail] ${error.message}` })) });
  }
  async function refreshVolcengineSpeakers(profile: TtsProviderProfile) {
    const volcengine = ttsProfileVolcengine(profile);
    const accessKeyIdId = profileSecretId('tts', profile.id, 'volcengine/accessKeyId');
    const secretAccessKeyId = profileSecretId('tts', profile.id, 'volcengine/secretAccessKey');
    const accessKeyId = secrets.reference(accessKeyIdId);
    const secretAccessKey = secrets.reference(secretAccessKeyId);
    if (!secrets.configured(accessKeyIdId) || !secrets.configured(secretAccessKeyId)) {
      setVolcengineSpeakerStatus('[失败] 加载火山音色列表需要填写访问密钥 ID 和访问密钥 Secret。');
      return;
    }

    const resourceId = (volcengine.resourceId ?? '').trim() || 'seed-tts-2.0';
    const limit = 100;
    await settingsAction.run(async () => {
      setLoadingVolcengineSpeakers(true);
      setVolcengineSpeakerStatus('正在加载全部音色...');
      try {
        const request = {
          accessKeyId: accessKeyId.value,
          secretAccessKey: secretAccessKey.value,
          accessKeyIdSecretId: accessKeyId.secretId,
          secretAccessKeySecretId: secretAccessKey.secretId,
          resourceId,
          limit,
        };
        const first = await api.listVolcengineSpeakers({ ...request, page: 1 });
        let speakers = mergeVolcengineSpeakers([], first.speakers);
        const total = first.total || speakers.length;
        if (first.status !== 'fail' && total > speakers.length) {
          const pageCount = Math.min(Math.ceil(total / limit), 20);
          for (let page = 2; page <= pageCount; page += 1) {
            const next = await api.listVolcengineSpeakers({ ...request, page });
            if (next.status === 'fail' || !next.speakers.length) break;
            speakers = mergeVolcengineSpeakers(speakers, next.speakers);
            if (speakers.length >= total) break;
          }
        }
        setVolcengineSpeakers(speakers);
        const loadedText = speakers.length > first.speakers.length ? `，已合并 ${speakers.length}/${total} 个` : '';
        setVolcengineSpeakerStatus(`[${first.status}] ${first.detail}${loadedText}`);
      } finally {
        setLoadingVolcengineSpeakers(false);
      }
    }, { onError: (error) => setVolcengineSpeakerStatus(`[fail] ${error.message}`) });
  }
  async function runDiagnostics() {
    await settingsAction.run(async () => {
      const report = await api.runDiagnostics();
      setDiagnostics(JSON.stringify(report, null, 2));
    });
  }
  async function fetchImaKnowledgeFromSettings() {
    await settingsAction.run(async () => {
      const savedConfig = await persistSettingsDraft(draft, 'IMA 配置已保存');
      const result = await api.fetchImaKnowledge({ query: savedConfig.ima.kbName || savedConfig.ima.kbId });
      setImaKnowledgeResult(result);
      setConfigTestResult(`[${result.status}] ${result.detail}`);
    }, { onError: (error) => setConfigTestResult(`[fail] ${error.message}`) });
  }
  async function uploadBgmFromSettings() {
    await settingsAction.run(async () => {
      const audioPath = await api.selectLocalAudio();
      if (!audioPath) return;
      const nextBgm = addUploadedBgm(draft, audioPath);
      await persistSettingsDraft(nextBgm.config, '已添加 BGM 文件');
    }, { onError: (error) => setConfigTestResult(`[fail] ${error.message}`) });
  }
  async function autoDetectJianyingDraftPath() {
    await settingsAction.run(async () => {
      setConfigTestResult('正在自动检测剪映草稿目录...');
      const detected = await api.detectJianyingDraftPath();
      if (!detected) {
        setConfigTestResult('[warn] 未自动检测到剪映草稿目录，请用“选择目录”手动指定。');
        return;
      }
      setSettingsDraft({ ...draft, jianying: { ...draft.jianying, draftPath: detected } });
      setConfigTestResult(`[pass] 已检测到剪映草稿目录：${detected}`);
    }, { onError: (error) => setConfigTestResult(`[fail] ${error.message}`) });
  }
  async function pickJianyingDraftPath() {
    await settingsAction.run(async () => {
      const folder = await api.selectLocalFolder();
      if (!folder) return;
      setSettingsDraft({ ...draft, jianying: { ...draft.jianying, draftPath: folder } });
      setConfigTestResult(`已选择剪映草稿目录：${folder}`);
    });
  }
  function setDefaultBgm(id: string) {
    setSettingsDraft({ ...draft, jianying: { ...draft.jianying, defaultBgmId: id } });
  }
  function updateBgmVolume(id: string, volume: number) {
    setSettingsDraft({
      ...draft,
      jianying: {
        ...draft.jianying,
        bgmLibrary: draft.jianying.bgmLibrary.map((bgm) => (bgm.id === id ? { ...bgm, volume } : bgm)),
      },
    });
  }
  function removeBgm(id: string) {
    const bgmLibrary = draft.jianying.bgmLibrary.filter((bgm) => bgm.id !== id);
    const nextConfig = { ...draft, jianying: { ...draft.jianying, bgmLibrary, defaultBgmId: draft.jianying.defaultBgmId === id ? '' : draft.jianying.defaultBgmId } };
    setSettingsDraft({ ...nextConfig, jianying: { ...nextConfig.jianying, defaultBgmId: resolveDefaultBgmId(nextConfig) } });
  }
  function updateSpeechToTextConfig(patch: Partial<AppConfig['speechToText']>) {
    setSettingsDraft({ ...draft, speechToText: { ...draft.speechToText, ...patch } });
  }
  function switchSpeechToTextProvider(provider: AppConfig['speechToText']['provider']) {
    if (provider === 'siliconflow') {
      updateSpeechToTextConfig({
        provider,
        baseUrl: siliconFlowSpeechToTextBaseUrl,
        model: siliconFlowSpeechToTextModels[0],
        responseFormat: 'json',
        timestampGranularities: ['segment'],
        chunkingStrategy: 'none',
      });
      return;
    }
    updateSpeechToTextConfig({
      provider,
      baseUrl: draft.speechToText.baseUrl.includes('siliconflow') ? 'https://api.openai.com/v1' : draft.speechToText.baseUrl,
      model: siliconFlowSpeechToTextModels.includes(draft.speechToText.model) ? 'whisper-1' : draft.speechToText.model,
    });
  }
  function toggleSpeechToTextTimestamp(granularity: AppConfig['speechToText']['timestampGranularities'][number], checked: boolean) {
    const current = draft.speechToText.timestampGranularities.filter((item) => item !== granularity);
    updateSpeechToTextConfig({ timestampGranularities: checked ? [...current, granularity] : current });
  }
  async function selectTheme(nextTheme: AppState['ui']['theme']) {
    await themeAction.run(async () => {
      const changed = await changeRuntimeTheme({
        currentTheme: state.ui.theme,
        nextTheme,
        persist: () => api.saveUiPreferences({ theme: nextTheme }),
      });
      applyState(changed.mutation);
    }, { onError: (error) => setConfigTestResult(`[fail] ${error.message}`) });
  }
  const selectedProviderProfileIds = {
    llm: selectedLlmProfileId,
    image: selectedImageProfileId,
    tts: selectedTtsProfileId,
  };
  const selectedLlmTestConfig = buildConfigForSelectedProfileTest(draft, 'llm', selectedProviderProfileIds);
  const selectedImageTestConfig = buildConfigForSelectedProfileTest(draft, 'image', selectedProviderProfileIds);
  const selectedTtsTestConfig = buildConfigForSelectedProfileTest(draft, 'tts', selectedProviderProfileIds);
  const settingsBgms = validBgmItems(draft);
  const isSiliconFlowSpeechToText = draft.speechToText.provider === 'siliconflow';
  const sections = [
    ['appearance', Palette, '外观', '明暗主题', state.ui.theme === 'dark' ? '深色' : '浅色'],
    ['llm', Sparkles, 'LLM', '文案与分镜', settingsStatusLabel(configTargetStatus('llm', draft))],
    ['image', ImageIcon, 'AI 绘图', '分镜图片', settingsStatusLabel(configTargetStatus('image', draft))],
    ['tts', Bot, 'TTS 配音', '每镜语音', settingsStatusLabel(configTargetStatus('tts', draft))],
    ['speechToText', Mic2, '语音转文字', '爆款拆解转写 API', settingsStatusLabel(configTargetStatus('speechToText', draft))],
    ['jianying', FolderOpen, '剪映', '草稿目录 · BGM', settingsStatusLabel(configTargetStatus('jianying', draft))],
    ['activation', KeyRound, '激活与订阅', '试用 · 激活码', state.activation.status],
    ['creative', Wand2, 'AI 创作', 'IMA 知识库', settingsStatusLabel(configTargetStatus('creative', draft))],
    ['about', Info, '关于 · 诊断', '日志 · 重置', '已配置'],
  ] as const;
  return (
    <div className="settings-layout">
      <section className="settings-menu">
        {sections.map(([id, Icon, label, hint, status]) => (
          <button key={id} className={section === id ? 'settings-tab active' : 'settings-tab'} onClick={() => setSection(id)}>
            <Icon size={16} />
            <strong>{label}</strong>
            <span>{hint}</span>
            <small>{status}</small>
          </button>
        ))}
      </section>
      <section className="settings-content panel">
        <div className="panel-title-row">
          <div className="settings-heading">
            <div className="square-icon"><Sparkles size={18} /></div>
            <div><h2>{sections.find(([id]) => id === section)?.[2]}</h2><span>配置 API 凭证与本地路径</span></div>
          </div>
          <div className="button-row">
            <button className="ghost-action" disabled={testingConfig || savingConfig} onClick={testCurrentConfig}>
              {testingConfig ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}
              保存并测试
            </button>
            <button className="primary-action slim" disabled={savingConfig} onClick={save}>
              {savingConfig ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
              保存配置
            </button>
          </div>
        </div>
        {configTestResult ? <div className="test-result">{configTestResult}</div> : null}
        {section === 'appearance' ? (
          <SettingsCard title="界面主题" status={state.ui.theme === 'dark' ? '深色' : '浅色'}>
            <Segmented
              label="主题"
              value={state.ui.theme}
              options={['dark', 'light']}
              labels={['深色', '浅色']}
              onChange={(value) => void selectTheme(value as AppState['ui']['theme'])}
            />
            <InlineActionFeedback feedback={themeAction.feedback} />
          </SettingsCard>
        ) : null}
        <InlineActionFeedback feedback={settingsAction.feedback} />
        {section === 'llm' ? (
          <SettingsCard title="LLM 配置档案" status={secrets.configured(profileSecretId('llm', selectedLlmProfileId, 'apiKey')) ? '已配置' : '待配置'}>
            <LlmProfileManager
              config={draft}
              selectedProfileId={selectedLlmProfileId}
              models={modelLists.llm}
              loadingModels={loadingModelList === 'llm'}
              modelStatus={modelListStatus.llm}
              saving={savingConfig}
              secrets={secrets}
              onChange={setSettingsDraft}
              onSelectedProfileIdChange={setSelectedLlmProfileId}
              onActivate={activateLlmProfile}
              onClearModels={() => clearProviderModels('llm')}
              onRefreshModels={(profile) => {
                const secret = secrets.reference(profileSecretId('llm', profile.id, 'apiKey'));
                return refreshProviderModels('llm', { baseUrl: profile.baseUrl, apiKey: secret.value, protocol: profile.protocol, secretId: secret.secretId }, profile.model);
              }}
            />
          </SettingsCard>
        ) : null}
        {section === 'image' ? (
          <SettingsCard
            title="AI 绘图"
            status={secrets.configured(profileSecretId('image', selectedImageProfileId, selectedImageTestConfig.imageProvider === 'jimeng' ? 'jimeng/accessKeyId' : selectedImageTestConfig.imageProvider === 'custom' ? 'customImage/apiKey' : 'gptImage/apiKey')) ? '已配置' : '待配置'}
          >
            <ImageProfileManager
              config={draft}
              selectedProfileId={selectedImageProfileId}
              gptModels={modelLists['gpt-image']}
              customModels={modelLists['custom-image']}
              loadingModelList={loadingModelList}
              modelStatus={modelListStatus}
              saving={savingConfig}
              secrets={secrets}
              onChange={setSettingsDraft}
              onSelectedProfileIdChange={setSelectedImageProfileId}
              onActivate={activateImageProfile}
              onClearModels={clearProviderModels}
              onRefreshModels={refreshProviderModels}
            />
          </SettingsCard>
        ) : null}
        {section === 'tts' ? (
          <SettingsCard title="TTS 配音" status={secrets.configured(profileSecretId('tts', selectedTtsProfileId, selectedTtsTestConfig.tts.provider === 'minimax' ? 'minimax/apiKey' : 'volcengine/apiKey')) ? '已配置' : '待配置'}>
            <TtsProfileManager
              config={draft}
              selectedProfileId={selectedTtsProfileId}
              cloneVoiceCount={state.minimaxCloneVoices.length}
              volcengineSpeakers={volcengineSpeakers}
              loadingVolcengineSpeakers={loadingVolcengineSpeakers}
              volcengineSpeakerStatus={volcengineSpeakerStatus}
              saving={savingConfig}
              secrets={secrets}
              onChange={setSettingsDraft}
              onSelectedProfileIdChange={setSelectedTtsProfileId}
              onActivate={activateTtsProfile}
              onRefreshVolcengineSpeakers={refreshVolcengineSpeakers}
            />
          </SettingsCard>
        ) : null}
        {section === 'speechToText' ? (
          <SettingsCard title="语音转文字" status={secrets.configured('speechToText/apiKey') ? '已配置' : '待配置'}>
            <ProviderConfigNote
              title="转写 API"
              value="OpenAI 兼容 /audio/transcriptions；SiliconFlow 使用 file、model，默认 FunAudioLLM/SenseVoiceSmall，也可选 TeleAI/TeleSpeechASR。"
            />
            <Segmented
              label="供应商"
              value={draft.speechToText.provider}
              options={['openai-compatible', 'siliconflow']}
              labels={['OpenAI 兼容', 'SiliconFlow']}
              onChange={(value) => switchSpeechToTextProvider(value as AppConfig['speechToText']['provider'])}
            />
            <ConfigInput label="接口地址" value={draft.speechToText.baseUrl} onChange={(value) => updateSpeechToTextConfig({ baseUrl: value })} />
            <SecretInput
              label="接口密钥"
              value={secrets.value('speechToText/apiKey')}
              configured={secrets.configured('speechToText/apiKey')}
              onChange={(value) => secrets.change('speechToText/apiKey', value)}
              onClear={() => secrets.change('speechToText/apiKey', null)}
            />
            {isSiliconFlowSpeechToText ? (
              <Segmented
                label="转写模型"
                value={draft.speechToText.model}
                options={siliconFlowSpeechToTextModels}
                onChange={(value) => updateSpeechToTextConfig({ model: value })}
              />
            ) : (
              <ConfigInput label="转写模型" value={draft.speechToText.model} onChange={(value) => updateSpeechToTextConfig({ model: value })} />
            )}
            <ConfigInput label="语言" value={draft.speechToText.language} onChange={(value) => updateSpeechToTextConfig({ language: value })} />
            <ConfigInput label="提示词" value={draft.speechToText.prompt} onChange={(value) => updateSpeechToTextConfig({ prompt: value })} />
            {isSiliconFlowSpeechToText ? (
              <LocalInfo title="SiliconFlow 参数" value="按官方接口只提交 file 和 model，上传上限 50MB。language、prompt、temperature、时间戳和切分策略不会随请求发送。" />
            ) : (
              <Segmented
                label="响应格式"
                value={draft.speechToText.responseFormat}
                options={['json', 'verbose_json', 'text', 'srt', 'vtt']}
                labels={['JSON', 'Verbose JSON', 'Text', 'SRT', 'VTT']}
                onChange={(value) => updateSpeechToTextConfig({ responseFormat: value as AppConfig['speechToText']['responseFormat'] })}
              />
            )}
            {!isSiliconFlowSpeechToText ? <RangeField label="温度" min={0} max={1} step={0.1} value={draft.speechToText.temperature} onChange={(value) => updateSpeechToTextConfig({ temperature: value })} /> : null}
            <ConfigNumberInput
              label="请求超时（秒）"
              value={Math.round(draft.speechToText.timeoutMs / 1000)}
              min={10}
              step={10}
              onChange={(value) => updateSpeechToTextConfig({ timeoutMs: value * 1000 })}
            />
            {!isSiliconFlowSpeechToText ? (
              <Field label="时间戳">
                <div className="settings-inline-actions">
                  <ToggleField
                    label="段落级"
                    checked={draft.speechToText.timestampGranularities.includes('segment')}
                    onChange={(checked) => toggleSpeechToTextTimestamp('segment', checked)}
                  />
                  <ToggleField
                    label="词级"
                    checked={draft.speechToText.timestampGranularities.includes('word')}
                    onChange={(checked) => toggleSpeechToTextTimestamp('word', checked)}
                  />
                </div>
              </Field>
            ) : null}
            {!isSiliconFlowSpeechToText ? (
              <Segmented
                label="切分策略"
                value={draft.speechToText.chunkingStrategy}
                options={['none', 'auto']}
                labels={['不启用', '自动']}
                onChange={(value) => updateSpeechToTextConfig({ chunkingStrategy: value as AppConfig['speechToText']['chunkingStrategy'] })}
              />
            ) : null}
          </SettingsCard>
        ) : null}
        {section === 'jianying' ? (
          <SettingsCard title="剪映草稿与 BGM" status={draft.jianying.draftPath ? '已配置' : '待配置'}>
            <ConfigInput label="草稿目录" value={draft.jianying.draftPath} onChange={(value) => setSettingsDraft({ ...draft, jianying: { ...draft.jianying, draftPath: value } })} />
            <div className="settings-inline-actions">
              <button className="ghost-action" type="button" onClick={autoDetectJianyingDraftPath}><Search size={15} />自动检测</button>
              <button className="ghost-action" type="button" onClick={pickJianyingDraftPath}><FolderOpen size={15} />选择目录</button>
            </div>
            <LocalInfo title="BGM 库" value={settingsBgms.length ? settingsBgms.map((bgm) => bgm.title).join('、') : 'BGM 库为空'} />
            <button className="ghost-action" type="button" onClick={uploadBgmFromSettings}><Upload size={15} />+ 添加 BGM 文件</button>
            <div className="bgm-library-list">
              {settingsBgms.length === 0 ? <div className="bgm-library-empty">BGM 库为空</div> : null}
              {settingsBgms.map((bgm) => (
                <div key={bgm.id} className="bgm-library-item">
                  <div>
                    <strong>{bgm.title}</strong>
                    <span>{bgm.path}</span>
                  </div>
                  <label>
                    音量
                    <input type="number" min="0" max="1" step="0.05" value={bgm.volume} onChange={(event) => updateBgmVolume(bgm.id, Number(event.target.value))} />
                  </label>
                  <button className={draft.jianying.defaultBgmId === bgm.id ? 'mini-button active' : 'mini-button'} type="button" onClick={() => setDefaultBgm(bgm.id)}>
                    {draft.jianying.defaultBgmId === bgm.id ? '默认' : '设为默认'}
                  </button>
                  <button className="mini-button" type="button" onClick={() => removeBgm(bgm.id)}>移除</button>
                </div>
              ))}
            </div>
          </SettingsCard>
        ) : null}
        {section === 'activation' ? <LocalInfo title="激活与订阅" value={state.activation.message} /> : null}
        {section === 'creative' ? (
          <SettingsCard title="AI 创作 / IMA 知识库" status={secrets.configured('ima/apiKey') ? '已配置' : '待配置'}>
            <ConfigInput label="客户端 ID" value={draft.ima.clientId} onChange={(value) => setSettingsDraft({ ...draft, ima: { ...draft.ima, clientId: value } })} />
            <SecretInput
              label="接口密钥"
              value={secrets.value('ima/apiKey')}
              configured={secrets.configured('ima/apiKey')}
              onChange={(value) => secrets.change('ima/apiKey', value)}
              onClear={() => secrets.change('ima/apiKey', null)}
            />
            <ConfigInput label="知识库 ID" value={draft.ima.kbId} onChange={(value) => setSettingsDraft({ ...draft, ima: { ...draft.ima, kbId: value } })} />
            <ConfigInput label="知识库名称" value={draft.ima.kbName} onChange={(value) => setSettingsDraft({ ...draft, ima: { ...draft.ima, kbName: value } })} />
            <button className="ghost-action" disabled={settingsAction.busy || savingConfig} onClick={fetchImaKnowledgeFromSettings}>
              {settingsAction.busy ? <Loader2 className="spin" size={15} /> : <Database size={15} />}
              测试并拉取知识库
            </button>
            {imaKnowledgeResult ? (
              <div className="test-result">
                <strong>{imaKnowledgeResult.knowledgeBaseId || 'IMA'}</strong>
                <span>{imaKnowledgeResult.detail}</span>
                {imaKnowledgeResult.records.map((record) => (
                  <div key={record.id}><strong>{record.title}</strong><span>{record.snippet || '无摘要'}</span></div>
                ))}
              </div>
            ) : null}
          </SettingsCard>
        ) : null}
        {section === 'about' ? (
          <div className="diagnostics-card">
            <LocalInfo title="视频故事创作助手" value="v0.10.4 · beta · Windows · 本地数据目录" />
            <div className="button-row">
              <button className="ghost-action" onClick={runDiagnostics}>检查诊断</button>
              <button className="ghost-action" onClick={() => navigator.clipboard?.writeText(diagnostics)}>
                <Copy size={15} />
                复制诊断报告
              </button>
              <button className="danger-action" onClick={() => navigate('history')}><XCircle size={15} />清理历史</button>
            </div>
            <pre>{diagnostics || '点击检查诊断后显示 LLM、TTS、BGM、剪映目录、账户状态等检查结果。'}</pre>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function LlmProfileManager({
  config,
  selectedProfileId,
  models,
  loadingModels,
  modelStatus,
  saving,
  secrets,
  onChange,
  onSelectedProfileIdChange,
  onActivate,
  onClearModels,
  onRefreshModels,
}: {
  config: AppConfig;
  selectedProfileId: string;
  models: ProviderModel[];
  loadingModels: boolean;
  modelStatus?: string;
  saving: boolean;
  secrets: SecretEditor;
  onChange: (config: AppConfig) => void;
  onSelectedProfileIdChange: (id: string) => void;
  onActivate: (id: string) => Promise<void>;
  onClearModels: () => void;
  onRefreshModels: (profile: AppConfig['llm']) => void;
}) {
  const profiles = config.llmProfiles.length ? config.llmProfiles : [config.llm];
  const activeId = activeLlmProfileId(config);
  const profileIds = profiles.map((profile) => profile.id).join('|');

  useEffect(() => {
    if (!profiles.some((profile) => profile.id === selectedProfileId)) {
      onSelectedProfileIdChange(activeId);
    }
  }, [activeId, onSelectedProfileIdChange, profileIds, profiles, selectedProfileId]);

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles.find((profile) => profile.id === activeId) ?? profiles[0];

  function updateSelectedProfile(profile: AppConfig['llm']) {
    onChange(saveLlmProfile(config, profile));
  }

  function addProfile() {
    const next = addLlmProfile(config);
    onChange(next);
    onSelectedProfileIdChange(next.llmProfiles[0]?.id ?? activeId);
  }

  function duplicateProfile(profile: AppConfig['llm']) {
    const next = copyLlmProfile(config, profile.id!);
    onChange(next);
    const currentIndex = config.llmProfiles.findIndex((item) => item.id === profile.id);
    onSelectedProfileIdChange(next.llmProfiles[Math.max(0, currentIndex + 1)]?.id ?? profile.id!);
  }

  function deleteProfile(profile: AppConfig['llm']) {
    const next = removeLlmProfile(config, profile.id!);
    onChange(next);
    onSelectedProfileIdChange(activeLlmProfileId(next));
  }

  if (!selectedProfile) return <ArtifactEmpty text="暂无 LLM 配置档案" />;

  const selectedProvider = editableLlmProfileProvider(selectedProfile);
  const apiKeyId = profileSecretId('llm', selectedProfile.id, 'apiKey');
  const requestParamsJsonValue = selectedProfile.requestParamsJson ?? '{}';
  return (
    <div className="llm-profile-manager">
      <div className="profile-switcher-head">
        <div>
          <strong>配置档案</strong>
          <span>可保存多个 OpenAI 兼容接口，启用一个作为任务运行配置。</span>
        </div>
        <button className="ghost-action" type="button" onClick={addProfile}>
          <Plus size={15} />
          新增配置
        </button>
      </div>

      <div className="profile-switcher-list">
        {profiles.map((profile) => {
          const isActive = profile.id === activeId;
          const isSelected = profile.id === selectedProfile.id;
          return (
            <article
              className={isActive ? 'provider-profile-card active' : isSelected ? 'provider-profile-card selected' : 'provider-profile-card'}
              data-profile-card
              key={profile.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectedProfileIdChange(profile.id!)}
              onKeyDown={(event) => event.key === 'Enter' && onSelectedProfileIdChange(profile.id!)}
            >
              <div className="profile-drag-dot">⋮⋮</div>
              <div className="profile-avatar">{profile.name?.slice(0, 1).toUpperCase() || 'C'}</div>
              <div className="profile-copy">
                <strong>{profile.name || '未命名配置'}</strong>
                <span>{profile.baseUrl || 'https://api.openai.com'}</span>
                <small>{profile.model || '未选择模型'}</small>
              </div>
              <div className="profile-actions">
                {isActive ? (
                  <span className="profile-active-badge">启用中</span>
                ) : (
                  <button
                    className="primary-action slim"
                    type="button"
                    disabled={saving}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectedProfileIdChange(profile.id!);
                      void onActivate(profile.id!);
                    }}
                  >
                    {saving ? <Loader2 className="spin" size={14} /> : <Play size={14} />}
                    启用
                  </button>
                )}
                <button className="icon-button" type="button" title="编辑" onClick={(event) => { event.stopPropagation(); onSelectedProfileIdChange(profile.id!); }}>
                  <Palette size={14} />
                </button>
                <button className="icon-button" type="button" title="复制" onClick={(event) => { event.stopPropagation(); duplicateProfile(profile); }}>
                  <Copy size={14} />
                </button>
                <button className="icon-button" type="button" title="删除" disabled={profiles.length <= 1} onClick={(event) => { event.stopPropagation(); deleteProfile(profile); }}>
                  <XCircle size={14} />
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="profile-editor-grid">
        <ConfigInput label="配置名称" value={selectedProfile.name ?? ''} onChange={(value) => updateSelectedProfile({ ...selectedProfile, name: value })} />
        <ConfigNumberInput
          label="请求超时（秒）"
          value={Math.round((selectedProfile.timeoutMs ?? defaultConfig.llm.timeoutMs ?? 120000) / 1000)}
          min={10}
          step={10}
          onChange={(value) => updateSelectedProfile({ ...selectedProfile, timeoutMs: value * 1000 })}
        />
        <Segmented
          label="供应商"
          value={selectedProvider}
          options={['openai', 'custom', 'anthropic']}
          labels={['OpenAI', '自定义', 'Anthropic']}
          onChange={(value) => {
            onClearModels();
            updateSelectedProfile({
              ...selectedProfile,
              provider: value,
              protocol: value === 'anthropic' ? 'anthropic' : 'openai',
              baseUrl:
                value === 'openai'
                  ? 'https://api.openai.com'
                  : value === 'anthropic'
                    ? selectedProfile.baseUrl === 'https://api.openai.com' || selectedProfile.baseUrl === defaultConfig.llm.baseUrl
                      ? 'https://api.anthropic.com'
                      : selectedProfile.baseUrl
                    : selectedProfile.baseUrl === 'https://api.openai.com' || selectedProfile.baseUrl === 'https://api.anthropic.com'
                      ? defaultConfig.llm.baseUrl
                      : selectedProfile.baseUrl,
            });
          }}
        />
        {selectedProvider === 'openai' ? (
          <>
            <ProviderConfigNote title="OpenAI 对话接口" value="使用官方 /v1/chat/completions，填写接口密钥与模型。" />
            <SecretInput label="OpenAI 接口密钥" value={secrets.value(apiKeyId)} configured={secrets.configured(apiKeyId)} onChange={(value) => { onClearModels(); secrets.change(apiKeyId, value); }} onClear={() => secrets.change(apiKeyId, null)} />
            <ModelPicker
              key={`llm-${selectedProfile.id}`}
              label="OpenAI 模型"
              value={selectedProfile.model}
              models={models}
              loading={loadingModels}
              status={modelStatus}
              onRefresh={() => onRefreshModels(selectedProfile)}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, model: value })}
            />
            <ConfigTextarea
              label="附加请求 JSON"
              hint={'Extra request JSON, e.g. {"reasoning_effort":"medium"}'}
              value={requestParamsJsonValue}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, requestParamsJson: value })}
            />
          </>
        ) : selectedProvider === 'anthropic' ? (
          <>
            <ProviderConfigNote title="Anthropic Messages API" value="使用 /v1/messages，填写 Anthropic 接口密钥与 Claude 模型。" />
            <ConfigInput label="Anthropic 接口地址" value={selectedProfile.baseUrl} onChange={(value) => { onClearModels(); updateSelectedProfile({ ...selectedProfile, provider: 'anthropic', protocol: 'anthropic', baseUrl: value }); }} />
            <SecretInput label="Anthropic 接口密钥" value={secrets.value(apiKeyId)} configured={secrets.configured(apiKeyId)} onChange={(value) => { onClearModels(); secrets.change(apiKeyId, value); }} onClear={() => secrets.change(apiKeyId, null)} />
            <ModelPicker
              key={`llm-${selectedProfile.id}`}
              label="Claude 模型"
              value={selectedProfile.model}
              models={models}
              loading={loadingModels}
              status={modelStatus}
              onRefresh={() => onRefreshModels({ ...selectedProfile, provider: 'anthropic', protocol: 'anthropic' })}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, provider: 'anthropic', protocol: 'anthropic', model: value })}
            />
            <ConfigTextarea
              label="附加请求 JSON"
              hint={'Extra request JSON, e.g. {"temperature":0,"max_tokens":4096}'}
              value={requestParamsJsonValue}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, provider: 'anthropic', protocol: 'anthropic', requestParamsJson: value })}
            />
          </>
        ) : (
          <>
            <ProviderConfigNote title="OpenAI 兼容 LLM" value="自定义接口按 /chat/completions 调用，需要接口地址、接口密钥与模型。" />
            <ConfigInput label="接口地址" value={selectedProfile.baseUrl} onChange={(value) => { onClearModels(); updateSelectedProfile({ ...selectedProfile, baseUrl: value }); }} />
            <SecretInput label="接口密钥" value={secrets.value(apiKeyId)} configured={secrets.configured(apiKeyId)} onChange={(value) => { onClearModels(); secrets.change(apiKeyId, value); }} onClear={() => secrets.change(apiKeyId, null)} />
            <ModelPicker
              key={`llm-${selectedProfile.id}`}
              label="模型"
              value={selectedProfile.model}
              models={models}
              loading={loadingModels}
              status={modelStatus}
              onRefresh={() => onRefreshModels(selectedProfile)}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, model: value })}
            />
            <ConfigTextarea
              label="附加请求 JSON"
              hint={'Extra request JSON, e.g. {"reasoning_effort":"medium"}'}
              value={requestParamsJsonValue}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, requestParamsJson: value })}
            />
          </>
        )}
      </div>
    </div>
  );
}

function ImageProfileManager({
  config,
  selectedProfileId,
  gptModels,
  customModels,
  loadingModelList,
  modelStatus,
  saving,
  secrets,
  onChange,
  onSelectedProfileIdChange,
  onActivate,
  onClearModels,
  onRefreshModels,
}: {
  config: AppConfig;
  selectedProfileId: string;
  gptModels: ProviderModel[];
  customModels: ProviderModel[];
  loadingModelList: ModelListKey | null;
  modelStatus: Partial<Record<ModelListKey, string>>;
  saving: boolean;
  secrets: SecretEditor;
  onChange: (config: AppConfig) => void;
  onSelectedProfileIdChange: (id: string) => void;
  onActivate: (id: string) => Promise<void>;
  onClearModels: (key: ModelListKey) => void;
  onRefreshModels: (key: ModelListKey, request: ProviderModelListRequest, currentModel: string, applyModel?: (config: AppConfig, model: string) => AppConfig) => void;
}) {
  const profiles = normalizedImageProfiles(config);
  const activeId = activeImageProfileId(config);
  const profileIds = profiles.map((profile) => profile.id).join('|');

  useEffect(() => {
    if (!profiles.some((profile) => profile.id === selectedProfileId)) {
      onSelectedProfileIdChange(activeId);
    }
  }, [activeId, onSelectedProfileIdChange, profileIds, profiles, selectedProfileId]);

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles.find((profile) => profile.id === activeId) ?? profiles[0];
  if (!selectedProfile) return <ArtifactEmpty text="暂无绘图配置档案" />;

  const provider = selectedProfile.provider;
  const gptImage = imageProfileGptImage(selectedProfile);
  const jimeng = imageProfileJimeng(selectedProfile);
  const customImage = imageProfileCustomImage(selectedProfile);
  const gptApiKeyId = profileSecretId('image', selectedProfile.id, 'gptImage/apiKey');
  const jimengSessionId = profileSecretId('image', selectedProfile.id, 'jimeng/sessionId');
  const jimengAccessKeyId = profileSecretId('image', selectedProfile.id, 'jimeng/accessKeyId');
  const jimengSecretAccessKeyId = profileSecretId('image', selectedProfile.id, 'jimeng/secretAccessKey');
  const customApiKeyId = profileSecretId('image', selectedProfile.id, 'customImage/apiKey');

  function updateSelectedProfile(profile: ImageProviderProfile) {
    onChange(saveImageProfile(config, profile));
  }

  function addProfile() {
    const next = addImageProfile(config);
    onChange(next);
    onSelectedProfileIdChange(next.imageProfiles[0]?.id ?? activeId);
  }

  function duplicateProfile(profile: ImageProviderProfile) {
    const next = copyImageProfile(config, profile.id!);
    onChange(next);
    const currentIndex = profiles.findIndex((item) => item.id === profile.id);
    onSelectedProfileIdChange(next.imageProfiles[Math.max(0, currentIndex + 1)]?.id ?? profile.id!);
  }

  function deleteProfile(profile: ImageProviderProfile) {
    const next = removeImageProfile(config, profile.id!);
    onChange(next);
    onSelectedProfileIdChange(activeImageProfileId(next));
  }

  return (
    <div className="llm-profile-manager">
      <div className="profile-switcher-head">
        <div>
          <strong>绘图档案</strong>
          <span>可保存 GPT Image、即梦和自定义图片接口，启用一个作为任务生图配置。</span>
        </div>
        <button className="ghost-action" type="button" onClick={addProfile}>
          <Plus size={15} />
          新增配置
        </button>
      </div>

      <div className="profile-switcher-list">
        {profiles.map((profile) => {
          const isActive = profile.id === activeId;
          const isSelected = profile.id === selectedProfile.id;
          return (
            <article
              className={isActive ? 'provider-profile-card active' : isSelected ? 'provider-profile-card selected' : 'provider-profile-card'}
              data-profile-card
              key={profile.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectedProfileIdChange(profile.id!)}
              onKeyDown={(event) => event.key === 'Enter' && onSelectedProfileIdChange(profile.id!)}
            >
              <div className="profile-drag-dot">⋮⋮</div>
              <div className="profile-avatar">{profile.name?.slice(0, 1).toUpperCase() || 'I'}</div>
              <div className="profile-copy">
                <strong>{profile.name || '未命名绘图配置'}</strong>
                <span>{imageProviderLabel(profile.provider)}</span>
                <small>{imageProfileSummary(profile)}</small>
              </div>
              <div className="profile-actions">
                {isActive ? (
                  <span className="profile-active-badge">启用中</span>
                ) : (
                  <button
                    className="primary-action slim"
                    type="button"
                    disabled={saving}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectedProfileIdChange(profile.id!);
                      void onActivate(profile.id!);
                    }}
                  >
                    {saving ? <Loader2 className="spin" size={14} /> : <Play size={14} />}
                    启用
                  </button>
                )}
                <button className="icon-button" type="button" title="编辑" onClick={(event) => { event.stopPropagation(); onSelectedProfileIdChange(profile.id!); }}>
                  <Palette size={14} />
                </button>
                <button className="icon-button" type="button" title="复制" onClick={(event) => { event.stopPropagation(); duplicateProfile(profile); }}>
                  <Copy size={14} />
                </button>
                <button className="icon-button" type="button" title="删除" disabled={profiles.length <= 1} onClick={(event) => { event.stopPropagation(); deleteProfile(profile); }}>
                  <XCircle size={14} />
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="profile-editor-grid">
        <ConfigInput label="配置名称" value={selectedProfile.name ?? ''} onChange={(value) => updateSelectedProfile({ ...selectedProfile, name: value })} />
        <Segmented
          label="供应商"
          value={provider}
          options={['gpt_image', 'jimeng', 'custom']}
          labels={['GPT Image', '即梦', '自定义']}
          onChange={(value) => {
            onClearModels('gpt-image');
            onClearModels('custom-image');
            updateSelectedProfile({ ...selectedProfile, provider: value as ImageProviderProfile['provider'] });
          }}
        />
        {provider === 'gpt_image' ? (
          <>
            <ProviderConfigNote title="OpenAI 图像接口" value="接口密钥与模型必填；接口地址为空时使用官方默认端点。" />
            <ConfigInput label="GPT Image 接口地址（可选）" value={gptImage.baseUrl} onChange={(value) => { onClearModels('gpt-image'); updateSelectedProfile({ ...selectedProfile, gptImage: { ...gptImage, baseUrl: value } }); }} />
            <SecretInput label="GPT Image 接口密钥" value={secrets.value(gptApiKeyId)} configured={secrets.configured(gptApiKeyId)} onChange={(value) => { onClearModels('gpt-image'); secrets.change(gptApiKeyId, value); }} onClear={() => secrets.change(gptApiKeyId, null)} />
            <ModelPicker
              key={`gpt-image-${selectedProfile.id}`}
              label="GPT Image 模型"
              value={gptImage.model}
              models={gptModels}
              loading={loadingModelList === 'gpt-image'}
              status={modelStatus['gpt-image']}
              onRefresh={() => onRefreshModels(
                'gpt-image',
                { baseUrl: gptImage.baseUrl || 'https://api.openai.com', apiKey: secrets.reference(gptApiKeyId).value, secretId: secrets.reference(gptApiKeyId).secretId },
                gptImage.model,
                (current, model) => saveImageProfile(current, { ...selectedProfile, gptImage: { ...gptImage, model } }),
              )}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, gptImage: { ...gptImage, model: value } })}
            />
            <Segmented label="分辨率" value={gptImage.resolution ?? '2K'} options={['1K', '2K', '4K']} onChange={(value) => updateSelectedProfile({ ...selectedProfile, gptImage: { ...gptImage, resolution: value as ImageResolution } })} />
            <Field label="并发"><input type="range" min="1" max="6" value={gptImage.concurrency} onChange={(event) => updateSelectedProfile({ ...selectedProfile, gptImage: { ...gptImage, concurrency: Number(event.target.value) } })} /></Field>
          </>
        ) : null}
        {provider === 'jimeng' ? (
          <>
            <ProviderConfigNote title="火山视觉接口" value={`端点 ${jimeng.endpoint || 'https://visual.volcengineapi.com'} · 区域 ${jimeng.region || 'cn-north-1'} · 服务 ${jimeng.service || 'cv'}`} />
            <SecretInput label="即梦 Session ID" value={secrets.value(jimengSessionId)} configured={secrets.configured(jimengSessionId)} onChange={(value) => secrets.change(jimengSessionId, value)} onClear={() => secrets.change(jimengSessionId, null)} />
            <SecretInput label="即梦访问密钥 ID" value={secrets.value(jimengAccessKeyId)} configured={secrets.configured(jimengAccessKeyId)} onChange={(value) => secrets.change(jimengAccessKeyId, value)} onClear={() => secrets.change(jimengAccessKeyId, null)} />
            <SecretInput label="即梦访问密钥 Secret" value={secrets.value(jimengSecretAccessKeyId)} configured={secrets.configured(jimengSecretAccessKeyId)} onChange={(value) => secrets.change(jimengSecretAccessKeyId, value)} onClear={() => secrets.change(jimengSecretAccessKeyId, null)} />
            <ConfigInput label="即梦请求 Key" value={jimeng.reqKey ?? ''} onChange={(value) => updateSelectedProfile({ ...selectedProfile, jimeng: { ...jimeng, reqKey: value } })} />
            <Segmented label="分辨率" value={jimeng.resolution} options={['1K', '2K', '4K']} onChange={(value) => updateSelectedProfile({ ...selectedProfile, jimeng: { ...jimeng, resolution: value as ImageResolution } })} />
            <Field label="并发"><input type="range" min="1" max="6" value={jimeng.concurrency} onChange={(event) => updateSelectedProfile({ ...selectedProfile, jimeng: { ...jimeng, concurrency: Number(event.target.value) } })} /></Field>
          </>
        ) : null}
        {provider === 'custom' ? (
          <>
            <ProviderConfigNote title="OpenAI 兼容接口" value="自定义图片接口按 /images/generations 调用，需要接口地址、接口密钥与模型。" />
            <ConfigInput label="自定义接口地址" value={customImage.baseUrl} onChange={(value) => { onClearModels('custom-image'); updateSelectedProfile({ ...selectedProfile, customImage: { ...customImage, baseUrl: value } }); }} />
            <SecretInput label="自定义接口密钥" value={secrets.value(customApiKeyId)} configured={secrets.configured(customApiKeyId)} onChange={(value) => { onClearModels('custom-image'); secrets.change(customApiKeyId, value); }} onClear={() => secrets.change(customApiKeyId, null)} />
            <ModelPicker
              key={`custom-image-${selectedProfile.id}`}
              label="自定义模型"
              value={customImage.model}
              models={customModels}
              loading={loadingModelList === 'custom-image'}
              status={modelStatus['custom-image']}
              onRefresh={() => onRefreshModels(
                'custom-image',
                { baseUrl: customImage.baseUrl, apiKey: secrets.reference(customApiKeyId).value, secretId: secrets.reference(customApiKeyId).secretId },
                customImage.model,
                (current, model) => saveImageProfile(current, { ...selectedProfile, customImage: { ...customImage, model } }),
              )}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, customImage: { ...customImage, model: value } })}
            />
            <Segmented label="分辨率" value={customImage.resolution ?? '2K'} options={['1K', '2K', '4K']} onChange={(value) => updateSelectedProfile({ ...selectedProfile, customImage: { ...customImage, resolution: value as ImageResolution } })} />
            <Field label="并发"><input type="range" min="1" max="6" value={customImage.concurrency} onChange={(event) => updateSelectedProfile({ ...selectedProfile, customImage: { ...customImage, concurrency: Number(event.target.value) } })} /></Field>
          </>
        ) : null}
      </div>
    </div>
  );
}

function TtsProfileManager({
  config,
  selectedProfileId,
  cloneVoiceCount,
  volcengineSpeakers,
  loadingVolcengineSpeakers,
  volcengineSpeakerStatus,
  saving,
  secrets,
  onChange,
  onSelectedProfileIdChange,
  onActivate,
  onRefreshVolcengineSpeakers,
}: {
  config: AppConfig;
  selectedProfileId: string;
  cloneVoiceCount: number;
  volcengineSpeakers: VolcengineSpeaker[];
  loadingVolcengineSpeakers: boolean;
  volcengineSpeakerStatus?: string;
  saving: boolean;
  secrets: SecretEditor;
  onChange: (config: AppConfig) => void;
  onSelectedProfileIdChange: (id: string) => void;
  onActivate: (id: string) => Promise<void>;
  onRefreshVolcengineSpeakers: (profile: TtsProviderProfile) => void;
}) {
  const profiles = normalizedTtsProfiles(config);
  const activeId = activeTtsProfileId(config);
  const profileIds = profiles.map((profile) => profile.id).join('|');

  useEffect(() => {
    if (!profiles.some((profile) => profile.id === selectedProfileId)) {
      onSelectedProfileIdChange(activeId);
    }
  }, [activeId, onSelectedProfileIdChange, profileIds, profiles, selectedProfileId]);

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles.find((profile) => profile.id === activeId) ?? profiles[0];
  const availableVolcengineVoices = useMemo(() => buildVolcengineVoiceOptions(volcengineSpeakers), [volcengineSpeakers]);
  if (!selectedProfile) return <ArtifactEmpty text="暂无 TTS 配置档案" />;

  const provider = selectedProfile.provider;
  const volcengine = ttsProfileVolcengine(selectedProfile);
  const minimax = ttsProfileMinimax(selectedProfile);
  const voiceSelection = volcenginePresetVoiceValue(volcengine.speaker, availableVolcengineVoices);
  const volcengineApiKeyId = profileSecretId('tts', selectedProfile.id, 'volcengine/apiKey');
  const volcengineAccessKeyId = profileSecretId('tts', selectedProfile.id, 'volcengine/accessKeyId');
  const volcengineSecretAccessKeyId = profileSecretId('tts', selectedProfile.id, 'volcengine/secretAccessKey');
  const minimaxApiKeyId = profileSecretId('tts', selectedProfile.id, 'minimax/apiKey');

  function updateSelectedProfile(profile: TtsProviderProfile) {
    onChange(saveTtsProfile(config, profile));
  }

  function updateVolcengineVoice(voiceType: string) {
    updateSelectedProfile({ ...selectedProfile, speaker: voiceType, volcengine: { ...volcengine, speaker: voiceType } });
  }

  function addProfile() {
    const next = addTtsProfile(config);
    onChange(next);
    onSelectedProfileIdChange(next.ttsProfiles[0]?.id ?? activeId);
  }

  function duplicateProfile(profile: TtsProviderProfile) {
    const next = copyTtsProfile(config, profile.id!);
    onChange(next);
    const currentIndex = profiles.findIndex((item) => item.id === profile.id);
    onSelectedProfileIdChange(next.ttsProfiles[Math.max(0, currentIndex + 1)]?.id ?? profile.id!);
  }

  function deleteProfile(profile: TtsProviderProfile) {
    const next = removeTtsProfile(config, profile.id!);
    onChange(next);
    onSelectedProfileIdChange(activeTtsProfileId(next));
  }

  return (
    <div className="llm-profile-manager">
      <div className="profile-switcher-head">
        <div>
          <strong>TTS 档案</strong>
          <span>可保存火山引擎与 MiniMax 配音配置，启用一个作为任务配音配置。</span>
        </div>
        <button className="ghost-action" type="button" onClick={addProfile}>
          <Plus size={15} />
          新增配置
        </button>
      </div>

      <div className="profile-switcher-list">
        {profiles.map((profile) => {
          const isActive = profile.id === activeId;
          const isSelected = profile.id === selectedProfile.id;
          return (
            <article
              className={isActive ? 'provider-profile-card active' : isSelected ? 'provider-profile-card selected' : 'provider-profile-card'}
              data-profile-card
              key={profile.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectedProfileIdChange(profile.id!)}
              onKeyDown={(event) => event.key === 'Enter' && onSelectedProfileIdChange(profile.id!)}
            >
              <div className="profile-drag-dot">⋮⋮</div>
              <div className="profile-avatar">{profile.name?.slice(0, 1).toUpperCase() || 'T'}</div>
              <div className="profile-copy">
                <strong>{profile.name || '未命名 TTS 配置'}</strong>
                <span>{ttsProviderLabel(profile.provider)}</span>
                <small>{ttsProfileSummary(profile)}</small>
              </div>
              <div className="profile-actions">
                {isActive ? (
                  <span className="profile-active-badge">启用中</span>
                ) : (
                  <button
                    className="primary-action slim"
                    type="button"
                    disabled={saving}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectedProfileIdChange(profile.id!);
                      void onActivate(profile.id!);
                    }}
                  >
                    {saving ? <Loader2 className="spin" size={14} /> : <Play size={14} />}
                    启用
                  </button>
                )}
                <button className="icon-button" type="button" title="编辑" onClick={(event) => { event.stopPropagation(); onSelectedProfileIdChange(profile.id!); }}>
                  <Palette size={14} />
                </button>
                <button className="icon-button" type="button" title="复制" onClick={(event) => { event.stopPropagation(); duplicateProfile(profile); }}>
                  <Copy size={14} />
                </button>
                <button className="icon-button" type="button" title="删除" disabled={profiles.length <= 1} onClick={(event) => { event.stopPropagation(); deleteProfile(profile); }}>
                  <XCircle size={14} />
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="profile-editor-grid">
        <ConfigInput label="配置名称" value={selectedProfile.name ?? ''} onChange={(value) => updateSelectedProfile({ ...selectedProfile, name: value })} />
        <Segmented
          label="引擎"
          value={provider}
          options={['volcengine', 'minimax']}
          labels={['火山引擎', 'MiniMax']}
          onChange={(value) => updateSelectedProfile({ ...selectedProfile, provider: value as TtsProviderProfile['provider'] })}
        />
        {provider === 'volcengine' ? (
          <>
            <ProviderConfigNote title="火山引擎 TTS" value="V3 HTTP Chunked 使用新版控制台 TTS 接口密钥；资源与端点使用系统默认配置。" />
            <SecretInput label="火山 TTS 接口密钥" value={secrets.value(volcengineApiKeyId)} configured={secrets.configured(volcengineApiKeyId)} onChange={(value) => secrets.change(volcengineApiKeyId, value)} onClear={() => secrets.change(volcengineApiKeyId, null)} />
            <SecretInput label="音色访问密钥 ID" value={secrets.value(volcengineAccessKeyId)} configured={secrets.configured(volcengineAccessKeyId)} onChange={(value) => secrets.change(volcengineAccessKeyId, value)} onClear={() => secrets.change(volcengineAccessKeyId, null)} />
            <SecretInput label="音色访问密钥 Secret" value={secrets.value(volcengineSecretAccessKeyId)} configured={secrets.configured(volcengineSecretAccessKeyId)} onChange={(value) => secrets.change(volcengineSecretAccessKeyId, value)} onClear={() => secrets.change(volcengineSecretAccessKeyId, null)} />
            <div className="settings-inline-actions">
              <button className="ghost-action" type="button" disabled={loadingVolcengineSpeakers} onClick={() => onRefreshVolcengineSpeakers(selectedProfile)}>
                {loadingVolcengineSpeakers ? <Loader2 className="spin" size={15} /> : <Search size={15} />}
                加载音色
              </button>
              {volcengineSpeakerStatus ? <span>{volcengineSpeakerStatus}</span> : null}
            </div>
            <Field label="默认音色">
              <div className="model-picker">
                <select value={voiceSelection} onChange={(event) => updateVolcengineVoice(event.target.value === 'custom' ? '' : event.target.value)}>
                  <option value="custom">自定义 voice_type</option>
                  {availableVolcengineVoices.map((voice) => (
                    <option key={voice.voiceType} value={voice.voiceType}>
                      {voice.label}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            {voiceSelection === 'custom' ? (
              <ConfigInput label="自定义 voice_type" value={volcengine.speaker} onChange={updateVolcengineVoice} />
            ) : null}
          </>
        ) : null}
        {provider === 'minimax' ? (
          <>
            <ProviderConfigNote title="MiniMax TTS" value="填写接口密钥、模型和音色 ID。" />
            <SecretInput label="MiniMax 接口密钥" value={secrets.value(minimaxApiKeyId)} configured={secrets.configured(minimaxApiKeyId)} onChange={(value) => secrets.change(minimaxApiKeyId, value)} onClear={() => secrets.change(minimaxApiKeyId, null)} />
            <ConfigInput label="MiniMax 模型" value={minimax.model} onChange={(value) => updateSelectedProfile({ ...selectedProfile, minimax: { ...minimax, model: value } })} />
            <ConfigInput label="MiniMax 音色 ID" value={minimax.voiceId} onChange={(value) => updateSelectedProfile({ ...selectedProfile, minimax: { ...minimax, voiceId: value } })} />
            <LocalInfo title="克隆音色" value={`${cloneVoiceCount} 个本地记录，可后续接入 MiniMax 克隆接口。`} />
          </>
        ) : null}
      </div>
    </div>
  );
}

function AccountPage({ api, state, applyState }: { api: StoryDreamApi; state: AppState; applyState: ApplyMutationResult }) {
  const [draft, setDraft] = useState(state.account);
  const accountAction = useAsyncAction();
  useEffect(() => setDraft(state.account), [state.account]);
  async function saveAccountProfile() {
    await accountAction.run(async () => {
      applyState(await api.saveAccount(draft));
    }, { successMessage: '账户资料已保存。' });
  }
  return (
    <section className="panel account-panel">
      <div className="profile-card">
        <div className="avatar">{draft.avatarInitial || 'S'}</div>
        <div>
          <h2>{draft.displayName}</h2>
          <span>{draft.email} · {draft.deviceId}</span>
        </div>
        <strong>{draft.balance.toFixed(2)} 积分</strong>
      </div>
      <ConfigInput label="显示名称" value={draft.displayName} onChange={(value) => setDraft({ ...draft, displayName: value, avatarInitial: value.slice(0, 1).toUpperCase() || 'S' })} />
      <ConfigInput label="邮箱" value={draft.email} onChange={(value) => setDraft({ ...draft, email: value })} />
      <ConfigInput label="工作区" value={draft.workspace} onChange={(value) => setDraft({ ...draft, workspace: value })} />
      <button className="primary-action slim" disabled={accountAction.busy} onClick={saveAccountProfile}><Save size={15} />保存资料</button>
      <InlineActionFeedback feedback={accountAction.feedback} />
      <LocalInfo title="账号与激活关系" value="本地复刻版只显示设备、账户和余额状态，不连接真实登录或付费系统。" />
    </section>
  );
}

function ActivationPage({ api, state, applyState }: { api: StoryDreamApi; state: AppState; applyState: ApplyMutationResult }) {
  const [draft, setDraft] = useState(state.activation);
  const activationAction = useAsyncAction();
  useEffect(() => setDraft(state.activation), [state.activation]);
  async function saveActivationState() {
    await activationAction.run(async () => {
      applyState(await api.saveActivation(draft));
    }, { successMessage: '本地激活状态已保存。' });
  }
  return (
    <div className="two-column">
      <section className="panel">
        <div className="panel-title-row">
          <h2>激活状态</h2>
          <StatusPill status={draft.status === 'active' ? 'completed' : 'paused'} />
        </div>
        <ConfigInput label="激活码" value={draft.code} onChange={(value) => setDraft({ ...draft, code: value })} />
        <Segmented label="计划" value={draft.plan} options={['trial', 'local', 'inactive']} labels={['试用', '本地激活', '未激活']} onChange={(value) => setDraft({ ...draft, plan: value as ActivationState['plan'] })} />
        <ConfigInput label="状态说明" value={draft.message} onChange={(value) => setDraft({ ...draft, message: value })} />
        <button className="primary-action slim" disabled={activationAction.busy} onClick={saveActivationState}><Save size={15} />保存状态</button>
        <InlineActionFeedback feedback={activationAction.feedback} />
      </section>
      <section className="panel faq-panel">
        <LocalInfo title="立即激活" value="这里是本地模拟状态页，不做真实购买、登录或付费限制。" />
        <LocalInfo title="常见问题" value="激活码、订阅、设备解绑均为本地 UI 状态，可用于后续接入真实服务。" />
      </section>
    </div>
  );
}

function SettingsCard({ title, status, children }: { title: string; status: string; children: React.ReactNode }) {
  return (
    <div className="config-card">
      <div className="config-card-head"><div><strong>{title}</strong><span>使用中</span></div><small>{status}</small></div>
      <div className="form-grid">{children}</div>
    </div>
  );
}

function ConfigInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="config-input"><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function SecretInput({
  label,
  value,
  configured,
  onChange,
  onClear,
}: {
  label: string;
  value: string;
  configured: boolean;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <label className="config-input secret-input">
      <span>{label}<small>{configured ? '已配置' : '待配置'}</small></span>
      <div className="secret-input-control">
        <input
          type={revealed ? 'text' : 'password'}
          value={value}
          autoComplete="new-password"
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
        <button className="icon-button" type="button" title={revealed ? '隐藏' : '显示'} aria-label={revealed ? '隐藏密钥' : '显示密钥'} onClick={() => setRevealed((current) => !current)}>
          {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
        <button className="icon-button" type="button" title="清除" aria-label="清除密钥" disabled={!configured && !value} onClick={onClear}>
          <Trash2 size={15} />
        </button>
      </div>
    </label>
  );
}

function ConfigTextarea({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  return (
    <label className="config-input config-textarea">
      <span>
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ConfigNumberInput({
  label,
  value,
  min,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="config-input">
      <span>{label}</span>
      <input type="number" min={min} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function ModelPicker({
  label,
  value,
  models,
  loading,
  status,
  onRefresh,
  onChange,
}: {
  label: string;
  value: string;
  models: ProviderModel[];
  loading: boolean;
  status?: string;
  onRefresh: () => void;
  onChange: (value: string) => void;
}) {
  const hasModels = models.length > 0;
  const options = hasModels && value && !models.some((model) => model.id === value) ? [{ id: value }, ...models] : models;
  return (
    <div className="field model-picker-field">
      <span>{label}</span>
      <div className="model-picker">
        {hasModels ? (
          <select value={value} onChange={(event) => onChange(event.target.value)}>
            {!value ? <option value="">选择模型</option> : null}
            {options.map((model) => (
              <option key={model.id} value={model.id}>
                {model.id}
              </option>
            ))}
          </select>
        ) : (
          <input value={value} onChange={(event) => onChange(event.target.value)} />
        )}
        <button className="icon-button model-refresh-button" title="获取模型" aria-label="获取模型" disabled={loading} onClick={onRefresh} type="button">
          {loading ? <Loader2 className="spin" size={15} /> : <RotateCcw size={15} />}
        </button>
      </div>
      {status ? <small className="model-list-status">{status}</small> : null}
    </div>
  );
}

function LocalInfo({ title, value }: { title: string; value: string }) {
  return <div className="local-info"><Info size={18} /><div><strong>{title}</strong><span>{value}</span></div></div>;
}

function ProviderConfigNote({ title, value }: { title: string; value: string }) {
  return (
    <div className="provider-config-note">
      <Info size={16} />
      <div>
        <strong>{title}</strong>
        <span>{value}</span>
      </div>
    </div>
  );
}

function settingsStatusLabel(status: 'pass' | 'warn' | 'fail'): string {
  return status === 'pass' ? '已配置' : status === 'warn' ? '需确认' : '待配置';
}

type ImageResolution = '1K' | '2K' | '4K';

function settingsConfigSignature(config: AppConfig): string {
  return JSON.stringify(normalizeEditableConfigProviders(config));
}

function imageProviderLabel(provider: ImageProviderProfile['provider']): string {
  return provider === 'gpt_image' ? 'GPT Image' : provider === 'jimeng' ? '即梦' : '自定义图片';
}

function imageProfileSummary(profile: ImageProviderProfile): string {
  if (profile.provider === 'jimeng') return imageProfileJimeng(profile).reqKey || imageProfileJimeng(profile).model || '未配置 Req Key';
  if (profile.provider === 'custom') return imageProfileCustomImage(profile).model || '未选择模型';
  return imageProfileGptImage(profile).model || '未选择模型';
}

function ttsProviderLabel(provider: TtsProviderProfile['provider']): string {
  return provider === 'minimax' ? 'MiniMax' : '火山引擎';
}

function ttsProfileSummary(profile: TtsProviderProfile): string {
  if (profile.provider === 'minimax') return ttsProfileMinimax(profile).model || '未选择模型';
  const speaker = ttsProfileVolcengine(profile).speaker;
  return volcengineVoicePresetLabel(speaker) || speaker || '未选择音色';
}

type VolcengineVoiceOption = {
  voiceType: string;
  label: string;
};

function mergeVolcengineSpeakers(current: VolcengineSpeaker[], incoming: VolcengineSpeaker[]): VolcengineSpeaker[] {
  const byVoiceType = new Map(current.map((speaker) => [speaker.voiceType, speaker]));
  incoming.forEach((speaker) => {
    const voiceType = speaker.voiceType.trim();
    if (voiceType) byVoiceType.set(voiceType, { ...speaker, voiceType });
  });
  return [...byVoiceType.values()];
}

function buildVolcengineVoiceOptions(speakers: VolcengineSpeaker[]): VolcengineVoiceOption[] {
  const byVoiceType = new Map<string, VolcengineVoiceOption>();
  volcengineVoicePresets.forEach(([label, voiceType]) => {
    byVoiceType.set(voiceType, { voiceType, label });
  });
  speakers.forEach((speaker) => {
    const voiceType = speaker.voiceType.trim();
    if (!voiceType) return;
    byVoiceType.set(voiceType, {
      voiceType,
      label: speaker.name.trim() || volcengineStaticPresetLabel(voiceType) || voiceType,
    });
  });
  return [...byVoiceType.values()];
}

function volcenginePresetVoiceValue(speaker: string, options: VolcengineVoiceOption[] = buildVolcengineVoiceOptions([])): string {
  return options.some((option) => option.voiceType === speaker) ? speaker : 'custom';
}

function volcengineVoicePresetLabel(speaker: string, speakers: VolcengineSpeaker[] = []): string {
  return buildVolcengineVoiceOptions(speakers).find((option) => option.voiceType === speaker)?.label ?? '';
}

function volcengineStaticPresetLabel(speaker: string): string {
  return volcengineVoicePresets.find(([, voiceType]) => voiceType === speaker)?.[0] ?? '';
}

function setDraftModel(config: AppConfig, key: ModelListKey, model: string): AppConfig {
  if (key === 'gpt-image') {
    return { ...config, gptImage: { ...config.gptImage, model } };
  }
  if (key === 'custom-image') {
    return { ...config, customImage: { ...config.customImage, model } };
  }
  return saveLlmProfile(config, { ...config.llm, model });
}

function setImageResolution(config: AppConfig, resolution: ImageResolution): AppConfig {
  if (config.imageProvider === 'custom') {
    return { ...config, customImage: { ...config.customImage, resolution } };
  }
  if (config.imageProvider === 'jimeng') {
    return { ...config, jimeng: { ...config.jimeng, resolution } };
  }
  return { ...config, image: { ...config.image, resolution }, gptImage: { ...config.gptImage, resolution } };
}

function activeImageResolution(config: AppConfig): ImageResolution {
  if (config.imageProvider === 'custom') return config.customImage.resolution ?? '2K';
  if (config.imageProvider === 'jimeng') return config.jimeng.resolution;
  return config.gptImage.resolution ?? config.image.resolution ?? '2K';
}

function setImageConcurrency(config: AppConfig, concurrency: number): AppConfig {
  if (config.imageProvider === 'custom') {
    return { ...config, customImage: { ...config.customImage, concurrency } };
  }
  if (config.imageProvider === 'jimeng') {
    return { ...config, jimeng: { ...config.jimeng, concurrency } };
  }
  return { ...config, image: { ...config.image, concurrency }, gptImage: { ...config.gptImage, concurrency } };
}

function activeImageConcurrency(config: AppConfig): number {
  if (config.imageProvider === 'custom') return config.customImage.concurrency;
  if (config.imageProvider === 'jimeng') return config.jimeng.concurrency;
  return config.gptImage.concurrency ?? config.image.concurrency;
}

function formatMs(value: number): string {
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

declare global {
  interface Window {
    __storydreamReactRoot?: Root;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root element');
}

applyStoredTheme(defaultUiPreferences.theme);
window.__storydreamReactRoot ??= createRoot(rootElement);
window.__storydreamReactRoot.render(<App />);
