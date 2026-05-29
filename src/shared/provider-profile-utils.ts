import { defaultConfig } from './config';
import { normalizeAppConfig } from './config-utils';
import type { AppConfig, ConfigTestTarget, ImageProviderProfile, TtsProviderProfile } from './types';

export type EditableLlmProvider = 'openai' | 'custom';
export type ImageResolution = '1K' | '2K' | '4K';

export type SelectedProviderProfileIds = {
  llm?: string;
  image?: string;
  tts?: string;
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
  return normalized;
}

export function activeLlmProfileId(config: AppConfig): string {
  return config.activeLlmProfileId || config.llm.id || config.llmProfiles[0]?.id || 'default-llm';
}

export function editableLlmProfileProvider(profile: AppConfig['llm']): EditableLlmProvider {
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
  return {
    ...merged,
    id,
    name: profile.name?.trim() || (merged.provider === 'openai' ? 'OpenAI Official' : index === 0 ? '第三方' : `配置 ${index + 1}`),
    provider: editableLlmProfileProvider(merged),
    protocol: 'openai',
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
  const merged = { ...defaultConfig.tts.volcengine, ...(profile.volcengine ?? {}) };
  return {
    ...merged,
    appId: profile.appId ?? merged.appId,
    accessKey: profile.accessKey ?? merged.accessKey,
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
    appId: profile.appId ?? volcengine.appId,
    accessKey: profile.accessKey ?? volcengine.accessKey,
    speaker: profile.speaker ?? volcengine.speaker,
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

function createLlmProfileId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `llm-${crypto.randomUUID()}`;
  return `llm-${Date.now()}-${Math.round(Math.random() * 10000)}`;
}

function createModelProfileId(prefix: 'image' | 'tts'): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 10000)}`;
}
