import React, { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  Bell,
  Bot,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Circle,
  Coins,
  Copy,
  Database,
  Eye,
  EyeOff,
  FileJson,
  Flame,
  FlaskConical,
  FolderOpen,
  History,
  Image as ImageIcon,
  Images,
  Info,
  KeyRound,
  LayoutTemplate,
  ListChecks,
  Loader2,
  Maximize2,
  Mic2,
  Minus,
  Music,
  Palette,
  Pause,
  Pencil,
  Play,
  Plus,
  Radar,
  RotateCcw,
  Save,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X,
  XCircle,
} from 'lucide-react';
import type {
  AccountProfile,
  ActivationState,
  AiSourceContext,
  AiSourceSection,
  AppDelta,
  AppMutationResult,
  AppConfig,
  BootstrapState,
  BookProductInfo,
  BookSelectionRecord,
  ConfigTestTarget,
  CreateTaskInput,
  CreateViralAnalysisInput,
  CustomCoverTemplate,
  CustomStyle,
  DraftTemplate,
  DraftTextBorder,
  HistoryFamily,
  HistoryListInput,
  HistoryListRequest,
  HistoryPage,
  ImageLabGenerateInput,
  ImageProviderProfile,
  ImageLabRecord,
  ImageLabSummary,
  ImageLabSmartMode,
  BgmItem,
  HtmlVideoConfigChange,
  HtmlVideoCoverAsset,
  HtmlVideoCoverMode,
  HtmlVideoCoverRatio,
  HtmlVideoJobConfig,
  HtmlVideoStepStatus,
  HtmlVideoTabKey,
  JianyingEffectCatalog,
  PausePoint,
  PodcastSpeakerPair,
  ProcessingMode,
  PromptTemplate,
  PromptTemplateSummary,
  PromptStepTemplateType,
  PromptTemplateType,
  ProviderModel,
  ProviderModelListRequest,
  RewriteIntensity,
  ShellView,
  Task,
  TaskSummary,
  TaskArtifactSnapshot,
  ViralAnalysisEvent,
  TaskEvent,
  TaskMode,
  TaskStatus,
  TaskStepRerunMode,
  TaskVideoForm,
  TtsProviderProfile,
  TtsProvider,
  UiPreferencesUpdate,
  VolcengineSpeaker,
  ViralAnalysisResult,
  ViralAnalysisRecord,
  ViralAnalysisSummary,
  ViralAnalysisStatus,
  ViralPlatform,
  VoiceLabGenerateInput,
  VoiceLabRecord,
  VoiceLabSummary,
} from './shared/types';
import type { StoryDreamApi } from './shared/storydream-api';
import {
  createAppDeltaCoordinator,
  MAX_RENDERER_DELTA_BUFFER,
  type DeltaViewState,
  type HistoryRevisionLedger,
  type RevisionGap,
} from './shared/state-delta';
import {
  applyAppMutationResult,
  applyBufferedMutationResults,
  applyHistorySelectionBarrier,
  applyLocalMutationResponse,
  authoritativeMissingRequestedTaskId,
  claimMutationResult,
  collectCursorPages,
  createRequestGenerationCompletionQueue,
  createRequestGenerationGuard,
  historyEntityRevisionKey,
  historyResponseDisposition,
  imageLabSummaryToRecord,
  mergeAuthoritativeSnapshotDetails,
  mergeDeltaViewSlices,
  mergeReconciliationSlices,
  raiseMutationRevisionFloor,
  reduceCompletionTrackedState,
  shouldApplyDeltaViewTransition,
  taskDetailRefreshKey,
  taskSummaryToTask,
  taskToSummary,
  viralSummaryToRecord,
  viralEventRefreshKey,
  voiceLabSummaryToRecord,
  type HistoryResponseRevision,
} from './shared/state-reconciliation';
import {
  stripConfigSecrets,
  type PublicAppState as AppState,
  type SecretChanges,
  type SecretId,
} from './shared/config-secrets';
import type { PersonAssetImage, PersonAssetSummary } from './shared/person-assets';
import { useHistoryPage } from './features/history/use-history-page';
import {
  applyStoredTheme,
  changeRuntimeTheme,
  revealThemedApplication,
} from './features/settings/theme-controller';
import { configTargetStatus, normalizeAppConfig, validateConfigTarget } from './shared/config-utils';
import {
  activeImageProfileId,
  activeLlmProfileId,
  activeTtsProfileId,
  activateSelectedProviderProfileForTarget,
  addImageProfile,
  addLlmProfile,
  addTtsProfile,
  buildConfigForSelectedProfileTest,
  copyImageProfile,
  copyLlmProfile,
  copyTtsProfile,
  editableLlmProfileProvider,
  enableImageProfile,
  enableLlmProfile,
  enableTtsProfile,
  imageProfileCustomImage,
  imageProfileGptImage,
  imageProfileJimeng,
  normalizeEditableConfigProviders,
  normalizedImageProfiles,
  normalizedTtsProfiles,
  removeImageProfile,
  removeLlmProfile,
  removeTtsProfile,
  saveImageProfile,
  saveLlmProfile,
  saveTtsProfile,
  ttsProfileMinimax,
  ttsProfileVolcengine,
} from './shared/provider-profile-utils';
import {
  countVisibleCharacters,
  normalizeStoryboardSceneCount,
  normalizeTargetLength,
  storyboardSceneCountPreviewRange,
  storyboardSceneCountRange,
  targetWordCountRange,
} from './shared/content-metrics';
import {
  defaultAccount,
  defaultActivation,
  defaultConfig,
  defaultCreditTransactions,
  defaultCustomCoverTemplates,
  defaultCustomStyles,
  defaultMinimaxCloneVoices,
  defaultUiPreferences,
} from './shared/config';
import { promptTemplateCatalog } from './shared/prompt-template-catalog';
import { loadDefaultPromptTemplates } from './shared/prompt-template-loader';
import { draftTemplates as builtinDraftTemplates, imageAnimations, normalizeDraftTemplate } from './shared/templates';
import { convertCozeWorkflowToDraftTemplate, convertManyCozeWorkflowsToDraftTemplates, type CozeWorkflowTemplateConversionResult } from './shared/coze-workflow-converter';
import {
  buildImageTemplateStyleOptions,
  buildStoryTemplateOptions,
  buildTaskPromptTemplateOptions,
  buildStoryTemplateTrackOptions,
  resolvePromptTemplateDefaultDraftTemplateId,
  resolvePromptTemplateDefaultStyleId,
  resolvePromptTemplateDefaultStyleIds,
  selectStepPromptTemplate,
  selectTaskPromptTemplate,
} from './shared/prompt-templates';
import { createViralTemplateDrafts } from './shared/viral-template-extraction';
import { defaultPodcastSpeakersForProvider, defaultTaskSpeakerForProvider, normalizeRuntimeTtsProvider, taskSpeakerLabel, ttsVoiceOptionsForProvider, type RuntimeTtsProvider } from './shared/tts-voices';
import { applyHtmlVideoConfigChanges, classifyHtmlVideoTaskMessage, createHtmlVideoTaskInput, fitHtmlVideoOutputSize, htmlVideoSteps, htmlVideoTabs, htmlVideoVisibleSteps, isHtmlVideoTask, nextHtmlVideoTabKey, parseHtmlVideoPipelineData, safeParseHtmlVideoPipelineData, tabForHtmlVideoStep, taskProgressLabel } from './shared/html-video-workflow';
import {
  HTML_VIDEO_BGM_VOLUMES,
  HTML_VIDEO_JOB_DEFAULTS,
  HTML_VIDEO_RATIOS,
  HTML_VIDEO_TRANSITIONS,
  HTML_VIDEO_TTS_PROVIDERS,
  HTML_VIDEO_TTS_SPEED_MAX,
  HTML_VIDEO_TTS_SPEED_MIN,
} from './shared/html-video-config';
import {
  HTML_VIDEO_COVER_MODES,
  HTML_VIDEO_COVER_RATIOS,
  htmlVideoCoverDimensions,
} from './shared/html-video-cover';
import {
  HTML_VIDEO_CAPTION_ANIMATIONS,
  HTML_VIDEO_CAPTION_COLOR_KEYS,
  HTML_VIDEO_CAPTION_PRESETS,
  htmlVideoCaptionColorsEqual,
  htmlVideoCaptionPickerColor,
  resolveHtmlVideoCaptionStyle,
  validateHtmlVideoCaptionColors,
  type HtmlVideoCaptionAnimation,
  type HtmlVideoCaptionColorOverrides,
  type HtmlVideoCaptionColorKey,
  type HtmlVideoCaptionPreset,
} from './shared/html-video-captions';
import { HTML_VIDEO_CONTROL_MANIFEST_V1 } from './shared/html-video-control-manifest';
import { createHtmlVideoMediaCache, htmlVideoMediaElementKey, htmlVideoMediaElementScopeMatches, htmlVideoMediaStatus, loadHtmlVideoMedia, recordHtmlVideoMediaElementFailure, syncHtmlVideoMediaCache, type HtmlVideoMediaElementFailureState, type HtmlVideoMediaElementScope } from './shared/html-video-media';
import { useAsyncAction, type AsyncActionFeedback } from './ui/async-action';
import './styles.css';

const sampleText =
  '武曌，通称武则天、武后，是中国历史上唯一的女皇帝。武则天十四岁入宫为唐太宗才人，历经十二年不得升迁。唐高宗时复为昭仪，通过废黜王皇后与萧淑妃，得以立为皇后。并尊号为天后，与唐高宗并称二圣。';

function promptTemplatePlaceholder(summary: PromptTemplateSummary): PromptTemplate {
  return { ...summary, content: '' };
}

const initialPromptTemplates = promptTemplateCatalog.map(promptTemplatePlaceholder);

const initialState: AppState = {
  config: defaultConfig,
  secretStatus: {},
  tasks: [],
  events: [],
  viralAnalyses: [],
  viralEvents: [],
  promptTemplates: initialPromptTemplates,
  draftTemplates: builtinDraftTemplates,
  imageLabRecords: [],
  voiceLabRecords: [],
  customStyles: defaultCustomStyles,
  customCoverTemplates: defaultCustomCoverTemplates,
  creditTransactions: defaultCreditTransactions,
  minimaxCloneVoices: defaultMinimaxCloneVoices,
  account: defaultAccount,
  activation: defaultActivation,
  ui: defaultUiPreferences,
};

type NavItem = { view: ShellView; label: string; hint: string; icon: React.ComponentType<{ size?: number }> };

const primaryNavItems: NavItem[] = [
  { view: 'new-task', label: '新建任务', hint: '素材成片', icon: Plus },
  { view: 'book-selection', label: '选品助手', hint: '商品卖点', icon: BookOpen },
  { view: 'benchmark', label: '对标导入', hint: '文案二改', icon: Radar },
  { view: 'person-assets', label: '人物素材库', hint: '真图分镜', icon: Images },
  { view: 'queue', label: '任务队列', hint: '运行进度', icon: ListChecks },
  { view: 'history', label: '历史任务', hint: '本地记录', icon: History },
  { view: 'image-lab', label: '画图实验室', hint: '分镜图片', icon: FlaskConical },
  { view: 'voice-lab', label: '配音实验室', hint: '音色试听', icon: Mic2 },
  { view: 'music-mv', label: '音乐 MV', hint: '歌词成片', icon: Music },
  { view: 'viral-analyzer', label: '爆款拆解', hint: '拉片复刻', icon: Flame },
  { view: 'prompt-templates', label: '提示词模板', hint: '代理提示词', icon: Sparkles },
  { view: 'draft-templates', label: '草稿模板', hint: '剪映画布', icon: LayoutTemplate },
  { view: 'settings', label: '系统设置', hint: 'API 与路径', icon: Settings },
  { view: 'account', label: '账户中心', hint: '资料与积分', icon: Circle },
  { view: 'activation', label: '激活管理', hint: '试用与授权', icon: KeyRound },
];

const secondaryNavItems: NavItem[] = [
  { view: 'html-video', label: 'HTML 动画视频', hint: 'HTML 渲染', icon: Play },
];

const navItems: NavItem[] = [...primaryNavItems, ...secondaryNavItems];

const contentTracks = [
  ['character-story', '人物故事', '历史人物 / 名人传记'],
  ['health-book', '健康图书', '健康养生 / 医学知识'],
  ['culture-science', '文化科普', '华夏文化 / 传统民俗'],
  ['picture-book', '绘本故事', '儿童绘本 / 睡前故事'],
  ['ecommerce', '电商带货', '产品种草 / 好物推荐'],
  ['mind-soup', '心灵鸡汤', '情感治愈 / 励志感悟'],
  ['folk-story', '民间故事', '虚构传说 / 因果寓言'],
  ['general-story', '通用故事', '通用写实风格'],
  ['food-v2', '美食探店V2', '城市街角小店的烟火气'],
];

const styleOptions = [
  ['black-white', '黑白摄影', '纪实感'],
  ['photo-real', '写实彩色', '质感胶片'],
  ['oil-paint', '油画风格', '印象写意'],
  ['modern-film', '现代电影', '宽屏调色'],
  ['ancient-film', '古风电影', '古代史诗'],
  ['retro-film', '复古胶片', '80年代街拍'],
  ['watercolor', '水彩治愈', '柔和晕染'],
  ['magazine', '杂志插画', '极简色块'],
  ['pixar-3d', '皮克斯 3D', '动画质感'],
  ['ink', '中国水墨', '文人意境'],
  ['folk', '民间故事工笔风', '工笔叙事'],
  ['ghibli', '吉卜力', '治愈日漫'],
];
const htmlVideoStyleOptions = styleOptions;

const ratioOptions = ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16'];
const smartImageModeOptions: Array<[ImageLabSmartMode, string, string]> = [
  ['cover', '封面', '短视频主封面'],
  ['blog-cover', '博客封面', '文章首图 / 横版主图'],
  ['podcast-cover', '播客封面', '节目感双人或主题封面'],
  ['video-narration', '旁白视频', '单人讲述主视觉'],
  ['two-host-podcast', '双人播客', '两位主播一问一答'],
  ['reference-edit', '参考图编辑', '参考图一致性改图'],
];
const storyboardSceneCountOptions = [8, 12, 16, 20, 30];
const siliconFlowSpeechToTextBaseUrl = 'https://api.siliconflow.cn/v1';
const siliconFlowSpeechToTextModels = ['FunAudioLLM/SenseVoiceSmall', 'TeleAI/TeleSpeechASR'];
const volcengineVoicePresets = [
  ['Vivi 2.0', 'zh_female_vv_uranus_bigtts'],
  ['云舟 2.0', 'zh_male_m191_uranus_bigtts'],
  ['爽快思思 2.0', 'zh_female_shuangkuaisisi_uranus_bigtts'],
  ['儒雅青年 2.0', 'zh_male_ruyaqingnian_uranus_bigtts'],
  ['悬疑解说 2.0', 'zh_male_xuanyijieshuo_uranus_bigtts'],
] as const;
const pauseOptions: Array<[PausePoint, string]> = [
  ['none', '不暂停'],
  ['critical', '关键节点'],
  ['every-step', '每步确认'],
  ['custom', '自定义'],
];
const rewriteOptions: Array<[RewriteIntensity, string]> = [
  ['standard', '标准改写'],
  ['deep', '深度改写'],
  ['original', '高度原创'],
];
const povOptions = [
  ['keep-original', '保持原文'],
  ['first-person', '第一人称'],
  ['third-person', '第三人称'],
] as const;
const promptTemplateTypeOptions: Array<PromptTemplateType | 'all'> = ['all', 'task', 'review', 'rewrite', 'cover', 'storyboard', 'image-prompt'];
const promptTemplateTypeLabels: Record<PromptTemplateType | 'all', string> = {
  all: '全部类型',
  task: '任务模板',
  review: '预审提示词',
  rewrite: '改写提示词',
  cover: '封面元数据提示词',
  storyboard: '分镜提示词',
  'image-prompt': '出图提示词',
};
type PromptTemplateVariableScope = PromptTemplateType;
const promptTemplateVariableDefinitions = [
  { key: 'inputText', label: '原文素材', description: '新建任务里粘贴或导入的原始文案', scopes: ['task', 'review'] },
  { key: 'title', label: '任务标题', description: '当前任务标题或自动生成标题', scopes: ['task', 'review', 'rewrite', 'cover'] },
  { key: 'sourceContext', label: '联网资料', description: 'AI 搜索或知识库带回来的参考资料', scopes: ['review'] },
  { key: 'reviewedText', label: '预审结果', description: 'Step 0 清洗、去重后的事实素材', scopes: ['rewrite', 'cover'] },
  { key: 'rewrittenCopy', label: '改写正文', description: 'Step 1 改写后的口播文案', scopes: ['storyboard'] },
  { key: 'scenesJson', label: '分镜数据', description: 'Step 2 拆出来的分镜 JSON', scopes: ['image-prompt'] },
  { key: 'track', label: '内容赛道', description: '人物故事、健康图书、电商等赛道', scopes: ['task', 'review', 'rewrite', 'cover', 'storyboard', 'image-prompt'] },
  { key: 'style', label: '画风', description: '任务选择的出图风格', scopes: ['task', 'storyboard', 'image-prompt'] },
  { key: 'ratio', label: '画面比例', description: '9:16、16:9 等画布比例', scopes: ['task', 'storyboard', 'image-prompt'] },
  { key: 'extraRequirements', label: '额外要求', description: '新建任务里填写的补充要求', scopes: ['task', 'review', 'rewrite', 'cover', 'storyboard', 'image-prompt'] },
  { key: 'rewriteIntensity', label: '改写强度', description: '新建任务高级设置里的改写强度', scopes: ['rewrite'] },
  { key: 'narrativePov', label: '叙事视角', description: '新建任务高级设置里的叙事视角', scopes: ['rewrite'] },
  { key: 'keepPromotion', label: '保留带货', description: '新建任务高级设置里的带货保留开关', scopes: ['rewrite', 'cover'] },
  { key: 'aiKeyword', label: 'AI 关键词', description: 'AI 创作模式里的检索关键词', scopes: ['task', 'review', 'rewrite', 'cover'] },
  { key: 'taskTemplateContent', label: '任务模板指令', description: '当前模板的任务总指令渲染结果；不要放在任务总指令内', scopes: ['review', 'rewrite', 'cover', 'storyboard', 'image-prompt'] },
  { key: 'taskTemplateName', label: '任务模板名称', description: '当前故事模板名称', scopes: ['review', 'rewrite', 'cover', 'storyboard', 'image-prompt'] },
  { key: 'defaultStyles', label: '默认画风', description: '当前故事模板绑定的默认图像模板', scopes: ['task', 'storyboard', 'image-prompt'] },
  { key: 'defaultDraftTemplateId', label: '默认草稿模板', description: '当前故事模板绑定的剪映草稿模板 ID', scopes: ['task'] },
  { key: 'characterPolicy', label: '角色档案策略', description: '当前故事模板是否强制提取或跳过角色档案', scopes: ['task', 'image-prompt'] },
  { key: 'step3SkeletonModules', label: 'Step 3 骨架', description: '当前故事模板启用的绘图骨架模块', scopes: ['storyboard', 'image-prompt'] },
  { key: 'referenceKind', label: '参考图类型', description: '当前故事模板使用的人脸、产品或无参考图类型', scopes: ['storyboard', 'image-prompt'] },
  { key: 'stylePrefix', label: '风格前缀', description: '当前图像模板的 prefix，会注入 Step 3 出图提示词', scopes: ['image-prompt'] },
  { key: 'styleSuffix', label: '风格后缀', description: '当前图像模板的 suffix，会注入 Step 3 出图提示词', scopes: ['image-prompt'] },
  { key: 'styleAllowColor', label: '允许色彩词', description: '当前图像模板是否允许在画面里使用具体色彩词', scopes: ['image-prompt'] },
  { key: 'styleNegativePrompt', label: '负面提示词', description: '当前图像模板的 negative prompt', scopes: ['image-prompt'] },
  { key: 'referenceImagePath', label: '参考图路径', description: '新建任务上传或填写的参考图本地路径', scopes: ['image-prompt'] },
  { key: 'imagePromptReference', label: '生图参考', description: '爆款拆解或用户补充的画面参考提示', scopes: ['image-prompt'] },
  { key: 'characterCard', label: '角色档案', description: 'Step 3 前提取出的角色一致性 JSON', scopes: ['image-prompt'] },
  { key: 'imageSeedPoolsJson', label: '图片种子池', description: '当前故事模板携带的 StoryDream 图片种子池 JSON', scopes: ['image-prompt'] },
] satisfies Array<{ key: string; label: string; description: string; scopes: PromptTemplateVariableScope[] }>;
const promptTemplateVariables = promptTemplateVariableDefinitions.map((item) => item.key);
const promptStepEditorDefinitions: Array<{ type: PromptStepTemplateType; label: string; hint: string }> = [
  { type: 'review', label: 'Step 0 预审', hint: '清理输入素材、保留事实顺序、去掉重复表达' },
  { type: 'rewrite', label: 'Step 1 改写', hint: '控制口播文案的语言、节奏和结构' },
  { type: 'cover', label: 'Step 1 元数据', hint: '生成标题、摘要、标签和评论的规则' },
  { type: 'storyboard', label: 'Step 2 分镜', hint: '控制分镜拆句、镜头节奏和场景数量' },
  { type: 'image-prompt', label: 'Step 3 出图', hint: '控制出图提示词、角色一致性和安全规则' },
];
const promptTemplateStep3SkeletonOptions = ['跨年代', '防台词文字', '产品一致性'];
const promptTemplateReferenceOptions: Array<[NonNullable<PromptTemplate['referenceKind']>, string]> = [
  ['none', '无'],
  ['face', '人脸'],
  ['product', '产品'],
];
const fallbackEffectCatalog: JianyingEffectCatalog = {
  status: 'warn',
  detail: '未读取到剪映特效目录，已使用本地基础转场清单。',
  transitions: ['叠化'],
  filters: [],
  videoEffects: [],
  audioEffects: [],
};

const pipelineSteps = [
  { index: 0, title: 'Step 0 预审', hint: '清理广告、重复和敏感表达', agent: 'Reviewer' },
  { index: 1, title: 'Step 1 三轮改写自评', hint: '三轮改写、评分、自评并生成封面信息', agent: 'Writer' },
  { index: 2, title: 'Step 2 分镜', hint: '拆成可配图的镜头单元', agent: 'Storyboard' },
  { index: 3, title: 'Step 3 主角档案与出图提示词', hint: '提取角色档案并生成每镜 prompt', agent: 'Prompt' },
  { index: 4, title: 'Step 4 批量生图', hint: '并发调用 AI 绘图，暂停后可续跑', agent: 'Producer' },
  { index: 5, title: 'Step 5 配音', hint: '生成旁白音频和字幕时间轴', agent: 'TTS' },
  { index: 6, title: 'Step 6 草稿导出', hint: '写入剪映草稿输出目录', agent: 'Draft' },
] as const;

type ApplyMutationResult = (result: AppMutationResult | null) => void;

function taskFromMutation(result: AppMutationResult | null): TaskSummary | null {
  return result?.kind === 'task-upsert' ? result.task : null;
}

function viralFromMutation(result: AppMutationResult | null): ViralAnalysisSummary | null {
  return result?.kind === 'viral-upsert' ? result.record : null;
}

function configFromMutation(result: AppMutationResult | null): AppConfig {
  if (result?.kind === 'state-patch' && result.patch.kind === 'config') return result.patch.config;
  throw new Error('CONFIG_MUTATION_INVALID: Save did not return a config patch.');
}

async function loadCompleteBootstrap(api: StoryDreamApi, bootstrap: BootstrapState): Promise<BootstrapState> {
  const [promptTemplates, draftTemplates] = await Promise.all([
    collectCursorPages(bootstrap.promptTemplates, (cursor) => api.listPromptTemplates({ cursor, limit: 100 })),
    collectCursorPages(bootstrap.draftTemplates, (cursor) => api.listDraftTemplates({ cursor, limit: 100 })),
  ]);
  return {
    ...bootstrap,
    promptTemplates: { items: promptTemplates, nextCursor: null },
    draftTemplates: { items: draftTemplates, nextCursor: null },
  };
}
type ModelListKey = 'llm' | 'gpt-image' | 'custom-image';
type SecretEditor = {
  value: (id: SecretId) => string;
  configured: (id: SecretId) => boolean;
  reference: (id: SecretId) => { value: string; secretId?: string };
  change: (id: SecretId, value: string | null) => void;
};

function profileSecretId(domain: 'llm' | 'image' | 'tts', profileId: string | undefined, suffix: string): SecretId {
  const stableId = profileId?.trim();
  if (!stableId) throw new Error('Provider profile requires a stable id.');
  return `${domain}/${encodeURIComponent(stableId)}/${suffix}` as SecretId;
}
type DraftCanvasLayer = 'image' | 'title' | 'subtitle' | 'caption' | 'disclaimer';
const DRAFT_TEXT_WIDTH_MIN = 0.1;
const DRAFT_TEXT_WIDTH_MAX = 2;
type DraftDragSnapshot =
  | { mode: 'move'; layer: DraftCanvasLayer; pointerId: number; startX: number; startY: number; template: DraftTemplate }
  | { mode: 'resize'; layer: Exclude<DraftCanvasLayer, 'image'>; pointerId: number; startX: number; startY: number; template: DraftTemplate };

function cloneState(state: AppState): AppState {
  return JSON.parse(JSON.stringify(state)) as AppState;
}

function hydrateState(state: Partial<AppState>): AppState {
  return {
    ...cloneState(initialState),
    ...state,
    config: stripConfigSecrets(normalizeAppConfig(state.config ?? defaultConfig)),
    secretStatus: state.secretStatus ?? {},
    tasks: state.tasks ?? [],
    events: state.events ?? [],
    promptTemplates: state.promptTemplates ?? initialPromptTemplates,
    draftTemplates: (state.draftTemplates ?? builtinDraftTemplates).map(normalizeDraftTemplate),
    imageLabRecords: state.imageLabRecords ?? [],
    voiceLabRecords: state.voiceLabRecords ?? [],
    customStyles: mergeDefaultCustomStyles(state.customStyles),
    customCoverTemplates: state.customCoverTemplates ?? defaultCustomCoverTemplates,
    creditTransactions: state.creditTransactions ?? defaultCreditTransactions,
    minimaxCloneVoices: state.minimaxCloneVoices ?? [],
    account: { ...defaultAccount, ...(state.account ?? {}) },
    activation: { ...defaultActivation, ...(state.activation ?? {}) },
    ui: { ...defaultUiPreferences, ...(state.ui ?? {}) },
  };
}

function bootstrapToState(bootstrap: BootstrapState): AppState {
  const draftDefaults = new Map(builtinDraftTemplates.map((template) => [template.id, template]));
  return hydrateState({
    config: bootstrap.config,
    secretStatus: bootstrap.secretStatus,
    tasks: bootstrap.tasks.items.map((task) => taskSummaryToTask(task)),
    events: [],
    viralAnalyses: bootstrap.viralAnalyses.items.map((summary) => viralSummaryToRecord(summary)),
    viralEvents: [],
    promptTemplates: bootstrap.promptTemplates.items.map(promptTemplatePlaceholder),
    draftTemplates: bootstrap.draftTemplates.items.map((summary) => {
      const base = draftDefaults.get(summary.id) ?? builtinDraftTemplates[0];
      return normalizeDraftTemplate({
        ...base,
        id: summary.id,
        name: summary.name,
        isDefault: summary.isDefault,
        updatedAt: summary.updatedAt,
        canvas: { ...base.canvas, ...summary.canvas },
      });
    }),
    imageLabRecords: bootstrap.imageLabRecords.items.map((summary) => imageLabSummaryToRecord(summary)),
    voiceLabRecords: bootstrap.voiceLabRecords.items.map((summary) => voiceLabSummaryToRecord(summary)),
    customStyles: bootstrap.customStyles,
    customCoverTemplates: bootstrap.customCoverTemplates,
    creditTransactions: bootstrap.creditTransactions,
    minimaxCloneVoices: bootstrap.minimaxCloneVoices,
    account: bootstrap.account,
    activation: bootstrap.activation,
    ui: bootstrap.ui,
  });
}

function mergeDeltaView(current: AppState, deltaState: DeltaViewState): AppState {
  return mergeDeltaViewSlices(current, deltaState);
}

type HistoryDeltaIdentity = { family: HistoryFamily; id: string; tombstone: boolean };
type HistoryFamilyEpochs = Partial<Record<HistoryFamily, number>>;

const allHistoryFamilies: readonly HistoryFamily[] = ['task', 'viral-analysis', 'image-lab', 'voice-lab'];
const MAX_TASK_DETAIL_REVISION_ATTEMPTS = 3;

function advanceHistoryFamilyEpochs(
  current: HistoryFamilyEpochs,
  families: readonly HistoryFamily[],
): HistoryFamilyEpochs {
  let next = current;
  for (const family of families) {
    if (next === current) next = { ...current };
    next[family] = (current[family] ?? 0) + 1;
  }
  return next;
}

function historyDeltaIdentity(delta: AppDelta): HistoryDeltaIdentity | null {
  if (delta.kind === 'task-upsert') return { family: 'task', id: delta.task.id, tombstone: false };
  if (delta.kind === 'viral-upsert') return { family: 'viral-analysis', id: delta.record.id, tombstone: false };
  if (delta.kind === 'task-tombstone') return { family: 'task', id: delta.id, tombstone: true };
  if (delta.kind === 'viral-tombstone') return { family: 'viral-analysis', id: delta.id, tombstone: true };
  if (delta.kind === 'image-lab-tombstone') return { family: 'image-lab', id: delta.id, tombstone: true };
  if (delta.kind === 'voice-lab-tombstone') return { family: 'voice-lab', id: delta.id, tombstone: true };
  if (delta.kind !== 'state-patch') return null;
  if (delta.patch.kind === 'image-lab-upsert') {
    return { family: 'image-lab', id: delta.patch.record.id, tombstone: false };
  }
  if (delta.patch.kind === 'voice-lab-upsert') {
    return { family: 'voice-lab', id: delta.patch.record.id, tombstone: false };
  }
  return null;
}

function recordHistoryDeltaRevision(
  entityRevisions: Map<string, number>,
  tombstoneRevisions: Map<string, number>,
  delta: AppDelta,
): HistoryDeltaIdentity | null {
  const identity = historyDeltaIdentity(delta);
  if (!identity) return null;
  const key = historyEntityRevisionKey(identity.family, identity.id);
  const entityRevision = entityRevisions.get(key) ?? -1;
  const tombstoneRevision = tombstoneRevisions.get(key) ?? -1;
  if (identity.tombstone) {
    if (delta.revision < entityRevision || delta.revision <= tombstoneRevision) return null;
    entityRevisions.delete(key);
    tombstoneRevisions.set(key, delta.revision);
    return identity;
  }
  if (tombstoneRevision >= 0 || delta.revision <= entityRevision) return null;
  entityRevisions.set(key, delta.revision);
  return identity;
}

function registerHistoryDeltaBarrier(
  entityRevisions: Map<string, number>,
  tombstoneRevisions: Map<string, number>,
  delta: AppDelta,
  invalidate: (family: HistoryFamily, id: string) => void,
  accepted?: (family: HistoryFamily) => void,
): void {
  const identity = recordHistoryDeltaRevision(entityRevisions, tombstoneRevisions, delta);
  if (!identity) return;
  accepted?.(identity.family);
  if (identity.tombstone) invalidate(identity.family, identity.id);
}

function replaceHistoryRevisionMap(target: Map<string, number>, ledger: HistoryRevisionLedger | undefined): void {
  for (const [family, revisions] of Object.entries(ledger ?? {}) as Array<[HistoryFamily, Record<string, number>]>) {
    for (const [id, revision] of Object.entries(revisions)) {
      const key = historyEntityRevisionKey(family, id);
      target.set(key, Math.max(target.get(key) ?? -1, revision));
    }
  }
}

function captureHistoryResponseRevision(
  family: HistoryFamily,
  id: string,
  entityRevisions: Map<string, number>,
  tombstoneRevisions: Map<string, number>,
): HistoryResponseRevision {
  const key = historyEntityRevisionKey(family, id);
  return {
    entityRevision: entityRevisions.get(key) ?? -1,
    tombstoneRevision: tombstoneRevisions.get(key) ?? -1,
  };
}

function isHistoryResponseCurrent(
  family: HistoryFamily,
  id: string,
  captured: HistoryResponseRevision,
  entityRevisions: Map<string, number>,
  tombstoneRevisions: Map<string, number>,
): boolean {
  const current = captureHistoryResponseRevision(family, id, entityRevisions, tombstoneRevisions);
  return captured.tombstoneRevision < 0
    && current.entityRevision === captured.entityRevision
    && current.tombstoneRevision === captured.tombstoneRevision;
}

function mergeDefaultCustomStyles(styles: CustomStyle[] | undefined): CustomStyle[] {
  const current = new Map((styles ?? []).map((style) => [style.id, style]));
  const builtinIds = new Set(defaultCustomStyles.map((style) => style.id));
  return [
    ...defaultCustomStyles.map((style) => current.get(style.id) ?? style),
    ...(styles ?? []).filter((style) => !builtinIds.has(style.id)),
  ];
}

type FallbackTombstoneEntry = {
  revision: number;
  cleanupState: 'unmanaged-legacy';
};

type FallbackGovernanceState = {
  revision: number;
  tombstones: Partial<Record<HistoryFamily, Record<string, FallbackTombstoneEntry>>>;
};

function fallbackTombstoneResult(
  family: HistoryFamily,
  id: string,
  revision: number,
): AppMutationResult {
  switch (family) {
    case 'task':
      return { kind: 'task-tombstone', id, revision };
    case 'viral-analysis':
      return { kind: 'viral-tombstone', id, revision };
    case 'image-lab':
      return { kind: 'image-lab-tombstone', id, revision };
    case 'voice-lab':
      return { kind: 'voice-lab-tombstone', id, revision };
  }
}

const fallbackGovernanceStorageKey = 'storydream-history-governance-v1';
const fallbackEnvelopeVersion = 1 as const;

type FallbackStorageEnvelope = FallbackGovernanceState & {
  version: typeof fallbackEnvelopeVersion;
  state: AppState;
};

function parseFallbackGovernance(value: unknown): FallbackGovernanceState {
  const empty: FallbackGovernanceState = { revision: 0, tombstones: {} };
  if (!value || typeof value !== 'object') return empty;
  const parsed = value as Partial<FallbackGovernanceState>;
  const revision = Number.isSafeInteger(parsed.revision) && Number(parsed.revision) >= 0
    ? Number(parsed.revision)
    : 0;
  const tombstones: FallbackGovernanceState['tombstones'] = {};
  for (const family of ['task', 'viral-analysis', 'image-lab', 'voice-lab'] as HistoryFamily[]) {
    const incoming = parsed.tombstones?.[family];
    if (!incoming || typeof incoming !== 'object') continue;
    for (const [id, entry] of Object.entries(incoming)) {
      if (!Number.isSafeInteger(entry?.revision) || entry.revision < 0) continue;
      (tombstones[family] ??= {})[id] = {
        revision: entry.revision,
        cleanupState: 'unmanaged-legacy',
      };
    }
  }
  return { revision, tombstones };
}

function readFallbackEnvelope(): FallbackStorageEnvelope {
  let stored: Partial<FallbackStorageEnvelope> | null = null;
  const rawEnvelope = localStorage.getItem(fallbackGovernanceStorageKey);
  if (rawEnvelope) {
    try {
      stored = JSON.parse(rawEnvelope) as Partial<FallbackStorageEnvelope>;
    } catch {
      stored = null;
    }
  }
  const governance = parseFallbackGovernance(stored);
  let sourceState: AppState;
  if (stored?.version === fallbackEnvelopeVersion && stored.state && typeof stored.state === 'object') {
    sourceState = hydrateState(stored.state as AppState);
  } else {
    const rawState = localStorage.getItem('storydream-state') ?? localStorage.getItem('storybound-state');
    sourceState = rawState ? hydrateState(JSON.parse(rawState) as AppState) : cloneState(initialState);
  }
  const filtered = filterFallbackTombstones(sourceState, governance);
  return {
    version: fallbackEnvelopeVersion,
    ...governance,
    state: { ...filtered, config: stripConfigSecrets(filtered.config), secretStatus: {} },
  };
}

function commitFallbackEnvelope(envelope: FallbackStorageEnvelope): void {
  // One synchronous tab-local write; localStorage provides neither cross-tab CAS nor crash transactions.
  localStorage.setItem(fallbackGovernanceStorageKey, JSON.stringify(envelope));
}

function filterFallbackTombstones(state: AppState, governance: FallbackGovernanceState): AppState {
  const deleted = (family: HistoryFamily, id: string) => Boolean(governance.tombstones[family]?.[id]);
  return {
    ...state,
    tasks: state.tasks.filter((task) => !deleted('task', task.id)),
    events: state.events.filter((event) => !deleted('task', event.taskId)),
    viralAnalyses: state.viralAnalyses.filter((record) => !deleted('viral-analysis', record.id)),
    viralEvents: state.viralEvents.filter((event) => !deleted('viral-analysis', event.analysisId)),
    imageLabRecords: state.imageLabRecords.filter((record) => !deleted('image-lab', record.id)),
    voiceLabRecords: state.voiceLabRecords.filter((record) => !deleted('voice-lab', record.id)),
  };
}

function fallbackHistoryPage<F extends HistoryFamily, T>(family: F, items: T[]): HistoryPage<F, T> {
  return {
    family,
    items,
    totalCount: items.length,
    hasMore: false,
    nextCursor: null,
  };
}

function makeFallbackApi(setState: (state: AppState) => void): StoryDreamApi {
  const readEnvelope = () => readFallbackEnvelope();
  const read = () => readEnvelope().state;
  const commitState = (state: AppState, governance: FallbackGovernanceState): AppState => {
    const filtered = filterFallbackTombstones(hydrateState(state), governance);
    const sanitized = { ...filtered, config: stripConfigSecrets(filtered.config), secretStatus: {} };
    commitFallbackEnvelope({ version: fallbackEnvelopeVersion, ...governance, state: sanitized });
    setState(sanitized);
    return sanitized;
  };
  const loadFallbackPromptTemplates = async (): Promise<AppState> => {
    const defaults = await loadDefaultPromptTemplates();
    const envelope = readEnvelope();
    const custom = envelope.state.promptTemplates.filter((template) => !template.isBuiltin);
    const next = { ...envelope.state, promptTemplates: [...defaults, ...custom] as PromptTemplate[] };
    if (!changed(envelope.state.promptTemplates, next.promptTemplates)) return envelope.state;
    return commitState(next, { revision: envelope.revision, tombstones: envelope.tombstones });
  };
  const readBookSelections = () => {
    const raw = localStorage.getItem('storybound-book-selections');
    if (!raw) return [] as BookSelectionRecord[];
    try {
      return JSON.parse(raw) as BookSelectionRecord[];
    } catch {
      return [] as BookSelectionRecord[];
    }
  };
  const writeBookSelections = (records: BookSelectionRecord[]) => {
    localStorage.setItem('storybound-book-selections', JSON.stringify(records));
    return records;
  };
  const changed = (left: unknown, right: unknown) => JSON.stringify(left) !== JSON.stringify(right);
  const mutationForState = (previous: AppState, next: AppState, revision: number): AppMutationResult | null => {
    const task = next.tasks.find((item) => {
      const old = previous.tasks.find((candidate) => candidate.id === item.id);
      return !old || changed(old, item);
    });
    if (task) return { kind: 'task-upsert', task: taskToSummary(task), revision };
    const viral = next.viralAnalyses.find((item) => {
      const old = previous.viralAnalyses.find((candidate) => candidate.id === item.id);
      return !old || changed(old, item);
    });
    if (viral) {
      const { settings: _settings, resultPath: _resultPath, videoPath: _videoPath, ...record } = viral;
      return { kind: 'viral-upsert', record, revision };
    }
    let patch: Extract<AppDelta, { kind: 'state-patch' }>['patch'] | null = null;
    if (changed(previous.config, next.config) && changed(previous.ui, next.ui)) {
      patch = { kind: 'theme-preference', config: next.config, ui: next.ui };
    } else if (changed(previous.config, next.config)) patch = { kind: 'config', config: next.config, secretStatus: {} };
    else if (changed(previous.promptTemplates, next.promptTemplates)) {
      const changedTemplates = next.promptTemplates.filter((template) => {
        const old = previous.promptTemplates.find((candidate) => candidate.id === template.id);
        return !old || changed(old, template);
      });
      patch = changedTemplates.length === 1
        ? { kind: 'prompt-template-upsert', template: changedTemplates[0] }
        : {
            kind: 'prompt-templates-reset',
            templates: next.promptTemplates.filter((template) => template.isBuiltin).map(({ content: _content, stepPrompts: _steps, imageSeedPoolsJson: _seeds, ...summary }) => summary),
          };
    } else if (changed(previous.customStyles, next.customStyles)) {
      const style = next.customStyles.find((item) => !previous.customStyles.some((old) => old.id === item.id && !changed(old, item)));
      if (style) patch = { kind: 'custom-style-upsert', style };
    } else if (changed(previous.draftTemplates, next.draftTemplates)) {
      const template = next.draftTemplates.find((item) => !previous.draftTemplates.some((old) => old.id === item.id && !changed(old, item)));
      if (template) patch = { kind: 'draft-template-upsert', template };
    } else if (changed(previous.imageLabRecords, next.imageLabRecords) && next.imageLabRecords[0]) {
      const { prompt, referenceImagePaths: _paths, referenceImagePath: _path, ...record } = next.imageLabRecords[0];
      patch = { kind: 'image-lab-upsert', record: { ...record, promptPreview: prompt.slice(0, 160) } };
    } else if (changed(previous.voiceLabRecords, next.voiceLabRecords) && next.voiceLabRecords[0]) {
      const { text, ...record } = next.voiceLabRecords[0];
      patch = { kind: 'voice-lab-upsert', record: { ...record, textPreview: text.slice(0, 160) } };
    } else if (changed(previous.account, next.account)) patch = { kind: 'account', account: next.account };
    else if (changed(previous.activation, next.activation)) patch = { kind: 'activation', activation: next.activation };
    else if (changed(previous.ui, next.ui)) patch = { kind: 'ui', ui: next.ui };
    return patch ? { kind: 'state-patch', patch, revision } : null;
  };
  const persist = (state: AppState): AppMutationResult | null => {
    const previous = readEnvelope();
    const next = filterFallbackTombstones(hydrateState(state), previous);
    const sanitized = { ...next, config: stripConfigSecrets(next.config), secretStatus: {} };
    const revision = previous.revision + 1;
    const mutation = mutationForState(previous.state, sanitized, revision);
    commitState(sanitized, {
      revision: mutation ? revision : previous.revision,
      tombstones: previous.tombstones,
    });
    return mutation;
  };

  const historyRecord = (state: AppState, family: HistoryFamily, id: string) => {
    if (family === 'task') return state.tasks.find((record) => record.id === id);
    if (family === 'viral-analysis') return state.viralAnalyses.find((record) => record.id === id);
    if (family === 'image-lab') return state.imageLabRecords.find((record) => record.id === id);
    return state.voiceLabRecords.find((record) => record.id === id);
  };

  const commitFallbackHistoryUpsert = (
    family: HistoryFamily,
    state: AppState,
    id: string,
  ): AppMutationResult => {
    const current = readEnvelope();
    const revision = current.revision + 1;
    const saved = commitState(state, { revision, tombstones: current.tombstones });
    if (family === 'task') {
      const task = saved.tasks.find((record) => record.id === id);
      if (!task) throw new Error(`Task not found: ${id}`);
      return { kind: 'task-upsert', task: taskToSummary(task), revision };
    }
    if (family === 'viral-analysis') {
      const record = saved.viralAnalyses.find((item) => item.id === id);
      if (!record) throw new Error(`Viral analysis not found: ${id}`);
      const { settings: _settings, resultPath: _resultPath, videoPath: _videoPath, ...summary } = record;
      return { kind: 'viral-upsert', record: summary, revision };
    }
    if (family === 'image-lab') {
      const record = saved.imageLabRecords.find((item) => item.id === id);
      if (!record) throw new Error(`Image lab record not found: ${id}`);
      const { prompt, referenceImagePaths: _paths, referenceImagePath: _path, ...summary } = record;
      return {
        kind: 'state-patch',
        patch: { kind: 'image-lab-upsert', record: { ...summary, promptPreview: prompt.slice(0, 160) } },
        revision,
      };
    }
    const record = saved.voiceLabRecords.find((item) => item.id === id);
    if (!record) throw new Error(`Voice lab record not found: ${id}`);
    const { text, ...summary } = record;
    return {
      kind: 'state-patch',
      patch: { kind: 'voice-lab-upsert', record: { ...summary, textPreview: text.slice(0, 160) } },
      revision,
    };
  };

  const archiveFallbackHistory = (family: HistoryFamily, id: string): AppMutationResult => {
    const state = read();
    const record = historyRecord(state, family, id);
    if (!record) throw new Error(`History record not found or deleted: ${family}/${id}`);
    if ((family === 'task' || family === 'viral-analysis')
      && (record.status === 'pending' || record.status === 'running')) {
      throw new Error('HISTORY_ACTIVE: Pending or running history cannot be archived.');
    }
    const archivedAt = record.archivedAt ?? new Date().toISOString();
    if (family === 'task') {
      return commitFallbackHistoryUpsert(family, {
        ...state,
        tasks: state.tasks.map((item) => item.id === id ? { ...item, archivedAt } : item),
      }, id);
    }
    if (family === 'viral-analysis') {
      return commitFallbackHistoryUpsert(family, {
        ...state,
        viralAnalyses: state.viralAnalyses.map((item) => item.id === id ? { ...item, archivedAt } : item),
      }, id);
    }
    if (family === 'image-lab') {
      return commitFallbackHistoryUpsert(family, {
        ...state,
        imageLabRecords: state.imageLabRecords.map((item) => item.id === id ? { ...item, archivedAt } : item),
      }, id);
    }
    return commitFallbackHistoryUpsert(family, {
      ...state,
      voiceLabRecords: state.voiceLabRecords.map((item) => item.id === id ? { ...item, archivedAt } : item),
    }, id);
  };

  const restoreFallbackHistory = (family: HistoryFamily, id: string): AppMutationResult => {
    const state = read();
    if (!historyRecord(state, family, id)) throw new Error(`History record not found or deleted: ${family}/${id}`);
    if (family === 'task') {
      return commitFallbackHistoryUpsert(family, {
        ...state,
        tasks: state.tasks.map((item) => item.id === id ? { ...item, archivedAt: null } : item),
      }, id);
    }
    if (family === 'viral-analysis') {
      return commitFallbackHistoryUpsert(family, {
        ...state,
        viralAnalyses: state.viralAnalyses.map((item) => item.id === id ? { ...item, archivedAt: null } : item),
      }, id);
    }
    if (family === 'image-lab') {
      return commitFallbackHistoryUpsert(family, {
        ...state,
        imageLabRecords: state.imageLabRecords.map((item) => item.id === id ? { ...item, archivedAt: null } : item),
      }, id);
    }
    return commitFallbackHistoryUpsert(family, {
      ...state,
      voiceLabRecords: state.voiceLabRecords.map((item) => item.id === id ? { ...item, archivedAt: null } : item),
    }, id);
  };

  const deleteFallbackHistory = (family: HistoryFamily, id: string): AppMutationResult => {
    const current = readEnvelope();
    const existing = current.tombstones[family]?.[id];
    if (existing) return fallbackTombstoneResult(family, id, existing.revision);
    const state = current.state;
    const record = historyRecord(state, family, id);
    if (!record) throw new Error(`History record not found: ${family}/${id}`);
    if (!record.archivedAt) throw new Error('HISTORY_NOT_ARCHIVED: Permanent deletion requires an archived history record.');
    const revision = current.revision + 1;
    const entry: FallbackTombstoneEntry = { revision, cleanupState: 'unmanaged-legacy' };
    const tombstones = {
      ...current.tombstones,
      [family]: { ...current.tombstones[family], [id]: entry },
    };
    commitState(state, { revision, tombstones });
    return fallbackTombstoneResult(family, id, revision);
  };

  const matchesArchiveFilter = (record: { archivedAt?: string | null }, filter: 'active' | 'archived' = 'active') => (
    filter === 'archived' ? Boolean(record.archivedAt) : !record.archivedAt
  );
  const matchesFallbackQuery = (query: string | undefined, values: unknown[]) => {
    const normalized = query?.trim().toLocaleLowerCase();
    return !normalized || values.some((value) => String(value ?? '').toLocaleLowerCase().includes(normalized));
  };

  return {
    async getState() {
      return loadFallbackPromptTemplates();
    },
    async getBootstrap() {
      const state = await loadFallbackPromptTemplates();
      const envelope = readEnvelope();
      return {
        revision: envelope.revision,
        config: state.config,
        secretStatus: {},
        tasks: fallbackHistoryPage('task', state.tasks.filter((record) => !record.archivedAt).map(taskToSummary)),
        viralAnalyses: fallbackHistoryPage('viral-analysis', state.viralAnalyses.filter((record) => !record.archivedAt)),
        imageLabRecords: fallbackHistoryPage(
          'image-lab',
          state.imageLabRecords.filter((record) => !record.archivedAt).map(({ prompt, referenceImagePaths: _paths, referenceImagePath: _path, ...record }) => ({ ...record, promptPreview: prompt.slice(0, 160) })),
        ),
        voiceLabRecords: fallbackHistoryPage(
          'voice-lab',
          state.voiceLabRecords.filter((record) => !record.archivedAt).map(({ text, ...record }) => ({ ...record, textPreview: text.slice(0, 160) })),
        ),
        promptTemplates: {
          items: state.promptTemplates.map(({ content: _content, stepPrompts: _steps, imageSeedPoolsJson: _seeds, ...summary }) => summary),
          nextCursor: null,
        },
        draftTemplates: {
          items: state.draftTemplates.map((template) => ({
            id: template.id,
            name: template.name,
            isDefault: template.isDefault,
            canvas: { width: template.canvas.width, height: template.canvas.height, ratio: template.canvas.ratio },
            updatedAt: '',
          })),
          nextCursor: null,
        },
        customStyles: state.customStyles,
        customCoverTemplates: state.customCoverTemplates,
        creditTransactions: state.creditTransactions,
        minimaxCloneVoices: state.minimaxCloneVoices,
        account: state.account,
        activation: state.activation,
        ui: state.ui,
      } satisfies BootstrapState;
    },
    async reconcileDeltas(input) {
      const envelope = readEnvelope();
      const state = envelope.state;
      const revision = envelope.revision;
      return {
        revision,
        deltas: [],
        resetRequired: input.forceReset === true || input.sinceRevision < revision,
        task: input.taskId ? state.tasks.find((task) => task.id === input.taskId) ?? null : null,
        taskEvents: input.taskId
          ? state.events.filter((event) => event.taskId === input.taskId && Number.isInteger(event.seq)) as Array<TaskEvent & { seq: number }>
          : [],
        viralAnalysis: input.viralAnalysisId ? state.viralAnalyses.find((record) => record.id === input.viralAnalysisId) ?? null : null,
        viralEvents: input.viralAnalysisId ? state.viralEvents.filter((event) => event.analysisId === input.viralAnalysisId) : [],
      };
    },
    async listTasks(request: HistoryListInput<'task'> = {}) {
      const tasks = read().tasks.filter((task) => {
        if (!matchesArchiveFilter(task, request.filter)) return false;
        if (request.status && task.status !== request.status) return false;
        if (request.statuses && !request.statuses.includes(task.status)) return false;
        const taskType = task.taskType?.trim() || (task.taskKind === 'music-mv' ? 'music-mv' : 'story');
        if (request.taskType && taskType !== request.taskType) return false;
        return matchesFallbackQuery(request.query, [task.title, task.inputText, task.aiKeyword]);
      });
      return fallbackHistoryPage('task', tasks.map(taskToSummary));
    },
    async archiveTask(id: string) {
      return archiveFallbackHistory('task', id);
    },
    async restoreTask(id: string) {
      return restoreFallbackHistory('task', id);
    },
    async deleteTaskPermanently(id: string) {
      return deleteFallbackHistory('task', id);
    },
    async getTaskDetail(id) {
      return read().tasks.find((task) => task.id === id) ?? null;
    },
    async listTaskEvents(taskId) {
      return {
        items: read().events.filter((event) => event.taskId === taskId && Number.isInteger(event.seq)) as Array<TaskEvent & { seq: number }>,
        nextCursor: null,
      };
    },
    async openTaskOutputDirectory() {
      throw new Error('浏览器预览不能打开本地任务目录，请在 Electron 桌面端操作。');
    },
    async listViralAnalyses(request: HistoryListInput<'viral-analysis'> = {}) {
      const records = read().viralAnalyses.filter((record) => (
        matchesArchiveFilter(record, request.filter)
        && (!request.status || record.status === request.status)
        && matchesFallbackQuery(request.query, [record.title, record.url, record.platform])
      ));
      return fallbackHistoryPage('viral-analysis', records);
    },
    async archiveViralAnalysis(id: string) {
      return archiveFallbackHistory('viral-analysis', id);
    },
    async restoreViralAnalysis(id: string) {
      return restoreFallbackHistory('viral-analysis', id);
    },
    async deleteViralAnalysisPermanently(id: string) {
      return deleteFallbackHistory('viral-analysis', id);
    },
    async getViralAnalysisDetail(id) {
      return read().viralAnalyses.find((record) => record.id === id) ?? null;
    },
    async listViralEvents(analysisId) {
      return { items: read().viralEvents.filter((event) => event.analysisId === analysisId), nextCursor: null };
    },
    async listImageLabRecords(request: HistoryListInput<'image-lab'> = {}) {
      return fallbackHistoryPage(
        'image-lab',
        read().imageLabRecords
          .filter((record) => (
            matchesArchiveFilter(record, request.filter)
            && (!request.status || record.status === request.status)
            && matchesFallbackQuery(request.query, [record.prompt, record.provider, record.style])
          ))
          .map(({ prompt, referenceImagePaths: _paths, referenceImagePath: _path, ...record }) => ({ ...record, promptPreview: prompt.slice(0, 160) })),
      );
    },
    async archiveImageLabRecord(id: string) {
      return archiveFallbackHistory('image-lab', id);
    },
    async restoreImageLabRecord(id: string) {
      return restoreFallbackHistory('image-lab', id);
    },
    async deleteImageLabRecordPermanently(id: string) {
      return deleteFallbackHistory('image-lab', id);
    },
    async getImageLabRecordDetail(id) {
      return read().imageLabRecords.find((record) => record.id === id) ?? null;
    },
    async listVoiceLabRecords(request: HistoryListInput<'voice-lab'> = {}) {
      return fallbackHistoryPage(
        'voice-lab',
        read().voiceLabRecords
          .filter((record) => (
            matchesArchiveFilter(record, request.filter)
            && (!request.status || record.status === request.status)
            && matchesFallbackQuery(request.query, [record.text, record.voiceLabel, record.provider])
          ))
          .map(({ text, ...record }) => ({ ...record, textPreview: text.slice(0, 160) })),
      );
    },
    async archiveVoiceLabRecord(id: string) {
      return archiveFallbackHistory('voice-lab', id);
    },
    async restoreVoiceLabRecord(id: string) {
      return restoreFallbackHistory('voice-lab', id);
    },
    async deleteVoiceLabRecordPermanently(id: string) {
      return deleteFallbackHistory('voice-lab', id);
    },
    async getVoiceLabRecordDetail(id) {
      return read().voiceLabRecords.find((record) => record.id === id) ?? null;
    },
    async listPromptTemplates() {
      const state = await loadFallbackPromptTemplates();
      return {
        items: state.promptTemplates.map(({ content: _content, stepPrompts: _steps, imageSeedPoolsJson: _seeds, ...summary }) => summary),
        nextCursor: null,
      };
    },
    async getPromptTemplateDetail(id) {
      return (await loadFallbackPromptTemplates()).promptTemplates.find((template) => template.id === id) ?? null;
    },
    async listDraftTemplates() {
      return {
        items: read().draftTemplates.map((template) => ({
          id: template.id,
          name: template.name,
          isDefault: template.isDefault,
          canvas: { width: template.canvas.width, height: template.canvas.height, ratio: template.canvas.ratio },
          updatedAt: '',
        })),
        nextCursor: null,
      };
    },
    async getDraftTemplateDetail(id) {
      return read().draftTemplates.find((template) => template.id === id) ?? null;
    },
    async saveConfig(input) {
      if (Object.keys(input.secretChanges).length > 0) {
        throw new Error('浏览器预览不会安全保存接口密钥，请在 Electron 桌面端配置并保存。');
      }
      return persist({ ...read(), config: input.config });
    },
    async testLlmConfig(config) {
      const endpoint =
        config.protocol === 'anthropic'
          ? `${config.baseUrl || 'https://api.anthropic.com'}/v1/messages`
          : `${config.baseUrl || 'https://api.openai.com'}/v1/chat/completions`;
      return {
        status: config.apiKey ? 'warn' : 'fail',
        detail: config.apiKey ? '浏览器预览无法调用模型测试接口，请在 Electron 桌面端测试。' : '接口密钥未填写，请先补全模型凭证。',
        latencyMs: 0,
        model: config.model,
        endpoint,
        requestId: null,
      };
    },
    async listProviderModels(request) {
      const baseUrl = request.baseUrl.trim().replace(/\/+$/, '');
      const endpoint = `${baseUrl || (request.protocol === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com')}/v1/models`;
      return {
        status: 'warn',
        detail: '浏览器预览无法安全加载模型列表，请在 Electron 桌面端使用。',
        latencyMs: 0,
        endpoint,
        models: [],
      };
    },
    async listVolcengineSpeakers() {
      const speakers = volcengineVoicePresets.map(([name, voiceType]) => ({ voiceType, name }));
      return {
        status: 'warn',
        detail: '浏览器预览无法调用火山 OpenAPI，已展示本地预设音色。请在 Electron 桌面端加载全部音色。',
        latencyMs: 0,
        endpoint: 'https://open.volcengineapi.com/?Action=ListSpeakers&Version=2025-05-20',
        speakers,
        total: speakers.length,
        requestId: null,
      };
    },
    async testAppConfig(target, config) {
      return validateConfigTarget(target, config);
    },
    async searchWebSources(query) {
      return {
        query,
        sections: [],
        warnings: ['浏览器预览无法直接抓取网页正文，请在 Electron 桌面端使用搜索。'],
      };
    },
    async composeResearchCopy() {
      throw new Error('浏览器预览无法调用真实 LLM 生成文案，请在 Electron 桌面端配置模型后使用。');
    },
    async savePromptTemplate(template: PromptTemplate) {
      const state = read();
      const next = state.promptTemplates.filter((item) => item.id !== template.id);
      return persist({ ...state, promptTemplates: [{ ...template, updatedAt: new Date().toISOString() }, ...next] });
    },
    async resetPromptTemplates() {
      const state = read();
      const custom = state.promptTemplates.filter((template) => !template.isBuiltin);
      const defaults = await loadDefaultPromptTemplates();
      return persist({ ...state, promptTemplates: [...defaults, ...custom] as PromptTemplate[] });
    },
    async saveCustomStyle(style: CustomStyle) {
      const state = read();
      const next = state.customStyles.filter((item) => item.id !== style.id);
      const now = new Date().toISOString();
      return persist({ ...state, customStyles: [{ ...style, updatedAt: now, createdAt: style.createdAt || now }, ...next] });
    },
    async generateCustomStyleDraft(input) {
      return { ...input.baseStyle, ...buildImageStyleDraftFromPrompt(input.prompt, input.baseStyle) };
    },
    async saveDraftTemplate(template: DraftTemplate) {
      const state = read();
      const exists = state.draftTemplates.some((item) => item.id === template.id);
      const templates = exists ? state.draftTemplates.map((item) => (item.id === template.id ? template : item)) : [template, ...state.draftTemplates];
      return persist({ ...state, draftTemplates: templates });
    },
    async generateImageLab(input: ImageLabGenerateInput) {
      const state = read();
      const now = new Date().toISOString();
      const record: ImageLabRecord = {
        id: input.id ?? crypto.randomUUID(),
        prompt: input.prompt,
        ratio: input.ratio,
        style: input.style,
        provider: state.config.imageProvider,
        imagePath: '',
        status: 'failed',
        errorMessage: '浏览器预览无法调用真实生图模型，请在 Electron 桌面端使用。',
        resolution: input.resolution ?? activeImageResolution(state.config),
        smartMode: input.smartMode ?? 'text-to-image',
        referenceImagePaths: input.referenceImagePaths?.length ? input.referenceImagePaths : input.referenceImagePath ? [input.referenceImagePath] : [],
        referenceImagePath: input.referenceImagePath ?? '',
        upstreamTaskId: input.upstreamTaskId ?? null,
        createdAt: input.createdAt ?? now,
        finishedAt: now,
      };
      return persist({ ...state, imageLabRecords: [record, ...state.imageLabRecords] });
    },
    async generateVoiceLabPreview(input: VoiceLabGenerateInput) {
      const state = read();
      const now = new Date().toISOString();
      const record: VoiceLabRecord = {
        id: input.id ?? crypto.randomUUID(),
        text: input.text,
        provider: input.provider,
        voiceId: input.voiceId,
        voiceLabel: input.voiceLabel ?? taskSpeakerLabel(input.provider, input.voiceId),
        speed: input.speed,
        audioPath: '',
        status: 'failed',
        errorMessage: '浏览器预览不能调用真实 TTS，请在 Electron 桌面端生成试听。',
        createdAt: input.createdAt ?? now,
        finishedAt: now,
      };
      return persist({ ...state, voiceLabRecords: [record, ...state.voiceLabRecords] });
    },
    async addImageLabRecord(input: Partial<ImageLabRecord> & Pick<ImageLabRecord, 'prompt' | 'ratio' | 'style' | 'provider'>) {
      const state = read();
      const now = new Date().toISOString();
      const record: ImageLabRecord = {
        id: input.id ?? crypto.randomUUID(),
        prompt: input.prompt,
        ratio: input.ratio,
        style: input.style,
        provider: input.provider,
        imagePath: input.imagePath ?? '',
        status: input.status ?? 'failed',
        errorMessage: input.errorMessage ?? '',
        resolution: input.resolution ?? '2K',
        smartMode: input.smartMode ?? 'text-to-image',
        referenceImagePaths: input.referenceImagePaths?.length ? input.referenceImagePaths : input.referenceImagePath ? [input.referenceImagePath] : [],
        referenceImagePath: input.referenceImagePath ?? '',
        upstreamTaskId: input.upstreamTaskId ?? null,
        createdAt: input.createdAt ?? now,
        finishedAt: input.finishedAt ?? now,
      };
      return persist({ ...state, imageLabRecords: [record, ...state.imageLabRecords] });
    },
    async saveAccount(account: AccountProfile) {
      return persist({ ...read(), account });
    },
    async saveActivation(activation: ActivationState) {
      return persist({ ...read(), activation });
    },
    async saveUiPreferences(update: UiPreferencesUpdate) {
      const current = read();
      const ui = {
        ...current.ui,
        ...update,
        themePreferenceVersion: 1 as const,
      };
      return persist({ ...current, ui, config: { ...current.config, ui: { theme: ui.theme } } });
    },
    async listBookSelections(theme) {
      const records = readBookSelections();
      return theme ? records.filter((record) => record.theme === theme) : records;
    },
    async saveBookSelection(input) {
      const records = readBookSelections();
      const record = { theme: input.theme, bookId: input.bookId ?? `b-${Date.now()}`, data: input.data, updatedAt: Date.now() };
      writeBookSelections([record, ...records.filter((item) => !(item.theme === record.theme && item.bookId === record.bookId))]);
      return record;
    },
    async deleteBookSelection(theme, bookId) {
      writeBookSelections(readBookSelections().filter((record) => !(record.theme === theme && record.bookId === bookId)));
      return undefined;
    },
    async listPersonAssets() {
      return [];
    },
    async createPersonAsset(name) {
      return { name, count: 0, dir: '', updatedAt: Date.now() };
    },
    async renamePersonAsset(_oldName, newName) {
      return newName;
    },
    async deletePersonAsset() {
      return undefined;
    },
    async importPersonAssetImages() {
      return 0;
    },
    async listPersonAssetImages() {
      return [];
    },
    async openPersonAssetDirectory() {
      throw new Error('浏览器预览不能打开本地人物素材目录，请在 Electron 桌面端操作。');
    },
    async createHtmlVideoTask(input: CreateTaskInput) {
      const state = read();
      const now = new Date().toISOString();
      const task: Task = {
        id: crypto.randomUUID(),
        title: input.title || input.inputText.slice(0, 18) || 'HTML 动画视频',
        inputText: input.inputText,
        taskKind: 'story',
        processingMode: input.processingMode ?? 'full-auto',
        publishMode: input.publishMode ?? 'review-rewrite',
        status: 'draft',
        currentStep: 0,
        track: input.track ?? 'character-story',
        style: input.style ?? 'modern-film',
        speaker: input.speaker ?? '灿博小叔',
        ratio: input.ratio ?? '9:16',
        templateId: input.templateId ?? 'default-portrait-9-16',
        bgmId: input.bgmId ?? state.config.jianying.defaultBgmId ?? '',
        pausePoints: input.pausePoints ?? [],
        outputDir: '',
        errorMessage: '',
        createdAt: now,
        completedAt: null,
        startedAt: null,
        lastHeartbeatAt: null,
        mode: input.mode ?? 'paste',
        aiKeyword: input.aiKeyword ?? '',
        aiSources: input.aiSources ?? [],
        selectedSources: input.selectedSources ?? [],
        extraRequirements: input.extraRequirements ?? '',
        imagePromptReference: input.imagePromptReference ?? '',
        promptTemplateId: input.promptTemplateId ?? null,
        promptTemplateType: input.promptTemplateType ?? null,
        referenceImagePath: input.referenceImagePath ?? '',
        rewriteIntensity: input.rewriteIntensity ?? 'standard',
        narrativePov: input.narrativePov ?? 'keep-original',
        keepPromotion: input.keepPromotion ?? false,
        ttsProvider: input.ttsProvider ?? 'volcengine',
        ttsSpeed: input.ttsSpeed ?? 1,
        storyboardSceneCount: input.targetScenes ?? input.storyboardSceneCount,
        targetLength: input.targetLength,
        targetScenes: input.targetScenes ?? input.storyboardSceneCount,
        step3PromptSnapshot: input.step3PromptSnapshot ?? '',
        musicMv: input.musicMv ?? { rhythmMode: 'lyric-sync', captionStyle: 'karaoke', visualMotif: '', audioPath: '' },
        videoForm: input.videoForm ?? 'narration',
        failedStep: null,
        retryFromStep: null,
        artifactStatePath: '',
        materialSource: input.materialSource ?? 'paste',
        taskType: 'html-video',
        pipelineStep: input.pipelineStep ?? 'rewrite',
        pipelineData: input.pipelineData ?? '{}',
        coverImageMode: input.coverImageMode ?? 'off',
        coverTemplateId: input.coverTemplateId ?? 'cinematic-poster',
      };
      const events: TaskEvent[] = [
        { taskId: task.id, type: 'pipeline_ready', step: 0, agent: 'HTML Video', tool: null, detail: 'HTML 动画视频任务已创建，等待改写与分句。', dataJson: task.pipelineData ?? null, ts: Date.now() },
      ];
      return persist({ ...state, tasks: [task, ...state.tasks], events: [...state.events, ...events] });
    },
    async updateHtmlVideoConfig(id: string, changes: HtmlVideoConfigChange[]) {
      const state = read();
      const task = state.tasks.find((item) => item.id === id);
      if (!task || task.taskType !== 'html-video') throw new Error(`HTML 视频任务不存在：${id}`);
      if (task.archivedAt) throw new Error('HISTORY_ARCHIVED: 已归档任务只读。');
      if (task.status === 'pending' || task.status === 'running') throw new Error('HTML_VIDEO_CONFIG_ACTIVE: 运行中的任务不能编辑参数。');
      const applied = applyHtmlVideoConfigChanges(parseHtmlVideoPipelineData(task.pipelineData), changes);
      const currentStep = htmlVideoVisibleSteps.indexOf(applied.invalidateFrom);
      const updated: Task = {
        ...task,
        ...applied.legacyMirrors,
        status: 'paused',
        currentStep,
        pipelineStep: applied.invalidateFrom,
        pipelineData: JSON.stringify(applied.pipeline),
        completedAt: null,
        errorMessage: '',
        failedStep: null,
        retryFromStep: null,
        lastHeartbeatAt: new Date().toISOString(),
      };
      const event: TaskEvent = {
        taskId: id,
        type: 'config_update',
        step: currentStep,
        agent: 'HTML Video',
        tool: null,
        detail: `已更新 HTML 视频参数，从${applied.invalidateFrom}阶段继续。`,
        dataJson: JSON.stringify({ changedFields: applied.changedFields, invalidateFrom: applied.invalidateFrom }),
        ts: Date.now(),
      };
      return persist({
        ...state,
        tasks: state.tasks.map((item) => item.id === id ? updated : item),
        events: [...state.events, event],
      });
    },
    async importHtmlVideoCover() {
      throw new Error('浏览器预览不能导入本地封面，请在 Electron 桌面端操作。');
    },
    async openHtmlVideoPreview() {
      throw new Error('浏览器预览仅创建任务快照，未执行特权 HTML 渲染。请在 Electron 桌面端打开预览。');
    },
    async getHtmlVideoMediaUrl() {
      throw new Error('浏览器预览仅创建任务快照，未执行特权 HTML 渲染。请在 Electron 桌面端读取媒体。');
    },
    async createAndRunTask(input: CreateTaskInput) {
      const browserPipelineError =
        '浏览器预览无法运行真实供应商流水线。请在 Electron 桌面端配置 LLM、生图、TTS、Python 和 pyJianYingDraft 后执行。';
      const state = read();
      const task: Task = {
        id: crypto.randomUUID(),
        title: input.title || input.inputText.slice(0, 18) || 'New task',
        inputText: input.inputText,
        taskKind: input.taskKind ?? 'story',
        processingMode: input.processingMode ?? 'full-auto',
        publishMode: input.publishMode ?? 'review-rewrite',
        status: 'paused',
        currentStep: 0,
        track: input.track ?? 'character-story',
        style: input.style ?? 'photo-real',
        speaker: input.speaker ?? '灿博小叔',
        ratio: input.ratio ?? '9:16',
        templateId: input.templateId ?? 'default-portrait-9-16',
        bgmId: input.bgmId ?? state.config.jianying.defaultBgmId ?? '',
        pausePoints: input.pausePoints ?? [],
        outputDir: '',
        errorMessage: browserPipelineError,
        createdAt: new Date().toISOString(),
        completedAt: null,
        startedAt: null,
        lastHeartbeatAt: null,
        mode: input.mode ?? 'paste',
        aiKeyword: input.aiKeyword ?? '',
        aiSources: input.aiSources ?? [],
        selectedSources: input.selectedSources ?? [],
        extraRequirements: input.extraRequirements ?? '',
        imagePromptReference: input.imagePromptReference ?? '',
        promptTemplateId: input.promptTemplateId ?? null,
        promptTemplateType: input.promptTemplateType ?? null,
        referenceImagePath: input.referenceImagePath ?? '',
        rewriteIntensity: input.rewriteIntensity ?? 'standard',
        narrativePov: input.narrativePov ?? 'keep-original',
        keepPromotion: input.keepPromotion ?? false,
        ttsProvider: input.ttsProvider ?? 'volcengine',
        ttsSpeed: input.ttsSpeed ?? 1,
        storyboardSceneCount: input.targetScenes ?? input.storyboardSceneCount,
        targetLength: input.targetLength,
        targetScenes: input.targetScenes ?? input.storyboardSceneCount,
        step3PromptSnapshot: input.step3PromptSnapshot ?? '',
        musicMv: input.musicMv ?? { rhythmMode: 'lyric-sync', captionStyle: 'karaoke', visualMotif: '', audioPath: '' },
        videoForm: input.videoForm ?? 'narration',
        failedStep: 0,
        retryFromStep: 0,
        artifactStatePath: '',
        materialSource: input.materialSource ?? 'ai',
        productInfo: input.productInfo ?? null,
        materialPerson: input.materialPerson ?? null,
        draftDir: input.draftDir ?? null,
        fixedIntro: input.fixedIntro ?? null,
        outroCta: input.outroCta ?? null,
        lockIntroSentences: input.lockIntroSentences ?? 0,
      };
      const events: TaskEvent[] = [
        { taskId: task.id, type: 'step_error', step: 0, agent: 'Reviewer', tool: null, detail: browserPipelineError, dataJson: null, ts: Date.now() },
      ];
      return persist({ ...state, tasks: [task, ...state.tasks], events: [...state.events, ...events] });
    },
    async createAndRunViralAnalysis(input: CreateViralAnalysisInput) {
      const state = read();
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      return persist({
        ...state,
        viralAnalyses: [
          {
            id,
            url: input.url,
            platform: input.platform ?? detectBrowserViralPlatform(input.url),
            title: input.title ?? input.url,
            status: 'paused',
            currentStage: 'failed',
            progress: 0,
            settings: input.settings,
            resultPath: '',
            videoPath: '',
            errorMessage: '浏览器预览无法运行爆款视频拆解。请在 Electron 桌面端下载并处理视频。',
            createdAt: now,
            startedAt: now,
            completedAt: null,
            lastHeartbeatAt: now,
          },
          ...state.viralAnalyses,
        ],
        viralEvents: [
          ...state.viralEvents,
          {
            analysisId: id,
            type: 'error',
            stage: 'failed',
            detail: '浏览器预览无法运行爆款视频拆解。请在 Electron 桌面端下载并处理视频。',
            dataJson: null,
            ts: Date.now(),
          },
        ],
      });
    },
    async updateViralAnalysisStatus(id: string, status: ViralAnalysisStatus) {
      const state = read();
      return persist({ ...state, viralAnalyses: state.viralAnalyses.map((item) => (item.id === id ? { ...item, status } : item)) });
    },
    async retryViralAnalysis(id: string) {
      const state = read();
      return persist({ ...state, viralAnalyses: state.viralAnalyses.map((item) => (item.id === id ? { ...item, status: 'pending', errorMessage: '' } : item)) });
    },
    async getViralAnalysisResult(id: string): Promise<ViralAnalysisResult> {
      const state = read();
      const record = state.viralAnalyses.find((item) => item.id === id);
      throw new Error(`浏览器预览无法读取爆款拆解结果：${record?.title ?? id}`);
    },
    async createProductionTaskFromViral(id: string) {
      throw new Error(`浏览器预览无法从爆款拆解创建成片任务：${id}`);
    },
    async updateTaskStatus(id: string, status: TaskStatus) {
      const state = read();
      return persist({ ...state, tasks: state.tasks.map((task) => (task.id === id ? { ...task, status, errorMessage: status === 'cancelled' ? '用户取消' : task.errorMessage } : task)) });
    },
    async retryTask(id: string) {
      const state = read();
      return persist({ ...state, tasks: state.tasks.map((task) => (task.id === id ? { ...task, status: 'pending', errorMessage: '' } : task)) });
    },
    async regenerateTaskImage() {
      throw new Error('浏览器预览不能重新生成真实图片，请在 Electron 应用中操作。');
    },
    async regenerateTaskNarration() {
      throw new Error('浏览器预览不能重新生成真实配音，请在 Electron 应用中操作。');
    },
    async updateTaskImagePrompt() {
      throw new Error('浏览器预览不能修改真实任务提示词，请在 Electron 应用中操作。');
    },
    async rerunTaskStep() {
      throw new Error('浏览器预览不能重新执行真实流水线步骤，请在 Electron 应用中操作。');
    },
    async getTaskArtifacts(id: string) {
      const task = read().tasks.find((item) => item.id === id);
      return {
        available: false,
        message: '浏览器预览无法读取本地任务产物，请在 Electron 桌面端查看。',
        taskId: id,
        statePath: task?.artifactStatePath ?? '',
        outputDir: task?.outputDir ?? '',
        updatedAt: null,
        steps: {},
        artifact: {},
        assets: { cover: [], images: [], imageErrors: [], narration: [] },
        draft: null,
      };
    },
    async readAssetDataUrl() {
      throw new Error('浏览器预览不能读取本地媒体预览，请在 Electron 应用中查看。');
    },
    async selectLocalImage() {
      return null;
    },
    async selectLocalAudio() {
      return null;
    },
    async selectLocalFolder() {
      return null;
    },
    async selectCookieFile() {
      return null;
    },
    async openViralLoginWindow() {
      throw new Error('浏览器预览不能打开抖音登录窗口，请在 Electron 桌面端操作。');
    },
    async detectJianyingDraftPath() {
      return '';
    },
    async getJianyingEffectCatalog() {
      return fallbackEffectCatalog;
    },
    async runDiagnostics() {
      const state = read();
      return {
        generatedAt: new Date().toISOString(),
        checks: [
          { id: 'llm-config', label: 'LLM 配置完整性', status: state.config.llm.apiKey ? 'pass' : 'warn', detail: state.config.llm.model },
          { id: 'tts-config', label: 'TTS 凭证已填写', status: state.config.tts.volcengine.apiKey || state.config.tts.accessKey ? 'pass' : 'warn', detail: state.config.tts.provider },
          { id: 'jianying-sidecar', label: '剪映草稿目录', status: state.config.jianying.draftPath ? 'pass' : 'warn', detail: state.config.jianying.draftPath },
          { id: 'account-state', label: '账户状态', status: 'pass', detail: state.activation.message },
        ],
      };
    },
    windowControl: async () => undefined,
    onAppDelta: () => () => undefined,
  };
}

function App() {
  const [trackedState, dispatchState] = useReducer(
    reduceCompletionTrackedState<AppState>,
    { value: cloneState(initialState), completionToken: 0 },
  );
  const state = trackedState.value;
  const taskDetailCompletionEpoch = trackedState.completionToken;
  const setState = useCallback((update: React.SetStateAction<AppState>) => {
    dispatchState({ update });
  }, []);
  const [activeView, setActiveView] = useState<ShellView>('new-task');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [historyFamilyEpochs, setHistoryFamilyEpochs] = useState<HistoryFamilyEpochs>({});
  const [saveTone, setSaveTone] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const isBrowserPreview = !window.storydream && !window.storybound;
  const api = useMemo(() => window.storydream ?? window.storybound ?? makeFallbackApi(setState), []);
  const shellAction = useAsyncAction();
  const revisionRef = useRef(0);
  const mutationRevisionsRef = useRef(new Map<string, number>());
  const historyEntityRevisionsRef = useRef(new Map<string, number>());
  const historyTombstoneRevisionsRef = useRef(new Map<string, number>());
  const activeViewRef = useRef<ShellView>('new-task');
  const selectedTaskIdRef = useRef<string | null>(null);
  const activeHtmlTaskIdRef = useRef<string | null>(null);
  const activeViralAnalysisIdRef = useRef<string | null>(null);
  const taskDetailGuard = useMemo(() => createRequestGenerationGuard(), []);
  const taskDetailCompletionQueue = useMemo(
    () => createRequestGenerationCompletionQueue(taskDetailGuard),
    [taskDetailGuard],
  );
  const viralDetailGuard = useMemo(() => createRequestGenerationGuard(), []);
  useLayoutEffect(() => {
    applyStoredTheme(state.ui.theme);
  }, [state.ui.theme]);
  const isHistoryTombstoned = useCallback((family: HistoryFamily, id: string) => (
    historyTombstoneRevisionsRef.current.has(historyEntityRevisionKey(family, id))
  ), []);
  const refreshHistoryFamilies = useCallback((
    families: readonly HistoryFamily[],
  ) => {
    setHistoryFamilyEpochs((current) => advanceHistoryFamilyEpochs(current, families));
  }, []);

  useEffect(() => {
    taskDetailCompletionQueue.flushThrough(taskDetailCompletionEpoch);
  }, [taskDetailCompletionEpoch, taskDetailCompletionQueue]);

  const applyHistoryEntityBarrier = useCallback((family: HistoryFamily, id: string) => {
    const selection = applyHistorySelectionBarrier({
      selectedTaskId: selectedTaskIdRef.current,
      activeHtmlTaskId: activeHtmlTaskIdRef.current,
      activeViralAnalysisId: activeViralAnalysisIdRef.current,
      activeView: activeViewRef.current,
    }, family, id);
    selectedTaskIdRef.current = selection.selectedTaskId;
    activeHtmlTaskIdRef.current = selection.activeHtmlTaskId;
    activeViralAnalysisIdRef.current = selection.activeViralAnalysisId;
    activeViewRef.current = selection.activeView;
    setSelectedTaskId(selection.selectedTaskId);
    setActiveView(selection.activeView);
    if (family === 'task') {
      taskDetailGuard.invalidate(id);
    } else if (family === 'viral-analysis') {
      viralDetailGuard.invalidate(id);
    }
  }, [taskDetailGuard, viralDetailGuard]);

  const applyHistoryBarrier = useCallback((delta: AppDelta) => {
    registerHistoryDeltaBarrier(
      historyEntityRevisionsRef.current,
      historyTombstoneRevisionsRef.current,
      delta,
      applyHistoryEntityBarrier,
      (family) => refreshHistoryFamilies([family]),
    );
  }, [applyHistoryEntityBarrier, refreshHistoryFamilies]);

  const refreshTaskDetail = useCallback(async (taskId: string) => {
    const generation = taskDetailGuard.begin(taskId);
    let completionDeferred = false;
    try {
      for (let attempt = 0; attempt < MAX_TASK_DETAIL_REVISION_ATTEMPTS; attempt += 1) {
        const responseRevision = captureHistoryResponseRevision(
          'task',
          taskId,
          historyEntityRevisionsRef.current,
          historyTombstoneRevisionsRef.current,
        );
        if (responseRevision.tombstoneRevision >= 0) return;
        const [detail, eventPage] = await Promise.all([
          api.getTaskDetail(taskId),
          api.listTaskEvents(taskId, { limit: 100 }),
        ]);
        if (!taskDetailGuard.isCurrent(taskId, generation) || !detail) return;
        const currentRevision = captureHistoryResponseRevision(
          'task',
          taskId,
          historyEntityRevisionsRef.current,
          historyTombstoneRevisionsRef.current,
        );
        const disposition = historyResponseDisposition(responseRevision, currentRevision);
        if (disposition === 'discard') return;
        if (disposition === 'retry') continue;

        const completionToken = taskDetailCompletionQueue.defer(taskId, generation);
        completionDeferred = true;
        dispatchState({
          update: (current) => taskDetailGuard.isCurrent(taskId, generation)
            ? mergeReconciliationSlices(current, {
                task: detail,
                taskEvents: eventPage.items,
                viralAnalysis: null,
                viralEvents: [],
              })
            : current,
          completionToken,
        });
        return;
      }
    } catch (error) {
      if (taskDetailGuard.isCurrent(taskId, generation)) shellAction.reportError(error);
    } finally {
      if (!completionDeferred) taskDetailGuard.finish(taskId, generation);
    }
  }, [api, shellAction.reportError, taskDetailCompletionQueue, taskDetailGuard]);

  const refreshViralEvents = useCallback(async (analysisId: string) => {
    const generation = viralDetailGuard.begin(analysisId);
    const responseRevision = captureHistoryResponseRevision(
      'viral-analysis',
      analysisId,
      historyEntityRevisionsRef.current,
      historyTombstoneRevisionsRef.current,
    );
    try {
      if (responseRevision.tombstoneRevision >= 0) return;
      const [detail, eventPage] = await Promise.all([
        api.getViralAnalysisDetail(analysisId),
        api.listViralEvents(analysisId, { limit: 100 }),
      ]);
      if (!viralDetailGuard.isCurrent(analysisId, generation)
        || !isHistoryResponseCurrent('viral-analysis', analysisId, responseRevision, historyEntityRevisionsRef.current, historyTombstoneRevisionsRef.current)) return;
      setState((current) => isHistoryResponseCurrent(
        'viral-analysis',
        analysisId,
        responseRevision,
        historyEntityRevisionsRef.current,
        historyTombstoneRevisionsRef.current,
      ) ? mergeReconciliationSlices(current, {
          task: null,
          taskEvents: [],
          viralAnalysis: detail,
          viralEvents: eventPage.items,
        }) : current);
    } catch (error) {
      if (viralDetailGuard.isCurrent(analysisId, generation)) shellAction.reportError(error);
    } finally {
      viralDetailGuard.finish(analysisId, generation);
    }
  }, [api, shellAction.reportError, viralDetailGuard]);

  const onActiveHtmlTaskChange = useCallback((taskId: string) => {
    activeHtmlTaskIdRef.current = taskId || null;
  }, []);

  const onActiveViralAnalysisChange = useCallback((analysisId: string) => {
    activeViralAnalysisIdRef.current = analysisId || null;
  }, []);

  useEffect(() => {
    selectedTaskIdRef.current = selectedTaskId;
  }, [selectedTaskId]);

  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);

  useEffect(() => {
    let disposed = false;
    let reconciling = false;
    let reconcileAgain = false;
    let reconcileAgainWithReset = false;
    let resetInProgress = false;
    let resetRecoveryRevision = 0;
    let snapshotInstalling = true;
    let mutationBufferOverflowed = false;
    const bufferedMutationResults = new Map<number, AppMutationResult>();
    const applyDeltaState = (
      next: DeltaViewState | null,
      previous?: DeltaViewState | null,
    ) => {
      if (!next || disposed) return;
      if (previous !== undefined && !shouldApplyDeltaViewTransition(previous, next)) return;
      revisionRef.current = next.revision;
      replaceHistoryRevisionMap(historyEntityRevisionsRef.current, next.entityRevisions);
      replaceHistoryRevisionMap(historyTombstoneRevisionsRef.current, next.tombstoneRevisions);
      setState((current) => mergeDeltaView(current, next));
    };
    const applyMutationDelta = (delta: AppMutationResult) => {
      const claimedRevisions = claimMutationResult(delta, mutationRevisionsRef.current);
      if (!claimedRevisions) return;
      setState((current) => applyAppMutationResult(current, delta, new Map(claimedRevisions)));
    };
    const requestReconciliation = (forceReset = false) => {
      if (disposed) return;
      if (snapshotInstalling || reconciling) {
        reconcileAgain = true;
        reconcileAgainWithReset ||= forceReset;
        return;
      }
      void reconcile(undefined, forceReset);
    };
    const flushQueuedReconciliation = () => {
      if (reconcileAgain && !disposed && !snapshotInstalling && !reconciling) {
        reconcileAgain = false;
        const reset = reconcileAgainWithReset;
        reconcileAgainWithReset = false;
        void reconcile(undefined, reset);
      }
    };
    const bufferMutationResult = (result: AppMutationResult) => {
      if (mutationBufferOverflowed) return;
      if (!bufferedMutationResults.has(result.revision) && bufferedMutationResults.size >= MAX_RENDERER_DELTA_BUFFER) {
        mutationBufferOverflowed = true;
        requestReconciliation(true);
        return;
      }
      bufferedMutationResults.set(result.revision, result);
    };
    const takeBufferedMutationResults = () => {
      const buffered = [...bufferedMutationResults.values()];
      bufferedMutationResults.clear();
      mutationBufferOverflowed = false;
      return buffered;
    };
    const beginSnapshotInstallation = () => {
      snapshotInstalling = true;
      mutationBufferOverflowed = false;
      bufferedMutationResults.clear();
    };
    const installAuthoritativeSnapshot = (
      rebuiltState: AppState,
      snapshotRevision: number,
      replayedRevision: number,
      preserveTemplateDetails: boolean,
      authoritativeTaskDetailIds?: ReadonlySet<string>,
    ) => {
      const buffered = takeBufferedMutationResults();
      raiseMutationRevisionFloor(mutationRevisionsRef.current, snapshotRevision);
      const replayRevisionFloor = new Map(mutationRevisionsRef.current);
      const finalRevision = Math.max(
        snapshotRevision,
        replayedRevision,
        buffered.reduce((revision, result) => Math.max(revision, result.revision), snapshotRevision),
      );
      raiseMutationRevisionFloor(mutationRevisionsRef.current, finalRevision);
      snapshotInstalling = false;
      setState((current) => {
        const localMutationRevisions = new Map(replayRevisionFloor);
        const authoritative = mergeAuthoritativeSnapshotDetails(
          current,
          rebuiltState,
          preserveTemplateDetails,
          authoritativeTaskDetailIds,
        );
        const replayed = applyBufferedMutationResults(
          authoritative,
          buffered,
          snapshotRevision,
          localMutationRevisions,
        );
        return replayed;
      });
      refreshHistoryFamilies(allHistoryFamilies);
    };
    const recoverSnapshotInstallation = (snapshotRevision: number, replayedRevision: number) => {
      const buffered = takeBufferedMutationResults();
      raiseMutationRevisionFloor(mutationRevisionsRef.current, snapshotRevision);
      const replayRevisionFloor = new Map(mutationRevisionsRef.current);
      const finalRevision = Math.max(
        snapshotRevision,
        replayedRevision,
        buffered.reduce((revision, result) => Math.max(revision, result.revision), snapshotRevision),
      );
      raiseMutationRevisionFloor(mutationRevisionsRef.current, finalRevision);
      snapshotInstalling = false;
      setState((current) => {
        const localMutationRevisions = new Map(replayRevisionFloor);
        const recovered = applyBufferedMutationResults(
          current,
          buffered,
          snapshotRevision,
          localMutationRevisions,
        );
        return recovered;
      });
    };
    const applyIncomingDelta = (delta: AppDelta) => {
      applyHistoryBarrier(delta);
      if (delta.kind !== 'task-event') {
        if (snapshotInstalling) bufferMutationResult(delta);
        else applyMutationDelta(delta);
      }
      const previous = coordinator.current();
      applyDeltaState(coordinator.receive(delta), previous);
    };
    async function reconcile(_gap?: RevisionGap, forceReset = false) {
      if (disposed) return;
      if (reconciling) {
        reconcileAgain = true;
        reconcileAgainWithReset ||= forceReset;
        return;
      }
      if (snapshotInstalling) {
        reconcileAgain = true;
        reconcileAgainWithReset ||= forceReset;
        return;
      }
      reconciling = true;
      try {
        const requestedTaskId = selectedTaskIdRef.current ?? activeHtmlTaskIdRef.current;
        const requestedViralId = activeViralAnalysisIdRef.current;
        const taskResponseRevision = requestedTaskId
          ? captureHistoryResponseRevision('task', requestedTaskId, historyEntityRevisionsRef.current, historyTombstoneRevisionsRef.current)
          : null;
        const viralResponseRevision = requestedViralId
          ? captureHistoryResponseRevision('viral-analysis', requestedViralId, historyEntityRevisionsRef.current, historyTombstoneRevisionsRef.current)
          : null;
        const result = await api.reconcileDeltas({
          sinceRevision: revisionRef.current,
          taskId: requestedTaskId ?? undefined,
          viralAnalysisId: requestedViralId ?? undefined,
          forceReset,
        });
        if (disposed) return;
        if (result.resetRequired) {
          coordinator.beginReset();
          resetInProgress = true;
          resetRecoveryRevision = revisionRef.current;
          beginSnapshotInstallation();
          const bootstrap = await loadCompleteBootstrap(api, await api.getBootstrap());
          const replayed = coordinator.reset({
            revision: bootstrap.revision,
            tasks: bootstrap.tasks.items,
            events: result.taskEvents,
            viralAnalyses: bootstrap.viralAnalyses.items,
            imageLabRecords: bootstrap.imageLabRecords.items,
            voiceLabRecords: bootstrap.voiceLabRecords.items,
          });
          revisionRef.current = replayed.revision;
          const guardedResult = {
            ...result,
            task: requestedTaskId && taskResponseRevision
              && isHistoryResponseCurrent('task', requestedTaskId, taskResponseRevision, historyEntityRevisionsRef.current, historyTombstoneRevisionsRef.current)
              ? result.task
              : null,
            taskEvents: requestedTaskId && taskResponseRevision
              && isHistoryResponseCurrent('task', requestedTaskId, taskResponseRevision, historyEntityRevisionsRef.current, historyTombstoneRevisionsRef.current)
              ? result.taskEvents
              : [],
            viralAnalysis: requestedViralId && viralResponseRevision
              && isHistoryResponseCurrent('viral-analysis', requestedViralId, viralResponseRevision, historyEntityRevisionsRef.current, historyTombstoneRevisionsRef.current)
              ? result.viralAnalysis
              : null,
            viralEvents: requestedViralId && viralResponseRevision
              && isHistoryResponseCurrent('viral-analysis', requestedViralId, viralResponseRevision, historyEntityRevisionsRef.current, historyTombstoneRevisionsRef.current)
              ? result.viralEvents
              : [],
          };
          const rebuiltResetState = mergeReconciliationSlices(mergeDeltaView(bootstrapToState(bootstrap), replayed), guardedResult);
          const missingRequestedTaskId = authoritativeMissingRequestedTaskId(
            requestedTaskId,
            result.task,
            rebuiltResetState.tasks,
          );
          if (missingRequestedTaskId) {
            applyHistoryEntityBarrier('task', missingRequestedTaskId);
          }
          installAuthoritativeSnapshot(
            rebuiltResetState,
            bootstrap.revision,
            replayed.revision,
            true,
            guardedResult.task ? new Set([guardedResult.task.id]) : undefined,
          );
          resetInProgress = false;
          const activeTaskId = selectedTaskIdRef.current ?? activeHtmlTaskIdRef.current;
          if (activeTaskId) void refreshTaskDetail(activeTaskId);
          const activeViralId = activeViralAnalysisIdRef.current;
          if (activeViralId) void refreshViralEvents(activeViralId);
          return;
        }
        result.deltas.forEach(applyIncomingDelta);
        const guardedResult = {
          ...result,
          task: requestedTaskId && taskResponseRevision
            && isHistoryResponseCurrent('task', requestedTaskId, taskResponseRevision, historyEntityRevisionsRef.current, historyTombstoneRevisionsRef.current)
            ? result.task
            : null,
          taskEvents: requestedTaskId && taskResponseRevision
            && isHistoryResponseCurrent('task', requestedTaskId, taskResponseRevision, historyEntityRevisionsRef.current, historyTombstoneRevisionsRef.current)
            ? result.taskEvents
            : [],
          viralAnalysis: requestedViralId && viralResponseRevision
            && isHistoryResponseCurrent('viral-analysis', requestedViralId, viralResponseRevision, historyEntityRevisionsRef.current, historyTombstoneRevisionsRef.current)
            ? result.viralAnalysis
            : null,
          viralEvents: requestedViralId && viralResponseRevision
            && isHistoryResponseCurrent('viral-analysis', requestedViralId, viralResponseRevision, historyEntityRevisionsRef.current, historyTombstoneRevisionsRef.current)
            ? result.viralEvents
            : [],
        };
        const current = coordinator.current();
        if (current && result.revision === current.revision) {
          const eventsBySeq = new Map(current.events.map((event) => [event.seq, event]));
          guardedResult.taskEvents.forEach((event) => eventsBySeq.set(event.seq, event));
          const synced = coordinator.bootstrap({
            ...current,
            revision: result.revision,
            events: [...eventsBySeq.values()].sort((left, right) => left.seq - right.seq),
          });
          applyDeltaState(synced);
        }
        setState((currentState) => mergeReconciliationSlices(currentState, guardedResult));
      } catch (error) {
        if (resetInProgress) {
          const current = coordinator.current();
          const replayed = current ? coordinator.reset(current) : null;
          if (replayed) applyDeltaState(replayed);
          recoverSnapshotInstallation(resetRecoveryRevision, replayed?.revision ?? resetRecoveryRevision);
          resetInProgress = false;
        }
        shellAction.reportError(error);
      } finally {
        reconciling = false;
        flushQueuedReconciliation();
      }
    }
    const coordinator = createAppDeltaCoordinator(
      (gap) => {
        if (gap) requestReconciliation();
      },
      () => {
        requestReconciliation(true);
      },
    );
    const unsubscribe = api.onAppDelta((delta: AppDelta) => {
      try {
        applyIncomingDelta(delta);
      } catch (error) {
        shellAction.reportError(error);
      }
    });
    api.getBootstrap().then((initialBootstrap) => loadCompleteBootstrap(api, initialBootstrap)).then((bootstrap) => {
      if (disposed) return;
      applyStoredTheme(bootstrap.ui.theme);
      revealThemedApplication();
      const replayed = coordinator.bootstrap({
        revision: bootstrap.revision,
        tasks: bootstrap.tasks.items,
        events: [],
        viralAnalyses: bootstrap.viralAnalyses.items,
        imageLabRecords: bootstrap.imageLabRecords.items,
        voiceLabRecords: bootstrap.voiceLabRecords.items,
      });
      revisionRef.current = replayed.revision;
      installAuthoritativeSnapshot(
        mergeDeltaView(bootstrapToState(bootstrap), replayed),
        bootstrap.revision,
        replayed.revision,
        false,
      );
      setActiveView(bootstrap.ui.activeView);
      flushQueuedReconciliation();
    }).catch((error) => {
      if (disposed) return;
      revealThemedApplication();
      recoverSnapshotInstallation(revisionRef.current, coordinator.current()?.revision ?? revisionRef.current);
      shellAction.reportError(error);
      requestReconciliation(true);
    });
    const reconciliationTimer = window.setInterval(() => {
      requestReconciliation();
    }, 30_000);
    return () => {
      disposed = true;
      window.clearInterval(reconciliationTimer);
      unsubscribe();
    };
  }, [api, applyHistoryBarrier, refreshHistoryFamilies, refreshTaskDetail, refreshViralEvents, shellAction.reportError]);

  useEffect(() => {
    if (!selectedTaskId) return;
    void refreshTaskDetail(selectedTaskId);
  }, [refreshTaskDetail, selectedTaskId]);

  async function navigate(view: ShellView) {
    if (view !== 'task-detail') {
      setSelectedTaskId(null);
    }
    setActiveView(view);
    setSaveTone('saving');
    const result = await shellAction.run(async () => {
      const next = await api.saveUiPreferences({ activeView: view });
      applyState(next);
      setSaveTone('saved');
    });
    if (!result.ok) {
      setSaveTone('dirty');
    }
  }

  function applyState(next: AppMutationResult | null) {
    if (isBrowserPreview && next) {
      applyHistoryBarrier(next);
      const claimedRevisions = claimMutationResult(next, mutationRevisionsRef.current);
      if (!claimedRevisions) return;
      setState((current) => applyLocalMutationResponse(current, next, new Map(claimedRevisions), true));
    }
    setSaveTone('saved');
  }

  async function openTaskDetail(taskId: string) {
    setSelectedTaskId(taskId);
    setActiveView('task-detail');
    setSaveTone('saving');
    const result = await shellAction.run(async () => {
      const next = await api.saveUiPreferences({ activeView: 'task-detail' });
      applyState(next);
      setSaveTone('saved');
    });
    if (!result.ok) {
      setSaveTone('dirty');
    }
  }

  function minimizeWindow() {
    void shellAction.run(() => api.windowControl('minimize'));
  }

  function toggleMaximizeWindow() {
    void shellAction.run(() => api.windowControl('toggle-maximize'));
  }

  function closeWindow() {
    void shellAction.run(() => api.windowControl('close'));
  }

  const selectedTask = selectedTaskId
    ? state.tasks.find((task) => task.id === selectedTaskId) ?? null
    : activeView === 'task-detail'
      ? null
      : state.tasks[0] ?? null;
  const recentTasks = state.tasks.slice(0, 3);
  const trialDaysLabel = state.activation.expiresAt
    ? `${Math.max(0, Math.ceil((new Date(state.activation.expiresAt).getTime() - Date.now()) / 86400000))} 天`
    : '本地试用';
  const activeNav = activeView === 'task-detail' ? { label: '任务详情', hint: '单任务流水线' } : navItems.find((item) => item.view === activeView) ?? navItems[0];

  return (
    <main className="app-shell">
      <div className="window-line">
        <div className="window-title">
          <div className="app-mark">S</div>
          <strong>StoryDream</strong>
        </div>
        <div className="window-controls" aria-label="窗体控制">
          <button className="window-control-button" type="button" aria-label="最小化" onClick={minimizeWindow}>
            <Minus size={14} />
          </button>
          <button className="window-control-button" type="button" aria-label="最大化" onClick={toggleMaximizeWindow}>
            <Maximize2 size={14} />
          </button>
          <button className="window-control-button close" type="button" aria-label="关闭" onClick={closeWindow}>
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="shell-grid">
        <aside className="sidebar">
          <div className="brand-block">
            <div className="brand-logo">S</div>
            <div>
              <strong>StoryDream</strong>
              <span>v0.10.4 · beta</span>
            </div>
            <Bell size={16} className="brand-bell" />
          </div>

          <button className="new-task-button" onClick={() => navigate('new-task')}>
            <Plus size={16} />
            <span>新建任务</span>
            <kbd>Ctrl+N</kbd>
          </button>

          <nav className="nav-list">
            <span className="nav-section-label">主线工作流</span>
            {primaryNavItems.filter((item) => item.view !== 'new-task').map((item) => (
              <NavButton key={item.view} item={item} active={activeView === item.view} navigate={navigate} />
            ))}
            <span className="nav-section-label secondary">扩展工具</span>
            {secondaryNavItems.map((item) => (
              <NavButton key={item.view} item={item} active={activeView === item.view} navigate={navigate} />
            ))}
          </nav>

          <div className="sidebar-bottom">
            <section className="recent-task-strip">
              <span className="nav-section-label">最近任务</span>
              {recentTasks.length === 0 ? <small>暂无任务</small> : null}
              {recentTasks.map((task) => (
                <button key={task.id} className="recent-task-item" onClick={() => openTaskDetail(task.id)}>
                  <strong>{task.title || '未命名任务'}</strong>
                  <span>{statusLabel(task.status)} · {taskProgressLabel(task)}</span>
                </button>
              ))}
            </section>
            <button className="trial-activation-bar" onClick={() => navigate('activation')}>
              <KeyRound size={15} />
              <span>试用剩余</span>
              <strong>{trialDaysLabel}</strong>
            </button>
            <div className="account-entry-grid">
              <button className="credit-chip" onClick={() => navigate('account')}>
                <Coins size={15} />
                积分明细
                <span>{state.account.balance.toFixed(2)}</span>
              </button>
              <button className="feedback-link" onClick={() => navigate('account')}>
                <Info size={14} />
                账户中心
              </button>
            </div>
          </div>
        </aside>

        <section className="content">
          <header className="page-head">
          <div>
            <h1>{activeNav.label}</h1>
            <p>{pageSubtitle(activeView)}</p>
            {isBrowserPreview ? <span className="local-note">浏览器预览不能执行真实流水线，请在 Electron 应用中运行任务。</span> : null}
          </div>
            <div className="top-notice">
              <Info size={16} />
              <span>{state.config.jianying.draftPath ? `剪映草稿目录：${state.config.jianying.draftPath}` : '尚未配齐：剪映草稿目录'}</span>
            </div>
            <div className={`save-state ${saveTone}`}>
              <span />
              {saveTone === 'saving' ? '保存中' : saveTone === 'dirty' ? '有未保存改动' : '所有改动已保存'}
            </div>
          </header>
          {shellAction.feedback ? (
            <div className="global-action-banner">
              <InlineActionFeedback feedback={shellAction.feedback} />
            </div>
          ) : null}

          {activeView === 'new-task' ? <NewTaskPage api={api} state={state} applyState={applyState} openTaskDetail={openTaskDetail} isBrowserPreview={isBrowserPreview} /> : null}
          {activeView === 'book-selection' ? <BookSelectionPage api={api} navigate={navigate} /> : null}
          {activeView === 'benchmark' ? <BenchmarkImportPage api={api} applyState={applyState} openTaskDetail={openTaskDetail} isBrowserPreview={isBrowserPreview} /> : null}
          {activeView === 'person-assets' ? <PersonAssetsPage api={api} isBrowserPreview={isBrowserPreview} /> : null}
          {activeView === 'queue' ? <QueuePage api={api} state={state} applyState={applyState} openNewTask={() => navigate('new-task')} openTaskDetail={openTaskDetail} isBrowserPreview={isBrowserPreview} /> : null}
          {activeView === 'history' ? (
            <HistoryPage
              api={api}
              openTaskDetail={openTaskDetail}
              isTombstoned={isHistoryTombstoned}
              familyEpoch={historyFamilyEpochs.task ?? 0}
            />
          ) : null}
          {activeView === 'task-detail' ? <TaskDetailPage api={api} state={state} task={selectedTask} applyState={applyState} close={() => navigate('history')} isBrowserPreview={isBrowserPreview} /> : null}
          {activeView === 'image-lab' ? <ImageLabPage api={api} state={state} applyState={applyState} /> : null}
          {activeView === 'voice-lab' ? <VoiceLabPage api={api} state={state} applyState={applyState} /> : null}
          {activeView === 'music-mv' ? <MusicMvPage api={api} state={state} applyState={applyState} openTaskDetail={openTaskDetail} isBrowserPreview={isBrowserPreview} /> : null}
          {activeView === 'html-video' ? <HtmlVideoPage api={api} state={state} applyState={applyState} refreshTaskDetail={refreshTaskDetail} onActiveTaskChange={onActiveHtmlTaskChange} isBrowserPreview={isBrowserPreview} /> : null}
          {activeView === 'viral-analyzer' ? <ViralAnalyzerPage api={api} state={state} applyState={applyState} refreshViralEvents={refreshViralEvents} onActiveAnalysisChange={onActiveViralAnalysisChange} openTaskDetail={openTaskDetail} isBrowserPreview={isBrowserPreview} /> : null}
          {activeView === 'prompt-templates' ? <PromptTemplatesPage api={api} state={state} applyState={applyState} /> : null}
          {activeView === 'draft-templates' ? <DraftTemplatesPage api={api} state={state} applyState={applyState} /> : null}
          {activeView === 'settings' ? <SettingsPage api={api} state={state} applyState={applyState} /> : null}
          {activeView === 'account' ? <AccountPage api={api} state={state} applyState={applyState} /> : null}
          {activeView === 'activation' ? <ActivationPage api={api} state={state} applyState={applyState} /> : null}
        </section>
      </div>
    </main>
  );
}

function NavButton({ item, active, navigate }: { item: NavItem; active: boolean; navigate: (view: ShellView) => void }) {
  const Icon = item.icon;
  return (
    <button className={active ? 'nav-item active' : 'nav-item'} onClick={() => navigate(item.view)}>
      <Icon size={16} />
      <span>{item.label}</span>
      <small>{item.hint}</small>
    </button>
  );
}

type ViralSourceMode = 'auto' | 'douyin' | 'kuaishou' | 'bilibili';
const viralSourceModes: ViralSourceMode[] = ['auto', 'douyin', 'kuaishou', 'bilibili'];

function ViralAnalyzerPage({
  api,
  state,
  applyState,
  refreshViralEvents,
  onActiveAnalysisChange,
  openTaskDetail,
  isBrowserPreview,
}: {
  api: StoryDreamApi;
  state: AppState;
  applyState: ApplyMutationResult;
  refreshViralEvents: (analysisId: string) => Promise<void>;
  onActiveAnalysisChange: (analysisId: string) => void;
  openTaskDetail: (taskId: string) => void;
  isBrowserPreview: boolean;
}) {
  const [url, setUrl] = useState('');
  const [sourceMode, setSourceMode] = useState<ViralSourceMode>('auto');
  const [track, setTrack] = useState('ecommerce');
  const [style, setStyle] = useState('photo-real');
  const [ratio, setRatio] = useState('9:16');
  const [templateId, setTemplateId] = useState('default-portrait-9-16');
  const [keyFrameCount, setKeyFrameCount] = useState(8);
  const [cookieFilePath, setCookieFilePath] = useState(state.config.viral.cookieFilePath);
  const [selectedId, setSelectedId] = useState(state.viralAnalyses[0]?.id ?? '');
  const [result, setResult] = useState<ViralAnalysisResult | null>(null);
  const [message, setMessage] = useState('');
  const viralAction = useAsyncAction();
  const selected = state.viralAnalyses.find((item) => item.id === selectedId) ?? state.viralAnalyses[0] ?? null;
  const selectedEvents = selected ? state.viralEvents.filter((event) => event.analysisId === selected.id) : [];
  const selectedEventRefreshKey = viralEventRefreshKey(selected);
  const detectedPlatform = detectBrowserViralPlatform(url);
  const selectedPlatformForAnalysis: ViralPlatform = sourceMode === 'auto' ? detectedPlatform : sourceMode;
  const selectedStageIndex = selected ? viralStages.indexOf(selected.currentStage) : -1;

  useEffect(() => {
    if (!selectedId && state.viralAnalyses[0]) setSelectedId(state.viralAnalyses[0].id);
  }, [selectedId, state.viralAnalyses]);

  useEffect(() => {
    if (!selected) {
      onActiveAnalysisChange('');
      return;
    }
    onActiveAnalysisChange(selected.id);
    return () => onActiveAnalysisChange('');
  }, [onActiveAnalysisChange, selected?.id]);

  useEffect(() => {
    if (selected) void refreshViralEvents(selected.id);
  }, [refreshViralEvents, selected?.id, selectedEventRefreshKey]);

  useEffect(() => {
    let cancelled = false;
    if (!selected || selected.status !== 'completed') {
      setResult(null);
      return;
    }
    api.getViralAnalysisResult(selected.id)
      .then((next) => {
        if (!cancelled) setResult(next);
      })
      .catch((error) => {
        if (!cancelled) viralAction.reportError(error);
      });
    return () => {
      cancelled = true;
    };
  }, [api, selected?.id, selected?.status, viralAction.reportError]);

  function handleUrlChange(value: string) {
    setUrl(value);
  }

  function persistViralCookiePath(path: string) {
    const trimmed = path.trim();
    setCookieFilePath(trimmed);
    return api.saveConfig({
      config: {
        ...state.config,
        viral: {
          ...state.config.viral,
          cookieFilePath: trimmed,
        },
      },
      secretChanges: {},
    }).then(applyState);
  }

  async function saveViralCookiePath(path: string) {
    await viralAction.run(() => persistViralCookiePath(path));
  }

  async function chooseCookieFile() {
    await viralAction.run(async () => {
      const selectedPath = await api.selectCookieFile();
      if (selectedPath) await persistViralCookiePath(selectedPath);
    });
  }

  async function openDouyinLogin() {
    await viralAction.run(async () => {
      setMessage('请在打开的抖音窗口完成登录，关闭窗口后会自动保存 Cookie。');
      const loginCookiePath = await api.openViralLoginWindow();
      if (loginCookiePath) {
        setCookieFilePath(loginCookiePath);
        setMessage(`已保存 Cookie 文件：${loginCookiePath}`);
      }
    });
  }

  async function startAnalysis() {
    if (!url.trim()) {
      setMessage('请输入抖音、快手或 B 站公开视频链接');
      return;
    }
    if (selectedPlatformForAnalysis === 'unknown') {
      setMessage('未识别到平台，请选择抖音、快手或 B站。');
      return;
    }
    setMessage('');
    await viralAction.run(async () => {
      if (cookieFilePath !== state.config.viral.cookieFilePath) await persistViralCookiePath(cookieFilePath);
      const next = await api.createAndRunViralAnalysis({
        url: url.trim(),
        platform: selectedPlatformForAnalysis,
        settings: { track, style, ratio, templateId, keyFrameCount, storyboardSceneCount: 12 },
      });
      applyState(next);
      setSelectedId(viralFromMutation(next)?.id ?? '');
    });
  }

  async function createProductionTask() {
    if (!selected) return;
    await viralAction.run(async () => {
      const next = await api.createProductionTaskFromViral(selected.id, {
        track,
        style,
        ratio,
        templateId,
        storyboardSceneCount: result?.recreation.taskDefaults.storyboardSceneCount ?? 12,
      });
      applyState(next);
      const task = taskFromMutation(next);
      if (task) openTaskDetail(task.id);
    });
  }

  async function saveViralTemplates(input: { storyTemplateName: string; imageTemplateName: string }) {
    if (!result) return;
    const actionResult = await viralAction.run(async () => {
      const drafts = createViralTemplateDrafts(result, {
        storyTemplateName: input.storyTemplateName,
        imageTemplateName: input.imageTemplateName,
        track,
        style,
        draftTemplateId: templateId,
      });
      await api.saveCustomStyle(drafts.imageTemplate);
      const next = await api.savePromptTemplate(drafts.storyTemplate);
      applyState(next);
      setMessage('已保存故事模板和图片模板，可在提示词模板中继续编辑。');
    });
    if (!actionResult.ok && actionResult.error) throw actionResult.error;
  }

  async function retryAnalysis() {
    if (!selected) return;
    await viralAction.run(async () => {
      applyState(await api.retryViralAnalysis(selected.id));
    });
  }

  return (
    <div className="viral-analyzer-layout">
      <div className="viral-workbench">
        <section className="panel viral-input-panel">
          <div className="panel-title-row">
            <div>
              <h2>爆款拆解</h2>
              <p>支持抖音、快手、B站链接，拆解开头、结构、结尾、爆点。</p>
            </div>
            <Flame size={20} />
          </div>
          <label className="field-label" htmlFor="viral-url-input">视频链接</label>
          <input id="viral-url-input" className="text-input viral-url-input" value={url} onChange={(event) => handleUrlChange(event.target.value)} placeholder="https://www.douyin.com/video/..." />
          <div className="segmented viral-platform-picker">
            {viralSourceModes.map((item) => (
              <button key={item} type="button" className={sourceMode === item ? 'active' : ''} onClick={() => setSourceMode(item)}>
                {viralSourceModeLabel(item)}
              </button>
            ))}
          </div>
          <p className="viral-source-status">
            {sourceMode === 'auto' ? `自动识别：${viralPlatformLabel(detectedPlatform)}` : `手动指定：${viralPlatformLabel(selectedPlatformForAnalysis)}`}
          </p>
          <button className="primary-action viral-start-action" disabled={isBrowserPreview && false} onClick={startAnalysis}>
            <Search size={16} />
            开始拆解
          </button>
          <div className="viral-settings-grid">
            <Field label="关键帧数量">
              <input
                className="text-input"
                type="number"
                min={1}
                max={40}
                step={1}
                value={keyFrameCount}
                onChange={(event) => setKeyFrameCount(normalizeViralKeyFrameCount(event.target.value))}
              />
            </Field>
            <ViralChoiceGroup title="赛道" options={contentTracks} value={track} onChange={setTrack} />
            <ViralChoiceGroup title="风格" options={styleOptions} value={style} onChange={setStyle} />
            <ViralChoiceGroup title="比例" options={ratioOptions.map((item) => [item, item, ''])} value={ratio} onChange={setRatio} compact />
            <Field label="草稿模板">
              <select className="viral-draft-template-select" value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
                {state.draftTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} · {template.canvas.ratio}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="viral-cookie-tools">
            <div className="settings-inline-actions">
              <button className="mini-button" type="button" onClick={openDouyinLogin}>打开抖音登录窗口</button>
              <button className="mini-button" type="button" onClick={chooseCookieFile}>选择 Cookie 文件</button>
            </div>
            <Field label="Cookie 文件">
              <div className="viral-cookie-input-row">
                <input
                  id="viral-cookie-input"
                  className="text-input"
                  value={cookieFilePath}
                  onChange={(event) => setCookieFilePath(event.target.value)}
                  onBlur={() => saveViralCookiePath(cookieFilePath)}
                  placeholder="C:\\Users\\you\\Downloads\\cookies.txt"
                />
                {cookieFilePath ? <button className="mini-button" type="button" onClick={() => saveViralCookiePath('')}>清空</button> : null}
              </div>
            </Field>
            <p className="muted-text">抖音风控时先点登录窗口完成登录；关闭窗口后会自动写入本应用的 Cookie 文件。也可以手动选择 Netscape cookies.txt。</p>
          </div>
          {message ? <div className="test-result">{message}</div> : null}
          <InlineActionFeedback feedback={viralAction.feedback} />
        </section>

        <section className="panel viral-history-panel">
          <div className="panel-title-row">
            <h3>历史拆解</h3>
            <span className="panel-count">{state.viralAnalyses.length}</span>
          </div>
          <div className="viral-history-list">
            {state.viralAnalyses.map((item) => (
              <button key={item.id} title={item.title || item.url} className={selected?.id === item.id ? 'viral-history-item active' : 'viral-history-item'} onClick={() => setSelectedId(item.id)}>
                <strong>{item.title || item.url}</strong>
                <span>{viralPlatformLabel(item.platform)} · {viralStatusLabel(item.status)} · {(item.progress * 100).toFixed(0)}%</span>
              </button>
            ))}
            {state.viralAnalyses.length === 0 ? <p className="muted-text">暂无拆解任务</p> : null}
          </div>
        </section>
      </div>

      <section className="panel viral-progress-panel">
        <h3>任务进度</h3>
        <div className="viral-progress-list viral-stage-timeline">
          {viralStages.map((stage, stageIndex) => {
            const isActive = selected?.currentStage === stage;
            const isCompleted = selected?.status === 'completed' || (selectedStageIndex > stageIndex && selectedStageIndex !== -1);
            const isFailed = selected?.status === 'failed' && isActive;
            const className = ['viral-progress-step', 'viral-stage-node', isActive ? 'active' : '', isCompleted ? 'completed' : '', isFailed ? 'failed' : ''].filter(Boolean).join(' ');
            const latestEvent = latestViralEventForStage(selectedEvents, stage);
            return (
              <div key={stage} className={className}>
                <span>{viralStageLabel(stage)}</span>
                <small>{latestEvent?.detail ?? '等待中'}</small>
              </div>
            );
          })}
        </div>
        {selected?.errorMessage ? <ErrorSummaryButton title="拆解错误" fullMessage={selected.errorMessage} /> : null}
      </section>

      <section className="panel viral-report-panel viral-result-drawer">
        <div className="panel-title-row">
          <h3>拆解报告</h3>
          {selected?.status === 'failed' || selected?.status === 'cancelled' ? <button className="mini-button viral-retry-button" type="button" disabled={viralAction.busy} onClick={retryAnalysis}><RotateCcw size={14} />重试</button> : null}
        </div>
        {result ? <ViralReport result={result} createProductionTask={createProductionTask} saveTemplates={saveViralTemplates} /> : <p className="muted-text">任务完成后显示开头、结构、结尾、爆点和复刻方案。</p>}
      </section>
    </div>
  );
}

const viralStages = ['downloading', 'extracting', 'transcribing', 'analyzing_frames', 'breaking_down', 'recreating', 'completed'];

function latestViralEventForStage(events: ViralAnalysisEvent[], stage: string): ViralAnalysisEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.stage === stage) return event;
  }
  return null;
}

function normalizeViralKeyFrameCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 8;
  return Math.min(40, Math.max(1, Math.round(parsed)));
}

function ViralChoiceGroup({
  title,
  options,
  value,
  onChange,
  compact = false,
}: {
  title: string;
  options: string[][];
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  return (
    <section className={compact ? 'viral-choice-section compact' : 'viral-choice-section'}>
      <span>{title}</span>
      <div className="viral-choice-grid" role="radiogroup" aria-label={title}>
        {options.map(([id, label, hint]) => (
          <button key={id} type="button" role="radio" aria-checked={value === id} className={value === id ? 'viral-choice-button active' : 'viral-choice-button'} onClick={() => onChange(id)}>
            <strong>{label}</strong>
            {hint ? <small>{hint}</small> : null}
          </button>
        ))}
      </div>
    </section>
  );
}

type ViralInsightTab = 'copy' | 'prompt';

function ViralReport({
  result,
  createProductionTask,
  saveTemplates,
}: {
  result: ViralAnalysisResult;
  createProductionTask: () => void;
  saveTemplates: (input: { storyTemplateName: string; imageTemplateName: string }) => Promise<void>;
}) {
  const [insightTab, setInsightTab] = useState<ViralInsightTab>('copy');
  const defaultTemplateBaseName = viralTemplateBaseName(result);
  const [storyTemplateName, setStoryTemplateName] = useState(`爆款故事模板 - ${defaultTemplateBaseName}`);
  const [imageTemplateName, setImageTemplateName] = useState(`爆款图片模板 - ${defaultTemplateBaseName}`);
  const [savingTemplates, setSavingTemplates] = useState(false);
  const [templateSaveError, setTemplateSaveError] = useState('');
  const breakdown = result.contentBreakdown;
  const frames = uniqueViralPromptFrames(result.frames);
  const keyFrameCount = frames.length;
  const originalCopy = viralTranscriptText(result);

  useEffect(() => {
    setStoryTemplateName(`爆款故事模板 - ${defaultTemplateBaseName}`);
    setImageTemplateName(`爆款图片模板 - ${defaultTemplateBaseName}`);
    setTemplateSaveError('');
  }, [defaultTemplateBaseName]);

  async function handleSaveTemplates() {
    const nextStoryName = storyTemplateName.trim();
    const nextImageName = imageTemplateName.trim();
    if (!nextStoryName || !nextImageName || savingTemplates) return;
    setSavingTemplates(true);
    setTemplateSaveError('');
    try {
      await saveTemplates({ storyTemplateName: nextStoryName, imageTemplateName: nextImageName });
    } catch (error) {
      setTemplateSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingTemplates(false);
    }
  }

  return (
    <>
      <div className="viral-report-grid">
        <ViralReportCard title="开头" value={breakdown.opening.type} detail={breakdown.opening.analysis} />
        <ViralReportCard title="结构" value={breakdown.structure.type} detail={breakdown.structure.analysis} />
        <ViralReportCard title="结尾" value={breakdown.ending.type} detail={breakdown.ending.analysis} />
        <ViralReportCard title="爆点" value={breakdown.viralPoint.summary} detail={breakdown.viralPoint.reusablePattern} />
      </div>
      <div className="viral-frame-insights">
        <div className="viral-insight-tabs" role="tablist" aria-label="图文拆解">
          <button type="button" className={insightTab === 'copy' ? 'active' : ''} onClick={() => setInsightTab('copy')}>文案拆解</button>
          <button type="button" className={insightTab === 'prompt' ? 'active' : ''} onClick={() => setInsightTab('prompt')}>提示词拆解</button>
          <span className="viral-keyframe-count">关键帧数量：{keyFrameCount}</span>
        </div>
        {insightTab === 'copy' ? (
          <div className="viral-copy-breakdown">
            <section className="viral-original-copy">
              <span>原文案</span>
              <p>{originalCopy || '暂无转写文案。可以先确认语音转文字配置，或查看下方标题、开头、结构与爆点拆解。'}</p>
            </section>
            <div className="viral-copy-grid">
              <ViralCopyCard title="标题文案" value={breakdown.title.original || result.source.title || '未识别标题'} detail={breakdown.title.pattern} />
              <ViralCopyCard title="开头话术" value={breakdown.opening.type} detail={breakdown.opening.analysis} />
              <ViralCopyCard title="结尾话术" value={breakdown.ending.type} detail={breakdown.ending.analysis} />
              <ViralCopyCard title="爆点表达" value={breakdown.viralPoint.summary} detail={breakdown.viralPoint.reusablePattern} />
            </div>
          </div>
        ) : (
          <div className="viral-insight-list">
            {frames.map((frame) => (
              <article className="viral-insight-card" key={`${frame.timestamp}-${frame.framePath}`}>
                <span>{formatViralFrameTimestamp(frame.timestamp)} · 生图提示词拆解</span>
                <strong>{frameImagePrompt(frame)}</strong>
                <p>{framePromptDetail(frame)}</p>
              </article>
            ))}
            {frames.length === 0 ? <p className="muted-text">暂无关键帧提示词拆解结果</p> : null}
          </div>
        )}
      </div>
      <div className="viral-followup-panel">
        <h3>后续操作</h3>
        <p>{result.recreation.blueprint}</p>
        <textarea className="small-textarea" value={result.recreation.script} readOnly />
        <div className="viral-template-name-grid">
          <Field label="故事模板名">
            <input className="text-input" value={storyTemplateName} onChange={(event) => setStoryTemplateName(event.target.value)} />
          </Field>
          <Field label="图片模板名">
            <input className="text-input" value={imageTemplateName} onChange={(event) => setImageTemplateName(event.target.value)} />
          </Field>
        </div>
        {templateSaveError ? <p className="form-error">{templateSaveError}</p> : null}
        <div className="viral-followup-actions">
          <button className="primary-action" disabled={savingTemplates || !storyTemplateName.trim() || !imageTemplateName.trim()} onClick={() => void handleSaveTemplates()}>
            {savingTemplates ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
            {savingTemplates ? '保存中' : '保存为模板'}
          </button>
          <button className="ghost-action viral-create-production-task" onClick={createProductionTask}>
            <Wand2 size={16} />
            生成新任务
          </button>
        </div>
      </div>
    </>
  );
}

function viralTranscriptText(result: ViralAnalysisResult): string {
  return result.transcript.map((segment) => segment.text.trim()).filter(Boolean).join('\n');
}

function viralTemplateBaseName(result: ViralAnalysisResult): string {
  return trimForPreview(result.source.title || result.contentBreakdown.topic || '短视频', 18);
}

function frameImagePrompt(frame: ViralAnalysisResult['frames'][number]): string {
  return frame.imagePrompt || [
    frame.shotType,
    frame.composition,
    frame.visualDescription,
    frame.mood,
    frame.keyElements.length ? `关键元素：${frame.keyElements.join('、')}` : '',
  ].filter(Boolean).join('，');
}

function framePromptDetail(frame: ViralAnalysisResult['frames'][number]): string {
  return [
    frame.visualDescription,
    frame.textOverlay ? `画面文字：${frame.textOverlay}` : '',
    frame.keyElements.length ? `关键元素：${frame.keyElements.join('、')}` : '',
  ].filter(Boolean).join('\n');
}

function uniqueViralPromptFrames(frames: ViralAnalysisResult['frames']): ViralAnalysisResult['frames'] {
  const seen = new Set<string>();
  return frames.filter((frame) => {
    const signature = [
      frame.imagePrompt,
      frame.visualDescription,
      frame.textOverlay ?? '',
      frame.composition,
    ].map((item) => item.trim()).filter(Boolean).join('|') || `${frame.timestamp}-${frame.framePath}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function ViralCopyCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <article className="viral-insight-card viral-copy-card">
      <span>{title}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function formatViralFrameTimestamp(timestamp: number): string {
  return `${Math.max(0, Math.round(timestamp))}s`;
}

function ViralReportCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <article className="viral-report-card">
      <span>{title}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function viralPlatformLabel(platform: ViralPlatform): string {
  return { douyin: '抖音', kuaishou: '快手', bilibili: 'B站', unknown: '自动识别' }[platform];
}

function viralSourceModeLabel(mode: ViralSourceMode): string {
  return mode === 'auto' ? '自动识别' : viralPlatformLabel(mode);
}

function detectBrowserViralPlatform(url: string): ViralPlatform {
  const normalized = url.toLowerCase();
  if (/douyin\.com|iesdouyin\.com|amemv\.com/.test(normalized)) return 'douyin';
  if (/kuaishou\.com|gifshow\.com|kwai\.com/.test(normalized)) return 'kuaishou';
  if (/bilibili\.com|b23\.tv/.test(normalized)) return 'bilibili';
  return 'unknown';
}

function viralStatusLabel(status: ViralAnalysisStatus): string {
  return { pending: '等待', running: '运行中', paused: '暂停', completed: '已完成', failed: '失败', cancelled: '已取消' }[status];
}

function viralStageLabel(stage: string): string {
  return {
    downloading: '下载视频',
    extracting: '抽帧提音频',
    transcribing: '语音转写',
    analyzing_frames: '画面分析',
    breaking_down: '内容拆解',
    recreating: '复刻生成',
    completed: '完成',
  }[stage] ?? stage;
}

function ContentMetricsSummary({
  text,
  targetLength,
  storyboardSceneCount,
}: {
  text: string;
  targetLength: string;
  storyboardSceneCount: string;
}) {
  const visibleCount = countVisibleCharacters(text);
  const reviewRange = targetWordCountRange(targetLength, text);
  const previewSceneRange = storyboardSceneCountPreviewRange(text, targetLength);
  const manualSceneCount = normalizeStoryboardSceneCount(storyboardSceneCount);
  const manualSceneRange = manualSceneCount ? storyboardSceneCountRange(text, manualSceneCount) : null;

  return (
    <div className="content-metrics-row">
      <span>字数：{visibleCount}</span>
      <span>预审字数：{reviewRange ? `${reviewRange.min}-${reviewRange.max}` : '待输入'}</span>
      <span>自动分镜：{previewSceneRange ? `自动（${previewSceneRange.target}）` : '待输入'}</span>
      {manualSceneRange ? <span>当前目标：{manualSceneRange.target} 个（{manualSceneRange.min}-{manualSceneRange.max}）</span> : null}
    </div>
  );
}

function NewTaskPage({
  api,
  state,
  applyState,
  openTaskDetail,
  isBrowserPreview,
}: {
  api: StoryDreamApi;
  state: AppState;
  applyState: ApplyMutationResult;
  openTaskDetail: (taskId: string) => void;
  isBrowserPreview: boolean;
}) {
  const initialDraftTemplateId = defaultTaskDraftTemplateId(state.draftTemplates);
  const [mode, setMode] = useState<TaskMode>('paste');
  const [title, setTitle] = useState('');
  const [inputText, setInputText] = useState(sampleText);
  const [aiKeyword, setAiKeyword] = useState('武则天回宫');
  const [aiSources, setAiSources] = useState(['web']);
  const [extraRequirements, setExtraRequirements] = useState('字数控制在 500 字左右，聚焦人物转折经历，语气偏感性');
  const [track, setTrack] = useState('character-story');
  const [style, setStyle] = useState('photo-real');
  const [templateId, setTemplateId] = useState(initialDraftTemplateId);
  const [ratio, setRatio] = useState(() => draftTemplateImageRatio(state.draftTemplates, initialDraftTemplateId));
  const [selectedTaskLlmProfileId, setSelectedTaskLlmProfileId] = useState(state.config.activeLlmProfileId || state.config.llm.id || state.config.llmProfiles[0]?.id || '');
  const [promptTemplateOverrideId, setPromptTemplateOverrideId] = useState('');
  const [promptTemplateManuallyOverridden, setPromptTemplateManuallyOverridden] = useState(false);
  const [styleManuallyOverridden, setStyleManuallyOverridden] = useState(false);
  const [draftTemplateManuallyOverridden, setDraftTemplateManuallyOverridden] = useState(false);
  const [ratioManuallyOverridden, setRatioManuallyOverridden] = useState(false);
  const [ttsProvider, setTtsProvider] = useState<RuntimeTtsProvider>(() => normalizeRuntimeTtsProvider(state.config.tts.provider));
  const [speaker, setSpeaker] = useState(() => defaultTaskSpeakerForProvider(state.config.tts.provider, state.config));
  const [bgmId, setBgmId] = useState(() => resolveDefaultBgmId(state.config));
  const [referenceImagePath, setReferenceImagePath] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pausePoint, setPausePoint] = useState<PausePoint>('none');
  const [processingMode, setProcessingMode] = useState<ProcessingMode>('full-auto');
  const [rewriteIntensity, setRewriteIntensity] = useState<RewriteIntensity>('standard');
  const [narrativePov, setNarrativePov] = useState<Task['narrativePov']>('keep-original');
  const [keepPromotion, setKeepPromotion] = useState(false);
  const [productInfo, setProductInfo] = useState<string | null>(null);
  const [materialSource, setMaterialSource] = useState<'ai' | 'local'>('ai');
  const [materialPerson, setMaterialPerson] = useState('');
  const [fixedIntro, setFixedIntro] = useState('');
  const [outroCta, setOutroCta] = useState('');
  const [lockIntroSentences, setLockIntroSentences] = useState('0');
  const [personAssets, setPersonAssets] = useState<PersonAssetSummary[]>([]);
  const [ttsSpeed, setTtsSpeed] = useState(1);
  const [targetLength, setTargetLength] = useState('');
  const [storyboardSceneCount, setStoryboardSceneCount] = useState('');
  const [publishMode, setPublishMode] = useState<'review-rewrite' | 'direct-copy'>('review-rewrite');
  const [videoForm, setVideoForm] = useState<TaskVideoForm>('narration');
  const [coverImageMode, setCoverImageMode] = useState('off');
  const [coverTemplateId, setCoverTemplateId] = useState('cinematic-poster');
  const [podcastImageMode, setPodcastImageMode] = useState('multi');
  const [podcastSpeakers, setPodcastSpeakers] = useState<PodcastSpeakerPair>('kazai-dayi');
  const [running, setRunning] = useState(false);
  const [draftNotice, setDraftNotice] = useState('');
  const [searchingSources, setSearchingSources] = useState(false);
  const [searchContext, setSearchContext] = useState<AiSourceContext | null>(null);
  const [selectedSearchSourceIds, setSelectedSearchSourceIds] = useState<string[]>([]);
  const [searchMessage, setSearchMessage] = useState('');
  const [composingCopy, setComposingCopy] = useState(false);
  const [researchCopy, setResearchCopy] = useState('');
  const [researchCopyMessage, setResearchCopyMessage] = useState('');
  const taskAction = useAsyncAction();

  const searchSections = (searchContext?.sections ?? []).slice(0, 10);
  const selectedSources = searchSections.filter((source, index) => selectedSearchSourceIds.includes(sourceKey(source, index)));
  const taskPromptTemplates = state.promptTemplates.filter((template) => template.type === 'task');
  const storyTemplateOptions = buildStoryTemplateOptions(taskPromptTemplates);
  const taskPromptTemplateOptions = buildTaskPromptTemplateOptions(state.promptTemplates, track);
  const imageTemplateStyleOptions = buildImageTemplateStyleOptions(state.customStyles);
  const resolvedPromptTemplate = resolvePromptTemplateForTrack(state.promptTemplates, track, promptTemplateOverrideId || null);
  const selectedStoryTemplateId = promptTemplateOverrideId || resolvedPromptTemplate?.id || '';
  const availableStyleIds = state.customStyles.map((customStyle) => customStyle.id);
  const availableDraftTemplateIds = state.draftTemplates.map((draftTemplate) => draftTemplate.id);
  const bgmOptions = validBgmItems(state.config);
  const ttsVoiceOptions = ttsVoiceOptionsForProvider(ttsProvider);
  const podcastVoiceDefaults = defaultPodcastSpeakersForProvider(ttsProvider, podcastSpeakers);
  const storyboardScenePreviewRange = storyboardSceneCountPreviewRange(inputText, targetLength);
  const storyDreamCoverTemplateIds = ['cinematic-poster', 'podcast-cover'];
  const coverTemplateOptions = state.customCoverTemplates.map((template) => [template.id, template.name, template.description]);
  const coverTemplateSelectOptions = coverTemplateOptions.length
    ? coverTemplateOptions
    : [['cinematic-poster', '电影海报封面', 'StoryDream 默认封面模板']];
  const coverTemplateHint = storyDreamCoverTemplateIds.includes(coverTemplateId) ? 'StoryDream 兼容模板' : '自定义封面模板';
  const selectedMaterialAsset = personAssets.find((asset) => asset.name === materialPerson) ?? null;
  const isLocalMaterialInvalid = materialSource === 'local' && (!materialPerson || !selectedMaterialAsset || selectedMaterialAsset.count <= 0);

  useEffect(() => {
    const incomingProductInfo = sessionStorage.getItem('book_product_info');
    if (incomingProductInfo) {
      setProductInfo(incomingProductInfo);
      setKeepPromotion(true);
      sessionStorage.removeItem('book_product_info');
    }
    const incomingBenchmarkScript = sessionStorage.getItem('benchmark_script');
    if (incomingBenchmarkScript) {
      setInputText(incomingBenchmarkScript);
      setMode('paste');
      sessionStorage.removeItem('benchmark_script');
    }
  }, []);

  useEffect(() => {
    let active = true;
    api
      .listPersonAssets()
      .then((assets) => {
        if (active) setPersonAssets(assets);
      })
      .catch(taskAction.reportError);
    return () => {
      active = false;
    };
  }, [api, taskAction.reportError]);

  useEffect(() => {
    if (materialSource === 'local' && !materialPerson && personAssets[0]) {
      setMaterialPerson(personAssets[0].name);
    }
  }, [materialSource, materialPerson, personAssets]);

  useEffect(() => {
    setBgmId((current) => (current && bgmOptions.some((bgm) => bgm.id === current) ? current : resolveDefaultBgmId(state.config)));
  }, [state.config.jianying.bgmLibrary, state.config.jianying.defaultBgmId]);

  useEffect(() => {
    const provider = normalizeRuntimeTtsProvider(state.config.tts.provider);
    const nextSpeaker = defaultTaskSpeakerForProvider(provider, state.config);
    setTtsProvider(provider);
    setSpeaker(nextSpeaker);
  }, [state.config.activeTtsProfileId, state.config.tts.provider, state.config.tts.speaker, state.config.tts.volcengine.speaker, state.config.tts.minimax.voiceId]);

  useEffect(() => {
    if (!state.config.llmProfiles.some((profile) => profile.id === selectedTaskLlmProfileId)) {
      setSelectedTaskLlmProfileId(state.config.activeLlmProfileId || state.config.llm.id || state.config.llmProfiles[0]?.id || '');
    }
  }, [state.config.activeLlmProfileId, state.config.llm.id, state.config.llmProfiles, selectedTaskLlmProfileId]);

  useEffect(() => {
    if (!styleManuallyOverridden && resolvedPromptTemplate) {
      setStyle(resolvePromptTemplateDefaultStyleId(resolvedPromptTemplate, availableStyleIds));
    }
  }, [resolvedPromptTemplate?.id, styleManuallyOverridden, state.customStyles]);

  function handleStoryTemplateChange(nextTemplateId: string) {
    setPromptTemplateManuallyOverridden(true);
    setPromptTemplateOverrideId(nextTemplateId);
    const template = state.promptTemplates.find((item) => item.id === nextTemplateId && item.type === 'task') ?? null;
    const nextTrack = template?.baseTrack || track;
    if (nextTrack !== track) {
      setTrack(nextTrack);
    }
    if (!styleManuallyOverridden && template) {
      setStyle(resolvePromptTemplateDefaultStyleId(template, availableStyleIds));
    }
    if (!draftTemplateManuallyOverridden && template) {
      const nextDraftTemplateId = resolvePromptTemplateDefaultDraftTemplateId(template, availableDraftTemplateIds, templateId);
      setTemplateId(nextDraftTemplateId);
      if (!ratioManuallyOverridden) {
        setRatio(draftTemplateImageRatio(state.draftTemplates, nextDraftTemplateId));
      }
    }
  }

  function handleStyleChange(nextStyle: string) {
    setStyleManuallyOverridden(true);
    setStyle(nextStyle);
  }

  function handleDraftTemplateChange(nextTemplateId: string) {
    setDraftTemplateManuallyOverridden(true);
    setTemplateId(nextTemplateId);
    setRatioManuallyOverridden(false);
    setRatio(draftTemplateImageRatio(state.draftTemplates, nextTemplateId));
  }

  function handleRatioChange(nextRatio: string) {
    setRatioManuallyOverridden(true);
    setRatio(nextRatio);
  }

  function handlePromptTemplateOverrideChange(nextId: string) {
    setPromptTemplateManuallyOverridden(Boolean(nextId));
    setPromptTemplateOverrideId(nextId);
    const template = resolvePromptTemplateForTrack(state.promptTemplates, track, nextId || null);
    if (template?.baseTrack && template.baseTrack !== track) {
      setTrack(template.baseTrack);
    }
    if (!styleManuallyOverridden && template) {
      setStyle(resolvePromptTemplateDefaultStyleId(template, availableStyleIds));
    }
    if (!draftTemplateManuallyOverridden && template) {
      const nextTemplateId = resolvePromptTemplateDefaultDraftTemplateId(template, availableDraftTemplateIds, templateId);
      setTemplateId(nextTemplateId);
      if (!ratioManuallyOverridden) {
        setRatio(draftTemplateImageRatio(state.draftTemplates, nextTemplateId));
      }
    }
  }

  function handleTtsProviderChange(nextProvider: string) {
    const provider = normalizeRuntimeTtsProvider(nextProvider);
    const nextSpeaker = defaultTaskSpeakerForProvider(provider, state.config);
    setTtsProvider(provider);
    setSpeaker(nextSpeaker);
  }

  async function searchWebSources() {
    const keyword = aiKeyword.trim();
    if (!keyword) {
      setSearchMessage('请先输入关键词。');
      return;
    }
    await taskAction.run(async () => {
      setSearchingSources(true);
      setSearchMessage('正在从 Bing 搜索并读取网页正文...');
      try {
        const context = await api.searchWebSources(keyword);
        const limitedContext = { ...context, sections: context.sections.slice(0, 10) };
        setSearchContext(limitedContext);
        setSelectedSearchSourceIds([]);
        setSearchMessage(context.warnings.length ? context.warnings.join('；') : `已获取前 ${limitedContext.sections.length} 条网页资料，请勾选要使用的页面。`);
      } finally {
        setSearchingSources(false);
      }
    }, { onError: (error) => setSearchMessage(error.message) });
  }

  async function composeResearchCopy() {
    if (selectedSources.length === 0) {
      setResearchCopyMessage('请先勾选至少 1 个网页来源。');
      return;
    }
    await taskAction.run(async () => {
      setComposingCopy(true);
      setResearchCopyMessage('正在结合所选页面信息生成文案...');
      try {
        const result = await api.composeResearchCopy({
          keyword: aiKeyword.trim(),
          extraRequirements,
          selectedSources,
          targetLength: normalizeTaskTargetLength(targetLength) ?? undefined,
        });
        setResearchCopy(result.copy);
        setInputText(result.copy);
        setTitle(result.title || aiKeyword.trim());
        setMode('paste');
        setResearchCopyMessage(`已生成文案并填入粘贴文案${result.requestId ? `（request ${result.requestId}）` : ''}。`);
      } finally {
        setComposingCopy(false);
      }
    }, { onError: (error) => setResearchCopyMessage(error.message) });
  }

  async function addBgmFromTask() {
    await taskAction.run(async () => {
      const audioPath = await api.selectLocalAudio();
      if (!audioPath) return;
      const nextBgm = addUploadedBgm(state.config, audioPath);
      const next = await api.saveConfig({ config: nextBgm.config, secretChanges: {} });
      applyState(next);
      setBgmId(nextBgm.bgmId);
    });
  }

  async function selectTaskReferenceImage() {
    await taskAction.run(async () => {
      const imagePath = await api.selectLocalImage();
      if (imagePath) setReferenceImagePath(imagePath);
    });
  }

  async function run() {
    if (isBrowserPreview) {
      setDraftNotice('浏览器预览不能执行真实流水线，请在 Electron 应用中运行任务。');
      return;
    }
    if (materialSource === 'local' && !materialPerson) {
      setDraftNotice('请先选择人物素材。');
      return;
    }
    if (materialSource === 'local' && (!selectedMaterialAsset || selectedMaterialAsset.count <= 0)) {
      setDraftNotice('所选人物素材至少导入 1 张图片后才能创建任务。');
      return;
    }
    setDraftNotice('');
    await taskAction.run(async () => {
      setRunning(true);
      try {
        const next = await api.createAndRunTask({
        title,
        inputText: mode === 'paste' ? inputText : researchCopy.trim() || `${aiKeyword}\n\n${extraRequirements}`,
        mode,
        aiKeyword,
        aiSources,
        selectedSources: mode === 'ai' ? selectedSources : [],
        extraRequirements,
        track,
        style,
        speaker,
        ratio,
        templateId,
        llmProfileId: selectedTaskLlmProfileId,
        videoForm,
        coverImageMode,
        coverTemplateId,
        podcastImageMode,
        podcastSpeakers: videoForm === 'two-host-podcast' ? podcastSpeakers : null,
        podcastSpeakerA: videoForm === 'two-host-podcast' ? podcastVoiceDefaults.podcastSpeakerA : null,
        podcastSpeakerB: videoForm === 'two-host-podcast' ? podcastVoiceDefaults.podcastSpeakerB : null,
        scriptFormat: videoForm === 'two-host-podcast' ? 'dialogue' : 'narration',
        bgmId,
        pausePoints: [pausePoint],
        processingMode,
        referenceImagePath,
        rewriteIntensity,
        narrativePov,
        keepPromotion: keepPromotion || Boolean(productInfo),
        productInfo,
        materialSource,
        materialPerson: materialSource === 'local' ? materialPerson : null,
        fixedIntro,
        outroCta,
        lockIntroSentences: normalizeLockIntroSentencesInput(lockIntroSentences),
        ttsProvider,
        ttsSpeed,
        publishMode,
        targetLength: normalizeTaskTargetLength(targetLength) ?? undefined,
        targetScenes: normalizeTaskStoryboardSceneCount(storyboardSceneCount),
        storyboardSceneCount: normalizeTaskStoryboardSceneCount(storyboardSceneCount),
        promptTemplateId: resolvedPromptTemplate?.id ?? null,
        promptTemplateType: 'task',
        });
        applyState(next);
        const createdTask = taskFromMutation(next);
        if (createdTask) {
          openTaskDetail(createdTask.id);
        }
      } finally {
        setRunning(false);
      }
    }, { onError: (error) => setDraftNotice(error.message) });
  }

  return (
    <div className="new-task-scroll">
      <section className="task-card">
        <Field label="标题" hint="可选">
          <input value={title} placeholder="留空会从文案自动提取" onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <div className="mode-grid">
          <button className={mode === 'paste' ? 'mode-card active' : 'mode-card'} onClick={() => setMode('paste')}>
            <strong>粘贴文案</strong>
            <span>已有对标文案，直接贴进来改写</span>
          </button>
          <button className={mode === 'ai' ? 'mode-card active' : 'mode-card'} onClick={() => setMode('ai')}>
            <strong>AI 创作 <em>NEW</em></strong>
            <span>输入关键词，AI 自动搜索并创作原稿</span>
          </button>
        </div>

        {mode === 'paste' ? (
          <Field label="文案内容">
            <textarea className="source-textarea" value={inputText} onChange={(event) => setInputText(event.target.value)} />
            <ContentMetricsSummary text={inputText} targetLength={targetLength} storyboardSceneCount={storyboardSceneCount} />
          </Field>
        ) : (
          <div className="ai-create-panel">
            <Field label="关键词">
              <input value={aiKeyword} onChange={(event) => setAiKeyword(event.target.value)} placeholder="例如：钱学森回国 / 张桂梅 / 苹果秋季发布会" />
            </Field>
            <span className="field-title">数据源</span>
            <label className="check-row">
              <input type="checkbox" checked={aiSources.includes('web')} onChange={() => setAiSources(toggleArray(aiSources, 'web'))} />
              全网搜索 <small>从 Bing + 搜狗 + 百度 + 360 搜索，补充百科、知乎、百家号、头条正文</small>
            </label>
            <label className="check-row">
              <input type="checkbox" checked={aiSources.includes('builtin-knowledge')} onChange={() => setAiSources(toggleArray(aiSources, 'builtin-knowledge'))} />
              AI 内置知识补全 <small>允许 AI 用自己的知识补全细节</small>
            </label>
            <label className="check-row muted">
              <input type="checkbox" checked={aiSources.includes('ima')} onChange={() => setAiSources(toggleArray(aiSources, 'ima'))} />
              IMA 知识库 <small>前往系统设置 · AI 创作配置</small>
            </label>
            <Field label="额外要求" hint="可选">
              <input className="extra-requirements-input" value={extraRequirements} onChange={(event) => setExtraRequirements(event.target.value)} />
            </Field>
            <button className="ghost-action" disabled={searchingSources || !aiKeyword.trim()} onClick={searchWebSources}>
              {searchingSources ? <Loader2 className="spin" size={15} /> : <Search size={15} />}
              搜索
            </button>
            {searchMessage ? <div className="test-result">{searchMessage}</div> : null}
            {searchContext ? (
              <div className="ai-search-block">
                <div className="ai-search-results ai-search-results-scroll">
                  <div className="panel-title-row">
                    <h3>网页候选（前 10 条）</h3>
                    <small>{selectedSources.length}/{searchContext.sections.length} 已选择</small>
                  </div>
                  {searchContext.sections.length === 0 ? <EmptyState title="暂无可用网页资料" /> : null}
                  {searchContext.sections.map((source, index) => {
                    const id = sourceKey(source, index);
                    return (
                      <label className="search-source-card" key={id}>
                        <input type="checkbox" checked={selectedSearchSourceIds.includes(id)} onChange={() => setSelectedSearchSourceIds(toggleArray(selectedSearchSourceIds, id))} />
                        <div>
                          <strong>{source.title}</strong>
                          {source.url ? <span>{source.url}</span> : null}
                          <p>{(source.content || source.snippet || '').slice(0, 220)}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
                <div className="ai-search-actions">
                  <button className="primary-action slim" disabled={composingCopy || selectedSources.length === 0} onClick={composeResearchCopy}>
                    {composingCopy ? <Loader2 className="spin" size={15} /> : <Wand2 size={15} />}
                    结合所选页面信息生成文案
                  </button>
                </div>
                {researchCopyMessage ? <div className="test-result">{researchCopyMessage}</div> : null}
                {researchCopy ? (
                  <Field label="生成文案（可编辑）">
                    <textarea
                      className="small-textarea research-copy-textarea"
                      value={researchCopy}
                      onChange={(event) => {
                        setResearchCopy(event.target.value);
                        setInputText(event.target.value);
                      }}
                    />
                    <ContentMetricsSummary text={researchCopy} targetLength={targetLength} storyboardSceneCount={storyboardSceneCount} />
                  </Field>
                ) : null}
              </div>
            ) : null}
          </div>
        )}

        <OptionCloud title="内容赛道" options={storyTemplateOptions} value={selectedStoryTemplateId} onChange={handleStoryTemplateChange} />
        <Field label="提示词模板" hint={resolvedPromptTemplate ? `当前使用：${resolvedPromptTemplate.name}` : '自动匹配赛道模板'}>
          <select className="prompt-template-selector" value={promptTemplateOverrideId || resolvedPromptTemplate?.id || ''} onChange={(event) => handlePromptTemplateOverrideChange(event.target.value)}>
            <option value="">自动匹配赛道模板</option>
            {taskPromptTemplateOptions.map(([id, label, hint]) => (
              <option key={id} value={id}>
                {hint ? `${label} · ${hint}` : label}
              </option>
            ))}
          </select>
        </Field>
        <OptionCloud title="画面风格" options={imageTemplateStyleOptions} value={style} onChange={handleStyleChange} />
        {resolvedPromptTemplate ? (
          <div className="template-default-summary">
            <strong>模板默认项</strong>
            <span>故事模板：{resolvedPromptTemplate.name}</span>
            <span>默认图像模板：{styleLabel(style, state.customStyles)}</span>
            <span>默认草稿模板：{draftTemplateLabel(templateId, state.draftTemplates)}</span>
            <span>主角档案：{characterPolicyLabel(resolvedPromptTemplate.characterPolicy)}</span>
            <span>参考图类型：{referenceKindLabel(resolvedPromptTemplate.referenceKind)}</span>
            <span>Step 3 骨架：{(resolvedPromptTemplate.step3SkeletonModules ?? []).join('、') || '未设置'}</span>
          </div>
        ) : null}

        <div className="video-form-panel">
          <div className="video-form-head">
            <span className="field-title">视频形态</span>
            <small>{videoForm === 'two-host-podcast' ? '双人播客会自动使用对话脚本和播客配图策略' : '单人配音讲述，适合常规旁白视频'}</small>
          </div>
          <div className="video-form-grid">
            <button className={videoForm === 'narration' ? 'video-form-option active' : 'video-form-option'} onClick={() => setVideoForm('narration')}>
              <strong>旁白视频</strong>
              <span>单人配音讲述（默认）</span>
            </button>
            <button className={videoForm === 'two-host-podcast' ? 'video-form-option active' : 'video-form-option'} onClick={() => setVideoForm('two-host-podcast')}>
              <strong>双人播客</strong>
              <span>两位主播一问一答聊内容</span>
            </button>
          </div>
          {videoForm === 'two-host-podcast' ? (
            <div className="podcast-form-controls">
              <span className="podcast-form-label">播客配图</span>
              <Segmented label="配图方式" value={podcastImageMode} options={['multi', 'single']} labels={['按分镜配图', '单图封面']} onChange={setPodcastImageMode} />
              <Segmented
                label="主播组合"
                value={podcastSpeakers}
                options={['kazai-dayi', 'liufei-xiaolei']}
                labels={['咔仔 x 大壹', '刘飞 x 潇磊']}
                onChange={(value) => setPodcastSpeakers(value as PodcastSpeakerPair)}
              />
              <p className="podcast-form-note">主播组合会写入对话脚本与播客封面提示，并自动使用两套默认音色生成 A/B 对话。</p>
            </div>
          ) : null}
        </div>

        <div className="option-two-col">
          <Field label="封面模板" hint={coverTemplateHint}>
            <select className="cover-template-select" value={coverTemplateId} onChange={(event) => setCoverTemplateId(event.target.value)}>
              {coverTemplateSelectOptions.map(([id, label, hint]) => (
                <option key={id} value={id}>
                  {hint ? `${label} · ${id}` : label}
                </option>
              ))}
            </select>
          </Field>
          <Segmented label="封面生成" value={coverImageMode} options={['off', 'auto', 'manual']} labels={['关闭', '自动', '仅封面']} onChange={setCoverImageMode} />
        </div>

        <div className="option-two-col">
          <OptionCloud title="草稿模板" options={state.draftTemplates.map((template) => [template.id, template.name, `出图 ${template.image.ratio}`])} value={templateId} onChange={handleDraftTemplateChange} />
          <div>
            <span className="field-title">AI 出图比例 <small>{ratioManuallyOverridden ? '已手动覆盖' : '已跟随草稿模板'}</small></span>
            <div className="ratio-grid">
              {['9:16', '4:3', '1:1', '16:9'].map((item) => (
                <button key={item} className={ratio === item ? 'chip active' : 'chip'} onClick={() => handleRatioChange(item)}>
                  <span className="ratio-icon" />
                  {item}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="target-controls-row">
          <label className="target-number-field">
            <span>目标字数</span>
            <input
              type="number"
              min="100"
              max="5000"
              step="50"
              value={targetLength}
              placeholder="自动"
              onChange={(event) => setTargetLength(event.target.value)}
            />
            <small>字（±20%，留空跟随原文）</small>
          </label>
          <label className="target-number-field">
            <span>目标分镜数</span>
            <input
              type="number"
              min="1"
              max="60"
              step="1"
              value={storyboardSceneCount}
              placeholder={storyboardScenePreviewRange ? `自动（${storyboardScenePreviewRange.target}）` : '自动'}
              onChange={(event) => setStoryboardSceneCount(event.target.value)}
            />
            <small>个（±10%，建议每镜 25-45 字）</small>
          </label>
          <label className="target-number-field">
            <span>发布方式</span>
            <Segmented
              label=""
              value={publishMode}
              options={['review-rewrite', 'direct-copy']}
              labels={['预审改写', '直接复用']}
              onChange={(value) => setPublishMode(value as 'review-rewrite' | 'direct-copy')}
            />
            <small>预审改写会走完整流程，直接复用原文可跳过 Step 0 / 1</small>
          </label>
        </div>

        <>
          <span className="field-title">配音员</span>
          <Segmented label="配音模型" value={ttsProvider} options={['volcengine', 'minimax']} labels={['豆包', 'MiniMax']} onChange={handleTtsProviderChange} />
          {videoForm !== 'two-host-podcast' ? (
            <>
            <div className="chip-row">
              {ttsVoiceOptions.map((voice) => (
                <button key={voice.id} className={speaker === voice.id ? 'chip active' : 'chip'} title={voice.id} onClick={() => setSpeaker(voice.id)}>
                  <Mic2 size={14} />
                  {voice.label}
                </button>
              ))}
            </div>
            <span className="hint-text">当前默认配音员：{taskSpeakerLabel(ttsProvider, speaker)} · {speaker}</span>
            </>
          ) : <span className="hint-text">双人播客会按主播组合自动拆分 A/B 音色，当前模型：{ttsProvider}</span>}
        </>

        <span className="field-title">背景音乐</span>
        <div className="chip-row">
          <button className={bgmId === '' ? 'chip active' : 'chip'} onClick={() => setBgmId('')}>
            无 BGM
          </button>
          {bgmOptions.map((bgm) => (
            <button key={bgm.id} className={bgmId === bgm.id ? 'chip active' : 'chip'} onClick={() => setBgmId(bgm.id)}>
              {bgm.title}
            </button>
          ))}
          <button className="chip" onClick={addBgmFromTask}><Plus size={14} />添加</button>
        </div>

        <Field label="主角参考图" hint="可选">
          <div className="upload-row">
            <input value={referenceImagePath} placeholder="上传后出现主角的分镜会以这张为基础保持人物一致" onChange={(event) => setReferenceImagePath(event.target.value)} />
            <button className="ghost-action" onClick={selectTaskReferenceImage}>
              <Upload size={15} />
              上传主角参考图
            </button>
          </div>
        </Field>

        <button className="advanced-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
          {showAdvanced ? '▼' : '▶'} 高级选项 <span>改写强度 · 叙事视角 · 带货 · 处理模式 · 暂停确认</span>
        </button>
        {showAdvanced ? (
          <div className="advanced-grid">
            <Segmented label="处理模式" value={processingMode} options={['full-auto', 'semi-auto', 'clip-only']} labels={['全自动', '半自动', '只出方案']} onChange={(value) => setProcessingMode(value as ProcessingMode)} />
            <Segmented label="暂停确认" value={pausePoint} options={pauseOptions.map(([id]) => id)} labels={pauseOptions.map(([, label]) => label)} onChange={(value) => setPausePoint(value as PausePoint)} />
            <Segmented label="改写强度" value={rewriteIntensity} options={rewriteOptions.map(([id]) => id)} labels={rewriteOptions.map(([, label]) => label)} onChange={(value) => setRewriteIntensity(value as RewriteIntensity)} />
            <Segmented label="叙事视角" value={narrativePov} options={povOptions.map(([id]) => id)} labels={povOptions.map(([, label]) => label)} onChange={(value) => setNarrativePov(value as Task['narrativePov'])} />
            <label className="toggle-row">
              <input type="checkbox" checked={keepPromotion} onChange={(event) => setKeepPromotion(event.target.checked)} />
              带货模式 <small>改写时删除带货段落</small>
            </label>
            <div className="advanced-section copy-control-section">
              <div className="section-title-row">
                <span className="field-title">文案把控</span>
                {productInfo ? <small>已带入：{productInfoSummary(productInfo)}</small> : null}
              </div>
              <div className="copy-control-grid">
                <Field label="固定开头" hint="可选">
                  <textarea className="small-textarea" value={fixedIntro} onChange={(event) => setFixedIntro(event.target.value)} placeholder="例如：今天这本书，先看第一句话。" />
                </Field>
                <Field label="结尾引导" hint="可用 {主角}">
                  <textarea className="small-textarea" value={outroCta} onChange={(event) => setOutroCta(event.target.value)} placeholder="例如：想读{主角}，去橱窗找这本书。" />
                </Field>
                <Field label="锁定开头句数">
                  <input type="number" min="0" max="20" step="1" value={lockIntroSentences} onChange={(event) => setLockIntroSentences(event.target.value)} />
                </Field>
              </div>
            </div>
            <div className="advanced-section material-source-section">
              <Segmented label="素材来源" value={materialSource} options={['ai', 'local']} labels={['AI 生图', '本地人物素材']} onChange={(value) => setMaterialSource(value as 'ai' | 'local')} />
              {materialSource === 'local' ? (
                <Field label="本地人物素材">
                  <select value={materialPerson} onChange={(event) => setMaterialPerson(event.target.value)}>
                    <option value="">请选择人物</option>
                    {personAssets.map((asset) => (
                      <option key={asset.name} value={asset.name}>
                        {asset.name} · {asset.count} 张
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
            </div>
            <Segmented label="配音语速" value={String(ttsSpeed)} options={['0.85', '1', '1.15', '1.3']} labels={['慢速 0.85x', '默认 1.0x', '快速 1.15x', '更快 1.3x']} onChange={(value) => setTtsSpeed(Number(value))} />
            <Field label="自定义 / 其他模型">
              <select value={selectedTaskLlmProfileId} onChange={(event) => setSelectedTaskLlmProfileId(event.target.value)}>
                {state.config.llmProfiles.map((profile) => (
                  <option key={profile.id ?? profile.model} value={profile.id ?? profile.model}>
                    {profile.provider}: {profile.model}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        ) : null}

        <div className="task-footer">
          <span className="danger-text">{isBrowserPreview ? '浏览器预览不能执行真实流水线' : '试用已用尽，复刻版仅本地模拟，不阻断生成'}</span>
          <div className="button-row">
            <button className="ghost-action" onClick={() => setDraftNotice('已保存为本地草稿预设')}>
              保存为草稿
            </button>
            <button className="primary-action" onClick={run} disabled={running || isBrowserPreview || isLocalMaterialInvalid || (mode === 'paste' ? inputText.trim().length === 0 : aiKeyword.trim().length === 0)}>
              {running ? <Loader2 className="spin" size={17} /> : <Play size={17} />}
              {running ? '运行中' : '开始生成'}
            </button>
          </div>
        </div>
        {draftNotice ? <span className="local-note">{draftNotice}</span> : null}
        <InlineActionFeedback feedback={taskAction.feedback} />
      </section>
    </div>
  );
}

function BookSelectionPage({ api, navigate }: { api: StoryDreamApi; navigate: (view: ShellView) => void }) {
  const [records, setRecords] = useState<BookSelectionRecord[]>([]);
  const [selectedBookId, setSelectedBookId] = useState('');
  const [theme, setTheme] = useState('故事带货');
  const [name, setName] = useState('');
  const [author, setAuthor] = useState('');
  const [category, setCategory] = useState('');
  const [keyword, setKeyword] = useState('');
  const [sellPoint, setSellPoint] = useState('');
  const [audience, setAudience] = useState('');
  const [persons, setPersons] = useState('');
  const [era, setEra] = useState('');
  const [price, setPrice] = useState('');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [pendingAction, setPendingAction] = useState<'save' | `delete:${string}` | null>(null);
  const bookAction = useAsyncAction();

  useEffect(() => {
    let active = true;
    api
      .listBookSelections()
      .then((items) => {
        if (active) setRecords(items);
      })
      .catch((error) => {
        if (active) bookAction.reportError(error);
      });
    return () => {
      active = false;
    };
  }, [api, bookAction.reportError]);

  function loadSelections() {
    return api.listBookSelections().then(setRecords);
  }

  async function refreshSelections() {
    await bookAction.run(loadSelections);
  }

  function loadRecord(record: BookSelectionRecord) {
    setSelectedBookId(record.bookId);
    setTheme(record.theme);
    setName(record.data.name ?? '');
    setAuthor(record.data.author ?? '');
    setCategory(record.data.category ?? '');
    setKeyword(record.data.keyword ?? '');
    setSellPoint(record.data.sellPoint ?? '');
    setAudience(record.data.audience ?? '');
    setPersons(record.data.persons ?? '');
    setEra(record.data.era ?? '');
    setPrice(record.data.price ?? '');
    setUrl(record.data.url ?? '');
    setNote(record.data.note ?? '');
    setMessage('');
  }

  function clearForm() {
    setSelectedBookId('');
    setName('');
    setAuthor('');
    setCategory('');
    setKeyword('');
    setSellPoint('');
    setAudience('');
    setPersons('');
    setEra('');
    setPrice('');
    setUrl('');
    setNote('');
    setMessage('');
  }

  function productData(): BookProductInfo {
    return {
      name: name.trim(),
      author: emptyToUndefined(author),
      category: emptyToUndefined(category),
      keyword: emptyToUndefined(keyword),
      sellPoint: emptyToUndefined(sellPoint),
      audience: emptyToUndefined(audience),
      persons: emptyToUndefined(persons),
      era: emptyToUndefined(era),
      price: emptyToUndefined(price),
      url: emptyToUndefined(url),
      note: emptyToUndefined(note),
    };
  }

  async function saveSelection() {
    if (!name.trim()) {
      setMessage('请先填写商品 / 书名。');
      return;
    }
    if (!theme.trim()) {
      setMessage('请先填写主题。');
      return;
    }
    await bookAction.run(async () => {
      setPendingAction('save');
      try {
        const record = await api.saveBookSelection({
          theme: theme.trim(),
          bookId: selectedBookId || undefined,
          data: productData(),
        });
        setSelectedBookId(record.bookId);
        await loadSelections();
        setMessage('已保存选品。');
      } finally {
        setPendingAction(null);
      }
    }, { onError: (error) => setMessage(error.message) });
  }

  async function deleteSelection(record: BookSelectionRecord) {
    await bookAction.run(async () => {
      setPendingAction(`delete:${record.bookId}`);
      try {
        await api.deleteBookSelection(record.theme, record.bookId);
        if (selectedBookId === record.bookId) clearForm();
        await loadSelections();
        setMessage('已删除选品。');
      } finally {
        setPendingAction(null);
      }
    }, { onError: (error) => setMessage(error.message) });
  }

  function handoffProduct(record: BookSelectionRecord, view: ShellView) {
    sessionStorage.setItem('book_product_info', JSON.stringify(record.data));
    if (view === 'benchmark') {
      sessionStorage.setItem('benchmark_search', record.data.keyword || record.data.name);
    }
    navigate(view);
  }

  return (
    <div className="selection-grid">
      <section className="panel selection-list-panel">
        <div className="panel-title-row">
          <div>
            <h2>选品助手</h2>
            <span>本地维护商品卖点，直接带入新任务。</span>
          </div>
          <button className="ghost-action compact-action" type="button" onClick={clearForm}>
            <Plus size={15} />
            新选品
          </button>
        </div>
        <div className="selection-card-list">
          {records.length === 0 ? <EmptyState title="暂无选品" /> : null}
          {records.map((record) => (
            <article key={`${record.theme}-${record.bookId}`} className={record.bookId === selectedBookId ? 'selection-card active' : 'selection-card'}>
              <button type="button" className="selection-card-main" onClick={() => loadRecord(record)}>
                <strong>{record.data.name}</strong>
                <span>{record.theme} · {record.data.author || record.data.category || '未填分类'}</span>
                <p>{record.data.sellPoint || record.data.note || '未填写卖点'}</p>
              </button>
              <div className="selection-card-actions">
                <button className="mini-button" type="button" onClick={() => handoffProduct(record, 'new-task')}>带入新建任务</button>
                <button className="mini-button" type="button" onClick={() => handoffProduct(record, 'benchmark')}>去对标导入</button>
                <button className="mini-button" type="button" disabled={pendingAction === `delete:${record.bookId}` || pendingAction === 'save'} onClick={() => deleteSelection(record)}>删除</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel selection-editor-panel">
        <div className="panel-title-row">
          <div>
            <h3>{selectedBookId ? '编辑选品' : '新增选品'}</h3>
            <span>商品信息只保存在本地，不调用远端 Storybound 接口。</span>
          </div>
          <button className="primary-action slim" type="button" disabled={pendingAction !== null} onClick={saveSelection}>
            <Save size={15} />
            保存选品
          </button>
        </div>
        <div className="selection-form-grid">
          <Field label="主题">
            <input value={theme} onChange={(event) => setTheme(event.target.value)} placeholder="例如：故事带货 / 健康书单" />
          </Field>
          <Field label="商品 / 书名">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：额尔古纳河右岸" />
          </Field>
          <Field label="作者">
            <input value={author} onChange={(event) => setAuthor(event.target.value)} />
          </Field>
          <Field label="分类">
            <input value={category} onChange={(event) => setCategory(event.target.value)} />
          </Field>
          <Field label="关键词">
            <input value={keyword} onChange={(event) => setKeyword(event.target.value)} />
          </Field>
          <Field label="价格">
            <input value={price} onChange={(event) => setPrice(event.target.value)} />
          </Field>
          <Field label="目标人群">
            <input value={audience} onChange={(event) => setAudience(event.target.value)} />
          </Field>
          <Field label="人物">
            <input value={persons} onChange={(event) => setPersons(event.target.value)} />
          </Field>
          <Field label="年代 / 场景">
            <input value={era} onChange={(event) => setEra(event.target.value)} />
          </Field>
          <Field label="链接">
            <input value={url} onChange={(event) => setUrl(event.target.value)} />
          </Field>
        </div>
        <Field label="核心卖点">
          <textarea className="small-textarea" value={sellPoint} onChange={(event) => setSellPoint(event.target.value)} />
        </Field>
        <Field label="备注">
          <textarea className="small-textarea" value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
        {message ? <span className="local-note">{message}</span> : null}
        <InlineActionFeedback feedback={bookAction.feedback} />
      </section>
    </div>
  );
}

function BenchmarkImportPage({
  api,
  applyState,
  openTaskDetail,
  isBrowserPreview,
}: {
  api: StoryDreamApi;
  applyState: ApplyMutationResult;
  openTaskDetail: (taskId: string) => void;
  isBrowserPreview: boolean;
}) {
  const [sourceLink, setSourceLink] = useState('');
  const [benchmarkTitle, setBenchmarkTitle] = useState('');
  const [keyword, setKeyword] = useState('');
  const [script, setScript] = useState('');
  const [productInfo, setProductInfo] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const benchmarkAction = useAsyncAction();
  const product = parseBookProductInfo(productInfo);
  const productName = product?.name ?? '';

  useEffect(() => {
    const incomingProductInfo = sessionStorage.getItem('book_product_info');
    const incomingSearch = sessionStorage.getItem('benchmark_search');
    if (incomingProductInfo) setProductInfo(incomingProductInfo);
    if (incomingSearch) setKeyword(incomingSearch);
    sessionStorage.removeItem('book_product_info');
    sessionStorage.removeItem('benchmark_search');
  }, []);

  async function createBenchmarkTask() {
    if (!script.trim()) {
      setMessage('请先粘贴对标文案。');
      return;
    }
    if (isBrowserPreview) {
      setMessage('浏览器预览不能执行真实流水线，请在 Electron 应用中创建任务。');
      return;
    }
    await benchmarkAction.run(async () => {
      setRunning(true);
      setMessage('');
      try {
        const next = await api.createAndRunTask({
          title: benchmarkTitle.trim() || keyword.trim() || productName || '',
          inputText: script,
          mode: 'paste',
          track: productInfo ? 'ecommerce' : 'character-story',
          keepPromotion: Boolean(productInfo),
          productInfo,
          pausePoints: [],
        });
        applyState(next);
        const createdTask = taskFromMutation(next);
        if (createdTask) openTaskDetail(createdTask.id);
      } finally {
        setRunning(false);
      }
    }, { onError: (error) => setMessage(error.message) });
  }

  return (
    <div className="benchmark-import-layout">
      <section className="panel benchmark-source-panel">
        <div className="panel-title-row">
          <div>
            <h2>对标导入</h2>
            <span>把同类文案贴进来，按当前选品创建二改任务。</span>
          </div>
        </div>
        <Field label="来源链接">
          <input value={sourceLink} onChange={(event) => setSourceLink(event.target.value)} placeholder="抖音 / 小红书 / 视频号链接" />
        </Field>
        <Field label="账号 / 标题">
          <input value={benchmarkTitle} onChange={(event) => setBenchmarkTitle(event.target.value)} />
        </Field>
        <Field label="关键词">
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={productName || '例如：民族史诗 / 睡前故事'} />
        </Field>
        <div className="benchmark-product-box">
          <span className="field-title">素材来源</span>
          <strong>{productName || '未带入选品'}</strong>
          <small>{productInfo ? productInfoSummary(productInfo) : '可从选品助手点击“去对标导入”带入商品信息'}</small>
        </div>
      </section>

      <section className="panel benchmark-script-panel">
        <div className="panel-title-row">
          <div>
            <h3>对标文案</h3>
            <span>保留原始结构，任务内再执行改写与带货控制。</span>
          </div>
          <button className="primary-action slim" type="button" disabled={running || !script.trim()} onClick={createBenchmarkTask}>
            {running ? <Loader2 className="spin" size={15} /> : <Play size={15} />}
            用此文案创建任务
          </button>
        </div>
        <textarea className="source-textarea benchmark-script-textarea" value={script} onChange={(event) => setScript(event.target.value)} placeholder="粘贴转写稿、对标文案或人工整理后的口播稿" />
        <div className="benchmark-meta-row">
          <span>字数：{countVisibleCharacters(script)}</span>
          <span>{sourceLink ? '已记录来源链接' : '未填来源链接'}</span>
          <span>{productInfo ? '带货任务' : '常规故事任务'}</span>
        </div>
        {message ? <span className="local-note">{message}</span> : null}
        <InlineActionFeedback feedback={benchmarkAction.feedback} />
      </section>
    </div>
  );
}

function PersonAssetsPage({ api, isBrowserPreview }: { api: StoryDreamApi; isBrowserPreview: boolean }) {
  const [people, setPeople] = useState<PersonAssetSummary[]>([]);
  const [selectedName, setSelectedName] = useState('');
  const [newPersonName, setNewPersonName] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [images, setImages] = useState<PersonAssetImage[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [message, setMessage] = useState(isBrowserPreview ? '浏览器预览不能导入或读取本地图片，请在 Electron 应用中管理素材。' : '');
  const [pendingAction, setPendingAction] = useState<'create' | 'rename' | 'delete' | 'import' | 'open' | null>(null);
  const personAction = useAsyncAction();
  const selectedAsset = people.find((person) => person.name === selectedName) ?? null;

  useEffect(() => {
    let active = true;
    api
      .listPersonAssets()
      .then((assets) => {
        if (!active) return;
        setPeople(assets);
        if (!selectedName && assets[0]) {
          setSelectedName(assets[0].name);
          setRenameValue(assets[0].name);
        }
      })
      .catch((error) => {
        if (active) personAction.reportError(error);
      });
    return () => {
      active = false;
    };
  }, [api, personAction.reportError, selectedName]);

  useEffect(() => {
    setRenameValue(selectedName);
  }, [selectedName]);

  useEffect(() => {
    let active = true;
    if (!selectedName) {
      setImages([]);
      setImageUrls({});
      return undefined;
    }
    api
      .listPersonAssetImages(selectedName)
      .then(async (items) => {
        if (!active) return;
        setImages(items);
        const entries = await Promise.all(
          items.map(async (image) => {
            try {
              return [image.path, await api.readAssetDataUrl(image.path)] as const;
            } catch {
              return [image.path, ''] as const;
            }
          }),
        );
        if (active) setImageUrls(Object.fromEntries(entries));
      })
      .catch((error) => {
        if (active) personAction.reportError(error);
      });
    return () => {
      active = false;
    };
  }, [api, personAction.reportError, selectedName]);

  const loadPeople = async (nextSelectedName = selectedName) => {
    const assets = await api.listPersonAssets();
    setPeople(assets);
    const selected = assets.find((asset) => asset.name === nextSelectedName) ?? assets[0] ?? null;
    setSelectedName(selected?.name ?? '');
  };

  async function refreshPeople(nextSelectedName = selectedName) {
    await personAction.run(() => loadPeople(nextSelectedName));
  }

  async function createPerson() {
    const name = newPersonName.trim();
    if (!name) {
      setMessage('请先填写人物名称。');
      return;
    }
    await personAction.run(async () => {
      setPendingAction('create');
      try {
        await api.createPersonAsset(name);
        setNewPersonName('');
        await loadPeople(name);
        setMessage('已创建人物素材库。');
      } finally {
        setPendingAction(null);
      }
    }, { onError: (error) => setMessage(error.message) });
  }

  async function renamePerson() {
    const nextName = renameValue.trim();
    if (!selectedName || !nextName) return;
    await personAction.run(async () => {
      setPendingAction('rename');
      try {
        await api.renamePersonAsset(selectedName, nextName);
        await loadPeople(nextName);
        setMessage('已重命名人物素材库。');
      } finally {
        setPendingAction(null);
      }
    }, { onError: (error) => setMessage(error.message) });
  }

  async function deletePerson() {
    if (!selectedName) return;
    await personAction.run(async () => {
      setPendingAction('delete');
      try {
        await api.deletePersonAsset(selectedName);
        await loadPeople('');
        setMessage('已删除人物素材库。');
      } finally {
        setPendingAction(null);
      }
    }, { onError: (error) => setMessage(error.message) });
  }

  async function importImages() {
    if (!selectedName) {
      setMessage('请先选择人物。');
      return;
    }
    await personAction.run(async () => {
      setPendingAction('import');
      try {
        const count = await api.importPersonAssetImages(selectedName);
        await loadPeople(selectedName);
        setImages(await api.listPersonAssetImages(selectedName));
        setMessage(count > 0 ? `已导入 ${count} 张图片。` : '没有导入新图片。');
      } finally {
        setPendingAction(null);
      }
    }, { onError: (error) => setMessage(error.message) });
  }

  async function openSelectedAssetDir() {
    if (!selectedAsset?.dir) return;
    await personAction.run(async () => {
      setPendingAction('open');
      try {
        await api.openPersonAssetDirectory(selectedAsset.name);
      } finally {
        setPendingAction(null);
      }
    }, { onError: (error) => setMessage(error.message) });
  }

  return (
    <div className="person-assets-layout">
      <section className="panel person-list-panel">
        <div className="panel-title-row">
          <div>
            <h2>人物素材库</h2>
            <span>本地真图素材用于分镜生图替代。</span>
          </div>
        </div>
        <div className="person-create-row">
          <input value={newPersonName} onChange={(event) => setNewPersonName(event.target.value)} placeholder="人物名称" />
          <button className="ghost-action compact-action" type="button" disabled={pendingAction !== null} onClick={createPerson}>
            <Plus size={15} />
            创建
          </button>
        </div>
        <div className="person-list">
          {people.length === 0 ? <EmptyState title="暂无人物素材" /> : null}
          {people.map((person) => (
            <button key={person.name} className={person.name === selectedName ? 'person-list-item active' : 'person-list-item'} type="button" onClick={() => setSelectedName(person.name)}>
              <strong>{person.name}</strong>
              <span>{person.count} 张图片</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel person-assets-panel">
        <div className="panel-title-row">
          <div>
            <h3>{selectedName || '选择人物'}</h3>
            <span>{selectedAsset?.dir || '创建人物后可导入本地图片'}</span>
          </div>
          <div className="button-row">
            {selectedAsset?.dir ? (
              <button className="ghost-action compact-action" type="button" disabled={pendingAction !== null} onClick={openSelectedAssetDir}>
                <FolderOpen size={15} />
                打开目录
              </button>
            ) : null}
            <button className="primary-action slim" type="button" disabled={!selectedName || pendingAction !== null} onClick={importImages}>
              <Upload size={15} />
              导入图片
            </button>
          </div>
        </div>

        {selectedName ? (
          <div className="person-asset-tools">
            <Field label="人物名称">
              <input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
            </Field>
            <div className="button-row person-asset-actions">
              <button className="ghost-action compact-action" type="button" disabled={!renameValue.trim() || renameValue.trim() === selectedName || pendingAction !== null} onClick={renamePerson}>
                <Pencil size={15} />
                重命名
              </button>
              <button className="mini-button" type="button" disabled={pendingAction !== null} onClick={deletePerson}>删除</button>
            </div>
          </div>
        ) : null}

        <div className="person-image-grid">
          {images.length === 0 ? <EmptyState title="暂无图片" /> : null}
          {images.map((image) => (
            <article className="person-image-card" key={image.path}>
              {imageUrls[image.path] ? <img src={imageUrls[image.path]} alt={image.name} /> : <div className="person-image-placeholder">{image.name}</div>}
              <span title={image.path}>{image.name}</span>
            </article>
          ))}
        </div>
        {message ? <span className="local-note">{message}</span> : null}
        <InlineActionFeedback feedback={personAction.feedback} />
      </section>
    </div>
  );
}

function MusicMvPage({
  api,
  state,
  applyState,
  openTaskDetail,
  isBrowserPreview,
}: {
  api: StoryDreamApi;
  state: AppState;
  applyState: ApplyMutationResult;
  openTaskDetail: (taskId: string) => void;
  isBrowserPreview: boolean;
}) {
  const defaultTemplateId = state.draftTemplates[0]?.id ?? 'default-portrait-9-16';
  const [title, setTitle] = useState('音乐MV');
  const [lyrics, setLyrics] = useState('雨落下第一句\n霓虹亮起第二句\n副歌把夜色唱亮');
  const [style, setStyle] = useState('modern-film');
  const [ratio, setRatio] = useState('16:9');
  const [templateId, setTemplateId] = useState(defaultTemplateId);
  const [storyboardSceneCount, setStoryboardSceneCount] = useState(12);
  const [processingMode, setProcessingMode] = useState<ProcessingMode>('full-auto');
  const [pausePoint, setPausePoint] = useState<PausePoint>('critical');
  const [musicMvRhythmMode, setMusicMvRhythmMode] = useState<Task['musicMv']['rhythmMode']>('lyric-sync');
  const [musicMvCaptionStyle, setMusicMvCaptionStyle] = useState<Task['musicMv']['captionStyle']>('karaoke');
  const [musicMvVisualMotif, setMusicMvVisualMotif] = useState('雨夜霓虹、孤独背影、慢镜头');
  const [musicMvAudioPath, setMusicMvAudioPath] = useState('');
  const [bgmId, setBgmId] = useState(resolveDefaultBgmId(state.config));
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const musicAction = useAsyncAction();
  const bgmOptions = validBgmItems(state.config);
  const lyricLines = lyrics.split(/\n/u).map((line) => line.trim()).filter(Boolean);
  const musicMvStyleOptions = styleOptions;
  const musicMvDraftTemplateOptions = state.draftTemplates.map((template) => [template.id, template.name, `出图 ${template.image.ratio}`]);

  async function selectMusicMvAudio() {
    await musicAction.run(async () => {
      const audioPath = await api.selectLocalAudio();
      if (!audioPath) return;
      setMusicMvAudioPath(audioPath);
      const nextBgm = addUploadedBgm(state.config, audioPath);
      const next = await api.saveConfig({ config: nextBgm.config, secretChanges: {} });
      applyState(next);
      setBgmId(nextBgm.bgmId);
    });
  }

  async function runMusicMv() {
    if (isBrowserPreview) {
      setMessage('浏览器预览不能执行真实流水线，请在 Electron 应用中生成音乐 MV。');
      return;
    }
    if (!lyrics.trim()) {
      setMessage('请先输入歌词 / 文案。');
      return;
    }
    await musicAction.run(async () => {
      setRunning(true);
      setMessage('');
      try {
        const next = await api.createAndRunTask({
          title,
          inputText: lyrics,
          taskKind: 'music-mv',
          processingMode,
          mode: 'paste',
          track: 'music-mv',
          style,
          ratio,
          templateId,
          bgmId,
          pausePoints: [pausePoint],
          storyboardSceneCount,
          musicMv: {
            rhythmMode: musicMvRhythmMode,
            captionStyle: musicMvCaptionStyle,
            visualMotif: musicMvVisualMotif,
            audioPath: musicMvAudioPath,
          },
        });
        applyState(next);
        const createdTask = taskFromMutation(next);
        if (createdTask) openTaskDetail(createdTask.id);
      } finally {
        setRunning(false);
      }
    }, { onError: (error) => setMessage(error.message) });
  }

  return (
    <div className="music-mv-layout">
      <section className="task-card">
        <div className="panel-title-row">
          <div>
            <h2>音乐MV</h2>
            <span>按歌词切分镜头、同步字幕节奏，并输出剪映草稿。</span>
          </div>
          <button className="primary-action slim" onClick={runMusicMv} disabled={running || !lyrics.trim()}>
            {running ? <Loader2 className="spin" size={15} /> : <Music size={15} />}
            生成音乐 MV
          </button>
        </div>

        <Field label="标题">
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field label="歌词 / 文案">
          <textarea className="source-textarea" value={lyrics} onChange={(event) => setLyrics(event.target.value)} />
        </Field>

        <div className="advanced-grid">
          <Segmented label="节奏模式" value={musicMvRhythmMode} options={['lyric-sync', 'fast-cut', 'slow-cinematic']} labels={['歌词同步', '快切', '慢镜头']} onChange={(value) => setMusicMvRhythmMode(value as Task['musicMv']['rhythmMode'])} />
          <Segmented label="歌词字幕" value={musicMvCaptionStyle} options={['karaoke', 'minimal', 'none']} labels={['卡拉 OK', '极简', '无字幕']} onChange={(value) => setMusicMvCaptionStyle(value as Task['musicMv']['captionStyle'])} />
          <Segmented label="处理模式" value={processingMode} options={['full-auto', 'semi-auto', 'clip-only']} labels={['全自动', '半自动', '只出方案']} onChange={(value) => setProcessingMode(value as ProcessingMode)} />
          <Segmented label="暂停确认" value={pausePoint} options={pauseOptions.map(([id]) => id)} labels={pauseOptions.map(([, label]) => label)} onChange={(value) => setPausePoint(value as PausePoint)} />
          <Segmented label="分镜数量" value={String(storyboardSceneCount)} options={storyboardSceneCountOptions.map(String)} labels={storyboardSceneCountOptions.map((count) => `${count} 条`)} onChange={(value) => setStoryboardSceneCount(Number(value))} />
        </div>

        <OptionCloud title="画面风格" options={musicMvStyleOptions} value={style} onChange={setStyle} />
        <div className="option-two-col">
          <OptionCloud title="草稿模板" options={musicMvDraftTemplateOptions} value={templateId} onChange={setTemplateId} />
          <div>
            <span className="field-title">AI 出图比例</span>
            <div className="ratio-grid">
              {['9:16', '4:3', '1:1', '16:9'].map((item) => (
                <button key={item} className={ratio === item ? 'chip active' : 'chip'} onClick={() => setRatio(item)}>
                  <span className="ratio-icon" />
                  {item}
                </button>
              ))}
            </div>
          </div>
        </div>

        <Field label="视觉母题">
          <input value={musicMvVisualMotif} onChange={(event) => setMusicMvVisualMotif(event.target.value)} placeholder="例如：雨夜霓虹、孤独背影、慢镜头" />
        </Field>
        <Field label="音频文件">
          <div className="upload-row">
            <input value={musicMvAudioPath} onChange={(event) => setMusicMvAudioPath(event.target.value)} placeholder="可选择本地歌曲或伴奏" />
            <button className="ghost-action" onClick={selectMusicMvAudio}><FolderOpen size={15} />选择音频</button>
          </div>
        </Field>

        <span className="field-title">背景音乐</span>
        <div className="chip-row">
          <button className={bgmId === '' ? 'chip active' : 'chip'} onClick={() => setBgmId('')}>无 BGM</button>
          {bgmOptions.map((bgm) => (
            <button key={bgm.id} className={bgmId === bgm.id ? 'chip active' : 'chip'} onClick={() => setBgmId(bgm.id)}>{bgm.title}</button>
          ))}
        </div>

        {message ? <span className="local-note">{message}</span> : null}
        <InlineActionFeedback feedback={musicAction.feedback} />
      </section>
      <aside className="music-mv-preview panel">
        <h3>MV 结构预览</h3>
        <div className="task-metrics">
          <div><small>歌词行</small><strong>{lyricLines.length}</strong></div>
          <div><small>节奏</small><strong>{musicMvRhythmMode}</strong></div>
          <div><small>字幕</small><strong>{musicMvCaptionStyle}</strong></div>
        </div>
        <div className="artifact-scene-list">
          {lyricLines.slice(0, 8).map((line, index) => (
            <div key={`${line}-${index}`}>
              <strong>{index + 1}. {index === 0 ? 'intro' : index === lyricLines.length - 1 ? 'outro' : index >= Math.floor(lyricLines.length / 2) ? 'chorus' : 'verse'}</strong>
              <p>{line}</p>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function HtmlVideoPage({
  api,
  state,
  applyState,
  refreshTaskDetail,
  onActiveTaskChange,
  isBrowserPreview,
}: {
  api: StoryDreamApi;
  state: AppState;
  applyState: ApplyMutationResult;
  refreshTaskDetail: (taskId: string) => Promise<void>;
  onActiveTaskChange: (taskId: string) => void;
  isBrowserPreview: boolean;
}) {
  const [copy, setCopy] = useState('武则天十四岁入宫，十二年间几乎没有被命运看见。\n直到唐高宗时代，她重新站回权力中心，用一次次选择改写自己的位置。\n这支视频用 HTML 动画呈现她从才人到天后的关键转折。');
  const [style, setStyle] = useState<string>(HTML_VIDEO_JOB_DEFAULTS.style);
  const [ratio, setRatio] = useState<string>(HTML_VIDEO_JOB_DEFAULTS.ratio);
  const [maxScenes, setMaxScenes] = useState<number>(HTML_VIDEO_JOB_DEFAULTS.maxScenes);
  const [foreground, setForeground] = useState<boolean>(HTML_VIDEO_JOB_DEFAULTS.foreground);
  const [bgmId, setBgmId] = useState(resolveDefaultBgmId(state.config));
  const [ttsProvider, setTtsProvider] = useState<TtsProvider>(() => normalizeRuntimeTtsProvider(state.config.tts.provider));
  const [voiceId, setVoiceId] = useState(() => defaultTaskSpeakerForProvider(state.config.tts.provider, state.config));
  const [ttsSpeed, setTtsSpeed] = useState<number>(HTML_VIDEO_JOB_DEFAULTS.ttsSpeed);
  const [bgmVolume, setBgmVolume] = useState<HtmlVideoJobConfig['bgmVolume']>(HTML_VIDEO_JOB_DEFAULTS.bgmVolume);
  const [transitionType, setTransitionType] = useState<HtmlVideoTransition>(HTML_VIDEO_JOB_DEFAULTS.transitionType);
  const [coverImageMode, setCoverImageMode] = useState<HtmlVideoCoverMode>(HTML_VIDEO_JOB_DEFAULTS.coverImageMode);
  const [coverTemplate, setCoverTemplate] = useState<string>(HTML_VIDEO_JOB_DEFAULTS.coverTemplate);
  const [coverRatio, setCoverRatio] = useState<HtmlVideoCoverRatio>(HTML_VIDEO_JOB_DEFAULTS.coverRatio);
  const [draftTemplate, setDraftTemplate] = useState<string>('');
  const [activeTaskId, setActiveTaskId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<HtmlVideoTabKey>('text');
  const [mediaRetryRevision, setMediaRetryRevision] = useState(0);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const htmlVideoAction = useAsyncAction();
  const bgmOptions = validBgmItems(state.config);
  const createVoiceOptions = ttsVoiceOptionsForProvider(ttsProvider);
  const createStyleOptions = editableHtmlVideoStyleOptions(state.customStyles, style);
  const htmlTasks = state.tasks.filter(isHtmlVideoTask);
  const activeTask = htmlTasks.find((task) => task.id === activeTaskId) ?? htmlTasks[0] ?? null;
  const activeTaskRefreshKey = taskDetailRefreshKey(activeTask);
  const pipelineParse = useMemo(
    () => safeParseHtmlVideoPipelineData(activeTask?.pipelineData, activeTask?.inputText),
    [activeTask?.inputText, activeTask?.pipelineData],
  );
  const pipelineData = pipelineParse.data;
  const activeStep = pipelineData.current;
  const derivedTab = tabForHtmlVideoStep(activeStep);
  const firstPreviewComposition = pipelineData.compositions.find((composition) => Boolean(composition.htmlPath));
  const mediaTaskId = activeTask?.id ?? '';
  const mediaPaths = useMemo(() => [...new Set([
    ...pipelineData.assets.map((asset) => asset.src),
    ...pipelineData.voices.map((voice) => voice.src),
    ...pipelineData.compositions.flatMap((composition) => [
      composition.thumbnailPath,
      composition.audio.src,
      composition.background.src,
    ]),
    pipelineData.coverAsset?.path,
    pipelineData.output?.path,
  ].filter((path): path is string => Boolean(path)))], [pipelineData]);
  const mediaPathKey = JSON.stringify(mediaPaths);
  const mediaCacheRef = useRef(createHtmlVideoMediaCache());
  const mediaRequestGeneration = useRef(0);
  const currentMediaElementScopeRef = useRef<HtmlVideoMediaElementScope>({
    taskId: mediaTaskId,
    pathKey: mediaPathKey,
    generation: mediaRetryRevision,
  });
  const htmlVideoTabRefs = useRef<Partial<Record<HtmlVideoTabKey, HTMLButtonElement | null>>>({});
  const [mediaState, setMediaState] = useState<{ taskId: string; urls: Record<string, string> }>({ taskId: '', urls: {} });
  const [mediaErrorState, setMediaErrorState] = useState<{ taskId: string; pathKey: string; message: string; failedPaths: string[] }>({
    taskId: '',
    pathKey: '',
    message: '',
    failedPaths: [],
  });
  const [mediaElementFailureState, setMediaElementFailureState] = useState<HtmlVideoMediaElementFailureState>({
    taskId: '', pathKey: '', generation: 0, failedPaths: [],
  });
  const mediaUrls: Record<string, string> = !isBrowserPreview && mediaState.taskId === mediaTaskId
    ? Object.fromEntries(mediaPaths.filter((path) => mediaState.urls[path]).map((path) => [path, mediaState.urls[path]]))
    : {};
  const mediaUrlError = mediaErrorState.taskId === mediaTaskId && mediaErrorState.pathKey === mediaPathKey
    ? mediaErrorState.message
    : '';
  const failedMediaUrlPaths = new Set(
    mediaErrorState.taskId === mediaTaskId && mediaErrorState.pathKey === mediaPathKey
      ? mediaErrorState.failedPaths
      : [],
  );
  const failedMediaElementPaths = new Set(
    mediaElementFailureState.taskId === mediaTaskId
      && mediaElementFailureState.pathKey === mediaPathKey
      && mediaElementFailureState.generation === mediaRetryRevision
      ? mediaElementFailureState.failedPaths
      : [],
  );
  const failedMediaPaths = new Set([...failedMediaUrlPaths, ...failedMediaElementPaths]);
  const mediaError = mediaUrlError || (failedMediaElementPaths.size
    ? '部分媒体文件加载失败，可重新加载媒体。'
    : '');
  const mediaLoading = !isBrowserPreview && mediaPaths.some(
    (path) => !mediaUrls[path] && !failedMediaPaths.has(path),
  );
  const taskBusy = running || htmlVideoAction.busy;
  const taskMessageKind = activeTask
    ? classifyHtmlVideoTaskMessage(activeTask.status, activeTask.errorMessage)
    : null;

  useLayoutEffect(() => {
    currentMediaElementScopeRef.current = {
      taskId: mediaTaskId,
      pathKey: mediaPathKey,
      generation: mediaRetryRevision,
    };
  }, [mediaPathKey, mediaRetryRevision, mediaTaskId]);

  useEffect(() => {
    if (!activeTaskId && htmlTasks[0]) {
      setActiveTaskId(htmlTasks[0].id);
    }
  }, [activeTaskId, htmlTasks]);

  useEffect(() => {
    if (!activeTask) {
      onActiveTaskChange('');
      return;
    }
    onActiveTaskChange(activeTask.id);
    return () => onActiveTaskChange('');
  }, [activeTask?.id, onActiveTaskChange]);

  useEffect(() => {
    if (activeTask) void refreshTaskDetail(activeTask.id);
  }, [activeTask?.id, activeTaskRefreshKey, refreshTaskDetail]);

  useEffect(() => {
    setActiveTab(derivedTab);
  }, [derivedTab, activeTask?.id]);

  useEffect(() => {
    const generation = ++mediaRequestGeneration.current;
    let disposed = false;
    const paths = JSON.parse(mediaPathKey) as string[];
    if (!mediaTaskId || isBrowserPreview || paths.length === 0) {
      syncHtmlVideoMediaCache(mediaCacheRef.current, mediaTaskId, []);
      setMediaState((current) => current.taskId === mediaTaskId && Object.keys(current.urls).length === 0
        ? current
        : { taskId: mediaTaskId, urls: {} });
      setMediaErrorState({ taskId: mediaTaskId, pathKey: mediaPathKey, message: '', failedPaths: [] });
      return () => {
        disposed = true;
      };
    }

    const cache = syncHtmlVideoMediaCache(mediaCacheRef.current, mediaTaskId, paths);
    const retainedUrls = Object.fromEntries(paths.flatMap((path) => {
      const url = cache.urls.get(path);
      return url ? [[path, url]] : [];
    }));
    setMediaState((current) => current.taskId === mediaTaskId && current.urls === retainedUrls
      ? current
      : { taskId: mediaTaskId, urls: retainedUrls });
    setMediaErrorState({ taskId: mediaTaskId, pathKey: mediaPathKey, message: '', failedPaths: [] });
    const pathRequests = paths.map(async (path) => {
      try {
        const url = await loadHtmlVideoMedia(
          cache,
          mediaTaskId,
          path,
          (taskId, mediaPath) => api.getHtmlVideoMediaUrl(taskId, mediaPath),
        );
        return [path, url] as const;
      } catch {
        return [path, null] as const;
      }
    });

    void Promise.all(pathRequests).then((entries) => {
      if (disposed || generation !== mediaRequestGeneration.current) return;
      const availableUrls = Object.fromEntries(entries.flatMap(([path, url]) => url ? [[path, url]] : []));
      setMediaState((current) => current.taskId === mediaTaskId
        ? { taskId: mediaTaskId, urls: { ...current.urls, ...availableUrls } }
        : current);
      setMediaErrorState({
        taskId: mediaTaskId,
        pathKey: mediaPathKey,
        message: entries.every(([, url]) => Boolean(url)) ? '' : '部分媒体文件不可用，可重试任务或检查任务目录。',
        failedPaths: entries.flatMap(([path, url]) => url ? [] : [path]),
      });
    });

    return () => {
      disposed = true;
    };
  }, [api, isBrowserPreview, mediaPathKey, mediaRetryRevision, mediaTaskId]);

  const markMediaElementFailed = useCallback((path: string) => {
    const eventScope = { taskId: mediaTaskId, pathKey: mediaPathKey, generation: mediaRetryRevision };
    if (!mediaTaskId || !htmlVideoMediaElementScopeMatches(eventScope, currentMediaElementScopeRef.current)) return;
    setMediaElementFailureState((current) => recordHtmlVideoMediaElementFailure(
      current,
      eventScope,
      currentMediaElementScopeRef.current,
      path,
    ));
  }, [mediaPathKey, mediaRetryRevision, mediaTaskId]);

  const markMediaElementReady = useCallback((path: string) => {
    const eventScope = { taskId: mediaTaskId, pathKey: mediaPathKey, generation: mediaRetryRevision };
    if (!htmlVideoMediaElementScopeMatches(eventScope, currentMediaElementScopeRef.current)) return;
    setMediaElementFailureState((current) => {
      if (
        !htmlVideoMediaElementScopeMatches(eventScope, currentMediaElementScopeRef.current)
        || !htmlVideoMediaElementScopeMatches(current, eventScope)
        || !current.failedPaths.includes(path)
      ) return current;
      return { ...current, failedPaths: current.failedPaths.filter((failedPath) => failedPath !== path) };
    });
  }, [mediaPathKey, mediaRetryRevision, mediaTaskId]);

  async function createHtmlVideoTask() {
    if (!copy.trim()) {
      setMessage('请先输入文案。');
      return;
    }
    await htmlVideoAction.run(async () => {
      setRunning(true);
      setMessage('');
      try {
        const next = await api.createHtmlVideoTask(createHtmlVideoTaskInput({
          copy,
          ratio,
          style,
          bgmId,
          maxScenes,
          foreground,
          ttsProvider,
          voiceId,
          ttsSpeed,
          bgmVolume,
          transitionType,
          coverImageMode,
          coverTemplate,
          coverRatio,
          draftTemplate,
          }));
        applyState(next);
        const createdTask = taskFromMutation(next);
        if (createdTask) setActiveTaskId(createdTask.id);
        setMessage(isBrowserPreview ? '已创建浏览器预览快照，未执行特权渲染。' : 'HTML 动画视频任务已创建并开始生成。');
      } finally {
        setRunning(false);
      }
    }, { onError: (error) => setMessage(error.message) });
  }

  function changeCreateTtsProvider(value: string) {
    const provider = value as TtsProvider;
    setTtsProvider(provider);
    setVoiceId(ttsVoiceOptionsForProvider(provider)[0]?.id ?? '');
  }

  async function setTaskStatus(status: Extract<TaskStatus, 'paused' | 'cancelled' | 'running'>) {
    if (!activeTask) return;
    await htmlVideoAction.run(async () => {
      const next = await api.updateTaskStatus(activeTask.id, status);
      applyState(next);
      setMessage(status === 'paused' ? '任务已暂停。' : status === 'cancelled' ? '任务已取消。' : '任务已继续。');
    }, { onError: (error) => setMessage(error.message) });
  }

  async function retryTask() {
    if (!activeTask) return;
    await htmlVideoAction.run(async () => {
      const next = await api.retryTask(activeTask.id);
      applyState(next);
      setMessage('任务已从断点重试。');
    }, { onError: (error) => setMessage(error.message) });
  }

  async function openPreview(sceneIndex?: number) {
    if (!activeTask) return;
    await htmlVideoAction.run(
      () => api.openHtmlVideoPreview(activeTask.id, sceneIndex),
      { onError: (error) => setMessage(error.message) },
    );
  }

  async function openOutputDirectory() {
    if (!activeTask?.outputDir) return;
    await htmlVideoAction.run(
      () => api.openTaskOutputDirectory(activeTask.id),
      { onError: (error) => setMessage(error.message) },
    );
  }

  function handleHtmlVideoTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, tabKey: HtmlVideoTabKey) {
    const nextTab = nextHtmlVideoTabKey(tabKey, event.key);
    if (!nextTab) return;
    event.preventDefault();
    setActiveTab(nextTab);
    htmlVideoTabRefs.current[nextTab]?.focus();
  }

  return (
    <div className="hv-layout">
      <section className="hv-config hv-card">
        <div className="panel-title-row">
          <div>
            <h2>HTML 动画视频</h2>
            <span>按 Storybound 的独立 HTML 渲染流水线创建任务，不进入普通成片链路</span>
          </div>
          <button className="primary-action slim" onClick={createHtmlVideoTask} disabled={taskBusy || !copy.trim()}>
            {running ? <Loader2 className="spin" size={15} /> : <Play size={15} />}
            {isBrowserPreview ? '创建预览快照' : '创建并生成'}
          </button>
        </div>

        <Field label="文案" hint="可直接粘贴口播稿，也可以先放 AI 命题创作后的草稿">
          <textarea className="source-textarea" value={copy} onChange={(event) => setCopy(event.target.value)} />
        </Field>

        <div className="advanced-grid">
          <div data-html-video-create-field="maxScenes">
            <Field label="场景上限"><input type="number" min={1} max={30} step={1} value={maxScenes} onChange={(event) => setMaxScenes(Number(event.target.value))} /></Field>
          </div>
          <div data-html-video-create-field="ratio">
            <Segmented label="画布比例" value={ratio} options={[...HTML_VIDEO_RATIOS]} onChange={setRatio} />
          </div>
          <div data-html-video-create-field="foreground">
            <Segmented label="前景图" value={foreground ? 'on' : 'off'} options={['on', 'off']} labels={['生成', '跳过']} onChange={(value) => setForeground(value === 'on')} />
          </div>
        </div>

        <div className="advanced-grid hv-cover-create-grid">
          <div data-html-video-create-field="coverImageMode">
            <Segmented label="封面" value={coverImageMode} options={[...HTML_VIDEO_COVER_MODES]} labels={['关闭', '自动', '手动']} onChange={(value) => setCoverImageMode(value as HtmlVideoCoverMode)} />
          </div>
          <div data-html-video-create-field="coverTemplate">
            <Field label="封面模板">
              <select value={coverTemplate} onChange={(event) => setCoverTemplate(event.target.value)}>
                {coverTemplate && !state.customCoverTemplates.some((item) => item.id === coverTemplate)
                  ? <option value={coverTemplate}>{coverTemplate}（目录中已缺失）</option>
                  : null}
                {state.customCoverTemplates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>
          </div>
          <div data-html-video-create-field="coverRatio">
            <Segmented label="封面比例" value={coverRatio} options={[...HTML_VIDEO_COVER_RATIOS]} onChange={(value) => setCoverRatio(value as HtmlVideoCoverRatio)} />
          </div>
          <div data-html-video-create-field="draftTemplate">
            <Field label="剪映草稿模板">
              <select value={draftTemplate} onChange={(event) => setDraftTemplate(event.target.value)}>
                <option value="">只输出 HTML 视频</option>
                {draftTemplate && !state.draftTemplates.some((item) => item.id === draftTemplate)
                  ? <option value={draftTemplate}>{draftTemplate}（目录中已缺失）</option>
                  : null}
                {state.draftTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
            </Field>
          </div>
        </div>

        <div data-html-video-create-field="style">
          <OptionCloud title="画面风格" options={createStyleOptions} value={style} onChange={setStyle} />
        </div>

        <div data-html-video-create-field="bgmId">
          <span className="field-title">背景音乐</span>
          <div className="chip-row">
            <button className={bgmId === '' ? 'chip active' : 'chip'} onClick={() => setBgmId('')}>无配乐</button>
            {bgmOptions.map((bgm) => (
              <button key={bgm.id} className={bgmId === bgm.id ? 'chip active' : 'chip'} onClick={() => setBgmId(bgm.id)}>{bgm.title}</button>
            ))}
          </div>
        </div>

        <div className="advanced-grid">
          <div data-html-video-create-field="ttsProvider">
            <Field label="配音模型">
              <select value={ttsProvider} onChange={(event) => changeCreateTtsProvider(event.target.value)}>
                {HTML_VIDEO_TTS_PROVIDERS.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
              </select>
            </Field>
          </div>
          <div data-html-video-create-field="voiceId">
            <Field label="音色">
              <select value={voiceId} onChange={(event) => setVoiceId(event.target.value)}>
                {voiceId && !createVoiceOptions.some((option) => option.id === voiceId)
                  ? <option value={voiceId}>{taskSpeakerLabel(ttsProvider, voiceId)}</option>
                  : null}
                {createVoiceOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </Field>
          </div>
          <div data-html-video-create-field="ttsSpeed">
            <RangeField label="语速" min={HTML_VIDEO_TTS_SPEED_MIN} max={HTML_VIDEO_TTS_SPEED_MAX} step={0.1} value={ttsSpeed} onChange={setTtsSpeed} />
          </div>
          <div data-html-video-create-field="bgmVolume">
            <Segmented label="配乐音量" value={bgmVolume ?? 'soft'} options={[...HTML_VIDEO_BGM_VOLUMES]} labels={['轻', '中', '响']} onChange={(value) => setBgmVolume(value as NonNullable<typeof bgmVolume>)} />
          </div>
          <div data-html-video-create-field="transitionType">
            <Field label="转场">
              <select value={transitionType} onChange={(event) => setTransitionType(event.target.value as HtmlVideoTransition)}>
                {HTML_VIDEO_TRANSITIONS.map((transition) => <option key={transition} value={transition}>{transition}</option>)}
              </select>
            </Field>
          </div>
        </div>

        {isBrowserPreview ? <span className="local-note">浏览器模式只保存预览快照，不生成本地媒体或视频。</span> : null}
        {message ? <span className="local-note">{message}</span> : null}
        <InlineActionFeedback feedback={htmlVideoAction.feedback} />
      </section>

      <section className="hv-workspace hv-card">
        <div className="panel-title-row">
          <div className="hv-workspace-heading">
            <h3>{activeTask?.title ?? '等待创建 HTML 动画视频任务'}</h3>
            <span>{activeTask ? `HTML 动画视频 · 当前阶段：${htmlVideoPipelineStepLabel(activeStep)}` : '创建后会在这里显示文案、素材、配音、动画预览、封面和出片状态'}</span>
            {pipelineParse.error && activeTask ? (
              <div className="hv-workspace-error" role="alert" aria-live="assertive">
                <ErrorSummaryButton compact title="HTML 视频任务数据损坏" fullMessage={pipelineParse.error} />
              </div>
            ) : taskMessageKind === 'error' && activeTask ? (
              <div className="hv-workspace-error" role="alert" aria-live="assertive">
                <ErrorSummaryButton compact title={`${activeTask.title || 'HTML 动画视频任务'}错误`} fullMessage={activeTask.errorMessage} />
              </div>
            ) : taskMessageKind === 'status' && activeTask ? (
              <div className="hv-workspace-status" role="status" aria-live="polite">
                {activeTask.errorMessage}
              </div>
            ) : null}
          </div>
          <div className="hv-workspace-actions">
            {htmlTasks.length ? (
              <select value={activeTask?.id ?? ''} onChange={(event) => setActiveTaskId(event.target.value)} aria-label="切换 HTML 动画视频任务">
                {htmlTasks.map((task) => (
                  <option key={task.id} value={task.id}>{task.title || task.id}</option>
                ))}
              </select>
            ) : null}
            {activeTask ? (
              <div className="hv-run-controls" aria-label="HTML 动画视频任务控制">
                {activeTask.status === 'running' || activeTask.status === 'pending' ? (
                  <button className="mini-button" disabled={taskBusy || isBrowserPreview} onClick={() => setTaskStatus('paused')}>
                    <Pause size={14} />暂停
                  </button>
                ) : null}
                {['running', 'pending', 'paused'].includes(activeTask.status) ? (
                  <button className="mini-button" disabled={taskBusy || isBrowserPreview} onClick={() => setTaskStatus('cancelled')}>
                    <XCircle size={14} />取消
                  </button>
                ) : null}
                {activeTask.status === 'paused' ? (
                  <button className="mini-button" disabled={taskBusy || isBrowserPreview} onClick={() => setTaskStatus('running')}>
                    <Play size={14} />继续
                  </button>
                ) : null}
                {pipelineParse.error || activeTask.status === 'failed' || activeTask.status === 'cancelled' ? (
                  <button className="mini-button" disabled={taskBusy || isBrowserPreview} onClick={retryTask}>
                    <RotateCcw size={14} />重试
                  </button>
                ) : null}
                {firstPreviewComposition ? (
                  <button className="mini-button" disabled={taskBusy || isBrowserPreview} onClick={() => openPreview(firstPreviewComposition.index)}>
                    <Eye size={14} />预览
                  </button>
                ) : null}
                {activeTask.outputDir ? (
                  <button className="mini-button" disabled={taskBusy || isBrowserPreview} onClick={openOutputDirectory}>
                    <FolderOpen size={14} />打开目录
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {pipelineData.warnings.length ? (
          <div className="hv-warning-list" role="status" aria-live="polite">
            <strong>流水线提示</strong>
            <ul>
              {pipelineData.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}
            </ul>
          </div>
        ) : null}

        {activeTask && !pipelineParse.error ? (
          <HtmlVideoConfigEditor
            key={`${activeTask.id}:${pipelineData.revision}`}
            api={api}
            task={activeTask}
            config={pipelineData.config}
            appConfig={state.config}
            customStyles={state.customStyles}
            draftTemplates={state.draftTemplates}
            applyState={applyState}
            refreshTaskDetail={refreshTaskDetail}
          />
        ) : null}

        <div className="task-metrics">
          <div><small>计划场景</small><strong>{pipelineData.scenes.length}</strong></div>
          <div><small>完成预览</small><strong>{pipelineData.compositions.length}</strong></div>
          <div><small>画布</small><strong>{pipelineData.config.ratio ?? ratio}</strong></div>
          <div><small>逐帧截图</small><strong>{htmlVideoStepStatusLabel(pipelineData.steps.render.status, activeTask?.status)}</strong></div>
        </div>

        <div className="hv-main">
          <aside className="hv-rail" aria-label="HTML 动画视频流水线步骤">
            {htmlVideoSteps.map((step, index) => {
              const stepState = pipelineData.steps[step.key];
              const status = stepState.status;
              return (
                <div key={step.key} className={`hv-step ${htmlVideoStepClass(status)}`}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{step.name}</strong>
                    <small>{step.sub} · {htmlVideoStepStatusLabel(stepState.status, activeTask?.status)}</small>
                    {stepState.error ? (
                      <div className="hv-step-error" role="alert" aria-live="assertive">
                        <ErrorSummaryButton compact title={`${step.name}错误`} fullMessage={stepState.error} />
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </aside>

          <div className="hv-stage">
            <div className="hv-tabs" role="tablist" aria-label="HTML 动画视频内容">
              {htmlVideoTabs.map((tab) => (
                <button
                  key={tab.key}
                  id={`html-video-tab-${tab.key}`}
                  ref={(element) => {
                    htmlVideoTabRefs.current[tab.key] = element;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.key}
                  aria-controls="html-video-panel"
                  tabIndex={activeTab === tab.key ? 0 : -1}
                  className={activeTab === tab.key ? 'hv-tab active' : 'hv-tab'}
                  onClick={() => setActiveTab(tab.key)}
                  onKeyDown={(event) => handleHtmlVideoTabKeyDown(event, tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {mediaError ? (
              <div className="hv-media-error" role="alert">
                <span>{mediaError}</span>
                <button className="mini-button" type="button" onClick={() => setMediaRetryRevision((revision) => revision + 1)}>
                  <RotateCcw size={14} />重新加载媒体
                </button>
              </div>
            ) : null}
            <div
              id="html-video-panel"
              role="tabpanel"
              aria-labelledby={`html-video-tab-${activeTab}`}
              aria-busy={mediaLoading}
            >
              <HtmlVideoTabPanel
                api={api}
                tab={activeTab}
                task={activeTask}
                data={pipelineData}
                customCoverTemplates={state.customCoverTemplates}
                applyState={applyState}
                refreshTaskDetail={refreshTaskDetail}
                mediaUrls={mediaUrls}
                failedMediaPaths={failedMediaPaths}
                mediaRetryRevision={mediaRetryRevision}
                onMediaElementError={markMediaElementFailed}
                onMediaElementReady={markMediaElementReady}
                busy={taskBusy}
                isBrowserPreview={isBrowserPreview}
                openPreview={openPreview}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

type HtmlVideoTransition = Extract<HtmlVideoConfigChange, { field: 'transitionType' }>['value'];

interface HtmlVideoEditableValues {
  style: string;
  voiceId: string;
  ttsProvider: TtsProvider;
  ttsSpeed: number;
  bgmId: string;
  bgmVolume: 'soft' | 'medium' | 'loud';
  transitionType: HtmlVideoTransition;
  foreground: boolean;
  maxScenes: number;
  ratio: '9:16' | '16:9' | '1:1' | '4:3';
  draftTemplate: string;
}

function editableHtmlVideoValues(config: HtmlVideoJobConfig): Omit<HtmlVideoEditableValues, 'transitionType'> & { transitionType: HtmlVideoTransition } {
  return {
    style: config.style ?? HTML_VIDEO_JOB_DEFAULTS.style,
    voiceId: config.voiceId ?? HTML_VIDEO_JOB_DEFAULTS.voiceId,
    ttsProvider: config.ttsProvider ?? HTML_VIDEO_JOB_DEFAULTS.ttsProvider,
    ttsSpeed: config.ttsSpeed ?? HTML_VIDEO_JOB_DEFAULTS.ttsSpeed,
    bgmId: config.bgmId ?? HTML_VIDEO_JOB_DEFAULTS.bgmId,
    bgmVolume: config.bgmVolume ?? 'soft',
    transitionType: (config.transitionType ?? HTML_VIDEO_JOB_DEFAULTS.transitionType) as HtmlVideoTransition,
    foreground: config.foreground ?? HTML_VIDEO_JOB_DEFAULTS.foreground,
    maxScenes: config.maxScenes ?? HTML_VIDEO_JOB_DEFAULTS.maxScenes,
    ratio: (config.ratio ?? HTML_VIDEO_JOB_DEFAULTS.ratio) as HtmlVideoEditableValues['ratio'],
    draftTemplate: config.draftTemplate ?? '',
  };
}

function editableHtmlVideoStyleOptions(customStyles: CustomStyle[], currentStyle: string): string[][] {
  const options = new Map(htmlVideoStyleOptions.map((option) => [option[0], option]));
  for (const style of customStyles) options.set(style.id, [style.id, style.name, '自定义画风']);
  if (currentStyle && !options.has(currentStyle)) options.set(currentStyle, [currentStyle, currentStyle, '当前任务画风']);
  return [...options.values()];
}

function HtmlVideoConfigEditor({
  api,
  task,
  config,
  appConfig,
  customStyles,
  draftTemplates,
  applyState,
  refreshTaskDetail,
}: {
  api: StoryDreamApi;
  task: Task;
  config: HtmlVideoJobConfig;
  appConfig: AppConfig;
  customStyles: CustomStyle[];
  draftTemplates: DraftTemplate[];
  applyState: ApplyMutationResult;
  refreshTaskDetail: (taskId: string) => Promise<void>;
}) {
  const initial = editableHtmlVideoValues(config);
  const [values, setValues] = useState(initial);
  const [message, setMessage] = useState('');
  const htmlVideoConfigAction = useAsyncAction();
  const bgmOptions = validBgmItems(appConfig);
  const styleOptions = editableHtmlVideoStyleOptions(customStyles, values.style);
  const voiceOptions = ttsVoiceOptionsForProvider(values.ttsProvider);
  const disabled = task.status === 'pending' || task.status === 'running' || htmlVideoConfigAction.busy;

  function setValue<K extends keyof typeof values>(field: K, value: (typeof values)[K]) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function changeProvider(value: string) {
    const ttsProvider = value as TtsProvider;
    const nextVoice = ttsVoiceOptionsForProvider(ttsProvider)[0]?.id ?? '';
    setValues((current) => ({ ...current, ttsProvider, voiceId: nextVoice }));
  }

  async function saveConfig() {
    const changes: HtmlVideoConfigChange[] = [];
    for (const field of [
      'style', 'voiceId', 'ttsProvider', 'ttsSpeed', 'bgmId', 'bgmVolume',
      'transitionType', 'foreground', 'maxScenes', 'ratio', 'draftTemplate',
    ] as const) {
      if (values[field] !== initial[field]) {
        changes.push({ field, value: values[field] } as HtmlVideoConfigChange);
      }
    }
    if (changes.length === 0) {
      setMessage('参数没有变化。');
      return;
    }
    await htmlVideoConfigAction.run(async () => {
      const next = await api.updateHtmlVideoConfig(task.id, changes);
      applyState(next);
      await refreshTaskDetail(task.id);
      setMessage('参数已保存，任务已回到可继续状态。');
    }, { onError: (error) => setMessage(error.message) });
  }

  return (
    <section className="hv-config-editor" aria-label="当前 HTML 视频任务参数">
      <div className="panel-title-row">
        <div><h4>任务参数</h4><span>保存后从最早受影响阶段继续</span></div>
        <button className="mini-button" type="button" onClick={saveConfig} disabled={disabled}>
          {htmlVideoConfigAction.busy ? <Loader2 className="spin" size={14} /> : <Save size={14} />}保存参数
        </button>
      </div>
      <fieldset className="advanced-grid hv-config-editor-grid" disabled={disabled}>
        <div data-html-video-edit-field="style">
          <Field label="画面风格">
            <select value={values.style} onChange={(event) => setValue('style', event.target.value)} disabled={disabled}>
              {styleOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </Field>
        </div>
        <div data-html-video-edit-field="ttsProvider">
          <Field label="配音模型">
            <select value={values.ttsProvider} onChange={(event) => changeProvider(event.target.value)} disabled={disabled}>
              {HTML_VIDEO_TTS_PROVIDERS.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
            </select>
          </Field>
        </div>
        <div data-html-video-edit-field="voiceId">
          <Field label="音色">
            <select value={values.voiceId} onChange={(event) => setValue('voiceId', event.target.value)} disabled={disabled}>
              {values.voiceId && !voiceOptions.some((option) => option.id === values.voiceId)
                ? <option value={values.voiceId}>{taskSpeakerLabel(values.ttsProvider, values.voiceId)}</option>
                : null}
              {voiceOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </Field>
        </div>
        <div data-html-video-edit-field="ttsSpeed">
          <RangeField label="语速" min={HTML_VIDEO_TTS_SPEED_MIN} max={HTML_VIDEO_TTS_SPEED_MAX} step={0.1} value={values.ttsSpeed} onChange={(value) => setValue('ttsSpeed', value)} />
        </div>
        <div data-html-video-edit-field="bgmId">
          <Field label="背景音乐">
            <select value={values.bgmId} onChange={(event) => setValue('bgmId', event.target.value)} disabled={disabled}>
              <option value="">无配乐</option>
              {values.bgmId && !bgmOptions.some((bgm) => bgm.id === values.bgmId)
                ? <option value={values.bgmId}>{values.bgmId}（素材库中已缺失）</option>
                : null}
              {bgmOptions.map((bgm) => <option key={bgm.id} value={bgm.id}>{bgm.title}</option>)}
            </select>
          </Field>
        </div>
        <div data-html-video-edit-field="bgmVolume">
          <Segmented label="配乐音量" value={values.bgmVolume} options={[...HTML_VIDEO_BGM_VOLUMES]} labels={['轻', '中', '响']} onChange={(value) => setValue('bgmVolume', value as typeof values.bgmVolume)} />
        </div>
        <div data-html-video-edit-field="transitionType">
          <Field label="转场">
            <select value={values.transitionType} onChange={(event) => setValue('transitionType', event.target.value as HtmlVideoTransition)} disabled={disabled}>
              {HTML_VIDEO_TRANSITIONS.map((transition) => <option key={transition} value={transition}>{transition}</option>)}
            </select>
          </Field>
        </div>
        <div data-html-video-edit-field="foreground">
          <ToggleField label="生成前景图" checked={values.foreground} onChange={(value) => setValue('foreground', value)} />
        </div>
        <div data-html-video-edit-field="maxScenes">
          <Field label="场景上限">
            <input type="number" min={1} max={30} step={1} value={values.maxScenes} onChange={(event) => setValue('maxScenes', Number(event.target.value))} disabled={disabled} />
          </Field>
        </div>
        <div data-html-video-edit-field="ratio">
          <Segmented label="画布比例" value={values.ratio} options={[...HTML_VIDEO_RATIOS]} onChange={(value) => setValue('ratio', value as typeof values.ratio)} />
        </div>
        <div data-html-video-edit-field="draftTemplate">
          <Field label="剪映草稿模板">
            <select value={values.draftTemplate} onChange={(event) => setValue('draftTemplate', event.target.value)} disabled={disabled}>
              <option value="">只输出 HTML 视频</option>
              {values.draftTemplate && !draftTemplates.some((template) => template.id === values.draftTemplate)
                ? <option value={values.draftTemplate}>{values.draftTemplate}（目录中已缺失）</option>
                : null}
              {draftTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
          </Field>
        </div>
      </fieldset>
      {message ? <span className="local-note" role="status">{message}</span> : null}
      <InlineActionFeedback feedback={htmlVideoConfigAction.feedback} />
    </section>
  );
}

const htmlVideoCaptionPresetLabels: Record<HtmlVideoCaptionPreset, string> = {
  classic: '经典',
  editorial: '编辑部',
  karaoke: '卡拉 OK',
};
const htmlVideoCaptionAnimationLabels: Record<HtmlVideoCaptionAnimation, string> = {
  none: '无动画',
  'fade-up': '淡入上浮',
  pop: '弹入',
};
const htmlVideoCaptionColorLabels: Record<HtmlVideoCaptionColorKey, string> = {
  text: '文字',
  accent: '强调',
  background: '底色',
  shadow: '阴影',
};

function HtmlVideoCaptionEditor({
  api,
  task,
  config,
  applyState,
  refreshTaskDetail,
  busy,
}: {
  api: StoryDreamApi;
  task: Task;
  config: HtmlVideoJobConfig;
  applyState: ApplyMutationResult;
  refreshTaskDetail: (taskId: string) => Promise<void>;
  busy: boolean;
}) {
  const initial = resolveHtmlVideoCaptionStyle(config);
  const configColorsKey = JSON.stringify(config.captionColors ?? {});
  const [preset, setPreset] = useState<HtmlVideoCaptionPreset>(initial.preset);
  const [animation, setAnimation] = useState<HtmlVideoCaptionAnimation>(initial.requestedAnimation);
  const [colors, setColors] = useState(initial.colors);
  const [colorOverrides, setColorOverrides] = useState<HtmlVideoCaptionColorOverrides>({ ...(config.captionColors ?? {}) });
  const [message, setMessage] = useState('');
  const captionAction = useAsyncAction();
  const disabled = busy || task.status === 'pending' || task.status === 'running' || captionAction.busy;

  useEffect(() => {
    const next = resolveHtmlVideoCaptionStyle(config);
    setPreset(next.preset);
    setAnimation(next.requestedAnimation);
    setColors(next.colors);
    setColorOverrides({ ...(config.captionColors ?? {}) });
    setMessage('');
  }, [task.id, config.captionPreset, config.captionAnim, configColorsKey]);

  function changePreset(value: HtmlVideoCaptionPreset) {
    setPreset(value);
    setColors(resolveHtmlVideoCaptionStyle({ captionPreset: value, captionColors: colorOverrides }).colors);
  }

  function changeColor(key: HtmlVideoCaptionColorKey, value: string) {
    setColors((current) => ({ ...current, [key]: value }));
    try {
      const validated = validateHtmlVideoCaptionColors({ [key]: value });
      setColorOverrides((current) => ({ ...current, [key]: validated[key] }));
      setMessage('');
    } catch {
      setMessage('颜色代码仅支持 3、4、6 或 8 位十六进制。');
    }
  }

  function resetColor(key: HtmlVideoCaptionColorKey) {
    const next = { ...colorOverrides };
    delete next[key];
    setColorOverrides(next);
    setColors(resolveHtmlVideoCaptionStyle({ captionPreset: preset, captionColors: next }).colors);
    setMessage('');
  }

  async function saveCaptionConfig() {
    try {
      validateHtmlVideoCaptionColors(colors);
    } catch {
      setMessage('请先修正无效的字幕颜色代码。');
      return;
    }
    const changes: HtmlVideoConfigChange[] = [];
    if (preset !== initial.preset) changes.push({ field: 'captionPreset', value: preset });
    if (animation !== initial.requestedAnimation) changes.push({ field: 'captionAnim', value: animation });
    if (!htmlVideoCaptionColorsEqual(config.captionColors, colorOverrides)) {
      changes.push({ field: 'captionColors', value: colorOverrides });
    }
    if (!changes.length) {
      setMessage('字幕参数没有变化。');
      return;
    }
    await captionAction.run(async () => {
      const next = await api.updateHtmlVideoConfig(task.id, changes);
      applyState(next);
      await refreshTaskDetail(task.id);
      setMessage('字幕参数已保存。');
    }, { onError: (error) => setMessage(error.message) });
  }

  return (
    <section className="hv-caption-editor" aria-label="字幕样式参数">
      <div className="panel-title-row">
        <h4>字幕样式</h4>
        <button className="mini-button" type="button" disabled={disabled} onClick={saveCaptionConfig}>
          {captionAction.busy ? <Loader2 className="spin" size={14} /> : <Save size={14} />}保存字幕
        </button>
      </div>
      <fieldset className="hv-caption-editor-grid" disabled={disabled}>
        <div data-html-video-edit-field="captionPreset">
          <Field label="字幕预设">
            <select value={preset} onChange={(event) => changePreset(event.target.value as HtmlVideoCaptionPreset)} disabled={disabled}>
              {HTML_VIDEO_CAPTION_PRESETS.map((value) => <option key={value} value={value}>{htmlVideoCaptionPresetLabels[value]}</option>)}
            </select>
          </Field>
        </div>
        <div data-html-video-edit-field="captionAnim">
          <Field label="字幕动画">
            <select value={animation} onChange={(event) => setAnimation(event.target.value as HtmlVideoCaptionAnimation)} disabled={disabled}>
              {HTML_VIDEO_CAPTION_ANIMATIONS.map((value) => <option key={value} value={value}>{htmlVideoCaptionAnimationLabels[value]}</option>)}
            </select>
          </Field>
        </div>
        <div className="hv-caption-colors" data-html-video-edit-field="captionColors">
          {HTML_VIDEO_CAPTION_COLOR_KEYS.map((key) => (
            <div className="hv-caption-color-item" key={key}>
              <span>{htmlVideoCaptionColorLabels[key]}</span>
              <div className="hv-caption-color-controls">
                <input
                  type="color"
                  aria-label={`${htmlVideoCaptionColorLabels[key]}颜色选择`}
                  value={htmlVideoCaptionPickerColor(colors[key])}
                  disabled={disabled}
                  onChange={(event) => changeColor(key, event.target.value)}
                />
                <input
                  className="hv-caption-color-code"
                  type="text"
                  aria-label={`${htmlVideoCaptionColorLabels[key]}十六进制颜色`}
                  value={colors[key]}
                  maxLength={9}
                  spellCheck={false}
                  disabled={disabled}
                  onChange={(event) => changeColor(key, event.target.value)}
                />
                <button
                  className="icon-button hv-caption-color-reset"
                  type="button"
                  title="恢复预设颜色"
                  aria-label={`恢复${htmlVideoCaptionColorLabels[key]}预设颜色`}
                  disabled={disabled || colorOverrides[key] === undefined}
                  onClick={() => resetColor(key)}
                >
                  <RotateCcw size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </fieldset>
      {message ? <span className="local-note" role="status">{message}</span> : null}
      <InlineActionFeedback feedback={captionAction.feedback} />
    </section>
  );
}

function HtmlVideoCoverEditor({
  api,
  task,
  config,
  coverAsset,
  templates,
  renderError,
  applyState,
  refreshTaskDetail,
  busy,
  isBrowserPreview,
}: {
  api: StoryDreamApi;
  task: Task;
  config: HtmlVideoJobConfig;
  coverAsset?: HtmlVideoCoverAsset;
  templates: CustomCoverTemplate[];
  renderError?: string;
  applyState: ApplyMutationResult;
  refreshTaskDetail: (taskId: string) => Promise<void>;
  busy: boolean;
  isBrowserPreview: boolean;
}) {
  const initialMode = config.coverImageMode ?? HTML_VIDEO_JOB_DEFAULTS.coverImageMode;
  const initialTemplate = config.coverTemplate ?? HTML_VIDEO_JOB_DEFAULTS.coverTemplate;
  const initialRatio = config.coverRatio ?? HTML_VIDEO_JOB_DEFAULTS.coverRatio;
  const [mode, setMode] = useState<HtmlVideoCoverMode>(initialMode);
  const [templateId, setTemplateId] = useState(initialTemplate);
  const [ratio, setRatio] = useState<HtmlVideoCoverRatio>(initialRatio);
  const [message, setMessage] = useState('');
  const coverAction = useAsyncAction();
  const taskActive = task.status === 'pending' || task.status === 'running';
  const disabled = busy || taskActive || coverAction.busy;
  const dimensions = htmlVideoCoverDimensions(ratio);

  useEffect(() => {
    setMode(config.coverImageMode ?? HTML_VIDEO_JOB_DEFAULTS.coverImageMode);
    setTemplateId(config.coverTemplate ?? HTML_VIDEO_JOB_DEFAULTS.coverTemplate);
    setRatio(config.coverRatio ?? HTML_VIDEO_JOB_DEFAULTS.coverRatio);
    setMessage('');
  }, [task.id, config.coverImageMode, config.coverTemplate, config.coverRatio]);

  async function saveCoverConfig() {
    const changes: HtmlVideoConfigChange[] = [];
    if (mode !== initialMode) changes.push({ field: 'coverImageMode', value: mode });
    if (templateId !== initialTemplate) changes.push({ field: 'coverTemplate', value: templateId });
    if (ratio !== initialRatio) changes.push({ field: 'coverRatio', value: ratio });
    if (!changes.length) {
      setMessage('封面参数没有变化。');
      return;
    }
    await coverAction.run(async () => {
      applyState(await api.updateHtmlVideoConfig(task.id, changes));
      await refreshTaskDetail(task.id);
      setMessage('封面参数已保存。');
    }, { onError: (error) => setMessage(error.message) });
  }

  async function importManualCover() {
    if (config.coverImageMode !== 'manual') {
      setMessage('请先保存手动封面模式。');
      return;
    }
    await coverAction.run(async () => {
      const next = await api.importHtmlVideoCover(task.id);
      if (next) applyState(next);
      await refreshTaskDetail(task.id);
      setMessage('手动封面已导入。');
    }, { onError: (error) => setMessage(error.message) });
  }

  return (
    <section className="hv-cover-editor" aria-label="封面参数">
      <div className="panel-title-row">
        <div>
          <h4>封面参数</h4>
          <span>{dimensions.width}x{dimensions.height}</span>
        </div>
        <div className="hv-cover-actions">
          <button
            className="mini-button"
            type="button"
            disabled={disabled || isBrowserPreview || config.coverImageMode !== 'manual'}
            onClick={importManualCover}
          >
            {coverAction.busy ? <Loader2 className="spin" size={14} /> : <Upload size={14} />}导入封面
          </button>
          <button className="mini-button" type="button" disabled={disabled} onClick={saveCoverConfig}>
            <Save size={14} />保存封面
          </button>
        </div>
      </div>
      <fieldset className="hv-cover-editor-grid" disabled={disabled}>
        <div data-html-video-edit-field="coverImageMode">
          <Segmented label="模式" value={mode} options={[...HTML_VIDEO_COVER_MODES]} labels={['关闭', '自动', '手动']} onChange={(value) => setMode(value as HtmlVideoCoverMode)} />
        </div>
        <div data-html-video-edit-field="coverTemplate">
          <Field label="模板">
            <select value={templateId} disabled={disabled} onChange={(event) => setTemplateId(event.target.value)}>
              {templateId && !templates.some((item) => item.id === templateId)
                ? <option value={templateId}>{templateId}（目录中已缺失）</option>
                : null}
              {templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
        </div>
        <div data-html-video-edit-field="coverRatio">
          <Segmented label="比例" value={ratio} options={[...HTML_VIDEO_COVER_RATIOS]} onChange={(value) => setRatio(value as HtmlVideoCoverRatio)} />
        </div>
      </fieldset>
      {coverAsset ? (
        <div className="hv-cover-artifact-meta">
          <strong>{coverAsset.mode === 'manual' ? '手动封面' : '自动封面'} · r{coverAsset.revision}</strong>
          <small>{coverAsset.width}x{coverAsset.height} · {formatFileSize(coverAsset.sizeBytes)}</small>
        </div>
      ) : null}
      {renderError ? <div className="hv-cover-error" role="alert">{renderError}</div> : null}
      {message ? <span className="local-note" role="status">{message}</span> : null}
      <InlineActionFeedback feedback={coverAction.feedback} />
    </section>
  );
}

function HtmlVideoTabPanel({
  api,
  tab,
  task,
  data,
  customCoverTemplates,
  applyState,
  refreshTaskDetail,
  mediaUrls,
  failedMediaPaths,
  mediaRetryRevision,
  onMediaElementError,
  onMediaElementReady,
  busy,
  isBrowserPreview,
  openPreview,
}: {
  api: StoryDreamApi;
  tab: HtmlVideoTabKey;
  task: Task | null;
  data: ReturnType<typeof safeParseHtmlVideoPipelineData>['data'];
  customCoverTemplates: CustomCoverTemplate[];
  applyState: ApplyMutationResult;
  refreshTaskDetail: (taskId: string) => Promise<void>;
  mediaUrls: Record<string, string>;
  failedMediaPaths: ReadonlySet<string>;
  mediaRetryRevision: number;
  onMediaElementError: (path: string) => void;
  onMediaElementReady: (path: string) => void;
  busy: boolean;
  isBrowserPreview: boolean;
  openPreview: (sceneIndex?: number) => Promise<void>;
}) {
  if (!task) {
    return <EmptyState title="暂无 HTML 动画视频任务" />;
  }

  if (tab === 'text') {
    return (
      <div className="hv-tab-content">
        {data.scenes.length ? (
          <div className="artifact-scene-list">
            {data.scenes.map((scene) => (
              <div key={scene.index}>
                <strong>{scene.index}. {scene.title}</strong>
                <p>{scene.narration}</p>
                <small>{scene.captions.join(' / ')}</small>
              </div>
            ))}
          </div>
        ) : <EmptyState title="等待文案改写与场景规划" />}
      </div>
    );
  }

  if (tab === 'assets') {
    return (
      <div className="hv-tab-content">
        {data.assets.length ? (
          <div className="hv-media-grid">
            {data.assets.map((asset) => {
              const url = mediaUrls[asset.src];
              const assetStatus = htmlVideoMediaStatus(asset.src, mediaUrls, failedMediaPaths, isBrowserPreview);
              return (
                <figure className="hv-media-item" key={`${asset.sceneIndex}-${asset.kind}-${asset.slot}`}>
                  <div className="hv-media-frame" aria-busy={assetStatus === 'loading'}>
                    {assetStatus === 'ready' && url ? (
                      <img
                        key={htmlVideoMediaElementKey(task.id, asset.src, mediaRetryRevision)}
                        src={url}
                        alt={`场景 ${asset.sceneIndex}${asset.kind === 'bg' ? '背景图' : '前景图'}`}
                        loading="lazy"
                        decoding="async"
                        onError={() => onMediaElementError(asset.src)}
                        onLoad={() => onMediaElementReady(asset.src)}
                      />
                    ) : assetStatus === 'loading' ? (
                      <span className="hv-media-state hv-media-loading" role="status"><Loader2 className="spin" size={18} />图片加载中</span>
                    ) : assetStatus === 'unavailable' ? (
                      <span className="hv-media-state" role="status" aria-live="polite"><ImageIcon size={22} aria-hidden="true" />图片加载失败</span>
                    ) : (
                      <span className="hv-media-state" role="status"><ImageIcon size={22} aria-hidden="true" />本地图片仅桌面端可用</span>
                    )}
                  </div>
                  <figcaption>
                    <strong>场景 {asset.sceneIndex} · {asset.kind === 'bg' ? '背景图' : `前景图 ${asset.slot + 1}`}</strong>
                    {asset.prompt ? <small>{trimForPreview(asset.prompt, 90)}</small> : null}
                  </figcaption>
                </figure>
              );
            })}
          </div>
        ) : data.scenes.length ? (
          <div className="artifact-scene-list">
            {data.scenes.map((scene) => (
              <div key={scene.index}>
                <strong>场景 {scene.index} 素材提示词</strong>
                <p>背景图：{scene.background.prompt}</p>
                {scene.elements.map((element) => <small key={element.slot}>透明前景图：{element.prompt}</small>)}
              </div>
            ))}
          </div>
        ) : <EmptyState title="等待素材生成" />}
      </div>
    );
  }

  if (tab === 'voice') {
    return (
      <div className="hv-tab-content">
        {data.voiceClips.length ? (
          <div className="artifact-scene-list">
            {data.voices.map((clip) => {
              const url = mediaUrls[clip.src];
              const voiceStatus = htmlVideoMediaStatus(clip.src, mediaUrls, failedMediaPaths, isBrowserPreview);
              return (
                <div key={`${clip.sceneIndex}-${clip.src}`}>
                  <strong>场景 {clip.sceneIndex} 配音</strong>
                  <p>{clip.text ?? '旁白音频'}</p>
                  {voiceStatus === 'ready' && url ? (
                    <audio
                      key={htmlVideoMediaElementKey(task.id, clip.src, mediaRetryRevision)}
                      controls
                      preload="metadata"
                      src={url}
                      aria-label={`场景 ${clip.sceneIndex} 配音`}
                      onError={() => onMediaElementError(clip.src)}
                      onCanPlay={() => onMediaElementReady(clip.src)}
                    />
                  ) : voiceStatus === 'loading' ? (
                    <small className="hv-media-loading" role="status"><Loader2 className="spin" size={14} />音频加载中</small>
                  ) : voiceStatus === 'unavailable' ? (
                    <small>音频文件暂不可用</small>
                  ) : <small>本地音频请在 Electron 桌面端查看</small>}
                  <small>{clip.durationSec.toFixed(1)} 秒</small>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState title="等待配音生成" />
        )}
      </div>
    );
  }

  if (tab === 'preview') {
    return (
      <div className="hv-tab-content">
        <HtmlVideoCaptionEditor
          key={task.id}
          api={api}
          task={task}
          config={data.config}
          applyState={applyState}
          refreshTaskDetail={refreshTaskDetail}
          busy={busy}
        />
        {data.compositions.length ? (
          <div className="hv-media-grid">
            {data.compositions.map((composition) => {
              const thumbnailPath = composition.thumbnailPath ?? composition.background.src;
              const thumbnailUrl = mediaUrls[thumbnailPath];
              const thumbnailStatus = htmlVideoMediaStatus(thumbnailPath, mediaUrls, failedMediaPaths, isBrowserPreview);
              return (
                <figure className="hv-media-item" key={composition.index}>
                  <div className="hv-media-frame" aria-busy={thumbnailStatus === 'loading'}>
                    {thumbnailStatus === 'ready' && thumbnailUrl ? (
                      <img
                        key={htmlVideoMediaElementKey(task.id, thumbnailPath, mediaRetryRevision)}
                        src={thumbnailUrl}
                        alt={`场景 ${composition.index} 动画预览`}
                        loading="lazy"
                        decoding="async"
                        onError={() => onMediaElementError(thumbnailPath)}
                        onLoad={() => onMediaElementReady(thumbnailPath)}
                      />
                    ) : thumbnailStatus === 'loading' ? (
                      <span className="hv-media-state hv-media-loading" role="status"><Loader2 className="spin" size={18} />预览加载中</span>
                    ) : thumbnailStatus === 'unavailable' ? (
                      <span className="hv-media-state" role="status" aria-live="polite"><Play size={22} aria-hidden="true" />预览加载失败</span>
                    ) : (
                      <span className="hv-media-state" role="status"><Play size={22} aria-hidden="true" />本地预览仅桌面端可用</span>
                    )}
                  </div>
                  <figcaption>
                    <strong>动画预览 · 场景 {composition.index}</strong>
                    <small>{composition.canvas.w}x{composition.canvas.h} · {composition.durationSec.toFixed(1)} 秒 · {composition.captions.length} 条字幕</small>
                    <button className="mini-button" disabled={busy || isBrowserPreview || !composition.htmlPath} onClick={() => openPreview(composition.index)}>
                      <Eye size={14} />打开预览
                    </button>
                  </figcaption>
                </figure>
              );
            })}
          </div>
        ) : <EmptyState title="等待动画预览" />}
      </div>
    );
  }

  if (tab === 'cover') {
    const coverPath = data.coverAsset?.path;
    const coverUrl = coverPath ? mediaUrls[coverPath] : '';
    const coverStatus = coverPath
      ? htmlVideoMediaStatus(coverPath, mediaUrls, failedMediaPaths, isBrowserPreview)
      : 'desktop-only';
    const coverDimensions = htmlVideoCoverDimensions(data.config.coverRatio ?? HTML_VIDEO_JOB_DEFAULTS.coverRatio);
    return (
      <div className="hv-tab-content">
        <HtmlVideoCoverEditor
          key={task.id}
          api={api}
          task={task}
          config={data.config}
          coverAsset={data.coverAsset}
          templates={customCoverTemplates}
          renderError={data.steps.render.error}
          applyState={applyState}
          refreshTaskDetail={refreshTaskDetail}
          busy={busy}
          isBrowserPreview={isBrowserPreview}
        />
        {data.config.coverImageMode === 'off' ? (
          <EmptyState title="封面已关闭" />
        ) : coverPath ? (
          <figure className="hv-media-item hv-cover-preview">
            <div className="hv-media-frame" style={{ aspectRatio: `${coverDimensions.width} / ${coverDimensions.height}` }} aria-busy={coverStatus === 'loading'}>
              {coverStatus === 'ready' && coverUrl ? (
                <img
                  key={htmlVideoMediaElementKey(task.id, coverPath, mediaRetryRevision)}
                  src={coverUrl}
                  alt="HTML 视频封面预览"
                  onError={() => onMediaElementError(coverPath)}
                  onLoad={() => onMediaElementReady(coverPath)}
                />
              ) : coverStatus === 'loading' ? (
                <span className="hv-media-state hv-media-loading" role="status"><Loader2 className="spin" size={18} />封面加载中</span>
              ) : coverStatus === 'unavailable' ? (
                <span className="hv-media-state" role="status"><ImageIcon size={22} />封面加载失败</span>
              ) : (
                <span className="hv-media-state" role="status"><ImageIcon size={22} />本地封面仅桌面端可用</span>
              )}
            </div>
            <figcaption>
              <strong>{task.title}</strong>
              <small>{data.coverAsset?.path}</small>
            </figcaption>
          </figure>
        ) : (
          <EmptyState title="等待封面生成" />
        )}
      </div>
    );
  }

  const outputUrl = data.output ? mediaUrls[data.output.path] : '';
  const outputStatus = data.output
    ? htmlVideoMediaStatus(data.output.path, mediaUrls, failedMediaPaths, isBrowserPreview)
    : 'desktop-only';
  const outputSize = fitHtmlVideoOutputSize(Number.POSITIVE_INFINITY, 520, data.config.ratio || task.ratio);
  const outputStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: outputSize.width,
    maxHeight: outputSize.height,
    aspectRatio: String(outputSize.aspectRatio),
  };
  return (
    <div className="hv-tab-content">
      <div className="task-metrics">
        <div
          data-html-video-control="transitionType"
          data-control-availability={HTML_VIDEO_CONTROL_MANIFEST_V1.transitionType.availability}
        ><small>转场</small><strong>{data.config.transitionType ?? HTML_VIDEO_JOB_DEFAULTS.transitionType}</strong></div>
        <div><small>背景音乐</small><strong>{data.config.bgmId || '无'}</strong></div>
        <div
          data-html-video-control="coverRatio"
          data-control-availability={HTML_VIDEO_CONTROL_MANIFEST_V1.coverRatio.availability}
        ><small>封面比例</small><strong>{data.config.coverRatio ?? HTML_VIDEO_JOB_DEFAULTS.coverRatio}</strong></div>
      </div>
      {data.output ? (
        <div className="hv-video-output">
          {outputStatus === 'ready' && outputUrl ? (
            <video
              key={htmlVideoMediaElementKey(task.id, data.output.path, mediaRetryRevision)}
              controls
              preload="metadata"
              src={outputUrl}
              aria-label={`${task.title || 'HTML 动画视频'}成片预览`}
              style={outputStyle}
              onError={() => onMediaElementError(data.output!.path)}
              onCanPlay={() => onMediaElementReady(data.output!.path)}
            />
          ) : (
            <div className="hv-video-placeholder" style={outputStyle} aria-busy={outputStatus === 'loading'} role={outputStatus === 'loading' ? 'status' : undefined}>
              {outputStatus === 'loading' ? (
                <><Loader2 className="spin" size={28} /><span>视频加载中</span></>
              ) : outputStatus === 'unavailable' ? (
                <><Play size={28} /><span>视频文件暂不可用</span></>
              ) : <><Play size={28} /><span>本地视频请在 Electron 桌面端查看</span></>}
            </div>
          )}
          <div className="hv-output-meta">
            <strong>{task.title}</strong>
            <small>{formatFileSize(data.output.sizeBytes)}{data.output.durationSec ? ` · ${data.output.durationSec.toFixed(1)} 秒` : ''}</small>
          </div>
          <div className="hv-output-path">
            <small>输出路径</small>
            <code>{data.output.path}</code>
          </div>
        </div>
      ) : <EmptyState title="等待出片" />}
    </div>
  );
}

function htmlVideoStepClass(status: HtmlVideoStepStatus): string {
  return status === 'completed' ? 'done' : status;
}

function htmlVideoStepStatusLabel(status: HtmlVideoStepStatus, taskStatus?: TaskStatus): string {
  if (status === 'cancelled' && taskStatus === 'paused') return '已暂停';
  return {
    pending: '等待',
    running: '运行中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  }[status];
}

function htmlVideoPipelineStepLabel(step: string): string {
  return {
    rewrite: '改写与分句',
    planning: '场景规划',
    assets: '素材生成',
    voice: '配音生成',
    preview: '动画预览',
    render: '逐帧合成',
    done: '出片完成',
  }[step] ?? '等待推进';
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function QueuePage({
  api,
  state,
  applyState,
  openNewTask,
  openTaskDetail,
  isBrowserPreview,
}: {
  api: StoryDreamApi;
  state: AppState;
  applyState: ApplyMutationResult;
  openNewTask: () => void;
  openTaskDetail: (taskId: string) => void;
  isBrowserPreview: boolean;
}) {
  const latestTask = state.tasks[0];
  const events = latestTask ? state.events.filter((event) => event.taskId === latestTask.id || event.taskId === 'live') : state.events;
  const queueAction = useAsyncAction();
  async function setStatus(task: Task, status: TaskStatus) {
    await queueAction.run(async () => {
      applyState(await api.updateTaskStatus(task.id, status));
    });
  }
  async function resumeTask(task: Task) {
    await queueAction.run(async () => {
      applyState(await api.retryTask(task.id));
    });
  }
  async function openQueueOutput(taskId: string) {
    await queueAction.run(() => api.openTaskOutputDirectory(taskId));
  }
  return (
    <div className="queue-layout">
      <section className="panel">
        <div className="panel-title-row">
          <div>
            <h2>任务队列</h2>
            <span>{state.tasks.length} 个草稿 · 选中一批即可自动串行执行 · 单任务内 3 路并发生图</span>
          </div>
          <button className="primary-action slim" onClick={openNewTask}>
            <Plus size={15} />
            新建任务
          </button>
        </div>
        <div className="task-list">
          {state.tasks.length === 0 ? <EmptyState title="暂无任务" /> : null}
          {state.tasks.map((task) => (
            <article className="task-row clickable" key={task.id} role="button" tabIndex={0} onClick={() => openTaskDetail(task.id)} onKeyDown={(event) => event.key === 'Enter' && openTaskDetail(task.id)}>
              <div>
                <strong>{task.title || '未命名任务'}</strong>
                <span>{task.mode === 'ai' ? 'AI 创作' : '粘贴文案'} · {task.ratio} · {formatDate(task.createdAt)}</span>
                <ErrorSummaryButton fullMessage={task.errorMessage} title={task.title || '任务错误'} />
              </div>
              <StatusPill status={task.status} />
              <div className="row-actions" onClick={(event) => event.stopPropagation()}>
                {task.status === 'running' ? <button className="mini-button" onClick={() => setStatus(task, 'paused')}>暂停</button> : null}
                {task.status === 'running' || task.status === 'pending' ? <button className="mini-button" onClick={() => setStatus(task, 'cancelled')}>取消</button> : null}
                {task.status === 'paused' || task.status === 'failed' ? <button className="mini-button" disabled={isBrowserPreview} onClick={() => resumeTask(task)}>继续</button> : null}
                {task.status === 'paused' || task.status === 'failed' ? <button className="mini-button" disabled={isBrowserPreview} onClick={() => resumeTask(task)}>重试</button> : null}
                <button className="mini-button" disabled={queueAction.busy || task.status !== 'completed' || !task.outputDir} onClick={() => task.outputDir && openQueueOutput(task.id)}>
                  <FolderOpen size={14} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-title-row">
          <h2>步骤事件</h2>
          {latestTask?.status === 'completed' && latestTask.outputDir ? (
            <button className="ghost-action" disabled={queueAction.busy} onClick={() => openQueueOutput(latestTask.id)}>
              <FolderOpen size={15} />
              打开剪映草稿
            </button>
          ) : null}
        </div>
        <InlineActionFeedback feedback={queueAction.feedback} />
        <EventTimeline events={events.slice(-24)} />
      </section>
    </div>
  );
}

function HistoryPage({
  api,
  openTaskDetail,
  isTombstoned,
  familyEpoch,
}: {
  api: StoryDreamApi;
  openTaskDetail: (taskId: string) => void;
  isTombstoned: (family: 'task', id: string) => boolean;
  familyEpoch: number;
}) {
  const [filter, setFilter] = useState<'all' | TaskStatus>('all');
  const [query, setQuery] = useState('');
  const historyAction = useAsyncAction();
  const request = useMemo<Extract<HistoryListRequest, { family: 'task' }>>(() => ({
    family: 'task',
    filter: 'active',
    ...(filter === 'all' ? {} : { status: filter }),
    ...(query.trim() ? { query } : {}),
    limit: 50,
  }), [filter, query]);
  const loadPage = useCallback((next: Extract<HistoryListRequest, { family: 'task' }>) => {
    const { family: _family, ...input } = next;
    return api.listTasks(input);
  }, [api]);
  const historyPage = useHistoryPage<'task', TaskSummary>({
    family: 'task',
    request,
    loadPage,
    isTombstoned,
    familyEpoch,
  });
  const tasks = historyPage.page?.items ?? [];
  async function openHistoryOutput(taskId: string) {
    await historyAction.run(() => api.openTaskOutputDirectory(taskId));
  }
  return (
    <section className="panel full-panel">
      <div className="panel-title-row">
        <div className="chip-row">
          {(['all', 'draft', 'completed', 'running', 'failed', 'cancelled'] as const).map((item) => (
            <button key={item} className={filter === item ? 'chip active' : 'chip'} onClick={() => setFilter(item)}>
              {statusLabel(item)}
            </button>
          ))}
        </div>
        <input className="search-input" value={query} placeholder="搜索任务" onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="panel-title-row">
        <span className="subtle-copy">
          {historyPage.page ? `${historyPage.page.totalCount} 条记录` : historyPage.loading ? '正在加载' : '暂无记录'}
        </span>
        <div className="chip-row" aria-label="历史分页">
          <button
            className="mini-button"
            type="button"
            title="上一页"
            aria-label="上一页"
            disabled={historyPage.loading || !historyPage.hasPrevious}
            onClick={historyPage.previous}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            className="mini-button"
            type="button"
            title="重新加载"
            aria-label="重新加载"
            disabled={historyPage.loading}
            onClick={historyPage.reload}
          >
            <RotateCcw size={14} />
          </button>
          <button
            className="mini-button"
            type="button"
            title="下一页"
            aria-label="下一页"
            disabled={historyPage.loading || !historyPage.page?.nextCursor}
            onClick={historyPage.next}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
      <div className="history-table">
        <div className="table-head">
          <span>任务</span>
          <span>状态</span>
          <span>步骤</span>
          <span>创建时间</span>
          <span>输出</span>
        </div>
        {historyPage.loading && tasks.length === 0 ? <EmptyState title="正在加载历史任务" /> : null}
        {!historyPage.loading && tasks.length === 0 ? <EmptyState title="暂无历史任务" /> : null}
        {tasks.map((task) => (
          <div className="table-row clickable" key={task.id} role="button" tabIndex={0} onClick={() => openTaskDetail(task.id)} onKeyDown={(event) => event.key === 'Enter' && openTaskDetail(task.id)}>
            <strong>{task.title || '未命名任务'}</strong>
            <StatusPill status={task.status} />
            <span>{taskProgressLabel(task)}</span>
            <span>{formatDate(task.createdAt)}</span>
            <button className="mini-button" disabled={historyAction.busy || !task.outputDir} onClick={(event) => { event.stopPropagation(); if (task.outputDir) void openHistoryOutput(task.id); }}>
              <FolderOpen size={14} />
            </button>
          </div>
        ))}
      </div>
      {historyPage.error ? <div className="inline-feedback error">{historyPage.error.message}</div> : null}
      <InlineActionFeedback feedback={historyAction.feedback} />
    </section>
  );
}

function TaskDetailPage({
  api,
  state,
  task,
  applyState,
  close,
  isBrowserPreview,
}: {
  api: StoryDreamApi;
  state: AppState;
  task: Task | null;
  applyState: ApplyMutationResult;
  close: () => void;
  isBrowserPreview: boolean;
}) {
  const [tab, setTab] = useState<'preview' | 'storyboard' | 'audio'>('preview');
  const [liveNow, setLiveNow] = useState(Date.now());
  const [artifactSnapshot, setArtifactSnapshot] = useState<TaskArtifactSnapshot | null>(null);
  const [artifactRefreshTick, setArtifactRefreshTick] = useState(0);
  const taskDetailAction = useAsyncAction();
  const events = task ? state.events.filter((event) => event.taskId === task.id) : [];
  const latestEvent = [...events].reverse()[0] ?? null;
  const snapshotImageCount = artifactSnapshot?.assets.images.length ?? 0;
  const artifactRefreshKey = [
    task?.id ?? '',
    task?.artifactStatePath ?? '',
    task?.outputDir ?? '',
    task?.currentStep ?? '',
    task?.status ?? '',
    latestEvent?.id ?? latestEvent?.seq ?? latestEvent?.ts ?? '',
    snapshotImageCount,
    snapshotStepStatus(artifactSnapshot, 4),
    artifactRefreshTick,
  ].join('|');
  useEffect(() => {
    if (task?.status !== 'running') return undefined;
    const timer = window.setInterval(() => setLiveNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [task?.id, task?.status]);
  useEffect(() => {
    if (task?.status !== 'running') return undefined;
    const timer = window.setInterval(() => setArtifactRefreshTick((tick) => tick + 1), 1500);
    return () => window.clearInterval(timer);
  }, [task?.id, task?.status]);
  useEffect(() => {
    let cancelled = false;
    if (!task) {
      setArtifactSnapshot(null);
      return undefined;
    }
    const artifactTask = task;
    api.getTaskArtifacts(artifactTask.id)
      .then((snapshot) => {
        if (!cancelled) setArtifactSnapshot(snapshot);
      })
      .catch((error) => {
        if (!cancelled) {
          const normalized = taskDetailAction.reportError(error);
          setArtifactSnapshot({
            available: false,
            message: normalized.message,
            taskId: artifactTask.id,
            statePath: artifactTask.artifactStatePath,
            outputDir: artifactTask.outputDir,
            updatedAt: null,
            steps: {},
            artifact: {},
            assets: { cover: [], images: [], imageErrors: [], narration: [] },
            draft: null,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, artifactRefreshKey, task, taskDetailAction.reportError]);
  if (!task) {
    return (
      <section className="panel full-panel">
        <EmptyState title="暂无任务详情" />
      </section>
    );
  }

  const activeTask = task;
  const currentStep = Math.min(Math.max(activeTask.currentStep, 0), pipelineSteps.length - 1);
  const currentMeta = pipelineSteps[currentStep] ?? pipelineSteps[0];
  const completedSteps = activeTask.status === 'completed' ? pipelineSteps.length : Math.max(0, activeTask.currentStep);

  async function cancelTask() {
    await taskDetailAction.run(async () => {
      applyState(await api.updateTaskStatus(activeTask.id, 'cancelled'));
    });
  }

  return (
    <div className="task-detail-shell">
      <div className="task-detail-bar">
        <div className="breadcrumb">
          <button onClick={close}>历史任务</button>
          <span>/</span>
          <strong>任务详情</strong>
        </div>
        <button className="mini-button" onClick={close}>
          <XCircle size={14} />
          关闭
        </button>
      </div>

      <aside className="task-detail-sidebar">
        <section className="task-summary-card">
          <div className="task-id-line">
            <span>{activeTask.id}</span>
            <button className="icon-button" title="复制任务 ID" onClick={() => navigator.clipboard?.writeText(activeTask.id)}>
              <Copy size={14} />
            </button>
          </div>
          <div className="task-metrics">
            <div><strong>{formatDuration(activeTask.createdAt, activeTask.completedAt, liveNow)}</strong><span>总耗时</span></div>
            <div><strong>{completedSteps}<small>/{pipelineSteps.length}</small></strong><span>当前步骤</span></div>
            <div><strong>{events.length || '-'}</strong><span>事件数</span></div>
          </div>
          <button className="cancel-task-button" disabled={activeTask.status === 'completed' || activeTask.status === 'cancelled'} onClick={cancelTask}>
            <XCircle size={14} />
            取消任务
          </button>
        </section>

        <section className="pipeline-card">
          <div className="pipeline-title">
            <strong>7 步流水线</strong>
            <span className="auto-badge">全自动</span>
            <small>· 全部 7 步执行</small>
          </div>
          <div className="pipeline-list">
            {pipelineSteps.map((step) => {
              const status = pipelineStepStatus(activeTask, step.index);
              const stepEvent = [...events].reverse().find((event) => event.step === step.index);
              const stepLabel = stepEvent?.detail || statusLabelForStep(status);
              return (
                <div className={`pipeline-step ${status}`} key={step.index}>
                  <div className="pipeline-node">{status === 'running' ? <Loader2 className="spin" size={14} /> : step.index + 1}</div>
                  <div>
                    <strong>{step.title}</strong>
                    <span>{step.hint}</span>
                    {status === 'running' ? <small>进行中</small> : stepEvent?.type === 'step_error' ? <ErrorSummaryButton fullMessage={stepEvent.detail} title={step.title} compact /> : <small>{stepLabel}</small>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </aside>

      <section className="task-detail-main">
        <InlineActionFeedback feedback={taskDetailAction.feedback} />
        <div className="artifact-tabs">
          <button className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}><FileJson size={14} />产物预览</button>
          <button className={tab === 'storyboard' ? 'active' : ''} onClick={() => setTab('storyboard')}><ImageIcon size={14} />分镜画廊</button>
          <button className={tab === 'audio' ? 'active' : ''} onClick={() => setTab('audio')}><Mic2 size={14} />配音试听</button>
        </div>
        <ArtifactPreviewContent api={api} task={activeTask} config={state.config} applyState={applyState} tab={tab} snapshot={artifactSnapshot} latestEvent={latestEvent} currentAgent={currentMeta.agent} isBrowserPreview={isBrowserPreview} />
      </section>
    </div>
  );
}

function ArtifactPreviewContent({
  api,
  task,
  config,
  applyState,
  tab,
  snapshot,
  latestEvent,
  currentAgent,
  isBrowserPreview,
}: {
  api: StoryDreamApi;
  task: Task;
  config: AppConfig;
  applyState: ApplyMutationResult;
  tab: 'preview' | 'storyboard' | 'audio';
  snapshot: TaskArtifactSnapshot | null;
  latestEvent: TaskEvent | null;
  currentAgent: string;
  isBrowserPreview: boolean;
}) {
  const artifact = snapshot?.artifact ?? {};
  const sourceContext = artifact.sourceContext;
  const scenes = artifact.scenes ?? [];
  const imagePrompts = artifact.imagePrompts ?? [];
  const subtitles = artifact.subtitles;
  const imageAssets = snapshot?.assets.images ?? [];
  const imageErrors = snapshot?.assets.imageErrors ?? [];
  const narrationAssets = snapshot?.assets.narration ?? [];
  const imageProgress = imageProgressLabel(scenes.length, imageAssets.length, snapshotStepStatus(snapshot, 4));
  const [rerunningStepAction, setRerunningStepAction] = useState<string | null>(null);
  const artifactAction = useAsyncAction();
  const canRerunStep = !isBrowserPreview && task.status !== 'running' && task.status !== 'pending' && Boolean(task.artifactStatePath);

  async function rerunArtifactStep(step: number, mode: TaskStepRerunMode) {
    const key = `${step}:${mode}`;
    await artifactAction.run(async () => {
      setRerunningStepAction(key);
      try {
        applyState(await api.rerunTaskStep(task.id, step, mode));
      } finally {
        setRerunningStepAction(null);
      }
    });
  }

  async function openArtifactOutput() {
    await artifactAction.run(() => api.openTaskOutputDirectory(task.id));
  }

  const artifactStepActions = (step: number) => (
    <ArtifactStepActions
      step={step}
      disabled={!canRerunStep}
      regenerating={rerunningStepAction === `${step}:regenerate`}
      rewriting={rerunningStepAction === `${step}:rewrite`}
      onAction={rerunArtifactStep}
    />
  );

  return (
    <div className="artifact-preview">
      <div className="artifact-preview-head">
        <div className="preview-empty-icon">{task.status === 'running' ? <Loader2 className="spin" size={22} /> : <Database size={22} />}</div>
        <div>
          <strong>{artifactPanelTitle(task, tab)}</strong>
          {latestEvent?.type === 'step_error' ? <ErrorSummaryButton fullMessage={latestEvent.detail} title="流水线错误" /> : <span>{snapshot?.message || latestEvent?.detail || '等待当前步骤产物落盘'}</span>}
        </div>
        {task.status === 'completed' && task.outputDir ? (
          <button className="ghost-action" disabled={artifactAction.busy} onClick={openArtifactOutput}>
            <FolderOpen size={15} />
            打开剪映草稿
          </button>
        ) : null}
      </div>
      <InlineActionFeedback feedback={artifactAction.feedback} />

      <div className="preview-meta-grid">
        <div><small>任务</small><strong>{task.title || '未命名任务'}</strong></div>
        <div><small>状态</small><strong>{statusLabel(task.status)}</strong></div>
        <div><small>当前代理</small><strong>{currentAgent}</strong></div>
        <div><small>图片进度</small><strong>{imageProgress}</strong></div>
        <div><small>产物更新时间</small><strong>{snapshot?.updatedAt ? formatDate(snapshot.updatedAt) : '等待生成'}</strong></div>
        <div><small>输出目录</small><strong>{task.outputDir || '等待生成'}</strong></div>
        <div><small>失败步骤</small><strong>{task.failedStep ?? '-'}</strong></div>
        <div><small>状态文件</small><strong>{task.artifactStatePath || '等待生成'}</strong></div>
        <div><small>最近心跳</small><strong>{task.lastHeartbeatAt ? formatDate(task.lastHeartbeatAt) : '等待运行'}</strong></div>
        <div><small>恢复步骤</small><strong>{task.retryFromStep ?? '-'}</strong></div>
      </div>

      {tab === 'preview' ? (
        <div className="artifact-section-stack">
          <ArtifactSection title="AI 搜索资料" badge={`${sourceContext?.sections.length ?? 0} 条`} actions={artifactStepActions(0)}>
            {sourceContext?.sections.length ? (
              <div className="artifact-source-list">
                {sourceContext.sections.map((source, index) => (
                  <div key={`${source.title}-${index}`}>
                    <strong>{source.title}</strong>
                    {source.url ? <span>{source.url}</span> : null}
                    <p>{trimForPreview(source.content || source.snippet || '', 260)}</p>
                  </div>
                ))}
              </div>
            ) : <ArtifactEmpty text="等待 AI 创作搜索资料" />}
          </ArtifactSection>

          <ArtifactSection title="文案预审" badge={`${countChars(artifact.reviewedText)} 字`} actions={artifactStepActions(0)}>
            <ArtifactText value={artifact.reviewedText} empty="等待文案预审产物" />
          </ArtifactSection>

          <ArtifactSection title="改写产物" badge={`${countChars(artifact.rewrittenCopy)} 字`} actions={artifactStepActions(1)}>
            <ArtifactText value={artifact.rewrittenCopy} empty="等待改写产物" />
          </ArtifactSection>

          <ArtifactSection title="封面信息" badge={artifact.cover?.title || '等待生成'} actions={artifactStepActions(1)}>
            {artifact.cover ? (
              <div className="artifact-cover-grid">
                <div><small>标题</small><strong>{artifact.cover.title}</strong></div>
                <div><small>副标题</small><strong>{artifact.cover.subtitle.join(' / ') || '-'}</strong></div>
                <div><small>摘要</small><p>{artifact.cover.summary || '-'}</p></div>
                <div><small>标签</small><p>{artifact.cover.tags.join(' ') || '-'}</p></div>
                <div><small>种子评论</small><p>{artifact.cover.comments.join(' / ') || '-'}</p></div>
              </div>
            ) : <ArtifactEmpty text="等待封面标题、摘要、标签和评论" />}
          </ArtifactSection>

          <ArtifactSection title="分镜分句" badge={`${scenes.length} 条`} actions={artifactStepActions(2)}>
            <ArtifactSceneList scenes={scenes} imagePrompts={imagePrompts} images={imageAssets} />
          </ArtifactSection>

          <ArtifactSection title="绘图提示词" badge={`${imagePrompts.length} 条`} actions={artifactStepActions(3)}>
            <ArtifactPromptList prompts={imagePrompts} />
          </ArtifactSection>

          <ArtifactSection title="批量生图" badge={`${imageAssets.length} 张`} actions={artifactStepActions(4)}>
            <ImageGenerationGallery
              api={api}
              task={task}
              scenes={scenes}
              imagePrompts={imagePrompts}
              images={imageAssets}
              imageErrors={imageErrors}
              concurrency={activeImageConcurrency(config)}
              isBrowserPreview={isBrowserPreview}
              applyState={applyState}
            />
          </ArtifactSection>

          <ArtifactSection title="配音字幕" badge={`${narrationAssets.length} 段 / ${subtitles?.cues.length ?? 0} 条字幕`} actions={artifactStepActions(5)}>
            <NarrationPreviewList
              api={api}
              task={task}
              scenes={scenes}
              subtitles={subtitles}
              assets={narrationAssets}
              empty="等待配音生成"
              isBrowserPreview={isBrowserPreview}
              applyState={applyState}
            />
            {subtitles?.srt ? <pre className="artifact-text-block compact">{trimForPreview(subtitles.srt, 900)}</pre> : null}
          </ArtifactSection>

          <ArtifactSection title="草稿输出" badge={snapshot?.draft ? '已生成' : '等待生成'} actions={artifactStepActions(6)}>
            {snapshot?.draft ? (
              <div className="artifact-path-list">
                <span>{snapshot.draft.draftDir}</span>
                <span>{snapshot.draft.draftContentPath}</span>
                <span>{snapshot.draft.draftMetaPath}</span>
              </div>
            ) : <ArtifactEmpty text="等待剪映草稿目录" />}
          </ArtifactSection>
        </div>
      ) : null}

      {tab === 'storyboard' ? (
        <div className="artifact-section-stack">
          <ArtifactSection title="批量生图" badge={`${imageAssets.length} 张`}>
            <ImageGenerationGallery
              api={api}
              task={task}
              scenes={scenes}
              imagePrompts={imagePrompts}
              images={imageAssets}
              imageErrors={imageErrors}
              concurrency={activeImageConcurrency(config)}
              isBrowserPreview={isBrowserPreview}
              applyState={applyState}
            />
          </ArtifactSection>
          <ArtifactSection title="分镜分句" badge={`${scenes.length} 条`}>
            <ArtifactSceneList scenes={scenes} imagePrompts={imagePrompts} images={imageAssets} />
          </ArtifactSection>
        </div>
      ) : null}

      {tab === 'audio' ? (
        <div className="artifact-section-stack">
          <ArtifactSection title="配音字幕" badge={`${narrationAssets.length} 段 / ${subtitles?.cues.length ?? 0} 条字幕`}>
            <NarrationPreviewList
              api={api}
              task={task}
              scenes={scenes}
              subtitles={subtitles}
              assets={narrationAssets}
              empty="等待配音生成"
              isBrowserPreview={isBrowserPreview}
              applyState={applyState}
            />
            {subtitles?.cues.length ? (
              <div className="artifact-scene-list">
                {subtitles.cues.map((cue) => (
                  <div key={cue.index}>
                    <strong>{cue.index}. {formatMs(cue.startMs)} - {formatMs(cue.endMs)}</strong>
                    <p>{cue.text}</p>
                  </div>
                ))}
              </div>
            ) : <ArtifactEmpty text="等待字幕时间轴" />}
          </ArtifactSection>
        </div>
      ) : null}
    </div>
  );
}

function ArtifactSection({ title, badge, actions, children }: { title: string; badge: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="artifact-section">
      <div className="panel-title-row">
        <h3>{title}</h3>
        <div className="artifact-section-actions">
          {actions}
          <small>{badge}</small>
        </div>
      </div>
      {children}
    </section>
  );
}

function ArtifactStepActions({
  step,
  disabled,
  regenerating,
  rewriting,
  onAction,
}: {
  step: number;
  disabled: boolean;
  regenerating: boolean;
  rewriting: boolean;
  onAction: (step: number, mode: TaskStepRerunMode) => void;
}) {
  const busy = regenerating || rewriting;
  return (
    <div className="artifact-step-action-buttons">
      <button className="mini-button" disabled={disabled || busy} title="从本步骤重新生成，并继续执行后续步骤" onClick={() => onAction(step, 'regenerate')}>
        {regenerating ? <Loader2 className="spin" size={14} /> : <RotateCcw size={14} />}
        重新生成
      </button>
      <button className="mini-button" disabled={disabled || busy} title="参考当前产物改写本步骤，并继续执行后续步骤" onClick={() => onAction(step, 'rewrite')}>
        {rewriting ? <Loader2 className="spin" size={14} /> : <Wand2 size={14} />}
        改写后继续
      </button>
    </div>
  );
}

function ArtifactText({ value, empty }: { value?: string; empty: string }) {
  return value ? <pre className="artifact-text-block">{value}</pre> : <ArtifactEmpty text={empty} />;
}

function ArtifactEmpty({ text }: { text: string }) {
  return <div className="artifact-empty">{text}</div>;
}

function ArtifactSceneList({
  scenes,
  imagePrompts,
  images,
}: {
  scenes: NonNullable<TaskArtifactSnapshot['artifact']['scenes']>;
  imagePrompts: NonNullable<TaskArtifactSnapshot['artifact']['imagePrompts']>;
  images: TaskArtifactSnapshot['assets']['images'];
}) {
  if (scenes.length === 0) return <ArtifactEmpty text="等待分镜生成" />;
  return (
    <div className="artifact-scene-list">
      {scenes.map((scene) => {
        const prompt = imagePrompts.find((item) => item.sceneId === scene.id);
        const image = images.find((item) => item.sceneId === scene.id);
        return (
          <div key={scene.id}>
            <strong>{scene.id}. {scene.cap}</strong>
            <p>{scene.descPrompt}</p>
            {prompt ? <small>Prompt: {trimForPreview(prompt.prompt, 220)}</small> : null}
            {image ? <span>{image.path}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function ArtifactPromptList({ prompts }: { prompts: NonNullable<TaskArtifactSnapshot['artifact']['imagePrompts']> }) {
  if (prompts.length === 0) return <ArtifactEmpty text="等待绘图提示词" />;
  return (
    <div className="artifact-scene-list">
      {prompts.map((prompt) => (
        <div key={prompt.sceneId}>
          <strong>{prompt.sceneId}. {prompt.cap}</strong>
          <p>{prompt.prompt}</p>
          <small>负面：{prompt.negativePrompt || '-'}</small>
        </div>
      ))}
    </div>
  );
}

function ImageGenerationGallery({
  api,
  task,
  scenes,
  imagePrompts,
  images,
  imageErrors,
  concurrency,
  isBrowserPreview,
  applyState,
}: {
  api: StoryDreamApi;
  task: Task;
  scenes: NonNullable<TaskArtifactSnapshot['artifact']['scenes']>;
  imagePrompts: NonNullable<TaskArtifactSnapshot['artifact']['imagePrompts']>;
  images: TaskArtifactSnapshot['assets']['images'];
  imageErrors: TaskArtifactSnapshot['assets']['imageErrors'];
  concurrency: number;
  isBrowserPreview: boolean;
  applyState: ApplyMutationResult;
}) {
  const [imagePreviewUrls, setImagePreviewUrls] = useState<Record<string, string>>({});
  const [imagePreviewErrors, setImagePreviewErrors] = useState<Record<string, string>>({});
  const [regeneratingSceneId, setRegeneratingSceneId] = useState<number | null>(null);
  const [editingPromptSceneId, setEditingPromptSceneId] = useState<number | null>(null);
  const [editingPromptText, setEditingPromptText] = useState('');
  const [savingPromptSceneId, setSavingPromptSceneId] = useState<number | null>(null);
  const imageGenerationAction = useAsyncAction();
  const imagePaths = images.map((asset) => asset.path).join('|');
  const imageBySceneId = useMemo(() => new Map(images.map((asset) => [asset.sceneId, asset] as const)), [images]);
  const promptBySceneId = useMemo(() => new Map(imagePrompts.map((prompt) => [prompt.sceneId, prompt] as const)), [imagePrompts]);
  const imageErrorBySceneId = useMemo(() => new Map(imageErrors.map((item) => [item.sceneId, item] as const)), [imageErrors]);

  useEffect(() => {
    if (isBrowserPreview || images.length === 0) {
      setImagePreviewUrls({});
      setImagePreviewErrors({});
      return undefined;
    }
    let cancelled = false;
    const validPaths = new Set(images.map((asset) => asset.path));
    setImagePreviewUrls((current) => Object.fromEntries(Object.entries(current).filter(([path]) => validPaths.has(path))));
    setImagePreviewErrors((current) => Object.fromEntries(Object.entries(current).filter(([path]) => validPaths.has(path))));

    for (const asset of images) {
      api.readAssetDataUrl(asset.path)
        .then((dataUrl) => {
          if (!cancelled) {
            setImagePreviewUrls((current) => ({ ...current, [asset.path]: dataUrl }));
          }
        })
        .catch((error) => {
          if (!cancelled) {
            const normalized = imageGenerationAction.reportError(error);
            setImagePreviewErrors((current) => ({ ...current, [asset.path]: normalized.message }));
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [api, imageGenerationAction.reportError, imagePaths, isBrowserPreview]);

  async function regenerate(sceneId: number) {
    await imageGenerationAction.run(async () => {
      setRegeneratingSceneId(sceneId);
      try {
        applyState(await api.regenerateTaskImage(task.id, sceneId));
      } finally {
        setRegeneratingSceneId(null);
      }
    });
  }

  function openPromptEditor(sceneId: number, promptText: string) {
    setEditingPromptSceneId(sceneId);
    setEditingPromptText(promptText);
  }

  function cancelPromptEdit() {
    setEditingPromptSceneId(null);
    setEditingPromptText('');
  }

  async function savePrompt(sceneId: number) {
    const nextPrompt = editingPromptText.trim();
    if (!nextPrompt) return;
    await imageGenerationAction.run(async () => {
      setSavingPromptSceneId(sceneId);
      try {
        applyState(await api.updateTaskImagePrompt(task.id, sceneId, nextPrompt));
        cancelPromptEdit();
      } finally {
        setSavingPromptSceneId(null);
      }
    });
  }

  if (scenes.length === 0) return <ArtifactEmpty text="等待分镜后生成图片" />;

  return (
    <div className="image-generation-gallery">
      <div className="image-generation-toolbar">
        <span>并发数 {concurrency}</span>
        <span>{images.length}/{scenes.length} 张已落盘</span>
      </div>
      <InlineActionFeedback feedback={imageGenerationAction.feedback} />
      <div className="image-preview-grid">
        {scenes.map((scene) => {
          const image = imageBySceneId.get(scene.id);
          const prompt = promptBySceneId.get(scene.id);
          const imageError = imageErrorBySceneId.get(scene.id);
          const previewUrl = image ? imagePreviewUrls[image.path] : '';
          const previewError = image ? imagePreviewErrors[image.path] : '';
          const cardState = image ? 'ready' : imageError ? 'failed' : 'pending';
          const statusText = image ? '已生成' : imageError ? '生成失败' : task.status === 'running' ? '等待/生成中' : '未生成';
          const promptText = prompt?.prompt ?? scene.descPrompt;
          const isEditingPrompt = editingPromptSceneId === scene.id;
          const isSavingPrompt = savingPromptSceneId === scene.id;
          const editDisabled = isBrowserPreview || task.status === 'running' || task.status === 'pending' || !prompt || isSavingPrompt;
          return (
            <article className={`image-preview-card ${cardState}`} key={scene.id}>
              <div className="image-thumb">
                {previewUrl ? <img src={previewUrl} alt={`Scene ${scene.id}`} /> : null}
                {!previewUrl && image && !previewError ? <span className="thumb-state">读取中</span> : null}
                {!previewUrl && previewError ? <span className="thumb-state danger">读取失败</span> : null}
                {!image && imageError ? <XCircle size={24} /> : null}
                {!image && !imageError ? <ImageIcon size={24} /> : null}
              </div>
              <div className="image-preview-body">
                <div className="image-preview-title">
                  <strong>{scene.id}. {scene.cap}</strong>
                  <span>{statusText}</span>
                </div>
                <p>{trimForPreview(promptText, 180)}</p>
                {image ? <small>{image.path}</small> : <small>等待 provider 返回真实图片</small>}
                {imageError ? <div className="artifact-image-error" title={imageError.message}>{summarizeErrorMessage(imageError.message)}</div> : null}
                {previewError ? <small className="danger-text">{previewError}</small> : null}
              </div>
              <div className="image-preview-actions">
                <button
                  className="mini-button"
                  disabled={isBrowserPreview || task.status === 'running' || task.status === 'pending' || (!image && !imageError) || regeneratingSceneId === scene.id}
                  onClick={() => regenerate(scene.id)}
                >
                  {regeneratingSceneId === scene.id ? <Loader2 className="spin" size={14} /> : <RotateCcw size={14} />}
                  重新生成
                </button>
                <button className="mini-button" disabled={editDisabled} onClick={() => openPromptEditor(scene.id, promptText)}>
                  <Pencil size={14} />
                  修改提示词
                </button>
                {isEditingPrompt ? (
                  <div className="image-prompt-editor">
                    <textarea value={editingPromptText} disabled={isSavingPrompt} onChange={(event) => setEditingPromptText(event.target.value)} />
                    <div className="image-prompt-editor-actions">
                      <button className="mini-button" disabled={isSavingPrompt || !editingPromptText.trim()} onClick={() => savePrompt(scene.id)}>
                        {isSavingPrompt ? <Loader2 className="spin" size={14} /> : <Save size={14} />}
                        保存提示词
                      </button>
                      <button className="mini-button" disabled={isSavingPrompt} onClick={cancelPromptEdit}>
                        <X size={14} />
                        取消
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function NarrationPreviewList({
  api,
  task,
  scenes,
  subtitles,
  assets,
  empty,
  isBrowserPreview,
  applyState,
}: {
  api: StoryDreamApi;
  task: Task;
  scenes: NonNullable<TaskArtifactSnapshot['artifact']['scenes']>;
  subtitles: TaskArtifactSnapshot['artifact']['subtitles'];
  assets: TaskArtifactSnapshot['assets']['narration'];
  empty: string;
  isBrowserPreview: boolean;
  applyState: ApplyMutationResult;
}) {
  const [audioPreviewUrls, setAudioPreviewUrls] = useState<Record<string, string>>({});
  const [audioPreviewErrors, setAudioPreviewErrors] = useState<Record<string, string>>({});
  const [regeneratingSceneId, setRegeneratingSceneId] = useState<number | null>(null);
  const narrationAction = useAsyncAction();
  const audioPaths = assets.map((asset) => asset.path).join('|');

  useEffect(() => {
    if (isBrowserPreview || assets.length === 0) {
      setAudioPreviewUrls({});
      setAudioPreviewErrors({});
      return undefined;
    }
    let cancelled = false;
    const validPaths = new Set(assets.map((asset) => asset.path));
    setAudioPreviewUrls((current) => Object.fromEntries(Object.entries(current).filter(([path]) => validPaths.has(path))));
    setAudioPreviewErrors((current) => Object.fromEntries(Object.entries(current).filter(([path]) => validPaths.has(path))));

    for (const asset of assets) {
      api.readAssetDataUrl(asset.path)
        .then((dataUrl) => {
          if (!cancelled) {
            setAudioPreviewUrls((current) => ({ ...current, [asset.path]: dataUrl }));
          }
        })
        .catch((error) => {
          if (!cancelled) {
            const normalized = narrationAction.reportError(error);
            setAudioPreviewErrors((current) => ({ ...current, [asset.path]: normalized.message }));
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [api, assets, audioPaths, isBrowserPreview, narrationAction.reportError]);

  async function regenerate(sceneId: number) {
    await narrationAction.run(async () => {
      setRegeneratingSceneId(sceneId);
      try {
        applyState(await api.regenerateTaskNarration(task.id, sceneId));
      } finally {
        setRegeneratingSceneId(null);
      }
    });
  }

  const sceneIds = new Set(scenes.map((scene) => scene.id));
  const rows = scenes.length
    ? [
        ...scenes.map((scene, index) => ({
          sceneId: scene.id,
          cap: scene.cap,
          cue: subtitles?.cues[index],
          assets: assets.filter((item) => item.sceneId === scene.id).sort(compareNarrationPreviewAssets),
          canRegenerate: true,
        })),
        ...assets.filter((asset) => !sceneIds.has(asset.sceneId)).map((asset) => ({
          sceneId: asset.sceneId,
          cap: '已生成配音',
          cue: undefined,
          assets: [asset],
          canRegenerate: false,
        })),
      ]
    : assets.map((asset) => ({
        sceneId: asset.sceneId,
        cap: '已生成配音',
        cue: undefined,
        assets: [asset],
        canRegenerate: false,
      }));

  if (rows.length === 0) return <ArtifactEmpty text={empty} />;

  return (
    <div className="narration-preview-list">
      <InlineActionFeedback feedback={narrationAction.feedback} />
      {rows.map((item) => {
        const disabled = isBrowserPreview || task.status === 'running' || task.status === 'pending' || regeneratingSceneId === item.sceneId || !item.canRegenerate;
        const ready = item.assets.length > 0;
        return (
          <article className={`narration-preview-card ${ready ? 'ready' : 'pending'}`} key={`${item.sceneId}-${item.assets.map((asset) => asset.path).join('|') || 'pending'}`}>
            <div className="narration-preview-head">
              <div>
                <strong>{item.sceneId}. {item.cap}</strong>
                {item.cue ? <span>{formatMs(item.cue.startMs)} - {formatMs(item.cue.endMs)}</span> : null}
              </div>
              <span>{ready ? `${item.assets.length} 段可试听` : task.status === 'running' ? '等待/生成中' : '未生成'}</span>
            </div>
            {item.assets.map((asset, index) => {
              const previewUrl = audioPreviewUrls[asset.path] ?? '';
              const previewError = audioPreviewErrors[asset.path] ?? '';
              return (
                <div className="narration-turn-preview" key={`${asset.path}-${asset.turnIndex ?? index}`}>
                  <strong>{narrationTurnLabel(asset, index)}</strong>
                  {previewUrl ? <audio controls className="narration-player" preload="metadata" src={previewUrl} /> : null}
                  {!previewUrl && !previewError ? <div className="narration-player loading">读取音频中</div> : null}
                  {!previewUrl && previewError ? <div className="narration-player error">音频读取失败</div> : null}
                  {asset.text ? <p>{asset.text}</p> : null}
                  <small>{asset.path}</small>
                  {previewError ? <small className="danger-text">{previewError}</small> : null}
                </div>
              );
            })}
            {!ready ? <div className="narration-player loading">等待音频落盘</div> : null}
            {item.cue ? <p>{item.cue.text}</p> : null}
            {!ready ? <small>等待 TTS 返回真实音频</small> : null}
            <button className="mini-button" disabled={disabled} onClick={() => regenerate(item.sceneId)}>
              {regeneratingSceneId === item.sceneId ? <Loader2 className="spin" size={14} /> : <RotateCcw size={14} />}
              {ready ? '重新生成配音' : '生成配音'}
            </button>
          </article>
        );
      })}
    </div>
  );
}

function compareNarrationPreviewAssets(a: TaskArtifactSnapshot['assets']['narration'][number], b: TaskArtifactSnapshot['assets']['narration'][number]): number {
  const aTurn = a.turnIndex ?? Number.MAX_SAFE_INTEGER;
  const bTurn = b.turnIndex ?? Number.MAX_SAFE_INTEGER;
  if (aTurn !== bTurn) return aTurn - bTurn;
  return a.path.localeCompare(b.path);
}

function narrationTurnLabel(asset: TaskArtifactSnapshot['assets']['narration'][number], index: number): string {
  const speaker = asset.speaker ? `主播 ${asset.speaker}` : '配音';
  const turn = asset.turnIndex ?? index + 1;
  return `${speaker} · 第 ${turn} 段`;
}

function ArtifactImageGallery({
  assets,
  scenes,
  empty,
}: {
  assets: TaskArtifactSnapshot['assets']['images'];
  scenes: NonNullable<TaskArtifactSnapshot['artifact']['scenes']>;
  empty: string;
}) {
  const sceneIds = new Set(scenes.map((scene) => scene.id));
  const galleryItems = scenes.length
    ? [
        ...scenes.map((scene) => ({ sceneId: scene.id, cap: scene.cap, asset: assets.find((item) => item.sceneId === scene.id) })),
        ...assets.filter((asset) => !sceneIds.has(asset.sceneId)).map((asset) => ({ sceneId: asset.sceneId, cap: '已生成图片', asset })),
      ]
    : assets.map((asset) => ({ sceneId: asset.sceneId, cap: '已生成图片', asset }));
  if (galleryItems.length === 0) return <ArtifactEmpty text={empty} />;
  return (
    <div className="artifact-image-gallery">
      {galleryItems.map((item) => {
        const imagePath = item.asset?.path ?? '';
        return (
          <figure className={imagePath ? 'artifact-image-card' : 'artifact-image-card pending'} key={`${item.sceneId}-${imagePath || 'pending'}`}>
            {imagePath ? (
              <img src={toLocalImageUrl(imagePath)} alt={`分镜 ${item.sceneId}: ${item.cap}`} loading="lazy" />
            ) : (
              <div className="artifact-image-pending">
                <ImageIcon size={22} />
                <span>等待生成</span>
              </div>
            )}
            <figcaption>
              <strong>{item.sceneId}. {item.cap}</strong>
              <span>{imagePath || '等待生成'}</span>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

function ArtifactAssetList({ assets, empty }: { assets: TaskArtifactSnapshot['assets']['images']; empty: string }) {
  if (assets.length === 0) return <ArtifactEmpty text={empty} />;
  return (
    <div className="artifact-path-list">
      {assets.map((asset) => <span key={`${asset.sceneId}-${asset.path}`}>{asset.sceneId}. {asset.path}</span>)}
    </div>
  );
}

function ImageLabPage({ api, state, applyState }: { api: StoryDreamApi; state: AppState; applyState: ApplyMutationResult }) {
  const [tab, setTab] = useState<'smart' | 'text' | 'reference'>('smart');
  const [smartMode] = useState<ImageLabSmartMode>('podcast-cover');
  const [prompt, setPrompt] = useState('根据食谱内容，规划 2-3 张美食教程图，合成品图、灵魂文案、制作步骤，保持参考图主体和质感。');
  const [ratio, setRatio] = useState('9:16');
  const [style, setStyle] = useState('photo-real');
  const [resolution, setResolution] = useState<ImageResolution>('1K');
  const [referenceImagePath, setReferenceImagePath] = useState('');
  const [referencePasteDraft, setReferencePasteDraft] = useState('');
  const [imageLabOutputCount, setImageLabOutputCount] = useState(3);
  const [generating, setGenerating] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [expandedReferenceImage, setExpandedReferenceImage] = useState('');
  const imageLabAction = useAsyncAction();
  const referenceLimit = 10;
  const referenceCandidates = parseReferenceImagePaths(referenceImagePath);
  const references = referenceCandidates.slice(0, referenceLimit);
  const hiddenReferenceCount = Math.max(0, referenceCandidates.length - references.length);
  const referenceModeDescription = tab === 'smart'
    ? '智能规划多张图，可带参考图；适合根据需求批量出教程图、封面和分镜图。'
    : tab === 'reference'
      ? '参考图编辑/延展，需要先添加参考图；适合保留主体、材质和画面一致性。'
      : '纯文本生成单张图，不使用参考图。';
  const baseSmartMode: ImageLabSmartMode = tab === 'smart' ? smartMode : tab === 'reference' ? 'reference-edit' : 'text-to-image';
  const imageLabRatioChoices = [
    ['21:9', '宽屏'],
    ['16:9', '横屏'],
    ['3:2', '标准横'],
    ['4:3', '标准'],
    ['1:1', '方形'],
    ['3:4', '标准竖'],
    ['2:3', '竖图'],
    ['9:16', '竖屏'],
  ];
  const estimatedCost = resolution === '1K' ? '0.08' : resolution === '2K' ? '0.16' : '0.32';
  const resolvedSmartMode = resolveImageLabSmartMode(tab, baseSmartMode, references);

  async function selectImageLabReferenceImage() {
    await imageLabAction.run(async () => {
      const imagePath = await api.selectLocalImage();
      if (!imagePath) return;
      setReferenceImagePath((current) => [...parseReferenceImagePaths(current), imagePath].join('\n'));
    });
  }

  function removeReferenceImagePath(reference: string) {
    setReferenceImagePath((current) => parseReferenceImagePaths(current).filter((item) => item !== reference).join('\n'));
    if (expandedReferenceImage === reference) {
      setExpandedReferenceImage('');
    }
  }

  function appendReferenceImagePaths(value: string) {
    const nextPaths = parseReferenceImagePaths(value);
    if (!nextPaths.length) return;
    setReferenceImagePath((current) => {
      const merged = [...parseReferenceImagePaths(current), ...nextPaths];
      return Array.from(new Set(merged)).join('\n');
    });
  }

  async function addRecord() {
    if (generating) return;
    await imageLabAction.run(async () => {
      setGenerating(true);
      setSubmitError('');
      try {
        const requestedCount = tab === 'text' ? 1 : Math.max(1, Math.min(10, imageLabOutputCount));
        let nextState: AppMutationResult | null = null;
        for (let index = 0; index < requestedCount; index += 1) {
          nextState = await api.generateImageLab({
            prompt,
            ratio,
            style,
            resolution,
            smartMode: resolvedSmartMode,
            referenceImagePath: references[0] ?? '',
            referenceImagePaths: references,
          });
        }
        applyState(nextState);
      } finally {
        setGenerating(false);
      }
    }, { onError: (error) => setSubmitError(error.message) });
  }

  return (
    <div className="image-lab-page">
      <section className="panel image-lab-workbench">
        <Segmented label="模式" value={tab} options={['smart', 'text', 'reference']} labels={['智慧生图', '文生图', '图像参考']} onChange={(value) => setTab(value as 'smart' | 'text' | 'reference')} />
        <div className="image-lab-mode-note">{referenceModeDescription}</div>
        {tab !== 'text' ? (
          <div className="image-lab-reference-block">
            <div className="image-lab-section-head">
              <strong>参考图</strong>
              <small>建议统一 IP 形象，最多 {referenceLimit} 张 · 已选 {references.length}</small>
            </div>
            <div className="image-lab-dropzone">
              <button className="image-lab-upload-card" type="button" onClick={selectImageLabReferenceImage}>
                <ImageIcon size={18} />
                添加
              </button>
              <span>
                <strong>选择或粘贴本地图片路径作为参考</strong>
                <small>支持 PNG / JPG / WEBP，每行一张，最多 {referenceLimit} 张会参与生成</small>
              </span>
            </div>
            <textarea
              className="reference-image-list"
              value={referencePasteDraft}
              placeholder="粘贴本地图片路径，每行一张；粘贴后下方只显示缩略图"
              onPaste={(event) => {
                event.preventDefault();
                appendReferenceImagePaths(event.clipboardData.getData('text'));
                setReferencePasteDraft('');
              }}
              onChange={(event) => setReferencePasteDraft(event.target.value)}
              onBlur={() => {
                appendReferenceImagePaths(referencePasteDraft);
                setReferencePasteDraft('');
              }}
            />
            <div className="image-lab-reference-list" aria-live="polite">
              {references.length ? (
                <div className="image-lab-reference-grid">
                  {references.map((reference, index) => (
                    <article className="image-lab-reference-thumb" key={`${reference}-${index}`}>
                      <button type="button" className="image-lab-reference-image" onClick={() => setExpandedReferenceImage(reference)} aria-label={`放大参考图 ${index + 1}`}>
                        <img src={toLocalImageUrl(reference)} alt={`参考图 ${index + 1}`} loading="lazy" />
                      </button>
                      <div className="image-lab-reference-actions">
                        <button type="button" className="mini-button" onClick={() => setExpandedReferenceImage(reference)}>放大</button>
                        <button type="button" className="mini-button" onClick={() => removeReferenceImagePath(reference)}>删除</button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : <span className="image-lab-reference-empty">暂未添加参考图路径</span>}
              {hiddenReferenceCount > 0 ? <span className="image-lab-reference-overflow">已忽略超出上限的 {hiddenReferenceCount} 张</span> : null}
            </div>
          </div>
        ) : null}
        <Field label="需求描述">
          <textarea className="prompt-box image-lab-prompt" value={prompt} placeholder="例如：根据食谱内容，规划 2-3 张美食教程图，合成品图、灵魂文案、制作步骤，不要点赞元素" onChange={(event) => setPrompt(event.target.value)} />
        </Field>
        {tab !== 'text' ? (
          <div className="image-lab-slider">
            <div className="image-lab-section-head">
              <strong>出图数量上限</strong>
              <small>普通上限设为 10 张</small>
            </div>
            <input type="range" min={1} max={10} step={1} value={imageLabOutputCount} onChange={(event) => setImageLabOutputCount(Number(event.target.value))} />
            <strong>{imageLabOutputCount} 张</strong>
            <small>AI 会读懂需求，规划成最多 10 张图；每张图文案需进图里。</small>
          </div>
        ) : null}
        <div className="image-lab-control-group">
          <div className="image-lab-section-head">
            <strong>比例</strong>
            <small>可多选体验保留为单选，已选 {ratio}</small>
          </div>
          <div className="image-lab-ratio-grid">
            {imageLabRatioChoices.map(([value, label]) => (
              <button key={value} className={ratio === value ? 'selected' : ''} onClick={() => setRatio(value)} type="button">
                <span className={`ratio-icon ratio-${value.replace(':', '-')}`} />
                <strong>{value}</strong>
                <small>{label}</small>
              </button>
            ))}
          </div>
        </div>
        <OptionCloud title="风格" options={styleOptions} value={style} onChange={setStyle} />
        <Segmented label="分辨率" value={resolution} options={['1K', '2K', '4K']} onChange={(value) => setResolution(value as ImageResolution)} />
        <div className="image-lab-footer">
          <button className="primary-action" onClick={addRecord} disabled={generating || !prompt.trim() || (resolvedSmartMode === 'reference-edit' && references.length === 0)}>
            {generating ? <Loader2 className="spin" size={17} /> : <Wand2 size={17} />}
            {generating ? '生成中' : '智能生成'}
          </button>
          <div className="provider-line">当前 Provider：<strong>{state.config.imageProvider}</strong> · {smartImageModeLabel(resolvedSmartMode)} · 预计消耗 ￥{estimatedCost}</div>
        </div>
        {submitError ? <ErrorSummaryButton compact title="画图实验室提交失败" fullMessage={submitError} /> : null}
        <InlineActionFeedback feedback={imageLabAction.feedback} />
      </section>
      {expandedReferenceImage ? (
        <div className="error-dialog-backdrop" onClick={() => setExpandedReferenceImage('')}>
          <section className="error-dialog image-lab-preview-dialog" role="dialog" aria-modal="true" aria-label="参考图预览" onClick={(event) => event.stopPropagation()}>
            <div className="error-dialog-head">
              <strong>参考图预览</strong>
              <button className="mini-button" type="button" onClick={() => setExpandedReferenceImage('')}>关闭</button>
            </div>
            <img src={toLocalImageUrl(expandedReferenceImage)} alt="参考图预览" />
          </section>
        </div>
      ) : null}
      <section className="image-lab-recent">
        <h3>最近生成 · {state.imageLabRecords.length}</h3>
        {state.imageLabRecords.length === 0 ? <EmptyState title="暂无画图记录" /> : null}
        <div className="image-grid-panel">
          {state.imageLabRecords.map((record) => (
          <article className={`image-record ${record.status}`} key={record.id}>
            <div className="lab-image-preview">
              {record.imagePath ? <img src={toLocalImageUrl(record.imagePath)} alt={record.prompt} loading="lazy" /> : (
                <>
                  <ImageIcon size={28} />
                  <span>{record.status === 'failed' ? '生成失败' : '等待图片'}</span>
                </>
              )}
            </div>
            <strong>{record.prompt}</strong>
            <small>{record.provider} · {record.ratio} · {record.resolution} · {smartImageModeLabel(record.smartMode)} · {formatDate(record.createdAt)}</small>
            {record.errorMessage ? <ErrorSummaryButton compact title="生图失败" fullMessage={record.errorMessage} /> : null}
          </article>
          ))}
        </div>
      </section>
    </div>
  );

}

function VoiceLabPage({ api, state, applyState }: { api: StoryDreamApi; state: AppState; applyState: ApplyMutationResult }) {
  const [text, setText] = useState('配音实验室试听文案：用稳定、清晰、有情绪的声音讲完这一段故事。');
  const [voiceProvider, setVoiceProvider] = useState<RuntimeTtsProvider>(() => normalizeRuntimeTtsProvider(state.config.tts.provider));
  const [voiceId, setVoiceId] = useState(() => defaultTaskSpeakerForProvider(state.config.tts.provider, state.config));
  const [voiceSpeed, setVoiceSpeed] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const voiceLabAction = useAsyncAction();
  const voiceOptions = ttsVoiceOptionsForProvider(voiceProvider);
  const selectedVoiceLabel = taskSpeakerLabel(voiceProvider, voiceId);

  useEffect(() => {
    const options = ttsVoiceOptionsForProvider(voiceProvider);
    if (!options.some((option) => option.id === voiceId)) {
      setVoiceId(defaultTaskSpeakerForProvider(voiceProvider, state.config));
    }
  }, [state.config, voiceId, voiceProvider]);

  function changeProvider(provider: string) {
    const nextProvider = normalizeRuntimeTtsProvider(provider);
    setVoiceProvider(nextProvider);
    setVoiceId(defaultTaskSpeakerForProvider(nextProvider, state.config));
  }

  async function generatePreview() {
    if (generating || !text.trim()) return;
    await voiceLabAction.run(async () => {
      setGenerating(true);
      setSubmitError('');
      try {
        const next = await api.generateVoiceLabPreview({
          text,
          provider: voiceProvider,
          voiceId,
          voiceLabel: selectedVoiceLabel,
          speed: voiceSpeed,
        });
        applyState(next);
      } finally {
        setGenerating(false);
      }
    }, { onError: (error) => setSubmitError(error.message) });
  }

  return (
    <div className="voice-lab-layout lab-layout">
      <section className="panel">
        <Field label="试听文案">
          <textarea className="prompt-box voice-lab-text" value={text} onChange={(event) => setText(event.target.value)} />
        </Field>
        <Segmented label="配音模型" value={voiceProvider} options={['volcengine', 'minimax']} labels={['豆包', 'MiniMax']} onChange={changeProvider} />
        <div className="voice-lab-voices">
          <span className="field-title">音色</span>
          <div className="chip-row">
            {voiceOptions.map((voice) => (
              <button key={voice.id} className={voiceId === voice.id ? 'chip active' : 'chip'} title={voice.id} onClick={() => setVoiceId(voice.id)}>
                <strong>{voice.label}</strong>
                <small>{voice.hint}</small>
              </button>
            ))}
          </div>
        </div>
        <Segmented label="语速" value={String(voiceSpeed)} options={['0.85', '1', '1.15', '1.3']} labels={['慢速 0.85x', '默认 1.0x', '快速 1.15x', '更快 1.3x']} onChange={(value) => setVoiceSpeed(Number(value))} />
        <div className="provider-line">当前音色：{selectedVoiceLabel} · {voiceId}</div>
        {submitError ? <ErrorSummaryButton compact title="配音实验室提交失败" fullMessage={submitError} /> : null}
        <InlineActionFeedback feedback={voiceLabAction.feedback} />
        <button className="primary-action" onClick={generatePreview} disabled={generating || !text.trim()}>
          {generating ? <Loader2 className="spin" size={17} /> : <Mic2 size={17} />}
          {generating ? '生成中' : '生成试听'}
        </button>
      </section>
      <section className="panel voice-lab-history">
        <div className="panel-title-row">
          <div>
            <h2>历史试听</h2>
            <span className="hint-text">{state.voiceLabRecords.length} 条本地记录</span>
          </div>
        </div>
        {state.voiceLabRecords.length === 0 ? <EmptyState title="暂无配音试听" /> : null}
        {state.voiceLabRecords.map((record) => (
          <article className={`voice-record ${record.status}`} key={record.id}>
            <div className="voice-record-head">
              <strong>{record.voiceLabel}</strong>
              <small>{record.provider} · {record.speed}x · {formatDate(record.createdAt)}</small>
            </div>
            <p>{record.text}</p>
            {record.audioPath ? <audio className="voice-lab-player" controls preload="metadata" src={toLocalAssetUrl(record.audioPath)} /> : null}
            {!record.audioPath && record.status === 'failed' ? <div className="voice-lab-player error">未生成音频</div> : null}
            {record.errorMessage ? <ErrorSummaryButton compact title="配音失败" fullMessage={record.errorMessage} /> : null}
            {record.audioPath ? <small>{record.audioPath}</small> : null}
          </article>
        ))}
      </section>
    </div>
  );
}

function PromptTemplatesPage({ api, state, applyState }: { api: StoryDreamApi; state: AppState; applyState: ApplyMutationResult }) {
  const [selectedId, setSelectedId] = useState(state.promptTemplates[0]?.id ?? '');
  const [templateMode, setTemplateMode] = useState<'gallery' | 'detail' | 'image-detail'>('gallery');
  const [promptTemplateLibraryTab, setPromptTemplateLibraryTab] = useState<'story' | 'image'>('story');
  const [templateTypeFilter, setTemplateTypeFilter] = useState<PromptTemplateType | 'all'>('all');
  const [templateTrackFilter, setTemplateTrackFilter] = useState('all');
  const [selectedImageStyleId, setSelectedImageStyleId] = useState(state.customStyles[0]?.id ?? defaultCustomStyles[0]?.id ?? '');
  const [imageDraft, setImageDraft] = useState<CustomStyle | null>(state.customStyles[0] ? { ...state.customStyles[0] } : null);
  const [imageTemplateAiPrompt, setImageTemplateAiPrompt] = useState('');
  const [imageTemplateAiStatus, setImageTemplateAiStatus] = useState('');
  const [imageTemplateAiGenerating, setImageTemplateAiGenerating] = useState(false);
  const [baseImageTemplateId, setBaseImageTemplateId] = useState(state.customStyles[0]?.id ?? defaultCustomStyles[0]?.id ?? '');
  const filteredTemplates = state.promptTemplates.filter((template) => {
    const typeMatches = templateTypeFilter === 'all' || template.type === templateTypeFilter;
    const trackMatches = templateTrackFilter === 'all' || template.baseTrack === templateTrackFilter;
    return typeMatches && trackMatches;
  });
  const selected = state.promptTemplates.find((template) => template.id === selectedId) ?? filteredTemplates[0] ?? state.promptTemplates[0];
  const selectedImageStyle = state.customStyles.find((style) => style.id === selectedImageStyleId) ?? state.customStyles[0] ?? defaultCustomStyles[0];
  const [draft, setDraft] = useState<PromptTemplate | null>(selected ? { ...selected } : null);
  const [templateJsonDraft, setTemplateJsonDraft] = useState('');
  const [imageTemplateJsonDraft, setImageTemplateJsonDraft] = useState('');
  const promptTemplateAction = useAsyncAction();
  const promptDetailGeneration = useRef(0);
  const promptTemplateTrackOptions = buildStoryTemplateTrackOptions(state.promptTemplates);
  const promptTemplateBindingTrackOptions =
    draft?.baseTrack && !promptTemplateTrackOptions.some(([id]) => id === draft.baseTrack)
      ? [...promptTemplateTrackOptions, [draft.baseTrack, draft.baseTrack, '当前模板赛道'] as [string, string, string]]
      : promptTemplateTrackOptions;

  useEffect(() => setDraft(selected ? { ...selected } : null), [selected?.id]);
  useEffect(() => setImageDraft(selectedImageStyle ? { ...selectedImageStyle } : null), [selectedImageStyle?.id]);

  function openPromptTemplateDetail(template: PromptTemplate) {
    const generation = ++promptDetailGeneration.current;
    setSelectedId(template.id);
    setDraft({ ...template });
    setTemplateJsonDraft('');
    setTemplateMode('detail');
    void promptTemplateAction.run(async () => {
      const detail = await api.getPromptTemplateDetail(template.id);
      if (generation === promptDetailGeneration.current && detail) setDraft({ ...detail });
    });
  }

  function openImageTemplateDetail(style: CustomStyle) {
    setSelectedImageStyleId(style.id);
    setImageDraft({ ...style });
    setBaseImageTemplateId(style.id);
    setImageTemplateAiStatus('');
    setTemplateMode('image-detail');
  }

  function handlePromptTemplateRowKeyDown(event: React.KeyboardEvent<HTMLElement>, template: PromptTemplate) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openPromptTemplateDetail(template);
  }

  async function savePromptTemplateDraft() {
    if (!draft) return;
    const shouldForkTemplate = Boolean(draft.isBuiltin);
    const templateToSave: PromptTemplate = {
      ...independentPromptTemplateFields(draft),
      id: shouldForkTemplate ? crypto.randomUUID() : draft.id,
      isBuiltin: false,
      origin: 'custom',
      updatedAt: new Date().toISOString(),
    };
    await promptTemplateAction.run(async () => {
      applyState(await api.savePromptTemplate(templateToSave));
      setSelectedId(templateToSave.id);
      setDraft(templateToSave);
      setTemplateMode('detail');
    });
  }

  async function duplicateTemplate(template: PromptTemplate) {
    const copy = { ...independentPromptTemplateFields(template), id: crypto.randomUUID(), name: `${template.name} 副本`, isBuiltin: false, origin: 'custom' as const };
    await promptTemplateAction.run(async () => {
      applyState(await api.savePromptTemplate(copy));
      setSelectedId(copy.id);
      setDraft(copy);
      setTemplateJsonDraft('');
      setTemplateMode('detail');
    });
  }

  async function duplicate() {
    if (!draft) return;
    await duplicateTemplate(draft);
  }

  async function createPromptTemplate() {
    const baseTrack = templateTrackFilter === 'all' ? 'general-story' : templateTrackFilter;
    const template: PromptTemplate = {
      id: crypto.randomUUID(),
      name: '新建模板',
      type: 'task',
      description: '本地自定义提示词模板',
      content: '请基于 {{inputText}} 生成适合 {{track}} 的短视频内容。',
      isBuiltin: false,
      updatedAt: new Date().toISOString(),
      baseTrack,
      defaultStyles: ['photo-real'],
      defaultDraftTemplateId: state.draftTemplates[0]?.id ?? 'default-portrait-9-16',
      characterPolicy: 'follow-template',
      step3SkeletonModules: ['防台词文字'],
      referenceKind: 'none',
      origin: 'custom',
      marketTags: [],
    };
    await promptTemplateAction.run(async () => {
      applyState(await api.savePromptTemplate(template));
      setSelectedId(template.id);
      setDraft(template);
      setTemplateJsonDraft('');
      setTemplateMode('detail');
    });
  }

  async function saveCustomStyleDraft() {
    if (!imageDraft) return;
    const now = new Date().toISOString();
    const styleToSave = { ...imageDraft, updatedAt: now, createdAt: imageDraft.createdAt || now };
    await promptTemplateAction.run(async () => {
      applyState(await api.saveCustomStyle(styleToSave));
      setSelectedImageStyleId(styleToSave.id);
      setImageDraft(styleToSave);
      setImageTemplateAiStatus('已保存图像模板。');
      setTemplateMode('image-detail');
    });
  }

  async function duplicateImageTemplate(style: CustomStyle) {
    const now = new Date().toISOString();
    const copy = { ...style, id: crypto.randomUUID(), name: `${style.name} 副本`, createdAt: now, updatedAt: now };
    await promptTemplateAction.run(async () => {
      applyState(await api.saveCustomStyle(copy));
      setSelectedImageStyleId(copy.id);
      setImageDraft(copy);
      setImageTemplateAiStatus('已克隆图像模板。');
      setTemplateMode('image-detail');
    });
  }

  async function createImageTemplate() {
    const base = state.customStyles.find((style) => style.id === baseImageTemplateId) ?? state.customStyles[0] ?? defaultCustomStyles[0];
    const now = new Date().toISOString();
    const template: CustomStyle = {
      ...base,
      id: crypto.randomUUID(),
      name: '新建图像模板',
      tag: '自定义风格',
      shortName: '自定义',
      createdAt: now,
      updatedAt: now,
    };
    await promptTemplateAction.run(async () => {
      applyState(await api.saveCustomStyle(template));
      setSelectedImageStyleId(template.id);
      setImageDraft(template);
      setImageTemplateAiStatus('');
      setTemplateMode('image-detail');
    });
  }

  function applyBaseImageTemplate() {
    if (!imageDraft) return;
    const base = state.customStyles.find((style) => style.id === baseImageTemplateId) ?? defaultCustomStyles.find((style) => style.id === baseImageTemplateId);
    if (!base) return;
    setImageDraft({
      ...imageDraft,
      tag: base.tag,
      shortName: base.shortName,
      prefix: base.prefix,
      suffix: base.suffix,
      negativePrompt: base.negativePrompt,
      allowColor: base.allowColor,
      description: base.description,
    });
    setImageTemplateAiStatus(`已套用系统风格：${base.name}`);
  }

  async function fillImageTemplateFromAiPrompt() {
    if (!imageDraft) return;
    const prompt = imageTemplateAiPrompt.trim();
    if (!prompt) {
      setImageTemplateAiStatus('请先输入风格描述。');
      return;
    }
    const base = state.customStyles.find((style) => style.id === baseImageTemplateId) ?? defaultCustomStyles.find((style) => style.id === baseImageTemplateId);
    await promptTemplateAction.run(async () => {
      setImageTemplateAiGenerating(true);
      setImageTemplateAiStatus('正在生成字段...');
      try {
        const generated = await api.generateCustomStyleDraft({ prompt, baseStyle: base ?? imageDraft });
        setImageDraft({ ...imageDraft, ...generated, id: imageDraft.id, createdAt: imageDraft.createdAt });
        setImageTemplateAiStatus(`已生成字段：${generated.name || prompt}`);
      } finally {
        setImageTemplateAiGenerating(false);
      }
    }, { onError: (error) => setImageTemplateAiStatus(`生成失败：${error.message}`) });
  }

  function exportPromptTemplateJson() {
    if (!draft) return;
    const json = JSON.stringify(draft, null, 2);
    setTemplateJsonDraft(json);
    void navigator.clipboard?.writeText(json).catch(() => undefined);
  }

  function exportImageTemplateJson() {
    if (!imageDraft) return;
    const json = JSON.stringify(imageDraft, null, 2);
    setImageTemplateJsonDraft(json);
    void navigator.clipboard?.writeText(json).catch(() => undefined);
  }

  function resolveImportedTemplateId(imported: { id?: string }, exists: boolean): string {
    return imported.id && !exists ? imported.id : crypto.randomUUID();
  }

  async function importPromptTemplateJson() {
    await promptTemplateAction.run(async () => {
      const imported = JSON.parse(templateJsonDraft) as PromptTemplate;
      const id = resolveImportedTemplateId(imported, state.promptTemplates.some((template) => template.id === imported.id));
      const next = { ...imported, id, isBuiltin: false, origin: 'custom' as const, updatedAt: new Date().toISOString() };
      applyState(await api.savePromptTemplate(next));
      setSelectedId(next.id);
      setDraft(next);
      setTemplateMode('detail');
      setTemplateJsonDraft('');
    }, { onError: () => setTemplateJsonDraft('{"name":"自定义模板","type":"task","description":"请补充","content":"请补充提示词"}') });
  }

  async function importImageTemplateJson() {
    await promptTemplateAction.run(async () => {
      const imported = JSON.parse(imageTemplateJsonDraft) as CustomStyle;
      const now = new Date().toISOString();
      const id = resolveImportedTemplateId(imported, state.customStyles.some((style) => style.id === imported.id));
      const next: CustomStyle = {
        ...imported,
        id,
        createdAt: imported.createdAt || now,
        updatedAt: now,
      };
      applyState(await api.saveCustomStyle(next));
      setSelectedImageStyleId(next.id);
      setImageDraft(next);
      setTemplateMode('image-detail');
      setImageTemplateJsonDraft('');
    }, { onError: () => setImageTemplateJsonDraft('{"name":"自定义图像模板","tag":"自定义","shortName":"自定义","prefix":"请补充","suffix":"请补充","negativePrompt":"请补充","allowColor":true,"description":"请补充"}') });
  }

  async function resetPromptTemplateLibrary() {
    await promptTemplateAction.run(async () => {
      applyState(await api.resetPromptTemplates());
    });
  }

  function updatePromptTemplateStepPrompt(type: PromptStepTemplateType, content: string) {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        stepPrompts: {
          ...(current.stepPrompts ?? {}),
          [type]: content,
        },
      };
    });
  }

  function resetPromptTemplateStepPrompt(type: PromptStepTemplateType) {
    setDraft((current) => {
      if (!current?.stepPrompts) return current;
      const nextStepPrompts = { ...current.stepPrompts };
      delete nextStepPrompts[type];
      return {
        ...current,
        stepPrompts: Object.keys(nextStepPrompts).length > 0 ? nextStepPrompts : undefined,
      };
    });
  }

  if (templateMode === 'gallery') {
    return (
      <div className="prompt-template-gallery">
        <div className="panel-title-row prompt-template-gallery-toolbar">
          <div>
            <h2>提示词模板</h2>
            <p>故事模板决定 AI 怎么写，图像模板决定画面怎么长。先浏览模板，点开后查看和编辑细节。</p>
          </div>
          <div className="button-row">
            <button className="ghost-action" disabled={promptTemplateAction.busy} onClick={resetPromptTemplateLibrary}>
              <RotateCcw size={14} />
              重置
            </button>
            <button className="primary-action slim" onClick={promptTemplateLibraryTab === 'story' ? createPromptTemplate : createImageTemplate}>
              <Plus size={14} />
              新建模板
            </button>
          </div>
        </div>
        <InlineActionFeedback feedback={promptTemplateAction.feedback} />
        <div className="prompt-template-tabs" role="tablist" aria-label="提示词模板类型">
          <button className={promptTemplateLibraryTab === 'story' ? 'chip active' : 'chip'} type="button" onClick={() => setPromptTemplateLibraryTab('story')}>故事模板</button>
          <button className={promptTemplateLibraryTab === 'image' ? 'chip active' : 'chip'} type="button" onClick={() => setPromptTemplateLibraryTab('image')}>图像模板</button>
        </div>
        {promptTemplateLibraryTab === 'story' ? (
          <>
            <div className="template-filter-row">
              <Field label="类型筛选">
                <select value={templateTypeFilter} onChange={(event) => setTemplateTypeFilter(event.target.value as PromptTemplateType | 'all')}>
                  {promptTemplateTypeOptions.map((type) => <option key={type} value={type}>{promptTemplateTypeLabel(type)}</option>)}
                </select>
              </Field>
              <Field label="赛道筛选">
                <select value={templateTrackFilter} onChange={(event) => setTemplateTrackFilter(event.target.value)}>
                  <option value="all">全部赛道</option>
                  {promptTemplateTrackOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </Field>
            </div>
            <section className="prompt-template-list story-template-gallery">
              <div className="prompt-template-list-title">
                <strong>故事模板（{filteredTemplates.filter((template) => template.type === 'task').length}）</strong>
                <span>{filteredTemplates.length} 个匹配模板</span>
              </div>
              {filteredTemplates.length > 0 ? filteredTemplates.map((template) => (
                <article
                  className="prompt-template-row"
                  key={template.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openPromptTemplateDetail(template)}
                  onKeyDown={(event) => handlePromptTemplateRowKeyDown(event, template)}
                >
                  <Sparkles size={18} />
                  <div className="prompt-template-row-main">
                    <strong>{template.name}</strong>
                    <span>{template.description}</span>
                    <small>默认图像模板：{promptTemplateStyleLabelList(template, state.customStyles).join('、') || '未设置'} · id: {template.id}</small>
                  </div>
                  <div className="prompt-template-row-actions">
                    <button className="ghost-action compact-action" onClick={(event) => { event.stopPropagation(); openPromptTemplateDetail(template); }}>
                      查看
                    </button>
                    <button className="ghost-action compact-action" onClick={(event) => { event.stopPropagation(); void duplicateTemplate(template); }}>
                      <Copy size={14} />
                      克隆
                    </button>
                  </div>
                </article>
              )) : <EmptyState title="暂无匹配模板" />}
            </section>
          </>
        ) : (
          <section className="prompt-template-list image-template-gallery">
            <div className="prompt-template-list-title">
              <strong>图像模板（{state.customStyles.length}）</strong>
              <span>管理 prefix、suffix、负面提示词和色彩模式</span>
            </div>
            {state.customStyles.map((style) => (
              <article
                className="prompt-template-row"
                key={style.id}
                role="button"
                tabIndex={0}
                onClick={() => openImageTemplateDetail(style)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openImageTemplateDetail(style);
                  }
                }}
              >
                <Palette size={18} />
                <div className="prompt-template-row-main">
                  <strong>{style.name}</strong>
                  <span>{style.description}</span>
                  <small>{style.tag} · {style.allowColor ? '彩色' : '黑白 / 单色'} · id: {style.id}</small>
                </div>
                <div className="prompt-template-row-actions">
                  <button className="ghost-action compact-action" onClick={(event) => { event.stopPropagation(); openImageTemplateDetail(style); }}>
                    查看
                  </button>
                  <button className="ghost-action compact-action" onClick={(event) => { event.stopPropagation(); void duplicateImageTemplate(style); }}>
                    <Copy size={14} />
                    克隆
                  </button>
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
    );
  }

  if (templateMode === 'image-detail') {
    return (
      <div className="prompt-template-detail">
        <section className="panel editor-panel">
          <InlineActionFeedback feedback={promptTemplateAction.feedback} />
          {imageDraft ? (
            <>
              <div className="panel-title-row prompt-template-detail-title">
                <div>
                  <button className="ghost-action compact-action" onClick={() => setTemplateMode('gallery')}>返回模板库</button>
                  <h2>查看图像模板 · {imageDraft.name}</h2>
                </div>
                <div className="button-row">
                  <button className="ghost-action" onClick={() => void duplicateImageTemplate(imageDraft)}>
                    <Copy size={15} />
                    克隆
                  </button>
                  <button className="ghost-action" onClick={exportImageTemplateJson}>
                    <FileJson size={15} />
                    导出 JSON
                  </button>
                  <button className="ghost-action" onClick={() => void importImageTemplateJson()}>
                    <FileJson size={15} />
                    导入 JSON
                  </button>
                  <button className="primary-action slim" onClick={saveCustomStyleDraft}>
                    <Save size={15} />
                    保存
                  </button>
                </div>
              </div>
              <div className="prompt-template-detail-stack">
                <section className="image-template-quick-card">
                  <div>
                    <span className="field-title">AI 快速生成</span>
                    <span className="hint-text">输入自然语言描述，自动填充下方图像模板字段。</span>
                  </div>
                  <Field label="风格描述">
                    <textarea className="small-textarea" value={imageTemplateAiPrompt} onChange={(event) => setImageTemplateAiPrompt(event.target.value)} placeholder="例如：赛博朋克雨夜街道，霓虹光影，未来都市" />
                  </Field>
                  <div className="template-meta-grid">
                    <Field label="基于系统风格">
                      <select value={baseImageTemplateId} onChange={(event) => setBaseImageTemplateId(event.target.value)}>
                        {state.customStyles.map((style) => <option key={style.id} value={style.id}>{style.name}</option>)}
                      </select>
                    </Field>
                    <div className="button-row image-template-quick-actions">
                      <button className="ghost-action" type="button" onClick={applyBaseImageTemplate}>套用系统风格</button>
                      <button className="primary-action slim" type="button" disabled={imageTemplateAiGenerating} onClick={() => void fillImageTemplateFromAiPrompt()}>
                        {imageTemplateAiGenerating ? '生成中...' : '生成字段'}
                      </button>
                    </div>
                  </div>
                  {imageTemplateAiStatus ? <div className="image-template-ai-status" aria-live="polite">{imageTemplateAiStatus}</div> : null}
                </section>

                <section className="prompt-template-settings-card">
                  <span className="field-title">手动填写字段</span>
                  <div className="image-template-field-grid">
                    <Field label="名称">
                      <input value={imageDraft.name} onChange={(event) => setImageDraft({ ...imageDraft, name: event.target.value })} />
                    </Field>
                    <Field label="标签">
                      <input value={imageDraft.tag} onChange={(event) => setImageDraft({ ...imageDraft, tag: event.target.value })} />
                    </Field>
                    <Field label="简称">
                      <input value={imageDraft.shortName} onChange={(event) => setImageDraft({ ...imageDraft, shortName: event.target.value })} />
                    </Field>
                    <Field label="色彩模式">
                      <select value={imageDraft.allowColor ? 'color' : 'mono'} onChange={(event) => setImageDraft({ ...imageDraft, allowColor: event.target.value === 'color' })}>
                        <option value="color">彩色</option>
                        <option value="mono">黑白 / 单色</option>
                      </select>
                    </Field>
                  </div>
                  <Field label="前缀（prefix）">
                    <textarea className="small-textarea" value={imageDraft.prefix} onChange={(event) => setImageDraft({ ...imageDraft, prefix: event.target.value })} />
                  </Field>
                  <Field label="后缀（suffix）">
                    <textarea className="small-textarea" value={imageDraft.suffix} onChange={(event) => setImageDraft({ ...imageDraft, suffix: event.target.value })} />
                  </Field>
                  <Field label="负面提示词（negativePrompt）">
                    <textarea className="small-textarea" value={imageDraft.negativePrompt} onChange={(event) => setImageDraft({ ...imageDraft, negativePrompt: event.target.value })} />
                  </Field>
                  <Field label="适用场景描述">
                    <textarea className="small-textarea" value={imageDraft.description} onChange={(event) => setImageDraft({ ...imageDraft, description: event.target.value })} />
                  </Field>
                </section>
                <Field label="导入 / 导出 JSON">
                  <textarea className="small-textarea" value={imageTemplateJsonDraft} onChange={(event) => setImageTemplateJsonDraft(event.target.value)} placeholder="导出后会填入这里；也可粘贴图像模板 JSON 后点击导入 JSON" />
                </Field>
              </div>
            </>
          ) : (
            <EmptyState title="暂无图像模板" />
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="prompt-template-detail">
      <section className="panel editor-panel">
        <InlineActionFeedback feedback={promptTemplateAction.feedback} />
        {draft ? (
          <>
            <div className="panel-title-row prompt-template-detail-title">
              <div>
                <button className="ghost-action compact-action" onClick={() => setTemplateMode('gallery')}>返回模板库</button>
                <h2>查看系统模板 · {draft.name}</h2>
              </div>
              <div className="button-row">
                <button className="ghost-action" onClick={duplicate}>
                  <Copy size={15} />
                  克隆
                </button>
                <button className="ghost-action" onClick={exportPromptTemplateJson}>
                  <FileJson size={15} />
                  导出 JSON
                </button>
                <button className="ghost-action" onClick={() => void importPromptTemplateJson()}>
                  <FileJson size={15} />
                  导入 JSON
                </button>
                <button className="primary-action slim" onClick={savePromptTemplateDraft}>
                  <Save size={15} />
                  {draft.isBuiltin ? '保存为自定义模板' : '保存修改'}
                </button>
              </div>
            </div>
            <div className="prompt-template-detail-stack">
              <section className="prompt-template-basics-card">
                <div className="template-meta-grid prompt-template-basics-grid">
                  <Field label="模板名">
                    <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                  </Field>
                  <Field label="描述（一句话说明这个模板的特点）">
                    <input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
                  </Field>
                  <Field label="模板类型">
                    <select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as PromptTemplateType })}>
                      {promptTemplateTypeOptions.filter((type) => type !== 'all').map((type) => <option key={type} value={type}>{promptTemplateTypeLabel(type)}</option>)}
                    </select>
                  </Field>
                  <Field label="绑定赛道">
                    <select value={draft.baseTrack ?? ''} onChange={(event) => setDraft({ ...draft, baseTrack: event.target.value || undefined })}>
                      <option value="">无</option>
                      {promptTemplateBindingTrackOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="prompt-template-default-style-pills">
                  <span className="field-title">默认画风</span>
                  <div className="chip-row">
                    {promptTemplateStyleOptions(state.customStyles, draft).map((style) => (
                      <button
                        className={resolvePromptTemplateDefaultStyleId(draft, state.customStyles.map((customStyle) => customStyle.id)) === style.id ? 'chip active' : 'chip'}
                        type="button"
                        key={style.id}
                        onClick={() => setDraft({ ...draft, defaultStyles: [style.id] })}
                      >
                        {style.name}
                      </button>
                    ))}
                  </div>
                </div>
                {draft.type === 'task' ? (
                  <div className="prompt-template-default-style-pills">
                    <span className="field-title">默认草稿模板</span>
                    <div className="chip-row">
                      {state.draftTemplates.map((template) => (
                        <button
                          className={(draft.defaultDraftTemplateId ?? 'default-portrait-9-16') === template.id ? 'chip active' : 'chip'}
                          type="button"
                          key={template.id}
                          onClick={() => setDraft({ ...draft, defaultDraftTemplateId: template.id })}
                        >
                          {template.name}
                        </button>
                      ))}
                    </div>
                    <small>新建任务选择赛道后，会同步草稿模板，并把 AI 出图比例同步为该草稿的图片比例。</small>
                  </div>
                ) : null}
              </section>

              <section className="prompt-template-settings-card">
                <span className="field-title">设置内容</span>
                <div className="prompt-template-content-settings">
                  <div className="prompt-template-setting-block">
                    <strong>主角档案</strong>
                    <div className="chip-row">
                      {(['follow-template', 'force-extract', 'force-skip'] as const).map((policy) => (
                        <button className={draft.characterPolicy === policy ? 'chip active' : 'chip'} type="button" key={policy} onClick={() => setDraft({ ...draft, characterPolicy: policy })}>
                          {policy === 'force-extract' ? '强制提取' : policy === 'force-skip' ? '强制跳过' : '跟随赛道'}
                        </button>
                      ))}
                    </div>
                    <small>主角档案会影响 Step 3 是否保持人物身份、外貌、年代和叙事一致。</small>
                  </div>
                  <div className="prompt-template-setting-block">
                    <strong>Step 3 骨架模块（可选线路）</strong>
                    <div className="chip-row">
                      {promptTemplateStep3SkeletonOptions.map((module) => (
                        <button
                          className={(draft.step3SkeletonModules ?? []).includes(module) ? 'chip active' : 'chip'}
                          type="button"
                          key={module}
                          onClick={() => setDraft({ ...draft, step3SkeletonModules: toggleArray(draft.step3SkeletonModules ?? [], module) })}
                        >
                          {module}
                        </button>
                      ))}
                    </div>
                    <small>勾选后 AI 助手会按用途生成对应骨架，已保存的 Step 3 prompt 文本不会自动改变。</small>
                  </div>
                  <div className="prompt-template-setting-block">
                    <strong>参考图类型</strong>
                    <div className="chip-row">
                      {promptTemplateReferenceOptions.map(([value, label]) => (
                        <button className={(draft.referenceKind ?? 'none') === value ? 'chip active' : 'chip'} type="button" key={value} onClick={() => setDraft({ ...draft, referenceKind: value })}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <small>上传参考图时，Step 3 会按这里的类型决定人脸或产品一致性要求。</small>
                  </div>
                </div>
                <div className="prompt-template-advanced-grid">
                  <Field label="标签">
                    <input value={(draft.marketTags ?? []).join('、')} onChange={(event) => setDraft({ ...draft, marketTags: splitListInput(event.target.value) })} />
                  </Field>
                  {draft.type === 'task' ? (
                    <Field label="出图种子池 JSON">
                      <textarea
                        className="small-textarea prompt-template-seed-pools"
                        value={draft.imageSeedPoolsJson ?? ''}
                        onChange={(event) => setDraft({ ...draft, imageSeedPoolsJson: event.target.value })}
                        placeholder='{"scenes":["close-up","wide shot"],"moods":["warm","dramatic"]}'
                      />
                    </Field>
                  ) : null}
                </div>
              </section>

              <span className="local-note">{draft.isBuiltin ? '系统模板保存后会生成自定义副本，原系统模板保持不变。' : '自定义模板保存会更新当前模板，历史任务和已绑定配置会继续使用这个模板。'}</span>

              {draft.type === 'task' ? (
                <section className="prompt-step-editor-list" aria-label="AI 步骤设置">
                  <div className="prompt-step-editor-heading">
                    <span className="field-title prompt-step-editor-section-title">步骤默认提示词</span>
                  </div>
                  <article className="prompt-step-editor-card" key="task-template-content">
                    <div className="prompt-step-editor-card-header">
                      <div>
                        <strong>任务总指令</strong>
                        <small>定义当前任务模板的整体目标、赛道语气和内容边界</small>
                      </div>
                    </div>
                    <PromptVariablePicker scope="task" value={draft.content} onChange={(value) => setDraft({ ...draft, content: value })} />
                    <VariableAwareTextarea
                      className="template-textarea prompt-step-editor-textarea"
                      value={draft.content}
                      onChange={(value) => setDraft({ ...draft, content: value })}
                      placeholder="输入 // 选择变量"
                      variables={promptTemplateVariablesForScope('task')}
                    />
                  </article>
                  {promptStepEditorDefinitions.map((step) => {
                    const hasOverride = promptTemplateHasStepPrompt(draft, step.type);
                    return (
                      <article className="prompt-step-editor-card" key={step.type}>
                        <div className="prompt-step-editor-card-header">
                          <div>
                            <strong>{step.label}</strong>
                            <small>{step.hint}</small>
                          </div>
                          <button className="ghost-action compact-action" type="button" disabled={!hasOverride} onClick={() => resetPromptTemplateStepPrompt(step.type)}>
                            继承全局
                          </button>
                        </div>
                        {(step.type === 'review' || step.type === 'rewrite') ? (
                          <PromptVariablePicker
                            scope={step.type}
                            value={promptTemplateStepPromptValue(draft, state.promptTemplates, step.type)}
                            onChange={(value) => updatePromptTemplateStepPrompt(step.type, value)}
                          />
                        ) : null}
                        <VariableAwareTextarea
                          className="template-textarea prompt-step-editor-textarea"
                          value={promptTemplateStepPromptValue(draft, state.promptTemplates, step.type)}
                          onChange={(value) => updatePromptTemplateStepPrompt(step.type, value)}
                          placeholder="输入 // 选择变量"
                          variables={promptTemplateVariablesForScope(step.type)}
                        />
                      </article>
                    );
                  })}
                </section>
              ) : (
                <section className="prompt-template-settings-card">
                  <div className="prompt-template-section-heading">
                    <span className="field-title">提示词内容</span>
                  </div>
                  <PromptVariablePicker scope={draft.type} value={draft.content} onChange={(value) => setDraft({ ...draft, content: value })} />
                  <VariableAwareTextarea
                    className="template-textarea"
                    value={draft.content}
                    onChange={(value) => setDraft({ ...draft, content: value })}
                    placeholder="输入 // 选择变量"
                    variables={promptTemplateVariablesForScope(draft.type)}
                  />
                </section>
              )}
            </div>
            <Field label="导入 / 导出 JSON">
              <textarea className="small-textarea" value={templateJsonDraft} onChange={(event) => setTemplateJsonDraft(event.target.value)} placeholder="导出后会填入这里；也可粘贴故事模板 JSON 后点击导入 JSON" />
            </Field>
          </>
        ) : (
          <EmptyState title="暂无模板" />
        )}
      </section>
    </div>
  );
}

function insertPromptVariable(value: string, key: string, cursor: number): { value: string; cursor: number } {
  const token = `{{${key}}}`;
  const before = value.slice(0, cursor);
  const after = value.slice(cursor);
  const triggerIndex = before.lastIndexOf('//');
  if (triggerIndex >= 0 && before.slice(triggerIndex).trim() === '//') {
    const nextValue = `${value.slice(0, triggerIndex)}${token}${after}`;
    return { value: nextValue, cursor: triggerIndex + token.length };
  }
  const prefix = before.endsWith(' ') || before.endsWith('\n') || before.length === 0 ? '' : ' ';
  const nextValue = `${before}${prefix}${token}${after}`;
  return { value: nextValue, cursor: before.length + prefix.length + token.length };
}

function promptTemplateVariablesForScope(scope: PromptTemplateVariableScope) {
  return promptTemplateVariableDefinitions.filter((item) => item.scopes.includes(scope));
}

function appendPromptVariable(value: string, key: string): string {
  return insertPromptVariable(value, key, value.length).value;
}

function PromptVariablePicker({
  scope,
  value,
  onChange,
}: {
  scope: PromptTemplateVariableScope;
  value: string;
  onChange: (value: string) => void;
}) {
  const variables = promptTemplateVariablesForScope(scope);
  return (
    <>
      <span className="field-title">变量</span>
      <span className="hint-text">点击插入当前步骤可用变量；每个提示词输入框也可输入 // 选择变量。</span>
      <div className="variable-chip-row">{variables.map((item) => (
        <button
          className="chip prompt-template-variable-chip"
          type="button"
          key={item.key}
          title={`插入 {{${item.key}}}: ${item.description}`}
          onClick={() => onChange(appendPromptVariable(value, item.key))}
        >
          <span>{item.label}</span>
          <code className="prompt-variable-token">{`{{${item.key}}}`}</code>
          <small>{item.description}</small>
        </button>
      ))}</div>
    </>
  );
}

function VariableAwareTextarea({
  value,
  onChange,
  className,
  placeholder,
  variables,
}: {
  value: string;
  onChange: (value: string) => void;
  className: string;
  placeholder?: string;
  variables: typeof promptTemplateVariableDefinitions;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);

  function syncSuggestState(nextValue: string, cursor: number | null) {
    const beforeCursor = nextValue.slice(0, cursor ?? nextValue.length);
    setSuggestOpen(beforeCursor.endsWith('//'));
  }

  function onVariableInsert(key: string) {
    const cursor = textareaRef.current?.selectionStart ?? value.length;
    const next = insertPromptVariable(value, key, cursor);
    onChange(next.value);
    setSuggestOpen(false);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(next.cursor, next.cursor);
    });
  }

  return (
    <div className="prompt-variable-editor">
      <textarea
        ref={textareaRef}
        className={className}
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
          syncSuggestState(event.target.value, event.target.selectionStart);
        }}
        onKeyUp={(event) => syncSuggestState(event.currentTarget.value, event.currentTarget.selectionStart)}
        onClick={(event) => syncSuggestState(event.currentTarget.value, event.currentTarget.selectionStart)}
      />
      {suggestOpen ? (
        <div className="prompt-variable-suggest">
          {variables.map((item) => (
            <button type="button" key={item.key} onMouseDown={(event) => event.preventDefault()} onClick={() => onVariableInsert(item.key)}>
              <span>{item.label}</span>
              <code>{`{{${item.key}}}`}</code>
              <small>英文变量 · {item.description}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DraftTemplatesPage({ api, state, applyState }: { api: StoryDreamApi; state: AppState; applyState: ApplyMutationResult }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingTemplate = editingId ? state.draftTemplates.find((template) => template.id === editingId) ?? null : null;
  const [draft, setDraft] = useState<DraftTemplate | null>(null);
  const [selectedLayer, setSelectedLayer] = useState<DraftCanvasLayer>('title');
  const [effectCatalog, setEffectCatalog] = useState<JianyingEffectCatalog>(fallbackEffectCatalog);
  const [cozeWorkflowSource, setCozeWorkflowSource] = useState('');
  const [cozeImportName, setCozeImportName] = useState('');
  const [cozeImportResult, setCozeImportResult] = useState<Extract<CozeWorkflowTemplateConversionResult, { ok: true }> | null>(null);
  const [cozeImportResults, setCozeImportResults] = useState<CozeWorkflowTemplateConversionResult[]>([]);
  const [cozeImportError, setCozeImportError] = useState('');
  const [cozeImportOpen, setCozeImportOpen] = useState(false);
  const draftTemplateAction = useAsyncAction();
  const draftDetailGeneration = useRef(0);

  useEffect(() => {
    // Rehydrate only when switching templates; state refreshes must not overwrite unsaved drag edits.
    const currentEditingTemplate = state.draftTemplates.find((template) => template.id === editingId) ?? null;
    setDraft(currentEditingTemplate ? cloneDraftTemplate(currentEditingTemplate) : null);
  }, [editingId]);

  useEffect(() => {
    let disposed = false;
    api
      .getJianyingEffectCatalog()
      .then((catalog) => {
        if (!disposed) setEffectCatalog(catalog);
      })
      .catch((error) => {
        if (!disposed) {
          setEffectCatalog(fallbackEffectCatalog);
          draftTemplateAction.reportError(error);
        }
      });
    return () => {
      disposed = true;
    };
  }, [api, draftTemplateAction.reportError]);

  useEffect(() => {
    if (!draft || isDraftLayerVisible(draft, selectedLayer)) return;
    setSelectedLayer(firstVisibleDraftLayer(draft));
  }, [draft, selectedLayer]);

  async function save() {
    if (!draft) return;
    await draftTemplateAction.run(async () => {
      applyState(await api.saveDraftTemplate(draft));
    });
  }

  async function copyTemplate(template: DraftTemplate) {
    await draftTemplateAction.run(async () => {
      const detail = await api.getDraftTemplateDetail(template.id) ?? template;
      const copy = { ...cloneDraftTemplate(detail), id: crypto.randomUUID(), name: `${detail.name} 副本`, isDefault: false };
      applyState(await api.saveDraftTemplate(copy));
      setEditingId(copy.id);
    });
  }

  async function createTemplate() {
    const base = cloneDraftTemplate(builtinDraftTemplates[0]);
    const next = { ...base, id: crypto.randomUUID(), name: '新模板', isDefault: false };
    await draftTemplateAction.run(async () => {
      applyState(await api.saveDraftTemplate(next));
      setEditingId(next.id);
    });
  }

  function previewCozeWorkflowTemplate() {
    const results = convertManyCozeWorkflowsToDraftTemplates(cozeWorkflowSource, { namePrefix: cozeImportName.trim() || undefined });
    const result = results[0] ?? convertCozeWorkflowToDraftTemplate(cozeWorkflowSource, { name: cozeImportName });
    setCozeImportResults(results);
    if (!result.ok || results.some((item) => !item.ok)) {
      setCozeImportResult(null);
      setCozeImportError(!result.ok ? result.error : '部分 Coze 工作流转换失败，请检查源码。');
      return;
    }
    setCozeImportResult(result);
    setCozeImportError('');
    if (!cozeImportName.trim()) setCozeImportName(result.template.name);
  }

  async function saveCozeWorkflowTemplate() {
    const result = convertCozeWorkflowToDraftTemplate(cozeWorkflowSource, { name: cozeImportName });
    if (!result.ok) {
      setCozeImportResult(null);
      setCozeImportError(result.error);
      return;
    }
    const template = cozeImportName.trim() ? { ...result.template, name: cozeImportName.trim() } : result.template;
    await draftTemplateAction.run(async () => {
      applyState(await api.saveDraftTemplate(template));
      setCozeImportResult({ ...result, template });
      setCozeImportError('');
      setEditingId(template.id);
    }, { onError: (error) => setCozeImportError(error.message) });
  }

  async function saveAllCozeWorkflowTemplates() {
    const results = convertManyCozeWorkflowsToDraftTemplates(cozeWorkflowSource, { namePrefix: cozeImportName.trim() || undefined });
    setCozeImportResults(results);
    const failures = results.filter((result) => !result.ok);
    if (failures.length) {
      setCozeImportResult(null);
      setCozeImportError(`${failures.length} 个 Coze 工作流转换失败。`);
      return;
    }
    await draftTemplateAction.run(async () => {
      let nextState: AppMutationResult | null = null;
      for (const result of results) {
        if (!result.ok) continue;
        nextState = await api.saveDraftTemplate(result.template);
      }
      applyState(nextState);
      const first = results.find((result): result is Extract<CozeWorkflowTemplateConversionResult, { ok: true }> => result.ok) ?? null;
      setCozeImportResult(first);
      setCozeImportError('');
      if (first) setEditingId(first.template.id);
    }, { onError: (error) => setCozeImportError(error.message) });
  }

  function openEditor(template: DraftTemplate) {
    const generation = ++draftDetailGeneration.current;
    setDraft(cloneDraftTemplate(template));
    setEditingId(template.id);
    void draftTemplateAction.run(async () => {
      const detail = await api.getDraftTemplateDetail(template.id);
      if (generation === draftDetailGeneration.current && detail) setDraft(cloneDraftTemplate(detail));
    });
  }

  async function selectDraftBackgroundImage() {
    await draftTemplateAction.run(async () => {
      const imagePath = await api.selectLocalImage();
      if (!imagePath) return;
      setDraft((current) => (current ? { ...current, canvas: { ...current.canvas, backgroundImage: imagePath } } : current));
    });
  }

  function updateDraftImage(patch: Partial<DraftTemplate['image']>) {
    setDraft((current) => (current ? { ...current, image: { ...current.image, ...patch } } : current));
  }

  function updateDraftTitle(patch: Partial<DraftTemplate['title']>) {
    setDraft((current) => (current ? { ...current, title: { ...current.title, ...patch } } : current));
  }

  function updateDraftSubtitle(patch: Partial<DraftTemplate['subtitle']>) {
    setDraft((current) => (current ? { ...current, subtitle: { ...current.subtitle, ...patch } } : current));
  }

  function updateDraftCaption(patch: Partial<DraftTemplate['caption']>) {
    setDraft((current) => (current ? { ...current, caption: { ...current.caption, ...patch } } : current));
  }

  function updateDraftCaptionBackground(patch: Partial<DraftTemplate['caption']['background']>) {
    setDraft((current) => (current ? { ...current, caption: { ...current.caption, background: { ...current.caption.background, ...patch } } } : current));
  }

  function updateDraftCaptionWidth(value: number) {
    updateDraftCaption({ width: clamp(value, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) });
  }

  function updateDraftDisclaimer(patch: Partial<DraftTemplate['disclaimer']>) {
    setDraft((current) => (current ? { ...current, disclaimer: { ...current.disclaimer, ...patch } } : current));
  }

  function updateDraftTitleBorder(patch: Partial<DraftTextBorder>) {
    setDraft((current) => (current ? { ...current, title: { ...current.title, border: { ...current.title.border, ...patch } } } : current));
  }

  function updateDraftSubtitleBorder(patch: Partial<DraftTextBorder>) {
    setDraft((current) => (current ? { ...current, subtitle: { ...current.subtitle, border: { ...current.subtitle.border, ...patch } } } : current));
  }

  function updateDraftCaptionBorder(patch: Partial<DraftTextBorder>) {
    setDraft((current) => (current ? { ...current, caption: { ...current.caption, border: { ...current.caption.border, ...patch } } } : current));
  }

  function updateDraftDisclaimerBorder(patch: Partial<DraftTextBorder>) {
    setDraft((current) => (current ? { ...current, disclaimer: { ...current.disclaimer, border: { ...current.disclaimer.border, ...patch } } } : current));
  }

  if (editingId && draft) {
    return (
      <div className="draft-template-page">
        <div className="editor-topbar">
          <button className="ghost-action" onClick={() => setEditingId(null)}>返回模板列表</button>
          <input className="template-name-input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          <div className="button-row">
            <button className="ghost-action" onClick={() => setDraft(editingTemplate ? cloneDraftTemplate(editingTemplate) : draft)}>取消</button>
            <button className="primary-action slim" onClick={save}><Save size={15} />保存</button>
          </div>
        </div>
        <InlineActionFeedback feedback={draftTemplateAction.feedback} />

        <div className="draft-editor-shell focused">
          <section className="draft-stage">
            <div className="panel-title-row">
              <div>
                <h2>{draft.name}</h2>
                <span className="hint-text">{draft.canvas.ratio} · {draft.canvas.width}x{draft.canvas.height} · {draft.image.animation}</span>
              </div>
              <button className="ghost-action" onClick={() => copyTemplate(draft)}><Copy size={15} />复制</button>
            </div>
            <EditableDraftCanvas template={draft} selectedLayer={selectedLayer} onSelectLayer={setSelectedLayer} onChange={setDraft} />
          </section>

          <section className="panel draft-controls">
            <Accordion title="画布设置" open>
              <Segmented label="比例" value={draft.canvas.ratio} options={['9:16', '4:3', '1:1', '16:9']} onChange={(value) => setDraft(applyDraftCanvasRatio(draft, value))} />
              <Field label="尺寸"><input value={`${draft.canvas.width}x${draft.canvas.height}`} readOnly /></Field>
              <Field label="底色">
                <div className="draft-background-field with-swatch">
                  <input className="draft-background-swatch" type="color" value={normalizeColorInput(draft.canvas.backgroundColor)} onChange={(event) => setDraft({ ...draft, canvas: { ...draft.canvas, backgroundColor: event.target.value } })} />
                  <input value={draft.canvas.backgroundColor} onChange={(event) => setDraft({ ...draft, canvas: { ...draft.canvas, backgroundColor: event.target.value } })} />
                </div>
              </Field>
              <Field label="背景图">
                <div className="draft-background-field">
                  <input value={draft.canvas.backgroundImage} onChange={(event) => setDraft({ ...draft, canvas: { ...draft.canvas, backgroundImage: event.target.value } })} placeholder="留空 = 无背景图" />
                  <button className="ghost-action" type="button" onClick={selectDraftBackgroundImage}><FolderOpen size={14} />浏览</button>
                  <button className="ghost-action" type="button" onClick={() => setDraft({ ...draft, canvas: { ...draft.canvas, backgroundImage: '' } })}>清空</button>
                </div>
              </Field>
            </Accordion>
            <Accordion title="图片区域" open>
              <ToggleField label="显示" checked={draft.image.visible} onChange={(checked) => updateDraftImage({ visible: checked })} />
              <Segmented label="图片比例" value={draft.image.ratio} options={['9:16', '4:3', '16:9']} onChange={(value) => setDraft(applyDraftImageRatio(draft, value))} />
              <Segmented label="适配" value={draft.image.fit} options={['cover', 'contain']} onChange={(value) => updateDraftImage({ fit: value as 'cover' | 'contain' })} />
              <Field label="坐标"><input value={`top ${draft.image.top.toFixed(2)}, height ${draft.image.height.toFixed(2)}`} readOnly /></Field>
              <RangeField label="垂直位置" min={-1} max={1} step={0.01} value={draft.image.top} onChange={(value) => updateDraftImage({ top: value })} />
              <RangeField label="高度占比" min={0.1} max={1} step={0.01} value={draft.image.height} onChange={(value) => updateDraftImage({ height: value })} />
              <Segmented label="动画效果" value={draft.image.animation} options={imageAnimations} onChange={(value) => updateDraftImage({ animation: value })} />
            </Accordion>
            <Accordion title="主标题">
              <ToggleField label="显示" checked={draft.title.visible} onChange={(checked) => updateDraftTitle({ visible: checked })} />
              <Field label="文字"><input value={draft.title.text} onChange={(event) => updateDraftTitle({ text: event.target.value })} /></Field>
              <Field label="坐标"><input value={`${draft.title.x.toFixed(2)}, ${draft.title.y.toFixed(2)}`} readOnly /></Field>
              <RangeField label="文本框宽度" min={DRAFT_TEXT_WIDTH_MIN} max={DRAFT_TEXT_WIDTH_MAX} step={0.01} value={draft.title.width} onChange={(value) => updateDraftTitle({ width: clamp(value, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) })} />
              <RangeField label="字号" min={12} max={120} step={1} value={draft.title.fontSize} onChange={(value) => updateDraftTitle({ fontSize: value })} />
              <ColorField label="颜色" value={draft.title.color} onChange={(value) => updateDraftTitle({ color: value })} />
              <RangeField label="透明度" min={0} max={1} step={0.05} value={draft.title.alpha} onChange={(value) => updateDraftTitle({ alpha: value })} />
              <ToggleField label="加粗" checked={draft.title.bold} onChange={(checked) => updateDraftTitle({ bold: checked })} />
              <ToggleField label="下划线" checked={draft.title.underline} onChange={(checked) => updateDraftTitle({ underline: checked })} />
              <Field label="对齐">
                <select value={String(draft.title.align)} onChange={(event) => updateDraftTitle({ align: Number(event.target.value) })}>
                  <option value="0">左对齐</option>
                  <option value="1">居中</option>
                  <option value="2">右对齐</option>
                </select>
              </Field>
              <RangeField label="字间距" min={0} max={20} step={1} value={draft.title.letterSpacing} onChange={(value) => updateDraftTitle({ letterSpacing: value })} />
              <RangeField label="行间距" min={0} max={20} step={1} value={draft.title.lineSpacing} onChange={(value) => updateDraftTitle({ lineSpacing: value })} />
              <TextBorderControls border={draft.title.border} onChange={updateDraftTitleBorder} />
            </Accordion>
            <Accordion title="副标题">
              <ToggleField label="显示" checked={draft.subtitle.visible} onChange={(checked) => updateDraftSubtitle({ visible: checked })} />
              <Field label="文字"><input value={draft.subtitle.text} onChange={(event) => updateDraftSubtitle({ text: event.target.value })} /></Field>
              <Field label="坐标"><input value={`${draft.subtitle.x.toFixed(2)}, ${draft.subtitle.y.toFixed(2)}`} readOnly /></Field>
              <RangeField label="文本框宽度" min={DRAFT_TEXT_WIDTH_MIN} max={DRAFT_TEXT_WIDTH_MAX} step={0.01} value={draft.subtitle.width} onChange={(value) => updateDraftSubtitle({ width: clamp(value, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) })} />
              <RangeField label="字号" min={10} max={72} step={1} value={draft.subtitle.fontSize} onChange={(value) => updateDraftSubtitle({ fontSize: value })} />
              <ColorField label="颜色" value={draft.subtitle.color} onChange={(value) => updateDraftSubtitle({ color: value })} />
              <RangeField label="透明度" min={0} max={1} step={0.05} value={draft.subtitle.alpha} onChange={(value) => updateDraftSubtitle({ alpha: value })} />
              <ToggleField label="加粗" checked={draft.subtitle.bold} onChange={(checked) => updateDraftSubtitle({ bold: checked })} />
              <ToggleField label="下划线" checked={draft.subtitle.underline} onChange={(checked) => updateDraftSubtitle({ underline: checked })} />
              <Field label="对齐">
                <select value={String(draft.subtitle.align)} onChange={(event) => updateDraftSubtitle({ align: Number(event.target.value) })}>
                  <option value="0">左对齐</option>
                  <option value="1">居中</option>
                  <option value="2">右对齐</option>
                </select>
              </Field>
              <RangeField label="字间距" min={0} max={20} step={1} value={draft.subtitle.letterSpacing} onChange={(value) => updateDraftSubtitle({ letterSpacing: value })} />
              <RangeField label="行间距" min={0} max={20} step={1} value={draft.subtitle.lineSpacing} onChange={(value) => updateDraftSubtitle({ lineSpacing: value })} />
              <TextBorderControls border={draft.subtitle.border} onChange={updateDraftSubtitleBorder} />
            </Accordion>
            <Accordion title="字幕">
              <ToggleField label="显示" checked={draft.caption.visible} onChange={(checked) => updateDraftCaption({ visible: checked })} />
              <Field label="坐标"><input value={`${draft.caption.x.toFixed(2)}, ${draft.caption.y.toFixed(2)}`} readOnly /></Field>
              <RangeField label="文本框宽度" min={DRAFT_TEXT_WIDTH_MIN} max={DRAFT_TEXT_WIDTH_MAX} step={0.01} value={draft.caption.width} onChange={updateDraftCaptionWidth} />
              <RangeField label="字号" min={8} max={48} step={1} value={draft.caption.fontSize} onChange={(value) => updateDraftCaption({ fontSize: value })} />
              <ColorField label="颜色" value={draft.caption.color} onChange={(value) => updateDraftCaption({ color: value })} />
              <RangeField label="透明度" min={0} max={1} step={0.05} value={draft.caption.alpha} onChange={(value) => updateDraftCaption({ alpha: value })} />
              <ToggleField label="加粗" checked={draft.caption.bold} onChange={(checked) => updateDraftCaption({ bold: checked })} />
              <ToggleField label="下划线" checked={draft.caption.underline} onChange={(checked) => updateDraftCaption({ underline: checked })} />
              <Field label="对齐">
                <select value={String(draft.caption.align)} onChange={(event) => updateDraftCaption({ align: Number(event.target.value) })}>
                  <option value="0">左对齐</option>
                  <option value="1">居中</option>
                  <option value="2">右对齐</option>
                </select>
              </Field>
              <RangeField label="字间距" min={0} max={20} step={1} value={draft.caption.letterSpacing} onChange={(value) => updateDraftCaption({ letterSpacing: value })} />
              <RangeField label="行间距" min={0} max={20} step={1} value={draft.caption.lineSpacing} onChange={(value) => updateDraftCaption({ lineSpacing: value })} />
              <RangeField label="每行字数" min={4} max={80} step={1} value={draft.caption.maxCharsPerLine} onChange={(value) => updateDraftCaption({ maxCharsPerLine: value })} />
              <ColorField label="背景色" value={draft.caption.background.color} onChange={(value) => updateDraftCaptionBackground({ color: value })} />
              <RangeField label="背景透明度" min={0} max={1} step={0.05} value={draft.caption.background.alpha} onChange={(value) => updateDraftCaptionBackground({ alpha: value })} />
              <RangeField label="圆角" min={0} max={1} step={0.05} value={draft.caption.background.roundRadius} onChange={(value) => updateDraftCaptionBackground({ roundRadius: value })} />
              <TextBorderControls border={draft.caption.border} onChange={updateDraftCaptionBorder} />
            </Accordion>
            <Accordion title="免责声明">
              <ToggleField label="显示" checked={draft.disclaimer.visible} onChange={(checked) => updateDraftDisclaimer({ visible: checked })} />
              <Field label="坐标"><input value={`${draft.disclaimer.x.toFixed(2)}, ${draft.disclaimer.y.toFixed(2)}`} readOnly /></Field>
              <Field label="文字"><input value={draft.disclaimer.text} onChange={(event) => updateDraftDisclaimer({ text: event.target.value })} /></Field>
              <RangeField label="文本框宽度" min={DRAFT_TEXT_WIDTH_MIN} max={DRAFT_TEXT_WIDTH_MAX} step={0.01} value={draft.disclaimer.width} onChange={(value) => updateDraftDisclaimer({ width: clamp(value, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) })} />
              <RangeField label="字号" min={8} max={40} step={1} value={draft.disclaimer.fontSize} onChange={(value) => updateDraftDisclaimer({ fontSize: value })} />
              <ColorField label="颜色" value={draft.disclaimer.color} onChange={(value) => updateDraftDisclaimer({ color: value })} />
              <RangeField label="透明度" min={0} max={1} step={0.05} value={draft.disclaimer.alpha} onChange={(value) => updateDraftDisclaimer({ alpha: value })} />
              <ToggleField label="加粗" checked={draft.disclaimer.bold} onChange={(checked) => updateDraftDisclaimer({ bold: checked })} />
              <ToggleField label="下划线" checked={draft.disclaimer.underline} onChange={(checked) => updateDraftDisclaimer({ underline: checked })} />
              <Field label="对齐">
                <select value={String(draft.disclaimer.align)} onChange={(event) => updateDraftDisclaimer({ align: Number(event.target.value) })}>
                  <option value="0">左对齐</option>
                  <option value="1">居中</option>
                  <option value="2">右对齐</option>
                </select>
              </Field>
              <RangeField label="字间距" min={0} max={20} step={1} value={draft.disclaimer.letterSpacing} onChange={(value) => updateDraftDisclaimer({ letterSpacing: value })} />
              <RangeField label="行间距" min={0} max={20} step={1} value={draft.disclaimer.lineSpacing} onChange={(value) => updateDraftDisclaimer({ lineSpacing: value })} />
              <TextBorderControls border={draft.disclaimer.border} onChange={updateDraftDisclaimerBorder} />
            </Accordion>
            <Accordion title="音频设置">
              <Field label="旁白音量"><input type="number" value={draft.audio.narrationVolume} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, narrationVolume: Number(event.target.value) } })} /></Field>
              <Field label="BGM 音量"><input type="number" value={draft.audio.bgmVolume} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, bgmVolume: Number(event.target.value) } })} /></Field>
              <Field label="转场">
                <select value={draft.audio.transitionType} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, transitionType: event.target.value } })}>
                  <option value="">关闭</option>
                  {effectCatalog.transitions.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </Field>
              <Field label="转场时长(ms)"><input type="number" value={draft.audio.transitionDurationMs} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, transitionDurationMs: Number(event.target.value) } })} /></Field>
              <Field label="旁白淡入(ms)"><input type="number" value={draft.audio.narrationFadeInMs} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, narrationFadeInMs: Number(event.target.value) } })} /></Field>
              <Field label="旁白淡出(ms)"><input type="number" value={draft.audio.narrationFadeOutMs} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, narrationFadeOutMs: Number(event.target.value) } })} /></Field>
              <Field label="BGM 淡入(ms)"><input type="number" value={draft.audio.bgmFadeInMs} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, bgmFadeInMs: Number(event.target.value) } })} /></Field>
              <Field label="BGM 淡出(ms)"><input type="number" value={draft.audio.bgmFadeOutMs} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, bgmFadeOutMs: Number(event.target.value) } })} /></Field>
              <Field label="滤镜">
                <select value={draft.audio.filterType} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, filterType: event.target.value } })}>
                  <option value="">关闭</option>
                  {effectCatalog.filters.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </Field>
              <Field label="视频特效">
                <select value={draft.audio.videoEffectType} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, videoEffectType: event.target.value } })}>
                  <option value="">关闭</option>
                  {effectCatalog.videoEffects.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </Field>
              <Field label="音频特效">
                <select value={draft.audio.audioEffectType} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, audioEffectType: event.target.value } })}>
                  <option value="">关闭</option>
                  {effectCatalog.audioEffects.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </Field>
            </Accordion>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="draft-template-page">
      <div className="panel-title-row draft-template-toolbar">
        <div>
          <h2>草稿模板</h2>
          <span className="hint-text">内置模板：默认竖屏、竖屏4:3、横屏16:9；自定义模板保存在本机。</span>
        </div>
        <div className="button-row">
          <button className="ghost-action" type="button" onClick={() => setCozeImportOpen(true)}><Upload size={15} />导入 Coze 模板</button>
          <button className="primary-action slim" onClick={createTemplate}><Plus size={15} />新模板</button>
        </div>
      </div>
      <InlineActionFeedback feedback={draftTemplateAction.feedback} />

      {cozeImportOpen ? (
        <div className="coze-template-import-backdrop" onClick={() => setCozeImportOpen(false)}>
          <section className="panel coze-template-import-panel coze-template-import-dialog" role="dialog" aria-modal="true" aria-label="导入 Coze 模板" onClick={(event) => event.stopPropagation()}>
            <div className="panel-title-row">
              <div>
                <h3>导入 Coze 模板</h3>
                <span className="hint-text">粘贴每个视频下复制出的 Coze 工作流源码，转换成可编辑的草稿模板预设。</span>
              </div>
              <div className="button-row">
                <button className="ghost-action" type="button" onClick={previewCozeWorkflowTemplate}>预览转换</button>
                <button className="primary-action slim" type="button" disabled={!cozeWorkflowSource.trim()} onClick={saveCozeWorkflowTemplate}><Upload size={15} />导入 Coze 模板</button>
                <button className="ghost-action" type="button" disabled={!cozeWorkflowSource.trim()} onClick={saveAllCozeWorkflowTemplates}>全部导入</button>
                <button className="mini-button" type="button" onClick={() => setCozeImportOpen(false)}>关闭</button>
              </div>
            </div>
            <div className="coze-template-import-grid">
              <Field label="模板名称">
                <input value={cozeImportName} onChange={(event) => setCozeImportName(event.target.value)} placeholder="留空则使用 Coze workflowId" />
              </Field>
              <Field label="Coze 工作流源码">
                <textarea className="small-textarea coze-workflow-source" value={cozeWorkflowSource} onChange={(event) => setCozeWorkflowSource(event.target.value)} placeholder='粘贴 {"type":"coze-workflow-clipboard-data", ...}' />
              </Field>
            </div>
            {cozeImportError ? <p className="form-error">{cozeImportError}</p> : null}
            {cozeImportResults.length > 1 ? <span className="hint-text">已识别 {cozeImportResults.length} 个 Coze 工作流源码。</span> : null}
            {cozeImportResult ? (
              <div className="coze-import-preview">
                <strong>{cozeImportResult.template.name}</strong>
                <span>{cozeImportResult.workflowId} · {cozeImportResult.template.canvas.ratio} · {cozeImportResult.template.canvas.width}x{cozeImportResult.template.canvas.height}</span>
                <div>
                  <small>转换诊断</small>
                  <ul className="coze-diagnostics-list">
                    {cozeImportResult.diagnostics.slice(0, 8).map((diagnostic, index) => (
                      <li key={`${diagnostic.code}-${diagnostic.nodeId ?? index}`}>
                        <span>{diagnostic.level}</span>
                        {diagnostic.message}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      <section className="draft-template-gallery">
        {state.draftTemplates.map((template) => (
          <article key={template.id} className="draft-template-card">
            <button className="draft-template-thumb" onClick={() => openEditor(template)} type="button" aria-label={`编辑 ${template.name}`}>
              <DraftTemplatePreview template={template} compact />
            </button>
            <div className="draft-template-meta">
              <div>
                <strong>{template.name}</strong>
                {template.isDefault ? <small>系统默认</small> : <small>本地自定义</small>}
              </div>
              <span>{template.canvas.ratio} · {template.canvas.width}x{template.canvas.height}</span>
              <span>图片 {template.image.ratio} · {template.image.fit} · {template.image.animation}</span>
            </div>
            <div className="row-actions">
              <button className="ghost-action" onClick={() => openEditor(template)}><LayoutTemplate size={15} />编辑</button>
              <button className="ghost-action" onClick={() => copyTemplate(template)}><Copy size={15} />复制</button>
            </div>
          </article>
        ))}
        <button className="draft-template-card new-template-card" onClick={createTemplate} type="button">
          <Plus size={24} />
          <strong>新模板</strong>
          <span>从默认竖屏复制一份本地配置</span>
        </button>
      </section>
    </div>
  );
}
function DraftTemplatePreview({ template, compact = false }: { template: DraftTemplate; compact?: boolean }) {
  const titleSize = compact ? Math.max(9, template.title.fontSize * 0.28) : template.title.fontSize;
  const subtitleSize = compact ? Math.max(7, template.subtitle.fontSize * 0.28) : template.subtitle.fontSize;
  const captionSize = compact ? Math.max(7, template.caption.fontSize * 0.42) : template.caption.fontSize;
  const disclaimerSize = compact ? Math.max(6, template.disclaimer.fontSize * 0.42) : template.disclaimer.fontSize;
  return (
    <div className={compact ? 'draft-preview-mini' : 'draft-preview-large'} style={draftTemplateCanvasStyle(template)}>
      {template.image.visible ? (
        <div className="draft-image" style={{ top: `${template.image.top * 100}%`, height: `${template.image.height * 100}%` }}>
          <div className="draft-image-media" style={draftImageMediaStyle(template)} />
        </div>
      ) : null}
      {template.title.visible ? (
        <DraftCanvasText
          className="draft-title"
          x={template.title.x}
          y={template.title.y}
          width={template.title.width}
          border={template.title.border}
          style={draftTextLayerStyle(template.title, titleSize, template.title.bold ? 800 : 500)}
        >
          {template.title.text}
        </DraftCanvasText>
      ) : null}
      {template.subtitle.visible ? (
        <DraftCanvasText
          className="draft-subtitle"
          x={template.subtitle.x}
          y={template.subtitle.y}
          width={template.subtitle.width}
          border={template.subtitle.border}
          style={draftTextLayerStyle(template.subtitle, subtitleSize, template.subtitle.bold ? 800 : 500)}
        >
          {template.subtitle.text}
        </DraftCanvasText>
      ) : null}
      {template.caption.visible ? (
        <DraftCanvasText
          className="draft-caption"
          x={template.caption.x}
          y={template.caption.y}
          width={template.caption.width}
          border={template.caption.border}
          style={{
            color: template.caption.color,
            fontSize: captionSize,
            opacity: template.caption.alpha,
            fontWeight: template.caption.bold ? 700 : 500,
            textDecoration: template.caption.underline ? 'underline' : 'none',
            textAlign: draftTextAlign(template.caption.align),
            letterSpacing: `${template.caption.letterSpacing}px`,
            lineHeight: `${1 + template.caption.lineSpacing / 10}`,
            backgroundColor: colorWithAlpha(template.caption.background.color, template.caption.background.alpha),
            borderRadius: `${template.caption.background.roundRadius * 24}px`,
            padding: compact ? '2px 8px' : '4px 10px',
          }}
        >
          字幕预览
        </DraftCanvasText>
      ) : null}
      {template.disclaimer.visible ? (
        <DraftCanvasText
          className="draft-disclaimer"
          x={template.disclaimer.x}
          y={template.disclaimer.y}
          width={template.disclaimer.width}
          border={template.disclaimer.border}
          style={draftTextLayerStyle(template.disclaimer, disclaimerSize, template.disclaimer.bold ? 700 : 500)}
        >
          {template.disclaimer.text}
        </DraftCanvasText>
      ) : null}
    </div>
  );
}

function EditableDraftCanvas({
  template,
  selectedLayer,
  onSelectLayer,
  onChange,
}: {
  template: DraftTemplate;
  selectedLayer: DraftCanvasLayer;
  onSelectLayer: (layer: DraftCanvasLayer) => void;
  onChange: (template: DraftTemplate) => void;
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DraftDragSnapshot | null>(null);

  function handleDraftCanvasPointerDown(layer: DraftCanvasLayer, event: React.PointerEvent<HTMLDivElement>) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelectLayer(layer);
    dragRef.current = {
      mode: 'move',
      layer,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      template: cloneDraftTemplate(template),
    } as DraftDragSnapshot;
  }

  function handleDraftCanvasResizePointerDown(layer: Exclude<DraftCanvasLayer, 'image'>, event: React.PointerEvent<HTMLElement>) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelectLayer(layer);
    dragRef.current = {
      mode: 'resize',
      layer,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      template: cloneDraftTemplate(template),
    };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!drag || !rect || drag.pointerId !== event.pointerId) return;
    const deltaX = ((event.clientX - drag.startX) / rect.width) * 2;
    const deltaY = ((event.clientY - drag.startY) / rect.height) * 2;
    onChange(drag.mode === 'resize' ? resizeDraftLayerWidth(drag.template, drag.layer, deltaX) : updateDraftLayerPosition(drag.template, drag.layer, deltaX, deltaY));
  }

  function stopDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }

  return (
    <div
      ref={canvasRef}
      className="editable-draft-canvas draft-preview-large"
      style={draftTemplateCanvasStyle(template)}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
    >
      {template.image.visible ? (
        <div
          className={selectedLayer === 'image' ? 'draft-layer image-layer selected' : 'draft-layer image-layer'}
          data-layer="image"
          style={{ top: `${template.image.top * 100}%`, height: `${template.image.height * 100}%` }}
          onPointerDown={(event) => handleDraftCanvasPointerDown('image', event)}
        >
          <div className="draft-image-media" style={draftImageMediaStyle(template)} />
          <span>图片区域</span>
          <i className="draft-layer-handle" />
        </div>
      ) : null}
      {template.title.visible ? (
        <DraftCanvasLayerBox layer="title" label="主标题" selected={selectedLayer === 'title'} x={template.title.x} y={template.title.y} width={template.title.width} onPointerDown={handleDraftCanvasPointerDown} onResizePointerDown={handleDraftCanvasResizePointerDown}>
          <DraftCanvasText
            className="draft-title"
            x={0}
            y={0}
            width={1}
            border={template.title.border}
            positioned={false}
            style={draftTextLayerStyle(template.title, template.title.fontSize, template.title.bold ? 800 : 500)}
          >
            {template.title.text}
          </DraftCanvasText>
        </DraftCanvasLayerBox>
      ) : null}
      {template.subtitle.visible ? (
        <DraftCanvasLayerBox layer="subtitle" label="副标题" selected={selectedLayer === 'subtitle'} x={template.subtitle.x} y={template.subtitle.y} width={template.subtitle.width} onPointerDown={handleDraftCanvasPointerDown} onResizePointerDown={handleDraftCanvasResizePointerDown}>
          <DraftCanvasText
            className="draft-subtitle"
            x={0}
            y={0}
            width={1}
            border={template.subtitle.border}
            positioned={false}
            style={draftTextLayerStyle(template.subtitle, template.subtitle.fontSize, template.subtitle.bold ? 800 : 500)}
          >
            {template.subtitle.text}
          </DraftCanvasText>
        </DraftCanvasLayerBox>
      ) : null}
      {template.caption.visible ? (
        <DraftCanvasLayerBox layer="caption" label="字幕" selected={selectedLayer === 'caption'} x={template.caption.x} y={template.caption.y} width={template.caption.width} onPointerDown={handleDraftCanvasPointerDown} onResizePointerDown={handleDraftCanvasResizePointerDown}>
          <DraftCanvasText
            className="draft-caption"
            x={0}
            y={0}
            width={1}
            border={template.caption.border}
            positioned={false}
            style={{
              color: template.caption.color,
              fontSize: template.caption.fontSize,
              opacity: template.caption.alpha,
              fontWeight: template.caption.bold ? 700 : 500,
              textDecoration: template.caption.underline ? 'underline' : 'none',
              textAlign: draftTextAlign(template.caption.align),
              letterSpacing: `${template.caption.letterSpacing}px`,
              lineHeight: `${1 + template.caption.lineSpacing / 10}`,
              backgroundColor: colorWithAlpha(template.caption.background.color, template.caption.background.alpha),
              borderRadius: `${template.caption.background.roundRadius * 24}px`,
              padding: '4px 10px',
            }}
          >
            字幕预览
          </DraftCanvasText>
        </DraftCanvasLayerBox>
      ) : null}
      {template.disclaimer.visible ? (
        <DraftCanvasLayerBox layer="disclaimer" label="免责声明" selected={selectedLayer === 'disclaimer'} x={template.disclaimer.x} y={template.disclaimer.y} width={template.disclaimer.width} onPointerDown={handleDraftCanvasPointerDown} onResizePointerDown={handleDraftCanvasResizePointerDown}>
          <DraftCanvasText
            className="draft-disclaimer"
            x={0}
            y={0}
            width={1}
            border={template.disclaimer.border}
            positioned={false}
            style={draftTextLayerStyle(template.disclaimer, template.disclaimer.fontSize, template.disclaimer.bold ? 700 : 500)}
          >
            {template.disclaimer.text}
          </DraftCanvasText>
        </DraftCanvasLayerBox>
      ) : null}
    </div>
  );
}

function DraftCanvasLayerBox({
  layer,
  label,
  selected,
  x,
  y,
  width,
  onPointerDown,
  onResizePointerDown,
  children,
}: {
  layer: Exclude<DraftCanvasLayer, 'image'>;
  label: string;
  selected: boolean;
  x: number;
  y: number;
  width: number;
  onPointerDown: (layer: DraftCanvasLayer, event: React.PointerEvent<HTMLDivElement>) => void;
  onResizePointerDown: (layer: Exclude<DraftCanvasLayer, 'image'>, event: React.PointerEvent<HTMLElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={selected ? 'draft-layer text-layer selected' : 'draft-layer text-layer'}
      data-layer={layer}
      style={{ ...draftLayerPositionStyle(x, y), ...draftTextWidthStyle(width) }}
      onPointerDown={(event) => onPointerDown(layer, event)}
    >
      <span>{label}</span>
      {children}
      <i className="draft-layer-handle" onPointerDown={(event) => onResizePointerDown(layer, event)} />
    </div>
  );
}

function SettingsPage({ api, state, applyState }: { api: StoryDreamApi; state: AppState; applyState: ApplyMutationResult }) {
  const [section, setSection] = useState('llm');
  const [draft, setDraft] = useState<AppConfig>(() => normalizeEditableConfigProviders(state.config));
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [secretChanges, setSecretChanges] = useState<SecretChanges>({});
  const [lastAppliedConfigSignature, setLastAppliedConfigSignature] = useState(() => settingsConfigSignature(state.config));
  const [diagnostics, setDiagnostics] = useState('');
  const [configTestResult, setConfigTestResult] = useState('');
  const [testingConfig, setTestingConfig] = useState(false);
  const [modelLists, setModelLists] = useState<Record<ModelListKey, ProviderModel[]>>({ llm: [], 'gpt-image': [], 'custom-image': [] });
  const [modelListStatus, setModelListStatus] = useState<Partial<Record<ModelListKey, string>>>({});
  const [loadingModelList, setLoadingModelList] = useState<ModelListKey | null>(null);
  const [volcengineSpeakers, setVolcengineSpeakers] = useState<VolcengineSpeaker[]>([]);
  const [volcengineSpeakerStatus, setVolcengineSpeakerStatus] = useState('');
  const [loadingVolcengineSpeakers, setLoadingVolcengineSpeakers] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [selectedLlmProfileId, setSelectedLlmProfileId] = useState(() => activeLlmProfileId(state.config));
  const [selectedImageProfileId, setSelectedImageProfileId] = useState(() => activeImageProfileId(state.config));
  const [selectedTtsProfileId, setSelectedTtsProfileId] = useState(() => activeTtsProfileId(state.config));
  const settingsAction = useAsyncAction();
  const themeAction = useAsyncAction();
  useEffect(() => {
    if (settingsDirty) return;
    const nextSignature = settingsConfigSignature(state.config);
    if (nextSignature === lastAppliedConfigSignature) return;
    setDraft(normalizeEditableConfigProviders(state.config));
    setSecretChanges({});
    setLastAppliedConfigSignature(nextSignature);
  }, [lastAppliedConfigSignature, settingsDirty, state.config]);
  function setSettingsDraft(next: AppConfig | ((current: AppConfig) => AppConfig)) {
    setSettingsDirty(true);
    setDraft(next);
  }
  function commitSettingsDraft(next: AppConfig) {
    const normalized = normalizeEditableConfigProviders(next);
    setDraft(normalized);
    setSettingsDirty(false);
    setSecretChanges({});
    setLastAppliedConfigSignature(settingsConfigSignature(normalized));
  }
  const persistSettingsDraft = async (nextDraft: AppConfig, successMessage: string) => {
    setSavingConfig(true);
    try {
      const next = await api.saveConfig({ config: normalizeEditableConfigProviders(nextDraft), secretChanges });
      const savedConfig = configFromMutation(next);
      commitSettingsDraft(savedConfig);
      applyState(next);
      setConfigTestResult(`[pass] ${successMessage}`);
      return savedConfig;
    } finally {
      setSavingConfig(false);
    }
  };
  async function commitAndApplySettingsDraft(nextDraft: AppConfig, successMessage = '配置已保存') {
    const result = await settingsAction.run(
      () => persistSettingsDraft(nextDraft, successMessage),
      { onError: (error) => setConfigTestResult(`[fail] ${error.message}`) },
    );
    return result.ok ? result.value : undefined;
  }
  function clearProviderModels(key: ModelListKey) {
    setModelLists((current) => ({ ...current, [key]: [] }));
    setModelListStatus((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }
  function changeSecret(id: SecretId, value: string | null) {
    setSettingsDirty(true);
    setSecretChanges((current) => {
      const next = { ...current };
      if (value === '') delete next[id];
      else next[id] = value;
      return next;
    });
  }
  function secretValue(id: SecretId): string {
    const value = secretChanges[id];
    return typeof value === 'string' ? value : '';
  }
  function isSecretConfigured(id: SecretId): boolean {
    const value = secretChanges[id];
    if (value === null) return false;
    if (typeof value === 'string') return value.length > 0;
    return state.secretStatus[id] === true;
  }
  function secretReference(id: SecretId): { value: string; secretId?: string } {
    if (secretChanges[id] === null) return { value: '' };
    return { value: secretValue(id), secretId: id };
  }
  const secrets: SecretEditor = {
    value: secretValue,
    configured: isSecretConfigured,
    reference: secretReference,
    change: changeSecret,
  };
  async function save() {
    await commitAndApplySettingsDraft(activateSelectedProviderProfileForTarget(draft, section as ConfigTestTarget, {
      llm: selectedLlmProfileId,
      image: selectedImageProfileId,
      tts: selectedTtsProfileId,
    }));
  }
  async function activateLlmProfile(id: string) {
    await commitAndApplySettingsDraft(enableLlmProfile(draft, id), '已启用 LLM 配置档案');
  }
  async function activateImageProfile(id: string) {
    await commitAndApplySettingsDraft(enableImageProfile(draft, id), '已启用绘图配置档案');
  }
  async function activateTtsProfile(id: string) {
    await commitAndApplySettingsDraft(enableTtsProfile(draft, id), '已启用 TTS 配置档案');
  }
  async function testCurrentConfig() {
    const target: ConfigTestTarget =
      section === 'llm' || section === 'image' || section === 'tts' || section === 'speechToText' || section === 'jianying' || section === 'creative'
        ? section
        : 'llm';
    await settingsAction.run(async () => {
      setTestingConfig(true);
      setSavingConfig(true);
      setConfigTestResult('正在保存并测试当前配置...');
      try {
        const nextDraft = activateSelectedProviderProfileForTarget(draft, target, {
          llm: selectedLlmProfileId,
          image: selectedImageProfileId,
          tts: selectedTtsProfileId,
        });
        const next = await api.saveConfig({ config: normalizeEditableConfigProviders(nextDraft), secretChanges });
        const savedConfig = configFromMutation(next);
        commitSettingsDraft(savedConfig);
        applyState(next);
        const testConfig = buildConfigForSelectedProfileTest(savedConfig, target, selectedProviderProfileIds);
        const result = await api.testAppConfig(target, testConfig);
        setConfigTestResult(`[${result.status}] ${result.detail}`);
      } finally {
        setSavingConfig(false);
        setTestingConfig(false);
      }
    }, { onError: (error) => setConfigTestResult(`[fail] ${error.message}`) });
  }
  async function refreshProviderModels(
    key: ModelListKey,
    request: ProviderModelListRequest,
    currentModel: string,
    applyModel?: (config: AppConfig, model: string) => AppConfig,
  ) {
    if (key === 'custom-image' && !request.baseUrl.trim()) {
      setModelListStatus((current) => ({ ...current, [key]: '[失败] 拉取模型前需要填写接口地址。' }));
      return;
    }
    await settingsAction.run(async () => {
      setLoadingModelList(key);
      setModelListStatus((current) => ({ ...current, [key]: '正在获取模型清单...' }));
      try {
        const result = await api.listProviderModels(request);
        setModelListStatus((current) => ({ ...current, [key]: `[${result.status}] ${result.detail}` }));
        if (result.models.length) {
          setModelLists((current) => ({ ...current, [key]: result.models }));
          if (!currentModel.trim()) {
            setSettingsDraft((current) => (applyModel ? applyModel(current, result.models[0].id) : setDraftModel(current, key, result.models[0].id)));
          }
        }
      } finally {
        setLoadingModelList((current) => (current === key ? null : current));
      }
    }, { onError: (error) => setModelListStatus((current) => ({ ...current, [key]: `[fail] ${error.message}` })) });
  }
  async function refreshVolcengineSpeakers(profile: TtsProviderProfile) {
    const volcengine = ttsProfileVolcengine(profile);
    const accessKeyIdId = profileSecretId('tts', profile.id, 'volcengine/accessKeyId');
    const secretAccessKeyId = profileSecretId('tts', profile.id, 'volcengine/secretAccessKey');
    const accessKeyId = secrets.reference(accessKeyIdId);
    const secretAccessKey = secrets.reference(secretAccessKeyId);
    if (!secrets.configured(accessKeyIdId) || !secrets.configured(secretAccessKeyId)) {
      setVolcengineSpeakerStatus('[失败] 加载火山音色列表需要填写访问密钥 ID 和访问密钥 Secret。');
      return;
    }

    const resourceId = (volcengine.resourceId ?? '').trim() || 'seed-tts-2.0';
    const limit = 100;
    await settingsAction.run(async () => {
      setLoadingVolcengineSpeakers(true);
      setVolcengineSpeakerStatus('正在加载全部音色...');
      try {
        const request = {
          accessKeyId: accessKeyId.value,
          secretAccessKey: secretAccessKey.value,
          accessKeyIdSecretId: accessKeyId.secretId,
          secretAccessKeySecretId: secretAccessKey.secretId,
          resourceId,
          limit,
        };
        const first = await api.listVolcengineSpeakers({ ...request, page: 1 });
        let speakers = mergeVolcengineSpeakers([], first.speakers);
        const total = first.total || speakers.length;
        if (first.status !== 'fail' && total > speakers.length) {
          const pageCount = Math.min(Math.ceil(total / limit), 20);
          for (let page = 2; page <= pageCount; page += 1) {
            const next = await api.listVolcengineSpeakers({ ...request, page });
            if (next.status === 'fail' || !next.speakers.length) break;
            speakers = mergeVolcengineSpeakers(speakers, next.speakers);
            if (speakers.length >= total) break;
          }
        }
        setVolcengineSpeakers(speakers);
        const loadedText = speakers.length > first.speakers.length ? `，已合并 ${speakers.length}/${total} 个` : '';
        setVolcengineSpeakerStatus(`[${first.status}] ${first.detail}${loadedText}`);
      } finally {
        setLoadingVolcengineSpeakers(false);
      }
    }, { onError: (error) => setVolcengineSpeakerStatus(`[fail] ${error.message}`) });
  }
  async function runDiagnostics() {
    await settingsAction.run(async () => {
      const report = await api.runDiagnostics();
      setDiagnostics(JSON.stringify(report, null, 2));
    });
  }
  async function uploadBgmFromSettings() {
    await settingsAction.run(async () => {
      const audioPath = await api.selectLocalAudio();
      if (!audioPath) return;
      const nextBgm = addUploadedBgm(draft, audioPath);
      await persistSettingsDraft(nextBgm.config, '已添加 BGM 文件');
    }, { onError: (error) => setConfigTestResult(`[fail] ${error.message}`) });
  }
  async function autoDetectJianyingDraftPath() {
    await settingsAction.run(async () => {
      setConfigTestResult('正在自动检测剪映草稿目录...');
      const detected = await api.detectJianyingDraftPath();
      if (!detected) {
        setConfigTestResult('[warn] 未自动检测到剪映草稿目录，请用“选择目录”手动指定。');
        return;
      }
      setSettingsDraft({ ...draft, jianying: { ...draft.jianying, draftPath: detected } });
      setConfigTestResult(`[pass] 已检测到剪映草稿目录：${detected}`);
    }, { onError: (error) => setConfigTestResult(`[fail] ${error.message}`) });
  }
  async function pickJianyingDraftPath() {
    await settingsAction.run(async () => {
      const folder = await api.selectLocalFolder();
      if (!folder) return;
      setSettingsDraft({ ...draft, jianying: { ...draft.jianying, draftPath: folder } });
      setConfigTestResult(`已选择剪映草稿目录：${folder}`);
    });
  }
  function setDefaultBgm(id: string) {
    setSettingsDraft({ ...draft, jianying: { ...draft.jianying, defaultBgmId: id } });
  }
  function updateBgmVolume(id: string, volume: number) {
    setSettingsDraft({
      ...draft,
      jianying: {
        ...draft.jianying,
        bgmLibrary: draft.jianying.bgmLibrary.map((bgm) => (bgm.id === id ? { ...bgm, volume } : bgm)),
      },
    });
  }
  function removeBgm(id: string) {
    const bgmLibrary = draft.jianying.bgmLibrary.filter((bgm) => bgm.id !== id);
    const nextConfig = { ...draft, jianying: { ...draft.jianying, bgmLibrary, defaultBgmId: draft.jianying.defaultBgmId === id ? '' : draft.jianying.defaultBgmId } };
    setSettingsDraft({ ...nextConfig, jianying: { ...nextConfig.jianying, defaultBgmId: resolveDefaultBgmId(nextConfig) } });
  }
  function updateSpeechToTextConfig(patch: Partial<AppConfig['speechToText']>) {
    setSettingsDraft({ ...draft, speechToText: { ...draft.speechToText, ...patch } });
  }
  function switchSpeechToTextProvider(provider: AppConfig['speechToText']['provider']) {
    if (provider === 'siliconflow') {
      updateSpeechToTextConfig({
        provider,
        baseUrl: siliconFlowSpeechToTextBaseUrl,
        model: siliconFlowSpeechToTextModels[0],
        responseFormat: 'json',
        timestampGranularities: ['segment'],
        chunkingStrategy: 'none',
      });
      return;
    }
    updateSpeechToTextConfig({
      provider,
      baseUrl: draft.speechToText.baseUrl.includes('siliconflow') ? 'https://api.openai.com/v1' : draft.speechToText.baseUrl,
      model: siliconFlowSpeechToTextModels.includes(draft.speechToText.model) ? 'whisper-1' : draft.speechToText.model,
    });
  }
  function toggleSpeechToTextTimestamp(granularity: AppConfig['speechToText']['timestampGranularities'][number], checked: boolean) {
    const current = draft.speechToText.timestampGranularities.filter((item) => item !== granularity);
    updateSpeechToTextConfig({ timestampGranularities: checked ? [...current, granularity] : current });
  }
  async function selectTheme(nextTheme: AppState['ui']['theme']) {
    await themeAction.run(async () => {
      const changed = await changeRuntimeTheme({
        currentTheme: state.ui.theme,
        nextTheme,
        persist: () => api.saveUiPreferences({ theme: nextTheme }),
      });
      applyState(changed.mutation);
    }, { onError: (error) => setConfigTestResult(`[fail] ${error.message}`) });
  }
  const selectedProviderProfileIds = {
    llm: selectedLlmProfileId,
    image: selectedImageProfileId,
    tts: selectedTtsProfileId,
  };
  const selectedLlmTestConfig = buildConfigForSelectedProfileTest(draft, 'llm', selectedProviderProfileIds);
  const selectedImageTestConfig = buildConfigForSelectedProfileTest(draft, 'image', selectedProviderProfileIds);
  const selectedTtsTestConfig = buildConfigForSelectedProfileTest(draft, 'tts', selectedProviderProfileIds);
  const settingsBgms = validBgmItems(draft);
  const isSiliconFlowSpeechToText = draft.speechToText.provider === 'siliconflow';
  const sections = [
    ['appearance', Palette, '外观', '明暗主题', state.ui.theme === 'dark' ? '深色' : '浅色'],
    ['llm', Sparkles, 'LLM', '文案与分镜', settingsStatusLabel(configTargetStatus('llm', draft))],
    ['image', ImageIcon, 'AI 绘图', '分镜图片', settingsStatusLabel(configTargetStatus('image', draft))],
    ['tts', Bot, 'TTS 配音', '每镜语音', settingsStatusLabel(configTargetStatus('tts', draft))],
    ['speechToText', Mic2, '语音转文字', '爆款拆解转写 API', settingsStatusLabel(configTargetStatus('speechToText', draft))],
    ['jianying', FolderOpen, '剪映', '草稿目录 · BGM', settingsStatusLabel(configTargetStatus('jianying', draft))],
    ['activation', KeyRound, '激活与订阅', '试用 · 激活码', state.activation.status],
    ['creative', Wand2, 'AI 创作', 'IMA 知识库', settingsStatusLabel(configTargetStatus('creative', draft))],
    ['about', Info, '关于 · 诊断', '日志 · 重置', '已配置'],
  ] as const;
  return (
    <div className="settings-layout">
      <section className="settings-menu">
        {sections.map(([id, Icon, label, hint, status]) => (
          <button key={id} className={section === id ? 'settings-tab active' : 'settings-tab'} onClick={() => setSection(id)}>
            <Icon size={16} />
            <strong>{label}</strong>
            <span>{hint}</span>
            <small>{status}</small>
          </button>
        ))}
      </section>
      <section className="settings-content panel">
        <div className="panel-title-row">
          <div className="settings-heading">
            <div className="square-icon"><Sparkles size={18} /></div>
            <div><h2>{sections.find(([id]) => id === section)?.[2]}</h2><span>配置 API 凭证与本地路径</span></div>
          </div>
          <div className="button-row">
            <button className="ghost-action" disabled={testingConfig || savingConfig} onClick={testCurrentConfig}>
              {testingConfig ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}
              保存并测试
            </button>
            <button className="primary-action slim" disabled={savingConfig} onClick={save}>
              {savingConfig ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
              保存配置
            </button>
          </div>
        </div>
        {configTestResult ? <div className="test-result">{configTestResult}</div> : null}
        {section === 'appearance' ? (
          <SettingsCard title="界面主题" status={state.ui.theme === 'dark' ? '深色' : '浅色'}>
            <Segmented
              label="主题"
              value={state.ui.theme}
              options={['dark', 'light']}
              labels={['深色', '浅色']}
              onChange={(value) => void selectTheme(value as AppState['ui']['theme'])}
            />
            <InlineActionFeedback feedback={themeAction.feedback} />
          </SettingsCard>
        ) : null}
        <InlineActionFeedback feedback={settingsAction.feedback} />
        {section === 'llm' ? (
          <SettingsCard title="LLM 配置档案" status={secrets.configured(profileSecretId('llm', selectedLlmProfileId, 'apiKey')) ? '已配置' : '待配置'}>
            <LlmProfileManager
              config={draft}
              selectedProfileId={selectedLlmProfileId}
              models={modelLists.llm}
              loadingModels={loadingModelList === 'llm'}
              modelStatus={modelListStatus.llm}
              saving={savingConfig}
              secrets={secrets}
              onChange={setSettingsDraft}
              onSelectedProfileIdChange={setSelectedLlmProfileId}
              onActivate={activateLlmProfile}
              onClearModels={() => clearProviderModels('llm')}
              onRefreshModels={(profile) => {
                const secret = secrets.reference(profileSecretId('llm', profile.id, 'apiKey'));
                return refreshProviderModels('llm', { baseUrl: profile.baseUrl, apiKey: secret.value, protocol: profile.protocol, secretId: secret.secretId }, profile.model);
              }}
            />
          </SettingsCard>
        ) : null}
        {section === 'image' ? (
          <SettingsCard
            title="AI 绘图"
            status={secrets.configured(profileSecretId('image', selectedImageProfileId, selectedImageTestConfig.imageProvider === 'jimeng' ? 'jimeng/accessKeyId' : selectedImageTestConfig.imageProvider === 'custom' ? 'customImage/apiKey' : 'gptImage/apiKey')) ? '已配置' : '待配置'}
          >
            <ImageProfileManager
              config={draft}
              selectedProfileId={selectedImageProfileId}
              gptModels={modelLists['gpt-image']}
              customModels={modelLists['custom-image']}
              loadingModelList={loadingModelList}
              modelStatus={modelListStatus}
              saving={savingConfig}
              secrets={secrets}
              onChange={setSettingsDraft}
              onSelectedProfileIdChange={setSelectedImageProfileId}
              onActivate={activateImageProfile}
              onClearModels={clearProviderModels}
              onRefreshModels={refreshProviderModels}
            />
          </SettingsCard>
        ) : null}
        {section === 'tts' ? (
          <SettingsCard title="TTS 配音" status={secrets.configured(profileSecretId('tts', selectedTtsProfileId, selectedTtsTestConfig.tts.provider === 'minimax' ? 'minimax/apiKey' : 'volcengine/apiKey')) ? '已配置' : '待配置'}>
            <TtsProfileManager
              config={draft}
              selectedProfileId={selectedTtsProfileId}
              cloneVoiceCount={state.minimaxCloneVoices.length}
              volcengineSpeakers={volcengineSpeakers}
              loadingVolcengineSpeakers={loadingVolcengineSpeakers}
              volcengineSpeakerStatus={volcengineSpeakerStatus}
              saving={savingConfig}
              secrets={secrets}
              onChange={setSettingsDraft}
              onSelectedProfileIdChange={setSelectedTtsProfileId}
              onActivate={activateTtsProfile}
              onRefreshVolcengineSpeakers={refreshVolcengineSpeakers}
            />
          </SettingsCard>
        ) : null}
        {section === 'speechToText' ? (
          <SettingsCard title="语音转文字" status={secrets.configured('speechToText/apiKey') ? '已配置' : '待配置'}>
            <ProviderConfigNote
              title="转写 API"
              value="OpenAI 兼容 /audio/transcriptions；SiliconFlow 使用 file、model，默认 FunAudioLLM/SenseVoiceSmall，也可选 TeleAI/TeleSpeechASR。"
            />
            <Segmented
              label="供应商"
              value={draft.speechToText.provider}
              options={['openai-compatible', 'siliconflow']}
              labels={['OpenAI 兼容', 'SiliconFlow']}
              onChange={(value) => switchSpeechToTextProvider(value as AppConfig['speechToText']['provider'])}
            />
            <ConfigInput label="接口地址" value={draft.speechToText.baseUrl} onChange={(value) => updateSpeechToTextConfig({ baseUrl: value })} />
            <SecretInput
              label="接口密钥"
              value={secrets.value('speechToText/apiKey')}
              configured={secrets.configured('speechToText/apiKey')}
              onChange={(value) => secrets.change('speechToText/apiKey', value)}
              onClear={() => secrets.change('speechToText/apiKey', null)}
            />
            {isSiliconFlowSpeechToText ? (
              <Segmented
                label="转写模型"
                value={draft.speechToText.model}
                options={siliconFlowSpeechToTextModels}
                onChange={(value) => updateSpeechToTextConfig({ model: value })}
              />
            ) : (
              <ConfigInput label="转写模型" value={draft.speechToText.model} onChange={(value) => updateSpeechToTextConfig({ model: value })} />
            )}
            <ConfigInput label="语言" value={draft.speechToText.language} onChange={(value) => updateSpeechToTextConfig({ language: value })} />
            <ConfigInput label="提示词" value={draft.speechToText.prompt} onChange={(value) => updateSpeechToTextConfig({ prompt: value })} />
            {isSiliconFlowSpeechToText ? (
              <LocalInfo title="SiliconFlow 参数" value="按官方接口只提交 file 和 model，上传上限 50MB。language、prompt、temperature、时间戳和切分策略不会随请求发送。" />
            ) : (
              <Segmented
                label="响应格式"
                value={draft.speechToText.responseFormat}
                options={['json', 'verbose_json', 'text', 'srt', 'vtt']}
                labels={['JSON', 'Verbose JSON', 'Text', 'SRT', 'VTT']}
                onChange={(value) => updateSpeechToTextConfig({ responseFormat: value as AppConfig['speechToText']['responseFormat'] })}
              />
            )}
            {!isSiliconFlowSpeechToText ? <RangeField label="温度" min={0} max={1} step={0.1} value={draft.speechToText.temperature} onChange={(value) => updateSpeechToTextConfig({ temperature: value })} /> : null}
            <ConfigNumberInput
              label="请求超时（秒）"
              value={Math.round(draft.speechToText.timeoutMs / 1000)}
              min={10}
              step={10}
              onChange={(value) => updateSpeechToTextConfig({ timeoutMs: value * 1000 })}
            />
            {!isSiliconFlowSpeechToText ? (
              <Field label="时间戳">
                <div className="settings-inline-actions">
                  <ToggleField
                    label="段落级"
                    checked={draft.speechToText.timestampGranularities.includes('segment')}
                    onChange={(checked) => toggleSpeechToTextTimestamp('segment', checked)}
                  />
                  <ToggleField
                    label="词级"
                    checked={draft.speechToText.timestampGranularities.includes('word')}
                    onChange={(checked) => toggleSpeechToTextTimestamp('word', checked)}
                  />
                </div>
              </Field>
            ) : null}
            {!isSiliconFlowSpeechToText ? (
              <Segmented
                label="切分策略"
                value={draft.speechToText.chunkingStrategy}
                options={['none', 'auto']}
                labels={['不启用', '自动']}
                onChange={(value) => updateSpeechToTextConfig({ chunkingStrategy: value as AppConfig['speechToText']['chunkingStrategy'] })}
              />
            ) : null}
          </SettingsCard>
        ) : null}
        {section === 'jianying' ? (
          <SettingsCard title="剪映草稿与 BGM" status={draft.jianying.draftPath ? '已配置' : '待配置'}>
            <ConfigInput label="草稿目录" value={draft.jianying.draftPath} onChange={(value) => setSettingsDraft({ ...draft, jianying: { ...draft.jianying, draftPath: value } })} />
            <div className="settings-inline-actions">
              <button className="ghost-action" type="button" onClick={autoDetectJianyingDraftPath}><Search size={15} />自动检测</button>
              <button className="ghost-action" type="button" onClick={pickJianyingDraftPath}><FolderOpen size={15} />选择目录</button>
            </div>
            <LocalInfo title="BGM 库" value={settingsBgms.length ? settingsBgms.map((bgm) => bgm.title).join('、') : 'BGM 库为空'} />
            <button className="ghost-action" type="button" onClick={uploadBgmFromSettings}><Upload size={15} />+ 添加 BGM 文件</button>
            <div className="bgm-library-list">
              {settingsBgms.length === 0 ? <div className="bgm-library-empty">BGM 库为空</div> : null}
              {settingsBgms.map((bgm) => (
                <div key={bgm.id} className="bgm-library-item">
                  <div>
                    <strong>{bgm.title}</strong>
                    <span>{bgm.path}</span>
                  </div>
                  <label>
                    音量
                    <input type="number" min="0" max="1" step="0.05" value={bgm.volume} onChange={(event) => updateBgmVolume(bgm.id, Number(event.target.value))} />
                  </label>
                  <button className={draft.jianying.defaultBgmId === bgm.id ? 'mini-button active' : 'mini-button'} type="button" onClick={() => setDefaultBgm(bgm.id)}>
                    {draft.jianying.defaultBgmId === bgm.id ? '默认' : '设为默认'}
                  </button>
                  <button className="mini-button" type="button" onClick={() => removeBgm(bgm.id)}>移除</button>
                </div>
              ))}
            </div>
          </SettingsCard>
        ) : null}
        {section === 'activation' ? <LocalInfo title="激活与订阅" value={state.activation.message} /> : null}
        {section === 'creative' ? (
          <SettingsCard title="AI 创作 / IMA 知识库" status={secrets.configured('ima/apiKey') ? '已配置' : '待配置'}>
            <ConfigInput label="客户端 ID" value={draft.ima.clientId} onChange={(value) => setSettingsDraft({ ...draft, ima: { ...draft.ima, clientId: value } })} />
            <SecretInput
              label="接口密钥"
              value={secrets.value('ima/apiKey')}
              configured={secrets.configured('ima/apiKey')}
              onChange={(value) => secrets.change('ima/apiKey', value)}
              onClear={() => secrets.change('ima/apiKey', null)}
            />
            <ConfigInput label="知识库名称" value={draft.ima.kbName} onChange={(value) => setSettingsDraft({ ...draft, ima: { ...draft.ima, kbName: value } })} />
            <button className="ghost-action">测试并拉取知识库</button>
          </SettingsCard>
        ) : null}
        {section === 'about' ? (
          <div className="diagnostics-card">
            <LocalInfo title="视频故事创作助手" value="v0.10.4 · beta · Windows · 本地数据目录" />
            <div className="button-row">
              <button className="ghost-action" onClick={runDiagnostics}>检查诊断</button>
              <button className="ghost-action" onClick={() => navigator.clipboard?.writeText(diagnostics)}>
                <Copy size={15} />
                复制诊断报告
              </button>
              <button className="danger-action"><XCircle size={15} />清理历史</button>
            </div>
            <pre>{diagnostics || '点击检查诊断后显示 LLM、TTS、BGM、剪映目录、账户状态等检查结果。'}</pre>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function LlmProfileManager({
  config,
  selectedProfileId,
  models,
  loadingModels,
  modelStatus,
  saving,
  secrets,
  onChange,
  onSelectedProfileIdChange,
  onActivate,
  onClearModels,
  onRefreshModels,
}: {
  config: AppConfig;
  selectedProfileId: string;
  models: ProviderModel[];
  loadingModels: boolean;
  modelStatus?: string;
  saving: boolean;
  secrets: SecretEditor;
  onChange: (config: AppConfig) => void;
  onSelectedProfileIdChange: (id: string) => void;
  onActivate: (id: string) => Promise<void>;
  onClearModels: () => void;
  onRefreshModels: (profile: AppConfig['llm']) => void;
}) {
  const profiles = config.llmProfiles.length ? config.llmProfiles : [config.llm];
  const activeId = activeLlmProfileId(config);
  const profileIds = profiles.map((profile) => profile.id).join('|');

  useEffect(() => {
    if (!profiles.some((profile) => profile.id === selectedProfileId)) {
      onSelectedProfileIdChange(activeId);
    }
  }, [activeId, onSelectedProfileIdChange, profileIds, profiles, selectedProfileId]);

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles.find((profile) => profile.id === activeId) ?? profiles[0];

  function updateSelectedProfile(profile: AppConfig['llm']) {
    onChange(saveLlmProfile(config, profile));
  }

  function addProfile() {
    const next = addLlmProfile(config);
    onChange(next);
    onSelectedProfileIdChange(next.llmProfiles[0]?.id ?? activeId);
  }

  function duplicateProfile(profile: AppConfig['llm']) {
    const next = copyLlmProfile(config, profile.id!);
    onChange(next);
    const currentIndex = config.llmProfiles.findIndex((item) => item.id === profile.id);
    onSelectedProfileIdChange(next.llmProfiles[Math.max(0, currentIndex + 1)]?.id ?? profile.id!);
  }

  function deleteProfile(profile: AppConfig['llm']) {
    const next = removeLlmProfile(config, profile.id!);
    onChange(next);
    onSelectedProfileIdChange(activeLlmProfileId(next));
  }

  if (!selectedProfile) return <ArtifactEmpty text="暂无 LLM 配置档案" />;

  const selectedProvider = editableLlmProfileProvider(selectedProfile);
  const apiKeyId = profileSecretId('llm', selectedProfile.id, 'apiKey');
  const requestParamsJsonValue = selectedProfile.requestParamsJson ?? '{}';
  return (
    <div className="llm-profile-manager">
      <div className="profile-switcher-head">
        <div>
          <strong>配置档案</strong>
          <span>可保存多个 OpenAI 兼容接口，启用一个作为任务运行配置。</span>
        </div>
        <button className="ghost-action" type="button" onClick={addProfile}>
          <Plus size={15} />
          新增配置
        </button>
      </div>

      <div className="profile-switcher-list">
        {profiles.map((profile) => {
          const isActive = profile.id === activeId;
          const isSelected = profile.id === selectedProfile.id;
          return (
            <article
              className={isActive ? 'provider-profile-card active' : isSelected ? 'provider-profile-card selected' : 'provider-profile-card'}
              data-profile-card
              key={profile.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectedProfileIdChange(profile.id!)}
              onKeyDown={(event) => event.key === 'Enter' && onSelectedProfileIdChange(profile.id!)}
            >
              <div className="profile-drag-dot">⋮⋮</div>
              <div className="profile-avatar">{profile.name?.slice(0, 1).toUpperCase() || 'C'}</div>
              <div className="profile-copy">
                <strong>{profile.name || '未命名配置'}</strong>
                <span>{profile.baseUrl || 'https://api.openai.com'}</span>
                <small>{profile.model || '未选择模型'}</small>
              </div>
              <div className="profile-actions">
                {isActive ? (
                  <span className="profile-active-badge">启用中</span>
                ) : (
                  <button
                    className="primary-action slim"
                    type="button"
                    disabled={saving}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectedProfileIdChange(profile.id!);
                      void onActivate(profile.id!);
                    }}
                  >
                    {saving ? <Loader2 className="spin" size={14} /> : <Play size={14} />}
                    启用
                  </button>
                )}
                <button className="icon-button" type="button" title="编辑" onClick={(event) => { event.stopPropagation(); onSelectedProfileIdChange(profile.id!); }}>
                  <Palette size={14} />
                </button>
                <button className="icon-button" type="button" title="复制" onClick={(event) => { event.stopPropagation(); duplicateProfile(profile); }}>
                  <Copy size={14} />
                </button>
                <button className="icon-button" type="button" title="删除" disabled={profiles.length <= 1} onClick={(event) => { event.stopPropagation(); deleteProfile(profile); }}>
                  <XCircle size={14} />
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="profile-editor-grid">
        <ConfigInput label="配置名称" value={selectedProfile.name ?? ''} onChange={(value) => updateSelectedProfile({ ...selectedProfile, name: value })} />
        <ConfigNumberInput
          label="请求超时（秒）"
          value={Math.round((selectedProfile.timeoutMs ?? defaultConfig.llm.timeoutMs ?? 120000) / 1000)}
          min={10}
          step={10}
          onChange={(value) => updateSelectedProfile({ ...selectedProfile, timeoutMs: value * 1000 })}
        />
        <Segmented
          label="供应商"
          value={selectedProvider}
          options={['openai', 'custom', 'anthropic']}
          labels={['OpenAI', '自定义', 'Anthropic']}
          onChange={(value) => {
            onClearModels();
            updateSelectedProfile({
              ...selectedProfile,
              provider: value,
              protocol: value === 'anthropic' ? 'anthropic' : 'openai',
              baseUrl:
                value === 'openai'
                  ? 'https://api.openai.com'
                  : value === 'anthropic'
                    ? selectedProfile.baseUrl === 'https://api.openai.com' || selectedProfile.baseUrl === defaultConfig.llm.baseUrl
                      ? 'https://api.anthropic.com'
                      : selectedProfile.baseUrl
                    : selectedProfile.baseUrl === 'https://api.openai.com' || selectedProfile.baseUrl === 'https://api.anthropic.com'
                      ? defaultConfig.llm.baseUrl
                      : selectedProfile.baseUrl,
            });
          }}
        />
        {selectedProvider === 'openai' ? (
          <>
            <ProviderConfigNote title="OpenAI 对话接口" value="使用官方 /v1/chat/completions，填写接口密钥与模型。" />
            <SecretInput label="OpenAI 接口密钥" value={secrets.value(apiKeyId)} configured={secrets.configured(apiKeyId)} onChange={(value) => { onClearModels(); secrets.change(apiKeyId, value); }} onClear={() => secrets.change(apiKeyId, null)} />
            <ModelPicker
              key={`llm-${selectedProfile.id}`}
              label="OpenAI 模型"
              value={selectedProfile.model}
              models={models}
              loading={loadingModels}
              status={modelStatus}
              onRefresh={() => onRefreshModels(selectedProfile)}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, model: value })}
            />
            <ConfigTextarea
              label="附加请求 JSON"
              hint={'Extra request JSON, e.g. {"reasoning_effort":"medium"}'}
              value={requestParamsJsonValue}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, requestParamsJson: value })}
            />
          </>
        ) : selectedProvider === 'anthropic' ? (
          <>
            <ProviderConfigNote title="Anthropic Messages API" value="使用 /v1/messages，填写 Anthropic 接口密钥与 Claude 模型。" />
            <ConfigInput label="Anthropic 接口地址" value={selectedProfile.baseUrl} onChange={(value) => { onClearModels(); updateSelectedProfile({ ...selectedProfile, provider: 'anthropic', protocol: 'anthropic', baseUrl: value }); }} />
            <SecretInput label="Anthropic 接口密钥" value={secrets.value(apiKeyId)} configured={secrets.configured(apiKeyId)} onChange={(value) => { onClearModels(); secrets.change(apiKeyId, value); }} onClear={() => secrets.change(apiKeyId, null)} />
            <ModelPicker
              key={`llm-${selectedProfile.id}`}
              label="Claude 模型"
              value={selectedProfile.model}
              models={models}
              loading={loadingModels}
              status={modelStatus}
              onRefresh={() => onRefreshModels({ ...selectedProfile, provider: 'anthropic', protocol: 'anthropic' })}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, provider: 'anthropic', protocol: 'anthropic', model: value })}
            />
            <ConfigTextarea
              label="附加请求 JSON"
              hint={'Extra request JSON, e.g. {"temperature":0,"max_tokens":4096}'}
              value={requestParamsJsonValue}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, provider: 'anthropic', protocol: 'anthropic', requestParamsJson: value })}
            />
          </>
        ) : (
          <>
            <ProviderConfigNote title="OpenAI 兼容 LLM" value="自定义接口按 /chat/completions 调用，需要接口地址、接口密钥与模型。" />
            <ConfigInput label="接口地址" value={selectedProfile.baseUrl} onChange={(value) => { onClearModels(); updateSelectedProfile({ ...selectedProfile, baseUrl: value }); }} />
            <SecretInput label="接口密钥" value={secrets.value(apiKeyId)} configured={secrets.configured(apiKeyId)} onChange={(value) => { onClearModels(); secrets.change(apiKeyId, value); }} onClear={() => secrets.change(apiKeyId, null)} />
            <ModelPicker
              key={`llm-${selectedProfile.id}`}
              label="模型"
              value={selectedProfile.model}
              models={models}
              loading={loadingModels}
              status={modelStatus}
              onRefresh={() => onRefreshModels(selectedProfile)}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, model: value })}
            />
            <ConfigTextarea
              label="附加请求 JSON"
              hint={'Extra request JSON, e.g. {"reasoning_effort":"medium"}'}
              value={requestParamsJsonValue}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, requestParamsJson: value })}
            />
          </>
        )}
      </div>
    </div>
  );
}

function ImageProfileManager({
  config,
  selectedProfileId,
  gptModels,
  customModels,
  loadingModelList,
  modelStatus,
  saving,
  secrets,
  onChange,
  onSelectedProfileIdChange,
  onActivate,
  onClearModels,
  onRefreshModels,
}: {
  config: AppConfig;
  selectedProfileId: string;
  gptModels: ProviderModel[];
  customModels: ProviderModel[];
  loadingModelList: ModelListKey | null;
  modelStatus: Partial<Record<ModelListKey, string>>;
  saving: boolean;
  secrets: SecretEditor;
  onChange: (config: AppConfig) => void;
  onSelectedProfileIdChange: (id: string) => void;
  onActivate: (id: string) => Promise<void>;
  onClearModels: (key: ModelListKey) => void;
  onRefreshModels: (key: ModelListKey, request: ProviderModelListRequest, currentModel: string, applyModel?: (config: AppConfig, model: string) => AppConfig) => void;
}) {
  const profiles = normalizedImageProfiles(config);
  const activeId = activeImageProfileId(config);
  const profileIds = profiles.map((profile) => profile.id).join('|');

  useEffect(() => {
    if (!profiles.some((profile) => profile.id === selectedProfileId)) {
      onSelectedProfileIdChange(activeId);
    }
  }, [activeId, onSelectedProfileIdChange, profileIds, profiles, selectedProfileId]);

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles.find((profile) => profile.id === activeId) ?? profiles[0];
  if (!selectedProfile) return <ArtifactEmpty text="暂无绘图配置档案" />;

  const provider = selectedProfile.provider;
  const gptImage = imageProfileGptImage(selectedProfile);
  const jimeng = imageProfileJimeng(selectedProfile);
  const customImage = imageProfileCustomImage(selectedProfile);
  const gptApiKeyId = profileSecretId('image', selectedProfile.id, 'gptImage/apiKey');
  const jimengSessionId = profileSecretId('image', selectedProfile.id, 'jimeng/sessionId');
  const jimengAccessKeyId = profileSecretId('image', selectedProfile.id, 'jimeng/accessKeyId');
  const jimengSecretAccessKeyId = profileSecretId('image', selectedProfile.id, 'jimeng/secretAccessKey');
  const customApiKeyId = profileSecretId('image', selectedProfile.id, 'customImage/apiKey');

  function updateSelectedProfile(profile: ImageProviderProfile) {
    onChange(saveImageProfile(config, profile));
  }

  function addProfile() {
    const next = addImageProfile(config);
    onChange(next);
    onSelectedProfileIdChange(next.imageProfiles[0]?.id ?? activeId);
  }

  function duplicateProfile(profile: ImageProviderProfile) {
    const next = copyImageProfile(config, profile.id!);
    onChange(next);
    const currentIndex = profiles.findIndex((item) => item.id === profile.id);
    onSelectedProfileIdChange(next.imageProfiles[Math.max(0, currentIndex + 1)]?.id ?? profile.id!);
  }

  function deleteProfile(profile: ImageProviderProfile) {
    const next = removeImageProfile(config, profile.id!);
    onChange(next);
    onSelectedProfileIdChange(activeImageProfileId(next));
  }

  return (
    <div className="llm-profile-manager">
      <div className="profile-switcher-head">
        <div>
          <strong>绘图档案</strong>
          <span>可保存 GPT Image、即梦和自定义图片接口，启用一个作为任务生图配置。</span>
        </div>
        <button className="ghost-action" type="button" onClick={addProfile}>
          <Plus size={15} />
          新增配置
        </button>
      </div>

      <div className="profile-switcher-list">
        {profiles.map((profile) => {
          const isActive = profile.id === activeId;
          const isSelected = profile.id === selectedProfile.id;
          return (
            <article
              className={isActive ? 'provider-profile-card active' : isSelected ? 'provider-profile-card selected' : 'provider-profile-card'}
              data-profile-card
              key={profile.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectedProfileIdChange(profile.id!)}
              onKeyDown={(event) => event.key === 'Enter' && onSelectedProfileIdChange(profile.id!)}
            >
              <div className="profile-drag-dot">⋮⋮</div>
              <div className="profile-avatar">{profile.name?.slice(0, 1).toUpperCase() || 'I'}</div>
              <div className="profile-copy">
                <strong>{profile.name || '未命名绘图配置'}</strong>
                <span>{imageProviderLabel(profile.provider)}</span>
                <small>{imageProfileSummary(profile)}</small>
              </div>
              <div className="profile-actions">
                {isActive ? (
                  <span className="profile-active-badge">启用中</span>
                ) : (
                  <button
                    className="primary-action slim"
                    type="button"
                    disabled={saving}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectedProfileIdChange(profile.id!);
                      void onActivate(profile.id!);
                    }}
                  >
                    {saving ? <Loader2 className="spin" size={14} /> : <Play size={14} />}
                    启用
                  </button>
                )}
                <button className="icon-button" type="button" title="编辑" onClick={(event) => { event.stopPropagation(); onSelectedProfileIdChange(profile.id!); }}>
                  <Palette size={14} />
                </button>
                <button className="icon-button" type="button" title="复制" onClick={(event) => { event.stopPropagation(); duplicateProfile(profile); }}>
                  <Copy size={14} />
                </button>
                <button className="icon-button" type="button" title="删除" disabled={profiles.length <= 1} onClick={(event) => { event.stopPropagation(); deleteProfile(profile); }}>
                  <XCircle size={14} />
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="profile-editor-grid">
        <ConfigInput label="配置名称" value={selectedProfile.name ?? ''} onChange={(value) => updateSelectedProfile({ ...selectedProfile, name: value })} />
        <Segmented
          label="供应商"
          value={provider}
          options={['gpt_image', 'jimeng', 'custom']}
          labels={['GPT Image', '即梦', '自定义']}
          onChange={(value) => {
            onClearModels('gpt-image');
            onClearModels('custom-image');
            updateSelectedProfile({ ...selectedProfile, provider: value as ImageProviderProfile['provider'] });
          }}
        />
        {provider === 'gpt_image' ? (
          <>
            <ProviderConfigNote title="OpenAI 图像接口" value="接口密钥与模型必填；接口地址为空时使用官方默认端点。" />
            <ConfigInput label="GPT Image 接口地址（可选）" value={gptImage.baseUrl} onChange={(value) => { onClearModels('gpt-image'); updateSelectedProfile({ ...selectedProfile, gptImage: { ...gptImage, baseUrl: value } }); }} />
            <SecretInput label="GPT Image 接口密钥" value={secrets.value(gptApiKeyId)} configured={secrets.configured(gptApiKeyId)} onChange={(value) => { onClearModels('gpt-image'); secrets.change(gptApiKeyId, value); }} onClear={() => secrets.change(gptApiKeyId, null)} />
            <ModelPicker
              key={`gpt-image-${selectedProfile.id}`}
              label="GPT Image 模型"
              value={gptImage.model}
              models={gptModels}
              loading={loadingModelList === 'gpt-image'}
              status={modelStatus['gpt-image']}
              onRefresh={() => onRefreshModels(
                'gpt-image',
                { baseUrl: gptImage.baseUrl || 'https://api.openai.com', apiKey: secrets.reference(gptApiKeyId).value, secretId: secrets.reference(gptApiKeyId).secretId },
                gptImage.model,
                (current, model) => saveImageProfile(current, { ...selectedProfile, gptImage: { ...gptImage, model } }),
              )}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, gptImage: { ...gptImage, model: value } })}
            />
            <Segmented label="分辨率" value={gptImage.resolution ?? '2K'} options={['1K', '2K', '4K']} onChange={(value) => updateSelectedProfile({ ...selectedProfile, gptImage: { ...gptImage, resolution: value as ImageResolution } })} />
            <Field label="并发"><input type="range" min="1" max="6" value={gptImage.concurrency} onChange={(event) => updateSelectedProfile({ ...selectedProfile, gptImage: { ...gptImage, concurrency: Number(event.target.value) } })} /></Field>
          </>
        ) : null}
        {provider === 'jimeng' ? (
          <>
            <ProviderConfigNote title="火山视觉接口" value={`端点 ${jimeng.endpoint || 'https://visual.volcengineapi.com'} · 区域 ${jimeng.region || 'cn-north-1'} · 服务 ${jimeng.service || 'cv'}`} />
            <SecretInput label="即梦 Session ID" value={secrets.value(jimengSessionId)} configured={secrets.configured(jimengSessionId)} onChange={(value) => secrets.change(jimengSessionId, value)} onClear={() => secrets.change(jimengSessionId, null)} />
            <SecretInput label="即梦访问密钥 ID" value={secrets.value(jimengAccessKeyId)} configured={secrets.configured(jimengAccessKeyId)} onChange={(value) => secrets.change(jimengAccessKeyId, value)} onClear={() => secrets.change(jimengAccessKeyId, null)} />
            <SecretInput label="即梦访问密钥 Secret" value={secrets.value(jimengSecretAccessKeyId)} configured={secrets.configured(jimengSecretAccessKeyId)} onChange={(value) => secrets.change(jimengSecretAccessKeyId, value)} onClear={() => secrets.change(jimengSecretAccessKeyId, null)} />
            <ConfigInput label="即梦请求 Key" value={jimeng.reqKey ?? ''} onChange={(value) => updateSelectedProfile({ ...selectedProfile, jimeng: { ...jimeng, reqKey: value } })} />
            <Segmented label="分辨率" value={jimeng.resolution} options={['1K', '2K', '4K']} onChange={(value) => updateSelectedProfile({ ...selectedProfile, jimeng: { ...jimeng, resolution: value as ImageResolution } })} />
            <Field label="并发"><input type="range" min="1" max="6" value={jimeng.concurrency} onChange={(event) => updateSelectedProfile({ ...selectedProfile, jimeng: { ...jimeng, concurrency: Number(event.target.value) } })} /></Field>
          </>
        ) : null}
        {provider === 'custom' ? (
          <>
            <ProviderConfigNote title="OpenAI 兼容接口" value="自定义图片接口按 /images/generations 调用，需要接口地址、接口密钥与模型。" />
            <ConfigInput label="自定义接口地址" value={customImage.baseUrl} onChange={(value) => { onClearModels('custom-image'); updateSelectedProfile({ ...selectedProfile, customImage: { ...customImage, baseUrl: value } }); }} />
            <SecretInput label="自定义接口密钥" value={secrets.value(customApiKeyId)} configured={secrets.configured(customApiKeyId)} onChange={(value) => { onClearModels('custom-image'); secrets.change(customApiKeyId, value); }} onClear={() => secrets.change(customApiKeyId, null)} />
            <ModelPicker
              key={`custom-image-${selectedProfile.id}`}
              label="自定义模型"
              value={customImage.model}
              models={customModels}
              loading={loadingModelList === 'custom-image'}
              status={modelStatus['custom-image']}
              onRefresh={() => onRefreshModels(
                'custom-image',
                { baseUrl: customImage.baseUrl, apiKey: secrets.reference(customApiKeyId).value, secretId: secrets.reference(customApiKeyId).secretId },
                customImage.model,
                (current, model) => saveImageProfile(current, { ...selectedProfile, customImage: { ...customImage, model } }),
              )}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, customImage: { ...customImage, model: value } })}
            />
            <Segmented label="分辨率" value={customImage.resolution ?? '2K'} options={['1K', '2K', '4K']} onChange={(value) => updateSelectedProfile({ ...selectedProfile, customImage: { ...customImage, resolution: value as ImageResolution } })} />
            <Field label="并发"><input type="range" min="1" max="6" value={customImage.concurrency} onChange={(event) => updateSelectedProfile({ ...selectedProfile, customImage: { ...customImage, concurrency: Number(event.target.value) } })} /></Field>
          </>
        ) : null}
      </div>
    </div>
  );
}

function TtsProfileManager({
  config,
  selectedProfileId,
  cloneVoiceCount,
  volcengineSpeakers,
  loadingVolcengineSpeakers,
  volcengineSpeakerStatus,
  saving,
  secrets,
  onChange,
  onSelectedProfileIdChange,
  onActivate,
  onRefreshVolcengineSpeakers,
}: {
  config: AppConfig;
  selectedProfileId: string;
  cloneVoiceCount: number;
  volcengineSpeakers: VolcengineSpeaker[];
  loadingVolcengineSpeakers: boolean;
  volcengineSpeakerStatus?: string;
  saving: boolean;
  secrets: SecretEditor;
  onChange: (config: AppConfig) => void;
  onSelectedProfileIdChange: (id: string) => void;
  onActivate: (id: string) => Promise<void>;
  onRefreshVolcengineSpeakers: (profile: TtsProviderProfile) => void;
}) {
  const profiles = normalizedTtsProfiles(config);
  const activeId = activeTtsProfileId(config);
  const profileIds = profiles.map((profile) => profile.id).join('|');

  useEffect(() => {
    if (!profiles.some((profile) => profile.id === selectedProfileId)) {
      onSelectedProfileIdChange(activeId);
    }
  }, [activeId, onSelectedProfileIdChange, profileIds, profiles, selectedProfileId]);

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles.find((profile) => profile.id === activeId) ?? profiles[0];
  const availableVolcengineVoices = useMemo(() => buildVolcengineVoiceOptions(volcengineSpeakers), [volcengineSpeakers]);
  if (!selectedProfile) return <ArtifactEmpty text="暂无 TTS 配置档案" />;

  const provider = selectedProfile.provider;
  const volcengine = ttsProfileVolcengine(selectedProfile);
  const minimax = ttsProfileMinimax(selectedProfile);
  const voiceSelection = volcenginePresetVoiceValue(volcengine.speaker, availableVolcengineVoices);
  const volcengineApiKeyId = profileSecretId('tts', selectedProfile.id, 'volcengine/apiKey');
  const volcengineAccessKeyId = profileSecretId('tts', selectedProfile.id, 'volcengine/accessKeyId');
  const volcengineSecretAccessKeyId = profileSecretId('tts', selectedProfile.id, 'volcengine/secretAccessKey');
  const minimaxApiKeyId = profileSecretId('tts', selectedProfile.id, 'minimax/apiKey');

  function updateSelectedProfile(profile: TtsProviderProfile) {
    onChange(saveTtsProfile(config, profile));
  }

  function updateVolcengineVoice(voiceType: string) {
    updateSelectedProfile({ ...selectedProfile, speaker: voiceType, volcengine: { ...volcengine, speaker: voiceType } });
  }

  function addProfile() {
    const next = addTtsProfile(config);
    onChange(next);
    onSelectedProfileIdChange(next.ttsProfiles[0]?.id ?? activeId);
  }

  function duplicateProfile(profile: TtsProviderProfile) {
    const next = copyTtsProfile(config, profile.id!);
    onChange(next);
    const currentIndex = profiles.findIndex((item) => item.id === profile.id);
    onSelectedProfileIdChange(next.ttsProfiles[Math.max(0, currentIndex + 1)]?.id ?? profile.id!);
  }

  function deleteProfile(profile: TtsProviderProfile) {
    const next = removeTtsProfile(config, profile.id!);
    onChange(next);
    onSelectedProfileIdChange(activeTtsProfileId(next));
  }

  return (
    <div className="llm-profile-manager">
      <div className="profile-switcher-head">
        <div>
          <strong>TTS 档案</strong>
          <span>可保存火山引擎与 MiniMax 配音配置，启用一个作为任务配音配置。</span>
        </div>
        <button className="ghost-action" type="button" onClick={addProfile}>
          <Plus size={15} />
          新增配置
        </button>
      </div>

      <div className="profile-switcher-list">
        {profiles.map((profile) => {
          const isActive = profile.id === activeId;
          const isSelected = profile.id === selectedProfile.id;
          return (
            <article
              className={isActive ? 'provider-profile-card active' : isSelected ? 'provider-profile-card selected' : 'provider-profile-card'}
              data-profile-card
              key={profile.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectedProfileIdChange(profile.id!)}
              onKeyDown={(event) => event.key === 'Enter' && onSelectedProfileIdChange(profile.id!)}
            >
              <div className="profile-drag-dot">⋮⋮</div>
              <div className="profile-avatar">{profile.name?.slice(0, 1).toUpperCase() || 'T'}</div>
              <div className="profile-copy">
                <strong>{profile.name || '未命名 TTS 配置'}</strong>
                <span>{ttsProviderLabel(profile.provider)}</span>
                <small>{ttsProfileSummary(profile)}</small>
              </div>
              <div className="profile-actions">
                {isActive ? (
                  <span className="profile-active-badge">启用中</span>
                ) : (
                  <button
                    className="primary-action slim"
                    type="button"
                    disabled={saving}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectedProfileIdChange(profile.id!);
                      void onActivate(profile.id!);
                    }}
                  >
                    {saving ? <Loader2 className="spin" size={14} /> : <Play size={14} />}
                    启用
                  </button>
                )}
                <button className="icon-button" type="button" title="编辑" onClick={(event) => { event.stopPropagation(); onSelectedProfileIdChange(profile.id!); }}>
                  <Palette size={14} />
                </button>
                <button className="icon-button" type="button" title="复制" onClick={(event) => { event.stopPropagation(); duplicateProfile(profile); }}>
                  <Copy size={14} />
                </button>
                <button className="icon-button" type="button" title="删除" disabled={profiles.length <= 1} onClick={(event) => { event.stopPropagation(); deleteProfile(profile); }}>
                  <XCircle size={14} />
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="profile-editor-grid">
        <ConfigInput label="配置名称" value={selectedProfile.name ?? ''} onChange={(value) => updateSelectedProfile({ ...selectedProfile, name: value })} />
        <Segmented
          label="引擎"
          value={provider}
          options={['volcengine', 'minimax']}
          labels={['火山引擎', 'MiniMax']}
          onChange={(value) => updateSelectedProfile({ ...selectedProfile, provider: value as TtsProviderProfile['provider'] })}
        />
        {provider === 'volcengine' ? (
          <>
            <ProviderConfigNote title="火山引擎 TTS" value="V3 HTTP Chunked 使用新版控制台 TTS 接口密钥；资源与端点使用系统默认配置。" />
            <SecretInput label="火山 TTS 接口密钥" value={secrets.value(volcengineApiKeyId)} configured={secrets.configured(volcengineApiKeyId)} onChange={(value) => secrets.change(volcengineApiKeyId, value)} onClear={() => secrets.change(volcengineApiKeyId, null)} />
            <SecretInput label="音色访问密钥 ID" value={secrets.value(volcengineAccessKeyId)} configured={secrets.configured(volcengineAccessKeyId)} onChange={(value) => secrets.change(volcengineAccessKeyId, value)} onClear={() => secrets.change(volcengineAccessKeyId, null)} />
            <SecretInput label="音色访问密钥 Secret" value={secrets.value(volcengineSecretAccessKeyId)} configured={secrets.configured(volcengineSecretAccessKeyId)} onChange={(value) => secrets.change(volcengineSecretAccessKeyId, value)} onClear={() => secrets.change(volcengineSecretAccessKeyId, null)} />
            <div className="settings-inline-actions">
              <button className="ghost-action" type="button" disabled={loadingVolcengineSpeakers} onClick={() => onRefreshVolcengineSpeakers(selectedProfile)}>
                {loadingVolcengineSpeakers ? <Loader2 className="spin" size={15} /> : <Search size={15} />}
                加载音色
              </button>
              {volcengineSpeakerStatus ? <span>{volcengineSpeakerStatus}</span> : null}
            </div>
            <Field label="默认音色">
              <div className="model-picker">
                <select value={voiceSelection} onChange={(event) => updateVolcengineVoice(event.target.value === 'custom' ? '' : event.target.value)}>
                  <option value="custom">自定义 voice_type</option>
                  {availableVolcengineVoices.map((voice) => (
                    <option key={voice.voiceType} value={voice.voiceType}>
                      {voice.label}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            {voiceSelection === 'custom' ? (
              <ConfigInput label="自定义 voice_type" value={volcengine.speaker} onChange={updateVolcengineVoice} />
            ) : null}
          </>
        ) : null}
        {provider === 'minimax' ? (
          <>
            <ProviderConfigNote title="MiniMax TTS" value="填写接口密钥、模型和音色 ID。" />
            <SecretInput label="MiniMax 接口密钥" value={secrets.value(minimaxApiKeyId)} configured={secrets.configured(minimaxApiKeyId)} onChange={(value) => secrets.change(minimaxApiKeyId, value)} onClear={() => secrets.change(minimaxApiKeyId, null)} />
            <ConfigInput label="MiniMax 模型" value={minimax.model} onChange={(value) => updateSelectedProfile({ ...selectedProfile, minimax: { ...minimax, model: value } })} />
            <ConfigInput label="MiniMax 音色 ID" value={minimax.voiceId} onChange={(value) => updateSelectedProfile({ ...selectedProfile, minimax: { ...minimax, voiceId: value } })} />
            <LocalInfo title="克隆音色" value={`${cloneVoiceCount} 个本地记录，可后续接入 MiniMax 克隆接口。`} />
          </>
        ) : null}
      </div>
    </div>
  );
}

function AccountPage({ api, state, applyState }: { api: StoryDreamApi; state: AppState; applyState: ApplyMutationResult }) {
  const [draft, setDraft] = useState(state.account);
  const accountAction = useAsyncAction();
  useEffect(() => setDraft(state.account), [state.account]);
  async function saveAccountProfile() {
    await accountAction.run(async () => {
      applyState(await api.saveAccount(draft));
    }, { successMessage: '账户资料已保存。' });
  }
  return (
    <section className="panel account-panel">
      <div className="profile-card">
        <div className="avatar">{draft.avatarInitial || 'S'}</div>
        <div>
          <h2>{draft.displayName}</h2>
          <span>{draft.email} · {draft.deviceId}</span>
        </div>
        <strong>{draft.balance.toFixed(2)} 积分</strong>
      </div>
      <ConfigInput label="显示名称" value={draft.displayName} onChange={(value) => setDraft({ ...draft, displayName: value, avatarInitial: value.slice(0, 1).toUpperCase() || 'S' })} />
      <ConfigInput label="邮箱" value={draft.email} onChange={(value) => setDraft({ ...draft, email: value })} />
      <ConfigInput label="工作区" value={draft.workspace} onChange={(value) => setDraft({ ...draft, workspace: value })} />
      <button className="primary-action slim" disabled={accountAction.busy} onClick={saveAccountProfile}><Save size={15} />保存资料</button>
      <InlineActionFeedback feedback={accountAction.feedback} />
      <LocalInfo title="账号与激活关系" value="本地复刻版只显示设备、账户和余额状态，不连接真实登录或付费系统。" />
    </section>
  );
}

function ActivationPage({ api, state, applyState }: { api: StoryDreamApi; state: AppState; applyState: ApplyMutationResult }) {
  const [draft, setDraft] = useState(state.activation);
  const activationAction = useAsyncAction();
  useEffect(() => setDraft(state.activation), [state.activation]);
  async function saveActivationState() {
    await activationAction.run(async () => {
      applyState(await api.saveActivation(draft));
    }, { successMessage: '本地激活状态已保存。' });
  }
  return (
    <div className="two-column">
      <section className="panel">
        <div className="panel-title-row">
          <h2>激活状态</h2>
          <StatusPill status={draft.status === 'active' ? 'completed' : 'paused'} />
        </div>
        <ConfigInput label="激活码" value={draft.code} onChange={(value) => setDraft({ ...draft, code: value })} />
        <Segmented label="计划" value={draft.plan} options={['trial', 'local', 'inactive']} labels={['试用', '本地激活', '未激活']} onChange={(value) => setDraft({ ...draft, plan: value as ActivationState['plan'] })} />
        <ConfigInput label="状态说明" value={draft.message} onChange={(value) => setDraft({ ...draft, message: value })} />
        <button className="primary-action slim" disabled={activationAction.busy} onClick={saveActivationState}><Save size={15} />保存状态</button>
        <InlineActionFeedback feedback={activationAction.feedback} />
      </section>
      <section className="panel faq-panel">
        <LocalInfo title="立即激活" value="这里是本地模拟状态页，不做真实购买、登录或付费限制。" />
        <LocalInfo title="常见问题" value="激活码、订阅、设备解绑均为本地 UI 状态，可用于后续接入真实服务。" />
      </section>
    </div>
  );
}

function SettingsCard({ title, status, children }: { title: string; status: string; children: React.ReactNode }) {
  return (
    <div className="config-card">
      <div className="config-card-head"><div><strong>{title}</strong><span>使用中</span></div><small>{status}</small></div>
      <div className="form-grid">{children}</div>
    </div>
  );
}

function ConfigInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="config-input"><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function SecretInput({
  label,
  value,
  configured,
  onChange,
  onClear,
}: {
  label: string;
  value: string;
  configured: boolean;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <label className="config-input secret-input">
      <span>{label}<small>{configured ? '已配置' : '待配置'}</small></span>
      <div className="secret-input-control">
        <input
          type={revealed ? 'text' : 'password'}
          value={value}
          autoComplete="new-password"
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
        <button className="icon-button" type="button" title={revealed ? '隐藏' : '显示'} aria-label={revealed ? '隐藏密钥' : '显示密钥'} onClick={() => setRevealed((current) => !current)}>
          {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
        <button className="icon-button" type="button" title="清除" aria-label="清除密钥" disabled={!configured && !value} onClick={onClear}>
          <Trash2 size={15} />
        </button>
      </div>
    </label>
  );
}

function ConfigTextarea({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  return (
    <label className="config-input config-textarea">
      <span>
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ConfigNumberInput({
  label,
  value,
  min,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="config-input">
      <span>{label}</span>
      <input type="number" min={min} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function ModelPicker({
  label,
  value,
  models,
  loading,
  status,
  onRefresh,
  onChange,
}: {
  label: string;
  value: string;
  models: ProviderModel[];
  loading: boolean;
  status?: string;
  onRefresh: () => void;
  onChange: (value: string) => void;
}) {
  const hasModels = models.length > 0;
  const options = hasModels && value && !models.some((model) => model.id === value) ? [{ id: value }, ...models] : models;
  return (
    <div className="field model-picker-field">
      <span>{label}</span>
      <div className="model-picker">
        {hasModels ? (
          <select value={value} onChange={(event) => onChange(event.target.value)}>
            {!value ? <option value="">选择模型</option> : null}
            {options.map((model) => (
              <option key={model.id} value={model.id}>
                {model.id}
              </option>
            ))}
          </select>
        ) : (
          <input value={value} onChange={(event) => onChange(event.target.value)} />
        )}
        <button className="icon-button model-refresh-button" title="获取模型" aria-label="获取模型" disabled={loading} onClick={onRefresh} type="button">
          {loading ? <Loader2 className="spin" size={15} /> : <RotateCcw size={15} />}
        </button>
      </div>
      {status ? <small className="model-list-status">{status}</small> : null}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}{hint ? <small>{hint}</small> : null}</span>{children}</label>;
}

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="draft-toggle-row">
      <span>{label}</span>
      <label className="draft-toggle-field draft-toggle-control">
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        <span className="draft-toggle-box" aria-hidden="true">{checked ? '✓' : ''}</span>
        <span>{checked ? '开启' : '关闭'}</span>
      </label>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Field label={label}>
      <div className="draft-color-field">
        <input type="color" value={normalizeColorInput(value)} onChange={(event) => onChange(event.target.value)} />
        <input value={value} onChange={(event) => onChange(event.target.value)} />
      </div>
    </Field>
  );
}

function RangeField({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <div className="draft-range-field">
        <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
        <input type="number" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      </div>
    </Field>
  );
}

function TextBorderControls({
  label,
  border,
  onChange,
}: {
  label?: string;
  border: DraftTextBorder;
  onChange: (patch: Partial<DraftTextBorder>) => void;
}) {
  return (
    <div className="draft-border-controls">
      {label ? <span className="field-title">{label}</span> : null}
      <div className="draft-inline-border-grid">
        <ColorField label="描边颜色" value={border.color} onChange={(value) => onChange({ color: value })} />
        <RangeField label="描边宽度" min={0} max={60} step={1} value={border.width} onChange={(value) => onChange({ width: value })} />
        <RangeField label="描边透明度" min={0} max={1} step={0.05} value={border.alpha} onChange={(value) => onChange({ alpha: value })} />
      </div>
    </div>
  );
}

function Segmented({ label, value, options, labels, onChange }: { label: string; value: string; options: string[]; labels?: string[]; onChange: (value: string) => void }) {
  return (
    <div className="field">
      {label ? <span>{label}</span> : null}
      <div className="segmented">
        {options.map((option, index) => (
          <button key={option} className={option === value ? 'selected' : ''} onClick={() => onChange(option)} type="button">
            {labels?.[index] ?? option}
          </button>
        ))}
      </div>
    </div>
  );
}

function OptionCloud({ title, options, value, onChange }: { title: string; options: string[][]; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <span className="field-title">{title}</span>
      <div className="option-cloud">
        {options.map(([id, label, hint]) => (
          <button key={id} className={value === id ? 'option-pill active' : 'option-pill'} onClick={() => onChange(id)}>
            <strong>{label}</strong>
            {hint ? <small>{hint}</small> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function Accordion({ title, open = false, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(open);
  return (
    <div className={expanded ? 'accordion open' : 'accordion'}>
      <button onClick={() => setExpanded(!expanded)}>› {title}</button>
      {expanded ? <div>{children}</div> : null}
    </div>
  );
}

function EventTimeline({ events }: { events: TaskEvent[] }) {
  if (events.length === 0) return <EmptyState title="暂无事件" />;
  return (
    <div className="event-list">
      {events.map((event, index) => (
        <div className="event-item" key={`${event.seq ?? index}-${event.ts}`}>
          <span>{event.step ?? '-'}</span>
          {event.type === 'step_error' ? <ErrorSummaryButton fullMessage={event.detail} title={`步骤 ${event.step ?? '-'} 错误`} compact /> : <p>{event.detail}</p>}
        </div>
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: TaskStatus }) {
  return <span className={`status-pill ${status}`}>{statusLabel(status)}</span>;
}

function EmptyState({ title }: { title: string }) {
  return <div className="empty-state"><Database size={20} /><span>{title}</span></div>;
}

function LocalInfo({ title, value }: { title: string; value: string }) {
  return <div className="local-info"><Info size={18} /><div><strong>{title}</strong><span>{value}</span></div></div>;
}

function InlineActionFeedback({ feedback }: { feedback: AsyncActionFeedback | null }) {
  if (!feedback) return null;
  return (
    <div className={`inline-action-feedback ${feedback.tone}`} role={feedback.tone === 'error' ? 'alert' : 'status'}>
      <span>{feedback.message}</span>
    </div>
  );
}

function ErrorSummaryButton({ fullMessage, title, compact = false }: { fullMessage: string; title: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!fullMessage.trim()) return null;
  const summary = summarizeErrorMessage(fullMessage);
  return (
    <>
      <button
        type="button"
        className={compact ? 'error-summary-button compact' : 'error-summary-button'}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <span className="error-mark">!</span>
        <span>{summary}</span>
      </button>
      {open ? <ErrorDetailDialog title={title} summary={summary} fullMessage={fullMessage} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ErrorDetailDialog({ title, summary, fullMessage, onClose }: { title: string; summary: string; fullMessage: string; onClose: () => void }) {
  return (
    <div className="error-dialog-backdrop" onClick={onClose}>
      <section className="error-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="error-dialog-head">
          <div>
            <span className="error-mark">!</span>
            <strong>{title}</strong>
          </div>
          <button className="mini-button" type="button" onClick={onClose}>关闭</button>
        </div>
        <p>{summary}</p>
        <pre>{fullMessage}</pre>
      </section>
    </div>
  );
}

function ProviderConfigNote({ title, value }: { title: string; value: string }) {
  return (
    <div className="provider-config-note">
      <Info size={16} />
      <div>
        <strong>{title}</strong>
        <span>{value}</span>
      </div>
    </div>
  );
}

function resolvePromptTemplateForTrack(templates: PromptTemplate[], track: string, overrideId?: string | null): PromptTemplate | null {
  return selectTaskPromptTemplate(templates, { track, promptTemplateId: overrideId ?? null });
}

function independentPromptTemplateFields(template: PromptTemplate): PromptTemplate {
  const copy = { ...template };
  delete copy.baseTemplateId;
  return copy;
}

function promptTemplateHasStepPrompt(template: PromptTemplate, type: PromptStepTemplateType): boolean {
  return Object.prototype.hasOwnProperty.call(template.stepPrompts ?? {}, type);
}

function promptTemplateStepPromptValue(template: PromptTemplate, templates: PromptTemplate[], type: PromptStepTemplateType): string {
  if (promptTemplateHasStepPrompt(template, type)) return template.stepPrompts?.[type] ?? '';
  return selectStepPromptTemplate(templates, type)?.content ?? '';
}

function promptTemplateTypeLabel(type: PromptTemplateType | 'all'): string {
  return promptTemplateTypeLabels[type];
}

function promptTemplateStyleOptions(styles: CustomStyle[], template: PromptTemplate): CustomStyle[] {
  const byId = new Map([...defaultCustomStyles, ...styles].map((style) => [style.id, style]));
  resolvePromptTemplateDefaultStyleIds(template, styles.map((style) => style.id)).forEach((id) => {
    if (!byId.has(id)) {
      const option = styleOptions.find(([styleId]) => styleId === id);
      if (option) {
        byId.set(id, {
          id,
          name: option[1],
          tag: option[2],
          shortName: option[1],
          prefix: option[1],
          suffix: option[2],
          negativePrompt: '',
          allowColor: id !== 'black-white',
          description: option[2],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }
  });
  return [...byId.values()];
}

function promptTemplateStyleLabelList(template: PromptTemplate, styles: CustomStyle[]): string[] {
  const styleNames = new Map([...defaultCustomStyles, ...styles].map((style) => [style.id, style.name]));
  return resolvePromptTemplateDefaultStyleIds(template, styles.map((style) => style.id)).map((id) => styleNames.get(id) ?? styleLabel(id, styles));
}

function styleLabel(id: string, styles: CustomStyle[] = defaultCustomStyles): string {
  return [...defaultCustomStyles, ...styles].find((style) => style.id === id)?.name ?? styleOptions.find(([styleId]) => styleId === id)?.[1] ?? id;
}

function smartImageModeLabel(mode: ImageLabSmartMode = 'text-to-image'): string {
  if (mode === 'text-to-image') return '文生图';
  return smartImageModeOptions.find(([id]) => id === mode)?.[1] ?? mode;
}

function resolveImageLabSmartMode(tab: 'smart' | 'text' | 'reference', smartMode: ImageLabSmartMode, references: string[]): ImageLabSmartMode {
  return tab === 'smart' && references.length > 0 ? 'reference-edit' : tab === 'smart' ? smartMode : tab === 'reference' ? 'reference-edit' : 'text-to-image';
}

function parseReferenceImagePaths(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function draftTemplateImageRatio(templates: DraftTemplate[], templateId: string): string {
  return templates.find((template) => template.id === templateId)?.image.ratio ?? templates[0]?.image.ratio ?? '9:16';
}

function defaultTaskDraftTemplateId(templates: DraftTemplate[]): string {
  return templates[0]?.id ?? 'default-portrait-9-16';
}

function draftTemplateLabel(templateId: string, templates: DraftTemplate[]): string {
  return templates.find((template) => template.id === templateId)?.name ?? templateId;
}

function characterPolicyLabel(policy: PromptTemplate['characterPolicy']): string {
  if (policy === 'force-extract') return '强制提取';
  if (policy === 'force-skip') return '强制跳过';
  return '跟随赛道';
}

function referenceKindLabel(kind: PromptTemplate['referenceKind']): string {
  if (kind === 'face') return '人脸';
  if (kind === 'product') return '产品';
  return '无';
}

function buildImageStyleDraftFromPrompt(prompt: string, base: CustomStyle): Pick<CustomStyle, 'name' | 'tag' | 'shortName' | 'prefix' | 'suffix' | 'negativePrompt' | 'allowColor' | 'description'> {
  const normalized = prompt.trim() || base.name;
  const tags = splitListInput(normalized).slice(0, 4);
  const name = tags[0] || normalized.slice(0, 12) || base.name;
  return {
    name,
    tag: tags.length ? tags.join('、') : base.tag,
    shortName: name.slice(0, 4),
    prefix: [normalized, base.prefix].filter(Boolean).join('，'),
    suffix: base.suffix || '高质量，清晰细节，电影级构图',
    negativePrompt: base.negativePrompt || '模糊，噪点，过曝，低质量，水印，文字',
    allowColor: !/黑白|单色|mono/i.test(normalized) && base.allowColor,
    description: `适合${normalized}题材。`,
  };
}

function splitListInput(value: string): string[] {
  return value
    .split(/[,，、\n]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function validBgmItems(config: AppConfig): BgmItem[] {
  return config.jianying.bgmLibrary.filter((bgm) => bgm.id.trim() && bgm.path.trim());
}

function resolveDefaultBgmId(config: AppConfig): string {
  const bgms = validBgmItems(config);
  return bgms.some((bgm) => bgm.id === config.jianying.defaultBgmId) ? config.jianying.defaultBgmId : bgms[0]?.id ?? '';
}

function addUploadedBgm(config: AppConfig, audioPath: string): { config: AppConfig; bgmId: string } {
  const id = `bgm-${crypto.randomUUID()}`;
  const item: BgmItem = {
    id,
    title: audioTitleFromPath(audioPath),
    path: audioPath,
    durationMs: 0,
    volume: 0.25,
  };
  const existingDefaultId = resolveDefaultBgmId(config);
  const bgmLibrary = [...validBgmItems(config), item];
  const nextConfig = {
    ...config,
    jianying: {
      ...config.jianying,
      bgmLibrary,
      defaultBgmId: existingDefaultId || id,
    },
  };
  return { config: nextConfig, bgmId: id };
}

function audioTitleFromPath(path: string): string {
  const filename = path.split(/[\\/]/u).pop() || 'BGM';
  return filename.replace(/\.[^.]+$/u, '') || filename;
}

function pageSubtitle(view: ShellView): string {
  const map: Partial<Record<ShellView, string>> = {
    'new-task': '粘贴一段人物故事，几分钟后在剪映里打开',
    'book-selection': '维护本地商品书单，把卖点带入新任务或对标导入',
    benchmark: '导入对标文案，本地二改后直接创建带货任务',
    'person-assets': '管理本地人物真图素材，供分镜阶段保持角色一致',
    queue: '查看当前任务、步骤事件、失败重试和输出状态',
    history: '按时间浏览已完成、失败、取消和草稿任务',
    'task-detail': '查看单个任务的独立执行状态和流水线',
    'image-lab': '单独测试文生图、图像参考和分镜图片提示词',
    'music-mv': '按歌词节奏生成音乐 MV 分镜、字幕和剪映草稿',
    'viral-analyzer': '拆解爆款短视频的开头、结构、结尾和爆点',
    'prompt-templates': '管理系统模板、克隆、导入 JSON 和本地编辑',
    'draft-templates': '调整画布、图片区域、字幕、免责声明和音频参数',
    settings: '配置 API 凭证、本地路径、TTS、IMA 与诊断',
    account: '管理本机账号资料、设备和模拟余额',
    activation: '管理本地激活状态与试用说明',
  };
  if (view === 'voice-lab') return '单独试听豆包与 MiniMax 音色，保存本地试听记录';
  if (view === 'html-video') return '文案、素材、配音、动画预览、封面和出片的独立 HTML 视频工作台';
  return map[view] ?? '';
}

function pipelineStepStatus(task: Task, step: number): 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' {
  if (task.status === 'paused' && task.failedStep === step) return 'failed';
  if (task.status === 'failed') return step === task.currentStep ? 'failed' : step < task.currentStep ? 'completed' : 'pending';
  if (task.status === 'cancelled') return step === task.currentStep ? 'cancelled' : step < task.currentStep ? 'completed' : 'pending';
  if (task.status === 'completed') return 'completed';
  if (task.status === 'running') return step < task.currentStep ? 'completed' : step === task.currentStep ? 'running' : 'pending';
  return step < task.currentStep ? 'completed' : 'pending';
}

function statusLabelForStep(status: ReturnType<typeof pipelineStepStatus>): string {
  return {
    pending: '等待中',
    running: '进行中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  }[status];
}

function artifactPanelTitle(task: Task, tab: 'preview' | 'storyboard' | 'audio'): string {
  if (tab === 'storyboard') return task.currentStep >= 2 ? '分镜画廊已跟随流水线准备' : '等待分镜生成';
  if (tab === 'audio') return task.currentStep >= 5 ? '配音与字幕时间轴' : '等待配音生成';
  return task.currentStep >= 7 ? '最终剪映草稿目录' : '等待当前步骤产物落盘';
}

function formatDuration(start: string, end: string | null, now = Date.now()): string {
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : now;
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return '--';
  const seconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}:${String(rest).padStart(2, '0')}` : `0:${String(rest).padStart(2, '0')}`;
}

function statusLabel(status: TaskStatus | 'all'): string {
  return {
    all: '全部',
    draft: '草稿',
    pending: '等待',
    running: '运行中',
    paused: '暂停',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  }[status];
}

function settingsStatusLabel(status: 'pass' | 'warn' | 'fail'): string {
  return status === 'pass' ? '已配置' : status === 'warn' ? '需确认' : '待配置';
}

function summarizeErrorMessage(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim();
  if (!normalized) return '发生错误';
  const imageApiStatus = normalized.match(/Image provider API error \((\d+)\)/i)?.[1];
  if (imageApiStatus) return `生图接口错误 ${imageApiStatus}`;
  if (/Python dependency .* is required|ModuleNotFoundError: No module named/i.test(normalized)) {
    const missing = normalized.match(/No module named ['"]([^'"]+)['"]/i)?.[1] ?? normalized.match(/Python dependency ([\w.-]+)/i)?.[1];
    return missing ? `Python 运行时缺少依赖：${missing}` : 'Python 运行时依赖缺失';
  }
  if (normalized.includes(['Browser preview', 'cannot run the real provider pipeline'].join(' ')) || /浏览器预览无法运行真实供应商流水线/i.test(normalized)) return '浏览器预览无法执行真实任务';
  if (/Image provider API key is missing/i.test(normalized)) return '生图 API Key 缺失';
  if (/Image provider is not configured/i.test(normalized)) return '生图配置不完整';
  if (/Jimeng submit failed/i.test(normalized)) return '即梦提交失败';
  if (/Jimeng poll failed/i.test(normalized)) return '即梦结果获取失败';
  if (/LLM provider is not configured/i.test(normalized)) return 'LLM 配置不完整';
  if (/TTS provider is not configured/i.test(normalized)) return 'TTS 配置不完整';
  const firstSentence = normalized.split(/[。.!?]/)[0] || normalized;
  return trimForPreview(firstSentence, 42);
}

type ImageResolution = '1K' | '2K' | '4K';

function settingsConfigSignature(config: AppConfig): string {
  return JSON.stringify(normalizeEditableConfigProviders(config));
}

function imageProviderLabel(provider: ImageProviderProfile['provider']): string {
  return provider === 'gpt_image' ? 'GPT Image' : provider === 'jimeng' ? '即梦' : '自定义图片';
}

function imageProfileSummary(profile: ImageProviderProfile): string {
  if (profile.provider === 'jimeng') return imageProfileJimeng(profile).reqKey || imageProfileJimeng(profile).model || '未配置 Req Key';
  if (profile.provider === 'custom') return imageProfileCustomImage(profile).model || '未选择模型';
  return imageProfileGptImage(profile).model || '未选择模型';
}

function ttsProviderLabel(provider: TtsProviderProfile['provider']): string {
  return provider === 'minimax' ? 'MiniMax' : '火山引擎';
}

function ttsProfileSummary(profile: TtsProviderProfile): string {
  if (profile.provider === 'minimax') return ttsProfileMinimax(profile).model || '未选择模型';
  const speaker = ttsProfileVolcengine(profile).speaker;
  return volcengineVoicePresetLabel(speaker) || speaker || '未选择音色';
}

type VolcengineVoiceOption = {
  voiceType: string;
  label: string;
};

function mergeVolcengineSpeakers(current: VolcengineSpeaker[], incoming: VolcengineSpeaker[]): VolcengineSpeaker[] {
  const byVoiceType = new Map(current.map((speaker) => [speaker.voiceType, speaker]));
  incoming.forEach((speaker) => {
    const voiceType = speaker.voiceType.trim();
    if (voiceType) byVoiceType.set(voiceType, { ...speaker, voiceType });
  });
  return [...byVoiceType.values()];
}

function buildVolcengineVoiceOptions(speakers: VolcengineSpeaker[]): VolcengineVoiceOption[] {
  const byVoiceType = new Map<string, VolcengineVoiceOption>();
  volcengineVoicePresets.forEach(([label, voiceType]) => {
    byVoiceType.set(voiceType, { voiceType, label });
  });
  speakers.forEach((speaker) => {
    const voiceType = speaker.voiceType.trim();
    if (!voiceType) return;
    byVoiceType.set(voiceType, {
      voiceType,
      label: speaker.name.trim() || volcengineStaticPresetLabel(voiceType) || voiceType,
    });
  });
  return [...byVoiceType.values()];
}

function volcenginePresetVoiceValue(speaker: string, options: VolcengineVoiceOption[] = buildVolcengineVoiceOptions([])): string {
  return options.some((option) => option.voiceType === speaker) ? speaker : 'custom';
}

function volcengineVoicePresetLabel(speaker: string, speakers: VolcengineSpeaker[] = []): string {
  return buildVolcengineVoiceOptions(speakers).find((option) => option.voiceType === speaker)?.label ?? '';
}

function volcengineStaticPresetLabel(speaker: string): string {
  return volcengineVoicePresets.find(([, voiceType]) => voiceType === speaker)?.[0] ?? '';
}

function DraftCanvasText({
  className,
  x,
  y,
  width,
  border,
  positioned = true,
  style,
  children,
}: {
  className: string;
  x: number;
  y: number;
  width: number;
  border?: DraftTextBorder;
  positioned?: boolean;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const positionStyle = positioned ? draftLayerPositionStyle(x, y) : {};
  return (
    <div className={className} style={{ ...positionStyle, ...draftTextWidthStyle(width), ...draftTextStrokeStyle(border), ...style }}>
      {children}
    </div>
  );
}

function applyDraftCanvasRatio(template: DraftTemplate, ratio: string): DraftTemplate {
  const canvas = draftCanvasSizeForRatio(ratio);
  return applyDraftImageRatio({ ...template, canvas: { ...template.canvas, ...canvas, ratio } }, template.image.ratio);
}

function draftCanvasSizeForRatio(ratio: string): Pick<DraftTemplate['canvas'], 'width' | 'height'> {
  if (ratio === '16:9') return { width: 1920, height: 1080 };
  if (ratio === '4:3') return { width: 1440, height: 1080 };
  if (ratio === '1:1') return { width: 1080, height: 1080 };
  return { width: 1080, height: 1920 };
}

function applyDraftImageRatio(template: DraftTemplate, ratio: string): DraftTemplate {
  const height = clamp(draftImageHeightForCanvas(template.canvas, ratio), 0.1, 1);
  return {
    ...template,
    image: {
      ...template.image,
      ratio,
      height,
      top: clamp((1 - height) / 2, -0.2, 1 - Math.min(0.1, height)),
    },
  };
}

function draftImageHeightForCanvas(canvas: DraftTemplate['canvas'], imageRatio: string): number {
  const ratio = ratioToNumber(imageRatio);
  if (!ratio) return 1;
  return (canvas.width / ratio) / canvas.height;
}

function draftTemplateCanvasStyle(template: DraftTemplate): React.CSSProperties {
  const backgroundImage = template.canvas.backgroundImage.trim();
  const ratio = ratioToNumber(template.canvas.ratio) || template.canvas.width / template.canvas.height;
  const style: React.CSSProperties & Record<string, string | number | undefined> = {
    '--draft-preview-width': `${draftPreviewWidth(template)}px`,
    '--draft-canvas-ratio': ratio,
    aspectRatio: `${template.canvas.width} / ${template.canvas.height}`,
    backgroundColor: template.canvas.backgroundColor,
    backgroundImage: backgroundImage ? `url("${toLocalImageUrl(backgroundImage).replace(/"/g, '\\"')}")` : undefined,
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    backgroundSize: 'cover',
  };
  return style;
}

function draftPreviewWidth(template: DraftTemplate): number {
  const ratio = ratioToNumber(template.canvas.ratio) || template.canvas.width / template.canvas.height;
  if (ratio >= 1.5) return 640;
  if (ratio >= 1.2) return 560;
  if (ratio >= 0.95) return 520;
  return Math.max(300, Math.round(ratio * 560));
}

function draftImageMediaStyle(template: DraftTemplate): React.CSSProperties {
  const aspectRatio = draftImageAspectRatio(template.image.ratio);
  if (template.image.fit === 'contain') {
    return {
      aspectRatio,
      height: 'auto',
      maxHeight: '100%',
      maxWidth: '100%',
      width: '100%',
    };
  }
  return {
    aspectRatio,
    height: '100%',
    width: '100%',
  };
}

function draftImageAspectRatio(ratio: string): string {
  const parts = ratio.split(':').map((item) => Number(item));
  if (parts.length === 2 && parts.every((item) => Number.isFinite(item) && item > 0)) {
    return `${parts[0]} / ${parts[1]}`;
  }
  return '9 / 16';
}

function ratioToNumber(ratio: string): number {
  const [width, height] = ratio.split(':').map((item) => Number(item));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 0;
  return width / height;
}

function normalizeColorInput(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : '#000000';
}

function colorWithAlpha(color: string, alpha: number): string {
  const normalized = normalizeColorInput(color).slice(1);
  const channel = (offset: number) => Number.parseInt(normalized.slice(offset, offset + 2), 16);
  const opacity = clamp(alpha, 0, 1);
  return `rgba(${channel(0)}, ${channel(2)}, ${channel(4)}, ${opacity})`;
}

function draftTextStrokeStyle(border?: DraftTextBorder): React.CSSProperties {
  if (!border || border.width <= 0 || border.alpha <= 0) return {};
  const color = colorWithAlpha(border.color, border.alpha);
  const previewStrokeWidth = Math.min(3, Math.max(1, Math.round(border.width / 16)));
  return {
    WebkitTextStroke: `${previewStrokeWidth}px ${color}`,
    paintOrder: 'stroke fill',
    textShadow: `0 1px 2px ${colorWithAlpha(border.color, Math.min(border.alpha, 0.55))}`,
  };
}

function draftTextBorderStyle(border?: DraftTextBorder): React.CSSProperties {
  return draftTextStrokeStyle(border);
}

function draftTextLayerStyle(
  text: Pick<DraftTemplate['title'], 'color' | 'alpha' | 'underline' | 'align' | 'letterSpacing' | 'lineSpacing'>,
  fontSize: number,
  fontWeight: React.CSSProperties['fontWeight'],
): React.CSSProperties {
  return {
    color: text.color,
    fontSize,
    opacity: text.alpha,
    fontWeight,
    textDecoration: text.underline ? 'underline' : 'none',
    textAlign: draftTextAlign(text.align),
    letterSpacing: `${text.letterSpacing}px`,
    lineHeight: `${1 + text.lineSpacing / 10}`,
  };
}

function draftTextWidthStyle(width: number): React.CSSProperties {
  return {
    width: `${clamp(width, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) * 100}%`,
  };
}

function draftTextAlign(align: number): React.CSSProperties['textAlign'] {
  if (align <= 0) return 'left';
  if (align >= 2) return 'right';
  return 'center';
}

function isDraftLayerVisible(template: DraftTemplate, layer: DraftCanvasLayer): boolean {
  if (layer === 'image') return template.image.visible;
  if (layer === 'title') return template.title.visible;
  if (layer === 'subtitle') return template.subtitle.visible;
  if (layer === 'caption') return template.caption.visible;
  return template.disclaimer.visible;
}

function firstVisibleDraftLayer(template: DraftTemplate): DraftCanvasLayer {
  return (['image', 'title', 'subtitle', 'caption', 'disclaimer'] as DraftCanvasLayer[]).find((layer) => isDraftLayerVisible(template, layer)) ?? 'title';
}

function updateDraftLayerPosition(template: DraftTemplate, layer: DraftCanvasLayer, deltaX: number, deltaY: number): DraftTemplate {
  if (layer === 'image') {
    return {
      ...template,
      image: {
        ...template.image,
        top: clamp(template.image.top + deltaY / 2, -0.2, 1 - Math.min(0.1, template.image.height)),
      },
    };
  }
  if (layer === 'title') {
    return { ...template, title: { ...template.title, x: clamp(template.title.x + deltaX, -0.9, 0.9), y: clamp(template.title.y + deltaY, -0.9, 0.9) } };
  }
  if (layer === 'subtitle') {
    return { ...template, subtitle: { ...template.subtitle, x: clamp(template.subtitle.x + deltaX, -0.9, 0.9), y: clamp(template.subtitle.y + deltaY, -0.9, 0.9) } };
  }
  if (layer === 'caption') {
    return { ...template, caption: { ...template.caption, x: clamp(template.caption.x + deltaX, -0.9, 0.9), y: clamp(template.caption.y + deltaY, -0.9, 0.9) } };
  }
  return { ...template, disclaimer: { ...template.disclaimer, x: clamp(template.disclaimer.x + deltaX, -0.9, 0.9), y: clamp(template.disclaimer.y + deltaY, -0.95, 0.95) } };
}

function resizeDraftLayerWidth(template: DraftTemplate, layer: Exclude<DraftCanvasLayer, 'image'>, deltaX: number): DraftTemplate {
  if (layer === 'title') return { ...template, title: { ...template.title, width: clamp(template.title.width + deltaX, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) } };
  if (layer === 'subtitle') return { ...template, subtitle: { ...template.subtitle, width: clamp(template.subtitle.width + deltaX, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) } };
  if (layer === 'caption') return { ...template, caption: { ...template.caption, width: clamp(template.caption.width + deltaX, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) } };
  return { ...template, disclaimer: { ...template.disclaimer, width: clamp(template.disclaimer.width + deltaX, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) } };
}

function draftLayerPositionStyle(x: number, y: number): React.CSSProperties {
  return {
    left: `${((x + 1) / 2) * 100}%`,
    top: `${((y + 1) / 2) * 100}%`,
    transform: 'translate(-50%, -50%)',
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function setDraftModel(config: AppConfig, key: ModelListKey, model: string): AppConfig {
  if (key === 'gpt-image') {
    return { ...config, gptImage: { ...config.gptImage, model } };
  }
  if (key === 'custom-image') {
    return { ...config, customImage: { ...config.customImage, model } };
  }
  return saveLlmProfile(config, { ...config.llm, model });
}

function setImageResolution(config: AppConfig, resolution: ImageResolution): AppConfig {
  if (config.imageProvider === 'custom') {
    return { ...config, customImage: { ...config.customImage, resolution } };
  }
  if (config.imageProvider === 'jimeng') {
    return { ...config, jimeng: { ...config.jimeng, resolution } };
  }
  return { ...config, image: { ...config.image, resolution }, gptImage: { ...config.gptImage, resolution } };
}

function activeImageResolution(config: AppConfig): ImageResolution {
  if (config.imageProvider === 'custom') return config.customImage.resolution ?? '2K';
  if (config.imageProvider === 'jimeng') return config.jimeng.resolution;
  return config.gptImage.resolution ?? config.image.resolution ?? '2K';
}

function setImageConcurrency(config: AppConfig, concurrency: number): AppConfig {
  if (config.imageProvider === 'custom') {
    return { ...config, customImage: { ...config.customImage, concurrency } };
  }
  if (config.imageProvider === 'jimeng') {
    return { ...config, jimeng: { ...config.jimeng, concurrency } };
  }
  return { ...config, image: { ...config.image, concurrency }, gptImage: { ...config.gptImage, concurrency } };
}

function activeImageConcurrency(config: AppConfig): number {
  if (config.imageProvider === 'custom') return config.customImage.concurrency;
  if (config.imageProvider === 'jimeng') return config.jimeng.concurrency;
  return config.gptImage.concurrency ?? config.image.concurrency;
}

function snapshotStepStatus(snapshot: TaskArtifactSnapshot | null, step: number): string {
  return snapshot?.steps[String(step)]?.status ?? 'pending';
}

function imageProgressLabel(totalScenes: number, generatedImages: number, stepStatus: string): string {
  const total = totalScenes || generatedImages;
  if (total === 0) return '等待分镜';
  const statusText = stepStatus === 'completed' ? '已完成' : stepStatus === 'running' ? '生成中' : stepStatus === 'failed' ? '生成失败' : '等待生图';
  return `${generatedImages}/${total} 张 · ${statusText}`;
}

function toLocalImageUrl(path: string): string {
  if (/^(https?:|file:|data:|blob:)/i.test(path)) return path;
  const normalized = path.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(normalized)) return `file:///${encodeURI(normalized)}`;
  if (normalized.startsWith('/')) return `file://${encodeURI(normalized)}`;
  return encodeURI(normalized);
}

function toLocalAssetUrl(path: string): string {
  return toLocalImageUrl(path);
}

function countChars(value?: string): number {
  return value?.trim().length ?? 0;
}

function normalizeTaskTargetLength(value: string): number | undefined {
  return normalizeTargetLength(value) ?? undefined;
}

function normalizeTaskStoryboardSceneCount(value: string): number | undefined {
  return normalizeStoryboardSceneCount(value) ?? undefined;
}

function normalizeLockIntroSentencesInput(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(20, Math.max(0, Math.trunc(parsed)));
}

function parseBookProductInfo(value: string | null): BookProductInfo | null {
  if (!value?.trim()) return null;
  try {
    const parsed = JSON.parse(value) as BookProductInfo;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function productInfoSummary(value: string | null): string {
  const product = parseBookProductInfo(value);
  if (!product) return trimForPreview(value ?? '', 42);
  return [product.name, product.author, product.sellPoint || product.category].filter(Boolean).join(' · ') || '已带入商品信息';
}

function emptyToUndefined(value: string): string | undefined {
  return value.trim() || undefined;
}

function trimForPreview(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function formatMs(value: number): string {
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function cloneDraftTemplate(template: DraftTemplate): DraftTemplate {
  return JSON.parse(JSON.stringify(template)) as DraftTemplate;
}

function toggleArray(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function sourceKey(source: AiSourceSection, index: number): string {
  return source.url || `${source.title}-${index}`;
}

declare global {
  interface Window {
    __storydreamReactRoot?: Root;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root element');
}

applyStoredTheme(defaultUiPreferences.theme);
window.__storydreamReactRoot ??= createRoot(rootElement);
window.__storydreamReactRoot.render(<App />);
