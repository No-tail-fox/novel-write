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
  FileJson,
  FolderOpen,
  Image as ImageIcon,
  Info,
  KeyRound,
  LayoutTemplate,
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
  CustomStyle,
  DraftTemplate,
  DraftTextBorder,
  HistoryFamily,
  ImageProviderProfile,
  ImaKnowledgeResult,
  JianyingEffectCatalog,
  PromptTemplate,
  PromptStepTemplateType,
  PromptTemplateType,
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
import {
  addUploadedBgm,
  resolveDefaultBgmId,
  toggleArray,
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
import { defaultConfig, defaultCustomStyles, defaultUiPreferences } from './shared/config';
import { draftTemplates as builtinDraftTemplates, imageAnimations } from './shared/templates';
import { convertCozeWorkflowToDraftTemplate, convertManyCozeWorkflowsToDraftTemplates, type CozeWorkflowTemplateConversionResult } from './shared/coze-workflow-converter';
import {
  buildStoryTemplateTrackOptions,
  resolvePromptTemplateDefaultStyleId,
  resolvePromptTemplateDefaultStyleIds,
  selectStepPromptTemplate,
} from './shared/prompt-templates';
import { taskProgressLabel } from './shared/html-video-workflow';
import { useAsyncAction } from './ui/async-action';
import { FormField as Field } from './components/FormField';
import { SegmentedControl as Segmented } from './components/SegmentedControl';
import { ToggleField } from './components/ToggleField';
import { RangeField } from './components/RangeField';
import { Accordion } from './components/Accordion';
import { AsyncActionFeedback as InlineActionFeedback } from './components/AsyncActionFeedback';
import { StatusBadge as StatusPill, taskStatusLabel as statusLabel } from './components/StatusBadge';
import { EmptyState } from './components/EmptyState';
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
  fallbackEffectCatalog,
  promptStepEditorDefinitions,
  promptTemplateReferenceOptions,
  promptTemplateStep3SkeletonOptions,
  promptTemplateTypeLabels,
  promptTemplateTypeOptions,
  promptTemplateVariableDefinitions,
  siliconFlowSpeechToTextBaseUrl,
  siliconFlowSpeechToTextModels,
  styleOptions,
  volcengineVoicePresets,
  type PromptTemplateVariableScope,
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
type DraftCanvasLayer = 'image' | 'title' | 'subtitle' | 'caption' | 'disclaimer';
const DRAFT_TEXT_WIDTH_MIN = 0.1;
const DRAFT_TEXT_WIDTH_MAX = 2;
type DraftDragSnapshot =
  | { mode: 'move'; layer: DraftCanvasLayer; pointerId: number; startX: number; startY: number; template: DraftTemplate }
  | { mode: 'resize'; layer: Exclude<DraftCanvasLayer, 'image'>; pointerId: number; startX: number; startY: number; template: DraftTemplate };

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

function PromptTemplatesPage({ api, state, applyState }: { api: StoryDreamApi; state: AppState; applyState: ApplyMutationResult }) {
  const [selectedId, setSelectedId] = useState(state.promptTemplates[0]?.id ?? '');
  const [templateMode, setTemplateMode] = useState<'gallery' | 'detail' | 'image-detail'>('gallery');
  const [promptTemplateLibraryTab, setPromptTemplateLibraryTab] = useState<'story' | 'image'>('story');
  const [templateTypeFilter, setTemplateTypeFilter] = useState<PromptTemplateType | 'all'>('all');
  const [templateTrackFilter, setTemplateTrackFilter] = useState('all');
  const [selectedImageStyleId, setSelectedImageStyleId] = useState(state.customStyles[0]?.id ?? defaultCustomStyles[0]?.id ?? '');
  const [imageDraft, setImageDraft] = useState<CustomStyle | null>(state.customStyles[0] ? { ...state.customStyles[0] } : null);
  const [imageTemplateAiPrompt, setImageTemplateAiPrompt] = useState('');
  const [imageTemplateAiStatus, setImageTemplateAiStatus] = useState('');
  const [imageTemplateAiGenerating, setImageTemplateAiGenerating] = useState(false);
  const [baseImageTemplateId, setBaseImageTemplateId] = useState(state.customStyles[0]?.id ?? defaultCustomStyles[0]?.id ?? '');
  const filteredTemplates = state.promptTemplates.filter((template) => {
    const typeMatches = templateTypeFilter === 'all' || template.type === templateTypeFilter;
    const trackMatches = templateTrackFilter === 'all' || template.baseTrack === templateTrackFilter;
    return typeMatches && trackMatches;
  });
  const selected = state.promptTemplates.find((template) => template.id === selectedId) ?? filteredTemplates[0] ?? state.promptTemplates[0];
  const selectedImageStyle = state.customStyles.find((style) => style.id === selectedImageStyleId) ?? state.customStyles[0] ?? defaultCustomStyles[0];
  const [draft, setDraft] = useState<PromptTemplate | null>(selected ? { ...selected } : null);
  const [templateJsonDraft, setTemplateJsonDraft] = useState('');
  const [imageTemplateJsonDraft, setImageTemplateJsonDraft] = useState('');
  const promptTemplateAction = useAsyncAction();
  const promptDetailGeneration = useRef(0);
  const promptTemplateTrackOptions = buildStoryTemplateTrackOptions(state.promptTemplates);
  const promptTemplateBindingTrackOptions =
    draft?.baseTrack && !promptTemplateTrackOptions.some(([id]) => id === draft.baseTrack)
      ? [...promptTemplateTrackOptions, [draft.baseTrack, draft.baseTrack, '当前模板赛道'] as [string, string, string]]
      : promptTemplateTrackOptions;

  useEffect(() => setDraft(selected ? { ...selected } : null), [selected?.id]);
  useEffect(() => setImageDraft(selectedImageStyle ? { ...selectedImageStyle } : null), [selectedImageStyle?.id]);

  function openPromptTemplateDetail(template: PromptTemplate) {
    const generation = ++promptDetailGeneration.current;
    setSelectedId(template.id);
    setDraft({ ...template });
    setTemplateJsonDraft('');
    setTemplateMode('detail');
    void promptTemplateAction.run(async () => {
      const detail = await api.getPromptTemplateDetail(template.id);
      if (generation === promptDetailGeneration.current && detail) setDraft({ ...detail });
    });
  }

  function openImageTemplateDetail(style: CustomStyle) {
    setSelectedImageStyleId(style.id);
    setImageDraft({ ...style });
    setBaseImageTemplateId(style.id);
    setImageTemplateAiStatus('');
    setTemplateMode('image-detail');
  }

  function handlePromptTemplateRowKeyDown(event: React.KeyboardEvent<HTMLElement>, template: PromptTemplate) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openPromptTemplateDetail(template);
  }

  async function savePromptTemplateDraft() {
    if (!draft) return;
    const shouldForkTemplate = Boolean(draft.isBuiltin);
    const templateToSave: PromptTemplate = {
      ...independentPromptTemplateFields(draft),
      id: shouldForkTemplate ? crypto.randomUUID() : draft.id,
      isBuiltin: false,
      origin: 'custom',
      updatedAt: new Date().toISOString(),
    };
    await promptTemplateAction.run(async () => {
      applyState(await api.savePromptTemplate(templateToSave));
      setSelectedId(templateToSave.id);
      setDraft(templateToSave);
      setTemplateMode('detail');
    });
  }

  async function duplicateTemplate(template: PromptTemplate) {
    const copy = { ...independentPromptTemplateFields(template), id: crypto.randomUUID(), name: `${template.name} 副本`, isBuiltin: false, origin: 'custom' as const };
    await promptTemplateAction.run(async () => {
      applyState(await api.savePromptTemplate(copy));
      setSelectedId(copy.id);
      setDraft(copy);
      setTemplateJsonDraft('');
      setTemplateMode('detail');
    });
  }

  async function duplicate() {
    if (!draft) return;
    await duplicateTemplate(draft);
  }

  async function createPromptTemplate() {
    const baseTrack = templateTrackFilter === 'all' ? 'general-story' : templateTrackFilter;
    const template: PromptTemplate = {
      id: crypto.randomUUID(),
      name: '新建模板',
      type: 'task',
      description: '本地自定义提示词模板',
      content: '请基于 {{inputText}} 生成适合 {{track}} 的短视频内容。',
      isBuiltin: false,
      updatedAt: new Date().toISOString(),
      baseTrack,
      defaultStyles: ['photo-real'],
      defaultDraftTemplateId: state.draftTemplates[0]?.id ?? 'default-portrait-9-16',
      characterPolicy: 'follow-template',
      step3SkeletonModules: ['防台词文字'],
      referenceKind: 'none',
      origin: 'custom',
      marketTags: [],
    };
    await promptTemplateAction.run(async () => {
      applyState(await api.savePromptTemplate(template));
      setSelectedId(template.id);
      setDraft(template);
      setTemplateJsonDraft('');
      setTemplateMode('detail');
    });
  }

  async function saveCustomStyleDraft() {
    if (!imageDraft) return;
    const now = new Date().toISOString();
    const styleToSave = { ...imageDraft, updatedAt: now, createdAt: imageDraft.createdAt || now };
    await promptTemplateAction.run(async () => {
      applyState(await api.saveCustomStyle(styleToSave));
      setSelectedImageStyleId(styleToSave.id);
      setImageDraft(styleToSave);
      setImageTemplateAiStatus('已保存图像模板。');
      setTemplateMode('image-detail');
    });
  }

  async function duplicateImageTemplate(style: CustomStyle) {
    const now = new Date().toISOString();
    const copy = { ...style, id: crypto.randomUUID(), name: `${style.name} 副本`, createdAt: now, updatedAt: now };
    await promptTemplateAction.run(async () => {
      applyState(await api.saveCustomStyle(copy));
      setSelectedImageStyleId(copy.id);
      setImageDraft(copy);
      setImageTemplateAiStatus('已克隆图像模板。');
      setTemplateMode('image-detail');
    });
  }

  async function createImageTemplate() {
    const base = state.customStyles.find((style) => style.id === baseImageTemplateId) ?? state.customStyles[0] ?? defaultCustomStyles[0];
    const now = new Date().toISOString();
    const template: CustomStyle = {
      ...base,
      id: crypto.randomUUID(),
      name: '新建图像模板',
      tag: '自定义风格',
      shortName: '自定义',
      createdAt: now,
      updatedAt: now,
    };
    await promptTemplateAction.run(async () => {
      applyState(await api.saveCustomStyle(template));
      setSelectedImageStyleId(template.id);
      setImageDraft(template);
      setImageTemplateAiStatus('');
      setTemplateMode('image-detail');
    });
  }

  function applyBaseImageTemplate() {
    if (!imageDraft) return;
    const base = state.customStyles.find((style) => style.id === baseImageTemplateId) ?? defaultCustomStyles.find((style) => style.id === baseImageTemplateId);
    if (!base) return;
    setImageDraft({
      ...imageDraft,
      tag: base.tag,
      shortName: base.shortName,
      prefix: base.prefix,
      suffix: base.suffix,
      negativePrompt: base.negativePrompt,
      allowColor: base.allowColor,
      description: base.description,
    });
    setImageTemplateAiStatus(`已套用系统风格：${base.name}`);
  }

  async function fillImageTemplateFromAiPrompt() {
    if (!imageDraft) return;
    const prompt = imageTemplateAiPrompt.trim();
    if (!prompt) {
      setImageTemplateAiStatus('请先输入风格描述。');
      return;
    }
    const base = state.customStyles.find((style) => style.id === baseImageTemplateId) ?? defaultCustomStyles.find((style) => style.id === baseImageTemplateId);
    await promptTemplateAction.run(async () => {
      setImageTemplateAiGenerating(true);
      setImageTemplateAiStatus('正在生成字段...');
      try {
        const generated = await api.generateCustomStyleDraft({ prompt, baseStyle: base ?? imageDraft });
        setImageDraft({ ...imageDraft, ...generated, id: imageDraft.id, createdAt: imageDraft.createdAt });
        setImageTemplateAiStatus(`已生成字段：${generated.name || prompt}`);
      } finally {
        setImageTemplateAiGenerating(false);
      }
    }, { onError: (error) => setImageTemplateAiStatus(`生成失败：${error.message}`) });
  }

  function exportPromptTemplateJson() {
    if (!draft) return;
    const json = JSON.stringify(draft, null, 2);
    setTemplateJsonDraft(json);
    void navigator.clipboard?.writeText(json).catch(() => undefined);
  }

  function exportImageTemplateJson() {
    if (!imageDraft) return;
    const json = JSON.stringify(imageDraft, null, 2);
    setImageTemplateJsonDraft(json);
    void navigator.clipboard?.writeText(json).catch(() => undefined);
  }

  function resolveImportedTemplateId(imported: { id?: string }, exists: boolean): string {
    return imported.id && !exists ? imported.id : crypto.randomUUID();
  }

  async function importPromptTemplateJson() {
    await promptTemplateAction.run(async () => {
      const imported = JSON.parse(templateJsonDraft) as PromptTemplate;
      const id = resolveImportedTemplateId(imported, state.promptTemplates.some((template) => template.id === imported.id));
      const next = { ...imported, id, isBuiltin: false, origin: 'custom' as const, updatedAt: new Date().toISOString() };
      applyState(await api.savePromptTemplate(next));
      setSelectedId(next.id);
      setDraft(next);
      setTemplateMode('detail');
      setTemplateJsonDraft('');
    }, { onError: () => setTemplateJsonDraft('{"name":"自定义模板","type":"task","description":"请补充","content":"请补充提示词"}') });
  }

  async function importImageTemplateJson() {
    await promptTemplateAction.run(async () => {
      const imported = JSON.parse(imageTemplateJsonDraft) as CustomStyle;
      const now = new Date().toISOString();
      const id = resolveImportedTemplateId(imported, state.customStyles.some((style) => style.id === imported.id));
      const next: CustomStyle = {
        ...imported,
        id,
        createdAt: imported.createdAt || now,
        updatedAt: now,
      };
      applyState(await api.saveCustomStyle(next));
      setSelectedImageStyleId(next.id);
      setImageDraft(next);
      setTemplateMode('image-detail');
      setImageTemplateJsonDraft('');
    }, { onError: () => setImageTemplateJsonDraft('{"name":"自定义图像模板","tag":"自定义","shortName":"自定义","prefix":"请补充","suffix":"请补充","negativePrompt":"请补充","allowColor":true,"description":"请补充"}') });
  }

  async function resetPromptTemplateLibrary() {
    await promptTemplateAction.run(async () => {
      applyState(await api.resetPromptTemplates());
    });
  }

  function updatePromptTemplateStepPrompt(type: PromptStepTemplateType, content: string) {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        stepPrompts: {
          ...(current.stepPrompts ?? {}),
          [type]: content,
        },
      };
    });
  }

  function resetPromptTemplateStepPrompt(type: PromptStepTemplateType) {
    setDraft((current) => {
      if (!current?.stepPrompts) return current;
      const nextStepPrompts = { ...current.stepPrompts };
      delete nextStepPrompts[type];
      return {
        ...current,
        stepPrompts: Object.keys(nextStepPrompts).length > 0 ? nextStepPrompts : undefined,
      };
    });
  }

  if (templateMode === 'gallery') {
    return (
      <div className="prompt-template-gallery">
        <div className="panel-title-row prompt-template-gallery-toolbar">
          <div>
            <h2>提示词模板</h2>
            <p>故事模板决定 AI 怎么写，图像模板决定画面怎么长。先浏览模板，点开后查看和编辑细节。</p>
          </div>
          <div className="button-row">
            <button className="ghost-action" disabled={promptTemplateAction.busy} onClick={resetPromptTemplateLibrary}>
              <RotateCcw size={14} />
              重置
            </button>
            <button className="primary-action slim" onClick={promptTemplateLibraryTab === 'story' ? createPromptTemplate : createImageTemplate}>
              <Plus size={14} />
              新建模板
            </button>
          </div>
        </div>
        <InlineActionFeedback feedback={promptTemplateAction.feedback} />
        <div className="prompt-template-tabs" role="tablist" aria-label="提示词模板类型">
          <button className={promptTemplateLibraryTab === 'story' ? 'chip active' : 'chip'} type="button" onClick={() => setPromptTemplateLibraryTab('story')}>故事模板</button>
          <button className={promptTemplateLibraryTab === 'image' ? 'chip active' : 'chip'} type="button" onClick={() => setPromptTemplateLibraryTab('image')}>图像模板</button>
        </div>
        {promptTemplateLibraryTab === 'story' ? (
          <>
            <div className="template-filter-row">
              <Field label="类型筛选">
                <select value={templateTypeFilter} onChange={(event) => setTemplateTypeFilter(event.target.value as PromptTemplateType | 'all')}>
                  {promptTemplateTypeOptions.map((type) => <option key={type} value={type}>{promptTemplateTypeLabel(type)}</option>)}
                </select>
              </Field>
              <Field label="赛道筛选">
                <select value={templateTrackFilter} onChange={(event) => setTemplateTrackFilter(event.target.value)}>
                  <option value="all">全部赛道</option>
                  {promptTemplateTrackOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </Field>
            </div>
            <section className="prompt-template-list story-template-gallery">
              <div className="prompt-template-list-title">
                <strong>故事模板（{filteredTemplates.filter((template) => template.type === 'task').length}）</strong>
                <span>{filteredTemplates.length} 个匹配模板</span>
              </div>
              {filteredTemplates.length > 0 ? filteredTemplates.map((template) => (
                <article
                  className="prompt-template-row"
                  key={template.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openPromptTemplateDetail(template)}
                  onKeyDown={(event) => handlePromptTemplateRowKeyDown(event, template)}
                >
                  <Sparkles size={18} />
                  <div className="prompt-template-row-main">
                    <strong>{template.name}</strong>
                    <span>{template.description}</span>
                    <small>默认图像模板：{promptTemplateStyleLabelList(template, state.customStyles).join('、') || '未设置'} · id: {template.id}</small>
                  </div>
                  <div className="prompt-template-row-actions">
                    <button className="ghost-action compact-action" onClick={(event) => { event.stopPropagation(); openPromptTemplateDetail(template); }}>
                      查看
                    </button>
                    <button className="ghost-action compact-action" onClick={(event) => { event.stopPropagation(); void duplicateTemplate(template); }}>
                      <Copy size={14} />
                      克隆
                    </button>
                  </div>
                </article>
              )) : <EmptyState title="暂无匹配模板" />}
            </section>
          </>
        ) : (
          <section className="prompt-template-list image-template-gallery">
            <div className="prompt-template-list-title">
              <strong>图像模板（{state.customStyles.length}）</strong>
              <span>管理 prefix、suffix、负面提示词和色彩模式</span>
            </div>
            {state.customStyles.map((style) => (
              <article
                className="prompt-template-row"
                key={style.id}
                role="button"
                tabIndex={0}
                onClick={() => openImageTemplateDetail(style)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openImageTemplateDetail(style);
                  }
                }}
              >
                <Palette size={18} />
                <div className="prompt-template-row-main">
                  <strong>{style.name}</strong>
                  <span>{style.description}</span>
                  <small>{style.tag} · {style.allowColor ? '彩色' : '黑白 / 单色'} · id: {style.id}</small>
                </div>
                <div className="prompt-template-row-actions">
                  <button className="ghost-action compact-action" onClick={(event) => { event.stopPropagation(); openImageTemplateDetail(style); }}>
                    查看
                  </button>
                  <button className="ghost-action compact-action" onClick={(event) => { event.stopPropagation(); void duplicateImageTemplate(style); }}>
                    <Copy size={14} />
                    克隆
                  </button>
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
    );
  }

  if (templateMode === 'image-detail') {
    return (
      <div className="prompt-template-detail">
        <section className="panel editor-panel">
          <InlineActionFeedback feedback={promptTemplateAction.feedback} />
          {imageDraft ? (
            <>
              <div className="panel-title-row prompt-template-detail-title">
                <div>
                  <button className="ghost-action compact-action" onClick={() => setTemplateMode('gallery')}>返回模板库</button>
                  <h2>查看图像模板 · {imageDraft.name}</h2>
                </div>
                <div className="button-row">
                  <button className="ghost-action" onClick={() => void duplicateImageTemplate(imageDraft)}>
                    <Copy size={15} />
                    克隆
                  </button>
                  <button className="ghost-action" onClick={exportImageTemplateJson}>
                    <FileJson size={15} />
                    导出 JSON
                  </button>
                  <button className="ghost-action" onClick={() => void importImageTemplateJson()}>
                    <FileJson size={15} />
                    导入 JSON
                  </button>
                  <button className="primary-action slim" onClick={saveCustomStyleDraft}>
                    <Save size={15} />
                    保存
                  </button>
                </div>
              </div>
              <div className="prompt-template-detail-stack">
                <section className="image-template-quick-card">
                  <div>
                    <span className="field-title">AI 快速生成</span>
                    <span className="hint-text">输入自然语言描述，自动填充下方图像模板字段。</span>
                  </div>
                  <Field label="风格描述">
                    <textarea className="small-textarea" value={imageTemplateAiPrompt} onChange={(event) => setImageTemplateAiPrompt(event.target.value)} placeholder="例如：赛博朋克雨夜街道，霓虹光影，未来都市" />
                  </Field>
                  <div className="template-meta-grid">
                    <Field label="基于系统风格">
                      <select value={baseImageTemplateId} onChange={(event) => setBaseImageTemplateId(event.target.value)}>
                        {state.customStyles.map((style) => <option key={style.id} value={style.id}>{style.name}</option>)}
                      </select>
                    </Field>
                    <div className="button-row image-template-quick-actions">
                      <button className="ghost-action" type="button" onClick={applyBaseImageTemplate}>套用系统风格</button>
                      <button className="primary-action slim" type="button" disabled={imageTemplateAiGenerating} onClick={() => void fillImageTemplateFromAiPrompt()}>
                        {imageTemplateAiGenerating ? '生成中...' : '生成字段'}
                      </button>
                    </div>
                  </div>
                  {imageTemplateAiStatus ? <div className="image-template-ai-status" aria-live="polite">{imageTemplateAiStatus}</div> : null}
                </section>

                <section className="prompt-template-settings-card">
                  <span className="field-title">手动填写字段</span>
                  <div className="image-template-field-grid">
                    <Field label="名称">
                      <input value={imageDraft.name} onChange={(event) => setImageDraft({ ...imageDraft, name: event.target.value })} />
                    </Field>
                    <Field label="标签">
                      <input value={imageDraft.tag} onChange={(event) => setImageDraft({ ...imageDraft, tag: event.target.value })} />
                    </Field>
                    <Field label="简称">
                      <input value={imageDraft.shortName} onChange={(event) => setImageDraft({ ...imageDraft, shortName: event.target.value })} />
                    </Field>
                    <Field label="色彩模式">
                      <select value={imageDraft.allowColor ? 'color' : 'mono'} onChange={(event) => setImageDraft({ ...imageDraft, allowColor: event.target.value === 'color' })}>
                        <option value="color">彩色</option>
                        <option value="mono">黑白 / 单色</option>
                      </select>
                    </Field>
                  </div>
                  <Field label="前缀（prefix）">
                    <textarea className="small-textarea" value={imageDraft.prefix} onChange={(event) => setImageDraft({ ...imageDraft, prefix: event.target.value })} />
                  </Field>
                  <Field label="后缀（suffix）">
                    <textarea className="small-textarea" value={imageDraft.suffix} onChange={(event) => setImageDraft({ ...imageDraft, suffix: event.target.value })} />
                  </Field>
                  <Field label="负面提示词（negativePrompt）">
                    <textarea className="small-textarea" value={imageDraft.negativePrompt} onChange={(event) => setImageDraft({ ...imageDraft, negativePrompt: event.target.value })} />
                  </Field>
                  <Field label="适用场景描述">
                    <textarea className="small-textarea" value={imageDraft.description} onChange={(event) => setImageDraft({ ...imageDraft, description: event.target.value })} />
                  </Field>
                </section>
                <Field label="导入 / 导出 JSON">
                  <textarea className="small-textarea" value={imageTemplateJsonDraft} onChange={(event) => setImageTemplateJsonDraft(event.target.value)} placeholder="导出后会填入这里；也可粘贴图像模板 JSON 后点击导入 JSON" />
                </Field>
              </div>
            </>
          ) : (
            <EmptyState title="暂无图像模板" />
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="prompt-template-detail">
      <section className="panel editor-panel">
        <InlineActionFeedback feedback={promptTemplateAction.feedback} />
        {draft ? (
          <>
            <div className="panel-title-row prompt-template-detail-title">
              <div>
                <button className="ghost-action compact-action" onClick={() => setTemplateMode('gallery')}>返回模板库</button>
                <h2>查看系统模板 · {draft.name}</h2>
              </div>
              <div className="button-row">
                <button className="ghost-action" onClick={duplicate}>
                  <Copy size={15} />
                  克隆
                </button>
                <button className="ghost-action" onClick={exportPromptTemplateJson}>
                  <FileJson size={15} />
                  导出 JSON
                </button>
                <button className="ghost-action" onClick={() => void importPromptTemplateJson()}>
                  <FileJson size={15} />
                  导入 JSON
                </button>
                <button className="primary-action slim" onClick={savePromptTemplateDraft}>
                  <Save size={15} />
                  {draft.isBuiltin ? '保存为自定义模板' : '保存修改'}
                </button>
              </div>
            </div>
            <div className="prompt-template-detail-stack">
              <section className="prompt-template-basics-card">
                <div className="template-meta-grid prompt-template-basics-grid">
                  <Field label="模板名">
                    <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                  </Field>
                  <Field label="描述（一句话说明这个模板的特点）">
                    <input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
                  </Field>
                  <Field label="模板类型">
                    <select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as PromptTemplateType })}>
                      {promptTemplateTypeOptions.filter((type) => type !== 'all').map((type) => <option key={type} value={type}>{promptTemplateTypeLabel(type)}</option>)}
                    </select>
                  </Field>
                  <Field label="绑定赛道">
                    <select value={draft.baseTrack ?? ''} onChange={(event) => setDraft({ ...draft, baseTrack: event.target.value || undefined })}>
                      <option value="">无</option>
                      {promptTemplateBindingTrackOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="prompt-template-default-style-pills">
                  <span className="field-title">默认画风</span>
                  <div className="chip-row">
                    {promptTemplateStyleOptions(state.customStyles, draft).map((style) => (
                      <button
                        className={resolvePromptTemplateDefaultStyleId(draft, state.customStyles.map((customStyle) => customStyle.id)) === style.id ? 'chip active' : 'chip'}
                        type="button"
                        key={style.id}
                        onClick={() => setDraft({ ...draft, defaultStyles: [style.id] })}
                      >
                        {style.name}
                      </button>
                    ))}
                  </div>
                </div>
                {draft.type === 'task' ? (
                  <div className="prompt-template-default-style-pills">
                    <span className="field-title">默认草稿模板</span>
                    <div className="chip-row">
                      {state.draftTemplates.map((template) => (
                        <button
                          className={(draft.defaultDraftTemplateId ?? 'default-portrait-9-16') === template.id ? 'chip active' : 'chip'}
                          type="button"
                          key={template.id}
                          onClick={() => setDraft({ ...draft, defaultDraftTemplateId: template.id })}
                        >
                          {template.name}
                        </button>
                      ))}
                    </div>
                    <small>新建任务选择赛道后，会同步草稿模板，并把 AI 出图比例同步为该草稿的图片比例。</small>
                  </div>
                ) : null}
              </section>

              <section className="prompt-template-settings-card">
                <span className="field-title">设置内容</span>
                <div className="prompt-template-content-settings">
                  <div className="prompt-template-setting-block">
                    <strong>主角档案</strong>
                    <div className="chip-row">
                      {(['follow-template', 'force-extract', 'force-skip'] as const).map((policy) => (
                        <button className={draft.characterPolicy === policy ? 'chip active' : 'chip'} type="button" key={policy} onClick={() => setDraft({ ...draft, characterPolicy: policy })}>
                          {policy === 'force-extract' ? '强制提取' : policy === 'force-skip' ? '强制跳过' : '跟随赛道'}
                        </button>
                      ))}
                    </div>
                    <small>主角档案会影响 Step 3 是否保持人物身份、外貌、年代和叙事一致。</small>
                  </div>
                  <div className="prompt-template-setting-block">
                    <strong>Step 3 骨架模块（可选线路）</strong>
                    <div className="chip-row">
                      {promptTemplateStep3SkeletonOptions.map((module) => (
                        <button
                          className={(draft.step3SkeletonModules ?? []).includes(module) ? 'chip active' : 'chip'}
                          type="button"
                          key={module}
                          onClick={() => setDraft({ ...draft, step3SkeletonModules: toggleArray(draft.step3SkeletonModules ?? [], module) })}
                        >
                          {module}
                        </button>
                      ))}
                    </div>
                    <small>勾选后 AI 助手会按用途生成对应骨架，已保存的 Step 3 prompt 文本不会自动改变。</small>
                  </div>
                  <div className="prompt-template-setting-block">
                    <strong>参考图类型</strong>
                    <div className="chip-row">
                      {promptTemplateReferenceOptions.map(([value, label]) => (
                        <button className={(draft.referenceKind ?? 'none') === value ? 'chip active' : 'chip'} type="button" key={value} onClick={() => setDraft({ ...draft, referenceKind: value })}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <small>上传参考图时，Step 3 会按这里的类型决定人脸或产品一致性要求。</small>
                  </div>
                </div>
                <div className="prompt-template-advanced-grid">
                  <Field label="标签">
                    <input value={(draft.marketTags ?? []).join('、')} onChange={(event) => setDraft({ ...draft, marketTags: splitListInput(event.target.value) })} />
                  </Field>
                  {draft.type === 'task' ? (
                    <Field label="出图种子池 JSON">
                      <textarea
                        className="small-textarea prompt-template-seed-pools"
                        value={draft.imageSeedPoolsJson ?? ''}
                        onChange={(event) => setDraft({ ...draft, imageSeedPoolsJson: event.target.value })}
                        placeholder='{"scenes":["close-up","wide shot"],"moods":["warm","dramatic"]}'
                      />
                    </Field>
                  ) : null}
                </div>
              </section>

              <span className="local-note">{draft.isBuiltin ? '系统模板保存后会生成自定义副本，原系统模板保持不变。' : '自定义模板保存会更新当前模板，历史任务和已绑定配置会继续使用这个模板。'}</span>

              {draft.type === 'task' ? (
                <section className="prompt-step-editor-list" aria-label="AI 步骤设置">
                  <div className="prompt-step-editor-heading">
                    <span className="field-title prompt-step-editor-section-title">步骤默认提示词</span>
                  </div>
                  <article className="prompt-step-editor-card" key="task-template-content">
                    <div className="prompt-step-editor-card-header">
                      <div>
                        <strong>任务总指令</strong>
                        <small>定义当前任务模板的整体目标、赛道语气和内容边界</small>
                      </div>
                    </div>
                    <PromptVariablePicker scope="task" value={draft.content} onChange={(value) => setDraft({ ...draft, content: value })} />
                    <VariableAwareTextarea
                      className="template-textarea prompt-step-editor-textarea"
                      value={draft.content}
                      onChange={(value) => setDraft({ ...draft, content: value })}
                      placeholder="输入 // 选择变量"
                      variables={promptTemplateVariablesForScope('task')}
                    />
                  </article>
                  {promptStepEditorDefinitions.map((step) => {
                    const hasOverride = promptTemplateHasStepPrompt(draft, step.type);
                    return (
                      <article className="prompt-step-editor-card" key={step.type}>
                        <div className="prompt-step-editor-card-header">
                          <div>
                            <strong>{step.label}</strong>
                            <small>{step.hint}</small>
                          </div>
                          <button className="ghost-action compact-action" type="button" disabled={!hasOverride} onClick={() => resetPromptTemplateStepPrompt(step.type)}>
                            继承全局
                          </button>
                        </div>
                        {(step.type === 'review' || step.type === 'rewrite') ? (
                          <PromptVariablePicker
                            scope={step.type}
                            value={promptTemplateStepPromptValue(draft, state.promptTemplates, step.type)}
                            onChange={(value) => updatePromptTemplateStepPrompt(step.type, value)}
                          />
                        ) : null}
                        <VariableAwareTextarea
                          className="template-textarea prompt-step-editor-textarea"
                          value={promptTemplateStepPromptValue(draft, state.promptTemplates, step.type)}
                          onChange={(value) => updatePromptTemplateStepPrompt(step.type, value)}
                          placeholder="输入 // 选择变量"
                          variables={promptTemplateVariablesForScope(step.type)}
                        />
                      </article>
                    );
                  })}
                </section>
              ) : (
                <section className="prompt-template-settings-card">
                  <div className="prompt-template-section-heading">
                    <span className="field-title">提示词内容</span>
                  </div>
                  <PromptVariablePicker scope={draft.type} value={draft.content} onChange={(value) => setDraft({ ...draft, content: value })} />
                  <VariableAwareTextarea
                    className="template-textarea"
                    value={draft.content}
                    onChange={(value) => setDraft({ ...draft, content: value })}
                    placeholder="输入 // 选择变量"
                    variables={promptTemplateVariablesForScope(draft.type)}
                  />
                </section>
              )}
            </div>
            <Field label="导入 / 导出 JSON">
              <textarea className="small-textarea" value={templateJsonDraft} onChange={(event) => setTemplateJsonDraft(event.target.value)} placeholder="导出后会填入这里；也可粘贴故事模板 JSON 后点击导入 JSON" />
            </Field>
          </>
        ) : (
          <EmptyState title="暂无模板" />
        )}
      </section>
    </div>
  );
}

function insertPromptVariable(value: string, key: string, cursor: number): { value: string; cursor: number } {
  const token = `{{${key}}}`;
  const before = value.slice(0, cursor);
  const after = value.slice(cursor);
  const triggerIndex = before.lastIndexOf('//');
  if (triggerIndex >= 0 && before.slice(triggerIndex).trim() === '//') {
    const nextValue = `${value.slice(0, triggerIndex)}${token}${after}`;
    return { value: nextValue, cursor: triggerIndex + token.length };
  }
  const prefix = before.endsWith(' ') || before.endsWith('\n') || before.length === 0 ? '' : ' ';
  const nextValue = `${before}${prefix}${token}${after}`;
  return { value: nextValue, cursor: before.length + prefix.length + token.length };
}

function promptTemplateVariablesForScope(scope: PromptTemplateVariableScope) {
  return promptTemplateVariableDefinitions.filter((item) => item.scopes.includes(scope));
}

function appendPromptVariable(value: string, key: string): string {
  return insertPromptVariable(value, key, value.length).value;
}

function PromptVariablePicker({
  scope,
  value,
  onChange,
}: {
  scope: PromptTemplateVariableScope;
  value: string;
  onChange: (value: string) => void;
}) {
  const variables = promptTemplateVariablesForScope(scope);
  return (
    <>
      <span className="field-title">变量</span>
      <span className="hint-text">点击插入当前步骤可用变量；每个提示词输入框也可输入 // 选择变量。</span>
      <div className="variable-chip-row">{variables.map((item) => (
        <button
          className="chip prompt-template-variable-chip"
          type="button"
          key={item.key}
          title={`插入 {{${item.key}}}: ${item.description}`}
          onClick={() => onChange(appendPromptVariable(value, item.key))}
        >
          <span>{item.label}</span>
          <code className="prompt-variable-token">{`{{${item.key}}}`}</code>
          <small>{item.description}</small>
        </button>
      ))}</div>
    </>
  );
}

function VariableAwareTextarea({
  value,
  onChange,
  className,
  placeholder,
  variables,
}: {
  value: string;
  onChange: (value: string) => void;
  className: string;
  placeholder?: string;
  variables: typeof promptTemplateVariableDefinitions;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);

  function syncSuggestState(nextValue: string, cursor: number | null) {
    const beforeCursor = nextValue.slice(0, cursor ?? nextValue.length);
    setSuggestOpen(beforeCursor.endsWith('//'));
  }

  function onVariableInsert(key: string) {
    const cursor = textareaRef.current?.selectionStart ?? value.length;
    const next = insertPromptVariable(value, key, cursor);
    onChange(next.value);
    setSuggestOpen(false);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(next.cursor, next.cursor);
    });
  }

  return (
    <div className="prompt-variable-editor">
      <textarea
        ref={textareaRef}
        className={className}
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
          syncSuggestState(event.target.value, event.target.selectionStart);
        }}
        onKeyUp={(event) => syncSuggestState(event.currentTarget.value, event.currentTarget.selectionStart)}
        onClick={(event) => syncSuggestState(event.currentTarget.value, event.currentTarget.selectionStart)}
      />
      {suggestOpen ? (
        <div className="prompt-variable-suggest">
          {variables.map((item) => (
            <button type="button" key={item.key} onMouseDown={(event) => event.preventDefault()} onClick={() => onVariableInsert(item.key)}>
              <span>{item.label}</span>
              <code>{`{{${item.key}}}`}</code>
              <small>英文变量 · {item.description}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DraftTemplatesPage({ api, state, applyState }: { api: StoryDreamApi; state: AppState; applyState: ApplyMutationResult }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingTemplate = editingId ? state.draftTemplates.find((template) => template.id === editingId) ?? null : null;
  const [draft, setDraft] = useState<DraftTemplate | null>(null);
  const [selectedLayer, setSelectedLayer] = useState<DraftCanvasLayer>('title');
  const [effectCatalog, setEffectCatalog] = useState<JianyingEffectCatalog>(fallbackEffectCatalog);
  const [cozeWorkflowSource, setCozeWorkflowSource] = useState('');
  const [cozeImportName, setCozeImportName] = useState('');
  const [cozeImportResult, setCozeImportResult] = useState<Extract<CozeWorkflowTemplateConversionResult, { ok: true }> | null>(null);
  const [cozeImportResults, setCozeImportResults] = useState<CozeWorkflowTemplateConversionResult[]>([]);
  const [cozeImportError, setCozeImportError] = useState('');
  const [cozeImportOpen, setCozeImportOpen] = useState(false);
  const draftTemplateAction = useAsyncAction();
  const draftDetailGeneration = useRef(0);

  useEffect(() => {
    // Rehydrate only when switching templates; state refreshes must not overwrite unsaved drag edits.
    const currentEditingTemplate = state.draftTemplates.find((template) => template.id === editingId) ?? null;
    setDraft(currentEditingTemplate ? cloneDraftTemplate(currentEditingTemplate) : null);
  }, [editingId]);

  useEffect(() => {
    let disposed = false;
    api
      .getJianyingEffectCatalog()
      .then((catalog) => {
        if (!disposed) setEffectCatalog(catalog);
      })
      .catch((error) => {
        if (!disposed) {
          setEffectCatalog(fallbackEffectCatalog);
          draftTemplateAction.reportError(error);
        }
      });
    return () => {
      disposed = true;
    };
  }, [api, draftTemplateAction.reportError]);

  useEffect(() => {
    if (!draft || isDraftLayerVisible(draft, selectedLayer)) return;
    setSelectedLayer(firstVisibleDraftLayer(draft));
  }, [draft, selectedLayer]);

  async function save() {
    if (!draft) return;
    await draftTemplateAction.run(async () => {
      applyState(await api.saveDraftTemplate(draft));
    });
  }

  async function copyTemplate(template: DraftTemplate) {
    await draftTemplateAction.run(async () => {
      const detail = await api.getDraftTemplateDetail(template.id) ?? template;
      const copy = { ...cloneDraftTemplate(detail), id: crypto.randomUUID(), name: `${detail.name} 副本`, isDefault: false };
      applyState(await api.saveDraftTemplate(copy));
      setEditingId(copy.id);
    });
  }

  async function createTemplate() {
    const base = cloneDraftTemplate(builtinDraftTemplates[0]);
    const next = { ...base, id: crypto.randomUUID(), name: '新模板', isDefault: false };
    await draftTemplateAction.run(async () => {
      applyState(await api.saveDraftTemplate(next));
      setEditingId(next.id);
    });
  }

  function previewCozeWorkflowTemplate() {
    const results = convertManyCozeWorkflowsToDraftTemplates(cozeWorkflowSource, { namePrefix: cozeImportName.trim() || undefined });
    const result = results[0] ?? convertCozeWorkflowToDraftTemplate(cozeWorkflowSource, { name: cozeImportName });
    setCozeImportResults(results);
    if (!result.ok || results.some((item) => !item.ok)) {
      setCozeImportResult(null);
      setCozeImportError(!result.ok ? result.error : '部分 Coze 工作流转换失败，请检查源码。');
      return;
    }
    setCozeImportResult(result);
    setCozeImportError('');
    if (!cozeImportName.trim()) setCozeImportName(result.template.name);
  }

  async function saveCozeWorkflowTemplate() {
    const result = convertCozeWorkflowToDraftTemplate(cozeWorkflowSource, { name: cozeImportName });
    if (!result.ok) {
      setCozeImportResult(null);
      setCozeImportError(result.error);
      return;
    }
    const template = cozeImportName.trim() ? { ...result.template, name: cozeImportName.trim() } : result.template;
    await draftTemplateAction.run(async () => {
      applyState(await api.saveDraftTemplate(template));
      setCozeImportResult({ ...result, template });
      setCozeImportError('');
      setEditingId(template.id);
    }, { onError: (error) => setCozeImportError(error.message) });
  }

  async function saveAllCozeWorkflowTemplates() {
    const results = convertManyCozeWorkflowsToDraftTemplates(cozeWorkflowSource, { namePrefix: cozeImportName.trim() || undefined });
    setCozeImportResults(results);
    const failures = results.filter((result) => !result.ok);
    if (failures.length) {
      setCozeImportResult(null);
      setCozeImportError(`${failures.length} 个 Coze 工作流转换失败。`);
      return;
    }
    await draftTemplateAction.run(async () => {
      let nextState: AppMutationResult | null = null;
      for (const result of results) {
        if (!result.ok) continue;
        nextState = await api.saveDraftTemplate(result.template);
      }
      applyState(nextState);
      const first = results.find((result): result is Extract<CozeWorkflowTemplateConversionResult, { ok: true }> => result.ok) ?? null;
      setCozeImportResult(first);
      setCozeImportError('');
      if (first) setEditingId(first.template.id);
    }, { onError: (error) => setCozeImportError(error.message) });
  }

  function openEditor(template: DraftTemplate) {
    const generation = ++draftDetailGeneration.current;
    setDraft(cloneDraftTemplate(template));
    setEditingId(template.id);
    void draftTemplateAction.run(async () => {
      const detail = await api.getDraftTemplateDetail(template.id);
      if (generation === draftDetailGeneration.current && detail) setDraft(cloneDraftTemplate(detail));
    });
  }

  async function selectDraftBackgroundImage() {
    await draftTemplateAction.run(async () => {
      const imagePath = await api.selectLocalImage();
      if (!imagePath) return;
      setDraft((current) => (current ? { ...current, canvas: { ...current.canvas, backgroundImage: imagePath } } : current));
    });
  }

  function updateDraftImage(patch: Partial<DraftTemplate['image']>) {
    setDraft((current) => (current ? { ...current, image: { ...current.image, ...patch } } : current));
  }

  function updateDraftTitle(patch: Partial<DraftTemplate['title']>) {
    setDraft((current) => (current ? { ...current, title: { ...current.title, ...patch } } : current));
  }

  function updateDraftSubtitle(patch: Partial<DraftTemplate['subtitle']>) {
    setDraft((current) => (current ? { ...current, subtitle: { ...current.subtitle, ...patch } } : current));
  }

  function updateDraftCaption(patch: Partial<DraftTemplate['caption']>) {
    setDraft((current) => (current ? { ...current, caption: { ...current.caption, ...patch } } : current));
  }

  function updateDraftCaptionBackground(patch: Partial<DraftTemplate['caption']['background']>) {
    setDraft((current) => (current ? { ...current, caption: { ...current.caption, background: { ...current.caption.background, ...patch } } } : current));
  }

  function updateDraftCaptionWidth(value: number) {
    updateDraftCaption({ width: clamp(value, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) });
  }

  function updateDraftDisclaimer(patch: Partial<DraftTemplate['disclaimer']>) {
    setDraft((current) => (current ? { ...current, disclaimer: { ...current.disclaimer, ...patch } } : current));
  }

  function updateDraftTitleBorder(patch: Partial<DraftTextBorder>) {
    setDraft((current) => (current ? { ...current, title: { ...current.title, border: { ...current.title.border, ...patch } } } : current));
  }

  function updateDraftSubtitleBorder(patch: Partial<DraftTextBorder>) {
    setDraft((current) => (current ? { ...current, subtitle: { ...current.subtitle, border: { ...current.subtitle.border, ...patch } } } : current));
  }

  function updateDraftCaptionBorder(patch: Partial<DraftTextBorder>) {
    setDraft((current) => (current ? { ...current, caption: { ...current.caption, border: { ...current.caption.border, ...patch } } } : current));
  }

  function updateDraftDisclaimerBorder(patch: Partial<DraftTextBorder>) {
    setDraft((current) => (current ? { ...current, disclaimer: { ...current.disclaimer, border: { ...current.disclaimer.border, ...patch } } } : current));
  }

  if (editingId && draft) {
    return (
      <div className="draft-template-page">
        <div className="editor-topbar">
          <button className="ghost-action" onClick={() => setEditingId(null)}>返回模板列表</button>
          <input className="template-name-input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          <div className="button-row">
            <button className="ghost-action" onClick={() => setDraft(editingTemplate ? cloneDraftTemplate(editingTemplate) : draft)}>取消</button>
            <button className="primary-action slim" onClick={save}><Save size={15} />保存</button>
          </div>
        </div>
        <InlineActionFeedback feedback={draftTemplateAction.feedback} />

        <div className="draft-editor-shell focused">
          <section className="draft-stage">
            <div className="panel-title-row">
              <div>
                <h2>{draft.name}</h2>
                <span className="hint-text">{draft.canvas.ratio} · {draft.canvas.width}x{draft.canvas.height} · {draft.image.animation}</span>
              </div>
              <button className="ghost-action" onClick={() => copyTemplate(draft)}><Copy size={15} />复制</button>
            </div>
            <EditableDraftCanvas template={draft} selectedLayer={selectedLayer} onSelectLayer={setSelectedLayer} onChange={setDraft} />
          </section>

          <section className="panel draft-controls">
            <Accordion title="画布设置" open>
              <Segmented label="比例" value={draft.canvas.ratio} options={['9:16', '4:3', '1:1', '16:9']} onChange={(value) => setDraft(applyDraftCanvasRatio(draft, value))} />
              <Field label="尺寸"><input value={`${draft.canvas.width}x${draft.canvas.height}`} readOnly /></Field>
              <Field label="底色">
                <div className="draft-background-field with-swatch">
                  <input className="draft-background-swatch" type="color" value={normalizeColorInput(draft.canvas.backgroundColor)} onChange={(event) => setDraft({ ...draft, canvas: { ...draft.canvas, backgroundColor: event.target.value } })} />
                  <input value={draft.canvas.backgroundColor} onChange={(event) => setDraft({ ...draft, canvas: { ...draft.canvas, backgroundColor: event.target.value } })} />
                </div>
              </Field>
              <Field label="背景图">
                <div className="draft-background-field">
                  <input value={draft.canvas.backgroundImage} onChange={(event) => setDraft({ ...draft, canvas: { ...draft.canvas, backgroundImage: event.target.value } })} placeholder="留空 = 无背景图" />
                  <button className="ghost-action" type="button" onClick={selectDraftBackgroundImage}><FolderOpen size={14} />浏览</button>
                  <button className="ghost-action" type="button" onClick={() => setDraft({ ...draft, canvas: { ...draft.canvas, backgroundImage: '' } })}>清空</button>
                </div>
              </Field>
            </Accordion>
            <Accordion title="图片区域" open>
              <ToggleField label="显示" checked={draft.image.visible} onChange={(checked) => updateDraftImage({ visible: checked })} />
              <Segmented label="图片比例" value={draft.image.ratio} options={['9:16', '4:3', '16:9']} onChange={(value) => setDraft(applyDraftImageRatio(draft, value))} />
              <Segmented label="适配" value={draft.image.fit} options={['cover', 'contain']} onChange={(value) => updateDraftImage({ fit: value as 'cover' | 'contain' })} />
              <Field label="坐标"><input value={`top ${draft.image.top.toFixed(2)}, height ${draft.image.height.toFixed(2)}`} readOnly /></Field>
              <RangeField label="垂直位置" min={-1} max={1} step={0.01} value={draft.image.top} onChange={(value) => updateDraftImage({ top: value })} />
              <RangeField label="高度占比" min={0.1} max={1} step={0.01} value={draft.image.height} onChange={(value) => updateDraftImage({ height: value })} />
              <Segmented label="动画效果" value={draft.image.animation} options={imageAnimations} onChange={(value) => updateDraftImage({ animation: value })} />
            </Accordion>
            <Accordion title="主标题">
              <ToggleField label="显示" checked={draft.title.visible} onChange={(checked) => updateDraftTitle({ visible: checked })} />
              <Field label="文字"><input value={draft.title.text} onChange={(event) => updateDraftTitle({ text: event.target.value })} /></Field>
              <Field label="坐标"><input value={`${draft.title.x.toFixed(2)}, ${draft.title.y.toFixed(2)}`} readOnly /></Field>
              <RangeField label="文本框宽度" min={DRAFT_TEXT_WIDTH_MIN} max={DRAFT_TEXT_WIDTH_MAX} step={0.01} value={draft.title.width} onChange={(value) => updateDraftTitle({ width: clamp(value, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) })} />
              <RangeField label="字号" min={12} max={120} step={1} value={draft.title.fontSize} onChange={(value) => updateDraftTitle({ fontSize: value })} />
              <ColorField label="颜色" value={draft.title.color} onChange={(value) => updateDraftTitle({ color: value })} />
              <RangeField label="透明度" min={0} max={1} step={0.05} value={draft.title.alpha} onChange={(value) => updateDraftTitle({ alpha: value })} />
              <ToggleField label="加粗" checked={draft.title.bold} onChange={(checked) => updateDraftTitle({ bold: checked })} />
              <ToggleField label="下划线" checked={draft.title.underline} onChange={(checked) => updateDraftTitle({ underline: checked })} />
              <Field label="对齐">
                <select value={String(draft.title.align)} onChange={(event) => updateDraftTitle({ align: Number(event.target.value) })}>
                  <option value="0">左对齐</option>
                  <option value="1">居中</option>
                  <option value="2">右对齐</option>
                </select>
              </Field>
              <RangeField label="字间距" min={0} max={20} step={1} value={draft.title.letterSpacing} onChange={(value) => updateDraftTitle({ letterSpacing: value })} />
              <RangeField label="行间距" min={0} max={20} step={1} value={draft.title.lineSpacing} onChange={(value) => updateDraftTitle({ lineSpacing: value })} />
              <TextBorderControls border={draft.title.border} onChange={updateDraftTitleBorder} />
            </Accordion>
            <Accordion title="副标题">
              <ToggleField label="显示" checked={draft.subtitle.visible} onChange={(checked) => updateDraftSubtitle({ visible: checked })} />
              <Field label="文字"><input value={draft.subtitle.text} onChange={(event) => updateDraftSubtitle({ text: event.target.value })} /></Field>
              <Field label="坐标"><input value={`${draft.subtitle.x.toFixed(2)}, ${draft.subtitle.y.toFixed(2)}`} readOnly /></Field>
              <RangeField label="文本框宽度" min={DRAFT_TEXT_WIDTH_MIN} max={DRAFT_TEXT_WIDTH_MAX} step={0.01} value={draft.subtitle.width} onChange={(value) => updateDraftSubtitle({ width: clamp(value, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) })} />
              <RangeField label="字号" min={10} max={72} step={1} value={draft.subtitle.fontSize} onChange={(value) => updateDraftSubtitle({ fontSize: value })} />
              <ColorField label="颜色" value={draft.subtitle.color} onChange={(value) => updateDraftSubtitle({ color: value })} />
              <RangeField label="透明度" min={0} max={1} step={0.05} value={draft.subtitle.alpha} onChange={(value) => updateDraftSubtitle({ alpha: value })} />
              <ToggleField label="加粗" checked={draft.subtitle.bold} onChange={(checked) => updateDraftSubtitle({ bold: checked })} />
              <ToggleField label="下划线" checked={draft.subtitle.underline} onChange={(checked) => updateDraftSubtitle({ underline: checked })} />
              <Field label="对齐">
                <select value={String(draft.subtitle.align)} onChange={(event) => updateDraftSubtitle({ align: Number(event.target.value) })}>
                  <option value="0">左对齐</option>
                  <option value="1">居中</option>
                  <option value="2">右对齐</option>
                </select>
              </Field>
              <RangeField label="字间距" min={0} max={20} step={1} value={draft.subtitle.letterSpacing} onChange={(value) => updateDraftSubtitle({ letterSpacing: value })} />
              <RangeField label="行间距" min={0} max={20} step={1} value={draft.subtitle.lineSpacing} onChange={(value) => updateDraftSubtitle({ lineSpacing: value })} />
              <TextBorderControls border={draft.subtitle.border} onChange={updateDraftSubtitleBorder} />
            </Accordion>
            <Accordion title="字幕">
              <ToggleField label="显示" checked={draft.caption.visible} onChange={(checked) => updateDraftCaption({ visible: checked })} />
              <Field label="坐标"><input value={`${draft.caption.x.toFixed(2)}, ${draft.caption.y.toFixed(2)}`} readOnly /></Field>
              <RangeField label="文本框宽度" min={DRAFT_TEXT_WIDTH_MIN} max={DRAFT_TEXT_WIDTH_MAX} step={0.01} value={draft.caption.width} onChange={updateDraftCaptionWidth} />
              <RangeField label="字号" min={8} max={48} step={1} value={draft.caption.fontSize} onChange={(value) => updateDraftCaption({ fontSize: value })} />
              <ColorField label="颜色" value={draft.caption.color} onChange={(value) => updateDraftCaption({ color: value })} />
              <RangeField label="透明度" min={0} max={1} step={0.05} value={draft.caption.alpha} onChange={(value) => updateDraftCaption({ alpha: value })} />
              <ToggleField label="加粗" checked={draft.caption.bold} onChange={(checked) => updateDraftCaption({ bold: checked })} />
              <ToggleField label="下划线" checked={draft.caption.underline} onChange={(checked) => updateDraftCaption({ underline: checked })} />
              <Field label="对齐">
                <select value={String(draft.caption.align)} onChange={(event) => updateDraftCaption({ align: Number(event.target.value) })}>
                  <option value="0">左对齐</option>
                  <option value="1">居中</option>
                  <option value="2">右对齐</option>
                </select>
              </Field>
              <RangeField label="字间距" min={0} max={20} step={1} value={draft.caption.letterSpacing} onChange={(value) => updateDraftCaption({ letterSpacing: value })} />
              <RangeField label="行间距" min={0} max={20} step={1} value={draft.caption.lineSpacing} onChange={(value) => updateDraftCaption({ lineSpacing: value })} />
              <RangeField label="每行字数" min={4} max={80} step={1} value={draft.caption.maxCharsPerLine} onChange={(value) => updateDraftCaption({ maxCharsPerLine: value })} />
              <ColorField label="背景色" value={draft.caption.background.color} onChange={(value) => updateDraftCaptionBackground({ color: value })} />
              <RangeField label="背景透明度" min={0} max={1} step={0.05} value={draft.caption.background.alpha} onChange={(value) => updateDraftCaptionBackground({ alpha: value })} />
              <RangeField label="圆角" min={0} max={1} step={0.05} value={draft.caption.background.roundRadius} onChange={(value) => updateDraftCaptionBackground({ roundRadius: value })} />
              <TextBorderControls border={draft.caption.border} onChange={updateDraftCaptionBorder} />
            </Accordion>
            <Accordion title="免责声明">
              <ToggleField label="显示" checked={draft.disclaimer.visible} onChange={(checked) => updateDraftDisclaimer({ visible: checked })} />
              <Field label="坐标"><input value={`${draft.disclaimer.x.toFixed(2)}, ${draft.disclaimer.y.toFixed(2)}`} readOnly /></Field>
              <Field label="文字"><input value={draft.disclaimer.text} onChange={(event) => updateDraftDisclaimer({ text: event.target.value })} /></Field>
              <RangeField label="文本框宽度" min={DRAFT_TEXT_WIDTH_MIN} max={DRAFT_TEXT_WIDTH_MAX} step={0.01} value={draft.disclaimer.width} onChange={(value) => updateDraftDisclaimer({ width: clamp(value, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) })} />
              <RangeField label="字号" min={8} max={40} step={1} value={draft.disclaimer.fontSize} onChange={(value) => updateDraftDisclaimer({ fontSize: value })} />
              <ColorField label="颜色" value={draft.disclaimer.color} onChange={(value) => updateDraftDisclaimer({ color: value })} />
              <RangeField label="透明度" min={0} max={1} step={0.05} value={draft.disclaimer.alpha} onChange={(value) => updateDraftDisclaimer({ alpha: value })} />
              <ToggleField label="加粗" checked={draft.disclaimer.bold} onChange={(checked) => updateDraftDisclaimer({ bold: checked })} />
              <ToggleField label="下划线" checked={draft.disclaimer.underline} onChange={(checked) => updateDraftDisclaimer({ underline: checked })} />
              <Field label="对齐">
                <select value={String(draft.disclaimer.align)} onChange={(event) => updateDraftDisclaimer({ align: Number(event.target.value) })}>
                  <option value="0">左对齐</option>
                  <option value="1">居中</option>
                  <option value="2">右对齐</option>
                </select>
              </Field>
              <RangeField label="字间距" min={0} max={20} step={1} value={draft.disclaimer.letterSpacing} onChange={(value) => updateDraftDisclaimer({ letterSpacing: value })} />
              <RangeField label="行间距" min={0} max={20} step={1} value={draft.disclaimer.lineSpacing} onChange={(value) => updateDraftDisclaimer({ lineSpacing: value })} />
              <TextBorderControls border={draft.disclaimer.border} onChange={updateDraftDisclaimerBorder} />
            </Accordion>
            <Accordion title="音频设置">
              <Field label="旁白音量"><input type="number" value={draft.audio.narrationVolume} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, narrationVolume: Number(event.target.value) } })} /></Field>
              <Field label="BGM 音量"><input type="number" value={draft.audio.bgmVolume} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, bgmVolume: Number(event.target.value) } })} /></Field>
              <Field label="转场">
                <select value={draft.audio.transitionType} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, transitionType: event.target.value } })}>
                  <option value="">关闭</option>
                  {effectCatalog.transitions.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </Field>
              <Field label="转场时长(ms)"><input type="number" value={draft.audio.transitionDurationMs} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, transitionDurationMs: Number(event.target.value) } })} /></Field>
              <Field label="旁白淡入(ms)"><input type="number" value={draft.audio.narrationFadeInMs} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, narrationFadeInMs: Number(event.target.value) } })} /></Field>
              <Field label="旁白淡出(ms)"><input type="number" value={draft.audio.narrationFadeOutMs} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, narrationFadeOutMs: Number(event.target.value) } })} /></Field>
              <Field label="BGM 淡入(ms)"><input type="number" value={draft.audio.bgmFadeInMs} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, bgmFadeInMs: Number(event.target.value) } })} /></Field>
              <Field label="BGM 淡出(ms)"><input type="number" value={draft.audio.bgmFadeOutMs} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, bgmFadeOutMs: Number(event.target.value) } })} /></Field>
              <Field label="滤镜">
                <select value={draft.audio.filterType} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, filterType: event.target.value } })}>
                  <option value="">关闭</option>
                  {effectCatalog.filters.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </Field>
              <Field label="视频特效">
                <select value={draft.audio.videoEffectType} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, videoEffectType: event.target.value } })}>
                  <option value="">关闭</option>
                  {effectCatalog.videoEffects.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </Field>
              <Field label="音频特效">
                <select value={draft.audio.audioEffectType} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, audioEffectType: event.target.value } })}>
                  <option value="">关闭</option>
                  {effectCatalog.audioEffects.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </Field>
            </Accordion>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="draft-template-page">
      <div className="panel-title-row draft-template-toolbar">
        <div>
          <h2>草稿模板</h2>
          <span className="hint-text">内置模板：默认竖屏、竖屏4:3、横屏16:9；自定义模板保存在本机。</span>
        </div>
        <div className="button-row">
          <button className="ghost-action" type="button" onClick={() => setCozeImportOpen(true)}><Upload size={15} />导入 Coze 模板</button>
          <button className="primary-action slim" onClick={createTemplate}><Plus size={15} />新模板</button>
        </div>
      </div>
      <InlineActionFeedback feedback={draftTemplateAction.feedback} />

      {cozeImportOpen ? (
        <div className="coze-template-import-backdrop" onClick={() => setCozeImportOpen(false)}>
          <section className="panel coze-template-import-panel coze-template-import-dialog" role="dialog" aria-modal="true" aria-label="导入 Coze 模板" onClick={(event) => event.stopPropagation()}>
            <div className="panel-title-row">
              <div>
                <h3>导入 Coze 模板</h3>
                <span className="hint-text">粘贴每个视频下复制出的 Coze 工作流源码，转换成可编辑的草稿模板预设。</span>
              </div>
              <div className="button-row">
                <button className="ghost-action" type="button" onClick={previewCozeWorkflowTemplate}>预览转换</button>
                <button className="primary-action slim" type="button" disabled={!cozeWorkflowSource.trim()} onClick={saveCozeWorkflowTemplate}><Upload size={15} />导入 Coze 模板</button>
                <button className="ghost-action" type="button" disabled={!cozeWorkflowSource.trim()} onClick={saveAllCozeWorkflowTemplates}>全部导入</button>
                <button className="mini-button" type="button" onClick={() => setCozeImportOpen(false)}>关闭</button>
              </div>
            </div>
            <div className="coze-template-import-grid">
              <Field label="模板名称">
                <input value={cozeImportName} onChange={(event) => setCozeImportName(event.target.value)} placeholder="留空则使用 Coze workflowId" />
              </Field>
              <Field label="Coze 工作流源码">
                <textarea className="small-textarea coze-workflow-source" value={cozeWorkflowSource} onChange={(event) => setCozeWorkflowSource(event.target.value)} placeholder='粘贴 {"type":"coze-workflow-clipboard-data", ...}' />
              </Field>
            </div>
            {cozeImportError ? <p className="form-error">{cozeImportError}</p> : null}
            {cozeImportResults.length > 1 ? <span className="hint-text">已识别 {cozeImportResults.length} 个 Coze 工作流源码。</span> : null}
            {cozeImportResult ? (
              <div className="coze-import-preview">
                <strong>{cozeImportResult.template.name}</strong>
                <span>{cozeImportResult.workflowId} · {cozeImportResult.template.canvas.ratio} · {cozeImportResult.template.canvas.width}x{cozeImportResult.template.canvas.height}</span>
                <div>
                  <small>转换诊断</small>
                  <ul className="coze-diagnostics-list">
                    {cozeImportResult.diagnostics.slice(0, 8).map((diagnostic, index) => (
                      <li key={`${diagnostic.code}-${diagnostic.nodeId ?? index}`}>
                        <span>{diagnostic.level}</span>
                        {diagnostic.message}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      <section className="draft-template-gallery">
        {state.draftTemplates.map((template) => (
          <article key={template.id} className="draft-template-card">
            <button className="draft-template-thumb" onClick={() => openEditor(template)} type="button" aria-label={`编辑 ${template.name}`}>
              <DraftTemplatePreview template={template} compact />
            </button>
            <div className="draft-template-meta">
              <div>
                <strong>{template.name}</strong>
                {template.isDefault ? <small>系统默认</small> : <small>本地自定义</small>}
              </div>
              <span>{template.canvas.ratio} · {template.canvas.width}x{template.canvas.height}</span>
              <span>图片 {template.image.ratio} · {template.image.fit} · {template.image.animation}</span>
            </div>
            <div className="row-actions">
              <button className="ghost-action" onClick={() => openEditor(template)}><LayoutTemplate size={15} />编辑</button>
              <button className="ghost-action" onClick={() => copyTemplate(template)}><Copy size={15} />复制</button>
            </div>
          </article>
        ))}
        <button className="draft-template-card new-template-card" onClick={createTemplate} type="button">
          <Plus size={24} />
          <strong>新模板</strong>
          <span>从默认竖屏复制一份本地配置</span>
        </button>
      </section>
    </div>
  );
}
function DraftTemplatePreview({ template, compact = false }: { template: DraftTemplate; compact?: boolean }) {
  const titleSize = compact ? Math.max(9, template.title.fontSize * 0.28) : template.title.fontSize;
  const subtitleSize = compact ? Math.max(7, template.subtitle.fontSize * 0.28) : template.subtitle.fontSize;
  const captionSize = compact ? Math.max(7, template.caption.fontSize * 0.42) : template.caption.fontSize;
  const disclaimerSize = compact ? Math.max(6, template.disclaimer.fontSize * 0.42) : template.disclaimer.fontSize;
  return (
    <div className={compact ? 'draft-preview-mini' : 'draft-preview-large'} style={draftTemplateCanvasStyle(template)}>
      {template.image.visible ? (
        <div className="draft-image" style={{ top: `${template.image.top * 100}%`, height: `${template.image.height * 100}%` }}>
          <div className="draft-image-media" style={draftImageMediaStyle(template)} />
        </div>
      ) : null}
      {template.title.visible ? (
        <DraftCanvasText
          className="draft-title"
          x={template.title.x}
          y={template.title.y}
          width={template.title.width}
          border={template.title.border}
          style={draftTextLayerStyle(template.title, titleSize, template.title.bold ? 800 : 500)}
        >
          {template.title.text}
        </DraftCanvasText>
      ) : null}
      {template.subtitle.visible ? (
        <DraftCanvasText
          className="draft-subtitle"
          x={template.subtitle.x}
          y={template.subtitle.y}
          width={template.subtitle.width}
          border={template.subtitle.border}
          style={draftTextLayerStyle(template.subtitle, subtitleSize, template.subtitle.bold ? 800 : 500)}
        >
          {template.subtitle.text}
        </DraftCanvasText>
      ) : null}
      {template.caption.visible ? (
        <DraftCanvasText
          className="draft-caption"
          x={template.caption.x}
          y={template.caption.y}
          width={template.caption.width}
          border={template.caption.border}
          style={{
            color: template.caption.color,
            fontSize: captionSize,
            opacity: template.caption.alpha,
            fontWeight: template.caption.bold ? 700 : 500,
            textDecoration: template.caption.underline ? 'underline' : 'none',
            textAlign: draftTextAlign(template.caption.align),
            letterSpacing: `${template.caption.letterSpacing}px`,
            lineHeight: `${1 + template.caption.lineSpacing / 10}`,
            backgroundColor: colorWithAlpha(template.caption.background.color, template.caption.background.alpha),
            borderRadius: `${template.caption.background.roundRadius * 24}px`,
            padding: compact ? '2px 8px' : '4px 10px',
          }}
        >
          字幕预览
        </DraftCanvasText>
      ) : null}
      {template.disclaimer.visible ? (
        <DraftCanvasText
          className="draft-disclaimer"
          x={template.disclaimer.x}
          y={template.disclaimer.y}
          width={template.disclaimer.width}
          border={template.disclaimer.border}
          style={draftTextLayerStyle(template.disclaimer, disclaimerSize, template.disclaimer.bold ? 700 : 500)}
        >
          {template.disclaimer.text}
        </DraftCanvasText>
      ) : null}
    </div>
  );
}

function EditableDraftCanvas({
  template,
  selectedLayer,
  onSelectLayer,
  onChange,
}: {
  template: DraftTemplate;
  selectedLayer: DraftCanvasLayer;
  onSelectLayer: (layer: DraftCanvasLayer) => void;
  onChange: (template: DraftTemplate) => void;
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DraftDragSnapshot | null>(null);

  function handleDraftCanvasPointerDown(layer: DraftCanvasLayer, event: React.PointerEvent<HTMLDivElement>) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelectLayer(layer);
    dragRef.current = {
      mode: 'move',
      layer,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      template: cloneDraftTemplate(template),
    } as DraftDragSnapshot;
  }

  function handleDraftCanvasResizePointerDown(layer: Exclude<DraftCanvasLayer, 'image'>, event: React.PointerEvent<HTMLElement>) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelectLayer(layer);
    dragRef.current = {
      mode: 'resize',
      layer,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      template: cloneDraftTemplate(template),
    };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!drag || !rect || drag.pointerId !== event.pointerId) return;
    const deltaX = ((event.clientX - drag.startX) / rect.width) * 2;
    const deltaY = ((event.clientY - drag.startY) / rect.height) * 2;
    onChange(drag.mode === 'resize' ? resizeDraftLayerWidth(drag.template, drag.layer, deltaX) : updateDraftLayerPosition(drag.template, drag.layer, deltaX, deltaY));
  }

  function stopDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }

  return (
    <div
      ref={canvasRef}
      className="editable-draft-canvas draft-preview-large"
      style={draftTemplateCanvasStyle(template)}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
    >
      {template.image.visible ? (
        <div
          className={selectedLayer === 'image' ? 'draft-layer image-layer selected' : 'draft-layer image-layer'}
          data-layer="image"
          style={{ top: `${template.image.top * 100}%`, height: `${template.image.height * 100}%` }}
          onPointerDown={(event) => handleDraftCanvasPointerDown('image', event)}
        >
          <div className="draft-image-media" style={draftImageMediaStyle(template)} />
          <span>图片区域</span>
          <i className="draft-layer-handle" />
        </div>
      ) : null}
      {template.title.visible ? (
        <DraftCanvasLayerBox layer="title" label="主标题" selected={selectedLayer === 'title'} x={template.title.x} y={template.title.y} width={template.title.width} onPointerDown={handleDraftCanvasPointerDown} onResizePointerDown={handleDraftCanvasResizePointerDown}>
          <DraftCanvasText
            className="draft-title"
            x={0}
            y={0}
            width={1}
            border={template.title.border}
            positioned={false}
            style={draftTextLayerStyle(template.title, template.title.fontSize, template.title.bold ? 800 : 500)}
          >
            {template.title.text}
          </DraftCanvasText>
        </DraftCanvasLayerBox>
      ) : null}
      {template.subtitle.visible ? (
        <DraftCanvasLayerBox layer="subtitle" label="副标题" selected={selectedLayer === 'subtitle'} x={template.subtitle.x} y={template.subtitle.y} width={template.subtitle.width} onPointerDown={handleDraftCanvasPointerDown} onResizePointerDown={handleDraftCanvasResizePointerDown}>
          <DraftCanvasText
            className="draft-subtitle"
            x={0}
            y={0}
            width={1}
            border={template.subtitle.border}
            positioned={false}
            style={draftTextLayerStyle(template.subtitle, template.subtitle.fontSize, template.subtitle.bold ? 800 : 500)}
          >
            {template.subtitle.text}
          </DraftCanvasText>
        </DraftCanvasLayerBox>
      ) : null}
      {template.caption.visible ? (
        <DraftCanvasLayerBox layer="caption" label="字幕" selected={selectedLayer === 'caption'} x={template.caption.x} y={template.caption.y} width={template.caption.width} onPointerDown={handleDraftCanvasPointerDown} onResizePointerDown={handleDraftCanvasResizePointerDown}>
          <DraftCanvasText
            className="draft-caption"
            x={0}
            y={0}
            width={1}
            border={template.caption.border}
            positioned={false}
            style={{
              color: template.caption.color,
              fontSize: template.caption.fontSize,
              opacity: template.caption.alpha,
              fontWeight: template.caption.bold ? 700 : 500,
              textDecoration: template.caption.underline ? 'underline' : 'none',
              textAlign: draftTextAlign(template.caption.align),
              letterSpacing: `${template.caption.letterSpacing}px`,
              lineHeight: `${1 + template.caption.lineSpacing / 10}`,
              backgroundColor: colorWithAlpha(template.caption.background.color, template.caption.background.alpha),
              borderRadius: `${template.caption.background.roundRadius * 24}px`,
              padding: '4px 10px',
            }}
          >
            字幕预览
          </DraftCanvasText>
        </DraftCanvasLayerBox>
      ) : null}
      {template.disclaimer.visible ? (
        <DraftCanvasLayerBox layer="disclaimer" label="免责声明" selected={selectedLayer === 'disclaimer'} x={template.disclaimer.x} y={template.disclaimer.y} width={template.disclaimer.width} onPointerDown={handleDraftCanvasPointerDown} onResizePointerDown={handleDraftCanvasResizePointerDown}>
          <DraftCanvasText
            className="draft-disclaimer"
            x={0}
            y={0}
            width={1}
            border={template.disclaimer.border}
            positioned={false}
            style={draftTextLayerStyle(template.disclaimer, template.disclaimer.fontSize, template.disclaimer.bold ? 700 : 500)}
          >
            {template.disclaimer.text}
          </DraftCanvasText>
        </DraftCanvasLayerBox>
      ) : null}
    </div>
  );
}

function DraftCanvasLayerBox({
  layer,
  label,
  selected,
  x,
  y,
  width,
  onPointerDown,
  onResizePointerDown,
  children,
}: {
  layer: Exclude<DraftCanvasLayer, 'image'>;
  label: string;
  selected: boolean;
  x: number;
  y: number;
  width: number;
  onPointerDown: (layer: DraftCanvasLayer, event: React.PointerEvent<HTMLDivElement>) => void;
  onResizePointerDown: (layer: Exclude<DraftCanvasLayer, 'image'>, event: React.PointerEvent<HTMLElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={selected ? 'draft-layer text-layer selected' : 'draft-layer text-layer'}
      data-layer={layer}
      style={{ ...draftLayerPositionStyle(x, y), ...draftTextWidthStyle(width) }}
      onPointerDown={(event) => onPointerDown(layer, event)}
    >
      <span>{label}</span>
      {children}
      <i className="draft-layer-handle" onPointerDown={(event) => onResizePointerDown(layer, event)} />
    </div>
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

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Field label={label}>
      <div className="draft-color-field">
        <input type="color" value={normalizeColorInput(value)} onChange={(event) => onChange(event.target.value)} />
        <input value={value} onChange={(event) => onChange(event.target.value)} />
      </div>
    </Field>
  );
}

function TextBorderControls({
  label,
  border,
  onChange,
}: {
  label?: string;
  border: DraftTextBorder;
  onChange: (patch: Partial<DraftTextBorder>) => void;
}) {
  return (
    <div className="draft-border-controls">
      {label ? <span className="field-title">{label}</span> : null}
      <div className="draft-inline-border-grid">
        <ColorField label="描边颜色" value={border.color} onChange={(value) => onChange({ color: value })} />
        <RangeField label="描边宽度" min={0} max={60} step={1} value={border.width} onChange={(value) => onChange({ width: value })} />
        <RangeField label="描边透明度" min={0} max={1} step={0.05} value={border.alpha} onChange={(value) => onChange({ alpha: value })} />
      </div>
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

function independentPromptTemplateFields(template: PromptTemplate): PromptTemplate {
  const copy = { ...template };
  delete copy.baseTemplateId;
  return copy;
}

function promptTemplateHasStepPrompt(template: PromptTemplate, type: PromptStepTemplateType): boolean {
  return Object.prototype.hasOwnProperty.call(template.stepPrompts ?? {}, type);
}

function promptTemplateStepPromptValue(template: PromptTemplate, templates: PromptTemplate[], type: PromptStepTemplateType): string {
  if (promptTemplateHasStepPrompt(template, type)) return template.stepPrompts?.[type] ?? '';
  return selectStepPromptTemplate(templates, type)?.content ?? '';
}

function promptTemplateTypeLabel(type: PromptTemplateType | 'all'): string {
  return promptTemplateTypeLabels[type];
}

function promptTemplateStyleOptions(styles: CustomStyle[], template: PromptTemplate): CustomStyle[] {
  const byId = new Map([...defaultCustomStyles, ...styles].map((style) => [style.id, style]));
  resolvePromptTemplateDefaultStyleIds(template, styles.map((style) => style.id)).forEach((id) => {
    if (!byId.has(id)) {
      const option = styleOptions.find(([styleId]) => styleId === id);
      if (option) {
        byId.set(id, {
          id,
          name: option[1],
          tag: option[2],
          shortName: option[1],
          prefix: option[1],
          suffix: option[2],
          negativePrompt: '',
          allowColor: id !== 'black-white',
          description: option[2],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }
  });
  return [...byId.values()];
}

function promptTemplateStyleLabelList(template: PromptTemplate, styles: CustomStyle[]): string[] {
  const styleNames = new Map([...defaultCustomStyles, ...styles].map((style) => [style.id, style.name]));
  return resolvePromptTemplateDefaultStyleIds(template, styles.map((style) => style.id)).map((id) => styleNames.get(id) ?? styleLabel(id, styles));
}

function styleLabel(id: string, styles: CustomStyle[] = defaultCustomStyles): string {
  return [...defaultCustomStyles, ...styles].find((style) => style.id === id)?.name ?? styleOptions.find(([styleId]) => styleId === id)?.[1] ?? id;
}

function buildImageStyleDraftFromPrompt(prompt: string, base: CustomStyle): Pick<CustomStyle, 'name' | 'tag' | 'shortName' | 'prefix' | 'suffix' | 'negativePrompt' | 'allowColor' | 'description'> {
  const normalized = prompt.trim() || base.name;
  const tags = splitListInput(normalized).slice(0, 4);
  const name = tags[0] || normalized.slice(0, 12) || base.name;
  return {
    name,
    tag: tags.length ? tags.join('、') : base.tag,
    shortName: name.slice(0, 4),
    prefix: [normalized, base.prefix].filter(Boolean).join('，'),
    suffix: base.suffix || '高质量，清晰细节，电影级构图',
    negativePrompt: base.negativePrompt || '模糊，噪点，过曝，低质量，水印，文字',
    allowColor: !/黑白|单色|mono/i.test(normalized) && base.allowColor,
    description: `适合${normalized}题材。`,
  };
}

function splitListInput(value: string): string[] {
  return value
    .split(/[,，、\n]/u)
    .map((item) => item.trim())
    .filter(Boolean);
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

function DraftCanvasText({
  className,
  x,
  y,
  width,
  border,
  positioned = true,
  style,
  children,
}: {
  className: string;
  x: number;
  y: number;
  width: number;
  border?: DraftTextBorder;
  positioned?: boolean;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const positionStyle = positioned ? draftLayerPositionStyle(x, y) : {};
  return (
    <div className={className} style={{ ...positionStyle, ...draftTextWidthStyle(width), ...draftTextStrokeStyle(border), ...style }}>
      {children}
    </div>
  );
}

function applyDraftCanvasRatio(template: DraftTemplate, ratio: string): DraftTemplate {
  const canvas = draftCanvasSizeForRatio(ratio);
  return applyDraftImageRatio({ ...template, canvas: { ...template.canvas, ...canvas, ratio } }, template.image.ratio);
}

function draftCanvasSizeForRatio(ratio: string): Pick<DraftTemplate['canvas'], 'width' | 'height'> {
  if (ratio === '16:9') return { width: 1920, height: 1080 };
  if (ratio === '4:3') return { width: 1440, height: 1080 };
  if (ratio === '1:1') return { width: 1080, height: 1080 };
  return { width: 1080, height: 1920 };
}

function applyDraftImageRatio(template: DraftTemplate, ratio: string): DraftTemplate {
  const height = clamp(draftImageHeightForCanvas(template.canvas, ratio), 0.1, 1);
  return {
    ...template,
    image: {
      ...template.image,
      ratio,
      height,
      top: clamp((1 - height) / 2, -0.2, 1 - Math.min(0.1, height)),
    },
  };
}

function draftImageHeightForCanvas(canvas: DraftTemplate['canvas'], imageRatio: string): number {
  const ratio = ratioToNumber(imageRatio);
  if (!ratio) return 1;
  return (canvas.width / ratio) / canvas.height;
}

function draftTemplateCanvasStyle(template: DraftTemplate): React.CSSProperties {
  const backgroundImage = template.canvas.backgroundImage.trim();
  const ratio = ratioToNumber(template.canvas.ratio) || template.canvas.width / template.canvas.height;
  const style: React.CSSProperties & Record<string, string | number | undefined> = {
    '--draft-preview-width': `${draftPreviewWidth(template)}px`,
    '--draft-canvas-ratio': ratio,
    aspectRatio: `${template.canvas.width} / ${template.canvas.height}`,
    backgroundColor: template.canvas.backgroundColor,
    backgroundImage: backgroundImage ? `url("${toLocalImageUrl(backgroundImage).replace(/"/g, '\\"')}")` : undefined,
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    backgroundSize: 'cover',
  };
  return style;
}

function draftPreviewWidth(template: DraftTemplate): number {
  const ratio = ratioToNumber(template.canvas.ratio) || template.canvas.width / template.canvas.height;
  if (ratio >= 1.5) return 640;
  if (ratio >= 1.2) return 560;
  if (ratio >= 0.95) return 520;
  return Math.max(300, Math.round(ratio * 560));
}

function draftImageMediaStyle(template: DraftTemplate): React.CSSProperties {
  const aspectRatio = draftImageAspectRatio(template.image.ratio);
  if (template.image.fit === 'contain') {
    return {
      aspectRatio,
      height: 'auto',
      maxHeight: '100%',
      maxWidth: '100%',
      width: '100%',
    };
  }
  return {
    aspectRatio,
    height: '100%',
    width: '100%',
  };
}

function draftImageAspectRatio(ratio: string): string {
  const parts = ratio.split(':').map((item) => Number(item));
  if (parts.length === 2 && parts.every((item) => Number.isFinite(item) && item > 0)) {
    return `${parts[0]} / ${parts[1]}`;
  }
  return '9 / 16';
}

function ratioToNumber(ratio: string): number {
  const [width, height] = ratio.split(':').map((item) => Number(item));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 0;
  return width / height;
}

function normalizeColorInput(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : '#000000';
}

function colorWithAlpha(color: string, alpha: number): string {
  const normalized = normalizeColorInput(color).slice(1);
  const channel = (offset: number) => Number.parseInt(normalized.slice(offset, offset + 2), 16);
  const opacity = clamp(alpha, 0, 1);
  return `rgba(${channel(0)}, ${channel(2)}, ${channel(4)}, ${opacity})`;
}

function draftTextStrokeStyle(border?: DraftTextBorder): React.CSSProperties {
  if (!border || border.width <= 0 || border.alpha <= 0) return {};
  const color = colorWithAlpha(border.color, border.alpha);
  const previewStrokeWidth = Math.min(3, Math.max(1, Math.round(border.width / 16)));
  return {
    WebkitTextStroke: `${previewStrokeWidth}px ${color}`,
    paintOrder: 'stroke fill',
    textShadow: `0 1px 2px ${colorWithAlpha(border.color, Math.min(border.alpha, 0.55))}`,
  };
}

function draftTextBorderStyle(border?: DraftTextBorder): React.CSSProperties {
  return draftTextStrokeStyle(border);
}

function draftTextLayerStyle(
  text: Pick<DraftTemplate['title'], 'color' | 'alpha' | 'underline' | 'align' | 'letterSpacing' | 'lineSpacing'>,
  fontSize: number,
  fontWeight: React.CSSProperties['fontWeight'],
): React.CSSProperties {
  return {
    color: text.color,
    fontSize,
    opacity: text.alpha,
    fontWeight,
    textDecoration: text.underline ? 'underline' : 'none',
    textAlign: draftTextAlign(text.align),
    letterSpacing: `${text.letterSpacing}px`,
    lineHeight: `${1 + text.lineSpacing / 10}`,
  };
}

function draftTextWidthStyle(width: number): React.CSSProperties {
  return {
    width: `${clamp(width, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) * 100}%`,
  };
}

function draftTextAlign(align: number): React.CSSProperties['textAlign'] {
  if (align <= 0) return 'left';
  if (align >= 2) return 'right';
  return 'center';
}

function isDraftLayerVisible(template: DraftTemplate, layer: DraftCanvasLayer): boolean {
  if (layer === 'image') return template.image.visible;
  if (layer === 'title') return template.title.visible;
  if (layer === 'subtitle') return template.subtitle.visible;
  if (layer === 'caption') return template.caption.visible;
  return template.disclaimer.visible;
}

function firstVisibleDraftLayer(template: DraftTemplate): DraftCanvasLayer {
  return (['image', 'title', 'subtitle', 'caption', 'disclaimer'] as DraftCanvasLayer[]).find((layer) => isDraftLayerVisible(template, layer)) ?? 'title';
}

function updateDraftLayerPosition(template: DraftTemplate, layer: DraftCanvasLayer, deltaX: number, deltaY: number): DraftTemplate {
  if (layer === 'image') {
    return {
      ...template,
      image: {
        ...template.image,
        top: clamp(template.image.top + deltaY / 2, -0.2, 1 - Math.min(0.1, template.image.height)),
      },
    };
  }
  if (layer === 'title') {
    return { ...template, title: { ...template.title, x: clamp(template.title.x + deltaX, -0.9, 0.9), y: clamp(template.title.y + deltaY, -0.9, 0.9) } };
  }
  if (layer === 'subtitle') {
    return { ...template, subtitle: { ...template.subtitle, x: clamp(template.subtitle.x + deltaX, -0.9, 0.9), y: clamp(template.subtitle.y + deltaY, -0.9, 0.9) } };
  }
  if (layer === 'caption') {
    return { ...template, caption: { ...template.caption, x: clamp(template.caption.x + deltaX, -0.9, 0.9), y: clamp(template.caption.y + deltaY, -0.9, 0.9) } };
  }
  return { ...template, disclaimer: { ...template.disclaimer, x: clamp(template.disclaimer.x + deltaX, -0.9, 0.9), y: clamp(template.disclaimer.y + deltaY, -0.95, 0.95) } };
}

function resizeDraftLayerWidth(template: DraftTemplate, layer: Exclude<DraftCanvasLayer, 'image'>, deltaX: number): DraftTemplate {
  if (layer === 'title') return { ...template, title: { ...template.title, width: clamp(template.title.width + deltaX, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) } };
  if (layer === 'subtitle') return { ...template, subtitle: { ...template.subtitle, width: clamp(template.subtitle.width + deltaX, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) } };
  if (layer === 'caption') return { ...template, caption: { ...template.caption, width: clamp(template.caption.width + deltaX, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) } };
  return { ...template, disclaimer: { ...template.disclaimer, width: clamp(template.disclaimer.width + deltaX, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) } };
}

function draftLayerPositionStyle(x: number, y: number): React.CSSProperties {
  return {
    left: `${((x + 1) / 2) * 100}%`,
    top: `${((y + 1) / 2) * 100}%`,
    transform: 'translate(-50%, -50%)',
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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


function toLocalImageUrl(path: string): string {
  if (/^(https?:|file:|data:|blob:)/i.test(path)) return path;
  const normalized = path.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(normalized)) return `file:///${encodeURI(normalized)}`;
  if (normalized.startsWith('/')) return `file://${encodeURI(normalized)}`;
  return encodeURI(normalized);
}

function toLocalAssetUrl(path: string): string {
  return toLocalImageUrl(path);
}

function formatMs(value: number): string {
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}


function cloneDraftTemplate(template: DraftTemplate): DraftTemplate {
  return JSON.parse(JSON.stringify(template)) as DraftTemplate;
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
