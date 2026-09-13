import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApplyMutationResult, RendererAppState as AppState } from '../../app/route-types';
import { useUnsavedChanges } from '../../app/workspace-navigation';
import { useWorkspaceDraft } from '../../app/workspace-draft';
import { mergeDirectorSavedDocument } from '../../shared/director-document-sync';
import { planEditorialScript } from '../../shared/editorial-script';
import { createProductionHistoryReservations, productionHistoryUsage, PRODUCTION_MEDIA_HISTORY_DEMAND, PRODUCTION_RENDER_HISTORY_DEMAND, type ProductionHistoryDemand, type ProductionHistoryReservation } from '../../shared/production-history';
import type { ShellView } from '../../shared/types';
import type { SettingsSection } from '../settings/SettingsPage';
import {
  EDITORIAL_COLLAGE_RATIOS,
  EDITORIAL_STARTER_DURATIONS_MS,
  EDITORIAL_STYLE_PRESETS,
  parseEditorialCollagePipelineData,
  insertEditorialBeat,
  insertEditorialShot,
  moveEditorialShot,
  mergeEditorialShots,
  removeEditorialBeat,
  removeEditorialShot,
  reorderEditorialBeat,
  reorderEditorialShot,
  editEditorialShotMotion,
  editorialCameraPreset,
  type EditorialMotionEdit,
  rebuildEditorialTimeline,
  splitEditorialShot,
  type EditorialCollageBeat,
  type EditorialCollagePipelineData,
  type EditorialCollageStarterDurationMs,
} from '../../shared/editorial-collage';
import { activeImageProfileId, enableImageProfile } from '../../shared/provider-profile-utils';
import { AppError } from '../../shared/app-error';
import { alignDirectorSubtitleCueFromTimestampFile, updateDirectorSubtitleCue, estimateDirectorSubtitleCue } from '../../shared/director-subtitles';
import { addDirectorSubtitleCue, removeDirectorSubtitleCue, invalidateDirectorShotSpeech } from '../../shared/director-subtitle-structure';
import type { StoryDreamApi } from '../../shared/storydream-api';
import { Button, CheckboxField, Dialog, SegmentedControl, SelectField, TextAreaField, TextField } from '../../ui';
import { useAsyncAction } from '../../ui/async-action';
import { DirectorDeskWorkspace, type DirectorAsset, type DirectorLayoutTemplate, type DirectorMotionPreset, type DirectorQueueItem, type DirectorShot, type DirectorVersion } from '../director-desk/DirectorDeskWorkspace';
import type { DirectorPreviewAudioClip } from '../director-desk/DirectorAudioPreview';
import { productionAudioClipsForShot } from '../../shared/production-audio';
import { latestProductionProviderJob } from '../../shared/production-workflow';
import { resolveEditorialSystemStatus } from '../../shared/director-system-status';
import { addDirectorSoundClip, removeDirectorSoundClip, updateDirectorAudioClip, type DIRECTOR_SOUND_TRACKS } from '../../shared/director-audio-edit';
import { directorSoundClips, readDirectorSoundDuration } from '../director-desk/director-sound';
import { DirectorCopyAssist, DirectorCreateWizard, DirectorProjectLoading, DirectorProjectRecovery } from '../director-desk/DirectorProjectStart';
import { buildDirectorCopyAssistRequest, normalizeDirectorCopyAssistError, type DirectorCopyAssistIntent } from '../director-desk/director-copy-assist';
import {
  applyEditorialImageRecord,
  applyEditorialStyleCandidateRecord,
  applyEditorialVoiceRecord,
  restoreEditorialImageVersion,
  directorImageInput,
  directorImageInputMatches,
  directorStyleCandidateInput,
  directorStyleCandidateInputMatches,
  editorialVoiceInput,
  editorialVoiceInputMatches,
  resolveDirectorImageProviderOptions,
  resolveDirectorImageProviderStatus,
  resolveDirectorVideoProviderOptions,
  resolveDirectorVideoProviderStatus,
  resolveDirectorVoiceProviderStatus,
  type DirectorStyleCandidateInput,
  type DirectorVideoProviderStatus,
} from '../director-desk/director-generation';
import { toLocalAssetUrl, toLocalImageUrl } from '../tasks/task-formatters';
import { confirmDirectorQualityReview, directorQualityReview, directorRenderOutputs } from '../../shared/director-render';
import type { DirectorSubtitleRecheckRequest, DirectorMediaRecheckRequest } from '../../shared/director-render';
import type { ProductionQualityManualReview } from '../../shared/production-workflow';
export function EditorialCollagePage({
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
  const [document, setDocument] = useState<EditorialCollagePipelineData | null>(null);
  const documentRef = useRef<EditorialCollagePipelineData | null>(null);
  const savedDocumentRef = useRef<EditorialCollagePipelineData | null>(null);
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
  const [createSource, setCreateSource] = useState('');
  const [copyAssistIntent, setCopyAssistIntent] = useState<DirectorCopyAssistIntent | null>(null);
  const [createRatio, setCreateRatio] = useState<EditorialCollagePipelineData['ratio']>('16:9');
  const [createDurationMs, setCreateDurationMs] = useState<EditorialCollageStarterDurationMs>('auto');
  const [sourceOpen, setSourceOpen] = useState(false);
  const createPlan = useMemo(() => {
    if (!createSource.trim()) return { plan: null, error: '' };
    try { return { plan: planEditorialScript(createSource, createDurationMs), error: '' }; }
    catch (error) { return { plan: null, error: (error instanceof Error ? error.message : String(error)).replace(/^EDITORIAL_[A-Z_]+: /u, '') }; }
  }, [createSource, createDurationMs]);
  const createStructure = createPlan.plan
    ? `${formatScriptDuration(createPlan.plan.durationMs)} · ${createPlan.plan.beats.length} 个节拍 · ${createPlan.plan.shotCount} 个镜头`
    : createPlan.error ? '时长待调整' : '等待文案';
  const createReadingSpeed = createPlan.plan
    ? `预计 ${createPlan.plan.minimumReadingCharsPerSecond.toFixed(1)} 字/秒 · 最长句 ${createPlan.plan.maximumCueCharsPerSecond.toFixed(1)} 字/秒`
    : '';
  const [createStyleId, setCreateStyleId] = useState<string>(EDITORIAL_STYLE_PRESETS[0].id);
  const [createLayoutTemplate, setCreateLayoutTemplate] = useState<DirectorLayoutTemplate>('对比拼贴 · 纸张撕裂');
  const [createMotionPreset, setCreateMotionPreset] = useState<DirectorMotionPreset>('平移 + 缓慢推进');
  const [createVoiceId, setCreateVoiceId] = useState('');
  const [createSubtitleStyle, setCreateSubtitleStyle] = useState('简体中文 · 白色描边');
  const [createSeedLocked, setCreateSeedLocked] = useState(true);
  const [dirty, setDirty] = useState(false);
  const projectLeave = useUnsavedChanges({
    id: 'editorial-project', label: 'VOX 项目', dirty, busy: projectAction.busy,
    onSave: saveProject,
    onDiscard: () => {
      const saved = savedDocumentRef.current;
      if (saved?.id === documentRef.current?.id) { documentRef.current = saved; setDocument(saved); }
      setDirty(false);
    },
  });
  const [selectedProviderProfileId, setSelectedProviderProfileId] = useState(() => activeImageProfileId(state.config));
  const creationDraft = useWorkspaceDraft({
    id: 'editorial-create', label: 'VOX 新建草稿', enabled: createOpen && Boolean(createTitle.trim() || createSource.trim()),
    busy: projectAction.busy || copyAction.busy,
    value: { createTitle, createSource, createRatio, createDurationMs: createDurationMs === 'auto' ? 30_000 : createDurationMs, createFullText: createDurationMs === 'auto', createStyleId, createLayoutTemplate, createMotionPreset, createVoiceId, createSubtitleStyle, createSeedLocked },
    restore: (draft) => {
      setCreateTitle(draft.createTitle); setCreateSource(draft.createSource); setCreateRatio(draft.createRatio); setCreateDurationMs(draft.createFullText ? 'auto' : draft.createDurationMs); setCreateStyleId(draft.createStyleId);
      setCreateLayoutTemplate(draft.createLayoutTemplate); setCreateMotionPreset(draft.createMotionPreset); setCreateVoiceId(draft.createVoiceId);
      setCreateSubtitleStyle(draft.createSubtitleStyle); setCreateSeedLocked(draft.createSeedLocked);
    },
  });

  const projects = useMemo(() => state.tasks.filter((task) => task.taskType === 'editorial-collage' && !task.archivedAt).slice().sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)), [state.tasks]);
  const providerProfiles = useMemo(() => resolveDirectorImageProviderOptions(state.config, state.secretStatus), [state.config, state.secretStatus]);
  const imageProviderOptions = useMemo(() => providerProfiles.map((profile) => ({
    value: profile.profileId,
    label: `${profile.label} · ${profile.model} · ${profile.resolution}${profile.supportsReferenceImages ? '' : ' · 不支持参考图'}${profile.connected ? '' : ` · ${profile.unavailableReason ?? '未配置'}`}`,
    disabled: !profile.connected,
  })), [providerProfiles]);
  const providerStatus = useMemo(() => resolveDirectorImageProviderStatus(state.config, state.secretStatus, selectedProviderProfileId), [selectedProviderProfileId, state.config, state.secretStatus]);
  const voiceStatus = useMemo(() => resolveDirectorVoiceProviderStatus(state.config, state.secretStatus), [state.config, state.secretStatus]);
  const videoProviderOptions = useMemo(() => resolveDirectorVideoProviderOptions(state.config, state.secretStatus), [state.config, state.secretStatus]);
  const committedVideoCost = useMemo(() => (document?.providerJobs ?? [])
    .filter((job) => job.capability === 'image-to-video')
    .reduce((total, job) => job.actualCost !== undefined
      ? total + job.actualCost
      : ['failed', 'cancelled'].includes(job.status) ? total : total + job.estimatedCost, 0), [document?.providerJobs]);
  const videoProviderStatuses = useMemo(() => new Map((document?.beats ?? []).flatMap((beat) => beat.shots.map((shot) => [
    shot.id,
    resolveDirectorVideoProviderStatus(state.config, state.secretStatus, { durationMs: shot.durationMs, committedCost: committedVideoCost }),
  ] as const))), [committedVideoCost, document?.beats, state.config, state.secretStatus]);
  const shots = useMemo(() => document ? document.beats.flatMap((beat) => beat.shots.map((shot) => directorShotFromEditorial(document, beat, shot, videoProviderStatuses.get(shot.id)))).map((shot, index) => ({ ...shot, index: index + 1 })) : [], [document, videoProviderStatuses]);
  const selectedVideoProviderStatus = videoProviderStatuses.get(selectedShotId || shots[0]?.id || '')
    ?? resolveDirectorVideoProviderStatus(state.config, state.secretStatus, { durationMs: shots[0]?.durationMs ?? 1000, committedCost: committedVideoCost });
  const renderOutputs = useMemo(() => document ? directorRenderOutputs(document) : { history: [], current: undefined }, [document]);
  const qualityReview = useMemo(() => document ? directorQualityReview(document) : undefined, [document]);
  const outputAsset = renderOutputs.current;
  const projectOptions = useMemo(() => projects.map((task) => ({ id: task.id, title: task.title || '未命名 VOX 项目', meta: `创建于 ${new Date(task.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` })), [projects]);
  const directorAssets = useMemo<DirectorAsset[]>(() => {
    if (!document) return [];
    const styleAssets = document.assets.filter((asset) => asset.kind === 'image' && asset.localPath && asset.assetId.startsWith('style-candidate-'));
    const generated = document.assets.filter((asset) => asset.kind === 'image' && asset.localPath && !asset.assetId.startsWith('style-candidate-')).map((asset, index) => ({
      id: asset.id,
      sourceVersionId: asset.id,
      label: `生成素材 ${index + 1}`,
      type: asset.provider ?? '生成图片',
      thumbnail: toLocalImageUrl(asset.localPath!),
      category: 'history' as const,
      selected: shots.some((shot) => shot.linkedAssetIds?.includes(asset.id)),
    }));
    const styleSamples = styleAssets.flatMap((asset) => {
      const styleId = asset.assetId.slice('style-candidate-'.length);
      const candidate = document.styleCandidates.find((item) => item.id === styleId);
      return asset.localPath ? [{
        id: asset.id,
        sourceVersionId: asset.id,
        label: `${candidate?.label ?? '风格'} · 试片`,
        type: '风格参考',
        thumbnail: toLocalImageUrl(asset.localPath),
        category: 'style' as const,
        selected: candidate?.assetVersionId === asset.id,
        selectable: false,
      }] : [];
    });
    return [...styleSamples, ...generated];
  }, [document, shots]);
  const directorStyleCandidates = useMemo(() => (document?.styleCandidates ?? []).map((candidate) => {
    const asset = candidate.assetVersionId ? document?.assets.find((item) => item.id === candidate.assetVersionId && item.kind === 'image') : undefined;
    return { ...candidate, thumbnail: asset?.localPath ? toLocalImageUrl(asset.localPath) : undefined };
  }), [document]);
  const versions = useMemo<DirectorVersion[]>(() => {
    if (!document || !selectedShotId) return [];
    const assetsByJob = new Map(document.assets.slice().reverse().map((asset) => [asset.providerJobId, asset]));
    return document.providerJobs.filter((job) => job.nodeId === selectedShotId && job.capability === 'text-to-image' && job.status === 'completed').map((job, index) => {
      const asset = assetsByJob.get(job.id);
      return { id: asset?.id ?? job.id, label: `画面版本 ${index + 1}`, createdAt: job.updatedAt, provider: `${job.providerId} / ${job.model}`, thumbnail: asset?.localPath ? toLocalImageUrl(asset.localPath) : undefined, selected: shots.find((shot) => shot.id === selectedShotId)?.linkedAssetIds?.includes(asset?.id ?? '') };
    }).reverse();
  }, [document, selectedShotId, shots]);
  const jobs = useMemo<DirectorQueueItem[]>(() => (document?.providerJobs ?? []).filter((job) => job.capability === 'text-to-image' || job.capability === 'image-to-video' || job.capability === 'style-sample').slice().reverse().map((job) => {
    const shot = shots.find((candidate) => candidate.id === job.nodeId);
    const styleId = job.nodeId.startsWith('style-candidate:') ? job.nodeId.slice('style-candidate:'.length) : '';
    const style = styleId ? document?.styleCandidates.find((candidate) => candidate.id === styleId) : undefined;
    const isStyle = job.capability === 'style-sample';
    const asset = isStyle ? document?.assets.find((candidate) => candidate.providerJobId === job.id && candidate.kind === 'image') : undefined;
    return { id: job.id, shotId: job.nodeId, kind: isStyle ? 'style-sample' as const : undefined, title: isStyle ? `${style?.label ?? '风格'} · 试片` : job.capability === 'image-to-video' ? `${shot?.title ?? '镜头'} · 动态海报` : shot?.title ?? '镜头生成', status: job.status === 'queued' ? 'waiting' : job.status === 'cancelled' ? 'failed' : job.status, progress: job.status === 'completed' ? 100 : 0, cost: job.actualCost ?? job.estimatedCost, provider: `${job.providerId} / ${job.model}`, thumbnail: isStyle && asset?.localPath ? toLocalImageUrl(asset.localPath) : shot?.thumbnail, error: job.error };
  }), [document, shots]);
  // Do not persist a provider's fallback celebrity voice as if it had been
  // configured. The author can create a local project first and choose a
  // real voice after connecting the narration service.
  const createVoiceIdForProject = voiceStatus.connected ? (createVoiceId || voiceStatus.voiceId) : undefined;
  const createVoiceLabel = voiceStatus.connected
    ? voiceStatus.voices.find((voice) => voice.value === createVoiceIdForProject)?.label ?? createVoiceIdForProject
    : undefined;
  const completedStages = useMemo(() => {
    if (!document) return [];
    const completed: string[] = [];
    if (document.beats.length > 0) completed.push('剧本', '画面拆解');
    if (document.selectedStyleId) completed.push('素材一致性');
    const sourceShots = document.beats.flatMap((beat) => beat.shots);
    if (sourceShots.length > 0 && sourceShots.every((shot) => {
      const imageReady = shot.layers.some((layer) => layer.assetVersionId && document.assets.some((asset) => asset.id === layer.assetVersionId && asset.kind === 'image' && Boolean(asset.localPath)));
      const videoReady = Boolean(shot.videoAssetVersionId
        && document.assets.some((asset) => asset.id === shot.videoAssetVersionId && asset.kind === 'video' && Boolean(asset.localPath))
        && shot.videoJobId
        && document.providerJobs.some((job) => job.id === shot.videoJobId && job.capability === 'image-to-video' && job.status === 'completed'));
      return shot.renderStrategy === 'living-poster' ? videoReady : shot.renderStrategy === 'hybrid' ? imageReady && videoReady : imageReady;
    })) completed.push('镜头生成');
    if (sourceShots.length > 0 && sourceShots.every((shot) => shot.voiceAssetVersionId && document.assets.some((asset) => asset.id === shot.voiceAssetVersionId && asset.kind === 'audio'))) completed.push('配音字幕');
    if (outputAsset) completed.push('导出');
    if (qualityReview?.freshness === 'current' && qualityReview.report?.status === 'passed'
      && qualityReview.report.checks.every((check) => check.status === 'passed' || check.status === 'waived')) completed.push('审片');
    return completed;
  }, [document, outputAsset, qualityReview, shots]);
  const actionError = providerAction.feedback?.tone === 'error' ? providerAction.feedback.message : projectAction.feedback?.tone === 'error' ? projectAction.feedback.message : undefined;
  const actionFeedback = providerAction.feedback?.tone === 'success' ? providerAction.feedback.message : projectAction.feedback?.tone === 'success' ? projectAction.feedback.message : undefined;
  const needsAiVideo = Boolean(document?.beats.some((beat) => beat.shots.some((shot) => shot.renderStrategy !== 'deterministic-layers')));
  const videoUnavailable = needsAiVideo && [...videoProviderStatuses.values()].some((status) => !status.connected);
  const systemStatusSummary = resolveEditorialSystemStatus({
    actionError: Boolean(actionError),
    imageConnected: providerStatus.connected,
    voiceConnected: voiceStatus.connected,
    videoRequired: needsAiVideo,
    videoConnected: !videoUnavailable,
  });
  const systemStatusTone = systemStatusSummary.tone;
  const systemStatus = systemStatusSummary.label;

  useEffect(() => {
    if (!providerAction.busy) setSelectedProviderProfileId(activeImageProfileId(state.config));
  }, [providerAction.busy, state.config]);

  useEffect(() => {
    if (!createVoiceId && voiceStatus.voices[0]?.value) setCreateVoiceId(voiceStatus.voices[0].value);
  }, [createVoiceId, voiceStatus.voices]);

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
      if (!task || task.taskType !== 'editorial-collage') throw new Error('VOX 项目不存在或已被移除。');
      return parseEditorialCollagePipelineData(task.pipelineData);
    });
    if (request !== projectOpenRequestRef.current) return;
    setLoadingProjectId('');
    if (!result.ok) return;
    setDocument(result.value);
    documentRef.current = result.value;
    savedDocumentRef.current = result.value;
    setActiveProjectId(taskId);
    setSelectedShotId(result.value.beats[0]?.shots[0]?.id ?? '');
    setCreateOpen(false);
    setDirty(false);
  }, [api, projectAction.run]);

  useEffect(() => {
    if (!requestedTaskId) return;
    void openProject(requestedTaskId).finally(() => onRequestedTaskHandled(requestedTaskId));
  }, [onRequestedTaskHandled, openProject, requestedTaskId]);

  function mutateDocument(update: (current: EditorialCollagePipelineData) => EditorialCollagePipelineData) {
    const current = documentRef.current;
    if (!current) return;
    const next = update(current);
    projectAction.clearFeedback();
    documentRef.current = next;
    setDocument(next);
    setDirty(true);
  }

  function mutateStructure(update: (current: EditorialCollagePipelineData) => EditorialCollagePipelineData) {
    try { mutateDocument(update); }
    catch (error) { projectAction.reportError(error); }
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
      if (aligned.issues.length > 0) throw new Error(`时间戳未导入：${aligned.issues.join('、')}。请确认文件与当前字幕句子匹配。`);
      mutateDocument(() => aligned.document);
      return aligned;
    }, { successMessage: '已导入识别时间戳；字幕将按真实时间切换。' });
  }

  function updateShot(id: string, update: Partial<DirectorShot>) {
    const before = shots.find((shot) => shot.id === id);
    if (before && ((update.voiceId !== undefined && update.voiceId !== before.voiceId) || (update.voiceSpeed !== undefined && update.voiceSpeed !== before.voiceSpeed))) {
      mutateDocument((current) => invalidateDirectorShotSpeech(current, id));
    }
    mutateDocument((current) => rebuildEditorialTimeline({
      ...current,
      beats: current.beats.map((beat) => ({
        ...beat,
        title: id === beat.shots[0]?.id && update.title !== undefined ? update.title : beat.title,
        shots: beat.shots.map((shot) => shot.id !== id ? shot : ({
          ...shot,
          scenePrompt: update.prompt ?? shot.scenePrompt,
          motionPrompt: update.motionPrompt ?? shot.motionPrompt,
          durationMs: update.durationMs ?? shot.durationMs,
          voiceId: update.voiceId ?? shot.voiceId,
          voiceLabel: update.voice ?? shot.voiceLabel,
          voiceSpeed: update.voiceSpeed ?? shot.voiceSpeed,
          layoutTemplate: update.layoutTemplate ?? shot.layoutTemplate,
          motionPreset: update.motionPreset ?? shot.motionPreset,
          camera: update.motionPreset ? editorialCameraPreset(update.durationMs ?? shot.durationMs, update.motionPreset) : shot.camera,
          subtitleStyle: update.subtitleStyle ?? shot.subtitleStyle,
          seed: update.seed ?? shot.seed,
          seedLocked: update.seedLocked ?? shot.seedLocked,
          renderStrategy: update.renderStrategy ?? shot.renderStrategy,
        })),
      })),
    }));
  }

  function updateShotMotion(id: string, edit: EditorialMotionEdit) {
    mutateDocument((current) => editEditorialShotMotion(current, id, edit));
  }

  function selectStyle(styleId: string) {
    mutateDocument((current) => ({
      ...current,
      selectedStyleId: styleId,
      styleCandidates: current.styleCandidates.map((candidate) => ({ ...candidate, selected: candidate.id === styleId })),
    }));
  }

  function addShot() {
    const current = documentRef.current;
    if (!current) return;
    const selected = current.beats.find((beat) => beat.shots.some((shot) => shot.id === selectedShotId));
    const beat = selected ?? current.beats[0];
    if (!beat) return;
    const sourceIndex = Math.max(0, beat.shots.findIndex((shot) => shot.id === selectedShotId));
    mutateStructure(() => {
      const next = insertEditorialShot(current, beat.id, sourceIndex + 1, selectedShotId || beat.shots[0]?.id, Math.min(beat.shots[0]?.durationMs ?? 3_000, 15_000));
      setSelectedShotId(next.beats.find((candidate) => candidate.id === beat.id)?.shots[sourceIndex + 1]?.id ?? '');
      return next;
    });
  }

  function removeShot(shotId: string) {
    const current = documentRef.current;
    if (!current) return;
    const location = current.beats.find((beat) => beat.shots.some((shot) => shot.id === shotId));
    if (!location || location.shots.length <= 1) return;
    const index = location.shots.findIndex((shot) => shot.id === shotId);
    const adjacentId = location.shots[index + 1]?.id ?? location.shots[index - 1]?.id ?? '';
    mutateStructure(() => {
      const next = removeEditorialShot(current, shotId);
      if (selectedShotId === shotId) setSelectedShotId(adjacentId);
      return next;
    });
  }

  function moveShot(direction: 'up' | 'down') {
    const current = documentRef.current;
    if (!current || !selectedShotId) return;
    const location = current.beats.find((beat) => beat.shots.some((shot) => shot.id === selectedShotId));
    if (!location) return;
    mutateStructure((value) => moveEditorialShot(value, selectedShotId, direction));
  }

  function addBeat() {
    const current = documentRef.current;
    if (!current) return;
    const beatIndex = current.beats.findIndex((beat) => beat.shots.some((shot) => shot.id === selectedShotId));
    const insertionIndex = beatIndex < 0 ? current.beats.length : beatIndex + 1;
    mutateStructure(() => {
      const next = insertEditorialBeat(current, insertionIndex, current.beats[beatIndex]?.id);
      setSelectedShotId(next.beats[insertionIndex]?.shots[0]?.id ?? selectedShotId);
      return next;
    });
  }

  function removeBeat() {
    const current = documentRef.current;
    if (!current) return;
    const beat = current.beats.find((candidate) => candidate.shots.some((shot) => shot.id === selectedShotId));
    if (!beat) return;
    mutateStructure(() => {
      const next = removeEditorialBeat(current, beat.id);
      const fallback = next.beats[Math.min(beat.index - 1, next.beats.length - 1)];
      setSelectedShotId(fallback?.shots[0]?.id ?? '');
      return next;
    });
  }

  function moveBeat(direction: 'up' | 'down') {
    const current = documentRef.current;
    if (!current) return;
    const index = current.beats.findIndex((beat) => beat.shots.some((shot) => shot.id === selectedShotId));
    if (index < 0) return;
    mutateStructure((value) => reorderEditorialBeat(value, current.beats[index].id, index + (direction === 'up' ? -1 : 1)));
  }

  function splitShot() {
    const current = documentRef.current;
    const shot = current?.beats.flatMap((beat) => beat.shots).find((candidate) => candidate.id === selectedShotId);
    if (!current || !shot) return;
    mutateStructure(() => {
      const next = splitEditorialShot(current, selectedShotId, Math.floor(shot.durationMs / 2));
      const originalIndex = current.beats.flatMap((beat) => beat.shots).findIndex((candidate) => candidate.id === selectedShotId);
      setSelectedShotId(next.beats.flatMap((beat) => beat.shots)[originalIndex]?.id ?? selectedShotId);
      return next;
    });
  }

  function mergeShot() {
    const current = documentRef.current;
    if (!current) return;
    const beat = current.beats.find((candidate) => candidate.shots.some((shot) => shot.id === selectedShotId));
    if (!beat) return;
    const index = beat.shots.findIndex((shot) => shot.id === selectedShotId);
    const nextShot = beat.shots[index + 1];
    if (!nextShot) return;
    mutateStructure((value) => mergeEditorialShots(value, selectedShotId, nextShot.id));
  }

  function updateRatio(ratio: EditorialCollagePipelineData['ratio']) {
    mutateDocument((current) => ({ ...current, ratio }));
  }

  async function selectImageProvider(profileId: string) {
    const previousProfileId = selectedProviderProfileId;
    setSelectedProviderProfileId(profileId);
    const result = await providerAction.run(async () => {
      const option = providerProfiles.find((candidate) => candidate.profileId === profileId);
      if (!option?.connected) throw new Error(option?.unavailableReason ?? '图片生成服务未配置，请先完成设置。');
      const mutation = await api.saveConfig({ config: enableImageProfile(state.config, profileId), secretChanges: {} });
      applyState(mutation);
      return profileId;
    }, { successMessage: '生成服务已切换。' });
    if (!result.ok) setSelectedProviderProfileId(previousProfileId);
  }

  async function selectVideoProvider(providerId: string) {
    await providerAction.run(async () => {
      const option = videoProviderOptions.find((candidate) => candidate.providerId === providerId);
      if (!option?.connected) throw new Error(option?.unavailableReason ?? '当前视频服务不可用，请先完成配置。');
      const mutation = await api.saveConfig({
        config: { ...state.config, video: { ...state.config.video, activeProviderId: providerId } },
        secretChanges: {},
      });
      applyState(mutation);
      return providerId;
    }, { successMessage: '视频生成服务已切换。' });
  }

  function restoreVersion(versionId: string) {
    mutateDocument((current) => restoreEditorialImageVersion(current, selectedShotId, versionId));
  }

  function toggleAsset(asset: DirectorAsset) {
    if (asset.sourceVersionId) restoreVersion(asset.sourceVersionId);
  }

  async function runCopyAssist(intent: DirectorCopyAssistIntent) {
    await copyAction.run(async () => {
      const submitted = creationDraft.snapshot();
      const request = projectOpenRequestRef.current;
      setCopyAssistIntent(intent);
      try {
        const result = await api.composeResearchCopy(buildDirectorCopyAssistRequest({ mode: 'vox', intent, title: submitted.createTitle, copy: submitted.createSource, durationMs: submitted.createFullText ? 'auto' : submitted.createDurationMs }))
          .catch((error) => { throw normalizeDirectorCopyAssistError(error); });
        const latest = creationDraft.snapshot();
        if (request !== projectOpenRequestRef.current || latest.createTitle !== submitted.createTitle || latest.createSource !== submitted.createSource || latest.createDurationMs !== submitted.createDurationMs || latest.createFullText !== submitted.createFullText) {
          throw new AppError('DIRECTOR_COPY_INPUT_CHANGED', '文案输入已修改，已保留当前内容。请基于当前内容重新生成。');
        }
        setCreateSource(result.copy);
        return result;
      } finally {
        setCopyAssistIntent(null);
      }
    }, { successMessage: intent === 'create' ? 'AI 文案已创作并填入。' : 'AI 文案已修改并填入。' });
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
    setCreateStep(0);
    copyAction.clearFeedback();
    setCreateOpen(true);
  }

  async function createProject() {
    const submittedDraft = creationDraft.snapshot();
    const result = await projectAction.run(async () => {
      const mutation = await api.createEditorialCollage({ title: createTitle, sourceText: createSource, ratio: createRatio, durationMs: createDurationMs });
      applyState(mutation);
      if (!mutation || mutation.kind !== 'task-upsert') throw new Error('VOX 项目已保存，但未返回可打开的任务记录。');
      const task = await api.getTaskDetail(mutation.task.id);
      if (!task) throw new Error('VOX 项目已创建，但无法重新读取。');
      const created = parseEditorialCollagePipelineData(task.pipelineData);
      const style = created.styleCandidates.find((candidate) => candidate.id === createStyleId) ?? created.styleCandidates[0];
      const configured: EditorialCollagePipelineData = {
        ...created,
        selectedStyleId: style?.id,
        styleCandidates: created.styleCandidates.map((candidate) => ({ ...candidate, selected: candidate.id === style?.id })),
        beats: created.beats.map((beat) => ({
          ...beat,
          shots: beat.shots.map((shot) => ({
            ...shot,
            scenePrompt: style ? `${style.prompt}. ${shot.scenePrompt}` : shot.scenePrompt,
            layoutTemplate: createLayoutTemplate,
            motionPreset: createMotionPreset,
            voiceId: createVoiceIdForProject,
            voiceLabel: createVoiceLabel,
            subtitleStyle: createSubtitleStyle,
            seed: shot.seed ?? '24681357',
            seedLocked: createSeedLocked,
          })),
        })),
      };
      const savedMutation = await api.saveEditorialCollage({ id: task.id, expectedUpdatedAt: configured.updatedAt, document: configured });
      applyState(savedMutation);
      const savedTask = await api.getTaskDetail(task.id);
      if (!savedTask) throw new Error('VOX 项目创建预检保存后无法重新读取。');
      return { id: task.id, document: parseEditorialCollagePipelineData(savedTask.pipelineData) };
    }, { successMessage: 'VOX 项目已创建。' });
    if (!result.ok) return;
    if (!creationDraft.complete(submittedDraft)) return;
    setActiveProjectId(result.value.id);
    setDocument(result.value.document);
    documentRef.current = result.value.document;
    savedDocumentRef.current = result.value.document;
    setSelectedShotId(result.value.document.beats[0]?.shots[0]?.id ?? '');
    setCreateTitle('');
    setCreateSource('');
    copyAction.clearFeedback();
    setCreateStep(0);
    setCreateOpen(false);
    setDirty(false);
  }

  async function persistProject(nextDocument: EditorialCollagePipelineData, baseline = nextDocument): Promise<EditorialCollagePipelineData> {
    const mutation = await api.saveEditorialCollage({ id: nextDocument.id, expectedUpdatedAt: nextDocument.updatedAt, document: nextDocument });
    applyState(mutation);
    const task = await api.getTaskDetail(nextDocument.id);
    if (!task) throw new Error('VOX 项目保存后无法重新读取。');
    const saved = parseEditorialCollagePipelineData(task.pipelineData);
    acceptSavedDocument(saved, baseline);
    return saved;
  }

  function acceptSavedDocument(saved: EditorialCollagePipelineData, submitted: EditorialCollagePipelineData) {
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
    update: (current: EditorialCollagePipelineData) => EditorialCollagePipelineData,
    optimistic = true,
  ): Promise<EditorialCollagePipelineData> {
    const pending = persistQueueRef.current.then(async () => {
      const latest = documentRef.current;
      if (!latest || latest.id !== projectId) throw new Error('VOX 项目已切换，本次生成结果未写入其他项目。');
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
    }, { successMessage: 'VOX 项目已保存。' });
    return result.ok && documentRef.current === result.value;
  }

  async function confirmQualityReview(input: ProductionQualityManualReview) {
    const current = documentRef.current;
    if (!current) throw new Error('请先打开项目。');
    const result = await projectAction.run(() => enqueueProjectMutation(current.id, (latest) => confirmDirectorQualityReview(latest, input), false), { successMessage: '已记录当前版本的人工复核。' });
    if (!result.ok) throw result.error ?? new Error('人工复核记录失败。');
  }

  async function recheckSubtitles(input: DirectorSubtitleRecheckRequest) {
    const current = documentRef.current;
    if (!current || current.id !== input.id) throw new Error('请先打开当前 VOX 项目。');
    const result = await projectAction.run(() => api.recheckDirectorSubtitles({ ...input, expectedUpdatedAt: current.updatedAt }), { successMessage: '字幕局部复检已完成。' });
    if (!result.ok) throw result.error ?? new Error('字幕局部复检失败。');
    const task = await api.getTaskDetail(current.id);
    if (!task) throw new Error('字幕复检已完成，但项目无法重新读取。');
    acceptSavedDocument(parseEditorialCollagePipelineData(task.pipelineData), current);
  }

  async function recheckMedia(input: DirectorMediaRecheckRequest) {
    const current = documentRef.current;
    if (!current || current.id !== input.id) throw new Error('请先打开当前 VOX 项目。');
    const result = await projectAction.run(() => api.recheckDirectorMedia({ ...input, expectedUpdatedAt: current.updatedAt }), { successMessage: '媒体局部复检已完成。' });
    if (!result.ok) throw result.error ?? new Error('媒体局部复检失败。');
    const task = await api.getTaskDetail(current.id);
    if (!task) throw new Error('媒体复检已完成，但项目无法重新读取。');
    acceptSavedDocument(parseEditorialCollagePipelineData(task.pipelineData), current);
  }

  async function generateShot(shotId: string) {
    const current = documentRef.current;
    const shot = shots.find((candidate) => candidate.id === shotId);
    if (!current || !shot) throw new Error('当前 VOX 镜头不存在。');
    if (!providerStatus.connected) throw new Error(providerStatus.unavailableReason ?? '图片服务未配置。');
    const input = directorImageInput(current, shotId);
    const recordId = `director-vox-${crypto.randomUUID()}`;
    const requestKey = `image:${shotId}`;
    generationRequestsRef.current.set(requestKey, recordId);
    let generationError: unknown = null;
    try {
      const mutation = await api.generateImageLab({
        id: recordId,
        prompt: input.prompt,
        ratio: input.ratio,
        style: 'magazine',
        provider: providerStatus.provider,
        resolution: providerStatus.resolution,
        quality: providerStatus.quality,
        smartMode: 'video-narration',
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
        return applyEditorialImageRecord(latest, shotId, record, providerStatus.model, input, isCurrentRequest);
      });
    }
    if (generationError) throw generationError;
    if (!record || record.status !== 'generated' || !record.imagePath) {
      throw new Error(record?.errorMessage || '图片服务没有返回可用的镜头文件。');
    }
    if (inputChanged) throw new AppError('DIRECTOR_IMAGE_INPUT_CHANGED', '镜头输入或所选画面已修改：生成图片保留在历史中，未替换当前画面。');
    return { thumbnail: toLocalImageUrl(record.imagePath), provider: `${providerStatus.label} / ${providerStatus.model}` };
  }

  async function generateStyleCandidate(styleId: string) {
    const current = documentRef.current;
    const candidate = current?.styleCandidates.find((item) => item.id === styleId);
    if (!current || !candidate) throw new Error('当前 VOX 风格候选不存在。');
    if (!providerStatus.connected) throw new Error(providerStatus.unavailableReason ?? '图片服务未配置。');
    const input: DirectorStyleCandidateInput = directorStyleCandidateInput(current, styleId);
    const recordId = `director-vox-style-${crypto.randomUUID()}`;
    const requestKey = `style:${styleId}`;
    generationRequestsRef.current.set(requestKey, recordId);
    let generationError: unknown = null;
    try {
      const mutation = await api.generateImageLab({
        id: recordId,
        prompt: input.prompt,
        ratio: input.ratio,
        style: 'magazine',
        provider: providerStatus.provider,
        resolution: providerStatus.resolution,
        quality: providerStatus.quality,
        smartMode: 'text-to-image',
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
        inputChanged = !isCurrentRequest || !directorStyleCandidateInputMatches(latest, input);
        return applyEditorialStyleCandidateRecord(latest, styleId, record, providerStatus.model, input, isCurrentRequest);
      });
    }
    if (generationError) throw generationError;
    if (!record || record.status !== 'generated' || !record.imagePath) {
      throw new Error(record?.errorMessage || '图片服务没有返回可用的风格试片。');
    }
    if (inputChanged) throw new AppError('DIRECTOR_STYLE_INPUT_CHANGED', '风格候选在生成期间已修改：试片保留在资产历史中，未替换当前候选版本。');
    return { thumbnail: toLocalImageUrl(record.imagePath), provider: `${providerStatus.label} / ${providerStatus.model}` };
  }

  async function generateVoice(shotId: string) {
    const current = documentRef.current;
    const shot = shots.find((candidate) => candidate.id === shotId);
    if (!current || !shot) throw new Error('当前 VOX 镜头不存在。');
    if (!voiceStatus.connected) throw new Error(voiceStatus.unavailableReason ?? '旁白服务未配置。');
    const input = editorialVoiceInput(current, shotId, voiceStatus);
    if (!input.text.trim()) throw new Error('当前镜头没有可生成的旁白文本。');
    const recordId = `director-vox-voice-${crypto.randomUUID()}`;
    const requestKey = `voice:${shotId}`;
    generationRequestsRef.current.set(requestKey, recordId);
    let generationError: unknown = null;
    try {
      applyState(await api.generateVoiceLabPreview({
        id: recordId,
        text: input.text,
        provider: input.provider,
        voiceId: input.voiceId,
        voiceLabel: input.voiceLabel,
        speed: input.speed,
      }));
    } catch (error) {
      generationError = error;
    }
    const record = await api.getVoiceLabRecordDetail(recordId);
    let inputChanged = false;
    let measuredDurationMs: number | undefined;
    let durationError: Error | undefined;
    if (record?.status === 'generated' && record.audioPath) {
      try {
        measuredDurationMs = await readDirectorSoundDuration(record.audioPath);
      } catch (error) {
        durationError = error instanceof Error ? error : new Error(String(error));
      }
    }
    if (record && !durationError) await enqueueProjectMutation(current.id, (latest) => {
      const isCurrentRequest = generationRequestsRef.current.get(requestKey) === recordId;
      inputChanged = !isCurrentRequest || !editorialVoiceInputMatches(latest, input);
      return applyEditorialVoiceRecord(latest, shotId, record, voiceStatus.model, input, isCurrentRequest, measuredDurationMs);
    });
    if (durationError) throw new Error(`旁白音频时长探测失败，未绑定到当前镜头：${durationError.message}`);
    if (generationError) throw generationError;
    if (!record || record.status !== 'generated' || !record.audioPath) throw new Error(record?.errorMessage || '旁白服务没有返回可用音频。');
    if (inputChanged) throw new AppError('DIRECTOR_VOICE_INPUT_CHANGED', '旁白输入或所选音频已修改：生成音频保留在历史中，未替换当前旁白。');
    return { audioUrl: toLocalAssetUrl(record.audioPath), provider: `${voiceStatus.label} / ${voiceStatus.model}` };
  }

  async function generateVideo(shotId: string) {
    const projectId = documentRef.current?.id;
    if (!projectId) throw new Error('当前 VOX 项目不存在。');
    const pending = persistQueueRef.current.then(async () => {
      const latest = documentRef.current;
      if (!latest || latest.id !== projectId) throw new Error('VOX 项目已切换，本次视频生成已取消。');
      const current = await persistProject(latest);
      try {
        const response = await api.generateDirectorShotVideo({
          id: current.id,
          shotId,
          expectedUpdatedAt: current.updatedAt,
        });
        applyState(response.mutation);
        const task = await api.getTaskDetail(projectId);
        if (!task) throw new Error('AI 动态海报已生成，但项目无法重新读取。');
        const saved = parseEditorialCollagePipelineData(task.pipelineData);
        acceptSavedDocument(saved, current);
        const asset = saved.assets.find((candidate) => candidate.id === response.result.videoAssetVersionId && candidate.kind === 'video');
        if (!asset?.localPath) throw new Error('AI 动态海报任务完成，但没有返回可播放的视频资产。');
        return {
          videoUrl: toLocalAssetUrl(asset.localPath),
          provider: response.result.providerName,
          model: response.result.model,
          estimatedCost: response.result.estimatedCost,
          jobId: response.result.videoJobId,
        };
      } catch (error) {
        const task = await api.getTaskDetail(projectId).catch(() => null);
        if (task) {
          const failed = parseEditorialCollagePipelineData(task.pipelineData);
          acceptSavedDocument(failed, current);
        }
        throw error;
      }
    });
    persistQueueRef.current = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async function renderProject() {
    await persistQueueRef.current;
    let current = documentRef.current;
    if (!current) throw new Error('当前 VOX 项目不存在。');
    if (dirty) current = await enqueueProjectMutation(current.id, (latest) => latest);
    const response = await api.renderDirectorProject({ id: current.id });
    applyState(response.mutation);
    const task = await api.getTaskDetail(current.id);
    if (!task) throw new Error('VOX 成片已生成，但项目无法重新读取。');
    const saved = parseEditorialCollagePipelineData(task.pipelineData);
    acceptSavedDocument(saved, current);
  }

  if (loadingProjectId) return <div data-editorial-collage-workbench="true"><DirectorProjectLoading mode="vox" onCancel={() => navigate?.('history')} /></div>;

  if (createOpen) {
    return <div data-editorial-collage-workbench="true"><DirectorCreateWizard
      mode="vox"
      step={createStep}
      busy={projectAction.busy || providerAction.busy || copyAction.busy}
      canContinue={Boolean(createTitle.trim() && createPlan.plan)}
      canCreate={Boolean(createTitle.trim() && createPlan.plan)}
      providerConnected={providerStatus.connected}
      providerLabel={`${providerStatus.label} · ${providerStatus.model}`}
      voiceConnected={voiceStatus.connected}
      voiceLabel={`${voiceStatus.label} · ${voiceStatus.model}`}
      summary={[
        { label: '项目', value: createTitle },
        { label: '结构', value: createStructure },
        { label: '画幅', value: createRatio },
        { label: '风格', value: EDITORIAL_STYLE_PRESETS.find((style) => style.id === createStyleId)?.label ?? '' },
        { label: '输出', value: '本地 MP4' },
      ]}
      feedback={actionFeedback}
      errorMessage={actionError}
      onBack={() => navigate?.('new-task')}
      onStepChange={setCreateStep}
      onConfigureImage={() => openSettings?.('image', 'editorial-collage')}
      onConfigureVoice={() => openSettings?.('tts', 'editorial-collage')}
      onCreate={() => void createProject()}
    >
      {createStep === 0 ? <>
        <TextField label="项目标题" value={createTitle} onChange={(_, data) => { setCreateTitle(data.value); copyAction.clearFeedback(); }} placeholder="例如：拉萨旧城的回声" />
        <div className="director-copy-field">
          <TextAreaField label="原始文案" value={createSource} onChange={(_, data) => { setCreateSource(data.value); copyAction.clearFeedback(); }} placeholder="粘贴需要拆成解释型视频的文案" resize="vertical" hint={`${createSource.length.toLocaleString('zh-CN')} 字符`} validationMessage={createPlan.error || undefined} />
          <DirectorCopyAssist
            activeIntent={copyAssistIntent}
            canCreate={Boolean(createTitle.trim())}
            canRevise={Boolean(createSource.trim())}
            feedback={copyAction.feedback}
            onCreate={() => void runCopyAssist('create')}
            onRevise={() => void runCopyAssist('revise')}
          />
        </div>
        <SegmentedControl label="画幅" value={createRatio} options={EDITORIAL_COLLAGE_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))} onChange={setCreateRatio} />
        <SelectField label="起步时长" value={String(createDurationMs)} options={[...EDITORIAL_STARTER_DURATIONS_MS.map((value) => ({ value: String(value), label: `${value / 1000} 秒${value === 60_000 ? ' · 长版' : ''}` })), { value: 'auto', label: '按全文分配时长' }]} onChange={(event) => setCreateDurationMs(event.target.value === 'auto' ? 'auto' : Number(event.target.value) as EditorialCollageStarterDurationMs)} />
        <div className="director-structure-preview" aria-live="polite"><strong>{createStructure}</strong>{createPlan.plan ? <span>预计朗读至少 {formatScriptDuration(createPlan.plan.minimumDurationMs)} · {createReadingSpeed}</span> : null}</div>
      </> : null}
      {createStep === 1 ? <>
        <SelectField label="视觉风格" value={createStyleId} options={EDITORIAL_STYLE_PRESETS.map((style) => ({ value: style.id, label: style.label }))} onChange={(event) => setCreateStyleId(event.target.value)} />
        <SelectField label="版式模板" value={createLayoutTemplate} options={['对比拼贴 · 纸张撕裂', '纪录片 · 纯画面', '漫画分格 · 角色优先'].map((value) => ({ value, label: value }))} onChange={(event) => setCreateLayoutTemplate(event.target.value as DirectorLayoutTemplate)} />
        <SelectField label="运动控制" value={createMotionPreset} options={['平移 + 缓慢推进', '轻微视差', '固定机位'].map((value) => ({ value, label: value }))} onChange={(event) => setCreateMotionPreset(event.target.value as DirectorMotionPreset)} />
        <SelectField label="图片生成服务" value={selectedProviderProfileId} options={imageProviderOptions} disabled={providerAction.busy} onChange={(event) => void selectImageProvider(event.target.value)} />
        <CheckboxField label="锁定跨镜头 Seed 与风格参考" checked={createSeedLocked} onChange={(_, data) => setCreateSeedLocked(Boolean(data.checked))} />
      </> : null}
      {createStep === 2 ? <>
        <SelectField label="音色" value={createVoiceId} options={voiceStatus.voices.length ? [...voiceStatus.voices] : [{ value: '', label: '尚未配置旁白服务，请先配置音色' , disabled: true }]} disabled={!voiceStatus.connected} onChange={(event) => setCreateVoiceId(event.target.value)} />
        <SelectField label="字幕样式" value={createSubtitleStyle} options={['简体中文 · 白色描边', '简体中文 · 下方黑底'].map((value) => ({ value, label: value }))} onChange={(event) => setCreateSubtitleStyle(event.target.value)} />
        <div className="director-output-preview"><strong>本地成片输出</strong><span>创建后先进入镜头生成；图片和旁白完成后，可在导演台生成 MP4 并打开输出目录。</span></div>
      </> : null}
    </DirectorCreateWizard></div>;
  }

  if (!document) return <div data-editorial-collage-workbench="true"><DirectorProjectRecovery mode="vox" errorMessage={actionError} returnLabel={returnView === 'projects' ? '返回项目' : '返回全部任务'} onReturnTasks={() => navigate?.(returnView)} onNewProject={startCreate} /></div>;

  return <div data-editorial-collage-workbench="true">
    <DirectorDeskWorkspace
      mode="vox"
      projectTitle={document.title}
      projectMeta={`${projects.length} 个项目`}
      episodeTitle="VOX 片段 · 01"
      stageLabel="镜头生成"
      completedStages={completedStages}
      systemStatus={systemStatus}
      systemStatusTone={systemStatusTone}
      projects={projectOptions}
      activeProjectId={activeProjectId}
      shots={shots}
      beatCount={document.beats.length}
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
      providerConnected={providerStatus.connected}
      providerLabel={providerStatus.label}
      providerModel={providerStatus.model}
      providerResolution={providerStatus.resolution}
      providerUnavailableReason={providerStatus.unavailableReason}
      providerProfileId={selectedProviderProfileId}
      providerOptions={imageProviderOptions}
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
      videoProviderOptions={videoProviderOptions.map((provider) => ({
        value: provider.providerId,
        label: `${provider.label} · ${provider.model} · ${provider.maxResolution} · 最长 ${provider.maxDurationSec}s${provider.unavailableReason ? ` · ${provider.unavailableReason}` : ''}`,
        disabled: !provider.connected,
      }))}
      outputUrl={outputAsset?.localPath ? toLocalAssetUrl(outputAsset.localPath) : undefined}
      outputHistory={renderOutputs.history.map((asset) => ({ id: asset.id, url: asset.localPath ? toLocalAssetUrl(asset.localPath) : undefined, createdAt: asset.createdAt, current: asset.id === outputAsset?.id }))}
      qualityReview={qualityReview}
      onConfirmQualityReview={confirmQualityReview}
      onRecheckSubtitles={recheckSubtitles}
      onRecheckMedia={recheckMedia}
      styleCandidates={directorStyleCandidates}
      selectedStyleId={document.selectedStyleId}
      ratio={document.ratio}
      onRatioChange={updateRatio}
      onStageChange={(stage) => { if (stage === '剧本') setSourceOpen(true); }}
      onSelectProject={(id) => { void projectLeave.requestLeave(() => openProject(id)); }}
      onAddShot={addShot}
      onRemoveShot={removeShot}
      onMoveShot={moveShot}
      onAddBeat={addBeat}
      onRemoveBeat={removeBeat}
      onMoveBeat={moveBeat}
      onSplitShot={splitShot}
      onMergeShot={mergeShot}
      onToggleAsset={toggleAsset}
      onSelectStyle={selectStyle}
      onRestoreVersion={restoreVersion}
      onSelectShot={setSelectedShotId}
      onUpdateShot={updateShot}
      onUpdateShotMotion={updateShotMotion}
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
      onGenerateStyleCandidate={(styleId) => withHistoryCapacity(PRODUCTION_MEDIA_HISTORY_DEMAND, () => generateStyleCandidate(styleId))}
      onProviderProfileChange={selectImageProvider}
      onGenerateVoice={(shotId) => withHistoryCapacity(PRODUCTION_MEDIA_HISTORY_DEMAND, () => generateVoice(shotId))}
      onGenerateVideo={(shotId) => withHistoryCapacity(PRODUCTION_MEDIA_HISTORY_DEMAND, () => generateVideo(shotId))}
      onRetryVideo={(shotId) => withHistoryCapacity(PRODUCTION_MEDIA_HISTORY_DEMAND, () => generateVideo(shotId))}
      onVideoProviderChange={selectVideoProvider}
      onRender={() => withHistoryCapacity(PRODUCTION_RENDER_HISTORY_DEMAND, renderProject)}
      onOpenOutput={() => api.openTaskOutputDirectory(document.id)}
      onOpenSettings={() => openSettings?.('image', 'editorial-collage', document.id)}
      onConfigureProvider={() => openSettings?.('image', 'editorial-collage', document.id)}
      onConfigureVideoProvider={() => openSettings?.('video', 'editorial-collage', document.id)}
      backToTasksLabel={returnView === 'projects' ? '返回项目' : '返回全部任务'}
      onBackToTasks={() => navigate?.(returnView)}
    />
    <Dialog open={sourceOpen} onOpenChange={setSourceOpen} title="剧本原稿" actions={<Button onClick={() => setSourceOpen(false)}>关闭</Button>}>
      <TextAreaField label="原始文案" value={document.sourceText ?? ''} readOnly rows={14} resize="none" hint={document.sourceText === undefined ? '此旧项目未保存原稿' : `${document.sourceText.length.toLocaleString('zh-CN')} 字符`} />
    </Dialog>
  </div>;
}

function formatScriptDuration(durationMs: number): string {
  const seconds = Math.ceil(durationMs / 1000);
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function directorShotFromEditorial(document: EditorialCollagePipelineData, beat: EditorialCollageBeat, shot: EditorialCollageBeat['shots'][number], videoProviderStatus?: DirectorVideoProviderStatus): DirectorShot {
  const linkedAssetId = shot.layers.find((layer) => layer.assetVersionId)?.assetVersionId;
  const asset = linkedAssetId ? document.assets.find((candidate) => candidate.id === linkedAssetId) : undefined;
  const voiceAsset = shot.voiceAssetVersionId ? document.assets.find((candidate) => candidate.id === shot.voiceAssetVersionId) : undefined;
  const audioClips: DirectorPreviewAudioClip[] = (productionAudioClipsForShot(document.timeline, shot) ?? []).flatMap((clip) => {
    const audioAsset = document.assets.find((candidate) => candidate.id === clip.assetVersionId && candidate.kind === 'audio');
    return audioAsset?.localPath ? [{ ...clip, url: toLocalAssetUrl(audioAsset.localPath), durationMs: clip.durationMs ?? clip.sourceDurationMs ?? shot.durationMs }] : [];
  });
  const videoAsset = shot.videoAssetVersionId ? document.assets.find((candidate) => candidate.id === shot.videoAssetVersionId && candidate.kind === 'video') : undefined;
  const job = latestProductionProviderJob(document.providerJobs, shot.id, 'text-to-image');
  const voiceJob = latestProductionProviderJob(document.providerJobs, shot.id, 'text-to-speech');
  const videoJob = shot.videoJobId
    ? document.providerJobs.find((candidate) => candidate.id === shot.videoJobId && candidate.capability === 'image-to-video')
    : latestProductionProviderJob(document.providerJobs, shot.id, 'image-to-video');
  const previewLayers = shot.layers.map((layer) => {
    const layerAsset = layer.assetVersionId ? document.assets.find((candidate) => candidate.id === layer.assetVersionId && candidate.kind === 'image') : undefined;
    return { id: layer.id, label: layer.label, src: layerAsset?.localPath ? toLocalImageUrl(layerAsset.localPath) : '', zIndex: layer.zIndex, visible: layer.visible, depth: layer.depth, motion: layer.motion };
  });
  const videoInputReady = Boolean(asset?.kind === 'image' && asset.localPath);
  return {
    id: shot.id,
    index: beat.index,
    beatIndex: beat.index,
    title: beat.title,
    scene: `VOX · ${beat.title.trim() || `节拍 ${beat.index}`}`,
    durationMs: shot.durationMs,
    framing: shot.layers.length > 1 ? '中景 / 叙事' : shot.subtitleCueIds.length > 0 ? '近景 / 细节' : '全景 / 建立',
    characterLabel: '旁白 · 叙事者',
    prompt: shot.scenePrompt,
    motionPrompt: shot.motionPrompt,
    subtitle: shot.subtitleCueIds.map((id) => beat.subtitleCues.find((cue) => cue.id === id)?.text).filter(Boolean).join(' '),
    subtitleCues: shot.subtitleCueIds.flatMap((id) => beat.subtitleCues.find((cue) => cue.id === id) ?? []),
    thumbnail: asset?.localPath ? toLocalImageUrl(asset.localPath) : undefined,
    status: job?.status === 'completed' ? 'ready' : job?.status === 'running' ? 'generating' : job?.status === 'failed' ? 'failed' : 'queued',
    provider: job ? `${job.providerId} / ${job.model}` : undefined,
    cost: job?.actualCost ?? job?.estimatedCost,
    voice: shot.voiceLabel,
    voiceId: shot.voiceId,
    voiceSpeed: shot.voiceSpeed,
    audioUrl: voiceAsset?.localPath ? toLocalAssetUrl(voiceAsset.localPath) : undefined,
    audioClips,
    soundClips: directorSoundClips(document, shot.id),
    imageReady: Boolean(asset?.localPath && asset.kind === 'image'),
    voiceReady: Boolean(voiceAsset?.localPath && voiceAsset.kind === 'audio'),
    imageFailed: job?.status === 'failed',
    voiceFailed: voiceJob?.status === 'failed',
    subtitleStyle: shot.subtitleStyle ?? '简体中文 · 白色描边',
    layoutTemplate: shot.layoutTemplate ?? '对比拼贴 · 纸张撕裂',
    motionPreset: shot.motionPreset ?? '平移 + 缓慢推进',
    seed: shot.seed,
    seedLocked: shot.seedLocked,
    renderStrategy: shot.renderStrategy as DirectorShot['renderStrategy'],
    previewLayers,
    cameraKeyframes: shot.camera,
    videoInputReady,
    videoInputUnavailableReason: videoInputReady ? undefined : '请先生成或选择一张可读取的首帧图片。',
    videoUrl: videoAsset?.localPath ? toLocalAssetUrl(videoAsset.localPath) : undefined,
    videoJobId: shot.videoJobId,
    videoJobStatus: videoJob?.status ?? 'idle',
    videoJobError: videoJob?.error,
    videoEstimatedCost: videoJob?.actualCost ?? videoJob?.estimatedCost ?? videoProviderStatus?.estimatedCost,
    linkedAssetIds: shot.layers.flatMap((layer) => layer.assetVersionId ? [layer.assetVersionId] : []),
    assetVersionIds: [...new Set([
      ...shot.layers.flatMap((layer) => layer.assetVersionId ? [layer.assetVersionId] : []),
      ...(shot.videoAssetVersionId ? [shot.videoAssetVersionId] : []),
      ...(shot.voiceAssetVersionId ? [shot.voiceAssetVersionId] : []),
      ...directorSoundClips(document, shot.id).map((clip) => clip.assetVersionId),
    ])],
  };
}
