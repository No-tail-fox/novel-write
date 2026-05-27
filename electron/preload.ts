import { contextBridge, ipcRenderer } from 'electron';
import type {
  AccountProfile,
  ActivationState,
  AiSourceContext,
  AppConfig,
  AppState,
  ConfigTestTarget,
  CreateTaskInput,
  DraftTemplate,
  ImageLabRecord,
  LlmConfig,
  PromptTemplate,
  ProviderModelListRequest,
  ProviderModelListResult,
  ResearchCopyComposeInput,
  ResearchCopyComposeResult,
  TaskArtifactSnapshot,
  TaskStatus,
  UiPreferences,
} from '../src/shared/types';

contextBridge.exposeInMainWorld('storybound', {
  getState: () => ipcRenderer.invoke('app:get-state'),
  saveConfig: (config: AppConfig) => ipcRenderer.invoke('app:save-config', config),
  testAppConfig: (target: ConfigTestTarget, config: AppConfig) => ipcRenderer.invoke('config:test', { target, config }),
  testLlmConfig: (config: LlmConfig) => ipcRenderer.invoke('llm:test-config', config),
  listProviderModels: (request: ProviderModelListRequest): Promise<ProviderModelListResult> => ipcRenderer.invoke('models:list', request),
  searchWebSources: (query: string): Promise<AiSourceContext> => ipcRenderer.invoke('research:web-search', query),
  composeResearchCopy: (input: ResearchCopyComposeInput): Promise<ResearchCopyComposeResult> => ipcRenderer.invoke('research:compose-copy', input),
  savePromptTemplate: (template: PromptTemplate) => ipcRenderer.invoke('prompt-template:save', template),
  resetPromptTemplates: () => ipcRenderer.invoke('prompt-template:reset'),
  saveDraftTemplate: (template: DraftTemplate) => ipcRenderer.invoke('draft-template:save', template),
  addImageLabRecord: (input: Partial<ImageLabRecord> & Pick<ImageLabRecord, 'prompt' | 'ratio' | 'style' | 'provider'>) => ipcRenderer.invoke('image-lab:add-record', input),
  saveAccount: (account: AccountProfile) => ipcRenderer.invoke('account:save', account),
  saveActivation: (activation: ActivationState) => ipcRenderer.invoke('activation:save', activation),
  saveUiPreferences: (ui: UiPreferences) => ipcRenderer.invoke('ui:save-preferences', ui),
  createAndRunTask: (input: CreateTaskInput) => ipcRenderer.invoke('task:create-and-run', input),
  updateTaskStatus: (id: string, status: TaskStatus) => ipcRenderer.invoke('task:update-status', { id, status }),
  retryTask: (id: string) => ipcRenderer.invoke('task:retry', id),
  getTaskArtifacts: (id: string): Promise<TaskArtifactSnapshot> => ipcRenderer.invoke('task:get-artifacts', id),
  runDiagnostics: () => ipcRenderer.invoke('diagnostics:run'),
  openPath: (path: string) => ipcRenderer.invoke('path:open', path),
  onTaskEvent: (callback: (state: AppState) => void) => {
    const listener = (_event: unknown, state: AppState) => callback(state);
    ipcRenderer.on('task:event', listener);
    return () => ipcRenderer.off('task:event', listener);
  },
});
