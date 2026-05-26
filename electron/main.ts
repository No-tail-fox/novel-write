import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { FileDatabase } from '../src/shared/storage';
import { runTask } from '../src/shared/runner';
import type { AccountProfile, ActivationState, AppConfig, CreateTaskInput, DraftTemplate, PromptTemplate, TaskStatus, UiPreferences } from '../src/shared/types';
import { getRendererIndexPath } from './paths';

const __dirname = dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let db: FileDatabase | null = null;

async function getDb(): Promise<FileDatabase> {
  if (db) {
    return db;
  }
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

ipcMain.handle('app:get-state', async () => {
  const database = await getDb();
  return database.getState();
});

ipcMain.handle('app:save-config', async (_event, config) => {
  const database = await getDb();
  await database.upsertConfig(config as AppConfig);
  return database.getState();
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
  await runTask(database, task, {
    appDataDir: join(app.getPath('userData'), 'storybound-replica'),
    onEvent: (detail) => mainWindow?.webContents.send('task:event', detail),
  });
  return database.getState();
});

ipcMain.handle('task:update-status', async (_event, input: { id: string; status: TaskStatus }) => {
  const database = await getDb();
  await database.updateTask(input.id, { status: input.status, errorMessage: input.status === 'cancelled' ? '用户取消' : '' });
  return database.getState();
});

ipcMain.handle('task:retry', async (_event, id: string) => {
  const database = await getDb();
  const state = await database.getState();
  const task = state.tasks.find((item) => item.id === id);
  if (task) {
    await database.updateTask(id, { status: 'pending', errorMessage: '' });
    await runTask(database, { ...task, status: 'pending', errorMessage: '' }, {
      appDataDir: join(app.getPath('userData'), 'storybound-replica'),
      onEvent: (detail) => mainWindow?.webContents.send('task:event', detail),
    });
  }
  return database.getState();
});

ipcMain.handle('diagnostics:run', async () => {
  const database = await getDb();
  const state = await database.getState();
  return {
    generatedAt: new Date().toISOString(),
    checks: [
      { id: 'llm-config', label: 'LLM 配置完整性', status: state.config.llm.apiKey ? 'pass' : 'warn', detail: state.config.llm.model },
      { id: 'tts-config', label: 'TTS 凭证', status: state.config.tts.accessKey ? 'pass' : 'warn', detail: state.config.tts.provider },
      { id: 'draft-dir', label: '剪映草稿目录', status: state.config.jianying.draftPath ? 'pass' : 'warn', detail: state.config.jianying.draftPath || '未配置' },
      { id: 'local-db', label: '数据目录写入权限', status: 'pass', detail: app.getPath('userData') },
      { id: 'account-state', label: '账号状态', status: 'pass', detail: state.activation.message },
    ],
  };
});

ipcMain.handle('path:open', async (_event, path: string) => {
  await shell.openPath(path);
});

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
