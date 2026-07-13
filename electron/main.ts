import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, safeStorage, shell, type Cookie } from 'electron';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { readTaskArtifactSnapshot } from '../src/shared/artifact-preview';
import { isCancellation, normalizeAppError } from '../src/shared/app-error';
import { fromLlmModelTestResult, testConfigTarget } from '../src/shared/config-utils';
import { generateImageLabRecord } from '../src/shared/image-lab';
import { detectJianyingDraftPath, resolveRuntimeJianyingDraftPath } from '../src/shared/jianying-paths';
import { loadJianyingEffectCatalog } from '../src/shared/jianying-effects';
import { runHtmlVideoPipeline, synchronizeHtmlVideoPipelineCheckpoint } from '../src/shared/html-video-runner';
import { htmlVideoVisibleSteps, isHtmlVideoTask, parseHtmlVideoPipelineData, recoverHtmlVideoPipelineDataForRetry, type HtmlVideoPipelineRetryPatch } from '../src/shared/html-video-workflow';
import { generateConfiguredVoicePreview } from '../src/shared/media-providers';
import { createPersonAsset, deletePersonAsset, importPersonAssetFiles, listPersonAssets, listPersonImages, renamePersonAsset } from '../src/shared/person-assets';
import { createConfiguredJsonLlm, createConfiguredTextLlm, listConfiguredProviderModels, testConfiguredLlm } from '../src/shared/llm-provider';
import { markSceneImageForRegeneration, markSceneNarrationForRegeneration, markTaskStepForRerun, updateSceneImagePrompt } from '../src/shared/pipeline-cache';
import { resolvePythonRuntimeInfo, setDefaultPythonRuntimeAppRoot } from '../src/shared/python-runtime';
import { composeCopyFromSources, createAiSourceResearcher, searchWebSources } from '../src/shared/research';
import { runTask } from '../src/shared/runner';
import { runStoryboundMediaSidecar } from '../src/shared/storybound-sidecar';
import { FileDatabase } from '../src/shared/storage';
import { createHtmlVideoRuntimeProviders, createTaskRuntimeProviders } from '../src/shared/task-runtime-providers';
import type { AccountProfile, ActivationState, AppConfig, BookSelectionInput, ConfigTestTarget, CreateTaskInput, CreateViralAnalysisInput, CustomStyle, CustomStyleGenerateInput, DraftTemplate, HtmlVideoPipelineDataV2, ImageLabGenerateInput, LlmConfig, PromptTemplate, ProviderModelListRequest, ResearchCopyComposeInput, Task, TaskStatus, TaskStepRerunMode, UiPreferences, ViralAnalysisRecord, ViralAnalysisStatus, ViralProductionTaskOptions, VolcengineSpeakerListRequest, VoiceLabGenerateInput } from '../src/shared/types';
import { createViralProductionTaskInput, detectViralPlatform, runViralAnalysis } from '../src/shared/viral-analysis';
import { createViralRuntimeProviders } from '../src/shared/viral-runtime';
import { listVolcengineSpeakers } from '../src/shared/volcengine-speakers';
import { getRendererIndexPath } from './paths';
import {
  createElectronHtmlVideoRuntime,
  fetchHtmlVideoMediaResponse,
  createHtmlVideoMediaUrl,
  ensureHtmlVideoTaskWorkDir,
  htmlVideoMediaScheme,
  prepareHtmlVideoBgm,
  resolveHtmlVideoMediaUrl,
  type HtmlVideoMediaProbeResult,
} from './html-video-runtime';
import { createElectronHtmlVideoRenderer } from './html-video-renderer';
import { createTrustedIpcRegistrar } from './ipc';
import { ConfigService } from './config-service';
import { CredentialVault } from './credential-vault';
import {
  finalizeTaskRunIntent,
  requestTaskRunIntent,
  runLatestTaskControlRequest,
  stopTaskRunBeforeArtifactMutation,
  type TaskRunIntent,
  type TaskRunIntentState,
} from './task-run-lifecycle';
import {
  attachDouyinLoginSecurity,
  attachMainWindowSecurity,
  isAllowedDouyinCookieDomain,
  type RendererPolicy,
  validateDevServerUrl,
} from './security';

const __dirname = dirname(fileURLToPath(import.meta.url));
protocol.registerSchemesAsPrivileged([{
  scheme: htmlVideoMediaScheme,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
  },
}]);
const execFileAsync = promisify(execFile);
let mainWindow: BrowserWindow | null = null;
let viralLoginWindow: BrowserWindow | null = null;
let mainRendererPolicy: RendererPolicy | null = null;
let mainWindowPolicyInstalled = false;
let db: FileDatabase | null = null;
let configService: ConfigService | null = null;
interface RunningTaskRun extends TaskRunIntentState {
  completion: Promise<void>;
}

interface RunningViralAnalysisRun {
  controller: AbortController;
  completion: Promise<void>;
}

const runningTasks = new Map<string, RunningTaskRun>();
const latestTaskControlRequests = new Map<string, symbol>();
const runningViralAnalyses = new Map<string, RunningViralAnalysisRun>();
let isShuttingDown = false;
let shutdownComplete = false;
let shutdownPromise: Promise<void> | null = null;

interface SmokeConfig {
  outputPath: string;
  userDataPath: string;
}

interface SmokeReport {
  mainLoaded: boolean;
  preloadExposed: boolean;
  ipcStateLoaded: boolean;
  preloadActionSucceeded: boolean;
  windowPolicyInstalled: boolean;
  shellRendered: boolean;
}

const smokeConfig = resolveSmokeConfig();
if (smokeConfig) {
  app.setPath('userData', smokeConfig.userDataPath);
}
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) {
  app.quit();
}
if (isPrimaryInstance) {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  });
}

const trustedHandle = createTrustedIpcRegistrar({
  register: (channel, handler) => ipcMain.handle(channel, handler),
  getWindow: () => mainWindow,
  getPolicy: () => mainRendererPolicy,
});
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

function resolveSmokeConfig(): SmokeConfig | null {
  const output = process.env.STORYDREAM_SMOKE_OUTPUT?.trim() ?? '';
  const userData = process.env.STORYDREAM_SMOKE_USER_DATA?.trim() ?? '';
  if (!output && !userData) return null;
  if (!output || !userData) {
    throw new Error('Both STORYDREAM_SMOKE_OUTPUT and STORYDREAM_SMOKE_USER_DATA are required.');
  }
  if (output.length > 4096 || userData.length > 4096 || output.includes('\0') || userData.includes('\0')) {
    throw new Error('Electron smoke paths are invalid.');
  }
  if (!isAbsolute(output) || !isAbsolute(userData)) {
    throw new Error('Electron smoke paths must be absolute.');
  }
  const userDataPath = resolve(userData);
  const outputPath = resolve(output);
  const outputFromUserData = relative(userDataPath, outputPath);
  if (!outputFromUserData || outputFromUserData.startsWith('..') || isAbsolute(outputFromUserData)) {
    throw new Error('Electron smoke output must be a file inside the temporary userData directory.');
  }
  return { outputPath, userDataPath };
}

async function getDb(): Promise<FileDatabase> {
  if (db) return db;
  const dir = appDataDir();
  await mkdir(dir, { recursive: true });
  const database = await FileDatabase.open(join(dir, 'data.db'));
  const service = new ConfigService({
    database,
    dataDir: dir,
    vault: new CredentialVault(join(dir, 'secrets.v1.json'), {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (value) => safeStorage.encryptString(value),
      decryptString: (value) => safeStorage.decryptString(value),
    }),
  });
  try {
    await service.migrateLegacySecrets();
    await ensureRuntimeJianyingDraftPath(database, service);
  } catch (error) {
    await database.close().catch(() => undefined);
    throw error;
  }
  db = database;
  configService = service;
  return database;
}

async function getConfigService(): Promise<ConfigService> {
  await getDb();
  if (!configService) throw new Error('CONFIG_SERVICE_UNAVAILABLE: Configuration service is not initialized.');
  return configService;
}

async function getPublicState() {
  return (await getConfigService()).getPublicState();
}

async function ensureRuntimeJianyingDraftPath(database: FileDatabase, service: ConfigService): Promise<void> {
  const state = await database.getState();
  const current = state.config.jianying.draftPath;
  const resolved = resolveRuntimeJianyingDraftPath(current, { pathExists: existsSync });
  if (resolved !== current.trim()) {
    await service.save({
      config: {
        ...state.config,
        jianying: {
          ...state.config.jianying,
          draftPath: resolved,
        },
      },
      secretChanges: {},
    });
  }
}

async function createWindow(): Promise<void> {
  const configuredDevUrl = process.env.VITE_DEV_SERVER_URL ?? (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:5173' : '');
  const rendererIndexPath = getRendererIndexPath(__dirname);
  mainRendererPolicy = configuredDevUrl
    ? { mode: 'development', entryUrl: validateDevServerUrl(configuredDevUrl) }
    : { mode: 'production', entryUrl: pathToFileURL(rendererIndexPath).toString() };
  const rendererPolicy = mainRendererPolicy;

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
      sandbox: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  attachMainWindowSecurity(mainWindow, rendererPolicy);
  mainWindowPolicyInstalled = true;

  if (rendererPolicy.mode === 'development') {
    await mainWindow.loadURL(rendererPolicy.entryUrl);
  } else {
    await mainWindow.loadFile(rendererIndexPath);
  }
  const database = await getDb();
  await pauseStaleRunningTasks(database);
  await sendTaskState(database);
}

async function runSmokeHandshake(): Promise<void> {
  if (!smokeConfig) return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('Electron smoke main window is unavailable.');
  }

  const rendererResult = await mainWindow.webContents.executeJavaScript(`(async () => {
    const waitForShell = () => new Promise((resolve) => {
      const deadline = Date.now() + 10000;
      const check = () => {
        if (document.querySelector('.app-shell') || Date.now() >= deadline) resolve(undefined);
        else setTimeout(check, 50);
      };
      check();
    });
    await waitForShell();
    const api = window.storydream;
    const base = {
      preloadExposed: Boolean(api),
      ipcStateLoaded: false,
      preloadActionSucceeded: false,
      shellRendered: Boolean(document.querySelector('.app-shell')) && document.body.innerText.includes('StoryDream'),
    };
    if (!api) return base;
    try {
      const state = await api.getState();
      base.ipcStateLoaded = Boolean(state && state.config && Array.isArray(state.tasks));
      if (state && state.ui) {
        const saved = await api.saveUiPreferences({ ...state.ui, activeView: 'new-task' });
        base.preloadActionSucceeded = saved?.ui?.activeView === 'new-task';
      }
    } catch {
      return base;
    }
    return base;
  })()`, true) as Pick<SmokeReport, 'preloadExposed' | 'ipcStateLoaded' | 'preloadActionSucceeded' | 'shellRendered'>;

  const report: SmokeReport = {
    mainLoaded: true,
    preloadExposed: rendererResult.preloadExposed === true,
    ipcStateLoaded: rendererResult.ipcStateLoaded === true,
    preloadActionSucceeded: rendererResult.preloadActionSucceeded === true,
    windowPolicyInstalled: mainWindowPolicyInstalled,
    shellRendered: rendererResult.shellRendered === true,
  };
  await writeFile(smokeConfig.outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  mainWindow.close();
  if (process.platform === 'darwin') app.quit();
}

async function sendTaskState(database: FileDatabase): Promise<void> {
  void database;
  const state = await getPublicState();
  mainWindow?.webContents.send('task:event', state);
}

function notifyTaskState(database: FileDatabase): void {
  void sendTaskState(database);
}

function taskWorkDir(task: Pick<Task, 'id'>): string {
  return join(app.getPath('userData'), appDataName, 'tasks', task.id);
}

function htmlVideoTaskDirectory(taskId: string) {
  return ensureHtmlVideoTaskWorkDir(app.getPath('userData'), appDataName, taskId);
}

function registerHtmlVideoMediaProtocol(): void {
  protocol.handle(htmlVideoMediaScheme, async (request) => {
    try {
      return await fetchHtmlVideoMediaResponse(
        request.url,
        htmlVideoTaskDirectory,
        (mediaPath) => net.fetch(pathToFileURL(mediaPath).toString(), { headers: request.headers }),
      );
    } catch {
      return new Response(null, { status: 404 });
    }
  });
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
  const [state, runtimeConfig] = await Promise.all([database.getState(), (await getConfigService()).getRuntimeConfig()]);
  return {
    appDataDir: appDataDir(),
    signal: controller.signal,
    resolveAiSourceContext: createAiSourceResearcher(runtimeConfig),
    ...createTaskRuntimeProviders(runtimeConfig, taskWorkDir(task), task),
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
  if (isShuttingDown || runningTasks.has(task.id)) return false;
  return isHtmlVideoTask(task)
    ? startHtmlVideoTaskRun(database, task)
    : startStandardTaskRun(database, task);
}

function startStandardTaskRun(database: FileDatabase, task: Task): boolean {
  return startOwnedTaskRun(database, task, 'Background task', async (controller) => {
    await runTask(database, { ...task, status: 'pending', errorMessage: '' }, await buildRunOptions(database, task, controller));
  });
}

function startHtmlVideoTaskRun(database: FileDatabase, task: Task): boolean {
  const recovery = recoverHtmlVideoPipelineDataForRetry(task);
  const runnableTask = recovery ? { ...task, ...recovery } : task;
  return startOwnedTaskRun(database, task, 'HTML video task', async (controller) => {
    await runHtmlVideoTask(database, runnableTask, controller, recovery);
  });
}

function startOwnedTaskRun(
  database: FileDatabase,
  task: Task,
  label: string,
  execute: (controller: AbortController) => Promise<void>,
): boolean {
  const controller = new AbortController();
  const run: RunningTaskRun = {
    controller,
    intent: null,
    completion: Promise.resolve(),
  };
  runningTasks.set(task.id, run);
  run.completion = (async () => {
    try {
      await execute(controller);
    } catch (error) {
      console.error(`${label} failed`, error);
    } finally {
      const currentRun = runningTasks.get(task.id);
      let restartTask: Task | null = null;
      try {
        if (!isShuttingDown && currentRun === run) {
          const finalized = await finalizeTaskRunIntent(run, async (intent) => {
            return applyTaskRunIntent(database, task.id, intent);
          });
          if (finalized?.intent === 'restart') restartTask = finalized.result;
        }
      } finally {
        if (runningTasks.get(task.id) === run) runningTasks.delete(task.id);
      }
      if (restartTask && !isShuttingDown) startTaskRun(database, restartTask);
      if (!isShuttingDown) await sendTaskState(database);
    }
  })();
  void run.completion.catch((error) => {
    console.error('Background task cleanup failed', error);
  });
  return true;
}

async function applyTaskRunIntent(
  database: FileDatabase,
  taskId: string,
  intent: TaskRunIntent,
): Promise<Task | null> {
  const latestTask = (await database.getState()).tasks.find((item) => item.id === taskId);
  if (!latestTask) return null;
  const now = new Date().toISOString();
  if (intent === 'restart') {
    await database.updateTask(taskId, {
      status: 'pending',
      errorMessage: '',
      completedAt: null,
      lastHeartbeatAt: now,
    });
    return {
      ...latestTask,
      status: 'pending',
      errorMessage: '',
      completedAt: null,
      lastHeartbeatAt: now,
    };
  }
  await database.updateTask(taskId, {
    status: intent,
    errorMessage: intent === 'cancelled' ? '用户取消' : '运行已暂停，可继续。',
    failedStep: intent === 'paused' ? latestTask.failedStep ?? latestTask.currentStep : latestTask.failedStep,
    retryFromStep: intent === 'paused' ? latestTask.retryFromStep ?? latestTask.currentStep : latestTask.retryFromStep,
    lastHeartbeatAt: now,
  });
  return null;
}

async function runHtmlVideoTask(
  database: FileDatabase,
  task: Task,
  controller: AbortController,
  recovery: HtmlVideoPipelineRetryPatch | null = null,
): Promise<void> {
  let workDir = taskWorkDir(task);
  const startedAt = task.startedAt ?? new Date().toISOString();
  let lastState: HtmlVideoPipelineDataV2 | null = null;
  try {
    const taskDirectory = await ensureHtmlVideoTaskWorkDir(app.getPath('userData'), appDataName, task.id);
    workDir = taskDirectory.workDir.canonicalPath;
    const initialState = parseHtmlVideoPipelineData(task.pipelineData);
    lastState = initialState;
    if (recovery) {
      await synchronizeHtmlVideoPipelineCheckpoint(workDir, initialState);
      await database.updateTask(task.id, recovery);
    }
    await database.updateTask(task.id, {
      status: 'running',
      outputDir: workDir,
      errorMessage: '',
      failedStep: null,
      retryFromStep: null,
      completedAt: null,
      startedAt,
      lastHeartbeatAt: startedAt,
    });
    await sendTaskState(database);

    const runtimeConfig = await (await getConfigService()).getRuntimeConfig();
    const probeMedia = probeHtmlVideoMedia;
    const bgmPath = await prepareHtmlVideoBgm({
      taskDirectory,
      bgmId: initialState.config.bgmId?.trim() ?? '',
      bgmLibrary: runtimeConfig.jianying.bgmLibrary,
      signal: controller.signal,
      probeMedia,
    });
    const renderer = createElectronHtmlVideoRenderer();
    const runtime = createElectronHtmlVideoRuntime({
      taskDirectory,
      taskTitle: task.title,
      bgmPath,
      signal: controller.signal,
      renderer,
      probeMedia,
    });
    const providers = createHtmlVideoRuntimeProviders(runtimeConfig, workDir, task, {
      measureAudioDuration: runtime.measureAudioDuration,
    });
    const finalState = await runHtmlVideoPipeline({
      taskId: task.id,
      sourceText: task.inputText,
      state: initialState,
      ignoreCheckpoint: Boolean(recovery),
    }, {
      workDir,
      signal: controller.signal,
      ...providers,
      createPreviews: runtime.createPreviews,
      render: runtime.render,
      onCheckpoint: async (state) => {
        lastState = state;
        await persistHtmlVideoTaskCheckpoint(database, task.id, workDir, state, controller.signal);
        await sendTaskState(database);
      },
    });
    lastState = finalState;
    await persistHtmlVideoTaskCheckpoint(database, task.id, workDir, finalState, controller.signal);
    await sendTaskState(database);
  } catch (error) {
    if (controller.signal.aborted || isCancellation(error)) {
      const status = htmlVideoAbortStatus(controller.signal.reason);
      const step = lastState ? htmlVideoTaskStep(lastState) : task.currentStep;
      await database.updateTask(task.id, {
        status,
        currentStep: step,
        outputDir: workDir,
        errorMessage: status === 'cancelled' ? '用户取消' : '运行已暂停，可继续。',
        failedStep: status === 'paused' ? step : task.failedStep,
        retryFromStep: status === 'paused' ? step : task.retryFromStep,
        lastHeartbeatAt: new Date().toISOString(),
      });
      await sendTaskState(database);
      return;
    }

    const normalized = normalizeAppError(error, {
      code: 'HTML_VIDEO_RUN_FAILED',
      message: 'HTML 视频生成失败。',
      retryable: true,
    });
    const step = lastState ? htmlVideoTaskStep(lastState) : task.currentStep;
    await database.updateTask(task.id, {
      status: 'failed',
      currentStep: step,
      outputDir: workDir,
      errorMessage: normalized.message,
      failedStep: step,
      retryFromStep: step,
      lastHeartbeatAt: new Date().toISOString(),
    });
    await database.addTaskEvent(task.id, {
      type: 'step_error',
      step,
      agent: null,
      detail: normalized.message,
    });
    await sendTaskState(database);
    throw normalized;
  }
}

async function probeHtmlVideoMedia(
  root: string,
  path: string,
  signal?: AbortSignal,
): Promise<HtmlVideoMediaProbeResult> {
  const result = await runStoryboundMediaSidecar({
    mode: 'probe_media',
    work_dir: root,
    media_path: path,
  }, { signal });
  return {
    duration: result.duration,
    hasAudio: result.has_audio,
    hasVideo: result.has_video,
    width: result.width,
    height: result.height,
  };
}

async function persistHtmlVideoTaskCheckpoint(
  database: FileDatabase,
  taskId: string,
  workDir: string,
  state: HtmlVideoPipelineDataV2,
  signal: AbortSignal,
): Promise<void> {
  const currentStep = htmlVideoTaskStep(state);
  const stepState = state.current === 'done' ? null : state.steps[state.current];
  const status: TaskStatus = state.current === 'done'
    ? 'completed'
    : stepState?.status === 'failed'
      ? 'failed'
      : stepState?.status === 'cancelled'
        ? htmlVideoAbortStatus(signal.reason)
        : 'running';
  const now = new Date().toISOString();
  const errorMessage = status === 'failed'
    ? stepState?.error ?? 'HTML 视频生成失败。'
    : status === 'cancelled'
      ? '用户取消'
      : status === 'paused'
        ? '运行已暂停，可继续。'
        : '';
  await database.updateTask(taskId, {
    status,
    currentStep,
    pipelineStep: state.current,
    pipelineData: JSON.stringify(state),
    outputDir: workDir,
    errorMessage,
    completedAt: status === 'completed' ? now : null,
    failedStep: status === 'failed' || status === 'paused' ? currentStep : null,
    retryFromStep: status === 'failed' || status === 'paused' ? currentStep : null,
    lastHeartbeatAt: now,
  });
}

function htmlVideoTaskStep(state: HtmlVideoPipelineDataV2): number {
  return state.current === 'done'
    ? htmlVideoVisibleSteps.length
    : Math.max(0, htmlVideoVisibleSteps.indexOf(state.current));
}

function htmlVideoAbortStatus(reason: unknown): Extract<TaskStatus, 'paused' | 'cancelled'> {
  return typeof reason === 'string' && reason.includes('取消') ? 'cancelled' : 'paused';
}

async function resumeTaskRun(
  database: FileDatabase,
  task: Task,
  shouldStart: () => boolean = () => true,
): Promise<void> {
  if (isShuttingDown) return;
  const existingRun = runningTasks.get(task.id);
  if (existingRun) {
    requestTaskRunIntent(existingRun, 'restart', '用户重试');
    await database.updateTask(task.id, {
      errorMessage: '正在停止当前运行，随后继续重试。',
      lastHeartbeatAt: new Date().toISOString(),
    });
    return;
  }
  await database.updateTask(task.id, { status: 'pending', errorMessage: '' });
  if (!shouldStart()) return;
  startTaskRun(database, { ...task, status: 'pending', errorMessage: '' });
}

async function resumeLatestTaskRun(
  database: FileDatabase,
  taskId: string,
  isCurrent: () => boolean,
): Promise<void> {
  if (!isCurrent()) return;
  const updatedTask = (await database.getState()).tasks.find((item) => item.id === taskId);
  if (!updatedTask || !isCurrent()) return;
  await resumeTaskRun(database, updatedTask, isCurrent);
}

function startViralAnalysisRun(database: FileDatabase, record: ViralAnalysisRecord): boolean {
  if (isShuttingDown || runningViralAnalyses.has(record.id)) return false;
  const controller = new AbortController();
  const run: RunningViralAnalysisRun = {
    controller,
    completion: Promise.resolve(),
  };
  runningViralAnalyses.set(record.id, run);
  run.completion = (async () => {
    const startedAt = new Date().toISOString();
    try {
      const runtimeConfig = await (await getConfigService()).getRuntimeConfig();
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
        ...createViralRuntimeProviders(runtimeConfig, viralAnalysisWorkDir(record)),
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
      if (runningViralAnalyses.get(record.id) === run) {
        runningViralAnalyses.delete(record.id);
      }
      if (!isShuttingDown) await sendTaskState(database);
    }
  })();
  void run.completion.catch((error) => {
    console.error('Background viral analysis cleanup failed', error);
  });
  return true;
}

async function resumeViralAnalysisRun(database: FileDatabase, record: ViralAnalysisRecord): Promise<void> {
  if (isShuttingDown) return;
  const existingRun = runningViralAnalyses.get(record.id);
  if (existingRun) {
    if (!existingRun.controller.signal.aborted) existingRun.controller.abort('用户重试');
    await existingRun.completion.catch(() => undefined);
  }
  if (isShuttingDown) return;
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

trustedHandle('window:control', async (_event, action: 'minimize' | 'toggle-maximize' | 'close') => {
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

trustedHandle('app:get-state', async () => {
  return getPublicState();
});

trustedHandle('app:save-config', async (_event, input) => {
  return (await getConfigService()).save(input);
});

trustedHandle('llm:test-config', async (_event, config: LlmConfig) => {
  if (config.apiKey) return testConfiguredLlm(config);
  const runtime = await (await getConfigService()).getRuntimeConfig();
  const stored = runtime.llmProfiles.find((profile) => profile.id === config.id) ?? runtime.llm;
  return testConfiguredLlm({ ...config, apiKey: stored.apiKey });
});

trustedHandle('models:list', async (_event, request: ProviderModelListRequest) => {
  const { secretId, ...providerRequest } = request;
  const apiKey = await (await getConfigService()).resolveSecret(secretId, providerRequest.apiKey);
  return listConfiguredProviderModels({ ...providerRequest, apiKey });
});

trustedHandle('volcengine:speakers:list', async (_event, request: VolcengineSpeakerListRequest) => {
  const { accessKeyIdSecretId, secretAccessKeySecretId, ...providerRequest } = request;
  const service = await getConfigService();
  const [accessKeyId, secretAccessKey] = await Promise.all([
    service.resolveSecret(accessKeyIdSecretId, providerRequest.accessKeyId),
    service.resolveSecret(secretAccessKeySecretId, providerRequest.secretAccessKey),
  ]);
  return listVolcengineSpeakers({ ...providerRequest, accessKeyId, secretAccessKey });
});

trustedHandle('config:test', async (_event, input) => {
  const runtimeConfig = await (await getConfigService()).getRuntimeConfigFor(input);
  if (input.target === 'llm') {
    return fromLlmModelTestResult(await testConfiguredLlm(runtimeConfig.llm));
  }
  return testConfigTarget(input.target, runtimeConfig, { pathExists: existsSync });
});

trustedHandle('research:web-search', async (_event, query: string) => {
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

trustedHandle('research:compose-copy', async (_event, input: ResearchCopyComposeInput) => {
  const runtimeConfig = await (await getConfigService()).getRuntimeConfig();
  return composeCopyFromSources(createConfiguredTextLlm(runtimeConfig.llm), input);
});

trustedHandle('prompt-template:save', async (_event, template: PromptTemplate) => {
  const database = await getDb();
  await database.upsertPromptTemplate(template);
  return getPublicState();
});

trustedHandle('prompt-template:reset', async () => {
  const database = await getDb();
  await database.resetPromptTemplates();
  return getPublicState();
});

trustedHandle('custom-style:save', async (_event, style: CustomStyle) => {
  const database = await getDb();
  await database.upsertCustomStyle(style);
  return getPublicState();
});

trustedHandle('custom-style:generate-draft', async (_event, input: CustomStyleGenerateInput): Promise<CustomStyle> => {
  const runtimeConfig = await (await getConfigService()).getRuntimeConfig();
  const llm = createConfiguredJsonLlm(runtimeConfig.llm);
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

trustedHandle('draft-template:save', async (_event, template: DraftTemplate) => {
  const database = await getDb();
  await database.upsertDraftTemplate(template);
  return getPublicState();
});

trustedHandle('image-lab:generate', async (_event, input: ImageLabGenerateInput) => {
  const database = await getDb();
  const runtimeConfig = await (await getConfigService()).getRuntimeConfig();
  const id = input.id ?? randomUUID();
  const record = await generateImageLabRecord(runtimeConfig, imageLabWorkDir(id), { ...input, id });
  await database.addImageLabRecord(record);
  return getPublicState();
});

trustedHandle('image-lab:add-record', async (_event, input) => {
  const database = await getDb();
  await database.addImageLabRecord(input);
  return getPublicState();
});

trustedHandle('voice-lab:generate', async (_event, input: VoiceLabGenerateInput) => {
  const database = await getDb();
  const runtimeConfig = await (await getConfigService()).getRuntimeConfig();
  const id = input.id ?? randomUUID();
  const record = await generateConfiguredVoicePreview(runtimeConfig, voiceLabWorkDir(id), { ...input, id });
  await database.addVoiceLabRecord(record);
  return getPublicState();
});

trustedHandle('account:save', async (_event, account: AccountProfile) => {
  const database = await getDb();
  await database.upsertAccount(account);
  return getPublicState();
});

trustedHandle('activation:save', async (_event, activation: ActivationState) => {
  const database = await getDb();
  await database.upsertActivation(activation);
  return getPublicState();
});

trustedHandle('ui:save-preferences', async (_event, ui: UiPreferences) => {
  const database = await getDb();
  await database.upsertUiPreferences(ui);
  return getPublicState();
});

trustedHandle('book-selection:list', async (_event, theme?: string) => (await getDb()).listBookSelections(theme));

trustedHandle('book-selection:save', async (_event, input: BookSelectionInput) => (await getDb()).upsertBookSelection(input));

trustedHandle('book-selection:delete', async (_event, input: { theme: string; bookId: string }) => {
  await (await getDb()).deleteBookSelection(input.theme, input.bookId);
});

trustedHandle('person-assets:list', async () => listPersonAssets(personAssetsRoot()));

trustedHandle('person-assets:create', async (_event, name: string) => createPersonAsset(personAssetsRoot(), name));

trustedHandle('person-assets:rename', async (_event, input: { oldName: string; newName: string }) => renamePersonAsset(personAssetsRoot(), input.oldName, input.newName));

trustedHandle('person-assets:delete', async (_event, name: string) => deletePersonAsset(personAssetsRoot(), name));

trustedHandle('person-assets:list-images', async (_event, name: string) => listPersonImages(personAssetsRoot(), name));

trustedHandle('person-assets:import-images', async (_event, name: string) => {
  const result = await dialog.showOpenDialog({
    title: `导入图片到「${name}」`,
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  });
  if (result.canceled) return 0;
  return importPersonAssetFiles(personAssetsRoot(), name, result.filePaths);
});

trustedHandle('html-video:create-task', async (_event, input: CreateTaskInput) => {
  const database = await getDb();
  const task = await database.createTask({
    ...input,
    taskKind: 'story',
    taskType: 'html-video',
    pipelineStep: input.pipelineStep ?? 'rewrite',
    pipelineData: input.pipelineData ?? '{}',
  });
  startTaskRun(database, task);
  return getPublicState();
});

trustedHandle('html-video:open-preview', async (_event, input: { id: string; sceneIndex?: number }) => {
  const database = await getDb();
  const task = await getHtmlVideoTask(database, input.id);
  const state = parseHtmlVideoPipelineData(task.pipelineData);
  const composition = input.sceneIndex === undefined
    ? state.compositions[0]
    : state.compositions.find((item) => item.index === input.sceneIndex);
  if (!composition?.htmlPath) {
    throw new Error('HTML_VIDEO_PREVIEW_UNAVAILABLE: 当前任务还没有可预览的 HTML 场景。');
  }
  const taskDirectory = await htmlVideoTaskDirectory(task.id);
  const workDir = taskDirectory.workDir.canonicalPath;
  const mediaUrl = await createHtmlVideoMediaUrl(task.id, taskDirectory, composition.htmlPath);
  const htmlPath = await resolveHtmlVideoMediaUrl(mediaUrl, () => taskDirectory);
  await createElectronHtmlVideoRenderer().openPreview({
    workDir,
    htmlPath,
    canvas: { width: composition.canvas.w, height: composition.canvas.h },
  });
});

trustedHandle('html-video:media-url', async (_event, input: { id: string; path: string }) => {
  const database = await getDb();
  const task = await getHtmlVideoTask(database, input.id);
  const taskDirectory = await htmlVideoTaskDirectory(task.id);
  return createHtmlVideoMediaUrl(task.id, taskDirectory, input.path);
});

async function getHtmlVideoTask(database: FileDatabase, id: string): Promise<Task> {
  const task = (await database.getState()).tasks.find((item) => item.id === id);
  if (!task || !isHtmlVideoTask(task)) {
    throw new Error('HTML_VIDEO_TASK_NOT_FOUND: HTML 视频任务不存在。');
  }
  return task;
}

trustedHandle('task:create-and-run', async (_event, input: CreateTaskInput) => {
  const database = await getDb();
  const task = await database.createTask(input);
  startTaskRun(database, task);
  return getPublicState();
});

trustedHandle('viral:create-and-run', async (_event, input: CreateViralAnalysisInput) => {
  const database = await getDb();
  const record = await database.createViralAnalysis({
    ...input,
    platform: input.platform && input.platform !== 'unknown' ? input.platform : detectViralPlatform(input.url),
  });
  startViralAnalysisRun(database, record);
  return getPublicState();
});

trustedHandle('viral:update-status', async (_event, input: { id: string; status: ViralAnalysisStatus }) => {
  const database = await getDb();
  const state = await database.getState();
  const record = state.viralAnalyses.find((item) => item.id === input.id);
  if (!record) return getPublicState();
  if (input.status === 'running') {
    await resumeViralAnalysisRun(database, record);
    return getPublicState();
  }
  if (input.status === 'paused' || input.status === 'cancelled') {
    const run = runningViralAnalyses.get(input.id);
    if (run && !run.controller.signal.aborted) {
      run.controller.abort(input.status === 'cancelled' ? '用户取消' : '用户暂停');
    }
    await database.updateViralAnalysis(input.id, {
      status: input.status,
      errorMessage: input.status === 'cancelled' ? '用户取消' : record.errorMessage,
      lastHeartbeatAt: new Date().toISOString(),
    });
  }
  return getPublicState();
});

trustedHandle('viral:retry', async (_event, id: string) => {
  const database = await getDb();
  const state = await database.getState();
  const record = state.viralAnalyses.find((item) => item.id === id);
  if (record) await resumeViralAnalysisRun(database, record);
  return getPublicState();
});

trustedHandle('viral:get-result', async (_event, id: string) => {
  const database = await getDb();
  const state = await database.getState();
  const record = state.viralAnalyses.find((item) => item.id === id);
  if (!record?.resultPath) throw new Error(`Viral analysis result is not available: ${id}`);
  return JSON.parse(await readFile(record.resultPath, 'utf8'));
});

trustedHandle('viral:create-production-task', async (_event, input: { id: string; options?: ViralProductionTaskOptions }) => {
  const database = await getDb();
  const state = await database.getState();
  const record = state.viralAnalyses.find((item) => item.id === input.id);
  if (!record?.resultPath) throw new Error(`Viral analysis result is not available: ${input.id}`);
  const result = JSON.parse(await readFile(record.resultPath, 'utf8'));
  const taskInput = createViralProductionTaskInput(result, input.options);
  const task = await database.createTask(taskInput);
  startTaskRun(database, task);
  return getPublicState();
});

trustedHandle('task:update-status', async (_event, input: { id: string; status: TaskStatus }) => {
  const isControlRequest = input.status === 'running' || input.status === 'paused' || input.status === 'cancelled';
  if (!isControlRequest) return getPublicState();
  return runLatestTaskControlRequest(latestTaskControlRequests, input.id, async (isCurrent) => {
    const existingRun = runningTasks.get(input.id);
    let controlledRun = existingRun;
    if (existingRun) {
      if (input.status === 'running') {
        requestTaskRunIntent(existingRun, 'restart', '用户重试');
      } else if (input.status === 'paused' || input.status === 'cancelled') {
        requestTaskRunIntent(
          existingRun,
          input.status,
          input.status === 'cancelled' ? '用户取消' : '用户暂停',
        );
      }
    }
    const database = await getDb();
    const state = await database.getState();
    const task = state.tasks.find((item) => item.id === input.id);
    if (!task || !isCurrent()) {
      return getPublicState();
    }
    if (input.status === 'running') {
      if (!existingRun) {
        await resumeTaskRun(database, task, isCurrent);
      } else if (isCurrent() && runningTasks.get(input.id) === existingRun && existingRun.intent === 'restart') {
        await database.updateTask(input.id, {
          errorMessage: '正在停止当前运行，随后继续重试。',
          lastHeartbeatAt: new Date().toISOString(),
        });
      }
      return getPublicState();
    }
    if (input.status === 'paused' || input.status === 'cancelled') {
      const currentRun = runningTasks.get(input.id);
      if (currentRun && currentRun !== controlledRun) {
        requestTaskRunIntent(
          currentRun,
          input.status,
          input.status === 'cancelled' ? '用户取消' : '用户暂停',
        );
        controlledRun = currentRun;
      }
      if (isCurrent() && (!existingRun || (runningTasks.get(input.id) === existingRun && existingRun.intent === input.status))) {
        await database.updateTask(input.id, {
          status: input.status,
          errorMessage: input.status === 'cancelled' ? '用户取消' : task.errorMessage,
          failedStep: input.status === 'paused' ? task.failedStep ?? task.currentStep : task.failedStep,
          retryFromStep: input.status === 'paused' ? task.retryFromStep ?? task.currentStep : task.retryFromStep,
          lastHeartbeatAt: new Date().toISOString(),
        });
      }
      if (isCurrent()) {
        const runAfterUpdate = runningTasks.get(input.id);
        if (runAfterUpdate && runAfterUpdate !== controlledRun) {
          requestTaskRunIntent(
            runAfterUpdate,
            input.status,
            input.status === 'cancelled' ? '用户取消' : '用户暂停',
          );
        }
      }
    }
    return getPublicState();
  });
});

trustedHandle('task:retry', async (_event, id: string) => {
  return runLatestTaskControlRequest(latestTaskControlRequests, id, async (isCurrent) => {
    const existingRun = runningTasks.get(id);
    if (existingRun) requestTaskRunIntent(existingRun, 'restart', '用户重试');
    const database = await getDb();
    const state = await database.getState();
    const task = state.tasks.find((item) => item.id === id);
    if (!task || !isCurrent()) {
      return getPublicState();
    }
    if (!existingRun) {
      await resumeTaskRun(database, task, isCurrent);
    } else if (isCurrent() && runningTasks.get(id) === existingRun && existingRun.intent === 'restart') {
      await database.updateTask(id, {
        errorMessage: '正在停止当前运行，随后继续重试。',
        lastHeartbeatAt: new Date().toISOString(),
      });
    }
    return getPublicState();
  });
});

trustedHandle('task:regenerate-image', async (_event, input: { id: string; sceneId: number }) => {
  return runLatestTaskControlRequest(latestTaskControlRequests, input.id, async (isCurrent) => {
    const database = await getDb();
    if (!isCurrent()) return getPublicState();
    const state = await database.getState();
    if (!isCurrent()) return getPublicState();
    const task = state.tasks.find((item) => item.id === input.id);
    if (!task) {
      throw new Error(`Task not found: ${input.id}`);
    }
    if (!task.artifactStatePath) {
      throw new Error('Task artifact state is not available; run the task before regenerating images.');
    }

    const sceneId = Number(input.sceneId);
    if (!await stopTaskRunBeforeArtifactMutation(() => runningTasks.get(input.id), isCurrent)) {
      return getPublicState();
    }
    await markSceneImageForRegeneration(task.artifactStatePath, sceneId);
    if (!isCurrent()) return getPublicState();
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
    if (!isCurrent()) return getPublicState();
    await database.addTaskEvent(task.id, {
      type: 'step_start',
      step: 4,
      agent: 'Producer',
      detail: `重新生成第 ${sceneId} 张图片`,
      dataJson: JSON.stringify({ sceneId }),
    });
    if (!isCurrent()) return getPublicState();
    await resumeLatestTaskRun(database, task.id, isCurrent);
    return getPublicState();
  });
});

trustedHandle('task:regenerate-narration', async (_event, input: { id: string; sceneId: number }) => {
  return runLatestTaskControlRequest(latestTaskControlRequests, input.id, async (isCurrent) => {
    const database = await getDb();
    if (!isCurrent()) return getPublicState();
    const state = await database.getState();
    if (!isCurrent()) return getPublicState();
    const task = state.tasks.find((item) => item.id === input.id);
    if (!task) {
      throw new Error(`Task not found: ${input.id}`);
    }
    if (!task.artifactStatePath) {
      throw new Error('Task artifact state is not available; run the task before regenerating narration.');
    }

    const sceneId = Number(input.sceneId);
    if (!await stopTaskRunBeforeArtifactMutation(() => runningTasks.get(input.id), isCurrent)) {
      return getPublicState();
    }
    await markSceneNarrationForRegeneration(task.artifactStatePath, sceneId);
    if (!isCurrent()) return getPublicState();
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
    if (!isCurrent()) return getPublicState();
    await database.addTaskEvent(task.id, {
      type: 'step_start',
      step: 5,
      agent: 'TTS',
      detail: `重新生成第 ${sceneId} 段配音`,
      dataJson: JSON.stringify({ sceneId }),
    });
    if (!isCurrent()) return getPublicState();
    await resumeLatestTaskRun(database, task.id, isCurrent);
    return getPublicState();
  });
});

trustedHandle('task:update-image-prompt', async (_event, input: { id: string; sceneId: number; prompt: string }) => {
  return runLatestTaskControlRequest(latestTaskControlRequests, input.id, async (isCurrent) => {
    const database = await getDb();
    if (!isCurrent()) return getPublicState();
    const state = await database.getState();
    if (!isCurrent()) return getPublicState();
    const task = state.tasks.find((item) => item.id === input.id);
    if (!task) {
      throw new Error(`Task not found: ${input.id}`);
    }
    if (!task.artifactStatePath) {
      throw new Error('Task artifact state is not available; run the task before editing image prompts.');
    }

    const sceneId = Number(input.sceneId);
    if (!await stopTaskRunBeforeArtifactMutation(() => runningTasks.get(input.id), isCurrent)) {
      return getPublicState();
    }
    const result = await updateSceneImagePrompt(task.artifactStatePath, sceneId, input.prompt);
    if (!isCurrent()) return getPublicState();
    await database.addTaskEvent(task.id, {
      type: 'prompt_update',
      step: 3,
      agent: 'Prompt',
      detail: `已修改第 ${sceneId} 张图片提示词`,
      dataJson: JSON.stringify({ sceneId, promptLength: result.updatedPrompt.prompt.length }),
    });
    return getPublicState();
  });
});

trustedHandle('task:rerun-step', async (_event, input: { id: string; step: number; mode: TaskStepRerunMode }) => {
  return runLatestTaskControlRequest(latestTaskControlRequests, input.id, async (isCurrent) => {
    const database = await getDb();
    if (!isCurrent()) return getPublicState();
    const state = await database.getState();
    if (!isCurrent()) return getPublicState();
    const task = state.tasks.find((item) => item.id === input.id);
    if (!task) {
      throw new Error(`Task not found: ${input.id}`);
    }
    if (!task.artifactStatePath) {
      throw new Error('Task artifact state is not available; run the task before rerunning a step.');
    }

    const step = Number(input.step);
    if (!await stopTaskRunBeforeArtifactMutation(() => runningTasks.get(input.id), isCurrent)) {
      return getPublicState();
    }
    const result = await markTaskStepForRerun(task.artifactStatePath, step, input.mode);
    if (!isCurrent()) return getPublicState();
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
    if (!isCurrent()) return getPublicState();
    await database.addTaskEvent(task.id, {
      type: 'step_start',
      step,
      agent: pipelineStepAgents[step] ?? null,
      detail,
      dataJson: JSON.stringify({ step, mode: result.mode, clearedSteps: result.clearedSteps }),
    });
    if (!isCurrent()) return getPublicState();
    await resumeLatestTaskRun(database, task.id, isCurrent);
    return getPublicState();
  });
});

trustedHandle('task:get-artifacts', async (_event, id: string) => {
  const database = await getDb();
  const state = await database.getState();
  const task = state.tasks.find((item) => item.id === id);
  if (!task) {
    throw new Error(`Task not found: ${id}`);
  }
  return readTaskArtifactSnapshot(task);
});

trustedHandle('asset:read-data-url', async (_event, path: string) => readLocalImageDataUrl(path));

trustedHandle('local-image:select', async () => {
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
  const cookies = allCookies.filter((cookie) => isAllowedDouyinCookieDomain(cookie.domain || ''));
  const lines = ['# Netscape HTTP Cookie File', ...cookies.map(netscapeCookieLine)];
  const outputPath = viralCookieFilePath();
  await writeFile(outputPath, `${lines.join('\n')}\n`, 'utf8');
  const database = await getDb();
  const service = await getConfigService();
  const state = await service.getPublicState();
  const updatedConfig: AppConfig = {
    ...state.config,
    viral: {
      ...state.config.viral,
      cookieFilePath: outputPath,
      cookieFallbackMode: 'browser-first-after-failure',
    },
  };
  await service.save({ config: updatedConfig, secretChanges: {} });
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
        sandbox: true,
      },
    });
    viralLoginWindow = loginWindow;
    attachDouyinLoginSecurity(loginWindow);
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

trustedHandle('local-audio:select', selectLocalAudio);
trustedHandle('local-folder:select', selectLocalFolder);
trustedHandle('cookie-file:select', selectCookieFile);
trustedHandle('viral:open-login-window', openViralLoginWindow);

trustedHandle('jianying:effect-catalog', async () => loadJianyingEffectCatalog());
trustedHandle('jianying:draft-path:detect', async () => detectJianyingDraftPath({ pathExists: existsSync }));

trustedHandle('diagnostics:run', async () => {
  const database = await getDb();
  const [state, runtimeConfig] = await Promise.all([database.getState(), (await getConfigService()).getRuntimeConfig()]);
  const python = await checkPython();
  const pyJianYingDraft = python.status === 'pass' ? await checkPyJianYingDraft() : { status: 'warn' as const, detail: 'Python unavailable; cannot check pyJianYingDraft.' };
  const storyboundSidecar =
    python.status === 'pass'
      ? await checkStoryboundSidecarDependencies()
      : { status: 'warn' as const, detail: 'Python unavailable; cannot check Storybound sidecar dependencies.' };
  return {
    generatedAt: new Date().toISOString(),
    checks: [
      { id: 'llm-config', label: 'LLM 配置完整性', status: runtimeConfig.llm.apiKey ? 'pass' : 'warn', detail: `${runtimeConfig.llm.baseUrl} · ${runtimeConfig.llm.model}` },
      { id: 'image-config', label: '图片供应商配置', status: imageConfigStatus(runtimeConfig), detail: runtimeConfig.imageProvider },
      { id: 'tts-config', label: 'TTS 凭证', status: ttsConfigStatus(runtimeConfig), detail: runtimeConfig.tts.provider },
      { id: 'draft-dir', label: '剪映草稿目录', status: runtimeConfig.jianying.draftPath ? 'pass' : 'warn', detail: runtimeConfig.jianying.draftPath || '未配置' },
      { id: 'python', label: 'Python 运行时', status: python.status, detail: python.detail },
      { id: 'pyjianyingdraft', label: 'pyJianYingDraft', status: pyJianYingDraft.status, detail: pyJianYingDraft.detail },
      { id: 'storybound-sidecar', label: 'Storybound sidecar', status: storyboundSidecar.status, detail: storyboundSidecar.detail },
      { id: 'local-db', label: '数据目录写入权限', status: 'pass', detail: app.getPath('userData') },
      { id: 'account-state', label: '账号状态', status: 'pass', detail: state.activation.message },
    ],
  };
});

trustedHandle('path:open', async (_event, path: string) => {
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

async function shutdownApplication(): Promise<void> {
  isShuttingDown = true;
  const completions: Promise<void>[] = [];

  for (const run of runningTasks.values()) {
    run.intent = null;
    if (!run.controller.signal.aborted) run.controller.abort('应用退出');
    completions.push(run.completion);
  }
  for (const run of runningViralAnalyses.values()) {
    if (!run.controller.signal.aborted) run.controller.abort('应用退出');
    completions.push(run.completion);
  }

  await Promise.allSettled(completions);
  const database = db;
  if (database) {
    await database.close();
    if (db === database) {
      db = null;
      configService = null;
    }
  }
}

if (isPrimaryInstance) {
  app.whenReady().then(async () => {
    setDefaultPythonRuntimeAppRoot(app.getAppPath());
    registerHtmlVideoMediaProtocol();
    await createWindow();
    await runSmokeHandshake();
  }).catch(async (error) => {
    console.error('Application startup failed', error);
    process.exitCode = 1;
    if (smokeConfig) {
      const failedReport: SmokeReport = {
        mainLoaded: false,
        preloadExposed: false,
        ipcStateLoaded: false,
        preloadActionSucceeded: false,
        windowPolicyInstalled: mainWindowPolicyInstalled,
        shellRendered: false,
      };
      await writeFile(smokeConfig.outputPath, `${JSON.stringify(failedReport, null, 2)}\n`, 'utf8').catch(() => undefined);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
      if (process.platform === 'darwin') app.quit();
    } else app.quit();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', (event) => {
    if (shutdownComplete) return;
    event.preventDefault();
    shutdownPromise ??= shutdownApplication()
      .catch((error) => {
        console.error('Application shutdown failed', error);
      })
      .finally(() => {
        shutdownComplete = true;
        app.quit();
      });
  });
}
