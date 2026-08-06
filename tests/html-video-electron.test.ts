import { existsSync, type BigIntStats } from 'node:fs';
import { createHash } from 'node:crypto';
import { copyFile, link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as htmlVideoRuntimeModule from '../electron/html-video-runtime';
import { AppError, isCancellation } from '../src/shared/app-error';
import { MAX_HTML_VIDEO_MEDIA_FILE_BYTES, runHtmlVideoPipeline, type HtmlVideoPreviewInput, type HtmlVideoRenderInput } from '../src/shared/html-video-runner';
import { createHtmlVideoPipelineData, createHtmlVideoTaskInput, parseHtmlVideoPipelineData } from '../src/shared/html-video-workflow';
import { FileDatabase } from '../src/shared/storage';
import { draftTemplates } from '../src/shared/templates';
import {
  createHtmlVideoMediaUrl,
  createElectronHtmlVideoRuntime,
  ensureHtmlVideoTaskWorkDir,
  htmlVideoCanvasForRatio,
  openHtmlVideoCompositionMediaResponse,
  prepareHtmlVideoBgm,
  preflightHtmlVideoRender,
  resolveHtmlVideoMediaUrl,
  type ElectronHtmlVideoRuntimeOptions,
  type HtmlVideoDigestFile,
  type HtmlVideoTaskDirectoryIdentity,
  type HtmlVideoMediaProbeResult,
} from '../electron/html-video-runtime';
import { createHtmlVideoComposePayload, type HtmlVideoExportInput } from '@shared/html-video';
import type { BgmItem, HtmlVideoCompositionSnapshot, HtmlVideoOutput, HtmlVideoScenePlan } from '@shared/types';

const expectedHtmlVideoBgmMaxBytes = 256 * 1024 * 1024;
const expectedHtmlVideoBgmDiskReserveBytes = 64 * 1024 * 1024;
const managedTestStorageKey = '0123456789abcdef0123456789abcdef0123456789abcdef';

describe('Electron HTML video runtime contract', () => {
  it('atomically persists a legal config update, its mirrors, resumable state, and one event', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'storydream-html-config-update-'));
    const databasePath = join(directory, 'app.db');
    let snapshots = 0;
    const database = await FileDatabase.open(databasePath, {
      replaceFile: async (source, target) => {
        snapshots += 1;
        await rename(source, target);
      },
    });
    try {
      const input = createHtmlVideoTaskInput({
        copy: 'Task 16 atomic config update',
        style: 'modern-film',
        voiceId: 'voice-old',
        ttsProvider: 'volcengine',
        ttsSpeed: 1,
        bgmId: '',
        foreground: true,
        maxScenes: 8,
        ratio: '9:16',
      });
      const created = await database.createTask(input);
      const completed = createHtmlVideoPipelineData(input.inputText, JSON.parse(input.pipelineData ?? '{}').config);
      completed.current = 'done';
      for (const step of Object.keys(completed.steps) as Array<keyof typeof completed.steps>) {
        completed.steps[step] = { status: 'completed', artifactPath: `steps/${step}.json`, artifactSize: 10 };
      }
      completed.output = { path: 'final.mp4', sizeBytes: 100 };
      await database.updateTask(created.id, {
        status: 'completed',
        currentStep: 6,
        pipelineStep: 'done',
        pipelineData: JSON.stringify(completed),
        completedAt: '2026-07-18T00:00:00.000Z',
        errorMessage: 'stale completion message',
        failedStep: 5,
        retryFromStep: 5,
      });
      snapshots = 0;

      const result = await database.updateHtmlVideoTaskConfig(created.id, [
        { field: 'transitionType', value: 'dissolve' },
        { field: 'bgmVolume', value: 'medium' },
        { field: 'voiceId', value: 'voice-new' },
        { field: 'ttsProvider', value: 'minimax' },
        { field: 'ttsSpeed', value: 1.25 },
      ]);
      expect(result.event.runGeneration).toBe(result.task.runGeneration);

      expect(snapshots).toBe(1);
      expect(result.changedFields).toEqual([
        'transitionType',
        'bgmVolume',
        'voiceId',
        'ttsProvider',
        'ttsSpeed',
      ]);
      expect(result.task).toMatchObject({ status: 'paused', currentStep: 3 });
      const task = await database.getTaskDetail(created.id);
      expect(task).toMatchObject({
        status: 'paused',
        currentStep: 3,
        pipelineStep: 'voice',
        completedAt: null,
        errorMessage: '',
        failedStep: null,
        retryFromStep: null,
        speaker: 'voice-new',
        ttsProvider: 'minimax',
        ttsSpeed: 1.25,
      });
      const pipeline = parseHtmlVideoPipelineData(task?.pipelineData);
      expect(pipeline.config).toMatchObject({
        transitionType: 'dissolve',
        bgmVolume: 'medium',
        voiceId: 'voice-new',
        ttsProvider: 'minimax',
        ttsSpeed: 1.25,
      });
      expect(pipeline.steps.assets).toEqual(completed.steps.assets);
      expect(pipeline.steps.voice).toEqual({ status: 'pending' });
      expect(pipeline).not.toHaveProperty('output');
      const events = await database.listTaskEvents(created.id, { limit: 100 });
      expect(events.items).toHaveLength(1);
      expect(events.items[0]).toMatchObject({ type: 'config_update', step: 3 });
    } finally {
      await database.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects active, archived, tombstoned, and read-only config updates without side effects', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'storydream-html-config-reject-'));
    const database = await FileDatabase.open(join(directory, 'app.db'));
    try {
      const create = (copy: string) => database.createTask(createHtmlVideoTaskInput({ copy }));
      const pending = await create('pending config');
      const pendingBefore = await database.getTaskDetail(pending.id);
      await expect(database.updateHtmlVideoTaskConfig(pending.id, [{ field: 'style', value: 'blocked' }]))
        .rejects.toThrow(/active|pending|running/i);
      expect(await database.getTaskDetail(pending.id)).toEqual(pendingBefore);
      expect((await database.listTaskEvents(pending.id, { limit: 100 })).items).toEqual([]);

      const archived = await create('archived config');
      await database.updateTask(archived.id, { status: 'completed' });
      await database.archiveTask(archived.id);
      const archivedBefore = await database.getTaskDetail(archived.id);
      await expect(database.updateHtmlVideoTaskConfig(archived.id, [{ field: 'ratio', value: '4:3' }]))
        .rejects.toThrow(/HISTORY_ARCHIVED/);
      expect(await database.getTaskDetail(archived.id)).toEqual(archivedBefore);
      expect((await database.listTaskEvents(archived.id, { limit: 100 })).items).toEqual([]);

      const deleted = await create('deleted config');
      await database.updateTask(deleted.id, { status: 'completed' });
      await database.archiveTask(deleted.id);
      await database.deleteTaskPermanently(deleted.id, {
        cleanupState: 'missing',
        quarantineName: null,
        quarantineIdentityJson: '{}',
        diagnostic: 'Test fixture has no managed directory.',
      });
      await expect(database.updateHtmlVideoTaskConfig(deleted.id, [{ field: 'style', value: 'blocked' }]))
        .rejects.toThrow(/HISTORY_DELETED/);
      expect((await database.listTaskEvents(deleted.id, { limit: 100 })).items).toEqual([]);

      const coverEditable = await create('cover editable config');
      await database.updateTask(coverEditable.id, { status: 'completed' });
      await expect(database.updateHtmlVideoTaskConfig(
        coverEditable.id,
        [{ field: 'coverRatio', value: '1:1' }],
      )).resolves.toMatchObject({ changedFields: ['coverRatio'] });
      expect(await database.getTaskDetail(coverEditable.id)).toMatchObject({
        status: 'paused',
        currentStep: 5,
        pipelineStep: 'render',
      });
      expect((await database.listTaskEvents(coverEditable.id, { limit: 100 })).items)
        .toEqual([expect.objectContaining({ type: 'config_update', step: 5 })]);
    } finally {
      await database.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('provides a dedicated runtime adapter with bounded canvas and media preflight', async () => {
    const url = new URL('../electron/html-video-runtime.ts', import.meta.url);
    expect(existsSync(url)).toBe(true);
    const source = await readFile(url, 'utf8');

    for (const symbol of [
      'createElectronHtmlVideoRuntime',
      'htmlVideoCanvasForRatio',
      'createPreviews',
      'measureAudioDuration',
      'preflightHtmlVideoRender',
      'thumbnailPath',
      'statfs',
      'await link(localTemporaryPath, bgmPath);',
      'isExistingFileError',
    ]) {
      expect(source).toContain(symbol);
    }
    expect(source).not.toContain('writeProductionJianyingDraft');
    expect(source).not.toContain('writeJianyingDraftOutput');
    expect((htmlVideoRuntimeModule as unknown as Record<string, unknown>).htmlVideoBgmMaxBytes)
      .toBe(expectedHtmlVideoBgmMaxBytes);
    expect((htmlVideoRuntimeModule as unknown as Record<string, unknown>).htmlVideoBgmDiskReserveBytes)
      .toBe(expectedHtmlVideoBgmDiskReserveBytes);
  });

  it('routes create, pause, cancel, resume, retry, preview, and output through the HTML runner lifecycle', async () => {
    const [main, preload, viteEnv, apiContract, ipcContract, indexHtml] = await Promise.all([
      readFile(new URL('../electron/main.ts', import.meta.url), 'utf8'),
      readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/shared/ipc-contract.ts', import.meta.url), 'utf8'),
      readFile(new URL('../index.html', import.meta.url), 'utf8'),
    ]);

    for (const symbol of [
      'runHtmlVideoPipeline',
      'createElectronHtmlVideoRuntime',
      'createHtmlVideoRuntimeProviders',
      'startHtmlVideoTaskRun',
      "trustedHandle('html-video:open-preview'",
      "trustedHandle('html-video:media-url'",
      'protocol.registerSchemesAsPrivileged',
      'protocol.handle(htmlVideoMediaScheme',
      'fetchHtmlVideoMediaResponse',
      'probeHtmlVideoMedia',
      'duration: result.duration',
      'hasAudio: result.has_audio',
      'hasVideo: result.has_video',
      'width: result.width',
      'height: result.height',
    ]) {
      expect(main).toContain(symbol);
    }
    expect(preload).toContain('openHtmlVideoPreview');
    expect(preload).toContain('getHtmlVideoMediaUrl');
    expect(apiContract).toContain('openHtmlVideoPreview: (id: string, sceneIndex?: number) => Promise<void>');
    expect(apiContract).toContain('getHtmlVideoMediaUrl: (id: string, path: string) => Promise<string>');
    expect(viteEnv).toContain("import type { StoryDreamApi } from './shared/storydream-api';");
    expect(viteEnv).not.toContain('openHtmlVideoPreview:');
    expect(ipcContract).toContain("'html-video:open-preview': htmlVideoPreviewSchema");
    expect(ipcContract).toContain("'html-video:media-url': htmlVideoMediaSchema");
    expect(indexHtml).toContain('storydream-media:');
    const privilegedScheme = main.slice(
      main.indexOf('protocol.registerSchemesAsPrivileged'),
      main.indexOf('const execFileAsync'),
    );
    expect(privilegedScheme).toContain('supportFetchAPI: true');
    expect(privilegedScheme).toContain('corsEnabled: true');

    const mediaProtocol = main.slice(
      main.indexOf('function registerHtmlVideoMediaProtocol'),
      main.indexOf('function viralAnalysisWorkDir'),
    );
    const verifiedFetch = mediaProtocol.indexOf('return await fetchHtmlVideoMediaResponse(');
    const fetchMedia = mediaProtocol.indexOf('openHtmlVideoCompositionMediaResponse(', verifiedFetch);
    expect(mediaProtocol).toContain('htmlVideoTaskDirectory');
    expect(mediaProtocol).toContain("request.headers.get('range')");
    expect(verifiedFetch).toBeGreaterThan(-1);
    expect(fetchMedia).toBeGreaterThan(verifiedFetch);
    expect(mediaProtocol).not.toContain('net.fetch(pathToFileURL(');
    expect(mediaProtocol).not.toContain('resolveHtmlVideoMediaUrl(');

    const previewAndMediaHandlers = main.slice(
      main.indexOf("trustedHandle('html-video:open-preview'"),
      main.indexOf('async function getHtmlVideoTask'),
    );
    expect(previewAndMediaHandlers).toContain('await htmlVideoTaskDirectory(task.id)');
    expect(previewAndMediaHandlers).toContain('createHtmlVideoMediaUrl(task.id, taskDirectory');
    expect(previewAndMediaHandlers).not.toMatch(/createHtmlVideoMediaUrl\([^\n]*taskWorkDir/u);
    expect(main).toContain('consumeRenderArtifactDigest: runtime.consumeRenderArtifactDigest');
  });

  it('waits for the old task run and applies only the latest pause, cancel, or retry intent', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const resume = main.slice(
      main.indexOf('async function resumeTaskRun'),
      main.indexOf('function startViralAnalysisRun'),
    );
    const updateStatus = main.slice(
      main.indexOf("trustedHandle('task:update-status'"),
      main.indexOf("trustedHandle('task:retry'"),
    );
    const ownedRun = main.slice(
      main.indexOf('function startOwnedTaskRun'),
      main.indexOf('async function runHtmlVideoTask'),
    );
    const finalizeIntent = ownedRun.indexOf('await finalizeTaskRunIntent(');
    const releaseOwnership = ownedRun.indexOf('runningTasks.delete(task.id);');
    const beginRestart = ownedRun.indexOf('await database.beginTaskRun(restartTask.id);');
    const restart = ownedRun.indexOf('startTaskRun(database, restartedTask, workDir, restartReservation);');

    expect(main).toContain("from './task-run-lifecycle'");
    expect(main).not.toContain('restartAfterAbort');
    expect(main).toContain('await finalizeTaskRunIntent(run, async (intent) => {');
    expect(main).toContain('return applyTaskRunIntent(database, task.id, intent);');
    expect(resume).toContain("requestTaskRunIntent(existingRun, 'restart', '用户重试')");
    expect(updateStatus).toContain('requestTaskRunIntent(');
    expect(finalizeIntent).toBeGreaterThan(-1);
    expect(releaseOwnership).toBeGreaterThan(finalizeIntent);
    expect(beginRestart).toBeGreaterThan(releaseOwnership);
    expect(restart).toBeGreaterThan(releaseOwnership);
    expect(restart).toBeGreaterThan(beginRestart);
  });

  it('persists a rebuilt HTML pipeline before a corrupted task is started again', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const start = main.slice(
      main.indexOf('function startHtmlVideoTaskRun'),
      main.indexOf('function startOwnedTaskRun'),
    );
    const recover = start.indexOf('recoverHtmlVideoPipelineDataForRetry(task)');
    const acquireOwner = start.indexOf('return startOwnedTaskRun(', recover);
    const run = start.indexOf('await runHtmlVideoTask(database, runnableTask, workDir, controller, recovery);', recover);
    const runner = main.slice(
      main.indexOf('async function runHtmlVideoTask'),
      main.indexOf('async function persistHtmlVideoTaskCheckpoint'),
    );
    const synchronize = runner.indexOf('await synchronizeHtmlVideoPipelineCheckpoint(workDir, initialState);');
    const persist = runner.indexOf('await database.updateTask(task.id, recovery);', synchronize);
    const prepareBgm = runner.indexOf('const bgmPath = await prepareHtmlVideoBgm({', persist);

    expect(recover).toBeGreaterThan(-1);
    expect(acquireOwner).toBeGreaterThan(recover);
    expect(run).toBeGreaterThan(recover);
    expect(synchronize).toBeGreaterThan(-1);
    expect(persist).toBeGreaterThan(synchronize);
    expect(prepareBgm).toBeGreaterThan(persist);
  });

  it('persists the final HTML pipeline state even when no checkpoint callback runs', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const runner = main.slice(
      main.indexOf('async function runHtmlVideoTask'),
      main.indexOf('async function persistHtmlVideoTaskCheckpoint'),
    );

    const pipelineStart = runner.indexOf('const finalState = await runHtmlVideoPipeline({');
    const finalStateAssignment = runner.indexOf('lastState = finalState;', pipelineStart);
    const finalCheckpoint = runner.indexOf(
      'await persistHtmlVideoTaskCheckpoint(database, task.id, workDir, finalState, controller.signal);',
      finalStateAssignment,
    );
    const finalNotification = runner.indexOf('await publishTaskUpsert(database, task.id);', finalCheckpoint);

    expect(pipelineStart).toBeGreaterThan(-1);
    expect(finalStateAssignment).toBeGreaterThan(pipelineStart);
    expect(finalCheckpoint).toBeGreaterThan(finalStateAssignment);
    expect(finalNotification).toBeGreaterThan(finalCheckpoint);
  });

  it('normalizes HTML task directory and running-state initialization failures', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const runner = main.slice(
      main.indexOf('async function runHtmlVideoTask'),
      main.indexOf('async function persistHtmlVideoTaskCheckpoint'),
    );
    const tryStart = runner.indexOf('  try {');
    const catchStart = runner.indexOf('  } catch (error) {');

    expect(tryStart).toBeGreaterThan(-1);
    expect(catchStart).toBeGreaterThan(tryStart);
    for (const initialization of [
      "await ensureHtmlVideoTaskWorkDir(app.getPath('userData'), appDataName, task.managedStorageKey ?? '')",
      "status: 'running',",
      'await publishTaskUpsert(database, task.id);',
    ]) {
      const initializationIndex = runner.indexOf(initialization);
      expect(initializationIndex).toBeGreaterThan(tryStart);
      expect(initializationIndex).toBeLessThan(catchStart);
    }
    expect(runner.slice(catchStart)).toContain("code: 'HTML_VIDEO_RUN_FAILED'");
  });

  it('establishes a trusted HTML task directory before any task-state write', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const runner = main.slice(
      main.indexOf('async function runHtmlVideoTask'),
      main.indexOf('async function probeHtmlVideoMedia'),
    );
    const ensureDirectory = runner.indexOf(
      "await ensureHtmlVideoTaskWorkDir(app.getPath('userData'), appDataName, task.managedStorageKey ?? '')",
    );
    const firstTaskWrite = runner.indexOf('await database.updateTask(task.id, {');

    expect(ensureDirectory).toBeGreaterThan(-1);
    expect(firstTaskWrite).toBeGreaterThan(ensureDirectory);
    expect(runner).toContain('workDir = taskDirectory.workDir.canonicalPath;');
    expect(runner.match(/      taskDirectory,/gu)).toHaveLength(2);
    expect(runner).not.toContain('await mkdir(workDir, { recursive: true });');
  });

  it('prepares BGM from parsed V2 config with the same bounded media probe used by the runtime', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const runner = main.slice(
      main.indexOf('async function runHtmlVideoTask'),
      main.indexOf('async function persistHtmlVideoTaskCheckpoint'),
    );

    const parseState = runner.indexOf('const initialState = parseHtmlVideoPipelineData(task.pipelineData);');
    const rememberState = runner.indexOf('lastState = initialState;', parseState);
    const prepareBgm = runner.indexOf('const bgmPath = await prepareHtmlVideoBgm({', rememberState);
    const createRuntime = runner.indexOf('const runtime = createElectronHtmlVideoRuntime({', prepareBgm);

    expect(parseState).toBeGreaterThan(-1);
    expect(rememberState).toBeGreaterThan(parseState);
    expect(prepareBgm).toBeGreaterThan(rememberState);
    expect(createRuntime).toBeGreaterThan(prepareBgm);
    expect(runner).toContain("bgmId: initialState.config.bgmId?.trim() ?? ''");
    expect(runner).toContain('bgmLibrary: runtimeConfig.jianying.bgmLibrary');
    expect(runner).not.toContain('task.bgmId');
    expect(runner.match(/probeMedia,/gu)).toHaveLength(2);
    expect(main).toContain('async function probeHtmlVideoMedia(');
    expect(main).toContain('hasAudio: result.has_audio');
  });

  it('encodes only task-local files as HTML media URLs', async () => {
    await withRuntimeDir(async (workDir) => {
      const runtimeModule = await import('../electron/html-video-runtime');
      expect(typeof runtimeModule.createHtmlVideoMediaUrl).toBe('function');
      expect(typeof runtimeModule.resolveHtmlVideoMediaUrl).toBe('function');
      if (!runtimeModule.createHtmlVideoMediaUrl || !runtimeModule.resolveHtmlVideoMediaUrl) return;

      const mediaPath = join(workDir, 'scene-001.jpg');
      const outsidePath = `${workDir}-outside.jpg`;
      await Promise.all([
        writeFile(mediaPath, Buffer.from('inside')),
        writeFile(outsidePath, Buffer.from('outside')),
      ]);
      const taskDirectory = taskDirectoryFor(workDir);
      const url = await runtimeModule.createHtmlVideoMediaUrl('task-1', taskDirectory, mediaPath);

      expect(url).toMatch(/^storydream-media:\/\/task\//);
      await expect(runtimeModule.resolveHtmlVideoMediaUrl(url, (taskId) => {
        expect(taskId).toBe('task-1');
        return taskDirectory;
      })).resolves.toBe(await realpath(mediaPath));
      await expect(
        runtimeModule.createHtmlVideoMediaUrl('task-1', taskDirectory, outsidePath),
      ).rejects.toMatchObject({ code: 'HTML_VIDEO_MEDIA_PATH_INVALID' });
      await rm(outsidePath, { force: true });
    });
  });

  it('rejects media access after the pinned task work directory is replaced by an external link', async () => {
    const trustedRoot = await mkdtemp(join(tmpdir(), 'storydream-html-media-root-'));
    const outsideDir = await mkdtemp(join(tmpdir(), 'storydream-html-media-outside-'));
    const outsideMedia = join(outsideDir, 'external.mp4');

    try {
      const taskDirectory = await ensureHtmlVideoTaskWorkDir(trustedRoot, 'storydream', managedTestStorageKey);
      const workDir = taskDirectory.workDir.canonicalPath;
      await writeFile(outsideMedia, Buffer.from('external media'));
      await rm(workDir, { recursive: true, force: true });
      await symlink(
        outsideDir,
        workDir,
        process.platform === 'win32' ? 'junction' : 'dir',
      );

      await expect(
        createHtmlVideoMediaUrl('task-1', taskDirectory, join(workDir, 'external.mp4')),
      ).rejects.toMatchObject({ code: 'HTML_VIDEO_MEDIA_PATH_INVALID' });
      await expect(
        resolveHtmlVideoMediaUrl(
          'storydream-media://task/task-1/external.mp4',
          () => taskDirectory,
        ),
      ).rejects.toMatchObject({ code: 'HTML_VIDEO_MEDIA_PATH_INVALID' });
      await expect(readFile(outsideMedia, 'utf8')).resolves.toBe('external media');
    } finally {
      await Promise.all([
        rm(trustedRoot, { recursive: true, force: true }),
        rm(outsideDir, { recursive: true, force: true }),
      ]);
    }
  });

  it('rejects a media child directory link that escapes the pinned task work directory', async () => {
    await withRuntimeDir(async (workDir) => {
      const outsideDir = await mkdtemp(join(tmpdir(), 'storydream-html-media-child-outside-'));
      const outsideMedia = join(outsideDir, 'external.mp4');
      const linkedDir = join(workDir, 'linked-media');

      try {
        await writeFile(outsideMedia, Buffer.from('external child media'));
        await symlink(
          outsideDir,
          linkedDir,
          process.platform === 'win32' ? 'junction' : 'dir',
        );
        const taskDirectory = taskDirectoryFor(workDir);

        await expect(
          createHtmlVideoMediaUrl('task-1', taskDirectory, join(linkedDir, 'external.mp4')),
        ).rejects.toMatchObject({ code: 'HTML_VIDEO_MEDIA_PATH_INVALID' });
        await expect(
          resolveHtmlVideoMediaUrl(
            'storydream-media://task/task-1/linked-media/external.mp4',
            () => taskDirectory,
          ),
        ).rejects.toMatchObject({ code: 'HTML_VIDEO_MEDIA_PATH_INVALID' });
        await expect(readFile(outsideMedia, 'utf8')).resolves.toBe('external child media');
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });
  });

  it('keeps one pinned task directory identity for the entire media fetch', async () => {
    await withRuntimeDir(async (workDir) => {
      const runtime = await import('../electron/html-video-runtime') as Record<string, unknown>;
      const fetchMedia = runtime.fetchHtmlVideoMediaResponse;
      expect(fetchMedia).toBeTypeOf('function');
      if (typeof fetchMedia !== 'function') return;

      const mediaPath = join(workDir, 'replace-root.mp4');
      await writeFile(mediaPath, Buffer.from('original media'));
      const taskDirectory = taskDirectoryFor(workDir);
      const url = await createHtmlVideoMediaUrl('task-1', taskDirectory, mediaPath);
      let directoryResolutions = 0;
      let bodyCancellations = 0;

      await expect((fetchMedia as (
        value: string,
        resolveTaskDirectory: (taskId: string) => Promise<HtmlVideoTaskDirectoryIdentity>,
        load: (path: string) => Promise<Response>,
      ) => Promise<Response>)(
        url,
        async () => {
          directoryResolutions += 1;
          return taskDirectory;
        },
        async () => {
          await rm(workDir, { recursive: true, force: true });
          await mkdir(workDir, { recursive: true });
          await writeFile(join(workDir, 'replace-root.mp4'), Buffer.from('replacement media'));
          return {
            body: { cancel: async () => { bodyCancellations += 1; } },
          } as unknown as Response;
        },
      )).rejects.toMatchObject({ code: 'HTML_VIDEO_MEDIA_PATH_INVALID' });
      expect(directoryResolutions).toBe(1);
      expect(bodyCancellations).toBe(1);
    });
  });

  it('rejects a media file replacement between resolution and fetch completion', async () => {
    await withRuntimeDir(async (workDir) => {
      const runtime = await import('../electron/html-video-runtime') as Record<string, unknown>;
      const fetchMedia = runtime.fetchHtmlVideoMediaResponse;
      expect(fetchMedia).toBeTypeOf('function');
      if (typeof fetchMedia !== 'function') return;

      const mediaPath = join(workDir, 'replace-file.mp4');
      const replacementPath = join(workDir, 'replace-file.next');
      await writeFile(mediaPath, Buffer.from('original media'));
      const taskDirectory = taskDirectoryFor(workDir);
      const url = await createHtmlVideoMediaUrl('task-1', taskDirectory, mediaPath);
      let bodyCancellations = 0;

      await expect((fetchMedia as (
        value: string,
        resolveTaskDirectory: (taskId: string) => HtmlVideoTaskDirectoryIdentity,
        load: (path: string) => Promise<Response>,
      ) => Promise<Response>)(
        url,
        () => taskDirectory,
        async () => {
          await writeFile(replacementPath, Buffer.from('replacement media'));
          await rm(mediaPath, { force: true });
          await rename(replacementPath, mediaPath);
          return {
            body: { cancel: async () => { bodyCancellations += 1; } },
          } as unknown as Response;
        },
      )).rejects.toMatchObject({ code: 'HTML_VIDEO_MEDIA_PATH_INVALID' });
      expect(bodyCancellations).toBe(1);
    });
  });

  it('returns the fetched response when pinned directory and file identities stay unchanged', async () => {
    await withRuntimeDir(async (workDir) => {
      const runtime = await import('../electron/html-video-runtime') as Record<string, unknown>;
      const fetchMedia = runtime.fetchHtmlVideoMediaResponse;
      expect(fetchMedia).toBeTypeOf('function');
      if (typeof fetchMedia !== 'function') return;

      const mediaPath = join(workDir, 'stable-file.mp4');
      await writeFile(mediaPath, Buffer.from('stable media'));
      const taskDirectory = taskDirectoryFor(workDir);
      const url = await createHtmlVideoMediaUrl('task-1', taskDirectory, mediaPath);
      const response = new Response('stable media');
      let directoryResolutions = 0;

      const fetched = await (fetchMedia as (
        value: string,
        resolveTaskDirectory: (taskId: string) => HtmlVideoTaskDirectoryIdentity,
        load: (path: string) => Promise<Response>,
      ) => Promise<Response>)(
        url,
        () => {
          directoryResolutions += 1;
          return taskDirectory;
        },
        async (path) => {
          expect(path).toBe(await realpath(mediaPath));
          return response;
        },
      );
      expect(fetched).not.toBe(response);
      expect(fetched.status).toBe(response.status);
      expect(fetched.headers.get('Cache-Control')).toContain('no-store');
      expect(fetched.headers.get('Pragma')).toBe('no-cache');
      await expect(fetched.text()).resolves.toBe('stable media');
      expect(directoryResolutions).toBe(1);
    });
  });

  it('uses one no-store response helper for successful ranges and failed media requests', async () => {
    const runtime = await import('../electron/html-video-runtime') as Record<string, unknown>;
    const createResponse = runtime.htmlVideoMediaResponse;
    expect(createResponse).toBeTypeOf('function');
    if (typeof createResponse !== 'function') return;

    const partial = (createResponse as (body: BodyInit | null, init?: ResponseInit) => Response)(
      'range body',
      {
        status: 206,
        statusText: 'Partial Content',
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Length': '10',
          'Content-Range': 'bytes 0-9/20',
          'Content-Type': 'video/mp4',
        },
      },
    );
    expect(partial.status).toBe(206);
    expect(partial.statusText).toBe('Partial Content');
    expect(partial.headers.get('Accept-Ranges')).toBe('bytes');
    expect(partial.headers.get('Content-Length')).toBe('10');
    expect(partial.headers.get('Content-Range')).toBe('bytes 0-9/20');
    expect(partial.headers.get('Content-Type')).toBe('video/mp4');
    expect(partial.headers.get('Cache-Control')).toBe('no-store, no-cache, must-revalidate');
    expect(partial.headers.get('Pragma')).toBe('no-cache');
    expect(partial.headers.get('Expires')).toBe('0');
    await expect(partial.text()).resolves.toBe('range body');

    const notFound = (createResponse as (body: BodyInit | null, init?: ResponseInit) => Response)(
      null,
      { status: 404 },
    );
    expect(notFound.status).toBe(404);
    expect(notFound.headers.get('Cache-Control')).toBe('no-store, no-cache, must-revalidate');
    expect(notFound.headers.get('Pragma')).toBe('no-cache');
    expect(notFound.headers.get('Expires')).toBe('0');

    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const mediaProtocol = main.slice(
      main.indexOf('function registerHtmlVideoMediaProtocol'),
      main.indexOf('function viralAnalysisWorkDir'),
    );
    expect(mediaProtocol).toContain('return htmlVideoMediaResponse(null, { status: 404 });');
  });

  it('serves a real pinned media byte range with exact partial-response metadata', async () => {
    await withRuntimeDir(async (workDir) => {
      const runtime = await import('../electron/html-video-runtime') as Record<string, unknown>;
      const fetchMedia = runtime.fetchHtmlVideoMediaResponse;
      const openRange = runtime.openHtmlVideoMediaRangeResponse;
      expect(fetchMedia).toBeTypeOf('function');
      expect(openRange).toBeTypeOf('function');
      if (typeof fetchMedia !== 'function' || typeof openRange !== 'function') return;

      const mediaPath = join(workDir, 'range.mp4');
      const bytes = Buffer.from(Array.from({ length: 64 }, (_, index) => index));
      await writeFile(mediaPath, bytes);
      const taskDirectory = taskDirectoryFor(workDir);
      const url = await createHtmlVideoMediaUrl('task-1', taskDirectory, mediaPath);
      const response = await (fetchMedia as (
        value: string,
        resolveTaskDirectory: () => HtmlVideoTaskDirectoryIdentity,
        load: (path: string, identity: unknown) => Promise<Response>,
      ) => Promise<Response>)(
        url,
        () => taskDirectory,
        (path, identity) => (openRange as (
          path: string,
          identity: unknown,
          range: string,
        ) => Promise<Response>)(path, identity, 'bytes=0-31'),
      );

      expect(response.status).toBe(206);
      expect(response.headers.get('Accept-Ranges')).toBe('bytes');
      expect(response.headers.get('Content-Length')).toBe('32');
      expect(response.headers.get('Content-Range')).toBe('bytes 0-31/64');
      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes.subarray(0, 32));
    });
  });

  it('serves managed HyperFrames HTML and runtime JavaScript with executable content types', async () => {
    await withRuntimeDir(async (workDir) => {
      const runtime = await import('../electron/html-video-runtime') as Record<string, unknown>;
      const fetchMedia = runtime.fetchHtmlVideoMediaResponse;
      const openMedia = runtime.openHtmlVideoMediaFileResponse;
      expect(fetchMedia).toBeTypeOf('function');
      expect(openMedia).toBeTypeOf('function');
      if (typeof fetchMedia !== 'function' || typeof openMedia !== 'function') return;

      const taskDirectory = taskDirectoryFor(workDir);
      const fixtures = [
        ['scene-001.html', '<!doctype html><title>HyperFrames</title>', 'text/html; charset=utf-8'],
        ['hyperframe.runtime.gsap.iife.js', 'window.__hf = {};', 'text/javascript; charset=utf-8'],
        ['untrusted.bin', 'opaque', 'application/octet-stream'],
      ] as const;
      for (const [name, body, contentType] of fixtures) {
        const path = join(workDir, name);
        await writeFile(path, body, 'utf8');
        const url = await createHtmlVideoMediaUrl('task-1', taskDirectory, path);
        const response = await (fetchMedia as (
          value: string,
          resolveTaskDirectory: () => HtmlVideoTaskDirectoryIdentity,
          load: (path: string, identity: unknown) => Promise<Response>,
        ) => Promise<Response>)(
          url,
          () => taskDirectory,
          (resolvedPath, identity) => (openMedia as (
            path: string,
            identity: unknown,
            range: string | null,
          ) => Promise<Response>)(resolvedPath, identity, null),
        );
        expect(response.headers.get('Content-Type')).toBe(contentType);
        await expect(response.text()).resolves.toBe(body);
      }
    });
  });

  it('rewrites composition scripts, images, and audio to task-pinned media URLs', async () => {
    await withRuntimeDir(async (workDir) => {
      const htmlDir = join(workDir, 'html-scenes');
      const htmlPath = join(htmlDir, 'scene-001.html');
      const runtimePath = join(htmlDir, 'gsap.min.js');
      const imagePath = join(workDir, 'scene-001.png');
      const audioPath = join(workDir, 'scene-001.wav');
      await mkdir(htmlDir);
      await Promise.all([
        writeFile(runtimePath, 'window.gsap = {};', 'utf8'),
        writeFile(imagePath, Buffer.from('image')),
        writeFile(audioPath, Buffer.from('audio')),
      ]);
      await writeFile(htmlPath, `<!doctype html><html><head><script src="./gsap.min.js"></script></head><body><img src="${pathToFileURL(imagePath)}"><audio src="${pathToFileURL(audioPath)}"></audio></body></html>`, 'utf8');

      const taskDirectory = taskDirectoryFor(workDir);
      const url = await createHtmlVideoMediaUrl('task-1', taskDirectory, htmlPath);
      const response = await htmlVideoRuntimeModule.fetchHtmlVideoMediaResponse(
        url,
        () => taskDirectory,
        (path, identity, context) => openHtmlVideoCompositionMediaResponse(path, identity, context, null),
      );
      const body = await response.text();

      expect(body).not.toContain('file:');
      expect(body.match(/src="storydream-media:\/\/task\/task-1\//gu)).toHaveLength(3);
      expect(body).toContain('/html-scenes/gsap.min.js');
      expect(body).toContain('/scene-001.png');
      expect(body).toContain('/scene-001.wav');
      expect(response.headers.get('Content-Length')).toBe(String(Buffer.byteLength(body)));
    });
  });

  it('rejects a composition file URL that escapes the pinned task directory', async () => {
    await withRuntimeDir(async (workDir) => {
      const outsidePath = `${workDir}-outside.png`;
      const htmlPath = join(workDir, 'scene-escape.html');
      try {
        await writeFile(outsidePath, Buffer.from('outside'));
        await writeFile(htmlPath, `<img src="${pathToFileURL(outsidePath)}">`, 'utf8');
        const taskDirectory = taskDirectoryFor(workDir);
        const url = await createHtmlVideoMediaUrl('task-1', taskDirectory, htmlPath);
        await expect(htmlVideoRuntimeModule.fetchHtmlVideoMediaResponse(
          url,
          () => taskDirectory,
          (path, identity, context) => openHtmlVideoCompositionMediaResponse(path, identity, context, null),
        )).rejects.toMatchObject({ code: 'HTML_VIDEO_MEDIA_PATH_INVALID' });
      } finally {
        await rm(outsidePath, { force: true });
      }
    });
  });

  it('rejects a restored-path ordinary media response opened from a replacement inode', async () => {
    await withRuntimeDir(async (workDir) => {
      const runtime = await import('../electron/html-video-runtime') as Record<string, unknown>;
      const fetchMedia = runtime.fetchHtmlVideoMediaResponse;
      const openMedia = runtime.openHtmlVideoMediaFileResponse;
      expect(fetchMedia).toBeTypeOf('function');
      expect(openMedia).toBeTypeOf('function');
      if (typeof fetchMedia !== 'function' || typeof openMedia !== 'function') return;

      const mediaPath = join(workDir, 'ordinary.mp4');
      const originalPath = join(workDir, 'ordinary.original.mp4');
      const original = Buffer.from('original ordinary media');
      const replacement = Buffer.from('replacement media bytes');
      await writeFile(mediaPath, original);
      const taskDirectory = taskDirectoryFor(workDir);
      const url = await createHtmlVideoMediaUrl('task-1', taskDirectory, mediaPath);

      await expect((fetchMedia as (
        value: string,
        resolveTaskDirectory: () => HtmlVideoTaskDirectoryIdentity,
        load: (path: string, identity: unknown) => Promise<Response>,
      ) => Promise<Response>)(
        url,
        () => taskDirectory,
        async (path, identity) => {
          await rename(path, originalPath);
          await writeFile(path, replacement);
          try {
            const response = await (openMedia as (
              path: string,
              identity: unknown,
              range: string | null,
            ) => Promise<Response>)(path, identity, null);
            return new Response(await response.arrayBuffer(), response);
          } finally {
            await rm(path, { force: true });
            await rename(originalPath, path);
          }
        },
      )).rejects.toMatchObject({ code: 'HTML_VIDEO_MEDIA_PATH_INVALID' });
      await expect(readFile(mediaPath)).resolves.toEqual(original);
    });
  });

  it('maps supported ratios to a bounded stable canvas', () => {
    expect(htmlVideoCanvasForRatio('9:16', 568)).toEqual({ width: 320, height: 568 });
    expect(htmlVideoCanvasForRatio('16:9', 568)).toEqual({ width: 568, height: 320 });
    expect(htmlVideoCanvasForRatio('1:1', 568)).toEqual({ width: 568, height: 568 });
    expect(htmlVideoCanvasForRatio('unexpected', 568)).toEqual({ width: 320, height: 568 });
  });

  it.each([
    ['missing', undefined, -28],
    ['soft', 'soft', -28],
    ['medium', 'medium', -22],
    ['loud', 'loud', -16],
  ] as const)('maps %s BGM volume and governed render config into the real composition', async (_label, volume, targetDb) => {
    await withRuntimeDir(async (workDir) => {
      let captured: HtmlVideoExportInput | undefined;
      await renderWithMediaProbe(
        workDir,
        async () => ({ ...validFinalMediaProbe(1.25), width: 568, height: 426 }),
        undefined,
        undefined,
        (input) => {
          captured = structuredClone(input);
        },
        (input) => {
          input.config = {
            ratio: '4:3',
            foreground: true,
            transitionType: 'dissolve',
            sceneMotion: 'pan_right',
            ...(volume === undefined ? {} : { bgmVolume: volume }),
          };
        },
      );

      expect(captured).toMatchObject({
        bgmTargetDb: targetDb,
        canvas_w: 568,
        canvas_h: 426,
        transition: { type: 'dissolve', duration: 0.3 },
      });
      expect(captured?.scenes[0].html).toContain('data-draft-motion="pan_right"');
    });
  });

  it('uses identical resolved caption HTML for preview and final render', async () => {
    await withRuntimeDir(async (workDir) => {
      const background = join(workDir, 'caption-background.png');
      const foreground = join(workDir, 'caption-foreground.png');
      const voice = join(workDir, 'caption-voice.wav');
      await Promise.all([
        writeFile(background, Buffer.from('background')),
        writeFile(foreground, Buffer.from('foreground')),
        writeFile(voice, Buffer.from('voice')),
      ]);
      let previewHtml = '';
      let renderHtml = '';
      const runtime = createElectronHtmlVideoRuntime({
        taskDirectory: taskDirectoryFor(workDir),
        taskTitle: 'Caption parity',
        fps: 2,
        maxLongEdge: 568,
        renderer: {
          async capturePreview(input) {
            previewHtml = await readFile(input.htmlPath, 'utf8');
            await writeFile(input.outputPath, Buffer.from('thumbnail'));
            return input.outputPath;
          },
          async render(input) {
            renderHtml = input.scenes[0].html;
            await writeFile(input.outputPath, Buffer.from('mp4-output'));
            return {
              outputPath: input.outputPath,
              sourceVideoPath: join(input.workDir, '_source.mp4'),
              duration: input.totalDurationS,
              taskDir: input.workDir,
              framesDirs: [],
            };
          },
        },
        probeMedia: async () => validFinalMediaProbe(1.25),
        getAvailableDiskBytes: async () => 4 * 1024 * 1024 * 1024,
      });
      const input = runtimeInput(background, foreground, voice);
      input.config = {
        ...input.config,
        captionPreset: 'editorial',
        captionAnim: 'pop',
        captionColors: { text: '#ffffff', accent: '#11aabb' },
      };
      const preview = await runtime.createPreviews(input);
      await runtime.render({ ...input, compositions: preview.compositions });

      expect(previewHtml).toBe(renderHtml);
      expect(renderHtml).toContain('data-caption-preset="editorial"');
      expect(renderHtml).toContain('data-caption-animation="pop"');
      expect(renderHtml).toContain('--caption-accent: #11aabb;');
      expect(renderHtml).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
    });
  });

  it('skips BGM preparation when the parsed V2 selection is empty', async () => {
    await withRuntimeDir(async (workDir) => {
      let probeCalls = 0;

      await expect(prepareHtmlVideoBgm({
        taskDirectory: taskDirectoryFor(workDir),
        bgmId: '',
        bgmLibrary: [],
        probeMedia: async () => {
          probeCalls += 1;
          return { duration: 1, hasAudio: true };
        },
      })).resolves.toBeUndefined();
      expect(probeCalls).toBe(0);
      expect(existsSync(join(workDir, 'inputs'))).toBe(false);
    });
  });

  it.each(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'] as const)(
    'copies an exact selected %s BGM into a canonical task-local path and probes it',
    async (extension) => {
      await withRuntimeDir(async (workDir) => {
        const sourceDir = await mkdtemp(join(tmpdir(), 'storydream-html-bgm-source-'));
        const sourcePath = join(sourceDir, `Library Track${extension.toUpperCase()}`);
        const controller = new AbortController();
        const receivedProbes: Array<{ root: string; path: string; signal?: AbortSignal }> = [];
        try {
          await writeFile(sourcePath, Buffer.from('valid audio'));

          const bgmPath = await prepareHtmlVideoBgm({
            taskDirectory: taskDirectoryFor(workDir),
            bgmId: 'Selected-BGM',
            bgmLibrary: [bgmItem('Selected-BGM', `  ${sourcePath}  `)],
            signal: controller.signal,
            async probeMedia(root, path, signal) {
              receivedProbes.push({ root, path, signal });
              return { duration: 2.5, hasAudio: true, hasVideo: false };
            },
          });

          expect(bgmPath).toBeTruthy();
          expect(await realpath(bgmPath!)).toBe(bgmPath);
          expect(await realpath(dirname(bgmPath!))).toBe(await realpath(join(workDir, 'inputs', 'bgm')));
          expect(basename(bgmPath!, extension)).toMatch(/^[a-f0-9]{64}$/u);
          expect(basename(bgmPath!)).not.toContain('Selected-BGM');
          expect(await readFile(bgmPath!, 'utf8')).toBe('valid audio');
          expect(receivedProbes).toHaveLength(1);
          expect(receivedProbes[0]).toMatchObject({
            root: await realpath(workDir),
            signal: controller.signal,
          });
          expect(receivedProbes[0].path).not.toBe(bgmPath);
          expect(await realpath(dirname(receivedProbes[0].path))).toBe(await realpath(dirname(bgmPath!)));
          expect(basename(receivedProbes[0].path)).toContain('.tmp');
          expect(basename(receivedProbes[0].path).endsWith(extension)).toBe(true);
          expect(existsSync(receivedProbes[0].path)).toBe(false);
        } finally {
          await rm(sourceDir, { recursive: true, force: true });
        }
      });
    },
  );

  it.each([
    ['does not exist with exact case', [bgmItem('selected-bgm', 'missing.wav')], 'Selected-BGM', 'HTML_VIDEO_BGM_NOT_FOUND'],
    ['is duplicated', [bgmItem('Selected-BGM', 'first.wav'), bgmItem('Selected-BGM', 'second.wav')], 'Selected-BGM', 'HTML_VIDEO_BGM_ID_DUPLICATE'],
  ] as const)('rejects a BGM selection that %s', async (_label, bgmLibrary, bgmId, code) => {
    await withRuntimeDir(async (workDir) => {
      let probeCalls = 0;

      await expect(prepareHtmlVideoBgm({
        taskDirectory: taskDirectoryFor(workDir),
        bgmId,
        bgmLibrary: [...bgmLibrary],
        probeMedia: async () => {
          probeCalls += 1;
          return { duration: 1, hasAudio: true };
        },
      })).rejects.toMatchObject({ code });
      expect(probeCalls).toBe(0);
      await expectBgmDirEmpty(workDir);
    });
  });

  it('rejects a selected BGM with an unsupported extension before copying it', async () => {
    await withRuntimeDir(async (workDir) => {
      const sourcePath = join(workDir, 'source.txt');
      await writeFile(sourcePath, Buffer.from('not audio'));

      await expect(prepareHtmlVideoBgm({
        taskDirectory: taskDirectoryFor(workDir),
        bgmId: 'selected',
        bgmLibrary: [bgmItem('selected', sourcePath)],
        probeMedia: async () => ({ duration: 1, hasAudio: true }),
      })).rejects.toMatchObject({ code: 'HTML_VIDEO_BGM_FORMAT_INVALID' });
      await expectBgmDirEmpty(workDir);
    });
  });

  it('rejects an empty BGM source without leaving a task-local copy', async () => {
    await withRuntimeDir(async (workDir) => {
      const sourcePath = join(workDir, 'empty.wav');
      await writeFile(sourcePath, Buffer.alloc(0));

      await expect(prepareHtmlVideoBgm({
        taskDirectory: taskDirectoryFor(workDir),
        bgmId: 'selected',
        bgmLibrary: [bgmItem('selected', sourcePath)],
        probeMedia: async () => ({ duration: 1, hasAudio: true }),
      })).rejects.toMatchObject({ code: 'HTML_VIDEO_BGM_SOURCE_INVALID' });
      await expectBgmDirEmpty(workDir);
    });
  });

  it('rejects an oversized BGM source before copying or probing it', async () => {
    await withRuntimeDir(async (workDir) => {
      const sourcePath = join(workDir, 'oversized-source.wav');
      let copyCalls = 0;
      let probeCalls = 0;
      await writeFile(sourcePath, Buffer.from('small test fixture'));

      await expect(prepareHtmlVideoBgm({
        taskDirectory: taskDirectoryFor(workDir),
        bgmId: 'selected',
        bgmLibrary: [bgmItem('selected', sourcePath)],
        probeMedia: async () => {
          probeCalls += 1;
          return { duration: 1, hasAudio: true };
        },
      }, {
        statSourceFile: async () => ({
          isFile: () => true,
          size: expectedHtmlVideoBgmMaxBytes + 1,
        }),
        getAvailableDiskBytes: async () => Number.MAX_SAFE_INTEGER,
        copyFile: async () => {
          copyCalls += 1;
        },
      })).rejects.toMatchObject({ code: 'HTML_VIDEO_BGM_SIZE_EXCEEDED' });

      expect(copyCalls).toBe(0);
      expect(probeCalls).toBe(0);
      await expectBgmDirEmpty(workDir);
    });
  });

  it('rejects BGM preparation before copying when source size plus reserve exceeds free disk', async () => {
    await withRuntimeDir(async (workDir) => {
      const sourcePath = join(workDir, 'low-space-source.wav');
      const sourceSize = 8 * 1024 * 1024;
      let copyCalls = 0;
      let probeCalls = 0;
      await writeFile(sourcePath, Buffer.from('small test fixture'));

      await expect(prepareHtmlVideoBgm({
        taskDirectory: taskDirectoryFor(workDir),
        bgmId: 'selected',
        bgmLibrary: [bgmItem('selected', sourcePath)],
        probeMedia: async () => {
          probeCalls += 1;
          return { duration: 1, hasAudio: true };
        },
      }, {
        statSourceFile: async () => ({
          isFile: () => true,
          size: sourceSize,
        }),
        getAvailableDiskBytes: async () => sourceSize + expectedHtmlVideoBgmDiskReserveBytes - 1,
        copyFile: async () => {
          copyCalls += 1;
        },
      })).rejects.toMatchObject({
        code: 'HTML_VIDEO_BGM_DISK_SPACE_LOW',
        retryable: true,
      });

      expect(copyCalls).toBe(0);
      expect(probeCalls).toBe(0);
      await expectBgmDirEmpty(workDir);
    });
  });

  it('rejects an oversized validated BGM cache before probing it again', async () => {
    await withRuntimeDir(async (workDir) => {
      const sourcePath = join(workDir, 'cached-source.wav');
      let probeCalls = 0;
      await writeFile(sourcePath, Buffer.from('cache seed'));
      const options = {
        taskDirectory: taskDirectoryFor(workDir),
        bgmId: 'selected',
        bgmLibrary: [bgmItem('selected', sourcePath)],
        probeMedia: async () => {
          probeCalls += 1;
          return { duration: 1, hasAudio: true };
        },
      };
      const cachedPath = await prepareHtmlVideoBgm(options, {
        getAvailableDiskBytes: async () => Number.MAX_SAFE_INTEGER,
      });
      probeCalls = 0;

      await expect(prepareHtmlVideoBgm(options, {
        getAvailableDiskBytes: async () => Number.MAX_SAFE_INTEGER,
        statLocalBgmFile: async (path) => {
          const value = await lstat(path, { bigint: true });
          Object.defineProperty(value, 'size', {
            value: BigInt(expectedHtmlVideoBgmMaxBytes + 1),
          });
          return value;
        },
      })).rejects.toMatchObject({ code: 'HTML_VIDEO_BGM_SIZE_EXCEEDED' });
      expect(probeCalls).toBe(0);
    });
  });

  it('rejects and removes a BGM temporary copy that grows beyond the source preflight size', async () => {
    await withRuntimeDir(async (workDir) => {
      const sourcePath = join(workDir, 'growing-source.wav');
      let probeCalls = 0;
      await writeFile(sourcePath, Buffer.from('small source'));

      await expect(prepareHtmlVideoBgm({
        taskDirectory: taskDirectoryFor(workDir),
        bgmId: 'selected',
        bgmLibrary: [bgmItem('selected', sourcePath)],
        probeMedia: async () => {
          probeCalls += 1;
          return { duration: 1, hasAudio: true };
        },
      }, {
        getAvailableDiskBytes: async () => Number.MAX_SAFE_INTEGER,
        copyFile: async (_source, destination) => {
          await writeFile(destination, Buffer.from('copied'));
        },
        statLocalBgmFile: async (path) => {
          const value = await lstat(path, { bigint: true });
          Object.defineProperty(value, 'size', {
            value: BigInt(expectedHtmlVideoBgmMaxBytes + 1),
          });
          return value;
        },
      })).rejects.toMatchObject({ code: 'HTML_VIDEO_BGM_SIZE_EXCEEDED' });

      expect(probeCalls).toBe(0);
      await expectBgmDirEmpty(workDir);
    });
  });

  it.each(['ENOENT', 'EACCES', 'EPERM'] as const)(
    'maps a source-side %s copy failure to an invalid BGM source',
    async (code) => {
      await withRuntimeDir(async (workDir) => {
        const sourcePath = join(workDir, 'copy-source.wav');
        await writeFile(sourcePath, Buffer.from('source audio'));

        await expect(prepareHtmlVideoBgm({
          taskDirectory: taskDirectoryFor(workDir),
          bgmId: 'selected',
          bgmLibrary: [bgmItem('selected', sourcePath)],
          probeMedia: async () => ({ duration: 1, hasAudio: true }),
        }, {
          copyFile: async (source) => {
            throw errnoError(code, source);
          },
        })).rejects.toMatchObject({ code: 'HTML_VIDEO_BGM_SOURCE_INVALID' });
        await expectBgmDirEmpty(workDir);
      });
    },
  );

  it.each([
    ['cancellation', new DOMException('Copy cancelled.', 'AbortError')],
    ['target disk failure', errnoError('ENOSPC', 'target.tmp.wav')],
  ] as const)('preserves a BGM copy %s', async (_label, copyError) => {
    await withRuntimeDir(async (workDir) => {
      const sourcePath = join(workDir, 'copy-source.wav');
      await writeFile(sourcePath, Buffer.from('source audio'));

      await expect(prepareHtmlVideoBgm({
        taskDirectory: taskDirectoryFor(workDir),
        bgmId: 'selected',
        bgmLibrary: [bgmItem('selected', sourcePath)],
        probeMedia: async () => ({ duration: 1, hasAudio: true }),
      }, {
        copyFile: async () => {
          throw copyError;
        },
      })).rejects.toBe(copyError);
      await expectBgmDirEmpty(workDir);
    });
  });

  it.each([
    ['no audio stream', { duration: 1, hasAudio: false }],
    ['missing duration', { hasAudio: true }],
    ['zero duration', { duration: 0, hasAudio: true }],
    ['NaN duration', { duration: Number.NaN, hasAudio: true }],
    ['infinite duration', { duration: Number.POSITIVE_INFINITY, hasAudio: true }],
  ] satisfies Array<[string, HtmlVideoMediaProbeResult]>)('rejects a copied BGM with %s', async (_label, probe) => {
    await withRuntimeDir(async (workDir) => {
      const sourcePath = join(workDir, 'source.wav');
      await writeFile(sourcePath, Buffer.from('invalid audio'));

      await expect(prepareHtmlVideoBgm({
        taskDirectory: taskDirectoryFor(workDir),
        bgmId: 'selected',
        bgmLibrary: [bgmItem('selected', sourcePath)],
        probeMedia: async () => probe,
      })).rejects.toMatchObject({ code: 'HTML_VIDEO_BGM_MEDIA_INVALID' });
      await expectBgmDirEmpty(workDir);
    });
  });

  it('preserves BGM probe failures and removes the unverified local copy', async () => {
    await withRuntimeDir(async (workDir) => {
      const sourcePath = join(workDir, 'source.wav');
      const probeError = new Error('bounded BGM probe failed');
      await writeFile(sourcePath, Buffer.from('audio'));

      await expect(prepareHtmlVideoBgm({
        taskDirectory: taskDirectoryFor(workDir),
        bgmId: 'selected',
        bgmLibrary: [bgmItem('selected', sourcePath)],
        probeMedia: async () => {
          throw probeError;
        },
      })).rejects.toBe(probeError);
      await expectBgmDirEmpty(workDir);
    });
  });

  it('preserves BGM probe cancellation and removes the cancelled local copy', async () => {
    await withRuntimeDir(async (workDir) => {
      const sourcePath = join(workDir, 'source.wav');
      const controller = new AbortController();
      const abortReason = new DOMException('BGM preparation cancelled.', 'AbortError');
      await writeFile(sourcePath, Buffer.from('audio'));

      await expect(prepareHtmlVideoBgm({
        taskDirectory: taskDirectoryFor(workDir),
        bgmId: 'selected',
        bgmLibrary: [bgmItem('selected', sourcePath)],
        signal: controller.signal,
        probeMedia: async (_root, _path, signal) => {
          expect(signal).toBe(controller.signal);
          controller.abort(abortReason);
          throw signal?.reason;
        },
      })).rejects.toBe(abortReason);
      await expectBgmDirEmpty(workDir);
    });
  });

  it('re-probes a valid task-local BGM cache when the external source is unavailable', async () => {
    await withRuntimeDir(async (workDir) => {
      const sourceDir = await mkdtemp(join(tmpdir(), 'storydream-html-bgm-cache-source-'));
      const sourcePath = join(sourceDir, 'retry.flac');
      const probePaths: string[] = [];
      try {
        await writeFile(sourcePath, Buffer.from('cached audio'));
        const options = {
          taskDirectory: taskDirectoryFor(workDir),
          bgmId: 'selected',
          bgmLibrary: [bgmItem('selected', sourcePath)],
          probeMedia: async (_root: string, path: string) => {
            probePaths.push(path);
            return { duration: 3, hasAudio: true };
          },
        };
        const cachedPath = await prepareHtmlVideoBgm(options);
        await rm(sourcePath, { force: true });

        await expect(prepareHtmlVideoBgm(options)).resolves.toBe(cachedPath);
        expect(probePaths).toHaveLength(2);
        expect(probePaths[0]).not.toBe(cachedPath);
        expect(basename(probePaths[0])).toContain('.tmp');
        expect(existsSync(probePaths[0])).toBe(false);
        expect(probePaths[1]).toBe(cachedPath);
        expect(await readFile(cachedPath!, 'utf8')).toBe('cached audio');
      } finally {
        await rm(sourceDir, { recursive: true, force: true });
      }
    });
  });

  it.each(['temporary probe failure', 'probe cancellation'] as const)(
    'preserves a validated BGM cache after %s',
    async (failureMode) => {
      await withRuntimeDir(async (workDir) => {
        const sourceDir = await mkdtemp(join(tmpdir(), 'storydream-html-bgm-preserved-cache-source-'));
        const sourcePath = join(sourceDir, 'preserved.wav');
        const interruption = failureMode === 'probe cancellation'
          ? new DOMException('Cached BGM probe cancelled.', 'AbortError')
          : new Error('Cached BGM probe temporarily unavailable');
        const controller = new AbortController();
        const baseOptions = {
          taskDirectory: taskDirectoryFor(workDir),
          bgmId: 'selected',
          bgmLibrary: [bgmItem('selected', sourcePath)],
        };
        try {
          await writeFile(sourcePath, Buffer.from('previously validated audio'));
          const cachedPath = await prepareHtmlVideoBgm({
            ...baseOptions,
            probeMedia: async () => ({ duration: 3, hasAudio: true }),
          });
          await rm(sourcePath, { force: true });

          await expect(prepareHtmlVideoBgm({
            ...baseOptions,
            signal: controller.signal,
            probeMedia: async (_root, _path, signal) => {
              if (failureMode === 'probe cancellation') {
                expect(signal).toBe(controller.signal);
                controller.abort(interruption);
              }
              throw interruption;
            },
          })).rejects.toBe(interruption);
          expect(existsSync(cachedPath!)).toBe(true);
          expect(await readFile(cachedPath!, 'utf8')).toBe('previously validated audio');
          await expect(prepareHtmlVideoBgm({
            ...baseOptions,
            probeMedia: async () => ({ duration: 3, hasAudio: true }),
          })).resolves.toBe(cachedPath);
        } finally {
          await rm(sourceDir, { recursive: true, force: true });
        }
      });
    },
  );

  it('serializes same-key BGM probes and preserves a successful publication when the queued probe fails', async () => {
    await withRuntimeDir(async (workDir) => {
      const sourcePath = join(workDir, 'concurrent-source.wav');
      const probeError = new Error('queued cache probe failed');
      const probePaths: string[] = [];
      let markFirstProbeStarted!: () => void;
      let releaseFirstProbe!: () => void;
      const firstProbeStarted = new Promise<void>((resolve) => { markFirstProbeStarted = resolve; });
      const firstProbeReleased = new Promise<void>((resolve) => { releaseFirstProbe = resolve; });
      await writeFile(sourcePath, Buffer.from('concurrent audio'));
      const baseOptions = {
        taskDirectory: taskDirectoryFor(workDir),
        bgmId: 'selected',
        bgmLibrary: [bgmItem('selected', sourcePath)],
      };
      const success = prepareHtmlVideoBgm({
        ...baseOptions,
        probeMedia: async (_root, path) => {
          probePaths.push(path);
          markFirstProbeStarted();
          await firstProbeReleased;
          return { duration: 2, hasAudio: true };
        },
      });
      const failure = prepareHtmlVideoBgm({
        ...baseOptions,
        probeMedia: async (_root, path) => {
          probePaths.push(path);
          throw probeError;
        },
      });
      let filesDuringProbe: string[] = [];
      try {
        await firstProbeStarted;
        filesDuringProbe = await readdir(join(workDir, 'inputs', 'bgm'));
        expect(probePaths).toHaveLength(1);
      } finally {
        releaseFirstProbe();
      }
      const results = await Promise.allSettled([success, failure]);

      expect(new Set(probePaths).size).toBe(2);
      expect(filesDuringProbe).toHaveLength(1);
      expect(filesDuringProbe[0]).toContain('.tmp.wav');
      const fulfilled = results.filter((result): result is PromiseFulfilledResult<string | undefined> => result.status === 'fulfilled');
      const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBe(probeError);
      expect(fulfilled[0].value).toBeTruthy();
      expect(probePaths[1]).toBe(fulfilled[0].value);
      expect(existsSync(fulfilled[0].value!)).toBe(true);
      expect(await readdir(join(workDir, 'inputs', 'bgm'))).toEqual([basename(fulfilled[0].value!)]);
      await expect(prepareHtmlVideoBgm({
        ...baseOptions,
        probeMedia: async () => ({ duration: 2, hasAudio: true }),
      })).resolves.toBe(fulfilled[0].value);
    });
  });

  it('does not use a validated cache to bypass an unknown or duplicate library selection', async () => {
    await withRuntimeDir(async (workDir) => {
      const sourcePath = join(workDir, 'cached-selection.wav');
      let probeCalls = 0;
      await writeFile(sourcePath, Buffer.from('cached selection audio'));
      const cachedPath = await prepareHtmlVideoBgm({
        taskDirectory: taskDirectoryFor(workDir),
        bgmId: 'selected',
        bgmLibrary: [bgmItem('selected', sourcePath)],
        probeMedia: async () => {
          probeCalls += 1;
          return { duration: 2, hasAudio: true };
        },
      });
      await rm(sourcePath, { force: true });

      for (const [bgmLibrary, code] of [
        [[bgmItem('other', sourcePath)], 'HTML_VIDEO_BGM_NOT_FOUND'],
        [[bgmItem('selected', sourcePath), bgmItem('selected', sourcePath)], 'HTML_VIDEO_BGM_ID_DUPLICATE'],
      ] as const) {
        await expect(prepareHtmlVideoBgm({
          taskDirectory: taskDirectoryFor(workDir),
          bgmId: 'selected',
          bgmLibrary: [...bgmLibrary],
          probeMedia: async () => {
            probeCalls += 1;
            return { duration: 2, hasAudio: true };
          },
        })).rejects.toMatchObject({ code });
        expect(existsSync(cachedPath!)).toBe(true);
      }
      expect(probeCalls).toBe(1);
    });
  });

  it('replaces an explicitly invalid BGM cache from the available source', async () => {
    await withRuntimeDir(async (workDir) => {
      const sourcePath = join(workDir, 'cache-repair.wav');
      let probeCalls = 0;
      await writeFile(sourcePath, Buffer.from('valid source audio'));
      const options = {
        taskDirectory: taskDirectoryFor(workDir),
        bgmId: 'selected',
        bgmLibrary: [bgmItem('selected', sourcePath)],
        probeMedia: async (_root: string, path: string) => {
          probeCalls += 1;
          return await readFile(path, 'utf8') === 'corrupted cache'
            ? { duration: 1, hasAudio: false }
            : { duration: 2, hasAudio: true };
        },
      };
      const cachedPath = await prepareHtmlVideoBgm(options);
      await writeFile(cachedPath!, Buffer.from('corrupted cache'));

      await expect(prepareHtmlVideoBgm(options)).resolves.toBe(cachedPath);
      expect(await readFile(cachedPath!, 'utf8')).toBe('valid source audio');
      expect(probeCalls).toBe(3);
    });
  });

  it('preserves and re-probes a valid cache inode that replaces the invalid inode being probed', async () => {
    await withRuntimeDir(async (workDir) => {
      const sourcePath = join(workDir, 'cross-process-cache-replacement.wav');
      const baseOptions = {
        taskDirectory: taskDirectoryFor(workDir),
        bgmId: 'selected',
        bgmLibrary: [bgmItem('selected', sourcePath)],
      };
      await writeFile(sourcePath, Buffer.from('valid source audio'));
      const cachedPath = await prepareHtmlVideoBgm({
        ...baseOptions,
        probeMedia: async () => ({ duration: 2, hasAudio: true }),
      });
      await writeFile(cachedPath!, Buffer.from('corrupted cache'));
      const invalidIdentity = await lstat(cachedPath!, { bigint: true });

      let markInvalidProbeStarted!: () => void;
      let releaseInvalidProbe!: () => void;
      const invalidProbeStarted = new Promise<void>((resolve) => { markInvalidProbeStarted = resolve; });
      const invalidProbeReleased = new Promise<void>((resolve) => { releaseInvalidProbe = resolve; });
      const probedContents: string[] = [];
      const operation = prepareHtmlVideoBgm({
        ...baseOptions,
        probeMedia: async (_root, path) => {
          const contents = await readFile(path, 'utf8');
          probedContents.push(contents);
          if (probedContents.length === 1) {
            markInvalidProbeStarted();
            await invalidProbeReleased;
            return { duration: 1, hasAudio: false };
          }
          return { duration: 2, hasAudio: contents === 'replacement valid audio' };
        },
      });
      const operationResult = operation.then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (reason: unknown) => ({ status: 'rejected' as const, reason }),
      );

      let replacementIdentity: Awaited<ReturnType<typeof lstat>>;
      let result: Awaited<typeof operationResult>;
      try {
        await invalidProbeStarted;
        await unlink(cachedPath!);
        await writeFile(cachedPath!, Buffer.from('replacement valid audio'), { flag: 'wx' });
        replacementIdentity = await lstat(cachedPath!, { bigint: true });
        expect(replacementIdentity.dev.toString()).toBe(invalidIdentity.dev.toString());
        expect(replacementIdentity.ino.toString()).not.toBe(invalidIdentity.ino.toString());
        await unlink(sourcePath);
      } finally {
        releaseInvalidProbe();
        result = await operationResult;
      }

      expect(result.status).toBe('fulfilled');
      if (result.status !== 'fulfilled') return;
      expect(result.value).toBe(cachedPath);
      expect(probedContents).toEqual(['corrupted cache', 'replacement valid audio']);
      expect(await readFile(cachedPath!, 'utf8')).toBe('replacement valid audio');
      const finalIdentity = await lstat(cachedPath!, { bigint: true });
      expect(finalIdentity.dev.toString()).toBe(replacementIdentity.dev.toString());
      expect(finalIdentity.ino.toString()).toBe(replacementIdentity.ino.toString());
    });
  });

  it('serializes concurrent repairs of the same invalid BGM cache', async () => {
    await withRuntimeDir(async (workDir) => {
      const sourcePath = join(workDir, 'serialized-cache-repair.wav');
      const baseOptions = {
        taskDirectory: taskDirectoryFor(workDir),
        bgmId: 'selected',
        bgmLibrary: [bgmItem('selected', sourcePath)],
      };
      await writeFile(sourcePath, Buffer.from('valid source audio'));
      const cachedPath = await prepareHtmlVideoBgm({
        ...baseOptions,
        probeMedia: async () => ({ duration: 2, hasAudio: true }),
      });
      await writeFile(cachedPath!, Buffer.from('corrupted cache'));

      let markFirstCacheProbeStarted!: () => void;
      let releaseFirstCacheProbe!: () => void;
      let markSecondProbeStarted!: () => void;
      const firstCacheProbeStarted = new Promise<void>((resolve) => { markFirstCacheProbeStarted = resolve; });
      const firstCacheProbeReleased = new Promise<void>((resolve) => { releaseFirstCacheProbe = resolve; });
      const secondProbeStarted = new Promise<void>((resolve) => { markSecondProbeStarted = resolve; });
      let sourceCopies = 0;
      const dependencies = {
        async copyFile(source: string, destination: string) {
          sourceCopies += 1;
          await copyFile(source, destination);
        },
      };
      const first = prepareHtmlVideoBgm({
        ...baseOptions,
        probeMedia: async (_root, path) => {
          if (path === cachedPath) {
            markFirstCacheProbeStarted();
            await firstCacheProbeReleased;
            return { duration: 1, hasAudio: false };
          }
          return { duration: 2, hasAudio: true };
        },
      }, dependencies);
      await firstCacheProbeStarted;
      const second = prepareHtmlVideoBgm({
        ...baseOptions,
        probeMedia: async (_root, path) => {
          markSecondProbeStarted();
          return await readFile(path, 'utf8') === 'corrupted cache'
            ? { duration: 1, hasAudio: false }
            : { duration: 2, hasAudio: true };
        },
      }, dependencies);

      let secondPhase: 'entered' | 'blocked';
      try {
        secondPhase = await Promise.race([
          secondProbeStarted.then(() => 'entered' as const),
          new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 50)),
        ]);
      } finally {
        releaseFirstCacheProbe();
      }

      await expect(Promise.all([first, second])).resolves.toEqual([cachedPath, cachedPath]);
      expect(secondPhase).toBe('blocked');
      expect(sourceCopies).toBe(1);
      expect(await readFile(cachedPath!, 'utf8')).toBe('valid source audio');
      const publishedInode = (await stat(cachedPath!)).ino;
      await expect(prepareHtmlVideoBgm({
        ...baseOptions,
        probeMedia: async () => ({ duration: 2, hasAudio: true }),
      }, dependencies)).resolves.toBe(cachedPath);
      expect((await stat(cachedPath!)).ino).toBe(publishedInode);
      expect(sourceCopies).toBe(1);
    });
  });

  it('cancels a queued BGM cache waiter without acquiring the lock or blocking its successor', async () => {
    await withRuntimeDir(async (workDir) => {
      const sourcePath = join(workDir, 'cancelled-cache-waiter.wav');
      const baseOptions = {
        taskDirectory: taskDirectoryFor(workDir),
        bgmId: 'selected',
        bgmLibrary: [bgmItem('selected', sourcePath)],
      };
      await writeFile(sourcePath, Buffer.from('valid source audio'));
      let markHolderProbeStarted!: () => void;
      let releaseHolderProbe!: () => void;
      const holderProbeStarted = new Promise<void>((resolve) => { markHolderProbeStarted = resolve; });
      const holderProbeReleased = new Promise<void>((resolve) => { releaseHolderProbe = resolve; });
      let sourceCopies = 0;
      const dependencies = {
        async copyFile(source: string, destination: string) {
          sourceCopies += 1;
          await copyFile(source, destination);
        },
      };
      const holder = prepareHtmlVideoBgm({
        ...baseOptions,
        probeMedia: async () => {
          markHolderProbeStarted();
          await holderProbeReleased;
          return { duration: 2, hasAudio: true };
        },
      }, dependencies);
      await holderProbeStarted;

      const controller = new AbortController();
      const abortReason = new DOMException('Queued BGM preparation cancelled.', 'AbortError');
      let cancelledProbeCalls = 0;
      let successorProbeCalls = 0;
      const cancelled = prepareHtmlVideoBgm({
        ...baseOptions,
        signal: controller.signal,
        probeMedia: async () => {
          cancelledProbeCalls += 1;
          return { duration: 2, hasAudio: true };
        },
      }, dependencies);
      const cancelledResult = cancelled.then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (reason: unknown) => ({ status: 'rejected' as const, reason }),
      );
      const successor = prepareHtmlVideoBgm({
        ...baseOptions,
        probeMedia: async () => {
          successorProbeCalls += 1;
          return { duration: 2, hasAudio: true };
        },
      }, dependencies);

      let cancellationPhase: 'fulfilled' | 'rejected' | 'waiting';
      try {
        controller.abort(abortReason);
        cancellationPhase = await Promise.race([
          cancelledResult.then((result) => result.status),
          new Promise<'waiting'>((resolve) => setTimeout(() => resolve('waiting'), 50)),
        ]);
        expect(successorProbeCalls).toBe(0);
      } finally {
        releaseHolderProbe();
      }

      const [holderPath, rejection, successorPath] = await Promise.all([
        holder,
        cancelledResult,
        successor,
      ]);
      expect(cancellationPhase).toBe('rejected');
      expect(rejection).toEqual({ status: 'rejected', reason: abortReason });
      expect(cancelledProbeCalls).toBe(0);
      expect(successorProbeCalls).toBe(1);
      expect(successorPath).toBe(holderPath);
      expect(sourceCopies).toBe(1);
    });
  });

  it.each(['inputs', 'inputs/bgm'] as const)(
    'rejects a BGM directory link at %s before accessing its external target',
    async (linkLocation) => {
      await withRuntimeDir(async (workDir) => {
        const outsideDir = await mkdtemp(join(tmpdir(), 'storydream-html-bgm-link-target-'));
        const sentinelPath = join(outsideDir, 'sentinel.txt');
        const sourcePath = join(workDir, 'source.wav');
        let probeCalls = 0;
        try {
          await Promise.all([
            writeFile(sentinelPath, Buffer.from('do not touch')),
            writeFile(sourcePath, Buffer.from('audio source')),
          ]);
          const linkPath = linkLocation === 'inputs'
            ? join(workDir, 'inputs')
            : join(workDir, 'inputs', 'bgm');
          if (linkLocation === 'inputs/bgm') {
            await mkdir(join(workDir, 'inputs'));
          }
          await symlink(
            await realpath(outsideDir),
            linkPath,
            process.platform === 'win32' ? 'junction' : 'dir',
          );
          const outsideEntries = await readdir(outsideDir);

          await expect(prepareHtmlVideoBgm({
            taskDirectory: taskDirectoryFor(workDir),
            bgmId: 'selected',
            bgmLibrary: [bgmItem('selected', sourcePath)],
            probeMedia: async () => {
              probeCalls += 1;
              return { duration: 1, hasAudio: true };
            },
          })).rejects.toMatchObject({ code: 'HTML_VIDEO_MEDIA_PATH_INVALID' });
          expect(probeCalls).toBe(0);
          expect(await readFile(sentinelPath, 'utf8')).toBe('do not touch');
          expect(await readdir(outsideDir)).toEqual(outsideEntries);
        } finally {
          await rm(outsideDir, { recursive: true, force: true });
        }
      });
    },
  );

  it('does not clean an external collision after the validated BGM directory is replaced by a link', async () => {
    await withRuntimeDir(async (workDir) => {
      const outsideDir = await mkdtemp(join(tmpdir(), 'storydream-html-bgm-cleanup-target-'));
      const sourcePath = join(workDir, 'cleanup-source.wav');
      const outsideSentinel = join(outsideDir, 'sentinel.txt');
      const probeError = new Error('probe failed after directory replacement');
      let outsideCollision = '';
      try {
        await Promise.all([
          writeFile(sourcePath, Buffer.from('source audio')),
          writeFile(outsideSentinel, Buffer.from('outside sentinel')),
        ]);

        await expect(prepareHtmlVideoBgm({
          taskDirectory: taskDirectoryFor(workDir),
          bgmId: 'selected',
          bgmLibrary: [bgmItem('selected', sourcePath)],
          probeMedia: async (_root, temporaryPath) => {
            const bgmDir = dirname(temporaryPath);
            await rename(bgmDir, join(workDir, 'detached-bgm'));
            await symlink(
              await realpath(outsideDir),
              bgmDir,
              process.platform === 'win32' ? 'junction' : 'dir',
            );
            outsideCollision = join(outsideDir, basename(temporaryPath));
            await writeFile(outsideCollision, Buffer.from('external collision'));
            throw probeError;
          },
        })).rejects.toBe(probeError);
        expect(await readFile(outsideSentinel, 'utf8')).toBe('outside sentinel');
        expect(await readFile(outsideCollision, 'utf8')).toBe('external collision');
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });
  });

  it('rejects a pre-existing task work directory junction outside the trusted app-data root', async () => {
    const trustedRoot = await mkdtemp(join(tmpdir(), 'storydream-html-trusted-root-'));
    const outsideDir = await mkdtemp(join(tmpdir(), 'storydream-html-task-link-target-'));
    const sentinelPath = join(outsideDir, 'sentinel.txt');
    try {
      const tasksRoot = join(trustedRoot, 'storydream', 'tasks');
      await mkdir(tasksRoot, { recursive: true });
      await writeFile(sentinelPath, Buffer.from('outside task data'));
      await symlink(
        await realpath(outsideDir),
        join(tasksRoot, managedTestStorageKey),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const outsideEntries = await readdir(outsideDir);
      const runtimeModule = await import('../electron/html-video-runtime');
      const ensureTaskWorkDir = Reflect.get(runtimeModule, 'ensureHtmlVideoTaskWorkDir');

      expect(typeof ensureTaskWorkDir).toBe('function');
      if (typeof ensureTaskWorkDir !== 'function') return;
      await expect(ensureTaskWorkDir(trustedRoot, 'storydream', managedTestStorageKey)).rejects.toMatchObject({
        code: 'HTML_VIDEO_MEDIA_PATH_INVALID',
      });
      expect(await readFile(sentinelPath, 'utf8')).toBe('outside task data');
      expect(await readdir(outsideDir)).toEqual(outsideEntries);
    } finally {
      await Promise.all([
        rm(trustedRoot, { recursive: true, force: true }),
        rm(outsideDir, { recursive: true, force: true }),
      ]);
    }
  });

  it('resolves only an existing HTML task work directory without recreating a deleted one', async () => {
    const trustedRoot = await mkdtemp(join(tmpdir(), 'storydream-html-existing-task-root-'));
    try {
      const taskDirectory = await ensureHtmlVideoTaskWorkDir(
        trustedRoot,
        'storydream',
        managedTestStorageKey,
      );
      const workDir = taskDirectory.workDir.canonicalPath;
      await rm(workDir, { recursive: true, force: true });
      const resolveExisting = Reflect.get(htmlVideoRuntimeModule, 'resolveExistingHtmlVideoTaskWorkDir');
      const resolver = typeof resolveExisting === 'function'
        ? resolveExisting as typeof ensureHtmlVideoTaskWorkDir
        : ensureHtmlVideoTaskWorkDir;
      const outcome = await resolver(trustedRoot, 'storydream', managedTestStorageKey).then(
        () => ({ status: 'resolved' as const }),
        (error: unknown) => ({ status: 'rejected' as const, error }),
      );

      expect({
        resolverInstalled: typeof resolveExisting === 'function',
        outcome,
        workDirExists: existsSync(workDir),
      }).toMatchObject({
        resolverInstalled: true,
        outcome: {
          status: 'rejected',
          error: { code: 'HTML_VIDEO_MEDIA_PATH_INVALID' },
        },
        workDirExists: false,
      });
    } finally {
      await rm(trustedRoot, { recursive: true, force: true });
    }
  });

  it('rejects a BGM work directory junction outside its required trusted task root', async () => {
    const trustedAppDataRoot = await mkdtemp(join(tmpdir(), 'storydream-html-trusted-root-'));
    const outsideDir = await mkdtemp(join(tmpdir(), 'storydream-html-workdir-link-target-'));
    const sourcePath = join(trustedAppDataRoot, 'source.wav');
    const sentinelPath = join(outsideDir, 'sentinel.txt');
    let probeCalls = 0;
    try {
      const taskDirectory = await ensureHtmlVideoTaskWorkDir(trustedAppDataRoot, 'storydream', managedTestStorageKey);
      const workDir = taskDirectory.workDir.canonicalPath;
      await Promise.all([
        writeFile(sourcePath, Buffer.from('source audio')),
        writeFile(sentinelPath, Buffer.from('outside task data')),
      ]);
      await rename(workDir, join(dirname(workDir), 'detached-task-1'));
      await symlink(
        await realpath(outsideDir),
        workDir,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const outsideEntries = await readdir(outsideDir);

      await expect(prepareHtmlVideoBgm({
        taskDirectory,
        bgmId: 'selected',
        bgmLibrary: [bgmItem('selected', sourcePath)],
        probeMedia: async () => {
          probeCalls += 1;
          return { duration: 1, hasAudio: true };
        },
      })).rejects.toMatchObject({ code: 'HTML_VIDEO_MEDIA_PATH_INVALID' });
      expect(probeCalls).toBe(0);
      expect(await readFile(sentinelPath, 'utf8')).toBe('outside task data');
      expect(await readdir(outsideDir)).toEqual(outsideEntries);
    } finally {
      await Promise.all([
        rm(trustedAppDataRoot, { recursive: true, force: true }),
        rm(outsideDir, { recursive: true, force: true }),
      ]);
    }
  });

  it.each(['prepare', 'runtime'] as const)(
    'pins the trusted tasks root identity against replacement before %s',
    async (operation) => {
      const trustedAppDataRoot = await mkdtemp(join(tmpdir(), 'storydream-html-pinned-root-'));
      const outsideTasksRoot = await mkdtemp(join(tmpdir(), 'storydream-html-replacement-tasks-'));
      const sourcePath = join(trustedAppDataRoot, 'source.wav');
      const outsideTaskDir = join(outsideTasksRoot, managedTestStorageKey);
      const outsideSentinel = join(outsideTaskDir, 'sentinel.txt');
      let probeCalls = 0;
      try {
        const taskDirectory = await ensureHtmlVideoTaskWorkDir(trustedAppDataRoot, 'storydream', managedTestStorageKey);
        await mkdir(outsideTaskDir);
        await Promise.all([
          writeFile(sourcePath, Buffer.from('source audio')),
          writeFile(outsideSentinel, Buffer.from('outside sentinel')),
          writeFile(join(outsideTaskDir, 'voice.wav'), Buffer.from('outside voice')),
        ]);
        const detachedTasksRoot = join(trustedAppDataRoot, 'storydream', 'detached-tasks');
        await rename(taskDirectory.trustedTaskRoot.canonicalPath, detachedTasksRoot);
        await symlink(
          await realpath(outsideTasksRoot),
          taskDirectory.trustedTaskRoot.canonicalPath,
          process.platform === 'win32' ? 'junction' : 'dir',
        );
        const outsideEntries = await readdir(outsideTaskDir);

        if (operation === 'prepare') {
          await expect(prepareHtmlVideoBgm({
            taskDirectory,
            bgmId: 'selected',
            bgmLibrary: [bgmItem('selected', sourcePath)],
            probeMedia: async () => {
              probeCalls += 1;
              return { duration: 1, hasAudio: true };
            },
          })).rejects.toMatchObject({ code: 'HTML_VIDEO_MEDIA_PATH_INVALID' });
        } else {
          const runtime = createElectronHtmlVideoRuntime({
            taskDirectory,
            taskTitle: 'Pinned root runtime',
            renderer: unusedRenderer(),
            probeMedia: async () => {
              probeCalls += 1;
              return { duration: 1, hasAudio: true };
            },
          });
          await expect(runtime.measureAudioDuration(join(taskDirectory.workDir.canonicalPath, 'voice.wav'))).rejects.toMatchObject({
            code: 'HTML_VIDEO_MEDIA_PATH_INVALID',
          });
        }
        expect(probeCalls).toBe(0);
        expect(await readFile(outsideSentinel, 'utf8')).toBe('outside sentinel');
        expect(await readdir(outsideTaskDir)).toEqual(outsideEntries);
      } finally {
        await Promise.all([
          rm(trustedAppDataRoot, { recursive: true, force: true }),
          rm(outsideTasksRoot, { recursive: true, force: true }),
        ]);
      }
    },
  );

  it('publishes preview HTML without writing a pre-existing external hardlink inode', async () => {
    await withRuntimeDir(async (workDir) => {
      const outsideDir = await mkdtemp(join(tmpdir(), 'storydream-html-preview-hardlink-'));
      const fixedHtmlPath = join(workDir, 'html-scenes', 'scene-001.html');
      const sentinel = await createHardlinkSentinel(
        outsideDir,
        fixedHtmlPath,
        'preview-html-sentinel.txt',
        'outside preview HTML sentinel',
      );
      const background = join(workDir, 'preview-html-background.png');
      const foreground = join(workDir, 'preview-html-foreground.png');
      const voice = join(workDir, 'preview-html-voice.wav');
      let captureWorkDir = '';
      try {
        await Promise.all([
          writeFile(background, Buffer.from('background')),
          writeFile(foreground, Buffer.from('foreground')),
          writeFile(voice, Buffer.from('voice')),
        ]);
        const runtime = createElectronHtmlVideoRuntime({
          taskDirectory: taskDirectoryFor(workDir),
          taskTitle: 'Preview HTML hardlink',
          renderer: {
            async capturePreview(input) {
              captureWorkDir = input.workDir;
              expect(input.workDir).not.toBe(workDir);
              expect(input.htmlPath).not.toBe(fixedHtmlPath);
              await writeFile(input.outputPath, Buffer.from('thumbnail'));
              return input.outputPath;
            },
            async render() {
              throw new Error('render was not expected');
            },
          },
          probeMedia: async () => validFinalMediaProbe(),
        });

        const preview = await runtime.createPreviews(runtimeInput(background, foreground, voice));

        expect(await realpath(preview.compositions[0].htmlPath!)).toBe(await realpath(fixedHtmlPath));
        expect(await readFile(fixedHtmlPath, 'utf8')).toContain('<!doctype html>');
        await expectExternalHardlinkSentinelUnchanged(sentinel);
        expect((await stat(fixedHtmlPath, { bigint: true })).ino).not.toBe(sentinel.inode);
        expect(existsSync(captureWorkDir)).toBe(false);
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });
  });

  it('publishes a preview thumbnail without writing a pre-existing external hardlink inode', async () => {
    await withRuntimeDir(async (workDir) => {
      const outsideDir = await mkdtemp(join(tmpdir(), 'storydream-html-thumbnail-hardlink-'));
      const fixedThumbnailPath = join(workDir, 'preview-thumbnails', 'scene-001.jpg');
      const sentinel = await createHardlinkSentinel(
        outsideDir,
        fixedThumbnailPath,
        'preview-thumbnail-sentinel.txt',
        'outside preview thumbnail sentinel',
      );
      const background = join(workDir, 'thumbnail-background.png');
      const foreground = join(workDir, 'thumbnail-foreground.png');
      const voice = join(workDir, 'thumbnail-voice.wav');
      try {
        await Promise.all([
          writeFile(background, Buffer.from('background')),
          writeFile(foreground, Buffer.from('foreground')),
          writeFile(voice, Buffer.from('voice')),
        ]);
        const runtime = createElectronHtmlVideoRuntime({
          taskDirectory: taskDirectoryFor(workDir),
          taskTitle: 'Preview thumbnail hardlink',
          renderer: {
            async capturePreview(input) {
              expect(input.outputPath).not.toBe(fixedThumbnailPath);
              await writeFile(input.outputPath, Buffer.from('new thumbnail'));
              return input.outputPath;
            },
            async render() {
              throw new Error('render was not expected');
            },
          },
          probeMedia: async () => validFinalMediaProbe(),
        });

        const preview = await runtime.createPreviews(runtimeInput(background, foreground, voice));

        expect(await realpath(preview.compositions[0].thumbnailPath!)).toBe(await realpath(fixedThumbnailPath));
        expect(await readFile(fixedThumbnailPath, 'utf8')).toBe('new thumbnail');
        await expectExternalHardlinkSentinelUnchanged(sentinel);
        expect((await stat(fixedThumbnailPath, { bigint: true })).ino).not.toBe(sentinel.inode);
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });
  });

  it('rolls back every stable preview file when post-publish validation fails before commit', async () => {
    await withRuntimeDir(async (workDir) => {
      const htmlDir = join(workDir, 'html-scenes');
      const thumbnailDir = join(workDir, 'preview-thumbnails');
      const fixedHtmlPath = join(htmlDir, 'scene-001.html');
      const fixedThumbnailPath = join(thumbnailDir, 'scene-001.jpg');
      const background = join(workDir, 'rollback-background.png');
      const foreground = join(workDir, 'rollback-foreground.png');
      const voice = join(workDir, 'rollback-voice.wav');
      await Promise.all([
        mkdir(htmlDir, { recursive: true }),
        mkdir(thumbnailDir, { recursive: true }),
        writeFile(background, Buffer.from('background')),
        writeFile(foreground, Buffer.from('foreground')),
        writeFile(voice, Buffer.from('voice')),
      ]);
      await Promise.all([
        writeFile(fixedHtmlPath, 'previous HTML', 'utf8'),
        writeFile(fixedThumbnailPath, 'previous thumbnail', 'utf8'),
      ]);
      let injectedFailures = 0;
      const runtime = createElectronHtmlVideoRuntime({
        taskDirectory: taskDirectoryFor(workDir),
        taskTitle: 'Preview publication rollback',
        renderer: {
          async capturePreview(input) {
            await writeFile(input.outputPath, 'new thumbnail', 'utf8');
            return input.outputPath;
          },
          async render() {
            throw new Error('render was not expected');
          },
        },
        probeMedia: async () => validFinalMediaProbe(),
        publicationFileOperations: {
          lstat: async (path) => {
            const value = await lstat(path, { bigint: true });
            if (
              path === fixedThumbnailPath
              && injectedFailures === 0
              && await readFile(path, 'utf8') === 'new thumbnail'
            ) {
              injectedFailures += 1;
              Object.defineProperty(value, 'size', { value: value.size + 1n });
            }
            return value;
          },
        },
      });

      await expect(runtime.createPreviews(runtimeInput(background, foreground, voice))).rejects.toMatchObject({
        code: 'HTML_VIDEO_PUBLISH_CONFLICT',
      });

      expect(injectedFailures).toBe(1);
      expect(await readFile(fixedHtmlPath, 'utf8')).toBe('previous HTML');
      expect(await readFile(fixedThumbnailPath, 'utf8')).toBe('previous thumbnail');
      expect((await readdir(htmlDir)).filter((name) => name.endsWith('.quarantine'))).toEqual([]);
      expect((await readdir(thumbnailDir)).filter((name) => name.endsWith('.quarantine'))).toEqual([]);
    });
  });

  it('keeps a committed preview successful when backup cleanup fails and reaps it on retry', async () => {
    await withRuntimeDir(async (workDir) => {
      const htmlDir = join(workDir, 'html-scenes');
      const thumbnailDir = join(workDir, 'preview-thumbnails');
      const fixedHtmlPath = join(htmlDir, 'scene-001.html');
      const fixedThumbnailPath = join(thumbnailDir, 'scene-001.jpg');
      const background = join(workDir, 'commit-background.png');
      const foreground = join(workDir, 'commit-foreground.png');
      const voice = join(workDir, 'commit-voice.wav');
      await Promise.all([
        mkdir(htmlDir, { recursive: true }),
        mkdir(thumbnailDir, { recursive: true }),
        writeFile(background, Buffer.from('background')),
        writeFile(foreground, Buffer.from('foreground')),
        writeFile(voice, Buffer.from('voice')),
      ]);
      await Promise.all([
        writeFile(fixedHtmlPath, 'previous HTML', 'utf8'),
        writeFile(fixedThumbnailPath, 'previous thumbnail', 'utf8'),
      ]);
      let cleanupCalls = 0;
      const firstRuntime = createElectronHtmlVideoRuntime({
        taskDirectory: taskDirectoryFor(workDir),
        taskTitle: 'Committed preview cleanup',
        renderer: {
          async capturePreview(input) {
            await writeFile(input.outputPath, 'committed thumbnail', 'utf8');
            return input.outputPath;
          },
          async render() {
            throw new Error('render was not expected');
          },
        },
        probeMedia: async () => validFinalMediaProbe(),
        publicationFileOperations: {
          unlink: async (path) => {
            if (path.endsWith('.quarantine')) {
              cleanupCalls += 1;
              throw new Error('injected quarantine cleanup failure');
            }
            await unlink(path);
          },
        },
      });

      await expect(firstRuntime.createPreviews(runtimeInput(background, foreground, voice))).resolves.toBeTruthy();
      expect(cleanupCalls).toBe(2);
      expect(await readFile(fixedHtmlPath, 'utf8')).toContain('<!doctype html>');
      expect(await readFile(fixedThumbnailPath, 'utf8')).toBe('committed thumbnail');
      expect((await readdir(htmlDir)).filter((name) => name.endsWith('.quarantine'))).toHaveLength(1);
      expect((await readdir(thumbnailDir)).filter((name) => name.endsWith('.quarantine'))).toHaveLength(1);

      const retryRuntime = createElectronHtmlVideoRuntime({
        taskDirectory: taskDirectoryFor(workDir),
        taskTitle: 'Committed preview cleanup retry',
        renderer: {
          async capturePreview(input) {
            await writeFile(input.outputPath, 'retried thumbnail', 'utf8');
            return input.outputPath;
          },
          async render() {
            throw new Error('render was not expected');
          },
        },
        probeMedia: async () => validFinalMediaProbe(),
      });

      await expect(retryRuntime.createPreviews(runtimeInput(background, foreground, voice))).resolves.toBeTruthy();
      expect(await readFile(fixedThumbnailPath, 'utf8')).toBe('retried thumbnail');
      expect((await readdir(htmlDir)).filter((name) => name.endsWith('.quarantine'))).toEqual([]);
      expect((await readdir(thumbnailDir)).filter((name) => name.endsWith('.quarantine'))).toEqual([]);
    });
  });

  it('restores a lone strict quarantine when its destination is missing before a failed retry', async () => {
    await withRuntimeDir(async (workDir) => {
      const htmlDir = join(workDir, 'html-scenes');
      const thumbnailDir = join(workDir, 'preview-thumbnails');
      const fixedHtmlPath = join(htmlDir, 'scene-001.html');
      const fixedThumbnailPath = join(thumbnailDir, 'scene-001.jpg');
      const quarantinePath = join(
        htmlDir,
        '.scene-001.html.00000000-0000-4000-8000-000000000003.quarantine',
      );
      const background = join(workDir, 'restore-background.png');
      const foreground = join(workDir, 'restore-foreground.png');
      const voice = join(workDir, 'restore-voice.wav');
      await Promise.all([
        mkdir(htmlDir, { recursive: true }),
        mkdir(fixedThumbnailPath, { recursive: true }),
        writeFile(background, Buffer.from('background')),
        writeFile(foreground, Buffer.from('foreground')),
        writeFile(voice, Buffer.from('voice')),
      ]);
      await writeFile(quarantinePath, 'recoverable HTML', 'utf8');
      const runtime = createElectronHtmlVideoRuntime({
        taskDirectory: taskDirectoryFor(workDir),
        taskTitle: 'Restore quarantined preview',
        renderer: {
          async capturePreview(input) {
            await writeFile(input.outputPath, 'new thumbnail', 'utf8');
            return input.outputPath;
          },
          async render() {
            throw new Error('render was not expected');
          },
        },
        probeMedia: async () => validFinalMediaProbe(),
      });

      await expect(runtime.createPreviews(runtimeInput(background, foreground, voice))).rejects.toMatchObject({
        code: 'HTML_VIDEO_PUBLISH_CONFLICT',
      });
      expect(await readFile(fixedHtmlPath, 'utf8')).toBe('recoverable HTML');
      expect(existsSync(quarantinePath)).toBe(false);
    });
  });

  it('reaps only a strict quarantine link without following it or touching similar names', async () => {
    await withRuntimeDir(async (workDir) => {
      const outsideDir = await mkdtemp(join(tmpdir(), 'storydream-html-quarantine-link-'));
      const htmlDir = join(workDir, 'html-scenes');
      const thumbnailDir = join(workDir, 'preview-thumbnails');
      const fixedHtmlPath = join(htmlDir, 'scene-001.html');
      const fixedThumbnailPath = join(thumbnailDir, 'scene-001.jpg');
      const quarantineLink = join(
        htmlDir,
        '.scene-001.html.00000000-0000-4000-8000-000000000004.quarantine',
      );
      const similarName = join(htmlDir, '.scene-001.html.not-a-uuid.quarantine');
      const outsideSentinel = join(outsideDir, 'sentinel.txt');
      const background = join(workDir, 'quarantine-link-background.png');
      const foreground = join(workDir, 'quarantine-link-foreground.png');
      const voice = join(workDir, 'quarantine-link-voice.wav');
      try {
        await Promise.all([
          mkdir(htmlDir, { recursive: true }),
          mkdir(thumbnailDir, { recursive: true }),
          writeFile(background, Buffer.from('background')),
          writeFile(foreground, Buffer.from('foreground')),
          writeFile(voice, Buffer.from('voice')),
          writeFile(outsideSentinel, 'outside quarantine sentinel', 'utf8'),
        ]);
        await Promise.all([
          writeFile(fixedHtmlPath, 'previous HTML', 'utf8'),
          writeFile(fixedThumbnailPath, 'previous thumbnail', 'utf8'),
          writeFile(similarName, 'not runtime-owned', 'utf8'),
          symlink(
            outsideDir,
            quarantineLink,
            process.platform === 'win32' ? 'junction' : 'dir',
          ),
        ]);
        const runtime = createElectronHtmlVideoRuntime({
          taskDirectory: taskDirectoryFor(workDir),
          taskTitle: 'Strict quarantine cleanup',
          renderer: {
            async capturePreview(input) {
              await writeFile(input.outputPath, 'new thumbnail', 'utf8');
              return input.outputPath;
            },
            async render() {
              throw new Error('render was not expected');
            },
          },
          probeMedia: async () => validFinalMediaProbe(),
        });

        await expect(runtime.createPreviews(runtimeInput(background, foreground, voice))).resolves.toBeTruthy();
        expect(existsSync(quarantineLink)).toBe(false);
        expect(await readFile(outsideSentinel, 'utf8')).toBe('outside quarantine sentinel');
        expect(await readFile(similarName, 'utf8')).toBe('not runtime-owned');
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });
  });

  it('renders entirely in staging and safely publishes final.mp4 over an external hardlink', async () => {
    await withRuntimeDir(async (workDir) => {
      const outsideDir = await mkdtemp(join(tmpdir(), 'storydream-html-render-hardlink-'));
      const sentinels = await Promise.all([
        createHardlinkSentinel(outsideDir, join(workDir, 'final.mp4'), 'final-sentinel.txt', 'outside final sentinel'),
        createHardlinkSentinel(outsideDir, join(workDir, 'html-scenes', 'scene-001.html'), 'render-html-sentinel.txt', 'outside renderer HTML sentinel'),
        createHardlinkSentinel(outsideDir, join(workDir, 'seg_00.mp4'), 'segment-sentinel.txt', 'outside segment sentinel'),
        createHardlinkSentinel(outsideDir, join(workDir, '_source.mp4'), 'source-sentinel.txt', 'outside source sentinel'),
      ]);
      const [finalSentinel, htmlSentinel, segmentSentinel, sourceSentinel] = sentinels;
      const background = join(workDir, 'staged-render-background.png');
      const foreground = join(workDir, 'staged-render-foreground.png');
      const voice = join(workDir, 'staged-render-voice.wav');
      let renderWorkDir = '';
      try {
        await Promise.all([
          writeFile(background, Buffer.from('background')),
          writeFile(foreground, Buffer.from('foreground')),
          writeFile(voice, Buffer.from('voice')),
        ]);
        const runtime = createElectronHtmlVideoRuntime({
          taskDirectory: taskDirectoryFor(workDir),
          taskTitle: 'Render hardlink staging',
          fps: 2,
          maxLongEdge: 568,
          renderer: {
            async capturePreview() {
              throw new Error('capturePreview was not expected');
            },
            async render(input) {
              renderWorkDir = input.workDir;
              expect(input.workDir).not.toBe(workDir);
              expect(input.outputPath).toBe(join(input.workDir, 'final.mp4'));
              await mkdir(join(input.workDir, 'html-scenes'), { recursive: true });
              await Promise.all([
                writeFile(join(input.workDir, 'html-scenes', 'scene-001.html'), 'new renderer HTML'),
                writeFile(join(input.workDir, 'seg_00.mp4'), 'new segment'),
                writeFile(join(input.workDir, '_source.mp4'), 'new source'),
                writeFile(input.outputPath, Buffer.from('mp4-output')),
              ]);
              return {
                outputPath: input.outputPath,
                sourceVideoPath: join(input.workDir, '_source.mp4'),
                duration: input.totalDurationS,
                taskDir: input.workDir,
                framesDirs: [],
              };
            },
          },
          probeMedia: async () => validFinalMediaProbe(1.25),
          getAvailableDiskBytes: async () => 4 * 1024 * 1024 * 1024,
        });

        const output = await runtime.render({
          ...runtimeInput(background, foreground, voice),
          compositions: [],
        });

        expect(await realpath(output.path)).toBe(await realpath(join(workDir, 'final.mp4')));
        expect(await readFile(output.path, 'utf8')).toBe('mp4-output');
        await Promise.all(sentinels.map(expectExternalHardlinkSentinelUnchanged));
        expect((await stat(output.path, { bigint: true })).ino).not.toBe(finalSentinel.inode);
        for (const sentinel of [htmlSentinel, segmentSentinel, sourceSentinel]) {
          expect((await stat(sentinel.linkedPath, { bigint: true })).ino).toBe(sentinel.inode);
        }
        expect(existsSync(renderWorkDir)).toBe(false);
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });
  });

  it('removes a stale render stage without following hardlinks or directory links outside it', async () => {
    await withRuntimeDir(async (workDir) => {
      const outsideDir = await mkdtemp(join(tmpdir(), 'storydream-html-stale-stage-outside-'));
      const outsideLinkedDir = join(outsideDir, 'linked-directory');
      const outsideLinkedSentinel = join(outsideLinkedDir, 'protected.txt');
      const stagingRoot = join(workDir, '.html-video-staging');
      const staleStage = join(stagingRoot, 'render-00000000-0000-4000-8000-000000000001');
      const background = join(workDir, 'stale-cleanup-background.png');
      const foreground = join(workDir, 'stale-cleanup-foreground.png');
      const voice = join(workDir, 'stale-cleanup-voice.wav');
      try {
        await Promise.all([
          mkdir(staleStage, { recursive: true }),
          mkdir(outsideLinkedDir, { recursive: true }),
          writeFile(background, Buffer.from('background')),
          writeFile(foreground, Buffer.from('foreground')),
          writeFile(voice, Buffer.from('voice')),
        ]);
        await writeFile(outsideLinkedSentinel, 'outside directory sentinel', 'utf8');
        const hardlinkSentinel = await createHardlinkSentinel(
          outsideDir,
          join(staleStage, 'stale-segment.mp4'),
          'stale-hardlink-sentinel.txt',
          'outside stale hardlink sentinel',
        );
        await symlink(
          outsideLinkedDir,
          join(staleStage, 'outside-directory-link'),
          process.platform === 'win32' ? 'junction' : 'dir',
        );
        const runtime = createElectronHtmlVideoRuntime({
          taskDirectory: taskDirectoryFor(workDir),
          taskTitle: 'Stale stage cleanup',
          renderer: {
            async capturePreview(input) {
              expect(existsSync(staleStage)).toBe(false);
              await writeFile(input.outputPath, Buffer.from('thumbnail'));
              return input.outputPath;
            },
            async render() {
              throw new Error('render was not expected');
            },
          },
          probeMedia: async () => validFinalMediaProbe(),
        });

        await expect(runtime.createPreviews(runtimeInput(background, foreground, voice))).resolves.toBeTruthy();

        expect(existsSync(staleStage)).toBe(false);
        await expectExternalHardlinkSentinelUnchanged(hardlinkSentinel);
        expect(await readFile(outsideLinkedSentinel, 'utf8')).toBe('outside directory sentinel');
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });
  });

  it('does not follow a stale stage parent replaced by a junction after readdir', async () => {
    await withRuntimeDir(async (workDir) => {
      const outsideDir = await mkdtemp(join(tmpdir(), 'storydream-html-stale-parent-swap-'));
      const outsideSentinel = join(outsideDir, 'shared-name.txt');
      const stagingRoot = join(workDir, '.html-video-staging');
      const staleStage = join(stagingRoot, 'render-00000000-0000-4000-8000-000000000002');
      const detachedStage = join(stagingRoot, 'detached-by-race-test');
      const background = join(workDir, 'stale-race-background.png');
      const foreground = join(workDir, 'stale-race-foreground.png');
      const voice = join(workDir, 'stale-race-voice.wav');
      try {
        await Promise.all([
          mkdir(staleStage, { recursive: true }),
          writeFile(outsideSentinel, 'outside sentinel', 'utf8'),
          writeFile(background, Buffer.from('background')),
          writeFile(foreground, Buffer.from('foreground')),
          writeFile(voice, Buffer.from('voice')),
        ]);
        await writeFile(join(staleStage, 'shared-name.txt'), 'stale stage file', 'utf8');
        let swaps = 0;
        const runtime = createElectronHtmlVideoRuntime({
          taskDirectory: taskDirectoryFor(workDir),
          taskTitle: 'Stale parent replacement',
          renderer: {
            async capturePreview(input) {
              await writeFile(input.outputPath, Buffer.from('thumbnail'));
              return input.outputPath;
            },
            async render() {
              throw new Error('render was not expected');
            },
          },
          probeMedia: async () => validFinalMediaProbe(),
          stagingFileOperations: {
            readdir: async (path) => {
              const names = await readdir(path);
              if (path !== stagingRoot && swaps === 0) {
                await rename(path, detachedStage);
                await symlink(
                  outsideDir,
                  path,
                  process.platform === 'win32' ? 'junction' : 'dir',
                );
                swaps += 1;
              }
              return names;
            },
          },
        });

        await expect(runtime.createPreviews(runtimeInput(background, foreground, voice))).resolves.toBeTruthy();
        expect(swaps).toBe(1);
        expect(await readFile(outsideSentinel, 'utf8')).toBe('outside sentinel');
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });
  });

  it('does not remove an active stage while a second preview run cleans stale stages', async () => {
    await withRuntimeDir(async (workDir) => {
      const background = join(workDir, 'active-stage-background.png');
      const foreground = join(workDir, 'active-stage-foreground.png');
      const voice = join(workDir, 'active-stage-voice.wav');
      await Promise.all([
        writeFile(background, Buffer.from('background')),
        writeFile(foreground, Buffer.from('foreground')),
        writeFile(voice, Buffer.from('voice')),
      ]);
      let firstStage = '';
      let secondStage = '';
      let captureCalls = 0;
      let markFirstStarted!: () => void;
      let releaseFirst!: () => void;
      let markSecondStarted!: () => void;
      const firstStarted = new Promise<void>((resolve) => {
        markFirstStarted = resolve;
      });
      const firstRelease = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const secondStarted = new Promise<void>((resolve) => {
        markSecondStarted = resolve;
      });
      const runtime = createElectronHtmlVideoRuntime({
        taskDirectory: taskDirectoryFor(workDir),
        taskTitle: 'Active stage preservation',
        renderer: {
          async capturePreview(input) {
            captureCalls += 1;
            if (captureCalls === 1) {
              firstStage = input.workDir;
              markFirstStarted();
              await firstRelease;
            } else {
              secondStage = input.workDir;
              expect(existsSync(firstStage)).toBe(true);
              markSecondStarted();
            }
            await writeFile(input.outputPath, Buffer.from(`thumbnail ${captureCalls}`));
            return input.outputPath;
          },
          async render() {
            throw new Error('render was not expected');
          },
        },
        probeMedia: async () => validFinalMediaProbe(),
      });
      const input = runtimeInput(background, foreground, voice);
      const first = runtime.createPreviews(input);
      await firstStarted;
      const second = runtime.createPreviews(input);
      try {
        await secondStarted;
        await expect(second).resolves.toBeTruthy();
        expect(existsSync(firstStage)).toBe(true);
        releaseFirst();
        await expect(first).resolves.toBeTruthy();
        expect(existsSync(firstStage)).toBe(false);
        expect(existsSync(secondStage)).toBe(false);
      } finally {
        releaseFirst();
        await Promise.allSettled([first, second]);
      }
    });
  });

  it('removes the preview stage when capture fails without replacing the renderer error', async () => {
    await withRuntimeDir(async (workDir) => {
      const background = join(workDir, 'failed-preview-background.png');
      const foreground = join(workDir, 'failed-preview-foreground.png');
      const voice = join(workDir, 'failed-preview-voice.wav');
      const captureError = new Error('preview capture failed');
      let captureStage = '';
      await Promise.all([
        writeFile(background, Buffer.from('background')),
        writeFile(foreground, Buffer.from('foreground')),
        writeFile(voice, Buffer.from('voice')),
      ]);
      const runtime = createElectronHtmlVideoRuntime({
        taskDirectory: taskDirectoryFor(workDir),
        taskTitle: 'Failed preview cleanup',
        renderer: {
          async capturePreview(input) {
            captureStage = input.workDir;
            throw captureError;
          },
          async render() {
            throw new Error('render was not expected');
          },
        },
        probeMedia: async () => validFinalMediaProbe(),
      });

      await expect(runtime.createPreviews(runtimeInput(background, foreground, voice))).rejects.toBe(captureError);
      expect(captureStage).not.toBe('');
      expect(existsSync(captureStage)).toBe(false);
    });
  });

  it('preserves a frozen AppError when the runtime operation and stage cleanup both fail', async () => {
    await withRuntimeDir(async (workDir) => {
      const background = join(workDir, 'double-failure-background.png');
      const foreground = join(workDir, 'double-failure-foreground.png');
      const voice = join(workDir, 'double-failure-voice.wav');
      const captureError = Object.freeze(new AppError(
        'HTML_VIDEO_CAPTURE_FAILED',
        'Preview capture failed.',
        true,
        'diag-double-failure',
      ));
      const cleanupError = new Error('stage cleanup failed');
      await Promise.all([
        writeFile(background, Buffer.from('background')),
        writeFile(foreground, Buffer.from('foreground')),
        writeFile(voice, Buffer.from('voice')),
      ]);
      const runtime = createElectronHtmlVideoRuntime({
        taskDirectory: taskDirectoryFor(workDir),
        taskTitle: 'Double failure semantics',
        renderer: {
          async capturePreview() {
            throw captureError;
          },
          async render() {
            throw new Error('render was not expected');
          },
        },
        probeMedia: async () => validFinalMediaProbe(),
        stagingFileOperations: {
          remove: async () => {
            throw cleanupError;
          },
        },
      });

      const error = await runtime.createPreviews(runtimeInput(background, foreground, voice)).catch((reason) => reason);
      expect(error).toMatchObject({
        name: 'AppError',
        code: 'HTML_VIDEO_CAPTURE_FAILED',
        message: 'Preview capture failed.',
        retryable: true,
        diagnosticId: 'diag-double-failure',
      });
      expect((error as Error & { cause?: unknown }).cause).toBe(cleanupError);
    });
  });

  it('preserves cancellation semantics when an aborted operation and stage cleanup both fail', async () => {
    await withRuntimeDir(async (workDir) => {
      const background = join(workDir, 'cancel-cleanup-background.png');
      const foreground = join(workDir, 'cancel-cleanup-foreground.png');
      const voice = join(workDir, 'cancel-cleanup-voice.wav');
      const abortError = Object.freeze(Object.assign(new Error('Preview capture cancelled.'), {
        name: 'AbortError',
        code: 'ABORT_ERR',
        retryable: false,
      }));
      const cleanupError = new Error('cancelled stage cleanup failed');
      await Promise.all([
        writeFile(background, Buffer.from('background')),
        writeFile(foreground, Buffer.from('foreground')),
        writeFile(voice, Buffer.from('voice')),
      ]);
      const runtime = createElectronHtmlVideoRuntime({
        taskDirectory: taskDirectoryFor(workDir),
        taskTitle: 'Cancellation cleanup semantics',
        renderer: {
          async capturePreview() {
            throw abortError;
          },
          async render() {
            throw new Error('render was not expected');
          },
        },
        probeMedia: async () => validFinalMediaProbe(),
        stagingFileOperations: {
          remove: async () => {
            throw cleanupError;
          },
        },
      });

      const error = await runtime.createPreviews(runtimeInput(background, foreground, voice)).catch((reason) => reason);
      expect(error).toMatchObject({
        name: 'AbortError',
        code: 'ABORT_ERR',
        message: 'Preview capture cancelled.',
        retryable: false,
      });
      expect(isCancellation(error)).toBe(true);
      expect((error as Error & { cause?: unknown }).cause).toBe(cleanupError);
    });
  });

  it('preserves a frozen generic error cause and custom diagnostics separately from cleanup failure', async () => {
    await withRuntimeDir(async (workDir) => {
      const background = join(workDir, 'generic-double-failure-background.png');
      const foreground = join(workDir, 'generic-double-failure-foreground.png');
      const voice = join(workDir, 'generic-double-failure-voice.wav');
      const operationCause = new Error('upstream provider connection failed');
      const providerContext = Object.freeze({ provider: 'custom-image', requestId: 'request-42' });
      const captureError = new Error('generic preview capture failed', { cause: operationCause }) as Error & {
        code?: string;
        retryable?: boolean;
        diagnosticId?: string;
        providerContext?: typeof providerContext;
      };
      captureError.name = 'ProviderError';
      captureError.code = 'PROVIDER_CAPTURE_FAILED';
      captureError.retryable = true;
      Object.defineProperties(captureError, {
        diagnosticId: { configurable: true, enumerable: false, value: 'diag-generic-double-failure' },
        providerContext: { configurable: true, enumerable: true, value: providerContext },
      });
      Object.freeze(captureError);
      const cleanupError = new Error('generic stage cleanup failed');
      await Promise.all([
        writeFile(background, Buffer.from('background')),
        writeFile(foreground, Buffer.from('foreground')),
        writeFile(voice, Buffer.from('voice')),
      ]);
      const runtime = createElectronHtmlVideoRuntime({
        taskDirectory: taskDirectoryFor(workDir),
        taskTitle: 'Generic double failure semantics',
        renderer: {
          async capturePreview() {
            throw captureError;
          },
          async render() {
            throw new Error('render was not expected');
          },
        },
        probeMedia: async () => validFinalMediaProbe(),
        stagingFileOperations: {
          remove: async () => {
            throw cleanupError;
          },
        },
      });

      const error = await runtime.createPreviews(runtimeInput(background, foreground, voice)).catch((reason) => reason) as Error & {
        cause?: unknown;
        cleanupError?: unknown;
        code?: string;
        retryable?: boolean;
        diagnosticId?: string;
        providerContext?: typeof providerContext;
      };
      expect(error).not.toBe(captureError);
      expect(error).toMatchObject({
        name: 'ProviderError',
        message: 'generic preview capture failed',
        code: 'PROVIDER_CAPTURE_FAILED',
        retryable: true,
        diagnosticId: 'diag-generic-double-failure',
        providerContext,
      });
      expect(error.cause).toBe(operationCause);
      expect(error.cleanupError).toBe(cleanupError);
      expect(Object.getOwnPropertyDescriptor(error, 'diagnosticId')?.enumerable).toBe(false);
      expect(Object.getOwnPropertyDescriptor(error, 'providerContext')?.writable).toBe(false);
    });
  });

  it('creates task-local HTML thumbnails and validates the rendered MP4', async () => {
    await withRuntimeDir(async (workDir) => {
      const background = join(workDir, 'background.png');
      const foreground = join(workDir, 'foreground.png');
      const voice = join(workDir, 'voice.wav');
      await Promise.all([
        writeFile(background, Buffer.from('background')),
        writeFile(foreground, Buffer.from('foreground')),
        writeFile(voice, Buffer.from('voice')),
      ]);
      const capturedHtml: string[] = [];
      let renderedComposition: HtmlVideoExportInput | null = null;
      const runtime = createElectronHtmlVideoRuntime({
        taskDirectory: taskDirectoryFor(workDir),
        taskTitle: 'Runtime smoke',
        fps: 2,
        maxLongEdge: 568,
        renderer: {
          async capturePreview(input) {
            capturedHtml.push(await readFile(input.htmlPath, 'utf8'));
            await writeFile(input.outputPath, Buffer.from('thumbnail'));
            return input.outputPath;
          },
          async render(input) {
            renderedComposition = input;
            await writeFile(input.outputPath, Buffer.from('mp4-output'));
            return {
              outputPath: input.outputPath,
              sourceVideoPath: join(workDir, '_source.mp4'),
              duration: input.totalDurationS,
              taskDir: workDir,
              framesDirs: [],
            };
          },
        },
        probeMedia: async () => validFinalMediaProbe(1.25),
        getAvailableDiskBytes: async () => 4 * 1024 * 1024 * 1024,
      });
      const input = runtimeInput(background, foreground, voice);

      const preview = await runtime.createPreviews(input);
      const compositions = preview.compositions as Array<HtmlVideoCompositionSnapshot & { thumbnailPath?: string }>;
      expect(compositions).toHaveLength(1);
      expect(compositions[0]).toMatchObject({
        index: 1,
        canvas: { w: 320, h: 568 },
      });
      expect(await realpath(compositions[0].thumbnailPath!)).toBe(await realpath(join(workDir, 'preview-thumbnails', 'scene-001.jpg')));
      expect(capturedHtml[0]).toContain('scene-foreground');
      expect(capturedHtml[0]).toContain('foreground.png');

      const output = await runtime.render({ ...input, compositions: preview.compositions });
      expect(output).toMatchObject({ sizeBytes: 10, durationSec: 1.25 });
      expect(await realpath(output.path)).toBe(await realpath(join(workDir, 'final.mp4')));
      expect(renderedComposition).toMatchObject({ fps: 2, canvas_w: 320, canvas_h: 568, totalDurationS: 1.25 });
    });
  });

  it('rejects external or URL scene media before preview capture and render', async () => {
    const cases = [
      { label: 'background', apply: (input: ReturnType<typeof runtimeInput>, value: string) => { input.assets[0].src = value; } },
      { label: 'foreground', apply: (input: ReturnType<typeof runtimeInput>, value: string) => { input.assets[1].src = value; } },
      { label: 'voice', apply: (input: ReturnType<typeof runtimeInput>, value: string) => { input.voices[0].src = value; } },
    ];
    for (const mediaCase of cases) {
      await withRuntimeDir(async (workDir) => {
        const background = join(workDir, `${mediaCase.label}-background.png`);
        const foreground = join(workDir, `${mediaCase.label}-foreground.png`);
        const voice = join(workDir, `${mediaCase.label}-voice.wav`);
        const outside = `${workDir}-${mediaCase.label}-outside.bin`;
        await Promise.all([
          writeFile(background, Buffer.from('background')),
          writeFile(foreground, Buffer.from('foreground')),
          writeFile(voice, Buffer.from('voice')),
          writeFile(outside, Buffer.from('outside')),
        ]);
        try {
          for (const invalidPath of [outside, 'https://example.invalid/media']) {
            let rendererCalls = 0;
            const runtime = createElectronHtmlVideoRuntime({
              taskDirectory: taskDirectoryFor(workDir),
              taskTitle: 'Reject external runtime media',
              renderer: {
                async capturePreview() {
                  rendererCalls += 1;
                  throw new Error('preview renderer must not be called');
                },
                async render() {
                  rendererCalls += 1;
                  throw new Error('video renderer must not be called');
                },
              },
              probeMedia: async () => validFinalMediaProbe(),
              getAvailableDiskBytes: async () => 4 * 1024 * 1024 * 1024,
            });
            const input = runtimeInput(background, foreground, voice);
            mediaCase.apply(input, invalidPath);

            await expect(runtime.createPreviews(input)).rejects.toMatchObject({
              code: 'HTML_VIDEO_MEDIA_PATH_INVALID',
            });
            await expect(runtime.render({ ...input, compositions: [] })).rejects.toMatchObject({
              code: 'HTML_VIDEO_MEDIA_PATH_INVALID',
            });
            expect(rendererCalls).toBe(0);
          }
        } finally {
          await rm(outside, { force: true });
        }
      });
    }
  });

  it('passes a validated task-local BGM through the runtime composition and compose payload', async () => {
    await withRuntimeDir(async (workDir) => {
      const bgmPath = join(workDir, 'prepared-bgm.wav');
      let compositionBgmPath: string | undefined;
      let payloadBgmPath: string | undefined;
      await writeFile(bgmPath, Buffer.from('prepared BGM'));

      await renderWithMediaProbe(
        workDir,
        async () => validFinalMediaProbe(),
        undefined,
        bgmPath,
        (input) => {
          compositionBgmPath = input.bgmPath;
          payloadBgmPath = createHtmlVideoComposePayload(input, [{
            sceneId: 1,
            framesDir: join(workDir, 'frames-001'),
            audioPath: input.scenes[0].audioPath,
            fps: input.fps,
          }]).bgm_path;
        },
      );

      const canonicalBgmPath = await realpath(bgmPath);
      expect(compositionBgmPath).toBe(canonicalBgmPath);
      expect(payloadBgmPath).toBe(canonicalBgmPath);
    });
  });

  it('rejects a root-external BGM before invoking the runtime renderer', async () => {
    await withRuntimeDir(async (workDir) => {
      const outsidePath = `${workDir}-outside.wav`;
      let rendererCalled = false;
      await writeFile(outsidePath, Buffer.from('outside BGM'));
      try {
        await expect(renderWithMediaProbe(
          workDir,
          async () => validFinalMediaProbe(),
          undefined,
          outsidePath,
          () => {
            rendererCalled = true;
          },
        )).rejects.toMatchObject({ code: 'HTML_VIDEO_MEDIA_PATH_INVALID' });
        expect(rendererCalled).toBe(false);
      } finally {
        await rm(outsidePath, { force: true });
      }
    });
  });

  it('rejects an empty task-local BGM before invoking the runtime renderer', async () => {
    await withRuntimeDir(async (workDir) => {
      const emptyBgmPath = join(workDir, 'empty-bgm.wav');
      let rendererCalled = false;
      await writeFile(emptyBgmPath, Buffer.alloc(0));

      await expect(renderWithMediaProbe(
        workDir,
        async () => validFinalMediaProbe(),
        undefined,
        emptyBgmPath,
        () => {
          rendererCalled = true;
        },
      )).rejects.toMatchObject({ code: 'HTML_VIDEO_MEDIA_FILE_INVALID' });
      expect(rendererCalled).toBe(false);
    });
  });

  it('serializes audio-only duration probes and forwards the active abort signal', async () => {
    await withRuntimeDir(async (workDir) => {
      let active = 0;
      let maxActive = 0;
      const signals: Array<AbortSignal | undefined> = [];
      const runtime = createElectronHtmlVideoRuntime({
        taskDirectory: taskDirectoryFor(workDir),
        taskTitle: 'Probe queue',
        renderer: unusedRenderer(),
        async probeMedia(_root, _path, signal) {
          signals.push(signal);
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 10));
          active -= 1;
          return { duration: 0.5, hasAudio: true, hasVideo: false };
        },
      });
      const controller = new AbortController();
      await Promise.all([
        writeFile(join(workDir, 'a.wav'), Buffer.from('a')),
        writeFile(join(workDir, 'b.wav'), Buffer.from('b')),
      ]);

      await expect(Promise.all([
        runtime.measureAudioDuration(join(workDir, 'a.wav'), controller.signal),
        runtime.measureAudioDuration(join(workDir, 'b.wav'), controller.signal),
      ])).resolves.toEqual([0.5, 0.5]);
      expect(maxActive).toBe(1);
      expect(signals).toEqual([controller.signal, controller.signal]);
    });
  });

  it('rejects a runtime work directory junction outside its required trusted task root', async () => {
    const trustedAppDataRoot = await mkdtemp(join(tmpdir(), 'storydream-html-runtime-trusted-root-'));
    const outsideDir = await mkdtemp(join(tmpdir(), 'storydream-html-runtime-task-link-target-'));
    const voicePath = join(outsideDir, 'voice.wav');
    let probeCalls = 0;
    try {
      const taskDirectory = await ensureHtmlVideoTaskWorkDir(trustedAppDataRoot, 'storydream', managedTestStorageKey);
      const workDir = taskDirectory.workDir.canonicalPath;
      await writeFile(voicePath, Buffer.from('outside voice'));
      await rename(workDir, join(dirname(workDir), 'detached-task-1'));
      await symlink(
        await realpath(outsideDir),
        workDir,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const runtime = createElectronHtmlVideoRuntime({
        taskDirectory,
        taskTitle: 'Untrusted work directory',
        renderer: unusedRenderer(),
        probeMedia: async () => {
          probeCalls += 1;
          return { duration: 1, hasAudio: true };
        },
      });

      await expect(runtime.measureAudioDuration(join(workDir, 'voice.wav'))).rejects.toMatchObject({
        code: 'HTML_VIDEO_MEDIA_PATH_INVALID',
      });
      expect(probeCalls).toBe(0);
    } finally {
      await Promise.all([
        rm(trustedAppDataRoot, { recursive: true, force: true }),
        rm(outsideDir, { recursive: true, force: true }),
      ]);
    }
  });

  it('uses the canonical final media probe duration instead of renderer metadata', async () => {
    await withRuntimeDir(async (workDir) => {
      const controller = new AbortController();
      const probes: Array<{ root: string; path: string; signal?: AbortSignal }> = [];

      const output = await renderWithMediaProbe(workDir, async (root, path, signal) => {
        probes.push({ root, path, signal });
        return validFinalMediaProbe(1.1);
      }, controller.signal);

      expect(output.durationSec).toBe(1.1);
      expect(probes).toHaveLength(1);
      expect(probes[0].root).not.toBe(await realpath(workDir));
      expect(probes[0].path).toBe(join(probes[0].root, 'final.mp4'));
      expect(probes[0].signal).toBe(controller.signal);
      expect(existsSync(probes[0].root)).toBe(false);
    });
  });

  it('rejects a staging output replaced during the final media probe without publishing it', async () => {
    await withRuntimeDir(async (workDir) => {
      await expect(renderWithMediaProbe(workDir, async (_root, path) => {
        await unlink(path);
        await writeFile(path, Buffer.from('tampered!!'));
        return validFinalMediaProbe(1.1);
      })).rejects.toMatchObject({
        code: 'HTML_VIDEO_OUTPUT_CHANGED',
        retryable: true,
      });
      expect(existsSync(join(workDir, 'final.mp4'))).toBe(false);
    });
  });

  it('rejects an equal-size in-place staging overwrite during the final media probe', async () => {
    await withRuntimeDir(async (workDir) => {
      let beforeInode = 0n;
      let afterInode = 0n;
      let beforeSize = 0n;
      let afterSize = 0n;
      await expect(renderWithMediaProbe(workDir, async (_root, path) => {
        const before = await stat(path, { bigint: true });
        beforeInode = before.ino;
        beforeSize = before.size;
        await writeFile(path, Buffer.from('tampered!!'));
        const after = await stat(path, { bigint: true });
        afterInode = after.ino;
        afterSize = after.size;
        return validFinalMediaProbe(1.1);
      })).rejects.toMatchObject({
        code: 'HTML_VIDEO_OUTPUT_CHANGED',
        retryable: true,
      });
      expect(afterInode).toBe(beforeInode);
      expect(afterSize).toBe(beforeSize);
      expect(existsSync(join(workDir, 'final.mp4'))).toBe(false);
    });
  });

  it('rolls back an equal-size in-place overwrite after publication rename', async () => {
    await withRuntimeDir(async (workDir) => {
      let mutations = 0;
      let beforeInode = 0n;
      let afterInode = 0n;
      let beforeSize = 0n;
      let afterSize = 0n;
      await expect(renderWithMediaProbe(
        workDir,
        async () => validFinalMediaProbe(1.1),
        undefined,
        undefined,
        undefined,
        undefined,
        (options) => {
          options.publicationFileOperations = {
            lstat: async (path) => {
              const value = await lstat(path, { bigint: true });
              if (path === join(workDir, 'final.mp4') && mutations === 0) {
                beforeInode = value.ino;
                beforeSize = value.size;
                await writeFile(path, Buffer.from('tampered!!'));
                const after = await lstat(path, { bigint: true });
                afterInode = after.ino;
                afterSize = after.size;
                mutations += 1;
              }
              return value;
            },
          };
        },
      )).rejects.toMatchObject({
        code: 'HTML_VIDEO_PUBLISH_CONFLICT',
        retryable: true,
      });
      expect(mutations).toBe(1);
      expect(afterInode).toBe(beforeInode);
      expect(afterSize).toBe(beforeSize);
      expect(existsSync(join(workDir, 'final.mp4'))).toBe(false);
    });
  });

  it('quarantines a different-inode publication conflict and restores the previous final repeatedly', async () => {
    await withRuntimeDir(async (workDir) => {
      const finalPath = join(workDir, 'final.mp4');

      for (let round = 1; round <= 2; round += 1) {
        await writeFile(finalPath, Buffer.from('verified-old'));
        const foreignPath = join(workDir, `.foreign-final-${round}.mp4`);
        await writeFile(foreignPath, Buffer.from('foreign!!!'));
        let canonicalLstatCalls = 0;
        let publishedInode = 0n;
        let foreignInode = 0n;

        const error = await renderWithMediaProbe(
          workDir,
          async () => validFinalMediaProbe(1.1),
          undefined,
          undefined,
          undefined,
          undefined,
          (options) => {
            options.publicationFileOperations = {
              lstat: async (path) => {
                const value = await lstat(path, { bigint: true });
                if (path === finalPath) {
                  canonicalLstatCalls += 1;
                  if (foreignInode === 0n && value.size === BigInt(Buffer.byteLength('mp4-output'))) {
                    publishedInode = value.ino;
                    await unlink(finalPath);
                    await rename(foreignPath, finalPath);
                    foreignInode = (await lstat(finalPath, { bigint: true })).ino;
                    expect(foreignInode).not.toBe(publishedInode);
                  }
                }
                return value;
              },
            };
          },
        ).catch((reason) => reason);

        expect(error).not.toBeInstanceOf(AggregateError);
        expect(error).toMatchObject({
          code: 'HTML_VIDEO_PUBLISH_CONFLICT',
          retryable: true,
        });
        expect(canonicalLstatCalls).toBeGreaterThanOrEqual(4);
        expect(foreignInode).not.toBe(0n);
        expect(await readFile(finalPath, 'utf8')).toBe('verified-old');
        expect(existsSync(foreignPath)).toBe(false);
        expect((await readdir(workDir)).filter((name) => name.endsWith('.quarantine'))).toEqual([]);
        expect((await readdir(workDir)).filter((name) => name.endsWith('.conflict-quarantine'))).toEqual([]);
      }
    });
  });

  it('restores the previous final repeatedly when the published final disappears before rollback', async () => {
    await withRuntimeDir(async (workDir) => {
      const finalPath = join(workDir, 'final.mp4');

      for (let round = 1; round <= 2; round += 1) {
        const previousFinal = `verified-old-${round}`;
        await writeFile(finalPath, Buffer.from(previousFinal));
        let deletedPublishedFinal = false;

        const error = await renderWithMediaProbe(
          workDir,
          async () => validFinalMediaProbe(1.1),
          undefined,
          undefined,
          undefined,
          undefined,
          (options) => {
            options.publicationFileOperations = {
              lstat: async (path) => {
                const value = await lstat(path, { bigint: true });
                if (
                  path === finalPath
                  && !deletedPublishedFinal
                  && value.size === BigInt(Buffer.byteLength('mp4-output'))
                ) {
                  await unlink(finalPath);
                  deletedPublishedFinal = true;
                  Object.defineProperty(value, 'size', { value: value.size + 1n });
                }
                return value;
              },
            };
          },
        ).catch((reason) => reason);

        expect(error).not.toBeInstanceOf(AggregateError);
        expect(error).toMatchObject({
          code: 'HTML_VIDEO_PUBLISH_CONFLICT',
          retryable: true,
        });
        expect(deletedPublishedFinal).toBe(true);
        await expect(readFile(finalPath, 'utf8')).resolves.toBe(previousFinal);
        expect((await readdir(workDir)).filter((name) => name.endsWith('.quarantine'))).toEqual([]);
        expect((await readdir(workDir)).filter((name) => name.endsWith('.conflict-quarantine'))).toEqual([]);
      }
    });
  });

  it('restores the previous final after moving a conflict even when conflict quarantine verification races', async () => {
    await withRuntimeDir(async (workDir) => {
      const finalPath = join(workDir, 'final.mp4');
      const foreignPath = join(workDir, '.foreign-final-race.mp4');
      const quarantineRacePath = join(workDir, '.foreign-quarantine-race.mp4');
      await Promise.all([
        writeFile(finalPath, Buffer.from('verified-old')),
        writeFile(foreignPath, Buffer.from('foreign!!!')),
        writeFile(quarantineRacePath, Buffer.from('raced!!!!!')),
      ]);
      let publishedReplaced = false;
      let quarantineReplaced = false;

      const error = await renderWithMediaProbe(
        workDir,
        async () => validFinalMediaProbe(1.1),
        undefined,
        undefined,
        undefined,
        undefined,
        (options) => {
          options.publicationFileOperations = {
            lstat: async (path) => {
              const value = await lstat(path, { bigint: true });
              if (
                path === finalPath
                && !publishedReplaced
                && value.size === BigInt(Buffer.byteLength('mp4-output'))
              ) {
                await unlink(finalPath);
                await rename(foreignPath, finalPath);
                publishedReplaced = true;
                return value;
              }
              if (path.endsWith('.conflict-quarantine') && !quarantineReplaced) {
                await unlink(path);
                await rename(quarantineRacePath, path);
                quarantineReplaced = true;
                return lstat(path, { bigint: true });
              }
              return value;
            },
          };
        },
      ).catch((reason) => reason);

      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'HTML_VIDEO_PUBLISH_CONFLICT' }),
      ]));
      expect(publishedReplaced).toBe(true);
      expect(quarantineReplaced).toBe(true);
      await expect(readFile(finalPath, 'utf8')).resolves.toBe('verified-old');
      expect((await readdir(workDir)).filter((name) => name.endsWith('.quarantine'))).toEqual([]);
      const [conflictQuarantineName] = (await readdir(workDir))
        .filter((name) => name.endsWith('.conflict-quarantine'));
      expect(conflictQuarantineName).toBeTruthy();
      await expect(readFile(join(workDir, conflictQuarantineName), 'utf8')).resolves.toBe('raced!!!!!');

      const retried = await renderWithMediaProbe(
        workDir,
        async () => validFinalMediaProbe(1.1),
      );

      expect(retried.path).toBe(finalPath);
      await expect(readFile(finalPath, 'utf8')).resolves.toBe('mp4-output');
      expect((await readdir(workDir)).filter((name) => name.endsWith('.conflict-quarantine'))).toEqual([]);
    });
  });

  it('reaps only strict conflict quarantine files and links without restoring or recursing', async () => {
    await withRuntimeDir(async (workDir) => {
      const outsideDir = await mkdtemp(join(tmpdir(), 'storydream-html-conflict-quarantine-link-'));
      const finalPath = join(workDir, 'final.mp4');
      const strictFile = join(workDir, '.final.mp4.00000000-0000-4000-8000-000000000005.conflict-quarantine');
      const strictLink = join(workDir, '.final.mp4.00000000-0000-4000-8000-000000000006.conflict-quarantine');
      const strictDirectory = join(workDir, '.final.mp4.00000000-0000-4000-8000-000000000007.conflict-quarantine');
      const similarName = join(workDir, '.final.mp4.not-a-uuid.conflict-quarantine');
      const outsideSentinel = join(outsideDir, 'sentinel.txt');
      const directorySentinel = join(strictDirectory, 'sentinel.txt');
      try {
        await Promise.all([
          writeFile(finalPath, Buffer.from('verified-old')),
          writeFile(strictFile, Buffer.from('never restore this conflict')),
          mkdir(strictDirectory, { recursive: true }),
          writeFile(similarName, Buffer.from('not runtime-owned')),
          writeFile(outsideSentinel, Buffer.from('outside conflict sentinel')),
        ]);
        await writeFile(directorySentinel, Buffer.from('directory sentinel'));
        await symlink(
          outsideDir,
          strictLink,
          process.platform === 'win32' ? 'junction' : 'dir',
        );

        const output = await renderWithMediaProbe(
          workDir,
          async () => validFinalMediaProbe(1.1),
        );

        expect(output.path).toBe(finalPath);
        await expect(readFile(finalPath, 'utf8')).resolves.toBe('mp4-output');
        expect(existsSync(strictFile)).toBe(false);
        expect(existsSync(strictLink)).toBe(false);
        await expect(readFile(outsideSentinel, 'utf8')).resolves.toBe('outside conflict sentinel');
        await expect(readFile(directorySentinel, 'utf8')).resolves.toBe('directory sentinel');
        await expect(readFile(similarName, 'utf8')).resolves.toBe('not runtime-owned');
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });
  });

  it('does not unlink a strict conflict quarantine whose identity changes during cleanup', async () => {
    await withRuntimeDir(async (workDir) => {
      const finalPath = join(workDir, 'final.mp4');
      const quarantinePath = join(
        workDir,
        '.final.mp4.00000000-0000-4000-8000-000000000008.conflict-quarantine',
      );
      const replacementPath = join(workDir, '.replacement-conflict-quarantine');
      await Promise.all([
        writeFile(finalPath, Buffer.from('verified-old')),
        writeFile(quarantinePath, Buffer.from('original conflict')),
        writeFile(replacementPath, Buffer.from('replacement conflict')),
      ]);
      let quarantineLstatCalls = 0;

      const error = await renderWithMediaProbe(
        workDir,
        async () => validFinalMediaProbe(1.1),
        undefined,
        undefined,
        undefined,
        undefined,
        (options) => {
          options.publicationFileOperations = {
            lstat: async (path) => {
              const value = await lstat(path, { bigint: true });
              if (path === quarantinePath) {
                quarantineLstatCalls += 1;
                if (quarantineLstatCalls === 1) {
                  await unlink(quarantinePath);
                  await rename(replacementPath, quarantinePath);
                }
              }
              return value;
            },
          };
        },
      ).catch((reason) => reason);

      expect(error).toMatchObject({
        code: 'HTML_VIDEO_PUBLISH_CONFLICT',
        retryable: true,
      });
      expect(quarantineLstatCalls).toBe(2);
      await expect(readFile(finalPath, 'utf8')).resolves.toBe('verified-old');
      await expect(readFile(quarantinePath, 'utf8')).resolves.toBe('replacement conflict');
    });
  });

  it('bounds strict conflict quarantine cleanup before touching an excessive set', async () => {
    await withRuntimeDir(async (workDir) => {
      const finalPath = join(workDir, 'final.mp4');
      const quarantinePaths = Array.from({ length: 33 }, (_, index) => join(
        workDir,
        `.final.mp4.00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}.conflict-quarantine`,
      ));
      await writeFile(finalPath, Buffer.from('verified-old'));
      await Promise.all(quarantinePaths.map((path, index) => writeFile(path, Buffer.from(`conflict-${index}`))));

      const error = await renderWithMediaProbe(
        workDir,
        async () => validFinalMediaProbe(1.1),
      ).catch((reason) => reason);

      expect(error).toMatchObject({
        code: 'HTML_VIDEO_PUBLISH_CONFLICT',
        retryable: true,
      });
      await expect(readFile(finalPath, 'utf8')).resolves.toBe('verified-old');
      expect((await readdir(workDir)).filter((name) => name.endsWith('.conflict-quarantine'))).toHaveLength(33);
    });
  });

  it('preserves cancellation when aborted during final output digest reading', async () => {
    await withRuntimeDir(async (workDir) => {
      const controller = new AbortController();
      const abortReason = new DOMException('Final output digest cancelled.', 'AbortError');
      let yieldedChunks = 0;
      let probeCalls = 0;
      await expect(renderWithMediaProbe(
        workDir,
        async () => {
          probeCalls += 1;
          return validFinalMediaProbe(1.1);
        },
        controller.signal,
        undefined,
        undefined,
        undefined,
        (options) => {
          options.publicationFileOperations = {
            openDigestFile: async (path, openFile) => openFile(path),
            onDigestRead: () => {
              yieldedChunks += 1;
              controller.abort(abortReason);
            },
          };
        },
      )).rejects.toBe(abortReason);
      expect(yieldedChunks).toBeGreaterThan(0);
      expect(probeCalls).toBe(0);
      expect(existsSync(join(workDir, 'final.mp4'))).toBe(false);
    });
  });

  it('preserves cancellation when the third digest handle closes', async () => {
    await withRuntimeDir(async (workDir) => {
      const controller = new AbortController();
      const abortReason = new DOMException('Third digest close cancelled.', 'AbortError');
      let opens = 0;
      const runtime = await createRenderRuntimeWithMediaProbe(
        workDir,
        async () => validFinalMediaProbe(1.1),
        (options) => {
          options.publicationFileOperations = {
            openDigestFile: async (path, openFile) => {
              opens += 1;
              return openFile(path);
            },
            onDigestFileClosed: () => {
              if (opens === 3) controller.abort(abortReason);
            },
          };
        },
      );

      await expect(runtime.render({
        ...createRenderRuntimeInput(workDir),
        signal: controller.signal,
      })).rejects.toBe(abortReason);
      expect(opens).toBe(3);
    });
  });

  it('rejects foreign digest bytes instead of proving the final path and consumer artifact', async () => {
    await withRuntimeDir(async (workDir) => {
      const foreignPath = join(workDir, 'foreign-digest-stream.mp4');
      await writeFile(foreignPath, Buffer.alloc(20, 0x66));
      let digestReads = 0;
      const runtime = await createRenderRuntimeWithMediaProbe(
        workDir,
        async () => validFinalMediaProbe(1.1),
        (options) => {
          options.publicationFileOperations = {
            openDigestFile: async (_path, openFile) => {
              digestReads += 1;
              return openFile(foreignPath);
            },
          };
        },
      );
      const outcome = await runtime.render(createRenderRuntimeInput(workDir)).then(async (output) => ({
        status: 'accepted' as const,
        proof: await runtime.consumeRenderArtifactDigest(output),
      }), (error: unknown) => ({ status: 'rejected' as const, error }));

      expect({ digestReads, outcome }).toMatchObject({
        outcome: {
          status: 'rejected',
          error: { code: 'HTML_VIDEO_OUTPUT_CHANGED' },
        },
      });
      expect(digestReads).toBe(1);
    });
  });

  it('rejects a same-size digest handle opened on a foreign inode', async () => {
    await withRuntimeDir(async (workDir) => {
      const foreignPath = join(workDir, 'foreign-final.mp4');
      await writeFile(foreignPath, Buffer.from('foreign!!!'));
      let opens = 0;
      let openedFile: HtmlVideoDigestFile | undefined;

      await expect(renderWithMediaProbe(
        workDir,
        async () => validFinalMediaProbe(1.1),
        undefined,
        undefined,
        undefined,
        undefined,
        (options) => {
          options.publicationFileOperations = {
            openDigestFile: async (_path, openFile) => {
              opens += 1;
              openedFile = await openFile(foreignPath);
              return openedFile;
            },
          };
        },
      )).rejects.toMatchObject({ code: 'HTML_VIDEO_OUTPUT_CHANGED' });
      expect(opens).toBe(1);
      await expect(openedFile!.stat()).rejects.toBeTruthy();
    });
  });

  it('rejects a same-size path replacement after opening the verified digest handle', async () => {
    await withRuntimeDir(async (workDir) => {
      let opens = 0;
      let swapped = false;
      let openedFile: HtmlVideoDigestFile | undefined;

      await expect(renderWithMediaProbe(
        workDir,
        async () => validFinalMediaProbe(1.1),
        undefined,
        undefined,
        undefined,
        undefined,
        (options) => {
          options.publicationFileOperations = {
            openDigestFile: async (path, openFile) => {
              opens += 1;
              const detachedPath = `${path}.opened`;
              const replacementPath = `${path}.replacement`;
              await writeFile(replacementPath, Buffer.from('foreign!!!'));
              await rename(path, detachedPath);
              await rename(replacementPath, path);
              swapped = true;
              openedFile = await openFile(detachedPath);
              return openedFile;
            },
          };
        },
      )).rejects.toMatchObject({ code: 'HTML_VIDEO_OUTPUT_CHANGED' });
      expect(opens).toBe(1);
      expect(swapped).toBe(true);
      await expect(openedFile!.stat()).rejects.toBeTruthy();
    });
  });

  it('rejects a digest handle that reaches EOF before the pinned size', async () => {
    await withRuntimeDir(async (workDir) => {
      const shortPath = join(workDir, 'short-digest-stream.mp4');
      await writeFile(shortPath, Buffer.alloc(5, 0x73));
      let openedFile: HtmlVideoDigestFile | undefined;

      await expect(renderWithMediaProbe(
        workDir,
        async () => validFinalMediaProbe(1.1),
        undefined,
        undefined,
        undefined,
        undefined,
        (options) => {
          options.publicationFileOperations = {
            openDigestFile: async (_path, openFile) => {
              openedFile = await openFile(shortPath);
              return openedFile;
            },
          };
        },
      )).rejects.toMatchObject({ code: 'HTML_VIDEO_OUTPUT_CHANGED' });
      await expect(openedFile!.stat()).rejects.toBeTruthy();
    });
  });

  it('rejects a digest handle whose real file is longer than the pinned size', async () => {
    await withRuntimeDir(async (workDir) => {
      const longPath = join(workDir, 'long-digest-stream.mp4');
      await writeFile(longPath, Buffer.alloc(11, 0x6c));
      let openedFile: HtmlVideoDigestFile | undefined;

      await expect(renderWithMediaProbe(
        workDir,
        async () => validFinalMediaProbe(1.1),
        undefined,
        undefined,
        undefined,
        undefined,
        (options) => {
          options.publicationFileOperations = {
            openDigestFile: async (_path, openFile) => {
              openedFile = await openFile(longPath);
              return openedFile;
            },
          };
        },
      )).rejects.toMatchObject({ code: 'HTML_VIDEO_OUTPUT_CHANGED' });
      await expect(openedFile!.stat()).rejects.toBeTruthy();
    });
  });

  it('rejects an oversized digest handle before reading and still closes it', async () => {
    await withRuntimeDir(async (workDir) => {
      let openedFile: HtmlVideoDigestFile | undefined;

      await expect(renderWithMediaProbe(
        workDir,
        async () => validFinalMediaProbe(1.1),
        undefined,
        undefined,
        undefined,
        undefined,
        (options) => {
          options.publicationFileOperations = {
            digestByteLimit: Buffer.byteLength('mp4-output') - 1,
            openDigestFile: async (path, openFile) => {
              openedFile = await openFile(path);
              return openedFile;
            },
          };
        },
      )).rejects.toMatchObject({ code: 'HTML_VIDEO_OUTPUT_TOO_LARGE' });
      await expect(openedFile!.stat()).rejects.toBeTruthy();
    });
  });

  it('hashes a successful final output exactly before probe, after probe, and after rename', async () => {
    await withRuntimeDir(async (workDir) => {
      let digestReads = 0;
      const runtime = await createRenderRuntimeWithMediaProbe(
        workDir,
        async () => validFinalMediaProbe(1.1),
        (options) => {
          options.publicationFileOperations = {
            openDigestFile: async (path, openFile) => {
              digestReads += 1;
              return openFile(path);
            },
          };
        },
      );
      const output = await runtime.render(createRenderRuntimeInput(workDir));
      const consumeDigest = (runtime as unknown as {
        consumeRenderArtifactDigest?: (
          output: HtmlVideoOutput,
          signal?: AbortSignal,
        ) => Promise<{ size: number; sha256: string }>;
      }).consumeRenderArtifactDigest;

      expect(output.path).toBe(join(workDir, 'final.mp4'));
      expect(digestReads).toBe(3);
      expect(Object.isFrozen(output)).toBe(true);
      expect(consumeDigest).toBeTypeOf('function');
      if (!consumeDigest) return;
      await expect(consumeDigest({ ...output })).rejects.toBeTruthy();
      await expect(consumeDigest(Object.assign({}, output))).rejects.toBeTruthy();
      await expect(consumeDigest(output)).resolves.toEqual({
        size: Buffer.byteLength('mp4-output'),
        sha256: createHash('sha256').update('mp4-output').digest('hex'),
      });
      await expect(consumeDigest(output)).rejects.toBeTruthy();
    });
  });

  it('rejects a consumed render proof after a same-inode same-size final rewrite', async () => {
    await withRuntimeDir(async (workDir) => {
      const runtime = await createRenderRuntimeWithMediaProbe(
        workDir,
        async () => validFinalMediaProbe(1.1),
      );
      const output = await runtime.render(createRenderRuntimeInput(workDir));
      const before = await lstat(output.path, { bigint: true });
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      await writeFile(output.path, Buffer.from('tampered!!'));
      const after = await lstat(output.path, { bigint: true });
      const consumeDigest = (runtime as unknown as {
        consumeRenderArtifactDigest?: (
          output: HtmlVideoOutput,
          signal?: AbortSignal,
        ) => Promise<{ size: number; sha256: string }>;
      }).consumeRenderArtifactDigest;

      expect(after.ino).toBe(before.ino);
      expect(after.size).toBe(before.size);
      expect(consumeDigest).toBeTypeOf('function');
      if (!consumeDigest) return;
      await expect(consumeDigest(output)).rejects.toMatchObject({ retryable: true });
    });
  });

  it('preserves an AbortError when render proof consumption is cancelled', async () => {
    await withRuntimeDir(async (workDir) => {
      const runtime = await createRenderRuntimeWithMediaProbe(
        workDir,
        async () => validFinalMediaProbe(1.1),
      );
      const output = await runtime.render(createRenderRuntimeInput(workDir));
      const controller = new AbortController();
      const abortReason = new DOMException('Digest proof consumption cancelled.', 'AbortError');
      controller.abort(abortReason);
      const consumeDigest = (runtime as unknown as {
        consumeRenderArtifactDigest?: (
          output: HtmlVideoOutput,
          signal?: AbortSignal,
        ) => Promise<{ size: number; sha256: string }>;
      }).consumeRenderArtifactDigest;

      expect(consumeDigest).toBeTypeOf('function');
      if (!consumeDigest) return;
      await expect(consumeDigest(output, controller.signal)).rejects.toBe(abortReason);
    });
  });

  it('uses the real runtime proof in the runner without a fourth final digest stream', async () => {
    await withRuntimeDir(async (workDir) => {
      let digestReads = 0;
      const runtime = await createRenderRuntimeWithMediaProbe(
        workDir,
        async () => validFinalMediaProbe(1.1),
        (options) => {
          options.publicationFileOperations = {
            openDigestFile: async (path, openFile) => {
              digestReads += 1;
              return openFile(path);
            },
          };
        },
      );
      const consumeRenderArtifactDigest = (runtime as unknown as {
        consumeRenderArtifactDigest?: (
          output: HtmlVideoOutput,
          signal?: AbortSignal,
        ) => Promise<{ size: number; sha256: string }>;
      }).consumeRenderArtifactDigest;
      expect(consumeRenderArtifactDigest).toBeTypeOf('function');
      if (!consumeRenderArtifactDigest) return;
      const state = createHtmlVideoPipelineData('第一幕。', {
        ratio: '9:16',
        style: 'cinematic',
        foreground: false,
      });

      const completed = await runHtmlVideoPipeline({
        taskId: 'real-runtime-digest',
        sourceText: '第一幕。',
        state,
      }, {
        workDir,
        rewrite: async () => ({ rewrittenText: '第一幕。', segments: ['第一幕。'] }),
        plan: async () => ({ scenes: [singleRuntimeScene()] }),
        generateAssets: async () => {
          const path = join(workDir, 'runner-background.png');
          await writeFile(path, Buffer.from('background'));
          return [{ sceneIndex: 1, kind: 'bg', slot: 0, src: path }];
        },
        synthesizeVoices: async () => {
          const path = join(workDir, 'runner-voice.wav');
          await writeFile(path, Buffer.from('voice'));
          return [{ sceneIndex: 1, src: path, durationSec: 1, text: '第一幕。' }];
        },
        createPreviews: runtime.createPreviews,
        render: runtime.render,
        consumeRenderArtifactDigest,
        onCheckpoint: async () => undefined,
      } as Parameters<typeof runHtmlVideoPipeline>[1] & {
        consumeRenderArtifactDigest: typeof consumeRenderArtifactDigest;
      });
      const artifact = JSON.parse(await readFile(join(workDir, 'steps', 'render.json'), 'utf8')) as {
        __storydreamFileDigests: Array<{ path: string; size: number; sha256: string }>;
      };

      expect(completed.current).toBe('done');
      expect(digestReads).toBe(3);
      expect(artifact.__storydreamFileDigests).toEqual([{
        path: 'final.mp4',
        size: Buffer.byteLength('mp4-output'),
        sha256: createHash('sha256').update('mp4-output').digest('hex'),
      }]);
    });
  });

  it('rejects an old digest when the published file changes after the D3 identity lstat', async () => {
    await withRuntimeDir(async (workDir) => {
      const finalPath = join(workDir, 'final.mp4');
      let digestReads = 0;
      let successfulFinalLstats = 0;
      let d3Identity: BigIntStats | undefined;
      const runtime = await createRenderRuntimeWithMediaProbe(
        workDir,
        async () => validFinalMediaProbe(1.1),
        (options) => {
          options.publicationFileOperations = {
            openDigestFile: async (path, openFile) => {
              digestReads += 1;
              return openFile(path);
            },
            lstat: async (path) => {
              const value = await lstat(path, { bigint: true });
              if (path === finalPath) {
                successfulFinalLstats += 1;
                if (successfulFinalLstats === 2) {
                  d3Identity = value;
                  await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
                  await writeFile(path, Buffer.from('tampered!!'));
                }
              }
              return value;
            },
          };
        },
      );
      const consumeRenderArtifactDigest = (runtime as unknown as {
        consumeRenderArtifactDigest?: (
          output: HtmlVideoOutput,
          signal?: AbortSignal,
        ) => Promise<{ size: number; sha256: string }>;
      }).consumeRenderArtifactDigest;
      expect(consumeRenderArtifactDigest).toBeTypeOf('function');
      if (!consumeRenderArtifactDigest) return;
      const state = createHtmlVideoPipelineData('第一幕。', {
        ratio: '9:16',
        style: 'cinematic',
        foreground: false,
      });

      await expect(runHtmlVideoPipeline({
        taskId: 'd3-identity-bound-digest',
        sourceText: '第一幕。',
        state,
      }, {
        workDir,
        rewrite: async () => ({ rewrittenText: '第一幕。', segments: ['第一幕。'] }),
        plan: async () => ({ scenes: [singleRuntimeScene()] }),
        generateAssets: async () => {
          const path = join(workDir, 'd3-runner-background.png');
          await writeFile(path, Buffer.from('background'));
          return [{ sceneIndex: 1, kind: 'bg', slot: 0, src: path }];
        },
        synthesizeVoices: async () => {
          const path = join(workDir, 'd3-runner-voice.wav');
          await writeFile(path, Buffer.from('voice'));
          return [{ sceneIndex: 1, src: path, durationSec: 1, text: '第一幕。' }];
        },
        createPreviews: runtime.createPreviews,
        render: runtime.render,
        consumeRenderArtifactDigest,
        onCheckpoint: async () => undefined,
      } as Parameters<typeof runHtmlVideoPipeline>[1] & {
        consumeRenderArtifactDigest: typeof consumeRenderArtifactDigest;
      })).rejects.toMatchObject({ code: 'HTML_VIDEO_OUTPUT_CHANGED' });

      const current = await lstat(finalPath, { bigint: true });
      expect(d3Identity).toBeDefined();
      expect(current.ino).toBe(d3Identity!.ino);
      expect(current.size).toBe(d3Identity!.size);
      expect(
        current.mtimeNs !== d3Identity!.mtimeNs || current.ctimeNs !== d3Identity!.ctimeNs,
      ).toBe(true);
      expect(successfulFinalLstats).toBe(3);
      expect(digestReads).toBe(3);
      expect(existsSync(join(workDir, 'steps', 'render.json'))).toBe(false);
    });
  });

  it('rejects publication when the file changes after the D3 digest yields its old bytes', async () => {
    await withRuntimeDir(async (workDir) => {
      const finalPath = join(workDir, 'final.mp4');
      let digestReads = 0;
      let d3Identity: BigIntStats | undefined;
      let mutated = false;
      const runtime = await createRenderRuntimeWithMediaProbe(
        workDir,
        async () => validFinalMediaProbe(1.1),
        (options) => {
          options.publicationFileOperations = {
            openDigestFile: async (path, openFile) => {
              digestReads += 1;
              if (digestReads === 3) d3Identity = await lstat(path, { bigint: true });
              return openFile(path);
            },
            onDigestRead: async (path) => {
              if (digestReads === 3 && !mutated) {
                mutated = true;
                await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
                await writeFile(path, Buffer.from('tampered!!'));
              }
            },
          };
        },
      );

      await expect(runtime.render(createRenderRuntimeInput(workDir))).rejects.toMatchObject({
        code: 'HTML_VIDEO_PUBLISH_CONFLICT',
        retryable: true,
      });

      expect(digestReads).toBe(3);
      expect(d3Identity).toBeDefined();
      expect(d3Identity!.size).toBe(BigInt(Buffer.byteLength('tampered!!')));
      expect(existsSync(finalPath)).toBe(false);
    });
  });

  it('rejects an oversized staging output before hashing or probing it', async () => {
    await withRuntimeDir(async (workDir) => {
      const background = join(workDir, 'oversized-output-background.png');
      const foreground = join(workDir, 'oversized-output-foreground.png');
      const voice = join(workDir, 'oversized-output-voice.wav');
      let probeCalls = 0;
      await Promise.all([
        writeFile(background, Buffer.from('background')),
        writeFile(foreground, Buffer.from('foreground')),
        writeFile(voice, Buffer.from('voice')),
      ]);
      const runtime = createElectronHtmlVideoRuntime({
        taskDirectory: taskDirectoryFor(workDir),
        taskTitle: 'Oversized final output',
        fps: 2,
        maxLongEdge: 568,
        renderer: {
          async capturePreview() {
            throw new Error('capturePreview was not expected');
          },
          async render(input) {
            await writeFile(input.outputPath, Buffer.from('mp4-output'));
            return {
              outputPath: input.outputPath,
              sourceVideoPath: join(input.workDir, '_source.mp4'),
              duration: input.totalDurationS,
              taskDir: input.workDir,
              framesDirs: [],
            };
          },
        },
        probeMedia: async () => {
          probeCalls += 1;
          return validFinalMediaProbe(1.1);
        },
        getAvailableDiskBytes: async () => 4 * 1024 * 1024 * 1024,
        publicationFileOperations: {
          lstat: async (path) => {
            const value = await lstat(path, { bigint: true });
            if (path.includes('.html-video-staging') && basename(path) === 'final.mp4') {
              return new Proxy(value, {
                get(target, property, receiver) {
                  return property === 'size'
                    ? BigInt(1024 * 1024 * 1024 + 1)
                    : Reflect.get(target, property, receiver);
                },
              });
            }
            return value;
          },
        },
      });

      await expect(runtime.render({
        ...runtimeInput(background, foreground, voice),
        compositions: [],
      })).rejects.toMatchObject({
        code: 'HTML_VIDEO_OUTPUT_TOO_LARGE',
        retryable: true,
      });
      expect(probeCalls).toBe(0);
      expect(existsSync(join(workDir, 'final.mp4'))).toBe(false);
    });
  });

  it.each([
    ['far shorter', 0.01],
    ['far longer', 6.01],
  ] as const)('rejects a final output whose duration is %s than the five-second composition', async (_label, duration) => {
    await withRuntimeDir(async (workDir) => {
      await expect(renderWithMediaProbe(
        workDir,
        async () => validFinalMediaProbe(duration),
        undefined,
        undefined,
        undefined,
        (input) => {
          input.voices[0].durationSec = 5;
        },
      )).rejects.toMatchObject({
        code: 'HTML_VIDEO_OUTPUT_DURATION_MISMATCH',
        retryable: true,
      });
    });
  });

  it.each([4.25, 5.15] as const)(
    'accepts a two-scene fade output with a bounded encoding error at %s seconds',
    async (duration) => {
      await withRuntimeDir(async (workDir) => {
        const background2 = join(workDir, `duration-background-2-${duration}.png`);
        const foreground2 = join(workDir, `duration-foreground-2-${duration}.png`);
        const voice2 = join(workDir, `duration-voice-2-${duration}.wav`);
        await Promise.all([
          writeFile(background2, Buffer.from('background 2')),
          writeFile(foreground2, Buffer.from('foreground 2')),
          writeFile(voice2, Buffer.from('voice 2')),
        ]);

        const output = await renderWithMediaProbe(
          workDir,
          async () => validFinalMediaProbe(duration),
          undefined,
          undefined,
          (composition) => {
            expect(composition.totalDurationS).toBe(5);
            expect(composition.transition?.duration).toBe(0.3);
          },
          (input) => {
            input.voices[0].durationSec = 2.5;
            input.scenes.push({
              ...htmlScenes()[0],
              index: 2,
              narration: '第二幕。',
              title: '第二幕',
              captions: ['第二幕。'],
            });
            input.assets.push(
              { sceneIndex: 2, kind: 'bg', slot: 0, src: background2 },
              { sceneIndex: 2, kind: 'fg', slot: 0, src: foreground2 },
            );
            input.voices.push({ sceneIndex: 2, src: voice2, durationSec: 2.5, text: '第二幕。' });
          },
        );

        expect(output.durationSec).toBe(duration);
      });
    },
  );

  it.each([
    ['missing audio stream', { ...validFinalMediaProbe(), hasAudio: false }],
    ['missing audio metadata', { ...validFinalMediaProbe(), hasAudio: undefined }],
    ['missing video stream', { ...validFinalMediaProbe(), hasVideo: false }],
    ['missing video metadata', { ...validFinalMediaProbe(), hasVideo: undefined }],
    ['missing width metadata', { ...validFinalMediaProbe(), width: undefined }],
    ['wrong width', { ...validFinalMediaProbe(), width: 321 }],
    ['missing height metadata', { ...validFinalMediaProbe(), height: undefined }],
    ['wrong height', { ...validFinalMediaProbe(), height: 567 }],
    ['missing duration', { ...validFinalMediaProbe(), duration: undefined }],
    ['zero duration', { ...validFinalMediaProbe(), duration: 0 }],
    ['NaN duration', { ...validFinalMediaProbe(), duration: Number.NaN }],
    ['infinite duration', { ...validFinalMediaProbe(), duration: Number.POSITIVE_INFINITY }],
  ] satisfies Array<[string, HtmlVideoMediaProbeResult]>)('rejects final output with %s', async (_label, probe) => {
    await withRuntimeDir(async (workDir) => {
      await expect(renderWithMediaProbe(workDir, async () => probe)).rejects.toMatchObject({
        code: 'HTML_VIDEO_OUTPUT_INVALID',
        message: 'HTML 视频渲染结果未通过完整性校验。',
        retryable: true,
      });
    });
  });

  it('preserves media probe failures without replacing them', async () => {
    await withRuntimeDir(async (workDir) => {
      const probeError = new Error('bounded media sidecar timed out');
      let probeRoot = '';

      await expect(renderWithMediaProbe(workDir, async (root) => {
        probeRoot = root;
        throw probeError;
      })).rejects.toBe(probeError);
      expect(existsSync(probeRoot)).toBe(false);
    });
  });

  it('preserves cancellation detected while the final media probe is pending', async () => {
    await withRuntimeDir(async (workDir) => {
      const controller = new AbortController();
      const abortReason = new DOMException('Render cancelled.', 'AbortError');
      let markProbeStarted!: () => void;
      let receivedSignal: AbortSignal | undefined;
      let probeRoot = '';
      let removeAbortListener: () => void = () => undefined;
      const probeStarted = new Promise<void>((resolve) => {
        markProbeStarted = resolve;
      });

      const operation = renderWithMediaProbe(workDir, async (root, _path, signal) => {
        probeRoot = root;
        receivedSignal = signal;
        markProbeStarted();
        return new Promise<HtmlVideoMediaProbeResult>((_resolve, reject) => {
          if (!signal) {
            reject(new Error('Final media probe did not receive an abort signal.'));
            return;
          }
          const onAbort = () => {
            signal.removeEventListener('abort', onAbort);
            reject(signal.reason);
          };
          removeAbortListener = () => signal.removeEventListener('abort', onAbort);
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener('abort', onAbort, { once: true });
        });
      }, controller.signal);

      try {
        const firstResult = await Promise.race([
          probeStarted.then(() => 'probe-started' as const),
          operation.then(() => 'render-completed' as const, () => 'render-rejected' as const),
        ]);

        expect(firstResult).toBe('probe-started');
        expect(receivedSignal).toBe(controller.signal);
        controller.abort(abortReason);
        await expect(operation).rejects.toBe(abortReason);
        expect(existsSync(probeRoot)).toBe(false);
      } finally {
        if (!controller.signal.aborted) controller.abort(abortReason);
        removeAbortListener();
        await operation.catch(() => undefined);
      }
    });
  });

  it('rejects rendering before capture when free disk is below the frame budget', async () => {
    await withRuntimeDir(async (workDir) => {
      await expect(preflightHtmlVideoRender({
        workDir,
        canvas: { width: 320, height: 568 },
        fps: 30,
        durations: [5, 5],
      }, {
        getAvailableDiskBytes: async () => 1024,
      })).rejects.toMatchObject({ code: 'HTML_VIDEO_DISK_SPACE_LOW' });
    });
  });

  it('passes only the validated task-managed cover path into the existing render composition', async () => {
    await withRuntimeDir(async (workDir) => {
      const coverDirectory = join(workDir, 'covers');
      const coverPath = join(coverDirectory, 'cover-manual-r1.png');
      await mkdir(coverDirectory, { recursive: true });
      await writeFile(coverPath, Buffer.from('cover'));
      let renderedCoverPath = '';
      const runtime = await createRenderRuntimeWithMediaProbe(
        workDir,
        async () => validFinalMediaProbe(2.2),
        (options) => {
          const render = options.renderer.render;
          options.renderer.render = async (input) => {
            renderedCoverPath = input.coverPath ?? '';
            return render(input);
          };
        },
      );
      const input: HtmlVideoRenderInput = {
        ...createRenderRuntimeInput(workDir),
        coverAsset: {
          version: 1,
          revision: 1,
          mode: 'manual',
          path: 'covers/cover-manual-r1.png',
          sizeBytes: 5,
          width: 768,
          height: 1024,
          mimeType: 'image/png',
          sha256: 'f'.repeat(64),
          ratio: '3:4',
          createdAt: '2026-07-18T00:00:00.000Z',
        },
      };

      await runtime.render(input);
      expect(renderedCoverPath).toBe(coverPath);
    });
  });

  it('uses the selected visual preset without writing a Jianying draft', async () => {
    await withRuntimeDir(async (workDir) => {
      const runtime = await createRenderRuntimeWithMediaProbe(
        workDir,
        async () => validFinalMediaProbe(1.25),
      );

      const output = await runtime.render({
        ...createRenderRuntimeInput(workDir),
        config: { ratio: '9:16' },
        draftTemplate: draftTemplates[0],
      });

      expect(output.path).toBe(join(workDir, 'final.mp4'));
      expect(output).not.toHaveProperty('draft');
    });
  });

  it('returns only the MP4 output when no visual preset is selected', async () => {
    await withRuntimeDir(async (workDir) => {
      const runtime = await createRenderRuntimeWithMediaProbe(
        workDir,
        async () => validFinalMediaProbe(1.25),
      );

      const output = await runtime.render({
        ...createRenderRuntimeInput(workDir),
        config: { ratio: '9:16' },
      });

      expect(output).not.toHaveProperty('draft');
    });
  });

  it('ships a bounded real Electron render smoke with stream, canvas, and cleanup verification', async () => {
    const smokeUrl = new URL('../scripts/smoke-html-video.ts', import.meta.url);
    expect(existsSync(smokeUrl)).toBe(true);
    if (!existsSync(smokeUrl)) return;
    const [packageJson, smoke] = await Promise.all([
      readFile(new URL('../package.json', import.meta.url), 'utf8'),
      readFile(smokeUrl, 'utf8'),
    ]);

    expect(packageJson).toContain('"smoke:html-video"');
    for (const symbol of [
      'createElectronHtmlVideoRenderer',
      'createElectronHtmlVideoRuntime',
      'runBoundedProcess',
      "mode: 'probe_media'",
      'maxLongEdge: 568',
      'fps: 2',
      'outputBytes',
      'durationToleranceS',
      'previewCount',
      'hasVideo',
      'hasAudio',
      'videoWidth',
      'videoHeight',
      'framesCleaned',
      'probeMedia:',
      "app.setPath('userData'",
    ]) {
      expect(smoke).toContain(symbol);
    }
  });
});

function runtimeInput(background: string, foreground: string, voice: string): HtmlVideoPreviewInput {
  return {
    scenes: htmlScenes(),
    assets: [
      { sceneIndex: 1, kind: 'bg' as const, slot: 0, src: background },
      { sceneIndex: 1, kind: 'fg' as const, slot: 0, src: foreground },
    ],
    voices: [{ sceneIndex: 1, src: voice, durationSec: 1.25, text: '第一幕。' }],
    config: { ratio: '9:16', foreground: true, transitionType: 'fade' },
  };
}

function htmlScenes(): HtmlVideoScenePlan[] {
  return [{
    index: 1,
    narration: '第一幕。',
    title: '第一幕',
    captions: ['第一幕。'],
    sceneTemplate: 'cinematic-title',
    background: { prompt: '电影感背景' },
    elements: [{ slot: 0, prompt: '透明人物前景' }],
  }];
}

interface HardlinkSentinel {
  outsidePath: string;
  linkedPath: string;
  contents: string;
  device: bigint;
  inode: bigint;
}

async function createHardlinkSentinel(
  outsideDir: string,
  linkedPath: string,
  outsideName: string,
  contents: string,
): Promise<HardlinkSentinel> {
  const outsidePath = join(outsideDir, outsideName);
  await mkdir(dirname(linkedPath), { recursive: true });
  await writeFile(outsidePath, contents, 'utf8');
  await link(outsidePath, linkedPath);
  const value = await stat(outsidePath, { bigint: true });
  return {
    outsidePath,
    linkedPath,
    contents,
    device: value.dev,
    inode: value.ino,
  };
}

async function expectExternalHardlinkSentinelUnchanged(sentinel: HardlinkSentinel): Promise<void> {
  const value = await stat(sentinel.outsidePath, { bigint: true });
  expect(await readFile(sentinel.outsidePath, 'utf8')).toBe(sentinel.contents);
  expect(value.dev).toBe(sentinel.device);
  expect(value.ino).toBe(sentinel.inode);
}

function bgmItem(id: string, path: string): BgmItem {
  return { id, path, title: id, durationMs: 0, volume: 0.25 };
}

function errnoError(code: string, path: string): Error & { code: string; path: string } {
  return Object.assign(new Error(`${code}: copy failed`), { code, path });
}

async function expectBgmDirEmpty(workDir: string): Promise<void> {
  const bgmDir = join(workDir, 'inputs', 'bgm');
  if (!existsSync(bgmDir)) return;
  expect(await readdir(bgmDir)).toEqual([]);
}

function unusedRenderer(): ElectronHtmlVideoRuntimeOptions['renderer'] {
  return {
    async capturePreview() {
      throw new Error('capturePreview was not expected.');
    },
    async render() {
      throw new Error('render was not expected.');
    },
  };
}

function validFinalMediaProbe(duration = 1.2): HtmlVideoMediaProbeResult {
  return {
    duration,
    hasAudio: true,
    hasVideo: true,
    width: 320,
    height: 568,
  };
}

async function createRenderRuntimeWithMediaProbe(
  workDir: string,
  probeMedia: ElectronHtmlVideoRuntimeOptions['probeMedia'],
  configureOptions?: (options: ElectronHtmlVideoRuntimeOptions) => void,
) {
  await Promise.all([
    writeFile(join(workDir, 'render-background.png'), Buffer.from('background')),
    writeFile(join(workDir, 'render-foreground.png'), Buffer.from('foreground')),
    writeFile(join(workDir, 'render-voice.wav'), Buffer.from('voice')),
  ]);
  const options: ElectronHtmlVideoRuntimeOptions = {
    taskDirectory: taskDirectoryFor(workDir),
    taskTitle: 'Trusted render digest',
    fps: 2,
    maxLongEdge: 568,
    renderer: {
      async capturePreview(input) {
        await writeFile(input.outputPath, Buffer.from('thumbnail'));
        return input.outputPath;
      },
      async render(input) {
        await writeFile(input.outputPath, Buffer.from('mp4-output'));
        return {
          outputPath: input.outputPath,
          sourceVideoPath: join(workDir, '_source.mp4'),
          duration: input.totalDurationS,
          taskDir: workDir,
          framesDirs: [],
        };
      },
    },
    probeMedia,
    getAvailableDiskBytes: async () => 4 * 1024 * 1024 * 1024,
  };
  configureOptions?.(options);
  return createElectronHtmlVideoRuntime(options);
}

function createRenderRuntimeInput(workDir: string) {
  return {
    ...runtimeInput(
      join(workDir, 'render-background.png'),
      join(workDir, 'render-foreground.png'),
      join(workDir, 'render-voice.wav'),
    ),
    compositions: [],
  };
}

function singleRuntimeScene(): HtmlVideoScenePlan {
  return {
    ...htmlScenes()[0],
    elements: [],
  };
}

async function renderWithMediaProbe(
  workDir: string,
  probeMedia: ElectronHtmlVideoRuntimeOptions['probeMedia'],
  signal?: AbortSignal,
  bgmPath?: string,
  onRender?: (input: HtmlVideoExportInput) => void,
  configureInput?: (input: ReturnType<typeof runtimeInput>) => void,
  configureOptions?: (options: ElectronHtmlVideoRuntimeOptions) => void,
) {
  const background = join(workDir, 'render-background.png');
  const foreground = join(workDir, 'render-foreground.png');
  const voice = join(workDir, 'render-voice.wav');
  await Promise.all([
    writeFile(background, Buffer.from('background')),
    writeFile(foreground, Buffer.from('foreground')),
    writeFile(voice, Buffer.from('voice')),
  ]);
  const options: ElectronHtmlVideoRuntimeOptions = {
    taskDirectory: taskDirectoryFor(workDir),
    taskTitle: 'Final media validation',
    fps: 2,
    maxLongEdge: 568,
    renderer: {
      async capturePreview() {
        throw new Error('capturePreview was not expected.');
      },
      async render(input) {
        onRender?.(input);
        await writeFile(input.outputPath, Buffer.from('mp4-output'));
        return {
          outputPath: input.outputPath,
          sourceVideoPath: join(workDir, '_source.mp4'),
          duration: 99,
          taskDir: workDir,
          framesDirs: [],
        };
      },
    },
    bgmPath,
    probeMedia,
    getAvailableDiskBytes: async () => 4 * 1024 * 1024 * 1024,
  };
  configureOptions?.(options);
  const runtime = createElectronHtmlVideoRuntime(options);

  const input = runtimeInput(background, foreground, voice);
  configureInput?.(input);

  return runtime.render({
    ...input,
    compositions: [],
    signal,
  });
}

const testTaskDirectories = new Map<string, HtmlVideoTaskDirectoryIdentity>();

function taskDirectoryFor(workDir: string): HtmlVideoTaskDirectoryIdentity {
  const taskDirectory = testTaskDirectories.get(workDir);
  if (!taskDirectory) throw new Error(`Missing pinned test task directory for ${workDir}`);
  return taskDirectory;
}

async function withRuntimeDir(run: (workDir: string) => Promise<void>): Promise<void> {
  const trustedRoot = await mkdtemp(join(tmpdir(), 'storydream-html-electron-root-'));
  const taskDirectory = await ensureHtmlVideoTaskWorkDir(trustedRoot, 'storydream-test', managedTestStorageKey);
  const workDir = taskDirectory.workDir.canonicalPath;
  testTaskDirectories.set(workDir, taskDirectory);
  try {
    await run(workDir);
  } finally {
    testTaskDirectories.delete(workDir);
    await rm(trustedRoot, { recursive: true, force: true });
  }
}
