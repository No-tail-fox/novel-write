import { defaultConfig } from './config';
import { normalizeAppConfig, normalizeMusicProfile, normalizeSpeechToTextProfile, normalizeVideoProvider, normalizeVisionProfile } from './config-utils';
import { resolveLlmProtocol } from './llm-protocol';
import { normalizeVolcengineTtsApiSettings } from './volcengine-tts';
import type { AppConfig, ConfigTestTarget, ImageProviderProfile, MusicProviderProfile, SpeechToTextProviderProfile, TtsProviderProfile, VideoProviderConfig, VisionProviderProfile } from './types';

export type EditableLlmProvider = 'openai' | 'custom' | 'anthropic';
export type ImageResolution = '1K' | '2K' | '4K';

export type SelectedProviderProfileIds = {
  llm?: string;
  image?: string;
  tts?: string;
  music?: string;
  video?: string;
  speechToText?: string;
  vision?: string;
};

export function normalizeEditableConfigProviders(config: AppConfig): AppConfig {
  const activeId = activeLlmProfileId(config);
  const llmProfiles = normalizeLocalLlmProfiles(config.llmProfiles.length ? config.llmProfiles : [config.llm], activeId);
  const activeProfile = llmProfiles.find((profile) => profile.id === activeId) ?? llmProfiles[0] ?? normalizeLocalLlmProfile(config.llm, 0);
  return normalizeAppConfig({
    ...config,
    llm: { ...activeProfile, provider: editableLlmProfileProvider(activeProfile), enabled: true },
    llmProfiles,
    activeLlmProfileId: activeProfile.id!,
    imageProvider: config.imageProvider === 'mock' ? 'gpt_image' : config.imageProvider,
    tts: {
      ...config.tts,
      provider: config.tts.provider === 'mock' ? 'volcengine' : config.tts.provider,
    },
  });
}

export function buildConfigForSelectedProfileTest(config: AppConfig, target: ConfigTestTarget, selectedIds: SelectedProviderProfileIds): AppConfig {
  const normalized = normalizeEditableConfigProviders(config);
  if (target === 'llm' && selectedIds.llm) return enableLlmProfile(normalized, selectedIds.llm);
  if (target === 'image' && selectedIds.image) return enableImageProfile(normalized, selectedIds.image);
  if (target === 'tts' && selectedIds.tts) return enableTtsProfile(normalized, selectedIds.tts);
  if (target === 'music' && selectedIds.music) return enableMusicProfile(normalized, selectedIds.music);
  if (target === 'video' && selectedIds.video) return enableVideoProfile(normalized, selectedIds.video);
  if (target === 'speechToText' && selectedIds.speechToText) return enableSpeechToTextProfile(normalized, selectedIds.speechToText);
  if (target === 'vision' && selectedIds.vision) return enableVisionProfile(normalized, selectedIds.vision);
  return normalized;
}

export function activateSelectedProviderProfileForTarget(config: AppConfig, target: ConfigTestTarget, selectedIds: SelectedProviderProfileIds): AppConfig {
  if (target === 'llm' || target === 'image' || target === 'tts' || target === 'music' || target === 'video' || target === 'speechToText' || target === 'vision') {
    return buildConfigForSelectedProfileTest(config, target, selectedIds);
  }
  return normalizeEditableConfigProviders(config);
}

export function activeLlmProfileId(config: AppConfig): string {
  return config.activeLlmProfileId || config.llm.id || config.llmProfiles[0]?.id || 'default-llm';
}

export function editableLlmProfileProvider(profile: AppConfig['llm']): EditableLlmProvider {
  if (profile.provider === 'anthropic') return 'anthropic';
  return profile.provider === 'openai' ? 'openai' : 'custom';
}

export function normalizeLocalLlmProfiles(profiles: AppConfig['llm'][], activeId: string): AppConfig['llm'][] {
  const seen = new Set<string>();
  const output: AppConfig['llm'][] = [];
  profiles.forEach((profile, index) => {
    const normalized = normalizeLocalLlmProfile(profile, index);
    if (seen.has(normalized.id!)) return;
    seen.add(normalized.id!);
    output.push({ ...normalized, enabled: normalized.id === activeId });
  });
  return output.length ? output : [{ ...normalizeLocalLlmProfile(defaultConfig.llm, 0), enabled: true }];
}

export function normalizeLocalLlmProfile(profile: Partial<AppConfig['llm']>, index: number): AppConfig['llm'] {
  const merged = { ...defaultConfig.llm, ...profile };
  const id = profile.id || createLlmProfileId();
  const provider = editableLlmProfileProvider(merged);
  return {
    ...merged,
    id,
    name: profile.name?.trim() || (provider === 'anthropic' ? 'Anthropic' : provider === 'openai' ? 'OpenAI Official' : index === 0 ? '第三方' : `配置 ${index + 1}`),
    provider,
    protocol: resolveLlmProtocol(merged),
    enabled: Boolean(profile.enabled),
    timeoutMs: normalizePositiveNumber(merged.timeoutMs, defaultConfig.llm.timeoutMs ?? 120000),
  };
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function enableLlmProfile(config: AppConfig, id: string): AppConfig {
  const profiles = normalizeLocalLlmProfiles(config.llmProfiles.length ? config.llmProfiles : [config.llm], id);
  const active = profiles.find((profile) => profile.id === id) ?? profiles[0];
  return {
    ...config,
    llm: { ...active, enabled: true },
    llmProfiles: profiles.map((profile) => ({ ...profile, enabled: profile.id === active.id })),
    activeLlmProfileId: active.id!,
  };
}

export function saveLlmProfile(config: AppConfig, profile: AppConfig['llm']): AppConfig {
  const activeId = activeLlmProfileId(config);
  const normalized = normalizeLocalLlmProfile(profile, config.llmProfiles.length);
  const profiles = normalizeLocalLlmProfiles(config.llmProfiles.length ? config.llmProfiles : [config.llm], activeId);
  const nextProfiles = profiles.some((item) => item.id === normalized.id)
    ? profiles.map((item) => (item.id === normalized.id ? { ...normalized, enabled: item.id === activeId } : item))
    : [{ ...normalized, enabled: false }, ...profiles];
  const next = { ...config, llmProfiles: nextProfiles };
  return normalized.id === activeId ? enableLlmProfile(next, normalized.id) : next;
}

export function addLlmProfile(config: AppConfig): AppConfig {
  const profile = normalizeLocalLlmProfile(
    {
      ...defaultConfig.llm,
      id: createLlmProfileId(),
      name: '新增配置',
      apiKey: '',
      model: '',
      enabled: false,
    },
    config.llmProfiles.length,
  );
  return { ...config, llmProfiles: [profile, ...normalizeLocalLlmProfiles(config.llmProfiles.length ? config.llmProfiles : [config.llm], activeLlmProfileId(config))] };
}

export function copyLlmProfile(config: AppConfig, id: string): AppConfig {
  const profiles = normalizeLocalLlmProfiles(config.llmProfiles.length ? config.llmProfiles : [config.llm], activeLlmProfileId(config));
  const index = profiles.findIndex((profile) => profile.id === id);
  if (index < 0) return config;
  const copy = normalizeLocalLlmProfile({ ...profiles[index], id: createLlmProfileId(), name: `${profiles[index].name || '配置'} 副本`, enabled: false }, profiles.length);
  return { ...config, llmProfiles: [...profiles.slice(0, index + 1), copy, ...profiles.slice(index + 1)] };
}

export function removeLlmProfile(config: AppConfig, id: string): AppConfig {
  const profiles = normalizeLocalLlmProfiles(config.llmProfiles.length ? config.llmProfiles : [config.llm], activeLlmProfileId(config));
  if (profiles.length <= 1) return config;
  const nextProfiles = profiles.filter((profile) => profile.id !== id);
  const activeId = id === activeLlmProfileId(config) ? nextProfiles[0].id! : activeLlmProfileId(config);
  return enableLlmProfile({ ...config, llmProfiles: nextProfiles }, activeId);
}

export function normalizedImageProfiles(config: AppConfig): ImageProviderProfile[] {
  return normalizeAppConfig(config).imageProfiles;
}

export function activeImageProfileId(config: AppConfig): string {
  return normalizeAppConfig(config).activeImageProfileId;
}

export function imageProfileGptImage(profile: ImageProviderProfile): AppConfig['gptImage'] {
  return { ...defaultConfig.gptImage, ...(profile.gptImage ?? {}) };
}

export function imageProfileJimeng(profile: ImageProviderProfile): AppConfig['jimeng'] {
  return { ...defaultConfig.jimeng, ...(profile.jimeng ?? {}) };
}

export function imageProfileCustomImage(profile: ImageProviderProfile): AppConfig['customImage'] {
  return { ...defaultConfig.customImage, ...(profile.customImage ?? {}) };
}

export function normalizeImageProfileForUi(profile: ImageProviderProfile, index: number): ImageProviderProfile {
  const provider = profile.provider === 'jimeng' || profile.provider === 'custom' ? profile.provider : 'gpt_image';
  return {
    id: profile.id || createModelProfileId('image'),
    name: profile.name?.trim() || (provider === 'gpt_image' ? 'GPT Image' : provider === 'jimeng' ? '即梦' : index === 0 ? '自定义图片' : `图片配置 ${index + 1}`),
    enabled: Boolean(profile.enabled),
    provider,
    gptImage: imageProfileGptImage(profile),
    jimeng: imageProfileJimeng(profile),
    customImage: imageProfileCustomImage(profile),
  };
}

export function enableImageProfile(config: AppConfig, id: string): AppConfig {
  const normalized = normalizeAppConfig(config);
  const profiles = normalized.imageProfiles.length ? normalized.imageProfiles : [normalizeImageProfileForUi({ ...defaultConfig.imageProfiles[0], enabled: true }, 0)];
  const active = profiles.find((profile) => profile.id === id) ?? profiles[0];
  return normalizeAppConfig({
    ...normalized,
    imageProfiles: profiles.map((profile) => ({ ...profile, enabled: profile.id === active.id })),
    activeImageProfileId: active.id!,
  });
}

export function saveImageProfile(config: AppConfig, profile: ImageProviderProfile): AppConfig {
  const normalized = normalizeAppConfig(config);
  const activeId = activeImageProfileId(normalized);
  const profiles = normalizedImageProfiles(normalized);
  const nextProfile = normalizeImageProfileForUi(profile, profiles.length);
  const nextProfiles = profiles.some((item) => item.id === nextProfile.id)
    ? profiles.map((item) => (item.id === nextProfile.id ? { ...nextProfile, enabled: item.id === activeId } : item))
    : [{ ...nextProfile, enabled: false }, ...profiles];
  const next = normalizeAppConfig({ ...normalized, imageProfiles: nextProfiles, activeImageProfileId: activeId });
  return nextProfile.id === activeId ? enableImageProfile(next, nextProfile.id) : next;
}

export function addImageProfile(config: AppConfig): AppConfig {
  const normalized = normalizeAppConfig(config);
  const profile = normalizeImageProfileForUi(
    {
      id: createModelProfileId('image'),
      name: '新增绘图配置',
      enabled: false,
      provider: 'gpt_image',
      gptImage: { ...defaultConfig.gptImage, apiKey: '', model: '' },
    },
    normalized.imageProfiles.length,
  );
  return normalizeAppConfig({ ...normalized, imageProfiles: [profile, ...normalized.imageProfiles] });
}

export function copyImageProfile(config: AppConfig, id: string): AppConfig {
  const normalized = normalizeAppConfig(config);
  const profiles = normalized.imageProfiles;
  const index = profiles.findIndex((profile) => profile.id === id);
  if (index < 0) return normalized;
  const copy = normalizeImageProfileForUi({ ...profiles[index], id: createModelProfileId('image'), name: `${profiles[index].name || '绘图配置'} 副本`, enabled: false }, profiles.length);
  return normalizeAppConfig({ ...normalized, imageProfiles: [...profiles.slice(0, index + 1), copy, ...profiles.slice(index + 1)] });
}

export function removeImageProfile(config: AppConfig, id: string): AppConfig {
  const normalized = normalizeAppConfig(config);
  const profiles = normalized.imageProfiles;
  if (profiles.length <= 1) return normalized;
  const nextProfiles = profiles.filter((profile) => profile.id !== id);
  const activeId = id === normalized.activeImageProfileId ? nextProfiles[0].id! : normalized.activeImageProfileId;
  return enableImageProfile({ ...normalized, imageProfiles: nextProfiles }, activeId);
}

export function normalizedTtsProfiles(config: AppConfig): TtsProviderProfile[] {
  return normalizeAppConfig(config).ttsProfiles;
}

export function activeTtsProfileId(config: AppConfig): string {
  return normalizeAppConfig(config).activeTtsProfileId;
}

export function ttsProfileVolcengine(profile: TtsProviderProfile): AppConfig['tts']['volcengine'] {
  const source: Partial<AppConfig['tts']['volcengine']> = profile.volcengine
    ?? (profile.appId || profile.accessKey
      ? { appId: profile.appId ?? '', accessKey: profile.accessKey ?? '', speaker: profile.speaker ?? '' }
      : defaultConfig.tts.volcengine);
  const merged = { ...defaultConfig.tts.volcengine, ...source };
  return {
    ...merged,
    ...normalizeVolcengineTtsApiSettings(source),
    appId: merged.appId || profile.appId || '',
    accessKey: merged.accessKey || profile.accessKey || '',
    speaker: profile.speaker ?? merged.speaker,
  };
}

export function ttsProfileMinimax(profile: TtsProviderProfile): AppConfig['tts']['minimax'] {
  return { ...defaultConfig.tts.minimax, ...(profile.minimax ?? {}) };
}

export function normalizeTtsProfileForUi(profile: TtsProviderProfile, index: number): TtsProviderProfile {
  const provider = profile.provider === 'minimax' ? 'minimax' : 'volcengine';
  const volcengine = ttsProfileVolcengine(profile);
  const minimax = ttsProfileMinimax(profile);
  return {
    id: profile.id || createModelProfileId('tts'),
    name: profile.name?.trim() || (provider === 'volcengine' ? '火山引擎' : index === 0 ? 'MiniMax' : `配音配置 ${index + 1}`),
    enabled: Boolean(profile.enabled),
    provider,
    appId: volcengine.appId,
    accessKey: volcengine.accessKey,
    speaker: volcengine.speaker,
    volcengine,
    minimax,
  };
}

export function enableTtsProfile(config: AppConfig, id: string): AppConfig {
  const normalized = normalizeAppConfig(config);
  const profiles = normalized.ttsProfiles.length ? normalized.ttsProfiles : [normalizeTtsProfileForUi({ ...defaultConfig.ttsProfiles[0], enabled: true }, 0)];
  const active = profiles.find((profile) => profile.id === id) ?? profiles[0];
  return normalizeAppConfig({
    ...normalized,
    ttsProfiles: profiles.map((profile) => ({ ...profile, enabled: profile.id === active.id })),
    activeTtsProfileId: active.id!,
  });
}

export function saveTtsProfile(config: AppConfig, profile: TtsProviderProfile): AppConfig {
  const normalized = normalizeAppConfig(config);
  const activeId = activeTtsProfileId(normalized);
  const profiles = normalizedTtsProfiles(normalized);
  const nextProfile = normalizeTtsProfileForUi(profile, profiles.length);
  const nextProfiles = profiles.some((item) => item.id === nextProfile.id)
    ? profiles.map((item) => (item.id === nextProfile.id ? { ...nextProfile, enabled: item.id === activeId } : item))
    : [{ ...nextProfile, enabled: false }, ...profiles];
  const next = normalizeAppConfig({ ...normalized, ttsProfiles: nextProfiles, activeTtsProfileId: activeId });
  return nextProfile.id === activeId ? enableTtsProfile(next, nextProfile.id) : next;
}

export function addTtsProfile(config: AppConfig): AppConfig {
  const normalized = normalizeAppConfig(config);
  const profile = normalizeTtsProfileForUi(
    {
      id: createModelProfileId('tts'),
      name: '新增配音配置',
      enabled: false,
      provider: 'volcengine',
      volcengine: { ...defaultConfig.tts.volcengine, appId: '', accessKey: '' },
    },
    normalized.ttsProfiles.length,
  );
  return normalizeAppConfig({ ...normalized, ttsProfiles: [profile, ...normalized.ttsProfiles] });
}

export function copyTtsProfile(config: AppConfig, id: string): AppConfig {
  const normalized = normalizeAppConfig(config);
  const profiles = normalized.ttsProfiles;
  const index = profiles.findIndex((profile) => profile.id === id);
  if (index < 0) return normalized;
  const copy = normalizeTtsProfileForUi({ ...profiles[index], id: createModelProfileId('tts'), name: `${profiles[index].name || '配音配置'} 副本`, enabled: false }, profiles.length);
  return normalizeAppConfig({ ...normalized, ttsProfiles: [...profiles.slice(0, index + 1), copy, ...profiles.slice(index + 1)] });
}

export function removeTtsProfile(config: AppConfig, id: string): AppConfig {
  const normalized = normalizeAppConfig(config);
  const profiles = normalized.ttsProfiles;
  if (profiles.length <= 1) return normalized;
  const nextProfiles = profiles.filter((profile) => profile.id !== id);
  const activeId = id === normalized.activeTtsProfileId ? nextProfiles[0].id! : normalized.activeTtsProfileId;
  return enableTtsProfile({ ...normalized, ttsProfiles: nextProfiles }, activeId);
}

export function normalizedMusicProfiles(config: AppConfig): MusicProviderProfile[] {
  return normalizeAppConfig(config).music.profiles;
}

export function activeMusicProfileId(config: AppConfig): string {
  return normalizeAppConfig(config).music.activeProfileId;
}

export function getMusicProfile(config: AppConfig, id?: string): MusicProviderProfile {
  const normalized = normalizeAppConfig(config);
  return normalized.music.profiles.find((profile) => profile.id === (id || normalized.music.activeProfileId)) ?? normalized.music.profiles[0];
}

export function enableMusicProfile(config: AppConfig, id: string): AppConfig {
  const normalized = normalizeAppConfig(config);
  if (!normalized.music.profiles.some((profile) => profile.id === id)) return normalized;
  return { ...normalized, music: { ...normalized.music, enabled: true, activeProfileId: id } };
}

export function saveMusicProfile(config: AppConfig, profile: MusicProviderProfile): AppConfig {
  const normalized = normalizeAppConfig(config);
  const nextProfile = normalizeMusicProfile(profile, normalized.music.profiles.length);
  const profiles = normalized.music.profiles.some((item) => item.id === nextProfile.id)
    ? normalized.music.profiles.map((item) => item.id === nextProfile.id ? nextProfile : item)
    : [nextProfile, ...normalized.music.profiles];
  return { ...normalized, music: { ...normalized.music, profiles } };
}

export function addMusicProfile(config: AppConfig): AppConfig {
  return saveMusicProfile(config, {
    ...defaultConfig.music.profiles[0],
    id: createModelProfileId('music'),
    name: '新增音乐配置',
    apiKey: '',
    useEnvironmentKey: false,
  });
}

export function copyMusicProfile(config: AppConfig, id: string): AppConfig {
  const normalized = normalizeAppConfig(config);
  const index = normalized.music.profiles.findIndex((profile) => profile.id === id);
  if (index < 0) return normalized;
  const original = normalized.music.profiles[index];
  const copy = { ...original, id: createModelProfileId('music'), name: `${original.name} 副本`, apiKey: '', useEnvironmentKey: false };
  return { ...normalized, music: { ...normalized.music, profiles: [...normalized.music.profiles.slice(0, index + 1), copy, ...normalized.music.profiles.slice(index + 1)] } };
}

export function removeMusicProfile(config: AppConfig, id: string): AppConfig {
  const normalized = normalizeAppConfig(config);
  if (normalized.music.profiles.length <= 1) return normalized;
  const profiles = normalized.music.profiles.filter((profile) => profile.id !== id);
  return { ...normalized, music: { ...normalized.music, profiles, activeProfileId: normalized.music.activeProfileId === id ? profiles[0].id : normalized.music.activeProfileId } };
}

export function normalizedVideoProfiles(config: AppConfig): VideoProviderConfig[] {
  return normalizeAppConfig(config).video.providers;
}

export function activeVideoProfileId(config: AppConfig): string {
  return normalizeAppConfig(config).video.activeProviderId;
}

export function getVideoProfile(config: AppConfig, id?: string): VideoProviderConfig {
  const normalized = normalizeAppConfig(config);
  return normalized.video.providers.find((profile) => profile.id === (id || normalized.video.activeProviderId)) ?? normalized.video.providers[0];
}

export function enableVideoProfile(config: AppConfig, id: string): AppConfig {
  const normalized = normalizeAppConfig(config);
  if (!normalized.video.providers.some((profile) => profile.id === id)) return normalized;
  return {
    ...normalized,
    video: {
      ...normalized.video,
      activeProviderId: id,
      providers: normalized.video.providers.map((profile) => ({ ...profile, enabled: profile.id === id })),
      automation: { ...normalized.video.automation, providerWhitelist: Array.from(new Set([...normalized.video.automation.providerWhitelist, id])) },
    },
  };
}

export function saveVideoProfile(config: AppConfig, profile: VideoProviderConfig): AppConfig {
  const normalized = normalizeAppConfig(config);
  const nextProfile = normalizeVideoProvider(profile, normalized.video.providers.length);
  const profiles = normalized.video.providers.some((item) => item.id === nextProfile.id)
    ? normalized.video.providers.map((item) => item.id === nextProfile.id ? { ...nextProfile, enabled: item.enabled } : item)
    : [{ ...nextProfile, enabled: false }, ...normalized.video.providers];
  return { ...normalized, video: { ...normalized.video, providers: profiles } };
}

export function addVideoProfile(config: AppConfig): AppConfig {
  return saveVideoProfile(config, { ...defaultConfig.video.providers[0], capabilities: [...defaultConfig.video.providers[0].capabilities], id: createModelProfileId('video'), name: '新增视频配置', apiKey: '', enabled: false });
}

export function copyVideoProfile(config: AppConfig, id: string): AppConfig {
  const normalized = normalizeAppConfig(config);
  const index = normalized.video.providers.findIndex((profile) => profile.id === id);
  if (index < 0) return normalized;
  const original = normalized.video.providers[index];
  const copy = { ...original, capabilities: [...original.capabilities], id: createModelProfileId('video'), name: `${original.name} 副本`, apiKey: '', enabled: false };
  return { ...normalized, video: { ...normalized.video, providers: [...normalized.video.providers.slice(0, index + 1), copy, ...normalized.video.providers.slice(index + 1)] } };
}

export function removeVideoProfile(config: AppConfig, id: string): AppConfig {
  const normalized = normalizeAppConfig(config);
  if (normalized.video.providers.length <= 1) return normalized;
  const providers = normalized.video.providers.filter((profile) => profile.id !== id);
  const activeProviderId = normalized.video.activeProviderId === id ? providers[0].id : normalized.video.activeProviderId;
  const next = normalizeAppConfig({ ...normalized, video: { ...normalized.video, providers, activeProviderId } });
  return normalized.video.activeProviderId === id && normalized.video.providers.some((profile) => profile.id === id && profile.enabled)
    ? enableVideoProfile(next, activeProviderId) : next;
}

export function normalizedSpeechToTextProfiles(config: AppConfig): SpeechToTextProviderProfile[] {
  return normalizeAppConfig(config).speechToTextProfiles;
}

export function activeSpeechToTextProfileId(config: AppConfig): string {
  return normalizeAppConfig(config).activeSpeechToTextProfileId;
}

export function getSpeechToTextProfile(config: AppConfig, id?: string): SpeechToTextProviderProfile {
  const normalized = normalizeAppConfig(config);
  return normalized.speechToTextProfiles.find((profile) => profile.id === (id || normalized.activeSpeechToTextProfileId)) ?? normalized.speechToTextProfiles[0];
}

export function enableSpeechToTextProfile(config: AppConfig, id: string): AppConfig {
  const normalized = normalizeAppConfig(config);
  const active = normalized.speechToTextProfiles.find((profile) => profile.id === id);
  if (!active) return normalized;
  const { id: _id, name: _name, enabled: _enabled, ...speechToText } = active;
  return { ...normalized, speechToText, activeSpeechToTextProfileId: id, speechToTextProfiles: normalized.speechToTextProfiles.map((profile) => ({ ...profile, enabled: profile.id === id })) };
}

export function saveSpeechToTextProfile(config: AppConfig, profile: SpeechToTextProviderProfile): AppConfig {
  const normalized = normalizeAppConfig(config);
  const nextProfile = normalizeSpeechToTextProfile(profile, normalized.speechToTextProfiles.length);
  const speechToTextProfiles = normalized.speechToTextProfiles.some((item) => item.id === nextProfile.id)
    ? normalized.speechToTextProfiles.map((item) => item.id === nextProfile.id ? { ...nextProfile, enabled: item.enabled } : item)
    : [{ ...nextProfile, enabled: false }, ...normalized.speechToTextProfiles];
  const next = { ...normalized, speechToTextProfiles, ...(nextProfile.id === normalized.activeSpeechToTextProfileId ? { speechToText: nextProfile } : {}) };
  return enableSpeechToTextProfile(next, normalized.activeSpeechToTextProfileId);
}

export function addSpeechToTextProfile(config: AppConfig): AppConfig {
  return saveSpeechToTextProfile(config, { ...defaultConfig.speechToTextProfiles[0], id: createModelProfileId('speech-to-text'), name: '新增转写配置', enabled: false, apiKey: '', timestampGranularities: [...defaultConfig.speechToText.timestampGranularities] });
}

export function copySpeechToTextProfile(config: AppConfig, id: string): AppConfig {
  const normalized = normalizeAppConfig(config);
  const index = normalized.speechToTextProfiles.findIndex((profile) => profile.id === id);
  if (index < 0) return normalized;
  const original = normalized.speechToTextProfiles[index];
  const copy = { ...original, id: createModelProfileId('speech-to-text'), name: `${original.name} 副本`, enabled: false, apiKey: '', timestampGranularities: [...original.timestampGranularities] };
  return { ...normalized, speechToTextProfiles: [...normalized.speechToTextProfiles.slice(0, index + 1), copy, ...normalized.speechToTextProfiles.slice(index + 1)] };
}

export function removeSpeechToTextProfile(config: AppConfig, id: string): AppConfig {
  const normalized = normalizeAppConfig(config);
  if (normalized.speechToTextProfiles.length <= 1) return normalized;
  const speechToTextProfiles = normalized.speechToTextProfiles.filter((profile) => profile.id !== id);
  const activeId = normalized.activeSpeechToTextProfileId === id ? speechToTextProfiles[0].id : normalized.activeSpeechToTextProfileId;
  return enableSpeechToTextProfile({ ...normalized, speechToText: speechToTextProfiles.find((profile) => profile.id === activeId)!, speechToTextProfiles, activeSpeechToTextProfileId: activeId }, activeId);
}

export function normalizedVisionProfiles(config: AppConfig): VisionProviderProfile[] {
  return normalizeAppConfig(config).viral.visionProfiles;
}

export function activeVisionProfileId(config: AppConfig): string {
  return normalizeAppConfig(config).viral.activeVisionProfileId;
}

export function getVisionProfile(config: AppConfig, id?: string): VisionProviderProfile {
  const normalized = normalizeAppConfig(config);
  return normalized.viral.visionProfiles.find((profile) => profile.id === (id || normalized.viral.activeVisionProfileId)) ?? normalized.viral.visionProfiles[0];
}

export function enableVisionProfile(config: AppConfig, id: string): AppConfig {
  const normalized = normalizeAppConfig(config);
  const active = normalized.viral.visionProfiles.find((profile) => profile.id === id);
  if (!active) return normalized;
  return { ...normalized, viral: { ...normalized.viral, vision: { ...active, enabled: true }, activeVisionProfileId: id, visionProfiles: normalized.viral.visionProfiles.map((profile) => ({ ...profile, enabled: profile.id === id })) } };
}

export function saveVisionProfile(config: AppConfig, profile: VisionProviderProfile): AppConfig {
  const normalized = normalizeAppConfig(config);
  const nextProfile = normalizeVisionProfile(profile, normalized.viral.visionProfiles.length);
  const visionProfiles = normalized.viral.visionProfiles.some((item) => item.id === nextProfile.id)
    ? normalized.viral.visionProfiles.map((item) => item.id === nextProfile.id ? { ...nextProfile, enabled: item.enabled } : item)
    : [{ ...nextProfile, enabled: false }, ...normalized.viral.visionProfiles];
  const next = { ...normalized, viral: { ...normalized.viral, visionProfiles, ...(nextProfile.id === normalized.viral.activeVisionProfileId ? { vision: nextProfile } : {}) } };
  return enableVisionProfile(next, normalized.viral.activeVisionProfileId);
}

export function addVisionProfile(config: AppConfig): AppConfig {
  return saveVisionProfile(config, { ...defaultConfig.viral.visionProfiles[0], id: createModelProfileId('vision'), name: '新增视觉配置', enabled: false, apiKey: '' });
}

export function copyVisionProfile(config: AppConfig, id: string): AppConfig {
  const normalized = normalizeAppConfig(config);
  const index = normalized.viral.visionProfiles.findIndex((profile) => profile.id === id);
  if (index < 0) return normalized;
  const original = normalized.viral.visionProfiles[index];
  const copy = { ...original, id: createModelProfileId('vision'), name: `${original.name} 副本`, enabled: false, apiKey: '' };
  return { ...normalized, viral: { ...normalized.viral, visionProfiles: [...normalized.viral.visionProfiles.slice(0, index + 1), copy, ...normalized.viral.visionProfiles.slice(index + 1)] } };
}

export function removeVisionProfile(config: AppConfig, id: string): AppConfig {
  const normalized = normalizeAppConfig(config);
  if (normalized.viral.visionProfiles.length <= 1) return normalized;
  const visionProfiles = normalized.viral.visionProfiles.filter((profile) => profile.id !== id);
  const activeId = normalized.viral.activeVisionProfileId === id ? visionProfiles[0].id : normalized.viral.activeVisionProfileId;
  return enableVisionProfile({ ...normalized, viral: { ...normalized.viral, vision: visionProfiles.find((profile) => profile.id === activeId)!, visionProfiles, activeVisionProfileId: activeId } }, activeId);
}

function createLlmProfileId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `llm-${crypto.randomUUID()}`;
  return `llm-${Date.now()}-${Math.round(Math.random() * 10000)}`;
}

function createModelProfileId(prefix: 'image' | 'tts' | 'music' | 'video' | 'speech-to-text' | 'vision'): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 10000)}`;
}
