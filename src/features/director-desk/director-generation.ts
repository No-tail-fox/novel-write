import { activeImageProfileId, activeTtsProfileId, normalizedImageProfiles, normalizedTtsProfiles } from '../../shared/provider-profile-utils';
import type { SecretStatus } from '../../shared/config-secrets';
import type { EditorialCollagePipelineData } from '../../shared/editorial-collage';
import type { MotionComicPipelineData } from '../../shared/motion-comic';
import type { ProductionAssetVersion, ProductionProviderJob } from '../../shared/production-workflow';
import { defaultTaskSpeakerForProvider, taskSpeakerLabel, ttsVoiceOptionsForProvider, type RuntimeTtsProvider } from '../../shared/tts-voices';
import type { AppConfig, ImageLabRecord, ImageProvider, VoiceLabRecord } from '../../shared/types';
import { resolveVolcengineTtsApiVersion } from '../../shared/volcengine-tts';

export interface DirectorImageProviderStatus {
  profileId: string;
  connected: boolean;
  provider: ImageProvider;
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

export function applyEditorialImageRecord(
  document: EditorialCollagePipelineData,
  shotId: string,
  record: ImageLabRecord,
  model: string,
): EditorialCollagePipelineData {
  const production = directorProductionRecord(document, shotId, record, model);
  const generated = record.status === 'generated' ? production.asset : null;
  return {
    ...document,
    stage: generated ? 'assets' : document.stage,
    assets: generated ? appendAssetVersion(document.assets, generated) : document.assets,
    providerJobs: appendProviderJob(document.providerJobs, production.job),
    beats: document.beats.map((beat) => ({
      ...beat,
      shots: beat.shots.map((shot) => {
        if (shot.id !== shotId) return shot;
        const generatedLayerIndex = shot.layers.findIndex((layer) => layer.source === 'generated-image');
        const firstVisualLayerIndex = generatedLayerIndex >= 0
          ? generatedLayerIndex
          : shot.layers.findIndex((layer) => layer.kind === 'background' || layer.kind === 'subject' || layer.kind === 'archival');
        return {
          ...shot,
          providerJobId: production.job.id,
          layers: generated && firstVisualLayerIndex >= 0
            ? shot.layers.map((layer, index) => index === firstVisualLayerIndex ? { ...layer, source: 'generated-image', assetVersionId: generated.id } : layer)
            : shot.layers,
        };
      }),
    })),
  };
}

export function applyMotionComicImageRecord(
  document: MotionComicPipelineData,
  shotId: string,
  record: ImageLabRecord,
  model: string,
): MotionComicPipelineData {
  const production = directorProductionRecord(document, shotId, record, model);
  const generated = record.status === 'generated' ? production.asset : null;
  return {
    ...document,
    stage: generated ? 'keyframes' : document.stage,
    assets: generated ? appendAssetVersion(document.assets, generated) : document.assets,
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
): EditorialCollagePipelineData {
  const production = directorVoiceProductionRecord(document, shotId, record, model);
  const generated = record.status === 'generated' ? production.asset : null;
  return {
    ...document,
    assets: generated ? appendAssetVersion(document.assets, generated) : document.assets,
    providerJobs: appendProviderJob(document.providerJobs, production.job),
    timeline: document.timeline && generated ? {
      ...document.timeline,
      audioAssetVersionIds: [...document.timeline.audioAssetVersionIds.filter((id) => document.assets.find((asset) => asset.id === id)?.assetId !== generated.assetId), generated.id],
    } : document.timeline,
    beats: document.beats.map((beat) => ({
      ...beat,
      shots: beat.shots.map((shot) => shot.id === shotId ? {
        ...shot,
        voiceId: record.voiceId,
        voiceLabel: record.voiceLabel,
        voiceSpeed: record.speed,
        voiceAssetVersionId: generated?.id ?? shot.voiceAssetVersionId,
      } : shot),
    })),
  };
}

export function applyMotionComicVoiceRecord(
  document: MotionComicPipelineData,
  shotId: string,
  record: VoiceLabRecord,
  model: string,
): MotionComicPipelineData {
  const production = directorVoiceProductionRecord(document, shotId, record, model);
  const generated = record.status === 'generated' ? production.asset : null;
  return {
    ...document,
    stage: generated ? 'audio' : document.stage,
    assets: generated ? appendAssetVersion(document.assets, generated) : document.assets,
    providerJobs: appendProviderJob(document.providerJobs, production.job),
    episodes: document.episodes.map((episode) => {
      const ownsShot = episode.scenes.some((scene) => scene.shots.some((shot) => shot.id === shotId));
      return {
        ...episode,
        status: generated && ownsShot ? 'audio' : episode.status,
        dialogueCues: generated ? episode.dialogueCues.map((cue) => cue.shotId === shotId ? { ...cue, voiceAssetVersionId: generated.id } : cue) : episode.dialogueCues,
        timeline: generated && ownsShot ? {
          ...episode.timeline,
          audioAssetVersionIds: [...episode.timeline.audioAssetVersionIds.filter((id) => document.assets.find((asset) => asset.id === id)?.assetId !== generated.assetId), generated.id],
        } : episode.timeline,
        scenes: episode.scenes.map((scene) => ({
          ...scene,
          shots: scene.shots.map((shot) => shot.id === shotId ? {
            ...shot,
            voiceId: record.voiceId,
            voiceLabel: record.voiceLabel,
            voiceSpeed: record.speed,
            voiceAssetVersionId: generated?.id ?? shot.voiceAssetVersionId,
          } : shot),
        })),
      };
    }),
  };
}

function directorProductionRecord(
  document: Pick<EditorialCollagePipelineData | MotionComicPipelineData, 'id' | 'workflowKind' | 'providerJobs'>,
  shotId: string,
  record: ImageLabRecord,
  model: string,
): { asset: ProductionAssetVersion; job: ProductionProviderJob } {
  const finishedAt = record.finishedAt ?? new Date().toISOString();
  const attempt = document.providerJobs.filter((job) => job.nodeId === shotId && job.capability === 'text-to-image').length + 1;
  const inputHash = textFingerprint(record.prompt);
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
