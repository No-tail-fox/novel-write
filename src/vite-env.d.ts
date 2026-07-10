import type {
  AccountProfile,
  ActivationState,
  AiSourceContext,
  AppConfig,
  BookSelectionInput,
  BookSelectionRecord,
  ConfigTestResult,
  ConfigTestTarget,
  CreateTaskInput,
  CreateViralAnalysisInput,
  CustomStyle,
  CustomStyleGenerateInput,
  DraftTemplate,
  ImageLabGenerateInput,
  ImageLabRecord,
  JianyingEffectCatalog,
  LlmConfig,
  LlmModelTestResult,
  PromptTemplate,
  ProviderModelListRequest,
  ProviderModelListResult,
  ResearchCopyComposeInput,
  ResearchCopyComposeResult,
  TaskArtifactSnapshot,
  TaskStepRerunMode,
  TaskStatus,
  UiPreferences,
  ViralAnalysisResult,
  ViralAnalysisStatus,
  ViralProductionTaskOptions,
  VolcengineSpeakerListRequest,
  VolcengineSpeakerListResult,
  VoiceLabGenerateInput,
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
      saveConfig: (input: SaveConfigInput) => Promise<AppState>;
      testAppConfig: (target: ConfigTestTarget, config: AppConfig, secretChanges?: SecretChanges) => Promise<ConfigTestResult>;
      testLlmConfig: (config: LlmConfig) => Promise<LlmModelTestResult>;
      listProviderModels: (request: ProviderModelListRequest) => Promise<ProviderModelListResult>;
      listVolcengineSpeakers: (request: VolcengineSpeakerListRequest) => Promise<VolcengineSpeakerListResult>;
      searchWebSources: (query: string) => Promise<AiSourceContext>;
      composeResearchCopy: (input: ResearchCopyComposeInput) => Promise<ResearchCopyComposeResult>;
      savePromptTemplate: (template: PromptTemplate) => Promise<AppState>;
      resetPromptTemplates: () => Promise<AppState>;
      saveCustomStyle: (style: CustomStyle) => Promise<AppState>;
      generateCustomStyleDraft: (input: CustomStyleGenerateInput) => Promise<CustomStyle>;
      saveDraftTemplate: (template: DraftTemplate) => Promise<AppState>;
      generateImageLab: (input: ImageLabGenerateInput) => Promise<AppState>;
      addImageLabRecord: (input: Partial<ImageLabRecord> & Pick<ImageLabRecord, 'prompt' | 'ratio' | 'style' | 'provider'>) => Promise<AppState>;
      generateVoiceLabPreview: (input: VoiceLabGenerateInput) => Promise<AppState>;
      saveAccount: (account: AccountProfile) => Promise<AppState>;
      saveActivation: (activation: ActivationState) => Promise<AppState>;
      saveUiPreferences: (ui: UiPreferences) => Promise<AppState>;
      createHtmlVideoTask: (input: CreateTaskInput) => Promise<AppState>;
      createAndRunTask: (input: CreateTaskInput) => Promise<AppState>;
      createAndRunViralAnalysis: (input: CreateViralAnalysisInput) => Promise<AppState>;
      updateViralAnalysisStatus: (id: string, status: ViralAnalysisStatus) => Promise<AppState>;
      retryViralAnalysis: (id: string) => Promise<AppState>;
      getViralAnalysisResult: (id: string) => Promise<ViralAnalysisResult>;
      createProductionTaskFromViral: (id: string, options?: ViralProductionTaskOptions) => Promise<AppState>;
      updateTaskStatus: (id: string, status: TaskStatus) => Promise<AppState>;
      retryTask: (id: string) => Promise<AppState>;
      regenerateTaskImage: (id: string, sceneId: number) => Promise<AppState>;
      regenerateTaskNarration: (id: string, sceneId: number) => Promise<AppState>;
      updateTaskImagePrompt: (id: string, sceneId: number, prompt: string) => Promise<AppState>;
      rerunTaskStep: (id: string, step: number, mode: TaskStepRerunMode) => Promise<AppState>;
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
      onTaskEvent: (callback: (state: AppState) => void) => () => void;
    } & LocalBookPersonAssetApi;
    storybound?: Window['storydream'];
  }
}
