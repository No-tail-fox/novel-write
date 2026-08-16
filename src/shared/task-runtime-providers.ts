import type { RunTaskOptions } from './runner';
import type { SceneAsset } from './draft';
import { AppError, redactErrorText } from './app-error';
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
import { createHtmlVideoJobConfig } from './html-video-config';
import { createHtmlVideoCoverAsset, type HtmlVideoCoverImageProcessor } from './html-video-cover';
import { resolveVolcengineTtsApiVersion } from './volcengine-tts';
import { HTML_VIDEO_SCENE_TEMPLATES } from './html-video-scene-templates';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppConfig, CustomStyle, HtmlVideoAsset, HtmlVideoJobConfig, HtmlVideoScenePlan, HtmlVideoVoiceClip, ImagePrompt, StoryboardScene, Task } from './types';
import { createConfiguredJsonLlm, type ConfiguredJsonLlm, type LlmMessage } from './llm-provider';
import { createConfiguredImageGenerator, createConfiguredNarrationSynthesizer, getConfiguredImageConcurrency } from './media-providers';
import { createConfiguredVideoProvider, selectVideoGenerationRoute, type VideoProvider } from './video-provider';

type ImageGenerator = NonNullable<RunTaskOptions['generateImages']>;
type NarrationSynthesizer = NonNullable<RunTaskOptions['synthesizeNarration']>;
type AudioDurationProbe = (path: string, signal?: AbortSignal) => Promise<number>;

export interface HtmlVideoRuntimeProviderOptions {
  measureAudioDuration: AudioDurationProbe;
  jobConfig: HtmlVideoJobConfig;
  imageStyle?: CustomStyle | null;
  inspectAssetTransparency?: (path: string) => Promise<boolean>;
  prepareCoverImage?: HtmlVideoCoverImageProcessor;
}

interface HtmlAssetRequest {
  syntheticId: number;
  scene: HtmlVideoScenePlan;
  kind: HtmlVideoAsset['kind'];
  slot: number;
  prompt: string;
}

interface HtmlVideoAssetGeneratorOptions {
  imageStyle?: CustomStyle | null;
  inspectAssetTransparency?: (path: string) => Promise<boolean>;
  imageConcurrency?: number;
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
          sceneTemplate: {
            type: 'string',
            minLength: 1,
            maxLength: MAX_HTML_VIDEO_SOURCE_CHARS,
            enum: HTML_VIDEO_SCENE_TEMPLATES.map((template) => template.id),
          },
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

export interface TaskRuntimeProviders extends Pick<RunTaskOptions, 'llm' | 'generateImages' | 'imageConcurrency' | 'synthesizeNarration'> {
  videoProvider?: VideoProvider;
}

export function createTaskRuntimeProviders(
  config: AppConfig,
  workDir: string,
  task?: Partial<Pick<Task, 'llmProfileId' | 'ttsProvider' | 'imageQuality'>>,
): TaskRuntimeProviders {
  const llm = task?.llmProfileId ? config.llmProfiles.find((profile) => profile.id === task.llmProfileId) ?? config.llm : config.llm;
  const videoRoute = selectVideoGenerationRoute(config, { durationSec: 1, requiredCapabilities: ['t2v'], remainingBudget: Number.POSITIVE_INFINITY });
  return {
    llm: hasUsableLlm(llm) ? createConfiguredJsonLlm(llm) : undefined,
    generateImages: hasUsableImageProvider(config) ? createConfiguredImageGenerator(config, workDir) : undefined,
    imageConcurrency: getConfiguredImageConcurrency(config),
    synthesizeNarration: hasUsableTtsProvider(config, task?.ttsProvider) ? createConfiguredNarrationSynthesizer(config, workDir) : undefined,
    videoProvider: videoRoute.kind === 'provider' ? createConfiguredVideoProvider(config, workDir) : undefined,
  };
}

export function createHtmlVideoRuntimeProviders(
  config: AppConfig,
  workDir: string,
  task: Task,
  options: HtmlVideoRuntimeProviderOptions,
): Pick<HtmlVideoRunnerOptions, 'rewrite' | 'plan' | 'generateAssets' | 'synthesizeVoices' | 'generateCover'> {
  const resolvedJobConfig = createHtmlVideoJobConfig(options.jobConfig);
  const runtimeTask = applyHtmlVoiceConfig(applyHtmlTaskConfig(task, resolvedJobConfig), resolvedJobConfig);
  const providers = createTaskRuntimeProviders(config, workDir, runtimeTask);
  const llmProviders = providers.llm ? createHtmlVideoLlmProviders(providers.llm) : {};

  return {
    rewrite: llmProviders.rewrite,
    plan: llmProviders.plan,
    generateAssets: providers.generateImages
        ? adaptHtmlVideoAssetGenerator(providers.generateImages, runtimeTask, {
          imageStyle: options.imageStyle,
          inspectAssetTransparency: options.inspectAssetTransparency,
          imageConcurrency: providers.imageConcurrency,
        })
      : async () => {
          throw new AppError('IMAGE_PROVIDER_NOT_CONFIGURED', '请先配置图片服务。');
        },
    generateCover: providers.generateImages && options.prepareCoverImage
      ? adaptHtmlVideoCoverGenerator(providers.generateImages, runtimeTask, workDir, options.prepareCoverImage)
      : async () => {
          throw new AppError('IMAGE_PROVIDER_NOT_CONFIGURED', '请先配置可用的封面图片服务。');
        },
    synthesizeVoices: providers.synthesizeNarration
      ? adaptHtmlVideoNarrationSynthesizer(providers.synthesizeNarration, runtimeTask, options.measureAudioDuration)
      : async () => {
          throw new AppError('TTS_PROVIDER_NOT_CONFIGURED', '请先配置配音服务。');
        },
  };
}

export function adaptHtmlVideoCoverGenerator(
  generator: ImageGenerator,
  task: Task,
  workDir: string,
  prepareCoverImage: HtmlVideoCoverImageProcessor,
): NonNullable<HtmlVideoRunnerOptions['generateCover']> {
  return async (input) => {
    const runtimeTask = {
      ...applyHtmlTaskConfig(task, input.config),
      ratio: input.ratio,
    };
    const scene: StoryboardScene = {
      id: 0,
      cap: input.taskTitle,
      descPrompt: input.prompt,
      durationMs: 1000,
    };
    const prompt: ImagePrompt = {
      sceneId: 0,
      cap: input.taskTitle,
      prompt: input.prompt,
      negativePrompt: 'low quality, blurry, watermark, account name, QR code, platform UI, malformed text',
      style: runtimeTask.style,
      ratio: input.ratio,
      characterProfile: '',
    };
    const generated = await generator([scene], [prompt], runtimeTask, input.signal);
    const source = indexProviderAssets(generated, [0], 'IMAGE_PROVIDER_INVALID_OUTPUT').get(0);
    if (!source?.path) {
      throw new AppError('IMAGE_PROVIDER_INVALID_OUTPUT', '封面图片服务没有返回有效图片。', true);
    }
    const relativePath = `covers/cover-auto-r${input.revision}.png`;
    const coverDirectory = join(workDir, 'covers');
    await mkdir(coverDirectory, { recursive: true });
    const prepared = await prepareCoverImage({
      sourcePath: source.path,
      destinationPath: join(workDir, relativePath),
      dimensions: input.dimensions,
      signal: input.signal,
    });
    return createHtmlVideoCoverAsset({
      revision: input.revision,
      mode: 'auto',
      path: relativePath,
      ...prepared,
      ratio: input.ratio,
      templateId: input.template.id,
      createdAt: new Date().toISOString(),
    });
  };
}

export function adaptHtmlVideoAssetGenerator(
  generator: ImageGenerator,
  task: Task,
  options: HtmlVideoAssetGeneratorOptions = {},
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
    const assets = new Array<HtmlVideoAsset>(requests.length);
    await runHtmlAssetRequestsWithConcurrency(requests, options.imageConcurrency ?? 1, async (request, index) => {
      const ratio = request.kind === 'bg' ? runtimeTask.ratio : '1:1';
      let generated: SceneAsset[];
      try {
        generated = await generateHtmlAssetBatch(
          generator,
          [request],
          request.kind === 'bg' ? runtimeTask : { ...runtimeTask, ratio },
          ratio,
          options.imageStyle,
          input.signal,
        );
      } catch (error) {
        throw asHtmlVideoImageProviderError(error);
      }
      const src = indexProviderAssets(
        generated,
        [request.syntheticId],
        'IMAGE_PROVIDER_INVALID_OUTPUT',
      ).get(request.syntheticId)!.path;
      let transparency: HtmlVideoAsset['transparency'];
      if (request.kind === 'fg' && options.inspectAssetTransparency) {
        transparency = await options.inspectAssetTransparency(src) ? 'transparent' : 'opaque';
      }
      const asset: HtmlVideoAsset = {
        sceneIndex: request.scene.index,
        kind: request.kind,
        slot: request.slot,
        src,
        prompt: request.prompt,
        ...(transparency ? { transparency } : {}),
      };
      assets[index] = asset;
      await input.onAssetGenerated?.(asset);
    });
    return assets;
  };
}

async function runHtmlAssetRequestsWithConcurrency(
  requests: HtmlAssetRequest[],
  concurrency: number,
  worker: (request: HtmlAssetRequest, index: number) => Promise<void>,
): Promise<void> {
  const limit = Math.max(1, Math.min(requests.length || 1, Math.floor(Number.isFinite(concurrency) ? concurrency : 1)));
  let cursor = 0;
  let firstError: unknown = null;

  async function runWorker(): Promise<void> {
    while (!firstError) {
      const index = cursor;
      cursor += 1;
      if (index >= requests.length) return;
      try {
        await worker(requests[index], index);
      } catch (error) {
        firstError ??= error;
        return;
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, runWorker));
  if (firstError) throw firstError;
}

async function generateHtmlAssetBatch(
  generator: ImageGenerator,
  requests: HtmlAssetRequest[],
  runtimeTask: Task,
  ratio: string,
  imageStyle: CustomStyle | null | undefined,
  signal?: AbortSignal,
): Promise<SceneAsset[]> {
  if (requests.length === 0) return [];
  const scenes: StoryboardScene[] = requests.map((request) => ({
    id: request.syntheticId,
    cap: request.scene.narration,
    descPrompt: buildHtmlAssetProviderPrompt(request, imageStyle),
    durationMs: 1000,
  }));
  const prompts: ImagePrompt[] = requests.map((request) => ({
    sceneId: request.syntheticId,
    cap: request.scene.title,
    prompt: buildHtmlAssetProviderPrompt(request, imageStyle),
    negativePrompt: mergeHtmlNegativePrompts(
      imageStyle?.negativePrompt,
      request.kind === 'fg' ? '复杂背景，纯色背景，不透明背景，文字，水印' : '',
    ),
    style: runtimeTask.style,
    ratio,
    characterProfile: '',
  }));
  const generated = await generator(scenes, prompts, runtimeTask, signal);
  indexProviderAssets(
    generated,
    requests.map((request) => request.syntheticId),
    'IMAGE_PROVIDER_INVALID_OUTPUT',
  );
  return generated;
}

function buildHtmlAssetProviderPrompt(request: HtmlAssetRequest, imageStyle: CustomStyle | null | undefined): string {
  return request.kind === 'bg'
    ? joinBoundedHtmlPrompt(imageStyle?.prefix, request.prompt, imageStyle?.suffix)
    : joinBoundedHtmlPrompt(imageStyle?.prefix, request.prompt, '纯透明背景 PNG，主体居中，无背景');
}

function joinBoundedHtmlPrompt(prefix: string | undefined, content: string, suffix: string | undefined): string {
  const head = [prefix?.trim(), content.trim()].filter(Boolean).join('，');
  const tail = suffix?.trim() ? `，${suffix.trim()}` : '';
  return `${head.slice(0, Math.max(0, MAX_HTML_VIDEO_SOURCE_CHARS - tail.length))}${tail}`
    .slice(0, MAX_HTML_VIDEO_SOURCE_CHARS);
}

function mergeHtmlNegativePrompts(...parts: Array<string | undefined>): string {
  return parts.map((part) => part?.trim()).filter(Boolean).join('，');
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
      ['rewrittenText', 'segments'],
    ),
    plan: async (input: HtmlVideoPlanningInput) => {
      const result = await runHtmlVideoJsonLlm<{ scenes: HtmlVideoScenePlan[] }>(
        llm,
        1,
        'html-video-planning',
        [
          { role: 'system', content: buildHtmlVideoPlanningSystemPrompt(input.config) },
          { role: 'user', content: JSON.stringify({ rewrittenText: input.rewrittenText, segments: input.segments, config: input.config }) },
        ],
        htmlPlanningSchema,
        input.signal,
        ['scenes'],
      );
      try {
        return {
          scenes: validateHtmlVideoPlanningContract(validateHtmlVideoScenePlans(
            repairHtmlVideoPlanningSlots(result.scenes, input.config.foreground !== false),
            input.config.maxScenes ?? MAX_HTML_VIDEO_SCENES,
          ), input.config.foreground !== false),
        };
      } catch (error) {
        throw htmlVideoPlanningValidationError(error);
      }
    },
  };
}

export function repairHtmlVideoPlanningSlots(
  scenes: HtmlVideoScenePlan[],
  foreground: boolean,
): HtmlVideoScenePlan[] {
  return scenes.map((scene) => {
    if (!Array.isArray(scene?.elements)) return scene;
    const elements = foreground ? scene.elements : [];
    const currentTemplate = HTML_VIDEO_SCENE_TEMPLATES.find((template) => template.id === scene.sceneTemplate);
    const template = currentTemplate?.materialSlots === elements.length
      ? currentTemplate
      : HTML_VIDEO_SCENE_TEMPLATES.find((candidate) => candidate.materialSlots === elements.length);
    return {
      ...scene,
      sceneTemplate: template?.id ?? scene.sceneTemplate,
      elements: elements.map((element, slot) => ({ ...element, slot })),
    };
  });
}

export function buildHtmlVideoPlanningSystemPrompt(config: HtmlVideoPlanningInput['config']): string {
  const orientation = config.ratio === '16:9' ? '横屏' : '竖屏';
  const foreground = config.foreground !== false;
  const templates = HTML_VIDEO_SCENE_TEMPLATES
    .filter((template) => foreground || template.materialSlots === 0)
    .map((template) => {
      const slots = template.materialSlots === 0
        ? '无素材槽'
        : `${template.materialSlots} 个素材槽（slot ${Array.from({ length: template.materialSlots }, (_, slot) => slot).join('/')}）`;
      return `- "${template.id}"（${template.label}）：${template.description}【${slots}】`;
    })
    .join('\n');
  const elementRule = foreground
    ? '- elements：严格按所选版式的素材槽输出。N 个槽就完整输出 slot 0 到 N-1，每项只写一个独立人物、物件或动作主体；无素材槽版式必须输出 []。'
    : '- elements：本次不使用前景素材，只能选择无素材槽版式，所有场景必须输出 []。';

  return [
    '你是短视频分镜策划。你的唯一任务是把输入旁白拆成可直接生成的 HTML 动画短视频场景，并且只输出 JSON。',
    '一个场景只对应一个清晰的画面单元，用来承载一句关键话、一次转折、一个事实或一句金句；不要把多个互不相关的画面意图塞进同一场景。',
    '',
    `【画面方向】${orientation}`,
    '【可用版式】每个场景必须按内容气质和信息关系选择一个，避免全片使用同一种版式：',
    templates,
    '选择原则：金句、结论和强观点优先文字主导版式；人物或单一物件优先单主体版式；对照、对话和前后变化优先双素材版式；步骤、群像、系统关系再使用三到四素材版式。版式必须服务当前旁白语义，不能只按素材槽数量随意选择。',
    '',
    '【每个场景字段】',
    '- index：从 1 连续递增。',
    '- narration：严格使用输入 segments 中对应的旁白，不改写、不增删。',
    '- sceneTemplate：只能填写上面列出的版式 id。',
    '- title：4-10 字的画面大标题，不要引号或书名号。',
    '- captions：只能沿用 narration 的原文和原标点切成短句，不改写、不概括、不调序、不增删任何字或标点；所有 captions 按顺序直接拼接后必须与 narration 逐字完全一致。',
    `- background：{ "prompt": "背景图的中文绘图提示词" }，只描述${orientation}环境、氛围、空间层次和旁白情绪；不要写屏幕文字，不要把前景主体重复画成背景主角。`,
    elementRule,
    '',
    '【提示词硬约束】',
    '1. background.prompt 和 elements[].prompt 只写画面内容，不写写实、卡通、3D、油画、水墨、胶片等风格词，风格由生成阶段统一注入。',
    '2. elements[].prompt 不写“透明背景”“无背景”“PNG”等生成说明，生成阶段会自动追加。',
    '3. 所有画面提示词都不要包含字幕、标题、标语、水印、Logo 或界面文字。',
    '4. elements 中每项是互不重复的单一主体，优先 10-20 个中文字，只描述人物、物件或动作及必要视觉特征；不要复述完整背景。',
    '5. 同一人物或关键物件跨场景出现时，身份、外形和核心特征保持一致；主体的动作、朝向和构图位置应适配所选版式。',
    '6. 输出前在内部逐场景核对：旁白与字幕逐字一致；版式符合语义；elements 数量与 slot 连续性完全匹配版式；背景与前景没有重复抢主体；相邻场景版式不过度重复。不要输出核对过程。',
    '7. 回复第一个字符必须是 {，最后一个字符必须是 }；只输出 JSON，不要前言、解释、Markdown 代码块、JSON Schema 或错误对象。',
    '',
    '格式：{"scenes":[{"index":1,"narration":"...","title":"...","captions":["..."],"sceneTemplate":"center-focus","background":{"prompt":"..."},"elements":[{"slot":0,"prompt":"..."}]}]}',
  ].join('\n');
}

function validateHtmlVideoPlanningContract(
  scenes: HtmlVideoScenePlan[],
  foreground: boolean,
): HtmlVideoScenePlan[] {
  for (const scene of scenes) {
    const template = HTML_VIDEO_SCENE_TEMPLATES.find((candidate) => candidate.id === scene.sceneTemplate);
    if (!template) {
      throw new Error(`scene ${scene.index} uses unsupported sceneTemplate ${scene.sceneTemplate}`);
    }
    const expectedCount = foreground ? template.materialSlots : 0;
    const expectedSlots = Array.from({ length: expectedCount }, (_, slot) => slot);
    const actualSlots = scene.elements.map((element) => element.slot).sort((left, right) => left - right);
    if (actualSlots.length !== expectedSlots.length || actualSlots.some((slot, index) => slot !== expectedSlots[index])) {
      throw new Error(`scene ${scene.index} elements must match ${template.id} slots [${expectedSlots.join(', ')}]`);
    }
  }
  return scenes;
}

function htmlVideoPlanningValidationError(error: unknown): AppError {
  const rawDetail = redactErrorText(error instanceof Error ? error.message : String(error))
    .replace(/^HTML video pipeline\s*/iu, '')
    .replace(/[。.]+$/u, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 360);
  const detail = rawDetail ? `：${rawDetail}` : '';
  return new AppError(
    'HTML_VIDEO_LLM_INVALID_JSON',
    `场景规划返回的场景结构不符合要求${detail}。`,
    true,
  );
}

async function runHtmlVideoJsonLlm<T>(
  llm: ConfiguredJsonLlm,
  step: number,
  name: string,
  messages: LlmMessage[],
  schema: Record<string, unknown>,
  signal?: AbortSignal,
  requiredFields: readonly string[] = [],
): Promise<T> {
  const run = async (jsonMode: 'required' | 'none'): Promise<T> => {
    const result = llm.protocol === 'anthropic'
      ? await llm.run<T>({ step, name, messages, signal, jsonMode, anthropic: { toolInputSchema: schema } })
      : await llm.run<T>({ step, name, messages, signal, jsonMode });
    return requireHtmlVideoLlmFields(result.json, requiredFields, name);
  };

  try {
    return await run('required');
  } catch (error) {
    if (!isHtmlVideoJsonCompatibilityError(error)) throw asHtmlVideoLlmError(name, error);
    try {
      return await run('none');
    } catch (fallbackError) {
      throw asHtmlVideoLlmError(name, fallbackError);
    }
  }
}

function requireHtmlVideoLlmFields<T>(value: T, requiredFields: readonly string[], name: string): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('HTML_VIDEO_LLM_INVALID_JSON', `${htmlVideoLlmStageLabel(name)}返回的 JSON 根节点不是对象。`, true);
  }
  const record = value as Record<string, unknown>;
  const providerError = typeof record.error === 'string' ? record.error.trim() : '';
  if (providerError) {
    throw new AppError(
      'HTML_VIDEO_LLM_SCHEMA_CONFLICT',
      `${htmlVideoLlmStageLabel(name)}返回了格式错误：${redactErrorText(providerError).slice(0, 360)}`,
      true,
    );
  }
  const missing = requiredFields.filter((field) => !(field in record));
  if (missing.length) {
    throw new AppError('HTML_VIDEO_LLM_INVALID_JSON', `${htmlVideoLlmStageLabel(name)}缺少字段：${missing.join('、')}。`, true);
  }
  return value;
}

function isHtmlVideoJsonCompatibilityError(error: unknown): boolean {
  if (error instanceof AppError && /HTML_VIDEO_LLM_(?:SCHEMA_CONFLICT|INVALID_JSON)/u.test(error.code)) return true;
  const message = redactErrorText(error instanceof Error ? error.message : String(error));
  return /(?:strict\s+json|json\s+schema|schema\s+conflict|response_format|structured\s+output|valid\s+json|planning\s+step\s+failed)/iu.test(message);
}

function asHtmlVideoLlmError(name: string, error: unknown): AppError {
  if (error instanceof AppError) return error;
  const detail = redactErrorText(error instanceof Error ? error.message : String(error)).replace(/\s+/gu, ' ').slice(0, 480);
  return new AppError(
    'HTML_VIDEO_LLM_OUTPUT_INVALID',
    `${htmlVideoLlmStageLabel(name)}失败：${detail || '服务没有返回可用的 JSON。'}`,
    true,
  );
}

function asHtmlVideoImageProviderError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const detail = redactErrorText(error instanceof Error ? error.message : String(error))
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 600);
  const timedOut = /^Image provider (?:request|edit request|async submit|async poll) timed out after \d+ms\.?$/iu.test(detail);
  return new AppError(
    timedOut ? 'IMAGE_PROVIDER_TIMEOUT' : 'IMAGE_PROVIDER_FAILED',
    detail || '图片服务没有返回可用素材。',
    timedOut || !/\b40[123]\b|余额不足|套餐额度/iu.test(detail),
  );
}

function htmlVideoLlmStageLabel(name: string): string {
  return name === 'html-video-planning' ? '场景规划' : '文案改写';
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
          prompt: element.prompt,
        });
      }
    }
  }
  return requests;
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
  const resolved = createHtmlVideoJobConfig(config);
  return {
    ...task,
    ratio: resolved.ratio,
    style: resolved.style,
  };
}

function applyHtmlVoiceConfig(task: Task, config: HtmlVideoJobConfig): Task {
  const resolved = createHtmlVideoJobConfig(config);
  return {
    ...task,
    speaker: resolved.voiceId,
    ttsProvider: resolved.ttsProvider,
    ttsSpeed: resolved.ttsSpeed,
  };
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
  const volcengine = profile?.volcengine ?? config.tts.volcengine;
  if (resolveVolcengineTtsApiVersion(volcengine) === 'v3') {
    return Boolean((volcengine.apiKey || config.tts.volcengine.apiKey)?.trim());
  }
  const appId = volcengine.appId || profile?.appId || config.tts.volcengine.appId || config.tts.appId;
  const accessKey = volcengine.accessKey || profile?.accessKey || config.tts.volcengine.accessKey || config.tts.accessKey;
  return Boolean(appId?.trim() && accessKey?.trim());
}
