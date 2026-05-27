import type {
  AccountProfile,
  ActivationState,
  AiSourceContext,
  AppConfig,
  AppState,
  CreateTaskInput,
  DraftTemplate,
  ImageLabRecord,
  LlmConfig,
  LlmModelTestResult,
  PromptTemplate,
  TaskStatus,
  UiPreferences,
} from './shared/types';

declare global {
  interface Window {
    storybound?: {
      getState: () => Promise<AppState>;
      saveConfig: (config: AppConfig) => Promise<AppState>;
      testLlmConfig: (config: LlmConfig) => Promise<LlmModelTestResult>;
      searchWebSources: (query: string) => Promise<AiSourceContext>;
      savePromptTemplate: (template: PromptTemplate) => Promise<AppState>;
      resetPromptTemplates: () => Promise<AppState>;
      saveDraftTemplate: (template: DraftTemplate) => Promise<AppState>;
      addImageLabRecord: (input: Partial<ImageLabRecord> & Pick<ImageLabRecord, 'prompt' | 'ratio' | 'style' | 'provider'>) => Promise<AppState>;
      saveAccount: (account: AccountProfile) => Promise<AppState>;
      saveActivation: (activation: ActivationState) => Promise<AppState>;
      saveUiPreferences: (ui: UiPreferences) => Promise<AppState>;
      createAndRunTask: (input: CreateTaskInput) => Promise<AppState>;
      updateTaskStatus: (id: string, status: TaskStatus) => Promise<AppState>;
      retryTask: (id: string) => Promise<AppState>;
      runDiagnostics: () => Promise<{ generatedAt: string; checks: Array<{ id: string; label: string; status: string; detail: string }> }>;
      openPath: (path: string) => Promise<void>;
      onTaskEvent: (callback: (state: AppState) => void) => () => void;
    };
  }
}
