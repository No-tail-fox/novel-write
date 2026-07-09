import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type Cookie } from 'electron';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { readTaskArtifactSnapshot } from '../src/shared/artifact-preview';
import { fromLlmModelTestResult, testConfigTarget } from '../src/shared/config-utils';
import { generateImageLabRecord } from '../src/shared/image-lab';
import { detectJianyingDraftPath, resolveRuntimeJianyingDraftPath } from '../src/shared/jianying-paths';
import { loadJianyingEffectCatalog } from '../src/shared/jianying-effects';
import { generateConfiguredVoicePreview } from '../src/shared/media-providers';
import { createPersonAsset, deletePersonAsset, importPersonAssetFiles, listPersonAssets, listPersonImages, renamePersonAsset } from '../src/shared/person-assets';
import { createConfiguredJsonLlm, createConfiguredTextLlm, listConfiguredProviderModels, testConfiguredLlm } from '../src/shared/llm-provider';
import { markSceneImageForRegeneration, markSceneNarrationForRegeneration, markTaskStepForRerun, updateSceneImagePrompt } from '../src/shared/pipeline-cache';
import { resolvePythonRuntimeInfo, setDefaultPythonRuntimeAppRoot } from '../src/shared/python-runtime';
import { composeCopyFromSources, createAiSourceResearcher, searchWebSources } from '../src/shared/research';
import { runTask } from '../src/shared/runner';
import { FileDatabase } from '../src/shared/storage';
import { createTaskRuntimeProviders } from '../src/shared/task-runtime-providers';
import type { AccountProfile, ActivationState, AppConfig, BookSelectionInput, ConfigTestTarget, CreateTaskInput, CreateViralAnalysisInput, CustomStyle, CustomStyleGenerateInput, DraftTemplate, ImageLabGenerateInput, LlmConfig, PromptTemplate, ProviderModelListRequest, ResearchCopyComposeInput, Task, TaskStatus, TaskStepRerunMode, UiPreferences, ViralAnalysisRecord, ViralAnalysisStatus, ViralProductionTaskOptions, VolcengineSpeakerListRequest, VoiceLabGenerateInput } from '../src/shared/types';
import { createViralProductionTaskInput, detectViralPlatform, runViralAnalysis } from '../src/shared/viral-analysis';
import { createViralRuntimeProviders } from '../src/shared/viral-runtime';
import { listVolcengineSpeakers } from '../src/shared/volcengine-speakers';
import { getRendererIndexPath } from './paths';
import { loadConfigFromFile, saveConfigToFile } from '../src/shared/config-file';

const __dirname = dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
let mainWindow: BrowserWindow | null = null;
let viralLoginWindow: BrowserWindow | null = null;
let db: FileDatabase | null = null;
interface RunningTaskRun {
  controller: AbortController;
  restartAfterAbort: boolean;
}

const runningTasks = new Map<string, RunningTaskRun>();
const runningViralAnalyses = new Map<string, AbortController>();
const appDataName = 'storydream';
const staleRunningMs = 5 * 60 * 1000;
const pipelineStepAgents: Record<number, string> = {
  0: 'Reviewer',
  1: 'Writer',
  2: 'Storyboard',
  3: 'Prompt',
  4: 'Producer',
  5: 'TTS',
  6: 'Draft',
};

async function getDb(): Promise<FileDatabase> {
  if (db) return db;
  const dir = appDataDir();
  await mkdir(dir, { recursive: true });
  db = await FileDatabase.open(join(dir, 'data.db'));
  await ensureRuntimeJianyingDraftPath(db);
  const externalConfig = await loadConfigFromFile(dir);
  if (externalConfig) {
    await db.upsertConfig(externalConfig);
  }
  return db;
}

async function ensureRuntimeJianyingDraftPath(database: FileDatabase): Promise<void> {
  const state = await database.getState();
  const current = state.config.jianying.draftPath;
  const resolved = resolveRuntimeJianyingDraftPath(current, { pathExists: existsSync });
  if (resolved !== current.trim()) {
    await database.upsertConfig({
      ...state.config,
      jianying: {
        ...state.config.jianying,
        draftPath: resolved,
      },
    });
  }
}

async function createWindow(): Promise<void> {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1080,
    minHeight: 720,
    title: 'StoryDream',
    backgroundColor: '#101114',
    autoHideMenuBar: true,
    frame: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);

  const devUrl = process.env.VITE_DEV_SERVER_URL ?? (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:5173' : '');
  if (devUrl) {
    await mainWindow.loadURL(devUrl);
  } else {
    await mainWindow.loadFile(getRendererIndexPath(__dirname));
  }
  const database = await getDb();
  await pauseStaleRunningTasks(database);
  await sendTaskState(database);
}

async function sendTaskState(database: FileDatabase): Promise<void> {
  const state = await database.getState();
  mainWindow?.webContents.send('task:event', state);
}

function notifyTaskState(database: FileDatabase): void {
  void sendTaskState(database);
}

function taskWorkDir(task: Task): string {
  return join(app.getPath('userData'), appDataName, 'tasks', task.id);
}

function viralAnalysisWorkDir(record: Pick<ViralAnalysisRecord, 'id'>): string {
  return join(app.getPath('userData'), appDataName, 'viral-analyses', record.id);
}

function imageLabWorkDir(id: string): string {
  return join(app.getPath('userData'), appDataName, 'image-lab', id);
}

function voiceLabWorkDir(id: string): string {
  return join(app.getPath('userData'), appDataName, 'voice-lab', id);
}

function appDataDir(): string {
  return join(app.getPath('userData'), appDataName);
}

function personAssetsRoot(): string {
  return join(appDataDir(), 'person-assets');
}

function viralCookieDir(): string {
  return join(appDataDir(), 'viral-cookies');
}

function viralCookieFilePath(): string {
  return join(viralCookieDir(), 'douyin-cookies.txt');
}

async function pauseStaleRunningTasks(database: FileDatabase): Promise<void> {
  const state = await database.getState();
  const now = Date.now();
  for (const task of state.tasks) {
    if (task.status !== 'running' || runningTasks.has(task.id)) continue;
    const heartbeat = task.lastHeartbeatAt ? new Date(task.lastHeartbeatAt).getTime() : 0;
    if (!heartbeat || Number.isNaN(heartbeat) || now - heartbeat > staleRunningMs) {
      await database.updateTask(task.id, {
        status: 'paused',
        currentStep: task.currentStep,
        failedStep: task.failedStep ?? task.currentStep,
        retryFromStep: task.retryFromStep ?? task.currentStep,
        errorMessage: '运行中断，可从失败/当前步骤重试。',
        lastHeartbeatAt: new Date().toISOString(),
      });
      await database.addTaskEvent(task.id, {
        type: 'step_error',
        step: task.failedStep ?? task.currentStep,
        agent: null,
        detail: '运行中断，可从失败/当前步骤重试。',
      });
    }
  }
}

async function buildRunOptions(database: FileDatabase, task: Task, controller: AbortController) {
  const state = await database.getState();
  return {
    appDataDir: appDataDir(),
    signal: controller.signal,
    resolveAiSourceContext: createAiSourceResearcher(state.config),
    ...createTaskRuntimeProviders(state.config, taskWorkDir(task), task),
    customCoverTemplates: state.customCoverTemplates,
    onEvent: () => {
      notifyTaskState(database);
    },
    onHeartbeat: async () => {
      await sendTaskState(database);
    },
  };
}

function startTaskRun(database: FileDatabase, task: Task): boolean {
  if (runningTasks.has(task.id)) return false;
  const controller = new AbortController();
  const run: RunningTaskRun = { controller, restartAfterAbort: false };
  runningTasks.set(task.id, run);
  void (async () => {
    try {
      await runTask(database, { ...task, status: 'pending', errorMessage: '' }, await buildRunOptions(database, task, controller));
    } catch (error) {
      console.error('Background task failed', error);
    } finally {
      const currentRun = runningTasks.get(task.id);
      const shouldRestart = currentRun === run && run.restartAfterAbort;
      if (currentRun === run) {
        runningTasks.delete(task.id);
      }
      if (shouldRestart) {
        const latestTask = (await database.getState()).tasks.find((item) => item.id === task.id);
        if (latestTask && latestTask.status !== 'cancelled' && latestTask.status !== 'completed') {
          startTaskRun(database, { ...latestTask, status: 'pending', errorMessage: '' });
          return;
        }
      }
      await sendTaskState(database);
    }
  })();
  return true;
}

async function resumeTaskRun(database: FileDatabase, task: Task): Promise<void> {
  const existingRun = runningTasks.get(task.id);
  if (existingRun) {
    existingRun.restartAfterAbort = true;
    if (!existingRun.controller.signal.aborted) {
      existingRun.controller.abort('用户重试');
    }
    await database.updateTask(task.id, {
      errorMessage: '正在停止当前运行，随后继续重试。',
      lastHeartbeatAt: new Date().toISOString(),
    });
    return;
  }
  await database.updateTask(task.id, { status: 'pending', errorMessage: '' });
  startTaskRun(database, { ...task, status: 'pending', errorMessage: '' });
}

function startViralAnalysisRun(database: FileDatabase, record: ViralAnalysisRecord): boolean {
  if (runningViralAnalyses.has(record.id)) return false;
  const controller = new AbortController();
  runningViralAnalyses.set(record.id, controller);
  void (async () => {
    const startedAt = new Date().toISOString();
    try {
      const state = await database.getState();
      await database.updateViralAnalysis(record.id, {
        status: 'running',
        currentStage: 'downloading',
        progress: 0.05,
        errorMessage: '',
        startedAt,
        lastHeartbeatAt: startedAt,
      });
      const completed = await runViralAnalysis(record, {
        workDir: viralAnalysisWorkDir(record),
        signal: controller.signal,
        ...createViralRuntimeProviders(state.config, viralAnalysisWorkDir(record)),
        emit: async (event) => {
          await database.addViralAnalysisEvent(record.id, {
            type: event.type,
            stage: event.stage,
            detail: event.detail,
            dataJson: event.data === undefined ? null : JSON.stringify(event.data),
          });
          const patch: Parameters<FileDatabase['updateViralAnalysis']>[1] = {
            currentStage: event.stage as ViralAnalysisRecord['currentStage'],
            lastHeartbeatAt: new Date().toISOString(),
          };
          if (typeof event.progress === 'number') patch.progress = event.progress;
          await database.updateViralAnalysis(record.id, {
            ...patch,
          });
          await sendTaskState(database);
        },
      });
      const completedAt = new Date().toISOString();
      await database.updateViralAnalysis(record.id, {
        status: 'completed',
        currentStage: 'completed',
        progress: 1,
        resultPath: completed.resultPath,
        videoPath: completed.videoPath,
        title: completed.result.source.title || record.title,
        completedAt,
        lastHeartbeatAt: completedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = controller.signal.aborted || /abort|cancel|取消/i.test(message);
      await database.addViralAnalysisEvent(record.id, {
        type: 'error',
        stage: cancelled ? 'failed' : 'failed',
        detail: message,
      });
      await database.updateViralAnalysis(record.id, {
        status: cancelled ? 'cancelled' : 'failed',
        currentStage: 'failed',
        errorMessage: message,
        lastHeartbeatAt: new Date().toISOString(),
      });
    } finally {
      runningViralAnalyses.delete(record.id);
      await sendTaskState(database);
    }
  })();
  return true;
}

async function resumeViralAnalysisRun(database: FileDatabase, record: ViralAnalysisRecord): Promise<void> {
  runningViralAnalyses.get(record.id)?.abort('用户重试');
  await database.updateViralAnalysis(record.id, {
    status: 'pending',
    currentStage: 'queued',
    progress: 0,
    errorMessage: '',
    completedAt: null,
    lastHeartbeatAt: new Date().toISOString(),
  });
  startViralAnalysisRun(database, { ...record, status: 'pending', currentStage: 'queued', progress: 0, errorMessage: '' });
}

ipcMain.handle('window:control', async (_event, action: 'minimize' | 'toggle-maximize' | 'close') => {
  if (action === 'minimize') {
    mainWindow?.minimize();
    return;
  }
  if (action === 'toggle-maximize') {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
    return;
  }
  if (action === 'close') {
    mainWindow?.close();
  }
});

ipcMain.handle('app:get-state', async () => {
  const database = await getDb();
  return database.getState();
});

ipcMain.handle('app:save-config', async (_event, config) => {
  const database = await getDb();
  await database.upsertConfig(config as AppConfig);
  await saveConfigToFile(appDataDir(), config as AppConfig);
  return database.getState();
});

ipcMain.handle('llm:test-config', async (_event, config: LlmConfig) => testConfiguredLlm(config));

ipcMain.handle('models:list', async (_event, request: ProviderModelListRequest) => listConfiguredProviderModels(request));

ipcMain.handle('volcengine:speakers:list', async (_event, request: VolcengineSpeakerListRequest) => listVolcengineSpeakers(request));

ipcMain.handle('config:test', async (_event, input: { target: ConfigTestTarget; config: AppConfig }) => {
  if (input.target === 'llm') {
    return fromLlmModelTestResult(await testConfiguredLlm(input.config.llm));
  }
  return testConfigTarget(input.target, input.config, { pathExists: existsSync });
});

ipcMain.handle('research:web-search', async (_event, query: string) => {
  const trimmed = query.trim();
  if (!trimmed) {
    return { query: trimmed, sections: [], warnings: ['请输入关键词后再搜索。'] };
  }
  try {
    return { query: trimmed, sections: await searchWebSources(trimmed), warnings: [] };
  } catch (error) {
    return { query: trimmed, sections: [], warnings: [error instanceof Error ? error.message : String(error)] };
  }
});

ipcMain.handle('research:compose-copy', async (_event, input: ResearchCopyComposeInput) => {
  const database = await getDb();
  const state = await database.getState();
  return composeCopyFromSources(createConfiguredTextLlm(state.config.llm), input);
});

ipcMain.handle('prompt-template:save', async (_event, template: PromptTemplate) => {
  const database = await getDb();
  await database.upsertPromptTemplate(template);
  return database.getState();
});

ipcMain.handle('prompt-template:reset', async () => {
  const database = await getDb();
  await database.resetPromptTemplates();
  return database.getState();
});

ipcMain.handle('custom-style:save', async (_event, style: CustomStyle) => {
  const database = await getDb();
  await database.upsertCustomStyle(style);
  return database.getState();
});

ipcMain.handle('custom-style:generate-draft', async (_event, input: CustomStyleGenerateInput): Promise<CustomStyle> => {
  const database = await getDb();
  const state = await database.getState();
  const llm = createConfiguredJsonLlm(state.config.llm);
  const result = await llm.run<Partial<CustomStyle>>({
    step: -1,
    name: 'custom-style-draft',
    messages: [
      { role: 'system', content: 'Return strict JSON only. Schema: {"name":string,"tag":string,"shortName":string,"prefix":string,"suffix":string,"negativePrompt":string,"allowColor":boolean,"description":string}.' },
      {
        role: 'user',
        content: [
          `用户描述：${input.prompt}`,
          `基准风格：${JSON.stringify(input.baseStyle)}`,
          '请生成一个中文图像风格模板。prefix 控制整体基调，suffix 强化质感，negativePrompt 写需要规避的画面问题。',
        ].join('\n\n'),
      },
    ],
  });
  return normalizeGeneratedCustomStyle(input, result.json);
});

ipcMain.handle('draft-template:save', async (_event, template: DraftTemplate) => {
  const database = await getDb();
  await database.upsertDraftTemplate(template);
  return database.getState();
});

ipcMain.handle('image-lab:generate', async (_event, input: ImageLabGenerateInput) => {
  const database = await getDb();
  const state = await database.getState();
  const id = input.id ?? randomUUID();
  const record = await generateImageLabRecord(state.config, imageLabWorkDir(id), { ...input, id });
  await database.addImageLabRecord(record);
  return database.getState();
});

ipcMain.handle('image-lab:add-record', async (_event, input) => {
  const database = await getDb();
  await database.addImageLabRecord(input);
  return database.getState();
});

ipcMain.handle('voice-lab:generate', async (_event, input: VoiceLabGenerateInput) => {
  const database = await getDb();
  const state = await database.getState();
  const id = input.id ?? randomUUID();
  const record = await generateConfiguredVoicePreview(state.config, voiceLabWorkDir(id), { ...input, id });
  await database.addVoiceLabRecord(record);
  return database.getState();
});

ipcMain.handle('account:save', async (_event, account: AccountProfile) => {
  const database = await getDb();
  await database.upsertAccount(account);
  return database.getState();
});

ipcMain.handle('activation:save', async (_event, activation: ActivationState) => {
  const database = await getDb();
  await database.upsertActivation(activation);
  return database.getState();
});

ipcMain.handle('ui:save-preferences', async (_event, ui: UiPreferences) => {
  const database = await getDb();
  await database.upsertUiPreferences(ui);
  return database.getState();
});

ipcMain.handle('book-selection:list', async (_event, theme?: string) => (await getDb()).listBookSelections(theme));

ipcMain.handle('book-selection:save', async (_event, input: BookSelectionInput) => (await getDb()).upsertBookSelection(input));

ipcMain.handle('book-selection:delete', async (_event, input: { theme: string; bookId: string }) => {
  await (await getDb()).deleteBookSelection(input.theme, input.bookId);
});

ipcMain.handle('person-assets:list', async () => listPersonAssets(personAssetsRoot()));

ipcMain.handle('person-assets:create', async (_event, name: string) => createPersonAsset(personAssetsRoot(), name));

ipcMain.handle('person-assets:rename', async (_event, input: { oldName: string; newName: string }) => renamePersonAsset(personAssetsRoot(), input.oldName, input.newName));

ipcMain.handle('person-assets:delete', async (_event, name: string) => deletePersonAsset(personAssetsRoot(), name));

ipcMain.handle('person-assets:list-images', async (_event, name: string) => listPersonImages(personAssetsRoot(), name));

ipcMain.handle('person-assets:import-images', async (_event, name: string) => {
  const result = await dialog.showOpenDialog({
    title: `导入图片到「${name}」`,
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  });
  if (result.canceled) return 0;
  return importPersonAssetFiles(personAssetsRoot(), name, result.filePaths);
});

ipcMain.handle('html-video:create-task', async (_event, input: CreateTaskInput) => {
  const database = await getDb();
  await database.createTask({
    ...input,
    taskKind: 'story',
    taskType: 'html-video',
    pipelineStep: input.pipelineStep ?? 'plan',
    pipelineData: input.pipelineData ?? '{}',
  });
  return database.getState();
});

ipcMain.handle('task:create-and-run', async (_event, input: CreateTaskInput) => {
  const database = await getDb();
  const task = await database.createTask(input);
  startTaskRun(database, task);
  return database.getState();
});

ipcMain.handle('viral:create-and-run', async (_event, input: CreateViralAnalysisInput) => {
  const database = await getDb();
  const record = await database.createViralAnalysis({
    ...input,
    platform: input.platform && input.platform !== 'unknown' ? input.platform : detectViralPlatform(input.url),
  });
  startViralAnalysisRun(database, record);
  return database.getState();
});

ipcMain.handle('viral:update-status', async (_event, input: { id: string; status: ViralAnalysisStatus }) => {
  const database = await getDb();
  const state = await database.getState();
  const record = state.viralAnalyses.find((item) => item.id === input.id);
  if (!record) return state;
  if (input.status === 'running') {
    await resumeViralAnalysisRun(database, record);
    return database.getState();
  }
  if (input.status === 'paused' || input.status === 'cancelled') {
    runningViralAnalyses.get(input.id)?.abort(input.status === 'cancelled' ? '用户取消' : '用户暂停');
    await database.updateViralAnalysis(input.id, {
      status: input.status,
      errorMessage: input.status === 'cancelled' ? '用户取消' : record.errorMessage,
      lastHeartbeatAt: new Date().toISOString(),
    });
  }
  return database.getState();
});

ipcMain.handle('viral:retry', async (_event, id: string) => {
  const database = await getDb();
  const state = await database.getState();
  const record = state.viralAnalyses.find((item) => item.id === id);
  if (record) await resumeViralAnalysisRun(database, record);
  return database.getState();
});

ipcMain.handle('viral:get-result', async (_event, id: string) => {
  const database = await getDb();
  const state = await database.getState();
  const record = state.viralAnalyses.find((item) => item.id === id);
  if (!record?.resultPath) throw new Error(`Viral analysis result is not available: ${id}`);
  return JSON.parse(await readFile(record.resultPath, 'utf8'));
});

ipcMain.handle('viral:create-production-task', async (_event, input: { id: string; options?: ViralProductionTaskOptions }) => {
  const database = await getDb();
  const state = await database.getState();
  const record = state.viralAnalyses.find((item) => item.id === input.id);
  if (!record?.resultPath) throw new Error(`Viral analysis result is not available: ${input.id}`);
  const result = JSON.parse(await readFile(record.resultPath, 'utf8'));
  const taskInput = createViralProductionTaskInput(result, input.options);
  const task = await database.createTask(taskInput);
  startTaskRun(database, task);
  return database.getState();
});

ipcMain.handle('task:update-status', async (_event, input: { id: string; status: TaskStatus }) => {
  const database = await getDb();
  const state = await database.getState();
  const task = state.tasks.find((item) => item.id === input.id);
  if (!task) return state;
  if (input.status === 'running') {
    await resumeTaskRun(database, task);
    return database.getState();
  }
  if (input.status === 'paused' || input.status === 'cancelled') {
    const existingRun = runningTasks.get(input.id);
    if (existingRun) {
      existingRun.restartAfterAbort = false;
      existingRun.controller.abort(input.status === 'cancelled' ? '用户取消' : '用户暂停');
    }
    await database.updateTask(input.id, {
      status: input.status,
      errorMessage: input.status === 'cancelled' ? '用户取消' : task.errorMessage,
      failedStep: input.status === 'paused' ? task.failedStep ?? task.currentStep : task.failedStep,
      retryFromStep: input.status === 'paused' ? task.retryFromStep ?? task.currentStep : task.retryFromStep,
      lastHeartbeatAt: new Date().toISOString(),
    });
  }
  return database.getState();
});

ipcMain.handle('task:retry', async (_event, id: string) => {
  const database = await getDb();
  const state = await database.getState();
  const task = state.tasks.find((item) => item.id === id);
  if (task) {
    await resumeTaskRun(database, task);
  }
  return database.getState();
});

ipcMain.handle('task:regenerate-image', async (_event, input: { id: string; sceneId: number }) => {
  const database = await getDb();
  const state = await database.getState();
  const task = state.tasks.find((item) => item.id === input.id);
  if (!task) {
    throw new Error(`Task not found: ${input.id}`);
  }
  if (!task.artifactStatePath) {
    throw new Error('Task artifact state is not available; run the task before regenerating images.');
  }

  const sceneId = Number(input.sceneId);
  await markSceneImageForRegeneration(task.artifactStatePath, sceneId);
  await database.updateTask(task.id, {
    status: 'pending',
    currentStep: 4,
    failedStep: 4,
    retryFromStep: 4,
    completedAt: null,
    outputDir: taskWorkDir(task),
    errorMessage: `重新生成第 ${sceneId} 张图片`,
    lastHeartbeatAt: new Date().toISOString(),
  });
  await database.addTaskEvent(task.id, {
    type: 'step_start',
    step: 4,
    agent: 'Producer',
    detail: `重新生成第 ${sceneId} 张图片`,
    dataJson: JSON.stringify({ sceneId }),
  });
  const updatedTask = (await database.getState()).tasks.find((item) => item.id === task.id);
  if (updatedTask) {
    await resumeTaskRun(database, updatedTask);
  }
  return database.getState();
});

ipcMain.handle('task:regenerate-narration', async (_event, input: { id: string; sceneId: number }) => {
  const database = await getDb();
  const state = await database.getState();
  const task = state.tasks.find((item) => item.id === input.id);
  if (!task) {
    throw new Error(`Task not found: ${input.id}`);
  }
  if (!task.artifactStatePath) {
    throw new Error('Task artifact state is not available; run the task before regenerating narration.');
  }

  const sceneId = Number(input.sceneId);
  await markSceneNarrationForRegeneration(task.artifactStatePath, sceneId);
  await database.updateTask(task.id, {
    status: 'pending',
    currentStep: 5,
    failedStep: 5,
    retryFromStep: 5,
    completedAt: null,
    outputDir: taskWorkDir(task),
    errorMessage: `重新生成第 ${sceneId} 段配音`,
    lastHeartbeatAt: new Date().toISOString(),
  });
  await database.addTaskEvent(task.id, {
    type: 'step_start',
    step: 5,
    agent: 'TTS',
    detail: `重新生成第 ${sceneId} 段配音`,
    dataJson: JSON.stringify({ sceneId }),
  });
  const updatedTask = (await database.getState()).tasks.find((item) => item.id === task.id);
  if (updatedTask) {
    await resumeTaskRun(database, updatedTask);
  }
  return database.getState();
});

ipcMain.handle('task:update-image-prompt', async (_event, input: { id: string; sceneId: number; prompt: string }) => {
  const database = await getDb();
  const state = await database.getState();
  const task = state.tasks.find((item) => item.id === input.id);
  if (!task) {
    throw new Error(`Task not found: ${input.id}`);
  }
  if (!task.artifactStatePath) {
    throw new Error('Task artifact state is not available; run the task before editing image prompts.');
  }

  const sceneId = Number(input.sceneId);
  const result = await updateSceneImagePrompt(task.artifactStatePath, sceneId, input.prompt);
  await database.addTaskEvent(task.id, {
    type: 'prompt_update',
    step: 3,
    agent: 'Prompt',
    detail: `已修改第 ${sceneId} 张图片提示词`,
    dataJson: JSON.stringify({ sceneId, promptLength: result.updatedPrompt.prompt.length }),
  });
  return database.getState();
});

ipcMain.handle('task:rerun-step', async (_event, input: { id: string; step: number; mode: TaskStepRerunMode }) => {
  const database = await getDb();
  const state = await database.getState();
  const task = state.tasks.find((item) => item.id === input.id);
  if (!task) {
    throw new Error(`Task not found: ${input.id}`);
  }
  if (!task.artifactStatePath) {
    throw new Error('Task artifact state is not available; run the task before rerunning a step.');
  }

  const step = Number(input.step);
  const result = await markTaskStepForRerun(task.artifactStatePath, step, input.mode);
  const detail = result.mode === 'rewrite' ? `改写第 ${step + 1} 步后继续` : `重新生成第 ${step + 1} 步后继续`;
  await database.updateTask(task.id, {
    status: 'pending',
    currentStep: step,
    failedStep: step,
    retryFromStep: step,
    completedAt: null,
    outputDir: taskWorkDir(task),
    errorMessage: detail,
    lastHeartbeatAt: new Date().toISOString(),
  });
  await database.addTaskEvent(task.id, {
    type: 'step_start',
    step,
    agent: pipelineStepAgents[step] ?? null,
    detail,
    dataJson: JSON.stringify({ step, mode: result.mode, clearedSteps: result.clearedSteps }),
  });
  const updatedTask = (await database.getState()).tasks.find((item) => item.id === task.id);
  if (updatedTask) {
    await resumeTaskRun(database, updatedTask);
  }
  return database.getState();
});

ipcMain.handle('task:get-artifacts', async (_event, id: string) => {
  const database = await getDb();
  const state = await database.getState();
  const task = state.tasks.find((item) => item.id === id);
  if (!task) {
    throw new Error(`Task not found: ${id}`);
  }
  return readTaskArtifactSnapshot(task);
});

ipcMain.handle('asset:read-data-url', async (_event, path: string) => readLocalImageDataUrl(path));

ipcMain.handle('local-image:select', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择背景图',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
});

async function selectLocalFolder(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: '选择剪映草稿目录',
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
}

async function selectLocalAudio(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: '选择 BGM 音频',
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] }],
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
}

async function selectCookieFile(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: '选择 Cookie 文件',
    properties: ['openFile'],
    filters: [
      { name: 'Cookie files', extensions: ['txt', 'cookies'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
}

function netscapeCookieLine(cookie: Cookie): string {
  const domain = cookie.domain || '.douyin.com';
  const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
  const path = cookie.path || '/';
  const secure = cookie.secure ? 'TRUE' : 'FALSE';
  const expires = Number.isFinite(cookie.expirationDate ?? NaN) ? Math.floor(cookie.expirationDate ?? 0) : 0;
  return [domain, includeSubdomains, path, secure, expires, cookie.name, cookie.value].join('\t');
}

async function exportDouyinLoginCookies(win: BrowserWindow): Promise<string> {
  await mkdir(viralCookieDir(), { recursive: true });
  const allCookies = await win.webContents.session.cookies.get({});
  const cookies = allCookies.filter((cookie) => {
    const domain = (cookie.domain || '').toLowerCase();
    return domain.includes('douyin.com') || domain.includes('iesdouyin.com') || domain.includes('amemv.com');
  });
  const lines = ['# Netscape HTTP Cookie File', ...cookies.map(netscapeCookieLine)];
  const outputPath = viralCookieFilePath();
  await writeFile(outputPath, `${lines.join('\n')}\n`, 'utf8');
  const database = await getDb();
  const state = await database.getState();
  const updatedConfig: AppConfig = {
    ...state.config,
    viral: {
      ...state.config.viral,
      cookieFilePath: outputPath,
      cookieFallbackMode: 'browser-first-after-failure',
    },
  };
  await database.upsertConfig(updatedConfig);
  await saveConfigToFile(appDataDir(), updatedConfig);
  await sendTaskState(database);
  return outputPath;
}

async function openViralLoginWindow(): Promise<string | null> {
  if (viralLoginWindow && !viralLoginWindow.isDestroyed()) {
    viralLoginWindow.focus();
    return null;
  }

  return new Promise<string | null>((resolve) => {
    let settled = false;
    let exportingCookies = false;
    function settle(cookiePath: string | null) {
      if (settled) return;
      settled = true;
      resolve(cookiePath);
    }

    const loginWindow = new BrowserWindow({
      width: 1100,
      height: 760,
      title: '抖音登录',
      autoHideMenuBar: true,
      webPreferences: {
        partition: 'persist:storydream-viral-douyin',
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    viralLoginWindow = loginWindow;
    loginWindow.on('closed', () => {
      if (viralLoginWindow === loginWindow) viralLoginWindow = null;
      settle(null);
    });
    loginWindow.on('close', (event) => {
      if (loginWindow.isDestroyed()) return;
      event.preventDefault();
      if (exportingCookies) return;
      exportingCookies = true;
      void exportDouyinLoginCookies(loginWindow)
        .then((cookiePath) => {
          settle(cookiePath);
        })
        .catch((error) => {
          console.error('Failed to export Douyin cookies', error);
          settle(null);
        })
        .finally(() => {
          if (!loginWindow.isDestroyed()) loginWindow.destroy();
        });
    });
    void loginWindow.loadURL('https://www.douyin.com/').catch((error) => {
      console.error('Failed to open Douyin login window', error);
      settle(null);
      if (!loginWindow.isDestroyed()) loginWindow.destroy();
    });
  });
}

ipcMain.handle('local-audio:select', selectLocalAudio);
ipcMain.handle('local-folder:select', selectLocalFolder);
ipcMain.handle('cookie-file:select', selectCookieFile);
ipcMain.handle('viral:open-login-window', openViralLoginWindow);

ipcMain.handle('jianying:effect-catalog', async () => loadJianyingEffectCatalog());
ipcMain.handle('jianying:draft-path:detect', async () => detectJianyingDraftPath({ pathExists: existsSync }));

ipcMain.handle('diagnostics:run', async () => {
  const database = await getDb();
  const state = await database.getState();
  const python = await checkPython();
  const pyJianYingDraft = python.status === 'pass' ? await checkPyJianYingDraft() : { status: 'warn' as const, detail: 'Python unavailable; cannot check pyJianYingDraft.' };
  const storyboundSidecar =
    python.status === 'pass'
      ? await checkStoryboundSidecarDependencies()
      : { status: 'warn' as const, detail: 'Python unavailable; cannot check Storybound sidecar dependencies.' };
  return {
    generatedAt: new Date().toISOString(),
    checks: [
      { id: 'llm-config', label: 'LLM 配置完整性', status: state.config.llm.apiKey ? 'pass' : 'warn', detail: `${state.config.llm.baseUrl} · ${state.config.llm.model}` },
      { id: 'image-config', label: '图片供应商配置', status: imageConfigStatus(state.config), detail: state.config.imageProvider },
      { id: 'tts-config', label: 'TTS 凭证', status: ttsConfigStatus(state.config), detail: state.config.tts.provider },
      { id: 'draft-dir', label: '剪映草稿目录', status: state.config.jianying.draftPath ? 'pass' : 'warn', detail: state.config.jianying.draftPath || '未配置' },
      { id: 'python', label: 'Python 运行时', status: python.status, detail: python.detail },
      { id: 'pyjianyingdraft', label: 'pyJianYingDraft', status: pyJianYingDraft.status, detail: pyJianYingDraft.detail },
      { id: 'storybound-sidecar', label: 'Storybound sidecar', status: storyboundSidecar.status, detail: storyboundSidecar.detail },
      { id: 'local-db', label: '数据目录写入权限', status: 'pass', detail: app.getPath('userData') },
      { id: 'account-state', label: '账号状态', status: 'pass', detail: state.activation.message },
    ],
  };
});

ipcMain.handle('path:open', async (_event, path: string) => {
  await shell.openPath(path);
});

async function readLocalImageDataUrl(path: string): Promise<string> {
  if (!path || !path.trim()) {
    throw new Error('Preview image path is required.');
  }
  const mime = previewImageMimeType(path);
  if (!mime) {
    throw new Error(`Unsupported preview image extension: ${extname(path) || '(none)'}`);
  }
  const bytes = await readFile(path);
  if (mime.startsWith('image/')) {
    return `data:image/${mime.replace('image/', '')};base64,${bytes.toString('base64')}`;
  }
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

function previewImageMimeType(path: string): string | null {
  const extension = extname(path).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.mp3') return 'audio/mpeg';
  if (extension === '.wav') return 'audio/wav';
  if (extension === '.m4a') return 'audio/mp4';
  if (extension === '.aac') return 'audio/aac';
  if (extension === '.ogg') return 'audio/ogg';
  if (extension === '.flac') return 'audio/flac';
  return null;
}

function imageConfigStatus(config: AppConfig): 'pass' | 'warn' | 'fail' {
  if (config.imageProvider === 'mock') return 'fail';
  if (config.imageProvider === 'jimeng') return config.jimeng.accessKeyId && config.jimeng.secretAccessKey && config.jimeng.reqKey ? 'pass' : 'warn';
  if (config.imageProvider === 'custom') return config.customImage.apiKey && config.customImage.baseUrl ? 'pass' : 'warn';
  return config.gptImage.apiKey || config.image.apiKey ? 'pass' : 'warn';
}

function ttsConfigStatus(config: AppConfig): 'pass' | 'warn' | 'fail' {
  if (config.tts.provider === 'mock') return 'fail';
  if (config.tts.provider === 'minimax') return config.tts.minimax.apiKey ? 'pass' : 'warn';
  if (config.tts.volcengine.apiKey) return 'pass';
  return (config.tts.volcengine.appId || config.tts.appId) && (config.tts.volcengine.accessKey || config.tts.accessKey) ? 'pass' : 'warn';
}

async function checkPython(): Promise<{ status: 'pass' | 'warn'; detail: string }> {
  const runtime = resolvePythonRuntimeInfo();
  try {
    const { stdout, stderr } = await execFileAsync(runtime.command, ['--version']);
    const version = (stdout || stderr).trim() || 'python available';
    return { status: 'pass', detail: `${runtime.source} ${version}` };
  } catch (error) {
    return { status: 'warn', detail: error instanceof Error ? error.message : 'python not found' };
  }
}

function normalizeGeneratedCustomStyle(input: CustomStyleGenerateInput, generated: Partial<CustomStyle>): CustomStyle {
  const now = new Date().toISOString();
  const fallbackName = input.prompt.trim().slice(0, 16) || input.baseStyle.name;
  return {
    id: input.baseStyle.id,
    name: String(generated.name || fallbackName),
    tag: String(generated.tag || input.baseStyle.tag),
    shortName: String(generated.shortName || fallbackName.slice(0, 4)),
    prefix: String(generated.prefix || input.baseStyle.prefix),
    suffix: String(generated.suffix || input.baseStyle.suffix),
    negativePrompt: String(generated.negativePrompt || input.baseStyle.negativePrompt),
    allowColor: typeof generated.allowColor === 'boolean' ? generated.allowColor : input.baseStyle.allowColor,
    description: String(generated.description || input.baseStyle.description),
    createdAt: input.baseStyle.createdAt || now,
    updatedAt: now,
  };
}

async function checkPyJianYingDraft(): Promise<{ status: 'pass' | 'warn'; detail: string }> {
  const runtime = resolvePythonRuntimeInfo();
  try {
    await execFileAsync(runtime.command, ['-c', 'import pyJianYingDraft; print("pyJianYingDraft installed")']);
    return { status: 'pass', detail: `pyJianYingDraft installed in ${runtime.source} Python` };
  } catch {
    return { status: 'warn', detail: runtime.source === 'bundled' ? 'Bundled pyJianYingDraft is unavailable; rebuild the portable Python runtime.' : '未检测到 pyJianYingDraft；请运行 python -m pip install pyJianYingDraft' };
  }
}

async function checkStoryboundSidecarDependencies(): Promise<{ status: 'pass' | 'warn'; detail: string }> {
  const runtime = resolvePythonRuntimeInfo();
  try {
    await execFileAsync(runtime.command, ['-c', 'import pyJianYingDraft, imageio_ffmpeg, pydub, jieba; print("Storybound sidecar dependencies installed")']);
    return { status: 'pass', detail: `Storybound sidecar dependencies installed in ${runtime.source} Python` };
  } catch {
    return {
      status: 'warn',
      detail:
        runtime.source === 'bundled'
          ? 'Bundled Storybound sidecar dependencies are unavailable; rebuild the portable Python runtime.'
          : '未检测到 Storybound sidecar 依赖；请安装 pyJianYingDraft、imageio-ffmpeg、pydub、jieba',
    };
  }
}

app.whenReady().then(() => {
  setDefaultPythonRuntimeAppRoot(app.getAppPath());
  return createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  if (db) {
    await db.close();
    db = null;
  }
});
