import type { StoryDreamApi } from '../shared/storydream-api';
import type { ShellView } from '../shared/types';

export interface RendererCommandOwner {
  route: ShellView | 'shell';
  source: string;
  controlSource: string;
  evidenceSource: string;
  handler: string;
  binding: string;
  control: string;
  disabled: string;
  loading: string;
  error: string;
  test: string;
  callPath?: readonly string[];
  bridges?: readonly RendererCommandBridge[];
}

export interface RendererCommandBridge {
  source: string;
  evidence: string;
}

export interface RendererCommandContract {
  route: ShellView | 'shell';
  control: string;
  disabled: string;
  loading: string;
  error: string;
  test: string;
  owners: readonly RendererCommandOwner[];
}

type BehaviorEvidence = Pick<RendererCommandOwner, 'disabled' | 'loading' | 'error'>;

const routeBehaviorEvidence: Partial<Record<ShellView | 'shell', BehaviorEvidence>> = {
  shell: { disabled: 'disabled={busy}', loading: "saveTone === 'saving'", error: 'InlineActionFeedback' },
  'new-task': { disabled: 'disabled={', loading: 'taskAction.busy', error: 'InlineActionFeedback' },
  queue: { disabled: 'disabled={', loading: 'queueAction.busy', error: 'InlineActionFeedback' },
  history: { disabled: 'historyBusy', loading: 'historyPage.loading', error: 'InlineActionFeedback' },
  'task-detail': { disabled: 'disabled={', loading: 'Loader2', error: 'InlineActionFeedback' },
  'html-video': { disabled: 'disabled={', loading: 'Loader2', error: 'InlineActionFeedback' },
  'image-lab': { disabled: 'disabled={', loading: 'imageLabAction.busy', error: 'InlineActionFeedback' },
  'voice-lab': { disabled: 'disabled={', loading: 'Loader2', error: 'InlineActionFeedback' },
  'music-mv': { disabled: 'disabled={', loading: 'musicAction.busy', error: 'InlineActionFeedback' },
  'book-selection': { disabled: 'disabled={', loading: 'pendingAction', error: 'InlineActionFeedback' },
  benchmark: { disabled: 'disabled={', loading: 'Loader2', error: 'InlineActionFeedback' },
  'person-assets': { disabled: 'disabled={', loading: 'pendingAction', error: 'InlineActionFeedback' },
  'viral-analyzer': { disabled: 'disabled={', loading: 'viralAction.busy', error: 'InlineActionFeedback' },
  'prompt-templates': { disabled: 'disabled={', loading: 'promptTemplateAction.busy', error: 'InlineActionFeedback' },
  'draft-templates': { disabled: 'disabled={', loading: 'draftTemplateAction.busy', error: 'InlineActionFeedback' },
  settings: { disabled: 'disabled={', loading: 'settingsAction.busy', error: 'InlineActionFeedback' },
  account: { disabled: 'disabled={accountAction.busy}', loading: 'accountAction.busy', error: 'InlineActionFeedback' },
  activation: { disabled: 'disabled={activationAction.busy}', loading: 'activationAction.busy', error: 'InlineActionFeedback' },
};

function owner(
  route: ShellView | 'shell',
  source: string,
  handler: string,
  binding: string,
  control: string,
  test: string,
  controlSource = source,
  behavior?: BehaviorEvidence,
  evidenceSource = controlSource,
  callPath?: readonly string[],
  bridges?: readonly RendererCommandBridge[],
): RendererCommandOwner {
  const resolvedBehavior = behavior ?? routeBehaviorEvidence[route];
  if (!resolvedBehavior) throw new Error(`Renderer command route has no UX evidence contract: ${route}`);
  return { route, source, controlSource, evidenceSource, handler, binding, control, ...resolvedBehavior, test, callPath, bridges };
}

function command(...owners: [RendererCommandOwner, ...RendererCommandOwner[]]): RendererCommandContract {
  const primary = owners[0];
  return {
    route: primary.route,
    control: primary.control,
    disabled: primary.disabled,
    loading: primary.loading,
    error: primary.error,
    test: primary.test,
    owners,
  };
}

function bridgeChain(...entries: Array<readonly [source: string, evidence: string]>): RendererCommandBridge[] {
  return entries.map(([source, evidence]) => ({ source, evidence }));
}

const productShellTest = 'tests/product-shell-ui.test.ts';
const historyTest = 'tests/history-governance.test.ts';

export const rendererCommandInventory = {
  addImageLabRecord: command(owner('image-lab', 'src/features/labs/ImageLabPage.tsx', 'importCompletedImage', 'importCompletedImage', '导入成品', productShellTest)),
  archiveImageLabRecord: command(owner('history', 'src/features/tasks/HistoryPage.tsx', 'archiveRecord', 'archiveRecord(record)', '归档记录', historyTest)),
  archiveTask: command(owner('history', 'src/features/tasks/HistoryPage.tsx', 'archiveRecord', 'archiveRecord(record)', '归档任务', historyTest)),
  archiveViralAnalysis: command(owner('history', 'src/features/tasks/HistoryPage.tsx', 'archiveRecord', 'archiveRecord(record)', '归档记录', historyTest)),
  archiveVoiceLabRecord: command(owner('history', 'src/features/tasks/HistoryPage.tsx', 'archiveRecord', 'archiveRecord(record)', '归档记录', historyTest)),
  composeResearchCopy: command(owner('new-task', 'src/features/tasks/NewTaskPage.tsx', 'composeResearchCopy', 'onClick={composeResearchCopy}', '结合所选页面信息生成文案', productShellTest)),
  createAndRunTask: command(
    owner('new-task', 'src/features/tasks/NewTaskPage.tsx', 'run', 'onClick={run}', '创建并开始任务', productShellTest),
    owner('benchmark', 'src/features/labs/BenchmarkImportPage.tsx', 'createBenchmarkTask', 'onClick={createBenchmarkTask}', '用此文案创建任务', productShellTest),
    owner('music-mv', 'src/features/music-mv/MusicMvPage.tsx', 'runMusicMv', 'onClick={runMusicMv}', '生成音乐 MV', productShellTest),
  ),
  createAndRunViralAnalysis: command(owner('viral-analyzer', 'src/features/viral/ViralAnalyzerPage.tsx', 'startAnalysis', 'onClick={startAnalysis}', '开始拆解', productShellTest, undefined, { disabled: 'disabled={viralAction.busy}', loading: 'viralAction.busy ? <Loader2', error: 'InlineActionFeedback' })),
  createHtmlVideoTask: command(owner('html-video', 'src/features/html-video/HtmlVideoPage.tsx', 'createHtmlVideoTask', 'createHtmlVideoTask', '创建并生成', 'tests/html-video.test.ts')),
  createPersonAsset: command(owner('person-assets', 'src/features/labs/PersonAssetsPage.tsx', 'createPerson', 'onClick={createPerson}', '创建', productShellTest)),
  createProductionTaskFromViral: command(owner('viral-analyzer', 'src/features/viral/ViralAnalyzerPage.tsx', 'createProductionTask', 'onClick={createProductionTask}', '生成新任务', productShellTest, 'src/features/viral/ViralReport.tsx', undefined, 'src/features/viral/ViralAnalyzerPage.tsx', undefined, bridgeChain(['src/features/viral/ViralAnalyzerPage.tsx', 'createProductionTask={createProductionTask}']))),
  deleteBookSelection: command(owner('book-selection', 'src/features/labs/BookSelectionPage.tsx', 'deleteSelection', 'deleteSelection(record)', '删除', productShellTest)),
  deleteImageLabRecordPermanently: command(owner('history', 'src/features/tasks/HistoryPage.tsx', 'deleteRecordPermanently', 'onConfirm={deleteRecordPermanently}', '永久删除', historyTest)),
  deletePersonAsset: command(owner('person-assets', 'src/features/labs/PersonAssetsPage.tsx', 'deletePerson', 'onClick={deletePerson}', '删除', productShellTest)),
  deleteTaskPermanently: command(owner('history', 'src/features/tasks/HistoryPage.tsx', 'deleteRecordPermanently', 'onConfirm={deleteRecordPermanently}', '永久删除', historyTest)),
  deleteViralAnalysisPermanently: command(owner('history', 'src/features/tasks/HistoryPage.tsx', 'deleteRecordPermanently', 'onConfirm={deleteRecordPermanently}', '永久删除', historyTest)),
  deleteVoiceLabRecordPermanently: command(owner('history', 'src/features/tasks/HistoryPage.tsx', 'deleteRecordPermanently', 'onConfirm={deleteRecordPermanently}', '永久删除', historyTest)),
  detectJianyingDraftPath: command(owner('settings', 'src/features/settings/SettingsPage.tsx', 'autoDetectJianyingDraftPath', 'onClick={autoDetectJianyingDraftPath}', '自动检测', productShellTest)),
  fetchImaKnowledge: command(owner('settings', 'src/features/settings/SettingsPage.tsx', 'fetchImaKnowledgeFromSettings', 'onClick={fetchImaKnowledgeFromSettings}', '测试并拉取知识库', 'tests/ima-knowledge.test.ts')),
  generateCustomStyleDraft: command(owner('prompt-templates', 'src/features/templates/PromptTemplatesPage.tsx', 'fillImageTemplateFromAiPrompt', 'fillImageTemplateFromAiPrompt', '生成字段', productShellTest, 'src/features/templates/PromptTemplateEditor.tsx', undefined, 'src/features/templates/PromptTemplatesPage.tsx', undefined, bridgeChain(['src/features/templates/PromptTemplatesPage.tsx', 'fillImageTemplateFromAiPrompt={fillImageTemplateFromAiPrompt}']))),
  generateImageLab: command(owner('image-lab', 'src/features/labs/ImageLabPage.tsx', 'addRecord', 'addRecord', '智能生成', productShellTest)),
  generateVoiceLabPreview: command(owner('voice-lab', 'src/features/labs/VoiceLabPage.tsx', 'generatePreview', 'generatePreview', '生成试听', productShellTest)),
  importHtmlVideoCover: command(owner('html-video', 'src/features/html-video/HtmlVideoTabPanel.tsx', 'importManualCover', 'onClick={importManualCover}', '导入封面', 'tests/html-video-cover.test.ts')),
  importOrdinaryTaskCover: command(owner('new-task', 'src/features/tasks/NewTaskPage.tsx', 'importOrdinaryTaskCover', 'onClick={importOrdinaryTaskCover}', '导入手动封面', 'tests/new-task-workbench-ui.test.ts')),
  importPersonAssetImages: command(owner('person-assets', 'src/features/labs/PersonAssetsPage.tsx', 'importImages', 'onClick={importImages}', '导入图片', productShellTest)),
  listProviderModels: command(owner(
    'settings',
    'src/features/settings/SettingsPage.tsx',
    'refreshProviderModels',
    'onClick={onRefresh}',
    '获取模型',
    productShellTest,
    'src/features/settings/settings-controls.tsx',
    { disabled: 'disabled={loading}', loading: 'loading ? <Loader2', error: 'status ? <small' },
    'src/features/settings/settings-controls.tsx',
    undefined,
    bridgeChain(
      ['src/features/settings/SettingsPage.tsx', 'onRefreshModels={refreshProviderModels}'],
      ['src/features/settings/ProviderProfileManagers.tsx', 'onRefresh={() => onRefreshModels('],
    ),
  )),
  listVolcengineSpeakers: command(owner('settings', 'src/features/settings/SettingsPage.tsx', 'refreshVolcengineSpeakers', 'onRefreshVolcengineSpeakers', '加载音色', productShellTest, 'src/features/settings/ProviderProfileManagers.tsx', undefined, 'src/features/settings/SettingsPage.tsx', undefined, bridgeChain(['src/features/settings/SettingsPage.tsx', 'onRefreshVolcengineSpeakers={refreshVolcengineSpeakers}']))),
  openHtmlVideoPreview: command(owner('html-video', 'src/features/html-video/HtmlVideoPage.tsx', 'openPreview', 'openPreview', '预览', 'tests/html-video-electron.test.ts')),
  openPersonAssetDirectory: command(owner('person-assets', 'src/features/labs/PersonAssetsPage.tsx', 'openSelectedAssetDir', 'onClick={openSelectedAssetDir}', '打开目录', 'tests/electron-ipc-contract.test.ts')),
  openTaskOutputDirectory: command(
    owner('html-video', 'src/features/html-video/HtmlVideoPage.tsx', 'openOutputDirectory', 'onClick={openOutputDirectory}', '打开目录', 'tests/electron-ipc-contract.test.ts'),
    owner('queue', 'src/features/tasks/QueuePage.tsx', 'openQueueOutput', 'openQueueOutput(task.id)', '打开任务输出目录', 'tests/electron-ipc-contract.test.ts'),
    owner('task-detail', 'src/features/tasks/TaskArtifactPreview.tsx', 'openArtifactOutput', 'onClick={openArtifactOutput}', '打开剪映草稿', 'tests/electron-ipc-contract.test.ts'),
  ),
  openViralLoginWindow: command(owner('viral-analyzer', 'src/features/viral/ViralAnalyzerPage.tsx', 'openDouyinLogin', 'onClick={openDouyinLogin}', '打开抖音登录窗口', productShellTest)),
  regenerateTaskImage: command(owner('task-detail', 'src/features/tasks/TaskArtifactPreview.tsx', 'regenerate[1]', 'regenerate(scene.id)', '重新生成', productShellTest)),
  regenerateTaskNarration: command(owner('task-detail', 'src/features/tasks/TaskArtifactPreview.tsx', 'regenerate[2]', 'regenerate(item.sceneId)', '重新生成配音', productShellTest)),
  renamePersonAsset: command(owner('person-assets', 'src/features/labs/PersonAssetsPage.tsx', 'renamePerson', 'onClick={renamePerson}', '重命名', productShellTest)),
  rerunTaskStep: command(
    owner('task-detail', 'src/features/tasks/TaskArtifactPreview.tsx', 'rerunArtifactStep', "onAction(step, 'regenerate')", '重新生成', productShellTest, undefined, { disabled: 'disabled={disabled || busy}', loading: 'regenerating ? <Loader2', error: 'InlineActionFeedback' }),
    owner('task-detail', 'src/features/tasks/TaskArtifactPreview.tsx', 'rerunArtifactStep', "onAction(step, 'rewrite')", '改写后继续', productShellTest, undefined, { disabled: 'disabled={disabled || busy}', loading: 'rewriting ? <Loader2', error: 'InlineActionFeedback' }),
  ),
  resetPromptTemplates: command(owner('prompt-templates', 'src/features/templates/PromptTemplatesPage.tsx', 'resetPromptTemplateLibrary', 'onClick={resetPromptTemplateLibrary}', '重置', productShellTest)),
  restoreImageLabRecord: command(owner('history', 'src/features/tasks/HistoryPage.tsx', 'restoreRecord', 'restoreRecord(record)', '恢复记录', historyTest)),
  restoreTask: command(owner('history', 'src/features/tasks/HistoryPage.tsx', 'restoreRecord', 'restoreRecord(record)', '恢复任务', historyTest)),
  restoreViralAnalysis: command(owner('history', 'src/features/tasks/HistoryPage.tsx', 'restoreRecord', 'restoreRecord(record)', '恢复记录', historyTest)),
  restoreVoiceLabRecord: command(owner('history', 'src/features/tasks/HistoryPage.tsx', 'restoreRecord', 'restoreRecord(record)', '恢复记录', historyTest)),
  retryTask: command(
    owner('queue', 'src/features/tasks/QueuePage.tsx', 'retryFailedTask', 'retryFailedTask(task)', '重试', 'tests/task-operations-contracts.test.ts'),
    owner('html-video', 'src/features/html-video/HtmlVideoPage.tsx', 'retryTask', 'retryTask', '重试', 'tests/task-operations-contracts.test.ts'),
    owner('task-detail', 'src/features/tasks/TaskDetailPage.tsx', 'retryTask', 'onClick={retryTask}', '重试当前步骤', 'tests/task-operations-contracts.test.ts'),
  ),
  retryViralAnalysis: command(owner('viral-analyzer', 'src/features/viral/ViralAnalyzerPage.tsx', 'retryAnalysis', 'onClick={retryAnalysis}', '重试', productShellTest)),
  runDiagnostics: command(owner('settings', 'src/features/settings/SettingsPage.tsx', 'runDiagnostics', 'onClick={runDiagnostics}', '检查诊断', productShellTest)),
  saveAccount: command(owner('account', 'src/features/account/AccountPage.tsx', 'saveAccountProfile', 'onClick={saveAccountProfile}', '保存资料', productShellTest)),
  saveActivation: command(owner('activation', 'src/features/account/ActivationPage.tsx', 'saveActivationState', 'onClick={saveActivationState}', '保存状态', productShellTest)),
  saveBookSelection: command(owner('book-selection', 'src/features/labs/BookSelectionPage.tsx', 'saveSelection', 'onClick={saveSelection}', '保存选品', productShellTest)),
  saveConfig: command(
    owner('music-mv', 'src/features/music-mv/MusicMvPage.tsx', 'selectMusicMvAudio', 'onClick={selectMusicMvAudio}', '选择音频', productShellTest),
    owner('settings', 'src/features/settings/SettingsPage.tsx', 'persistSettingsDraft', 'onClick={save}', '保存配置', productShellTest, undefined, undefined, undefined, ['save', 'commitAndApplySettingsDraft', 'persistSettingsDraft']),
    owner('settings', 'src/features/settings/SettingsPage.tsx', 'persistSettingsDraft', 'onActivate(profile.id!)', '启用 LLM 配置', productShellTest, 'src/features/settings/ProviderProfileManagers.tsx', { disabled: 'disabled={saving}', loading: 'settingsAction.busy', error: 'InlineActionFeedback' }, 'src/features/settings/SettingsPage.tsx', ['activateLlmProfile', 'commitAndApplySettingsDraft', 'persistSettingsDraft'], [{ source: 'src/features/settings/SettingsPage.tsx', evidence: 'onActivate={activateLlmProfile}' }]),
    owner('settings', 'src/features/settings/SettingsPage.tsx', 'persistSettingsDraft', 'onActivate(profile.id!)', '启用绘图配置', productShellTest, 'src/features/settings/ProviderProfileManagers.tsx', { disabled: 'disabled={saving}', loading: 'settingsAction.busy', error: 'InlineActionFeedback' }, 'src/features/settings/SettingsPage.tsx', ['activateImageProfile', 'commitAndApplySettingsDraft', 'persistSettingsDraft'], [{ source: 'src/features/settings/SettingsPage.tsx', evidence: 'onActivate={activateImageProfile}' }]),
    owner('settings', 'src/features/settings/SettingsPage.tsx', 'persistSettingsDraft', 'onActivate(profile.id!)', '启用 TTS 配置', productShellTest, 'src/features/settings/ProviderProfileManagers.tsx', { disabled: 'disabled={saving}', loading: 'settingsAction.busy', error: 'InlineActionFeedback' }, 'src/features/settings/SettingsPage.tsx', ['activateTtsProfile', 'commitAndApplySettingsDraft', 'persistSettingsDraft'], [{ source: 'src/features/settings/SettingsPage.tsx', evidence: 'onActivate={activateTtsProfile}' }]),
    owner('settings', 'src/features/settings/SettingsPage.tsx', 'persistSettingsDraft', 'onClick={fetchImaKnowledgeFromSettings}', '测试并拉取知识库', productShellTest, undefined, undefined, undefined, ['fetchImaKnowledgeFromSettings', 'persistSettingsDraft']),
    owner('settings', 'src/features/settings/SettingsPage.tsx', 'persistSettingsDraft', 'onClick={uploadBgmFromSettings}', '添加 BGM 文件', productShellTest, undefined, undefined, undefined, ['uploadBgmFromSettings', 'persistSettingsDraft']),
    owner('settings', 'src/features/settings/SettingsPage.tsx', 'testCurrentConfig', 'onClick={testCurrentConfig}', '保存并测试', productShellTest),
    owner('new-task', 'src/features/tasks/NewTaskPage.tsx', 'addBgmFromTask', 'onClick={addBgmFromTask}', '添加', productShellTest),
    owner('viral-analyzer', 'src/features/viral/ViralAnalyzerPage.tsx', 'persistViralCookiePath', 'onClick={chooseCookieFile}', '选择 Cookie 文件', productShellTest, undefined, undefined, undefined, ['chooseCookieFile', 'persistViralCookiePath']),
    owner('viral-analyzer', 'src/features/viral/ViralAnalyzerPage.tsx', 'persistViralCookiePath', 'onBlur={() => saveViralCookiePath(cookieFilePath)}', 'id="viral-cookie-input"', productShellTest, undefined, undefined, undefined, ['saveViralCookiePath', 'persistViralCookiePath']),
    owner('viral-analyzer', 'src/features/viral/ViralAnalyzerPage.tsx', 'persistViralCookiePath', "saveViralCookiePath('')", '清空', productShellTest, undefined, undefined, undefined, ['saveViralCookiePath', 'persistViralCookiePath']),
    owner('viral-analyzer', 'src/features/viral/ViralAnalyzerPage.tsx', 'persistViralCookiePath', 'onClick={startAnalysis}', '开始拆解', productShellTest, undefined, { disabled: 'disabled={viralAction.busy}', loading: 'viralAction.busy ? <Loader2', error: 'InlineActionFeedback' }, undefined, ['startAnalysis', 'persistViralCookiePath']),
  ),
  saveCustomStyle: command(
    owner('prompt-templates', 'src/features/templates/PromptTemplatesPage.tsx', 'saveCustomStyleDraft', 'onClick={saveCustomStyleDraft}', '保存修改', productShellTest, 'src/features/templates/PromptTemplateEditor.tsx', undefined, 'src/features/templates/PromptTemplatesPage.tsx', undefined, bridgeChain(['src/features/templates/PromptTemplatesPage.tsx', 'saveCustomStyleDraft={saveCustomStyleDraft}'])),
    owner('prompt-templates', 'src/features/templates/PromptTemplatesPage.tsx', 'duplicateImageTemplate', 'duplicateImageTemplate(style)', '克隆', productShellTest),
    owner('prompt-templates', 'src/features/templates/PromptTemplatesPage.tsx', 'duplicateImageTemplate', 'duplicateImageTemplate(imageDraft)', '克隆', productShellTest, 'src/features/templates/PromptTemplateEditor.tsx', undefined, 'src/features/templates/PromptTemplatesPage.tsx', undefined, bridgeChain(['src/features/templates/PromptTemplatesPage.tsx', 'duplicateImageTemplate={duplicateImageTemplate}'])),
    owner('prompt-templates', 'src/features/templates/PromptTemplatesPage.tsx', 'createImageTemplate', "promptTemplateLibraryTab === 'story' ? createPromptTemplate : createImageTemplate", '新建模板', productShellTest),
    owner('prompt-templates', 'src/features/templates/PromptTemplatesPage.tsx', 'importImageTemplateJson', 'importImageTemplateJson()', '导入 JSON', productShellTest, 'src/features/templates/PromptTemplateEditor.tsx', undefined, 'src/features/templates/PromptTemplatesPage.tsx', undefined, bridgeChain(['src/features/templates/PromptTemplatesPage.tsx', 'importImageTemplateJson={importImageTemplateJson}'])),
  ),
  saveDraftTemplate: command(
    owner('draft-templates', 'src/features/templates/DraftTemplatesPage.tsx', 'save', 'onClick={save}', '保存', productShellTest),
    owner('draft-templates', 'src/features/templates/DraftTemplatesPage.tsx', 'copyTemplate', 'copyTemplate(draft)', '复制', productShellTest),
    owner('draft-templates', 'src/features/templates/DraftTemplatesPage.tsx', 'copyTemplate', 'copyTemplate(template)', '复制', productShellTest),
    owner('draft-templates', 'src/features/templates/DraftTemplatesPage.tsx', 'createTemplate', 'onClick={createTemplate}', 'aria-label="新建草稿模板"', productShellTest),
    owner('draft-templates', 'src/features/templates/DraftTemplatesPage.tsx', 'createTemplate', 'onClick={createTemplate}', 'aria-label="从默认模板新建草稿模板"', productShellTest),
    owner('draft-templates', 'src/features/templates/DraftTemplatesPage.tsx', 'saveCozeWorkflowTemplate', 'onClick={saveCozeWorkflowTemplate}', '导入 Coze 模板', productShellTest),
    owner('draft-templates', 'src/features/templates/DraftTemplatesPage.tsx', 'saveAllCozeWorkflowTemplates', 'onClick={saveAllCozeWorkflowTemplates}', '全部导入', productShellTest),
  ),
  savePromptTemplate: command(
    owner('prompt-templates', 'src/features/templates/PromptTemplatesPage.tsx', 'savePromptTemplateDraft', 'onClick={savePromptTemplateDraft}', '保存修改', productShellTest, 'src/features/templates/PromptTemplateEditor.tsx', undefined, 'src/features/templates/PromptTemplatesPage.tsx', undefined, bridgeChain(['src/features/templates/PromptTemplatesPage.tsx', 'savePromptTemplateDraft={savePromptTemplateDraft}'])),
    owner('prompt-templates', 'src/features/templates/PromptTemplatesPage.tsx', 'duplicateTemplate', 'duplicateTemplate(template)', '克隆', productShellTest),
    owner('prompt-templates', 'src/features/templates/PromptTemplatesPage.tsx', 'duplicateTemplate', 'onClick={duplicate}', '克隆', productShellTest, 'src/features/templates/PromptTemplateEditor.tsx', undefined, 'src/features/templates/PromptTemplatesPage.tsx', ['duplicate', 'duplicateTemplate'], bridgeChain(['src/features/templates/PromptTemplatesPage.tsx', 'duplicate={duplicate}'])),
    owner('prompt-templates', 'src/features/templates/PromptTemplatesPage.tsx', 'createPromptTemplate', "promptTemplateLibraryTab === 'story' ? createPromptTemplate : createImageTemplate", '新建模板', productShellTest),
    owner('prompt-templates', 'src/features/templates/PromptTemplatesPage.tsx', 'importPromptTemplateJson', 'importPromptTemplateJson()', '导入 JSON', productShellTest, 'src/features/templates/PromptTemplateEditor.tsx', undefined, 'src/features/templates/PromptTemplatesPage.tsx', undefined, bridgeChain(['src/features/templates/PromptTemplatesPage.tsx', 'importPromptTemplateJson={importPromptTemplateJson}'])),
  ),
  saveUiPreferences: command(
    owner('settings', 'src/features/settings/SettingsPage.tsx', 'persist', 'selectTheme', '主题', productShellTest, undefined, { disabled: 'disabled={themeAction.busy}', loading: 'themeAction.busy', error: 'InlineActionFeedback' }),
    owner('shell', 'src/app/App.tsx', 'navigate', 'navigate(newTaskPrimaryAction.view)', 'newTaskPrimaryAction.label', productShellTest, 'src/app/AppShell.tsx', undefined, undefined, undefined, bridgeChain(['src/app/App.tsx', 'navigate={navigate}'])),
    owner('shell', 'src/app/App.tsx', 'navigate', 'navigate(item.view)', 'item.label', productShellTest, 'src/app/AppShell.tsx', undefined, undefined, undefined, bridgeChain(['src/app/App.tsx', 'navigate={navigate}'])),
    owner('shell', 'src/app/App.tsx', 'navigate', "navigate('activation')", '试用剩余', productShellTest, 'src/app/AppShell.tsx', undefined, undefined, undefined, bridgeChain(['src/app/App.tsx', 'navigate={navigate}'])),
    owner('shell', 'src/app/App.tsx', 'navigate', "navigate('account')", '积分明细', productShellTest, 'src/app/AppShell.tsx', undefined, undefined, undefined, bridgeChain(['src/app/App.tsx', 'navigate={navigate}'])),
    owner('shell', 'src/app/App.tsx', 'navigate', "navigate('account')", '账户中心', productShellTest, 'src/app/AppShell.tsx', undefined, undefined, undefined, bridgeChain(['src/app/App.tsx', 'navigate={navigate}'])),
    owner('shell', 'src/app/App.tsx', 'openTaskDetail', 'openTaskDetail(task.id)', '未命名任务', productShellTest, 'src/app/AppShell.tsx', undefined, undefined, undefined, bridgeChain(['src/app/App.tsx', 'openTaskDetail={openTaskDetail}'])),
    owner('shell', 'src/app/App.tsx', 'toggleTheme', 'onClick={toggleTheme}', 'themeLabel', productShellTest, 'src/app/AppShell.tsx', undefined, 'src/app/AppShell.tsx', undefined, bridgeChain(['src/app/App.tsx', 'toggleTheme={toggleTheme}'])),
  ),
  saveViralTemplates: command(owner('viral-analyzer', 'src/features/viral/ViralAnalyzerPage.tsx', 'saveViralTemplates', 'handleSaveTemplates', '保存为模板', productShellTest, 'src/features/viral/ViralReport.tsx', undefined, 'src/features/viral/ViralAnalyzerPage.tsx', undefined, bridgeChain(['src/features/viral/ViralAnalyzerPage.tsx', 'saveTemplates={saveViralTemplates}'], ['src/features/viral/ViralReport.tsx', 'await saveTemplates({']))),
  searchWebSources: command(owner('new-task', 'src/features/tasks/NewTaskPage.tsx', 'searchWebSources', 'onClick={searchWebSources}', '搜索', productShellTest)),
  selectCookieFile: command(owner('viral-analyzer', 'src/features/viral/ViralAnalyzerPage.tsx', 'chooseCookieFile', 'onClick={chooseCookieFile}', '选择 Cookie 文件', productShellTest)),
  selectLocalAudio: command(
    owner('music-mv', 'src/features/music-mv/MusicMvPage.tsx', 'selectMusicMvAudio', 'onClick={selectMusicMvAudio}', '选择音频', productShellTest),
    owner('settings', 'src/features/settings/SettingsPage.tsx', 'uploadBgmFromSettings', 'onClick={uploadBgmFromSettings}', '添加 BGM 文件', productShellTest),
    owner('new-task', 'src/features/tasks/NewTaskPage.tsx', 'addBgmFromTask', 'onClick={addBgmFromTask}', '添加', productShellTest),
  ),
  selectLocalFolder: command(owner('settings', 'src/features/settings/SettingsPage.tsx', 'pickJianyingDraftPath', 'onClick={pickJianyingDraftPath}', '选择目录', productShellTest)),
  selectLocalImage: command(
    owner('image-lab', 'src/features/labs/ImageLabPage.tsx', 'selectImageLabReferenceImage', 'onClick={selectImageLabReferenceImage}', '添加参考图', productShellTest, undefined, { disabled: 'disabled={imageLabAction.busy}', loading: 'imageLabAction.busy', error: 'InlineActionFeedback' }),
    owner('image-lab', 'src/features/labs/ImageLabPage.tsx', 'importCompletedImage', 'importCompletedImage', '导入成品', productShellTest),
    owner('new-task', 'src/features/tasks/NewTaskPage.tsx', 'selectTaskReferenceImage', 'onClick={selectTaskReferenceImage}', '上传主角参考图', productShellTest),
    owner('draft-templates', 'src/features/templates/DraftTemplatesPage.tsx', 'selectDraftBackgroundImage', 'onClick={selectDraftBackgroundImage}', '浏览', productShellTest),
  ),
  testAppConfig: command(owner('settings', 'src/features/settings/SettingsPage.tsx', 'testCurrentConfig', 'onClick={testCurrentConfig}', '保存并测试', productShellTest)),
  testLlmConfig: command(owner('settings', 'src/features/settings/SettingsPage.tsx', 'testSelectedLlmConfig', 'onClick={testSelectedLlmConfig}', '仅测试当前 LLM', productShellTest)),
  updateHtmlVideoConfig: command(
    owner('html-video', 'src/features/html-video/HtmlVideoPage.tsx', 'saveConfig', 'saveConfig', '保存参数', productShellTest),
    owner('html-video', 'src/features/html-video/HtmlVideoTabPanel.tsx', 'saveCaptionConfig', 'onClick={saveCaptionConfig}', '保存字幕', productShellTest),
    owner('html-video', 'src/features/html-video/HtmlVideoTabPanel.tsx', 'saveCoverConfig', 'onClick={saveCoverConfig}', '保存封面', productShellTest),
  ),
  updateTaskImagePrompt: command(owner('task-detail', 'src/features/tasks/TaskArtifactPreview.tsx', 'savePrompt', 'savePrompt(scene.id)', '保存提示词', productShellTest)),
  updateTaskStatus: command(
    owner('html-video', 'src/features/html-video/HtmlVideoPage.tsx', 'setTaskStatus', "setTaskStatus('paused')", '暂停', 'tests/task-operations-contracts.test.ts', undefined, { disabled: 'disabled={taskBusy || isBrowserPreview}', loading: 'taskBusy', error: 'InlineActionFeedback' }),
    owner('html-video', 'src/features/html-video/HtmlVideoPage.tsx', 'setTaskStatus', "setTaskStatus('cancelled')", '取消', 'tests/task-operations-contracts.test.ts', undefined, { disabled: 'disabled={taskBusy || isBrowserPreview}', loading: 'taskBusy', error: 'InlineActionFeedback' }),
    owner('html-video', 'src/features/html-video/HtmlVideoPage.tsx', 'setTaskStatus', "setTaskStatus('running')", '继续', 'tests/task-operations-contracts.test.ts', undefined, { disabled: 'disabled={taskBusy || isBrowserPreview}', loading: 'taskBusy', error: 'InlineActionFeedback' }),
    owner('queue', 'src/features/tasks/QueuePage.tsx', 'setStatus', "setStatus(task, 'paused')", '暂停', 'tests/task-operations-contracts.test.ts'),
    owner('queue', 'src/features/tasks/QueuePage.tsx', 'setStatus', "setStatus(task, 'cancelled')", '取消', 'tests/task-operations-contracts.test.ts'),
    owner('queue', 'src/features/tasks/QueuePage.tsx', 'continueTask', 'continueTask(task)', '继续', 'tests/task-operations-contracts.test.ts'),
    owner('task-detail', 'src/features/tasks/TaskDetailPage.tsx', 'setTaskStatus', "setTaskStatus('paused')", '暂停任务', 'tests/task-operations-contracts.test.ts'),
    owner('task-detail', 'src/features/tasks/TaskDetailPage.tsx', 'setTaskStatus', "setTaskStatus('running')", '继续任务', 'tests/task-operations-contracts.test.ts'),
    owner('task-detail', 'src/features/tasks/TaskDetailPage.tsx', 'setTaskStatus', "setTaskStatus('cancelled')", '取消任务', 'tests/task-operations-contracts.test.ts'),
  ),
  updateViralAnalysisStatus: command(owner('viral-analyzer', 'src/features/viral/ViralAnalyzerPage.tsx', 'updateAnalysisStatus', 'pauseAnalysis', '暂停', productShellTest)),
  windowControl: command(
    owner('shell', 'src/app/App.tsx', 'minimizeWindow', 'onClick={minimizeWindow}', '最小化', productShellTest, 'src/app/AppShell.tsx', undefined, undefined, undefined, bridgeChain(['src/app/App.tsx', 'minimizeWindow={minimizeWindow}'])),
    owner('shell', 'src/app/App.tsx', 'toggleMaximizeWindow', 'onClick={toggleMaximizeWindow}', '最大化', productShellTest, 'src/app/AppShell.tsx', undefined, undefined, undefined, bridgeChain(['src/app/App.tsx', 'toggleMaximizeWindow={toggleMaximizeWindow}'])),
    owner('shell', 'src/app/App.tsx', 'closeWindow', 'onClick={closeWindow}', '关闭', productShellTest, 'src/app/AppShell.tsx', undefined, undefined, undefined, bridgeChain(['src/app/App.tsx', 'closeWindow={closeWindow}'])),
  ),
};

const typedRendererCommandInventory: Partial<Record<keyof StoryDreamApi, RendererCommandContract>> = rendererCommandInventory;
void typedRendererCommandInventory;
