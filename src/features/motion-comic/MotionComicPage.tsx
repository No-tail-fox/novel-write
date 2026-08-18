import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpenCheck, Images, Save, Settings2, ShieldCheck } from 'lucide-react';
import type { ApplyMutationResult, RendererAppState as AppState } from '../../app/route-types';
import type { ShellView } from '../../shared/types';
import type { SettingsSection } from '../settings/SettingsPage';
import {
  appendMotionComicEpisode,
  appendMotionComicScene,
  appendMotionComicShot,
  MOTION_COMIC_RATIOS,
  parseMotionComicPipelineData,
  type MotionComicEpisode,
  type MotionComicPipelineData,
  type MotionComicShot,
} from '../../shared/motion-comic';
import { activeImageProfileId, enableImageProfile } from '../../shared/provider-profile-utils';
import type { StoryDreamApi } from '../../shared/storydream-api';
import { Button, CheckboxField, Pane, SegmentedControl, SelectField, TextAreaField, TextField, Toolbar } from '../../ui';
import { useAsyncAction } from '../../ui/async-action';
import { DirectorDeskWorkspace, type DirectorAsset, type DirectorQueueItem, type DirectorShot, type DirectorVersion } from '../director-desk/DirectorDeskWorkspace';
import { DirectorCreateWizard, DirectorProjectLibrary, DirectorProjectLoading } from '../director-desk/DirectorProjectStart';
import { applyMotionComicImageRecord, applyMotionComicVoiceRecord, resolveDirectorImageProviderOptions, resolveDirectorImageProviderStatus, resolveDirectorVoiceProviderStatus } from '../director-desk/director-generation';
import { toLocalAssetUrl, toLocalImageUrl } from '../tasks/task-formatters';
import shotAlley from '../../assets/director-desk/shot-alley.png';
import shotArchive from '../../assets/director-desk/shot-archive.png';
import shotRooftop from '../../assets/director-desk/shot-rooftop.png';
import shotTeahouse from '../../assets/director-desk/shot-teahouse.png';

const comicImages = [shotTeahouse, shotAlley, shotArchive, shotRooftop];

export function MotionComicPage({
  api,
  state,
  applyState,
  requestedTaskId,
  onRequestedTaskHandled,
  navigate,
  openSettings,
}: {
  api: StoryDreamApi;
  state: AppState;
  applyState: ApplyMutationResult;
  requestedTaskId: string;
  onRequestedTaskHandled: (taskId: string) => void;
  navigate?: (view: ShellView) => void;
  openSettings?: (section: SettingsSection, returnView: ShellView, taskId?: string) => void;
}) {
  const projectAction = useAsyncAction();
  const providerAction = useAsyncAction();
  const [document, setDocument] = useState<MotionComicPipelineData | null>(null);
  const documentRef = useRef<MotionComicPipelineData | null>(null);
  const [activeProjectId, setActiveProjectId] = useState('');
  const [selectedShotId, setSelectedShotId] = useState('');
  const [loadingProjectId, setLoadingProjectId] = useState('');
  const projectOpenRequestRef = useRef(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState(0);
  const [createTitle, setCreateTitle] = useState('');
  const [createPremise, setCreatePremise] = useState('');
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
  const [seriesSettingsOpen, setSeriesSettingsOpen] = useState(false);
  const [selectedProviderProfileId, setSelectedProviderProfileId] = useState(() => activeImageProfileId(state.config));

  const projects = useMemo(() => state.tasks.filter((task) => task.taskType === 'motion-comic' && !task.archivedAt).slice().sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)), [state.tasks]);
  const providerProfiles = useMemo(() => resolveDirectorImageProviderOptions(state.config, state.secretStatus), [state.config, state.secretStatus]);
  const providerStatus = useMemo(() => resolveDirectorImageProviderStatus(state.config, state.secretStatus, selectedProviderProfileId), [selectedProviderProfileId, state.config, state.secretStatus]);
  const voiceStatus = useMemo(() => resolveDirectorVoiceProviderStatus(state.config, state.secretStatus), [state.config, state.secretStatus]);
  const activeEpisode = document?.episodes.find((episode) => episode.id === document.activeEpisodeId) ?? document?.episodes[0] ?? null;
  const shots = useMemo(() => activeEpisode ? activeEpisode.scenes.flatMap((scene) => scene.shots.map((shot) => directorShotFromComic(activeEpisode, scene.title, shot, document))) : [], [activeEpisode, document]);
  const outputAsset = useMemo(() => [...(document?.assets ?? [])].reverse().find((asset) => asset.assetId === 'director-final-video' && asset.kind === 'video' && asset.selected), [document]);
  const projectOptions = useMemo(() => projects.map((task) => ({ id: task.id, title: task.title || '未命名 AI 漫剧', meta: `创建于 ${new Date(task.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` })), [projects]);
  const episodeOptions = useMemo(() => (document?.episodes ?? []).map((episode) => ({ id: episode.id, number: episode.number, title: episode.title, meta: `${episode.scenes.length} 场 · ${episode.scenes.flatMap((scene) => scene.shots).length} 镜头` })), [document?.episodes]);
  const directorAssets = useMemo<DirectorAsset[]>(() => {
    if (!document) return [];
    const selected = shots.find((shot) => shot.id === selectedShotId);
    const looks = document.characters.flatMap((character, characterIndex) => character.looks.map((look) => ({ id: look.id, label: `${character.name} · ${look.label}`, type: '角色造型', thumbnail: comicImages[characterIndex % comicImages.length], category: 'consistency' as const, locked: look.pinned, selected: selected?.linkedAssetIds?.includes(look.id) })));
    const scenes = document.sceneAssets.map((asset, index) => ({ id: asset.id, label: asset.label, type: '场景', thumbnail: comicImages[(index + 1) % comicImages.length], category: 'consistency' as const, locked: true, selected: selected?.linkedAssetIds?.includes(asset.id) }));
    const props = document.props.map((asset, index) => ({ id: asset.id, label: asset.label, type: '道具', thumbnail: comicImages[(index + 2) % comicImages.length], category: 'consistency' as const, locked: true, selected: selected?.linkedAssetIds?.includes(asset.id) }));
    const generated = document.assets.filter((asset) => asset.kind === 'image' && asset.localPath).map((asset, index) => ({ id: asset.id, sourceVersionId: asset.id, label: `关键帧 ${index + 1}`, type: asset.provider ?? '生成图片', thumbnail: toLocalImageUrl(asset.localPath!), category: 'history' as const, selected: selected?.linkedAssetIds?.includes(asset.id) }));
    return [...looks, ...scenes, ...props, ...generated];
  }, [document, selectedShotId, shots]);
  const versions = useMemo<DirectorVersion[]>(() => {
    if (!document || !selectedShotId) return [];
    return document.providerJobs.filter((job) => job.nodeId === selectedShotId && job.capability === 'text-to-image' && job.status === 'completed').map((job, index) => {
      const asset = document.assets.find((candidate) => candidate.providerJobId === job.id);
      return { id: asset?.id ?? job.id, label: `关键帧版本 ${index + 1}`, createdAt: job.updatedAt, provider: `${job.providerId} / ${job.model}`, thumbnail: asset?.localPath ? toLocalImageUrl(asset.localPath) : undefined, selected: shots.find((shot) => shot.id === selectedShotId)?.linkedAssetIds?.includes(asset?.id ?? '') };
    }).reverse();
  }, [document, selectedShotId, shots]);
  const jobs = useMemo<DirectorQueueItem[]>(() => (document?.providerJobs ?? []).filter((job) => job.capability === 'text-to-image').slice().reverse().map((job) => {
    const shot = shots.find((candidate) => candidate.id === job.nodeId);
    return { id: job.id, shotId: job.nodeId, title: shot?.title ?? '关键帧生成', status: job.status === 'queued' ? 'waiting' : job.status === 'cancelled' ? 'failed' : job.status, progress: job.status === 'completed' ? 100 : 0, cost: job.actualCost ?? job.estimatedCost, provider: `${job.providerId} / ${job.model}`, thumbnail: shot?.thumbnail, error: job.error };
  }), [document?.providerJobs, shots]);
  const createVoiceLabel = voiceStatus.voices.find((voice) => voice.value === createVoiceId)?.label ?? voiceStatus.voiceLabel;
  const completedStages = useMemo(() => {
    if (!document) return [];
    const completed: string[] = [];
    if (document.series.premise.trim()) completed.push('剧本');
    if (activeEpisode?.scenes.length) completed.push('画面拆解');
    if (document.characters.length > 0 && document.sceneAssets.length > 0) completed.push('素材一致性');
    const sourceShots = activeEpisode?.scenes.flatMap((scene) => scene.shots) ?? [];
    if (sourceShots.length > 0 && sourceShots.every((shot) => shot.firstFrameAssetVersionId && document.assets.some((asset) => asset.id === shot.firstFrameAssetVersionId && asset.kind === 'image'))) completed.push('镜头生成');
    if (sourceShots.length > 0 && sourceShots.every((shot) => shot.voiceAssetVersionId && document.assets.some((asset) => asset.id === shot.voiceAssetVersionId && asset.kind === 'audio'))) completed.push('配音字幕');
    if (outputAsset) completed.push('审片', '导出');
    return completed;
  }, [activeEpisode?.scenes.length, document, outputAsset, shots]);
  const actionError = providerAction.feedback?.tone === 'error' ? providerAction.feedback.message : projectAction.feedback?.tone === 'error' ? projectAction.feedback.message : undefined;
  const systemStatusTone = actionError ? 'error' : !providerStatus.connected || !voiceStatus.connected ? 'warning' : 'ok';
  const systemStatus = actionError ? '项目需要处理' : !providerStatus.connected ? '图片服务待配置' : !voiceStatus.connected ? '旁白服务待配置' : '生成服务正常';

  useEffect(() => {
    if (!providerAction.busy) setSelectedProviderProfileId(activeImageProfileId(state.config));
  }, [providerAction.busy, state.config]);

  useEffect(() => {
    if (!createVoiceId && voiceStatus.voices[0]?.value) setCreateVoiceId(voiceStatus.voices[0].value);
  }, [createVoiceId, voiceStatus.voices]);

  const openProject = useCallback(async (taskId: string) => {
    const request = ++projectOpenRequestRef.current;
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
    setDocument((current) => {
      const next = current ? update(current) : current;
      documentRef.current = next;
      return next;
    });
    setDirty(true);
  }

  function updateShot(id: string, update: Partial<DirectorShot>) {
    mutateDocument((current) => ({
      ...current,
      episodes: current.episodes.map((episode) => ({
        ...episode,
        dialogueCues: update.subtitle !== undefined
          ? episode.dialogueCues.map((cue) => cue.shotId === id ? { ...cue, text: update.subtitle ?? cue.text } : cue)
          : episode.dialogueCues,
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
    }));
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

  function restoreVersion(versionId: string) {
    mutateDocument((current) => ({
      ...current,
      episodes: current.episodes.map((episode) => ({ ...episode, scenes: episode.scenes.map((scene) => ({ ...scene, shots: scene.shots.map((shot) => shot.id === selectedShotId ? { ...shot, firstFrameAssetVersionId: versionId } : shot) })) })),
    }));
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

  function startCreate() {
    projectOpenRequestRef.current += 1;
    setLoadingProjectId('');
    setDocument(null);
    documentRef.current = null;
    setActiveProjectId('');
    setSelectedShotId('');
    setSeriesSettingsOpen(false);
    setCreateStep(0);
    setCreateOpen(true);
  }

  function showLibrary() {
    projectOpenRequestRef.current += 1;
    setLoadingProjectId('');
    setDocument(null);
    documentRef.current = null;
    setActiveProjectId('');
    setSelectedShotId('');
    setSeriesSettingsOpen(false);
    setCreateOpen(false);
    setDirty(false);
  }

  async function createProject() {
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
              voiceId: createVoiceId || voiceStatus.voiceId,
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
    setActiveProjectId(result.value.id);
    setDocument(result.value.document);
    documentRef.current = result.value.document;
    setSelectedShotId(result.value.document.episodes[0]?.scenes[0]?.shots[0]?.id ?? '');
    setCreateTitle('');
    setCreatePremise('');
    setCreateEpisodeTitle('第一集');
    setCreateStep(0);
    setCreateOpen(false);
    setDirty(false);
  }

  async function persistProject(nextDocument: MotionComicPipelineData): Promise<MotionComicPipelineData> {
      const mutation = await api.saveMotionComic({ id: nextDocument.id, expectedUpdatedAt: nextDocument.updatedAt, document: nextDocument });
      applyState(mutation);
      const task = await api.getTaskDetail(nextDocument.id);
      if (!task) throw new Error('AI 漫剧项目保存后无法重新读取。');
      const saved = parseMotionComicPipelineData(task.pipelineData);
      setDocument(saved);
      documentRef.current = saved;
      setDirty(false);
      return saved;
  }

  async function saveProject() {
    const current = documentRef.current;
    if (!current) return false;
    const result = await projectAction.run(async () => {
      return persistProject(current);
    }, { successMessage: 'AI 漫剧项目已保存。' });
    return result.ok;
  }

  async function generateShot(shotId: string) {
    const current = documentRef.current;
    const shot = shots.find((candidate) => candidate.id === shotId);
    if (!current || !shot) throw new Error('当前 AI 漫剧镜头不存在。');
    if (!providerStatus.connected) throw new Error(providerStatus.unavailableReason ?? '图片服务未配置。');
    const recordId = `director-comic-${crypto.randomUUID()}`;
    let generationError: unknown = null;
    try {
      const mutation = await api.generateImageLab({
        id: recordId,
        prompt: `${shot.prompt}\nLayout: ${shot.layoutTemplate ?? '漫画分格 · 角色优先'}. Motion reference: ${shot.motionPreset ?? '轻微视差'}. ${shot.seedLocked && shot.seed ? `Keep visual seed reference ${shot.seed}.` : ''}\nCinematic motion-comic keyframe, preserve the named character identity and wardrobe, consistent location and lighting, no text, no watermark.`,
        ratio: current.ratio,
        style: 'cinematic',
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
    if (record) {
      const latest = documentRef.current ?? current;
      await persistProject(applyMotionComicImageRecord(latest, shotId, record, providerStatus.model));
    }
    if (generationError) throw generationError;
    if (!record || record.status !== 'generated' || !record.imagePath) {
      throw new Error(record?.errorMessage || '图片服务没有返回可用的关键帧文件。');
    }
    return { thumbnail: toLocalImageUrl(record.imagePath), provider: `${providerStatus.label} / ${providerStatus.model}` };
  }

  async function generateVoice(shotId: string) {
    const current = documentRef.current;
    const shot = shots.find((candidate) => candidate.id === shotId);
    if (!current || !shot) throw new Error('当前 AI 漫剧镜头不存在。');
    if (!voiceStatus.connected) throw new Error(voiceStatus.unavailableReason ?? '旁白服务未配置。');
    if (!shot.subtitle.trim()) throw new Error('当前镜头没有可生成的对白文本。');
    const recordId = `director-comic-voice-${crypto.randomUUID()}`;
    const voiceId = shot.voiceId || voiceStatus.voiceId;
    const voiceLabel = shot.voice || voiceStatus.voiceLabel;
    let generationError: unknown = null;
    try {
      applyState(await api.generateVoiceLabPreview({
        id: recordId,
        text: shot.subtitle,
        provider: voiceStatus.provider,
        voiceId,
        voiceLabel,
        speed: shot.voiceSpeed ?? voiceStatus.speed,
      }));
    } catch (error) {
      generationError = error;
    }
    const record = await api.getVoiceLabRecordDetail(recordId);
    if (record) await persistProject(applyMotionComicVoiceRecord(documentRef.current ?? current, shotId, record, voiceStatus.model));
    if (generationError) throw generationError;
    if (!record || record.status !== 'generated' || !record.audioPath) throw new Error(record?.errorMessage || '旁白服务没有返回可用音频。');
    return { audioUrl: toLocalAssetUrl(record.audioPath), provider: `${voiceStatus.label} / ${voiceStatus.model}` };
  }

  async function renderProject() {
    let current = documentRef.current;
    if (!current) throw new Error('当前 AI 漫剧项目不存在。');
    if (dirty) current = await persistProject(current);
    const response = await api.renderDirectorProject({ id: current.id });
    applyState(response.mutation);
    const task = await api.getTaskDetail(current.id);
    if (!task) throw new Error('AI 漫剧成片已生成，但项目无法重新读取。');
    const saved = parseMotionComicPipelineData(task.pipelineData);
    setDocument(saved);
    documentRef.current = saved;
    setDirty(false);
  }

  if (loadingProjectId) return <div data-motion-comic-workbench="true"><DirectorProjectLoading mode="motion-comic" onCancel={showLibrary} /></div>;

  if (createOpen) {
    return <div data-motion-comic-workbench="true"><DirectorCreateWizard
      mode="motion-comic"
      step={createStep}
      busy={projectAction.busy || providerAction.busy}
      canContinue={createStep > 0 || Boolean(createTitle.trim() && createPremise.trim())}
      canCreate={Boolean(createTitle.trim() && createPremise.trim() && createProtagonist.trim() && createLocation.trim())}
      providerConnected={providerStatus.connected}
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
      feedback={projectAction.feedback?.tone === 'success' ? projectAction.feedback.message : undefined}
      errorMessage={actionError}
      onBackLibrary={showLibrary}
      onSwitchMode={(mode) => navigate?.(mode === 'vox' ? 'editorial-collage' : 'motion-comic')}
      onStepChange={setCreateStep}
      onConfigureImage={() => openSettings?.('image', 'motion-comic')}
      onConfigureVoice={() => openSettings?.('tts', 'motion-comic')}
      onCreate={() => void createProject()}
    >
      {createStep === 0 ? <>
        <TextField label="系列名称" value={createTitle} onChange={(_, data) => setCreateTitle(data.value)} placeholder="例如：雨夜来信" />
        <TextAreaField label="核心设定" value={createPremise} onChange={(_, data) => setCreatePremise(data.value)} placeholder="一句话写清主角、异常事件与核心冲突" resize="vertical" hint={`${createPremise.trim().length} 字 · 将生成三场六镜首集骨架`} />
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
        <SelectField label="生成服务" value={selectedProviderProfileId} options={providerProfiles.map((profile) => ({ value: profile.profileId, label: `${profile.label} · ${profile.model} · ${profile.resolution}${profile.connected ? '' : ' · 未连接'}`, disabled: !profile.connected }))} disabled={providerAction.busy} onChange={(event) => void selectImageProvider(event.target.value)} />
        <SelectField label="旁白角色" value={createVoiceId} options={voiceStatus.voices.length ? [...voiceStatus.voices] : [{ value: '', label: '尚未配置旁白服务', disabled: true }]} disabled={!voiceStatus.connected} onChange={(event) => setCreateVoiceId(event.target.value)} />
        <SelectField label="字幕样式" value={createSubtitleStyle} options={['简体中文 · 白色描边', '简体中文 · 下方黑底'].map((value) => ({ value, label: value }))} onChange={(event) => setCreateSubtitleStyle(event.target.value)} />
        <CheckboxField label="锁定角色、场景和跨镜头 Seed" checked={createSeedLocked} onChange={(_, data) => setCreateSeedLocked(Boolean(data.checked))} />
        <div className="director-output-preview"><strong>系列骨架与本地成片</strong><span>创建后先进入系列圣经或镜头板；关键帧与旁白完成后，可在导演台生成 MP4。</span></div>
      </> : null}
    </DirectorCreateWizard></div>;
  }

  if (!document || !activeEpisode) return <div data-motion-comic-workbench="true"><DirectorProjectLibrary mode="motion-comic" projects={projectOptions} busy={projectAction.busy} feedback={projectAction.feedback?.tone === 'success' ? projectAction.feedback.message : undefined} errorMessage={actionError} onOpenProject={(id) => void openProject(id)} onNewProject={startCreate} onBackHome={() => navigate?.('new-task')} onSwitchMode={(mode) => navigate?.(mode === 'vox' ? 'editorial-collage' : 'motion-comic')} /></div>;

  if (seriesSettingsOpen) return <div data-motion-comic-workbench="true" data-motion-comic-series-bible="true" className="director-series-page">
    <header className="director-series-header">
      <div><Button variant="subtle" icon={<ArrowLeft size={14} />} onClick={() => setSeriesSettingsOpen(false)}>返回导演台</Button><span><BookOpenCheck size={18} /><strong>系列圣经</strong><small>角色、场景、道具与视觉规则的唯一事实来源</small></span></div>
      <Toolbar aria-label="系列圣经操作"><Button variant="subtle" icon={<Settings2 size={14} />} onClick={() => openSettings?.('image', 'motion-comic', document.id)}>模型设置</Button><Button variant="primary" icon={<Save size={14} />} disabled={!dirty || projectAction.busy} onClick={() => void saveProject().then((saved) => { if (saved) setSeriesSettingsOpen(false); })}>保存系列圣经</Button></Toolbar>
    </header>
    <div className="director-series-layout">
      <Pane as="aside" tone="subtle" className="director-series-summary"><ShieldCheck size={20} /><h2>{document.title}</h2><p>{document.series.premise}</p><dl><div><dt>类型</dt><dd>{document.series.genre}</dd></div><div><dt>角色</dt><dd>{document.characters.length}</dd></div><div><dt>场景</dt><dd>{document.sceneAssets.length}</dd></div><div><dt>道具</dt><dd>{document.props.length}</dd></div></dl><span>所有修改先保留在本地草稿，点击保存后写入项目版本。</span></Pane>
      <main className="director-series-editor">
        <section><div className="director-series-section-heading"><span>01</span><div><h2>系列定位</h2><p>确定故事承诺、观众和不可随意改写的世界规则。</p></div></div><TextField label="系列名称" value={document.title} onChange={(_, data) => mutateDocument((current) => ({ ...current, title: data.value, series: { ...current.series, title: data.value } }))} /><TextAreaField label="核心设定" value={document.series.premise} onChange={(_, data) => mutateDocument((current) => ({ ...current, series: { ...current.series, premise: data.value } }))} resize="vertical" /><div className="director-create-two-col"><TextField label="类型" value={document.series.genre} onChange={(_, data) => mutateDocument((current) => ({ ...current, series: { ...current.series, genre: data.value } }))} /><TextField label="基调" value={document.series.tone} onChange={(_, data) => mutateDocument((current) => ({ ...current, series: { ...current.series, tone: data.value } }))} /></div><TextField label="目标观众" value={document.series.audience} onChange={(_, data) => mutateDocument((current) => ({ ...current, series: { ...current.series, audience: data.value } }))} /><TextAreaField label="世界规则" value={document.series.worldRules.join('\n')} onChange={(_, data) => mutateDocument((current) => ({ ...current, series: { ...current.series, worldRules: data.value.split('\n').map((value) => value.trim()).filter(Boolean) } }))} resize="vertical" /><TextAreaField label="视觉规则" value={document.series.visualRules.join('\n')} onChange={(_, data) => mutateDocument((current) => ({ ...current, series: { ...current.series, visualRules: data.value.split('\n').map((value) => value.trim()).filter(Boolean) } }))} resize="vertical" /><TextAreaField label="负面提示词" value={document.series.negativePrompt} onChange={(_, data) => mutateDocument((current) => ({ ...current, series: { ...current.series, negativePrompt: data.value } }))} resize="vertical" /></section>
        <section><div className="director-series-section-heading"><span>02</span><div><h2>角色一致性</h2><p>身份提示词和造型必须跨集复用，不能由单镜头临时覆盖。</p></div></div>{document.characters.map((character, index) => <div key={character.id} className="director-series-entity"><div className="director-create-two-col"><TextField label={`角色 ${index + 1}`} value={character.name} onChange={(_, data) => mutateDocument((current) => ({ ...current, characters: current.characters.map((item) => item.id === character.id ? { ...item, name: data.value } : item) }))} /><TextField label="戏剧作用" value={character.role} onChange={(_, data) => mutateDocument((current) => ({ ...current, characters: current.characters.map((item) => item.id === character.id ? { ...item, role: data.value } : item) }))} /></div><TextAreaField label="身份提示词" value={character.identityPrompt} onChange={(_, data) => mutateDocument((current) => ({ ...current, characters: current.characters.map((item) => item.id === character.id ? { ...item, identityPrompt: data.value } : item) }))} resize="vertical" /><div className="director-create-two-col"><TextAreaField label="性格与行为" value={character.personality} onChange={(_, data) => mutateDocument((current) => ({ ...current, characters: current.characters.map((item) => item.id === character.id ? { ...item, personality: data.value } : item) }))} resize="vertical" /><TextAreaField label="声音说明" value={character.voiceNotes} onChange={(_, data) => mutateDocument((current) => ({ ...current, characters: current.characters.map((item) => item.id === character.id ? { ...item, voiceNotes: data.value } : item) }))} resize="vertical" /></div>{character.looks.map((look) => <div key={look.id} className="director-series-look"><TextField label="造型名称" value={look.label} onChange={(_, data) => mutateDocument((current) => ({ ...current, characters: current.characters.map((item) => item.id === character.id ? { ...item, looks: item.looks.map((candidate) => candidate.id === look.id ? { ...candidate, label: data.value } : candidate) } : item) }))} /><TextAreaField label="外观与服装" value={`${look.appearancePrompt}\n${look.wardrobe}`} onChange={(_, data) => { const [appearancePrompt = '', ...wardrobe] = data.value.split('\n'); mutateDocument((current) => ({ ...current, characters: current.characters.map((item) => item.id === character.id ? { ...item, looks: item.looks.map((candidate) => candidate.id === look.id ? { ...candidate, appearancePrompt, wardrobe: wardrobe.join('\n') } : candidate) } : item) })); }} resize="vertical" /></div>)}</div>)}</section>
        <section><div className="director-series-section-heading"><span>03</span><div><h2>场景一致性</h2><p>固定建筑、光线、天气与时间，供所有镜头直接引用。</p></div></div>{document.sceneAssets.map((asset) => <div key={asset.id} className="director-series-entity"><TextField label="场景名称" value={asset.label} onChange={(_, data) => mutateDocument((current) => ({ ...current, sceneAssets: current.sceneAssets.map((item) => item.id === asset.id ? { ...item, label: data.value } : item) }))} /><TextAreaField label="场景说明" value={asset.description} onChange={(_, data) => mutateDocument((current) => ({ ...current, sceneAssets: current.sceneAssets.map((item) => item.id === asset.id ? { ...item, description: data.value } : item) }))} resize="vertical" /><TextAreaField label="生成提示词" value={asset.prompt} onChange={(_, data) => mutateDocument((current) => ({ ...current, sceneAssets: current.sceneAssets.map((item) => item.id === asset.id ? { ...item, prompt: data.value } : item) }))} resize="vertical" /><TextAreaField label="连续性说明" value={asset.continuityNotes} onChange={(_, data) => mutateDocument((current) => ({ ...current, sceneAssets: current.sceneAssets.map((item) => item.id === asset.id ? { ...item, continuityNotes: data.value } : item) }))} resize="vertical" /></div>)}</section>
        <section><div className="director-series-section-heading"><span>04</span><div><h2>道具一致性</h2><p>关键物件必须保持轮廓、材质和标记可识别。</p></div></div>{document.props.map((asset) => <div key={asset.id} className="director-series-entity"><TextField label="道具名称" value={asset.label} onChange={(_, data) => mutateDocument((current) => ({ ...current, props: current.props.map((item) => item.id === asset.id ? { ...item, label: data.value } : item) }))} /><TextAreaField label="道具说明" value={asset.description} onChange={(_, data) => mutateDocument((current) => ({ ...current, props: current.props.map((item) => item.id === asset.id ? { ...item, description: data.value } : item) }))} resize="vertical" /><TextAreaField label="生成提示词" value={asset.prompt} onChange={(_, data) => mutateDocument((current) => ({ ...current, props: current.props.map((item) => item.id === asset.id ? { ...item, prompt: data.value } : item) }))} resize="vertical" /></div>)}</section>
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
        selectedShotId={selectedShotId || shots[0]?.id || ''}
        dirty={dirty}
        busy={projectAction.busy || providerAction.busy}
        feedback={providerAction.feedback?.tone === 'success' ? providerAction.feedback.message : projectAction.feedback?.tone === 'success' ? projectAction.feedback.message : undefined}
        errorMessage={actionError}
        estimatedCost={document.estimatedCost}
        providerConnected={providerStatus.connected}
        providerLabel={providerStatus.label}
        providerModel={providerStatus.model}
        providerResolution={providerStatus.resolution}
        providerUnavailableReason={providerStatus.unavailableReason}
        providerProfileId={selectedProviderProfileId}
        providerOptions={providerProfiles.map((profile) => ({ value: profile.profileId, label: `${profile.label} · ${profile.model} · ${profile.resolution}${profile.connected ? '' : ' · 未连接'}`, disabled: !profile.connected }))}
        voiceConnected={voiceStatus.connected}
        voiceProviderLabel={voiceStatus.label}
        voiceModel={voiceStatus.model}
        voiceUnavailableReason={voiceStatus.unavailableReason}
        voiceOptions={voiceStatus.voices}
        outputUrl={outputAsset?.localPath ? toLocalAssetUrl(outputAsset.localPath) : undefined}
        ratio={document.ratio}
        onRatioChange={updateRatio}
        onSelectProject={openProject}
        onSelectEpisode={selectEpisode}
        onAddEpisode={addEpisode}
        onAddScene={addScene}
        onAddShot={addShot}
        onToggleAsset={toggleConsistencyAsset}
        onRestoreVersion={restoreVersion}
        onSelectShot={setSelectedShotId}
        onUpdateShot={updateShot}
        onSave={() => void saveProject()}
        onNewProject={startCreate}
        onGenerateShot={generateShot}
        onProviderProfileChange={selectImageProvider}
        onGenerateVoice={generateVoice}
        onRender={renderProject}
        onOpenOutput={() => api.openTaskOutputDirectory(document.id)}
        onOpenSettings={() => setSeriesSettingsOpen(true)}
        onConfigureProvider={() => openSettings?.('image', 'motion-comic', document.id)}
        onBackToLibrary={showLibrary}
        onStageChange={(stage) => { if (stage === '剧本') setSeriesSettingsOpen(true); }}
        onModeChange={(mode) => navigate?.(mode === 'vox' ? 'editorial-collage' : 'motion-comic')}
      />
    </div>
  </>;
}

function directorShotFromComic(episode: MotionComicEpisode, sceneTitle: string, shot: MotionComicShot, document: MotionComicPipelineData | null): DirectorShot {
  const subtitle = shot.dialogueCueIds.map((cueId) => episode.dialogueCues.find((cue) => cue.id === cueId)?.text).filter(Boolean).join(' ');
  const characterLabel = shot.characterLookIds.map((lookId) => document?.characters.flatMap((character) => character.looks).find((look) => look.id === lookId)?.label).filter(Boolean).join('、') || '角色待绑定';
  const asset = shot.firstFrameAssetVersionId ? document?.assets.find((candidate) => candidate.id === shot.firstFrameAssetVersionId) : undefined;
  const voiceAsset = shot.voiceAssetVersionId ? document?.assets.find((candidate) => candidate.id === shot.voiceAssetVersionId) : undefined;
  const job = [...(document?.providerJobs ?? [])].reverse().find((candidate) => candidate.nodeId === shot.id && candidate.capability === 'text-to-image');
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
    thumbnail: asset?.localPath ? toLocalImageUrl(asset.localPath) : comicImages[(shot.index - 1) % comicImages.length],
    status: job?.status === 'completed' ? 'ready' : job?.status === 'running' ? 'generating' : job?.status === 'failed' ? 'failed' : 'queued',
    provider: job ? `${job.providerId} / ${job.model}` : undefined,
    cost: job?.actualCost ?? job?.estimatedCost,
    voice: shot.voiceLabel,
    voiceId: shot.voiceId,
    voiceSpeed: shot.voiceSpeed,
    audioUrl: voiceAsset?.localPath ? toLocalAssetUrl(voiceAsset.localPath) : undefined,
    subtitleStyle: shot.subtitleStyle ?? '简体中文 · 白色描边',
    layoutTemplate: shot.layoutTemplate ?? '漫画分格 · 角色优先',
    motionPreset: shot.motionPreset ?? '轻微视差',
    seed: shot.seed,
    seedLocked: shot.seedLocked,
    linkedAssetIds: [...shot.characterLookIds, shot.sceneAssetId, ...shot.propAssetIds, ...(shot.firstFrameAssetVersionId ? [shot.firstFrameAssetVersionId] : [])],
  };
}
