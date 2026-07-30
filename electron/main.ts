import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, protocol, safeStorage, shell, type Cookie } from 'electron';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { readTaskArtifactSnapshot } from '../src/shared/artifact-preview';
import { isCancellation, normalizeAppError } from '../src/shared/app-error';
import { fromLlmModelTestResult, testConfigTarget } from '../src/shared/config-utils';
import { generateImageLabRecord } from '../src/shared/image-lab';
import { fetchImaKnowledge } from '../src/shared/ima-knowledge';
import { detectJianyingDraftPath, resolveRuntimeJianyingDraftPath } from '../src/shared/jianying-paths';
import { loadJianyingEffectCatalog } from '../src/shared/jianying-effects';
import { runHtmlVideoPipeline, synchronizeHtmlVideoPipelineCheckpoint } from '../src/shared/html-video-runner';
import { MAX_HTML_VIDEO_COVER_BYTES, type HtmlVideoCoverImageProcessor, type HtmlVideoCoverInspection } from '../src/shared/html-video-cover';
import {
  MAX_ORDINARY_TASK_COVER_BYTES,
  createOrdinaryTaskCoverAsset,
  createOrdinaryTaskCoverSelection,
  ordinaryTaskCoverDimensions,
  validateOrdinaryTaskCoverInspection,
  validateOrdinaryTaskCoverSelection,
  type OrdinaryTaskCoverImageProcessor,
  type OrdinaryTaskCoverInspection,
} from '../src/shared/ordinary-task-cover';
import { createHtmlVideoTaskInput, htmlVideoVisibleSteps, isHtmlVideoTask, parseHtmlVideoPipelineData, recoverHtmlVideoPipelineDataForRetry, type HtmlVideoPipelineRetryPatch } from '../src/shared/html-video-workflow';
import { generateConfiguredVoicePreview } from '../src/shared/media-providers';
import { mergeMinimaxCloneVoice } from '../src/shared/minimax-clone-voices';
import { createPersonAsset, deletePersonAsset, importPersonAssetFiles, listPersonAssets, listPersonImages, renamePersonAsset } from '../src/shared/person-assets';
import { createConfiguredJsonLlm, createConfiguredTextLlm, listConfiguredProviderModels, testConfiguredLlm } from '../src/shared/llm-provider';
import { markSceneImageForRegeneration, markSceneNarrationForRegeneration, markTaskStepForRerun, updateSceneImagePrompt } from '../src/shared/pipeline-cache';
import { resolvePythonRuntimeInfo, setDefaultPythonRuntimeAppRoot } from '../src/shared/python-runtime';
import { composeCopyFromSources, createAiSourceResearcher, searchWebSources } from '../src/shared/research';
import { runTask } from '../src/shared/runner';
import { runStoryboundMediaSidecar } from '../src/shared/storybound-sidecar';
import { FileDatabase, type HistoryDeletionCleanup, type HistoryTombstone } from '../src/shared/storage';
import { createHtmlVideoRuntimeProviders, createTaskRuntimeProviders } from '../src/shared/task-runtime-providers';
import { assertTaskLifecycleAction } from '../src/shared/task-progress';
import type { AccountProfile, ActivationState, AppConfig, AppDelta, AppDeltaReconcileRequest, AppDeltaReconcileResult, AppStatePatch, BookSelectionInput, ConfigTestTarget, CreateTaskInput, CreateViralAnalysisInput, CursorRequest, CustomStyle, CustomStyleGenerateInput, DraftTemplate, HistoryFamily, HistoryListRequest, HtmlVideoConfigChange, HtmlVideoPipelineDataV2, ImageLabGenerateInput, ImageLabRecord, ImageLabSummary, ImaKnowledgeRequest, LlmConfig, MinimaxCloneVoiceInput, OrdinaryTaskCoverRatio, OrdinaryTaskCoverSelection, PromptTemplate, ProviderModelListRequest, ResearchCopyComposeInput, SequencedTaskEvent, Task, TaskStatus, TaskStepRerunMode, UiPreferencesUpdate, ViralAnalysisRecord, ViralAnalysisResult, ViralAnalysisStatus, ViralProductionTaskOptions, VolcengineSpeakerListRequest, VoiceLabGenerateInput, VoiceLabRecord, VoiceLabSummary } from '../src/shared/types';
import { boundViralDiagnosticText, createViralProductionTaskInput, detectViralPlatform, runViralAnalysis, viralCheckpointResumeState } from '../src/shared/viral-analysis';
import { createViralRuntimeProviders } from '../src/shared/viral-runtime';
import { listVolcengineSpeakers } from '../src/shared/volcengine-speakers';
import { resolveVolcengineTtsApiVersion } from '../src/shared/volcengine-tts';
import { getRendererIndexPath } from './paths';
import {
  createElectronHtmlVideoRuntime,
  fetchHtmlVideoMediaResponse,
  createHtmlVideoMediaUrl,
  ensureHtmlVideoTaskWorkDir,
  htmlVideoMediaResponse,
  htmlVideoMediaScheme,
  openHtmlVideoMediaFileResponse,
  prepareHtmlVideoBgm,
  resolveExistingHtmlVideoTaskWorkDir,
  resolveHtmlVideoMediaUrl,
  type HtmlVideoMediaProbeResult,
} from './html-video-runtime';
import { createElectronHtmlVideoRenderer } from './html-video-renderer';
import { createTrustedIpcRegistrar } from './ipc';
import { openExistingDirectory } from './open-directory';
import { importManagedImageLabRecord } from './image-lab-import';
import { writeWindowsManagedFile } from './windows-managed-file';
import { captureEditorialQa, resolveEditorialQaConfig } from './editorial-qa';
import { ConfigService } from './config-service';
import { CredentialVault } from './credential-vault';
import { HistoryActivityRegistry, type HistoryActivityReservation } from './history-activity-registry';
import {
  backfillLegacyManagedHistoryStorage,
  deleteManagedHistoryWithQuarantine,
  reapHistoryQuarantines,
  resolveManagedHistoryWorkDir,
} from './managed-history-paths';
import {
  finalizeTaskRunIntent,
  requestTaskRunIntent,
  runLatestTaskControlRequest,
  stopTaskRunBeforeArtifactMutation,
  takeHistoryActivityReservation,
  type LatestTaskControlRequestState,
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
    corsEnabled: true,
    stream: true,
  },
}]);
const execFileAsync = promisify(execFile);
let mainWindow: BrowserWindow | null = null;
let viralLoginWindow: BrowserWindow | null = null;
let mainRendererPolicy: RendererPolicy | null = null;
let mainWindowPolicyInstalled = false;
let db: FileDatabase | null = null;
let dbInitializationPromise: Promise<FileDatabase> | null = null;
let configService: ConfigService | null = null;
interface RunningTaskRun extends TaskRunIntentState {
  activityReservation: HistoryActivityReservation | null;
  completion: Promise<void>;
}

interface RunningViralAnalysisRun {
  activityReservation: HistoryActivityReservation | null;
  controller: AbortController;
  completion: Promise<void>;
}

const runningTasks = new Map<string, RunningTaskRun>();
const latestTaskControlRequests = new Map<string, LatestTaskControlRequestState>();
const runningViralAnalyses = new Map<string, RunningViralAnalysisRun>();
const latestViralControlRequests = new Map<string, LatestTaskControlRequestState>();
const historyActivityRegistry = new HistoryActivityRegistry();
const appDeltaHistoryLimit = 512;
const appDeltaHistory: AppDelta[] = [];
let appRevision = 0;
let deltaPublishQueue: Promise<void> = Promise.resolve();
let acceptingAppDeltas = true;
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

const editorialQaConfig = resolveEditorialQaConfig();
const smokeConfig = resolveSmokeConfig();
if (smokeConfig || editorialQaConfig) {
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  app.setPath('userData', smokeConfig?.userDataPath ?? editorialQaConfig!.userData);
}
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance && (smokeConfig || editorialQaConfig)) {
  console.error('Isolated Electron verification could not acquire its userData-scoped instance lock.');
  process.exitCode = 1;
}
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
  if (isShuttingDown) {
    throw new Error('DATABASE_UNAVAILABLE: Application shutdown is in progress.');
  }
  const initialization = dbInitializationPromise ??= initializeDatabase();
  try {
    return await initialization;
  } finally {
    if (dbInitializationPromise === initialization) dbInitializationPromise = null;
  }
}

async function initializeDatabase(): Promise<FileDatabase> {
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
    const candidates = await database.listMissingManagedStorageKeys();
    await backfillLegacyManagedHistoryStorage(
      dir,
      candidates,
      (family, id, managedStorageKey) => database.backfillManagedStorageKey(family, id, managedStorageKey),
    );
    await reapHistoryQuarantines(dir, database);
    await service.migrateLegacySecrets();
    await ensureRuntimeJianyingDraftPath(database, service);
    await seedTaskOperationsEditorialQa(database, dir);
    await seedHtmlVideoEditorialQa(database);
    if (isShuttingDown) {
      throw new Error('DATABASE_INITIALIZATION_CANCELLED: Application shutdown started before database publication.');
    }
    db = database;
    configService = service;
    return database;
  } catch (error) {
    await database.close().catch(() => undefined);
    throw error;
  }
}

async function seedTaskOperationsEditorialQa(database: FileDatabase, dataDir: string): Promise<void> {
  if (editorialQaConfig?.scope !== 'task-operations' && editorialQaConfig?.scope !== 'workflow' && editorialQaConfig?.scope !== 'all') return;
  const createFixture = async (title: string) => {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2));
    return database.createTask({
      title,
      inputText: `${title}的本地确定性 QA 素材`,
      mode: 'ai',
      track: 'character-story',
      ratio: '9:16',
      storyboardSceneCount: 12,
      targetScenes: 12,
      coverImageMode: 'off',
    });
  };

  const archived = await createFixture('QA 永久删除验证记录');
  await database.updateTask(archived.id, { status: 'completed', currentStep: 7, completedAt: new Date().toISOString() });
  await database.archiveTask(archived.id);

  const completed = await createFixture('丝绸之路文化科普');
  const completedOutput = join(dataDir, 'qa-task-operations', 'completed-output');
  await mkdir(completedOutput, { recursive: true });
  await database.updateTask(completed.id, {
    status: 'completed',
    currentStep: 7,
    outputDir: completedOutput,
    completedAt: new Date().toISOString(),
  });

  const paused = await createFixture('夏日轻食产品短片');
  await database.updateTask(paused.id, { status: 'paused', currentStep: 4, errorMessage: '等待用户继续任务' });

  const running = await createFixture('武则天：从深宫才人到一代女皇');
  const fixtureRoot = join(dataDir, 'qa-task-operations', 'running-task');
  const pipelineDir = join(fixtureRoot, 'pipeline');
  const statePath = join(pipelineDir, 'state.json');
  await mkdir(pipelineDir, { recursive: true });
  const scenes = Array.from({ length: 12 }, (_, index) => ({
    id: index + 1,
    cap: ['十四岁入宫', '重返长安', '权力中心', '登临帝位'][index] ?? `历史场景 ${index + 1}`,
    descPrompt: `武则天人物故事场景 ${index + 1}`,
    durationMs: 4200,
  }));
  await writeFile(statePath, `${JSON.stringify({
    version: 1,
    taskId: running.id,
    updatedAt: new Date().toISOString(),
    steps: {
      0: { status: 'completed' },
      1: { status: 'completed' },
      2: { status: 'completed' },
      3: { status: 'completed' },
      4: { status: 'running' },
      5: { status: 'pending' },
      6: { status: 'pending' },
    },
    artifact: {
      reviewedText: '武则天人物生平预审文案。',
      rewrittenCopy: '从深宫才人到一代女皇的故事改写。',
      scenes,
      imagePrompts: scenes.map((scene) => ({
        sceneId: scene.id,
        cap: scene.cap,
        prompt: scene.descPrompt,
        negativePrompt: '',
        style: 'photo-real',
        ratio: '9:16',
        characterProfile: '武则天人物一致性档案',
      })),
    },
    assets: {
      images: scenes.slice(0, 8).map((scene) => ({ sceneId: scene.id, path: join(fixtureRoot, 'images', `scene-${scene.id}.png`) })),
      narration: [],
    },
  }, null, 2)}\n`, 'utf8');
  const startedAt = new Date().toISOString();
  await database.updateTask(running.id, {
    status: 'running',
    currentStep: 4,
    outputDir: fixtureRoot,
    artifactStatePath: statePath,
    startedAt,
    lastHeartbeatAt: startedAt,
  });
  const eventFixtures = [
    { step: 2, agent: 'Storyboard', detail: 'Step 2 分镜 · 共 12 个场景' },
    { step: 3, agent: 'Prompt', detail: 'Step 3 角色与提示词已完成' },
    { step: 4, agent: 'Producer', detail: 'Step 4 批量生图 · 已完成 8 / 12' },
  ];
  for (const [index, event] of eventFixtures.entries()) {
    await database.addTaskEvent(running.id, {
      type: index === eventFixtures.length - 1 ? 'step_progress' : 'step_complete',
      step: event.step,
      agent: event.agent,
      detail: event.detail,
      ts: Date.now() + index,
    });
  }
}

async function seedHtmlVideoEditorialQa(database: FileDatabase): Promise<void> {
  if (editorialQaConfig?.scope !== 'html-video' && editorialQaConfig?.scope !== 'task-operations' && editorialQaConfig?.scope !== 'workflow' && editorialQaConfig?.scope !== 'all') return;
  const copy = [
    '武则天十四岁入宫，十二年间几乎没有被命运看见。',
    '直到唐高宗时代，她重新站回权力中心。',
    '一次次选择，最终改写了她在历史中的位置。',
  ].join('\n\n');
  const input = createHtmlVideoTaskInput({
    copy,
    style: 'modern-cinematic',
    voiceId: 'qa-editorial-voice',
    ttsProvider: 'mock',
    ttsSpeed: 1,
    bgmId: '',
    captionPreset: 'editorial',
    captionAnim: 'fade-up',
    bgmVolume: 'soft',
    transitionType: 'fade',
    coverImageMode: 'auto',
    coverTemplate: 'cinematic-poster',
    coverRatio: '9:16',
    draftTemplate: '',
    foreground: true,
    maxScenes: 3,
    ratio: '9:16',
  });
  const task = await database.createTask({ ...input, title: '武则天：权力之路 HTML 动画' });
  if (!task.managedStorageKey) throw new Error('Editorial QA HTML video fixture has no managed storage key.');
  const taskDirectory = await ensureHtmlVideoTaskWorkDir(app.getPath('userData'), appDataName, task.managedStorageKey);
  const workDir = taskDirectory.workDir.canonicalPath;
  const pipeline = parseHtmlVideoPipelineData(task.pipelineData);
  const sceneMedia = pipeline.scenes.map((scene) => ({
    scene,
    backgroundPath: join(workDir, `scene-${scene.index}-background.png`),
    foregroundPath: join(workDir, `scene-${scene.index}-foreground.png`),
    thumbnailPath: join(workDir, `scene-${scene.index}-thumbnail.png`),
    voicePath: join(workDir, `scene-${scene.index}.wav`),
    htmlPath: join(workDir, `scene-${scene.index}.html`),
  }));
  await Promise.all(sceneMedia.flatMap(({ scene, backgroundPath, foregroundPath, thumbnailPath, voicePath, htmlPath }) => {
    const previewPng = editorialQaHtmlVideoPreviewPng(scene.index);
    return [
      writeFile(backgroundPath, previewPng),
      writeFile(foregroundPath, previewPng),
      writeFile(thumbnailPath, previewPng),
      writeFile(voicePath, editorialQaWavTone(900 + scene.index * 120, 220 + scene.index * 45)),
      writeFile(htmlPath, `<!doctype html><html lang="zh-CN"><body><main><h1>${scene.title}</h1><p>${scene.narration}</p></main></body></html>`, 'utf8'),
    ];
  }));
  pipeline.revision = 4;
  pipeline.current = 'preview';
  pipeline.steps = {
    rewrite: { status: 'completed' },
    planning: { status: 'completed' },
    assets: { status: 'completed' },
    voice: { status: 'completed' },
    preview: { status: 'running' },
    render: { status: 'pending' },
  };
  pipeline.assets = sceneMedia.flatMap(({ scene, backgroundPath, foregroundPath }) => [
    {
      sceneIndex: scene.index,
      kind: 'bg' as const,
      slot: 0,
      src: backgroundPath,
      prompt: scene.background.prompt,
    },
    {
      sceneIndex: scene.index,
      kind: 'fg' as const,
      slot: scene.elements[0]?.slot ?? 0,
      src: foregroundPath,
      prompt: scene.elements[0]?.prompt,
    },
  ]);
  pipeline.voices = sceneMedia.map(({ scene, voicePath }) => ({
    sceneIndex: scene.index,
    src: voicePath,
    durationSec: 1.02,
    text: scene.narration,
  }));
  pipeline.compositions = sceneMedia.map(({ scene, backgroundPath, thumbnailPath, voicePath, htmlPath }) => ({
    index: scene.index,
    durationSec: 4 + scene.index,
    canvas: { w: 720, h: 1280 },
    audio: { src: voicePath, durationSec: 1.02 },
    background: { src: backgroundPath },
    captions: scene.captions.map((text, index) => ({
      id: `${scene.index}-${index + 1}`,
      text,
      startSec: index * 1.2,
      durationSec: 1.2,
    })),
    htmlPath,
    thumbnailPath,
    rev: 1,
  }));
  const startedAt = new Date().toISOString();
  await database.updateTask(task.id, {
    status: 'running',
    currentStep: 4,
    pipelineStep: 'preview',
    pipelineData: JSON.stringify(pipeline),
    outputDir: workDir,
    startedAt,
    lastHeartbeatAt: startedAt,
  });
}

function editorialQaHtmlVideoPreviewPng(sceneIndex: number): Buffer {
  const width = 360;
  const height = 640;
  const bitmap = Buffer.alloc(width * height * 4);
  const accents = [[43, 63, 143], [115, 58, 91], [44, 103, 72]] as const;
  const accent = accents[(sceneIndex - 1) % accents.length];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const isAccent = (y > 238 && y < 250) || (y > 510 && x > 38 && x < width - 38);
      const shade = isAccent ? accent : y < 120 ? [24, 29, 34] : [16, 19, 22];
      bitmap[offset] = shade[2];
      bitmap[offset + 1] = shade[1];
      bitmap[offset + 2] = shade[0];
      bitmap[offset + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(bitmap, { width, height, scaleFactor: 1 }).toPNG();
}

function editorialQaWavTone(durationMs: number, frequency: number): Buffer {
  const sampleRate = 8_000;
  const samples = Math.max(1, Math.floor((sampleRate * durationMs) / 1_000));
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < samples; index += 1) {
    const value = Math.round(Math.sin((index / sampleRate) * Math.PI * 2 * frequency) * 8_000);
    buffer.writeInt16LE(value, 44 + index * 2);
  }
  return buffer;
}

async function runHistoryGovernanceMutation<T>(
  family: HistoryFamily,
  id: string,
  mutate: (database: FileDatabase) => Promise<T>,
): Promise<T> {
  const reservation = historyActivityRegistry.reserveGovernance(family, id);
  try {
    if (family === 'task' && runningTasks.has(id)) {
      throw new Error('HISTORY_ACTIVE: task has an active runtime handle.');
    }
    if (family === 'viral-analysis' && runningViralAnalyses.has(id)) {
      throw new Error('HISTORY_ACTIVE: viral-analysis has an active runtime handle.');
    }
    const database = await getDb();
    return await mutate(database);
  } finally {
    reservation.release();
  }
}

async function deleteHistoryPermanently(
  database: FileDatabase,
  family: HistoryFamily,
  id: string,
): Promise<HistoryTombstone> {
  const target = await database.getHistoryDeletionTarget(family, id);
  if (target.tombstone) return target.tombstone;
  return deleteManagedHistoryWithQuarantine(
    appDataDir(),
    family,
    target.managedStorageKey,
    {
      commit: (cleanup: HistoryDeletionCleanup) => {
        if (family === 'task') return database.deleteTaskPermanently(id, cleanup);
        if (family === 'viral-analysis') return database.deleteViralAnalysisPermanently(id, cleanup);
        if (family === 'image-lab') return database.deleteImageLabRecordPermanently(id, cleanup);
        return database.deleteVoiceLabRecordPermanently(id, cleanup);
      },
      updateCleanup: (cleanupState, diagnostic) =>
        database.updateHistoryTombstoneCleanup(family, id, cleanupState, diagnostic),
    },
  );
}

async function getConfigService(): Promise<ConfigService> {
  await getDb();
  if (!configService) throw new Error('CONFIG_SERVICE_UNAVAILABLE: Configuration service is not initialized.');
  return configService;
}

function publicViralAnalysisDetail(record: ViralAnalysisRecord | null): ViralAnalysisRecord | null {
  if (!record) return null;
  const { checkpoint: _checkpoint, ...detail } = record;
  return detail;
}

async function getPublicState() {
  const state = await (await getConfigService()).getPublicState();
  return { ...state, viralAnalyses: state.viralAnalyses.map((record) => publicViralAnalysisDetail(record)!) };
}

async function ensureRuntimeJianyingDraftPath(database: FileDatabase, service: ConfigService): Promise<void> {
  const metadata = await database.getBootstrapMetadata();
  const current = metadata.config.jianying.draftPath;
  const resolved = resolveRuntimeJianyingDraftPath(current, { pathExists: existsSync });
  if (resolved !== current.trim()) {
    await service.save({
      config: {
        ...metadata.config,
        jianying: {
          ...metadata.config.jianying,
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
    useContentSize: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: !editorialQaConfig,
      sandbox: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  attachMainWindowSecurity(mainWindow, rendererPolicy);
  mainWindowPolicyInstalled = true;

  await getDb();

  if (rendererPolicy.mode === 'development') {
    await mainWindow.loadURL(rendererPolicy.entryUrl);
  } else {
    await mainWindow.loadFile(rendererIndexPath);
  }
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
        if ((document.querySelector('.app-shell') && document.documentElement.dataset.themeReady === 'true') || Date.now() >= deadline) resolve(undefined);
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
      const state = await api.getBootstrap();
      base.ipcStateLoaded = Boolean(state && state.config && Array.isArray(state.tasks?.items));
      if (state && state.ui) {
        const saved = await api.saveUiPreferences({ activeView: 'new-task' });
        base.preloadActionSucceeded = saved?.kind === 'state-patch'
          && saved.patch.kind === 'theme-preference'
          && saved.patch.ui.activeView === 'new-task';
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

async function runEditorialQaCapture(): Promise<void> {
  if (!editorialQaConfig) return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('Editorial QA main window is unavailable.');
  }
  await captureEditorialQa(mainWindow, editorialQaConfig, () => app.getAppMetrics());
  mainWindow.close();
  if (process.platform === 'darwin') app.quit();
}

type AppDeltaPayload =
  | Omit<Extract<AppDelta, { kind: 'task-upsert' }>, 'revision'>
  | Omit<Extract<AppDelta, { kind: 'task-event' }>, 'revision'>
  | Omit<Extract<AppDelta, { kind: 'viral-upsert' }>, 'revision'>
  | Omit<Extract<AppDelta, { kind: 'state-patch' }>, 'revision'>
  | Omit<Extract<AppDelta, { kind: 'task-tombstone' }>, 'revision'>
  | Omit<Extract<AppDelta, { kind: 'viral-tombstone' }>, 'revision'>
  | Omit<Extract<AppDelta, { kind: 'image-lab-tombstone' }>, 'revision'>
  | Omit<Extract<AppDelta, { kind: 'voice-lab-tombstone' }>, 'revision'>;

function publishAppDelta(payload: AppDeltaPayload): AppDelta {
  const delta = { ...payload, revision: ++appRevision } as AppDelta;
  appDeltaHistory.push(delta);
  if (appDeltaHistory.length > appDeltaHistoryLimit) appDeltaHistory.splice(0, appDeltaHistory.length - appDeltaHistoryLimit);
  const target = mainWindow;
  if (!target || target.isDestroyed() || target.webContents.isDestroyed()) return delta;
  try {
    target.webContents.send('app:delta', delta);
  } catch {
    // The history remains available for reconciliation if the renderer closes during send.
  }
  return delta;
}

function enqueueAppDelta(build: () => Promise<AppDeltaPayload | null> | AppDeltaPayload | null): Promise<AppDelta | null> {
  if (!acceptingAppDeltas) return Promise.resolve(null);
  const operation = deltaPublishQueue.then(async () => {
    if (!acceptingAppDeltas) return null;
    const payload = await build();
    return payload ? publishAppDelta(payload) : null;
  });
  deltaPublishQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function publishTaskUpsert(database: FileDatabase, taskId: string): Promise<AppDelta | null> {
  return enqueueAppDelta(async () => {
    const task = await database.getTaskSummary(taskId);
    return task ? { kind: 'task-upsert', task } : null;
  });
}

function publishTaskEvent(event: SequencedTaskEvent): Promise<AppDelta | null> {
  return enqueueAppDelta(() => ({ kind: 'task-event', event }));
}

function publishViralUpsert(database: FileDatabase, analysisId: string): Promise<AppDelta | null> {
  return enqueueAppDelta(async () => {
    const record = await database.getViralAnalysisSummary(analysisId);
    return record ? { kind: 'viral-upsert', record } : null;
  });
}

function publishStatePatch(patch: AppStatePatch): Promise<AppDelta | null> {
  return enqueueAppDelta(() => ({ kind: 'state-patch', patch }));
}

function imageLabSummary(record: ImageLabRecord): ImageLabSummary {
  const { prompt, referenceImagePaths: _paths, referenceImagePath: _path, ...summary } = record;
  return { ...summary, promptPreview: prompt.slice(0, 160) };
}

function voiceLabSummary(record: VoiceLabRecord): VoiceLabSummary {
  const { text, ...summary } = record;
  return { ...summary, textPreview: text.slice(0, 160) };
}

function taskWorkDir(task: Pick<Task, 'managedStorageKey'>): string {
  return resolveManagedHistoryWorkDir(appDataDir(), 'task', task.managedStorageKey);
}

async function htmlVideoTaskDirectory(taskId: string) {
  const task = await (await getDb()).getTaskDetail(taskId);
  if (!task) throw new Error(`HTML_VIDEO_TASK_NOT_FOUND: ${taskId}`);
  resolveManagedHistoryWorkDir(appDataDir(), 'task', task.managedStorageKey);
  return resolveExistingHtmlVideoTaskWorkDir(app.getPath('userData'), appDataName, task.managedStorageKey ?? '');
}

function registerHtmlVideoMediaProtocol(): void {
  protocol.handle(htmlVideoMediaScheme, async (request) => {
    try {
      return await fetchHtmlVideoMediaResponse(
        request.url,
        htmlVideoTaskDirectory,
        (mediaPath, identity) => openHtmlVideoMediaFileResponse(
          mediaPath,
          identity,
          request.headers.get('range'),
        ),
      );
    } catch {
      return htmlVideoMediaResponse(null, { status: 404 });
    }
  });
}

function viralAnalysisWorkDir(record: Pick<ViralAnalysisRecord, 'managedStorageKey'>): string {
  return resolveManagedHistoryWorkDir(appDataDir(), 'viral-analysis', record.managedStorageKey);
}

function imageLabWorkDir(record: Pick<ImageLabRecord, 'managedStorageKey'>): string {
  return resolveManagedHistoryWorkDir(appDataDir(), 'image-lab', record.managedStorageKey);
}

function voiceLabWorkDir(record: Pick<VoiceLabRecord, 'managedStorageKey'>): string {
  return resolveManagedHistoryWorkDir(appDataDir(), 'voice-lab', record.managedStorageKey);
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

async function readViralAnalysisResult(path: string): Promise<ViralAnalysisResult> {
  const bytes = await readFile(path);
  if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('VIRAL_REPORT_TOO_LARGE: Report exceeds 8 MiB.');
  try {
    return JSON.parse(bytes.toString('utf8')) as ViralAnalysisResult;
  } catch (error) {
    throw new Error(`VIRAL_REPORT_INVALID: ${boundViralDiagnosticText(error)}`);
  }
}

async function buildRunOptions(database: FileDatabase, task: Task, workDir: string, controller: AbortController) {
  const [state, runtimeConfig] = await Promise.all([database.getState(), (await getConfigService()).getRuntimeConfig()]);
  return {
    appDataDir: appDataDir(),
    workDir,
    signal: controller.signal,
    resolveAiSourceContext: createAiSourceResearcher(runtimeConfig),
    ...createTaskRuntimeProviders(runtimeConfig, workDir, task),
    customCoverTemplates: state.customCoverTemplates,
    onEvent: (event: SequencedTaskEvent) => {
      void publishTaskEvent(event);
    },
    onHeartbeat: async () => {
      await publishTaskUpsert(database, task.id);
    },
  };
}

function startTaskRun(
  database: FileDatabase,
  task: Task,
  workDir: string,
  activityReservation: HistoryActivityReservation,
): boolean {
  if (isShuttingDown || runningTasks.has(task.id)) {
    activityReservation.release();
    return false;
  }
  try {
    return isHtmlVideoTask(task)
      ? startHtmlVideoTaskRun(database, task, workDir, activityReservation)
      : startStandardTaskRun(database, task, workDir, activityReservation);
  } catch (error) {
    activityReservation.release();
    throw error;
  }
}

function startStandardTaskRun(
  database: FileDatabase,
  task: Task,
  workDir: string,
  activityReservation: HistoryActivityReservation,
): boolean {
  return startOwnedTaskRun(database, task, workDir, activityReservation, 'Background task', async (controller) => {
    await runTask(database, { ...task, status: 'pending', errorMessage: '' }, await buildRunOptions(database, task, workDir, controller));
  });
}

function startHtmlVideoTaskRun(
  database: FileDatabase,
  task: Task,
  workDir: string,
  activityReservation: HistoryActivityReservation,
): boolean {
  const recovery = recoverHtmlVideoPipelineDataForRetry(task);
  const runnableTask = recovery ? { ...task, ...recovery } : task;
  return startOwnedTaskRun(database, task, workDir, activityReservation, 'HTML video task', async (controller) => {
    await runHtmlVideoTask(database, runnableTask, workDir, controller, recovery);
  });
}

function startOwnedTaskRun(
  database: FileDatabase,
  task: Task,
  workDir: string,
  activityReservation: HistoryActivityReservation,
  label: string,
  execute: (controller: AbortController) => Promise<void>,
): boolean {
  const controller = new AbortController();
  const run: RunningTaskRun = {
    activityReservation,
    controller,
    intent: null,
    completion: Promise.resolve(),
  };
  runningTasks.set(task.id, run);
  run.completion = (async () => {
    let reservationTransferred = false;
    try {
      try {
        await execute(controller);
      } catch (error) {
        console.error(`${label} failed`, error);
      }

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
      if (restartTask && !isShuttingDown) {
        const restartReservation = takeHistoryActivityReservation(run);
        const restartedTask = await database.beginTaskRun(restartTask.id);
        await publishTaskUpsert(database, restartTask.id);
        reservationTransferred = startTaskRun(database, restartedTask, workDir, restartReservation);
      }
      if (!isShuttingDown) await publishTaskUpsert(database, task.id);
    } finally {
      if (runningTasks.get(task.id) === run) runningTasks.delete(task.id);
      if (!reservationTransferred && run.activityReservation === activityReservation) {
        run.activityReservation = null;
        activityReservation.release();
      }
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
  const action = intent === 'restart' ? 'retry' : intent === 'paused' ? 'pause' : 'cancel';
  try {
    assertTaskLifecycleAction(latestTask, action, { hasActiveRun: true });
  } catch {
    return null;
  }
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
  workDir: string,
  controller: AbortController,
  recovery: HtmlVideoPipelineRetryPatch | null = null,
): Promise<void> {
  const startedAt = task.startedAt ?? new Date().toISOString();
  let lastState: HtmlVideoPipelineDataV2 | null = null;
  try {
    const taskDirectory = await ensureHtmlVideoTaskWorkDir(app.getPath('userData'), appDataName, task.managedStorageKey ?? '');
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
    await publishTaskUpsert(database, task.id);

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
      draftRootDir: runtimeConfig.jianying.draftPath,
      signal: controller.signal,
      renderer,
      probeMedia,
    });
    const providers = createHtmlVideoRuntimeProviders(runtimeConfig, workDir, task, {
      measureAudioDuration: runtime.measureAudioDuration,
      jobConfig: initialState.config,
      prepareCoverImage: prepareHtmlVideoCoverImage,
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
      taskTitle: task.title,
      resolveCoverTemplate: (id) => database.getCustomCoverTemplateDetail(id),
      resolveDraftTemplate: (id) => database.getDraftTemplateDetail(id),
      createPreviews: runtime.createPreviews,
      render: runtime.render,
      consumeRenderArtifactDigest: runtime.consumeRenderArtifactDigest,
      onCheckpoint: async (state) => {
        lastState = state;
        await persistHtmlVideoTaskCheckpoint(database, task.id, workDir, state, controller.signal);
        await publishTaskUpsert(database, task.id);
      },
    });
    lastState = finalState;
    await persistHtmlVideoTaskCheckpoint(database, task.id, workDir, finalState, controller.signal);
    await publishTaskUpsert(database, task.id);
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
      await publishTaskUpsert(database, task.id);
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
    const event = await database.addTaskEvent(task.id, {
      type: 'step_error',
      step,
      agent: null,
      detail: normalized.message,
      runGeneration: task.runGeneration,
    });
    await publishTaskEvent(event);
    await publishTaskUpsert(database, task.id);
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

async function inspectHtmlVideoCoverImage(sourcePath: string): Promise<HtmlVideoCoverInspection> {
  const value = await stat(sourcePath);
  if (!value.isFile() || value.size <= 0 || value.size > MAX_HTML_VIDEO_COVER_BYTES) {
    throw new Error(`HTML_VIDEO_COVER_SOURCE_INVALID: 封面图片必须是 1 到 ${MAX_HTML_VIDEO_COVER_BYTES} 字节的普通文件。`);
  }
  const extension = extname(sourcePath).toLowerCase();
  const mimeType = extension === '.png'
    ? 'image/png'
    : extension === '.jpg' || extension === '.jpeg'
      ? 'image/jpeg'
      : extension === '.webp'
        ? 'image/webp'
        : '';
  if (!mimeType) throw new Error('HTML_VIDEO_COVER_SOURCE_INVALID: 封面图片格式不受支持。');
  const image = nativeImage.createFromPath(sourcePath);
  if (image.isEmpty()) throw new Error('HTML_VIDEO_COVER_SOURCE_INVALID: 无法解码所选封面图片。');
  const size = image.getSize();
  return {
    sourcePath,
    exists: true,
    isFile: true,
    sizeBytes: value.size,
    width: size.width,
    height: size.height,
    mimeType,
  };
}

const prepareHtmlVideoCoverImage: HtmlVideoCoverImageProcessor = async (input) => {
  input.signal?.throwIfAborted();
  const value = await stat(input.sourcePath);
  if (!value.isFile() || value.size <= 0 || value.size > MAX_HTML_VIDEO_COVER_BYTES) {
    throw new Error('HTML_VIDEO_COVER_SOURCE_INVALID: 封面图片文件大小无效。');
  }
  const source = nativeImage.createFromPath(input.sourcePath);
  if (source.isEmpty()) throw new Error('HTML_VIDEO_COVER_SOURCE_INVALID: 无法解码封面图片。');
  const resized = source.resize({
    width: input.dimensions.width,
    height: input.dimensions.height,
    quality: 'best',
  });
  const size = resized.getSize();
  if (size.width !== input.dimensions.width || size.height !== input.dimensions.height) {
    throw new Error('HTML_VIDEO_COVER_DIMENSIONS_INVALID: 无法生成精确尺寸的封面图片。');
  }
  input.signal?.throwIfAborted();
  const bytes = resized.toPNG();
  if (bytes.length <= 0 || bytes.length > MAX_HTML_VIDEO_COVER_BYTES) {
    throw new Error('HTML_VIDEO_COVER_OUTPUT_INVALID: 规范化后的封面图片大小无效。');
  }
  await writeFile(input.destinationPath, bytes, { flag: 'wx' });
  input.signal?.throwIfAborted();
  return {
    sizeBytes: bytes.length,
    width: size.width,
    height: size.height,
    mimeType: 'image/png',
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
};

function ordinaryTaskCoverPendingPaths(id: string): { image: string; metadata: string } {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(id)) {
    throw new Error('ORDINARY_MANUAL_COVER_ID_INVALID: 手动封面资产标识无效。');
  }
  const root = join(appDataDir(), 'pending-task-covers');
  return { image: join(root, `${id}.png`), metadata: join(root, `${id}.json`) };
}

async function inspectOrdinaryTaskCoverImage(
  sourcePath: string,
  ratio: OrdinaryTaskCoverRatio,
): Promise<OrdinaryTaskCoverInspection & { sourceBytes: Uint8Array }> {
  const value = await stat(sourcePath);
  if (!value.isFile()) {
    throw new Error('ORDINARY_MANUAL_COVER_SOURCE_INVALID: 封面图片必须是普通文件。');
  }
  const sourceBytes = await readFile(sourcePath);
  if (sourceBytes.length <= 0 || sourceBytes.length > MAX_ORDINARY_TASK_COVER_BYTES) {
    throw new Error(`ORDINARY_MANUAL_COVER_SOURCE_INVALID: 封面图片必须是 1 到 ${MAX_ORDINARY_TASK_COVER_BYTES} 字节的普通文件。`);
  }
  const extension = extname(sourcePath).toLowerCase();
  const mimeType = extension === '.png'
    ? 'image/png'
    : extension === '.jpg' || extension === '.jpeg'
      ? 'image/jpeg'
      : extension === '.webp'
        ? 'image/webp'
        : '';
  if (!mimeType) throw new Error('ORDINARY_MANUAL_COVER_SOURCE_INVALID: 封面图片格式不受支持。');
  const image = nativeImage.createFromBuffer(sourceBytes);
  if (image.isEmpty()) throw new Error('ORDINARY_MANUAL_COVER_SOURCE_INVALID: 无法解码所选封面图片。');
  const size = image.getSize();
  const inspection = validateOrdinaryTaskCoverInspection({
    sourcePath,
    exists: true,
    isFile: true,
    sizeBytes: sourceBytes.length,
    width: size.width,
    height: size.height,
    mimeType,
    originalName: basename(sourcePath),
  }, ratio);
  return { ...inspection, sourceBytes };
}

const prepareOrdinaryTaskCoverImage: OrdinaryTaskCoverImageProcessor = async (input) => {
  const source = nativeImage.createFromBuffer(Buffer.from(input.sourceBytes));
  if (source.isEmpty()) throw new Error('ORDINARY_MANUAL_COVER_SOURCE_INVALID: 无法解码封面图片。');
  const resized = source.resize({ width: input.dimensions.width, height: input.dimensions.height, quality: 'best' });
  const size = resized.getSize();
  if (size.width !== input.dimensions.width || size.height !== input.dimensions.height) {
    throw new Error('ORDINARY_MANUAL_COVER_DIMENSIONS_INVALID: 无法生成精确尺寸的封面图片。');
  }
  const bytes = resized.toPNG();
  if (bytes.length <= 0 || bytes.length > MAX_ORDINARY_TASK_COVER_BYTES) {
    throw new Error('ORDINARY_MANUAL_COVER_OUTPUT_INVALID: 规范化后的封面图片大小无效。');
  }
  await writeFile(input.destinationPath, bytes, { flag: 'wx' });
  return {
    sizeBytes: bytes.length,
    width: size.width,
    height: size.height,
    mimeType: 'image/png',
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
};

async function stageOrdinaryTaskCover(
  inspection: OrdinaryTaskCoverInspection & { sourceBytes: Uint8Array },
  ratio: OrdinaryTaskCoverRatio,
): Promise<OrdinaryTaskCoverSelection> {
  validateOrdinaryTaskCoverInspection(inspection, ratio);
  const id = randomUUID();
  const paths = ordinaryTaskCoverPendingPaths(id);
  const root = dirname(paths.image);
  const tempImage = join(root, `.${id}-${randomUUID()}.tmp`);
  await mkdir(root, { recursive: true });
  try {
    const prepared = await prepareOrdinaryTaskCoverImage({
      sourcePath: inspection.sourcePath,
      sourceBytes: inspection.sourceBytes,
      destinationPath: tempImage,
      dimensions: ordinaryTaskCoverDimensions(ratio),
    });
    const asset = createOrdinaryTaskCoverAsset({
      path: 'covers/cover-manual.png',
      originalName: basename(inspection.originalName || inspection.sourcePath).slice(0, 512),
      ...prepared,
      ratio,
      createdAt: new Date().toISOString(),
    });
    const selection = createOrdinaryTaskCoverSelection(id, asset);
    await rename(tempImage, paths.image);
    await writeFile(paths.metadata, JSON.stringify(selection), { encoding: 'utf8', flag: 'wx' });
    return selection;
  } catch (error) {
    await Promise.all([
      rm(tempImage, { force: true }),
      rm(paths.image, { force: true }),
      rm(paths.metadata, { force: true }),
    ]).catch(() => undefined);
    throw error;
  }
}

async function readStagedOrdinaryTaskCover(id: string): Promise<{
  selection: OrdinaryTaskCoverSelection;
  inspection: OrdinaryTaskCoverInspection;
  bytes: Uint8Array;
}> {
  const paths = ordinaryTaskCoverPendingPaths(id);
  const selection = validateOrdinaryTaskCoverSelection(JSON.parse(await readFile(paths.metadata, 'utf8')));
  if (selection.id !== id) throw new Error('ORDINARY_MANUAL_COVER_ID_INVALID: 手动封面元数据不匹配。');
  const inspected = await inspectOrdinaryTaskCoverImage(paths.image, selection.ratio);
  const { sourceBytes: bytes, ...inspection } = inspected;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== selection.sizeBytes || sha256 !== selection.sha256) {
    throw new Error('ORDINARY_MANUAL_COVER_TAMPERED: 手动封面暂存文件已变化，请重新导入。');
  }
  return {
    selection,
    inspection: { ...inspection, originalName: selection.originalName },
    bytes,
  };
}

async function removeStagedOrdinaryTaskCover(id: string): Promise<void> {
  const paths = ordinaryTaskCoverPendingPaths(id);
  await Promise.all([rm(paths.image, { force: true }), rm(paths.metadata, { force: true })]);
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
  workDir: string,
  shouldStart: () => boolean = () => true,
  transferReservation?: () => HistoryActivityReservation,
  beforeStart?: (runningTask: Task) => Promise<void>,
): Promise<boolean> {
  if (isShuttingDown) return false;
  const existingRun = runningTasks.get(task.id);
  if (existingRun) {
    if (!existingRun.activityReservation) {
      if (!transferReservation) {
        throw new Error('HISTORY_ACTIVITY_RESERVATION_REQUIRED: A task restart requires an active reservation.');
      }
      existingRun.activityReservation = transferReservation();
    }
    requestTaskRunIntent(existingRun, 'restart', '用户重试');
    await database.updateTask(task.id, {
      errorMessage: '正在停止当前运行，随后继续重试。',
      lastHeartbeatAt: new Date().toISOString(),
    });
    return false;
  }
  await database.updateTask(task.id, { status: 'pending', errorMessage: '' });
  if (!shouldStart()) return false;
  if (!transferReservation) {
    throw new Error('HISTORY_ACTIVITY_RESERVATION_REQUIRED: A task run requires an active reservation.');
  }
  const runningTask = await database.beginTaskRun(task.id);
  await publishTaskUpsert(database, task.id);
  await beforeStart?.(runningTask);
  if (!shouldStart()) return false;
  return startTaskRun(
    database,
    { ...runningTask, status: 'pending', errorMessage: '' },
    workDir,
    transferReservation(),
  );
}

async function resumeLatestTaskRun(
  database: FileDatabase,
  taskId: string,
  workDir: string,
  isCurrent: () => boolean,
  transferReservation: () => HistoryActivityReservation,
  beforeStart?: (runningTask: Task) => Promise<void>,
): Promise<boolean> {
  if (!isCurrent()) return false;
  const updatedTask = (await database.getState()).tasks.find((item) => item.id === taskId);
  if (!updatedTask || !isCurrent()) return false;
  return resumeTaskRun(database, updatedTask, workDir, isCurrent, transferReservation, beforeStart);
}

function startViralAnalysisRun(
  database: FileDatabase,
  record: ViralAnalysisRecord,
  workDir: string,
  activityReservation: HistoryActivityReservation,
): boolean {
  if (isShuttingDown || runningViralAnalyses.has(record.id)) {
    activityReservation.release();
    return false;
  }
  const controller = new AbortController();
  const run: RunningViralAnalysisRun = {
    activityReservation,
    controller,
    completion: Promise.resolve(),
  };
  runningViralAnalyses.set(record.id, run);
  run.completion = (async () => {
    const startedAt = new Date().toISOString();
    const runGeneration = record.runGeneration ?? 0;
    const resumeState = viralCheckpointResumeState(record.checkpoint);
    let lastStage = resumeState.stage;
    try {
      const runtimeConfig = await (await getConfigService()).getRuntimeConfig();
      if (!await database.updateViralAnalysisForGeneration(record.id, runGeneration, {
        status: 'running',
        currentStage: resumeState.stage,
        progress: resumeState.progress,
        errorMessage: '',
        startedAt,
        lastHeartbeatAt: startedAt,
      })) return;
      await publishViralUpsert(database, record.id);
      const completed = await runViralAnalysis(record, {
        workDir,
        signal: controller.signal,
        resumeFrom: record.checkpoint,
        persistCheckpoint: async (checkpoint) => {
          if (!await database.updateViralAnalysisForGeneration(record.id, runGeneration, { checkpoint })) {
            throw new Error('STALE_VIRAL_RUN: Checkpoint generation is no longer current.');
          }
        },
        ...createViralRuntimeProviders(runtimeConfig, workDir),
        emit: async (event) => {
          lastStage = event.stage as ViralAnalysisRecord['currentStage'];
          await database.addViralAnalysisEvent(record.id, {
            type: event.type,
            stage: event.stage,
            detail: event.detail,
            dataJson: event.data === undefined ? null : JSON.stringify(event.data),
            runGeneration,
          });
          const patch: Parameters<FileDatabase['updateViralAnalysis']>[1] = {
            currentStage: event.stage as ViralAnalysisRecord['currentStage'],
            lastHeartbeatAt: new Date().toISOString(),
          };
          if (typeof event.progress === 'number') patch.progress = event.progress;
          if (!await database.updateViralAnalysisForGeneration(record.id, runGeneration, {
            ...patch,
          })) throw new Error('STALE_VIRAL_RUN: Event generation is no longer current.');
          await publishViralUpsert(database, record.id);
        },
      });
      const completedAt = new Date().toISOString();
      await database.updateViralAnalysisForGeneration(record.id, runGeneration, {
        status: 'completed',
        currentStage: 'completed',
        progress: 1,
        resultPath: completed.resultPath,
        videoPath: completed.videoPath,
        resultGeneration: runGeneration,
        title: completed.result.source.title || record.title,
        completedAt,
        lastHeartbeatAt: completedAt,
      });
    } catch (error) {
      const message = boundViralDiagnosticText(error);
      const paused = controller.signal.aborted && /暂停/i.test(String(controller.signal.reason ?? message));
      const cancelled = controller.signal.aborted && !paused;
      const terminalStatus = paused ? 'paused' : cancelled ? 'cancelled' : 'failed';
      await database.addViralAnalysisEvent(record.id, {
        type: paused ? 'paused' : cancelled ? 'cancelled' : 'error',
        stage: paused || cancelled ? lastStage : 'failed',
        detail: paused ? '用户暂停' : cancelled ? '用户取消' : message,
        runGeneration,
      }).catch((eventError) => {
        if (!/STALE_VIRAL_RUN/.test(String(eventError))) throw eventError;
      });
      await database.updateViralAnalysisForGeneration(record.id, runGeneration, {
        status: terminalStatus,
        currentStage: paused || cancelled ? lastStage : 'failed',
        errorMessage: paused ? '' : cancelled ? '用户取消' : message,
        lastHeartbeatAt: new Date().toISOString(),
      });
    } finally {
      try {
        if (runningViralAnalyses.get(record.id) === run) {
          runningViralAnalyses.delete(record.id);
        }
        if (!isShuttingDown) await publishViralUpsert(database, record.id);
      } finally {
        if (run.activityReservation === activityReservation) {
          run.activityReservation = null;
          activityReservation.release();
        }
      }
    }
  })();
  void run.completion.catch((error) => {
    console.error('Background viral analysis cleanup failed', error);
  });
  return true;
}

async function resumeViralAnalysisRun(
  database: FileDatabase,
  record: ViralAnalysisRecord,
  workDir: string,
  isCurrent: () => boolean,
  transferReservation: () => HistoryActivityReservation,
): Promise<boolean> {
  if (isShuttingDown || !isCurrent()) return false;
  const begun = await database.beginViralAnalysisRun(record.id);
  const checkpoint = begun.checkpoint ? { ...begun.checkpoint, runGeneration: begun.runGeneration ?? 0 } : null;
  await database.updateViralAnalysisForGeneration(record.id, begun.runGeneration ?? 0, { checkpoint });
  if (isShuttingDown || !isCurrent()) return false;
  return startViralAnalysisRun(
    database,
    { ...begun, checkpoint },
    workDir,
    transferReservation(),
  );
}

async function reconcileAppDeltas(database: FileDatabase, input: AppDeltaReconcileRequest): Promise<AppDeltaReconcileResult> {
  await deltaPublishQueue;
  const firstAvailableRevision = appDeltaHistory[0]?.revision ?? appRevision + 1;
  const resetRequired = input.forceReset === true
    || (input.sinceRevision < appRevision && input.sinceRevision < firstAvailableRevision - 1);
  const [task, taskEvents, viralAnalysis, viralEvents] = await Promise.all([
    input.taskId ? database.getTaskDetail(input.taskId) : Promise.resolve(null),
    input.taskId ? database.listTaskEvents(input.taskId, { limit: 100 }) : Promise.resolve({ items: [], nextCursor: null }),
    input.viralAnalysisId
      ? database.getViralAnalysisDetail(input.viralAnalysisId).then(publicViralAnalysisDetail)
      : Promise.resolve(null),
    input.viralAnalysisId ? database.listViralAnalysisEvents(input.viralAnalysisId, { limit: 100 }) : Promise.resolve({ items: [], nextCursor: null }),
  ]);
  return {
    revision: appRevision,
    deltas: resetRequired ? [] : appDeltaHistory.filter((delta) => delta.revision > input.sinceRevision),
    resetRequired,
    task,
    taskEvents: taskEvents.items,
    viralAnalysis,
    viralEvents: viralEvents.items,
  };
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

trustedHandle('app:get-bootstrap', async () => {
  await deltaPublishQueue;
  return (await getConfigService()).getBootstrapState(appRevision);
});

trustedHandle('app:reconcile-deltas', async (_event, input: AppDeltaReconcileRequest) => {
  return reconcileAppDeltas(await getDb(), input);
});

trustedHandle('task:list', async (_event, request: Extract<HistoryListRequest, { family: 'task' }>) => (await getDb()).listTaskSummaries(request));
trustedHandle('task:get-detail', async (_event, id: string) => (await getDb()).getTaskDetail(id));
trustedHandle('task:list-events', async (_event, input: { taskId: string } & CursorRequest) =>
  (await getDb()).listTaskEvents(input.taskId, input));
trustedHandle('task:open-output-directory', async (_event, id: string) => {
  const database = await getDb();
  const task = await database.getTaskDetail(id);
  if (!task) throw new Error(`任务不存在或已删除：${id}`);
  const directory = isHtmlVideoTask(task)
    ? (await htmlVideoTaskDirectory(task.id)).workDir.canonicalPath
    : task.outputDir.trim();
  if (!directory) throw new Error('任务尚未生成输出目录。');
  await openExistingDirectory(directory, (path) => shell.openPath(path));
});
trustedHandle('viral:list', async (_event, request: Extract<HistoryListRequest, { family: 'viral-analysis' }>) => (await getDb()).listViralAnalyses(request));
trustedHandle('viral:get-detail', async (_event, id: string) => publicViralAnalysisDetail(await (await getDb()).getViralAnalysisDetail(id)));
trustedHandle('viral:list-events', async (_event, input: { analysisId: string } & CursorRequest) =>
  (await getDb()).listViralAnalysisEvents(input.analysisId, input));
trustedHandle('image-lab:list', async (_event, request: Extract<HistoryListRequest, { family: 'image-lab' }>) => (await getDb()).listImageLabRecords(request));
trustedHandle('image-lab:get-detail', async (_event, id: string) => (await getDb()).getImageLabRecordDetail(id));
trustedHandle('voice-lab:list', async (_event, request: Extract<HistoryListRequest, { family: 'voice-lab' }>) => (await getDb()).listVoiceLabRecords(request));
trustedHandle('voice-lab:get-detail', async (_event, id: string) => (await getDb()).getVoiceLabRecordDetail(id));
trustedHandle('task:archive', (_event, id: string) =>
  runHistoryGovernanceMutation('task', id, async (database) => {
    const task = await database.archiveTask(id);
    return await enqueueAppDelta(() => ({ kind: 'task-upsert', task }));
  }));
trustedHandle('task:restore', (_event, id: string) =>
  runHistoryGovernanceMutation('task', id, async (database) => {
    const task = await database.restoreTask(id);
    return await enqueueAppDelta(() => ({ kind: 'task-upsert', task }));
  }));
trustedHandle('task:delete', (_event, id: string) =>
  runHistoryGovernanceMutation('task', id, async (database) => {
    await deleteHistoryPermanently(database, 'task', id);
    return await enqueueAppDelta(() => ({ kind: 'task-tombstone', id }));
  }));
trustedHandle('viral:archive', (_event, id: string) =>
  runHistoryGovernanceMutation('viral-analysis', id, async (database) => {
    const record = await database.archiveViralAnalysis(id);
    return await enqueueAppDelta(() => ({ kind: 'viral-upsert', record }));
  }));
trustedHandle('viral:restore', (_event, id: string) =>
  runHistoryGovernanceMutation('viral-analysis', id, async (database) => {
    const record = await database.restoreViralAnalysis(id);
    return await enqueueAppDelta(() => ({ kind: 'viral-upsert', record }));
  }));
trustedHandle('viral:delete', (_event, id: string) =>
  runHistoryGovernanceMutation('viral-analysis', id, async (database) => {
    await deleteHistoryPermanently(database, 'viral-analysis', id);
    return await enqueueAppDelta(() => ({ kind: 'viral-tombstone', id }));
  }));
trustedHandle('image-lab:archive', (_event, id: string) =>
  runHistoryGovernanceMutation('image-lab', id, async (database) => {
    const record = await database.archiveImageLabRecord(id);
    return await enqueueAppDelta(() => ({ kind: 'state-patch', patch: { kind: 'image-lab-upsert', record } }));
  }));
trustedHandle('image-lab:restore', (_event, id: string) =>
  runHistoryGovernanceMutation('image-lab', id, async (database) => {
    const record = await database.restoreImageLabRecord(id);
    return await enqueueAppDelta(() => ({ kind: 'state-patch', patch: { kind: 'image-lab-upsert', record } }));
  }));
trustedHandle('image-lab:delete', (_event, id: string) =>
  runHistoryGovernanceMutation('image-lab', id, async (database) => {
    await deleteHistoryPermanently(database, 'image-lab', id);
    return await enqueueAppDelta(() => ({ kind: 'image-lab-tombstone', id }));
  }));
trustedHandle('voice-lab:archive', (_event, id: string) =>
  runHistoryGovernanceMutation('voice-lab', id, async (database) => {
    const record = await database.archiveVoiceLabRecord(id);
    return await enqueueAppDelta(() => ({ kind: 'state-patch', patch: { kind: 'voice-lab-upsert', record } }));
  }));
trustedHandle('voice-lab:restore', (_event, id: string) =>
  runHistoryGovernanceMutation('voice-lab', id, async (database) => {
    const record = await database.restoreVoiceLabRecord(id);
    return await enqueueAppDelta(() => ({ kind: 'state-patch', patch: { kind: 'voice-lab-upsert', record } }));
  }));
trustedHandle('voice-lab:delete', (_event, id: string) =>
  runHistoryGovernanceMutation('voice-lab', id, async (database) => {
    await deleteHistoryPermanently(database, 'voice-lab', id);
    return await enqueueAppDelta(() => ({ kind: 'voice-lab-tombstone', id }));
  }));
trustedHandle('prompt-template:list', async (_event, request: CursorRequest) => (await getDb()).listPromptTemplateSummaries(request));
trustedHandle('prompt-template:get-detail', async (_event, id: string) => (await getDb()).getPromptTemplateDetail(id));
trustedHandle('draft-template:list', async (_event, request: CursorRequest) => (await getDb()).listDraftTemplateSummaries(request));
trustedHandle('draft-template:get-detail', async (_event, id: string) => (await getDb()).getDraftTemplateDetail(id));
trustedHandle('minimax-clone-voice:list', async (_event, request: CursorRequest) => (await getDb()).listMinimaxCloneVoices(request));
trustedHandle('minimax-clone-voice:save', async (_event, input: MinimaxCloneVoiceInput) => {
  const database = await getDb();
  const existing = await database.getMinimaxCloneVoice(input.voiceId);
  const voice = await database.upsertMinimaxCloneVoice(mergeMinimaxCloneVoice(existing, input));
  return publishStatePatch({ kind: 'minimax-clone-voice-upsert', voice });
});
trustedHandle('minimax-clone-voice:delete', async (_event, voiceId: string) => {
  const database = await getDb();
  await database.deleteMinimaxCloneVoice(voiceId);
  return publishStatePatch({ kind: 'minimax-clone-voice-delete', voiceId });
});

trustedHandle('app:save-config', async (_event, input) => {
  const saved = await (await getConfigService()).save(input);
  return publishStatePatch({ kind: 'config', ...saved });
});

trustedHandle('llm:test-config', async (_event, config: LlmConfig) => {
  if (config.apiKey) return testConfiguredLlm(config);
  const runtime = await (await getConfigService()).getRuntimeConfig();
  const stored = runtime.llmProfiles.find((profile) => profile.id === config.id)
    ?? (runtime.llm.id === config.id ? runtime.llm : null);
  if (!stored) {
    throw new Error('LLM_TEST_PROFILE_NOT_PERSISTED: Save the selected LLM profile before testing it.');
  }
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

trustedHandle('ima:fetch-knowledge', async (_event, input: ImaKnowledgeRequest) => {
  const runtimeConfig = await (await getConfigService()).getRuntimeConfig();
  return fetchImaKnowledge(runtimeConfig.ima, input);
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
  const saved = await database.upsertPromptTemplate(template);
  return publishStatePatch({ kind: 'prompt-template-upsert', template: saved });
});

trustedHandle('prompt-template:reset', async () => {
  const database = await getDb();
  await database.resetPromptTemplates();
  return publishStatePatch({ kind: 'prompt-templates-reset', templates: await database.listBuiltinPromptTemplateSummaries() });
});

trustedHandle('custom-style:save', async (_event, style: CustomStyle) => {
  const database = await getDb();
  const saved = await database.upsertCustomStyle(style);
  return publishStatePatch({ kind: 'custom-style-upsert', style: saved });
});

trustedHandle('viral:save-templates', async (_event, input) => {
  const saved = await (await getDb()).saveViralTemplatesAtomically(input);
  return publishStatePatch({ kind: 'viral-templates-upsert', ...saved });
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
  const saved = await database.upsertDraftTemplate(template);
  return publishStatePatch({ kind: 'draft-template-upsert', template: saved });
});

trustedHandle('image-lab:generate', async (_event, input: ImageLabGenerateInput) => {
  const id = input.id ?? randomUUID();
  const activityReservation = historyActivityRegistry.reserveActive('image-lab', id);
  try {
    const database = await getDb();
    const record = {
      ...input,
      id,
      provider: input.provider ?? 'mock',
      status: 'failed',
      errorMessage: 'Image generation was interrupted before completion.',
      finishedAt: null,
    } as const;
    const initial = await database.addImageLabRecord(record);
    try {
      const runtimeConfig = await (await getConfigService()).getRuntimeConfig();
      const generatedRecord = await generateImageLabRecord(
        runtimeConfig,
        imageLabWorkDir({ managedStorageKey: initial.managedStorageKey }),
        { ...input, id },
      );
      const saved = await database.updateImageLabRecord(id, generatedRecord);
      return await publishStatePatch({ kind: 'image-lab-upsert', record: imageLabSummary(saved) });
    } catch (error) {
      const failed = await database.updateImageLabRecord(id, {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
        finishedAt: new Date().toISOString(),
      });
      await publishStatePatch({ kind: 'image-lab-upsert', record: imageLabSummary(failed) });
      throw error;
    }
  } finally {
    activityReservation.release();
  }
});

trustedHandle('image-lab:add-record', async (_event, input) => {
  const database = await getDb();
  const saved = await importManagedImageLabRecord(
    appDataDir(),
    input,
    (record) => database.addImageLabRecord(record),
    {
      inspectImage: (bytes) => {
        const image = nativeImage.createFromBuffer(bytes);
        if (image.isEmpty()) throw new Error('IMAGE_LAB_IMPORT_SOURCE_INVALID: Electron could not decode the selected image.');
        return image.getSize();
      },
      writeDestination: writeWindowsManagedFile,
    },
  );
  return publishStatePatch({ kind: 'image-lab-upsert', record: imageLabSummary(saved) });
});

trustedHandle('voice-lab:generate', async (_event, input: VoiceLabGenerateInput) => {
  const id = input.id ?? randomUUID();
  const activityReservation = historyActivityRegistry.reserveActive('voice-lab', id);
  try {
    const database = await getDb();
    const record = {
      ...input,
      id,
      status: 'failed',
      errorMessage: 'Voice generation was interrupted before completion.',
      finishedAt: null,
    } as const;
    const initial = await database.addVoiceLabRecord(record);
    try {
      const runtimeConfig = await (await getConfigService()).getRuntimeConfig();
      const generatedRecord = await generateConfiguredVoicePreview(
        runtimeConfig,
        voiceLabWorkDir({ managedStorageKey: initial.managedStorageKey }),
        { ...input, id },
      );
      const saved = await database.updateVoiceLabRecord(id, generatedRecord);
      return await publishStatePatch({ kind: 'voice-lab-upsert', record: voiceLabSummary(saved) });
    } catch (error) {
      const failed = await database.updateVoiceLabRecord(id, {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
        finishedAt: new Date().toISOString(),
      });
      await publishStatePatch({ kind: 'voice-lab-upsert', record: voiceLabSummary(failed) });
      throw error;
    }
  } finally {
    activityReservation.release();
  }
});

trustedHandle('account:save', async (_event, account: AccountProfile) => {
  const database = await getDb();
  await database.upsertAccount(account);
  return publishStatePatch({ kind: 'account', account });
});

trustedHandle('activation:save', async (_event, activation: ActivationState) => {
  const database = await getDb();
  await database.upsertActivation(activation);
  return publishStatePatch({ kind: 'activation', activation });
});

trustedHandle('ui:save-preferences', async (_event, update: UiPreferencesUpdate) => {
  const database = await getDb();
  const persisted = await database.upsertUiPreferences(update);
  return publishStatePatch({ kind: 'theme-preference', ui: persisted.ui, config: persisted.config });
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

trustedHandle('person-assets:open-directory', async (_event, name: string) => {
  const root = personAssetsRoot();
  const asset = (await listPersonAssets(root)).find((asset) => asset.name === name);
  if (!asset) throw new Error(`人物素材库不存在或已删除：${name}`);
  await openExistingDirectory(asset.dir, (path) => shell.openPath(path), { allowedRoot: root });
});

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
  const activityReservation = historyActivityRegistry.reserveActive('task', task.id);
  let reservationTransferred = false;
  try {
    const runningTask = await database.beginTaskRun(task.id);
    const workDir = taskWorkDir(task);
    const delta = await publishTaskUpsert(database, task.id);
    reservationTransferred = startTaskRun(database, runningTask, workDir, activityReservation);
    return delta;
  } finally {
    if (!reservationTransferred) activityReservation.release();
  }
});

trustedHandle('html-video:update-config', (_event, input: { id: string; changes: HtmlVideoConfigChange[] }) =>
  runHistoryGovernanceMutation('task', input.id, async (database) => {
    const result = await database.updateHtmlVideoTaskConfig(input.id, input.changes);
    return await enqueueAppDelta(() => ({ kind: 'task-upsert', task: result.task }));
  }));

trustedHandle('html-video:import-cover', (_event, id: string) =>
  runHistoryGovernanceMutation('task', id, async (database) => {
    const task = await database.getTaskDetail(id);
    if (!task || !isHtmlVideoTask(task)) {
      throw new Error('HTML_VIDEO_TASK_NOT_FOUND: HTML 视频任务不存在。');
    }
    if (task.archivedAt) throw new Error('HISTORY_ARCHIVED: 已归档任务只读。');
    if (task.status === 'pending' || task.status === 'running') {
      throw new Error(`HTML_VIDEO_COVER_ACTIVE: ${id} is ${task.status} and cannot import a cover.`);
    }
    const result = await dialog.showOpenDialog({
      title: '导入 HTML 视频封面',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const sourcePath = result.filePaths[0];
    const inspection = await inspectHtmlVideoCoverImage(sourcePath);
    await database.importHtmlVideoCover(id, inspection, {
      prepareImage: prepareHtmlVideoCoverImage,
      promoteFile: (source, target) => rename(source, target),
      removeFile: async (path) => { await rm(path, { force: true }); },
      ensureDirectory: async (path) => { await mkdir(path, { recursive: true }); },
      now: () => new Date().toISOString(),
    });
    return publishTaskUpsert(database, id);
  }));

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
  const task = await database.getTaskDetail(id);
  if (!task || !isHtmlVideoTask(task)) {
    throw new Error('HTML_VIDEO_TASK_NOT_FOUND: HTML 视频任务不存在。');
  }
  return task;
}

trustedHandle('task:import-cover', async (_event, ratio: OrdinaryTaskCoverRatio) => {
  const result = await dialog.showOpenDialog({
    title: `导入普通任务封面（${ratio}）`,
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const inspection = await inspectOrdinaryTaskCoverImage(result.filePaths[0], ratio);
  return stageOrdinaryTaskCover(inspection, ratio);
});

trustedHandle('task:create-and-run', async (_event, input: CreateTaskInput) => {
  const database = await getDb();
  let task: Task;
  if (input.coverImageMode === 'manual') {
    if (!input.manualCoverAssetId) {
      throw new Error('ORDINARY_MANUAL_COVER_REQUIRED: 请先导入手动封面。');
    }
    const staged = await readStagedOrdinaryTaskCover(input.manualCoverAssetId);
    if ((input.ratio ?? '9:16') !== staged.selection.ratio) {
      throw new Error('ORDINARY_MANUAL_COVER_RATIO_MISMATCH: 当前画面比例与已导入封面不一致，请重新导入。');
    }
    task = await database.createTaskWithOrdinaryCover({ ...input }, { ...staged.inspection, sourceBytes: staged.bytes }, staged.selection.ratio, {
      prepareImage: prepareOrdinaryTaskCoverImage,
      promoteFile: (source, target) => rename(source, target),
      removeFile: async (path) => { await rm(path, { force: true }); },
      ensureDirectory: async (path) => { await mkdir(path, { recursive: true }); },
      now: () => new Date().toISOString(),
    });
    await removeStagedOrdinaryTaskCover(input.manualCoverAssetId).catch(() => undefined);
  } else {
    if (input.manualCoverAssetId) {
      throw new Error('ORDINARY_MANUAL_COVER_MODE_MISMATCH: 手动封面资产只能用于手动封面模式。');
    }
    task = await database.createTask(input);
  }
  const activityReservation = historyActivityRegistry.reserveActive('task', task.id);
  let reservationTransferred = false;
  try {
    const runningTask = await database.beginTaskRun(task.id);
    const workDir = taskWorkDir(task);
    const delta = await publishTaskUpsert(database, task.id);
    reservationTransferred = startTaskRun(database, runningTask, workDir, activityReservation);
    return delta;
  } finally {
    if (!reservationTransferred) activityReservation.release();
  }
});

trustedHandle('viral:create-and-run', async (_event, input: CreateViralAnalysisInput) => {
  const database = await getDb();
  const record = await database.createViralAnalysis({
    ...input,
    platform: input.platform && input.platform !== 'unknown' ? input.platform : detectViralPlatform(input.url),
  });
  const activityReservation = historyActivityRegistry.reserveActive('viral-analysis', record.id);
  let reservationTransferred = false;
  try {
    const runningRecord = await database.beginViralAnalysisRun(record.id);
    const workDir = viralAnalysisWorkDir(record);
    const delta = await publishViralUpsert(database, record.id);
    reservationTransferred = startViralAnalysisRun(database, runningRecord, workDir, activityReservation);
    return delta;
  } finally {
    if (!reservationTransferred) activityReservation.release();
  }
});

trustedHandle('viral:update-status', async (_event, input: { id: string; status: ViralAnalysisStatus }) => {
  const isControlRequest = input.status === 'running' || input.status === 'paused' || input.status === 'cancelled';
  if (!isControlRequest) {
    const database = await getDb();
    const record = (await database.getState()).viralAnalyses.find((item) => item.id === input.id);
    return record ? publishViralUpsert(database, input.id) : null;
  }
  const existingRunAtEntry = runningViralAnalyses.get(input.id);
  return runLatestTaskControlRequest(latestViralControlRequests, input.id, async (isCurrent, transferReservation) => {
    if (existingRunAtEntry && isCurrent() && !existingRunAtEntry.controller.signal.aborted) {
      existingRunAtEntry.controller.abort(
        input.status === 'cancelled' ? '用户取消' : input.status === 'paused' ? '用户暂停' : '用户重试',
      );
    }
    if (existingRunAtEntry) await existingRunAtEntry.completion.catch(() => undefined);
    if (!isCurrent()) return null;
    const database = await getDb();
    if (!isCurrent()) return null;
    const state = await database.getState();
    if (!isCurrent()) return null;
    const record = state.viralAnalyses.find((item) => item.id === input.id);
    if (!record) return null;
    if (input.status === 'running') {
      const workDir = viralAnalysisWorkDir(record);
      await resumeViralAnalysisRun(database, record, workDir, isCurrent, transferReservation);
      if (!isCurrent()) return null;
      return publishViralUpsert(database, record.id);
    }
    if (input.status === 'paused' || input.status === 'cancelled') {
      await database.updateViralAnalysis(input.id, {
        status: input.status,
        errorMessage: input.status === 'cancelled' ? '用户取消' : record.errorMessage,
        lastHeartbeatAt: new Date().toISOString(),
      });
      if (!isCurrent()) return null;
      return publishViralUpsert(database, input.id);
    }
    return publishViralUpsert(database, input.id);
  }, () => existingRunAtEntry?.activityReservation
    ? takeHistoryActivityReservation(existingRunAtEntry)
    : historyActivityRegistry.reserveActive('viral-analysis', input.id));
});

trustedHandle('viral:retry', async (_event, id: string) => {
  const existingRunAtEntry = runningViralAnalyses.get(id);
  return runLatestTaskControlRequest(latestViralControlRequests, id, async (isCurrent, transferReservation) => {
    if (existingRunAtEntry && isCurrent() && !existingRunAtEntry.controller.signal.aborted) {
      existingRunAtEntry.controller.abort('用户重试');
    }
    if (existingRunAtEntry) await existingRunAtEntry.completion.catch(() => undefined);
    if (!isCurrent()) return null;
    const database = await getDb();
    if (!isCurrent()) return null;
    const state = await database.getState();
    if (!isCurrent()) return null;
    const record = state.viralAnalyses.find((item) => item.id === id);
    if (record) {
      const workDir = viralAnalysisWorkDir(record);
      await resumeViralAnalysisRun(database, record, workDir, isCurrent, transferReservation);
      if (!isCurrent()) return null;
      return publishViralUpsert(database, id);
    }
    return null;
  }, () => existingRunAtEntry?.activityReservation
    ? takeHistoryActivityReservation(existingRunAtEntry)
    : historyActivityRegistry.reserveActive('viral-analysis', id));
});

trustedHandle('viral:get-result', async (_event, id: string) => {
  const database = await getDb();
  const state = await database.getState();
  const record = state.viralAnalyses.find((item) => item.id === id);
  if (!record?.resultPath
    || record.status !== 'completed'
    || record.resultGeneration !== record.runGeneration) throw new Error(`Viral analysis result is not available for the current generation: ${id}`);
  return readViralAnalysisResult(record.resultPath);
});

trustedHandle('viral:create-production-task', async (_event, input: { id: string; options?: ViralProductionTaskOptions }) => {
  const database = await getDb();
  const state = await database.getState();
  const record = state.viralAnalyses.find((item) => item.id === input.id);
  if (!record?.resultPath
    || record.status !== 'completed'
    || record.resultGeneration !== record.runGeneration) throw new Error(`Viral analysis result is not available for the current generation: ${input.id}`);
  if (record.archivedAt) throw new Error(`VIRAL_ANALYSIS_ARCHIVED: ${input.id}`);
  const result = await readViralAnalysisResult(record.resultPath);
  const taskInput = createViralProductionTaskInput(result, {
    track: record.settings.track,
    style: record.settings.style,
    ratio: record.settings.ratio,
    templateId: record.settings.templateId,
    storyboardSceneCount: record.settings.storyboardSceneCount,
    ...input.options,
  });
  const task = await database.createTask(taskInput);
  const activityReservation = historyActivityRegistry.reserveActive('task', task.id);
  let reservationTransferred = false;
  try {
    const runningTask = await database.beginTaskRun(task.id);
    const workDir = taskWorkDir(task);
    const delta = await publishTaskUpsert(database, task.id);
    reservationTransferred = startTaskRun(database, runningTask, workDir, activityReservation);
    return delta;
  } finally {
    if (!reservationTransferred) activityReservation.release();
  }
});

trustedHandle('task:update-status', async (_event, input: { id: string; status: TaskStatus }) => {
  const isControlRequest = input.status === 'running' || input.status === 'paused' || input.status === 'cancelled';
  if (!isControlRequest) return null;
  const existingControlRun = runningTasks.get(input.id);
  const existingActiveRun = input.status === 'running' && existingControlRun?.activityReservation
    ? existingControlRun
    : undefined;
  return runLatestTaskControlRequest(latestTaskControlRequests, input.id, async (isCurrent, transferReservation) => {
    if (existingControlRun && isCurrent()) {
      if (input.status === 'running' && !existingControlRun.activityReservation) {
        existingControlRun.activityReservation = transferReservation();
      }
      const intent = input.status === 'running'
        ? 'restart'
        : input.status === 'paused'
          ? 'paused'
          : 'cancelled';
      requestTaskRunIntent(
        existingControlRun,
        intent,
        input.status === 'cancelled' ? '用户取消' : input.status === 'paused' ? '用户暂停' : '用户重试',
      );
      if (input.status === 'paused' || input.status === 'cancelled') {
        await existingControlRun.completion?.catch(() => undefined);
        if (!isCurrent()) return null;
      }
    }
    const database = await getDb();
    const state = await database.getState();
    const task = state.tasks.find((item) => item.id === input.id);
    if (!task || !isCurrent()) {
      return null;
    }
    assertTaskLifecycleAction(task, input.status === 'running' ? 'continue' : input.status === 'paused' ? 'pause' : 'cancel', {
      hasActiveRun: Boolean(existingControlRun || runningTasks.get(input.id)),
    });
    const workDir = input.status === 'running' ? taskWorkDir(task) : null;
    if (input.status === 'running' && existingActiveRun) {
      if (isCurrent() && runningTasks.get(input.id) === existingActiveRun && existingActiveRun.intent === 'restart') {
        await database.updateTask(input.id, {
          errorMessage: '正在停止当前运行，随后继续重试。',
          lastHeartbeatAt: new Date().toISOString(),
        });
      }
      return publishTaskUpsert(database, input.id);
    }
    const existingRun = runningTasks.get(input.id);
    let controlledRun = existingRun;
    if (existingRun) {
      if (input.status === 'running') {
        if (!existingRun.activityReservation) {
          existingRun.activityReservation = transferReservation();
        }
        requestTaskRunIntent(existingRun, 'restart', '用户重试');
      } else if (input.status === 'paused' || input.status === 'cancelled') {
        requestTaskRunIntent(
          existingRun,
          input.status,
          input.status === 'cancelled' ? '用户取消' : '用户暂停',
        );
      }
    }
    if (input.status === 'running') {
      if (workDir === null) throw new Error('Managed task work directory is unavailable.');
      if (!existingRun) {
        await resumeTaskRun(database, task, workDir, isCurrent, transferReservation);
      } else if (isCurrent() && runningTasks.get(input.id) === existingRun && existingRun.intent === 'restart') {
        await database.updateTask(input.id, {
          errorMessage: '正在停止当前运行，随后继续重试。',
          lastHeartbeatAt: new Date().toISOString(),
        });
      }
      return publishTaskUpsert(database, input.id);
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
    return publishTaskUpsert(database, input.id);
  }, input.status === 'running' && existingControlRun?.activityReservation
    ? undefined
    : () => existingControlRun?.activityReservation
      ? takeHistoryActivityReservation(existingControlRun)
      : historyActivityRegistry.reserveActive('task', input.id));
});

trustedHandle('task:retry', async (_event, id: string) => {
  const existingRunAtEntry = runningTasks.get(id);
  return runLatestTaskControlRequest(latestTaskControlRequests, id, async (isCurrent, transferReservation) => {
    if (existingRunAtEntry && isCurrent()) {
      if (!existingRunAtEntry.activityReservation) {
        existingRunAtEntry.activityReservation = transferReservation();
      }
      requestTaskRunIntent(existingRunAtEntry, 'restart', '用户重试');
    }
    const database = await getDb();
    const state = await database.getState();
    const task = state.tasks.find((item) => item.id === id);
    if (!task || !isCurrent()) return null;
    assertTaskLifecycleAction(task, 'retry', {
      hasActiveRun: Boolean(existingRunAtEntry || runningTasks.get(id)),
    });
    const workDir = taskWorkDir(task);
    if (existingRunAtEntry) {
      if (isCurrent() && runningTasks.get(id) === existingRunAtEntry && existingRunAtEntry.intent === 'restart') {
        await database.updateTask(id, {
          errorMessage: '正在停止当前运行，随后继续重试。',
          lastHeartbeatAt: new Date().toISOString(),
        });
      }
      return publishTaskUpsert(database, id);
    }
    const existingRun = runningTasks.get(id);
    if (existingRun) {
      if (!existingRun.activityReservation) {
        existingRun.activityReservation = transferReservation();
      }
      requestTaskRunIntent(existingRun, 'restart', '用户重试');
    }
    if (!existingRun) {
      await resumeTaskRun(database, task, workDir, isCurrent, transferReservation);
    } else if (isCurrent() && runningTasks.get(id) === existingRun && existingRun.intent === 'restart') {
      await database.updateTask(id, {
        errorMessage: '正在停止当前运行，随后继续重试。',
        lastHeartbeatAt: new Date().toISOString(),
      });
    }
    return publishTaskUpsert(database, id);
  }, existingRunAtEntry?.activityReservation
    ? undefined
    : () => historyActivityRegistry.reserveActive('task', id));
});

trustedHandle('task:regenerate-image', async (_event, input: { id: string; sceneId: number }) => {
  const existingActiveRun = runningTasks.get(input.id);
  return runLatestTaskControlRequest(latestTaskControlRequests, input.id, async (isCurrent, transferReservation) => {
    if (!await stopTaskRunBeforeArtifactMutation(() => runningTasks.get(input.id), isCurrent)) {
      return null;
    }
    const database = await getDb();
    if (!isCurrent()) return null;
    const state = await database.getState();
    if (!isCurrent()) return null;
    const task = state.tasks.find((item) => item.id === input.id);
    if (!task) {
      throw new Error(`Task not found: ${input.id}`);
    }
    const workDir = taskWorkDir(task);
    if (!task.artifactStatePath) {
      throw new Error('Task artifact state is not available; run the task before regenerating images.');
    }

    const sceneId = Number(input.sceneId);
    await markSceneImageForRegeneration(task.artifactStatePath, sceneId);
    if (!isCurrent()) return null;
    await database.updateTask(task.id, {
      status: 'pending',
      currentStep: 4,
      failedStep: 4,
      retryFromStep: 4,
      completedAt: null,
      outputDir: workDir,
      errorMessage: `重新生成第 ${sceneId} 张图片`,
      lastHeartbeatAt: new Date().toISOString(),
    });
    if (!isCurrent()) return null;
    await resumeLatestTaskRun(database, task.id, workDir, isCurrent, transferReservation, async (runningTask) => {
      const event = await database.addTaskEvent(task.id, {
        type: 'step_start',
        step: 4,
        agent: 'Producer',
        detail: `重新生成第 ${sceneId} 张图片`,
        dataJson: JSON.stringify({ sceneId }),
        runGeneration: runningTask.runGeneration,
      });
      await publishTaskEvent(event);
    });
    return publishTaskUpsert(database, task.id);
  }, () => existingActiveRun?.activityReservation
    ? takeHistoryActivityReservation(existingActiveRun)
    : historyActivityRegistry.reserveActive('task', input.id));
});

trustedHandle('task:regenerate-narration', async (_event, input: { id: string; sceneId: number }) => {
  const existingActiveRun = runningTasks.get(input.id);
  return runLatestTaskControlRequest(latestTaskControlRequests, input.id, async (isCurrent, transferReservation) => {
    if (!await stopTaskRunBeforeArtifactMutation(() => runningTasks.get(input.id), isCurrent)) {
      return null;
    }
    const database = await getDb();
    if (!isCurrent()) return null;
    const state = await database.getState();
    if (!isCurrent()) return null;
    const task = state.tasks.find((item) => item.id === input.id);
    if (!task) {
      throw new Error(`Task not found: ${input.id}`);
    }
    const workDir = taskWorkDir(task);
    if (!task.artifactStatePath) {
      throw new Error('Task artifact state is not available; run the task before regenerating narration.');
    }

    const sceneId = Number(input.sceneId);
    await markSceneNarrationForRegeneration(task.artifactStatePath, sceneId);
    if (!isCurrent()) return null;
    await database.updateTask(task.id, {
      status: 'pending',
      currentStep: 5,
      failedStep: 5,
      retryFromStep: 5,
      completedAt: null,
      outputDir: workDir,
      errorMessage: `重新生成第 ${sceneId} 段配音`,
      lastHeartbeatAt: new Date().toISOString(),
    });
    if (!isCurrent()) return null;
    await resumeLatestTaskRun(database, task.id, workDir, isCurrent, transferReservation, async (runningTask) => {
      const event = await database.addTaskEvent(task.id, {
        type: 'step_start',
        step: 5,
        agent: 'TTS',
        detail: `重新生成第 ${sceneId} 段配音`,
        dataJson: JSON.stringify({ sceneId }),
        runGeneration: runningTask.runGeneration,
      });
      await publishTaskEvent(event);
    });
    return publishTaskUpsert(database, task.id);
  }, () => existingActiveRun?.activityReservation
    ? takeHistoryActivityReservation(existingActiveRun)
    : historyActivityRegistry.reserveActive('task', input.id));
});

trustedHandle('task:update-image-prompt', async (_event, input: { id: string; sceneId: number; prompt: string }) => {
  const existingActiveRun = runningTasks.get(input.id);
  return runLatestTaskControlRequest(latestTaskControlRequests, input.id, async (isCurrent) => {
    if (!await stopTaskRunBeforeArtifactMutation(() => runningTasks.get(input.id), isCurrent)) {
      return null;
    }
    const database = await getDb();
    if (!isCurrent()) return null;
    const state = await database.getState();
    if (!isCurrent()) return null;
    const task = state.tasks.find((item) => item.id === input.id);
    if (!task) {
      throw new Error(`Task not found: ${input.id}`);
    }
    const workDir = taskWorkDir(task);
    if (!task.artifactStatePath) {
      throw new Error('Task artifact state is not available; run the task before editing image prompts.');
    }

    const sceneId = Number(input.sceneId);
    const result = await updateSceneImagePrompt(task.artifactStatePath, sceneId, input.prompt);
    if (!isCurrent()) return null;
    const event = await database.addTaskEvent(task.id, {
      type: 'prompt_update',
      step: 3,
      agent: 'Prompt',
      detail: `已修改第 ${sceneId} 张图片提示词`,
      dataJson: JSON.stringify({ sceneId, promptLength: result.updatedPrompt.prompt.length }),
    });
    await publishTaskEvent(event);
    return publishTaskUpsert(database, task.id);
  }, () => existingActiveRun?.activityReservation
    ? takeHistoryActivityReservation(existingActiveRun)
    : historyActivityRegistry.reserveActive('task', input.id));
});

trustedHandle('task:rerun-step', async (_event, input: { id: string; step: number; mode: TaskStepRerunMode }) => {
  const existingActiveRun = runningTasks.get(input.id);
  return runLatestTaskControlRequest(latestTaskControlRequests, input.id, async (isCurrent, transferReservation) => {
    if (!await stopTaskRunBeforeArtifactMutation(() => runningTasks.get(input.id), isCurrent)) {
      return null;
    }
    const database = await getDb();
    if (!isCurrent()) return null;
    const state = await database.getState();
    if (!isCurrent()) return null;
    const task = state.tasks.find((item) => item.id === input.id);
    if (!task) {
      throw new Error(`Task not found: ${input.id}`);
    }
    const workDir = taskWorkDir(task);
    if (!task.artifactStatePath) {
      throw new Error('Task artifact state is not available; run the task before rerunning a step.');
    }

    const step = Number(input.step);
    const result = await markTaskStepForRerun(task.artifactStatePath, step, input.mode);
    if (!isCurrent()) return null;
    const detail = result.mode === 'rewrite' ? `改写第 ${step + 1} 步后继续` : `重新生成第 ${step + 1} 步后继续`;
    await database.updateTask(task.id, {
      status: 'pending',
      currentStep: step,
      failedStep: step,
      retryFromStep: step,
      completedAt: null,
      outputDir: workDir,
      errorMessage: detail,
      lastHeartbeatAt: new Date().toISOString(),
    });
    if (!isCurrent()) return null;
    await resumeLatestTaskRun(database, task.id, workDir, isCurrent, transferReservation, async (runningTask) => {
      const event = await database.addTaskEvent(task.id, {
        type: 'step_start',
        step,
        agent: pipelineStepAgents[step] ?? null,
        detail,
        dataJson: JSON.stringify({ step, mode: result.mode, clearedSteps: result.clearedSteps }),
        runGeneration: runningTask.runGeneration,
      });
      await publishTaskEvent(event);
    });
    return publishTaskUpsert(database, task.id);
  }, () => existingActiveRun?.activityReservation
    ? takeHistoryActivityReservation(existingActiveRun)
    : historyActivityRegistry.reserveActive('task', input.id));
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
  if (editorialQaConfig?.scope === 'clone-voice' || editorialQaConfig?.scope === 'all') {
    return join(editorialQaConfig.root, 'qa-minimax-source.wav');
  }
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
  void database;
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
  if (resolveVolcengineTtsApiVersion(config.tts.volcengine) === 'v3') {
    return config.tts.volcengine.apiKey ? 'pass' : 'warn';
  }
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
  acceptingAppDeltas = false;
  historyActivityRegistry.close();
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
  await historyActivityRegistry.waitForIdle();
  await deltaPublishQueue;
  const databaseInitialization = dbInitializationPromise;
  if (databaseInitialization) await databaseInitialization.catch(() => undefined);
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
    await runEditorialQaCapture();
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
