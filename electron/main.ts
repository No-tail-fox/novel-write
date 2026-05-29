import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { readTaskArtifactSnapshot } from '../src/shared/artifact-preview';
import { fromLlmModelTestResult, testConfigTarget } from '../src/shared/config-utils';
import { generateImageLabRecord } from '../src/shared/image-lab';
import { createOpenAiCompatibleJsonLlm, listOpenAiCompatibleModels, testOpenAiCompatibleLlm } from '../src/shared/llm-provider';
import { markSceneImageForRegeneration, markSceneNarrationForRegeneration } from '../src/shared/pipeline-cache';
import { composeCopyFromSources, createAiSourceResearcher, searchWebSources } from '../src/shared/research';
import { runTask } from '../src/shared/runner';
import { FileDatabase } from '../src/shared/storage';
import { createTaskRuntimeProviders } from '../src/shared/task-runtime-providers';
import type { AccountProfile, ActivationState, AppConfig, ConfigTestTarget, CreateTaskInput, DraftTemplate, ImageLabGenerateInput, LlmConfig, PromptTemplate, ProviderModelListRequest, ResearchCopyComposeInput, Task, TaskStatus, UiPreferences, VolcengineSpeakerListRequest } from '../src/shared/types';
import { listVolcengineSpeakers } from '../src/shared/volcengine-speakers';
import { getRendererIndexPath } from './paths';

const __dirname = dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
let mainWindow: BrowserWindow | null = null;
let db: FileDatabase | null = null;
interface RunningTaskRun {
  controller: AbortController;
  restartAfterAbort: boolean;
}

const runningTasks = new Map<string, RunningTaskRun>();
const staleRunningMs = 5 * 60 * 1000;

async function getDb(): Promise<FileDatabase> {
  if (db) return db;
  const dataDir = join(app.getPath('userData'), 'storybound-replica');
  await mkdir(dataDir, { recursive: true });
  db = await FileDatabase.open(join(dataDir, 'data.db'));
  return db;
}

async function createWindow(): Promise<void> {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1080,
    minHeight: 720,
    title: 'Storybound Replica',
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
  return join(app.getPath('userData'), 'storybound-replica', 'tasks', task.id);
}

function imageLabWorkDir(id: string): string {
  return join(app.getPath('userData'), 'storybound-replica', 'image-lab', id);
}

function appDataDir(): string {
  return join(app.getPath('userData'), 'storybound-replica');
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
    ...createTaskRuntimeProviders(state.config, taskWorkDir(task)),
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
  return database.getState();
});

ipcMain.handle('llm:test-config', async (_event, config: LlmConfig) => testOpenAiCompatibleLlm(config));

ipcMain.handle('models:list', async (_event, request: ProviderModelListRequest) => listOpenAiCompatibleModels(request));

ipcMain.handle('volcengine:speakers:list', async (_event, request: VolcengineSpeakerListRequest) => listVolcengineSpeakers(request));

ipcMain.handle('config:test', async (_event, input: { target: ConfigTestTarget; config: AppConfig }) => {
  if (input.target === 'llm') {
    return fromLlmModelTestResult(await testOpenAiCompatibleLlm(input.config.llm));
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
  return composeCopyFromSources(createOpenAiCompatibleJsonLlm(state.config.llm), input);
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

ipcMain.handle('task:create-and-run', async (_event, input: CreateTaskInput) => {
  const database = await getDb();
  const task = await database.createTask(input);
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

ipcMain.handle('diagnostics:run', async () => {
  const database = await getDb();
  const state = await database.getState();
  const python = await checkPython();
  const pyJianYingDraft = python.status === 'pass' ? await checkPyJianYingDraft() : { status: 'warn' as const, detail: 'Python unavailable; cannot check pyJianYingDraft.' };
  return {
    generatedAt: new Date().toISOString(),
    checks: [
      { id: 'llm-config', label: 'LLM 配置完整性', status: state.config.llm.apiKey ? 'pass' : 'warn', detail: `${state.config.llm.baseUrl} · ${state.config.llm.model}` },
      { id: 'image-config', label: '图片供应商配置', status: imageConfigStatus(state.config), detail: state.config.imageProvider },
      { id: 'tts-config', label: 'TTS 凭证', status: ttsConfigStatus(state.config), detail: state.config.tts.provider },
      { id: 'draft-dir', label: '剪映草稿目录', status: state.config.jianying.draftPath ? 'pass' : 'warn', detail: state.config.jianying.draftPath || '未配置' },
      { id: 'python', label: 'Python 运行时', status: python.status, detail: python.detail },
      { id: 'pyjianyingdraft', label: 'pyJianYingDraft', status: pyJianYingDraft.status, detail: pyJianYingDraft.detail },
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
  if (config.tts.volcengine.apiKey) return config.tts.volcengine.resourceId && (config.tts.volcengine.speaker || config.tts.speaker) ? 'pass' : 'warn';
  return (config.tts.volcengine.appId || config.tts.appId) && (config.tts.volcengine.accessKey || config.tts.accessKey) ? 'pass' : 'warn';
}

async function checkPython(): Promise<{ status: 'pass' | 'warn'; detail: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('python', ['--version']);
    return { status: 'pass', detail: (stdout || stderr).trim() || 'python available' };
  } catch (error) {
    return { status: 'warn', detail: error instanceof Error ? error.message : 'python not found' };
  }
}

async function checkPyJianYingDraft(): Promise<{ status: 'pass' | 'warn'; detail: string }> {
  try {
    await execFileAsync('python', ['-c', 'import pyJianYingDraft; print("pyJianYingDraft installed")']);
    return { status: 'pass', detail: 'pyJianYingDraft installed' };
  } catch {
    return { status: 'warn', detail: '未检测到 pyJianYingDraft；请运行 python -m pip install pyJianYingDraft' };
  }
}

app.whenReady().then(createWindow);

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
