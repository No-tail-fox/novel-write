import type {
  AccountProfile,
  ActivationState,
  AiSourceContext,
  AppConfig,
  AppState,
  ConfigTestResult,
  ConfigTestTarget,
  CreateTaskInput,
  DraftTemplate,
  ImageLabGenerateInput,
  ImageLabRecord,
  LlmConfig,
  LlmModelTestResult,
  PromptTemplate,
  ProviderModelListRequest,
  ProviderModelListResult,
  ResearchCopyComposeInput,
  ResearchCopyComposeResult,
  TaskArtifactSnapshot,
  TaskStatus,
  UiPreferences,
  VolcengineSpeakerListRequest,
  VolcengineSpeakerListResult,
} from './shared/types';

declare global {
  interface Window {
    storybound?: {
      getState: () => Promise<AppState>;
      saveConfig: (config: AppConfig) => Promise<AppState>;
      testAppConfig: (target: ConfigTestTarget, config: AppConfig) => Promise<ConfigTestResult>;
      testLlmConfig: (config: LlmConfig) => Promise<LlmModelTestResult>;
      listProviderModels: (request: ProviderModelListRequest) => Promise<ProviderModelListResult>;
      listVolcengineSpeakers: (request: VolcengineSpeakerListRequest) => Promise<VolcengineSpeakerListResult>;
      searchWebSources: (query: string) => Promise<AiSourceContext>;
      composeResearchCopy: (input: ResearchCopyComposeInput) => Promise<ResearchCopyComposeResult>;
      savePromptTemplate: (template: PromptTemplate) => Promise<AppState>;
      resetPromptTemplates: () => Promise<AppState>;
      saveDraftTemplate: (template: DraftTemplate) => Promise<AppState>;
      generateImageLab: (input: ImageLabGenerateInput) => Promise<AppState>;
      addImageLabRecord: (input: Partial<ImageLabRecord> & Pick<ImageLabRecord, 'prompt' | 'ratio' | 'style' | 'provider'>) => Promise<AppState>;
      saveAccount: (account: AccountProfile) => Promise<AppState>;
      saveActivation: (activation: ActivationState) => Promise<AppState>;
      saveUiPreferences: (ui: UiPreferences) => Promise<AppState>;
      createAndRunTask: (input: CreateTaskInput) => Promise<AppState>;
      updateTaskStatus: (id: string, status: TaskStatus) => Promise<AppState>;
      retryTask: (id: string) => Promise<AppState>;
      regenerateTaskImage: (id: string, sceneId: number) => Promise<AppState>;
      regenerateTaskNarration: (id: string, sceneId: number) => Promise<AppState>;
      getTaskArtifacts: (id: string) => Promise<TaskArtifactSnapshot>;
      readAssetDataUrl: (path: string) => Promise<string>;
      selectLocalImage: () => Promise<string | null>;
      runDiagnostics: () => Promise<{ generatedAt: string; checks: Array<{ id: string; label: string; status: string; detail: string }> }>;
      openPath: (path: string) => Promise<void>;
      windowControl: (action: 'minimize' | 'toggle-maximize' | 'close') => Promise<void>;
      onTaskEvent: (callback: (state: AppState) => void) => () => void;
    };
  }
}
