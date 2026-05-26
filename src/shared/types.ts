export type TaskStatus = 'draft' | 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type ThemeName = 'dark' | 'light';
export type ShellView =
  | 'new-task'
  | 'queue'
  | 'history'
  | 'image-lab'
  | 'prompt-templates'
  | 'draft-templates'
  | 'settings'
  | 'account'
  | 'activation';

export type TaskMode = 'paste' | 'ai';
export type PromptTemplateType = 'review' | 'rewrite' | 'cover' | 'storyboard' | 'image-prompt' | 'task';
export type ImageProvider = 'gpt_image' | 'jimeng' | 'custom' | 'mock';
export type TtsProvider = 'volcengine' | 'minimax' | 'mock';
export type PausePoint = 'none' | 'critical' | 'every-step' | 'custom';
export type RewriteIntensity = 'standard' | 'deep' | 'original';
export type NarrativePov = 'keep-original' | 'first-person' | 'third-person';

export interface LlmConfig {
  provider: string;
  protocol?: 'openai';
  apiKey: string;
  baseUrl: string;
  model: string;
  proxyUrl: string;
}

export interface ImageConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  ratio: string;
  concurrency: number;
  resolution?: '1K' | '2K' | '4K';
  proxyUrl?: string;
}

export interface JimengConfig {
  sessionId: string;
  model: string;
  ratio: string;
  resolution: '1K' | '2K' | '4K';
  concurrency: number;
}

export interface CustomImageConfig extends ImageConfig {
  displayName: string;
  asyncMode: boolean;
  ratioMappingJson: string;
}

export interface TtsConfig {
  provider: TtsProvider;
  appId: string;
  accessKey: string;
  speaker: string;
  volcengine: {
    appId: string;
    accessKey: string;
    speaker: string;
  };
  minimax: {
    apiKey: string;
    model: string;
    voiceId: string;
  };
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
}

export interface ImaConfig {
  clientId: string;
  apiKey: string;
  kbId: string;
  kbName: string;
}

export interface AppConfig {
  llm: LlmConfig;
  llmProfiles: LlmConfig[];
  imageProvider: ImageProvider;
  image: ImageConfig;
  gptImage: ImageConfig;
  jimeng: JimengConfig;
  customImage: CustomImageConfig;
  tts: TtsConfig;
  jianying: JianyingConfig;
  ima: ImaConfig;
  ui: {
    theme: ThemeName;
  };
}

export interface Task {
  id: string;
  title: string;
  inputText: string;
  status: TaskStatus;
  currentStep: number;
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
  mode: TaskMode;
  aiKeyword: string;
  aiSources: string[];
  extraRequirements: string;
  promptTemplateId: string | null;
  promptTemplateType: string | null;
  referenceImagePath: string;
  rewriteIntensity: RewriteIntensity;
  narrativePov: NarrativePov;
  keepPromotion: boolean;
  ttsProvider: TtsProvider;
  ttsSpeed: number;
  step3PromptSnapshot: string;
}

export type CreateTaskInput = Partial<
  Pick<
    Task,
    | 'title'
    | 'inputText'
    | 'mode'
    | 'aiKeyword'
    | 'aiSources'
    | 'extraRequirements'
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
    | 'step3PromptSnapshot'
  >
> & {
  inputText: string;
};

export interface TaskEvent {
  seq?: number;
  taskId: string;
  type: string;
  step: number | null;
  agent: string | null;
  tool: string | null;
  detail: string;
  dataJson: string | null;
  ts: number;
}

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
  characterPolicy?: 'follow-template' | 'force-extract' | 'force-skip';
  step3SkeletonModules?: string[];
  referenceKind?: 'none' | 'face' | 'product';
  origin?: 'system' | 'custom' | 'market';
  usedCount?: number;
  marketTags?: string[];
}

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

export interface ImageLabRecord {
  id: string;
  prompt: string;
  ratio: string;
  style: string;
  provider: ImageProvider | string;
  imagePath: string;
  status: 'mock' | 'generated' | 'failed';
  errorMessage: string;
  resolution: '1K' | '2K' | '4K';
  referenceImagePath: string;
  upstreamTaskId: string | null;
  createdAt: string;
  finishedAt: string | null;
}

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
}

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

export interface PipelineArtifact {
  reviewedText: string;
  rewrittenCopy: string;
  cover: CoverMetadata;
  scenes: StoryboardScene[];
  imagePrompts: ImagePrompt[];
  subtitles: SubtitleTrack;
}

export interface DraftTemplate {
  id: string;
  name: string;
  isDefault: boolean;
  canvas: {
    width: number;
    height: number;
    ratio: string;
    backgroundColor: string;
    backgroundImage: string;
  };
  image: {
    ratio: string;
    fit: 'cover' | 'contain';
    top: number;
    height: number;
    animation: string;
  };
  title: {
    visible: boolean;
    text: string;
    fontSize: number;
    color: string;
  };
  subtitle: {
    visible: boolean;
    fontSize: number;
    color: string;
  };
  caption: {
    visible: boolean;
    x: number;
    y: number;
    fontSize: number;
    color: string;
    alpha: number;
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
  };
  audio: {
    narrationVolume: number;
    bgmVolume: number;
    bgmFadeOutMs: number;
  };
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
  promptTemplates: PromptTemplate[];
  draftTemplates: DraftTemplate[];
  imageLabRecords: ImageLabRecord[];
  customStyles: CustomStyle[];
  creditTransactions: CreditTransaction[];
  minimaxCloneVoices: MinimaxCloneVoice[];
  account: AccountProfile;
  activation: ActivationState;
  ui: UiPreferences;
}
