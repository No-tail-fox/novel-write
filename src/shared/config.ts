import type {
  AccountProfile,
  ActivationState,
  AppConfig,
  CreditTransaction,
  CustomCoverTemplate,
  CustomStyle,
  MinimaxCloneVoice,
  PromptTemplate,
  UiPreferences,
} from './types';
import { storyboundSystemTemplateVersionHash, storyboundSystemTemplates, type StoryboundSystemTemplate } from './storybound-system-templates';
import { DEFAULT_VOLCENGINE_TTS_V3_SPEAKER } from './volcengine-tts';

const updatedAt = '2026-05-26T00:00:00.000Z';

export const defaultConfig: AppConfig = {
  llm: {
    id: 'default-llm',
    name: '第三方',
    enabled: true,
    provider: 'custom',
    protocol: 'openai',
    apiKey: '',
    baseUrl: 'https://ai.input.im',
    model: 'gpt-5.5',
    proxyUrl: '',
    timeoutMs: 120000,
    requestParamsJson: '{}',
  },
  llmProfiles: [
    {
      id: 'default-llm',
      name: '第三方',
      enabled: true,
      provider: 'custom',
      protocol: 'openai',
      apiKey: '',
      baseUrl: 'https://ai.input.im',
      model: 'gpt-5.5',
      proxyUrl: '',
      timeoutMs: 120000,
      requestParamsJson: '{}',
    },
  ],
  activeLlmProfileId: 'default-llm',
  imageProvider: 'gpt_image',
  image: {
    baseUrl: '',
    apiKey: '',
    model: 'gpt-image-2',
    ratio: '9:16',
    concurrency: 3,
    resolution: '2K',
    proxyUrl: '',
  },
  gptImage: {
    baseUrl: '',
    apiKey: '',
    model: 'gpt-image-2',
    ratio: '9:16',
    concurrency: 3,
    resolution: '2K',
    proxyUrl: '',
  },
  jimeng: {
    sessionId: '',
    accessKeyId: '',
    secretAccessKey: '',
    reqKey: 'jimeng_t2i_v40',
    endpoint: 'https://visual.volcengineapi.com',
    region: 'cn-north-1',
    service: 'cv',
    pollIntervalMs: 2000,
    timeoutMs: 120000,
    model: 'jimeng-3.1',
    ratio: '9:16',
    resolution: '2K',
    concurrency: 3,
  },
  customImage: {
    displayName: '自定义图片接口',
    baseUrl: '',
    apiKey: '',
    model: 'gpt-image-2',
    ratio: '9:16',
    concurrency: 3,
    resolution: '2K',
    proxyUrl: '',
    asyncMode: false,
    ratioMappingJson: '{}',
  },
  imageProfiles: [
    {
      id: 'default-image',
      name: 'GPT Image',
      enabled: true,
      provider: 'gpt_image',
      gptImage: {
        baseUrl: '',
        apiKey: '',
        model: 'gpt-image-2',
        ratio: '9:16',
        concurrency: 3,
        resolution: '2K',
        proxyUrl: '',
      },
    },
  ],
  activeImageProfileId: 'default-image',
  tts: {
    provider: 'volcengine',
    appId: '',
    accessKey: '',
    speaker: DEFAULT_VOLCENGINE_TTS_V3_SPEAKER,
    volcengine: {
      apiKey: '',
      accessKeyId: '',
      secretAccessKey: '',
      appId: '',
      accessKey: '',
      speaker: DEFAULT_VOLCENGINE_TTS_V3_SPEAKER,
      cluster: 'volcano_tts',
      endpoint: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
      resourceId: 'seed-tts-2.0',
    },
    minimax: {
      apiKey: '',
      model: 'speech-02-hd',
      voiceId: 'male-qn-qingse',
    },
  },
  ttsProfiles: [
    {
      id: 'default-tts',
      name: '火山引擎',
      enabled: true,
      provider: 'volcengine',
      appId: '',
      accessKey: '',
      speaker: DEFAULT_VOLCENGINE_TTS_V3_SPEAKER,
      volcengine: {
        apiKey: '',
        accessKeyId: '',
        secretAccessKey: '',
        appId: '',
        accessKey: '',
        speaker: DEFAULT_VOLCENGINE_TTS_V3_SPEAKER,
        cluster: 'volcano_tts',
        endpoint: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
        resourceId: 'seed-tts-2.0',
      },
    },
  ],
  activeTtsProfileId: 'default-tts',
  speechToText: {
    provider: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'whisper-1',
    language: 'zh',
    prompt: '',
    responseFormat: 'verbose_json',
    temperature: 0,
    timestampGranularities: ['segment'],
    chunkingStrategy: 'none',
    timeoutMs: 120000,
  },
  jianying: {
    draftPath: '',
    bgmLibrary: [],
    defaultBgmId: '',
  },
  ima: {
    clientId: '',
    apiKey: '',
    kbId: '',
    kbName: '',
  },
  viral: {
    cookieFilePath: '',
    cookieFallbackMode: 'browser-first-after-failure',
    browserCookieSource: 'auto',
    frameIntervalSeconds: 3,
    maxFrames: 40,
    whisperModel: 'small',
    huggingFaceEndpoint: '',
    downloadTimeoutMs: 180000,
    vision: {
      id: 'viral-vision',
      name: '爆款拆解视觉模型',
      enabled: true,
      provider: 'custom',
      protocol: 'openai',
      apiKey: '',
      baseUrl: 'https://ai.input.im',
      model: 'gpt-5.5',
      proxyUrl: '',
      timeoutMs: 120000,
    },
  },
  ui: {
    theme: 'dark',
  },
};

function storyboundTemplateUpdatedAt(template: StoryboundSystemTemplate): string {
  return new Date(template.updatedAt * 1000).toISOString();
}

function storyboundCharacterPolicy(template: StoryboundSystemTemplate): PromptTemplate['characterPolicy'] {
  if (template.needsCharacterCard === 'force') return 'force-extract';
  if (template.needsCharacterCard === 'skip') return 'force-skip';
  return 'follow-template';
}

function storyboundReferenceKind(template: StoryboundSystemTemplate): PromptTemplate['referenceKind'] {
  if (template.referenceKind === 'character' || template.referenceKind === 'face') return 'face';
  if (template.referenceKind === 'product') return 'product';
  return 'none';
}

function storyboundTaskTemplateContent(template: StoryboundSystemTemplate): string {
  return [
    `StoryDream 系统模板：${template.name}`,
    `模板 ID：${template.templateId}`,
    `模板说明：${template.description}`,
    `默认画风：${template.defaultStyleId}`,
    `版本：${template.version}`,
    `模板源版本：${storyboundSystemTemplateVersionHash}`,
  ].join('\n');
}

function storydreamCanonicalTrack(templateId: string): string {
  if (templateId === 'culture-knowledge') return 'culture-science';
  if (templateId === 'folk-tale') return 'folk-story';
  if (templateId === 'inspirational') return 'mind-soup';
  return templateId;
}

function storyboundStoryboardStepPrompt(template: StoryboundSystemTemplate): string {
  return [
    'StoryDream 本地化分镜规则',
    `StoryDream Storybound-compatible storyboard lane: ${template.name}`,
    'Storyboard split only: split the rewritten copy into scene captions; do not rewrite, summarize, translate, or add new story facts.',
    '请把口播稿拆成连续分镜 JSON。cap 是最终口播字幕，必须适合 TTS 和字幕展示；descPrompt 是给后续 StoryDream Step 3 的视觉种子，只写可见画面、镜头、场景、人物/产品线索，不要复述完整字幕，不要写屏幕文字、标题、字幕、水印或 UI。',
    '目标字数：{{targetLength}}',
    '目标分镜数：{{storyboardSceneCount}}',
    'Every scene.cap must be a continuous caption fragment. The ordered cap values should join back to the original rewritten copy with only whitespace/punctuation-normalization differences.',
    'Each descPrompt must describe visible image content for the matching cap only. Do not put new plot, narration, titles, subtitles, watermarks, UI, or readable text into descPrompt.',
    'Respect the target storyboard scene count {{storyboardSceneCount}}, but complete copy coverage is more important than hitting the exact count.',
    'Use varied close, medium, wide, and establishing shots while keeping character, era, product, and location continuity.',
  ].join('\n');
}

function storyboundImagePromptStepPrompt(template: StoryboundSystemTemplate): string {
  return [
    template.step3SystemPrompt,
    '',
    'StoryDream local safety and consistency supplement:',
    `Lane: ${template.name}`,
    'Read each scene.cap first, then convert descPrompt/desc_prompt into a drawable scene. The prompt must not contradict the spoken caption.',
    'Use safe substitutes for gore, medical efficacy, trademarks, celebrity likenesses, sensitive identity, minors at risk, and dangerous actions.',
    'Keep character appearance, age, wardrobe, era, locations, and product shape consistent across all shots.',
    'Do not generate readable text, subtitles, watermarks, signatures, UI, logos, or malformed bodies. Use unreadable posters, book pages, screen glow, or props when text-like information is needed.',
    'Return strict JSON imagePrompts and preserve sceneId, cap, prompt, negativePrompt, style, ratio, and characterProfile.',
    'Use desc_prompt as an alias for descPrompt when the reference prompt names it that way.',
  ].join('\n');
}

const defaultStoryboundFallbackTemplate = storyboundSystemTemplates.find((template) => template.templateId === 'general') ?? storyboundSystemTemplates[0];

const storyboundPromptTaskTemplates: PromptTemplate[] = storyboundSystemTemplates.map((template) => ({
  id: `system-${template.templateId}`,
  name: template.name,
  type: 'task',
  description: template.description,
  content: storyboundTaskTemplateContent(template),
  isBuiltin: true,
  updatedAt: storyboundTemplateUpdatedAt(template),
  baseTrack: storydreamCanonicalTrack(template.templateId),
  defaultStyles: [template.defaultStyleId],
  characterPolicy: storyboundCharacterPolicy(template),
  step3SkeletonModules: [...(template.step3SkeletonModules ?? [])],
  referenceKind: storyboundReferenceKind(template),
  stepPrompts: {
    rewrite: template.step1RewriteSystemPrompt,
    cover: template.step1MetadataSystemPrompt,
    storyboard: storyboundStoryboardStepPrompt(template),
    'image-prompt': storyboundImagePromptStepPrompt(template),
  },
  imageSeedPoolsJson: JSON.stringify(template.imageSeedPools ?? {}),
  origin: 'system',
}));

export const defaultPromptTemplates: PromptTemplate[] = [
  ...storyboundPromptTaskTemplates,
  {
    id: 'builtin-review',
    name: '预审整理',
    type: 'review',
    description: '清洗素材、去噪、压缩为适合短视频的事实文案。',
    content:
      '任务模板：{{taskTemplateContent}}\n\n素材：{{inputText}}\n\n资料来源：{{sourceContext}}\n\n请清洗素材、去除重复和明显广告噪音，保留事实顺序，输出适合后续改写的中文事实简稿。',
    isBuiltin: true,
    updatedAt,
    origin: 'system',
  },
  {
    id: 'builtin-rewrite',
    name: 'StoryDream 通用改写',
    type: 'rewrite',
    description: 'StoryDream 通用故事赛道改写提示词兜底。',
    content: defaultStoryboundFallbackTemplate.step1RewriteSystemPrompt,
    isBuiltin: true,
    updatedAt: storyboundTemplateUpdatedAt(defaultStoryboundFallbackTemplate),
    origin: 'system',
  },
  {
    id: 'builtin-cover',
    name: 'StoryDream 通用封面信息',
    type: 'cover',
    description: 'StoryDream 通用故事赛道封面标题与视频简介提示词兜底。',
    content: defaultStoryboundFallbackTemplate.step1MetadataSystemPrompt,
    isBuiltin: true,
    updatedAt: storyboundTemplateUpdatedAt(defaultStoryboundFallbackTemplate),
    origin: 'system',
  },
  {
    id: 'builtin-storyboard',
    name: 'StoryDream 本地化分镜',
    type: 'storyboard',
    description: '为 StoryDream 绘图提示词阶段生成字幕句和视觉种子。',
    content:
      'StoryDream 本地化分镜规则\n\n最终口播稿：{{rewrittenCopy}}\n\n任务模板：{{taskTemplateContent}}\n\n目标字数：{{targetLength}}\n目标分镜数：{{storyboardSceneCount}}\n画面比例：{{ratio}}\n当前画面风格：{{style}}\n参考图类型：{{referenceKind}}\nStep 3 骨架：{{step3SkeletonModules}}\n额外要求：{{extraRequirements}}\n\n请把口播稿拆成连续分镜 JSON。cap 是最终口播字幕，必须适合 TTS 和字幕展示；descPrompt 是给后续 StoryDream Step 3 的视觉种子，只写可见画面、镜头、场景、人物/产品线索，不要复述完整字幕，不要写屏幕文字、标题、字幕、水印或 UI。每个镜头只表达一个动作、场景或情绪，保持人物/产品/时代连续性，穿插特写、中景、全景和建立镜头。durationMs 按 cap 字数和节奏估算。',
    isBuiltin: true,
    updatedAt,
    origin: 'system',
  },
  {
    id: 'builtin-image-prompt',
    name: 'StoryDream 通用绘图提示词',
    type: 'image-prompt',
    description: 'StoryDream 通用故事赛道分镜绘画提示词兜底。',
    content: `${defaultStoryboundFallbackTemplate.step3SystemPrompt}\n\n爆款复刻画面提示词参考：{{imagePromptReference}}`,
    isBuiltin: true,
    updatedAt: storyboundTemplateUpdatedAt(defaultStoryboundFallbackTemplate),
    origin: 'system',
  },
];

export const defaultCustomStyles: CustomStyle[] = [
  {
    id: 'cinematic',
    name: '电影感封面',
    tag: '强钩子海报',
    shortName: '电影感',
    prefix: 'cinematic short-video poster, dramatic lighting, strong subject focus, editorial composition',
    suffix: 'sharp focal hierarchy, high contrast, premium social video cover, readable empty space',
    negativePrompt: 'low quality, blurry, watermark, extra text, malformed hands, cluttered background',
    allowColor: true,
    description: 'StoryDream 默认电影感封面与短视频主图风格。',
    createdAt: updatedAt,
    updatedAt,
  },
  {
    id: 'ancient-cinematic',
    name: '古风电影封面',
    tag: '历史大片',
    shortName: '古风电影',
    prefix: 'ancient cinematic poster, historical Chinese atmosphere, restrained costume detail, dramatic rim light',
    suffix: 'epic but grounded, textured set, strong vertical composition, premium cover art',
    negativePrompt: 'modern objects, low quality, watermark, random text, overdecorated fantasy armor',
    allowColor: true,
    description: '对应参考包内 ancient-cinematic 风格，用于历史与文化故事封面。',
    createdAt: updatedAt,
    updatedAt,
  },
  {
    id: 'black-white',
    name: '黑白摄影',
    tag: '纪实感',
    shortName: '黑白',
    prefix: '黑白纪实摄影，高对比光影，颗粒感，真实人物质感',
    suffix: '自然构图，电影级光线，真实细节',
    negativePrompt: '卡通，动漫，低质量，模糊，变形，水印，文字',
    allowColor: false,
    description: '适合人物传记和纪实叙事。',
    createdAt: updatedAt,
    updatedAt,
  },
  {
    id: 'photo-real',
    name: '写实彩色',
    tag: '质感胶片',
    shortName: '写实',
    prefix: '写实摄影，电影级布光，真实人物，清晰细节',
    suffix: '高质量，浅景深，真实色彩',
    negativePrompt: '卡通，油画，低质量，额外肢体，文字，水印',
    allowColor: true,
    description: '通用短视频分镜风格。',
    createdAt: updatedAt,
    updatedAt,
  },
  {
    id: 'oil-paint',
    name: '油画风格',
    tag: '印象写意',
    shortName: '油画',
    prefix: '油画质感，厚涂笔触，柔和自然光，人物和场景带有手工绘制的层次',
    suffix: '写意构图，丰富肌理，柔和色彩，画面有叙事感',
    negativePrompt: '照片写实，卡通，低质量，过度锐化，文字，水印，畸形肢体',
    allowColor: true,
    description: '适合书摘、知识类和情绪表达偏柔和的内容。',
    createdAt: updatedAt,
    updatedAt,
  },
  {
    id: 'modern-film',
    name: '现代电影',
    tag: '宽屏调色',
    shortName: '电影',
    prefix: '现代电影镜头，真实场景，宽屏构图，克制高级的电影调色',
    suffix: '自然表演，空间纵深，氛围光，电影级细节',
    negativePrompt: '卡通，插画，低质量，过曝，文字，水印，畸形肢体',
    allowColor: true,
    description: '适合情感、都市、通用叙事和剧情感较强的短视频。',
    createdAt: updatedAt,
    updatedAt,
  },
  {
    id: 'ancient-film',
    name: '古风电影',
    tag: '古代史诗',
    shortName: '古风',
    prefix: '古装电影质感，历史场景，细腻服饰，庄重光影',
    suffix: '电影构图，真实布景，古代建筑',
    negativePrompt: '现代物件，卡通，低质量，水印，文字',
    allowColor: true,
    description: '适合古代人物和文化内容。',
    createdAt: updatedAt,
    updatedAt,
  },
  {
    id: 'retro-film',
    name: '复古胶片',
    tag: '80年代街拍',
    shortName: '复古',
    prefix: '复古胶片摄影，80年代生活气息，暖色颗粒，街头纪实质感',
    suffix: '自然抓拍，真实环境光，胶片颗粒，怀旧但清晰',
    negativePrompt: '未来科技感，卡通，低质量，过度磨皮，文字，水印',
    allowColor: true,
    description: '适合美食探店、街角小店、城市烟火气和怀旧叙事。',
    createdAt: updatedAt,
    updatedAt,
  },
  {
    id: 'watercolor',
    name: '水彩治愈',
    tag: '柔和晕染',
    shortName: '水彩',
    prefix: '水彩插画，柔和晕染，温暖治愈，轻盈干净的童书画面',
    suffix: '纸张纹理，柔和边缘，清透色彩，温柔光线',
    negativePrompt: '写实照片，暗黑恐怖，强冲突，低质量，文字，水印',
    allowColor: true,
    description: '适合绘本故事、睡前故事和温柔治愈内容。',
    createdAt: updatedAt,
    updatedAt,
  },
  {
    id: 'magazine',
    name: '杂志插画',
    tag: '极简色块',
    shortName: '杂志',
    prefix: '现代杂志插画，极简色块，清晰主体，信息图式构图',
    suffix: '干净背景，平衡留白，高级配色，适合知识传播',
    negativePrompt: '复杂脏乱，恐怖，低质量，模糊，文字，水印',
    allowColor: true,
    description: '适合健康科普、图书拆解、电商卖点和知识说明。',
    createdAt: updatedAt,
    updatedAt,
  },
  {
    id: 'pixar-3d',
    name: '皮克斯 3D',
    tag: '动画质感',
    shortName: '3D',
    prefix: '高质量 3D 动画质感，友好的角色比例，柔和体积光，精致材质',
    suffix: '明亮色彩，电影动画构图，表情自然，细节丰富',
    negativePrompt: '恐怖，写实血腥，低质量，材质粗糙，文字，水印',
    allowColor: true,
    description: '适合轻松、有角色表现需求的动画化内容。',
    createdAt: updatedAt,
    updatedAt,
  },
  {
    id: 'ink',
    name: '中国水墨',
    tag: '文人意境',
    shortName: '水墨',
    prefix: '中国水墨画，留白构图，淡墨层次，传统文化意境',
    suffix: '宣纸纹理，水墨晕染，克制色彩，东方美学',
    negativePrompt: '现代霓虹，3D，低质量，脏乱背景，文字，水印',
    allowColor: true,
    description: '适合文化科普、传统器物、诗词意境和历史知识。',
    createdAt: updatedAt,
    updatedAt,
  },
  {
    id: 'folk',
    name: '民间故事工笔风',
    tag: '工笔叙事',
    shortName: '工笔',
    prefix: '民间故事工笔画风，乡土场景，细腻线描，传统叙事画面',
    suffix: '村镇山林，古朴服饰，层次清晰，带有传说感',
    negativePrompt: '现代城市，赛博朋克，低质量，卡通过度，文字，水印',
    allowColor: true,
    description: '适合民间传说、寓言、乡土叙事和古朴故事。',
    createdAt: updatedAt,
    updatedAt,
  },
  {
    id: 'ghibli',
    name: '吉卜力',
    tag: '治愈日漫',
    shortName: '吉卜力',
    prefix: '治愈日漫电影感，自然风景，温暖人物，柔和手绘动画质感',
    suffix: '明亮天空，丰富生活细节，温柔氛围，干净构图',
    negativePrompt: '真实照片，恐怖，低质量，过度商业海报感，文字，水印',
    allowColor: true,
    description: '适合治愈、成长、幻想和温暖日常故事。',
    createdAt: updatedAt,
    updatedAt,
  },
];

export const defaultCustomCoverTemplates: CustomCoverTemplate[] = [
  {
    id: 'cinematic-poster',
    name: '电影海报封面',
    description: 'StoryDream 默认封面模板，适合故事口播与人物反差主题。',
    directions: 'Use a cinematic poster composition with one clear subject and strong contrast. Reserve clean negative space for the generated title.',
    compositionRule: 'Subject occupies the visual center or lower third; background supports tension without adding unrelated objects.',
    titleLayout: 'Large title in the upper third, short and readable, no more than two lines.',
    subtitleLayout: 'Small subtitle below the title or near the subject edge, used only when it sharpens the hook.',
    plainHint: '电影感短视频封面，强主体，暗部层次，标题留白，适合 {{TITLE}}',
    createdAt: updatedAt,
    updatedAt,
  },
  {
    id: 'ancient-cinematic',
    name: '古风电影封面',
    description: '历史人物、传统文化、古代故事的电影感封面。',
    directions: 'Create an ancient Chinese cinematic poster with restrained historical texture and a clear emotional hook.',
    compositionRule: 'Use architecture, fabric, weather, or ritual objects as context; avoid crowded fantasy decoration.',
    titleLayout: 'Title sits in a calm high-contrast area, using a sober poster hierarchy.',
    subtitleLayout: 'Subtitle is optional and should feel like a dramatic logline.',
    plainHint: '古风电影封面，历史氛围，克制留白，适合 {{TITLE}}',
    createdAt: updatedAt,
    updatedAt,
  },
  {
    id: 'podcast-cover',
    name: '播客节目封面',
    description: '对应 1.7.0 podcast-cover-prompt 资产，用于多配图播客/访谈式任务。',
    directions: 'Create a podcast cover that reads clearly at thumbnail size, with a calm host/story identity and a single topic signal.',
    compositionRule: 'Use a portrait, object, or symbolic scene as the anchor; keep text area stable and uncluttered.',
    titleLayout: 'Title should be compact, centered or upper-left, with strong contrast.',
    subtitleLayout: 'Subtitle can carry episode context, placed below title with smaller weight.',
    plainHint: '播客封面，清晰节目识别，稳定文字区，多配图任务，适合 {{TITLE}}',
    createdAt: updatedAt,
    updatedAt,
  },
];

export const defaultAccount: AccountProfile = {
  displayName: '本地用户',
  email: 'local@storydream.app',
  workspace: 'StoryDream 本地工作区',
  avatarInitial: 'S',
  deviceId: 'local-device',
  balance: 0,
};

export const defaultActivation: ActivationState = {
  plan: 'trial',
  status: 'trial',
  code: '',
  expiresAt: null,
  message: '本地试用模式：旧任务可继续执行，新任务不做真实付费限制。',
};

export const defaultUiPreferences: UiPreferences = {
  theme: 'dark',
  activeView: 'new-task',
};

export const defaultCreditTransactions: CreditTransaction[] = [
  {
    id: 1,
    type: 'system',
    amount: 0,
    balance: 0,
    taskId: null,
    description: 'StoryDream 本地试用积分，不参与真实扣费。',
    createdAt: updatedAt,
  },
];

export const defaultMinimaxCloneVoices: MinimaxCloneVoice[] = [];
