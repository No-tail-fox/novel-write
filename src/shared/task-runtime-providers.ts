import type { RunTaskOptions } from './runner';
import type { SceneAsset } from './draft';
import { AppError } from './app-error';
import type {
  HtmlVideoAssetInput,
  HtmlVideoPlanningInput,
  HtmlVideoRewriteInput,
  HtmlVideoRewriteOutput,
  HtmlVideoRunnerOptions,
  HtmlVideoVoiceInput,
} from './html-video-runner';
import {
  MAX_HTML_VIDEO_CAPTIONS_PER_SCENE,
  MAX_HTML_VIDEO_ELEMENTS_PER_SCENE,
  MAX_HTML_VIDEO_SCENES,
  MAX_HTML_VIDEO_SOURCE_CHARS,
  validateHtmlVideoScenePlans,
} from './html-video-workflow';
import type { AppConfig, HtmlVideoAsset, HtmlVideoJobConfig, HtmlVideoScenePlan, HtmlVideoVoiceClip, ImagePrompt, StoryboardScene, Task } from './types';
import { createConfiguredJsonLlm, type ConfiguredJsonLlm, type LlmMessage } from './llm-provider';
import { createConfiguredImageGenerator, createConfiguredNarrationSynthesizer, getConfiguredImageConcurrency } from './media-providers';

type ImageGenerator = NonNullable<RunTaskOptions['generateImages']>;
type NarrationSynthesizer = NonNullable<RunTaskOptions['synthesizeNarration']>;
type AudioDurationProbe = (path: string, signal?: AbortSignal) => Promise<number>;

export interface HtmlVideoRuntimeProviderOptions {
  measureAudioDuration: AudioDurationProbe;
}

interface HtmlAssetRequest {
  syntheticId: number;
  scene: HtmlVideoScenePlan;
  kind: HtmlVideoAsset['kind'];
  slot: number;
  prompt: string;
}

interface HtmlVoiceRequest {
  syntheticId: number;
  scene: HtmlVideoScenePlan;
}

const htmlRewriteSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['rewrittenText', 'segments'],
  properties: {
    rewrittenText: { type: 'string', minLength: 1, maxLength: MAX_HTML_VIDEO_SOURCE_CHARS },
    segments: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_HTML_VIDEO_SCENES,
      items: { type: 'string', minLength: 1, maxLength: MAX_HTML_VIDEO_SOURCE_CHARS },
    },
  },
};

const htmlPlanningSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['scenes'],
  properties: {
    scenes: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_HTML_VIDEO_SCENES,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'narration', 'title', 'captions', 'sceneTemplate', 'background', 'elements'],
        properties: {
          index: { type: 'integer', minimum: 1 },
          narration: { type: 'string', minLength: 1, maxLength: MAX_HTML_VIDEO_SOURCE_CHARS },
          title: { type: 'string', minLength: 1, maxLength: MAX_HTML_VIDEO_SOURCE_CHARS },
          captions: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_HTML_VIDEO_CAPTIONS_PER_SCENE,
            items: { type: 'string', minLength: 1, maxLength: MAX_HTML_VIDEO_SOURCE_CHARS },
          },
          sceneTemplate: { type: 'string', minLength: 1, maxLength: MAX_HTML_VIDEO_SOURCE_CHARS },
          background: {
            type: 'object',
            additionalProperties: false,
            required: ['prompt'],
            properties: { prompt: { type: 'string', minLength: 1, maxLength: MAX_HTML_VIDEO_SOURCE_CHARS } },
          },
          elements: {
            type: 'array',
            maxItems: MAX_HTML_VIDEO_ELEMENTS_PER_SCENE,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['slot', 'prompt'],
              properties: {
                slot: { type: 'integer', minimum: 0 },
                prompt: { type: 'string', minLength: 1, maxLength: MAX_HTML_VIDEO_SOURCE_CHARS },
              },
            },
          },
        },
      },
    },
  },
};

export function createTaskRuntimeProviders(config: AppConfig, workDir: string, task?: Partial<Pick<Task, 'llmProfileId' | 'ttsProvider'>>): Pick<RunTaskOptions, 'llm' | 'generateImages' | 'imageConcurrency' | 'synthesizeNarration'> {
  const llm = task?.llmProfileId ? config.llmProfiles.find((profile) => profile.id === task.llmProfileId) ?? config.llm : config.llm;
  return {
    llm: hasUsableLlm(llm) ? createConfiguredJsonLlm(llm) : undefined,
    generateImages: hasUsableImageProvider(config) ? createConfiguredImageGenerator(config, workDir) : undefined,
    imageConcurrency: getConfiguredImageConcurrency(config),
    synthesizeNarration: hasUsableTtsProvider(config, task?.ttsProvider) ? createConfiguredNarrationSynthesizer(config, workDir) : undefined,
  };
}

export function createHtmlVideoRuntimeProviders(
  config: AppConfig,
  workDir: string,
  task: Task,
  options: HtmlVideoRuntimeProviderOptions,
): Pick<HtmlVideoRunnerOptions, 'rewrite' | 'plan' | 'generateAssets' | 'synthesizeVoices'> {
  const providers = createTaskRuntimeProviders(config, workDir, task);
  const llmProviders = providers.llm ? createHtmlVideoLlmProviders(providers.llm) : {};

  return {
    rewrite: llmProviders.rewrite,
    plan: llmProviders.plan,
    generateAssets: providers.generateImages
      ? adaptHtmlVideoAssetGenerator(providers.generateImages, task)
      : async () => {
          throw new AppError('IMAGE_PROVIDER_NOT_CONFIGURED', '请先配置图片服务。');
        },
    synthesizeVoices: providers.synthesizeNarration
      ? adaptHtmlVideoNarrationSynthesizer(providers.synthesizeNarration, task, options.measureAudioDuration)
      : async () => {
          throw new AppError('TTS_PROVIDER_NOT_CONFIGURED', '请先配置配音服务。');
        },
  };
}

export function adaptHtmlVideoAssetGenerator(
  generator: ImageGenerator,
  task: Task,
): HtmlVideoRunnerOptions['generateAssets'] {
  return async (input: HtmlVideoAssetInput): Promise<HtmlVideoAsset[]> => {
    const validatedInput = {
      ...input,
      scenes: validateHtmlVideoScenePlans(
        input.scenes,
        input.config.maxScenes ?? MAX_HTML_VIDEO_SCENES,
      ),
    };
    const requests = buildHtmlAssetRequests(validatedInput);
    const runtimeTask = applyHtmlTaskConfig(task, input.config);
    const scenes: StoryboardScene[] = requests.map((request) => ({
      id: request.syntheticId,
      cap: request.scene.narration,
      descPrompt: request.prompt,
      durationMs: 1000,
    }));
    const prompts: ImagePrompt[] = requests.map((request) => ({
      sceneId: request.syntheticId,
      cap: request.scene.title,
      prompt: request.prompt,
      negativePrompt: request.kind === 'fg' ? '复杂背景，文字，水印' : '',
      style: runtimeTask.style,
      ratio: runtimeTask.ratio,
      characterProfile: '',
    }));
    const generated = await generator(scenes, prompts, runtimeTask, input.signal);
    const assetsById = indexProviderAssets(generated, requests.map((request) => request.syntheticId), 'IMAGE_PROVIDER_INVALID_OUTPUT');

    return requests.map((request) => ({
      sceneIndex: request.scene.index,
      kind: request.kind,
      slot: request.slot,
      src: assetsById.get(request.syntheticId)!.path,
      prompt: request.prompt,
    }));
  };
}

export function adaptHtmlVideoNarrationSynthesizer(
  synthesizer: NarrationSynthesizer,
  task: Task,
  measureAudioDuration: AudioDurationProbe,
): HtmlVideoRunnerOptions['synthesizeVoices'] {
  return async (input: HtmlVideoVoiceInput): Promise<HtmlVideoVoiceClip[]> => {
    const validatedScenes = validateHtmlVideoScenePlans(
      input.scenes,
      input.config.maxScenes ?? MAX_HTML_VIDEO_SCENES,
    );
    const requests: HtmlVoiceRequest[] = validatedScenes.map((scene, index) => ({ syntheticId: index + 1, scene }));
    const runtimeTask = applyHtmlVoiceConfig(applyHtmlTaskConfig(task, input.config), input.config);
    const scenes: StoryboardScene[] = requests.map((request) => ({
      id: request.syntheticId,
      cap: request.scene.narration,
      descPrompt: request.scene.background.prompt,
      durationMs: 1000,
    }));
    const generated = await synthesizer(scenes, runtimeTask, input.signal);
    const assetsById = indexProviderAssets(generated, requests.map((request) => request.syntheticId), 'TTS_PROVIDER_INVALID_OUTPUT');

    return Promise.all(requests.map(async (request) => {
      const asset = assetsById.get(request.syntheticId)!;
      const durationSec = await measureAudioDuration(asset.path, input.signal);
      if (!Number.isFinite(durationSec) || durationSec <= 0) {
        throw new AppError('TTS_PROVIDER_INVALID_OUTPUT', `场景 ${request.scene.index} 的配音时长无效。`, true);
      }
      return {
        sceneIndex: request.scene.index,
        src: asset.path,
        durationSec,
        text: asset.text?.trim() || request.scene.narration,
      };
    }));
  };
}

function createHtmlVideoLlmProviders(
  llm: ConfiguredJsonLlm,
): Pick<HtmlVideoRunnerOptions, 'rewrite' | 'plan'> {
  return {
    rewrite: async (input: HtmlVideoRewriteInput) => runHtmlVideoJsonLlm<HtmlVideoRewriteOutput>(
      llm,
      0,
      'html-video-rewrite',
      [
        { role: 'system', content: '将输入改写为适合短视频旁白的文案。只返回 JSON：rewrittenText 为完整文案，segments 为按场景拆分的非空字符串数组。' },
        { role: 'user', content: JSON.stringify({ sourceText: input.sourceText, config: input.config }) },
      ],
      htmlRewriteSchema,
      input.signal,
    ),
    plan: async (input: HtmlVideoPlanningInput) => runHtmlVideoJsonLlm<{ scenes: HtmlVideoScenePlan[] }>(
      llm,
      1,
      'html-video-planning',
      [
        { role: 'system', content: '把旁白规划为 HTML 动画视频场景。只返回 JSON，scenes 必须包含连续 index、narration、title、captions、sceneTemplate、background.prompt 和 elements。前景 elements 的 prompt 应明确透明背景 PNG。' },
        { role: 'user', content: JSON.stringify({ rewrittenText: input.rewrittenText, segments: input.segments, config: input.config }) },
      ],
      htmlPlanningSchema,
      input.signal,
    ),
  };
}

async function runHtmlVideoJsonLlm<T>(
  llm: ConfiguredJsonLlm,
  step: number,
  name: string,
  messages: LlmMessage[],
  schema: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const result = llm.protocol === 'anthropic'
    ? await llm.run<T>({ step, name, messages, signal, anthropic: { toolInputSchema: schema } })
    : await llm.run<T>({ step, name, messages, signal });
  return result.json;
}

function buildHtmlAssetRequests(input: HtmlVideoAssetInput): HtmlAssetRequest[] {
  const requests: HtmlAssetRequest[] = [];
  for (const scene of input.scenes) {
    requests.push({
      syntheticId: requests.length + 1,
      scene,
      kind: 'bg',
      slot: 0,
      prompt: scene.background.prompt,
    });
    if (input.config.foreground !== false) {
      for (const element of scene.elements) {
        requests.push({
          syntheticId: requests.length + 1,
          scene,
          kind: 'fg',
          slot: element.slot,
          prompt: ensureTransparentForegroundPrompt(element.prompt),
        });
      }
    }
  }
  return requests;
}

function ensureTransparentForegroundPrompt(prompt: string): string {
  if (/透明|transparent/iu.test(prompt)) return prompt;
  const suffix = '，透明背景 PNG 前景素材';
  return `${prompt.slice(0, MAX_HTML_VIDEO_SOURCE_CHARS - suffix.length)}${suffix}`;
}

function indexProviderAssets(
  assets: SceneAsset[],
  expectedIds: number[],
  errorCode: 'IMAGE_PROVIDER_INVALID_OUTPUT' | 'TTS_PROVIDER_INVALID_OUTPUT',
): Map<number, SceneAsset> {
  if (!Array.isArray(assets) || assets.length !== expectedIds.length) {
    throw new AppError(errorCode, '媒体服务返回的场景文件数量不匹配。', true);
  }
  const expected = new Set(expectedIds);
  const byId = new Map<number, SceneAsset>();
  for (const asset of assets) {
    if (!expected.has(asset.sceneId) || byId.has(asset.sceneId) || !asset.path.trim()) {
      throw new AppError(errorCode, '媒体服务返回了无法匹配的场景文件。', true);
    }
    byId.set(asset.sceneId, asset);
  }
  if (byId.size !== expected.size) {
    throw new AppError(errorCode, '媒体服务没有返回全部场景文件。', true);
  }
  return byId;
}

function applyHtmlTaskConfig(task: Task, config: HtmlVideoJobConfig): Task {
  return {
    ...task,
    ratio: config.ratio?.trim() || task.ratio,
    style: config.style?.trim() || task.style,
  };
}

function applyHtmlVoiceConfig(task: Task, config: HtmlVideoJobConfig): Task {
  return {
    ...task,
    speaker: config.voiceId?.trim() || task.speaker,
    ttsProvider: resolveTaskTtsProvider(config.ttsProvider, task.ttsProvider),
    ttsSpeed: Number.isFinite(config.ttsSpeed) && Number(config.ttsSpeed) > 0 ? Number(config.ttsSpeed) : task.ttsSpeed,
  };
}

function resolveTaskTtsProvider(value: string | undefined, fallback: Task['ttsProvider']): Task['ttsProvider'] {
  if (value === 'volcengine' || value === 'minimax' || value === 'mock') return value;
  return fallback;
}

function hasUsableLlm(config: AppConfig['llm']): boolean {
  return Boolean(config.apiKey.trim() && config.model.trim());
}

function hasUsableImageProvider(config: AppConfig): boolean {
  if (config.imageProvider === 'mock') return false;
  if (config.imageProvider === 'jimeng') return Boolean(config.jimeng.accessKeyId && config.jimeng.secretAccessKey && config.jimeng.reqKey);
  if (config.imageProvider === 'custom') return Boolean(config.customImage.baseUrl && config.customImage.apiKey && config.customImage.model);
  return Boolean((config.gptImage.apiKey || config.image.apiKey) && (config.gptImage.model || config.image.model));
}

function hasUsableTtsProvider(config: AppConfig, taskProvider?: Task['ttsProvider']): boolean {
  const provider = taskProvider && taskProvider !== 'mock' ? taskProvider : config.tts.provider;
  if (provider === 'mock') return false;
  const profile = config.ttsProfiles.find((item) => item.provider === provider && item.enabled)
    ?? config.ttsProfiles.find((item) => item.provider === provider);
  if (provider === 'minimax') {
    return Boolean(
      (config.tts.minimax.apiKey || profile?.minimax?.apiKey)?.trim()
      && (config.tts.minimax.model || profile?.minimax?.model)?.trim(),
    );
  }
  if ((config.tts.volcengine.apiKey || profile?.volcengine?.apiKey)?.trim()) return true;
  const appId = config.tts.volcengine.appId || profile?.volcengine?.appId || profile?.appId || config.tts.appId;
  const accessKey = config.tts.volcengine.accessKey || profile?.volcengine?.accessKey || profile?.accessKey || config.tts.accessKey;
  return Boolean(appId?.trim() && accessKey?.trim());
}
