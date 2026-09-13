import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { ArrowLeft, BookOpenCheck, CheckCircle2, CircleAlert, ImageOff, ImagePlus, Images, Loader2, LockKeyhole, Pin, PinOff, Save, Settings2, ShieldCheck, Upload } from 'lucide-react';
import type { ApplyMutationResult, RendererAppState as AppState } from '../../app/route-types';
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
  MOTION_COMIC_RATIOS,
  parseMotionComicPipelineData,
  removeMotionComicShot,
  reorderMotionComicShot,
  updateMotionComicShotDuration,
  type MotionComicEpisode,
  type MotionComicPipelineData,
  type MotionComicShot,
} from '../../shared/motion-comic';
import { activeImageProfileId, enableImageProfile } from '../../shared/provider-profile-utils';
import { AppError } from '../../shared/app-error';
import { alignDirectorSubtitleCueFromTimestampFile, updateDirectorSubtitleCue, estimateDirectorSubtitleCue } from '../../shared/director-subtitles';
import { addDirectorSubtitleCue, removeDirectorSubtitleCue, invalidateDirectorShotSpeech } from '../../shared/director-subtitle-structure';
import type { StoryDreamApi } from '../../shared/storydream-api';
import { Button, CheckboxField, Pane, SegmentedControl, SelectField, TextAreaField, TextField, Toolbar } from '../../ui';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import { useAsyncAction, type AsyncActionFeedback } from '../../ui/async-action';
import { DirectorDeskWorkspace, type DirectorAsset, type DirectorQueueItem, type DirectorShot, type DirectorVersion } from '../director-desk/DirectorDeskWorkspace';
import type { DirectorPreviewAudioClip } from '../director-desk/DirectorAudioPreview';
import { productionAudioClipsForShot } from '../../shared/production-audio';
import { latestProductionProviderJob } from '../../shared/production-workflow';
import { addDirectorSoundClip, removeDirectorSoundClip, updateDirectorAudioClip, type DIRECTOR_SOUND_TRACKS } from '../../shared/director-audio-edit';
import { directorSoundClips, readDirectorSoundDuration } from '../director-desk/director-sound';
import { motionComicDialogueCuesToGenerate, motionComicDialogueInput, motionComicDialogueInputMatches, updateMotionComicCharacterVoice } from '../../shared/motion-comic-dialogue';
import { DirectorCopyAssist, DirectorCreateWizard, DirectorProjectLoading, DirectorProjectRecovery } from '../director-desk/DirectorProjectStart';
import { buildDirectorCopyAssistRequest, normalizeDirectorCopyAssistError, type DirectorCopyAssistIntent } from '../director-desk/director-copy-assist';
import { applyMotionComicImageRecord, applyMotionComicVoiceRecord, directorImageInput, directorImageInputMatches, restoreMotionComicImageVersion, resolveDirectorImageProviderOptions, resolveDirectorImageProviderStatus, resolveDirectorVoiceProviderStatus } from '../director-desk/director-generation';
import { attachMotionComicReference, createMotionComicReferenceAsset, fixedMotionComicReferenceAsset, imageLabRecordIdFromMutation, inspectMotionComicShotConsistency, motionComicConsistencyReady, motionComicConsistencySummary, motionComicReferenceAssets, motionComicReferenceVersionIds, referenceTargetLabel, setMotionComicFixedReference, type MotionComicReferenceKind, type MotionComicReferenceTarget } from './motion-comic-consistency';
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
  const copyAction = useAsyncAction();
  const referenceAction = useAsyncAction();
  const [document, setDocument] = useState<MotionComicPipelineData | null>(null);
  const documentRef = useRef<MotionComicPipelineData | null>(null);
  const savedDocumentRef = useRef<MotionComicPipelineData | null>(null);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [activeProjectId, setActiveProjectId] = useState('');
  const [selectedShotId, setSelectedShotId] = useState('');
  const [loadingProjectId, setLoadingProjectId] = useState(() => requestedTaskId);
  const projectOpenRequestRef = useRef(0);
  const generationRequestsRef = useRef(new Map<string, string>());
  const historyReservationsRef = useRef(createProductionHistoryReservations());
  const [createOpen, setCreateOpen] = useState(() => !requestedTaskId);
  const [createStep, setCreateStep] = useState(0);
  const [createTitle, setCreateTitle] = useState('');
  const [createPremise, setCreatePremise] = useState('');
  const [copyAssistIntent, setCopyAssistIntent] = useState<DirectorCopyAssistIntent | null>(null);
  const [createEpisodeTitle, setCreateEpisodeTitle] = useState('第一集');
  const [createRatio, setCreateRatio] = useState<MotionComicPipelineData['ratio']>('16:9');
  const [createGenre, setCreateGenre] = useState('都市奇幻');
  const [createTone, setCreateTone] = useState('悬念、克制、电影感');
  const [createAudience, setCreateAudience] = useState('短视频剧情观众');
  const [createProtagonist, setCreateProtagonist] = useState('主角');
  const [createCounterpart, setCreateCounterpart] = useState('关键人物');
  const [createLocation, setCreateLocation] = useState('故事起点');
  const [createWorldRules, setCreateWorldRules] = useState('异常规则必须可追踪，不能为反转临时改写。');
  const [createVisualRules, setCreateVisualRules] = useState('角色脸型、发型、服装和关键配饰跨镜头保持一致。\n同一场景保持主光方向、天气和色温连续。');
  const [createVoiceId, setCreateVoiceId] = useState('');
  const [createSubtitleStyle, setCreateSubtitleStyle] = useState('简体中文 · 白色描边');
  const [createSeedLocked, setCreateSeedLocked] = useState(true);
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
  const [seriesSettingsOpen, setSeriesSettingsOpen] = useState(false);
  const [referenceTargetId, setReferenceTargetId] = useState('');
  const creationDraft = useWorkspaceDraft({
    id: 'motion-comic-create', label: 'AI 漫剧新建草稿', enabled: createOpen && Boolean(createTitle.trim() || createPremise.trim()),
    busy: projectAction.busy || copyAction.busy,
    value: { createTitle, createPremise, createEpisodeTitle, createRatio, createGenre, createTone, createAudience, createProtagonist, createCounterpart, createLocation, createWorldRules, createVisualRules, createVoiceId, createSubtitleStyle, createSeedLocked },
    restore: (draft) => {
      setCreateTitle(draft.createTitle); setCreatePremise(draft.createPremise); setCreateEpisodeTitle(draft.createEpisodeTitle); setCreateRatio(draft.createRatio);
      setCreateGenre(draft.createGenre); setCreateTone(draft.createTone); setCreateAudience(draft.createAudience); setCreateProtagonist(draft.createProtagonist);
      setCreateCounterpart(draft.createCounterpart); setCreateLocation(draft.createLocation); setCreateWorldRules(draft.createWorldRules); setCreateVisualRules(draft.createVisualRules);
      setCreateVoiceId(draft.createVoiceId); setCreateSubtitleStyle(draft.createSubtitleStyle); setCreateSeedLocked(draft.createSeedLocked);
    },
  });
  const [brokenReferenceIds, setBrokenReferenceIds] = useState<Set<string>>(() => new Set());
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
  const activeEpisode = document?.episodes.find((episode) => episode.id === document.activeEpisodeId) ?? document?.episodes[0] ?? null;
  const shots = useMemo(() => activeEpisode ? activeEpisode.scenes.flatMap((scene) => scene.shots.map((shot) => directorShotFromComic(activeEpisode, scene.title, shot, document))).map((shot, index) => ({ ...shot, index: index + 1 })) : [], [activeEpisode, document]);
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
  const jobs = useMemo<DirectorQueueItem[]>(() => (document?.providerJobs ?? []).filter((job) => job.capability === 'text-to-image').slice().reverse().map((job) => {
    const shot = shots.find((candidate) => candidate.id === job.nodeId);
    return { id: job.id, shotId: job.nodeId, title: shot?.title ?? '关键帧生成', status: job.status === 'queued' ? 'waiting' : job.status === 'cancelled' ? 'failed' : job.status, progress: job.status === 'completed' ? 100 : 0, cost: job.actualCost ?? job.estimatedCost, provider: `${job.providerId} / ${job.model}`, thumbnail: shot?.thumbnail, error: job.error };
  }), [document?.providerJobs, shots]);
  // A default speaker id is useful for provider requests, but must not look
  // like a configured/selected voice while the TTS service is disconnected.
  const createVoiceIdForProject = voiceStatus.connected ? (createVoiceId || voiceStatus.voiceId) : undefined;
  const createVoiceLabel = voiceStatus.connected
    ? voiceStatus.voices.find((voice) => voice.value === createVoiceIdForProject)?.label ?? createVoiceIdForProject
    : undefined;
  const completedStages = useMemo(() => {
    if (!document) return [];
    const completed: string[] = [];
    if (document.series.premise.trim()) completed.push('剧本');
    if (activeEpisode?.scenes.length) completed.push('画面拆解');
    if (motionComicConsistencyReady(document)) completed.push('素材一致性');
    const sourceShots = activeEpisode?.scenes.flatMap((scene) => scene.shots) ?? [];
    if (sourceShots.length > 0 && sourceShots.every((shot) => shot.firstFrameAssetVersionId && document.assets.some((asset) => asset.id === shot.firstFrameAssetVersionId && asset.kind === 'image'))) completed.push('镜头生成');
    if (sourceShots.length > 0 && sourceShots.every((shot) => {
      const cueIds = shot.dialogueCueIds;
      return cueIds.length > 0 && cueIds.every((cueId) => {
        const cue = activeEpisode?.dialogueCues.find((candidate) => candidate.id === cueId);
        const assetId = cue?.voiceAssetVersionId ?? shot.voiceAssetVersionId;
        return Boolean(assetId && document.assets.some((asset) => asset.id === assetId && asset.kind === 'audio'));
      });
    })) completed.push('配音字幕');
    if (outputAsset) completed.push('导出');
    if (qualityReview?.freshness === 'current' && qualityReview.report?.status === 'passed'
      && qualityReview.report.checks.every((check) => check.status === 'passed' || check.status === 'waived')) completed.push('审片');
    return completed;
  }, [activeEpisode?.scenes.length, document, outputAsset, qualityReview, shots]);
  const actionError = providerAction.feedback?.tone === 'error' ? providerAction.feedback.message : referenceAction.feedback?.tone === 'error' ? referenceAction.feedback.message : projectAction.feedback?.tone === 'error' ? projectAction.feedback.message : undefined;
  const actionFeedback = providerAction.feedback?.tone === 'success' ? providerAction.feedback.message : projectAction.feedback?.tone === 'success' ? projectAction.feedback.message : undefined;
  const systemStatusSummary = resolveMotionComicSystemStatus({
    actionError: Boolean(actionError),
    imageConnected: providerStatus.connected,
    supportsReferenceImages: providerStatus.supportsReferenceImages,
    consistencyReady: displayedConsistencyReady,
    voiceConnected: voiceStatus.connected,
  });
  const systemStatusTone = systemStatusSummary.tone;
  const systemStatus = systemStatusSummary.label;

  useEffect(() => {
    if (!providerAction.busy) setSelectedProviderProfileId(activeImageProfileId(state.config));
  }, [providerAction.busy, state.config]);

  useEffect(() => {
    if (!createVoiceId && voiceStatus.voices[0]?.value) setCreateVoiceId(voiceStatus.voices[0].value);
  }, [createVoiceId, voiceStatus.voices]);

  useEffect(() => {
    setBrokenReferenceIds(new Set());
  }, [activeProjectId]);

  useEffect(() => () => {
    projectOpenRequestRef.current += 1;
    generationRequestsRef.current.clear();
  }, []);

  const openProject = useCallback(async (taskId: string) => {
    const request = ++projectOpenRequestRef.current;
    generationRequestsRef.current.clear();
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
    const next = update(current);
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
    const before = shots.find((shot) => shot.id === id);
    if (before && ((update.voiceId !== undefined && update.voiceId !== before.voiceId) || (update.voiceSpeed !== undefined && update.voiceSpeed !== before.voiceSpeed))) {
      mutateDocument((current) => invalidateDirectorShotSpeech(current, id));
    }
    mutateDocument((current) => {
      const owningEpisode = current.episodes.find((episode) => episode.scenes.some((scene) => scene.shots.some((shot) => shot.id === id)));
      const base = owningEpisode && update.durationMs !== undefined && update.durationMs !== before?.durationMs
        ? updateMotionComicShotDuration(current, owningEpisode.id, id, update.durationMs)
        : current;
      return {
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
            })),
          })),
        })),
      };
    });
  }

  function replaceDocument(next: MotionComicPipelineData) {
    setDocument(next);
    documentRef.current = next;
    setDirty(true);
  }

  function updateRatio(ratio: MotionComicPipelineData['ratio']) {
    mutateDocument((current) => ({ ...current, ratio }));
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

  function selectEpisode(episodeId: string) {
    const current = documentRef.current;
    const episode = current?.episodes.find((candidate) => candidate.id === episodeId);
    if (!current || !episode) return;
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

  function addScene() {
    const current = documentRef.current;
    if (!current) return;
    const next = appendMotionComicScene(current, current.activeEpisodeId, { id: `${current.activeEpisodeId}-scene-${crypto.randomUUID()}` });
    replaceDocument(next);
    setSelectedShotId(next.episodes.find((episode) => episode.id === next.activeEpisodeId)?.scenes.at(-1)?.shots[0]?.id ?? '');
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
    mutateDocument((current) => ({
      ...current,
      episodes: current.episodes.map((episode) => ({ ...episode, scenes: episode.scenes.map((scene) => ({ ...scene, shots: scene.shots.map((shot) => {
        if (shot.id !== selectedShotId) return shot;
        if (current.characters.some((character) => character.looks.some((look) => look.id === asset.id))) {
          return { ...shot, characterLookIds: shot.characterLookIds.includes(asset.id) ? shot.characterLookIds.filter((id) => id !== asset.id) : [...shot.characterLookIds, asset.id] };
        }
        if (current.sceneAssets.some((sceneAsset) => sceneAsset.id === asset.id)) return { ...shot, sceneAssetId: asset.id };
        if (current.props.some((prop) => prop.id === asset.id)) return { ...shot, propAssetIds: shot.propAssetIds.includes(asset.id) ? shot.propAssetIds.filter((id) => id !== asset.id) : [...shot.propAssetIds, asset.id] };
        return shot;
      }) })) })),
    }));
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
      const next = attachMotionComicReference(latest, target, asset);
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

  async function runCopyAssist(intent: DirectorCopyAssistIntent) {
    await copyAction.run(async () => {
      const submitted = creationDraft.snapshot();
      const request = projectOpenRequestRef.current;
      setCopyAssistIntent(intent);
      try {
        const result = await api.composeResearchCopy(buildDirectorCopyAssistRequest({ mode: 'motion-comic', intent, title: submitted.createTitle, copy: submitted.createPremise }))
          .catch((error) => { throw normalizeDirectorCopyAssistError(error); });
        const latest = creationDraft.snapshot();
        if (request !== projectOpenRequestRef.current || latest.createTitle !== submitted.createTitle || latest.createPremise !== submitted.createPremise) {
          throw new AppError('DIRECTOR_COPY_INPUT_CHANGED', '核心设定输入已修改，已保留当前内容。请基于当前内容重新生成。');
        }
        setCreatePremise(result.copy);
        return result;
      } finally {
        setCopyAssistIntent(null);
      }
    }, { successMessage: intent === 'create' ? 'AI 核心设定已创作并填入。' : 'AI 核心设定已修改并填入。' });
  }

  function startCreate() {
    void projectLeave.requestLeave(() => startCreateNow());
  }

  function startCreateNow() {
    projectOpenRequestRef.current += 1;
    generationRequestsRef.current.clear();
    setLoadingProjectId('');
    setDocument(null);
    documentRef.current = null;
    setActiveProjectId('');
    setSelectedShotId('');
    setSeriesSettingsOpen(false);
    setCreateStep(0);
    copyAction.clearFeedback();
    setCreateOpen(true);
  }

  async function createProject() {
    const submittedDraft = creationDraft.snapshot();
    const result = await projectAction.run(async () => {
      const mutation = await api.createMotionComic({ title: createTitle, premise: createPremise, episodeTitle: createEpisodeTitle || undefined, ratio: createRatio });
      applyState(mutation);
      if (!mutation || mutation.kind !== 'task-upsert') throw new Error('AI 漫剧项目已保存，但未返回可打开的任务记录。');
      const task = await api.getTaskDetail(mutation.task.id);
      if (!task) throw new Error('AI 漫剧项目已创建，但无法重新读取。');
      const created = parseMotionComicPipelineData(task.pipelineData);
      const configured: MotionComicPipelineData = {
        ...created,
        series: {
          ...created.series,
          genre: createGenre,
          tone: createTone,
          audience: createAudience,
          worldRules: createWorldRules.split('\n').map((value) => value.trim()).filter(Boolean),
          visualRules: createVisualRules.split('\n').map((value) => value.trim()).filter(Boolean),
        },
        characters: created.characters.map((character, index) => ({
          ...character,
          name: index === 0 ? createProtagonist : index === 1 ? createCounterpart : character.name,
          looks: character.looks.map((look) => ({ ...look, pinned: true })),
        })),
        sceneAssets: created.sceneAssets.map((asset, index) => index === 0 ? { ...asset, label: createLocation, description: `${createPremise}的核心起点场景` } : asset),
        episodes: created.episodes.map((episode) => ({
          ...episode,
          scenes: episode.scenes.map((scene) => ({
            ...scene,
            shots: scene.shots.map((shot) => ({
              ...shot,
              layoutTemplate: '漫画分格 · 角色优先',
              motionPreset: '轻微视差',
              voiceId: createVoiceIdForProject,
              voiceLabel: createVoiceLabel,
              subtitleStyle: createSubtitleStyle,
              seed: shot.seed ?? '24681357',
              seedLocked: createSeedLocked,
            })),
          })),
        })),
      };
      const savedMutation = await api.saveMotionComic({ id: task.id, expectedUpdatedAt: configured.updatedAt, document: configured });
      applyState(savedMutation);
      const savedTask = await api.getTaskDetail(task.id);
      if (!savedTask) throw new Error('AI 漫剧创建预检保存后无法重新读取。');
      return { id: task.id, document: parseMotionComicPipelineData(savedTask.pipelineData) };
    }, { successMessage: 'AI 漫剧系列项目已创建。' });
    if (!result.ok) return;
    if (!creationDraft.complete(submittedDraft)) return;
    setActiveProjectId(result.value.id);
    setDocument(result.value.document);
    documentRef.current = result.value.document;
    savedDocumentRef.current = result.value.document;
    setSelectedShotId(result.value.document.episodes[0]?.scenes[0]?.shots[0]?.id ?? '');
    setCreateTitle('');
    setCreatePremise('');
    copyAction.clearFeedback();
    setCreateEpisodeTitle('第一集');
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

  if (loadingProjectId) return <div data-motion-comic-workbench="true"><DirectorProjectLoading mode="motion-comic" onCancel={() => navigate?.('history')} /></div>;

  if (createOpen) {
    return <div data-motion-comic-workbench="true"><DirectorCreateWizard
      mode="motion-comic"
      step={createStep}
      busy={projectAction.busy || providerAction.busy || copyAction.busy}
      canContinue={createStep > 0 || Boolean(createTitle.trim() && createPremise.trim())}
      canCreate={Boolean(createTitle.trim() && createPremise.trim() && createProtagonist.trim() && createLocation.trim())}
      providerConnected={providerReady}
      providerLabel={`${providerStatus.label} · ${providerStatus.model}`}
      voiceConnected={voiceStatus.connected}
      voiceLabel={`${voiceStatus.label} · ${voiceStatus.model}`}
      summary={[
        { label: '系列', value: createTitle },
        { label: '首集', value: createEpisodeTitle },
        { label: '结构', value: '3 场 · 6 镜头 · 约 40 秒' },
        { label: '主角', value: createProtagonist },
        { label: '画幅', value: createRatio },
      ]}
      feedback={actionFeedback}
      errorMessage={actionError}
      onBack={() => navigate?.('new-task')}
      onStepChange={setCreateStep}
      onConfigureImage={() => openSettings?.('image', 'motion-comic')}
      onConfigureVoice={() => openSettings?.('tts', 'motion-comic')}
      onCreate={() => void createProject()}
    >
      {createStep === 0 ? <>
        <TextField label="系列名称" value={createTitle} onChange={(_, data) => { setCreateTitle(data.value); copyAction.clearFeedback(); }} placeholder="例如：雨夜来信" />
        <div className="director-copy-field">
          <TextAreaField label="核心设定" value={createPremise} onChange={(_, data) => { setCreatePremise(data.value); copyAction.clearFeedback(); }} placeholder="一句话写清主角、异常事件与核心冲突" resize="vertical" hint={`${createPremise.trim().length} 字 · 将生成三场六镜首集骨架`} />
          <DirectorCopyAssist
            activeIntent={copyAssistIntent}
            canCreate={Boolean(createTitle.trim())}
            canRevise={Boolean(createPremise.trim())}
            feedback={copyAction.feedback}
            onCreate={() => void runCopyAssist('create')}
            onRevise={() => void runCopyAssist('revise')}
          />
        </div>
        <div className="director-create-two-col"><TextField label="首集标题" value={createEpisodeTitle} onChange={(_, data) => setCreateEpisodeTitle(data.value)} /><SegmentedControl label="画幅" value={createRatio} options={MOTION_COMIC_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))} onChange={setCreateRatio} /></div>
        <div className="director-structure-preview"><strong>首集结构</strong><span>01 异常出现</span><span>02 线索升级</span><span>03 选择与钩子</span><span>每场 2 镜头</span></div>
      </> : null}
      {createStep === 1 ? <>
        <div className="director-create-two-col"><TextField label="类型" value={createGenre} onChange={(_, data) => setCreateGenre(data.value)} /><TextField label="基调" value={createTone} onChange={(_, data) => setCreateTone(data.value)} /></div>
        <TextField label="目标观众" value={createAudience} onChange={(_, data) => setCreateAudience(data.value)} />
        <div className="director-create-two-col"><TextField label="主角" value={createProtagonist} onChange={(_, data) => setCreateProtagonist(data.value)} /><TextField label="关键人物" value={createCounterpart} onChange={(_, data) => setCreateCounterpart(data.value)} /></div>
        <TextField label="核心场景" value={createLocation} onChange={(_, data) => setCreateLocation(data.value)} />
        <TextAreaField label="世界规则" value={createWorldRules} onChange={(_, data) => setCreateWorldRules(data.value)} resize="vertical" />
        <TextAreaField label="视觉规则" value={createVisualRules} onChange={(_, data) => setCreateVisualRules(data.value)} resize="vertical" hint="每行一条；创建后可在系列圣经继续编辑角色、场景和道具" />
      </> : null}
      {createStep === 2 ? <>
        <SelectField label="图片生成服务" value={selectedProviderProfileId} options={providerOptions} disabled={providerAction.busy} validationMessage={providerUnavailableReason} onChange={(event) => void selectImageProvider(event.target.value)} />
        <SelectField label="音色" value={createVoiceId} options={voiceStatus.voices.length ? [...voiceStatus.voices] : [{ value: '', label: '尚未配置旁白服务，请先配置音色', disabled: true }]} disabled={!voiceStatus.connected} onChange={(event) => setCreateVoiceId(event.target.value)} />
        <SelectField label="字幕样式" value={createSubtitleStyle} options={['简体中文 · 白色描边', '简体中文 · 下方黑底'].map((value) => ({ value, label: value }))} onChange={(event) => setCreateSubtitleStyle(event.target.value)} />
        <CheckboxField label="在提示词中保留跨镜头 Seed 标记" checked={createSeedLocked} onChange={(_, data) => setCreateSeedLocked(Boolean(data.checked))} />
        <div className="director-output-preview"><strong>系列骨架与本地成片</strong><span>创建后先进入系列圣经或镜头板；关键帧与旁白完成后，可在导演台生成 MP4。</span></div>
      </> : null}
    </DirectorCreateWizard></div>;
  }

  if (!document || !activeEpisode) return <div data-motion-comic-workbench="true"><DirectorProjectRecovery mode="motion-comic" errorMessage={actionError} returnLabel={returnView === 'projects' ? '返回项目' : '返回全部任务'} onReturnTasks={() => navigate?.(returnView)} onNewProject={startCreate} /></div>;

  if (seriesSettingsOpen) return <div data-motion-comic-workbench="true" data-motion-comic-series-bible="true" className="director-series-page">
    <header className="director-series-header">
      <div><Button variant="subtle" icon={<ArrowLeft size={14} />} onClick={() => setSeriesSettingsOpen(false)}>返回导演台</Button><span><BookOpenCheck size={18} /><strong>系列圣经</strong><small>角色、场景、道具与视觉规则的唯一事实来源</small></span></div>
      <Toolbar aria-label="系列圣经操作"><Button variant="subtle" icon={<Settings2 size={14} />} onClick={() => openSettings?.('image', 'motion-comic', document.id)}>模型设置</Button><Button variant="primary" icon={<Save size={14} />} disabled={!dirty || projectAction.busy} onClick={() => void saveProject().then((saved) => { if (saved) setSeriesSettingsOpen(false); })}>保存系列圣经</Button></Toolbar>
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
        <section><div className="director-series-section-heading"><span>01</span><div><h2>系列定位</h2><p>确定故事承诺、观众和不可随意改写的世界规则。</p></div></div><TextField label="系列名称" value={document.title} onChange={(_, data) => mutateDocument((current) => ({ ...current, title: data.value, series: { ...current.series, title: data.value } }))} /><TextAreaField label="核心设定" value={document.series.premise} onChange={(_, data) => mutateDocument((current) => ({ ...current, series: { ...current.series, premise: data.value } }))} resize="vertical" /><div className="director-create-two-col"><TextField label="类型" value={document.series.genre} onChange={(_, data) => mutateDocument((current) => ({ ...current, series: { ...current.series, genre: data.value } }))} /><TextField label="基调" value={document.series.tone} onChange={(_, data) => mutateDocument((current) => ({ ...current, series: { ...current.series, tone: data.value } }))} /></div><TextField label="目标观众" value={document.series.audience} onChange={(_, data) => mutateDocument((current) => ({ ...current, series: { ...current.series, audience: data.value } }))} /><TextAreaField label="世界规则" value={document.series.worldRules.join('\n')} onChange={(_, data) => mutateDocument((current) => ({ ...current, series: { ...current.series, worldRules: data.value.split('\n').map((value) => value.trim()).filter(Boolean) } }))} resize="vertical" /><TextAreaField label="视觉规则" value={document.series.visualRules.join('\n')} onChange={(_, data) => mutateDocument((current) => ({ ...current, series: { ...current.series, visualRules: data.value.split('\n').map((value) => value.trim()).filter(Boolean) } }))} resize="vertical" /><TextAreaField label="负面提示词" value={document.series.negativePrompt} onChange={(_, data) => mutateDocument((current) => ({ ...current, series: { ...current.series, negativePrompt: data.value } }))} resize="vertical" /></section>
        <section>
          <div className="director-series-section-heading"><span>02</span><div><h2>角色一致性</h2><p>身份提示词和造型必须跨集复用，不能由单镜头临时覆盖。</p></div></div>
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
          <div className="director-series-section-heading"><span>03</span><div><h2>场景一致性</h2><p>固定建筑、光线、天气与时间，供所有镜头直接引用。</p></div></div>
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
          <div className="director-series-section-heading"><span>04</span><div><h2>道具一致性</h2><p>关键物件必须保持轮廓、材质和标记可识别。</p></div></div>
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
  </div>;

  return <>
    <div data-motion-comic-workbench="true">
      <DirectorDeskWorkspace
        mode="motion-comic"
        projectTitle={document.title}
        projectMeta={`${projects.length} 个系列项目`}
        episodeTitle={`EP${String(activeEpisode.number).padStart(2, '0')} · ${activeEpisode.title}`}
        stageLabel="镜头生成"
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
        onRender={() => withHistoryCapacity(PRODUCTION_RENDER_HISTORY_DEMAND, renderProject)}
        onOpenOutput={() => api.openTaskOutputDirectory(document.id)}
        onOpenSettings={() => setSeriesSettingsOpen(true)}
        onConfigureProvider={() => openSettings?.('image', 'motion-comic', document.id)}
        backToTasksLabel={returnView === 'projects' ? '返回项目' : '返回全部任务'}
        onBackToTasks={() => navigate?.(returnView)}
        onStageChange={(stage) => { if (stage === '剧本') setSeriesSettingsOpen(true); }}
      />
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

function directorShotFromComic(episode: MotionComicEpisode, sceneTitle: string, shot: MotionComicShot, document: MotionComicPipelineData | null): DirectorShot {
  const subtitle = shot.dialogueCueIds.map((cueId) => episode.dialogueCues.find((cue) => cue.id === cueId)?.text).filter(Boolean).join(' ');
  const characterLabel = shot.characterLookIds.map((lookId) => document?.characters.flatMap((character) => character.looks).find((look) => look.id === lookId)?.label).filter(Boolean).join('、') || '角色待绑定';
  const asset = shot.firstFrameAssetVersionId ? document?.assets.find((candidate) => candidate.id === shot.firstFrameAssetVersionId) : undefined;
  const cueVoiceIds = shot.dialogueCueIds.map((id) => episode.dialogueCues.find((cue) => cue.id === id)?.voiceAssetVersionId).filter((id): id is string => Boolean(id));
  const voiceAsset = document?.assets.find((candidate) => candidate.id === (cueVoiceIds[0] ?? shot.voiceAssetVersionId));
  const audioClips: DirectorPreviewAudioClip[] = (productionAudioClipsForShot(episode.timeline, shot) ?? [])
    .flatMap((clip) => {
      const asset = document?.assets.find((candidate) => candidate.id === clip.assetVersionId && candidate.kind === 'audio');
      return asset?.localPath ? [{ id: clip.id, url: toLocalAssetUrl(asset.localPath), startMs: clip.startMs, durationMs: clip.durationMs ?? clip.sourceDurationMs ?? shot.durationMs, sourceStartMs: clip.sourceStartMs, sourceDurationMs: clip.sourceDurationMs, gainDb: clip.gainDb, fadeInMs: clip.fadeInMs, fadeOutMs: clip.fadeOutMs, muted: clip.muted }] : [];
    });
  const job = document ? latestProductionProviderJob(document.providerJobs, shot.id, 'text-to-image') : undefined;
  const voiceJob = document ? latestProductionProviderJob(document.providerJobs, shot.id, 'text-to-speech') : undefined;
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
    status: job?.status === 'completed' ? 'ready' : job?.status === 'running' ? 'generating' : job?.status === 'failed' ? 'failed' : 'queued',
    provider: job ? `${job.providerId} / ${job.model}` : undefined,
    cost: job?.actualCost ?? job?.estimatedCost,
    voice: shot.voiceLabel,
    voiceId: shot.voiceId,
    voiceSpeed: shot.voiceSpeed,
    audioUrl: voiceAsset?.localPath ? toLocalAssetUrl(voiceAsset.localPath) : undefined,
    audioClips,
    soundClips: document ? directorSoundClips(document, shot.id) : [],
    voiceGenerationCount: document ? motionComicDialogueCuesToGenerate(document, shot.id).length : 0,
    imageReady: Boolean(asset?.localPath && asset.kind === 'image'),
    voiceReady: shot.dialogueCueIds.length > 0 && shot.dialogueCueIds.every((id) => {
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
    linkedAssetIds: [...shot.characterLookIds, shot.sceneAssetId, ...shot.propAssetIds, ...(shot.firstFrameAssetVersionId ? [shot.firstFrameAssetVersionId] : [])],
    assetVersionIds: [...new Set([
      ...(episode.timeline.clips.find((clip) => clip.shotId === shot.id)?.assetVersionIds ?? []),
      ...(shot.firstFrameAssetVersionId ? [shot.firstFrameAssetVersionId] : []),
      ...(shot.voiceAssetVersionId ? [shot.voiceAssetVersionId] : []), ...cueVoiceIds,
      ...(document ? directorSoundClips(document, shot.id).map((clip) => clip.assetVersionId) : []),
    ])],
  };
}
