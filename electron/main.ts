import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { readTaskArtifactSnapshot } from '../src/shared/artifact-preview';
import { fromLlmModelTestResult, validateConfigTarget } from '../src/shared/config-utils';
import { createOpenAiCompatibleJsonLlm, listOpenAiCompatibleModels, testOpenAiCompatibleLlm } from '../src/shared/llm-provider';
import { composeCopyFromSources, createAiSourceResearcher, searchWebSources } from '../src/shared/research';
import { runTask } from '../src/shared/runner';
import { FileDatabase } from '../src/shared/storage';
import { createTaskRuntimeProviders } from '../src/shared/task-runtime-providers';
import type { AccountProfile, ActivationState, AppConfig, ConfigTestTarget, CreateTaskInput, DraftTemplate, LlmConfig, PromptTemplate, ProviderModelListRequest, ResearchCopyComposeInput, TaskStatus, UiPreferences } from '../src/shared/types';
import { getRendererIndexPath } from './paths';

const __dirname = dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
let mainWindow: BrowserWindow | null = null;
let db: FileDatabase | null = null;

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
}

async function sendTaskState(database: FileDatabase): Promise<void> {
  const state = await database.getState();
  mainWindow?.webContents.send('task:event', state);
}

function notifyTaskState(database: FileDatabase): void {
  void sendTaskState(database);
}

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

ipcMain.handle('config:test', async (_event, input: { target: ConfigTestTarget; config: AppConfig }) => {
  if (input.target === 'llm') {
    return fromLlmModelTestResult(await testOpenAiCompatibleLlm(input.config.llm));
  }
  return validateConfigTarget(input.target, input.config, { pathExists: existsSync });
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
  const state = await database.getState();
  const taskWorkDir = join(app.getPath('userData'), 'storybound-replica', 'tasks', task.id);
  void runTask(database, task, {
    appDataDir: join(app.getPath('userData'), 'storybound-replica'),
    resolveAiSourceContext: createAiSourceResearcher(state.config),
    ...createTaskRuntimeProviders(state.config, taskWorkDir),
    onEvent: () => {
      notifyTaskState(database);
    },
  }).catch((error) => {
    console.error('Background task failed', error);
  });
  return database.getState();
});

ipcMain.handle('task:update-status', async (_event, input: { id: string; status: TaskStatus }) => {
  const database = await getDb();
  await database.updateTask(input.id, {
    status: input.status,
    errorMessage: input.status === 'cancelled' ? '用户取消' : '',
  });
  return database.getState();
});

ipcMain.handle('task:retry', async (_event, id: string) => {
  const database = await getDb();
  const state = await database.getState();
  const task = state.tasks.find((item) => item.id === id);
  if (task) {
    await database.updateTask(id, { status: 'pending', errorMessage: '' });
    const taskWorkDir = join(app.getPath('userData'), 'storybound-replica', 'tasks', task.id);
    await runTask(database, { ...task, status: 'pending', errorMessage: '' }, {
      appDataDir: join(app.getPath('userData'), 'storybound-replica'),
      resolveAiSourceContext: createAiSourceResearcher(state.config),
      ...createTaskRuntimeProviders(state.config, taskWorkDir),
      onEvent: () => {
        notifyTaskState(database);
      },
    });
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

function imageConfigStatus(config: AppConfig): 'pass' | 'warn' | 'fail' {
  if (config.imageProvider === 'mock') return 'fail';
  if (config.imageProvider === 'jimeng') return config.jimeng.accessKeyId && config.jimeng.secretAccessKey && config.jimeng.reqKey ? 'pass' : 'warn';
  if (config.imageProvider === 'custom') return config.customImage.apiKey && config.customImage.baseUrl ? 'pass' : 'warn';
  return config.gptImage.apiKey || config.image.apiKey ? 'pass' : 'warn';
}

function ttsConfigStatus(config: AppConfig): 'pass' | 'warn' | 'fail' {
  if (config.tts.provider === 'mock') return 'fail';
  if (config.tts.provider === 'minimax') return config.tts.minimax.apiKey ? 'pass' : 'warn';
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
