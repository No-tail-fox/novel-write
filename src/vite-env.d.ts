import type {
  AccountProfile,
  ActivationState,
  AiSourceContext,
  AppDelta,
  AppDeltaReconcileRequest,
  AppDeltaReconcileResult,
  AppMutationResult,
  AppConfig,
  BootstrapState,
  BookSelectionInput,
  BookSelectionRecord,
  ConfigTestResult,
  ConfigTestTarget,
  CreateTaskInput,
  CreateViralAnalysisInput,
  CursorPage,
  CursorRequest,
  CustomStyle,
  CustomStyleGenerateInput,
  DraftTemplate,
  DraftTemplateSummary,
  ImageLabGenerateInput,
  ImageLabRecord,
  ImageLabSummary,
  JianyingEffectCatalog,
  LlmConfig,
  LlmModelTestResult,
  PromptTemplate,
  PromptTemplateSummary,
  ProviderModelListRequest,
  ProviderModelListResult,
  ResearchCopyComposeInput,
  ResearchCopyComposeResult,
  TaskArtifactSnapshot,
  SequencedTaskEvent,
  Task,
  TaskSummary,
  TaskStepRerunMode,
  TaskStatus,
  UiPreferences,
  ViralAnalysisResult,
  ViralAnalysisEvent,
  ViralAnalysisSummary,
  ViralAnalysisRecord,
  ViralAnalysisStatus,
  ViralProductionTaskOptions,
  VolcengineSpeakerListRequest,
  VolcengineSpeakerListResult,
  VoiceLabGenerateInput,
  VoiceLabRecord,
  VoiceLabSummary,
} from './shared/types';
import type { PublicAppState as AppState, SaveConfigInput, SecretChanges } from './shared/config-secrets';
import type { PersonAssetImage, PersonAssetSummary } from './shared/person-assets';

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
};

declare global {
  interface Window {
    storydream?: {
      getState: () => Promise<AppState>;
      getBootstrap: () => Promise<BootstrapState>;
      reconcileDeltas: (input: AppDeltaReconcileRequest) => Promise<AppDeltaReconcileResult>;
      listTasks: (request?: CursorRequest) => Promise<CursorPage<TaskSummary>>;
      getTaskDetail: (id: string) => Promise<Task | null>;
      listTaskEvents: (taskId: string, request?: CursorRequest) => Promise<CursorPage<SequencedTaskEvent>>;
      listViralAnalyses: (request?: CursorRequest) => Promise<CursorPage<ViralAnalysisSummary>>;
      getViralAnalysisDetail: (id: string) => Promise<ViralAnalysisRecord | null>;
      listViralEvents: (analysisId: string, request?: CursorRequest) => Promise<CursorPage<ViralAnalysisEvent>>;
      listImageLabRecords: (request?: CursorRequest) => Promise<CursorPage<ImageLabSummary>>;
      getImageLabRecordDetail: (id: string) => Promise<ImageLabRecord | null>;
      listVoiceLabRecords: (request?: CursorRequest) => Promise<CursorPage<VoiceLabSummary>>;
      getVoiceLabRecordDetail: (id: string) => Promise<VoiceLabRecord | null>;
      listPromptTemplates: (request?: CursorRequest) => Promise<CursorPage<PromptTemplateSummary>>;
      getPromptTemplateDetail: (id: string) => Promise<PromptTemplate | null>;
      listDraftTemplates: (request?: CursorRequest) => Promise<CursorPage<DraftTemplateSummary>>;
      getDraftTemplateDetail: (id: string) => Promise<DraftTemplate | null>;
      saveConfig: (input: SaveConfigInput) => Promise<AppMutationResult | null>;
      testAppConfig: (target: ConfigTestTarget, config: AppConfig, secretChanges?: SecretChanges) => Promise<ConfigTestResult>;
      testLlmConfig: (config: LlmConfig) => Promise<LlmModelTestResult>;
      listProviderModels: (request: ProviderModelListRequest) => Promise<ProviderModelListResult>;
      listVolcengineSpeakers: (request: VolcengineSpeakerListRequest) => Promise<VolcengineSpeakerListResult>;
      searchWebSources: (query: string) => Promise<AiSourceContext>;
      composeResearchCopy: (input: ResearchCopyComposeInput) => Promise<ResearchCopyComposeResult>;
      savePromptTemplate: (template: PromptTemplate) => Promise<AppMutationResult | null>;
      resetPromptTemplates: () => Promise<AppMutationResult | null>;
      saveCustomStyle: (style: CustomStyle) => Promise<AppMutationResult | null>;
      generateCustomStyleDraft: (input: CustomStyleGenerateInput) => Promise<CustomStyle>;
      saveDraftTemplate: (template: DraftTemplate) => Promise<AppMutationResult | null>;
      generateImageLab: (input: ImageLabGenerateInput) => Promise<AppMutationResult | null>;
      addImageLabRecord: (input: Partial<ImageLabRecord> & Pick<ImageLabRecord, 'prompt' | 'ratio' | 'style' | 'provider'>) => Promise<AppMutationResult | null>;
      generateVoiceLabPreview: (input: VoiceLabGenerateInput) => Promise<AppMutationResult | null>;
      saveAccount: (account: AccountProfile) => Promise<AppMutationResult | null>;
      saveActivation: (activation: ActivationState) => Promise<AppMutationResult | null>;
      saveUiPreferences: (ui: UiPreferences) => Promise<AppMutationResult | null>;
      createHtmlVideoTask: (input: CreateTaskInput) => Promise<AppMutationResult | null>;
      openHtmlVideoPreview: (id: string, sceneIndex?: number) => Promise<void>;
      getHtmlVideoMediaUrl: (id: string, path: string) => Promise<string>;
      createAndRunTask: (input: CreateTaskInput) => Promise<AppMutationResult | null>;
      createAndRunViralAnalysis: (input: CreateViralAnalysisInput) => Promise<AppMutationResult | null>;
      updateViralAnalysisStatus: (id: string, status: ViralAnalysisStatus) => Promise<AppMutationResult | null>;
      retryViralAnalysis: (id: string) => Promise<AppMutationResult | null>;
      getViralAnalysisResult: (id: string) => Promise<ViralAnalysisResult>;
      createProductionTaskFromViral: (id: string, options?: ViralProductionTaskOptions) => Promise<AppMutationResult | null>;
      updateTaskStatus: (id: string, status: TaskStatus) => Promise<AppMutationResult | null>;
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
      openPath: (path: string) => Promise<void>;
      windowControl: (action: 'minimize' | 'toggle-maximize' | 'close') => Promise<void>;
      onAppDelta: (callback: (delta: AppDelta) => void) => () => void;
    } & LocalBookPersonAssetApi;
    storybound?: Window['storydream'];
  }
}
