import { contextBridge, ipcRenderer } from 'electron';
import type {
  AccountProfile,
  ActivationState,
  AiSourceContext,
  AppConfig,
  BookSelectionInput,
  BookSelectionRecord,
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
} from '../src/shared/types';
import type { PublicAppState, SaveConfigInput, SecretChanges } from '../src/shared/config-secrets';
import type { PersonAssetImage, PersonAssetSummary } from '../src/shared/person-assets';
import { unwrapIpcResult, type IpcChannel } from '../src/shared/ipc-contract';
import { appErrorFromPayload, serializeAppErrorForBridge } from '../src/shared/app-error';

async function invokeTrusted<T = unknown>(channel: IpcChannel, input?: unknown): Promise<T> {
  const result = await ipcRenderer.invoke(channel, input);
  if (result && typeof result === 'object' && result.ok === false) {
    throw new Error(serializeAppErrorForBridge(appErrorFromPayload(result.error)));
  }
  return unwrapIpcResult<T>(result);
}

const storyDreamApi = {
  getState: (): Promise<PublicAppState> => invokeTrusted('app:get-state'),
  saveConfig: (input: SaveConfigInput): Promise<PublicAppState> => invokeTrusted('app:save-config', input),
  testAppConfig: (target: ConfigTestTarget, config: AppConfig, secretChanges: SecretChanges = {}) =>
    invokeTrusted('config:test', { target, config, secretChanges }),
  testLlmConfig: (config: LlmConfig) => invokeTrusted('llm:test-config', config),
  listProviderModels: (request: ProviderModelListRequest): Promise<ProviderModelListResult> => invokeTrusted('models:list', request),
  listVolcengineSpeakers: (request: VolcengineSpeakerListRequest): Promise<VolcengineSpeakerListResult> => invokeTrusted('volcengine:speakers:list', request),
  searchWebSources: (query: string): Promise<AiSourceContext> => invokeTrusted('research:web-search', query),
  composeResearchCopy: (input: ResearchCopyComposeInput): Promise<ResearchCopyComposeResult> => invokeTrusted('research:compose-copy', input),
  savePromptTemplate: (template: PromptTemplate) => invokeTrusted('prompt-template:save', template),
  resetPromptTemplates: () => invokeTrusted('prompt-template:reset'),
  saveCustomStyle: (style: CustomStyle) => invokeTrusted('custom-style:save', style),
  generateCustomStyleDraft: (input: CustomStyleGenerateInput): Promise<CustomStyle> => invokeTrusted('custom-style:generate-draft', input),
  saveDraftTemplate: (template: DraftTemplate) => invokeTrusted('draft-template:save', template),
  generateImageLab: (input: ImageLabGenerateInput): Promise<PublicAppState> => invokeTrusted('image-lab:generate', input),
  addImageLabRecord: (input: Partial<ImageLabRecord> & Pick<ImageLabRecord, 'prompt' | 'ratio' | 'style' | 'provider'>) => invokeTrusted('image-lab:add-record', input),
  generateVoiceLabPreview: (input: VoiceLabGenerateInput): Promise<PublicAppState> => invokeTrusted('voice-lab:generate', input),
  saveAccount: (account: AccountProfile) => invokeTrusted('account:save', account),
  saveActivation: (activation: ActivationState) => invokeTrusted('activation:save', activation),
  saveUiPreferences: (ui: UiPreferences) => invokeTrusted('ui:save-preferences', ui),
  listBookSelections: (theme?: string): Promise<BookSelectionRecord[]> => invokeTrusted('book-selection:list', theme),
  saveBookSelection: (input: BookSelectionInput): Promise<BookSelectionRecord> => invokeTrusted('book-selection:save', input),
  deleteBookSelection: (theme: string, bookId: string): Promise<void> => invokeTrusted('book-selection:delete', { theme, bookId }),
  listPersonAssets: (): Promise<PersonAssetSummary[]> => invokeTrusted('person-assets:list'),
  createPersonAsset: (name: string): Promise<PersonAssetSummary> => invokeTrusted('person-assets:create', name),
  renamePersonAsset: (oldName: string, newName: string): Promise<string> => invokeTrusted('person-assets:rename', { oldName, newName }),
  deletePersonAsset: (name: string): Promise<void> => invokeTrusted('person-assets:delete', name),
  importPersonAssetImages: (name: string): Promise<number> => invokeTrusted('person-assets:import-images', name),
  listPersonAssetImages: (name: string): Promise<PersonAssetImage[]> => invokeTrusted('person-assets:list-images', name),
  createHtmlVideoTask: (input: CreateTaskInput) => invokeTrusted('html-video:create-task', input),
  createAndRunTask: (input: CreateTaskInput) => invokeTrusted('task:create-and-run', input),
  createAndRunViralAnalysis: (input: CreateViralAnalysisInput) => invokeTrusted('viral:create-and-run', input),
  updateViralAnalysisStatus: (id: string, status: ViralAnalysisStatus) => invokeTrusted('viral:update-status', { id, status }),
  retryViralAnalysis: (id: string) => invokeTrusted('viral:retry', id),
  getViralAnalysisResult: (id: string): Promise<ViralAnalysisResult> => invokeTrusted('viral:get-result', id),
  createProductionTaskFromViral: (id: string, options?: ViralProductionTaskOptions) => invokeTrusted('viral:create-production-task', { id, options }),
  updateTaskStatus: (id: string, status: TaskStatus) => invokeTrusted('task:update-status', { id, status }),
  retryTask: (id: string) => invokeTrusted('task:retry', id),
  regenerateTaskImage: (id: string, sceneId: number) => invokeTrusted('task:regenerate-image', { id, sceneId }),
  regenerateTaskNarration: (id: string, sceneId: number) => invokeTrusted('task:regenerate-narration', { id, sceneId }),
  updateTaskImagePrompt: (id: string, sceneId: number, prompt: string) => invokeTrusted('task:update-image-prompt', { id, sceneId, prompt }),
  rerunTaskStep: (id: string, step: number, mode: TaskStepRerunMode) => invokeTrusted('task:rerun-step', { id, step, mode }),
  getTaskArtifacts: (id: string): Promise<TaskArtifactSnapshot> => invokeTrusted('task:get-artifacts', id),
  readAssetDataUrl: (path: string): Promise<string> => invokeTrusted('asset:read-data-url', path),
  selectLocalImage: (): Promise<string | null> => invokeTrusted('local-image:select'),
  selectLocalAudio: (): Promise<string | null> => invokeTrusted('local-audio:select'),
  selectLocalFolder: (): Promise<string | null> => invokeTrusted('local-folder:select'),
  selectCookieFile: (): Promise<string | null> => invokeTrusted('cookie-file:select'),
  openViralLoginWindow: (): Promise<string | null> => invokeTrusted('viral:open-login-window'),
  detectJianyingDraftPath: (): Promise<string> => invokeTrusted('jianying:draft-path:detect'),
  getJianyingEffectCatalog: (): Promise<JianyingEffectCatalog> => invokeTrusted('jianying:effect-catalog'),
  runDiagnostics: () => invokeTrusted('diagnostics:run'),
  openPath: (path: string) => invokeTrusted('path:open', path),
  windowControl: (action: 'minimize' | 'toggle-maximize' | 'close') => invokeTrusted('window:control', action),
  onTaskEvent: (callback: (state: PublicAppState) => void) => {
    const listener = (_event: unknown, state: PublicAppState) => callback(state);
    ipcRenderer.on('task:event', listener);
    return () => ipcRenderer.off('task:event', listener);
  },
};

contextBridge.exposeInMainWorld('storydream', storyDreamApi);
contextBridge.exposeInMainWorld('storybound', storyDreamApi);
