import { contextBridge, ipcRenderer } from 'electron';
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
  HistoryArchiveFilter,
  HistoryFamily,
  HistoryListInput,
  HistoryListRequest,
  HistoryPage,
  HtmlVideoConfigChange,
  ImageLabGenerateInput,
  ImageLabRecord,
  ImageLabSummary,
  JianyingEffectCatalog,
  LlmConfig,
  MinimaxCloneVoice,
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
  UiPreferencesUpdate,
  ViralAnalysisResult,
  ViralAnalysisEvent,
  ViralAnalysisSummary,
  ViralAnalysisRecord,
  ViralAnalysisStatus,
  ViralProductionTaskOptions,
  ViralTemplateSaveInput,
  VolcengineSpeakerListRequest,
  VolcengineSpeakerListResult,
  VoiceLabGenerateInput,
  VoiceLabRecord,
  VoiceLabSummary,
} from '../src/shared/types';
import type { PublicAppState, SaveConfigInput, SecretChanges } from '../src/shared/config-secrets';
import type { PersonAssetImage, PersonAssetSummary } from '../src/shared/person-assets';
import type { StoryDreamApi } from '../src/shared/storydream-api';
import { MAX_IPC_TEXT, unwrapIpcResult, type IpcChannel } from '../src/shared/ipc-contract';
import { appErrorFromPayload, serializeAppErrorForBridge } from '../src/shared/app-error';

async function invokeTrusted<T = unknown>(channel: IpcChannel, input?: unknown): Promise<T> {
  const result = await ipcRenderer.invoke(channel, input);
  if (result && typeof result === 'object' && result.ok === false) {
    throw new Error(serializeAppErrorForBridge(appErrorFromPayload(result.error)));
  }
  return unwrapIpcResult<T>(result);
}

interface RendererHistoryBase {
  filter?: HistoryArchiveFilter;
  query?: string;
  cursor?: string | null;
  limit?: number;
}

function normalizeHistoryBase<F extends HistoryFamily>(family: F, request: RendererHistoryBase) {
  if (request.filter !== undefined && request.filter !== 'active' && request.filter !== 'archived') {
    throw new TypeError('Invalid history filter.');
  }
  if (request.query !== undefined && typeof request.query !== 'string') {
    throw new TypeError('Invalid history query.');
  }
  if (request.query !== undefined && request.query.length > MAX_IPC_TEXT) {
    throw new TypeError('History query exceeds the IPC text limit.');
  }
  const query = request.query?.trim();
  return {
    family,
    filter: request.filter === undefined ? 'active' : request.filter,
    ...(query ? { query } : {}),
    ...(request.cursor !== undefined ? { cursor: request.cursor } : {}),
    ...(request.limit !== undefined ? { limit: request.limit } : {}),
  };
}

function normalizeTaskHistoryRequest(request: HistoryListInput<'task'>): Extract<HistoryListRequest, { family: 'task' }> {
  const base = {
    ...normalizeHistoryBase('task', request),
    ...(request.taskType !== undefined ? { taskType: request.taskType } : {}),
  };
  if (request.statuses !== undefined) return { ...base, statuses: request.statuses };
  return {
    ...base,
    ...(request.status !== undefined ? { status: request.status } : {}),
  };
}

function normalizeViralHistoryRequest(request: HistoryListInput<'viral-analysis'>): Extract<HistoryListRequest, { family: 'viral-analysis' }> {
  return {
    ...normalizeHistoryBase('viral-analysis', request),
    ...(request.status !== undefined ? { status: request.status } : {}),
  };
}

function normalizeImageLabHistoryRequest(request: HistoryListInput<'image-lab'>): Extract<HistoryListRequest, { family: 'image-lab' }> {
  return {
    ...normalizeHistoryBase('image-lab', request),
    ...(request.status !== undefined ? { status: request.status } : {}),
  };
}

function normalizeVoiceLabHistoryRequest(request: HistoryListInput<'voice-lab'>): Extract<HistoryListRequest, { family: 'voice-lab' }> {
  return {
    ...normalizeHistoryBase('voice-lab', request),
    ...(request.status !== undefined ? { status: request.status } : {}),
  };
}

export const storyDreamApi = {
  getState: (): Promise<PublicAppState> => invokeTrusted('app:get-state'),
  getBootstrap: (): Promise<BootstrapState> => invokeTrusted('app:get-bootstrap'),
  reconcileDeltas: (input: AppDeltaReconcileRequest): Promise<AppDeltaReconcileResult> => invokeTrusted('app:reconcile-deltas', input),
  listTasks: async (request: HistoryListInput<'task'> = {}): Promise<HistoryPage<'task', TaskSummary>> =>
    invokeTrusted('task:list', normalizeTaskHistoryRequest(request)),
  archiveTask: (id: string): Promise<AppMutationResult> => invokeTrusted('task:archive', id),
  restoreTask: (id: string): Promise<AppMutationResult> => invokeTrusted('task:restore', id),
  deleteTaskPermanently: (id: string): Promise<AppMutationResult> => invokeTrusted('task:delete', id),
  getTaskDetail: (id: string): Promise<Task | null> => invokeTrusted('task:get-detail', id),
  listTaskEvents: (taskId: string, request: CursorRequest = {}): Promise<CursorPage<SequencedTaskEvent>> =>
    invokeTrusted('task:list-events', { taskId, ...request }),
  openTaskOutputDirectory: (id: string): Promise<void> => invokeTrusted('task:open-output-directory', id),
  listViralAnalyses: async (request: HistoryListInput<'viral-analysis'> = {}): Promise<HistoryPage<'viral-analysis', ViralAnalysisSummary>> =>
    invokeTrusted('viral:list', normalizeViralHistoryRequest(request)),
  archiveViralAnalysis: (id: string): Promise<AppMutationResult> => invokeTrusted('viral:archive', id),
  restoreViralAnalysis: (id: string): Promise<AppMutationResult> => invokeTrusted('viral:restore', id),
  deleteViralAnalysisPermanently: (id: string): Promise<AppMutationResult> => invokeTrusted('viral:delete', id),
  getViralAnalysisDetail: (id: string): Promise<ViralAnalysisRecord | null> => invokeTrusted('viral:get-detail', id),
  listViralEvents: (analysisId: string, request: CursorRequest = {}): Promise<CursorPage<ViralAnalysisEvent>> =>
    invokeTrusted('viral:list-events', { analysisId, ...request }),
  listImageLabRecords: async (request: HistoryListInput<'image-lab'> = {}): Promise<HistoryPage<'image-lab', ImageLabSummary>> =>
    invokeTrusted('image-lab:list', normalizeImageLabHistoryRequest(request)),
  archiveImageLabRecord: (id: string): Promise<AppMutationResult> => invokeTrusted('image-lab:archive', id),
  restoreImageLabRecord: (id: string): Promise<AppMutationResult> => invokeTrusted('image-lab:restore', id),
  deleteImageLabRecordPermanently: (id: string): Promise<AppMutationResult> => invokeTrusted('image-lab:delete', id),
  getImageLabRecordDetail: (id: string): Promise<ImageLabRecord | null> => invokeTrusted('image-lab:get-detail', id),
  listVoiceLabRecords: async (request: HistoryListInput<'voice-lab'> = {}): Promise<HistoryPage<'voice-lab', VoiceLabSummary>> =>
    invokeTrusted('voice-lab:list', normalizeVoiceLabHistoryRequest(request)),
  archiveVoiceLabRecord: (id: string): Promise<AppMutationResult> => invokeTrusted('voice-lab:archive', id),
  restoreVoiceLabRecord: (id: string): Promise<AppMutationResult> => invokeTrusted('voice-lab:restore', id),
  deleteVoiceLabRecordPermanently: (id: string): Promise<AppMutationResult> => invokeTrusted('voice-lab:delete', id),
  getVoiceLabRecordDetail: (id: string): Promise<VoiceLabRecord | null> => invokeTrusted('voice-lab:get-detail', id),
  listPromptTemplates: (request: CursorRequest = {}): Promise<CursorPage<PromptTemplateSummary>> => invokeTrusted('prompt-template:list', request),
  getPromptTemplateDetail: (id: string): Promise<PromptTemplate | null> => invokeTrusted('prompt-template:get-detail', id),
  listDraftTemplates: (request: CursorRequest = {}): Promise<CursorPage<DraftTemplateSummary>> => invokeTrusted('draft-template:list', request),
  getDraftTemplateDetail: (id: string): Promise<DraftTemplate | null> => invokeTrusted('draft-template:get-detail', id),
  listMinimaxCloneVoices: (request: CursorRequest = {}): Promise<CountedCursorPage<MinimaxCloneVoice>> => invokeTrusted('minimax-clone-voice:list', request),
  saveConfig: (input: SaveConfigInput): Promise<AppMutationResult | null> => invokeTrusted('app:save-config', input),
  testAppConfig: (target: ConfigTestTarget, config: AppConfig, secretChanges: SecretChanges = {}) =>
    invokeTrusted('config:test', { target, config, secretChanges }),
  testLlmConfig: (config: LlmConfig) => invokeTrusted('llm:test-config', config),
  listProviderModels: (request: ProviderModelListRequest): Promise<ProviderModelListResult> => invokeTrusted('models:list', request),
  listVolcengineSpeakers: (request: VolcengineSpeakerListRequest): Promise<VolcengineSpeakerListResult> => invokeTrusted('volcengine:speakers:list', request),
  searchWebSources: (query: string): Promise<AiSourceContext> => invokeTrusted('research:web-search', query),
  composeResearchCopy: (input: ResearchCopyComposeInput): Promise<ResearchCopyComposeResult> => invokeTrusted('research:compose-copy', input),
  savePromptTemplate: (template: PromptTemplate): Promise<AppMutationResult | null> => invokeTrusted('prompt-template:save', template),
  resetPromptTemplates: (): Promise<AppMutationResult | null> => invokeTrusted('prompt-template:reset'),
  saveCustomStyle: (style: CustomStyle): Promise<AppMutationResult | null> => invokeTrusted('custom-style:save', style),
  saveViralTemplates: (input: ViralTemplateSaveInput): Promise<AppMutationResult | null> => invokeTrusted('viral:save-templates', input),
  generateCustomStyleDraft: (input: CustomStyleGenerateInput): Promise<CustomStyle> => invokeTrusted('custom-style:generate-draft', input),
  saveDraftTemplate: (template: DraftTemplate): Promise<AppMutationResult | null> => invokeTrusted('draft-template:save', template),
  generateImageLab: (input: ImageLabGenerateInput): Promise<AppMutationResult | null> => invokeTrusted('image-lab:generate', input),
  addImageLabRecord: (input: Partial<ImageLabRecord> & Pick<ImageLabRecord, 'prompt' | 'ratio' | 'style' | 'provider'>): Promise<AppMutationResult | null> => invokeTrusted('image-lab:add-record', input),
  generateVoiceLabPreview: (input: VoiceLabGenerateInput): Promise<AppMutationResult | null> => invokeTrusted('voice-lab:generate', input),
  saveAccount: (account: AccountProfile): Promise<AppMutationResult | null> => invokeTrusted('account:save', account),
  saveActivation: (activation: ActivationState): Promise<AppMutationResult | null> => invokeTrusted('activation:save', activation),
  saveUiPreferences: (update: UiPreferencesUpdate): Promise<AppMutationResult | null> => invokeTrusted('ui:save-preferences', update),
  listBookSelections: (theme?: string): Promise<BookSelectionRecord[]> => invokeTrusted('book-selection:list', theme),
  saveBookSelection: (input: BookSelectionInput): Promise<BookSelectionRecord> => invokeTrusted('book-selection:save', input),
  deleteBookSelection: (theme: string, bookId: string): Promise<void> => invokeTrusted('book-selection:delete', { theme, bookId }),
  listPersonAssets: (): Promise<PersonAssetSummary[]> => invokeTrusted('person-assets:list'),
  createPersonAsset: (name: string): Promise<PersonAssetSummary> => invokeTrusted('person-assets:create', name),
  renamePersonAsset: (oldName: string, newName: string): Promise<string> => invokeTrusted('person-assets:rename', { oldName, newName }),
  deletePersonAsset: (name: string): Promise<void> => invokeTrusted('person-assets:delete', name),
  importPersonAssetImages: (name: string): Promise<number> => invokeTrusted('person-assets:import-images', name),
  listPersonAssetImages: (name: string): Promise<PersonAssetImage[]> => invokeTrusted('person-assets:list-images', name),
  openPersonAssetDirectory: (name: string): Promise<void> => invokeTrusted('person-assets:open-directory', name),
  createHtmlVideoTask: (input: CreateTaskInput) => invokeTrusted('html-video:create-task', input),
  updateHtmlVideoConfig: (id: string, changes: HtmlVideoConfigChange[]) =>
    invokeTrusted('html-video:update-config', { id, changes }),
  importHtmlVideoCover: (id: string): Promise<AppMutationResult | null> =>
    invokeTrusted('html-video:import-cover', id),
  openHtmlVideoPreview: (id: string, sceneIndex?: number): Promise<void> =>
    invokeTrusted('html-video:open-preview', { id, sceneIndex }),
  getHtmlVideoMediaUrl: (id: string, path: string): Promise<string> =>
    invokeTrusted('html-video:media-url', { id, path }),
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
  windowControl: (action: 'minimize' | 'toggle-maximize' | 'close') => invokeTrusted('window:control', action),
  onAppDelta: (callback: (delta: AppDelta) => void) => {
    const listener = (_event: unknown, delta: AppDelta) => callback(delta);
    ipcRenderer.on('app:delta', listener);
    return () => {
      ipcRenderer.off('app:delta', listener);
    };
  },
} satisfies StoryDreamApi;

contextBridge.exposeInMainWorld('storydream', storyDreamApi);
contextBridge.exposeInMainWorld('storybound', storyDreamApi);
