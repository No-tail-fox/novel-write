import { defaultConfig } from './config';
import { normalizeOpenAiImageBaseUrl, testOpenAiCompatibleImageModel } from './openai-image';
import { isArkModelApiKey, normalizeVolcengineV3Speaker, VOLCENGINE_TTS_ARK_KEY_MESSAGE } from './volcengine-tts';
import type { AppConfig, BgmItem, ConfigTestResult, ConfigTestTarget, ImageProviderProfile, LlmModelTestResult, TtsProviderProfile } from './types';

type TestStatus = ConfigTestResult['status'];
type ConfigValidationOptions = {
  pathExists?: (path: string) => boolean;
  fetchImpl?: typeof fetch;
};

function normalizeLlmProfile(profile: Partial<AppConfig['llm']>, index: number): AppConfig['llm'] {
  const merged = { ...defaultConfig.llm, ...profile };
  const id = profile.id?.trim() || buildLlmProfileId(merged, index);
  return {
    ...merged,
    id,
    name: profile.name?.trim() || defaultLlmProfileName(merged, index),
    enabled: Boolean(profile.enabled),
    timeoutMs: normalizePositiveNumber(merged.timeoutMs, defaultConfig.llm.timeoutMs ?? 120000),
  };
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBgmLibrary(input: unknown): BgmItem[] {
  if (!Array.isArray(input)) return defaultConfig.jianying.bgmLibrary;
  return input
    .map((item, index) => {
      const source = item && typeof item === 'object' ? (item as Partial<BgmItem>) : {};
      const id = String(source.id ?? '').trim() || `bgm-${index + 1}`;
      const path = String(source.path ?? '').trim();
      const title = String(source.title ?? '').trim() || id;
      return {
        id,
        title,
        path,
        durationMs: Math.max(0, Math.round(Number(source.durationMs ?? 0) || 0)),
        volume: normalizeNonNegativeNumber(source.volume, 0.25),
      };
    })
    .filter((item) => item.id !== '__builtin__' && item.path.length > 0);
}

function normalizeNonNegativeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeDefaultBgmId(library: BgmItem[], value: unknown): string {
  const requested = typeof value === 'string' ? value.trim() : '';
  if (requested && library.some((item) => item.id === requested)) return requested;
  return library.find((item) => item.path.trim())?.id ?? '';
}

function buildLlmProfileId(profile: AppConfig['llm'], index: number): string {
  const source = `${profile.provider}-${profile.baseUrl || 'official'}-${profile.model || 'model'}-${index}`;
  const slug = source
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `llm-${slug || index + 1}`;
}

function defaultLlmProfileName(profile: AppConfig['llm'], index: number): string {
  if (profile.provider === 'openai') return 'OpenAI Official';
  if (profile.baseUrl.includes('ai.input.im')) return '第三方';
  return index === 0 ? '默认配置' : `配置 ${index + 1}`;
}

function normalizeImageProvider(provider: unknown): ImageProviderProfile['provider'] {
  return provider === 'custom' || provider === 'jimeng' || provider === 'gpt_image' ? provider : 'gpt_image';
}

function normalizeTtsProvider(provider: unknown): TtsProviderProfile['provider'] {
  return provider === 'minimax' || provider === 'volcengine' ? provider : 'volcengine';
}

function buildConfigProfileId(prefix: string, source: string, index: number): string {
  const slug = source
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${prefix}-${slug || index + 1}`;
}

function normalizeImageProfile(profile: Partial<ImageProviderProfile>, index: number): ImageProviderProfile {
  const provider = normalizeImageProvider(profile.provider);
  const gptImage = { ...defaultConfig.gptImage, ...(profile.gptImage ?? {}) };
  const jimeng = { ...defaultConfig.jimeng, ...(profile.jimeng ?? {}) };
  const customImage = { ...defaultConfig.customImage, ...(profile.customImage ?? {}) };
  const model = provider === 'jimeng' ? jimeng.reqKey || jimeng.model : provider === 'custom' ? customImage.model : gptImage.model;
  const endpoint = provider === 'jimeng' ? jimeng.endpoint : provider === 'custom' ? customImage.baseUrl : gptImage.baseUrl || 'openai';
  const id = profile.id?.trim() || buildConfigProfileId('image', `${provider}-${endpoint}-${model || 'model'}-${index}`, index);
  return {
    id,
    name: profile.name?.trim() || defaultImageProfileName(provider, index),
    enabled: Boolean(profile.enabled),
    provider,
    gptImage,
    jimeng,
    customImage,
  };
}

function defaultImageProfileName(provider: ImageProviderProfile['provider'], index: number): string {
  if (provider === 'gpt_image') return 'GPT Image';
  if (provider === 'jimeng') return '即梦';
  return index === 0 ? '自定义图片' : `图片配置 ${index + 1}`;
}

function imageProfileFromLegacy(partial: Partial<AppConfig>): ImageProviderProfile {
  const provider = normalizeImageProvider(partial.imageProvider ?? defaultConfig.imageProvider);
  const gptImage = { ...defaultConfig.gptImage, ...(partial.gptImage ?? partial.image ?? {}) };
  return normalizeImageProfile(
    {
      id: partial.activeImageProfileId || defaultConfig.activeImageProfileId,
      name: provider === 'gpt_image' ? 'GPT Image' : provider === 'jimeng' ? '即梦' : '自定义图片',
      enabled: true,
      provider,
      gptImage,
      jimeng: { ...defaultConfig.jimeng, ...(partial.jimeng ?? {}) },
      customImage: { ...defaultConfig.customImage, ...(partial.customImage ?? {}) },
    },
    0,
  );
}

function imageProfileHasProviderSettings(profile: ImageProviderProfile): boolean {
  if (profile.provider === 'jimeng') {
    const jimeng = profile.jimeng;
    return Boolean(jimeng?.accessKeyId?.trim() || jimeng?.secretAccessKey?.trim() || jimeng?.reqKey?.trim());
  }
  if (profile.provider === 'custom') {
    const customImage = profile.customImage;
    return Boolean(customImage?.baseUrl?.trim() || customImage?.apiKey?.trim() || customImage?.model?.trim());
  }
  const gptImage = profile.gptImage;
  return Boolean(
    gptImage?.baseUrl?.trim() ||
      gptImage?.apiKey?.trim() ||
      (gptImage?.model?.trim() && gptImage.model !== defaultConfig.gptImage.model),
  );
}

function normalizeImageProfiles(partial: Partial<AppConfig>): {
  imageProvider: ImageProviderProfile['provider'];
  image: AppConfig['image'];
  gptImage: AppConfig['gptImage'];
  jimeng: AppConfig['jimeng'];
  customImage: AppConfig['customImage'];
  imageProfiles: ImageProviderProfile[];
  activeImageProfileId: string;
} {
  const rawProfiles = partial.imageProfiles?.length ? partial.imageProfiles : [imageProfileFromLegacy(partial)];
  const profileMap = new Map<string, ImageProviderProfile>();
  for (const [index, profile] of rawProfiles.entries()) {
    const normalized = normalizeImageProfile(profile, index);
    profileMap.set(normalized.id!, normalized);
  }
  const fallback = imageProfileFromLegacy(partial);
  const existingFallbackProfile = profileMap.get(fallback.id!);
  if (
    existingFallbackProfile &&
    existingFallbackProfile.provider === fallback.provider &&
    (!partial.imageProfiles?.length || !imageProfileHasProviderSettings(existingFallbackProfile))
  ) {
    const existing = existingFallbackProfile;
    profileMap.set(fallback.id!, {
      ...existing,
      ...fallback,
      name: existing.name,
      enabled: existing.enabled || (!partial.imageProfiles?.length && fallback.enabled),
    });
  }
  if (profileMap.size === 0) profileMap.set(fallback.id!, fallback);
  const enabled = Array.from(profileMap.values()).find((profile) => profile.enabled);
  const activeImageProfileId =
    partial.activeImageProfileId && profileMap.has(partial.activeImageProfileId)
      ? partial.activeImageProfileId
      : enabled?.id ?? fallback.id!;
  const active = profileMap.get(activeImageProfileId) ?? profileMap.values().next().value ?? fallback;
  const imageProfiles = Array.from(profileMap.values()).map((profile) => ({ ...profile, enabled: profile.id === active.id }));
  const gptImage = { ...defaultConfig.gptImage, ...(active.gptImage ?? {}) };
  const jimeng = { ...defaultConfig.jimeng, ...(active.jimeng ?? {}) };
  const customImage = { ...defaultConfig.customImage, ...(active.customImage ?? {}) };
  const image = active.provider === 'gpt_image' ? { ...defaultConfig.image, ...gptImage } : { ...defaultConfig.image, ...(partial.image ?? {}) };
  return {
    imageProvider: active.provider,
    image,
    gptImage,
    jimeng,
    customImage,
    imageProfiles,
    activeImageProfileId: active.id!,
  };
}

function normalizeTtsProfile(profile: Partial<TtsProviderProfile>, index: number): TtsProviderProfile {
  const provider = normalizeTtsProvider(profile.provider);
  const rawVolcengine = { ...defaultConfig.tts.volcengine, ...(profile.volcengine ?? {}) };
  const speaker = normalizeVolcengineV3Speaker(profile.speaker ?? rawVolcengine.speaker);
  const volcengine = {
    ...rawVolcengine,
    appId: profile.appId ?? rawVolcengine.appId,
    accessKey: profile.accessKey ?? rawVolcengine.accessKey,
    speaker,
  };
  const minimax = { ...defaultConfig.tts.minimax, ...(profile.minimax ?? {}) };
  const id = profile.id?.trim() || buildConfigProfileId('tts', `${provider}-${provider === 'minimax' ? minimax.model : volcengine.speaker}-${index}`, index);
  return {
    id,
    name: profile.name?.trim() || defaultTtsProfileName(provider, index),
    enabled: Boolean(profile.enabled),
    provider,
    appId: profile.appId ?? volcengine.appId,
    accessKey: profile.accessKey ?? volcengine.accessKey,
    speaker,
    volcengine,
    minimax,
  };
}

function defaultTtsProfileName(provider: TtsProviderProfile['provider'], index: number): string {
  if (provider === 'volcengine') return '火山引擎';
  return index === 0 ? 'MiniMax' : `配音配置 ${index + 1}`;
}

function ttsProfileFromLegacy(partial: Partial<AppConfig>): TtsProviderProfile {
  const tts = {
    ...defaultConfig.tts,
    ...(partial.tts ?? {}),
    volcengine: { ...defaultConfig.tts.volcengine, ...(partial.tts?.volcengine ?? {}) },
    minimax: { ...defaultConfig.tts.minimax, ...(partial.tts?.minimax ?? {}) },
  };
  const provider = normalizeTtsProvider(tts.provider);
  return normalizeTtsProfile(
    {
      id: partial.activeTtsProfileId || defaultConfig.activeTtsProfileId,
      name: provider === 'volcengine' ? '火山引擎' : 'MiniMax',
      enabled: true,
      provider,
      appId: tts.appId,
      accessKey: tts.accessKey,
      speaker: tts.speaker,
      volcengine: tts.volcengine,
      minimax: tts.minimax,
    },
    0,
  );
}

function normalizeTtsProfiles(partial: Partial<AppConfig>): {
  tts: AppConfig['tts'];
  ttsProfiles: TtsProviderProfile[];
  activeTtsProfileId: string;
} {
  const rawProfiles = partial.ttsProfiles?.length ? partial.ttsProfiles : [ttsProfileFromLegacy(partial)];
  const profileMap = new Map<string, TtsProviderProfile>();
  for (const [index, profile] of rawProfiles.entries()) {
    const normalized = normalizeTtsProfile(profile, index);
    profileMap.set(normalized.id!, normalized);
  }
  const fallback = ttsProfileFromLegacy(partial);
  if (!partial.ttsProfiles?.length && profileMap.has(fallback.id!) && profileMap.get(fallback.id!)?.provider === fallback.provider) {
    const existing = profileMap.get(fallback.id!)!;
    profileMap.set(fallback.id!, {
      ...existing,
      ...fallback,
      name: existing.name,
      enabled: existing.enabled || (!partial.ttsProfiles?.length && fallback.enabled),
    });
  }
  if (profileMap.size === 0) profileMap.set(fallback.id!, fallback);
  const enabled = Array.from(profileMap.values()).find((profile) => profile.enabled);
  const activeTtsProfileId =
    partial.activeTtsProfileId && profileMap.has(partial.activeTtsProfileId)
      ? partial.activeTtsProfileId
      : enabled?.id ?? fallback.id!;
  const active = profileMap.get(activeTtsProfileId) ?? profileMap.values().next().value ?? fallback;
  const ttsProfiles = Array.from(profileMap.values()).map((profile) => ({ ...profile, enabled: profile.id === active.id }));
  const volcengine = { ...defaultConfig.tts.volcengine, ...(active.volcengine ?? {}) };
  const minimax = { ...defaultConfig.tts.minimax, ...(active.minimax ?? {}) };
  const tts = {
    ...defaultConfig.tts,
    provider: active.provider,
    appId: active.appId ?? volcengine.appId,
    accessKey: active.accessKey ?? volcengine.accessKey,
    speaker: active.speaker ?? volcengine.speaker,
    volcengine,
    minimax,
  };
  return { tts, ttsProfiles, activeTtsProfileId: active.id! };
}

export function normalizeAppConfig(input: unknown): AppConfig {
  const partial = (input && typeof input === 'object' ? input : {}) as Partial<AppConfig>;
  const llm = normalizeLlmProfile({ ...defaultConfig.llm, ...(partial.llm ?? {}) }, 0);
  const rawProfiles = partial.llmProfiles?.length ? partial.llmProfiles : [];
  const profileMap = new Map<string, AppConfig['llmProfiles'][number]>();
  for (const [index, profile] of rawProfiles.entries()) {
    const normalized = normalizeLlmProfile(profile, index);
    profileMap.set(normalized.id!, normalized);
  }
  if (!profileMap.has(llm.id!)) {
    profileMap.set(llm.id!, llm);
  } else {
    profileMap.set(llm.id!, { ...profileMap.get(llm.id!)!, ...llm });
  }
  const enabledLlm = Array.from(profileMap.values()).find((profile) => profile.enabled);
  const activeLlmProfileId = partial.activeLlmProfileId && profileMap.has(partial.activeLlmProfileId) ? partial.activeLlmProfileId : enabledLlm?.id ?? llm.id!;
  const llmProfiles = Array.from(profileMap.values()).map((profile) => ({ ...profile, enabled: profile.id === activeLlmProfileId }));
  const activeLlm = { ...(llmProfiles.find((profile) => profile.id === activeLlmProfileId) ?? llm), enabled: true };
  const imageConfig = normalizeImageProfiles(partial);
  const ttsConfig = normalizeTtsProfiles(partial);

  const bgmLibrary = normalizeBgmLibrary(partial.jianying?.bgmLibrary);
  const defaultBgmId = normalizeDefaultBgmId(bgmLibrary, partial.jianying?.defaultBgmId);

  return {
    ...defaultConfig,
    ...partial,
    llm: activeLlm,
    llmProfiles,
    activeLlmProfileId,
    ...imageConfig,
    ...ttsConfig,
    jianying: {
      ...defaultConfig.jianying,
      ...(partial.jianying ?? {}),
      bgmLibrary,
      defaultBgmId,
    },
    ima: { ...defaultConfig.ima, ...(partial.ima ?? {}) },
    ui: { ...defaultConfig.ui, ...(partial.ui ?? {}) },
  };
}

export function configTargetStatus(target: ConfigTestTarget, config: AppConfig, options: ConfigValidationOptions = {}): TestStatus {
  return validateConfigTarget(target, config, options).status;
}

export function validateConfigTarget(target: ConfigTestTarget, input: AppConfig, options: ConfigValidationOptions = {}): ConfigTestResult {
  const startedAt = Date.now();
  const config = normalizeAppConfig(input);

  if (target === 'llm') {
    const fieldsReady = Boolean(config.llm.apiKey.trim() && config.llm.model.trim());
    return buildResult({
      target,
      startedAt,
      status: fieldsReady ? 'pass' : 'fail',
      endpoint: `${normalizeBaseUrl(config.llm.baseUrl || 'https://api.openai.com/v1')}/chat/completions`,
      detail: fieldsReady ? `LLM 字段已填写：${config.llm.model}` : 'LLM API Key 和模型不能为空。',
    });
  }

  if (target === 'image') {
    return validateImageConfig(config, startedAt);
  }

  if (target === 'tts') {
    return validateTtsConfig(config, startedAt);
  }

  if (target === 'jianying') {
    const draftPath = config.jianying.draftPath.trim();
    const pathAccessible = options.pathExists ? options.pathExists(draftPath) : true;
    return buildResult({
      target,
      startedAt,
      status: draftPath && pathAccessible ? 'pass' : 'fail',
      endpoint: draftPath,
      detail: draftPath ? (pathAccessible ? `剪映草稿目录可访问：${draftPath}` : `剪映草稿目录不存在或不可访问：${draftPath}`) : '剪映草稿目录不能为空。',
    });
  }

  const hasKnowledgeBase = Boolean(config.ima.kbId.trim() || config.ima.kbName.trim());
  return buildResult({
    target,
    startedAt,
    status: config.ima.apiKey.trim() && hasKnowledgeBase ? 'pass' : 'fail',
    endpoint: config.ima.kbId || config.ima.kbName,
    detail: config.ima.apiKey.trim() && hasKnowledgeBase ? 'IMA 凭证和知识库已填写。' : 'IMA API Key 和 Knowledge Base 不能为空。',
  });
}

export async function testConfigTarget(target: ConfigTestTarget, input: AppConfig, options: ConfigValidationOptions = {}): Promise<ConfigTestResult> {
  const fieldResult = validateConfigTarget(target, input, options);
  if (target !== 'image' || fieldResult.status === 'fail') {
    return fieldResult;
  }

  const config = normalizeAppConfig(input);
  if (config.imageProvider !== 'gpt_image' && config.imageProvider !== 'custom') {
    return fieldResult;
  }

  const image = activeOpenAiImageConfig(config);
  const probe = await testOpenAiCompatibleImageModel({
    baseUrl: image.baseUrl,
    apiKey: image.apiKey,
    model: image.model,
    ratio: image.ratio,
    resolution: image.resolution,
    fetchImpl: options.fetchImpl,
  });

  return {
    target: 'image',
    status: probe.status,
    detail: probe.detail,
    latencyMs: probe.latencyMs,
    endpoint: probe.endpoint,
    requestId: probe.requestId,
  };
}

export function fromLlmModelTestResult(result: LlmModelTestResult): ConfigTestResult {
  return {
    status: result.status,
    detail: result.detail,
    latencyMs: result.latencyMs,
    target: 'llm',
    endpoint: result.endpoint,
    requestId: result.requestId,
  };
}

function validateImageConfig(config: AppConfig, startedAt: number): ConfigTestResult {
  if (config.imageProvider === 'mock') {
    return buildResult({ target: 'image', startedAt, status: 'fail', endpoint: 'mock', detail: '图片供应商是 mock，真实任务不会生成图片。' });
  }

  if (config.imageProvider === 'jimeng') {
    const missing = missingFields([
      ['AccessKey ID', config.jimeng.accessKeyId],
      ['SecretAccessKey', config.jimeng.secretAccessKey],
      ['Req Key', config.jimeng.reqKey],
    ]);
    return buildResult({
      target: 'image',
      startedAt,
      status: missing.length ? 'fail' : 'pass',
      endpoint: config.jimeng.endpoint || 'https://visual.volcengineapi.com',
      detail: missing.length ? `即梦配置缺少：${missing.join('、')}。` : `即梦图片配置已可用于任务：${config.jimeng.reqKey}`,
    });
  }

  if (config.imageProvider === 'custom') {
    const image = activeOpenAiImageConfig(config);
    const missing = missingFields([
      ['Base URL', image.baseUrl],
      ['API Key', image.apiKey],
      ['模型', image.model],
    ]);
    return buildResult({
      target: 'image',
      startedAt,
      status: missing.length ? 'fail' : 'pass',
      endpoint: `${normalizeOpenAiImageBaseUrl(image.baseUrl)}/images/generations`,
      detail: missing.length ? `自定义图片接口缺少：${missing.join('、')}。` : `自定义图片接口字段完整：${image.model}`,
    });
  }

  const image = activeOpenAiImageConfig(config);
  const missing = missingFields([
    ['API Key', image.apiKey],
    ['模型', image.model],
  ]);
  return buildResult({
    target: 'image',
    startedAt,
    status: missing.length ? 'fail' : 'pass',
    endpoint: `${normalizeOpenAiImageBaseUrl(image.baseUrl)}/images/generations`,
    detail: missing.length ? `GPT Image 配置缺少：${missing.join('、')}。` : `GPT Image 配置已可用于任务：${image.model}`,
  });
}

function validateTtsConfig(config: AppConfig, startedAt: number): ConfigTestResult {
  if (config.tts.provider === 'mock') {
    return buildResult({ target: 'tts', startedAt, status: 'fail', endpoint: 'mock', detail: 'TTS 引擎是 mock，真实任务不会生成配音。' });
  }

  if (config.tts.provider === 'minimax') {
    const missing = missingFields([
      ['API Key', config.tts.minimax.apiKey],
      ['模型', config.tts.minimax.model],
      ['音色 ID', config.tts.minimax.voiceId],
    ]);
    return buildResult({
      target: 'tts',
      startedAt,
      status: missing.length ? 'fail' : 'pass',
      endpoint: 'https://api.minimaxi.com/v1/t2a_v2',
      detail: missing.length ? `MiniMax TTS 缺少：${missing.join('、')}。` : `MiniMax TTS 配置已可用于任务：${config.tts.minimax.model}`,
    });
  }

  const volcengineApiKey = config.tts.volcengine.apiKey?.trim() ?? '';
  if (volcengineApiKey) {
    if (isArkModelApiKey(volcengineApiKey)) {
      return buildResult({
        target: 'tts',
        startedAt,
        status: 'fail',
        endpoint: config.tts.volcengine.endpoint || 'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
        detail: VOLCENGINE_TTS_ARK_KEY_MESSAGE,
      });
    }
    const missing = missingFields([
      ['API Key', config.tts.volcengine.apiKey],
      ['Resource ID', config.tts.volcengine.resourceId],
      ['音色 voice_type', config.tts.volcengine.speaker || config.tts.speaker],
    ]);
    return buildResult({
      target: 'tts',
      startedAt,
      status: missing.length ? 'fail' : 'pass',
      endpoint: config.tts.volcengine.endpoint || 'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
      detail: missing.length ? `火山 TTS V3 缺少：${missing.join('、')}。` : `火山 TTS V3 配置已可用于任务：${config.tts.volcengine.resourceId || 'seed-tts-2.0'} · ${config.tts.volcengine.speaker || config.tts.speaker}`,
    });
  }

  const missing = missingFields([
    ['App ID', config.tts.volcengine.appId || config.tts.appId],
    ['Access Token', config.tts.volcengine.accessKey || config.tts.accessKey],
  ]);
  return buildResult({
    target: 'tts',
    startedAt,
    status: missing.length ? 'fail' : 'pass',
    endpoint: config.tts.volcengine.endpoint?.includes('/api/v3/') ? 'https://openspeech.bytedance.com/api/v1/tts' : config.tts.volcengine.endpoint || 'https://openspeech.bytedance.com/api/v1/tts',
    detail: missing.length ? `火山 TTS 缺少：${missing.join('、')}。` : `火山 TTS 配置已可用于任务：${config.tts.volcengine.speaker || config.tts.speaker}`,
  });
}

function buildResult(input: Omit<ConfigTestResult, 'latencyMs' | 'requestId'> & { startedAt: number; requestId?: string | null }): ConfigTestResult {
  return {
    status: input.status,
    detail: input.detail,
    latencyMs: Date.now() - input.startedAt,
    target: input.target,
    endpoint: input.endpoint,
    requestId: input.requestId ?? null,
  };
}

function missingFields(fields: Array<[string, string | null | undefined]>): string[] {
  return fields.filter(([, value]) => !String(value ?? '').trim()).map(([label]) => label);
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed || 'https://api.openai.com'}/v1`;
}

function activeOpenAiImageConfig(config: AppConfig): {
  baseUrl: string;
  apiKey: string;
  model: string;
  ratio: string;
  resolution: '1K' | '2K' | '4K';
} {
  if (config.imageProvider === 'custom') {
    return {
      baseUrl: config.customImage.baseUrl,
      apiKey: config.customImage.apiKey,
      model: config.customImage.model,
      ratio: config.customImage.ratio,
      resolution: config.customImage.resolution ?? '2K',
    };
  }

  return {
    baseUrl: config.gptImage.baseUrl || config.image.baseUrl,
    apiKey: config.gptImage.apiKey || config.image.apiKey,
    model: config.gptImage.model || config.image.model,
    ratio: config.gptImage.ratio || config.image.ratio,
    resolution: config.gptImage.resolution ?? config.image.resolution ?? '2K',
  };
}
