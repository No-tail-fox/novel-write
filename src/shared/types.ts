export type TaskStatus = 'draft' | 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type ThemeName = 'dark' | 'light';
export const SHELL_VIEWS = [
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
] as const;
export type ShellView = (typeof SHELL_VIEWS)[number];

export type TaskMode = 'paste' | 'ai';
export type TaskKind = 'story' | 'music-mv';
export type TaskVideoForm = 'narration' | 'two-host-podcast';
export type PodcastSpeakerPair = 'kazai-dayi' | 'liufei-xiaolei';
export type PublishMode = 'review-rewrite' | 'direct-copy';
export type ProcessingMode = 'full-auto' | 'semi-auto' | 'clip-only';
export type PromptTemplateType = 'review' | 'rewrite' | 'cover' | 'storyboard' | 'image-prompt' | 'task';
export type PromptStepTemplateType = Exclude<PromptTemplateType, 'task'>;
export type ImageProvider = 'gpt_image' | 'jimeng' | 'custom' | 'mock';
export type TtsProvider = 'volcengine' | 'minimax' | 'mock';
export type PausePoint = 'none' | 'critical' | 'every-step' | 'custom';
export type RewriteIntensity = 'standard' | 'deep' | 'original';
export type NarrativePov = 'keep-original' | 'first-person' | 'third-person';

export interface LlmConfig {
  id?: string;
  name?: string;
  enabled?: boolean;
  provider: string;
  protocol?: 'openai' | 'anthropic';
  apiKey: string;
  baseUrl: string;
  model: string;
  proxyUrl: string;
  timeoutMs?: number;
  requestParamsJson?: string;
}

export interface LlmModelTestResult {
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  latencyMs: number;
  model: string;
  endpoint: string;
  requestId: string | null;
}

export interface ProviderModel {
  id: string;
  created?: number;
  ownedBy?: string;
}

export interface ProviderModelListRequest {
  baseUrl: string;
  apiKey: string;
  protocol?: LlmConfig['protocol'];
  secretId?: string;
}

export interface ProviderModelListResult {
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  latencyMs: number;
  endpoint: string;
  models: ProviderModel[];
}

export interface VolcengineSpeaker {
  voiceType: string;
  name: string;
  gender?: string;
  age?: string;
  labels?: string[];
  avatar?: string;
}

export interface VolcengineSpeakerListRequest {
  accessKeyId: string;
  secretAccessKey: string;
  accessKeyIdSecretId?: string;
  secretAccessKeySecretId?: string;
  resourceId: string;
  voiceTypes?: string[];
  page?: number;
  limit?: number;
}

export interface VolcengineSpeakerListResult {
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  latencyMs: number;
  endpoint: string;
  speakers: VolcengineSpeaker[];
  total: number;
  requestId: string | null;
}

export type ConfigTestTarget = 'llm' | 'image' | 'tts' | 'speechToText' | 'jianying' | 'creative';

export interface ConfigTestResult {
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  latencyMs: number;
  target: ConfigTestTarget;
  endpoint: string;
  requestId: string | null;
}

export interface ImaKnowledgeRequest {
  query: string;
}

export interface ImaKnowledgeRecord {
  id: string;
  title: string;
  snippet: string;
  url?: string;
}

export interface ImaKnowledgeResult {
  status: 'pass' | 'fail';
  detail: string;
  latencyMs: number;
  endpoint: string;
  requestId: string | null;
  knowledgeBaseId: string;
  records: ImaKnowledgeRecord[];
  totalCount: number;
}

export interface JianyingEffectCatalog {
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  transitions: string[];
  filters: string[];
  videoEffects: string[];
  audioEffects: string[];
}

export interface ImageConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  ratio: string;
  concurrency: number;
  resolution?: '1K' | '2K' | '4K';
  proxyUrl?: string;
  timeoutMs?: number;
}

export interface JimengConfig {
  sessionId: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  reqKey?: string;
  endpoint?: string;
  region?: string;
  service?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  model: string;
  ratio: string;
  resolution: '1K' | '2K' | '4K';
  concurrency: number;
}

export interface CustomImageConfig extends ImageConfig {
  displayName: string;
  asyncMode: boolean;
  ratioMappingJson: string;
  pollIntervalMs?: number;
}

export interface ImageProviderProfile {
  id?: string;
  name?: string;
  enabled?: boolean;
  provider: Exclude<ImageProvider, 'mock'>;
  gptImage?: ImageConfig;
  jimeng?: JimengConfig;
  customImage?: CustomImageConfig;
}

export interface TtsConfig {
  provider: TtsProvider;
  appId: string;
  accessKey: string;
  speaker: string;
  volcengine: {
    apiKey?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    appId: string;
    accessKey: string;
    speaker: string;
    cluster?: string;
    endpoint?: string;
    resourceId?: string;
  };
  minimax: {
    apiKey: string;
    model: string;
    voiceId: string;
  };
}

export interface TtsProviderProfile {
  id?: string;
  name?: string;
  enabled?: boolean;
  provider: Exclude<TtsProvider, 'mock'>;
  appId?: string;
  accessKey?: string;
  speaker?: string;
  volcengine?: TtsConfig['volcengine'];
  minimax?: TtsConfig['minimax'];
}

export type SpeechToTextResponseFormat = 'json' | 'text' | 'srt' | 'verbose_json' | 'vtt';
export type SpeechToTextTimestampGranularity = 'segment' | 'word';
export type SpeechToTextChunkingStrategy = 'none' | 'auto';
export type SpeechToTextProvider = 'openai-compatible' | 'siliconflow';

export interface SpeechToTextConfig {
  provider: SpeechToTextProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  language: string;
  prompt: string;
  responseFormat: SpeechToTextResponseFormat;
  temperature: number;
  timestampGranularities: SpeechToTextTimestampGranularity[];
  chunkingStrategy: SpeechToTextChunkingStrategy;
  timeoutMs: number;
}

export interface BgmItem {
  id: string;
  title: string;
  path: string;
  durationMs: number;
  volume: number;
}

export interface JianyingConfig {
  draftPath: string;
  bgmLibrary: BgmItem[];
  defaultBgmId: string;
}

export interface ImaConfig {
  clientId: string;
  apiKey: string;
  kbId: string;
  kbName: string;
}

export type ViralPlatform = 'douyin' | 'kuaishou' | 'bilibili' | 'unknown';
export type ViralDownloadProvider = 'douyin-internal' | 'kuaishou-playwright' | 'bilibili-internal';
export type ViralCookieSource = 'none' | 'browser-chrome' | 'browser-edge' | 'cookie-file';
export type ViralCookieFallbackMode = 'browser-first-after-failure';
export type ViralBrowserCookieSource = 'auto' | 'chrome' | 'edge';
export type ViralAnalysisStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type ViralAnalysisStage =
  | 'queued'
  | 'downloading'
  | 'extracting'
  | 'transcribing'
  | 'analyzing_frames'
  | 'breaking_down'
  | 'recreating'
  | 'completed'
  | 'failed';

export interface ViralAnalyzerConfig {
  cookieFilePath: string;
  cookieFallbackMode: ViralCookieFallbackMode;
  browserCookieSource: ViralBrowserCookieSource;
  frameIntervalSeconds: number;
  maxFrames: number;
  whisperModel: string;
  huggingFaceEndpoint: string;
  downloadTimeoutMs: number;
  vision: LlmConfig;
}

export interface AppConfig {
  llm: LlmConfig;
  llmProfiles: LlmConfig[];
  activeLlmProfileId: string;
  imageProvider: ImageProvider;
  image: ImageConfig;
  gptImage: ImageConfig;
  jimeng: JimengConfig;
  customImage: CustomImageConfig;
  imageProfiles: ImageProviderProfile[];
  activeImageProfileId: string;
  tts: TtsConfig;
  ttsProfiles: TtsProviderProfile[];
  activeTtsProfileId: string;
  speechToText: SpeechToTextConfig;
  jianying: JianyingConfig;
  ima: ImaConfig;
  viral: ViralAnalyzerConfig;
  ui: {
    theme: ThemeName;
  };
}

export interface Task {
  id: string;
  archivedAt?: string | null;
  managedStorageKey?: string | null;
  title: string;
  inputText: string;
  taskKind: TaskKind;
  processingMode: ProcessingMode;
  publishMode: PublishMode;
  status: TaskStatus;
  currentStep: number;
  runGeneration?: number;
  track: string;
  style: string;
  speaker: string;
  ratio: string;
  templateId: string;
  bgmId: string;
  pausePoints: PausePoint[];
  outputDir: string;
  errorMessage: string;
  createdAt: string;
  completedAt: string | null;
  startedAt: string | null;
  lastHeartbeatAt: string | null;
  mode: TaskMode;
  aiKeyword: string;
  aiSources: string[];
  selectedSources: AiSourceSection[];
  extraRequirements: string;
  imagePromptReference: string;
  promptTemplateId: string | null;
  promptTemplateType: string | null;
  referenceImagePath: string;
  rewriteIntensity: RewriteIntensity;
  narrativePov: NarrativePov;
  keepPromotion: boolean;
  ttsProvider: TtsProvider;
  ttsSpeed: number;
  storyboardSceneCount?: number;
  step3PromptSnapshot: string;
  musicMv: MusicMvSettings;
  failedStep: number | null;
  retryFromStep: number | null;
  artifactStatePath: string;
  videoForm?: TaskVideoForm;
  llmProfileId?: string | null;
  materialSource?: string;
  productInfo?: string | null;
  materialPerson?: string | null;
  draftDir?: string | null;
  fixedIntro?: string | null;
  outroCta?: string | null;
  lockIntroSentences?: number;
  taskType?: string;
  pipelineStep?: string;
  pipelineData?: string;
  targetLength?: number;
  targetScenes?: number;
  scriptFormat?: string;
  podcastImageMode?: string;
  podcastSpeakers?: string | null;
  podcastSpeakerA?: string | null;
  podcastSpeakerB?: string | null;
  coverImageMode?: string;
  coverTemplateId?: string;
  htmlVideoForeground?: boolean;
}

export type HtmlVideoVisibleStep = 'rewrite' | 'planning' | 'assets' | 'voice' | 'preview' | 'render';
export type HtmlVideoPipelineStep = HtmlVideoVisibleStep | 'done';
export type HtmlVideoTabKey = 'text' | 'assets' | 'voice' | 'preview' | 'cover' | 'output';

export type HtmlVideoStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface HtmlVideoStepState {
  status: HtmlVideoStepStatus;
  inputHash?: string;
  artifactPath?: string;
  artifactSize?: number;
  artifactHash?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface HtmlVideoScenePlan {
  index: number;
  narration: string;
  title: string;
  captions: string[];
  sceneTemplate: string;
  background: {
    prompt: string;
  };
  elements: Array<{
    slot: number;
    prompt: string;
  }>;
}

export interface HtmlVideoCompositionSnapshot {
  index: number;
  durationSec: number;
  canvas: {
    w: number;
    h: number;
  };
  audio: {
    src: string;
    durationSec: number;
  };
  background: {
    src: string;
  };
  captions: Array<{
    id: string;
    text: string;
    startSec: number;
    durationSec: number;
  }>;
  htmlPath?: string;
  thumbnailPath?: string;
  rev?: number;
}

export interface HtmlVideoAsset {
  sceneIndex: number;
  kind: 'bg' | 'fg';
  slot: number;
  src: string;
  prompt?: string;
  sizeBytes?: number;
}

export interface HtmlVideoVoiceClip {
  sceneIndex: number;
  src: string;
  durationSec: number;
  text?: string;
  sizeBytes?: number;
}

export interface HtmlVideoOutput {
  path: string;
  sizeBytes: number;
  durationSec?: number;
  cover?: CoverMetadata | null;
  draft?: {
    draftDir: string;
    draftContentPath: string;
    draftMetaPath: string;
    draftId?: string;
    sourceVideoPath?: string;
  };
}

export type HtmlVideoCoverMode = 'off' | 'auto' | 'manual';
export type HtmlVideoCoverRatio = '3:4' | '1:1' | '16:9' | '9:16';

export interface HtmlVideoCoverAsset {
  version: 1;
  revision: number;
  mode: Exclude<HtmlVideoCoverMode, 'off'>;
  path: string;
  sizeBytes: number;
  width: number;
  height: number;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  sha256: string;
  ratio: HtmlVideoCoverRatio;
  createdAt: string;
  templateId?: string;
}

export interface HtmlVideoJobConfig {
  style?: string;
  voiceId?: string;
  ttsProvider?: TtsProvider;
  ttsSpeed?: number;
  bgmId?: string;
  captionPreset?: string;
  captionAnim?: string;
  captionColors?: Record<string, string>;
  bgmVolume?: 'soft' | 'medium' | 'loud';
  transitionType?: string;
  coverImageMode?: HtmlVideoCoverMode;
  coverTemplate?: string;
  coverRatio?: HtmlVideoCoverRatio;
  draftTemplate?: string;
  foreground?: boolean;
  maxScenes?: number;
  ratio?: string;
}

export type HtmlVideoEditableConfigField =
  | 'style'
  | 'voiceId'
  | 'ttsProvider'
  | 'ttsSpeed'
  | 'bgmId'
  | 'captionPreset'
  | 'captionAnim'
  | 'captionColors'
  | 'bgmVolume'
  | 'transitionType'
  | 'coverImageMode'
  | 'coverTemplate'
  | 'coverRatio'
  | 'draftTemplate'
  | 'foreground'
  | 'maxScenes'
  | 'ratio';

export type HtmlVideoConfigChange =
  | { field: 'style'; value: string }
  | { field: 'voiceId'; value: string }
  | { field: 'ttsProvider'; value: TtsProvider }
  | { field: 'ttsSpeed'; value: number }
  | { field: 'bgmId'; value: string }
  | { field: 'captionPreset'; value: 'classic' | 'editorial' | 'karaoke' }
  | { field: 'captionAnim'; value: 'none' | 'fade-up' | 'pop' }
  | { field: 'captionColors'; value: Record<string, string> }
  | { field: 'bgmVolume'; value: 'soft' | 'medium' | 'loud' }
  | { field: 'transitionType'; value: 'fade' | 'dissolve' | 'wipeleft' | 'wiperight' | 'slideleft' | 'slideright' }
  | { field: 'coverImageMode'; value: HtmlVideoCoverMode }
  | { field: 'coverTemplate'; value: string }
  | { field: 'coverRatio'; value: HtmlVideoCoverRatio }
  | { field: 'draftTemplate'; value: string }
  | { field: 'foreground'; value: boolean }
  | { field: 'maxScenes'; value: number }
  | { field: 'ratio'; value: '9:16' | '16:9' | '1:1' | '4:3' };

export interface HtmlVideoPipelineDataV2 {
  version: 2;
  revision: number;
  configSnapshotHash?: string;
  current: HtmlVideoPipelineStep;
  warnings: string[];
  steps: Record<HtmlVideoVisibleStep, HtmlVideoStepState>;
  scenes: HtmlVideoScenePlan[];
  assets: HtmlVideoAsset[];
  voices: HtmlVideoVoiceClip[];
  compositions: HtmlVideoCompositionSnapshot[];
  coverAsset?: HtmlVideoCoverAsset;
  output?: HtmlVideoOutput;
  config: HtmlVideoJobConfig;
}

// Temporary read-only projection for the existing HTML video page. These
// properties are non-enumerable at runtime and are not persisted in V2 JSON.
export interface HtmlVideoPipelineData extends HtmlVideoPipelineDataV2 {
  readonly scenesPlanned: number;
  readonly scenesCompleted: number;
  readonly videoTitle: string;
  readonly assetImages: HtmlVideoAsset[];
  readonly voiceClips: HtmlVideoVoiceClip[];
  readonly htmlPaths: string[];
  readonly cover?: CoverMetadata | null;
  readonly _cfg?: HtmlVideoJobConfig;
}

export interface MusicMvSettings {
  rhythmMode: 'lyric-sync' | 'fast-cut' | 'slow-cinematic';
  captionStyle: 'karaoke' | 'minimal' | 'none';
  visualMotif: string;
  audioPath: string;
}

export interface BookProductInfo {
  name: string;
  author?: string;
  category?: string;
  keyword?: string;
  sellPoint?: string;
  audience?: string;
  persons?: string;
  era?: string;
  price?: string;
  url?: string;
  note?: string;
  coverPath?: string;
  materialFolder?: string;
}

export interface BookSelectionRecord {
  theme: string;
  bookId: string;
  data: BookProductInfo;
  updatedAt: number;
}

export interface BookSelectionIdentity {
  theme: string;
  bookId: string;
}

export interface BookSelectionInput {
  theme: string;
  bookId?: string;
  previousIdentity?: BookSelectionIdentity;
  data: BookProductInfo;
}

export type CreateTaskInput = Partial<
  Pick<
    Task,
    | 'title'
    | 'inputText'
    | 'taskKind'
    | 'processingMode'
    | 'publishMode'
    | 'mode'
    | 'aiKeyword'
    | 'aiSources'
    | 'selectedSources'
    | 'extraRequirements'
    | 'imagePromptReference'
    | 'track'
    | 'style'
    | 'speaker'
    | 'ratio'
    | 'templateId'
    | 'bgmId'
    | 'pausePoints'
    | 'promptTemplateId'
    | 'promptTemplateType'
    | 'referenceImagePath'
    | 'rewriteIntensity'
    | 'narrativePov'
    | 'keepPromotion'
    | 'ttsProvider'
    | 'ttsSpeed'
    | 'storyboardSceneCount'
    | 'step3PromptSnapshot'
    | 'musicMv'
    | 'videoForm'
    | 'llmProfileId'
    | 'materialSource'
    | 'productInfo'
    | 'materialPerson'
    | 'draftDir'
    | 'fixedIntro'
    | 'outroCta'
    | 'lockIntroSentences'
    | 'taskType'
    | 'pipelineStep'
    | 'pipelineData'
    | 'targetLength'
    | 'targetScenes'
    | 'scriptFormat'
    | 'podcastImageMode'
    | 'podcastSpeakers'
    | 'podcastSpeakerA'
    | 'podcastSpeakerB'
    | 'coverImageMode'
    | 'coverTemplateId'
    | 'htmlVideoForeground'
  >
> & {
  inputText: string;
};

export interface TaskEvent {
  id?: string;
  seq?: number;
  runGeneration?: number;
  taskId: string;
  type: string;
  step: number | null;
  agent: string | null;
  tool: string | null;
  detail: string;
  dataJson: string | null;
  ts: number;
}

export type SequencedTaskEvent = Omit<TaskEvent, 'seq'> & { seq: number };

export interface CursorRequest {
  cursor?: string | null;
  limit?: number;
}

export type HistoryFamily = 'task' | 'viral-analysis' | 'image-lab' | 'voice-lab';
export type HistoryArchiveFilter = 'active' | 'archived';

export type TaskHistoryStatusFilter =
  | { status?: TaskStatus; statuses?: never }
  | { status?: never; statuses: TaskStatus[] };

export type HistoryListRequest =
  | ({
      family: 'task';
      filter: HistoryArchiveFilter;
      taskType?: 'story' | 'music-mv' | 'html-video';
      query?: string;
      cursor?: string | null;
      limit?: number;
    } & TaskHistoryStatusFilter)
  | {
      family: 'viral-analysis';
      filter: HistoryArchiveFilter;
      status?: ViralAnalysisStatus;
      query?: string;
      cursor?: string | null;
      limit?: number;
    }
  | {
      family: 'image-lab';
      filter: HistoryArchiveFilter;
      status?: ImageLabRecord['status'];
      query?: string;
      cursor?: string | null;
      limit?: number;
    }
  | {
      family: 'voice-lab';
      filter: HistoryArchiveFilter;
      status?: VoiceLabRecord['status'];
      query?: string;
      cursor?: string | null;
      limit?: number;
    };

export type HistoryListInput<F extends HistoryFamily, R = HistoryListRequest> = R extends { family: F }
  ? Omit<R, 'family' | 'filter'> & { filter?: HistoryArchiveFilter }
  : never;

export type HistoryPage<F extends HistoryFamily, T> = {
  family: F;
  items: T[];
  totalCount: number;
  hasMore: boolean;
  nextCursor: string | null;
};

export type TaskTombstoneResult = { kind: 'task-tombstone'; id: string; revision: number };
export type ViralAnalysisTombstoneResult = { kind: 'viral-tombstone'; id: string; revision: number };
export type ImageLabTombstoneResult = { kind: 'image-lab-tombstone'; id: string; revision: number };
export type VoiceLabTombstoneResult = { kind: 'voice-lab-tombstone'; id: string; revision: number };

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CountedCursorPage<T> extends CursorPage<T> {
  totalCount: number;
}

export type TaskSummary = Omit<
  Task,
  | 'inputText'
  | 'pausePoints'
  | 'aiSources'
  | 'selectedSources'
  | 'extraRequirements'
  | 'imagePromptReference'
  | 'step3PromptSnapshot'
  | 'musicMv'
  | 'pipelineData'
  | 'productInfo'
  | 'materialPerson'
  | 'fixedIntro'
  | 'outroCta'
  | 'podcastSpeakers'
> & {
  inputPreview: string;
};

export interface PromptTemplate {
  id: string;
  name: string;
  type: PromptTemplateType;
  description: string;
  content: string;
  isBuiltin: boolean;
  updatedAt: string;
  baseTrack?: string;
  baseTemplateId?: string | null;
  defaultStyles?: string[];
  defaultDraftTemplateId?: string;
  characterPolicy?: 'follow-template' | 'force-extract' | 'force-skip';
  step3SkeletonModules?: string[];
  referenceKind?: 'none' | 'face' | 'product';
  stepPrompts?: Partial<Record<PromptStepTemplateType, string>>;
  imageSeedPoolsJson?: string;
  origin?: 'system' | 'custom' | 'market';
  usedCount?: number;
  marketTags?: string[];
}

export type PromptTemplateSummary = Omit<PromptTemplate, 'content' | 'stepPrompts' | 'imageSeedPoolsJson'>;

export interface CustomStyle {
  id: string;
  name: string;
  tag: string;
  shortName: string;
  prefix: string;
  suffix: string;
  negativePrompt: string;
  allowColor: boolean;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomCoverTemplate {
  id: string;
  name: string;
  description: string;
  directions: string;
  compositionRule: string;
  titleLayout: string;
  subtitleLayout: string;
  plainHint: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomStyleGenerateInput {
  prompt: string;
  baseStyle: CustomStyle;
}

export interface ImageLabRecord {
  id: string;
  archivedAt?: string | null;
  managedStorageKey?: string | null;
  prompt: string;
  ratio: string;
  style: string;
  provider: ImageProvider | string;
  imagePath: string;
  status: 'mock' | 'generated' | 'failed';
  errorMessage: string;
  resolution: '1K' | '2K' | '4K';
  smartMode: ImageLabSmartMode;
  referenceImagePaths: string[];
  referenceImagePath: string;
  upstreamTaskId: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export type ImageLabSummary = Omit<ImageLabRecord, 'prompt' | 'referenceImagePaths' | 'referenceImagePath'> & {
  promptPreview: string;
};

export type ImageLabSmartMode = 'text-to-image' | 'cover' | 'blog-cover' | 'podcast-cover' | 'video-narration' | 'two-host-podcast' | 'reference-edit';

export type ImageLabGenerateInput = Pick<ImageLabRecord, 'prompt' | 'ratio' | 'style'> &
  Partial<Pick<ImageLabRecord, 'id' | 'provider' | 'resolution' | 'smartMode' | 'referenceImagePath' | 'referenceImagePaths' | 'upstreamTaskId' | 'createdAt'>>;

export type ImageLabImportInput = Pick<ImageLabRecord, 'prompt' | 'ratio' | 'style' | 'provider' | 'imagePath'> &
  Partial<Pick<ImageLabRecord, 'resolution' | 'smartMode' | 'referenceImagePath' | 'referenceImagePaths' | 'upstreamTaskId'>>;

export interface VoiceLabRecord {
  id: string;
  archivedAt?: string | null;
  managedStorageKey?: string | null;
  text: string;
  provider: TtsProvider;
  voiceId: string;
  voiceLabel: string;
  speed: number;
  audioPath: string;
  status: 'generated' | 'failed';
  errorMessage: string;
  createdAt: string;
  finishedAt: string | null;
}

export type VoiceLabSummary = Omit<VoiceLabRecord, 'text'> & {
  textPreview: string;
};

export type VoiceLabGenerateInput = Pick<VoiceLabRecord, 'text' | 'provider' | 'voiceId' | 'speed'> &
  Partial<Pick<VoiceLabRecord, 'id' | 'voiceLabel' | 'createdAt'>>;

export interface CreditTransaction {
  id: number;
  type: string;
  amount: number;
  balance: number;
  taskId: string | null;
  description: string;
  createdAt: string;
}

export interface MinimaxCloneVoice {
  voiceId: string;
  displayName: string;
  sourceAudioPath: string;
  createdAt: number;
  lastUsedAt: number;
}

export interface AccountProfile {
  displayName: string;
  email: string;
  workspace: string;
  avatarInitial: string;
  deviceId: string;
  balance: number;
}

export interface ActivationState {
  plan: 'trial' | 'local' | 'inactive';
  status: 'trial' | 'active' | 'inactive';
  code: string;
  expiresAt: string | null;
  message: string;
}

export interface UiPreferences {
  theme: ThemeName;
  activeView: ShellView;
  themePreferenceVersion: 1;
}

export type UiPreferencesUpdate =
  | { theme: ThemeName; activeView?: never }
  | { activeView: ShellView; theme?: never };

export interface CoverMetadata {
  title: string;
  subtitle: string[];
  summary: string;
  tags: string[];
  comments: string[];
}

export interface ImagePrompt {
  sceneId: number;
  cap: string;
  prompt: string;
  negativePrompt: string;
  style: string;
  ratio: string;
  characterProfile: string;
  referenceImagePaths?: string[];
}

export interface StoryboardScene {
  id: number;
  cap: string;
  descPrompt: string;
  durationMs: number;
}

export interface SubtitleCue {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

export interface SubtitleTrack {
  cues: SubtitleCue[];
  srt: string;
}

export interface MusicPlan {
  rhythmMode: MusicMvSettings['rhythmMode'];
  captionStyle: MusicMvSettings['captionStyle'];
  visualMotif: string;
  audioPath: string;
  audioDurationMs: number;
  segments: Array<{
    id: number;
    lyric: string;
    section: 'intro' | 'verse' | 'chorus' | 'bridge' | 'outro';
    startMs: number;
    durationMs: number;
    visualHint: string;
  }>;
}

export interface CharacterCard {
  summary: string;
  characters: Array<{
    name: string;
    appearance: string;
    wardrobe?: string;
    role?: string;
  }>;
  consistencyRules: string[];
}

export interface RewriteEvaluationResult {
  bestRound: number;
  evaluations: Array<{
    round: number;
    score: number;
    reason: string;
  }>;
  wordCountWarning?: string;
}

export interface AiSourceSection {
  source: string;
  title: string;
  url?: string;
  snippet?: string;
  content: string;
}

export interface AiSourceContext {
  query: string;
  sections: AiSourceSection[];
  warnings: string[];
}

export interface ResearchCopyComposeInput {
  keyword: string;
  extraRequirements: string;
  selectedSources: AiSourceSection[];
  targetLength?: number;
}

export interface ResearchCopyComposeResult {
  title: string;
  copy: string;
  raw: string;
  requestId: string | null;
}

export interface ViralAnalysisSettings {
  track: string;
  style: string;
  ratio: string;
  templateId: string;
  keyFrameCount?: number;
  storyboardSceneCount?: number;
  extraRequirements?: string;
}

export interface CreateViralAnalysisInput {
  url: string;
  platform?: ViralPlatform;
  title?: string;
  settings: ViralAnalysisSettings;
}

export interface ViralAnalysisCheckpoint {
  runGeneration: number;
  downloaded?: {
    source: ViralVideoSource;
    videoPath: string;
    provider: ViralDownloadProvider;
    normalizedUrl: string;
    usedCookieSource: ViralCookieSource;
  };
  extracted?: {
    audioPath: string;
    frames: Array<{ timestamp: number; framePath: string }>;
  };
  transcript?: ViralTranscriptSegment[];
  frames?: ViralFrameAnalysis[];
  contentBreakdown?: ViralContentBreakdown;
  recreation?: ViralRecreationDraft;
  completed?: { resultPath: string; videoPath: string };
}

export interface ViralTemplateSaveInput {
  storyTemplate: PromptTemplate;
  imageTemplate: CustomStyle;
}

export interface ViralAnalysisRecord {
  id: string;
  archivedAt?: string | null;
  managedStorageKey?: string | null;
  url: string;
  platform: ViralPlatform;
  title: string;
  status: ViralAnalysisStatus;
  currentStage: ViralAnalysisStage;
  progress: number;
  runGeneration?: number;
  resultGeneration?: number | null;
  settings: ViralAnalysisSettings;
  checkpoint?: ViralAnalysisCheckpoint | null;
  resultPath: string;
  videoPath: string;
  errorMessage: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  lastHeartbeatAt: string | null;
}

export type ViralAnalysisSummary = Omit<ViralAnalysisRecord, 'settings' | 'checkpoint' | 'resultPath' | 'videoPath'>;

export interface ViralAnalysisEvent {
  id?: string;
  seq?: number;
  analysisId: string;
  runGeneration?: number;
  type: string;
  stage: ViralAnalysisStage | string;
  detail: string;
  dataJson: string | null;
  ts: number;
}

export interface ViralVideoSource {
  platform: ViralPlatform;
  url: string;
  normalizedUrl: string;
  downloadProvider: ViralDownloadProvider;
  usedCookieSource: ViralCookieSource;
  videoPath: string;
  coverPath: string;
  title: string;
  author: string;
  duration: number;
  stats: {
    likes: number | null;
    comments: number | null;
    shares: number | null;
  };
}

export interface ViralTranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface ViralTranscriptSegment {
  text: string;
  start: number;
  end: number;
  words: ViralTranscriptWord[];
}

export interface ViralFrameAnalysis {
  timestamp: number;
  framePath: string;
  shotType: string;
  cameraMovement: string;
  composition: string;
  transition: string;
  textOverlay: string | null;
  visualDescription: string;
  mood: string;
  keyElements: string[];
  imagePrompt: string;
}

export interface ViralContentBreakdown {
  topic: string;
  title: {
    original: string;
    pattern: string;
    suggestions: string[];
  };
  cover: {
    observed: string;
    pattern: string;
    suggestions: string[];
  };
  opening: {
    type: '开门见山' | '引用金句' | '亮点前置' | '抛出观点' | string;
    analysis: string;
    reusablePattern: string;
  };
  structure: {
    type: '总分结构' | '递进结构' | '平行结构' | string;
    analysis: string;
    outline: string[];
  };
  ending: {
    type: '总结型结尾' | '引导型结尾' | '预告型结尾' | string;
    analysis: string;
    reusablePattern: string;
  };
  viralPoint: {
    summary: string;
    evidence: string[];
    reusablePattern: string;
  };
}

export interface ViralRecreationDraft {
  formula: {
    main: string;
    title: string;
    cover: string;
    opening: string;
    structure: string;
    ending: string;
  };
  templatePrompt: string;
  storyCore: {
    who: string;
    where: string;
    whatHappened: string;
    why: string;
    turningPoint: string;
    result: string;
  };
  storyContent: string;
  blueprint: string;
  openingOptions: string[];
  titleOptions: string[];
  coverIdeas: string[];
  script: string;
  storyboardHints: string[];
  taskDefaults: {
    track: string;
    style: string;
    ratio: string;
    storyboardSceneCount: number;
  };
}

export interface ViralAnalysisResult {
  source: ViralVideoSource;
  transcript: ViralTranscriptSegment[];
  frames: ViralFrameAnalysis[];
  contentBreakdown: ViralContentBreakdown;
  recreation: ViralRecreationDraft;
  createdAt: string;
}

export interface ViralProductionTaskOptions {
  title?: string;
  track?: string;
  style?: string;
  ratio?: string;
  templateId?: string;
  storyboardSceneCount?: number;
}

export interface PipelineArtifact {
  reviewedText: string;
  rewrittenCopy: string;
  cover: CoverMetadata;
  scenes: StoryboardScene[];
  imagePrompts: ImagePrompt[];
  subtitles: SubtitleTrack;
  sourceContext?: AiSourceContext;
  musicPlan?: MusicPlan;
  characterCard?: CharacterCard;
  rewriteEvaluation?: RewriteEvaluationResult;
}

export type TaskArtifactStepStatus = 'pending' | 'running' | 'completed' | 'failed';
export type TaskStepRerunMode = 'regenerate' | 'rewrite';

export interface TaskArtifactStepPreview {
  status: TaskArtifactStepStatus;
  outputPath?: string;
  error?: string;
  completedAt?: string;
}

export interface TaskArtifactAssetPreview {
  sceneId: number;
  path: string;
  speaker?: 'A' | 'B';
  turnIndex?: number;
  text?: string;
}

export interface TaskArtifactImageErrorPreview {
  sceneId: number;
  message: string;
}

export interface TaskDraftArtifactPreview {
  draftDir: string;
  draftContentPath: string;
  draftMetaPath: string;
}

export interface TaskArtifactSnapshot {
  available: boolean;
  message: string;
  taskId: string;
  statePath: string;
  outputDir: string;
  updatedAt: string | null;
  steps: Record<string, TaskArtifactStepPreview>;
  artifact: Partial<PipelineArtifact>;
  assets: {
    cover: TaskArtifactAssetPreview[];
    images: TaskArtifactAssetPreview[];
    imageErrors: TaskArtifactImageErrorPreview[];
    narration: TaskArtifactAssetPreview[];
  };
  draft: TaskDraftArtifactPreview | null;
}

export interface DraftTemplate {
  id: string;
  name: string;
  isDefault: boolean;
  updatedAt?: string;
  canvas: {
    width: number;
    height: number;
    ratio: string;
    backgroundColor: string;
    backgroundImage: string;
  };
  image: {
    visible: boolean;
    ratio: string;
    fit: 'cover' | 'contain';
    top: number;
    height: number;
    animation: string;
  };
  title: {
    visible: boolean;
    text: string;
    x: number;
    y: number;
    width: number;
    fontSize: number;
    color: string;
    alpha: number;
    bold: boolean;
    underline: boolean;
    align: number;
    letterSpacing: number;
    lineSpacing: number;
    border: DraftTextBorder;
  };
  subtitle: {
    visible: boolean;
    text: string;
    x: number;
    y: number;
    width: number;
    fontSize: number;
    color: string;
    alpha: number;
    bold: boolean;
    underline: boolean;
    align: number;
    letterSpacing: number;
    lineSpacing: number;
    border: DraftTextBorder;
  };
  caption: {
    visible: boolean;
    x: number;
    y: number;
    width: number;
    fontSize: number;
    color: string;
    alpha: number;
    border: DraftTextBorder;
    bold: boolean;
    underline: boolean;
    align: number;
    letterSpacing: number;
    lineSpacing: number;
    maxCharsPerLine: number;
    background: {
      color: string;
      alpha: number;
      roundRadius: number;
    };
  };
  disclaimer: {
    visible: boolean;
    text: string;
    x: number;
    y: number;
    width: number;
    fontSize: number;
    color: string;
    alpha: number;
    bold: boolean;
    underline: boolean;
    align: number;
    letterSpacing: number;
    lineSpacing: number;
    border: DraftTextBorder;
  };
  audio: {
    narrationVolume: number;
    bgmVolume: number;
    transitionType: string;
    transitionDurationMs: number;
    narrationFadeInMs: number;
    narrationFadeOutMs: number;
    bgmFadeInMs: number;
    bgmFadeOutMs: number;
    filterType: string;
    videoEffectType: string;
    audioEffectType: string;
  };
}

export interface DraftTextBorder {
  color: string;
  width: number;
  alpha: number;
}

export interface DraftTemplateSummary {
  id: string;
  name: string;
  isDefault: boolean;
  canvas: Pick<DraftTemplate['canvas'], 'width' | 'height' | 'ratio'>;
  updatedAt: string;
}

export interface BootstrapState {
  revision: number;
  config: AppConfig;
  secretStatus: Partial<Record<string, boolean>>;
  tasks: HistoryPage<'task', TaskSummary>;
  viralAnalyses: HistoryPage<'viral-analysis', ViralAnalysisSummary>;
  imageLabRecords: HistoryPage<'image-lab', ImageLabSummary>;
  voiceLabRecords: HistoryPage<'voice-lab', VoiceLabSummary>;
  promptTemplates: CursorPage<PromptTemplateSummary>;
  draftTemplates: CursorPage<DraftTemplateSummary>;
  customStyles: CustomStyle[];
  customCoverTemplates: CustomCoverTemplate[];
  creditTransactions: CreditTransaction[];
  minimaxCloneVoices: MinimaxCloneVoice[];
  account: AccountProfile;
  activation: ActivationState;
  ui: UiPreferences;
}

export type AppStatePatch =
  | { kind: 'config'; config: AppConfig; secretStatus: Partial<Record<string, boolean>> }
  | { kind: 'theme-preference'; config: AppConfig; ui: UiPreferences }
  | { kind: 'prompt-template-upsert'; template: PromptTemplate }
  | { kind: 'prompt-templates-reset'; templates: PromptTemplateSummary[] }
  | { kind: 'custom-style-upsert'; style: CustomStyle }
  | { kind: 'viral-templates-upsert'; storyTemplate: PromptTemplate; imageTemplate: CustomStyle }
  | { kind: 'draft-template-upsert'; template: DraftTemplate }
  | { kind: 'image-lab-upsert'; record: ImageLabSummary }
  | { kind: 'voice-lab-upsert'; record: VoiceLabSummary }
  | { kind: 'account'; account: AccountProfile }
  | { kind: 'activation'; activation: ActivationState }
  | { kind: 'ui'; ui: UiPreferences };

export type AppDelta =
  | { kind: 'task-upsert'; task: TaskSummary; revision: number }
  | { kind: 'task-event'; event: SequencedTaskEvent; revision: number }
  | { kind: 'viral-upsert'; record: ViralAnalysisSummary; revision: number }
  | { kind: 'state-patch'; patch: AppStatePatch; revision: number }
  | TaskTombstoneResult
  | ViralAnalysisTombstoneResult
  | ImageLabTombstoneResult
  | VoiceLabTombstoneResult;

export type AppMutationResult = Extract<AppDelta, {
  kind:
    | 'task-upsert'
    | 'viral-upsert'
    | 'state-patch'
    | 'task-tombstone'
    | 'viral-tombstone'
    | 'image-lab-tombstone'
    | 'voice-lab-tombstone';
}>;

export interface AppDeltaReconcileRequest {
  sinceRevision: number;
  taskId?: string;
  viralAnalysisId?: string;
  forceReset?: boolean;
}

export interface AppDeltaReconcileResult {
  revision: number;
  deltas: AppDelta[];
  resetRequired: boolean;
  task: Task | null;
  taskEvents: SequencedTaskEvent[];
  viralAnalysis: ViralAnalysisRecord | null;
  viralEvents: ViralAnalysisEvent[];
}

export interface DiagnosticCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface DiagnosticsReport {
  generatedAt: string;
  checks: DiagnosticCheck[];
}

export interface AppState {
  config: AppConfig;
  tasks: Task[];
  events: TaskEvent[];
  viralAnalyses: ViralAnalysisRecord[];
  viralEvents: ViralAnalysisEvent[];
  promptTemplates: PromptTemplate[];
  draftTemplates: DraftTemplate[];
  imageLabRecords: ImageLabRecord[];
  voiceLabRecords: VoiceLabRecord[];
  customStyles: CustomStyle[];
  customCoverTemplates: CustomCoverTemplate[];
  creditTransactions: CreditTransaction[];
  minimaxCloneVoices: MinimaxCloneVoice[];
  account: AccountProfile;
  activation: ActivationState;
  ui: UiPreferences;
}
