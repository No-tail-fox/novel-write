import { contextBridge, ipcRenderer } from 'electron';
import type {
  AccountProfile,
  ActivationState,
  AiHotArchiveRequest,
  AiHotArchiveResult,
  AiSourceContext,
  AppDelta,
  AppDeltaReconcileRequest,
  AppDeltaReconcileResult,
  AppMutationResult,
  AppConfig,
  BootstrapState,
  BenchmarkGroup,
  BenchmarkGroupInput,
  BenchmarkGroupSyncResult,
  BenchmarkLoginInput,
  BenchmarkLoginResult,
  BenchmarkPost,
  BenchmarkPostInput,
  BookDiscoveryRequest,
  BookDiscoveryResult,
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
  HotBoardArchiveRequest,
  HotBoardArchiveResult,
  HotBoardSourceContent,
  HotBoardSourceContentInput,
  HtmlVideoConfigChange,
  HtmlVideoAssetTarget,
  HtmlVideoCompositionSource,
  HtmlVideoCompositionSourceLintInput,
  HtmlVideoCompositionSourceSaveInput,
  HtmlVideoCompositionSourceSaveResult,
  HtmlVideoLintFinding,
  HtmlVideoSceneChange,
  HtmlVideoSceneStructureChange,
  ImageLabGenerateInput,
  ImageLabImportInput,
  ImageLabRecord,
  ImageLabSummary,
  ImaKnowledgeRequest,
  ImaKnowledgeResult,
  JianyingEffectCatalog,
  LlmConfig,
  ManagedBgmImport,
  MusicMvTaskUpdateInput,
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
  TaskArtifactSnapshot,
  TaskImageReplacementSource,
  TaskVideoReplacementSource,
  SequencedTaskEvent,
  Task,
  TaskSummary,
  TaskStepRerunMode,
  TaskSubtitleSceneLines,
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
  WebSearchRequest,
} from '../src/shared/types';
import type { PublicAppState, SaveConfigInput, SecretChanges } from '../src/shared/config-secrets';
import type { PersonAssetImage, PersonAssetSummary, RecycledPersonAsset } from '../src/shared/person-assets';
import type { PersonAssetReference } from '../src/shared/storydream-api';
import type { StoryDreamApi } from '../src/shared/storydream-api';
import type { DirectorGenerateShotVideoRequest, DirectorGenerateShotVideoResult, DirectorRenderRequest, DirectorRenderResult, DirectorSubtitleRecheckRequest, DirectorSubtitleRecheckResult, DirectorMediaRecheckRequest, DirectorMediaRecheckResult } from '../src/shared/director-render';
import type { EditorialCollageCreateInput, EditorialCollageSaveInput } from '../src/shared/editorial-collage';
import type { MotionComicCreateInput, MotionComicSaveInput } from '../src/shared/motion-comic';
import type { CreateDirectorBatchInput, DirectorBatchRecord, UpdateDirectorBatchInput } from '../src/shared/director-batch-persistence';
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
    ...(request.favorite !== undefined ? { favorite: request.favorite } : {}),
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

export const storyDreamApi: StoryDreamApi = {
  getState: (): Promise<PublicAppState> => invokeTrusted('app:get-state'),
  getBootstrap: (): Promise<BootstrapState> => invokeTrusted('app:get-bootstrap'),
  reconcileDeltas: (input: AppDeltaReconcileRequest): Promise<AppDeltaReconcileResult> => invokeTrusted('app:reconcile-deltas', input),
  listTasks: async (request: HistoryListInput<'task'> = {}): Promise<HistoryPage<'task', TaskSummary>> =>
    invokeTrusted('task:list', normalizeTaskHistoryRequest(request)),
  setTaskFavorite: (id: string, isFavorite: boolean): Promise<AppMutationResult> => invokeTrusted('task:set-favorite', { id, isFavorite }),
  archiveTask: (id: string): Promise<AppMutationResult> => invokeTrusted('task:archive', id),
  restoreTask: (id: string): Promise<AppMutationResult> => invokeTrusted('task:restore', id),
  deleteTaskPermanently: (id: string): Promise<AppMutationResult> => invokeTrusted('task:delete', id),
  getTaskDetail: (id: string): Promise<Task | null> => invokeTrusted('task:get-detail', id),
  listTaskEvents: (taskId: string, request: CursorRequest = {}): Promise<CursorPage<SequencedTaskEvent>> =>
    invokeTrusted('task:list-events', { taskId, ...request }),
  openTaskOutputDirectory: (id: string): Promise<void> => invokeTrusted('task:open-output-directory', id),
  launchJianying: (id: string): Promise<void> => invokeTrusted('task:launch-jianying', id),
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
  openImageLabOutputDirectory: (id: string): Promise<void> => invokeTrusted('image-lab:open-output-directory', id),
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
  deleteDraftTemplate: (id: string): Promise<AppMutationResult | null> => invokeTrusted('draft-template:delete', id),
  listMinimaxCloneVoices: (request: CursorRequest = {}): Promise<CountedCursorPage<MinimaxCloneVoice>> => invokeTrusted('minimax-clone-voice:list', request),
  saveMinimaxCloneVoice: (input: MinimaxCloneVoiceInput): Promise<AppMutationResult | null> => invokeTrusted('minimax-clone-voice:save', input),
  deleteMinimaxCloneVoice: (voiceId: string): Promise<AppMutationResult | null> => invokeTrusted('minimax-clone-voice:delete', voiceId),
  saveConfig: (input: SaveConfigInput): Promise<AppMutationResult | null> => invokeTrusted('app:save-config', input),
  testAppConfig: (target: ConfigTestTarget, config: AppConfig, secretChanges: SecretChanges = {}) =>
    invokeTrusted('config:test', { target, config, secretChanges }),
  fetchImaKnowledge: (input: ImaKnowledgeRequest): Promise<ImaKnowledgeResult> => invokeTrusted('ima:fetch-knowledge', input),
  testLlmConfig: (config: LlmConfig) => invokeTrusted('llm:test-config', config),
  listProviderModels: (request: ProviderModelListRequest): Promise<ProviderModelListResult> => invokeTrusted('models:list', request),
  listVolcengineSpeakers: (request: VolcengineSpeakerListRequest): Promise<VolcengineSpeakerListResult> => invokeTrusted('volcengine:speakers:list', request),
  searchWebSources: (input: string | WebSearchRequest): Promise<AiSourceContext> => invokeTrusted('research:web-search', input),
  composeResearchCopy: (input: ResearchCopyComposeInput): Promise<ResearchCopyComposeResult> => invokeTrusted('research:compose-copy', input),
  fetchHotBoard: (input: HotBoardArchiveRequest = {}): Promise<HotBoardArchiveResult> => invokeTrusted('hotboard:fetch', input),
  readHotBoardSource: (input: HotBoardSourceContentInput): Promise<HotBoardSourceContent> => invokeTrusted('hotboard:read-source', input),
  queryAiHot: (input: AiHotArchiveRequest): Promise<AiHotArchiveResult> => invokeTrusted('aihot:query', input),
  openHotBoardUrl: (url: string): Promise<void> => invokeTrusted('hotboard:open-url', url),
  savePromptTemplate: (template: PromptTemplate): Promise<AppMutationResult | null> => invokeTrusted('prompt-template:save', template),
  resetPromptTemplates: (): Promise<AppMutationResult | null> => invokeTrusted('prompt-template:reset'),
  saveCustomStyle: (style: CustomStyle): Promise<AppMutationResult | null> => invokeTrusted('custom-style:save', style),
  saveViralTemplates: (input: ViralTemplateSaveInput): Promise<AppMutationResult | null> => invokeTrusted('viral:save-templates', input),
  generateCustomStyleDraft: (input: CustomStyleGenerateInput): Promise<CustomStyle> => invokeTrusted('custom-style:generate-draft', input),
  saveDraftTemplate: (template: DraftTemplate): Promise<AppMutationResult | null> => invokeTrusted('draft-template:save', template),
  generateImageLab: (input: ImageLabGenerateInput): Promise<AppMutationResult | null> => invokeTrusted('image-lab:generate', input),
  addImageLabRecord: (input: ImageLabImportInput): Promise<AppMutationResult | null> => invokeTrusted('image-lab:add-record', input),
  generateVoiceLabPreview: (input: VoiceLabGenerateInput): Promise<AppMutationResult | null> => invokeTrusted('voice-lab:generate', input),
  saveAccount: (account: AccountProfile): Promise<AppMutationResult | null> => invokeTrusted('account:save', account),
  saveActivation: (activation: ActivationState): Promise<AppMutationResult | null> => invokeTrusted('activation:save', activation),
  saveUiPreferences: (update: UiPreferencesUpdate): Promise<AppMutationResult | null> => invokeTrusted('ui:save-preferences', update),
  listBookSelections: (theme?: string): Promise<BookSelectionRecord[]> => invokeTrusted('book-selection:list', theme),
  discoverBooks: (input: BookDiscoveryRequest): Promise<BookDiscoveryResult> => invokeTrusted('book-selection:discover', input),
  saveBookSelection: (input: BookSelectionInput): Promise<BookSelectionRecord> => invokeTrusted('book-selection:save', input),
  deleteBookSelection: (theme: string, bookId: string): Promise<void> => invokeTrusted('book-selection:delete', { theme, bookId }),
  listBenchmarkGroups: (): Promise<BenchmarkGroup[]> => invokeTrusted('benchmark:list-groups'),
  saveBenchmarkGroup: (input: BenchmarkGroupInput): Promise<BenchmarkGroup> => invokeTrusted('benchmark:save-group', input),
  deleteBenchmarkGroup: (id: string): Promise<void> => invokeTrusted('benchmark:delete-group', id),
  listBenchmarkPosts: (groupId?: string): Promise<BenchmarkPost[]> => invokeTrusted('benchmark:list-posts', groupId),
  saveBenchmarkPost: (input: BenchmarkPostInput): Promise<BenchmarkPost> => invokeTrusted('benchmark:save-post', input),
  deleteBenchmarkPost: (id: string): Promise<void> => invokeTrusted('benchmark:delete-post', id),
  syncBenchmarkGroup: (groupId: string): Promise<BenchmarkGroupSyncResult> => invokeTrusted('benchmark:sync-group', groupId),
  openBenchmarkLogin: (input: BenchmarkLoginInput): Promise<BenchmarkLoginResult> => invokeTrusted('benchmark:open-login', input),
  listPersonAssets: (): Promise<PersonAssetSummary[]> => invokeTrusted('person-assets:list'),
  createPersonAsset: (name: string): Promise<PersonAssetSummary> => invokeTrusted('person-assets:create', name),
  renamePersonAsset: (oldName: string, newName: string): Promise<string> => invokeTrusted('person-assets:rename', { oldName, newName }),
  getPersonAssetUsage: (name: string): Promise<PersonAssetReference[]> => invokeTrusted('person-assets:usage', name),
  deletePersonAsset: (name: string): Promise<RecycledPersonAsset> => invokeTrusted('person-assets:delete', name),
  restorePersonAsset: (token: string): Promise<PersonAssetSummary> => invokeTrusted('person-assets:restore', token),
  importPersonAssetImages: (name: string): Promise<number> => invokeTrusted('person-assets:import-images', name),
  listPersonAssetImages: (name: string): Promise<PersonAssetImage[]> => invokeTrusted('person-assets:list-images', name),
  openPersonAssetDirectory: (name: string): Promise<void> => invokeTrusted('person-assets:open-directory', name),
  createEditorialCollage: (input: EditorialCollageCreateInput): Promise<AppMutationResult | null> =>
    invokeTrusted('editorial-collage:create', input),
  saveEditorialCollage: (input: EditorialCollageSaveInput): Promise<AppMutationResult | null> =>
    invokeTrusted('editorial-collage:save', input),
  generateDirectorShotVideo: (input: DirectorGenerateShotVideoRequest): Promise<{ result: DirectorGenerateShotVideoResult; mutation: AppMutationResult | null }> =>
    invokeTrusted('director:generate-shot-video', input),
  createMotionComic: (input: MotionComicCreateInput): Promise<AppMutationResult | null> =>
    invokeTrusted('motion-comic:create', input),
  saveMotionComic: (input: MotionComicSaveInput): Promise<AppMutationResult | null> =>
    invokeTrusted('motion-comic:save', input),
  renderDirectorProject: (input: DirectorRenderRequest): Promise<{ result: DirectorRenderResult; mutation: AppMutationResult | null }> =>
    invokeTrusted('director:render', input),
  recheckDirectorSubtitles: (input: DirectorSubtitleRecheckRequest): Promise<DirectorSubtitleRecheckResult> =>
    invokeTrusted('director:recheck-subtitles', input),
  recheckDirectorMedia: (input: DirectorMediaRecheckRequest): Promise<DirectorMediaRecheckResult> =>
    invokeTrusted('director:recheck-media', input),
  createDirectorBatch: (input: CreateDirectorBatchInput): Promise<DirectorBatchRecord> => invokeTrusted('director:batch-create', input),
  getDirectorBatch: (id: string): Promise<DirectorBatchRecord | null> => invokeTrusted('director:batch-get', id),
  listDirectorBatches: (options = {}): Promise<DirectorBatchRecord[]> => invokeTrusted('director:batch-list', options),
  updateDirectorBatch: (id: string, patch: UpdateDirectorBatchInput): Promise<DirectorBatchRecord> => invokeTrusted('director:batch-update', { id, patch }),
  deleteDirectorBatch: (id: string): Promise<boolean> => invokeTrusted('director:batch-delete', id),
  createHtmlVideoTask: (input: CreateTaskInput) => invokeTrusted('html-video:create-task', input),
  updateHtmlVideoConfig: (id: string, changes: HtmlVideoConfigChange[]) =>
    invokeTrusted('html-video:update-config', { id, changes }),
  updateHtmlVideoScene: (id: string, sceneIndex: number, changes: HtmlVideoSceneChange[]) =>
    invokeTrusted('html-video:update-scene', { id, sceneIndex, changes }),
  updateHtmlVideoSceneStructure: (id: string, change: HtmlVideoSceneStructureChange) =>
    invokeTrusted('html-video:update-scene-structure', { id, change }),
  addHtmlVideoAsset: (id: string, sceneIndex: number, prompt: string) =>
    invokeTrusted('html-video:add-asset', { id, sceneIndex, prompt }),
  replaceHtmlVideoAsset: (id: string, target: HtmlVideoAssetTarget) =>
    invokeTrusted('html-video:replace-asset', { id, target }),
  regenerateHtmlVideoAsset: (id: string, target: HtmlVideoAssetTarget) =>
    invokeTrusted('html-video:regenerate-asset', { id, target }),
  removeHtmlVideoAssetBackground: (id: string, target: HtmlVideoAssetTarget) =>
    invokeTrusted('html-video:remove-asset-background', { id, target }),
  removeAllHtmlVideoAssetBackgrounds: (id: string) =>
    invokeTrusted('html-video:remove-all-backgrounds', id),
  regenerateHtmlVideoVoice: (id: string, sceneIndex: number) =>
    invokeTrusted('html-video:regenerate-voice', { id, sceneIndex }),
  regenerateHtmlVideoCover: (id: string): Promise<AppMutationResult | null> =>
    invokeTrusted('html-video:regenerate-cover', id),
  rerenderHtmlVideo: (id: string): Promise<AppMutationResult | null> =>
    invokeTrusted('html-video:rerender', id),
  importHtmlVideoCover: (id: string): Promise<AppMutationResult | null> =>
    invokeTrusted('html-video:import-cover', id),
  getHtmlVideoCompositionSource: (taskId: string, sceneIndex: number): Promise<HtmlVideoCompositionSource> =>
    invokeTrusted('html-video:composition-source:get', { taskId, sceneIndex }),
  lintHtmlVideoCompositionSource: (input: HtmlVideoCompositionSourceLintInput): Promise<HtmlVideoLintFinding[]> =>
    invokeTrusted('html-video:composition-source:lint', input),
  saveHtmlVideoCompositionSource: (input: HtmlVideoCompositionSourceSaveInput): Promise<HtmlVideoCompositionSourceSaveResult> =>
    invokeTrusted('html-video:composition-source:save', input),
  importOrdinaryTaskCover: (ratio: OrdinaryTaskCoverRatio): Promise<OrdinaryTaskCoverSelection | null> =>
    invokeTrusted('task:import-cover', ratio),
  openHtmlVideoPreview: (id: string, sceneIndex?: number): Promise<void> =>
    invokeTrusted('html-video:open-preview', { id, sceneIndex }),
  getHtmlVideoMediaUrl: (id: string, path: string): Promise<string> =>
    invokeTrusted('html-video:media-url', { id, path }),
  createAndRunTask: (input: CreateTaskInput) => invokeTrusted('task:create-and-run', input),
  updateMusicMvTask: (input: MusicMvTaskUpdateInput) => invokeTrusted('music-mv:update', input),
  createAndRunViralAnalysis: (input: CreateViralAnalysisInput) => invokeTrusted('viral:create-and-run', input),
  updateViralAnalysisStatus: (id: string, status: ViralAnalysisStatus) => invokeTrusted('viral:update-status', { id, status }),
  retryViralAnalysis: (id: string) => invokeTrusted('viral:retry', id),
  getViralAnalysisResult: (id: string): Promise<ViralAnalysisResult> => invokeTrusted('viral:get-result', id),
  createProductionTaskFromViral: (id: string, options?: ViralProductionTaskOptions) => invokeTrusted('viral:create-production-task', { id, options }),
  updateTaskStatus: (id: string, status: Extract<TaskStatus, 'running' | 'paused' | 'cancelled'>) => invokeTrusted('task:update-status', { id, status }),
  updateTaskTemplate: (id: string, templateId: string) => invokeTrusted('task:update-template', { id, templateId }),
  updateTaskBgm: (id: string, bgmId: string) => invokeTrusted('task:update-bgm', { id, bgmId }),
  updateTaskSubtitleLines: (id: string, scenes: TaskSubtitleSceneLines[]) => invokeTrusted('task:update-subtitle-lines', { id, scenes }),
  retryTask: (id: string) => invokeTrusted('task:retry', id),
  regenerateTaskImage: (id: string, sceneId: number) => invokeTrusted('task:regenerate-image', { id, sceneId }),
  regenerateTaskImages: (id: string, sceneIds: number[]) => invokeTrusted('task:regenerate-images', { id, sceneIds }),
  replaceTaskImage: (id: string, sceneId: number, source: TaskImageReplacementSource) => invokeTrusted('task:replace-image', { id, sceneId, source }),
  listSceneVideoLibrary: () => invokeTrusted('scene-video-library:list'),
  replaceTaskSceneVideo: (id: string, sceneId: number, source: TaskVideoReplacementSource) => invokeTrusted('task:replace-video', { id, sceneId, source }),
  restoreTaskSceneImage: (id: string, sceneId: number) => invokeTrusted('task:restore-image', { id, sceneId }),
  updateTaskSceneVideoTrim: (id: string, sceneId: number, trimStartMs: number) => invokeTrusted('task:update-video-trim', { id, sceneId, trimStartMs }),
  copyTaskImage: (id: string, sceneId: number) => invokeTrusted('task:copy-image', { id, sceneId }),
  importTaskImages: (id: string) => invokeTrusted('task:import-images', id),
  referenceEditTaskImage: (id: string, sceneId: number, prompt: string, referenceImagePaths?: string[]) => invokeTrusted('task:reference-edit-image', { id, sceneId, prompt, referenceImagePaths }),
  regenerateTaskNarration: (id: string, sceneId: number) => invokeTrusted('task:regenerate-narration', { id, sceneId }),
  updateTaskImagePrompt: (id: string, sceneId: number, prompt: string) => invokeTrusted('task:update-image-prompt', { id, sceneId, prompt }),
  rerunTaskStep: (id: string, step: number, mode: TaskStepRerunMode) => invokeTrusted('task:rerun-step', { id, step, mode }),
  repackTaskDraft: (id: string) => storyDreamApi.rerunTaskStep(id, 6, 'regenerate'),
  getTaskArtifacts: (id: string): Promise<TaskArtifactSnapshot> => invokeTrusted('task:get-artifacts', id),
  getTaskMediaUrl: (id: string, path: string): Promise<string> => invokeTrusted('task:media-url', { id, path }),
  readAssetDataUrl: (path: string): Promise<string> => invokeTrusted('asset:read-data-url', path),
  selectLocalImage: (): Promise<string | null> => invokeTrusted('local-image:select'),
  importBgmAudio: () => storyDreamApi.selectLocalAudio('managed-bgm'),
  selectLocalAudio: ((purpose?: 'managed-bgm') => invokeTrusted('local-audio:select', purpose)) as StoryDreamApi['selectLocalAudio'],
  selectLocalSubtitleTimestampFile: (): ReturnType<StoryDreamApi['selectLocalSubtitleTimestampFile']> => invokeTrusted('local-subtitle-timestamps:select'),
  selectLocalFolder: (): Promise<string | null> => invokeTrusted('local-folder:select'),
  selectCookieFile: (): Promise<string | null> => invokeTrusted('cookie-file:select'),
  openViralLoginWindow: (): Promise<string | null> => invokeTrusted('viral:open-login-window'),
  detectJianyingDraftPath: (): ReturnType<StoryDreamApi['detectJianyingDraftPath']> => invokeTrusted('jianying:draft-path:detect'),
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
};

contextBridge.exposeInMainWorld('storydream', storyDreamApi);
contextBridge.exposeInMainWorld('storybound', storyDreamApi);
