import type { AppConfig } from '../src/shared/types';
import type { CommercialModelProfile, CommercialProfiles, ModelCapability } from '../src/shared/commercial-contract';
import { enableLlmProfile, enableImageProfile, enableMusicProfile, enableVideoProfile, enableTtsProfile, enableSpeechToTextProfile, enableVisionProfile } from '../src/shared/provider-profile-utils';
import { AppError } from '../src/shared/app-error';

const selectors = { text: enableLlmProfile, image: enableImageProfile, video: enableVideoProfile, music: enableMusicProfile, tts: enableTtsProfile, speechToText: enableSpeechToTextProfile, vision: enableVisionProfile };
const ids = (config: AppConfig): Record<ModelCapability, (string | undefined)[]> => ({ text: config.llmProfiles.map(x => x.id), image: config.imageProfiles.map(x => x.id), video: config.video.providers.map(x => x.id), music: config.music.profiles.map(x => x.id), tts: config.ttsProfiles.map(x => x.id), speechToText: config.speechToTextProfiles.map(x => x.id), vision: config.viral.visionProfiles.map(x => x.id) });
const activeIds = (config: AppConfig): Record<ModelCapability, string> => ({ text: config.activeLlmProfileId, image: config.activeImageProfileId, video: config.video.activeProviderId, music: config.music.activeProfileId, tts: config.activeTtsProfileId, speechToText: config.activeSpeechToTextProfileId, vision: config.viral.activeVisionProfileId });

function activeProfile(profiles: CommercialProfiles, capability: ModelCapability): CommercialModelProfile | undefined {
  const id = profiles.active[capability];
  if (!id) return undefined;
  const matches = profiles.profiles.filter(item => item.id === id && item.capability === capability);
  if (matches.length !== 1) throw new AppError('MODEL_PROFILE_MISSING', '当前账号启用的模型配置已失效，请在系统设置中重新选择并启用。');
  return matches[0];
}

/** Resolve account-owned BYOK references in memory; never rewrite the machine's saved profiles. */
export function applyCommercialByokProfiles(config: AppConfig, profiles: CommercialProfiles): AppConfig {
  let result = config;
  const selected: CommercialModelProfile[] = [];
  for (const capability of Object.keys(selectors) as ModelCapability[]) {
    const profile = activeProfile(profiles, capability);
    if (!profile || profile.source !== 'byok') continue;
    if (!profile.localProfileId || ids(config)[capability].filter(id => id === profile.localProfileId).length !== 1) throw new AppError('BYOK_PROFILE_MISSING', '当前账号关联的本机模型配置已不存在或不唯一，请在系统设置中重新选择。');
    result = selectors[capability](result, profile.localProfileId);
    if (activeIds(result)[capability] !== profile.localProfileId) throw new AppError('BYOK_PROFILE_MISSING', '本机配置无法按指定 ID 启用，请在系统设置中重新保存并关联。');
    selected.push(profile);
  }
  // Legacy tasks may carry an old llmProfileId/provider. Do not leave alternative
  // credentials in this request-local view for those mirrors to select instead.
  for (const profile of selected) result = scopeSelectedByok(result, profile);
  return result;
}

function scopeSelectedByok(config: AppConfig, profile: CommercialModelProfile): AppConfig {
  const id = profile.localProfileId;
  switch (profile.capability) {
    case 'text': return { ...config, llmProfiles: config.llmProfiles.filter(item => item.id === id) };
    case 'image': return {
      ...config, imageProfiles: config.imageProfiles.filter(item => item.id === id),
      image: config.imageProvider === 'gpt_image' ? config.image : { ...config.image, apiKey: '' },
      gptImage: config.imageProvider === 'gpt_image' ? config.gptImage : { ...config.gptImage, apiKey: '' },
      customImage: config.imageProvider === 'custom' ? config.customImage : { ...config.customImage, apiKey: '' },
      jimeng: config.imageProvider === 'jimeng' ? config.jimeng : { ...config.jimeng, sessionId: '', accessKeyId: '', secretAccessKey: '' },
    };
    case 'video': return { ...config, video: { ...config.video, providers: config.video.providers.filter(item => item.id === id), automation: { ...config.video.automation, providerWhitelist: [id!] } } };
    case 'music': return { ...config, music: { ...config.music, profiles: config.music.profiles.filter(item => item.id === id) } };
    case 'tts': return {
      ...config, ttsProfiles: config.ttsProfiles.filter(item => item.id === id),
      tts: {
        ...config.tts,
        appId: config.tts.provider === 'volcengine' ? config.tts.appId : '',
        accessKey: config.tts.provider === 'volcengine' ? config.tts.accessKey : '',
        volcengine: config.tts.provider === 'volcengine' ? config.tts.volcengine : { ...config.tts.volcengine, apiKey: '', accessKeyId: '', secretAccessKey: '', appId: '', accessKey: '' },
        minimax: config.tts.provider === 'minimax' ? config.tts.minimax : { ...config.tts.minimax, apiKey: '' },
      },
    };
    case 'speechToText': return { ...config, speechToTextProfiles: config.speechToTextProfiles.filter(item => item.id === id) };
    case 'vision': return { ...config, viral: { ...config.viral, visionProfiles: config.viral.visionProfiles.filter(item => item.id === id) } };
  }
}

// Existing authoring pipelines have their own orchestration. Until their budget flow is migrated,
// an explicit platform selection must stop the old paid entry, including helper and retry routes.
const pipeline: ModelCapability[] = ['text', 'image', 'video', 'tts', 'speechToText', 'vision'];
export const legacyPaidCapabilities: Record<string, ModelCapability[]> = {
  'research:compose-copy': ['text'], 'vox:generate': ['text'], 'custom-style:generate-draft': ['text'],
  'image-lab:generate': ['image'], 'voice-lab:generate': ['tts'], 'video-lab:generate': ['video'],
  'book-selection:discover': ['text'], 'director:generate-shot-video': ['video'],
  'task:create-and-run': pipeline, 'task:retry': pipeline, 'task:rerun-step': pipeline,
  'task:update-status': pipeline, 'task:replace-video': ['video'],
  'task:regenerate-image': ['image'], 'task:regenerate-images': ['image'], 'task:reference-edit-image': ['image'], 'task:regenerate-narration': ['tts'],
  'html-video:create-task': ['text', 'image', 'tts'], 'html-video:regenerate-asset': ['image'],
  'html-video:regenerate-voice': ['tts'], 'html-video:regenerate-cover': ['image'],
  'viral:analyze-prepared': ['text', 'speechToText', 'vision'], 'viral:create-and-run': ['text', 'speechToText', 'vision'], 'viral:retry': ['text', 'speechToText', 'vision'],
  'viral:update-status': ['text', 'speechToText', 'vision'], 'viral:create-production-task': pipeline,
  'music-lab:generate': ['music'], 'music-lab:lyrics': ['music'], 'music-lab:boost-style': ['music'],
  'music-lab:operation': ['music'], 'music-lab:upload-source': ['music'], 'music-lab:voice': ['music'], 'music-lab:enhanced': ['music'],
};

/** Some IPC channels also contain local/stop/read operations; keep those available. */
export function legacyPaidCapabilitiesFor(channel: string, input?: unknown): readonly ModelCapability[] {
  const possible = legacyPaidCapabilities[channel] || [];
  // A caller without the parsed request cannot prove a mixed operation is free.
  if (!input || typeof input !== 'object') return possible;
  const request = input as Record<string, unknown>;
  if (channel === 'task:update-status' || channel === 'viral:update-status') {
    return ['paused', 'cancelled', 'draft', 'pending', 'completed', 'failed'].includes(String(request.status)) ? [] : possible;
  }
  if (channel === 'task:replace-video') {
    const source = request.source as Record<string, unknown> | undefined;
    return source?.kind === 'local' || source?.kind === 'library' || source?.kind === 'random' ? [] : possible;
  }
  if (channel === 'music-lab:enhanced' && ['list', 'poll', 'cancel'].includes(String(request.action))) return [];
  if (channel === 'music-lab:voice' && ['list', 'refresh', 'poll', 'delete'].includes(String(request.action))) return [];
  return possible;
}

export function assertLegacyModelSource(channel: string, profiles: CommercialProfiles, input?: unknown): void {
  for (const capability of legacyPaidCapabilitiesFor(channel, input)) {
    const profile = activeProfile(profiles, capability);
    if (profile?.source === 'platform') throw new AppError('PLATFORM_PIPELINE_PENDING', `此工作流尚未接入平台报价。请在系统设置中明确启用自有 API 配置后再运行；当前选择：${profile.name}。`);
  }
}
