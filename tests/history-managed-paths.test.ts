import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import { FileDatabase } from '@shared/storage';
import {
  backfillLegacyManagedHistoryStorage,
  createManagedStorageKey,
  managedHistoryFamilyRoot,
  resolveLegacyManagedHistoryWorkDir,
  resolveManagedHistoryWorkDir,
} from '../electron/managed-history-paths';

const createdDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  createdDirectories.push(directory);
  return directory;
}

describe('managed history paths', () => {
  it('creates random path-safe keys independent from caller business ids', () => {
    const first = createManagedStorageKey();
    const second = createManagedStorageKey();
    expect(first).toMatch(/^[a-z0-9_-]{16,128}$/u);
    expect(second).toMatch(/^[a-z0-9_-]{16,128}$/u);
    expect(first).not.toBe(second);
    expect(first).not.toBe('caller-controlled-id');
  });

  it.each([
    ['task', 'tasks'],
    ['viral-analysis', 'viral-analyses'],
    ['image-lab', 'image-lab'],
    ['voice-lab', 'voice-lab'],
  ] as const)('keeps %s work directories under its governed family root', (family, directoryName) => {
    const appDataDir = join('C:\\trusted', 'storydream');
    const key = createManagedStorageKey();
    const root = managedHistoryFamilyRoot(appDataDir, family);
    const workDir = resolveManagedHistoryWorkDir(appDataDir, family, key);
    expect(basename(root)).toBe(directoryName);
    expect(relative(root, workDir)).toBe(key);
  });

  it('rejects missing and attacker-controlled keys before deriving any work directory', () => {
    const appDataDir = join('C:\\trusted', 'storydream');
    expect(resolveManagedHistoryWorkDir(appDataDir, 'task', 'short')).toBe(join(appDataDir, 'tasks', 'short'));
    expect(resolveManagedHistoryWorkDir(appDataDir, 'task', 'a'.repeat(256))).toBe(join(appDataDir, 'tasks', 'a'.repeat(256)));
    expect(() => resolveManagedHistoryWorkDir(appDataDir, 'task', 'a'.repeat(257))).toThrow('MANAGED_STORAGE_KEY_INVALID');
    for (const key of [null, '', '.', '..', '../outside', '..\\outside', 'a/b', 'a\\b', 'white space', '中文', 'CON', 'nul', 'COM1']) {
      expect(() => resolveManagedHistoryWorkDir(appDataDir, 'task', key)).toThrow('MANAGED_STORAGE_KEY_INVALID');
    }
  });

  it('backfills only schema-valid contained legacy directories without links', async () => {
    const appDataDir = await temporaryDirectory('storydream-managed-legacy-');
    const root = managedHistoryFamilyRoot(appDataDir, 'task');
    const safeId = '11111111-1111-4111-8111-111111111111';
    const safe = join(root, safeId);
    await mkdir(safe, { recursive: true });
    expect(await resolveLegacyManagedHistoryWorkDir(appDataDir, 'task', safeId)).toBe(await realpath(safe));
    expect(await resolveLegacyManagedHistoryWorkDir(appDataDir, 'task', '../outside')).toBeNull();
    expect(await resolveLegacyManagedHistoryWorkDir(appDataDir, 'task', '33333333-3333-4333-8333-333333333333')).toBeNull();

    const outside = await temporaryDirectory('storydream-managed-outside-');
    const linkedId = '22222222-2222-4222-8222-222222222222';
    const linked = join(root, linkedId);
    await symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
    expect(await resolveLegacyManagedHistoryWorkDir(appDataDir, 'task', linkedId)).toBeNull();
  });

  it('accepts an existing prefixed governance-safe legacy id as a compatible managed key', async () => {
    const appDataDir = await temporaryDirectory('storydream-managed-prefixed-');
    const legacyId = 'image-lab-550e8400-e29b-41d4-a716-446655440000';
    const legacyDir = join(managedHistoryFamilyRoot(appDataDir, 'image-lab'), legacyId);
    await mkdir(legacyDir, { recursive: true });
    expect(await resolveLegacyManagedHistoryWorkDir(appDataDir, 'image-lab', legacyId)).toBe(await realpath(legacyDir));
    expect(resolveManagedHistoryWorkDir(appDataDir, 'image-lab', legacyId)).toBe(legacyDir);
  });

  it('persists only verified legacy ownership during startup migration', async () => {
    const appDataDir = await temporaryDirectory('storydream-managed-backfill-');
    const databaseFile = join(appDataDir, 'data.db');
    const database = await FileDatabase.open(databaseFile);
    const safeTask = await database.createTask({ title: 'Safe legacy', inputText: 'safe' });
    const linkedImage = await database.addImageLabRecord({
      id: '22222222-2222-4222-8222-222222222222',
      prompt: 'linked',
      ratio: '9:16',
      style: 'photo-real',
      provider: 'mock',
    });
    await database.close();
    await clearManagedStorageKeys(databaseFile, [
      ['tasks', safeTask.id],
      ['image_lab_records', linkedImage.id],
    ]);

    await mkdir(join(managedHistoryFamilyRoot(appDataDir, 'task'), safeTask.id), { recursive: true });
    const outside = await temporaryDirectory('storydream-managed-backfill-outside-');
    const imageRoot = managedHistoryFamilyRoot(appDataDir, 'image-lab');
    await mkdir(imageRoot, { recursive: true });
    await symlink(outside, join(imageRoot, linkedImage.id), process.platform === 'win32' ? 'junction' : 'dir');

    const reopened = await FileDatabase.open(databaseFile);
    const candidates = await reopened.listMissingManagedStorageKeys();
    expect(candidates).toEqual(expect.arrayContaining([
      { family: 'task', id: safeTask.id, managedStorageKey: null },
      { family: 'image-lab', id: linkedImage.id, managedStorageKey: null },
    ]));
    const migrated = await backfillLegacyManagedHistoryStorage(
      appDataDir,
      candidates,
      (family, id, managedStorageKey) => reopened.backfillManagedStorageKey(family, id, managedStorageKey),
    );
    expect(migrated).toBe(1);
    expect((await reopened.getTaskDetail(safeTask.id))?.managedStorageKey).toBe(safeTask.id);
    expect((await reopened.getImageLabRecordDetail(linkedImage.id))?.managedStorageKey).toBeNull();
    await reopened.close();

    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const storage = await readFile(new URL('../src/shared/storage.ts', import.meta.url), 'utf8');
    const getDatabase = main.slice(main.indexOf('async function getDb'), main.indexOf('async function getConfigService'));
    const ensureDraftPath = main.slice(
      main.indexOf('async function ensureRuntimeJianyingDraftPath'),
      main.indexOf('async function createWindow'),
    );
    const createWindow = main.slice(main.indexOf('async function createWindow'), main.indexOf('async function runSmokeHandshake'));
    const storageRecovery = storage.slice(
      storage.indexOf('private recoverInterruptedTasks()'),
      storage.indexOf('private seedShellDefaults()'),
    );
    expect(getDatabase.indexOf('backfillLegacyManagedHistoryStorage')).toBeGreaterThan(getDatabase.indexOf('FileDatabase.open'));
    expect(getDatabase).toContain('database.listMissingManagedStorageKeys()');
    expect(getDatabase).not.toContain('database.getState()');
    expect(ensureDraftPath).toContain('database.getBootstrapMetadata()');
    expect(ensureDraftPath).not.toContain('database.getState()');
    expect(ensureDraftPath).toContain('metadata.config.jianying.draftPath');
    expect(createWindow).not.toContain('pauseStaleRunningTasks');
    expect(main).not.toContain('async function pauseStaleRunningTasks');
    expect(storage).toContain('this.recoverInterruptedTasks();');
    expect(storageRecovery).toContain("status = 'paused'");
    expect(storageRecovery).toContain('failed_step = COALESCE(failed_step, current_step)');
    expect(storageRecovery).toContain('retry_from_step = COALESCE(retry_from_step, current_step)');
    expect(storageRecovery).toContain("WHERE status = 'running'");
  });

  it('guards task, HTML, and viral resume entries before runtime ownership or state changes', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const taskStatus = sourceSection(main, "trustedHandle('task:update-status'", "trustedHandle('task:retry'");
    const taskRetry = sourceSection(main, "trustedHandle('task:retry'", "trustedHandle('task:regenerate-image'");
    const viralStatus = sourceSection(main, "trustedHandle('viral:update-status'", "trustedHandle('viral:retry'");
    const viralRetry = sourceSection(main, "trustedHandle('viral:retry'", "trustedHandle('viral:get-result'");
    const startTask = sourceSection(main, 'function startTaskRun', 'function startViralAnalysisRun');
    const runHtml = sourceSection(main, 'async function runHtmlVideoTask', 'async function persistHtmlVideoTaskCheckpoint');
    const viralRuntime = sourceSection(main, 'function startViralAnalysisRun', 'async function reconcileAppDeltas');

    expectSourceOrder(taskStatus, [
      'const task = state.tasks.find',
      "const workDir = input.status === 'running' ? taskWorkDir(task) : null",
      'const existingRun = runningTasks.get(input.id)',
      'requestTaskRunIntent(',
    ]);
    expect(taskStatus).toContain('resumeTaskRun(database, task, workDir, isCurrent)');

    expectSourceOrder(taskRetry, [
      'const task = state.tasks.find',
      'const workDir = taskWorkDir(task)',
      'const existingRun = runningTasks.get(id)',
      'requestTaskRunIntent(',
    ]);
    expect(taskRetry).toContain('resumeTaskRun(database, task, workDir, isCurrent)');

    expectSourceOrder(viralStatus, [
      'const record = state.viralAnalyses.find',
      'const workDir = viralAnalysisWorkDir(record)',
      'resumeViralAnalysisRun(database, record, workDir)',
    ]);
    expectSourceOrder(viralRetry, [
      'const record = state.viralAnalyses.find',
      'const workDir = viralAnalysisWorkDir(record)',
      'resumeViralAnalysisRun(database, record, workDir)',
    ]);

    expect(startTask).toContain('function startTaskRun(database: FileDatabase, task: Task, workDir: string)');
    expect(startTask).toContain('startStandardTaskRun(database, task, workDir)');
    expect(startTask).toContain('startHtmlVideoTaskRun(database, task, workDir)');
    expect(startTask).toContain('async function resumeTaskRun(');
    expect(startTask).toContain('workDir: string,');
    expect(startTask).not.toContain('taskWorkDir(task)');
    expect(runHtml).toContain('workDir: string,');
    expect(runHtml).not.toContain('taskWorkDir(task)');
    expect(viralRuntime).toContain('function startViralAnalysisRun(database: FileDatabase, record: ViralAnalysisRecord, workDir: string)');
    expect(viralRuntime).toContain('async function resumeViralAnalysisRun(');
    expect(viralRuntime).not.toContain('viralAnalysisWorkDir(record)');
  });

  it('guards every task artifact mutation before touching run ownership or artifact files', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const entries = [
      ['task:regenerate-image', 'task:regenerate-narration', 'markSceneImageForRegeneration', true],
      ['task:regenerate-narration', 'task:update-image-prompt', 'markSceneNarrationForRegeneration', true],
      ['task:update-image-prompt', 'task:rerun-step', 'updateSceneImagePrompt', false],
      ['task:rerun-step', 'task:get-artifacts', 'markTaskStepForRerun', true],
    ] as const;

    for (const [channel, nextChannel, mutation, resumes] of entries) {
      const handler = sourceSection(main, `trustedHandle('${channel}'`, `trustedHandle('${nextChannel}'`);
      expectSourceOrder(handler, [
        'const task = state.tasks.find',
        'const workDir = taskWorkDir(task)',
        'if (!task.artifactStatePath)',
        'stopTaskRunBeforeArtifactMutation(',
        `${mutation}(`,
      ]);
      expect(handler.match(/taskWorkDir\(task\)/gu)).toHaveLength(1);
      if (resumes) {
        expect(handler).toContain('outputDir: workDir');
        expect(handler).toContain('resumeLatestTaskRun(database, task.id, workDir, isCurrent)');
      }
    }
  });

  it('persists image and voice ownership before invoking providers and retains failed rows', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const imageHandler = main.slice(
      main.indexOf("trustedHandle('image-lab:generate'"),
      main.indexOf("trustedHandle('image-lab:add-record'"),
    );
    const voiceHandler = main.slice(
      main.indexOf("trustedHandle('voice-lab:generate'"),
      main.indexOf("trustedHandle('account:save'"),
    );

    expect(imageHandler.indexOf('addImageLabRecord')).toBeGreaterThan(-1);
    expect(imageHandler.indexOf('generateImageLabRecord')).toBeGreaterThan(imageHandler.indexOf('addImageLabRecord'));
    expect(imageHandler).toContain('managedStorageKey');
    expect(imageHandler).toContain("status: 'failed'");
    expect(imageHandler).toContain('updateImageLabRecord');
    expect(voiceHandler.indexOf('addVoiceLabRecord')).toBeGreaterThan(-1);
    expect(voiceHandler.indexOf('generateConfiguredVoicePreview')).toBeGreaterThan(voiceHandler.indexOf('addVoiceLabRecord'));
    expect(voiceHandler).toContain('managedStorageKey');
    expect(voiceHandler).toContain("status: 'failed'");
    expect(voiceHandler).toContain('updateVoiceLabRecord');
  });

  it('starts task and viral work only from canonical database-owned keys', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    expect(main).toContain("resolveManagedHistoryWorkDir(appDataDir(), 'task', task.managedStorageKey)");
    expect(main).toContain("resolveManagedHistoryWorkDir(appDataDir(), 'viral-analysis', record.managedStorageKey)");
    expect(main).not.toContain("'tasks', task.id");
    expect(main).not.toContain("'viral-analyses', record.id");
    expect(main).not.toContain("'image-lab', id");
    expect(main).not.toContain("'voice-lab', id");
  });
});

async function clearManagedStorageKeys(
  file: string,
  records: Array<[table: 'tasks' | 'image_lab_records', id: string]>,
): Promise<void> {
  const SQL = await initSqlJs();
  const database = new SQL.Database(await readFile(file));
  try {
    for (const [table, id] of records) database.run(`UPDATE ${table} SET managed_storage_key = NULL WHERE id = ?`, [id]);
    await writeFile(file, database.export());
  } finally {
    database.close();
  }
}

function sourceSection(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start, `${startMarker} exists`).toBeGreaterThan(-1);
  expect(end, `${endMarker} bounds ${startMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

function expectSourceOrder(source: string, markers: string[]): void {
  let previous = -1;
  for (const marker of markers) {
    const index = source.indexOf(marker);
    expect(index, `${marker} exists`).toBeGreaterThan(-1);
    expect(index, `${marker} follows the prior guard step`).toBeGreaterThan(previous);
    previous = index;
  }
}
