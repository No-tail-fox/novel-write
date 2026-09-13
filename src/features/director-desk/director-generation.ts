import { activeImageProfileId, activeTtsProfileId, normalizedImageProfiles, normalizedTtsProfiles } from '../../shared/provider-profile-utils';
import type { SecretStatus } from '../../shared/config-secrets';
import { rebuildEditorialTimeline, type EditorialCollagePipelineData } from '../../shared/editorial-collage';
import type { MotionComicPipelineData } from '../../shared/motion-comic';
import type { ProductionAssetVersion, ProductionProviderJob, ProductionSubtitleCue } from '../../shared/production-workflow';
import type { ProductionAudioClip } from '../../shared/production-audio';
import { motionComicDialogueInputMatches, type MotionComicDialogueInput } from '../../shared/motion-comic-dialogue';
import { invalidateSubtitleAlignment } from '../../shared/audio-alignment';
import { defaultTaskSpeakerForProvider, taskSpeakerLabel, ttsVoiceOptionsForProvider, type RuntimeTtsProvider } from '../../shared/tts-voices';
import type { AppConfig, ImageLabRecord, ImageProvider, VoiceLabRecord } from '../../shared/types';
import { selectVideoGenerationRoute } from '../../shared/video-routing';
import { resolveVolcengineTtsApiVersion } from '../../shared/volcengine-tts';
import { buildMotionComicConsistencyPrompt, collectMotionComicReferenceBundle } from '../motion-comic/motion-comic-consistency';

export interface DirectorImageProviderStatus {
  profileId: string;
  connected: boolean;
  provider: ImageProvider;
  supportsReferenceImages: boolean;
  maxReferenceImages: number;
  label: string;
  model: string;
  resolution: '1K' | '2K' | '4K';
  quality: 'low' | 'medium' | 'high';
  unavailableReason?: string;
}

export interface DirectorVoiceProviderStatus {
  connected: boolean;
  provider: RuntimeTtsProvider;
  label: string;
  model: string;
  voiceId: string;
  voiceLabel: string;
  speed: number;
  voices: Array<{ value: string; label: string }>;
  unavailableReason?: string;
}

export interface DirectorVideoProviderOption {
  providerId: string;
  connected: boolean;
  label: string;
  model: string;
  maxDurationSec: number;
  maxResolution: string;
  unavailableReason?: string;
}

export interface DirectorVideoProviderStatus {
  providerId: string;
  connected: boolean;
  label: string;
  model: string;
  estimatedCost: number;
  remainingBudget: number;
  unavailableReason?: string;
}

export function resolveDirectorImageProviderOptions(config: AppConfig, secrets: SecretStatus): DirectorImageProviderStatus[] {
  return normalizedImageProfiles(config).map((profile) => resolveDirectorImageProviderStatus(config, secrets, profile.id));
}

export function resolveDirectorImageProviderStatus(config: AppConfig, secrets: SecretStatus, requestedProfileId = activeImageProfileId(config)): DirectorImageProviderStatus {
  const activeProfile = activeImageProfileId(config);
  const profileId = normalizedImageProfiles(config).some((candidate) => candidate.id === requestedProfileId) ? requestedProfileId : activeProfile;
  const profile = normalizedImageProfiles(config).find((candidate) => candidate.id === profileId);
  const segment = encodeURIComponent(profileId);
  const configured = (...ids: Array<keyof SecretStatus | string>) => ids.some((id) => secrets[id as keyof SecretStatus] === true);
  const provider = profile?.provider ?? config.imageProvider;
  const activeAliases = profileId === activeProfile;

  if (provider === 'gpt_image') {
    const target = profile?.gptImage ?? config.gptImage;
    const connected = Boolean(target.baseUrl.trim()) && configured(
      `image/${segment}/gptImage/apiKey`,
      ...(activeAliases ? ['image/@active/gptImage/apiKey', 'image/@legacy/apiKey'] : []),
    );
    return {
      profileId,
      connected,
      provider: 'gpt_image',
      supportsReferenceImages: true,
      maxReferenceImages: 10,
      label: profile?.name?.trim() || 'GPT Image',
      model: target.model.trim() || '未选择模型',
      resolution: target.resolution ?? '2K',
      quality: target.quality ?? 'medium',
      unavailableReason: connected ? undefined : '请先在系统设置中配置图片接口地址和 API Key。',
    };
  }

  if (provider === 'custom') {
    const target = profile?.customImage ?? config.customImage;
    const connected = Boolean(target.baseUrl.trim()) && configured(
      `image/${segment}/customImage/apiKey`,
      ...(activeAliases ? ['image/@active/customImage/apiKey'] : []),
    );
    return {
      profileId,
      connected,
      provider: 'custom',
      supportsReferenceImages: true,
      maxReferenceImages: 10,
      label: profile?.name?.trim() || target.displayName.trim() || '自定义图片接口',
      model: target.model.trim() || '未选择模型',
      resolution: target.resolution ?? '2K',
      quality: target.quality ?? 'medium',
      unavailableReason: connected ? undefined : '请先在系统设置中配置自定义图片接口和 API Key。',
    };
  }

  if (provider === 'jimeng') {
    const target = profile?.jimeng ?? config.jimeng;
    const hasSession = configured(`image/${segment}/jimeng/sessionId`, ...(activeAliases ? ['image/@active/jimeng/sessionId'] : []));
    const hasAccessKey = configured(`image/${segment}/jimeng/accessKeyId`, ...(activeAliases ? ['image/@active/jimeng/accessKeyId'] : []))
      && configured(`image/${segment}/jimeng/secretAccessKey`, ...(activeAliases ? ['image/@active/jimeng/secretAccessKey'] : []));
    const connected = hasSession || hasAccessKey;
    return {
      profileId,
      connected,
      provider: 'jimeng',
      supportsReferenceImages: false,
      maxReferenceImages: 0,
      label: profile?.name?.trim() || '即梦图片',
      model: target.model.trim() || 'jimeng',
      resolution: target.resolution,
      quality: 'medium',
      unavailableReason: connected ? undefined : '请先在系统设置中配置即梦会话或 Access Key。',
    };
  }

  return {
    profileId,
    connected: false,
    provider: 'mock',
    supportsReferenceImages: false,
    maxReferenceImages: 0,
    label: '图片服务未配置',
    model: '未配置',
    resolution: '2K',
    quality: 'medium',
    unavailableReason: '当前图片 Provider 为 mock，不能生成真实镜头。',
  };
}

export function resolveDirectorVoiceProviderStatus(config: AppConfig, secrets: SecretStatus): DirectorVoiceProviderStatus {
  const profileId = activeTtsProfileId(config);
  const profile = normalizedTtsProfiles(config).find((candidate) => candidate.id === profileId);
  const provider: RuntimeTtsProvider = profile?.provider === 'minimax' ? 'minimax' : 'volcengine';
  const segment = encodeURIComponent(profileId);
  const configured = (...ids: string[]) => ids.some((id) => secrets[id as keyof SecretStatus] === true);
  const voiceId = provider === 'minimax'
    ? profile?.minimax?.voiceId || config.tts.minimax.voiceId || defaultTaskSpeakerForProvider(provider, config)
    : profile?.volcengine?.speaker || profile?.speaker || defaultTaskSpeakerForProvider(provider, config);
  const voices = ttsVoiceOptionsForProvider(provider).map((voice) => ({ value: voice.id, label: `${voice.label} · ${voice.hint}` }));
  const voiceLabel = taskSpeakerLabel(provider, voiceId);

  if (provider === 'minimax') {
    const connected = configured(`tts/${segment}/minimax/apiKey`, 'tts/@active/minimax/apiKey');
    return {
      connected,
      provider,
      label: profile?.name?.trim() || 'MiniMax TTS',
      model: profile?.minimax?.model || config.tts.minimax.model || 'speech-02-hd',
      voiceId,
      voiceLabel,
      speed: 1,
      voices,
      unavailableReason: connected ? undefined : '请先在系统设置中配置 MiniMax TTS API Key。',
    };
  }

  const volcengine = profile?.volcengine ?? config.tts.volcengine;
  const isV3 = resolveVolcengineTtsApiVersion(volcengine) === 'v3';
  const hasCredential = isV3
    ? configured(`tts/${segment}/volcengine/apiKey`, 'tts/@active/volcengine/apiKey')
    : configured(`tts/${segment}/volcengine/accessKey`, `tts/${segment}/accessKey`, 'tts/@active/volcengine/accessKey', 'tts/@active/accessKey');
  const hasAppId = isV3 || Boolean(volcengine.appId || profile?.appId || config.tts.appId);
  const connected = hasCredential && hasAppId;
  return {
    connected,
    provider,
    label: profile?.name?.trim() || '火山引擎 TTS',
    model: volcengine.resourceId || (isV3 ? 'seed-tts-2.0' : 'volcengine-legacy'),
    voiceId,
    voiceLabel,
    speed: 1,
    voices,
    unavailableReason: connected ? undefined : '请先在系统设置中配置火山引擎 TTS 凭证。',
  };
}

export function resolveDirectorVideoProviderOptions(config: AppConfig, secrets: SecretStatus): DirectorVideoProviderOption[] {
  const whitelist = new Set(config.video.automation.providerWhitelist);
  return config.video.providers.map((provider) => {
    const hasCredential = secrets[`video/${encodeURIComponent(provider.id)}/apiKey`] === true;
    const failures = [
      !provider.enabled ? '未启用' : '',
      !provider.baseUrl.trim() ? '缺少接口地址' : '',
      !hasCredential ? '缺少 API Key' : '',
      !provider.model.trim() ? '缺少模型' : '',
      !provider.capabilities.includes('i2v') ? '不支持图生视频' : '',
      !whitelist.has(provider.id) ? '未加入调度白名单' : '',
    ].filter(Boolean);
    return {
      providerId: provider.id,
      connected: failures.length === 0,
      label: provider.name.trim() || '未命名视频服务',
      model: provider.model.trim() || '未选择模型',
      maxDurationSec: provider.maxDurationSec,
      maxResolution: provider.maxResolution,
      ...(failures.length > 0 ? { unavailableReason: failures.join('、') } : {}),
    };
  });
}

export function resolveDirectorVideoProviderStatus(
  config: AppConfig,
  secrets: SecretStatus,
  input: { durationMs: number; committedCost?: number },
): DirectorVideoProviderStatus {
  const durationSec = Math.max(1, input.durationMs / 1000);
  const committedCost = Math.max(0, input.committedCost ?? 0);
  const remainingBudget = Math.max(0, config.video.automation.budgetLimit - committedCost);
  const configWithCredentialStatus: AppConfig = {
    ...config,
    video: {
      ...config.video,
      providers: config.video.providers.map((provider) => ({
        ...provider,
        enabled: provider.enabled
          && Boolean(provider.baseUrl.trim() && provider.model.trim())
          && secrets[`video/${encodeURIComponent(provider.id)}/apiKey`] === true,
        apiKey: secrets[`video/${encodeURIComponent(provider.id)}/apiKey`] === true ? '__configured__' : '',
      })),
    },
  };
  const route = selectVideoGenerationRoute(configWithCredentialStatus, {
    durationSec,
    requiredCapabilities: ['i2v'],
    remainingBudget,
  });
  if (route.kind === 'provider') {
    return {
      providerId: route.provider.id,
      connected: true,
      label: route.provider.name.trim() || '未命名视频服务',
      model: route.provider.model.trim() || '未选择模型',
      estimatedCost: route.estimatedCost,
      remainingBudget,
    };
  }
  const preferred = config.video.providers.find((provider) => provider.id === config.video.activeProviderId) ?? config.video.providers[0];
  return {
    providerId: preferred?.id ?? '',
    connected: false,
    label: preferred?.name.trim() || '视频服务未配置',
    model: preferred?.model.trim() || '未配置',
    estimatedCost: Math.max(0, (preferred?.pricePerSecond ?? 0) * durationSec),
    remainingBudget,
    unavailableReason: `${route.reason} 请在 AI 视频设置中检查凭证、I2V 能力、时长、白名单和预算。`,
  };
}

export function directorImageInput(document: EditorialCollagePipelineData | MotionComicPipelineData, shotId: string) {
  if (document.workflowKind === 'editorial-collage') {
    const beat = document.beats.find((item) => item.shots.some((shot) => shot.id === shotId));
    const shot = beat?.shots.find((item) => item.id === shotId);
    if (!shot) throw new Error('当前 VOX 镜头不存在。');
    const selectedStyle = document.styleCandidates.find((candidate) => candidate.id === document.selectedStyleId && candidate.selected);
    const stylePrompt = selectedStyle?.prompt?.trim() ? `Style baseline (${selectedStyle.label}): ${selectedStyle.prompt.trim()}.` : '';
    return {
      projectId: document.id, workflowKind: document.workflowKind, ownerId: beat!.id, shotId,
      ratio: document.ratio,
      prompt: `${stylePrompt}${stylePrompt ? '\n' : ''}${shot.scenePrompt}\nLayout: ${shot.layoutTemplate ?? '对比拼贴 · 纸张撕裂'}. Motion reference: ${shot.motionPreset ?? '平移 + 缓慢推进'}. ${shot.seedLocked && shot.seed ? `Keep visual seed reference ${shot.seed}.` : ''}\nVOX documentary editorial still, preserve clean space for deterministic captions, no generated text, no watermark.`,
      references: [] as Array<{ assetVersionId: string; path: string }>,
      selectedAssetIds: shot.layers.flatMap((layer) => layer.assetVersionId ? [layer.assetVersionId] : []),
      styleCandidateId: selectedStyle?.id,
    };
  }
  const episode = document.episodes.find((item) => item.scenes.some((scene) => scene.shots.some((shot) => shot.id === shotId)));
  const shot = episode?.scenes.flatMap((scene) => scene.shots).find((item) => item.id === shotId);
  if (!shot) throw new Error('当前 AI 漫剧镜头不存在。');
  return {
    projectId: document.id, workflowKind: document.workflowKind, ownerId: episode!.id, shotId,
    ratio: document.ratio, prompt: buildMotionComicConsistencyPrompt(document, shot),
    references: collectMotionComicReferenceBundle(document, shot).map(({ assetVersionId, path }) => ({ assetVersionId, path })),
    selectedAssetIds: shot.firstFrameAssetVersionId ? [shot.firstFrameAssetVersionId] : [],
  };
}

export type DirectorImageInput = ReturnType<typeof directorImageInput>;

export function directorImageInputMatches(document: EditorialCollagePipelineData | MotionComicPipelineData, input: DirectorImageInput): boolean {
  try { return JSON.stringify(directorImageInput(document, input.shotId)) === JSON.stringify(input); }
  catch { return false; }
}

/**
 * Build the stable request consumed by a VOX style-sample generation.  Style
 * samples are project-level assets, so they deliberately do not borrow a
 * shot's prompt or selected layer.  Keeping this input separate also lets us
 * detect an edit made while the provider was running and avoid replacing a
 * newer candidate version with a stale response.
 */
export function directorStyleCandidateInput(document: EditorialCollagePipelineData, styleId: string) {
  const candidate = document.styleCandidates.find((item) => item.id === styleId);
  if (!candidate) throw new Error('当前 VOX 风格候选不存在。');
  const prompt = [
    candidate.prompt.trim(),
    `VOX ${document.ratio} editorial style reference sheet for a documentary collage project.`,
    'Show material, lighting, composition, and color language only; no readable text, no logos, no watermark.',
  ].filter(Boolean).join('\n');
  return {
    projectId: document.id,
    workflowKind: document.workflowKind,
    styleId: candidate.id,
    label: candidate.label,
    ratio: document.ratio,
    prompt,
  } as const;
}

export type DirectorStyleCandidateInput = ReturnType<typeof directorStyleCandidateInput>;

export function directorStyleCandidateInputMatches(document: EditorialCollagePipelineData, input: DirectorStyleCandidateInput): boolean {
  try {
    return JSON.stringify(directorStyleCandidateInput(document, input.styleId)) === JSON.stringify(input);
  } catch {
    return false;
  }
}

export function styleCandidateNodeId(styleId: string): string {
  return `style-candidate:${styleId}`;
}

/**
 * Append a style-sample attempt to production history.  A successful current
 * request updates only that candidate's assetVersionId; failed attempts stay
 * visible as jobs and stale successful attempts are retained as unselected
 * assets without changing the candidate currently used by the project.
 */
export function applyEditorialStyleCandidateRecord(
  document: EditorialCollagePipelineData,
  styleId: string,
  record: ImageLabRecord,
  model: string,
  expectedInput?: DirectorStyleCandidateInput,
  isCurrentRequest = true,
  costs: { estimatedCost?: number; actualCost?: number } = {},
): EditorialCollagePipelineData {
  const candidate = document.styleCandidates.find((item) => item.id === styleId);
  if (!candidate) throw new Error('当前 VOX 风格候选不存在。');
  const finishedAt = record.finishedAt ?? new Date().toISOString();
  const nodeId = styleCandidateNodeId(styleId);
  const attempt = document.providerJobs.filter((job) => job.nodeId === nodeId && job.capability === 'style-sample').length + 1;
  const inputHash = textFingerprint(JSON.stringify({
    styleId,
    prompt: record.prompt,
    ratio: record.ratio,
    resolution: record.resolution,
    quality: record.quality,
    provider: record.provider,
    model,
  }));
  const jobId = `style-image-job-${record.id}`;
  const estimatedCost = Math.max(0, costs.estimatedCost ?? 0);
  const actualCost = costs.actualCost === undefined ? undefined : Math.max(0, costs.actualCost);
  const job: ProductionProviderJob = {
    id: jobId,
    workflowKind: document.workflowKind,
    nodeId,
    providerId: String(record.provider),
    model,
    capability: 'style-sample',
    status: record.status === 'generated' ? 'completed' : 'failed',
    inputHash,
    idempotencyKey: `${document.id}:${nodeId}:${inputHash}:${attempt}`,
    estimatedCost,
    ...(actualCost === undefined ? {} : { actualCost }),
    attempt,
    remoteTaskId: record.upstreamTaskId ?? undefined,
    createdAt: record.createdAt,
    updatedAt: finishedAt,
    error: record.errorMessage || undefined,
  };
  const completedAsset: ProductionAssetVersion | null = record.status === 'generated' && record.imagePath ? {
    id: `style-image-asset-${record.id}`,
    assetId: `style-candidate-${styleId}`,
    kind: 'image',
    localPath: record.imagePath,
    prompt: record.prompt,
    providerJobId: jobId,
    provider: record.provider,
    model,
    createdAt: finishedAt,
    selected: true,
    pinned: false,
  } : null;
  const matches = isCurrentRequest && (!expectedInput || directorStyleCandidateInputMatches(document, expectedInput));
  const generated = matches ? completedAsset : null;
  const existingJob = document.providerJobs.some((item) => item.id === jobId);
  const nextEstimatedCost = document.estimatedCost + (existingJob ? 0 : estimatedCost);
  const nextActualCost = actualCost === undefined
    ? document.actualCost
    : (document.actualCost ?? 0) + (existingJob ? 0 : actualCost);
  const nextCandidates = document.styleCandidates.map((item) => item.id === styleId && generated
    ? { ...item, assetVersionId: generated.id }
    : item);
  return {
    ...document,
    stage: generated && (document.stage === 'draft' || document.stage === 'script-approved') ? 'style-approved' : document.stage,
    estimatedCost: nextEstimatedCost,
    ...(nextActualCost === undefined ? {} : { actualCost: nextActualCost }),
    ...(nextEstimatedCost > 0 && !document.costApprovedAt ? { costApprovedAt: finishedAt } : {}),
    providerJobs: appendProviderJob(document.providerJobs, job),
    assets: completedAsset
      ? generated
        ? appendAssetVersion(document.assets, completedAsset)
        : [...document.assets, { ...completedAsset, selected: false }]
      : document.assets,
    styleCandidates: nextCandidates,
  };
}

export function editorialVoiceInput(document: EditorialCollagePipelineData, shotId: string, defaults: Pick<DirectorVoiceProviderStatus, 'provider' | 'voiceId' | 'voiceLabel' | 'speed'>) {
  const beat = document.beats.find((item) => item.shots.some((shot) => shot.id === shotId));
  const shot = beat?.shots.find((item) => item.id === shotId);
  if (!shot) throw new Error('当前 VOX 镜头不存在。');
  const cues = shot.subtitleCueIds.flatMap((id) => beat!.subtitleCues.find((cue) => cue.id === id) ?? []);
  return {
    projectId: document.id, beatId: beat!.id, shotId,
    text: cues.map((cue) => cue.text).filter(Boolean).join(' '),
    cueIds: shot.subtitleCueIds,
    provider: defaults.provider, voiceId: shot.voiceId || defaults.voiceId,
    voiceLabel: shot.voiceLabel || defaults.voiceLabel, speed: shot.voiceSpeed ?? defaults.speed,
    selectedAssetId: shot.voiceAssetVersionId,
    defaults: { provider: defaults.provider, voiceId: defaults.voiceId, voiceLabel: defaults.voiceLabel, speed: defaults.speed },
  };
}

export type EditorialVoiceInput = ReturnType<typeof editorialVoiceInput>;

export function editorialVoiceInputMatches(document: EditorialCollagePipelineData, input: EditorialVoiceInput): boolean {
  try { return JSON.stringify(editorialVoiceInput(document, input.shotId, input.defaults)) === JSON.stringify(input); }
  catch { return false; }
}

export function applyEditorialImageRecord(
  document: EditorialCollagePipelineData,
  shotId: string,
  record: ImageLabRecord,
  model: string,
  expectedInput?: DirectorImageInput,
  isCurrentRequest = true,
): EditorialCollagePipelineData {
  const production = directorProductionRecord(document, shotId, record, model);
  const matches = isCurrentRequest && (!expectedInput || (expectedInput.shotId === shotId && directorImageInputMatches(document, expectedInput)));
  const completedAsset = record.status === 'generated' ? production.asset : null;
  const generated = matches ? completedAsset : null;
  return rebuildEditorialTimeline({
    ...document,
    stage: generated ? 'assets' : document.stage,
    assets: completedAsset ? (matches ? appendAssetVersion(document.assets, completedAsset) : [...document.assets, { ...completedAsset, selected: false }]) : document.assets,
    providerJobs: appendProviderJob(document.providerJobs, production.job),
    beats: document.beats.map((beat) => ({
      ...beat,
      shots: beat.shots.map((shot) => {
        if (shot.id !== shotId || !matches) return shot;
        const generatedLayerIndex = shot.layers.findIndex((layer) => layer.source === 'generated-image');
        const firstVisualLayerIndex = generatedLayerIndex >= 0
          ? generatedLayerIndex
          : shot.layers.findIndex((layer) => layer.kind === 'background' || layer.kind === 'subject' || layer.kind === 'archival');
        return {
          ...shot,
          providerJobId: production.job.id,
          videoAssetVersionId: generated ? undefined : shot.videoAssetVersionId,
          videoJobId: generated ? undefined : shot.videoJobId,
          layers: generated && firstVisualLayerIndex >= 0
            ? shot.layers.map((layer, index) => index === firstVisualLayerIndex ? { ...layer, source: 'generated-image', assetVersionId: generated.id } : layer)
            : shot.layers,
        };
      }),
    })),
  });
}

export function restoreEditorialImageVersion(document: EditorialCollagePipelineData, shotId: string, versionId: string): EditorialCollagePipelineData {
  if (!document.assets.some((asset) => asset.id === versionId && asset.kind === 'image' && asset.localPath)) return document;
  const shot = document.beats.flatMap((beat) => beat.shots).find((item) => item.id === shotId);
  if (!shot) return document;
  const generatedIndex = shot.layers.findIndex((layer) => layer.source === 'generated-image');
  const visualIndex = generatedIndex >= 0 ? generatedIndex : shot.layers.findIndex((layer) => ['background', 'subject', 'archival'].includes(layer.kind));
  if (visualIndex < 0) return document;
  const previousVersionId = shot.layers[visualIndex].assetVersionId;
  const next = rebuildEditorialTimeline({
    ...document,
    beats: document.beats.map((beat) => ({
      ...beat,
      shots: beat.shots.map((item) => item.id === shotId ? {
        ...item,
        ...(previousVersionId === versionId ? {} : { videoAssetVersionId: undefined, videoJobId: undefined }),
        layers: item.layers.map((layer, index) => index === visualIndex ? { ...layer, source: 'generated-image' as const, assetVersionId: versionId } : layer),
      } : item),
    })),
  });
  return { ...next, assets: reconcileRestoredImageSelection(next, previousVersionId, versionId) };
}

export function restoreMotionComicImageVersion(document: MotionComicPipelineData, shotId: string, versionId: string): MotionComicPipelineData {
  if (!document.assets.some((asset) => asset.id === versionId && asset.kind === 'image' && asset.localPath)) return document;
  const episode = document.episodes.find((item) => item.id === document.activeEpisodeId);
  const shot = episode?.scenes.flatMap((scene) => scene.shots).find((item) => item.id === shotId);
  if (!shot) return document;
  const previousVersionId = shot.firstFrameAssetVersionId;
  const next: MotionComicPipelineData = {
    ...document,
    episodes: document.episodes.map((item) => item.id === episode!.id ? {
      ...item,
      scenes: item.scenes.map((scene) => ({ ...scene, shots: scene.shots.map((candidate) => candidate.id === shotId ? { ...candidate, firstFrameAssetVersionId: versionId } : candidate) })),
      timeline: {
        ...item.timeline,
        clips: item.timeline.clips.map((clip) => clip.shotId === shotId ? {
          ...clip,
          assetVersionIds: [...new Set(clip.assetVersionIds.map((id) => id === previousVersionId && id !== shot.lastFrameAssetVersionId ? versionId : id).concat(versionId))],
        } : clip),
      },
    } : item),
  };
  return { ...next, assets: reconcileRestoredImageSelection(next, previousVersionId, versionId) };
}

function reconcileRestoredImageSelection(document: EditorialCollagePipelineData | MotionComicPipelineData, previousVersionId: string | undefined, versionId: string): ProductionAssetVersion[] {
  const affectedFamilies = new Set(document.assets.filter((asset) => asset.id === previousVersionId || asset.id === versionId).map((asset) => asset.assetId));
  const referenced = new Set<string>();
  const add = (id: string | undefined) => { if (id) referenced.add(id); };
  if (document.workflowKind === 'editorial-collage') {
    document.beats.forEach((beat) => beat.shots.forEach((shot) => shot.layers.forEach((layer) => add(layer.assetVersionId))));
    document.styleCandidates.forEach((candidate) => add(candidate.assetVersionId));
  } else {
    document.episodes.forEach((episode) => episode.scenes.forEach((scene) => scene.shots.forEach((shot) => {
      add(shot.firstFrameAssetVersionId);
      add(shot.lastFrameAssetVersionId);
    })));
    const referenceIds = new Set([
      ...document.characters.flatMap((character) => character.looks.flatMap((look) => look.referenceAssetVersionIds)),
      ...document.sceneAssets.flatMap((scene) => scene.referenceAssetVersionIds),
      ...document.props.flatMap((prop) => prop.referenceAssetVersionIds),
    ]);
    document.assets.forEach((asset) => { if (referenceIds.has(asset.id) && asset.selected && asset.pinned) add(asset.id); });
  }
  // An image can remain in use by another shot, layer, or episode after restoration.
  return document.assets.map((asset) => asset.kind === 'image' && affectedFamilies.has(asset.assetId)
    ? { ...asset, selected: referenced.has(asset.id) }
    : asset);
}

export function applyMotionComicImageRecord(
  document: MotionComicPipelineData,
  shotId: string,
  record: ImageLabRecord,
  model: string,
  expectedInput?: DirectorImageInput,
  isCurrentRequest = true,
): MotionComicPipelineData {
  const production = directorProductionRecord(document, shotId, record, model);
  const matches = isCurrentRequest && (!expectedInput || (expectedInput.shotId === shotId && directorImageInputMatches(document, expectedInput)));
  const completedAsset = record.status === 'generated' ? production.asset : null;
  const generated = matches ? completedAsset : null;
  return {
    ...document,
    stage: generated ? 'keyframes' : document.stage,
    assets: completedAsset ? (matches ? appendAssetVersion(document.assets, completedAsset) : [...document.assets, { ...completedAsset, selected: false }]) : document.assets,
    providerJobs: appendProviderJob(document.providerJobs, production.job),
    episodes: document.episodes.map((episode) => ({
      ...episode,
      status: generated && episode.scenes.some((scene) => scene.shots.some((shot) => shot.id === shotId)) ? 'keyframes' : episode.status,
      scenes: episode.scenes.map((scene) => ({
        ...scene,
        shots: scene.shots.map((shot) => shot.id === shotId && generated
          ? { ...shot, firstFrameAssetVersionId: generated.id }
          : shot),
      })),
    })),
  };
}

export function applyEditorialVoiceRecord(
  document: EditorialCollagePipelineData,
  shotId: string,
  record: VoiceLabRecord,
  model: string,
  expectedInput?: EditorialVoiceInput,
  isCurrentRequest = true,
  measuredDurationMs?: number,
): EditorialCollagePipelineData {
  const production = directorVoiceProductionRecord(document, shotId, record, model, measuredDurationMs);
  const matches = isCurrentRequest && (!expectedInput || (expectedInput.shotId === shotId
    && record.text === expectedInput.text && record.voiceId === expectedInput.voiceId
    && record.speed === expectedInput.speed && record.provider === expectedInput.provider
    && editorialVoiceInputMatches(document, expectedInput)));
  const completedAsset = record.status === 'generated' ? production.asset : null;
  const generated = matches ? completedAsset : null;
  return rebuildEditorialTimeline({
    ...document,
    assets: completedAsset ? (matches ? appendAssetVersion(document.assets, completedAsset) : [...document.assets, { ...completedAsset, selected: false }]) : document.assets,
    providerJobs: appendProviderJob(document.providerJobs, production.job),
    ...(generated && measuredDurationMs && document.timeline ? {
      timeline: {
        ...document.timeline,
        audioClips: upsertAggregateNarrationAudioClip(document.timeline.audioClips, document.timeline.clips.find((clip) => clip.shotId === shotId)?.startMs ?? 0, shotId, generated.id, shotDuration(document, shotId), measuredDurationMs),
      },
    } : {}),
    beats: document.beats.map((beat) => ({
      ...beat,
      subtitleCues: generated ? beat.subtitleCues.map((cue) => beat.shots.some((shot) => shot.id === shotId && shot.subtitleCueIds.includes(cue.id)) ? refreshShotCueAlignment(cue, generated.id, record) : cue) : beat.subtitleCues,
      shots: beat.shots.map((shot) => shot.id === shotId && generated ? {
        ...shot,
        voiceId: record.voiceId,
        voiceLabel: record.voiceLabel,
        voiceSpeed: record.speed,
        voiceAssetVersionId: generated?.id ?? shot.voiceAssetVersionId,
      } : shot),
    })),
  });
}

export function applyMotionComicVoiceRecord(
  document: MotionComicPipelineData,
  shotId: string,
  record: VoiceLabRecord,
  model: string,
  cueId?: string,
  expectedInput?: MotionComicDialogueInput,
  measuredDurationMs?: number,
): MotionComicPipelineData {
  const production = directorVoiceProductionRecord(document, shotId, record, model, measuredDurationMs);
  if (cueId) production.asset.assetId = `dialogue-voice-${cueId}`;
  const completedAsset = record.status === 'generated' ? production.asset : null;
  const matches = !expectedInput || (expectedInput.cueId === cueId && expectedInput.shotId === shotId
    && record.text === expectedInput.text && record.voiceId === expectedInput.voiceId && record.speed === expectedInput.speed && record.provider === expectedInput.provider
    && motionComicDialogueInputMatches(document, expectedInput));
  const generated = matches ? completedAsset : null;
  return {
    ...document,
    stage: generated ? 'audio' : document.stage,
    assets: completedAsset ? (matches ? appendAssetVersion(document.assets, completedAsset) : [...document.assets, { ...completedAsset, selected: false }]) : document.assets,
    providerJobs: appendProviderJob(document.providerJobs, production.job),
    episodes: document.episodes.map((episode) => {
      const ownsShot = episode.scenes.some((scene) => scene.shots.some((shot) => shot.id === shotId));
      const ownedShot = episode.scenes.flatMap((scene) => scene.shots).find((shot) => shot.id === shotId);
      return {
        ...episode,
        status: generated && ownsShot ? 'audio' : episode.status,
        // Aggregate recordings are alignment dependencies only; independent
        // cue recordings additionally own the voiceAssetVersionId reference.
        dialogueCues: generated ? episode.dialogueCues.map((cue) => cue.shotId === shotId && (!cueId || cue.id === cueId)
          ? { ...refreshShotCueAlignment(cue, generated.id, record), voiceAssetVersionId: cueId ? generated.id : undefined }
          : cue) : episode.dialogueCues,
        timeline: generated && ownsShot ? {
          ...episode.timeline,
          audioAssetVersionIds: [...episode.timeline.audioAssetVersionIds.filter((id) => document.assets.find((asset) => asset.id === id)?.assetId !== generated.assetId), generated.id],
          ...(cueId ? {
            audioClips: upsertDialogueAudioClip(episode.timeline.audioClips, cueId, shotId, generated.id, episode.dialogueCues.find((cue) => cue.id === cueId), measuredDurationMs),
          } : measuredDurationMs ? {
            audioClips: upsertAggregateNarrationAudioClip(episode.timeline.audioClips, episode.timeline.clips.find((clip) => clip.shotId === shotId)?.startMs ?? 0, shotId, generated.id, ownedShot?.durationMs ?? 1, measuredDurationMs),
          } : episode.timeline.audioClips ? { audioClips: episode.timeline.audioClips.filter((clip) => clip.shotId !== shotId || !['dialogue', 'narration'].includes(clip.trackType)) } : {}),
        } : episode.timeline,
        scenes: episode.scenes.map((scene) => ({
          ...scene,
          shots: scene.shots.map((shot) => shot.id === shotId ? {
            ...shot,
            ...(!cueId && generated ? { voiceId: record.voiceId, voiceLabel: record.voiceLabel, voiceSpeed: record.speed } : {}),
            // A single cue must never masquerade as an aggregate shot recording.
            voiceAssetVersionId: cueId && generated ? undefined : (generated?.id ?? shot.voiceAssetVersionId),
          } : shot),
        })),
      };
    }),
  };
}

function refreshShotCueAlignment<T extends ProductionSubtitleCue>(cue: T, audioAssetVersionId: string, record: VoiceLabRecord): T {
  return invalidateSubtitleAlignment(cue, { audioAssetVersionId, voiceId: record.voiceId, voiceSpeed: record.speed }) as T;
}

function upsertDialogueAudioClip(
  clips: readonly ProductionAudioClip[] | undefined,
  cueId: string,
  shotId: string,
  assetVersionId: string,
  cue: ProductionSubtitleCue | undefined,
  measuredDurationMs?: number,
): ProductionAudioClip[] {
  if (!cue) return [...(clips ?? [])];
  const next: ProductionAudioClip = {
    id: `dialogue-clip-${cueId}`,
    assetVersionId,
    shotId,
    trackType: 'dialogue',
    startMs: cue.startMs,
    sourceStartMs: 0,
    durationMs: Math.min(Math.max(1, cue.endMs - cue.startMs), measuredDurationMs ?? Math.max(1, cue.endMs - cue.startMs)),
    ...(Number.isFinite(measuredDurationMs) && measuredDurationMs! > 0 ? { sourceDurationMs: Math.round(measuredDurationMs!), sourceMediaDurationMs: Math.round(measuredDurationMs!) } : {}),
    gainDb: 0,
  };
  return [...(clips ?? []).filter((clip) => clip.id !== next.id), next];
}

function shotDuration(document: EditorialCollagePipelineData, shotId: string): number {
  return document.beats.flatMap((beat) => beat.shots).find((shot) => shot.id === shotId)?.durationMs ?? 1;
}

function upsertAggregateNarrationAudioClip(
  clips: readonly ProductionAudioClip[] | undefined,
  startMs: number,
  shotId: string,
  assetVersionId: string,
  shotDurationMs: number,
  measuredDurationMs: number,
): ProductionAudioClip[] {
  const sourceDurationMs = Math.max(1, Math.round(measuredDurationMs));
  return [
    ...(clips ?? []).filter((clip) => clip.shotId !== shotId || !['dialogue', 'narration'].includes(clip.trackType)),
    {
      id: `narration-clip-${shotId}`,
      assetVersionId,
      shotId,
      trackType: 'narration',
      startMs,
      sourceStartMs: 0,
      sourceDurationMs,
      sourceMediaDurationMs: sourceDurationMs,
      durationMs: Math.min(Math.max(1, Math.round(shotDurationMs)), sourceDurationMs),
      gainDb: 0,
    },
  ];
}

function directorProductionRecord(
  document: Pick<EditorialCollagePipelineData | MotionComicPipelineData, 'id' | 'workflowKind' | 'providerJobs'>,
  shotId: string,
  record: ImageLabRecord,
  model: string,
): { asset: ProductionAssetVersion; job: ProductionProviderJob } {
  const finishedAt = record.finishedAt ?? new Date().toISOString();
  const attempt = document.providerJobs.filter((job) => job.nodeId === shotId && job.capability === 'text-to-image').length + 1;
  const inputHash = textFingerprint(JSON.stringify({
    prompt: record.prompt,
    referenceImagePaths: record.referenceImagePaths,
    ratio: record.ratio,
    resolution: record.resolution,
    quality: record.quality,
    smartMode: record.smartMode,
    provider: record.provider,
    model,
  }));
  const jobId = `image-job-${record.id}`;
  return {
    asset: {
      id: `image-asset-${record.id}`,
      assetId: `shot-keyframe-${shotId}`,
      kind: 'image',
      localPath: record.imagePath,
      prompt: record.prompt,
      providerJobId: jobId,
      provider: record.provider,
      model,
      createdAt: finishedAt,
      selected: true,
      pinned: false,
    },
    job: {
      id: jobId,
      workflowKind: document.workflowKind,
      nodeId: shotId,
      providerId: String(record.provider),
      model,
      capability: 'text-to-image',
      status: record.status === 'generated' ? 'completed' : 'failed',
      inputHash,
      idempotencyKey: `${document.id}:${shotId}:${inputHash}:${attempt}`,
      estimatedCost: 0,
      attempt,
      remoteTaskId: record.upstreamTaskId ?? undefined,
      createdAt: record.createdAt,
      updatedAt: finishedAt,
      error: record.errorMessage || undefined,
    },
  };
}

function directorVoiceProductionRecord(
  document: Pick<EditorialCollagePipelineData | MotionComicPipelineData, 'id' | 'workflowKind' | 'providerJobs'>,
  shotId: string,
  record: VoiceLabRecord,
  model: string,
  measuredDurationMs?: number,
): { asset: ProductionAssetVersion; job: ProductionProviderJob } {
  const finishedAt = record.finishedAt ?? new Date().toISOString();
  const attempt = document.providerJobs.filter((job) => job.nodeId === shotId && job.capability === 'text-to-speech').length + 1;
  const inputHash = textFingerprint(`${record.text}\n${record.voiceId}\n${record.speed}`);
  const jobId = `voice-job-${record.id}`;
  return {
    asset: {
      id: `voice-asset-${record.id}`,
      assetId: `shot-voice-${shotId}`,
      kind: 'audio',
      localPath: record.audioPath,
      prompt: record.text,
      providerJobId: jobId,
      provider: record.provider,
      model,
      createdAt: finishedAt,
      selected: true,
      pinned: false,
      ...(Number.isFinite(measuredDurationMs) && measuredDurationMs! > 0 ? { durationMs: Math.round(measuredDurationMs!) } : {}),
    },
    job: {
      id: jobId,
      workflowKind: document.workflowKind,
      nodeId: shotId,
      providerId: record.provider,
      model,
      capability: 'text-to-speech',
      status: record.status === 'generated' ? 'completed' : 'failed',
      inputHash,
      idempotencyKey: `${document.id}:${shotId}:${inputHash}:${attempt}`,
      estimatedCost: 0,
      attempt,
      createdAt: record.createdAt,
      updatedAt: finishedAt,
      error: record.errorMessage || undefined,
    },
  };
}

function appendAssetVersion(assets: readonly ProductionAssetVersion[], generated: ProductionAssetVersion): ProductionAssetVersion[] {
  return [
    ...assets.map((asset) => asset.assetId === generated.assetId ? { ...asset, selected: false } : asset),
    generated,
  ];
}

function appendProviderJob(jobs: readonly ProductionProviderJob[], generated: ProductionProviderJob): ProductionProviderJob[] {
  return [...jobs.filter((job) => job.id !== generated.id), generated];
}

function textFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
