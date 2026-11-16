import { updateMotionComicMakeShot, toggleMotionComicMakeAsset } from './motion-comic-make-edits';
import './motion-comic-project-controls.css';
import { startRecordedVideoRequest } from './motion-comic-video-background';
import { ProjectModelFields, ProjectModelBar, useProjectModelConfig } from '../projects/ProjectModelFields';
import { defaultProjectModels, readProjectModelsDraft } from '../../shared/project-models';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, ChevronRight, CircleAlert, Download, FileText, ImageOff, ImagePlus, Images, Layers3, Loader2, Plus, Save, Scissors, Settings2, Sparkles, Trash2, Upload, Users, Video, Volume2 } from 'lucide-react';
import type { ApplyMutationResult, RendererAppState as AppState } from '../../app/route-types';
import { useUnsavedChanges } from '../../app/workspace-navigation';
import { useWorkspaceDraft } from '../../app/workspace-draft';
import { mergeMotionComicSavedDocument } from '../../shared/motion-comic-document-sync';
import { motionComicRuntimeProvider } from '../../shared/motion-comic-script-batch';
import type { MotionComicScriptSnapshot } from '../../shared/motion-comic-script-batch';
import { createProductionHistoryReservations, productionHistoryUsage, PRODUCTION_MEDIA_HISTORY_DEMAND, PRODUCTION_RENDER_HISTORY_DEMAND, type ProductionHistoryDemand, type ProductionHistoryReservation } from '../../shared/production-history';
import type { ShellView } from '../../shared/types';
import type { SettingsSection } from '../settings/SettingsPage';
import {
  appendMotionComicEpisode,
  appendMotionComicScene,
  appendMotionComicShot,
  invalidateMotionComicShotVideo,
  parseMotionComicPipelineData,
  renameMotionComicAct,
  removeMotionComicShot,
  reorderMotionComicShot,
  setMotionComicActBoundary,
  setMotionComicShotFirstFrame,
  setMotionComicShotLastFrame,
  applyMotionComicPreviousFrameAsFirst,
  motionComicPreviousShotFrameId,
  splitMotionComicSourceEpisodes,
  updateMotionComicRatio,
  type MotionComicAdaptationMode,
  type MotionComicEpisode,
  type MotionComicPipelineData,
  type MotionComicShot,
  type MotionComicSourceKind,
  type MotionComicSplitStrategy,
  type MotionComicWorkflowStage,
} from '../../shared/motion-comic';
import { activeImageProfileId, enableImageProfile } from '../../shared/provider-profile-utils';
import { AppError } from '../../shared/app-error';
import { alignDirectorSubtitleCueFromTimestampFile, updateDirectorSubtitleCue, estimateDirectorSubtitleCue } from '../../shared/director-subtitles';
import { addDirectorSubtitleCue, removeDirectorSubtitleCue, setDirectorSubtitleCues } from '../../shared/director-subtitle-structure';
import type { StoryDreamApi } from '../../shared/storydream-api';
import { Button, Dialog, IconButton, Pane, SelectField, TextAreaField, TextField, Toolbar } from '../../ui';
import { useAsyncAction } from '../../ui/async-action';
import { AsyncActionFeedback } from '../../components/AsyncActionFeedback';
import { DirectorDeskWorkspace, type DirectorAsset, type DirectorQueueItem, type DirectorShot, type DirectorVersion, type DirectorVideoResult } from '../director-desk/DirectorDeskWorkspace';
import { MotionComicTaskDrawer } from './MotionComicTaskDrawer';
import { buildMotionComicTaskViewModel, type MotionComicTaskNavigation } from './motion-comic-task-view-model';
import { useMotionComicTaskSnapshot } from './use-motion-comic-task-snapshot';
import { MotionComicAssetCreateDialog, type MotionComicAssetCreateInput, type MotionComicAssetCreateKind } from './MotionComicAssetCreateDialog';
import { useFinalFilmGate } from '../final-film-gate/FinalFilmGatePanel';
import { motionComicPreviewAudioClips, motionComicShotUsesNativeAudio } from './motion-comic-audio-preview';
import { latestProductionProviderJob } from '../../shared/production-workflow';
import { addDirectorSoundClip, removeDirectorSoundClip, updateDirectorAudioClip, type DIRECTOR_SOUND_TRACKS } from '../../shared/director-audio-edit';
import { directorSoundClips, readDirectorSoundDuration } from '../director-desk/director-sound';
import { motionComicDialogueCuesToGenerate, motionComicDialogueInput, motionComicDialogueInputMatches, refreshMotionComicDialogueInputsAfterTiming, updateMotionComicCharacterVoice } from '../../shared/motion-comic-dialogue';
import { DirectorCopyAssist, DirectorProjectLoading, DirectorProjectRecovery } from '../director-desk/DirectorProjectStart';
import { buildDirectorCopyAssistRequest, normalizeDirectorCopyAssistError, type DirectorCopyAssistIntent } from '../director-desk/director-copy-assist';
import { applyMotionComicImageRecord, applyMotionComicVoiceRecord, directorImageInput, directorImageInputMatches, restoreMotionComicImageVersion, resolveDirectorImageProviderOptions, resolveDirectorImageProviderStatus, resolveDirectorVideoProviderOptions, resolveDirectorVideoProviderStatus, resolveDirectorVoiceProviderStatus, type DirectorVideoProviderStatus } from '../director-desk/director-generation';
import { attachMotionComicReference, createMotionComicReferenceAsset, fixedMotionComicReferenceAsset, fixedMotionComicReferenceAssets, imageLabRecordIdFromMutation, inspectMotionComicShotConsistency, motionComicConsistencySummary, motionComicEpisodeMissingReferenceTargets, motionComicReferenceAssets, motionComicReferenceRole, motionComicReferenceVersionIds, referenceTargetLabel, setMotionComicFixedReference, setMotionComicReferenceRole, unpinMotionComicReference, type MotionComicReferenceKind, type MotionComicReferenceRole, type MotionComicReferenceTarget } from './motion-comic-consistency';
import { motionComicReferenceGenerationInput, motionComicReferenceGenerationLabel } from './motion-comic-reference-generation';
import { MotionComicPlanDialog } from './MotionComicPlanDialog';
import { MotionComicScriptWorkspace } from './MotionComicScriptWorkspace';
import { MotionComicGenerationReferences } from './MotionComicGenerationReferences';
import { defaultMotionComicLookReferencePrompt } from './motion-comic-reference-generation';
import { MotionComicAssetGallery } from './MotionComicAssetGallery';
import { MotionComicAssetExtraction } from './MotionComicAssetExtraction';
import { MotionComicReferenceBatch } from './MotionComicReferenceBatch';
import { MotionComicAssetRemoveDialog } from './MotionComicAssetRemoveDialog';
import { MotionComicCharacterVoiceSample } from './MotionComicCharacterVoiceSample';
import { MotionComicCharacterProfile, type MotionComicCharacterProfilePatch } from './MotionComicCharacterProfile';
import { MotionComicReferenceBoard, type MotionComicReferenceCard } from './MotionComicReferenceBoard';
import { MotionComicAssetUsage } from './MotionComicAssetUsage';
import { planMotionComicAssetRemoval, referenceJobFor, type MotionComicAssetRemovalTarget } from './motion-comic-asset-removal';
import type { MotionComicAssetEpisodeUsage } from './motion-comic-asset-usage';
import {
  createMotionComicRuleSplitEvidence,
  motionComicSourceSplitEvidenceSchema,
  type MotionComicSourceSplitEvidence,
} from '../../shared/motion-comic-episode-planning';
import {
  isUntouchedMotionComicStarter,
  plannedMotionComicSourceEpisodeIds,
  motionComicSourceEpisodeIdForEpisode,
  type MotionComicPlanResult,
  type MotionComicPlanRecovery,
  type MotionComicScriptFailure,
  type MotionComicScriptDraft,
  motionComicPlanRecoverySchema,
  motionComicScriptFailureSchema,
} from '../../shared/motion-comic-planning';
import { MotionComicVideoReadiness } from './MotionComicVideoReadiness';
import { MotionComicFramePanel } from './MotionComicFramePanel';
import { importMotionComicFrame, motionComicFrameAssets } from './motion-comic-frame-import';
import { MotionComicMakeWorkspace } from './MotionComicMakeWorkspace';
import { motionComicReferenceToken } from '../../shared/motion-comic-reference-compiler';
import { MotionComicVideoVersions } from './MotionComicVideoVersions';
import { MotionComicReferenceEditor } from './MotionComicReferenceEditor';
import { adoptMotionComicVideoVersion, motionComicVideoVersions } from '../../shared/motion-comic-video-versions';
import { MOTION_COMIC_VIDEO_CANDIDATE_MIME, MotionComicCandidateDock, readCandidateDrag } from './MotionComicCandidateDock';
import { MotionComicCreateFlow, type MotionComicEpisodeDraft } from './MotionComicCreateFlow';
import { MotionComicProductionWorkspace, type MotionComicStageState } from './MotionComicProductionWorkspace';
import { MotionComicProjectOverview } from './MotionComicProjectOverview';
import { resolveMotionComicResume } from './motion-comic-resume';
import { motionComicBackTarget } from './motion-comic-navigation';
import { MotionComicEpisodesPanel, MotionComicScenesPanel, MotionComicSourcePanel } from './MotionComicWorkflowPanels';
import { resolveMotionComicActiveEpisodeReadiness, resolveMotionComicStageState } from './motion-comic-stage-state';
import { buildMotionComicShotVideoRequest, motionComicVideoReferences, motionComicVideoDialogue } from '../../shared/motion-comic-video';
import { planMotionComicProductionUnits, splitMotionComicProductionUnits } from '../../shared/motion-comic-production';
import { invalidateMotionComicVideosForChangedInputs } from '../../shared/motion-comic-video';
import { currentMotionComicShotContinuityAdvice } from '../../shared/motion-comic-continuity';
import { toLocalAssetUrl, toLocalImageUrl } from '../tasks/task-formatters';
import { directorQualityReview, directorRenderOutputs } from '../../shared/director-render';
import type { DirectorQualityArtifactRequest, DirectorQualityArtifactResult } from '../../shared/director-render';
import type { DirectorSubtitleRecheckRequest, DirectorMediaRecheckRequest } from '../../shared/director-render';
import { resolveMotionComicSystemStatus } from '../../shared/director-system-status';
import { LibraryPicker, type LibrarySelection } from '../asset-library/LibraryPicker';
export function MotionComicPage({
  api,
  state,
  applyState,
  requestedTaskId,
  onRequestedTaskHandled,
  navigate,
  openSettings,
  returnView = 'history',
}: {
  api: StoryDreamApi;
  state: AppState;
  applyState: ApplyMutationResult;
  requestedTaskId: string;
  onRequestedTaskHandled: (taskId: string) => void;
  navigate?: (view: ShellView) => void;
  returnView?: ShellView;
  openSettings?: (section: SettingsSection, returnView: ShellView, taskId?: string) => void;
}) {
  const projectAction = useAsyncAction();
  const providerAction = useAsyncAction();
  const sourceFileAction = useAsyncAction();
  const episodePlanningAction = useAsyncAction();
  const referenceAction = useAsyncAction();
  const referenceGenerationAction = useAsyncAction();
  const referenceSubmissionRef = useRef(new Set<string>());
  const [referenceGenerationBatches, setReferenceGenerationBatches] = useState<import('../../shared/director-batch-persistence').DirectorBatchRecord[]>([]);
  const planningAction = useAsyncAction();
  const planApplyAction = useAsyncAction();
  const [createModels, setCreateModels] = useState(() => defaultProjectModels(state.config));
  const [document, setDocument] = useState<MotionComicPipelineData | null>(null);
  const documentRef = useRef<MotionComicPipelineData | null>(null);
  const savedDocumentRef = useRef<MotionComicPipelineData | null>(null);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const videoRequestsRef = useRef(new Set<string>());
  const scriptDraftGuardRef = useRef<(() => boolean) | null>(null);
  const planRequestRef = useRef(0);
  const episodePlanningRequestRef = useRef(0);
  const [activeProjectId, setActiveProjectId] = useState('');
  const [selectedShotId, setSelectedShotId] = useState('');
  const [loadingProjectId, setLoadingProjectId] = useState(() => requestedTaskId);
  const projectOpenRequestRef = useRef(0);
  const generationRequestsRef = useRef(new Map<string, string>());
  const historyReservationsRef = useRef(createProductionHistoryReservations());
  const [createOpen, setCreateOpen] = useState(() => !requestedTaskId);
  const [createStep, setCreateStep] = useState(0);
  const [createTitle, setCreateTitle] = useState('');
  const [createVisualStyle, setCreateVisualStyle] = useState('');
  const [createRatio, setCreateRatio] = useState<MotionComicPipelineData['ratio']>('16:9');
  const [createSourceKind, setCreateSourceKind] = useState<MotionComicSourceKind>('script');
  const [createAdaptationMode, setCreateAdaptationMode] = useState<MotionComicAdaptationMode>('faithful-script');
  const [createSourceFileName, setCreateSourceFileName] = useState('');
  const [createSourceText, setCreateSourceText] = useState('');
  const [createTargetCharacters, setCreateTargetCharacters] = useState('2400');
  const [createTargetDurationSec, setCreateTargetDurationSec] = useState('');
  const [createSplitInstructions, setCreateSplitInstructions] = useState('');
  const [createSplitStrategy, setCreateSplitStrategy] = useState<MotionComicSplitStrategy>('chapter');
  const [createEpisodeDrafts, setCreateEpisodeDrafts] = useState<MotionComicEpisodeDraft[]>([]);
  const [createSplitEvidence, setCreateSplitEvidence] = useState<MotionComicSourceSplitEvidence | null>(null);
  const [createSplitWarnings, setCreateSplitWarnings] = useState<string[]>([]);
  const [workflowStage, setWorkflowStage] = useState<MotionComicWorkflowStage>('source');
  const workflowNavigationMemory = useRef<{ projectId: string; stages: Record<string, MotionComicWorkflowStage> }>({ projectId: '', stages: {} });
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const taskSnapshot = useMotionComicTaskSnapshot(api, document?.id, tasksOpen || overviewOpen);
  /** Pending LLM switch: resolved after the user acknowledges its effect on approved scripts. */
  const [llmSwitchPrompt, setLlmSwitchPrompt] = useState<{ nextProfileId: string; resolve: (accepted: boolean) => void; affected: string[] } | null>(null);
  const [selectedSourceEpisodeId, setSelectedSourceEpisodeId] = useState('');
  const [sceneSourcePreviewId, setSceneSourcePreviewId] = useState('');
  const [planOpen, setPlanOpen] = useState(false);
  const [planSourceText, setPlanSourceText] = useState('');
  const [planInstructions, setPlanInstructions] = useState('');
  const [planTargetDurationSec, setPlanTargetDurationSec] = useState('');
  const [planResult, setPlanResult] = useState<MotionComicPlanResult | null>(null);
  const [planRecovery, setPlanRecovery] = useState<MotionComicPlanRecovery | null>(null);
  const [planScriptFailure, setPlanScriptFailure] = useState<MotionComicScriptFailure | null>(null);
  const [planDraftSaveError, setPlanDraftSaveError] = useState('');
  const [planApplyMode, setPlanApplyMode] = useState<'append' | 'replace'>('append');
  const [planningSourceEpisodeId, setPlanningSourceEpisodeId] = useState('');
  const [dirty, setDirty] = useState(false);
  const [rendering, setRendering] = useState(false);
  const renderPendingRef = useRef(false);
  const projectLeave = useUnsavedChanges({
    id: 'motion-comic-project', label: 'AI 漫剧项目', dirty, busy: projectAction.busy || rendering,
    onSave: saveProject,
    onDiscard: () => {
      const saved = savedDocumentRef.current;
      if (saved?.id === documentRef.current?.id) { documentRef.current = saved; setDocument(saved); }
      setDirty(false);
    },
  });
  const [referenceTargetId, setReferenceTargetId] = useState('');
  const [activeLookIds, setActiveLookIds] = useState<Record<string, string>>({});
  const [assetRemoval, setAssetRemoval] = useState<MotionComicAssetRemoveRequest | null>(null);
  const [removingAsset, setRemovingAsset] = useState(false);
  const [libraryTarget, setLibraryTarget] = useState<{ kind: MotionComicReferenceKind; id: string; projectId: string } | null>(null);
  /** Confirmed imports waiting for the user to pick a role; keyed by target and never guessed. */
  const [pendingReferenceImports, setPendingReferenceImports] = useState<Record<string, MotionComicReferenceCard[]>>({});
  const [referenceImports, setReferenceImports] = useState<Record<string, number>>({});
  const [referenceComposeTargets, setReferenceComposeTargets] = useState<Set<string>>(() => new Set());
  const [assetSection, setAssetSection] = useState<'series' | 'characters' | 'scenes' | 'props'>('characters');
  const [assetDisplay, setAssetDisplay] = useState<'gallery' | 'detail'>('gallery');
  const [assetCreate, setAssetCreate] = useState<{ kind: MotionComicAssetCreateKind; projectId: string; characterId?: string } | null>(null);
  const [assetQuery, setAssetQuery] = useState('');
  const [selectedProjectAssets, setSelectedProjectAssets] = useState<Record<string, string>>({});
  const creationDraft = useWorkspaceDraft({
    id: 'motion-comic-create', label: 'AI 漫剧新建草稿', enabled: createOpen && Boolean(createTitle.trim() || createSourceText.trim() || createVisualStyle.trim()),
    busy: projectAction.busy || sourceFileAction.busy || episodePlanningAction.busy,
    value: {
      createModelsJson: JSON.stringify(createModels),
      createTitle,
      createVisualStyle,
      createRatio,
      createSourceKind,
      createAdaptationMode,
      createSourceFileName,
      createSourceText,
      createTargetCharacters,
      createTargetDurationSec,
      createSplitInstructions,
      createSplitStrategy,
      createEpisodeDraftsJson: JSON.stringify(createEpisodeDrafts),
      createSplitEvidenceJson: JSON.stringify(createSplitEvidence),
      createSplitWarningsJson: JSON.stringify(createSplitWarnings),
    },
    restore: (draft) => {
      setCreateModels(current => readProjectModelsDraft(draft.createModelsJson, current));
      setCreateTitle(draft.createTitle); setCreateRatio(draft.createRatio); setCreateSourceKind(draft.createSourceKind);
      setCreateVisualStyle(draft.createVisualStyle ?? '');
      setCreateAdaptationMode(draft.createAdaptationMode); setCreateSourceFileName(draft.createSourceFileName); setCreateSourceText(draft.createSourceText);
      setCreateTargetCharacters(draft.createTargetCharacters);
      setCreateTargetDurationSec(draft.createTargetDurationSec);
      setCreateSplitInstructions(draft.createSplitInstructions);
      setCreateSplitStrategy(draft.createSplitStrategy === 'length' || draft.createSplitStrategy === 'ai-story' ? draft.createSplitStrategy : 'chapter');
      try {
        const parsed: unknown = JSON.parse(draft.createEpisodeDraftsJson);
        setCreateEpisodeDrafts(Array.isArray(parsed) ? parsed.filter((item): item is MotionComicEpisodeDraft => Boolean(item && typeof item === 'object' && typeof (item as { title?: unknown }).title === 'string' && typeof (item as { sourceText?: unknown }).sourceText === 'string')) : []);
      } catch {
        setCreateEpisodeDrafts([]);
      }
      try {
        const parsed = motionComicSourceSplitEvidenceSchema.safeParse(JSON.parse(draft.createSplitEvidenceJson));
        setCreateSplitEvidence(parsed.success ? parsed.data : null);
      } catch {
        setCreateSplitEvidence(null);
      }
      try {
        const parsed: unknown = JSON.parse(draft.createSplitWarningsJson);
        setCreateSplitWarnings(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 20) : []);
      } catch {
        setCreateSplitWarnings([]);
      }
    },
  });
  const planningDraft = useWorkspaceDraft({
    id: `motion-comic-plan-${activeProjectId || 'new'}`,
    label: 'AI 漫剧新集规划',
    enabled: planOpen && Boolean(planSourceText.trim()),
    busy: planningAction.busy || planApplyAction.busy,
    value: { planSourceText, planInstructions, planTargetDurationSec, planningSourceEpisodeId, planRecoveryJson: JSON.stringify(planRecovery), planScriptFailureJson: JSON.stringify(planScriptFailure) },
    restore: (draft) => {
      setPlanSourceText(draft.planSourceText);
      setPlanInstructions(draft.planInstructions);
      setPlanTargetDurationSec(draft.planTargetDurationSec);
      setPlanningSourceEpisodeId(draft.planningSourceEpisodeId);
      try {
        const parsed = motionComicPlanRecoverySchema.safeParse(JSON.parse(draft.planRecoveryJson));
        setPlanRecovery(parsed.success && parsed.data.projectId === activeProjectId ? parsed.data : null);
      } catch { setPlanRecovery(null); }
      try {
        const parsed = motionComicScriptFailureSchema.safeParse(JSON.parse(draft.planScriptFailureJson));
        setPlanScriptFailure(parsed.success && parsed.data.projectId === activeProjectId ? parsed.data : null);
      } catch { setPlanScriptFailure(null); }
      setPlanResult(null);
    },
  });
  const [brokenReferenceIds, setBrokenReferenceIds] = useState<Set<string>>(() => new Set());
  const [copyAssistIntent, setCopyAssistIntent] = useState<DirectorCopyAssistIntent | null>(null);
  const copyAction = useAsyncAction();

  async function runCopyAssist(intent: DirectorCopyAssistIntent) {
    if (!document) return;
    setCopyAssistIntent(intent);
    const submitted = { createTitle: document.title, createPremise: document.series.premise };
    const result = await copyAction.run(async () => {
      try {
        const result = await api.composeResearchCopy({ projectId: document.id, ...buildDirectorCopyAssistRequest({
          mode: 'motion-comic',
          intent,
          title: submitted.createTitle,
          copy: submitted.createPremise,
        }) }).catch((error) => { throw normalizeDirectorCopyAssistError(error); });
        if (result?.copy?.trim()) {
          mutateDocument((current) => ({
            ...current,
            series: { ...current.series, premise: result.copy.trim() },
          }));
        }
      } finally {
        setCopyAssistIntent(null);
      }
    });
    if (!result.ok) setCopyAssistIntent(null);
  }
  const projectTask = state.tasks.find(task => task.id === document?.id);
  const selectedProjectModels = (!createOpen && projectTask?.projectModels) || createModels;
  const modelConfig = useProjectModelConfig(state.config, selectedProjectModels);
  const selectedProviderProfileId = selectedProjectModels.imageProfileId;

  const projects = useMemo(() => state.tasks.filter((task) => task.taskType === 'motion-comic' && !task.archivedAt).slice().sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)), [state.tasks]);
  const providerProfiles = useMemo(() => resolveDirectorImageProviderOptions(modelConfig, state.secretStatus), [modelConfig, state.secretStatus]);
  const providerStatus = useMemo(() => resolveDirectorImageProviderStatus(modelConfig, state.secretStatus, selectedProviderProfileId), [selectedProviderProfileId, modelConfig, state.secretStatus]);
  const providerOptions = useMemo(() => providerProfiles.map((profile) => ({
    value: profile.profileId,
    label: `${profile.label} · ${profile.model} · ${profile.resolution}${profile.supportsReferenceImages ? ' · 支持参考图' : ' · 不支持参考图'}${profile.connected ? '' : ' · 未连接'}`,
    disabled: !profile.connected || !profile.supportsReferenceImages,
  })), [providerProfiles]);
  const voiceStatus = useMemo(() => resolveDirectorVoiceProviderStatus(state.config, state.secretStatus), [state.config, state.secretStatus]);
  const videoProviderOptions = useMemo(() => resolveDirectorVideoProviderOptions(modelConfig, state.secretStatus), [modelConfig, state.secretStatus]);
  const committedVideoCost = useMemo(() => (document?.providerJobs ?? [])
    .filter((job) => job.capability === 'image-to-video')
    .reduce((total, job) => job.actualCost !== undefined
      ? total + job.actualCost
      : ['failed', 'cancelled'].includes(job.status) ? total : total + job.estimatedCost, 0), [document?.providerJobs]);
  const selectedUnplannedSource = workflowStage === 'scenes'
    ? document?.sourceDocument?.episodes.find((source) => source.id === sceneSourcePreviewId
      && !document.episodes.some((episode) => episode.planningEvidence?.sourceEpisodeId === source.id
        || episode.planningEvidence?.sourceText.trim() === source.sourceText.trim()))
    : undefined;
  // A source episode is not a generated episode; dependent workspaces need a real one.
  const activeEpisode: MotionComicEpisode | null = selectedUnplannedSource ? null
    : document?.episodes.find((episode) => episode.id === document.activeEpisodeId) ?? document?.episodes[0] ?? null;
  const videoProviderStatuses = useMemo(() => new Map((activeEpisode?.scenes ?? []).flatMap((scene) => scene.shots.map((shot) => [
    shot.id,
    resolveDirectorVideoProviderStatus(modelConfig, state.secretStatus, { durationMs: shot.durationMs, committedCost: committedVideoCost, requiresLastFrame: Boolean(shot.lastFrameAssetVersionId), comic: document ? {document,shot} : undefined }),
  ] as const))), [activeEpisode?.scenes, document, committedVideoCost, modelConfig, state.secretStatus]);
  const selectedVideoProviderStatus = videoProviderStatuses.get(selectedShotId || activeEpisode?.scenes[0]?.shots[0]?.id || '')
    ?? resolveDirectorVideoProviderStatus(modelConfig, state.secretStatus, { durationMs: activeEpisode?.scenes[0]?.shots[0]?.durationMs ?? 1_000, committedCost: committedVideoCost });
  const shots = useMemo(() => activeEpisode ? activeEpisode.scenes.flatMap((scene) => scene.shots.map((shot) => directorShotFromComic(activeEpisode, scene.title, shot, document, videoProviderStatuses.get(shot.id)))).map((shot, index) => ({ ...shot, index: index + 1 })) : [], [activeEpisode, document, videoProviderStatuses]);
  const renderOutputs = useMemo(() => document && activeEpisode ? directorRenderOutputs(document, activeEpisode.id) : { history: [], current: undefined }, [activeEpisode?.id, document]);
  const qualityReview = useMemo(() => document && activeEpisode ? directorQualityReview(document, activeEpisode.id) : undefined, [activeEpisode?.id, document]);
  const outputAsset = renderOutputs.current;
  // E-5: advisory final-film gate (quality-gate.json) next to this episode's current film; read-only.
  const finalFilmGate = useFinalFilmGate(api, activeProjectId, { ...(activeEpisode?.id ? { episodeId: activeEpisode.id } : {}), refreshKey: `${outputAsset?.id ?? ''}:${outputAsset?.localPath ?? ''}`, enabled: Boolean(outputAsset?.localPath) });
  const projectOptions = useMemo(() => projects.map((task) => ({ id: task.id, title: task.title || '未命名 AI 漫剧', meta: `创建于 ${new Date(task.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` })), [projects]);
  const episodeOptions = useMemo(() => (document?.episodes ?? []).map((episode) => ({ id: episode.id, number: episode.number, title: episode.title, meta: `${episode.scenes.length} 场 · ${episode.scenes.flatMap((scene) => scene.shots).length} 镜头` })), [document?.episodes]);
  const consistencySummary = useMemo(() => document ? motionComicConsistencySummary(document) : null, [document]);
  const missingEpisodeReferenceTargets = useMemo(() => document && activeEpisode
    ? motionComicEpisodeMissingReferenceTargets(document, activeEpisode.id) : [], [activeEpisode?.id, document]);
  const brokenFixedReferenceCount = useMemo(() => {
    if (!document || brokenReferenceIds.size === 0) return 0;
    const referenceIds = motionComicReferenceVersionIds(document);
    return document.assets.filter((asset) => referenceIds.has(asset.id) && asset.selected && asset.pinned && brokenReferenceIds.has(asset.id)).length;
  }, [brokenReferenceIds, document]);
  const displayedConsistencyReady = Boolean(consistencySummary?.ready && brokenFixedReferenceCount === 0);
  const canReplaceStarter = useMemo(() => document ? isUntouchedMotionComicStarter(document) : false, [document]);
  const displayedMissingTargets = [...(consistencySummary?.missingTargets ?? []), ...(brokenFixedReferenceCount > 0 ? [`${brokenFixedReferenceCount} 个固定参考文件不可用`] : [])];
  const providerReady = providerStatus.connected && providerStatus.supportsReferenceImages;
  const providerUnavailableReason = !providerStatus.connected
    ? providerStatus.unavailableReason
    : !providerStatus.supportsReferenceImages
      ? `${providerStatus.label} 不支持参考图编辑，请切换到 GPT Image 或兼容的自定义图片服务。`
      : undefined;
  const directorAssets = useMemo<DirectorAsset[]>(() => {
    if (!document) return [];
    const selected = shots.find((shot) => shot.id === selectedShotId);
    const fixedPreview = (ids: readonly string[]) => fixedMotionComicReferenceAsset(document, ids)?.localPath;
    const looks = document.characters.flatMap((character) => character.looks.map((look) => {
      const localPath = fixedPreview(look.referenceAssetVersionIds);
      return { id: look.id, label: `${character.name} · ${look.label}`, type: '角色造型', thumbnail: localPath ? toLocalImageUrl(localPath) : undefined, category: 'consistency' as const, locked: Boolean(localPath), warning: localPath ? undefined : '缺少固定参考图', selected: selected?.linkedAssetIds?.includes(look.id) };
    }));
    const scenes = document.sceneAssets.map((asset) => {
      const localPath = fixedPreview(asset.referenceAssetVersionIds);
      return { id: asset.id, label: asset.label, type: '场景', thumbnail: localPath ? toLocalImageUrl(localPath) : undefined, category: 'consistency' as const, locked: Boolean(localPath), warning: localPath ? undefined : '缺少固定参考图', selected: selected?.linkedAssetIds?.includes(asset.id) };
    });
    const props = document.props.map((asset) => {
      const localPath = fixedPreview(asset.referenceAssetVersionIds);
      return { id: asset.id, label: asset.label, type: '道具', thumbnail: localPath ? toLocalImageUrl(localPath) : undefined, category: 'consistency' as const, locked: Boolean(localPath), warning: localPath ? undefined : '缺少固定参考图', selected: selected?.linkedAssetIds?.includes(asset.id) };
    });
    const referenceVersionIds = motionComicReferenceVersionIds(document);
    const imageJobIds = new Set(document.providerJobs.filter((job) => job.capability === 'text-to-image').map((job) => job.id));
    const generated = document.assets
      .filter((asset) => asset.kind === 'image' && asset.localPath && !referenceVersionIds.has(asset.id) && (asset.assetId.startsWith('shot-keyframe-') || Boolean(asset.providerJobId && imageJobIds.has(asset.providerJobId))))
      .map((asset, index) => ({ id: asset.id, sourceVersionId: asset.id, label: `关键帧 ${index + 1}`, type: asset.provider ?? '生成图片', thumbnail: toLocalImageUrl(asset.localPath!), category: 'history' as const, selected: selected?.linkedAssetIds?.includes(asset.id) }));
    return [...looks, ...scenes, ...props, ...generated];
  }, [document, selectedShotId, shots]);
  const versions = useMemo<DirectorVersion[]>(() => {
    if (!document || !selectedShotId) return [];
    const assetsByJob = new Map(document.assets.slice().reverse().map((asset) => [asset.providerJobId, asset]));
    return document.providerJobs.filter((job) => job.nodeId === selectedShotId && job.capability === 'text-to-image' && job.status === 'completed').map((job, index) => {
      const asset = assetsByJob.get(job.id);
      return { id: asset?.id ?? job.id, label: `关键帧版本 ${index + 1}`, createdAt: job.updatedAt, provider: `${job.providerId} / ${job.model}`, thumbnail: asset?.localPath ? toLocalImageUrl(asset.localPath) : undefined, selected: shots.find((shot) => shot.id === selectedShotId)?.linkedAssetIds?.includes(asset?.id ?? '') };
    }).reverse();
  }, [document, selectedShotId, shots]);
  const jobs = useMemo<DirectorQueueItem[]>(() => (document?.providerJobs ?? []).filter((job) => ['text-to-image', 'image-to-video', 'text-to-speech', 'deterministic-render'].includes(job.capability)).slice().reverse().map((job) => {
    const shot = shots.find((candidate) => candidate.id === job.nodeId);
    const kind: DirectorQueueItem['kind'] = job.capability === 'image-to-video' ? 'shot-video' : job.capability === 'text-to-speech' ? 'shot-voice' : job.capability === 'deterministic-render' ? 'project-render' : 'shot-image';
    const fallbackTitle = kind === 'shot-video' ? '远程视频' : kind === 'shot-voice' ? '对白配音' : kind === 'project-render' ? '整片合成' : '关键帧生成';
    return { id: job.id, shotId: job.nodeId, kind, title: shot ? `${shot.title} · ${fallbackTitle}` : fallbackTitle, status: job.status === 'queued' ? 'waiting' : job.status === 'cancelled' ? 'failed' : job.status, progress: job.status === 'completed' ? 100 : 0, cost: job.actualCost ?? job.estimatedCost, provider: `${job.providerId} / ${job.model}`, thumbnail: shot?.thumbnail, error: job.error };
  }), [document?.providerJobs, shots]);
  const activeEpisodeReadiness = useMemo(() => document ? resolveMotionComicActiveEpisodeReadiness(document) : null, [document]);
  const completedStages = useMemo(() => {
    if (!document) return [];
    const completed: string[] = [];
    if (document.series.premise.trim()) completed.push('剧本');
    if (activeEpisode?.scenes.length) completed.push('画面拆解');
    if (activeEpisodeReadiness?.consistencyComplete) completed.push('素材一致性');
    if (activeEpisodeReadiness?.generationComplete) completed.push('镜头生成');
    if (activeEpisodeReadiness?.audioComplete) completed.push('配音字幕');
    if (outputAsset) completed.push('导出');
    if (qualityReview?.freshness === 'current' && qualityReview.report?.status === 'passed'
      && qualityReview.report.checks.every((check) => check.status === 'passed' || check.status === 'waived')) completed.push('审片');
    return completed;
  }, [activeEpisode?.scenes.length, activeEpisodeReadiness, document, outputAsset, qualityReview]);
  const plannedSourceEpisodeIds = useMemo(() => document ? plannedMotionComicSourceEpisodeIds(document) : new Set<string>(), [document]);
  const selectedSourceEpisode = document?.sourceDocument?.episodes.find((episode) => episode.id === selectedSourceEpisodeId)
    ?? document?.sourceDocument?.episodes[0]
    ?? null;
  const currentPlanRecovery = planRecovery !== null && planRecovery.projectId === document?.id
    && planRecovery.sourceText === planSourceText.trim()
    && planRecovery.instructions === planInstructions.trim()
    && planRecovery.targetDurationSec === (planTargetDurationSec.trim() ? Number(planTargetDurationSec) : undefined)
    ? planRecovery : null;
  const currentPlanScriptFailure = planScriptFailure !== null && planScriptFailure.projectId === document?.id
    && planScriptFailure.sourceText === planSourceText.trim()
    && planScriptFailure.instructions === planInstructions.trim()
    && planScriptFailure.targetDurationSec === (planTargetDurationSec.trim() ? Number(planTargetDurationSec) : undefined)
    ? planScriptFailure : null;
  const stageState = useMemo<Record<MotionComicWorkflowStage, MotionComicStageState>>(() => {
    if (!document) {
      return Object.fromEntries([
        'source', 'episodes', 'scenes', 'assets', 'storyboard', 'video', 'audio', 'export',
      ].map((stage) => [stage, { ready: stage === 'source', complete: false, detail: '等待打开项目' }])) as Record<MotionComicWorkflowStage, MotionComicStageState>;
    }
    const stages = resolveMotionComicStageState(document, plannedSourceEpisodeIds, Boolean(outputAsset));
    if (selectedUnplannedSource) {
      for (const stage of ['storyboard', 'video', 'audio', 'export'] as const) {
        stages[stage] = { ready: false, complete: false, detail: '当前分集尚未完成结构化' };
      }
      stages.scenes = { ready: true, complete: false, detail: `第 ${selectedUnplannedSource.number} 集待结构化` };
    }
    return stages;
  }, [document, outputAsset, plannedSourceEpisodeIds, selectedUnplannedSource]);
  const actionError = sourceFileAction.feedback?.tone === 'error' ? sourceFileAction.feedback.message : episodePlanningAction.feedback?.tone === 'error' ? episodePlanningAction.feedback.message : providerAction.feedback?.tone === 'error' ? providerAction.feedback.message : referenceAction.feedback?.tone === 'error' ? referenceAction.feedback.message : projectAction.feedback?.tone === 'error' ? projectAction.feedback.message : undefined;
  const actionFeedback = sourceFileAction.feedback?.tone === 'success' ? sourceFileAction.feedback.message : episodePlanningAction.feedback?.tone === 'success' ? episodePlanningAction.feedback.message : providerAction.feedback?.tone === 'success' ? providerAction.feedback.message : projectAction.feedback?.tone === 'success' ? projectAction.feedback.message : undefined;
  const planError = planApplyAction.feedback?.tone === 'error' ? planApplyAction.feedback.message : planningAction.feedback?.tone === 'error' ? planningAction.feedback.message : undefined;
  const systemStatusSummary = resolveMotionComicSystemStatus({
    actionError: Boolean(actionError),
    imageConnected: providerStatus.connected,
    supportsReferenceImages: providerStatus.supportsReferenceImages,
    consistencyReady: displayedConsistencyReady,
    voiceConnected: voiceStatus.connected,
  });
  const videoRequired = Boolean(activeEpisode?.scenes.some((scene) => scene.shots.some((shot) => shot.renderStrategy === 'remote-video')));
  const videoUnavailable = videoRequired && !videoProviderOptions.some((status) => status.connected);
  const systemStatusTone = actionError ? 'error' : videoUnavailable ? 'warning' : systemStatusSummary.tone;
  const systemStatus = actionError ? systemStatusSummary.label : videoUnavailable ? '远程视频服务待配置' : systemStatusSummary.label;



  useEffect(() => {
    setBrokenReferenceIds(new Set());
    setSceneSourcePreviewId('');
    setPlanDraftSaveError('');
  }, [activeProjectId]);

  useEffect(() => () => {
    projectOpenRequestRef.current += 1;
    planRequestRef.current += 1;
    episodePlanningRequestRef.current += 1;
    generationRequestsRef.current.clear();
  }, []);

  const openProject = useCallback(async (taskId: string) => {
    const request = ++projectOpenRequestRef.current;
    planRequestRef.current += 1;
    generationRequestsRef.current.clear();
    setPlanOpen(false);
    setPlanResult(null);
    setLoadingProjectId(taskId);
    const result = await projectAction.run(async () => {
      const task = await api.getTaskDetail(taskId);
      if (!task || task.taskType !== 'motion-comic') throw new Error('AI 漫剧项目不存在或已被移除。');
      return parseMotionComicPipelineData(task.pipelineData);
    });
    if (request !== projectOpenRequestRef.current) return;
    setLoadingProjectId('');
    if (!result.ok) return;
    setDocument(result.value);
    documentRef.current = result.value;
    savedDocumentRef.current = result.value;
    setActiveProjectId(taskId);
    setAssetDisplay('gallery');
    setAssetQuery('');
    setSelectedProjectAssets({});
    const resume = resolveMotionComicResume(result.value);
    setSelectedShotId(resume.shotId);
    setSelectedSourceEpisodeId(resume.sourceEpisodeId);
    setSceneSourcePreviewId('');
    setWorkflowStage(resume.stage);
    setOverviewOpen(true);
    setCreateOpen(false);
    setDirty(false);
  }, [api, projectAction.run]);

  useEffect(() => {
    if (!requestedTaskId) return;
    void openProject(requestedTaskId).finally(() => onRequestedTaskHandled(requestedTaskId));
  }, [onRequestedTaskHandled, openProject, requestedTaskId]);

  // Pending import cards and the compose choice belong to one asset in one project:
  // switching projects must not leave another project's cards on screen.
  const referenceStateProjectRef = useRef(document?.id);
  useEffect(() => {
    if (referenceStateProjectRef.current === document?.id) return;
    referenceStateProjectRef.current = document?.id;
    setPendingReferenceImports({});
    setReferenceImports({});
    setReferenceComposeTargets(new Set());
    setReferenceTargetId('');
  }, [document?.id]);

  function mutateDocument(update: (current: MotionComicPipelineData) => MotionComicPipelineData) {
    const current = documentRef.current;
    if (!current) return;
    // Local edits retain the last persisted revision until storage commits them.
    const next = { ...invalidateMotionComicVideosForChangedInputs(current, update(current)), updatedAt: current.updatedAt };
    documentRef.current = next;
    setDocument(next);
    setDirty(true);
  }

  async function withHistoryCapacity<T>(demand: ProductionHistoryDemand, action: (reservation: ProductionHistoryReservation) => Promise<T>): Promise<T> {
    const current = documentRef.current;
    if (!current) throw new Error('请先打开项目。');
    const reservation = historyReservationsRef.current.reserve(current, demand);
    try { return await action(reservation); }
    finally { reservation.release(); }
  }

  async function importSoundDirect(shotId: string, trackType: (typeof DIRECTOR_SOUND_TRACKS)[number]) {
    const projectId = documentRef.current?.id;
    const request = projectOpenRequestRef.current;
    if (!projectId) throw new Error('请先打开项目。');
    const imported = await api.importBgmAudio();
    if (!imported) return;
    const durationMs = await readDirectorSoundDuration(imported.path);
    if (documentRef.current?.id !== projectId || request !== projectOpenRequestRef.current) throw new Error('项目已切换，请在当前项目重新导入音频。');
    mutateDocument((current) => addDirectorSoundClip(current, shotId, { id: crypto.randomUUID(), ...imported, durationMs, trackType, createdAt: new Date().toISOString() }));
  }

  function importSound(shotId: string, trackType: (typeof DIRECTOR_SOUND_TRACKS)[number]) {
    return withHistoryCapacity({ assets: 1 }, () => importSoundDirect(shotId, trackType));
  }

  async function importSubtitleTimestamps(shotId: string, cueId: string) {
    await projectAction.run(async () => {
      const selected = await api.selectLocalSubtitleTimestampFile();
      if (!selected) return null;
      const current = documentRef.current;
      if (!current) throw new Error('请先打开项目。');
      const aligned = alignDirectorSubtitleCueFromTimestampFile(current, shotId, cueId, selected.contents, selected.path);
      if (aligned.issues.length > 0) throw new Error(`时间戳未导入：${aligned.issues.join('、')}。请确认文件与当前对白句子匹配。`);
      mutateDocument(() => aligned.document);
      return aligned;
    }, { successMessage: '已导入识别时间戳；对白将按真实时间切换。' });
  }

  function updateShot(id: string, update: Partial<DirectorShot> & Pick<Partial<MotionComicShot>, 'continuity'>) {
    mutateDocument(current => updateMotionComicMakeShot(current, id, update));
  }

  function replaceDocument(next: MotionComicPipelineData) {
    setDocument(next);
    documentRef.current = next;
    setDirty(true);
  }

  function updateRatio(ratio: MotionComicPipelineData['ratio']) {
    mutateDocument((current) => updateMotionComicRatio(current, ratio));
  }


  function selectEpisode(episodeId: string) {
    const current = documentRef.current;
    if (!current) return;
    const episode = current.episodes.find((candidate) => candidate.id === episodeId);
    if (!episode && current.sourceDocument?.episodes) {
      const sourceEp = current.sourceDocument.episodes.find((s) => s.id === episodeId);
      if (sourceEp) {
        setSelectedSourceEpisodeId(sourceEp.id);
        setSceneSourcePreviewId(sourceEp.id);
        setSelectedShotId('');
        return;
      }
    }
    if (!episode) return;
    setSceneSourcePreviewId('');
    setSelectedSourceEpisodeId(motionComicSourceEpisodeIdForEpisode(current, episode) ?? '');
    if (current.activeEpisodeId !== episodeId) {
      replaceDocument({ ...current, activeEpisodeId: episodeId });
    }
    setSelectedShotId(episode.scenes[0]?.shots[0]?.id ?? '');
  }

  function backWithinProject() {
    if (scriptDraftGuardRef.current?.() === false) return;
    const target = motionComicBackTarget(workflowStage);
    if (!target.stage) {
      setOverviewOpen(true);
      return;
    }
    if (target.stage === 'episodes') {
      const current = documentRef.current;
      const episode = current?.episodes.find(item => item.id === current.activeEpisodeId);
      const sourceId = sceneSourcePreviewId || (current && episode ? motionComicSourceEpisodeIdForEpisode(current, episode) : undefined);
      if (sourceId) setSelectedSourceEpisodeId(sourceId);
    }
    setWorkflowStage(target.stage);
  }

  function openAssetUsage(usage: MotionComicAssetEpisodeUsage) {
    if (usage.episodeId) {
      selectEpisode(usage.episodeId);
      setWorkflowStage('scenes');
    } else if (usage.sourceEpisodeId) {
      setSelectedSourceEpisodeId(usage.sourceEpisodeId);
      setWorkflowStage('episodes');
    }
  }

  function addEpisode() {
    const current = documentRef.current;
    if (!current) return;
    const next = appendMotionComicEpisode(current, { id: `episode-${current.id}-${crypto.randomUUID()}`, title: `第${current.episodes.length + 1}集` });
    replaceDocument(next);
    const episode = next.episodes.find((candidate) => candidate.id === next.activeEpisodeId);
    setSelectedShotId(episode?.scenes[0]?.shots[0]?.id ?? '');
  }

  function openPlanDialog(sourceEpisodeId?: string) {
    const sources = documentRef.current?.sourceDocument?.episodes;
    if (sources?.length) {
      if (scriptDraftGuardRef.current?.() === false) return;
      setSelectedSourceEpisodeId(sources.find((episode) => episode.id === sourceEpisodeId)?.id ?? sources[0].id);
      setPlanOpen(false);
      setWorkflowStage('episodes');
      return;
    }
    planRequestRef.current += 1;
    planningAction.clearFeedback();
    planApplyAction.clearFeedback();
    setPlanApplyMode('append');
    setPlanResult(null);
    const sourceEpisode = documentRef.current?.sourceDocument?.episodes.find((episode) => episode.id === sourceEpisodeId);
    if (sourceEpisode) {
      setPlanningSourceEpisodeId(sourceEpisode.id);
      setSelectedSourceEpisodeId(sourceEpisode.id);
      if (sourceEpisode.id !== planningSourceEpisodeId || !planSourceText.trim()) {
        setPlanRecovery(null);
        setPlanScriptFailure(null);
        setPlanDraftSaveError('');
        setPlanSourceText(sourceEpisode.sourceText);
        setPlanInstructions(documentRef.current?.sourceDocument?.adaptationMode === 'novel-adaptation'
          ? '将小说内容改写为可拍摄的漫剧剧本，保留核心事件和人物动机；输出分幕、分场、角色、场景、道具和逐镜视频提示词。'
          : '忠实保留现有剧本的事件顺序和对白意图；输出分幕、分场、角色、场景、道具和逐镜视频提示词。');
      }
    } else {
      setPlanningSourceEpisodeId('');
    }
    setPlanOpen(true);
  }

  function changePlanScriptDraft(draft: MotionComicScriptDraft) {
    if (!currentPlanScriptFailure) return;
    const failure = { ...currentPlanScriptFailure, draft };
    setPlanScriptFailure(failure);
    try {
      planningDraft.persist({ ...planningDraft.snapshot(), planScriptFailureJson: JSON.stringify(failure) });
      setPlanDraftSaveError('');
    } catch {
      setPlanDraftSaveError('修正仍在当前窗口，但本地草稿保存失败。请勿关闭窗口，释放本地存储空间后重试。');
    }
  }

  function changeReviewedScript(draft: MotionComicScriptDraft) {
    if (!currentPlanRecovery) return;
    planRequestRef.current += 1;
    setPlanResult(null);
    const recovery = { ...currentPlanRecovery, script: draft, needsValidation: true };
    setPlanRecovery(recovery);
    try {
      planningDraft.persist({ ...planningDraft.snapshot(), planRecoveryJson: JSON.stringify(recovery) });
      setPlanDraftSaveError('');
    } catch {
      setPlanDraftSaveError('剧本修改尚未保存到本地，请勿关闭窗口，释放存储空间后重试。');
    }
  }

  function changePlanInput(setValue: (value: string) => void, value: string) {
    planRequestRef.current += 1;
    setPlanResult(null);
    setPlanRecovery(null);
    setPlanScriptFailure(null);
    planningAction.clearFeedback();
    setValue(value);
  }

  function changePlanOpen(open: boolean) {
    if (!open && planSourceText.trim()) {
      try { planningDraft.persist(planningDraft.snapshot()); setPlanDraftSaveError(''); }
      catch { setPlanDraftSaveError('无法保存当前规划草稿，窗口尚未关闭，请重试。'); return; }
    }
    setPlanOpen(open);
    if (!open) {
      planRequestRef.current += 1;
      setPlanResult(null);
      planningAction.clearFeedback();
      planApplyAction.clearFeedback();
    }
  }

  function editPlanSource() {
    planningAction.clearFeedback();
    planApplyAction.clearFeedback();
    setPlanApplyMode('append');
    planRequestRef.current += 1;
    setPlanResult(null);
    setPlanRecovery(null);
    setPlanScriptFailure(null);
  }

  function completePlanDraft(submitted: ReturnType<typeof planningDraft.snapshot>) {
    planningDraft.complete(submitted);
    setPlanSourceText('');
    setPlanInstructions('');
    setPlanTargetDurationSec('');
    setPlanResult(null);
    setPlanRecovery(null);
    setPlanScriptFailure(null);
    setPlanningSourceEpisodeId('');
  }

  function createBlankEpisodeFromPlan() {
    const submitted = planningDraft.snapshot();
    addEpisode();
    completePlanDraft(submitted);
    setPlanOpen(false);
  }

  async function generatePlan(resume = false, restart = false, scriptDraft?: MotionComicScriptDraft) {
    setPlanDraftSaveError('');
    const submitted = planningDraft.snapshot();
    const request = ++planRequestRef.current;
    const result = await planningAction.run(async () => {
      const sourceText = submitted.planSourceText.trim();
      if (!sourceText) throw new Error('请先填写本集故事原文。');
      if (sourceText.length > 30_000) throw new Error('故事原文超过 30,000 字，请按集拆分后再生成。');
      const durationText = submitted.planTargetDurationSec.trim();
      const targetDurationSec = durationText ? Number(durationText) : undefined;
      if (targetDurationSec !== undefined && (!Number.isFinite(targetDurationSec) || targetDurationSec < 5 || targetDurationSec > 1_800)) {
        throw new Error('目标时长需填写 5 到 1800 秒。');
      }
      await persistQueueRef.current;
      let current = documentRef.current;
      if (!current) throw new Error('请先打开 AI 漫剧项目。');
      if (dirty) current = await enqueueProjectMutation(current.id, (latest) => latest);
      planningDraft.persist(submitted);
      const planned = await api.planMotionComic({
        id: current.id,
        expectedUpdatedAt: current.updatedAt,
        stage: resume ? 'storyboard' : 'script',
        sourceText,
        ...(submitted.planInstructions.trim() ? { instructions: submitted.planInstructions.trim() } : {}),
        ...(targetDurationSec !== undefined ? { targetDurationSec } : {}),
        ...(scriptDraft ? { scriptDraft, scriptRevisionToken: currentPlanRecovery?.token ?? currentPlanScriptFailure?.token } : {}),
        ...(resume && currentPlanRecovery ? { resumeToken: currentPlanRecovery.token } : {}),
        ...(restart ? { restart: true } : {}),
      });
      if (request !== planRequestRef.current || documentRef.current?.id !== current.id) return null;
      if (JSON.stringify(documentRef.current) !== JSON.stringify(current)) throw new Error('生成期间项目已修改，本次结果未应用，请基于当前项目重新规划。');
      if (resume) {
        const task = await api.getTaskDetail(current.id);
        if (!task) throw new Error('项目资产已确认，但项目无法重新读取。');
        const saved = parseMotionComicPipelineData(task.pipelineData);
        if (request !== planRequestRef.current || documentRef.current?.id !== current.id) return null;
        acceptSavedDocument(saved, current);
        current = saved;
      }
      if (planned.status === 'script-invalid') {
        setPlanResult(null);
        setPlanRecovery(null);
        setPlanScriptFailure(planned.failure);
        try {
          planningDraft.persist({ ...submitted, planRecoveryJson: 'null', planScriptFailureJson: JSON.stringify(planned.failure) });
        } catch {
          throw new Error(`剧本问题已返回，但无法保存草稿入口；请不要关闭当前窗口。${planned.error.message}`);
        }
        throw new Error(`${planned.error.message}（诊断号：${planned.error.diagnosticId}）`);
      }
      if (planned.status === 'script-ready' || planned.status === 'storyboard-failed') {
        setPlanResult(null);
        setPlanScriptFailure(null);
        setPlanRecovery(planned.recovery);
        try {
          planningDraft.persist({ ...submitted, planRecoveryJson: JSON.stringify(planned.recovery), planScriptFailureJson: 'null' });
        } catch {
          throw new Error('剧本已保留，但无法保存恢复入口；请勿关闭当前窗口。');
        }
        if (planned.status === 'script-ready') return null;
        const recovered = planned.error.code === 'MOTION_COMIC_PLAN_RECOVERY_AVAILABLE';
        throw new Error(`${recovered ? '发现之前保留的剧本' : '分镜阶段失败，已保留剧本'}。${planned.error.message}（诊断号：${planned.error.diagnosticId}）`);
      }
      return { projectId: current.id, planned: planned.result };
    }, { successMessage: resume ? '分镜已生成，请审阅后再应用。' : '剧本已通过校验，请审核后再生成分镜。' });
    if (!result.ok || !result.value || request !== planRequestRef.current || documentRef.current?.id !== result.value.projectId) return;
    setPlanResult(result.value.planned);
    const recovery = resume && currentPlanRecovery ? { ...currentPlanRecovery, script: result.value.planned.plan.script } : null;
    setPlanRecovery(recovery);
    setPlanScriptFailure(null);
    planningDraft.persist({ ...submitted, planRecoveryJson: JSON.stringify(recovery), planScriptFailureJson: 'null' });
  }

  async function applyPlan(replaceStarter = false, reviewedAdjustments = false) {
    const preview = planResult;
    if (!preview) return;
    setPlanApplyMode(replaceStarter ? 'replace' : 'append');
    const submitted = planningDraft.snapshot();
    const request = ++planRequestRef.current;
    const result = await planApplyAction.run(async () => {
      await persistQueueRef.current;
      const current = documentRef.current;
      if (!current) throw new Error('请先打开 AI 漫剧项目。');
      const mutation = await api.applyMotionComicPlan({
        id: current.id,
        expectedUpdatedAt: current.updatedAt,
        plan: preview.plan,
        replaceStarter,
        reviewedAdjustments,
        ...(planningSourceEpisodeId ? { sourceEpisodeId: planningSourceEpisodeId } : {}),
      });
      applyState(mutation);
      const task = await api.getTaskDetail(current.id);
      if (!task) throw new Error('新集已应用，但项目无法重新读取。');
      return { submittedDocument: current, saved: parseMotionComicPipelineData(task.pipelineData) };
    }, { successMessage: replaceStarter ? '默认空模板已替换为规划内容。' : `第 ${documentRef.current?.episodes.length ? documentRef.current.episodes.length + 1 : 1} 集已追加。` });
    if (!result.ok || request !== planRequestRef.current || documentRef.current?.id !== result.value.saved.id) return;
    acceptSavedDocument(result.value.saved, result.value.submittedDocument);
    const addedEpisode = result.value.saved.episodes.find((episode) => episode.id === result.value.saved.activeEpisodeId) ?? result.value.saved.episodes.at(-1);
    setSelectedShotId(addedEpisode?.scenes[0]?.shots[0]?.id ?? '');
    setWorkflowStage('scenes');
    setSelectedSourceEpisodeId(result.value.saved.sourceDocument?.episodes.find((source) => !plannedMotionComicSourceEpisodeIds(result.value.saved).has(source.id))?.id ?? planningSourceEpisodeId ?? result.value.saved.sourceDocument?.episodes[0]?.id ?? '');
    completePlanDraft(submitted);
    setPlanOpen(false);
  }

  function addScene() {
    const current = documentRef.current;
    if (!current) return;
    const next = appendMotionComicScene(current, current.activeEpisodeId, { id: `${current.activeEpisodeId}-scene-${crypto.randomUUID()}` });
    replaceDocument(next);
    setSelectedShotId(next.episodes.find((episode) => episode.id === next.activeEpisodeId)?.scenes.at(-1)?.shots[0]?.id ?? '');
  }

  function addCharacterAsset(input?: MotionComicAssetCreateInput | unknown) {
    if (!input || typeof input !== 'object' || !('kind' in input) || !('name' in input)) { if (documentRef.current) setAssetCreate({ kind: 'character', projectId: documentRef.current.id }); return; }
    const data = input as MotionComicAssetCreateInput;
    const characterId = `character-${crypto.randomUUID()}`;
    mutateDocument((current) => {
      const lookId = `look-${crypto.randomUUID()}`;
      return {
        ...current,
        series: { ...current.series, characterIds: [...current.series.characterIds, characterId] },
        characters: [...current.characters, {
          id: characterId,
          name: data.name.trim(),
          role: '待定义',
          identityPrompt: data.description.trim(),
          personality: '',
          voiceNotes: '',
          looks: [{
            id: lookId,
            characterId,
            label: '基础造型',
            appearancePrompt: '',
            wardrobe: '',
            continuityNotes: '',
            referenceAssetVersionIds: [],
            pinned: false,
          }],
        }],
      };
    });
    setAssetQuery('');
    setSelectedProjectAssets((current) => ({ ...current, characters: characterId }));
    setAssetDisplay('detail');
  }

  function addCharacterLook(characterId: string, input?: MotionComicAssetCreateInput) {
    const current = documentRef.current;
    if (!current) return;
    if (!input) { setAssetCreate({ kind: 'look', characterId, projectId: current.id }); return; }
    const target = current.characters.find(character => character.id === characterId);
    if (!target) throw new Error('人物已不存在，请重新选择人物。');
    if (target.looks.length >= 50) throw new Error('每个人物最多保存 50 个造型。');
    const lookId = `look-${crypto.randomUUID()}`;
    setActiveLookIds((ids) => ({ ...ids, [characterId]: lookId }));
    mutateDocument((current) => ({ ...current, characters: current.characters.map((character) => character.id !== characterId || character.looks.length >= 50 ? character : {
      ...character, looks: [...character.looks, {
        id: lookId, characterId, label: input.name.trim(),
        appearancePrompt: input.description.trim(), wardrobe: '', continuityNotes: '', referencePrompt: '', referenceAssetVersionIds: [], pinned: false,
      }],
    }) }));
  }

  type MotionComicAssetRemoveRequest =
    | { kind: 'character'; id: string; name: string; target: MotionComicAssetRemovalTarget }
    | { kind: 'look'; id: string; name: string; target: MotionComicAssetRemovalTarget }
    | { kind: 'scene'; id: string; name: string; target: MotionComicAssetRemovalTarget }
    | { kind: 'prop'; id: string; name: string; target: MotionComicAssetRemovalTarget };

  function openRemove(kind: 'look', character: { id: string; name: string }, look: { id: string; label: string }): void;
  function openRemove(kind: 'scene' | 'prop', asset: { id: string; label: string }): void;
  function openRemove(kind: 'character' | 'look' | 'scene' | 'prop', owner: { id: string; name?: string; label?: string }, look?: { id: string; label: string }) {
    const current = documentRef.current;
    if (!current) return;
    if (kind === 'look') {
      if (!look || !owner.id) return;
      setAssetRemoval({ kind, id: look.id, name: `${owner.name ?? ''} · ${look.label}`.trim(), target: { kind: 'look', characterId: owner.id, lookId: look.id } });
      return;
    }
    if (kind === 'character') {
      setAssetRemoval({ kind, id: owner.id, name: owner.name ?? '人物', target: { kind: 'character', characterId: owner.id } });
      return;
    }
    setAssetRemoval({ kind, id: owner.id, name: owner.label ?? (kind === 'scene' ? '地点' : '道具'), target: kind === 'scene' ? { kind: 'scene', sceneAssetId: owner.id } : { kind: 'prop', propAssetId: owner.id } });
  }

  async function confirmRemoveAsset() {
    const request = assetRemoval;
    const current = documentRef.current;
    if (!request || !current || removingAsset) return;
    if (!planMotionComicAssetRemoval(current, request.target).next) return;
    setRemovingAsset(true);
    try {
      mutateDocument((latest) => planMotionComicAssetRemoval(latest, request.target).next ?? latest);
      forgetRemovedAsset(request);
      referenceAction.clearFeedback();
      setAssetRemoval(null);
    } finally {
      setRemovingAsset(false);
    }
  }

  /** Clear the now-stale selections after a successful removal. */
  function forgetRemovedAsset(request: MotionComicAssetRemoveRequest) {
    const target = request.target;
    if (target.kind === 'character') setSelectedProjectAssets((ids) => ({ ...ids, characters: '' }));
    else if (target.kind === 'look') {
      setSelectedProjectAssets((ids) => ({ ...ids, characters: target.characterId }));
      setActiveLookIds((ids) => ({ ...ids, [target.characterId]: '' }));
    } else if (target.kind === 'scene') setSelectedProjectAssets((ids) => ({ ...ids, scenes: '' }));
    else setSelectedProjectAssets((ids) => ({ ...ids, props: '' }));
    const removedId = target.kind === 'look' ? target.lookId : target.kind === 'character' ? target.characterId : target.kind === 'scene' ? target.sceneAssetId : target.propAssetId;
    if (referenceTargetId.endsWith(`:${removedId}`)) setReferenceTargetId('');
  }

  function addSceneAsset(input?: MotionComicAssetCreateInput | unknown) {
    if (!input || typeof input !== 'object' || !('kind' in input) || !('name' in input)) { if (documentRef.current) setAssetCreate({ kind: 'scene', projectId: documentRef.current.id }); return; }
    const data = input as MotionComicAssetCreateInput;
    const id = `scene-asset-${crypto.randomUUID()}`;
    mutateDocument((current) => {
      return {
        ...current,
        series: { ...current.series, sceneAssetIds: [...current.series.sceneAssetIds, id] },
        sceneAssets: [...current.sceneAssets, {
          id,
          label: data.name.trim(),
          description: data.description.trim(),
          prompt: data.description.trim(),
          continuityNotes: '',
          referenceAssetVersionIds: [],
        }],
      };
    });
    setAssetQuery('');
    setSelectedProjectAssets((current) => ({ ...current, scenes: id }));
    setAssetDisplay('detail');
  }

  function addPropAsset(input?: MotionComicAssetCreateInput | unknown) {
    if (!input || typeof input !== 'object' || !('kind' in input) || !('name' in input)) { if (documentRef.current) setAssetCreate({ kind: 'prop', projectId: documentRef.current.id }); return; }
    const data = input as MotionComicAssetCreateInput;
    const id = `prop-${crypto.randomUUID()}`;
    mutateDocument((current) => {
      return {
        ...current,
        series: { ...current.series, propAssetIds: [...current.series.propAssetIds, id] },
        props: [...current.props, {
          id,
          label: data.name.trim(),
          description: data.description.trim(),
          prompt: data.description.trim(),
          referenceAssetVersionIds: [],
        }],
      };
    });
    setAssetQuery('');
    setSelectedProjectAssets((current) => ({ ...current, props: id }));
    setAssetDisplay('detail');
  }

  function updateScene(sceneId: string, update: Partial<Pick<MotionComicPipelineData['episodes'][number]['scenes'][number], 'title' | 'summary' | 'actIndex' | 'actTitle' | 'actBoundaryReason' | 'actSource'>>) {
    mutateDocument((current) => ({
      ...current,
      episodes: current.episodes.map((episode) => ({
        ...episode,
        scenes: episode.scenes.map((scene) => scene.id === sceneId ? { ...scene, ...update } : scene),
      })),
    }));
  }

  function addShot() {
    const current = documentRef.current;
    const episode = current?.episodes.find((candidate) => candidate.id === current.activeEpisodeId);
    const selectedScene = episode?.scenes.find((scene) => scene.shots.some((shot) => shot.id === selectedShotId)) ?? episode?.scenes.at(-1);
    if (!current || !episode || !selectedScene) return;
    const next = appendMotionComicShot(current, episode.id, selectedScene.id, { id: `${selectedScene.id}-shot-${crypto.randomUUID()}` });
    replaceDocument(next);
    setSelectedShotId(next.episodes.find((candidate) => candidate.id === episode.id)?.scenes.find((scene) => scene.id === selectedScene.id)?.shots.at(-1)?.id ?? '');
  }

  function removeShot(shotId: string) {
    const current = documentRef.current;
    const episode = current?.episodes.find((candidate) => candidate.id === current.activeEpisodeId);
    const ordered = episode?.scenes.flatMap((scene) => scene.shots) ?? [];
    const index = ordered.findIndex((shot) => shot.id === shotId);
    if (!current || !episode || index < 0 || ordered.length <= 1) return;
    const adjacentId = ordered[index + 1]?.id ?? ordered[index - 1]?.id ?? '';
    const next = removeMotionComicShot(current, episode.id, shotId);
    replaceDocument(next);
    if (selectedShotId === shotId) setSelectedShotId(adjacentId);
  }

  function moveShot(direction: 'up' | 'down') {
    const current = documentRef.current;
    const episode = current?.episodes.find((candidate) => candidate.id === current.activeEpisodeId);
    if (!current || !episode || !selectedShotId) return;
    const ordered = episode.scenes.flatMap((scene) => scene.shots);
    const currentIndex = ordered.findIndex((shot) => shot.id === selectedShotId);
    const target = currentIndex + (direction === 'up' ? -1 : 1);
    if (currentIndex < 0 || target < 0 || target >= ordered.length) return;
    const targetShot = ordered[target];
    const targetScene = episode.scenes.find((scene) => scene.shots.some((shot) => shot.id === targetShot.id));
    if (!targetScene) return;
    const remaining = targetScene.shots.filter((shot) => shot.id !== selectedShotId);
    const targetIndex = remaining.findIndex((shot) => shot.id === targetShot.id) + (direction === 'down' ? 1 : 0);
    const next = reorderMotionComicShot(current, episode.id, selectedShotId, targetScene.id, targetIndex);
    replaceDocument(next);
  }

  function reorderTimelineShot(shotId: string, targetShotId: string) {
    const current = documentRef.current;
    const episode = current?.episodes.find((item) => item.id === current.activeEpisodeId);
    if (!current || !episode || shotId === targetShotId) return;
    const ordered = episode.scenes.flatMap((scene) => scene.shots);
    const from = ordered.findIndex((shot) => shot.id === shotId);
    const to = ordered.findIndex((shot) => shot.id === targetShotId);
    const scene = episode.scenes.find((item) => item.shots.some((shot) => shot.id === targetShotId));
    if (from < 0 || to < 0 || !scene) return;
    const index = scene.shots.filter((shot) => shot.id !== shotId).findIndex((shot) => shot.id === targetShotId) + (to > from ? 1 : 0);
    replaceDocument(reorderMotionComicShot(current, episode.id, shotId, scene.id, index));
    setSelectedShotId(shotId);
  }

  function restoreVersion(versionId: string) {
    mutateDocument((current) => restoreMotionComicImageVersion(current, selectedShotId, versionId));
  }

  function toggleConsistencyAsset(asset: DirectorAsset) {
    if (asset.sourceVersionId) {
      restoreVersion(asset.sourceVersionId);
      return;
    }
    mutateDocument(current => toggleMotionComicMakeAsset(current, selectedShotId, asset.id));
  }

  /**
   * Import one or more reference images. Each confirmed image waits in `pending` until the
   * user says what it is for: a look can hold a design sheet plus angles, and guessing the role
   * from the file name would silently change what the provider sees.
   */
  async function importReference(kind: MotionComicReferenceKind, targetId: string, selection?: LibrarySelection) {
    const current = documentRef.current;
    if (!current || referenceAction.busy) return;
    const target = { kind, id: targetId } as const;
    const targetKey = `${kind}:${targetId}`;
    setReferenceTargetId(targetKey);
    const limit = Math.max(1, providerStatus.maxReferenceImages || 6);
    let queued = 0;
    const result = await referenceAction.run(() => withHistoryCapacity({ assets: limit }, async () => {
      const imagePaths = selection ? [selection.imagePath] : await api.selectLocalReferenceImages();
      if (!imagePaths?.length) return { added: 0, failed: 0 };
      const known = new Set([
        ...(pendingReferenceImports[targetKey] ?? []).flatMap((card) => card.paths),
      ]);
      let added = 0;
      let failed = 0;
      for (const imagePath of imagePaths.filter((path): path is string => Boolean(path))) {
        const latestBefore = documentRef.current;
        if (!latestBefore || latestBefore.id !== current.id) throw new Error('AI 漫剧项目已切换，本次参考图未写入其他项目。');
        if (known.has(imagePath)) continue;
        const batch = `${targetKey}:${crypto.randomUUID()}`;
        queued += 1;
        setReferenceImports((items) => ({ ...items, [batch]: (items[batch] ?? 0) + 1 }));
        try {
          // SHA-256 is computed by the main process, so the card identity is never trusted from the draft.
          const sha256 = await api.sha256File(imagePath);
          const imported = await api.addImageLabRecord({
            prompt: `AI 漫剧一致性参考图 · ${referenceTargetLabel(latestBefore, target)}`,
            ratio: latestBefore.ratio,
            style: 'reference',
            provider: 'local-import',
            imagePath,
            resolution: '2K',
            quality: 'high',
            smartMode: 'reference-edit',
            upstreamTaskId: latestBefore.id,
          });
          applyState(imported);
          const recordId = imageLabRecordIdFromMutation(imported);
          const record = await api.getImageLabRecordDetail(recordId);
          if (!record || record.status !== 'generated' || !record.imagePath) throw new Error('参考图已选择，但未能完成托管导入。');
          const latest = documentRef.current;
          if (!latest || latest.id !== current.id) throw new Error('AI 漫剧项目已切换，本次参考图未写入其他项目。');
          const versionId = `motion-comic-reference-${record.id}`;
          const asset = {
            ...createMotionComicReferenceAsset(record, targetId, kind),
            sha256,
            ...(selection?.libraryId && selection.revision ? { librarySource: { id: selection.libraryId, revision: selection.revision } } : {}),
          };
          const next = invalidateMotionComicVideosForChangedInputs(latest, attachMotionComicReference(latest, target, asset, { setFixed: false }));
          setDocument(next);
          documentRef.current = next;
          setDirty(true);
          known.add(imagePath);
          setPendingReferenceImports((items) => ({ ...items, [targetKey]: [...(items[targetKey] ?? []).filter((card) => card.sha256 !== sha256), { sha256, paths: [imagePath], size: 0, versionId }] }));
          added += 1;
        } catch (error) {
          failed += 1;
          if (imagePaths.length === 1) throw error;
        } finally {
          setReferenceImports((items) => {
            const remaining = (items[batch] ?? 1) - 1;
            const next = { ...items };
            if (remaining > 0) next[batch] = remaining;
            else delete next[batch];
            return next;
          });
        }
      }
      return { added, failed };
    }), { successMessage: '参考图已导入。请为每张图选择用途，选好并确认后才会成为固定参考。' });
    if (result.ok && !result.value?.added) referenceAction.clearFeedback();
    if (!result.ok && selection) throw new Error('参考图未能导入，请检查当前项目的操作提示后重试。');
  }

  function generationReferencePaths(current: MotionComicPipelineData, lookId: string): string[] {
    const look = current.characters.flatMap((character) => character.looks).find((item) => item.id === lookId);
    return look?.generationReferenceImagePaths ?? (look ? fixedMotionComicReferenceAssets(current, look.referenceAssetVersionIds).flatMap((asset) => asset.localPath ? [asset.localPath] : []) : []);
  }

  async function importGenerationReferences(projectId: string, lookId: string, selectedPaths?: string[]) {
    const paths = selectedPaths ?? await api.selectLocalReferenceImages();
    if (!paths?.length) return;
    if (documentRef.current?.id !== projectId) throw new Error('项目已切换，请重新选择参考图。');
    mutateDocument((current) => ({ ...current, characters: current.characters.map((character) => ({ ...character, looks: character.looks.map((look) => look.id === lookId ? { ...look, generationReferenceImagePaths: [...new Set([...generationReferencePaths(current, lookId), ...paths])].slice(0, 20) } : look) })) }));
  }

  /** Fixed slots for the board: one pinned image per role, in provider order. */
  function referenceSlots(current: MotionComicPipelineData, versionIds: readonly string[]): Array<{ role: MotionComicReferenceRole; versionId: string }> {
    return fixedMotionComicReferenceAssets(current, versionIds).map((asset) => ({ role: motionComicReferenceRole(asset), versionId: asset.id }));
  }

  function referenceImporting(targetKey: string): number {
    return Object.entries(referenceImports).reduce((total, [key, count]) => (key.startsWith(`${targetKey}:`) ? total + count : total), 0);
  }

  function toggleReferenceCompose(targetKey: string, value: boolean) {
    setReferenceComposeTargets((current) => {
      const next = new Set(current);
      if (value) next.add(targetKey);
      else next.delete(targetKey);
      return next;
    });
  }

  function setReferenceRoleSilent(target: MotionComicReferenceTarget, versionId: string, action: 'unpin') {
    if (action !== 'unpin') return;
    setReferenceTargetId(`${target.kind}:${target.id}`);
    referenceAction.clearFeedback();
    mutateDocument((current) => unpinMotionComicReference(current, target, versionId));
  }

  /** Abandon a just-imported card: nothing stays fixed, so the candidate is simply detached. */
  function discardReferenceImport(target: MotionComicReferenceTarget, versionId: string) {
    setPendingReferenceImports((items) => ({ ...items, [`${target.kind}:${target.id}`]: (items[`${target.kind}:${target.id}`] ?? []).filter((card) => card.versionId !== versionId) }));
    removeReferenceVersion(target, versionId);
  }

  function removeReferenceVersion(target: MotionComicReferenceTarget, versionId: string) {
    setReferenceTargetId(`${target.kind}:${target.id}`);
    referenceAction.clearFeedback();
    mutateDocument((current) => {
      // Detach from this target only; the image and its history stay in the project assets.
      const detach = <T extends { referenceAssetVersionIds: string[] }>(item: T): T => ({ ...item, referenceAssetVersionIds: item.referenceAssetVersionIds.filter((id) => id !== versionId) });
      if (target.kind === 'look') return { ...current, characters: current.characters.map((character) => ({ ...character, looks: character.looks.map((look) => (look.id === target.id ? detach(look) : look)) })) };
      if (target.kind === 'scene') return { ...current, sceneAssets: current.sceneAssets.map((scene) => (scene.id === target.id ? detach(scene) : scene)) };
      return { ...current, props: current.props.map((prop) => (prop.id === target.id ? detach(prop) : prop)) };
    });
  }

  /** Assign a role to a confirmed import; the dialog has already validated the choice. */
  function setReferenceRole(target: MotionComicReferenceTarget, versionId: string, role: MotionComicReferenceRole) {
    setReferenceTargetId(`${target.kind}:${target.id}`);
    referenceAction.clearFeedback();
    mutateDocument((current) => setMotionComicReferenceRole(current, target, versionId, role));
    setPendingReferenceImports((items) => ({ ...items, [`${target.kind}:${target.id}`]: (items[`${target.kind}:${target.id}`] ?? []).filter((card) => card.versionId !== versionId) }));
  }

  // Poll persisted jobs independently of the asset selection and merge into the latest local draft.
  useEffect(() => {
    const projectId = document?.id;
    if (!projectId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const batches = await api.listDirectorBatches({ projectId });
        if (disposed) return;
        const references = batches.filter(batch => batch.plan.purpose === 'reference-generation');
        setReferenceGenerationBatches(references);
        if (references.length) {
          const pending = persistQueueRef.current.then(async () => {
            const baseline = savedDocumentRef.current;
            if (disposed || baseline?.id !== projectId) return;
            const task = await api.getTaskDetail(projectId);
            if (disposed || !task || documentRef.current?.id !== projectId) return;
            const saved = parseMotionComicPipelineData(task.pipelineData);
            if (saved.updatedAt !== baseline.updatedAt) acceptSavedDocument(saved, baseline);
          });
          persistQueueRef.current = pending.then(() => undefined, () => undefined);
          await pending;
        }
      } catch { /* Jobs remain persisted; the next poll retries without resubmitting. */ }
      finally { if (!disposed) timer = setTimeout(() => void poll(), 2000); }
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [api, document?.id]);

  function referenceGenerationPending(target: MotionComicReferenceTarget): boolean {
    const projectId = document?.id;
    return referenceSubmissionRef.current.has(`${projectId}:${target.kind}:${target.id}`)
      || referenceGenerationBatches.some(batch => batch.projectId === projectId
        && ['queued', 'running', 'paused', 'cancelling'].includes(batch.status)
        && batch.nodes.some(node => node.reference?.target.kind === target.kind && node.reference.target.id === target.id
          && ['pending', 'running'].includes(node.status)));
  }

  function referenceGenerationStatus(target: MotionComicReferenceTarget): string | undefined {
    const batches = referenceGenerationBatches.filter(batch => batch.projectId === document?.id
      && batch.nodes.some(node => node.reference?.target.kind === target.kind && node.reference.target.id === target.id));
    const latest = batches.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!latest) return referenceGenerationPending(target) ? '正在提交后台任务…' : undefined;
    const nodes = latest.nodes.filter(node => node.reference?.target.kind === target.kind && node.reference.target.id === target.id);
    const complete = nodes.filter(node => node.reference?.applyState === 'applied').length;
    if (latest.recoveryRequired) return `已完成 ${complete}/${nodes.length}，请在任务中心核对未完成请求。`;
    if (nodes.some(node => node.reference?.applyState === 'stale')) return '资产设定已变化，过期结果保留在图片历史中。';
    if (latest.status === 'failed') return `已完成 ${complete}/${nodes.length}，部分生成失败，请在任务中心查看原因。`;
    if (latest.status === 'cancelled') return `生成已取消，保留已完成的 ${complete} 张候选。`;
    return complete === nodes.length ? `已生成 ${complete} 张候选，待确认用途。` : `后台生成中 ${complete}/${nodes.length}，可继续编辑。`;
  }

  async function generateReference(kind: MotionComicReferenceKind, targetId: string) {
    const current = documentRef.current;
    const target = { kind, id: targetId } as const;
    if (!current || referenceGenerationPending(target)) return;
    const key = `${current.id}:${kind}:${targetId}`;
    referenceSubmissionRef.current.add(key);
    setReferenceTargetId(`${kind}:${targetId}`);
    try {
      await referenceGenerationAction.run(async () => {
        if (!providerStatus.connected) throw new AppError('MOTION_COMIC_IMAGE_PROVIDER_REQUIRED', providerStatus.unavailableReason ?? '请先配置图片模型。');
        return withSavedScriptProject(async saved => {
          if (saved.id !== current.id) throw new Error('项目已切换，请重新提交参考图任务。');
          const batch = await api.submitMotionComicReferenceBatch({ projectId: saved.id, expectedProjectUpdatedAt: saved.updatedAt,
            targets: [target], selectionMode: 'selected', concurrency: kind === 'look' ? 3 : 1,
            composeMultiple: referenceComposeTargets.has(`${kind}:${targetId}`) });
          setReferenceGenerationBatches(items => [batch, ...items.filter(item => item.id !== batch.id)]);
          return batch;
        });
      }, { successMessage: kind === 'look' ? '正面、侧面、背面三张候选已提交后台生成，可继续其他操作。' : '参考图已提交后台生成，可继续其他操作。' });
    } finally { referenceSubmissionRef.current.delete(key); }
  }
  function referenceImageCount(target: MotionComicReferenceTarget): number {
    if (!document) return 0;
    const ids = target.kind === 'look'
      ? document.characters.flatMap((character) => character.looks).find((look) => look.id === target.id)?.referenceAssetVersionIds ?? []
      : target.kind === 'scene' ? document.sceneAssets.find((scene) => scene.id === target.id)?.referenceAssetVersionIds ?? [] : document.props.find((prop) => prop.id === target.id)?.referenceAssetVersionIds ?? [];
    return fixedMotionComicReferenceAssets(document, ids).length;
  }

  function referenceGenerationIssue(target: MotionComicReferenceTarget): string | undefined {
    if (!providerStatus.connected) return providerStatus.unavailableReason;
    try { if (document) motionComicReferenceGenerationInput(document, target, providerStatus); }
    catch (error) { return error instanceof Error ? error.message : '请先完善资产设定。'; }
    return undefined;
  }

  function referenceImportControl(kind: MotionComicReferenceKind, targetId: string, hasVersions: boolean) {
    const active = referenceTargetId === `${kind}:${targetId}`;
    const target = { kind, id: targetId } as const;
    const definitionError = referenceGenerationIssue(target);
    return <>
      <Button density="compact" variant="primary" icon={active && referenceAction.busy ? <Loader2 className="director-spin" size={13} /> : <Sparkles size={13} />}
        aria-label={document ? motionComicReferenceGenerationLabel(document, target) : '生成参考图候选'}
        title={definitionError ?? providerStatus.unavailableReason ?? `使用 ${providerStatus.label} / ${providerStatus.model}，将调用图片服务；仅新增候选，不替换固定版本`}
        disabled={referenceAction.busy || providerAction.busy || !providerStatus.connected || Boolean(definitionError)} onClick={() => void generateReference(kind, targetId)}>生成候选</Button>
      <Button density="compact" variant="secondary" icon={<Upload size={13} />} disabled={referenceAction.busy || providerAction.busy} onClick={() => void importReference(kind, targetId)}>{hasVersions ? '导入新版本' : '导入参考图'}</Button>
      <Button density="compact" variant="subtle" icon={<Images size={13} />} disabled={referenceAction.busy || providerAction.busy} onClick={() => { if (document) setLibraryTarget({ kind, id: targetId, projectId: document.id }); }}>从素材库选择</Button>
    </>;
  }

  function setFixedReference(target: MotionComicReferenceTarget, versionId: string | null) {
    setReferenceTargetId(`${target.kind}:${target.id}`);
    referenceAction.clearFeedback();
    mutateDocument((current) => invalidateMotionComicVideosForChangedInputs(current, setMotionComicFixedReference(current, target, versionId)));
  }

  function markReferenceFileStatus(versionId: string, status: 'ready' | 'error') {
    setBrokenReferenceIds((current) => {
      const next = new Set(current);
      if (status === 'error') next.add(versionId);
      else next.delete(versionId);
      return next;
    });
  }

  async function importSourceFile() {
    const result = await sourceFileAction.run(async () => api.selectMotionComicSourceFile(), { successMessage: '源文件已读取，请确认正文后继续。' });
    if (!result.ok || !result.value) {
      if (result.ok) sourceFileAction.clearFeedback();
      return;
    }
    setCreateSourceFileName(result.value.name);
    setCreateSourceText(result.value.contents);
    episodePlanningRequestRef.current += 1;
    setCreateEpisodeDrafts([]);
    setCreateSplitEvidence(null);
    setCreateSplitWarnings([]);
    episodePlanningAction.clearFeedback();
    if (!createTitle.trim()) setCreateTitle(result.value.name.replace(/\.(?:txt|md)$/iu, ''));
  }

  function setActBoundary(sceneId: string, startsNewAct: boolean) {
    mutateDocument((current) => setMotionComicActBoundary(current, current.activeEpisodeId, sceneId, startsNewAct));
  }

  function renameAct(actIndex: number, title: string) {
    mutateDocument((current) => renameMotionComicAct(current, current.activeEpisodeId, actIndex, title));
  }

  function boundedCreateEpisodeTarget(): number {
    const value = Number(createTargetCharacters);
    return Math.max(500, Math.min(20_000, Number.isFinite(value) ? Math.round(value) : 2_400));
  }

  async function prepareCreateEpisodes(strategy = createSplitStrategy) {
    if (strategy === 'ai-story') {
      const request = ++episodePlanningRequestRef.current;
      const sourceText = createSourceText.trim();
      const durationValue = createTargetDurationSec.trim() ? Number(createTargetDurationSec) : undefined;
      const result = await episodePlanningAction.run(async () => {
        if (!sourceText) throw new Error('请先导入完整原文。');
        if (durationValue !== undefined && (!Number.isInteger(durationValue) || durationValue < 15 || durationValue > 1_800)) {
          throw new Error('每集目标时长需填写 15 至 1800 秒的整数。');
        }
        return api.planMotionComicEpisodes({
          llmProfileId: createModels.llmProfileId,
          sourceText,
          sourceKind: createSourceKind,
          adaptationMode: createAdaptationMode,
          targetCharacters: boundedCreateEpisodeTarget(),
          ...(durationValue === undefined ? {} : { targetDurationSec: durationValue }),
          ...(createSplitInstructions.trim() ? { instructions: createSplitInstructions.trim() } : {}),
        });
      }, { successMessage: 'AI 分集已通过连续覆盖校验，可逐集确认后创建项目。' });
      if (!result.ok || request !== episodePlanningRequestRef.current) {
        if (request !== episodePlanningRequestRef.current) episodePlanningAction.clearFeedback();
        return;
      }
      setCreateEpisodeDrafts(result.value.episodes);
      setCreateSplitEvidence(result.value.evidence);
      setCreateSplitWarnings(result.value.warnings);
      setCreateStep(1);
      return;
    }

    const request = ++episodePlanningRequestRef.current;
    episodePlanningAction.clearFeedback();
    const result = await projectAction.run(async () => {
      const target = boundedCreateEpisodeTarget();
      const ruleStrategy = strategy === 'length' ? 'length' : 'chapter';
      return {
        episodes: splitMotionComicSourceEpisodes(createSourceText, target, ruleStrategy),
        evidence: createMotionComicRuleSplitEvidence({
          sourceText: createSourceText,
          strategy: ruleStrategy,
          targetCharacters: target,
        }),
      };
    });
    if (!result.ok || request !== episodePlanningRequestRef.current) return;
    setCreateEpisodeDrafts(result.value.episodes);
    setCreateSplitEvidence(result.value.evidence);
    const chapterCount = (createSourceText.match(/^\s*(第[^\n]{1,16}[章节集幕回卷]|(?:EP|Episode|Chapter)\s*\d+)\s*[:：.、\-]?/gimu) ?? []).length;
    setCreateSplitWarnings(chapterCount > 100 && strategy === 'chapter'
      ? [`检测到 ${chapterCount} 个章节，已完整拆分为 ${result.value.episodes.length} 集；原文顺序与内容均保留。长篇分集列表可滚动查看，不设固定集数上限。`]
      : []);
    if (result.value.episodes.length > 0) setCreateStep(1);
  }

  function resetCreateSplitPreview(): void {
    episodePlanningRequestRef.current += 1;
    setCreateEpisodeDrafts([]);
    setCreateSplitEvidence(null);
    setCreateSplitWarnings([]);
    episodePlanningAction.clearFeedback();
    projectAction.clearFeedback();
  }

  function changeCreateSplitStrategy(strategy: MotionComicSplitStrategy): void {
    const supportedStrategy = strategy === 'ai-logic' ? 'chapter' : strategy;
    setCreateSplitStrategy(supportedStrategy);
    resetCreateSplitPreview();
    if (supportedStrategy !== 'ai-story' && createSourceText.trim()) void prepareCreateEpisodes(supportedStrategy);
  }

  function changeCreateSourceText(value: string): void {
    setCreateSourceText(value);
    resetCreateSplitPreview();
    sourceFileAction.clearFeedback();
  }

  function changeCreateTargetCharacters(value: string): void {
    setCreateTargetCharacters(value);
    resetCreateSplitPreview();
  }

  function changeCreateTargetDuration(value: string): void {
    setCreateTargetDurationSec(value);
    if (createSplitStrategy === 'ai-story') resetCreateSplitPreview();
  }

  function changeCreateSplitInstructions(value: string): void {
    setCreateSplitInstructions(value);
    if (createSplitStrategy === 'ai-story') resetCreateSplitPreview();
  }

  function updateCreateEpisode(index: number, update: Partial<MotionComicEpisodeDraft>) {
    setCreateEpisodeDrafts((current) => current.map((episode, candidateIndex) => candidateIndex === index ? { ...episode, ...update } : episode));
  }

  function startCreate() {
    void projectLeave.requestLeave(() => startCreateNow());
  }

  function startCreateNow() {
    setOverviewOpen(false);
    projectOpenRequestRef.current += 1;
    planRequestRef.current += 1;
    generationRequestsRef.current.clear();
    setLoadingProjectId('');
    setDocument(null);
    documentRef.current = null;
    setActiveProjectId('');
    setSelectedShotId('');
    setPlanOpen(false);
    setPlanResult(null);
    setPlanningSourceEpisodeId('');
    setWorkflowStage('source');
    setSelectedSourceEpisodeId('');
    setCreateStep(0);
    setCreateTitle('');
    setCreateVisualStyle('');
    setCreateSourceFileName('');
    setCreateSourceText('');
    setCreateTargetCharacters('2400');
    setCreateTargetDurationSec('');
    setCreateSplitInstructions('');
    setCreateSplitStrategy('chapter');
    setCreateEpisodeDrafts([]);
    setCreateSplitEvidence(null);
    setCreateSplitWarnings([]);
    episodePlanningRequestRef.current += 1;
    episodePlanningAction.clearFeedback();
    sourceFileAction.clearFeedback();
    setCreateOpen(true);
  }

  async function createProject() {
    const submittedDraft = creationDraft.snapshot();
    const result = await projectAction.run(async () => {
      const sourceText = createSourceText.trim();
      const episodes = createEpisodeDrafts.filter((episode) => episode.title.trim() && episode.sourceText.trim());
      if (!createTitle.trim() || !sourceText || episodes.length === 0) throw new Error('请先完成源文导入和分集确认。');
      if (createSplitStrategy === 'ai-story' && createSplitEvidence?.strategy !== 'ai-story') throw new Error('请先生成并确认通过校验的 AI 分集方案。');
      const splitEvidence = createSplitEvidence ?? createMotionComicRuleSplitEvidence({
        sourceText,
        strategy: createSplitStrategy === 'length' ? 'length' : 'chapter',
        targetCharacters: boundedCreateEpisodeTarget(),
      });
      const premise = sourceText.replace(/\s+/gu, ' ').slice(0, 800);
      const mutation = await api.createMotionComic({
        projectModels: createModels,
        title: createTitle,
        premise,
        ratio: createRatio,
        ...(createVisualStyle.trim() ? { visualStyle: createVisualStyle.trim() } : {}),
        source: {
          kind: createSourceKind,
          adaptationMode: createAdaptationMode,
          ...(createSourceFileName ? { fileName: createSourceFileName } : {}),
          originalText: sourceText,
          episodes,
          splitEvidence,
        },
      });
      applyState(mutation);
      if (!mutation || mutation.kind !== 'task-upsert') throw new Error('AI 漫剧项目已保存，但未返回可打开的任务记录。');
      const task = await api.getTaskDetail(mutation.task.id);
      if (!task) throw new Error('AI 漫剧项目已创建，但无法重新读取。');
      return { id: task.id, document: parseMotionComicPipelineData(task.pipelineData) };
    }, { successMessage: '源文和分集方案已保存，可开始逐集结构化。' });
    if (!result.ok) return;
    if (!creationDraft.complete(submittedDraft)) return;
    setActiveProjectId(result.value.id);
    setDocument(result.value.document);
    documentRef.current = result.value.document;
    savedDocumentRef.current = result.value.document;
    setSelectedShotId(result.value.document.episodes[0]?.scenes[0]?.shots[0]?.id ?? '');
    setSelectedSourceEpisodeId(result.value.document.sourceDocument?.episodes[0]?.id ?? '');
    setWorkflowStage('episodes');
    setCreateTitle('');
    setCreateVisualStyle('');
    setCreateSourceFileName('');
    setCreateSourceText('');
    setCreateTargetCharacters('2400');
    setCreateTargetDurationSec('');
    setCreateSplitInstructions('');
    setCreateSplitStrategy('chapter');
    setCreateEpisodeDrafts([]);
    setCreateSplitEvidence(null);
    setCreateSplitWarnings([]);
    episodePlanningAction.clearFeedback();
    sourceFileAction.clearFeedback();
    setCreateStep(0);
    setCreateOpen(false);
    setDirty(false);
  }

  async function persistProject(nextDocument: MotionComicPipelineData, baseline = nextDocument): Promise<MotionComicPipelineData> {
    let candidate = nextDocument;
    let knownSaved = savedDocumentRef.current?.id === candidate.id ? savedDocumentRef.current : null;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const mutation = await api.saveMotionComic({ id: candidate.id, expectedUpdatedAt: candidate.updatedAt, document: candidate });
        applyState(mutation);
        const task = await api.getTaskDetail(candidate.id);
        if (!task) throw new Error('AI 漫剧项目保存后无法重新读取。');
        const saved = parseMotionComicPipelineData(task.pipelineData);
        acceptSavedDocument(saved, baseline);
        return saved;
      } catch (error) {
        if (!String(error).includes('MOTION_COMIC_STALE_WRITE') || !knownSaved || attempt === 7) throw error;
        const task = await api.getTaskDetail(candidate.id);
        if (!task) throw error;
        const remote = parseMotionComicPipelineData(task.pipelineData);
        // Rebase this save, preserving its edits and remote candidate additions. Newer typing
        // stays in documentRef and is reconciled by acceptSavedDocument after the save.
        candidate = mergeMotionComicSavedDocument(candidate, knownSaved, remote);
        knownSaved = remote;
      }
    }
    throw new Error('AI 漫剧项目保存冲突，请重试。');
  }

  function acceptSavedDocument(saved: MotionComicPipelineData, submitted: MotionComicPipelineData) {
    const live = documentRef.current;
    if (live?.id === submitted.id) {
      const next = mergeMotionComicSavedDocument(live, submitted, saved, savedDocumentRef.current ?? undefined);
      savedDocumentRef.current = saved;
      setDocument(next);
      documentRef.current = next;
      setDirty(next !== saved);
    }
  }

  function enqueueProjectMutation(
    projectId: string,
    update: (current: MotionComicPipelineData) => MotionComicPipelineData,
    optimistic = true,
  ): Promise<MotionComicPipelineData> {
    const pending = persistQueueRef.current.then(async () => {
      const latest = documentRef.current;
      if (!latest || latest.id !== projectId) throw new Error('AI 漫剧项目已切换，本次生成结果未写入其他项目。');
      const next = update(latest);
      if (optimistic) {
        documentRef.current = next;
        setDocument(next);
        setDirty(true);
      }
      return persistProject(next, optimistic ? next : latest);
    });
    persistQueueRef.current = pending.then(() => undefined, () => undefined);
    return pending;
  }

  function withSavedScriptProject<T>(operation: (current: MotionComicPipelineData) => Promise<T>): Promise<T> {
    const projectId = documentRef.current?.id;
    const pending = persistQueueRef.current.then(async () => {
      let current = documentRef.current;
      if (!current || current.id !== projectId) throw new Error('项目已切换，请重新提交剧本操作。');
      if (JSON.stringify(current) !== JSON.stringify(savedDocumentRef.current)) current = await persistProject(current);
      if (documentRef.current?.id !== projectId) throw new Error('项目已切换，未向其他项目提交任务。');
      return operation(current);
    });
    persistQueueRef.current = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async function applyScriptStoryboard(input: { taskId: string; outputRevision: number; reviewedAdjustments: boolean }): Promise<void> {
    await withSavedScriptProject(async (submitted) => {
      const mutation = await api.applyMotionComicScriptStoryboard({ ...input, id: submitted.id, expectedUpdatedAt: submitted.updatedAt });
      applyState(mutation);
      const task = await api.getTaskDetail(submitted.id);
      if (!task) throw new Error('分镜已应用，但项目暂时无法重新读取，请重新打开项目。');
      const saved = parseMotionComicPipelineData(task.pipelineData);
      acceptSavedDocument(saved, submitted);
      if (documentRef.current?.id !== submitted.id) return;
      const episode = saved.episodes.find((episode) => episode.id === saved.activeEpisodeId);
      setSelectedSourceEpisodeId(episode ? motionComicSourceEpisodeIdForEpisode(saved, episode) ?? '' : '');
      setSceneSourcePreviewId('');
      setSelectedShotId(episode?.scenes[0]?.shots[0]?.id ?? '');
      setWorkflowStage('scenes');
    });
  }

  async function approveScripts(revisions: Array<{ taskId: string; outputRevision: number }>) {
    return withSavedScriptProject(async (submitted) => {
      const snapshot = await api.approveMotionComicScripts({ id: submitted.id, expectedUpdatedAt: submitted.updatedAt, revisions });
      const task = await api.getTaskDetail(submitted.id);
      if (!task) throw new Error('资产已确认，但项目暂时无法重新读取，请重新打开项目。');
      acceptSavedDocument(parseMotionComicPipelineData(task.pipelineData), submitted);
      return snapshot;
    });
  }

  async function adoptVideoVersion(episodeId: string, shotId: string, versionId: string): Promise<void> {
    const current = documentRef.current;
    if (!current) throw new Error('项目已关闭，请重新打开。');
    // Validate before reading, then repeat against the latest queued document.
    adoptMotionComicVideoVersion(current, episodeId, shotId, versionId);
    const path = current.assets.find(asset => asset.id === versionId)!.localPath!;
    const mediaUrl = await api.getTaskMediaUrl(current.id, path);
    if (!mediaUrl) throw new Error('本地视频文件不可读取，未采用该候选。');
    await enqueueProjectMutation(current.id, latest => {
      if (latest.assets.find(asset => asset.id === versionId)?.localPath !== path) throw new Error('候选文件已变化，请重新预览后采用。');
      return adoptMotionComicVideoVersion(latest, episodeId, shotId, versionId);
    }, false);
  }

  async function saveProject() {
    const current = documentRef.current;
    if (!current) return false;
    const result = await projectAction.run(async () => {
      return enqueueProjectMutation(current.id, (latest) => latest);
    }, { successMessage: 'AI 漫剧项目已保存。' });
    return result.ok && documentRef.current === result.value;
  }

  async function reviewQualityArtifact(input: DirectorQualityArtifactRequest): Promise<DirectorQualityArtifactResult> {
    const pending = persistQueueRef.current.then(async () => {
      const current = documentRef.current;
      const baseline = savedDocumentRef.current;
      if (!current || current.id !== input.id || baseline?.id !== input.id) throw new Error('项目已切换，请重新打开审片报告。');
      const result = await api.reviewDirectorArtifact({ ...input, expectedUpdatedAt: baseline.updatedAt });
      if (result.document.workflowKind !== 'motion-comic') throw new Error('审片项目类型不一致。');
      acceptSavedDocument(result.document, baseline);
      return result;
    });
    persistQueueRef.current = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async function recheckSubtitles(input: DirectorSubtitleRecheckRequest) {
    const current = documentRef.current;
    if (!current || current.id !== input.id) throw new Error('请先打开当前 AI 漫剧项目。');
    const result = await projectAction.run(() => api.recheckDirectorSubtitles({ ...input, episodeId: current.activeEpisodeId, expectedUpdatedAt: current.updatedAt }), { successMessage: '字幕局部复检已完成。' });
    if (!result.ok) throw result.error ?? new Error('字幕局部复检失败。');
    const task = await api.getTaskDetail(current.id);
    if (!task) throw new Error('字幕复检已完成，但项目无法重新读取。');
    acceptSavedDocument(parseMotionComicPipelineData(task.pipelineData), current);
  }

  async function recheckMedia(input: DirectorMediaRecheckRequest) {
    const current = documentRef.current;
    if (!current || current.id !== input.id) throw new Error('请先打开当前 AI 漫剧项目。');
    const result = await projectAction.run(() => api.recheckDirectorMedia({ ...input, episodeId: current.activeEpisodeId, expectedUpdatedAt: current.updatedAt }), { successMessage: '媒体局部复检已完成。' });
    if (!result.ok) throw result.error ?? new Error('媒体局部复检失败。');
    const task = await api.getTaskDetail(current.id);
    if (!task) throw new Error('媒体复检已完成，但项目无法重新读取。');
    acceptSavedDocument(parseMotionComicPipelineData(task.pipelineData), current);
  }

  async function generateShot(shotId: string) {
    const current = documentRef.current;
    const shot = shots.find((candidate) => candidate.id === shotId);
    if (!current || !shot) throw new Error('当前 AI 漫剧镜头不存在。');
    if (!providerStatus.connected) throw new Error(providerStatus.unavailableReason ?? '图片服务未配置。');
    if (!providerStatus.supportsReferenceImages) throw new Error(`${providerStatus.label} 不支持参考图编辑，请先切换生成服务。`);
    const sourceShot = current.episodes.flatMap((episode) => episode.scenes.flatMap((scene) => scene.shots)).find((candidate) => candidate.id === shotId);
    if (!sourceShot) throw new Error('当前 AI 漫剧镜头不存在。');
    const consistencyCheck = inspectMotionComicShotConsistency(current, sourceShot);
    if (!consistencyCheck.ready) {
      const detail = consistencyCheck.missingTargets.length > 0 ? consistencyCheck.missingTargets.join('、') : '固定参考图未就绪';
      throw new Error(`请先完成当前镜头的一致性素材：${detail}。`);
    }
    if (consistencyCheck.fixedReferenceCount > providerStatus.maxReferenceImages) {
      throw new Error(`当前镜头需要 ${consistencyCheck.fixedReferenceCount} 张参考图，但 ${providerStatus.label} 最多支持 ${providerStatus.maxReferenceImages} 张。`);
    }
    const input = directorImageInput(current, shotId);
    const referenceImagePaths = input.references.map((reference) => reference.path);
    if (referenceImagePaths.length === 0) throw new Error('当前镜头没有可用的固定参考图。');
    const recordId = `director-comic-${crypto.randomUUID()}`;
    const requestKey = `image:${shotId}`;
    generationRequestsRef.current.set(requestKey, recordId);
    for (const path of referenceImagePaths) {
      try {
        await api.readAssetDataUrl(path);
      } catch {
        throw new Error(`固定参考图文件不可用：${path}`);
      }
    }
    if (generationRequestsRef.current.get(requestKey) !== recordId || !documentRef.current || !directorImageInputMatches(documentRef.current, input)) {
      throw new AppError('DIRECTOR_IMAGE_INPUT_CHANGED', '镜头输入已修改，请确认后重新生成。');
    }
    let generationError: unknown = null;
    try {
      const mutation = await api.generateImageLab({
        upstreamTaskId: current.id,
        id: recordId,
        prompt: input.prompt,
        ratio: input.ratio,
        style: 'cinematic',
        provider: providerStatus.provider,
        resolution: providerStatus.resolution,
        quality: providerStatus.quality,
        smartMode: 'reference-edit',
        referenceImagePath: referenceImagePaths[0],
        referenceImagePaths,
      });
      applyState(mutation);
    } catch (error) {
      generationError = error;
    }

    const record = await api.getImageLabRecordDetail(recordId);
    let inputChanged = false;
    if (record) {
      await enqueueProjectMutation(current.id, (latest) => {
        const isCurrentRequest = generationRequestsRef.current.get(requestKey) === recordId;
        inputChanged = !isCurrentRequest || !directorImageInputMatches(latest, input);
        return applyMotionComicImageRecord(latest, shotId, record, providerStatus.model, input, isCurrentRequest);
      });
    }
    if (record?.status === 'failed' && record.errorMessage) {
      throw new AppError('DIRECTOR_IMAGE_GENERATION_FAILED', record.errorMessage);
    }
    if (generationError) throw generationError;
    if (!record || record.status !== 'generated' || !record.imagePath) {
      throw new AppError('DIRECTOR_IMAGE_GENERATION_FAILED', '图片服务没有返回可用的关键帧文件。');
    }
    if (inputChanged) throw new AppError('DIRECTOR_IMAGE_INPUT_CHANGED', '镜头输入或固定参考已修改：生成图片保留在历史中，未替换当前关键帧。');
    return { thumbnail: toLocalImageUrl(record.imagePath), provider: `${providerStatus.label} / ${providerStatus.model}` };
  }

  async function generateVoice(shotId: string, cueId?: string) {
    const current = documentRef.current;
    const shot = shots.find((candidate) => candidate.id === shotId);
    if (!current || !shot) throw new Error('当前 AI 漫剧镜头不存在。');
    if (!voiceStatus.connected) throw new Error(voiceStatus.unavailableReason ?? '旁白服务未配置。');
    if (!shot.subtitle.trim()) throw new Error('当前镜头没有可生成的对白文本。');
    const cues = motionComicDialogueCuesToGenerate(current, shotId, cueId);
    if (cues.length === 0) throw new Error('当前镜头没有可生成的对白文本。');
    const inputs = cues.map((cue) => motionComicDialogueInput(current, shotId, cue.id, voiceStatus));
    return withHistoryCapacity({ assets: inputs.length, providerJobs: inputs.length }, async (reservation) => {
      let latestAudioUrl: string | undefined;
      let firstError: Error | undefined;
      // Keep cue generation and persistence ordered while holding the remaining capacity.
      for (let inputIndex = 0; inputIndex < inputs.length; inputIndex += 1) {
        const input = inputs[inputIndex];
        if (!documentRef.current || !motionComicDialogueInputMatches(documentRef.current, input)) throw new Error('项目或对白已修改，已停止后续配音。请确认后重新生成。');
        const recordId = `director-comic-voice-${crypto.randomUUID()}`;
        try {
          applyState(await api.generateVoiceLabPreview({
            id: recordId,
            text: input.text,
            provider: input.provider,
            voiceId: input.voiceId,
            voiceLabel: voiceStatus.voices.find((voice) => voice.value === input.voiceId)?.label ?? input.voiceId,
            speed: input.speed,
          }));
        } catch (error) {
          firstError ??= error instanceof Error ? error : new Error(String(error));
        }
        const record = await api.getVoiceLabRecordDetail(recordId);
        if (record) {
          let measuredDurationMs: number | undefined;
          if (record.status === 'generated' && record.audioPath) {
            try {
              measuredDurationMs = await readDirectorSoundDuration(record.audioPath);
            } catch (error) {
              firstError ??= new Error(`对白音频时长探测失败，未绑定到当前对白：${error instanceof Error ? error.message : String(error)}`);
            }
          }
          if (firstError) break;
          let inputChanged = false;
          await enqueueProjectMutation(current.id, (latest) => {
            inputChanged = !motionComicDialogueInputMatches(latest, input);
            // Only advance snapshots that still match before our own timing fit.
            // Real edits made while the request was running must remain stale.
            const next = applyMotionComicVoiceRecord(latest, shotId, record, voiceStatus.model, input.cueId, input, measuredDurationMs);
            if (!inputChanged) {
              const remaining = refreshMotionComicDialogueInputsAfterTiming(latest, next, inputs.slice(inputIndex + 1));
              inputs.splice(inputIndex + 1, remaining.length, ...remaining);
            }
            return next;
          });
          reservation.consume({ assets: record.status === 'generated' && record.audioPath ? 1 : 0, providerJobs: 1 });
          if (inputChanged) throw new Error('对白已修改：生成音频保留在历史中，未绑定到新对白。');
          if (record.status === 'generated' && record.audioPath) latestAudioUrl = toLocalAssetUrl(record.audioPath);
          if (record.status !== 'generated') firstError ??= new Error(record.errorMessage || '对白音频生成失败。');
        } else {
          firstError ??= new Error('旁白服务没有返回可用音频记录。');
        }
        if (firstError) break;
      }
      if (firstError) throw firstError;
      if (!latestAudioUrl) throw new Error('旁白服务没有返回可用音频。');
      return { audioUrl: latestAudioUrl, provider: `${voiceStatus.label} / ${voiceStatus.model}` };
    });
  }

  function generateVideo(shotId: string, adoption: 'automatic', resumeOnly: true): Promise<void>;
  function generateVideo(shotId: string, adoption?: 'automatic'): Promise<DirectorVideoResult>;
  function generateVideo(shotId: string, adoption: 'candidate'): Promise<void>;
  async function generateVideo(shotId: string, adoption: 'candidate' | 'automatic' = 'candidate', resumeOnly = false): Promise<DirectorVideoResult | void> {
    const projectId = documentRef.current?.id;
    if (!projectId) throw new Error('当前 AI 漫剧项目不存在。');
    const requestKey = `${projectId}:${shotId}`;
    if (videoRequestsRef.current.has(requestKey)) throw new Error('该镜头已有视频任务正在执行，请勿重复提交。');
    videoRequestsRef.current.add(requestKey);
    const openRequest = projectOpenRequestRef.current;
    const pending = persistQueueRef.current.then(async () => {
      const latest = documentRef.current;
      if (!latest || latest.id !== projectId || projectOpenRequestRef.current !== openRequest) throw new Error('AI 漫剧项目已切换，本次视频生成已取消。');
      const sourceShot = latest.episodes.flatMap((episode) => episode.scenes.flatMap((scene) => scene.shots)).find((shot) => shot.id === shotId);
      if (!sourceShot) throw new Error('当前 AI 漫剧镜头不存在。');
      if (sourceShot.renderStrategy !== 'remote-video') throw new Error('当前镜头使用图片运镜，无需调用远程视频服务。');
      const latestVideoJob = latestProductionProviderJob(latest.providerJobs, shotId, 'image-to-video', sourceShot.episodeId);
      if (resumeOnly && (!latestVideoJob || !['running', 'failed'].includes(latestVideoJob.status) || !latestVideoJob.remoteTaskId)) {
        throw new Error('原视频任务已变化或缺少云端任务 ID，不能恢复查询；本次不会重新提交生成。');
      }
      const effectiveAdoption = resumeOnly ? latestVideoJob?.videoAdoption ?? 'automatic' : adoption;
      if (!resumeOnly && adoption === 'candidate' && latest.providerJobs.some(job => job.nodeId === shotId && job.episodeId === sourceShot.episodeId
        && job.capability === 'image-to-video' && !['completed', 'failed', 'cancelled'].includes(job.status))) {
        throw new Error('已有视频任务正在执行或结果尚未确认，请先核对任务状态，勿重复提交。');
      }
      const current = await persistProject(latest);
      // Saving re-reads the document: a concurrent completion must never turn recovery into a new POST.
      const persistedVideoJob = latestProductionProviderJob(current.providerJobs, shotId, 'image-to-video', sourceShot.episodeId);
      if (resumeOnly) assertMotionComicVideoRecovery(persistedVideoJob, latestVideoJob);
      if (documentRef.current?.id !== projectId || projectOpenRequestRef.current !== openRequest) throw new Error('项目已切换，本次视频生成已取消。');
      const knownJobs = new Set(current.providerJobs.map(job => job.id));
      let recordingActive = true;
      const { completion } = await startRecordedVideoRequest({
        start: () => resumeOnly
          ? api.resumeDirectorShotVideo({ id: current.id, shotId, expectedUpdatedAt: current.updatedAt, adoption: effectiveAdoption })
          : api.generateDirectorShotVideo({ id: current.id, shotId, expectedUpdatedAt: current.updatedAt, adoption: effectiveAdoption }),
        isRecorded: async () => {
          if (resumeOnly) return true;
          const task = await api.getTaskDetail(projectId);
          if (!task) return false;
          const saved = parseMotionComicPipelineData(task.pipelineData);
          const recorded = saved.providerJobs.some(job => !knownJobs.has(job.id) && job.nodeId === shotId && job.capability === 'image-to-video');
          if (recordingActive && recorded && documentRef.current?.id === projectId && projectOpenRequestRef.current === openRequest) acceptSavedDocument(saved, current);
          return recorded;
        },
      });
      recordingActive = false;
      return { current, effectiveAdoption, completion };
    });
    persistQueueRef.current = pending.then(() => undefined, () => undefined);
    try {
      const { current, effectiveAdoption, completion } = await pending;
      const refreshResult = () => {
        const refresh = persistQueueRef.current.then(async () => {
          const task = await api.getTaskDetail(projectId);
          if (!task) throw new Error('远程镜头视频已生成，但项目无法重新读取。');
          const saved = parseMotionComicPipelineData(task.pipelineData);
          if (documentRef.current?.id === projectId && projectOpenRequestRef.current === openRequest) acceptSavedDocument(saved, current);
          return saved;
        });
        persistQueueRef.current = refresh.then(() => undefined, () => undefined);
        return refresh;
      };
      try {
        const response = await completion;
        applyState(response.mutation);
        const saved = await refreshResult();
        const asset = saved.assets.find((candidate) => candidate.id === response.result.videoAssetVersionId && candidate.kind === 'video');
        if (!asset?.localPath) throw new Error('远程视频任务完成，但没有返回可播放的视频资产。');
        // Candidate generation refreshes history only; never hand its URL to the current preview.
        if (resumeOnly || effectiveAdoption === 'candidate') return;
        return {
          videoUrl: toLocalAssetUrl(asset.localPath),
          provider: response.result.providerName,
          model: response.result.model,
          estimatedCost: response.result.estimatedCost,
          jobId: response.result.videoJobId,
        };
      } catch (error) {
        await refreshResult().catch(() => undefined);
        throw error;
      }
    } finally {
      videoRequestsRef.current.delete(requestKey);
    }
  }

  async function renderProject() {
    if (renderPendingRef.current) return;
    renderPendingRef.current = true;
    setRendering(true);
    try {
      await persistQueueRef.current;
      let current = documentRef.current;
      if (!current) throw new Error('当前 AI 漫剧项目不存在。');
      if (current !== savedDocumentRef.current) current = await enqueueProjectMutation(current.id, (latest) => latest);
      const response = await api.renderDirectorProject({ id: current.id, episodeId: current.activeEpisodeId });
      applyState(response.mutation);
      const task = await api.getTaskDetail(current.id);
      if (!task) throw new Error('AI 漫剧成片已生成，但项目无法重新读取。');
      const saved = parseMotionComicPipelineData(task.pipelineData);
      acceptSavedDocument(saved, current);
      if (documentRef.current?.id === current.id) setWorkflowStage('export');
    } finally {
      renderPendingRef.current = false;
      setRendering(false);
    }
  }

  if (loadingProjectId) return <div data-motion-comic-workbench="true"><DirectorProjectLoading mode="motion-comic" /></div>;

  if (createOpen) {
    return <div data-motion-comic-workbench="true"><MotionComicCreateFlow
      models={<ProjectModelFields config={state.config} value={createModels} onChange={setCreateModels} disabled={projectAction.busy} />}
      services={[
        { id: 'image', label: '参考图与分镜图', model: `${providerStatus.label} · ${providerStatus.model}`, ready: providerStatus.connected && providerStatus.supportsReferenceImages, detail: providerStatus.unavailableReason || '需要支持参考图编辑的图片模型。', onConfigure: () => openSettings?.('image', 'motion-comic') },
        { id: 'video', label: '远程视频', model: selectedVideoProviderStatus.model, ready: selectedVideoProviderStatus.connected, detail: selectedVideoProviderStatus.unavailableReason, onConfigure: () => openSettings?.('video', 'motion-comic') },
        { id: 'voice', label: '角色配音', model: voiceStatus.label, ready: voiceStatus.connected, detail: voiceStatus.unavailableReason, onConfigure: () => openSettings?.('tts', 'motion-comic') },
      ]}
      step={createStep}
      title={createTitle}
      visualStyle={createVisualStyle}
      onVisualStyleChange={setCreateVisualStyle}
      ratio={createRatio}
      sourceKind={createSourceKind}
      adaptationMode={createAdaptationMode}
      sourceFileName={createSourceFileName}
      sourceText={createSourceText}
      targetCharacters={createTargetCharacters}
      targetDurationSec={createTargetDurationSec}
      splitInstructions={createSplitInstructions}
      splitStrategy={createSplitStrategy}
      splitEvidence={createSplitEvidence}
      splitWarnings={createSplitWarnings}
      onSplitStrategyChange={changeCreateSplitStrategy}
      episodes={createEpisodeDrafts}
      busy={projectAction.busy || sourceFileAction.busy || episodePlanningAction.busy}
      feedback={sourceFileAction.feedback?.tone === 'success' ? sourceFileAction.feedback.message : episodePlanningAction.feedback?.tone === 'success' ? episodePlanningAction.feedback.message : projectAction.feedback?.tone === 'success' ? projectAction.feedback.message : undefined}
      errorMessage={actionError}
      onStepChange={setCreateStep}
      onTitleChange={(value) => { setCreateTitle(value); projectAction.clearFeedback(); }}
      onRatioChange={setCreateRatio}
      onSourceKindChange={(value) => {
        setCreateSourceKind(value);
        setCreateAdaptationMode(value === 'novel' ? 'novel-adaptation' : 'faithful-script');
        if (createSplitStrategy === 'ai-story') resetCreateSplitPreview();
      }}
      onAdaptationModeChange={(value) => {
        setCreateAdaptationMode(value);
        if (createSplitStrategy === 'ai-story') resetCreateSplitPreview();
      }}
      onSourceTextChange={changeCreateSourceText}
      onTargetCharactersChange={changeCreateTargetCharacters}
      onTargetDurationSecChange={changeCreateTargetDuration}
      onSplitInstructionsChange={changeCreateSplitInstructions}
      onEpisodeChange={updateCreateEpisode}
      onImportFile={() => void importSourceFile()}
      onPrepareEpisodes={() => void prepareCreateEpisodes()}
      onCreate={() => void createProject()}
    /></div>;
  }

  if (!document) return <div data-motion-comic-workbench="true"><DirectorProjectRecovery mode="motion-comic" errorMessage={actionError} onNewProject={startCreate} /></div>;

  const projectAssetItems = (assetSection === 'characters' ? document.characters.map((item) => ({ id: item.id, label: item.name, detail: `${item.looks.length} 个造型`, search: `${item.name} ${(item.aliases ?? []).join(' ')}` }))
    : assetSection === 'scenes' ? document.sceneAssets.map((item) => ({ id: item.id, label: item.label, detail: item.description, search: item.label }))
      : assetSection === 'props' ? document.props.map((item) => ({ id: item.id, label: item.label, detail: item.description, search: item.label })) : [])
    .filter((item) => item.search.toLocaleLowerCase().includes(assetQuery.trim().toLocaleLowerCase()));
  const selectedProjectAssetId = projectAssetItems.find((item) => item.id === selectedProjectAssets[assetSection])?.id ?? projectAssetItems[0]?.id;
  const assetUsage = assetSection !== 'series' && selectedProjectAssetId ? <MotionComicAssetUsage
    api={api} document={document} target={{ kind: assetSection === 'characters' ? 'character' : assetSection === 'scenes' ? 'scene' : 'prop', id: selectedProjectAssetId }}
    busy={referenceAction.busy || projectAction.busy} onOpen={openAssetUsage}
  /> : null;

  const taskView = buildMotionComicTaskViewModel({ project: document, scriptSnapshot: taskSnapshot.scripts, referenceBatches: taskSnapshot.batches });
  function navigateTask(target: MotionComicTaskNavigation) {
    if (scriptDraftGuardRef.current?.() === false) return;
    setOverviewOpen(false);
    if (target.kind === 'script') { setSelectedSourceEpisodeId(target.sourceEpisodeId); setWorkflowStage('episodes'); }
    else if (target.kind === 'episode') { selectEpisode(target.episodeId); setWorkflowStage(target.stage === 'storyboard' ? 'storyboard' : target.stage); }
    else {
      setWorkflowStage('assets');
      if (target.target) {
        const item = target.target;
        const section = item.kind === 'look' ? 'characters' : item.kind === 'scene' ? 'scenes' : 'props';
        const id = item.kind === 'look' ? documentRef.current?.characters.find(character => character.looks.some(look => look.id === item.id))?.id : item.id;
        setAssetSection(section); setAssetQuery('');
        if (id) { setSelectedProjectAssets(current => ({ ...current, [section]: id })); setAssetDisplay('detail'); }
      }
    }
    setTasksOpen(false);
  }
  const taskDrawer = <MotionComicTaskDrawer open={tasksOpen} onOpenChange={setTasksOpen} items={taskView.items} loading={taskSnapshot.loading} error={taskSnapshot.error} projectTitle={document.title} resolveUrl={path => api.getTaskMediaUrl(document.id, path)} onNavigate={navigateTask} />;
  const modelLocked = rendering || taskView.items.some(item => ['running', 'queued', 'paused', 'cancelling', 'unknown'].includes(item.status));
  const taskButton = <Button density="compact" variant="subtle" icon={<Layers3 size={14} />} aria-label={`后台任务${taskView.counts.total ? `，${taskView.counts.total} 条` : ''}`} onClick={() => setTasksOpen(true)}>后台任务{taskView.counts.total ? <span className="comic-task-count">{taskView.counts.total}</span> : null}</Button>;
  /**
   * Switching the project LLM only affects work submitted afterwards, but an approved script
   * whose storyboard has not been generated yet will be produced by the new runtime. Say so
   * at the moment of the switch instead of blocking the storyboard button later.
   */
  async function confirmLlmChange(nextProfileId: string): Promise<boolean> {
    if (!document?.id) return true;
    let snapshot: MotionComicScriptSnapshot | undefined = taskSnapshot.scripts;
    if (!snapshot) { try { snapshot = await api.getMotionComicScripts(document.id); } catch { return true; } }
    const affected = snapshot.tasks
      .filter(task => task.status === 'approved' && task.storyboardStatus !== 'ready')
      .map(task => {
        const episode = document.sourceDocument?.episodes.find(item => item.id === task.sourceEpisodeId);
        return episode ? `第 ${episode.number} 集 · ${episode.title}` : task.sourceEpisodeId;
      });
    if (!affected.length) return true;
    return new Promise<boolean>(resolve => setLlmSwitchPrompt({ nextProfileId, resolve, affected }));
  }
  /** Single project header: models + tasks live beside save, not in an extra row. */
  const headerActions = <><ProjectModelBar inline task={projectTask} config={state.config} api={api} onUpdated={applyState} disabled={modelLocked} confirmLlmChange={confirmLlmChange} />{taskButton}{taskDrawer}</>;
  const projectControls = <div className="comic-project-controls"><ProjectModelBar inline task={projectTask} config={state.config} api={api} onUpdated={applyState} disabled={modelLocked} confirmLlmChange={confirmLlmChange} />{taskButton}{taskDrawer}</div>;

  const selectedCharacter = assetSection === 'characters' ? document.characters.find((item) => item.id === selectedProjectAssetId) : undefined;
  /** One canonical look selection per character; falls back to the first look. */
  const selectedCharacterLookId = selectedCharacter
    ? (selectedCharacter.looks.some((look) => look.id === activeLookIds[selectedCharacter.id]) ? activeLookIds[selectedCharacter.id] : selectedCharacter.looks[0]?.id)
    : undefined;
  const selectedLook = selectedCharacter?.looks.find((look) => look.id === selectedCharacterLookId);
  /** Background reference batch state for the focused target, straight from the task snapshot. */
  const activeReferenceJob = document && referenceTargetId ? referenceJobFor(document, referenceTargetId, taskSnapshot.batches) : null;
  const removalPlan = assetRemoval ? planMotionComicAssetRemoval(document, assetRemoval.target) : null;

  const assetCreateDialog = assetCreate ? <MotionComicAssetCreateDialog
    open kind={assetCreate.kind} characterId={assetCreate.characterId}
    characterName={document.characters.find(item => item.id === assetCreate.characterId)?.name}
    busy={projectAction.busy || referenceAction.busy}
    onOpenChange={open => { if (!open) setAssetCreate(null); }}
    onSubmit={input => {
      if (documentRef.current?.id !== assetCreate.projectId) throw new Error('项目已切换，请重新打开新增窗口。');
      if (!input.name.trim()) throw new Error('请填写名称。');
      if (input.kind === 'character') addCharacterAsset(input);
      else if (input.kind === 'scene') addSceneAsset(input);
      else if (input.kind === 'prop') addPropAsset(input);
      else { if (!assetCreate.characterId) throw new Error('请先选择人物。'); addCharacterLook(assetCreate.characterId, input); }
    }}
  /> : null;

  const libraryPicker = libraryTarget ? <LibraryPicker api={api} kind="image" title="选择项目参考图" actionLabel="导入为候选" onClose={() => setLibraryTarget(null)} onChoose={async (selection) => {
    if (documentRef.current?.id !== libraryTarget.projectId) throw new Error('项目已切换，请重新选择参考目标。');
    if (!selection.imagePath) throw new Error('所选素材没有可用图片，请重新选择。');
    if (libraryTarget.kind === 'look') await importGenerationReferences(libraryTarget.projectId, libraryTarget.id, [selection.imagePath]);
    else await importReference(libraryTarget.kind, libraryTarget.id, selection);
  }} /> : null;

  const assetRemoveDialog = assetRemoval ? <MotionComicAssetRemoveDialog
    open
    label={assetRemoval.kind === 'character' ? '人物' : assetRemoval.kind === 'look' ? '造型' : assetRemoval.kind === 'scene' ? '地点' : '道具'}
    name={assetRemoval.name}
    impact={assetRemoval.kind === 'character' || assetRemoval.kind === 'look'
      ? '删除后该造型不再出现在分镜绑定与参考图生成中。'
      : '删除后该资产不再出现在资产总览与分镜选择中。'}
    notes={removalPlan?.notes}
    blockedReason={removalPlan?.blocker?.message}
    busy={removingAsset}
    onOpenChange={(open) => { if (!open && !removingAsset) setAssetRemoval(null); }}
    onConfirm={() => void confirmRemoveAsset()}
  /> : null;

  if (overviewOpen) return <div className="motion-comic-page">{projectControls}<MotionComicProjectOverview
    document={document}
    scriptSnapshot={taskSnapshot.scripts}
    busy={rendering || projectAction.busy}
    onBack={() => navigate?.(returnView)}
    onContinue={() => setOverviewOpen(false)}
    onOpenAssets={() => { setWorkflowStage('assets'); setOverviewOpen(false); }}
    onOpenScript={(id) => { if (id) setSelectedSourceEpisodeId(id); setWorkflowStage('episodes'); setOverviewOpen(false); }}
    onOpenEpisode={(id) => { selectEpisode(id); setWorkflowStage('scenes'); setOverviewOpen(false); }}
  /></div>;

  const renderFramesFn = (shotId: string, busy: boolean) => {
    const canonical = activeEpisode?.scenes.flatMap((scene) => scene.shots).find((item) => item.id === shotId);
    if (!canonical) return null;
    const frameOptions = motionComicFrameAssets(document)
      .map((asset, index) => ({ id: asset.id, label: `画面 ${index + 1}`, url: toLocalImageUrl(asset.localPath!) }));
    const projectId = document.id;
    const projectRequest = projectOpenRequestRef.current;
    return <MotionComicFramePanel
      key={`${projectId}:${projectRequest}:${shotId}`}
      firstId={canonical.firstFrameAssetVersionId}
      lastId={canonical.lastFrameAssetVersionId}
      previousId={motionComicPreviousShotFrameId(document, shotId)}
      options={frameOptions}
      busy={busy}
      onImport={(slot, signal, onPhase) => withHistoryCapacity({ assets: 1 }, () => importMotionComicFrame({
        api, projectId, shotId, slot, signal, onPhase,
        readCurrent: () => documentRef.current,
        isCurrent: () => projectOpenRequestRef.current === projectRequest,
        applyMutation: applyState,
        enqueue: enqueueProjectMutation,
      }))}
      onSetFirst={(assetId) => mutateDocument((current) => setMotionComicShotFirstFrame(current, shotId, assetId))}
      onSetLast={(assetId) => mutateDocument((current) => setMotionComicShotLastFrame(current, shotId, assetId))}
      onUsePrevious={() => mutateDocument((current) => applyMotionComicPreviousFrameAsFirst(current, shotId))}
    />;
  };
  const renderShotWorkflowFn = (shotId: string, busy: boolean, videoRunning: boolean, withFrames = true) => {
          const shot = shots.find((candidate) => candidate.id === shotId);
          if (!shot) return null;
          const status = videoProviderStatuses.get(shotId) ?? selectedVideoProviderStatus;
          const canonical=activeEpisode?.scenes.flatMap(scene=>scene.shots).find(item=>item.id===shotId);
          const production=canonical?.videoProduction??{version:1 as const,referenceMode:'frames' as const,audioMode:'post-mix' as const};
          let submittedReferences: Array<{assetVersionId:string;ownerId:string;kind:string;description:string}> = [];
          let referenceError:string|undefined;
          try { if(canonical&&production.referenceMode==='references') submittedReferences=motionComicVideoReferences(document,canonical); } catch(error) {referenceError=error instanceof Error?error.message:String(error);}
          const selectedProvider=modelConfig.video.providers.find(provider=>provider.id===(status.providerId||modelConfig.video.activeProviderId));
          let units:ReturnType<typeof planMotionComicProductionUnits>=[],unitError:string|undefined;
          try {if(canonical&&selectedProvider)units=planMotionComicProductionUnits(document,canonical,selectedProvider);}catch(error){unitError=error instanceof Error?error.message:String(error);}
          const updateProduction=(patch:Partial<typeof production>)=>mutateDocument(current=>({...current,episodes:current.episodes.map(episode=>({...episode,scenes:episode.scenes.map(scene=>({...scene,shots:scene.shots.map(item=>item.id===shotId?{...item,videoProduction:{...(item.videoProduction ?? {version:1 as const,referenceMode:'frames' as const,audioMode:'post-mix' as const}),...patch}}:item)}))}))}));
          return <>{withFrames ? renderFramesFn(shotId, busy || videoRunning) : null}<MotionComicVideoReadiness
            compact={!withFrames}
            outputRatio={document.ratio}
            shot={videoRunning ? { ...shot, videoJobStatus: 'running', videoJobError: undefined } : shot}
            connected={status.connected}
            providerLabel={status.label}
            providerModel={status.model}
            providerId={modelConfig.video.activeProviderId}
            providerOptions={videoProviderOptions.map((provider) => ({
              value: provider.providerId,
              label: `${provider.label} · ${provider.model}${provider.connected ? '' : ` · ${provider.unavailableReason ?? '未连接'}`}`,
              disabled: !provider.connected,
            }))}
            unavailableReason={status.unavailableReason}
            busy={busy}
            remoteOnly={Boolean(document.sourceDocument)}
            providerCapabilities={selectedProvider?.capabilities}
            keyframeAsReference={Boolean(selectedProvider && /^minimax_h3_(?:768p-15s|1080p-10s|736p-12s)$/i.test(selectedProvider.model))}
            production={production}
            submittedReferences={submittedReferences.map((reference) => {
              const ownerId = reference.ownerId;
              const kind = reference.kind === 'character' ? 'look' : reference.kind === 'scene' ? 'scene' : reference.kind === 'object' ? 'prop' : undefined;
              return { ...reference, ...(kind && ownerId ? { token: motionComicReferenceToken(kind, ownerId) } : {}) };
            })}
            onInsertReference={(token) => {
              if (!canonical || busy || videoRunning) return;
              updateShot(shotId, { motionPrompt: `${canonical.motionPrompt.trimEnd()}${canonical.motionPrompt.trim() ? ' ' : ''}${token} ` });
            }}
            referenceError={referenceError}
            dialogue={canonical ? motionComicVideoDialogue(document,canonical) : []}
            referenceAudioOptions={document.assets.filter(asset=>asset.kind==='audio'&&asset.localPath&&!asset.assetId.startsWith('character-voice-sample:')).map(asset=>({value:asset.id,label:`${asset.assetId} · ${asset.durationMs?`${(asset.durationMs/1000).toFixed(1)} 秒`:'时长待测'}`}))}
            units={units}
            unitError={unitError}
            onProductionChange={updateProduction}
            onSplitUnits={canonical&&selectedProvider&&units.some(unit=>units.length>1||unit.generationDurationSec>Math.ceil(canonical.durationMs/1000))?()=>mutateDocument(current=>splitMotionComicProductionUnits(current,shotId,selectedProvider)):undefined}
            onStrategyChange={(strategy) => updateShot(shotId, { renderStrategy: strategy })}
            onConfigureProvider={() => openSettings?.('video', 'motion-comic', document.id)}
            onRecoverSubmission={async (resolution) => {
              const current = documentRef.current;
              const job = current && latestProductionProviderJob(current.providerJobs, shotId, 'image-to-video', canonical?.episodeId);
              if (!current || !job) throw new Error('未找到待核对的视频任务。');
              const pending = persistQueueRef.current.then(async () => {
                const latest = documentRef.current;
                if (!latest || latest.id !== current.id) throw new Error('项目已切换，请重新核对。');
                const submitted = await persistProject(latest);
                const response = await api.recoverMotionComicVideoSubmission({ id: submitted.id, shotId, jobId: job.id, expectedUpdatedAt: submitted.updatedAt, ...resolution });
                if (response.mutation) applyState(response.mutation);
                acceptSavedDocument(response.document, submitted);
              });
              persistQueueRef.current = pending.then(() => undefined, () => undefined);
              await pending;
            }}
            onResumeVideo={() => withHistoryCapacity({ assets: 1 }, () => generateVideo(shotId, 'automatic', true))}
          /></>;
  };
  const renderShotCandidatesFn = (shotId: string, busy: boolean, videoRunning: boolean) => {
          const shot = shots.find(item => item.id === shotId);
          const canonical = activeEpisode?.scenes.flatMap(scene => scene.shots).find(item => item.id === shotId);
          if (!shot || !canonical) return null;
          const status = videoProviderStatuses.get(shotId) ?? selectedVideoProviderStatus;
          const selectedProvider = modelConfig.video.providers.find(provider => provider.id === (status.providerId || modelConfig.video.activeProviderId));
          let inputError: string | undefined;
          try {
            if (canonical.videoProduction?.referenceMode === 'references') motionComicVideoReferences(document, canonical);
            if (selectedProvider) planMotionComicProductionUnits(document, canonical, selectedProvider);
          } catch (error) { inputError = error instanceof Error ? error.message : String(error); }
          return <MotionComicVideoVersions
            key={`${document.id}:${canonical.episodeId}:${canonical.id}`}
            document={document} shot={canonical} busy={busy || videoRunning}
            readVideo={path => api.getTaskMediaUrl(document.id, path)}
            generationDisabledReason={canonical.renderStrategy !== 'remote-video' ? '请先切换为远程视频制作方式。'
              : !status.connected ? status.unavailableReason || '请先配置并连接视频模型。'
              : !shot.videoInputReady ? shot.videoInputUnavailableReason || '请先补全视频制作输入。'
              : inputError}
            onGenerateCandidate={() => withHistoryCapacity(PRODUCTION_MEDIA_HISTORY_DEMAND, () => generateVideo(shotId, 'candidate'))}
            onAdopt={versionId => adoptVideoVersion(canonical.episodeId, canonical.id, versionId)}
          />;
  };

  const renderCandidateDockFn = (busy: boolean) => {
    if (!activeEpisode) return null;
    const canonicalShots = activeEpisode.scenes.flatMap(scene => scene.shots);
    const dockShots = canonicalShots.map((canonical, index) => ({
      id: canonical.id,
      index: index + 1,
      title: canonical.title,
      thumbnailUrl: (() => {
        const frameAsset = canonical.firstFrameAssetVersionId
          ? document.assets.find(a => a.id === canonical.firstFrameAssetVersionId && a.kind === 'image' && a.localPath)
          : undefined;
        return frameAsset?.localPath ? toLocalImageUrl(frameAsset.localPath) : undefined;
      })(),
      candidates: motionComicVideoVersions(document, canonical).map(({ asset, current, unavailableReason }, versionIndex, all) => ({
        id: asset.id,
        label: `候选 ${all.length - versionIndex}`,
        meta: `${asset.model || '模型未记录'} · ${asset.durationMs ? `${(asset.durationMs / 1000).toFixed(1)} 秒` : '时长未记录'}`,
        current,
        unavailableReason,
        videoUrl: asset.localPath ? toLocalAssetUrl(asset.localPath) : undefined,
      })),
    }));
    return <MotionComicCandidateDock shots={dockShots} selectedShotId={selectedShotId ?? ''} busy={busy} onSelectShot={setSelectedShotId} onAdopt={(shotId, versionId) => adoptVideoVersion(activeEpisode.id, shotId, versionId)} />;
  };
  const dropCandidateOnShot = (shotId: string, dataTransfer: DataTransfer) => {
    const drag = readCandidateDrag(dataTransfer);
    if (!drag || !activeEpisode) return;
    void projectAction.run(async () => {
      if (drag.shotId !== shotId) throw new Error('候选视频只能放到它所属镜头的视频条上。');
      await adoptVideoVersion(activeEpisode.id, shotId, drag.versionId);
    }, { successMessage: '已采用该候选视频，时间线已更新。' });
  };

  if (workflowStage === 'assets') return <div className="motion-comic-page">{assetCreateDialog}{libraryPicker}{assetRemoveDialog}<div data-motion-comic-workbench="true"><MotionComicProductionWorkspace
    navigationMemory={workflowNavigationMemory}
    document={document}
    stage="assets"
    headerActions={headerActions}
    stageState={stageState}
    dirty={dirty}
    busy={projectAction.busy || providerAction.busy || referenceAction.busy}
    feedback={actionFeedback}
    errorMessage={actionError}
    onStageChange={setWorkflowStage}
    onSave={() => void saveProject()}
    onNewProject={startCreate}
    onBack={backWithinProject}
  ><div data-motion-comic-series-bible="true" className="director-series-page">
    <div className="director-series-layout">
      <Pane as="aside" tone="subtle" className="director-series-summary">
        <nav className="comic-asset-navigation" aria-label="资产分区">
          {([{ id: 'characters', label: '人物', count: document.characters.length }, { id: 'scenes', label: '地点', count: document.sceneAssets.length }, { id: 'props', label: '道具', count: document.props.length }, { id: 'series', label: '系列设定', count: undefined }] as const).map((item) => <Button key={item.id} variant={assetSection === item.id ? 'secondary' : 'subtle'} aria-label={`查看${item.label}资产`} aria-pressed={assetSection === item.id} onClick={() => { setAssetSection(item.id); setAssetQuery(''); setAssetDisplay('gallery'); }}>{item.label}<span>{item.count}</span></Button>)}
        </nav>
        {assetSection !== 'series' ? <div className="comic-project-asset-list">
          <TextField label="搜索项目资产" placeholder="名称或人物别名" value={assetQuery} onChange={(_, data) => setAssetQuery(data.value)} />
          <div aria-label="项目资产列表">{projectAssetItems.map((item) => <Button key={item.id} variant="subtle" aria-pressed={item.id === selectedProjectAssetId} onClick={() => { setSelectedProjectAssets((current) => ({ ...current, [assetSection]: item.id })); setAssetDisplay('detail'); }}><strong>{item.label}</strong><small>{item.detail}</small></Button>)}{!projectAssetItems.length ? <small>没有符合条件的资产</small> : null}</div>
        </div> : null}
        <details className="comic-asset-settings"><summary>参考图生成服务</summary><section className="comic-asset-model" aria-label="参考图生成服务">
          <strong>项目生图模型：{providerStatus.label}</strong>
          <span className={providerStatus.connected ? 'is-ready' : 'is-warning'}>{providerStatus.connected ? '已配置 · 点击生成时调用' : '需要完成模型配置'}</span>
          <small>{providerStatus.model} · {providerStatus.resolution} · {providerStatus.quality === 'high' ? '高质量' : providerStatus.quality === 'medium' ? '标准质量' : '快速质量'}</small>
          {!providerStatus.connected ? <p role="status">{providerStatus.unavailableReason}</p> : null}
          <Button variant="subtle" density="compact" icon={<Settings2 size={13} />} disabled={referenceAction.busy} onClick={() => openSettings?.('image', 'motion-comic', document.id)}>管理图片模型</Button>
        </section></details>
        <details className="comic-asset-settings"><summary>{activeEpisode ? `第 ${activeEpisode.number} 集` : '项目'} · 参考就绪情况</summary>
        <div className={`motion-comic-readiness ${consistencySummary?.requiredTargetCount ? displayedConsistencyReady ? 'is-ready' : 'is-warning' : ''}`} role="status">
          {consistencySummary?.requiredTargetCount ? displayedConsistencyReady ? <CheckCircle2 size={16} /> : <CircleAlert size={16} /> : <Images size={16} />}
          <span><strong>{!consistencySummary?.requiredTargetCount ? '本集暂无分镜引用' : displayedConsistencyReady ? '一致性素材已就绪' : '一致性素材待补充'}</strong>{consistencySummary?.requiredTargetCount ? <small>{consistencySummary.readyTargetCount}/{consistencySummary.requiredTargetCount} 个引用目标已固定 · 单镜头最多 {consistencySummary.maxReferencesPerShot} 张</small> : null}</span>
        </div>
        {displayedMissingTargets.length > 0 ? <div className="motion-comic-missing-list"><strong>当前缺少</strong>{displayedMissingTargets.slice(0, 5).map((label) => <span key={label}>{label}</span>)}{displayedMissingTargets.length > 5 ? <small>另有 {displayedMissingTargets.length - 5} 项</small> : null}</div> : null}
        </details>
      </Pane>
      <main className="director-series-editor" data-asset-display={assetSection === 'series' ? 'series' : assetDisplay}>
        {assetSection !== 'series' && assetDisplay === 'gallery' ? <div className="director-series-section-heading comic-asset-page-heading"><div><h2>项目资产库 · {assetSection === 'characters' ? '人物' : assetSection === 'scenes' ? '地点' : '道具'}<span className="comic-asset-page-count">{assetSection === 'characters' ? document.characters.length : assetSection === 'scenes' ? document.sceneAssets.length : document.props.length}</span></h2><small>跨集共用 · 选择卡片查看定义、参考版本与引用</small></div><Button variant="primary" icon={<Plus size={14} />} onClick={assetSection === 'characters' ? addCharacterAsset : assetSection === 'scenes' ? addSceneAsset : addPropAsset}>新增{assetSection === 'characters' ? '人物' : assetSection === 'scenes' ? '地点' : '道具'}</Button></div> : null}
        {assetSection !== 'series' && !providerStatus.connected ? <p className="comic-reference-batch__hint comic-asset-provider-note" role="status"><CircleAlert size={13} aria-hidden="true" />参考图生成：{providerStatus.unavailableReason || '请先配置参考图生成服务，再生成候选。'}</p> : null}
        {assetSection !== 'series' ? <MotionComicReferenceBatch key={`${document.id}:${assetSection}:batch`} api={api} document={document} category={assetSection}
          disabled={referenceAction.busy || providerAction.busy || !providerStatus.connected}
          onPrepare={() => withSavedScriptProject(async (saved) => saved)}
          onSubmit={(saved, targets) => {
            if (documentRef.current?.id !== saved.id) throw new Error('项目已切换，请重新打开批量生成。');
            return api.submitMotionComicReferenceBatch({ projectId: saved.id, expectedProjectUpdatedAt: saved.updatedAt, targets,
              selectionMode: 'selected', concurrency: assetSection === 'characters' ? 3 : 1, composeMultiple: false });
          }}
          onControl={(id, action) => api.controlMotionComicReferenceBatch({ id, action })}
          onRefresh={async () => {
            const baseline = savedDocumentRef.current;
            if (!baseline || baseline.id !== document.id) return;
            const task = await api.getTaskDetail(baseline.id);
            if (!task) throw new Error('参考图已生成，但项目暂时无法重新读取，请重新打开项目。');
            if (documentRef.current?.id === baseline.id) acceptSavedDocument(parseMotionComicPipelineData(task.pipelineData), baseline);
          }} /> : null}
        {assetSection !== 'series' && assetDisplay === 'gallery' ? <MotionComicAssetGallery document={document} category={assetSection} query={assetQuery} onOpen={(id) => { setSelectedProjectAssets((current) => ({ ...current, [assetSection]: id })); setAssetDisplay('detail'); }} onAdd={assetSection === 'characters' ? addCharacterAsset : assetSection === 'scenes' ? addSceneAsset : addPropAsset} /> : null}
        {assetSection !== 'series' && assetDisplay === 'detail' ? <Toolbar aria-label="资产详情导航">
          <Button variant="subtle" density="compact" icon={<ArrowLeft size={13} />} onClick={() => setAssetDisplay('gallery')}>返回资产总览</Button>
          <MotionComicAssetExtraction key={`${document.id}:${assetSection}`} document={document} category={assetSection} api={api} disabled={projectAction.busy}
            onPrepare={() => withSavedScriptProject(async (saved) => saved)}
            onPropose={(saved, input) => {
              if (documentRef.current?.id !== saved.id) throw new Error('项目已切换，请重新确认提取范围。');
              return api.proposeMotionComicAssetExtraction({ ...input, id: saved.id, expectedUpdatedAt: saved.updatedAt });
            }}
            onApply={(saved, input) => {
              if (documentRef.current?.id !== saved.id) throw new Error('项目已切换，请重新打开候选。');
              return api.applyMotionComicAssetExtraction({ ...input, id: saved.id, expectedUpdatedAt: saved.updatedAt });
            }}
            onRefresh={async () => {
              const baseline = savedDocumentRef.current;
              if (!baseline || baseline.id !== document.id) return;
              const task = await api.getTaskDetail(baseline.id);
              if (!task) throw new Error('资产已确认，但项目暂时无法重新读取，请重新打开项目。');
              if (documentRef.current?.id === baseline.id) acceptSavedDocument(parseMotionComicPipelineData(task.pipelineData), baseline);
            }} />
        </Toolbar> : null}
        <section hidden={assetSection !== 'series'}><div className="director-series-section-heading"><div><h2>系列设定</h2><small>全项目共用</small></div></div><TextField label="系列名称" value={document.title} onChange={(_, data) => mutateDocument((current) => ({ ...current, title: data.value, series: { ...current.series, title: data.value } }))} /><div className="director-copy-field">
  <TextAreaField label="核心设定" value={document.series.premise} onChange={(_, data) => { mutateDocument((current) => ({ ...current, series: { ...current.series, premise: data.value } })); copyAction.clearFeedback(); }} resize="vertical" />
  <DirectorCopyAssist
    activeIntent={copyAssistIntent}
    canCreate={Boolean(document.title.trim())}
    canRevise={Boolean(document.series.premise.trim())}
    feedback={copyAction.feedback}
    onCreate={() => void runCopyAssist('create')}
    onRevise={() => void runCopyAssist('revise')}
  />
</div><div className="director-create-two-col"><TextField label="类型" value={document.series.genre} onChange={(_, data) => mutateDocument((current) => ({ ...current, series: { ...current.series, genre: data.value } }))} /><TextField label="基调" value={document.series.tone} onChange={(_, data) => mutateDocument((current) => ({ ...current, series: { ...current.series, tone: data.value } }))} /></div><TextField label="目标观众" value={document.series.audience} onChange={(_, data) => mutateDocument((current) => ({ ...current, series: { ...current.series, audience: data.value } }))} /><TextAreaField label="世界规则" value={document.series.worldRules.join('\n')} onChange={(_, data) => mutateDocument((current) => ({ ...current, series: { ...current.series, worldRules: data.value.split('\n').map((value) => value.trim()).filter(Boolean) } }))} resize="vertical" /><TextAreaField label="视觉规则" value={document.series.visualRules.join('\n')} onChange={(_, data) => mutateDocument((current) => ({ ...current, series: { ...current.series, visualRules: data.value.split('\n').map((value) => value.trim()).filter(Boolean) } }))} resize="vertical" /><TextAreaField label="负面提示词" value={document.series.negativePrompt} onChange={(_, data) => mutateDocument((current) => ({ ...current, series: { ...current.series, negativePrompt: data.value } }))} resize="vertical" /></section>
        <section hidden={assetSection !== 'characters' || assetDisplay !== 'detail'}>
          <div className="director-series-section-heading comic-asset-detail-heading comic-asset-pane-heading"><div><h2>{document.characters.find((item) => item.id === selectedProjectAssetId)?.name ?? '人物'}</h2><small>人物 · 跨集共用 · {document.characters.find((item) => item.id === selectedProjectAssetId)?.looks.length ?? 0} 个造型</small></div><Button density="compact" variant="secondary" icon={<Plus size={13} />} onClick={addCharacterAsset}>新增人物</Button></div>
          {document.characters.length === 0 ? <div className="motion-comic-asset-empty"><Users size={20} /><span><strong>当前没有人物</strong><small>空镜或道具特写可以继续制作；需要角色时在这里补录。</small></span></div> : null}
          {document.characters.filter((character) => character.id === selectedProjectAssetId).map((character) => <div key={character.id} className="comic-asset-detail-pane">
            {(() => { const portraitLook = [selectedLook, ...character.looks].find((look) => look && fixedMotionComicReferenceAsset(document, look.referenceAssetVersionIds)); const portrait = portraitLook ? fixedMotionComicReferenceAsset(document, portraitLook.referenceAssetVersionIds) : undefined; return <MotionComicCharacterProfile character={character} onManageReferences={() => { const region = globalThis.document.getElementById(`comic-reference-workspace-${character.id}`); region?.scrollIntoView({ block: 'start', behavior: 'smooth' }); region?.focus({ preventScroll: true }); }} portraitPath={portrait?.localPath} portraitLabel={portraitLook ? `${portraitLook.label} · 已固定` : undefined} fixedLooks={character.looks.filter((look) => fixedMotionComicReferenceAsset(document, look.referenceAssetVersionIds)).length} onChange={(patch: MotionComicCharacterProfilePatch) => mutateDocument((current) => ({ ...current, characters: current.characters.map((item) => item.id === character.id ? { ...item, ...patch } : item) }))} />; })()}
            <div className="comic-character-looks-heading"><strong>造型</strong><small>同一人物的不同服装或状态，每个造型单独固定参考图</small></div>
            <div className="comic-look-tabs" role="tablist" aria-label="角色造型">
              {character.looks.map((look) => {
                const fixed = fixedMotionComicReferenceAsset(document, look.referenceAssetVersionIds);
                const versions = motionComicReferenceAssets(document, look.referenceAssetVersionIds);
                const selected = look.id === selectedCharacterLookId;
                return <Button key={look.id} variant="subtle" className="comic-look-tab" role="tab" id={`comic-look-tab-${character.id}-${look.id}`} aria-selected={selected} aria-pressed={selected} tabIndex={selected ? 0 : -1} onClick={() => setActiveLookIds((current) => ({ ...current, [character.id]: look.id }))} onKeyDown={(event) => {
                  const index = character.looks.findIndex((candidate) => candidate.id === look.id);
                  const next = event.key === 'ArrowRight' ? (index + 1) % character.looks.length : event.key === 'ArrowLeft' ? (index - 1 + character.looks.length) % character.looks.length : event.key === 'Home' ? 0 : event.key === 'End' ? character.looks.length - 1 : -1;
                  if (next < 0) return;
                  event.preventDefault();
                  const target = character.looks[next];
                  setActiveLookIds((current) => ({ ...current, [character.id]: target.id }));
                  globalThis.document.getElementById(`comic-look-tab-${character.id}-${target.id}`)?.focus();
                }}>
                  <span className="comic-look-tab__thumb">{(fixed ?? versions.at(-1))?.localPath ? <img src={toLocalImageUrl((fixed ?? versions.at(-1))!.localPath!)} alt="" loading="lazy" /> : <ImageOff size={14} aria-hidden="true" />}</span>
                  <span><strong>{look.label || '未命名造型'}</strong><small>{selected ? '✓ 当前造型 · ' : ''}{fixed ? '已固定' : versions.length ? `${versions.length} 个候选待采用` : '缺少参考图'}</small></span>
                </Button>;
              })}
              <Button variant="subtle" className="comic-look-tab is-add" disabled={referenceAction.busy || character.looks.length >= 50} title={character.looks.length >= 50 ? '每个角色最多保留 50 个造型' : '新增造型'} onClick={() => addCharacterLook(character.id)}><Plus size={14} aria-hidden="true" /><span><strong>新增造型</strong><small>沿用同一人物身份</small></span></Button>
            </div>
            {(selectedLook ? [selectedLook] : []).map((look) => {
              const target = { kind: 'look' as const, id: look.id };
              const targetKey = `look:${look.id}`;
              const versions = motionComicReferenceAssets(document, look.referenceAssetVersionIds);
              const fixed = fixedMotionComicReferenceAsset(document, look.referenceAssetVersionIds);
              return <div key={look.id} id={`comic-reference-workspace-${character.id}`} tabIndex={-1} aria-label={`${look.label}参考图工作台`} className="comic-look-panel comic-asset-detail-layout">
                <div className="comic-look-panel__stage">
                  <MotionComicReferenceBoard key={targetKey} suggestedRoles={['front', 'side', 'back']} hideImport label={`${character.name} · ${look.label}`} versions={versions} slots={referenceSlots(document, look.referenceAssetVersionIds)} pending={pendingReferenceImports[targetKey] ?? []} importing={referenceImporting(targetKey)} busy={referenceAction.busy} active={referenceTargetId === targetKey} job={referenceTargetId === targetKey ? activeReferenceJob : null} feedback={referenceTargetId === targetKey ? referenceAction.feedback : null} generationHint={referenceGenerationIssue(target)} maxImages={Math.max(1, providerStatus.maxReferenceImages || 6)} composeMultiple={referenceComposeTargets.has(targetKey)} onImport={() => void importReference('look', look.id)} onComposeChange={(value) => toggleReferenceCompose(targetKey, value)} onSetRole={(versionId, role) => setReferenceRole(target, versionId, role)} onUnpin={(versionId) => setReferenceRoleSilent(target, versionId, 'unpin')} onRemove={(versionId) => removeReferenceVersion(target, versionId)} onDiscard={(versionId) => discardReferenceImport(target, versionId)} onImageStatus={markReferenceFileStatus} />
                  <div className="comic-reference-composer">
                    <TextAreaField label="生成提示词" rows={4} resize="vertical" value={look.referencePrompt ?? defaultMotionComicLookReferencePrompt(character, look)} hint="已根据人物身份与右侧造型设定预填，可直接修改；一次生成正面、侧面、背面各一张。" onChange={(_, data) => mutateDocument((current) => ({ ...current, characters: current.characters.map((item) => item.id === character.id ? { ...item, looks: item.looks.map((candidate) => candidate.id === look.id ? { ...candidate, referencePrompt: data.value } : candidate) } : item) }))} />
                    <Button density="compact" variant="subtle" onClick={() => mutateDocument((current) => ({ ...current, characters: current.characters.map((item) => item.id === character.id ? { ...item, looks: item.looks.map((candidate) => candidate.id === look.id ? { ...candidate, referencePrompt: undefined } : candidate) } : item) }))}>重新填入当前设定</Button>
                    <MotionComicGenerationReferences key={targetKey} paths={generationReferencePaths(document, look.id)} maxImages={providerStatus.maxReferenceImages} onImport={() => importGenerationReferences(document.id, look.id)} onLibrary={() => setLibraryTarget({ kind: 'look', id: look.id, projectId: document.id })} onRemove={(path) => mutateDocument((current) => ({ ...current, characters: current.characters.map((item) => ({ ...item, looks: item.looks.map((candidate) => candidate.id === look.id ? { ...candidate, generationReferenceImagePaths: generationReferencePaths(current, look.id).filter((entry) => entry !== path) } : candidate) })) }))} />
                  <div className="comic-look-panel__commands">
                    <Button density="compact" variant="primary" icon={<Sparkles size={13} />} disabled={referenceGenerationPending(target) || providerAction.busy || !providerStatus.connected || Boolean(referenceGenerationIssue(target))} title={referenceGenerationIssue(target) ?? `使用 ${providerStatus.label} / ${providerStatus.model} 在后台生成三视图`} onClick={() => { setReferenceTargetId(targetKey); void generateReference('look', look.id); }}>{referenceGenerationPending(target) ? '三视图生成中…' : '生成三视图 · 3 张'}</Button>
                  </div>
                    {referenceGenerationStatus(target) ? <small role="status">{referenceGenerationStatus(target)}</small> : null}
                    {referenceTargetId === targetKey ? <AsyncActionFeedback feedback={referenceGenerationAction.feedback} /> : null}
                    <small className="comic-reference-composer__hint">后台分别生成正面、侧面、背面，可继续切换造型和编辑。核对并固定后用于分镜。</small>
                  </div>
                </div>
                <div className="comic-asset-definition">
                <TextField label="造型名称" value={look.label} onChange={(_, data) => mutateDocument((current) => ({ ...current, characters: current.characters.map((item) => item.id === character.id ? { ...item, looks: item.looks.map((candidate) => candidate.id === look.id ? { ...candidate, label: data.value } : candidate) } : item) }))} />
                <div className="comic-asset-definition__pair">
                <TextAreaField label="外观特征" rows={3} value={look.appearancePrompt} hint="描述样貌、发型与辨识特征；换行不会改变字段归属。" onChange={(_, data) => mutateDocument((current) => ({ ...current, characters: current.characters.map((item) => item.id === character.id ? { ...item, looks: item.looks.map((candidate) => candidate.id === look.id ? { ...candidate, appearancePrompt: data.value } : candidate) } : item) }))} resize="vertical" />
                <TextAreaField label="服装与配饰" rows={3} value={look.wardrobe} onChange={(_, data) => mutateDocument((current) => ({ ...current, characters: current.characters.map((item) => item.id === character.id ? { ...item, looks: item.looks.map((candidate) => candidate.id === look.id ? { ...candidate, wardrobe: data.value } : candidate) } : item) }))} resize="vertical" />
                <TextAreaField label="造型连续性要求" rows={2} value={look.continuityNotes} hint="记录跨镜头必须保持的发型、服装、配饰和辨识特征。" onChange={(_, data) => mutateDocument((current) => ({ ...current, characters: current.characters.map((item) => item.id === character.id ? { ...item, looks: item.looks.map((candidate) => candidate.id === look.id ? { ...candidate, continuityNotes: data.value } : candidate) } : item) }))} />
                </div>
                <div className="comic-asset-definition__footer">
                  <small className="comic-asset-definition__note">删除造型只影响当前项目；仍被镜头引用时会被阻止。</small>
                  <Button variant="danger" density="compact" icon={<Trash2 size={13} />} disabled={referenceAction.busy || character.looks.length < 2} title={character.looks.length < 2 ? '人物至少保留一个造型' : undefined} onClick={() => openRemove('look', character, look)}>删除此造型</Button>
                </div>
                </div>
              </div>;
            })}
            <section className="comic-character-voice" aria-label="角色配音"><header><strong>角色配音</strong><small>音色和语速只影响之后生成的配音</small></header>
            <div className="director-create-two-col">
              <SelectField label={`${character.name}音色`} value={character.voiceId ?? ''} options={[{ value: '', label: '跟随镜头默认音色' }, ...voiceStatus.voices, ...(character.voiceId && !voiceStatus.voices.some((voice) => voice.value === character.voiceId) ? [{ value: character.voiceId, label: `${character.voiceId} · 已保存音色` }] : [])]} validationMessage={character.voiceProvider && character.voiceProvider !== voiceStatus.provider ? '该角色音色属于另一服务，请重新选择。' : undefined} onChange={(event) => mutateDocument((current) => updateMotionComicCharacterVoice(current, character.id, { voiceProvider: voiceStatus.provider, voiceId: event.target.value || undefined }))} />
              <SelectField label={`${character.name}语速`} value={String(character.voiceSpeed ?? '')} options={[{ value: '', label: '跟随镜头语速' }, { value: '0.8', label: '0.80x' }, { value: '1', label: '1.00x' }, { value: '1.2', label: '1.20x' }]} onChange={(event) => mutateDocument((current) => updateMotionComicCharacterVoice(current, character.id, { voiceProvider: character.voiceProvider ?? voiceStatus.provider, voiceSpeed: event.target.value ? Number(event.target.value) : undefined }))} />
            </div>
            {assetSection === 'characters' && assetDisplay === 'detail' && selectedProjectAssetId === character.id ? <MotionComicCharacterVoiceSample key={`${document.id}:${character.id}`} characterName={character.name}
              sample={document.assets.find((asset) => asset.id === character.voiceSampleAssetVersionId && asset.kind === 'audio')}
              disabled={projectAction.busy}
              getMediaUrl={(path) => api.getTaskMediaUrl(document.id, path)}
              onImport={async () => { await withSavedScriptProject(async (saved) => {
                const mutation = await api.importCharacterVoiceSample({ taskId: saved.id, characterId: character.id, expectedUpdatedAt: saved.updatedAt });
                if (!mutation) return;
                applyState(mutation);
                const task = await api.getTaskDetail(saved.id);
                if (!task) throw new Error('样本已导入，但项目暂时无法重新读取，请重新打开项目。');
                acceptSavedDocument(parseMotionComicPipelineData(task.pipelineData), saved);
              }); }}
              onUnlink={async () => { await enqueueProjectMutation(document.id, (current) => ({ ...current, characters: current.characters.map((item) => item.id === character.id ? { ...item, voiceSampleAssetVersionId: undefined } : item) }), false); }} /> : null}
            </section>
            <details className="comic-character-details comic-asset-identity"><summary>身份与跨集引用</summary><small className="comic-project-asset-id">身份 ID · {character.id}</small>{assetUsage}</details>
          </div>)}
        </section>
        <section hidden={assetSection !== 'scenes' || assetDisplay !== 'detail'}>
          <div className="director-series-section-heading comic-asset-detail-heading"><div><h2>{document.sceneAssets.find((item) => item.id === selectedProjectAssetId)?.label ?? '地点'}</h2><small>地点 · 跨集共用</small></div><Button density="compact" variant="secondary" icon={<Plus size={13} />} onClick={addSceneAsset}>新增场景</Button></div>
          {document.sceneAssets.length === 0 ? <div className="motion-comic-asset-empty"><ImagePlus size={20} /><span><strong>当前没有场景资产</strong><small>补录场景后可生成或导入固定参考图。</small></span></div> : null}
          {document.sceneAssets.filter((asset) => asset.id === selectedProjectAssetId).map((asset) => {
            const target = { kind: 'scene' as const, id: asset.id };
            const targetKey = `scene:${asset.id}`;
            const versions = motionComicReferenceAssets(document, asset.referenceAssetVersionIds);
            const fixed = fixedMotionComicReferenceAsset(document, asset.referenceAssetVersionIds);
            return <div key={asset.id} className="director-series-entity">
              <small className="comic-project-asset-id">身份 ID · {asset.id}</small>
              {assetUsage}
              <div className="comic-asset-detail-layout">
              <div className="comic-look-panel__stage">
                <MotionComicReferenceBoard key={targetKey} label={asset.label} versions={versions} slots={referenceSlots(document, asset.referenceAssetVersionIds)} pending={pendingReferenceImports[targetKey] ?? []} importing={referenceImporting(targetKey)} busy={referenceAction.busy} active={referenceTargetId === targetKey} job={referenceTargetId === targetKey ? activeReferenceJob : null} feedback={referenceTargetId === targetKey ? referenceAction.feedback : null} generationHint={referenceGenerationIssue(target)} maxImages={Math.max(1, providerStatus.maxReferenceImages || 6)} composeMultiple={referenceComposeTargets.has(targetKey)} onImport={() => void importReference('scene', asset.id)} onComposeChange={(value) => toggleReferenceCompose(targetKey, value)} onSetRole={(versionId, role) => setReferenceRole(target, versionId, role)} onUnpin={(versionId) => setReferenceRoleSilent(target, versionId, 'unpin')} onRemove={(versionId) => removeReferenceVersion(target, versionId)} onDiscard={(versionId) => discardReferenceImport(target, versionId)} onImageStatus={markReferenceFileStatus} />
                <div className="comic-look-panel__commands">
                  <Button density="compact" variant="primary" icon={<Sparkles size={13} />} disabled={referenceGenerationPending(target) || providerAction.busy || !providerStatus.connected || Boolean(referenceGenerationIssue(target))} title={referenceGenerationIssue(target) ?? '在后台生成；只追加候选'} onClick={() => { setReferenceTargetId(targetKey); void generateReference('scene', asset.id); }}>{referenceGenerationPending(target) ? '后台生成中…' : '生成参考图'}</Button>
                  {referenceGenerationStatus(target) ? <small role="status">{referenceGenerationStatus(target)}</small> : null}
                  {referenceTargetId === targetKey ? <AsyncActionFeedback feedback={referenceGenerationAction.feedback} /> : null}
                  <Button density="compact" variant="secondary" icon={<Upload size={13} />} disabled={referenceAction.busy || providerAction.busy} onClick={() => { setReferenceTargetId(targetKey); void importReference('scene', asset.id); }}>导入</Button>
                  <Button density="compact" variant="subtle" icon={<Images size={13} />} disabled={referenceAction.busy || providerAction.busy} onClick={() => setLibraryTarget({ kind: 'scene', id: asset.id, projectId: document.id })}>素材库</Button>
                </div>
              </div>
              <div className="comic-asset-definition">
              <TextField label="场景名称" value={asset.label} onChange={(_, data) => mutateDocument((current) => ({ ...current, sceneAssets: current.sceneAssets.map((item) => item.id === asset.id ? { ...item, label: data.value } : item) }))} />
              <TextAreaField label="场景说明" value={asset.description} onChange={(_, data) => mutateDocument((current) => ({ ...current, sceneAssets: current.sceneAssets.map((item) => item.id === asset.id ? { ...item, description: data.value } : item) }))} resize="vertical" />
              <TextAreaField label="生成提示词" value={asset.prompt} onChange={(_, data) => mutateDocument((current) => ({ ...current, sceneAssets: current.sceneAssets.map((item) => item.id === asset.id ? { ...item, prompt: data.value } : item) }))} resize="vertical" />
              <TextAreaField label="连续性说明" value={asset.continuityNotes} onChange={(_, data) => mutateDocument((current) => ({ ...current, sceneAssets: current.sceneAssets.map((item) => item.id === asset.id ? { ...item, continuityNotes: data.value } : item) }))} resize="vertical" />
              <div className="comic-asset-definition__footer">
                <small className="comic-asset-definition__note">仍被分场或分镜引用时不能删除。</small>
                <Button variant="danger" density="compact" icon={<Trash2 size={13} />} disabled={referenceAction.busy} onClick={() => openRemove('scene', asset)}>删除此地点</Button>
              </div>
              </div></div>
            </div>;
          })}
        </section>
        <section hidden={assetSection !== 'props' || assetDisplay !== 'detail'}>
          <div className="director-series-section-heading comic-asset-detail-heading"><div><h2>{document.props.find((item) => item.id === selectedProjectAssetId)?.label ?? '道具'}</h2><small>道具 · 跨集共用</small></div><Button density="compact" variant="secondary" icon={<Plus size={13} />} onClick={addPropAsset}>新增道具</Button></div>
          {document.props.length === 0 ? <div className="motion-comic-asset-empty"><Plus size={20} /><span><strong>当前没有关键道具</strong><small>没有道具时无需补齐；需要连续性物件时可手动新增。</small></span></div> : null}
          {document.props.filter((asset) => asset.id === selectedProjectAssetId).map((asset) => {
            const target = { kind: 'prop' as const, id: asset.id };
            const targetKey = `prop:${asset.id}`;
            const versions = motionComicReferenceAssets(document, asset.referenceAssetVersionIds);
            const fixed = fixedMotionComicReferenceAsset(document, asset.referenceAssetVersionIds);
            return <div key={asset.id} className="director-series-entity">
              <small className="comic-project-asset-id">身份 ID · {asset.id}</small>
              {assetUsage}
              <div className="comic-asset-detail-layout">
              <div className="comic-look-panel__stage">
                <MotionComicReferenceBoard key={targetKey} label={asset.label} versions={versions} slots={referenceSlots(document, asset.referenceAssetVersionIds)} pending={pendingReferenceImports[targetKey] ?? []} importing={referenceImporting(targetKey)} busy={referenceAction.busy} active={referenceTargetId === targetKey} job={referenceTargetId === targetKey ? activeReferenceJob : null} feedback={referenceTargetId === targetKey ? referenceAction.feedback : null} generationHint={referenceGenerationIssue(target)} maxImages={Math.max(1, providerStatus.maxReferenceImages || 6)} composeMultiple={referenceComposeTargets.has(targetKey)} onImport={() => void importReference('prop', asset.id)} onComposeChange={(value) => toggleReferenceCompose(targetKey, value)} onSetRole={(versionId, role) => setReferenceRole(target, versionId, role)} onUnpin={(versionId) => setReferenceRoleSilent(target, versionId, 'unpin')} onRemove={(versionId) => removeReferenceVersion(target, versionId)} onDiscard={(versionId) => discardReferenceImport(target, versionId)} onImageStatus={markReferenceFileStatus} />
                <div className="comic-look-panel__commands">
                  <Button density="compact" variant="primary" icon={<Sparkles size={13} />} disabled={referenceGenerationPending(target) || providerAction.busy || !providerStatus.connected || Boolean(referenceGenerationIssue(target))} title={referenceGenerationIssue(target) ?? '在后台生成；只追加候选'} onClick={() => { setReferenceTargetId(targetKey); void generateReference('prop', asset.id); }}>{referenceGenerationPending(target) ? '后台生成中…' : '生成参考图'}</Button>
                  {referenceGenerationStatus(target) ? <small role="status">{referenceGenerationStatus(target)}</small> : null}
                  {referenceTargetId === targetKey ? <AsyncActionFeedback feedback={referenceGenerationAction.feedback} /> : null}
                  <Button density="compact" variant="secondary" icon={<Upload size={13} />} disabled={referenceAction.busy || providerAction.busy} onClick={() => { setReferenceTargetId(targetKey); void importReference('prop', asset.id); }}>导入</Button>
                  <Button density="compact" variant="subtle" icon={<Images size={13} />} disabled={referenceAction.busy || providerAction.busy} onClick={() => setLibraryTarget({ kind: 'prop', id: asset.id, projectId: document.id })}>素材库</Button>
                </div>
              </div>
              <div className="comic-asset-definition">
              <TextField label="道具名称" value={asset.label} onChange={(_, data) => mutateDocument((current) => ({ ...current, props: current.props.map((item) => item.id === asset.id ? { ...item, label: data.value } : item) }))} />
              <TextAreaField label="道具说明" value={asset.description} onChange={(_, data) => mutateDocument((current) => ({ ...current, props: current.props.map((item) => item.id === asset.id ? { ...item, description: data.value } : item) }))} resize="vertical" />
              <TextAreaField label="生成提示词" value={asset.prompt} onChange={(_, data) => mutateDocument((current) => ({ ...current, props: current.props.map((item) => item.id === asset.id ? { ...item, prompt: data.value } : item) }))} resize="vertical" />
              <div className="comic-asset-definition__footer">
                <small className="comic-asset-definition__note">仍被分镜引用时不能删除。</small>
                <Button variant="danger" density="compact" icon={<Trash2 size={13} />} disabled={referenceAction.busy} onClick={() => openRemove('prop', asset)}>删除此道具</Button>
              </div>
              </div></div>
            </div>;
          })}
        </section>
      </main>
    </div>
  </div></MotionComicProductionWorkspace></div></div>;

  return <div className="motion-comic-page">
    {libraryPicker}
    <MotionComicPlanDialog
      open={planOpen && !document.sourceDocument}
      sourceText={planSourceText}
      instructions={planInstructions}
      targetDurationSec={planTargetDurationSec}
      episodeNumber={document.sourceDocument?.episodes.find((episode) => episode.id === planningSourceEpisodeId)?.number ?? document.episodes.filter((episode) => episode.scenes.length > 0).length + 1}
      result={planResult}
      recovery={currentPlanRecovery}
      project={document}
      scriptFailure={currentPlanScriptFailure}
      busy={planningAction.busy}
      applying={planApplyAction.busy}
      applyingMode={planApplyMode}
      canReplaceStarter={canReplaceStarter}
      replaceStarterByDefault={Boolean(canReplaceStarter && document.sourceDocument?.episodes.find((episode) => episode.id === planningSourceEpisodeId)?.number === 1)}
      canCreateBlankEpisode={!document.sourceDocument}
      errorMessage={planDraftSaveError || planError}
      onOpenChange={changePlanOpen}
      onScriptDraftChange={changePlanScriptDraft}
      onReviewScriptChange={changeReviewedScript}
      onSourceTextChange={(value) => changePlanInput(setPlanSourceText, value)}
      onInstructionsChange={(value) => changePlanInput(setPlanInstructions, value)}
      onTargetDurationSecChange={(value) => changePlanInput(setPlanTargetDurationSec, value)}
      onGenerate={() => void generatePlan(false, Boolean(currentPlanRecovery || currentPlanScriptFailure))}
      onResume={() => currentPlanRecovery?.needsValidation
        ? void generatePlan(false, false, currentPlanRecovery.script) : void generatePlan(true)}
      onRepairScript={(draft) => void generatePlan(false, false, draft)}
      onApply={(reviewed) => void applyPlan(false, reviewed)}
      onReplaceStarter={(reviewed) => void applyPlan(true, reviewed)}
      onEdit={editPlanSource}
      onEditScript={() => { planRequestRef.current += 1; setPlanResult(null); planningAction.clearFeedback(); }}
      onCreateBlankEpisode={createBlankEpisodeFromPlan}
    />
    <Dialog open={llmSwitchPrompt !== null} title="切换模型会影响待生成分镜" onOpenChange={(open) => { if (!open) { llmSwitchPrompt?.resolve(false); setLlmSwitchPrompt(null); } }}
      actions={<><Button onClick={() => { llmSwitchPrompt?.resolve(false); setLlmSwitchPrompt(null); }}>取消切换</Button><Button variant="primary" onClick={() => { llmSwitchPrompt?.resolve(true); setLlmSwitchPrompt(null); }}>继续切换</Button></>}>
      <p>以下已批准剧本尚未生成分镜，切换后将由新模型生成：</p>
      <ul className="comic-llm-switch-list">{llmSwitchPrompt?.affected.map(item => <li key={item}>{item}</li>)}</ul>
      <p>已生成的剧本、分镜和素材不受影响；之后提交的任务统一使用新模型。</p>
    </Dialog>
    <div data-motion-comic-workbench="true">
      <MotionComicProductionWorkspace
        navigationMemory={workflowNavigationMemory}
        document={document}
        stage={workflowStage}
        headerActions={headerActions}
        stageState={stageState}
        dirty={dirty}
        busy={rendering || projectAction.busy || providerAction.busy || planningAction.busy || planApplyAction.busy}
        showProjectHeader
        episodeLabel={activeEpisode ? `EP${String(activeEpisode.number).padStart(2, '0')} · ${activeEpisode.title}` : undefined}
        feedback={actionFeedback}
        errorMessage={actionError}
        onStageChange={(stage) => { if (scriptDraftGuardRef.current?.() !== false) setWorkflowStage(stage); }}
        onSave={() => void saveProject()}
        onNewProject={startCreate}
        onBack={backWithinProject}
      >
        {workflowStage === 'source' ? <MotionComicSourcePanel document={document} onContinue={setWorkflowStage} /> : null}
        {workflowStage === 'episodes' && document.sourceDocument ? <MotionComicScriptWorkspace
          key={document.id}
          api={api}
          document={document}
          model={modelConfig.llm.model}
          runtimeIdentity={{ provider: motionComicRuntimeProvider(modelConfig.llm), model: modelConfig.llm.model }}
          selectedSourceEpisodeId={selectedSourceEpisode?.id ?? ''}
          plannedSourceEpisodeIds={plannedSourceEpisodeIds}
          onSelectSourceEpisode={setSelectedSourceEpisodeId}
          onDraftGuardChange={(guard) => { scriptDraftGuardRef.current = guard; }}
          withSavedProject={withSavedScriptProject}
          onApproveScripts={approveScripts}
          onOpenProjectAssets={() => setWorkflowStage('assets')}
          onApplyStoryboard={applyScriptStoryboard}
          onOpenEpisode={(id) => { selectEpisode(id); setWorkflowStage('scenes'); }}
        /> : workflowStage === 'episodes' ? <MotionComicEpisodesPanel
          document={document}
          selectedSourceEpisodeId={selectedSourceEpisode?.id ?? ''}
          plannedSourceEpisodeIds={plannedSourceEpisodeIds}
          nextSourceEpisodeId={undefined}
          onSelectSourceEpisode={setSelectedSourceEpisodeId}
          onPlanEpisode={(sourceEpisodeId) => openPlanDialog(sourceEpisodeId)}
          onSelectGeneratedEpisode={selectEpisode}
          onContinue={setWorkflowStage}
        /> : null}
        {!activeEpisode && ['scenes', 'storyboard', 'video', 'audio', 'export'].includes(workflowStage) ? <div className="motion-comic-stage-empty" data-motion-comic-empty-episode>
          <FileText size={22} aria-hidden="true" />
          <strong>还没有可制作的分集</strong>
          <span>请先到剧本创建或规划分集，确认结构后继续分场、分镜和生产。</span>
          <Button variant="primary" onClick={() => setWorkflowStage('episodes')}>去剧本创建或规划分集</Button>
        </div> : null}
        {workflowStage === 'scenes' && activeEpisode ? <MotionComicScenesPanel
          document={document}
          activeEpisode={activeEpisode}
          onSelectEpisode={selectEpisode}
          onBack={backWithinProject}
          resolveMediaUrl={path => api.getTaskMediaUrl(document.id, path)}
          onOpenAssets={() => { if (scriptDraftGuardRef.current?.() !== false) setWorkflowStage('assets'); }}
          onAddScene={addScene}
          onDraftGuardChange={(guard) => { scriptDraftGuardRef.current = guard; }}
          onUpdateScene={updateScene}
          onUpdateShot={(id, patch) => updateShot(id, { title: patch.title, prompt: patch.prompt, motionPrompt: patch.motionPrompt, framing: patch.framing, durationMs: patch.durationMs, ...('continuity' in patch ? { continuity: patch.continuity } : {}) })}
          onUpdateCue={(cueId, patch) => mutateDocument(current => {
            const owner = current.episodes.flatMap(episode => episode.scenes.flatMap(scene => scene.shots)).find(shot => shot.dialogueCueIds.includes(cueId));
            return owner ? updateDirectorSubtitleCue(current, owner.id, cueId, { text: patch.text }) : current;
          })}
          onSetActBoundary={setActBoundary}
          onRenameAct={renameAct}
          onPlanEpisode={(sourceEpisodeId) => openPlanDialog(sourceEpisodeId)}
          onContinue={setWorkflowStage}
        /> : null}
        {workflowStage === 'storyboard' && activeEpisode && missingEpisodeReferenceTargets.length > 0 ? <MotionComicReferenceBatch
          key={`${document.id}:${activeEpisode.id}:missing-references:${missingEpisodeReferenceTargets.map((target) => `${target.kind}:${target.id}`).sort().join('|')}`}
          api={api} document={document} category="episode" targetKeys={missingEpisodeReferenceTargets.map((target) => `${target.kind}:${target.id}`)}
          scopeLabel={`第 ${activeEpisode.number} 集缺失资产`} emptyHint="当前分镜没有可自动补齐的缺失资产；请检查未绑定场景或引用资产定义。"
          disabled={projectAction.busy || providerAction.busy || !providerStatus.connected}
          onPrepare={() => withSavedScriptProject(async (saved) => saved)}
          onSubmit={(saved, targets) => {
            if (documentRef.current?.id !== saved.id) throw new Error('项目已切换，请重新打开批量生成。');
            return api.submitMotionComicReferenceBatch({ projectId: saved.id, expectedProjectUpdatedAt: saved.updatedAt, targets,
              selectionMode: 'selected', concurrency: 3, composeMultiple: false });
          }}
          onControl={(id, action) => api.controlMotionComicReferenceBatch({ id, action })}
          onRefresh={async () => {
            const baseline = savedDocumentRef.current;
            if (!baseline || baseline.id !== document.id) return;
            const task = await api.getTaskDetail(baseline.id);
            if (!task) throw new Error('参考图已生成，但项目暂时无法重新读取，请重新打开项目。');
            if (documentRef.current?.id === baseline.id) acceptSavedDocument(parseMotionComicPipelineData(task.pipelineData), baseline);
          }} /> : null}
        {activeEpisode && (workflowStage === 'storyboard' || workflowStage === 'video') ? <MotionComicMakeWorkspace
          key={`${document.id}:${activeEpisode.id}`}
          episode={activeEpisode}
          shots={shots}
          selectedShotId={selectedShotId || shots[0]?.id || ''}
          busy={rendering || projectAction.busy || providerAction.busy}
          providerConnected={providerReady}
          providerUnavailableReason={providerUnavailableReason}
          onSelectShot={setSelectedShotId}
          onUpdateShot={updateShot}
          onUpdateSubtitleCue={(shotId, cueId, text) => mutateDocument(current => invalidateMotionComicShotVideo(updateDirectorSubtitleCue(current, shotId, cueId, { text }), shotId))}
          onAddShot={addShot}
          onRemoveShot={removeShot}
          onMoveShot={moveShot}
          onGenerateImage={(shotId) => withHistoryCapacity(PRODUCTION_MEDIA_HISTORY_DEMAND, () => generateShot(shotId))}
          onGenerateVideo={(shotId) => withHistoryCapacity(PRODUCTION_MEDIA_HISTORY_DEMAND, () => generateVideo(shotId))}
          renderFrames={(shotId, busy) => renderFramesFn(shotId, busy)}
          renderWorkflow={(shotId, busy) => renderShotWorkflowFn(shotId, busy, false, false)}
          renderCandidates={(shotId, busy) => renderShotCandidatesFn(shotId, busy, false)}
          assets={directorAssets.filter((asset) => asset.category === 'consistency')}
          onToggleAsset={toggleConsistencyAsset}
        /> : null}
        {activeEpisode && ['audio', 'export'].includes(workflowStage) ? <DirectorDeskWorkspace
        mode="motion-comic"
        projectTitle={document.title}
        projectMeta={`${projects.length} 个系列项目`}
        episodeTitle={`EP${String(activeEpisode.number).padStart(2, '0')} · ${activeEpisode.title}`}
        stageLabel={workflowStage === 'storyboard' ? '分镜图' : workflowStage === 'video' ? '视频生成' : workflowStage === 'audio' ? '配音字幕' : '导出'}
        completedStages={completedStages}
        systemStatus={systemStatus}
        systemStatusTone={systemStatusTone}
        projects={projectOptions}
        activeProjectId={activeProjectId}
        episodes={episodeOptions}
        activeEpisodeId={activeEpisode.id}
        shots={shots}
        assets={directorAssets}
        versions={versions}
      jobs={jobs}
      batchPersistence={{ list: api.listDirectorBatches, create: api.createDirectorBatch, update: api.updateDirectorBatch }}
        selectedShotId={selectedShotId || shots[0]?.id || ''}
        projectId={document.id}
        expectedUpdatedAt={document.updatedAt}
        dirty={dirty}
        busy={rendering || projectAction.busy || providerAction.busy}
        rendering={rendering}
        feedback={actionFeedback}
        errorMessage={actionError}
        estimatedCost={document.estimatedCost}
        providerConnected={providerReady}
        providerLabel={providerStatus.label}
        providerModel={providerStatus.model}
        providerResolution={providerStatus.resolution}
        providerUnavailableReason={providerUnavailableReason}
        providerProfileId={selectedProviderProfileId}
        providerOptions={providerOptions}
        voiceConnected={voiceStatus.connected}
        voiceProviderLabel={voiceStatus.label}
        voiceModel={voiceStatus.model}
        voiceUnavailableReason={voiceStatus.unavailableReason}
        voiceOptions={voiceStatus.voices}
        videoProviderConnected={selectedVideoProviderStatus.connected}
        videoProviderLabel={selectedVideoProviderStatus.label}
        videoProviderModel={selectedVideoProviderStatus.model}
        videoProviderUnavailableReason={selectedVideoProviderStatus.unavailableReason}
        videoProviderId={modelConfig.video.activeProviderId}
        videoProviderOptions={videoProviderOptions.map((provider) => ({ value: provider.providerId, label: `${provider.label} · ${provider.model}${provider.connected ? '' : ` · ${provider.unavailableReason ?? '未连接'}`}`, disabled: !provider.connected }))}
        outputUrl={outputAsset?.localPath ? toLocalAssetUrl(outputAsset.localPath) : undefined}
        onExportOutputVersion={(assetVersionId) => api.exportMotionComicRender({ taskId: document.id, assetVersionId })}
        outputHistory={renderOutputs.history.map((asset) => ({ id: asset.id, url: asset.localPath ? toLocalAssetUrl(asset.localPath) : undefined, createdAt: asset.createdAt, current: asset.id === outputAsset?.id }))}
        qualityReview={qualityReview}
        finalFilmGate={finalFilmGate}
        onReviewQualityArtifact={reviewQualityArtifact}
      onRecheckSubtitles={recheckSubtitles}
      onRecheckMedia={recheckMedia}
        ratio={document.ratio}
        onRatioChange={updateRatio}
        onSelectProject={(id) => { void projectLeave.requestLeave(() => openProject(id)); }}
        onSelectEpisode={selectEpisode}
        onAddEpisode={addEpisode}
        onAddScene={addScene}
        onAddShot={addShot}
        onRemoveShot={removeShot}
        onMoveShot={moveShot}
        onReorderTimelineShot={reorderTimelineShot}
        onToggleAsset={toggleConsistencyAsset}
        onRestoreVersion={restoreVersion}
        onSelectShot={setSelectedShotId}
        onUpdateShot={updateShot}
        onUpdateSubtitleCue={(shotId, cueId, patch) => mutateDocument((current) => updateDirectorSubtitleCue(current, shotId, cueId, patch))}
        onBatchApplySubtitleCues={(shotId, cues, mode) => {
          if (!documentRef.current) throw new Error('项目已关闭，请重新打开后应用字幕。');
          mutateDocument((current) => setDirectorSubtitleCues(current, shotId, cues, mode));
        }}
        onAddSubtitleCue={(shotId) => mutateDocument((current) => addDirectorSubtitleCue(current, shotId, crypto.randomUUID()))}
        onRemoveSubtitleCue={(shotId, cueId) => mutateDocument((current) => removeDirectorSubtitleCue(current, shotId, cueId))}
        onAlignSubtitleCue={(shotId, cueId) => mutateDocument((current) => estimateDirectorSubtitleCue(current, shotId, cueId))}
        onImportSubtitleTimestamps={(shotId, cueId) => void importSubtitleTimestamps(shotId, cueId)}
        onUpdateSoundClip={(shotId, clipId, patch) => mutateDocument((current) => updateDirectorAudioClip(current, shotId, clipId, patch))}
        onRemoveSoundClip={(shotId, clipId) => mutateDocument((current) => removeDirectorSoundClip(current, shotId, clipId))}
        onImportSound={importSound}
        onSave={() => void saveProject()}
        onNewProject={startCreate}
        historyUsage={productionHistoryUsage(document)}
        onGenerateShot={(shotId) => withHistoryCapacity(PRODUCTION_MEDIA_HISTORY_DEMAND, () => generateShot(shotId))}

        onGenerateVoice={generateVoice}
        onGenerateDialogueVoice={generateVoice}
        onGenerateVideo={(shotId) => withHistoryCapacity(PRODUCTION_MEDIA_HISTORY_DEMAND, () => generateVideo(shotId))}
        onRetryVideo={(shotId) => withHistoryCapacity(PRODUCTION_MEDIA_HISTORY_DEMAND, () => generateVideo(shotId, 'automatic'))}
        onResumeVideo={(shotId) => withHistoryCapacity({ assets: 1 }, () => generateVideo(shotId, 'automatic', true))}

        renderShotWorkflow={renderShotWorkflowFn}
        renderShotCandidates={renderShotCandidatesFn}
        renderCandidateDock={renderCandidateDockFn}
        onDropCandidate={dropCandidateOnShot}
        acceptsCandidateDrop={(dataTransfer) => Array.from(dataTransfer.types).includes(MOTION_COMIC_VIDEO_CANDIDATE_MIME)}
        onRender={() => withHistoryCapacity(PRODUCTION_RENDER_HISTORY_DEMAND, renderProject)}
        onCancelRender={() => api.cancelDirectorRender(document.id)}
        onOpenOutput={() => api.openTaskOutputDirectory(document.id)}
        onOpenSettings={() => setWorkflowStage('assets')}
        onConfigureProvider={() => openSettings?.('image', 'motion-comic', document.id)}
        onConfigureVideoProvider={() => openSettings?.('video', 'motion-comic', document.id)}
        backToTasksLabel={motionComicBackTarget(workflowStage).label}
        onBackToTasks={backWithinProject}
        onStageChange={(stage) => {
          if (stage === '分镜图') setWorkflowStage('storyboard');
          if (stage === '视频生成') setWorkflowStage('video');
          if (stage === '配音字幕') setWorkflowStage('audio');
          if (stage === '导出' || stage === '审片') setWorkflowStage('export');
        }}
      />
        : null}
      </MotionComicProductionWorkspace>
    </div>
  </div>;
}

export function assertMotionComicVideoRecovery(
  current: MotionComicPipelineData['providerJobs'][number] | undefined,
  original: MotionComicPipelineData['providerJobs'][number] | undefined,
): void {
  if (!current || !['running', 'failed'].includes(current.status) || current.id !== original?.id
    || !current.remoteTaskId || current.remoteTaskId !== original.remoteTaskId) {
    throw new Error('原视频任务在保存期间已变化，已停止恢复查询；本次不会重新提交生成。');
  }
}

function directorShotFromComic(episode: MotionComicEpisode, sceneTitle: string, shot: MotionComicShot, document: MotionComicPipelineData | null, videoProviderStatus?: DirectorVideoProviderStatus): DirectorShot {
  const subtitle = shot.dialogueCueIds.map((cueId) => episode.dialogueCues.find((cue) => cue.id === cueId)?.text).filter((text): text is string => text !== undefined).join('\n');
  const characterLabel = [...new Set(shot.characterLookIds.map((lookId) => document?.characters.find((character) => character.looks.some((look) => look.id === lookId))?.name).filter(Boolean))].join('、') || '未关联人物';
  const asset = shot.firstFrameAssetVersionId ? document?.assets.find((candidate) => candidate.id === shot.firstFrameAssetVersionId) : undefined;
  const cueVoiceIds = shot.dialogueCueIds.map((id) => episode.dialogueCues.find((cue) => cue.id === id)?.voiceAssetVersionId).filter((id): id is string => Boolean(id));
  const voiceAsset = document?.assets.find((candidate) => candidate.id === (cueVoiceIds[0] ?? shot.voiceAssetVersionId));
  const videoAsset = shot.videoAssetVersionId ? document?.assets.find((candidate) => candidate.id === shot.videoAssetVersionId && candidate.kind === 'video') : undefined;
  const nativeAudio = motionComicShotUsesNativeAudio(shot);
  const audioClips = motionComicPreviewAudioClips(episode, shot, document);
  const job = document ? latestProductionProviderJob(document.providerJobs, shot.id, 'text-to-image') : undefined;
  const voiceJob = document ? latestProductionProviderJob(document.providerJobs, shot.id, 'text-to-speech') : undefined;
  const selectedVideoJob = shot.videoJobId
    ? document?.providerJobs.find((candidate) => candidate.id === shot.videoJobId && candidate.nodeId === shot.id && candidate.capability === 'image-to-video')
    : undefined;
  const latestVideoJob = document ? latestProductionProviderJob(document.providerJobs, shot.id, 'image-to-video', episode.id) : undefined;
  const videoJob = latestVideoJob && ['running', 'failed', 'cancelled'].includes(latestVideoJob.status) ? latestVideoJob : selectedVideoJob;
  const firstFrameReady = Boolean(asset?.localPath && asset.kind === 'image');
  let videoInputReady = false;
  let videoInputUnavailableReason: string | undefined;
  try {
    if (!document) throw new Error('请先打开项目。');
    buildMotionComicShotVideoRequest(document, shot);
    videoInputReady = true;
  } catch (error) {
    videoInputUnavailableReason = error instanceof Error ? error.message : '视频输入尚未就绪。';
  }
  const videoReady = Boolean(videoAsset?.localPath && videoJob?.status === 'completed' && videoAsset.providerJobId === videoJob.id);
  const remoteVideo = shot.renderStrategy === 'remote-video';
  const activeJob = remoteVideo ? videoJob : job;
  const continuity = remoteVideo && videoReady ? currentMotionComicShotContinuityAdvice(episode, shot) : undefined;
  return {
    id: shot.id,
    index: shot.index,
    title: shot.title,
    scene: sceneTitle,
    durationMs: shot.durationMs,
    framing: shot.framing,
    characterLabel,
    prompt: shot.prompt,
    motionPrompt: shot.motionPrompt,
    subtitle,
    subtitleCues: shot.dialogueCueIds.flatMap((id) => episode.dialogueCues.find((cue) => cue.id === id) ?? []),
    dialogueCharacters: document?.characters.map((character) => ({ value: character.id, label: character.name })),
    thumbnail: asset?.localPath ? toLocalImageUrl(asset.localPath) : undefined,
    status: remoteVideo ? videoReady ? 'ready' : activeJob?.status === 'running' ? 'generating' : activeJob?.status === 'failed' || activeJob?.status === 'cancelled' ? 'failed' : activeJob?.status === 'queued' ? 'queued' : 'idle' : job?.status === 'completed' ? 'ready' : job?.status === 'running' ? 'generating' : job?.status === 'failed' ? 'failed' : 'queued',
    provider: activeJob ? `${activeJob.providerId} / ${activeJob.model}` : undefined,
    cost: job?.actualCost ?? job?.estimatedCost,
    voice: shot.voiceLabel,
    voiceId: shot.voiceId,
    voiceSpeed: shot.voiceSpeed,
    audioUrl: !nativeAudio && voiceAsset?.localPath ? toLocalAssetUrl(voiceAsset.localPath) : undefined,
    audioClips,
    soundClips: document ? directorSoundClips(document, shot.id) : [],
    voiceGenerationCount: document ? motionComicDialogueCuesToGenerate(document, shot.id).length : 0,
    imageReady: firstFrameReady,
    videoInputReady,
    videoFirstFrameReady: firstFrameReady,
    videoUrl: videoReady && videoAsset?.localPath ? toLocalAssetUrl(videoAsset.localPath) : undefined,
    videoJobStatus: videoJob?.status,
    voiceReady: nativeAudio ? videoReady : shot.dialogueCueIds.length === 0 || shot.dialogueCueIds.every((id) => {
      const cue = episode.dialogueCues.find((item) => item.id === id);
      return document?.assets.some((asset) => asset.id === (cue?.voiceAssetVersionId ?? shot.voiceAssetVersionId) && asset.kind === 'audio' && asset.localPath);
    }),
    imageFailed: job?.status === 'failed',
    voiceFailed: voiceJob?.status === 'failed',
    subtitleStyle: shot.subtitleStyle ?? '简体中文 · 白色描边',
    layoutTemplate: shot.layoutTemplate ?? '纪录片 · 纯画面',
    motionPreset: shot.motionPreset ?? '轻微视差',
    seed: shot.seed,
    seedLocked: shot.seedLocked,
    renderStrategy: remoteVideo ? 'living-poster' : 'deterministic-layers',
    videoLastFrameReady: Boolean(shot.lastFrameAssetVersionId && document?.assets.some((candidate) => candidate.id === shot.lastFrameAssetVersionId && candidate.kind === 'image' && candidate.localPath)),
    videoRequiresLastFrame: false,
    videoInputUnavailableReason,
    videoJobId: shot.videoJobId,
    continuityAdvice: continuity ? { level: continuity.level, score: continuity.score } : undefined,
    videoRecovery: videoJob?.remoteTaskId && ['running', 'failed'].includes(videoJob.status) ? 'resume' : videoJob?.status === 'running' ? 'unknown' : undefined,
    videoHasAttempt: Boolean(latestVideoJob),
    videoJobError: videoJob?.error,
    videoEstimatedCost: videoJob && (videoJob.status === 'completed' || videoJob.status === 'running' || videoJob.providerId === videoProviderStatus?.providerId)
      ? videoJob.actualCost ?? videoJob.estimatedCost
      : videoProviderStatus?.estimatedCost,
    linkedAssetIds: [...shot.characterLookIds, shot.sceneAssetId, ...shot.propAssetIds, ...(shot.firstFrameAssetVersionId ? [shot.firstFrameAssetVersionId] : [])],
    assetVersionIds: [...new Set([
      ...(episode.timeline.clips.find((clip) => clip.shotId === shot.id)?.assetVersionIds ?? []),
      ...(shot.firstFrameAssetVersionId ? [shot.firstFrameAssetVersionId] : []),
      ...(shot.lastFrameAssetVersionId ? [shot.lastFrameAssetVersionId] : []),
      ...(shot.videoAssetVersionId ? [shot.videoAssetVersionId] : []),
      ...(shot.voiceAssetVersionId ? [shot.voiceAssetVersionId] : []), ...cueVoiceIds,
      ...(document ? directorSoundClips(document, shot.id).map((clip) => clip.assetVersionId) : []),
    ])],
  };
}
