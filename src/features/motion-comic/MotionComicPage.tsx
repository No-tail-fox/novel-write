import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { ArrowLeft, BookOpenCheck, CheckCircle2, ChevronRight, CircleAlert, Download, FileText, ImageOff, ImagePlus, Images, Layers3, Loader2, LockKeyhole, Pin, PinOff, Plus, Save, Scissors, Settings2, ShieldCheck, Upload, Users, Video, Volume2 } from 'lucide-react';
import type { ApplyMutationResult, RendererAppState as AppState } from '../../app/route-types';
import { navigationReturnLabel } from '../../app/navigation';
import { useUnsavedChanges } from '../../app/workspace-navigation';
import { useWorkspaceDraft } from '../../app/workspace-draft';
import { mergeDirectorSavedDocument } from '../../shared/director-document-sync';
import { createProductionHistoryReservations, productionHistoryUsage, PRODUCTION_MEDIA_HISTORY_DEMAND, PRODUCTION_RENDER_HISTORY_DEMAND, type ProductionHistoryDemand, type ProductionHistoryReservation } from '../../shared/production-history';
import type { ShellView } from '../../shared/types';
import type { ProductionAssetVersion, ProductionQualityManualReview } from '../../shared/production-workflow';
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
  resolveMotionComicSceneAct,
  setMotionComicActBoundary,
  splitMotionComicSourceEpisodes,
  updateMotionComicRatio,
  updateMotionComicShotDuration,
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
import { addDirectorSubtitleCue, removeDirectorSubtitleCue, invalidateDirectorShotSpeech } from '../../shared/director-subtitle-structure';
import type { StoryDreamApi } from '../../shared/storydream-api';
import { Button, Pane, SelectField, TextAreaField, TextField, Toolbar } from '../../ui';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import { useAsyncAction, type AsyncActionFeedback } from '../../ui/async-action';
import { DirectorDeskWorkspace, type DirectorAsset, type DirectorQueueItem, type DirectorShot, type DirectorVersion } from '../director-desk/DirectorDeskWorkspace';
import type { DirectorPreviewAudioClip } from '../director-desk/DirectorAudioPreview';
import { productionAudioClipsForShot } from '../../shared/production-audio';
import { latestProductionProviderJob } from '../../shared/production-workflow';
import { addDirectorSoundClip, removeDirectorSoundClip, updateDirectorAudioClip, type DIRECTOR_SOUND_TRACKS } from '../../shared/director-audio-edit';
import { directorSoundClips, readDirectorSoundDuration } from '../director-desk/director-sound';
import { motionComicDialogueCuesToGenerate, motionComicDialogueInput, motionComicDialogueInputMatches, updateMotionComicCharacterVoice } from '../../shared/motion-comic-dialogue';
import { DirectorCopyAssist, DirectorProjectLoading, DirectorProjectRecovery } from '../director-desk/DirectorProjectStart';
import { buildDirectorCopyAssistRequest, normalizeDirectorCopyAssistError, type DirectorCopyAssistIntent } from '../director-desk/director-copy-assist';
import { applyMotionComicImageRecord, applyMotionComicVoiceRecord, directorImageInput, directorImageInputMatches, restoreMotionComicImageVersion, resolveDirectorImageProviderOptions, resolveDirectorImageProviderStatus, resolveDirectorVideoProviderOptions, resolveDirectorVideoProviderStatus, resolveDirectorVoiceProviderStatus, type DirectorVideoProviderStatus } from '../director-desk/director-generation';
import { attachMotionComicReference, createMotionComicReferenceAsset, fixedMotionComicReferenceAsset, imageLabRecordIdFromMutation, inspectMotionComicShotConsistency, motionComicConsistencyReady, motionComicConsistencySummary, motionComicReferenceAssets, motionComicReferenceVersionIds, referenceTargetLabel, setMotionComicFixedReference, type MotionComicReferenceKind, type MotionComicReferenceTarget } from './motion-comic-consistency';
import { MotionComicPlanDialog } from './MotionComicPlanDialog';
import {
  createMotionComicRuleSplitEvidence,
  motionComicSourceSplitEvidenceSchema,
  type MotionComicSourceSplitEvidence,
} from '../../shared/motion-comic-episode-planning';
import {
  isUntouchedMotionComicStarter,
  nextUnplannedMotionComicSourceEpisodeId,
  plannedMotionComicSourceEpisodeIds,
  type MotionComicPlanResult,
  type MotionComicPlanRecovery,
  type MotionComicScriptFailure,
  type MotionComicScriptDraft,
  motionComicPlanRecoverySchema,
  motionComicScriptFailureSchema,
} from '../../shared/motion-comic-planning';
import { MotionComicVideoReadiness } from './MotionComicVideoReadiness';
import { MotionComicCreateFlow, type MotionComicEpisodeDraft } from './MotionComicCreateFlow';
import { MotionComicProductionWorkspace, type MotionComicStageState } from './MotionComicProductionWorkspace';
import { MotionComicEmptyStructuredPanel, MotionComicEpisodesPanel, MotionComicScenesPanel, MotionComicSourcePanel } from './MotionComicWorkflowPanels';
import { resolveMotionComicActiveEpisodeReadiness, resolveMotionComicStageState } from './motion-comic-stage-state';
import { invalidateMotionComicVideosForChangedInputs } from '../../shared/motion-comic-video';
import { toLocalAssetUrl, toLocalImageUrl } from '../tasks/task-formatters';
import { confirmDirectorQualityReview, directorQualityReview, directorRenderOutputs } from '../../shared/director-render';
import type { DirectorSubtitleRecheckRequest, DirectorMediaRecheckRequest } from '../../shared/director-render';
import { resolveMotionComicSystemStatus } from '../../shared/director-system-status';
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
  const planningAction = useAsyncAction();
  const planApplyAction = useAsyncAction();
  const [document, setDocument] = useState<MotionComicPipelineData | null>(null);
  const documentRef = useRef<MotionComicPipelineData | null>(null);
  const savedDocumentRef = useRef<MotionComicPipelineData | null>(null);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
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
  const projectLeave = useUnsavedChanges({
    id: 'motion-comic-project', label: 'AI 漫剧项目', dirty, busy: projectAction.busy,
    onSave: saveProject,
    onDiscard: () => {
      const saved = savedDocumentRef.current;
      if (saved?.id === documentRef.current?.id) { documentRef.current = saved; setDocument(saved); }
      setDirty(false);
    },
  });
  const [referenceTargetId, setReferenceTargetId] = useState('');
  const creationDraft = useWorkspaceDraft({
    id: 'motion-comic-create', label: 'AI 漫剧新建草稿', enabled: createOpen && Boolean(createTitle.trim() || createSourceText.trim()),
    busy: projectAction.busy || sourceFileAction.busy || episodePlanningAction.busy,
    value: {
      createTitle,
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
      setCreateTitle(draft.createTitle); setCreateRatio(draft.createRatio); setCreateSourceKind(draft.createSourceKind);
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
        const result = await api.composeResearchCopy(buildDirectorCopyAssistRequest({
          mode: 'motion-comic',
          intent,
          title: submitted.createTitle,
          copy: submitted.createPremise,
        })).catch((error) => { throw normalizeDirectorCopyAssistError(error); });
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
  const [selectedProviderProfileId, setSelectedProviderProfileId] = useState(() => activeImageProfileId(state.config));

  const projects = useMemo(() => state.tasks.filter((task) => task.taskType === 'motion-comic' && !task.archivedAt).slice().sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)), [state.tasks]);
  const providerProfiles = useMemo(() => resolveDirectorImageProviderOptions(state.config, state.secretStatus), [state.config, state.secretStatus]);
  const providerStatus = useMemo(() => resolveDirectorImageProviderStatus(state.config, state.secretStatus, selectedProviderProfileId), [selectedProviderProfileId, state.config, state.secretStatus]);
  const providerOptions = useMemo(() => providerProfiles.map((profile) => ({
    value: profile.profileId,
    label: `${profile.label} · ${profile.model} · ${profile.resolution}${profile.supportsReferenceImages ? ' · 支持参考图' : ' · 不支持参考图'}${profile.connected ? '' : ' · 未连接'}`,
    disabled: !profile.connected || !profile.supportsReferenceImages,
  })), [providerProfiles]);
  const voiceStatus = useMemo(() => resolveDirectorVoiceProviderStatus(state.config, state.secretStatus), [state.config, state.secretStatus]);
  const videoProviderOptions = useMemo(() => resolveDirectorVideoProviderOptions(state.config, state.secretStatus), [state.config, state.secretStatus]);
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
  const activeEpisode: MotionComicEpisode | null = selectedUnplannedSource && document ? {
    id: selectedUnplannedSource.id, seriesId: document.series.id, number: selectedUnplannedSource.number,
    title: selectedUnplannedSource.title, logline: '', script: selectedUnplannedSource.sourceText,
    status: 'draft', scenes: [], dialogueCues: [], timeline: { durationMs: 0, clips: [], audioAssetVersionIds: [] },
  } : document?.episodes.find((episode) => episode.id === document.activeEpisodeId) ?? document?.episodes[0] ?? null;
  const videoProviderStatuses = useMemo(() => new Map((activeEpisode?.scenes ?? []).flatMap((scene) => scene.shots.map((shot) => [
    shot.id,
    resolveDirectorVideoProviderStatus(state.config, state.secretStatus, { durationMs: shot.durationMs, committedCost: committedVideoCost, requiresLastFrame: Boolean(shot.lastFrameAssetVersionId) }),
  ] as const))), [activeEpisode?.scenes, committedVideoCost, state.config, state.secretStatus]);
  const selectedVideoProviderStatus = videoProviderStatuses.get(selectedShotId || activeEpisode?.scenes[0]?.shots[0]?.id || '')
    ?? resolveDirectorVideoProviderStatus(state.config, state.secretStatus, { durationMs: activeEpisode?.scenes[0]?.shots[0]?.durationMs ?? 1_000, committedCost: committedVideoCost });
  const shots = useMemo(() => activeEpisode ? activeEpisode.scenes.flatMap((scene) => scene.shots.map((shot) => directorShotFromComic(activeEpisode, scene.title, shot, document, videoProviderStatuses.get(shot.id)))).map((shot, index) => ({ ...shot, index: index + 1 })) : [], [activeEpisode, document, videoProviderStatuses]);
  const renderOutputs = useMemo(() => document ? directorRenderOutputs(document, activeEpisode?.id) : { history: [], current: undefined }, [activeEpisode?.id, document]);
  const qualityReview = useMemo(() => document ? directorQualityReview(document, activeEpisode?.id) : undefined, [activeEpisode?.id, document]);
  const outputAsset = renderOutputs.current;
  const projectOptions = useMemo(() => projects.map((task) => ({ id: task.id, title: task.title || '未命名 AI 漫剧', meta: `创建于 ${new Date(task.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` })), [projects]);
  const episodeOptions = useMemo(() => (document?.episodes ?? []).map((episode) => ({ id: episode.id, number: episode.number, title: episode.title, meta: `${episode.scenes.length} 场 · ${episode.scenes.flatMap((scene) => scene.shots).length} 镜头` })), [document?.episodes]);
  const consistencySummary = useMemo(() => document ? motionComicConsistencySummary(document) : null, [document]);
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
  const nextSourceEpisodeId = useMemo(() => document ? nextUnplannedMotionComicSourceEpisodeId(document) : undefined, [document]);
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
      for (const stage of ['assets', 'storyboard', 'video', 'audio', 'export'] as const) {
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
  const videoUnavailable = videoRequired && [...videoProviderStatuses.values()].some((status) => !status.connected);
  const systemStatusTone = actionError ? 'error' : videoUnavailable ? 'warning' : systemStatusSummary.tone;
  const systemStatus = actionError ? systemStatusSummary.label : videoUnavailable ? '远程视频服务待配置' : systemStatusSummary.label;

  useEffect(() => {
    if (!providerAction.busy) setSelectedProviderProfileId(activeImageProfileId(state.config));
  }, [providerAction.busy, state.config]);

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
    const openedEpisode = result.value.episodes.find((episode) => episode.id === result.value.activeEpisodeId) ?? result.value.episodes[0];
    setSelectedShotId(openedEpisode?.scenes[0]?.shots[0]?.id ?? '');
    setSelectedSourceEpisodeId(nextUnplannedMotionComicSourceEpisodeId(result.value) ?? result.value.sourceDocument?.episodes[0]?.id ?? '');
    setWorkflowStage(suggestMotionComicWorkflowStage(result.value));
    setCreateOpen(false);
    setDirty(false);
  }, [api, projectAction.run]);

  useEffect(() => {
    if (!requestedTaskId) return;
    void openProject(requestedTaskId).finally(() => onRequestedTaskHandled(requestedTaskId));
  }, [onRequestedTaskHandled, openProject, requestedTaskId]);

  function mutateDocument(update: (current: MotionComicPipelineData) => MotionComicPipelineData) {
    const current = documentRef.current;
    if (!current) return;
    const next = invalidateMotionComicVideosForChangedInputs(current, update(current));
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

  function updateShot(id: string, update: Partial<DirectorShot>) {
    if (documentRef.current?.sourceDocument && update.renderStrategy !== undefined && update.renderStrategy !== 'living-poster') {
      throw new Error('导入剧本创建的 AI 漫剧只允许使用远程视频 API。');
    }
    const before = shots.find((shot) => shot.id === id);
    const invalidatesVideo = Boolean(before && (
      (update.prompt !== undefined && update.prompt !== before.prompt)
      || (update.motionPrompt !== undefined && update.motionPrompt !== before.motionPrompt)
      || (update.framing !== undefined && update.framing !== before.framing)
      || (update.durationMs !== undefined && update.durationMs !== before.durationMs)
      || (update.renderStrategy !== undefined && update.renderStrategy !== before.renderStrategy)
    ));
    if (before && ((update.voiceId !== undefined && update.voiceId !== before.voiceId) || (update.voiceSpeed !== undefined && update.voiceSpeed !== before.voiceSpeed))) {
      mutateDocument((current) => invalidateDirectorShotSpeech(current, id));
    }
    mutateDocument((current) => {
      const owningEpisode = current.episodes.find((episode) => episode.scenes.some((scene) => scene.shots.some((shot) => shot.id === id)));
      const base = owningEpisode && update.durationMs !== undefined && update.durationMs !== before?.durationMs
        ? updateMotionComicShotDuration(current, owningEpisode.id, id, update.durationMs)
        : current;
      const next: MotionComicPipelineData = {
        ...base,
        episodes: base.episodes.map((episode) => ({
          ...episode,
          scenes: episode.scenes.map((scene) => ({
            ...scene,
            shots: scene.shots.map((shot) => shot.id !== id ? shot : ({
              ...shot,
              title: update.title ?? shot.title,
              prompt: update.prompt ?? shot.prompt,
              motionPrompt: update.motionPrompt ?? shot.motionPrompt,
              framing: update.framing ?? shot.framing,
              durationMs: update.durationMs ?? shot.durationMs,
              voiceId: update.voiceId ?? shot.voiceId,
              voiceLabel: update.voice ?? shot.voiceLabel,
              voiceSpeed: update.voiceSpeed ?? shot.voiceSpeed,
              layoutTemplate: update.layoutTemplate ?? shot.layoutTemplate,
              motionPreset: update.motionPreset ?? shot.motionPreset,
              subtitleStyle: update.subtitleStyle ?? shot.subtitleStyle,
              seed: update.seed ?? shot.seed,
              seedLocked: update.seedLocked ?? shot.seedLocked,
              ...(update.renderStrategy !== undefined ? { renderStrategy: update.renderStrategy === 'living-poster' ? 'remote-video' as const : 'image-motion' as const } : {}),
             })),
          })),
        })),
      };
      return invalidatesVideo ? invalidateMotionComicShotVideo(next, id) : next;
    });
  }

  function replaceDocument(next: MotionComicPipelineData) {
    setDocument(next);
    documentRef.current = next;
    setDirty(true);
  }

  function updateRatio(ratio: MotionComicPipelineData['ratio']) {
    mutateDocument((current) => updateMotionComicRatio(current, ratio));
  }

  async function selectImageProvider(profileId: string) {
    const previousProfileId = selectedProviderProfileId;
    setSelectedProviderProfileId(profileId);
    const result = await providerAction.run(async () => {
      const option = providerProfiles.find((candidate) => candidate.profileId === profileId);
      if (!option?.connected) throw new Error(option?.unavailableReason ?? '图片生成服务未配置，请先完成设置。');
      if (!option.supportsReferenceImages) throw new Error(`${option.label} 不支持参考图编辑，请切换图片生成服务。`);
      const mutation = await api.saveConfig({ config: enableImageProfile(state.config, profileId), secretChanges: {} });
      applyState(mutation);
      return profileId;
    }, { successMessage: '生成服务已切换。' });
    if (!result.ok) setSelectedProviderProfileId(previousProfileId);
  }

  async function selectVideoProvider(providerId: string) {
    await providerAction.run(async () => {
      const option = videoProviderOptions.find((candidate) => candidate.providerId === providerId);
      if (!option?.connected) throw new Error(option?.unavailableReason ?? '当前远程视频服务不可用，请先完成配置。');
      const mutation = await api.saveConfig({
        config: { ...state.config, video: { ...state.config.video, activeProviderId: providerId } },
        secretChanges: {},
      });
      applyState(mutation);
      return providerId;
    }, { successMessage: '远程视频服务已切换。' });
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
    setSelectedSourceEpisodeId(episode.planningEvidence?.sourceEpisodeId ?? '');
    replaceDocument({ ...current, activeEpisodeId: episodeId });
    setSelectedShotId(episode.scenes[0]?.shots[0]?.id ?? '');
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
    planRequestRef.current += 1;
    planningAction.clearFeedback();
    planApplyAction.clearFeedback();
    setPlanApplyMode('append');
    setPlanResult(null);
    const sourceEpisode = documentRef.current?.sourceDocument?.episodes.find((episode) => episode.id === sourceEpisodeId);
    if (sourceEpisode) {
      const nextId = documentRef.current ? nextUnplannedMotionComicSourceEpisodeId(documentRef.current) : undefined;
      if (nextId && sourceEpisode.id !== nextId) return;
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
    setPlanRecovery(resume ? currentPlanRecovery : null);
    setPlanScriptFailure(null);
    planningDraft.persist({ ...submitted, planRecoveryJson: JSON.stringify(resume ? currentPlanRecovery : null), planScriptFailureJson: 'null' });
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
    setSelectedSourceEpisodeId(nextUnplannedMotionComicSourceEpisodeId(result.value.saved) ?? planningSourceEpisodeId ?? result.value.saved.sourceDocument?.episodes[0]?.id ?? '');
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

  function addCharacterAsset() {
    mutateDocument((current) => {
      const characterId = `character-${crypto.randomUUID()}`;
      const lookId = `look-${crypto.randomUUID()}`;
      const number = current.characters.length + 1;
      return {
        ...current,
        series: { ...current.series, characterIds: [...current.series.characterIds, characterId] },
        characters: [...current.characters, {
          id: characterId,
          name: `人物 ${number}`,
          role: '待定义',
          identityPrompt: '',
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
  }

  function addSceneAsset() {
    mutateDocument((current) => {
      const id = `scene-asset-${crypto.randomUUID()}`;
      const number = current.sceneAssets.length + 1;
      return {
        ...current,
        series: { ...current.series, sceneAssetIds: [...current.series.sceneAssetIds, id] },
        sceneAssets: [...current.sceneAssets, {
          id,
          label: `场景 ${number}`,
          description: '',
          prompt: '',
          continuityNotes: '',
          referenceAssetVersionIds: [],
        }],
      };
    });
  }

  function addPropAsset() {
    mutateDocument((current) => {
      const id = `prop-${crypto.randomUUID()}`;
      const number = current.props.length + 1;
      return {
        ...current,
        series: { ...current.series, propAssetIds: [...current.series.propAssetIds, id] },
        props: [...current.props, {
          id,
          label: `道具 ${number}`,
          description: '',
          prompt: '',
          referenceAssetVersionIds: [],
        }],
      };
    });
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

  function restoreVersion(versionId: string) {
    mutateDocument((current) => restoreMotionComicImageVersion(current, selectedShotId, versionId));
  }

  function toggleConsistencyAsset(asset: DirectorAsset) {
    if (asset.sourceVersionId) {
      restoreVersion(asset.sourceVersionId);
      return;
    }
    mutateDocument((current) => {
      let changed = false;
      const next: MotionComicPipelineData = {
        ...current,
        episodes: current.episodes.map((episode) => ({ ...episode, scenes: episode.scenes.map((scene) => ({ ...scene, shots: scene.shots.map((shot) => {
          if (shot.id !== selectedShotId) return shot;
          if (current.characters.some((character) => character.looks.some((look) => look.id === asset.id))) {
            changed = true;
            return { ...shot, characterLookIds: shot.characterLookIds.includes(asset.id) ? shot.characterLookIds.filter((id) => id !== asset.id) : [...shot.characterLookIds, asset.id] };
          }
          if (current.sceneAssets.some((sceneAsset) => sceneAsset.id === asset.id)) {
            if (shot.sceneAssetId === asset.id) return shot;
            changed = true;
            return { ...shot, sceneAssetId: asset.id };
          }
          if (current.props.some((prop) => prop.id === asset.id)) {
            changed = true;
            return { ...shot, propAssetIds: shot.propAssetIds.includes(asset.id) ? shot.propAssetIds.filter((id) => id !== asset.id) : [...shot.propAssetIds, asset.id] };
          }
          return shot;
        }) })) })),
      };
      return changed ? invalidateMotionComicShotVideo(next, selectedShotId) : current;
    });
  }

  async function importReference(kind: MotionComicReferenceKind, targetId: string) {
    const current = documentRef.current;
    if (!current || referenceAction.busy) return;
    const target = { kind, id: targetId } as const;
    const targetKey = `${kind}:${targetId}`;
    setReferenceTargetId(targetKey);
    const result = await referenceAction.run(() => withHistoryCapacity({ assets: 1 }, async () => {
      const imagePath = await api.selectLocalImage();
      if (!imagePath) return false;
      const imported = await api.addImageLabRecord({
        prompt: `AI 漫剧一致性参考图 · ${referenceTargetLabel(current, target)}`,
        ratio: current.ratio,
        style: 'reference',
        provider: 'local-import',
        imagePath,
        resolution: '2K',
        quality: 'high',
        smartMode: 'reference-edit',
        upstreamTaskId: current.id,
      });
      applyState(imported);
      const recordId = imageLabRecordIdFromMutation(imported);
      const record = await api.getImageLabRecordDetail(recordId);
      if (!record || record.status !== 'generated' || !record.imagePath) {
        throw new Error('参考图已选择，但未能完成托管导入。');
      }
      const asset = createMotionComicReferenceAsset(record, targetId, kind);
      const latest = documentRef.current;
      if (!latest || latest.id !== current.id) throw new Error('AI 漫剧项目已切换，本次参考图未写入其他项目。');
      const next = invalidateMotionComicVideosForChangedInputs(latest, attachMotionComicReference(latest, target, asset));
      setDocument(next);
      documentRef.current = next;
      setDirty(true);
      return true;
    }), { successMessage: '参考图已导入并固定到系列圣经。' });
    if (result.ok && !result.value) referenceAction.clearFeedback();
  }

  function referenceImportControl(kind: MotionComicReferenceKind, targetId: string, hasVersions: boolean) {
    const active = referenceTargetId === `${kind}:${targetId}`;
    return <Button density="compact" variant={hasVersions ? 'secondary' : 'primary'} icon={active && referenceAction.busy ? <Loader2 className="director-spin" size={13} /> : <Upload size={13} />} disabled={referenceAction.busy} onClick={() => void importReference(kind, targetId)}>{hasVersions ? '导入新版本' : '导入参考图'}</Button>;
  }

  function setFixedReference(target: MotionComicReferenceTarget, versionId: string | null) {
    setReferenceTargetId(`${target.kind}:${target.id}`);
    referenceAction.clearFeedback();
    mutateDocument((current) => setMotionComicFixedReference(current, target, versionId));
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
        title: createTitle,
        premise,
        ratio: createRatio,
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
    const mutation = await api.saveMotionComic({ id: nextDocument.id, expectedUpdatedAt: nextDocument.updatedAt, document: nextDocument });
    applyState(mutation);
    const task = await api.getTaskDetail(nextDocument.id);
    if (!task) throw new Error('AI 漫剧项目保存后无法重新读取。');
    const saved = parseMotionComicPipelineData(task.pipelineData);
    acceptSavedDocument(saved, baseline);
    return saved;
  }

  function acceptSavedDocument(saved: MotionComicPipelineData, submitted: MotionComicPipelineData) {
    const live = documentRef.current;
    if (live?.id === submitted.id) {
      savedDocumentRef.current = saved;
      const next = mergeDirectorSavedDocument(live, submitted, saved);
      setDocument(next);
      documentRef.current = next;
      setDirty(live !== submitted);
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

  async function saveProject() {
    const current = documentRef.current;
    if (!current) return false;
    const result = await projectAction.run(async () => {
      return enqueueProjectMutation(current.id, (latest) => latest);
    }, { successMessage: 'AI 漫剧项目已保存。' });
    return result.ok && documentRef.current === result.value;
  }

  async function confirmQualityReview(input: ProductionQualityManualReview) {
    const current = documentRef.current;
    if (!current) throw new Error('请先打开项目。');
    const result = await projectAction.run(() => enqueueProjectMutation(current.id, (latest) => confirmDirectorQualityReview(latest, input, latest.activeEpisodeId), false), { successMessage: '已记录当前版本的人工复核。' });
    if (!result.ok) throw result.error ?? new Error('人工复核记录失败。');
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
    if (generationError) throw generationError;
    if (!record || record.status !== 'generated' || !record.imagePath) {
      throw new Error(record?.errorMessage || '图片服务没有返回可用的关键帧文件。');
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
      for (const input of inputs) {
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
          const saved = await enqueueProjectMutation(current.id, (latest) => applyMotionComicVoiceRecord(latest, shotId, record, voiceStatus.model, input.cueId, input, measuredDurationMs));
          reservation.consume({ assets: record.status === 'generated' && record.audioPath ? 1 : 0, providerJobs: 1 });
          if (!motionComicDialogueInputMatches(saved, input)) throw new Error('对白已修改：生成音频保留在历史中，未绑定到新对白。');
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

  async function generateVideo(shotId: string) {
    const projectId = documentRef.current?.id;
    if (!projectId) throw new Error('当前 AI 漫剧项目不存在。');
    const pending = persistQueueRef.current.then(async () => {
      const latest = documentRef.current;
      if (!latest || latest.id !== projectId) throw new Error('AI 漫剧项目已切换，本次视频生成已取消。');
      const sourceShot = latest.episodes.flatMap((episode) => episode.scenes.flatMap((scene) => scene.shots)).find((shot) => shot.id === shotId);
      if (!sourceShot) throw new Error('当前 AI 漫剧镜头不存在。');
      if (sourceShot.renderStrategy !== 'remote-video') throw new Error('当前镜头使用图片运镜，无需调用远程视频服务。');
      const current = await persistProject(latest);
      try {
        const response = await api.generateDirectorShotVideo({ id: current.id, shotId, expectedUpdatedAt: current.updatedAt });
        applyState(response.mutation);
        const task = await api.getTaskDetail(projectId);
        if (!task) throw new Error('远程镜头视频已生成，但项目无法重新读取。');
        const saved = parseMotionComicPipelineData(task.pipelineData);
        acceptSavedDocument(saved, current);
        const asset = saved.assets.find((candidate) => candidate.id === response.result.videoAssetVersionId && candidate.kind === 'video');
        if (!asset?.localPath) throw new Error('远程视频任务完成，但没有返回可播放的视频资产。');
        return {
          videoUrl: toLocalAssetUrl(asset.localPath),
          provider: response.result.providerName,
          model: response.result.model,
          estimatedCost: response.result.estimatedCost,
          jobId: response.result.videoJobId,
        };
      } catch (error) {
        const task = await api.getTaskDetail(projectId).catch(() => null);
        if (task) acceptSavedDocument(parseMotionComicPipelineData(task.pipelineData), current);
        throw error;
      }
    });
    persistQueueRef.current = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async function renderProject() {
    await persistQueueRef.current;
    let current = documentRef.current;
    if (!current) throw new Error('当前 AI 漫剧项目不存在。');
    if (dirty) current = await enqueueProjectMutation(current.id, (latest) => latest);
    const response = await api.renderDirectorProject({ id: current.id, episodeId: current.activeEpisodeId });
    applyState(response.mutation);
    const task = await api.getTaskDetail(current.id);
    if (!task) throw new Error('AI 漫剧成片已生成，但项目无法重新读取。');
    const saved = parseMotionComicPipelineData(task.pipelineData);
    acceptSavedDocument(saved, current);
  }

  if (loadingProjectId) return <div data-motion-comic-workbench="true"><DirectorProjectLoading mode="motion-comic" /></div>;

  if (createOpen) {
    return <div data-motion-comic-workbench="true"><MotionComicCreateFlow
      step={createStep}
      title={createTitle}
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

  if (!document || !activeEpisode) return <div data-motion-comic-workbench="true"><DirectorProjectRecovery mode="motion-comic" errorMessage={actionError} onNewProject={startCreate} /></div>;

  if (workflowStage === 'assets') return <div data-motion-comic-workbench="true"><MotionComicProductionWorkspace
    document={document}
    stage="assets"
    stageState={stageState}
    dirty={dirty}
    busy={projectAction.busy || providerAction.busy || referenceAction.busy}
    feedback={actionFeedback}
    errorMessage={actionError}
    onStageChange={setWorkflowStage}
    onSave={() => void saveProject()}
    onNewProject={startCreate}
    onBack={() => navigate?.(returnView)}
  ><div data-motion-comic-series-bible="true" className="director-series-page">
    <header className="director-series-header">
      <div><Button variant="subtle" icon={<ArrowLeft size={14} />} onClick={() => setWorkflowStage('scenes')}>返回分幕分场</Button><span><BookOpenCheck size={18} /><strong>角色资产</strong><small>确认人物、场景、道具定义，再固定视觉参考图</small></span></div>
      <Toolbar aria-label="角色资产操作"><Button variant="subtle" icon={<Settings2 size={14} />} onClick={() => openSettings?.('image', 'motion-comic', document.id)}>图片模型</Button><Button variant="primary" icon={<Images size={14} />} disabled={!stageState.assets.complete} onClick={() => setWorkflowStage('storyboard')}>进入分镜图</Button></Toolbar>
    </header>
    <div className="director-series-layout">
      <Pane as="aside" tone="subtle" className="director-series-summary">
        <ShieldCheck size={20} />
        <h2>{document.title}</h2>
        <p>{document.series.premise}</p>
        <dl><div><dt>类型</dt><dd>{document.series.genre}</dd></div><div><dt>角色</dt><dd>{document.characters.length}</dd></div><div><dt>场景</dt><dd>{document.sceneAssets.length}</dd></div><div><dt>道具</dt><dd>{document.props.length}</dd></div></dl>
        <div className={`motion-comic-readiness ${displayedConsistencyReady ? 'is-ready' : 'is-warning'}`} role="status">
          {displayedConsistencyReady ? <CheckCircle2 size={16} /> : <CircleAlert size={16} />}
          <span><strong>{displayedConsistencyReady ? '一致性素材已就绪' : '一致性素材待补充'}</strong><small>{consistencySummary ? `${consistencySummary.readyTargetCount}/${consistencySummary.requiredTargetCount} 个引用目标已固定 · 单镜头最多 ${consistencySummary.maxReferencesPerShot} 张` : '正在检查素材'}</small></span>
        </div>
        {displayedMissingTargets.length > 0 ? <div className="motion-comic-missing-list"><strong>当前缺少</strong>{displayedMissingTargets.slice(0, 5).map((label) => <span key={label}>{label}</span>)}{displayedMissingTargets.length > 5 ? <small>另有 {displayedMissingTargets.length - 5} 项</small> : null}</div> : null}
        <span>所有修改先保留在本地草稿，点击保存后写入项目版本。</span>
      </Pane>
      <main className="director-series-editor">
        <section><div className="director-series-section-heading"><span>01</span><div><h2>系列定位</h2><p>确定故事承诺、观众和不可随意改写的世界规则。</p></div></div><TextField label="系列名称" value={document.title} onChange={(_, data) => mutateDocument((current) => ({ ...current, title: data.value, series: { ...current.series, title: data.value } }))} /><div className="director-copy-field">
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
        <section>
          <div className="director-series-section-heading"><span>02</span><div><h2>角色一致性</h2><p>身份提示词和造型必须跨集复用，不能由单镜头临时覆盖。</p></div><Button density="compact" variant="secondary" icon={<Plus size={13} />} onClick={addCharacterAsset}>新增人物</Button></div>
          {document.characters.length === 0 ? <div className="motion-comic-asset-empty"><Users size={20} /><span><strong>当前没有人物</strong><small>空镜或道具特写可以继续制作；需要角色时在这里补录。</small></span></div> : null}
          {document.characters.map((character, index) => <div key={character.id} className="director-series-entity">
            <div className="director-create-two-col"><TextField label={`角色 ${index + 1}`} value={character.name} onChange={(_, data) => mutateDocument((current) => ({ ...current, characters: current.characters.map((item) => item.id === character.id ? { ...item, name: data.value } : item) }))} /><TextField label="戏剧作用" value={character.role} onChange={(_, data) => mutateDocument((current) => ({ ...current, characters: current.characters.map((item) => item.id === character.id ? { ...item, role: data.value } : item) }))} /></div>
            <TextAreaField label="身份提示词" value={character.identityPrompt} onChange={(_, data) => mutateDocument((current) => ({ ...current, characters: current.characters.map((item) => item.id === character.id ? { ...item, identityPrompt: data.value } : item) }))} resize="vertical" />
            <div className="director-create-two-col"><TextAreaField label="性格与行为" value={character.personality} onChange={(_, data) => mutateDocument((current) => ({ ...current, characters: current.characters.map((item) => item.id === character.id ? { ...item, personality: data.value } : item) }))} resize="vertical" /><TextAreaField label="声音说明" value={character.voiceNotes} onChange={(_, data) => mutateDocument((current) => ({ ...current, characters: current.characters.map((item) => item.id === character.id ? { ...item, voiceNotes: data.value } : item) }))} resize="vertical" /></div>
            <div className="director-create-two-col">
              <SelectField label={`${character.name}音色`} value={character.voiceId ?? ''} options={[{ value: '', label: '跟随镜头默认音色' }, ...voiceStatus.voices, ...(character.voiceId && !voiceStatus.voices.some((voice) => voice.value === character.voiceId) ? [{ value: character.voiceId, label: `${character.voiceId} · 已保存音色` }] : [])]} validationMessage={character.voiceProvider && character.voiceProvider !== voiceStatus.provider ? '该角色音色属于另一服务，请重新选择。' : undefined} onChange={(event) => mutateDocument((current) => updateMotionComicCharacterVoice(current, character.id, { voiceProvider: voiceStatus.provider, voiceId: event.target.value || undefined }))} />
              <SelectField label={`${character.name}语速`} value={String(character.voiceSpeed ?? '')} options={[{ value: '', label: '跟随镜头语速' }, { value: '0.8', label: '0.80x' }, { value: '1', label: '1.00x' }, { value: '1.2', label: '1.20x' }]} onChange={(event) => mutateDocument((current) => updateMotionComicCharacterVoice(current, character.id, { voiceProvider: character.voiceProvider ?? voiceStatus.provider, voiceSpeed: event.target.value ? Number(event.target.value) : undefined }))} />
            </div>
            {character.looks.map((look) => {
              const target = { kind: 'look' as const, id: look.id };
              const targetKey = `look:${look.id}`;
              const versions = motionComicReferenceAssets(document, look.referenceAssetVersionIds);
              const fixed = fixedMotionComicReferenceAsset(document, look.referenceAssetVersionIds);
              return <div key={look.id} className="director-series-look">
                <TextField label="造型名称" value={look.label} onChange={(_, data) => mutateDocument((current) => ({ ...current, characters: current.characters.map((item) => item.id === character.id ? { ...item, looks: item.looks.map((candidate) => candidate.id === look.id ? { ...candidate, label: data.value } : candidate) } : item) }))} />
                <TextAreaField label="外观与服装" value={`${look.appearancePrompt}\n${look.wardrobe}`} onChange={(_, data) => { const [appearancePrompt = '', ...wardrobe] = data.value.split('\n'); mutateDocument((current) => ({ ...current, characters: current.characters.map((item) => item.id === character.id ? { ...item, looks: item.looks.map((candidate) => candidate.id === look.id ? { ...candidate, appearancePrompt, wardrobe: wardrobe.join('\n') } : candidate) } : item) })); }} resize="vertical" />
                <MotionComicReferenceEditor label={`${character.name} · ${look.label}`} versions={versions} fixedVersionId={fixed?.id} busy={referenceAction.busy} active={referenceTargetId === targetKey} feedback={referenceTargetId === targetKey ? referenceAction.feedback : null} importControl={referenceImportControl('look', look.id, versions.length > 0)} onSetFixed={(versionId) => setFixedReference(target, versionId)} onImageStatus={markReferenceFileStatus} />
              </div>;
            })}
          </div>)}
        </section>
        <section>
          <div className="director-series-section-heading"><span>03</span><div><h2>场景一致性</h2><p>固定建筑、光线、天气与时间，供所有镜头直接引用。</p></div><Button density="compact" variant="secondary" icon={<Plus size={13} />} onClick={addSceneAsset}>新增场景</Button></div>
          {document.sceneAssets.length === 0 ? <div className="motion-comic-asset-empty"><ImagePlus size={20} /><span><strong>当前没有场景资产</strong><small>补录场景后可生成或导入固定参考图。</small></span></div> : null}
          {document.sceneAssets.map((asset) => {
            const target = { kind: 'scene' as const, id: asset.id };
            const targetKey = `scene:${asset.id}`;
            const versions = motionComicReferenceAssets(document, asset.referenceAssetVersionIds);
            const fixed = fixedMotionComicReferenceAsset(document, asset.referenceAssetVersionIds);
            return <div key={asset.id} className="director-series-entity">
              <TextField label="场景名称" value={asset.label} onChange={(_, data) => mutateDocument((current) => ({ ...current, sceneAssets: current.sceneAssets.map((item) => item.id === asset.id ? { ...item, label: data.value } : item) }))} />
              <TextAreaField label="场景说明" value={asset.description} onChange={(_, data) => mutateDocument((current) => ({ ...current, sceneAssets: current.sceneAssets.map((item) => item.id === asset.id ? { ...item, description: data.value } : item) }))} resize="vertical" />
              <TextAreaField label="生成提示词" value={asset.prompt} onChange={(_, data) => mutateDocument((current) => ({ ...current, sceneAssets: current.sceneAssets.map((item) => item.id === asset.id ? { ...item, prompt: data.value } : item) }))} resize="vertical" />
              <TextAreaField label="连续性说明" value={asset.continuityNotes} onChange={(_, data) => mutateDocument((current) => ({ ...current, sceneAssets: current.sceneAssets.map((item) => item.id === asset.id ? { ...item, continuityNotes: data.value } : item) }))} resize="vertical" />
              <MotionComicReferenceEditor label={asset.label} versions={versions} fixedVersionId={fixed?.id} busy={referenceAction.busy} active={referenceTargetId === targetKey} feedback={referenceTargetId === targetKey ? referenceAction.feedback : null} importControl={referenceImportControl('scene', asset.id, versions.length > 0)} onSetFixed={(versionId) => setFixedReference(target, versionId)} onImageStatus={markReferenceFileStatus} />
            </div>;
          })}
        </section>
        <section>
          <div className="director-series-section-heading"><span>04</span><div><h2>道具一致性</h2><p>关键物件必须保持轮廓、材质和标记可识别。</p></div><Button density="compact" variant="secondary" icon={<Plus size={13} />} onClick={addPropAsset}>新增道具</Button></div>
          {document.props.length === 0 ? <div className="motion-comic-asset-empty"><Plus size={20} /><span><strong>当前没有关键道具</strong><small>没有道具时无需补齐；需要连续性物件时可手动新增。</small></span></div> : null}
          {document.props.map((asset) => {
            const target = { kind: 'prop' as const, id: asset.id };
            const targetKey = `prop:${asset.id}`;
            const versions = motionComicReferenceAssets(document, asset.referenceAssetVersionIds);
            const fixed = fixedMotionComicReferenceAsset(document, asset.referenceAssetVersionIds);
            return <div key={asset.id} className="director-series-entity">
              <TextField label="道具名称" value={asset.label} onChange={(_, data) => mutateDocument((current) => ({ ...current, props: current.props.map((item) => item.id === asset.id ? { ...item, label: data.value } : item) }))} />
              <TextAreaField label="道具说明" value={asset.description} onChange={(_, data) => mutateDocument((current) => ({ ...current, props: current.props.map((item) => item.id === asset.id ? { ...item, description: data.value } : item) }))} resize="vertical" />
              <TextAreaField label="生成提示词" value={asset.prompt} onChange={(_, data) => mutateDocument((current) => ({ ...current, props: current.props.map((item) => item.id === asset.id ? { ...item, prompt: data.value } : item) }))} resize="vertical" />
              <MotionComicReferenceEditor label={asset.label} versions={versions} fixedVersionId={fixed?.id} busy={referenceAction.busy} active={referenceTargetId === targetKey} feedback={referenceTargetId === targetKey ? referenceAction.feedback : null} importControl={referenceImportControl('prop', asset.id, versions.length > 0)} onSetFixed={(versionId) => setFixedReference(target, versionId)} onImageStatus={markReferenceFileStatus} />
            </div>;
          })}
        </section>
      </main>
    </div>
  </div></MotionComicProductionWorkspace></div>;

  return <>
    <MotionComicPlanDialog
      open={planOpen}
      sourceText={planSourceText}
      instructions={planInstructions}
      targetDurationSec={planTargetDurationSec}
      episodeNumber={document.sourceDocument?.episodes.find((episode) => episode.id === planningSourceEpisodeId)?.number ?? document.episodes.filter((episode) => episode.scenes.length > 0).length + 1}
      result={planResult}
      recovery={currentPlanRecovery}
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
    <div data-motion-comic-workbench="true">
      <MotionComicProductionWorkspace
        document={document}
        stage={workflowStage}
        stageState={stageState}
        dirty={dirty}
        busy={projectAction.busy || providerAction.busy || planningAction.busy || planApplyAction.busy}
        showProjectHeader={!['storyboard', 'video', 'audio', 'export'].includes(workflowStage)}
        feedback={actionFeedback}
        errorMessage={actionError}
        onStageChange={setWorkflowStage}
        onSave={() => void saveProject()}
        onNewProject={startCreate}
        onBack={() => navigate?.(returnView)}
      >
        {workflowStage === 'source' ? <MotionComicSourcePanel document={document} onContinue={setWorkflowStage} /> : null}
        {workflowStage === 'episodes' ? <MotionComicEpisodesPanel
          document={document}
          selectedSourceEpisodeId={selectedSourceEpisode?.id ?? ''}
          plannedSourceEpisodeIds={plannedSourceEpisodeIds}
          nextSourceEpisodeId={nextSourceEpisodeId}
          onSelectSourceEpisode={setSelectedSourceEpisodeId}
          onPlanEpisode={(sourceEpisodeId) => openPlanDialog(sourceEpisodeId)}
          onSelectGeneratedEpisode={selectEpisode}
          onContinue={setWorkflowStage}
        /> : null}
        {workflowStage === 'scenes' ? <MotionComicScenesPanel
          document={document}
          activeEpisode={activeEpisode}
          onSelectEpisode={selectEpisode}
          onAddScene={addScene}
          onUpdateScene={updateScene}
          onSetActBoundary={setActBoundary}
          onRenameAct={renameAct}
          onPlanEpisode={(sourceEpisodeId) => openPlanDialog(sourceEpisodeId)}
          onContinue={setWorkflowStage}
        /> : null}
        {['storyboard', 'video', 'audio', 'export'].includes(workflowStage) ? <DirectorDeskWorkspace
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
        busy={projectAction.busy || providerAction.busy}
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
        videoProviderId={state.config.video.activeProviderId}
        videoProviderOptions={videoProviderOptions.map((provider) => ({ value: provider.providerId, label: `${provider.label} · ${provider.model}${provider.connected ? '' : ` · ${provider.unavailableReason ?? '未连接'}`}`, disabled: !provider.connected }))}
        outputUrl={outputAsset?.localPath ? toLocalAssetUrl(outputAsset.localPath) : undefined}
        outputHistory={renderOutputs.history.map((asset) => ({ id: asset.id, url: asset.localPath ? toLocalAssetUrl(asset.localPath) : undefined, createdAt: asset.createdAt, current: asset.id === outputAsset?.id }))}
        qualityReview={qualityReview}
        onConfirmQualityReview={confirmQualityReview}
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
        onToggleAsset={toggleConsistencyAsset}
        onRestoreVersion={restoreVersion}
        onSelectShot={setSelectedShotId}
        onUpdateShot={updateShot}
        onUpdateSubtitleCue={(shotId, cueId, patch) => mutateDocument((current) => updateDirectorSubtitleCue(current, shotId, cueId, patch))}
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
        onProviderProfileChange={selectImageProvider}
        onGenerateVoice={generateVoice}
        onGenerateDialogueVoice={generateVoice}
        onGenerateVideo={(shotId) => withHistoryCapacity(PRODUCTION_MEDIA_HISTORY_DEMAND, () => generateVideo(shotId))}
        onRetryVideo={(shotId) => withHistoryCapacity(PRODUCTION_MEDIA_HISTORY_DEMAND, () => generateVideo(shotId))}
        onVideoProviderChange={selectVideoProvider}
        renderShotWorkflow={(shotId, busy) => {
          const shot = shots.find((candidate) => candidate.id === shotId);
          if (!shot) return null;
          const status = videoProviderStatuses.get(shotId) ?? selectedVideoProviderStatus;
          return <MotionComicVideoReadiness
            shot={shot}
            connected={status.connected}
            providerLabel={status.label}
            providerModel={status.model}
            providerId={state.config.video.activeProviderId}
            providerOptions={videoProviderOptions.map((provider) => ({
              value: provider.providerId,
              label: `${provider.label} · ${provider.model}${provider.connected ? '' : ` · ${provider.unavailableReason ?? '未连接'}`}`,
              disabled: !provider.connected,
            }))}
            unavailableReason={status.unavailableReason}
            busy={busy}
            remoteOnly={Boolean(document.sourceDocument)}
            onStrategyChange={(strategy) => updateShot(shotId, { renderStrategy: strategy })}
            onProviderChange={selectVideoProvider}
            onConfigureProvider={() => openSettings?.('video', 'motion-comic', document.id)}
          />;
        }}
        onRender={() => withHistoryCapacity(PRODUCTION_RENDER_HISTORY_DEMAND, renderProject)}
        onOpenOutput={() => api.openTaskOutputDirectory(document.id)}
        onOpenSettings={() => setWorkflowStage('assets')}
        onConfigureProvider={() => openSettings?.('image', 'motion-comic', document.id)}
        onConfigureVideoProvider={() => openSettings?.('video', 'motion-comic', document.id)}
        backToTasksLabel={navigationReturnLabel(returnView)}
        onBackToTasks={() => navigate?.(returnView)}
        onStageChange={(stage) => {
          if (stage === '配音字幕') setWorkflowStage('audio');
          if (stage === '导出' || stage === '审片') setWorkflowStage('export');
        }}
      />
        : null}
      </MotionComicProductionWorkspace>
    </div>
  </>;
}

function MotionComicReferenceEditor({
  label,
  versions,
  fixedVersionId,
  busy,
  active,
  feedback,
  importControl,
  onSetFixed,
  onImageStatus,
}: {
  label: string;
  versions: readonly ProductionAssetVersion[];
  fixedVersionId?: string;
  busy: boolean;
  active: boolean;
  feedback: AsyncActionFeedback | null;
  importControl: ReactElement;
  onSetFixed: (versionId: string | null) => void;
  onImageStatus: (versionId: string, status: 'ready' | 'error') => void;
}) {
  const newestFirst = [...versions].reverse();
  const state = fixedVersionId ? 'fixed' : versions.length > 0 ? 'unfixed' : 'missing';
  return <div className={`motion-comic-reference is-${state}`} data-motion-comic-reference={state} aria-busy={active && busy}>
    <div className="motion-comic-reference-header">
      <span className="motion-comic-reference-title">
        <Images size={15} />
        <span><strong>一致性参考图</strong><small>{fixedVersionId ? `已固定 · ${versions.length} 个版本` : versions.length > 0 ? `${versions.length} 个版本 · 尚未固定` : '缺少参考图'}</small></span>
      </span>
      <Toolbar aria-label={`${label}参考图操作`}>
        {fixedVersionId ? <Button density="compact" variant="subtle" icon={<PinOff size={13} />} disabled={busy} onClick={() => onSetFixed(null)}>取消固定</Button> : null}
        {importControl}
      </Toolbar>
    </div>
    {versions.length === 0 ? <div className="motion-comic-reference-empty">
      {active && busy ? <Loader2 className="director-spin" size={18} /> : <ImagePlus size={18} />}
      <span><strong>{active && busy ? '正在托管参考图' : '缺少参考图'}</strong><small>{active && busy ? '完成后会自动固定为当前版本' : `${label}尚未建立视觉基准`}</small></span>
    </div> : <div className="motion-comic-reference-versions" aria-label={`${label}参考图版本`}>
      {newestFirst.map((version, reverseIndex) => {
        const versionNumber = versions.length - reverseIndex;
        const fixed = version.id === fixedVersionId;
        return <div key={version.id} className={`motion-comic-reference-version ${fixed ? 'is-fixed' : ''}`}>
          <ReferenceImagePreview src={toLocalImageUrl(version.localPath!)} alt={`${label}参考图版本 ${versionNumber}`} onStatusChange={(status) => onImageStatus(version.id, status)} />
          <span className="motion-comic-reference-version-meta"><strong>v{versionNumber}</strong><small>{formatReferenceDate(version.createdAt)}</small></span>
          {fixed
            ? <span className="motion-comic-reference-fixed"><LockKeyhole size={12} />当前固定</span>
            : <Button density="compact" variant="subtle" icon={<Pin size={12} />} disabled={busy} onClick={() => onSetFixed(version.id)}>固定此版本</Button>}
        </div>;
      })}
    </div>}
    {active ? <InlineActionFeedback feedback={feedback} /> : null}
  </div>;
}

function ReferenceImagePreview({ src, alt, onStatusChange }: { src: string; alt: string; onStatusChange: (status: 'ready' | 'error') => void }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [src]);
  return <span className={`motion-comic-reference-image ${failed ? 'is-error' : ''}`}>
    {failed ? <span role="img" aria-label={`${alt}加载失败`}><ImageOff size={18} /><small>文件不可用</small></span> : <img src={src} alt={alt} loading="lazy" onLoad={() => onStatusChange('ready')} onError={() => { setFailed(true); onStatusChange('error'); }} />}
  </span>;
}

function formatReferenceDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function suggestMotionComicWorkflowStage(document: MotionComicPipelineData): MotionComicWorkflowStage {
  const generatedEpisodes = document.episodes.filter((episode) => episode.scenes.length > 0);
  const plannedSourceCount = document.sourceDocument ? plannedMotionComicSourceEpisodeIds(document).size : generatedEpisodes.length;
  if (document.sourceDocument && plannedSourceCount < document.sourceDocument.episodes.length) return 'episodes';
  if (generatedEpisodes.length === 0) return document.sourceDocument ? 'episodes' : 'source';
  if (generatedEpisodes.some((episode) => {
    const acts = episode.scenes.map((scene, index) => resolveMotionComicSceneAct(scene, index, episode.scenes.length));
    return acts.some((act, index) => index === 0
      ? act.actIndex !== 1
      : act.actIndex !== acts[index - 1].actIndex && act.actIndex !== acts[index - 1].actIndex + 1);
  })) return 'scenes';
  if (!motionComicConsistencyReady(document)) return 'assets';
  const shots = generatedEpisodes.flatMap((episode) => episode.scenes.flatMap((scene) => scene.shots));
  if (shots.some((shot) => !shot.firstFrameAssetVersionId)) return 'storyboard';
  if (shots.some((shot) => shot.renderStrategy === 'remote-video' && !shot.videoAssetVersionId)) return 'video';
  const cues = generatedEpisodes.flatMap((episode) => episode.dialogueCues);
  if (cues.some((cue) => !cue.voiceAssetVersionId && !cue.audioAssetVersionId)) return 'audio';
  return 'export';
}

function directorShotFromComic(episode: MotionComicEpisode, sceneTitle: string, shot: MotionComicShot, document: MotionComicPipelineData | null, videoProviderStatus?: DirectorVideoProviderStatus): DirectorShot {
  const subtitle = shot.dialogueCueIds.map((cueId) => episode.dialogueCues.find((cue) => cue.id === cueId)?.text).filter(Boolean).join(' ');
  const characterLabel = shot.characterLookIds.map((lookId) => document?.characters.flatMap((character) => character.looks).find((look) => look.id === lookId)?.label).filter(Boolean).join('、') || '角色待绑定';
  const asset = shot.firstFrameAssetVersionId ? document?.assets.find((candidate) => candidate.id === shot.firstFrameAssetVersionId) : undefined;
  const cueVoiceIds = shot.dialogueCueIds.map((id) => episode.dialogueCues.find((cue) => cue.id === id)?.voiceAssetVersionId).filter((id): id is string => Boolean(id));
  const voiceAsset = document?.assets.find((candidate) => candidate.id === (cueVoiceIds[0] ?? shot.voiceAssetVersionId));
  const videoAsset = shot.videoAssetVersionId ? document?.assets.find((candidate) => candidate.id === shot.videoAssetVersionId && candidate.kind === 'video') : undefined;
  const audioClips: DirectorPreviewAudioClip[] = (productionAudioClipsForShot(episode.timeline, shot) ?? [])
    .flatMap((clip) => {
      const asset = document?.assets.find((candidate) => candidate.id === clip.assetVersionId && candidate.kind === 'audio');
      return asset?.localPath ? [{ id: clip.id, url: toLocalAssetUrl(asset.localPath), startMs: clip.startMs, durationMs: clip.durationMs ?? clip.sourceDurationMs ?? shot.durationMs, sourceStartMs: clip.sourceStartMs, sourceDurationMs: clip.sourceDurationMs, gainDb: clip.gainDb, fadeInMs: clip.fadeInMs, fadeOutMs: clip.fadeOutMs, muted: clip.muted }] : [];
    });
  const job = document ? latestProductionProviderJob(document.providerJobs, shot.id, 'text-to-image') : undefined;
  const voiceJob = document ? latestProductionProviderJob(document.providerJobs, shot.id, 'text-to-speech') : undefined;
  const selectedVideoJob = shot.videoJobId
    ? document?.providerJobs.find((candidate) => candidate.id === shot.videoJobId && candidate.nodeId === shot.id && candidate.capability === 'image-to-video')
    : undefined;
  const latestVideoJob = document ? latestProductionProviderJob(document.providerJobs, shot.id, 'image-to-video', episode.id) : undefined;
  const videoJob = selectedVideoJob ?? (latestVideoJob?.status === 'running' ? latestVideoJob : undefined);
  const firstFrameReady = Boolean(asset?.localPath && asset.kind === 'image');
  const videoReady = Boolean(videoAsset?.localPath && videoJob?.status === 'completed' && videoAsset.providerJobId === videoJob.id);
  const remoteVideo = shot.renderStrategy === 'remote-video';
  const activeJob = remoteVideo ? videoJob : job;
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
    status: remoteVideo ? videoReady ? 'ready' : activeJob?.status === 'running' ? 'generating' : activeJob?.status === 'failed' || activeJob?.status === 'cancelled' ? 'failed' : 'queued' : job?.status === 'completed' ? 'ready' : job?.status === 'running' ? 'generating' : job?.status === 'failed' ? 'failed' : 'queued',
    provider: activeJob ? `${activeJob.providerId} / ${activeJob.model}` : undefined,
    cost: activeJob?.actualCost ?? activeJob?.estimatedCost,
    voice: shot.voiceLabel,
    voiceId: shot.voiceId,
    voiceSpeed: shot.voiceSpeed,
    audioUrl: voiceAsset?.localPath ? toLocalAssetUrl(voiceAsset.localPath) : undefined,
    audioClips,
    soundClips: document ? directorSoundClips(document, shot.id) : [],
    voiceGenerationCount: document ? motionComicDialogueCuesToGenerate(document, shot.id).length : 0,
    imageReady: firstFrameReady,
    voiceReady: shot.dialogueCueIds.length === 0 || shot.dialogueCueIds.every((id) => {
      const cue = episode.dialogueCues.find((item) => item.id === id);
      return document?.assets.some((asset) => asset.id === (cue?.voiceAssetVersionId ?? shot.voiceAssetVersionId) && asset.kind === 'audio' && asset.localPath);
    }),
    imageFailed: job?.status === 'failed',
    voiceFailed: voiceJob?.status === 'failed',
    subtitleStyle: shot.subtitleStyle ?? '简体中文 · 白色描边',
    layoutTemplate: shot.layoutTemplate ?? '漫画分格 · 角色优先',
    motionPreset: shot.motionPreset ?? '轻微视差',
    seed: shot.seed,
    seedLocked: shot.seedLocked,
    renderStrategy: remoteVideo ? 'living-poster' : 'deterministic-layers',
    videoInputReady: firstFrameReady,
    videoFirstFrameReady: firstFrameReady,
    videoLastFrameReady: Boolean(shot.lastFrameAssetVersionId && document?.assets.some((candidate) => candidate.id === shot.lastFrameAssetVersionId && candidate.kind === 'image' && candidate.localPath)),
    videoRequiresLastFrame: false,
    videoInputUnavailableReason: firstFrameReady ? undefined : '请先生成或选择一张可读取的关键帧图片。',
    videoUrl: videoAsset?.localPath ? toLocalAssetUrl(videoAsset.localPath) : undefined,
    videoJobId: shot.videoJobId,
    videoJobStatus: videoJob?.status ?? 'idle',
    videoJobError: videoJob?.error,
    videoEstimatedCost: videoJob?.actualCost ?? videoJob?.estimatedCost ?? videoProviderStatus?.estimatedCost,
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
