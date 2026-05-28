import { defaultConfig } from './config';
import { normalizeOpenAiImageBaseUrl, testOpenAiCompatibleImageModel } from './openai-image';
import type { AppConfig, ConfigTestResult, ConfigTestTarget, LlmModelTestResult } from './types';

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
  };
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
  const activeLlmProfileId = partial.activeLlmProfileId && profileMap.has(partial.activeLlmProfileId) ? partial.activeLlmProfileId : llm.id!;
  const llmProfiles = Array.from(profileMap.values()).map((profile) => ({ ...profile, enabled: profile.id === activeLlmProfileId }));
  const activeLlm = { ...(llmProfiles.find((profile) => profile.id === activeLlmProfileId) ?? llm), enabled: true };
  const imageProvider = partial.imageProvider ?? defaultConfig.imageProvider;
  const gptImage = { ...defaultConfig.gptImage, ...(partial.gptImage ?? partial.image ?? {}) };
  const legacyImage = imageProvider === 'gpt_image' ? { ...defaultConfig.image, ...gptImage } : { ...defaultConfig.image, ...(partial.image ?? {}) };

  return {
    ...defaultConfig,
    ...partial,
    llm: activeLlm,
    llmProfiles,
    activeLlmProfileId,
    imageProvider,
    image: legacyImage,
    gptImage,
    jimeng: { ...defaultConfig.jimeng, ...(partial.jimeng ?? {}) },
    customImage: { ...defaultConfig.customImage, ...(partial.customImage ?? {}) },
    tts: {
      ...defaultConfig.tts,
      ...(partial.tts ?? {}),
      volcengine: { ...defaultConfig.tts.volcengine, ...(partial.tts?.volcengine ?? {}) },
      minimax: { ...defaultConfig.tts.minimax, ...(partial.tts?.minimax ?? {}) },
    },
    jianying: {
      ...defaultConfig.jianying,
      ...(partial.jianying ?? {}),
      bgmLibrary: partial.jianying?.bgmLibrary?.length ? partial.jianying.bgmLibrary : defaultConfig.jianying.bgmLibrary,
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
    return buildResult({
      target,
      startedAt,
      status: config.llm.apiKey.trim() && config.llm.model.trim() ? 'warn' : 'fail',
      endpoint: `${normalizeBaseUrl(config.llm.baseUrl || 'https://api.openai.com/v1')}/chat/completions`,
      detail: config.llm.apiKey.trim() && config.llm.model.trim() ? `LLM 字段已填写，可继续发起真实探针：${config.llm.model}` : 'LLM API Key 和模型不能为空。',
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

  const missing = missingFields([
    ['App ID', config.tts.volcengine.appId || config.tts.appId],
    ['Access Token', config.tts.volcengine.accessKey || config.tts.accessKey],
  ]);
  return buildResult({
    target: 'tts',
    startedAt,
    status: missing.length ? 'fail' : 'pass',
    endpoint: config.tts.volcengine.endpoint || 'https://openspeech.bytedance.com/api/v1/tts',
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
