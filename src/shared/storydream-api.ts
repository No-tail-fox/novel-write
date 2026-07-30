import type {
  AccountProfile,
  ActivationState,
  AiSourceContext,
  AppConfig,
  AppDelta,
  AppDeltaReconcileRequest,
  AppDeltaReconcileResult,
  AppMutationResult,
  BookSelectionInput,
  BookSelectionRecord,
  BootstrapState,
  ConfigTestResult,
  ConfigTestTarget,
  CreateTaskInput,
  CreateViralAnalysisInput,
  CountedCursorPage,
  CursorPage,
  CursorRequest,
  CustomStyle,
  CustomStyleGenerateInput,
  DraftTemplate,
  DraftTemplateSummary,
  HistoryPage,
  HtmlVideoConfigChange,
  HtmlVideoCompositionSource,
  HtmlVideoCompositionSourceLintInput,
  HtmlVideoCompositionSourceSaveInput,
  HtmlVideoCompositionSourceSaveResult,
  HtmlVideoLintFinding,
  HistoryListInput,
  ImageLabGenerateInput,
  ImageLabImportInput,
  ImageLabRecord,
  ImageLabSummary,
  ImageLabTombstoneResult,
  ImaKnowledgeRequest,
  ImaKnowledgeResult,
  JianyingEffectCatalog,
  LlmConfig,
  LlmModelTestResult,
  MinimaxCloneVoice,
  MinimaxCloneVoiceInput,
  OrdinaryTaskCoverRatio,
  OrdinaryTaskCoverSelection,
  PromptTemplate,
  PromptTemplateSummary,
  ProviderModelListRequest,
  ProviderModelListResult,
  ResearchCopyComposeInput,
  ResearchCopyComposeResult,
  SequencedTaskEvent,
  Task,
  TaskArtifactSnapshot,
  TaskStatus,
  TaskStepRerunMode,
  TaskSummary,
  UiPreferencesUpdate,
  ViralAnalysisEvent,
  ViralAnalysisRecord,
  ViralAnalysisResult,
  ViralAnalysisStatus,
  ViralAnalysisSummary,
  ViralProductionTaskOptions,
  ViralTemplateSaveInput,
  VoiceLabGenerateInput,
  VoiceLabRecord,
  VoiceLabSummary,
  VolcengineSpeakerListRequest,
  VolcengineSpeakerListResult,
} from './types';
import type { PublicAppState as AppState, SaveConfigInput, SecretChanges } from './config-secrets';
import type { PersonAssetImage, PersonAssetSummary } from './person-assets';

export const INVOKE_CHANNELS = Object.freeze([
  'app:get-state',
  'app:get-bootstrap',
  'app:reconcile-deltas',
  'task:list',
  'task:archive',
  'task:restore',
  'task:delete',
  'task:get-detail',
  'task:list-events',
  'task:open-output-directory',
  'viral:list',
  'viral:archive',
  'viral:restore',
  'viral:delete',
  'viral:get-detail',
  'viral:list-events',
  'image-lab:list',
  'image-lab:archive',
  'image-lab:restore',
  'image-lab:delete',
  'image-lab:get-detail',
  'voice-lab:list',
  'voice-lab:archive',
  'voice-lab:restore',
  'voice-lab:delete',
  'voice-lab:get-detail',
  'prompt-template:list',
  'prompt-template:get-detail',
  'draft-template:list',
  'draft-template:get-detail',
  'minimax-clone-voice:list',
  'minimax-clone-voice:save',
  'minimax-clone-voice:delete',
  'app:save-config',
  'config:test',
  'ima:fetch-knowledge',
  'llm:test-config',
  'models:list',
  'volcengine:speakers:list',
  'research:web-search',
  'research:compose-copy',
  'prompt-template:save',
  'prompt-template:reset',
  'custom-style:save',
  'viral:save-templates',
  'custom-style:generate-draft',
  'draft-template:save',
  'image-lab:generate',
  'image-lab:add-record',
  'voice-lab:generate',
  'account:save',
  'activation:save',
  'ui:save-preferences',
  'book-selection:list',
  'book-selection:save',
  'book-selection:delete',
  'person-assets:list',
  'person-assets:create',
  'person-assets:rename',
  'person-assets:delete',
  'person-assets:import-images',
  'person-assets:list-images',
  'person-assets:open-directory',
  'html-video:create-task',
  'html-video:update-config',
  'html-video:import-cover',
  'html-video:composition-source:get',
  'html-video:composition-source:lint',
  'html-video:composition-source:save',
  'task:import-cover',
  'html-video:open-preview',
  'html-video:media-url',
  'task:create-and-run',
  'viral:create-and-run',
  'viral:update-status',
  'viral:retry',
  'viral:get-result',
  'viral:create-production-task',
  'task:update-status',
  'task:retry',
  'task:regenerate-image',
  'task:regenerate-narration',
  'task:update-image-prompt',
  'task:rerun-step',
  'task:get-artifacts',
  'asset:read-data-url',
  'local-image:select',
  'local-audio:select',
  'local-folder:select',
  'cookie-file:select',
  'viral:open-login-window',
  'jianying:draft-path:detect',
  'jianying:effect-catalog',
  'diagnostics:run',
  'window:control',
] as const);

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];

type LocalBookPersonAssetApi = {
  listBookSelections: (theme?: string) => Promise<BookSelectionRecord[]>;
  saveBookSelection: (input: BookSelectionInput) => Promise<BookSelectionRecord>;
  deleteBookSelection: (theme: string, bookId: string) => Promise<void>;
  listPersonAssets: () => Promise<PersonAssetSummary[]>;
  createPersonAsset: (name: string) => Promise<PersonAssetSummary>;
  renamePersonAsset: (oldName: string, newName: string) => Promise<string>;
  deletePersonAsset: (name: string) => Promise<void>;
  importPersonAssetImages: (name: string) => Promise<number>;
  listPersonAssetImages: (name: string) => Promise<PersonAssetImage[]>;
  openPersonAssetDirectory: (name: string) => Promise<void>;
};

export type StoryDreamApi = {
  getState: () => Promise<AppState>;
  getBootstrap: () => Promise<BootstrapState>;
  reconcileDeltas: (input: AppDeltaReconcileRequest) => Promise<AppDeltaReconcileResult>;
  listTasks: (request?: HistoryListInput<'task'>) => Promise<HistoryPage<'task', TaskSummary>>;
  archiveTask: (id: string) => Promise<AppMutationResult>;
  restoreTask: (id: string) => Promise<AppMutationResult>;
  deleteTaskPermanently: (id: string) => Promise<AppMutationResult>;
  getTaskDetail: (id: string) => Promise<Task | null>;
  listTaskEvents: (taskId: string, request?: CursorRequest) => Promise<CursorPage<SequencedTaskEvent>>;
  openTaskOutputDirectory: (id: string) => Promise<void>;
  listViralAnalyses: (request?: HistoryListInput<'viral-analysis'>) => Promise<HistoryPage<'viral-analysis', ViralAnalysisSummary>>;
  archiveViralAnalysis: (id: string) => Promise<AppMutationResult>;
  restoreViralAnalysis: (id: string) => Promise<AppMutationResult>;
  deleteViralAnalysisPermanently: (id: string) => Promise<AppMutationResult>;
  getViralAnalysisDetail: (id: string) => Promise<ViralAnalysisRecord | null>;
  listViralEvents: (analysisId: string, request?: CursorRequest) => Promise<CursorPage<ViralAnalysisEvent>>;
  listImageLabRecords: (request?: HistoryListInput<'image-lab'>) => Promise<HistoryPage<'image-lab', ImageLabSummary>>;
  archiveImageLabRecord: (id: string) => Promise<AppMutationResult>;
  restoreImageLabRecord: (id: string) => Promise<AppMutationResult>;
  deleteImageLabRecordPermanently: (id: string) => Promise<AppMutationResult>;
  getImageLabRecordDetail: (id: string) => Promise<ImageLabRecord | null>;
  listVoiceLabRecords: (request?: HistoryListInput<'voice-lab'>) => Promise<HistoryPage<'voice-lab', VoiceLabSummary>>;
  archiveVoiceLabRecord: (id: string) => Promise<AppMutationResult>;
  restoreVoiceLabRecord: (id: string) => Promise<AppMutationResult>;
  deleteVoiceLabRecordPermanently: (id: string) => Promise<AppMutationResult>;
  getVoiceLabRecordDetail: (id: string) => Promise<VoiceLabRecord | null>;
  listPromptTemplates: (request?: CursorRequest) => Promise<CursorPage<PromptTemplateSummary>>;
  getPromptTemplateDetail: (id: string) => Promise<PromptTemplate | null>;
  listDraftTemplates: (request?: CursorRequest) => Promise<CursorPage<DraftTemplateSummary>>;
  getDraftTemplateDetail: (id: string) => Promise<DraftTemplate | null>;
  listMinimaxCloneVoices: (request?: CursorRequest) => Promise<CountedCursorPage<MinimaxCloneVoice>>;
  saveMinimaxCloneVoice: (input: MinimaxCloneVoiceInput) => Promise<AppMutationResult | null>;
  deleteMinimaxCloneVoice: (voiceId: string) => Promise<AppMutationResult | null>;
  saveConfig: (input: SaveConfigInput) => Promise<AppMutationResult | null>;
  testAppConfig: (target: ConfigTestTarget, config: AppConfig, secretChanges?: SecretChanges) => Promise<ConfigTestResult>;
  fetchImaKnowledge: (input: ImaKnowledgeRequest) => Promise<ImaKnowledgeResult>;
  testLlmConfig: (config: LlmConfig) => Promise<LlmModelTestResult>;
  listProviderModels: (request: ProviderModelListRequest) => Promise<ProviderModelListResult>;
  listVolcengineSpeakers: (request: VolcengineSpeakerListRequest) => Promise<VolcengineSpeakerListResult>;
  searchWebSources: (query: string) => Promise<AiSourceContext>;
  composeResearchCopy: (input: ResearchCopyComposeInput) => Promise<ResearchCopyComposeResult>;
  savePromptTemplate: (template: PromptTemplate) => Promise<AppMutationResult | null>;
  resetPromptTemplates: () => Promise<AppMutationResult | null>;
  saveCustomStyle: (style: CustomStyle) => Promise<AppMutationResult | null>;
  saveViralTemplates: (input: ViralTemplateSaveInput) => Promise<AppMutationResult | null>;
  generateCustomStyleDraft: (input: CustomStyleGenerateInput) => Promise<CustomStyle>;
  saveDraftTemplate: (template: DraftTemplate) => Promise<AppMutationResult | null>;
  generateImageLab: (input: ImageLabGenerateInput) => Promise<AppMutationResult | null>;
  addImageLabRecord: (input: ImageLabImportInput) => Promise<AppMutationResult | null>;
  generateVoiceLabPreview: (input: VoiceLabGenerateInput) => Promise<AppMutationResult | null>;
  saveAccount: (account: AccountProfile) => Promise<AppMutationResult | null>;
  saveActivation: (activation: ActivationState) => Promise<AppMutationResult | null>;
  saveUiPreferences: (update: UiPreferencesUpdate) => Promise<AppMutationResult | null>;
  createHtmlVideoTask: (input: CreateTaskInput) => Promise<AppMutationResult | null>;
  updateHtmlVideoConfig: (id: string, changes: HtmlVideoConfigChange[]) => Promise<AppMutationResult | null>;
  importHtmlVideoCover: (id: string) => Promise<AppMutationResult | null>;
  getHtmlVideoCompositionSource: (taskId: string, sceneIndex: number) => Promise<HtmlVideoCompositionSource>;
  lintHtmlVideoCompositionSource: (input: HtmlVideoCompositionSourceLintInput) => Promise<HtmlVideoLintFinding[]>;
  saveHtmlVideoCompositionSource: (input: HtmlVideoCompositionSourceSaveInput) => Promise<HtmlVideoCompositionSourceSaveResult>;
  importOrdinaryTaskCover: (ratio: OrdinaryTaskCoverRatio) => Promise<OrdinaryTaskCoverSelection | null>;
  openHtmlVideoPreview: (id: string, sceneIndex?: number) => Promise<void>;
  getHtmlVideoMediaUrl: (id: string, path: string) => Promise<string>;
  createAndRunTask: (input: CreateTaskInput) => Promise<AppMutationResult | null>;
  createAndRunViralAnalysis: (input: CreateViralAnalysisInput) => Promise<AppMutationResult | null>;
  updateViralAnalysisStatus: (id: string, status: ViralAnalysisStatus) => Promise<AppMutationResult | null>;
  retryViralAnalysis: (id: string) => Promise<AppMutationResult | null>;
  getViralAnalysisResult: (id: string) => Promise<ViralAnalysisResult>;
  createProductionTaskFromViral: (id: string, options?: ViralProductionTaskOptions) => Promise<AppMutationResult | null>;
  updateTaskStatus: (id: string, status: Extract<TaskStatus, 'running' | 'paused' | 'cancelled'>) => Promise<AppMutationResult | null>;
  retryTask: (id: string) => Promise<AppMutationResult | null>;
  regenerateTaskImage: (id: string, sceneId: number) => Promise<AppMutationResult | null>;
  regenerateTaskNarration: (id: string, sceneId: number) => Promise<AppMutationResult | null>;
  updateTaskImagePrompt: (id: string, sceneId: number, prompt: string) => Promise<AppMutationResult | null>;
  rerunTaskStep: (id: string, step: number, mode: TaskStepRerunMode) => Promise<AppMutationResult | null>;
  getTaskArtifacts: (id: string) => Promise<TaskArtifactSnapshot>;
  readAssetDataUrl: (path: string) => Promise<string>;
  selectLocalImage: () => Promise<string | null>;
  selectLocalAudio: () => Promise<string | null>;
  selectLocalFolder: () => Promise<string | null>;
  selectCookieFile: () => Promise<string | null>;
  openViralLoginWindow: () => Promise<string | null>;
  detectJianyingDraftPath: () => Promise<string>;
  getJianyingEffectCatalog: () => Promise<JianyingEffectCatalog>;
  runDiagnostics: () => Promise<{ generatedAt: string; checks: Array<{ id: string; label: string; status: string; detail: string }> }>;
  windowControl: (action: 'minimize' | 'toggle-maximize' | 'close') => Promise<void>;
  onAppDelta: (callback: (delta: AppDelta) => void) => () => void;
} & LocalBookPersonAssetApi;
