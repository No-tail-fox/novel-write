import { z } from 'zod';
import type { AppConfig, ImageLabImportInput } from './types';
import { draftTemplateSchema } from './draft-template-contract';
import { isSecretId, type SaveConfigInput } from './config-secrets';
import {
  HTML_VIDEO_BGM_VOLUMES,
  HTML_VIDEO_RATIOS,
  HTML_VIDEO_TTS_PROVIDERS,
  HTML_VIDEO_TTS_SPEED_MAX,
  HTML_VIDEO_TTS_SPEED_MIN,
  HTML_VIDEO_TRANSITIONS,
} from './html-video-config';
import { HTML_VIDEO_COVER_MODES, HTML_VIDEO_COVER_RATIOS } from './html-video-cover';
import {
  HTML_VIDEO_CAPTION_ANIMATIONS,
  HTML_VIDEO_CAPTION_PRESETS,
  validateHtmlVideoCaptionColors,
} from './html-video-captions';
import {
  MAX_HTML_VIDEO_SCENES,
  MAX_HTML_VIDEO_SOURCE_CHARS,
  parseHtmlVideoPipelineData,
} from './html-video-workflow';
import { HTML_VIDEO_EDITABLE_CONTROL_FIELDS } from './html-video-control-manifest';
import { INVOKE_CHANNELS, type InvokeChannel } from './storydream-api';
import { ORDINARY_TASK_COVER_RATIOS } from './ordinary-task-cover';
import { MAX_HYPERFRAMES_SOURCE_BYTES } from './hyperframes';

export const MAX_TASK_TEXT = 1_000_000;
export const MAX_IPC_TEXT = 65_536;
export const MAX_IPC_ARRAY_ITEMS = 500;
export const MAX_IPC_OBJECT_KEYS = 256;
export const MAX_IPC_DEPTH = 12;
export const MAX_IPC_PATH = 4096;
export { MAX_HYPERFRAMES_SOURCE_BYTES } from './hyperframes';

const nonEmptyText = (max = MAX_IPC_TEXT) => z.string().max(max).refine((value) => value.trim().length > 0, 'Value is required.');
const optionalText = (max = MAX_IPC_TEXT) => z.string().max(max).optional();
const nullableText = (max = MAX_IPC_TEXT) => z.string().max(max).nullable().optional();
const idSchema = nonEmptyText(256);
const minimaxCloneVoiceIdSchema = z
  .string()
  .max(256)
  .regex(/^[A-Za-z0-9._:-]+$/u, 'Invalid MiniMax voice id.');
const governanceIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,256}$/u, 'Invalid governance id.')
  .refine(
    (value) => !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(value),
    'Reserved device names are not allowed.',
  );
const secretIdSchema = z.string().max(1024).refine(isSecretId, 'Invalid secret id.');
const finiteNumber = z.number().finite();
const nonNegativeInteger = z.number().finite().int().nonnegative();
const stringArray = (maxLength = MAX_IPC_ARRAY_ITEMS, itemLength = MAX_IPC_TEXT) => z.array(z.string().max(itemLength)).max(maxLength);

function addBoundedIssue(ctx: z.core.$RefinementCtx<unknown>, message: string, path: PropertyKey[]): void {
  ctx.addIssue({ code: 'custom', message, path });
}

function inspectBoundedValue(value: unknown, ctx: z.core.$RefinementCtx<unknown>, depth = 0, path: PropertyKey[] = []): void {
  if (depth > MAX_IPC_DEPTH) {
    addBoundedIssue(ctx, 'IPC value exceeds maximum nesting depth.', path);
    return;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_TASK_TEXT) addBoundedIssue(ctx, 'IPC string exceeds maximum length.', path);
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) addBoundedIssue(ctx, 'IPC numbers must be finite.', path);
    return;
  }
  if (value === null || value === undefined || typeof value === 'boolean') return;
  if (Array.isArray(value)) {
    if (value.length > MAX_IPC_ARRAY_ITEMS) {
      addBoundedIssue(ctx, 'IPC array exceeds maximum length.', path);
      return;
    }
    value.forEach((item, index) => inspectBoundedValue(item, ctx, depth + 1, [...path, index]));
    return;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > MAX_IPC_OBJECT_KEYS) {
      addBoundedIssue(ctx, 'IPC object has too many keys.', path);
      return;
    }
    for (const [key, item] of entries) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) {
        addBoundedIssue(ctx, 'IPC object contains a forbidden key.', [...path, key]);
        continue;
      }
      inspectBoundedValue(item, ctx, depth + 1, [...path, key]);
    }
    return;
  }
  addBoundedIssue(ctx, 'IPC value is not serializable.', path);
}

function bounded<T extends z.ZodType>(schema: T): T {
  return schema.superRefine((value, ctx) => inspectBoundedValue(value, ctx)) as T;
}

const boundedObjectSchema = bounded(z.object({}).passthrough());

export const pathSchema = z
  .string()
  .min(1)
  .max(MAX_IPC_PATH)
  .refine((value) => !value.includes('\0'), 'Path contains a null byte.')
  .refine((value) => !value.split(/[\\/]+/u).includes('..'), 'Path traversal is not allowed.');

const llmConfigSchema = bounded(
  z
    .object({
      id: optionalText(256),
      name: optionalText(512),
      enabled: z.boolean().optional(),
      provider: z.string().max(128),
      protocol: z.enum(['openai', 'anthropic']).optional(),
      apiKey: z.string().max(MAX_IPC_TEXT),
      baseUrl: z.string().max(MAX_IPC_TEXT),
      model: z.string().max(1024),
      proxyUrl: z.string().max(MAX_IPC_TEXT),
      timeoutMs: z.number().finite().int().positive().max(3_600_000).optional(),
      requestParamsJson: optionalText(262_144),
    })
    .strict(),
);

const configTestTargetSchema = z.enum(['llm', 'image', 'tts', 'speechToText', 'jianying', 'creative']);
const taskStatusValueSchema = z.enum(['draft', 'pending', 'running', 'paused', 'completed', 'failed', 'cancelled']);
const viralStatusValueSchema = z.enum(['pending', 'running', 'paused', 'completed', 'failed', 'cancelled']);
const taskStepRerunModeSchema = z.enum(['regenerate', 'rewrite']);
const viralPlatformSchema = z.enum(['douyin', 'kuaishou', 'bilibili', 'unknown']);

const sourceSectionSchema = bounded(
  z
    .object({
      source: z.string().max(1024),
      title: z.string().max(MAX_IPC_TEXT),
      url: optionalText(MAX_IPC_TEXT),
      snippet: optionalText(MAX_IPC_TEXT),
      content: z.string().max(MAX_TASK_TEXT),
    })
    .strict(),
);

const musicMvSchema = z
  .object({
    rhythmMode: z.enum(['lyric-sync', 'fast-cut', 'slow-cinematic']),
    captionStyle: z.enum(['karaoke', 'minimal', 'none']),
    visualMotif: z.string().max(MAX_IPC_TEXT),
    audioPath: z.string().max(MAX_IPC_PATH),
  })
  .strict();

export const createTaskSchema = bounded(
  z
    .object({
      title: optionalText(MAX_IPC_TEXT),
      inputText: nonEmptyText(MAX_TASK_TEXT),
      taskKind: z.enum(['story', 'music-mv']).optional(),
      processingMode: z.enum(['full-auto', 'semi-auto', 'clip-only']).optional(),
      publishMode: z.enum(['review-rewrite', 'direct-copy']).optional(),
      mode: z.enum(['paste', 'ai']).optional(),
      aiKeyword: optionalText(MAX_IPC_TEXT),
      aiSources: stringArray().optional(),
      selectedSources: z.array(sourceSectionSchema).max(MAX_IPC_ARRAY_ITEMS).optional(),
      extraRequirements: optionalText(MAX_TASK_TEXT),
      imagePromptReference: optionalText(MAX_TASK_TEXT),
      track: optionalText(1024),
      style: optionalText(1024),
      speaker: optionalText(1024),
      ratio: optionalText(128),
      templateId: optionalText(256),
      bgmId: optionalText(256),
      pausePoints: z.array(z.enum(['none', 'critical', 'every-step', 'custom'])).max(16).optional(),
      promptTemplateId: z.string().max(256).nullable().optional(),
      promptTemplateType: z.string().max(128).nullable().optional(),
      referenceImagePath: optionalText(MAX_IPC_PATH),
      rewriteIntensity: z.enum(['standard', 'deep', 'original']).optional(),
      narrativePov: z.enum(['keep-original', 'first-person', 'third-person']).optional(),
      keepPromotion: z.boolean().optional(),
      ttsProvider: z.enum(HTML_VIDEO_TTS_PROVIDERS).optional(),
      ttsSpeed: finiteNumber.min(HTML_VIDEO_TTS_SPEED_MIN).max(HTML_VIDEO_TTS_SPEED_MAX).optional(),
      storyboardSceneCount: nonNegativeInteger.max(500).optional(),
      step3PromptSnapshot: optionalText(MAX_TASK_TEXT),
      musicMv: musicMvSchema.optional(),
      videoForm: z.enum(['narration', 'two-host-podcast']).optional(),
      llmProfileId: z.string().max(256).nullable().optional(),
      materialSource: optionalText(256),
      productInfo: nullableText(MAX_TASK_TEXT),
      materialPerson: nullableText(1024),
      draftDir: nullableText(MAX_IPC_PATH),
      fixedIntro: nullableText(MAX_TASK_TEXT),
      outroCta: nullableText(MAX_TASK_TEXT),
      lockIntroSentences: nonNegativeInteger.max(100).optional(),
      taskType: optionalText(128),
      pipelineStep: optionalText(128),
      pipelineData: optionalText(MAX_TASK_TEXT),
      targetLength: nonNegativeInteger.max(MAX_TASK_TEXT).optional(),
      targetScenes: nonNegativeInteger.max(500).optional(),
      scriptFormat: optionalText(128),
      podcastImageMode: optionalText(128),
      podcastSpeakers: nullableText(MAX_IPC_TEXT),
      podcastSpeakerA: nullableText(1024),
      podcastSpeakerB: nullableText(1024),
      coverImageMode: optionalText(128),
      coverTemplateId: optionalText(256),
      manualCoverAssetId: z.string().uuid().optional(),
      htmlVideoForeground: z.boolean().optional(),
    })
    .strict(),
);

export const htmlVideoCreateTaskSchema = createTaskSchema.superRefine((input, ctx) => {
  if (input.inputText.length > MAX_HTML_VIDEO_SOURCE_CHARS) {
    addBoundedIssue(ctx, `HTML video source text must not exceed ${MAX_HTML_VIDEO_SOURCE_CHARS} characters.`, ['inputText']);
  }
  try {
    parseHtmlVideoPipelineData(input.pipelineData);
  } catch {
    addBoundedIssue(ctx, 'Invalid HTML video pipeline data.', ['pipelineData']);
  }
  for (const field of ['targetScenes', 'storyboardSceneCount'] as const) {
    if (input[field] !== undefined && input[field] > MAX_HTML_VIDEO_SCENES) {
      addBoundedIssue(ctx, `HTML video scenes must not exceed ${MAX_HTML_VIDEO_SCENES}.`, [field]);
    }
  }
});

const htmlVideoPreviewSchema = z
  .object({
    id: idSchema,
    sceneIndex: nonNegativeInteger.min(1).max(10_000).optional(),
  })
  .strict();

const htmlVideoMediaSchema = z
  .object({
    id: idSchema,
    path: pathSchema,
  })
  .strict();

const htmlVideoCompositionSourceGetSchema = z
  .object({
    taskId: governanceIdSchema,
    sceneIndex: nonNegativeInteger.min(1).max(10_000),
  })
  .strict();

const htmlVideoCompositionSourceLintSchema = bounded(z
  .object({
    taskId: governanceIdSchema,
    sceneIndex: nonNegativeInteger.min(1).max(10_000),
    source: z.string().min(1).max(MAX_HYPERFRAMES_SOURCE_BYTES),
  })
  .strict());

const htmlVideoCompositionSourceSaveSchema = bounded(z
  .object({
    taskId: governanceIdSchema,
    sceneIndex: nonNegativeInteger.min(1).max(10_000),
    expectedRevision: nonNegativeInteger.max(Number.MAX_SAFE_INTEGER),
    source: z.string().min(1).max(MAX_HYPERFRAMES_SOURCE_BYTES),
  })
  .strict());

const htmlVideoConfigChangeSchema = z.discriminatedUnion('field', [
  z.object({ field: z.literal('style'), value: z.string().max(1024) }).strict(),
  z.object({ field: z.literal('voiceId'), value: z.string().max(1024) }).strict(),
  z.object({ field: z.literal('ttsProvider'), value: z.enum(HTML_VIDEO_TTS_PROVIDERS) }).strict(),
  z.object({ field: z.literal('ttsSpeed'), value: finiteNumber.min(HTML_VIDEO_TTS_SPEED_MIN).max(HTML_VIDEO_TTS_SPEED_MAX) }).strict(),
  z.object({ field: z.literal('bgmId'), value: z.string().max(1024) }).strict(),
  z.object({ field: z.literal('captionPreset'), value: z.enum(HTML_VIDEO_CAPTION_PRESETS) }).strict(),
  z.object({ field: z.literal('captionAnim'), value: z.enum(HTML_VIDEO_CAPTION_ANIMATIONS) }).strict(),
  z.object({
    field: z.literal('captionColors'),
    value: z.custom<Record<string, string>>((value) => {
      try {
        validateHtmlVideoCaptionColors(value);
        return true;
      } catch {
        return false;
      }
    }, 'Invalid HTML video caption colors.'),
  }).strict(),
  z.object({ field: z.literal('bgmVolume'), value: z.enum(HTML_VIDEO_BGM_VOLUMES) }).strict(),
  z.object({ field: z.literal('transitionType'), value: z.enum(HTML_VIDEO_TRANSITIONS) }).strict(),
  z.object({ field: z.literal('coverImageMode'), value: z.enum(HTML_VIDEO_COVER_MODES) }).strict(),
  z.object({ field: z.literal('coverTemplate'), value: nonEmptyText(256) }).strict(),
  z.object({ field: z.literal('coverRatio'), value: z.enum(HTML_VIDEO_COVER_RATIOS) }).strict(),
  z.object({ field: z.literal('draftTemplate'), value: z.string().max(256) }).strict(),
  z.object({ field: z.literal('foreground'), value: z.boolean() }).strict(),
  z.object({ field: z.literal('maxScenes'), value: nonNegativeInteger.min(1).max(MAX_HTML_VIDEO_SCENES) }).strict(),
  z.object({ field: z.literal('ratio'), value: z.enum(HTML_VIDEO_RATIOS) }).strict(),
]);

export const htmlVideoConfigUpdateSchema = bounded(z
  .object({
    id: governanceIdSchema,
    changes: z.array(htmlVideoConfigChangeSchema).min(1).max(HTML_VIDEO_EDITABLE_CONTROL_FIELDS.length),
  })
  .strict()
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    input.changes.forEach((change, index) => {
      if (seen.has(change.field)) addBoundedIssue(ctx, `Duplicate HTML video config field: ${change.field}.`, ['changes', index, 'field']);
      seen.add(change.field);
    });
  }));

export const sceneActionSchema = z.object({ id: idSchema, sceneId: nonNegativeInteger }).strict();
export const taskStatusSchema = z.object({ id: idSchema, status: z.enum(['running', 'paused', 'cancelled']) }).strict();
const viralStatusSchema = z.object({ id: idSchema, status: viralStatusValueSchema }).strict();
const idOnlySchema = idSchema;
const cursorPageSchema = z
  .object({
    cursor: nonEmptyText(4096).nullable().optional(),
    limit: finiteNumber.optional(),
  })
  .strict();
const countedCursorPageSchema = z
  .object({
    cursor: nonEmptyText(4096).nullable().optional(),
    limit: finiteNumber.int().min(1).max(100).optional(),
  })
  .strict();
const historyArchiveFilterSchema = z.enum(['active', 'archived']);
const historyCursorSchema = z
  .string()
  .max(4096)
  .refine((value) => value.trim().length > 0, 'History cursor must not be empty.')
  .nullable()
  .optional();
const historyLimitSchema = z.number().finite().int().min(1).max(100).optional();
const historyQuerySchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value;
    if (value.length > MAX_IPC_TEXT) return value;
    const query = value.trim();
    return query || undefined;
  },
  z.string().max(256).optional(),
);
const historyBaseShape = {
  filter: historyArchiveFilterSchema,
  query: historyQuerySchema,
  cursor: historyCursorSchema,
  limit: historyLimitSchema,
} as const;
const taskHistoryStatusesSchema = z
  .array(taskStatusValueSchema)
  .min(1)
  .max(7)
  .superRefine((statuses, ctx) => {
    if (new Set(statuses).size !== statuses.length) {
      ctx.addIssue({ code: 'custom', message: 'Task history statuses must be unique.' });
    }
  });
const taskHistoryListSchema = z.union([
  z
    .object({
      ...historyBaseShape,
      family: z.literal('task'),
      taskType: z.enum(['story', 'music-mv', 'html-video']).optional(),
      favorite: z.boolean().optional(),
      status: taskStatusValueSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...historyBaseShape,
      family: z.literal('task'),
      taskType: z.enum(['story', 'music-mv', 'html-video']).optional(),
      favorite: z.boolean().optional(),
      statuses: taskHistoryStatusesSchema,
    })
    .strict(),
]);
const viralHistoryListSchema = z
  .object({
    ...historyBaseShape,
    family: z.literal('viral-analysis'),
    status: viralStatusValueSchema.optional(),
  })
  .strict();
const imageLabHistoryListSchema = z
  .object({
    ...historyBaseShape,
    family: z.literal('image-lab'),
    status: z.enum(['mock', 'generated', 'failed']).optional(),
  })
  .strict();
const voiceLabHistoryListSchema = z
  .object({
    ...historyBaseShape,
    family: z.literal('voice-lab'),
    status: z.enum(['generated', 'failed']).optional(),
  })
  .strict();
const optionalThemeSchema = z.string().max(1024).optional();
const nameSchema = nonEmptyText(256).refine((value) => !/[\\/]/u.test(value) && value !== '..', 'Invalid name.');

export const providerModelListSchema = z
  .object({
    baseUrl: nonEmptyText(MAX_IPC_TEXT),
    apiKey: z.string().max(MAX_IPC_TEXT),
    protocol: z.enum(['openai', 'anthropic']).optional(),
    secretId: secretIdSchema.optional(),
  })
  .strict();

const volcengineSpeakerListSchema = z
  .object({
    accessKeyId: z.string().max(MAX_IPC_TEXT),
    secretAccessKey: z.string().max(MAX_IPC_TEXT),
    accessKeyIdSecretId: secretIdSchema.optional(),
    secretAccessKeySecretId: secretIdSchema.optional(),
    resourceId: z.string().max(1024),
    voiceTypes: stringArray().optional(),
    page: nonNegativeInteger.max(100_000).optional(),
    limit: nonNegativeInteger.min(1).max(500).optional(),
  })
  .strict();

export const researchCopyComposeSchema = bounded(
  z
    .object({
      keyword: nonEmptyText(MAX_IPC_TEXT),
      extraRequirements: z.string().max(MAX_TASK_TEXT),
      selectedSources: z.array(sourceSectionSchema).max(MAX_IPC_ARRAY_ITEMS),
      targetLength: nonNegativeInteger.max(MAX_TASK_TEXT).optional(),
    })
    .strict(),
);

const promptTemplateSchema = bounded(
  z
    .object({
      id: idSchema,
      name: nonEmptyText(1024),
      type: z.enum(['review', 'rewrite', 'cover', 'storyboard', 'image-prompt', 'task']),
      description: z.string().max(MAX_IPC_TEXT),
      content: z.string().max(MAX_TASK_TEXT),
      isBuiltin: z.boolean(),
      updatedAt: z.string().max(128),
      baseTrack: optionalText(1024),
      baseTemplateId: z.string().max(256).nullable().optional(),
      defaultStyles: stringArray().optional(),
      defaultDraftTemplateId: optionalText(256),
      characterPolicy: z.enum(['follow-template', 'force-extract', 'force-skip']).optional(),
      step3SkeletonModules: stringArray().optional(),
      referenceKind: z.enum(['none', 'face', 'product']).optional(),
      stepPrompts: z.record(z.string(), z.string().max(MAX_TASK_TEXT)).optional(),
      imageSeedPoolsJson: optionalText(MAX_TASK_TEXT),
      origin: z.enum(['system', 'custom', 'market']).optional(),
      usedCount: nonNegativeInteger.optional(),
      marketTags: stringArray().optional(),
    })
    .strict(),
);

const customStyleSchema = z
  .object({
    id: idSchema,
    name: nonEmptyText(1024),
    tag: z.string().max(1024),
    shortName: z.string().max(256),
    prefix: z.string().max(MAX_TASK_TEXT),
    suffix: z.string().max(MAX_TASK_TEXT),
    negativePrompt: z.string().max(MAX_TASK_TEXT),
    allowColor: z.boolean(),
    description: z.string().max(MAX_TASK_TEXT),
    createdAt: z.string().max(128),
    updatedAt: z.string().max(128),
  })
  .strict();

const imageLabSchema = z
  .object({
    id: optionalText(256),
    prompt: nonEmptyText(MAX_TASK_TEXT),
    ratio: nonEmptyText(128),
    style: z.string().max(1024),
    provider: z.enum(['gpt_image', 'jimeng', 'custom']).optional(),
    resolution: z.enum(['1K', '2K', '4K']).optional(),
    smartMode: z.enum(['text-to-image', 'cover', 'blog-cover', 'podcast-cover', 'video-narration', 'two-host-podcast', 'reference-edit']).optional(),
    referenceImagePath: optionalText(MAX_IPC_PATH),
    referenceImagePaths: z.array(pathSchema).max(MAX_IPC_ARRAY_ITEMS).optional(),
    upstreamTaskId: z.string().max(256).nullable().optional(),
    createdAt: optionalText(128),
    imagePath: optionalText(MAX_IPC_PATH),
    status: z.enum(['mock', 'generated', 'failed']).optional(),
    errorMessage: optionalText(MAX_IPC_TEXT),
    finishedAt: z.string().max(128).nullable().optional(),
  })
  .strict();

const imageLabAddRecordSchema = z
  .object({
    prompt: nonEmptyText(MAX_TASK_TEXT),
    ratio: nonEmptyText(128),
    style: z.string().max(1024),
    provider: nonEmptyText(128),
    imagePath: pathSchema,
    resolution: z.enum(['1K', '2K', '4K']).optional(),
    smartMode: z.enum(['text-to-image', 'cover', 'blog-cover', 'podcast-cover', 'video-narration', 'two-host-podcast', 'reference-edit']).optional(),
    referenceImagePath: optionalText(MAX_IPC_PATH),
    referenceImagePaths: z.array(pathSchema).max(MAX_IPC_ARRAY_ITEMS).optional(),
    upstreamTaskId: z.string().max(256).nullable().optional(),
  })
  .strict() satisfies z.ZodType<ImageLabImportInput>;

const voiceLabSchema = z
  .object({
    id: optionalText(256),
    text: nonEmptyText(MAX_TASK_TEXT),
    provider: z.enum(HTML_VIDEO_TTS_PROVIDERS),
    voiceId: z.string().max(1024),
    voiceLabel: optionalText(1024),
    speed: finiteNumber.min(0.1).max(10),
    createdAt: optionalText(128),
  })
  .strict();

const bookProductSchema = z
  .object({
    name: nonEmptyText(2048),
    author: optionalText(2048),
    category: optionalText(2048),
    keyword: optionalText(2048),
    sellPoint: optionalText(MAX_IPC_TEXT),
    audience: optionalText(MAX_IPC_TEXT),
    persons: optionalText(MAX_IPC_TEXT),
    era: optionalText(2048),
    price: optionalText(2048),
    url: optionalText(MAX_IPC_TEXT),
    note: optionalText(MAX_TASK_TEXT),
    coverPath: optionalText(MAX_IPC_PATH),
    materialFolder: optionalText(MAX_IPC_PATH),
  })
  .strict();

export const createViralAnalysisSchema = z
  .object({
    url: nonEmptyText(MAX_IPC_TEXT),
    platform: viralPlatformSchema.optional(),
    title: optionalText(MAX_IPC_TEXT),
    settings: z
      .object({
        track: nonEmptyText(1024),
        style: nonEmptyText(1024),
        ratio: nonEmptyText(128),
        templateId: nonEmptyText(256),
        keyFrameCount: nonNegativeInteger.max(500).optional(),
        storyboardSceneCount: nonNegativeInteger.max(500).optional(),
        extraRequirements: optionalText(MAX_TASK_TEXT),
      })
      .strict(),
  })
  .strict();

const viralProductionOptionsSchema = z
  .object({
    title: optionalText(MAX_IPC_TEXT),
    track: optionalText(1024),
    style: optionalText(1024),
    ratio: optionalText(128),
    templateId: optionalText(256),
    storyboardSceneCount: nonNegativeInteger.max(500).optional(),
  })
  .strict();

const appConfigSchema = boundedObjectSchema as unknown as z.ZodType<AppConfig>;
const secretChangesSchema = bounded(
  z.record(secretIdSchema, z.union([z.string().min(1).max(MAX_IPC_TEXT), z.null()])),
);
const saveConfigInputSchema = z
  .object({ config: appConfigSchema, secretChanges: secretChangesSchema })
  .strict() as z.ZodType<SaveConfigInput>;
export const ipcInputSchemas = {
  'app:get-state': z.void(),
  'app:get-bootstrap': z.void(),
  'app:reconcile-deltas': z
    .object({
      sinceRevision: nonNegativeInteger,
      taskId: idSchema.optional(),
      viralAnalysisId: idSchema.optional(),
      forceReset: z.boolean().optional(),
    })
    .strict(),
  'app:save-config': saveConfigInputSchema,
  'config:test': z.object({ target: configTestTargetSchema, config: appConfigSchema, secretChanges: secretChangesSchema }).strict(),
  'ima:fetch-knowledge': z.object({ query: nonEmptyText(1024) }).strict(),
  'llm:test-config': llmConfigSchema,
  'models:list': providerModelListSchema,
  'volcengine:speakers:list': volcengineSpeakerListSchema,
  'research:web-search': nonEmptyText(MAX_IPC_TEXT),
  'research:compose-copy': researchCopyComposeSchema,
  'prompt-template:save': promptTemplateSchema,
  'prompt-template:list': cursorPageSchema,
  'prompt-template:get-detail': idOnlySchema,
  'prompt-template:reset': z.void(),
  'custom-style:save': customStyleSchema,
  'viral:save-templates': z.object({ storyTemplate: promptTemplateSchema, imageTemplate: customStyleSchema }).strict(),
  'custom-style:generate-draft': z.object({ prompt: nonEmptyText(MAX_TASK_TEXT), baseStyle: customStyleSchema }).strict(),
  'draft-template:save': draftTemplateSchema,
  'draft-template:list': cursorPageSchema,
  'draft-template:get-detail': idOnlySchema,
  'minimax-clone-voice:list': countedCursorPageSchema,
  'minimax-clone-voice:save': z.object({
    voiceId: minimaxCloneVoiceIdSchema,
    displayName: nonEmptyText(256),
    sourceAudioPath: z.string().max(MAX_IPC_PATH).refine((value) => !value.includes('\0'), 'Path contains a null byte.'),
  }).strict(),
  'minimax-clone-voice:delete': minimaxCloneVoiceIdSchema,
  'image-lab:generate': imageLabSchema,
  'image-lab:list': imageLabHistoryListSchema,
  'image-lab:archive': governanceIdSchema,
  'image-lab:restore': governanceIdSchema,
  'image-lab:delete': governanceIdSchema,
  'image-lab:get-detail': idOnlySchema,
  'image-lab:open-output-directory': idOnlySchema,
  'image-lab:add-record': imageLabAddRecordSchema,
  'voice-lab:generate': voiceLabSchema,
  'voice-lab:list': voiceLabHistoryListSchema,
  'voice-lab:archive': governanceIdSchema,
  'voice-lab:restore': governanceIdSchema,
  'voice-lab:delete': governanceIdSchema,
  'voice-lab:get-detail': idOnlySchema,
  'account:save': z
    .object({
      displayName: z.string().max(1024),
      email: z.string().max(4096),
      workspace: z.string().max(4096),
      avatarInitial: z.string().max(64),
      deviceId: z.string().max(1024),
      balance: finiteNumber,
    })
    .strict(),
  'activation:save': z
    .object({
      plan: z.enum(['trial', 'local', 'inactive']),
      status: z.enum(['trial', 'active', 'inactive']),
      code: z.string().max(4096),
      expiresAt: z.string().max(128).nullable(),
      message: z.string().max(MAX_IPC_TEXT),
    })
    .strict(),
  'ui:save-preferences': z.union([
    z.object({ theme: z.enum(['dark', 'light']) }).strict(),
    z.object({
      activeView: z.enum([
        'new-task',
        'queue',
        'history',
        'task-detail',
        'html-video',
        'image-lab',
        'voice-lab',
        'music-mv',
        'book-selection',
        'benchmark',
        'person-assets',
        'viral-analyzer',
        'prompt-templates',
        'draft-templates',
        'settings',
        'account',
        'activation',
      ]),
    }).strict(),
  ]),
  'book-selection:list': optionalThemeSchema,
  'book-selection:save': z.object({
    theme: nonEmptyText(1024),
    bookId: optionalText(256),
    previousIdentity: z.object({ theme: nonEmptyText(1024), bookId: idSchema }).strict().optional(),
    data: bookProductSchema,
  }).strict(),
  'book-selection:delete': z.object({ theme: nonEmptyText(1024), bookId: idSchema }).strict(),
  'person-assets:list': z.void(),
  'person-assets:create': nameSchema,
  'person-assets:rename': z.object({ oldName: nameSchema, newName: nameSchema }).strict(),
  'person-assets:delete': nameSchema,
  'person-assets:list-images': nameSchema,
  'person-assets:import-images': nameSchema,
  'person-assets:open-directory': nameSchema,
  'html-video:create-task': htmlVideoCreateTaskSchema,
  'html-video:update-config': htmlVideoConfigUpdateSchema,
  'html-video:import-cover': idOnlySchema,
  'html-video:composition-source:get': htmlVideoCompositionSourceGetSchema,
  'html-video:composition-source:lint': htmlVideoCompositionSourceLintSchema,
  'html-video:composition-source:save': htmlVideoCompositionSourceSaveSchema,
  'task:import-cover': z.enum(ORDINARY_TASK_COVER_RATIOS),
  'html-video:open-preview': htmlVideoPreviewSchema,
  'html-video:media-url': htmlVideoMediaSchema,
  'task:create-and-run': createTaskSchema,
  'task:list': taskHistoryListSchema,
  'task:set-favorite': z.object({ id: idSchema, isFavorite: z.boolean() }).strict(),
  'task:archive': governanceIdSchema,
  'task:restore': governanceIdSchema,
  'task:delete': governanceIdSchema,
  'task:get-detail': idOnlySchema,
  'task:list-events': z.object({ taskId: idSchema, cursor: nonEmptyText(4096).nullable().optional(), limit: finiteNumber.optional() }).strict(),
  'task:open-output-directory': idOnlySchema,
  'viral:create-and-run': createViralAnalysisSchema,
  'viral:list': viralHistoryListSchema,
  'viral:archive': governanceIdSchema,
  'viral:restore': governanceIdSchema,
  'viral:delete': governanceIdSchema,
  'viral:get-detail': idOnlySchema,
  'viral:list-events': z.object({ analysisId: idSchema, cursor: nonEmptyText(4096).nullable().optional(), limit: finiteNumber.optional() }).strict(),
  'viral:update-status': viralStatusSchema,
  'viral:retry': idOnlySchema,
  'viral:get-result': idOnlySchema,
  'viral:create-production-task': z.object({ id: idSchema, options: viralProductionOptionsSchema.optional() }).strict(),
  'task:update-status': taskStatusSchema,
  'task:retry': idOnlySchema,
  'task:regenerate-image': sceneActionSchema,
  'task:regenerate-narration': sceneActionSchema,
  'task:update-image-prompt': z.object({ id: idSchema, sceneId: nonNegativeInteger, prompt: nonEmptyText(MAX_TASK_TEXT) }).strict(),
  'task:rerun-step': z.object({ id: idSchema, step: nonNegativeInteger.max(6), mode: taskStepRerunModeSchema }).strict(),
  'task:get-artifacts': idOnlySchema,
  'asset:read-data-url': pathSchema,
  'local-image:select': z.void(),
  'local-audio:select': z.void(),
  'local-folder:select': z.void(),
  'cookie-file:select': z.void(),
  'viral:open-login-window': z.void(),
  'jianying:draft-path:detect': z.void(),
  'jianying:effect-catalog': z.void(),
  'diagnostics:run': z.void(),
  'window:control': z.enum(['minimize', 'toggle-maximize', 'close']),
} as const satisfies Record<InvokeChannel, z.ZodType>;

export type IpcChannel = InvokeChannel;
export const IPC_CHANNELS = INVOKE_CHANNELS;
export type IpcInput<C extends IpcChannel> = z.output<(typeof ipcInputSchemas)[C]>;

export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } };

export async function toIpcResult<T>(operation: () => Promise<T> | T): Promise<IpcResult<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch {
    return { ok: false, error: { code: 'IPC_HANDLER_FAILED', message: 'The requested operation failed.' } };
  }
}

export function unwrapIpcResult<T>(result: unknown): T {
  if (!result || typeof result !== 'object' || !('ok' in result)) {
    throw new Error('IPC_INVALID_RESPONSE: Invalid IPC response.');
  }
  const typed = result as IpcResult<T>;
  if (typed.ok) return typed.value;
  const code = typed.error?.code || 'IPC_HANDLER_FAILED';
  const message = typed.error?.message || 'The requested operation failed.';
  throw new Error(`${code}: ${message}`);
}
