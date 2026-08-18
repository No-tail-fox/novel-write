import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApplyMutationResult, RendererAppState as AppState } from '../../app/route-types';
import type { ShellView } from '../../shared/types';
import type { SettingsSection } from '../settings/SettingsPage';
import {
  EDITORIAL_COLLAGE_RATIOS,
  EDITORIAL_STYLE_PRESETS,
  parseEditorialCollagePipelineData,
  type EditorialCollageBeat,
  type EditorialCollagePipelineData,
} from '../../shared/editorial-collage';
import { activeImageProfileId, enableImageProfile } from '../../shared/provider-profile-utils';
import type { StoryDreamApi } from '../../shared/storydream-api';
import { CheckboxField, SegmentedControl, SelectField, TextAreaField, TextField } from '../../ui';
import { useAsyncAction } from '../../ui/async-action';
import { DirectorDeskWorkspace, type DirectorAsset, type DirectorLayoutTemplate, type DirectorMotionPreset, type DirectorQueueItem, type DirectorShot, type DirectorVersion } from '../director-desk/DirectorDeskWorkspace';
import { DirectorCreateWizard, DirectorProjectLoading, DirectorProjectRecovery } from '../director-desk/DirectorProjectStart';
import { applyEditorialImageRecord, applyEditorialVoiceRecord, resolveDirectorImageProviderOptions, resolveDirectorImageProviderStatus, resolveDirectorVoiceProviderStatus } from '../director-desk/director-generation';
import { toLocalAssetUrl, toLocalImageUrl } from '../tasks/task-formatters';
import shotAlley from '../../assets/director-desk/shot-alley.png';
import shotArchive from '../../assets/director-desk/shot-archive.png';
import shotRooftop from '../../assets/director-desk/shot-rooftop.png';
import shotTeahouse from '../../assets/director-desk/shot-teahouse.png';

const editorialImages = [shotAlley, shotArchive, shotRooftop, shotTeahouse];

export function EditorialCollagePage({
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
  const [document, setDocument] = useState<EditorialCollagePipelineData | null>(null);
  const documentRef = useRef<EditorialCollagePipelineData | null>(null);
  const [activeProjectId, setActiveProjectId] = useState('');
  const [selectedShotId, setSelectedShotId] = useState('');
  const [loadingProjectId, setLoadingProjectId] = useState(() => requestedTaskId);
  const projectOpenRequestRef = useRef(0);
  const [createOpen, setCreateOpen] = useState(() => !requestedTaskId);
  const [createStep, setCreateStep] = useState(0);
  const [createTitle, setCreateTitle] = useState('');
  const [createSource, setCreateSource] = useState('');
  const [createRatio, setCreateRatio] = useState<EditorialCollagePipelineData['ratio']>('16:9');
  const [createStyleId, setCreateStyleId] = useState<string>(EDITORIAL_STYLE_PRESETS[0].id);
  const [createLayoutTemplate, setCreateLayoutTemplate] = useState<DirectorLayoutTemplate>('对比拼贴 · 纸张撕裂');
  const [createMotionPreset, setCreateMotionPreset] = useState<DirectorMotionPreset>('平移 + 缓慢推进');
  const [createVoiceId, setCreateVoiceId] = useState('');
  const [createSubtitleStyle, setCreateSubtitleStyle] = useState('简体中文 · 白色描边');
  const [createSeedLocked, setCreateSeedLocked] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [selectedProviderProfileId, setSelectedProviderProfileId] = useState(() => activeImageProfileId(state.config));

  const projects = useMemo(() => state.tasks.filter((task) => task.taskType === 'editorial-collage' && !task.archivedAt).slice().sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)), [state.tasks]);
  const providerProfiles = useMemo(() => resolveDirectorImageProviderOptions(state.config, state.secretStatus), [state.config, state.secretStatus]);
  const providerStatus = useMemo(() => resolveDirectorImageProviderStatus(state.config, state.secretStatus, selectedProviderProfileId), [selectedProviderProfileId, state.config, state.secretStatus]);
  const voiceStatus = useMemo(() => resolveDirectorVoiceProviderStatus(state.config, state.secretStatus), [state.config, state.secretStatus]);
  const shots = useMemo(() => document ? document.beats.flatMap((beat) => beat.shots.map((shot) => directorShotFromEditorial(document, beat, shot))) : [], [document]);
  const outputAsset = useMemo(() => [...(document?.assets ?? [])].reverse().find((asset) => asset.assetId === 'director-final-video' && asset.kind === 'video' && asset.selected), [document]);
  const projectOptions = useMemo(() => projects.map((task) => ({ id: task.id, title: task.title || '未命名 VOX 项目', meta: `创建于 ${new Date(task.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` })), [projects]);
  const directorAssets = useMemo<DirectorAsset[]>(() => (document?.assets ?? []).filter((asset) => asset.kind === 'image' && asset.localPath).map((asset, index) => ({ id: asset.id, sourceVersionId: asset.id, label: `生成素材 ${index + 1}`, type: asset.provider ?? '生成图片', thumbnail: toLocalImageUrl(asset.localPath!), category: 'history', selected: shots.some((shot) => shot.linkedAssetIds?.includes(asset.id)) })), [document?.assets, shots]);
  const versions = useMemo<DirectorVersion[]>(() => {
    if (!document || !selectedShotId) return [];
    return document.providerJobs.filter((job) => job.nodeId === selectedShotId && job.capability === 'text-to-image' && job.status === 'completed').map((job, index) => {
      const asset = document.assets.find((candidate) => candidate.providerJobId === job.id);
      return { id: asset?.id ?? job.id, label: `画面版本 ${index + 1}`, createdAt: job.updatedAt, provider: `${job.providerId} / ${job.model}`, thumbnail: asset?.localPath ? toLocalImageUrl(asset.localPath) : undefined, selected: shots.find((shot) => shot.id === selectedShotId)?.linkedAssetIds?.includes(asset?.id ?? '') };
    }).reverse();
  }, [document, selectedShotId, shots]);
  const jobs = useMemo<DirectorQueueItem[]>(() => (document?.providerJobs ?? []).filter((job) => job.capability === 'text-to-image').slice().reverse().map((job) => {
    const shot = shots.find((candidate) => candidate.id === job.nodeId);
    return { id: job.id, shotId: job.nodeId, title: shot?.title ?? '镜头生成', status: job.status === 'queued' ? 'waiting' : job.status === 'cancelled' ? 'failed' : job.status, progress: job.status === 'completed' ? 100 : 0, cost: job.actualCost ?? job.estimatedCost, provider: `${job.providerId} / ${job.model}`, thumbnail: shot?.thumbnail, error: job.error };
  }), [document?.providerJobs, shots]);
  const createVoiceLabel = voiceStatus.voices.find((voice) => voice.value === createVoiceId)?.label ?? voiceStatus.voiceLabel;
  const completedStages = useMemo(() => {
    if (!document) return [];
    const completed: string[] = [];
    if (document.beats.length > 0) completed.push('剧本', '画面拆解');
    if (document.selectedStyleId) completed.push('素材一致性');
    const sourceShots = document.beats.flatMap((beat) => beat.shots);
    if (sourceShots.length > 0 && sourceShots.every((shot) => shot.layers.some((layer) => layer.assetVersionId && document.assets.some((asset) => asset.id === layer.assetVersionId && asset.kind === 'image')))) completed.push('镜头生成');
    if (sourceShots.length > 0 && sourceShots.every((shot) => shot.voiceAssetVersionId && document.assets.some((asset) => asset.id === shot.voiceAssetVersionId && asset.kind === 'audio'))) completed.push('配音字幕');
    if (outputAsset) completed.push('审片', '导出');
    return completed;
  }, [document, outputAsset, shots]);
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
      if (!task || task.taskType !== 'editorial-collage') throw new Error('VOX 项目不存在或已被移除。');
      return parseEditorialCollagePipelineData(task.pipelineData);
    });
    if (request !== projectOpenRequestRef.current) return;
    setLoadingProjectId('');
    if (!result.ok) return;
    setDocument(result.value);
    documentRef.current = result.value;
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
      beats: current.beats.map((beat) => ({
        ...beat,
        title: id === beat.shots[0]?.id && update.title !== undefined ? update.title : beat.title,
        narration: id === beat.shots[0]?.id && update.prompt !== undefined ? update.prompt : beat.narration,
        subtitleCues: id === beat.shots[0]?.id && update.subtitle !== undefined && beat.subtitleCues[0]
          ? beat.subtitleCues.map((cue, index) => index === 0 ? { ...cue, text: update.subtitle ?? cue.text } : cue)
          : beat.subtitleCues,
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
          subtitleStyle: update.subtitleStyle ?? shot.subtitleStyle,
          seed: update.seed ?? shot.seed,
          seedLocked: update.seedLocked ?? shot.seedLocked,
        })),
      })),
    }));
  }

  function updateRatio(ratio: EditorialCollagePipelineData['ratio']) {
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

  function restoreVersion(versionId: string) {
    mutateDocument((current) => ({
      ...current,
      beats: current.beats.map((beat) => ({
        ...beat,
        shots: beat.shots.map((shot) => {
          if (shot.id !== selectedShotId) return shot;
          const visualIndex = shot.layers.findIndex((layer) => layer.source === 'generated-image' || layer.kind === 'background' || layer.kind === 'subject' || layer.kind === 'archival');
          return visualIndex < 0 ? shot : { ...shot, layers: shot.layers.map((layer, index) => index === visualIndex ? { ...layer, source: 'generated-image' as const, assetVersionId: versionId } : layer) };
        }),
      })),
    }));
  }

  function toggleAsset(asset: DirectorAsset) {
    if (asset.sourceVersionId) restoreVersion(asset.sourceVersionId);
  }

  function startCreate() {
    projectOpenRequestRef.current += 1;
    setLoadingProjectId('');
    setDocument(null);
    documentRef.current = null;
    setActiveProjectId('');
    setSelectedShotId('');
    setCreateStep(0);
    setCreateOpen(true);
  }

  async function createProject() {
    const result = await projectAction.run(async () => {
      const mutation = await api.createEditorialCollage({ title: createTitle, sourceText: createSource, ratio: createRatio });
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
            voiceId: createVoiceId || voiceStatus.voiceId,
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
    setActiveProjectId(result.value.id);
    setDocument(result.value.document);
    documentRef.current = result.value.document;
    setSelectedShotId(result.value.document.beats[0]?.shots[0]?.id ?? '');
    setCreateTitle('');
    setCreateSource('');
    setCreateStep(0);
    setCreateOpen(false);
    setDirty(false);
  }

  async function persistProject(nextDocument: EditorialCollagePipelineData): Promise<EditorialCollagePipelineData> {
      const mutation = await api.saveEditorialCollage({ id: nextDocument.id, expectedUpdatedAt: nextDocument.updatedAt, document: nextDocument });
      applyState(mutation);
      const task = await api.getTaskDetail(nextDocument.id);
      if (!task) throw new Error('VOX 项目保存后无法重新读取。');
      const saved = parseEditorialCollagePipelineData(task.pipelineData);
      setDocument(saved);
      documentRef.current = saved;
      setDirty(false);
      return saved;
  }

  async function saveProject() {
    const current = documentRef.current;
    if (!current) return;
    const result = await projectAction.run(async () => {
      return persistProject(current);
    }, { successMessage: 'VOX 项目已保存。' });
    if (!result.ok) return;
  }

  async function generateShot(shotId: string) {
    const current = documentRef.current;
    const shot = shots.find((candidate) => candidate.id === shotId);
    if (!current || !shot) throw new Error('当前 VOX 镜头不存在。');
    if (!providerStatus.connected) throw new Error(providerStatus.unavailableReason ?? '图片服务未配置。');
    const recordId = `director-vox-${crypto.randomUUID()}`;
    let generationError: unknown = null;
    try {
      const mutation = await api.generateImageLab({
        id: recordId,
        prompt: `${shot.prompt}\nLayout: ${shot.layoutTemplate ?? '对比拼贴 · 纸张撕裂'}. Motion reference: ${shot.motionPreset ?? '平移 + 缓慢推进'}. ${shot.seedLocked && shot.seed ? `Keep visual seed reference ${shot.seed}.` : ''}\nVOX documentary editorial still, preserve clean space for deterministic captions, no generated text, no watermark.`,
        ratio: current.ratio,
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
    if (record) {
      const latest = documentRef.current ?? current;
      await persistProject(applyEditorialImageRecord(latest, shotId, record, providerStatus.model));
    }
    if (generationError) throw generationError;
    if (!record || record.status !== 'generated' || !record.imagePath) {
      throw new Error(record?.errorMessage || '图片服务没有返回可用的镜头文件。');
    }
    return { thumbnail: toLocalImageUrl(record.imagePath), provider: `${providerStatus.label} / ${providerStatus.model}` };
  }

  async function generateVoice(shotId: string) {
    const current = documentRef.current;
    const shot = shots.find((candidate) => candidate.id === shotId);
    if (!current || !shot) throw new Error('当前 VOX 镜头不存在。');
    if (!voiceStatus.connected) throw new Error(voiceStatus.unavailableReason ?? '旁白服务未配置。');
    if (!shot.subtitle.trim()) throw new Error('当前镜头没有可生成的旁白文本。');
    const recordId = `director-vox-voice-${crypto.randomUUID()}`;
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
    if (record) await persistProject(applyEditorialVoiceRecord(documentRef.current ?? current, shotId, record, voiceStatus.model));
    if (generationError) throw generationError;
    if (!record || record.status !== 'generated' || !record.audioPath) throw new Error(record?.errorMessage || '旁白服务没有返回可用音频。');
    return { audioUrl: toLocalAssetUrl(record.audioPath), provider: `${voiceStatus.label} / ${voiceStatus.model}` };
  }

  async function renderProject() {
    let current = documentRef.current;
    if (!current) throw new Error('当前 VOX 项目不存在。');
    if (dirty) current = await persistProject(current);
    const response = await api.renderDirectorProject({ id: current.id });
    applyState(response.mutation);
    const task = await api.getTaskDetail(current.id);
    if (!task) throw new Error('VOX 成片已生成，但项目无法重新读取。');
    const saved = parseEditorialCollagePipelineData(task.pipelineData);
    setDocument(saved);
    documentRef.current = saved;
    setDirty(false);
  }

  if (loadingProjectId) return <div data-editorial-collage-workbench="true"><DirectorProjectLoading mode="vox" onCancel={() => navigate?.('history')} /></div>;

  if (createOpen) {
    return <div data-editorial-collage-workbench="true"><DirectorCreateWizard
      mode="vox"
      step={createStep}
      busy={projectAction.busy || providerAction.busy}
      canContinue={createStep > 0 || Boolean(createTitle.trim() && createSource.trim())}
      canCreate={Boolean(createTitle.trim() && createSource.trim())}
      providerConnected={providerStatus.connected}
      providerLabel={`${providerStatus.label} · ${providerStatus.model}`}
      voiceConnected={voiceStatus.connected}
      voiceLabel={`${voiceStatus.label} · ${voiceStatus.model}`}
      summary={[
        { label: '项目', value: createTitle },
        { label: '结构', value: '30 秒 · 4 镜头' },
        { label: '画幅', value: createRatio },
        { label: '风格', value: EDITORIAL_STYLE_PRESETS.find((style) => style.id === createStyleId)?.label ?? '' },
        { label: '输出', value: '本地 MP4' },
      ]}
      feedback={projectAction.feedback?.tone === 'success' ? projectAction.feedback.message : undefined}
      errorMessage={actionError}
      onBack={() => navigate?.('new-task')}
      onStepChange={setCreateStep}
      onConfigureImage={() => openSettings?.('image', 'editorial-collage')}
      onConfigureVoice={() => openSettings?.('tts', 'editorial-collage')}
      onCreate={() => void createProject()}
    >
      {createStep === 0 ? <>
        <TextField label="项目标题" value={createTitle} onChange={(_, data) => setCreateTitle(data.value)} placeholder="例如：拉萨旧城的回声" />
        <TextAreaField label="原始文案" value={createSource} onChange={(_, data) => setCreateSource(data.value)} placeholder="粘贴需要拆成解释型视频的文案" resize="vertical" hint={`${createSource.trim().length} 字 · 将拆成钩子、背景、证据、结论`} />
        <SegmentedControl label="画幅" value={createRatio} options={EDITORIAL_COLLAGE_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))} onChange={setCreateRatio} />
        <div className="director-structure-preview"><strong>30 秒解释结构</strong><span>01 钩子 · 3s</span><span>02 背景 · 9s</span><span>03 证据 · 9s</span><span>04 结论 · 9s</span></div>
      </> : null}
      {createStep === 1 ? <>
        <SelectField label="视觉风格" value={createStyleId} options={EDITORIAL_STYLE_PRESETS.map((style) => ({ value: style.id, label: style.label }))} onChange={(event) => setCreateStyleId(event.target.value)} />
        <SelectField label="版式模板" value={createLayoutTemplate} options={['对比拼贴 · 纸张撕裂', '纪录片 · 纯画面', '漫画分格 · 角色优先'].map((value) => ({ value, label: value }))} onChange={(event) => setCreateLayoutTemplate(event.target.value as DirectorLayoutTemplate)} />
        <SelectField label="运动控制" value={createMotionPreset} options={['平移 + 缓慢推进', '轻微视差', '固定机位'].map((value) => ({ value, label: value }))} onChange={(event) => setCreateMotionPreset(event.target.value as DirectorMotionPreset)} />
        <SelectField label="生成服务" value={selectedProviderProfileId} options={providerProfiles.map((profile) => ({ value: profile.profileId, label: `${profile.label} · ${profile.model} · ${profile.resolution}${profile.connected ? '' : ' · 未连接'}`, disabled: !profile.connected }))} disabled={providerAction.busy} onChange={(event) => void selectImageProvider(event.target.value)} />
        <CheckboxField label="锁定跨镜头 Seed 与风格参考" checked={createSeedLocked} onChange={(_, data) => setCreateSeedLocked(Boolean(data.checked))} />
      </> : null}
      {createStep === 2 ? <>
        <SelectField label="旁白角色" value={createVoiceId} options={voiceStatus.voices.length ? [...voiceStatus.voices] : [{ value: '', label: '尚未配置旁白服务', disabled: true }]} disabled={!voiceStatus.connected} onChange={(event) => setCreateVoiceId(event.target.value)} />
        <SelectField label="字幕样式" value={createSubtitleStyle} options={['简体中文 · 白色描边', '简体中文 · 下方黑底'].map((value) => ({ value, label: value }))} onChange={(event) => setCreateSubtitleStyle(event.target.value)} />
        <div className="director-output-preview"><strong>本地成片输出</strong><span>创建后先进入镜头生成；图片和旁白完成后，可在导演台生成 MP4 并打开输出目录。</span></div>
      </> : null}
    </DirectorCreateWizard></div>;
  }

  if (!document) return <div data-editorial-collage-workbench="true"><DirectorProjectRecovery mode="vox" errorMessage={actionError} onReturnTasks={() => navigate?.('history')} onNewProject={startCreate} /></div>;

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
      onToggleAsset={toggleAsset}
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
      onOpenSettings={() => openSettings?.('image', 'editorial-collage', document.id)}
      onBackToTasks={() => navigate?.('history')}
    />
  </div>;
}

function directorShotFromEditorial(document: EditorialCollagePipelineData, beat: EditorialCollageBeat, shot: EditorialCollageBeat['shots'][number]): DirectorShot {
  const linkedAssetId = shot.layers.find((layer) => layer.assetVersionId)?.assetVersionId;
  const asset = linkedAssetId ? document.assets.find((candidate) => candidate.id === linkedAssetId) : undefined;
  const voiceAsset = shot.voiceAssetVersionId ? document.assets.find((candidate) => candidate.id === shot.voiceAssetVersionId) : undefined;
  const job = [...document.providerJobs].reverse().find((candidate) => candidate.nodeId === shot.id && candidate.capability === 'text-to-image');
  return {
    id: shot.id,
    index: beat.index,
    title: beat.title,
    scene: `VOX · ${beat.index === 1 ? '开场' : beat.index === 2 ? '背景' : beat.index === 3 ? '证据' : '结论'}`,
    durationMs: shot.durationMs,
    framing: beat.index === 1 ? '全景 / 建立' : beat.index === 2 ? '中景 / 推进' : '近景 / 证据',
    characterLabel: '旁白 · 叙事者',
    prompt: shot.scenePrompt,
    motionPrompt: shot.motionPrompt,
    subtitle: beat.subtitleCues[0]?.text ?? beat.narration,
    thumbnail: asset?.localPath ? toLocalImageUrl(asset.localPath) : editorialImages[(beat.index - 1) % editorialImages.length],
    status: job?.status === 'completed' ? 'ready' : job?.status === 'running' ? 'generating' : job?.status === 'failed' ? 'failed' : 'queued',
    provider: job ? `${job.providerId} / ${job.model}` : undefined,
    cost: job?.actualCost ?? job?.estimatedCost,
    voice: shot.voiceLabel,
    voiceId: shot.voiceId,
    voiceSpeed: shot.voiceSpeed,
    audioUrl: voiceAsset?.localPath ? toLocalAssetUrl(voiceAsset.localPath) : undefined,
    subtitleStyle: shot.subtitleStyle ?? '简体中文 · 白色描边',
    layoutTemplate: shot.layoutTemplate ?? '对比拼贴 · 纸张撕裂',
    motionPreset: shot.motionPreset ?? '平移 + 缓慢推进',
    seed: shot.seed,
    seedLocked: shot.seedLocked,
    linkedAssetIds: shot.layers.flatMap((layer) => layer.assetVersionId ? [layer.assetVersionId] : []),
  };
}
