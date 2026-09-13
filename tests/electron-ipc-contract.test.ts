import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { createTestTempDirectory as mkdtemp, createTestDirectoryLink as symlink, removeTestTempDirectories } from './helpers/test-temp-directories';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openExistingDirectory } from '../electron/open-directory';
import { INVOKE_CHANNELS } from '../src/shared/storydream-api';
import { ipcInputSchemas } from '../src/shared/ipc-contract';

describe('owned test directory cleanup', () => {
  it('refuses unregistered directories before scheduling recursive cleanup', () => {
    expect(() => removeTestTempDirectories(tmpdir())).toThrow('unregistered test directory');
  });

  it.each(['holder', 'target'] as const)('detaches junctions before disposing their %s', async (first) => {
    const root = await mkdtemp(join(tmpdir(), 'storydream-cleanup-holder-'));
    const outside = await mkdtemp(join(tmpdir(), 'storydream-cleanup-target-'));
    const remaining = new Set([root, outside]);
    try {
      await writeFile(join(root, 'holder.txt'), 'holder sentinel', 'utf8');
      await writeFile(join(outside, 'target.txt'), 'target sentinel', 'utf8');
      await symlink(outside, join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
      const removed = first === 'holder' ? root : outside;
      await removeTestTempDirectories(removed);
      remaining.delete(removed);
      if (first === 'holder') {
        expect(await readFile(join(outside, 'target.txt'), 'utf8')).toBe('target sentinel');
      } else {
        expect(await readdir(root)).toEqual(['holder.txt']);
        expect(await readFile(join(root, 'holder.txt'), 'utf8')).toBe('holder sentinel');
      }
    } finally {
      await removeTestTempDirectories(...remaining);
    }
  });
});

describe('electron ipc contract', () => {
  it('accepts the selected episode on director render while rejecting malformed or extra fields', () => {
    expect(ipcInputSchemas['director:render'].parse({ id: 'project', episodeId: 'episode-two' })).toEqual({ id: 'project', episodeId: 'episode-two' });
    expect(ipcInputSchemas['director:render'].parse({ id: 'project' })).toEqual({ id: 'project' });
    expect(() => ipcInputSchemas['director:render'].parse({ id: 'project', episodeId: '' })).toThrow();
    expect(() => ipcInputSchemas['director:render'].parse({ id: 'project', episodeId: 'episode-two', bypassQuality: true })).toThrow();
  });
  it('keeps hot board fetching and external navigation in the trusted main process', async () => {
    const [main, preload, apiContract] = await Promise.all([
      readFile(new URL('../electron/main.ts', import.meta.url), 'utf8'),
      readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8'),
    ]);
    expect(main).toContain("trustedHandle('hotboard:fetch', async (_event, input) => loadHotBoardArchive(");
    expect(main).toContain("trustedHandle('aihot:query', async (_event, input) => loadAiHotArchive(");
    expect(main).toContain('await getDb()');
    expect(main).toContain("trustedHandle('hotboard:open-url'");
    expect(main).toContain("assertNetworkUrl(url, 'public-research')");
    expect(main).toContain('shell.openExternal(target.href)');
    expect(preload).toContain("fetchHotBoard: (input: HotBoardArchiveRequest = {}): Promise<HotBoardArchiveResult> => invokeTrusted('hotboard:fetch', input)");
    expect(preload).toContain("queryAiHot: (input: AiHotArchiveRequest): Promise<AiHotArchiveResult> => invokeTrusted('aihot:query', input)");
    expect(preload).toContain("openHotBoardUrl: (url: string): Promise<void> => invokeTrusted('hotboard:open-url', url)");
    expect(apiContract).toContain('fetchHotBoard: (input?: HotBoardArchiveRequest) => Promise<HotBoardArchiveResult>');
    expect(apiContract).toContain('queryAiHot: (input: AiHotArchiveRequest) => Promise<AiHotArchiveResult>');
    expect(apiContract).toContain('openHotBoardUrl: (url: string) => Promise<void>');
  });

  it('passes the strict book selection save request through preload and the trusted handler', async () => {
    const [main, preload, apiContract] = await Promise.all([
      readFile(new URL('../electron/main.ts', import.meta.url), 'utf8'),
      readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8'),
    ]);
    expect(main).toContain("trustedHandle('book-selection:save', async (_event, input: BookSelectionInput) => (await getDb()).upsertBookSelection(input))");
    expect(preload).toContain("saveBookSelection: (input: BookSelectionInput): Promise<BookSelectionRecord> => invokeTrusted('book-selection:save', input)");
    expect(apiContract).toContain('saveBookSelection: (input: BookSelectionInput) => Promise<BookSelectionRecord>');
    expect(main).toContain("trustedHandle('book-selection:discover', async (_event, input: BookDiscoveryRequest) => discoverDangdangBooks(input))");
    expect(preload).toContain("discoverBooks: (input: BookDiscoveryRequest): Promise<BookDiscoveryResult> => invokeTrusted('book-selection:discover', input)");
    expect(apiContract).toContain('discoverBooks: (input: BookDiscoveryRequest) => Promise<BookDiscoveryResult>');
  });

  it('keeps ordinary manual-cover selection and paths in the main process', async () => {
    const [main, preload, apiContract] = await Promise.all([
      readFile(new URL('../electron/main.ts', import.meta.url), 'utf8'),
      readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8'),
    ]);
    const start = main.indexOf("trustedHandle('task:import-cover'");
    const end = main.indexOf("trustedHandle('task:create-and-run'", start);
    const handler = main.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(handler).toContain('dialog.showOpenDialog');
    expect(handler).toContain('inspectOrdinaryTaskCoverImage');
    expect(handler).toContain('stageOrdinaryTaskCover');
    expect(preload).toContain("invokeTrusted('task:import-cover', ratio)");
    expect(apiContract).toContain('importOrdinaryTaskCover: (ratio: OrdinaryTaskCoverRatio)');
    expect(handler).not.toContain('input.sourcePath');
  });

  it('opens only existing directories and surfaces shell opener errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storydream-open-directory-'));
    const filePath = join(root, 'not-a-directory.txt');
    const targetPath = join(root, 'target');
    const aliasPath = join(root, 'alias');
    const opened: string[] = [];
    try {
      await Promise.all([
        writeFile(filePath, 'file', 'utf8'),
        mkdir(targetPath),
      ]);
      await symlink(
        await realpath(targetPath),
        aliasPath,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      await expect(openExistingDirectory(root, async (path) => {
        opened.push(path);
        return '';
      })).resolves.toBeUndefined();
      await expect(openExistingDirectory(aliasPath, async (path) => {
        opened.push(path);
        return '';
      })).resolves.toBeUndefined();
      expect(opened).toEqual([await realpath(root), await realpath(aliasPath)]);
      await expect(openExistingDirectory(filePath, async () => '')).rejects.toThrow(/目录/u);
      await expect(openExistingDirectory(join(root, 'missing'), async () => '')).rejects.toThrow(/不存在/u);
      await expect(openExistingDirectory(root, async () => 'Access denied')).rejects.toThrow(/Access denied/u);
      let longError: Error | null = null;
      try {
        await openExistingDirectory(root, async () => 'x'.repeat(10_000));
      } catch (error) {
        longError = error as Error;
      }
      expect(longError).not.toBeNull();
      expect(longError!.message.length).toBeLessThanOrEqual(1_100);
    } finally {
      await removeTestTempDirectories(root);
    }
  });

  it('rejects a directory that escapes its allowed root through a junction', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storydream-person-root-'));
    const outside = await mkdtemp(join(tmpdir(), 'storydream-person-outside-'));
    const aliasPath = join(root, 'escaped-person');
    let opened = false;
    try {
      await symlink(
        await realpath(outside),
        aliasPath,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      await expect(openExistingDirectory(aliasPath, async () => {
        opened = true;
        return '';
      }, { allowedRoot: root })).rejects.toMatchObject({ code: 'DIRECTORY_OUTSIDE_ROOT' });
      expect(opened).toBe(false);
    } finally {
      await Promise.all([
        removeTestTempDirectories(root),
        removeTestTempDirectories(outside),
      ]);
    }
  });

  it('revalidates a rooted directory after its initial identity is replaced', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storydream-person-race-root-'));
    const outside = await mkdtemp(join(tmpdir(), 'storydream-person-race-outside-'));
    const personPath = join(root, 'person');
    const detachedPath = join(root, 'detached-person');
    await mkdir(personPath);
    const canonicalPersonPath = await realpath(personPath);
    let swaps = 0;
    let opened = false;
    try {
      await expect(openExistingDirectory(personPath, async () => {
        opened = true;
        return '';
      }, {
        allowedRoot: root,
        fileOperations: {
          stat: async (path) => {
            const value = await stat(path, { bigint: true });
            if (path === canonicalPersonPath && swaps === 0) {
              await rename(path, detachedPath);
              await symlink(
                await realpath(outside),
                path,
                process.platform === 'win32' ? 'junction' : 'dir',
              );
              swaps += 1;
            }
            return value;
          },
        },
      })).rejects.toMatchObject({ code: 'DIRECTORY_CHANGED' });
      expect(swaps).toBe(1);
      expect(opened).toBe(false);
    } finally {
      await Promise.all([
        removeTestTempDirectories(root),
        removeTestTempDirectories(outside),
      ]);
    }
  });

  it('revalidates the rooted target after the final root check before opening it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storydream-person-root-check-race-'));
    const outside = await mkdtemp(join(tmpdir(), 'storydream-person-root-check-outside-'));
    const personPath = join(root, 'person');
    const detachedPath = join(root, 'detached-person');
    await mkdir(personPath);
    const canonicalRoot = await realpath(root);
    let rootStats = 0;
    let swaps = 0;
    let opened = false;
    try {
      const result = await openExistingDirectory(personPath, async () => {
        opened = true;
        return '';
      }, {
        allowedRoot: root,
        fileOperations: {
          stat: async (path) => {
            const value = await stat(path, { bigint: true });
            if (path === canonicalRoot) {
              rootStats += 1;
              if (rootStats === 2) {
                await rename(personPath, detachedPath);
                await symlink(
                  await realpath(outside),
                  personPath,
                  process.platform === 'win32' ? 'junction' : 'dir',
                );
                swaps += 1;
              }
            }
            return value;
          },
        },
      }).then(
        () => ({ status: 'opened' as const }),
        (error: unknown) => ({ status: 'rejected' as const, error }),
      );

      expect(result).toMatchObject({ status: 'rejected' });
      if (result.status === 'rejected') {
        expect(['DIRECTORY_CHANGED', 'DIRECTORY_OUTSIDE_ROOT']).toContain(
          (result.error as { code?: unknown }).code,
        );
      }
      expect(rootStats).toBe(2);
      expect(swaps).toBe(1);
      expect(opened).toBe(false);
    } finally {
      await Promise.all([
        removeTestTempDirectories(root),
        removeTestTempDirectories(outside),
      ]);
    }
  });

  it('allows a legitimate child directory whose name starts with two dots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storydream-person-dot-root-'));
    const hiddenPerson = join(root, '..hidden');
    const opened: string[] = [];
    try {
      await mkdir(hiddenPerson);
      await expect(openExistingDirectory(hiddenPerson, async (path) => {
        opened.push(path);
        return '';
      }, { allowedRoot: root })).resolves.toBeUndefined();
      expect(opened).toEqual([await realpath(hiddenPerson)]);
    } finally {
      await removeTestTempDirectories(root);
    }
  });

  it('revalidates an unrestricted task directory before opening it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storydream-task-output-race-'));
    const outside = await mkdtemp(join(tmpdir(), 'storydream-task-output-outside-'));
    const outputPath = join(root, 'output');
    const detachedPath = join(root, 'detached-output');
    await mkdir(outputPath);
    const canonicalOutputPath = await realpath(outputPath);
    let swaps = 0;
    let opened = false;
    try {
      await expect(openExistingDirectory(outputPath, async () => {
        opened = true;
        return '';
      }, {
        fileOperations: {
          stat: async (path) => {
            const value = await stat(path, { bigint: true });
            if (path === canonicalOutputPath && swaps === 0) {
              await rename(path, detachedPath);
              await symlink(
                await realpath(outside),
                path,
                process.platform === 'win32' ? 'junction' : 'dir',
              );
              swaps += 1;
            }
            return value;
          },
        },
      })).rejects.toMatchObject({ code: 'DIRECTORY_CHANGED' });
      expect(swaps).toBe(1);
      expect(opened).toBe(false);
    } finally {
      await Promise.all([
        removeTestTempDirectories(root),
        removeTestTempDirectories(outside),
      ]);
    }
  });

  it('keeps renderer directory opening scoped to persisted tasks, image jobs, and existing person assets', async () => {
    const [main, preload, apiContract, renderer, artifact, imageLab, personAssets] = await Promise.all([
      readFile(new URL('../electron/main.ts', import.meta.url), 'utf8'),
      readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/main.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/tasks/TaskArtifactPreview.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/labs/ImageLabPage.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/labs/PersonAssetsPage.tsx', import.meta.url), 'utf8'),
    ]);

    expect(main).toContain("trustedHandle('task:open-output-directory'");
    expect(main).toContain("trustedHandle('image-lab:open-output-directory'");
    expect(main).toContain("trustedHandle('person-assets:open-directory'");
    expect(main).toContain('await database.getTaskDetail(id)');
    expect(main).toContain('isHtmlVideoTask(task)');
    expect(main).toContain('htmlVideoTaskDirectory(task.id)');
    expect(main).toContain("return resolveExistingHtmlVideoTaskWorkDir(app.getPath('userData'), appDataName, task.managedStorageKey ?? '');");
    expect(main).toContain("find((asset) => asset.name === name)");
    expect(main).toContain('openExistingDirectory');
    const taskDirectoryHandler = handlerSource(main, 'task:open-output-directory');
    const imageLabDirectoryHandler = handlerSource(main, 'image-lab:open-output-directory');
    const personDirectoryHandler = handlerSource(main, 'person-assets:open-directory');
    expect(personDirectoryHandler).toContain('const root = personAssetsRoot();');
    expect(personDirectoryHandler).toContain('{ allowedRoot: root }');
    expect(taskDirectoryHandler).not.toContain('allowedRoot');
    expect(taskDirectoryHandler).toContain(': task.outputDir.trim()');
    expect(imageLabDirectoryHandler).toContain('database.getImageLabRecordDetail(id)');
    expect(imageLabDirectoryHandler).toContain('imageLabWorkDir(record)');
    expect(main).not.toContain("trustedHandle('path:open'");
    expect(preload).not.toContain('openPath');
    expect(apiContract).not.toContain('openPath');
    expect(renderer).not.toContain('api.openPath');
    expect(artifact).toContain('api.openTaskOutputDirectory(task.id)');
    expect(imageLab).toContain('api.openImageLabOutputDirectory(record.id)');
    expect(personAssets).toContain('api.openPersonAssetDirectory(selectedAsset.name)');
  });

  it('publishes history governance only after successful persistence and returns the published revision', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const payload = main.slice(main.indexOf('type AppDeltaPayload'), main.indexOf('function publishAppDelta'));

    for (const kind of [
      'task-tombstone',
      'viral-tombstone',
      'image-lab-tombstone',
      'voice-lab-tombstone',
    ]) {
      expect(payload).toContain(`kind: '${kind}'`);
    }

    for (const [channel, method, publishKind] of [
      ['task:archive', 'archiveTask', 'task-upsert'],
      ['task:restore', 'restoreTask', 'task-upsert'],
      ['viral:archive', 'archiveViralAnalysis', 'viral-upsert'],
      ['viral:restore', 'restoreViralAnalysis', 'viral-upsert'],
      ['image-lab:archive', 'archiveImageLabRecord', 'image-lab-upsert'],
      ['image-lab:restore', 'restoreImageLabRecord', 'image-lab-upsert'],
      ['voice-lab:archive', 'archiveVoiceLabRecord', 'voice-lab-upsert'],
      ['voice-lab:restore', 'restoreVoiceLabRecord', 'voice-lab-upsert'],
    ] as const) {
      const handler = handlerSource(main, channel);
      const persisted = handler.indexOf(`await database.${method}(id)`);
      const published = handler.indexOf(`kind: '${publishKind}'`);
      expect(persisted, `${channel} awaits persistence`).toBeGreaterThan(-1);
      expect(published, `${channel} publishes its upsert`).toBeGreaterThan(persisted);
      expect(handler).toContain('return await');
    }

    for (const [channel, family, publishKind] of [
      ['task:delete', 'task', 'task-tombstone'],
      ['viral:delete', 'viral-analysis', 'viral-tombstone'],
      ['image-lab:delete', 'image-lab', 'image-lab-tombstone'],
      ['voice-lab:delete', 'voice-lab', 'voice-lab-tombstone'],
    ] as const) {
      const handler = handlerSource(main, channel);
      const deleted = handler.indexOf(`await deleteHistoryPermanently(database, '${family}', id)`);
      const published = handler.indexOf(`kind: '${publishKind}'`);
      expect(deleted, `${channel} awaits database/quarantine deletion`).toBeGreaterThan(-1);
      expect(published, `${channel} publishes its tombstone`).toBeGreaterThan(deleted);
      expect(handler).toContain('return await');
    }
  });

  it('keeps runner integration timeouts at the committed heavy-test baseline', async () => {
    const runnerTests = await readFile(new URL('./runner.test.ts', import.meta.url), 'utf8');

    expect((runnerTests.match(/rewriteControlTestTimeoutMs/gu) ?? []).length).toBe(19);
  });

  it('routes every privileged invoke through one trusted registration and result boundary', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const gateway = await readFile(new URL('../electron/ipc.ts', import.meta.url), 'utf8').catch(() => '');
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(main).toContain('createTrustedIpcRegistrar');
    expect(main).toContain("trustedHandle('app:get-bootstrap'");
    expect((main.match(/ipcMain\.handle\(/g) ?? []).length).toBe(1);
    expect(preload).toContain('invokeTrusted');
    expect(preload).toContain('unwrapIpcResult');
    expect((preload.match(/ipcRenderer\.invoke\(/g) ?? []).length).toBe(1);
    expect(gateway).toContain('IPC_SENDER_REJECTED');
    expect(gateway).toContain('IPC_INVALID_INPUT');
    expect(manifest.dependencies?.zod).toBeTruthy();
    expect(manifest.devDependencies?.zod).toBeUndefined();
  });

  it('defines a renderer sender policy for the trusted IPC gateway', async () => {
    const security = await readFile(new URL('../electron/security.ts', import.meta.url), 'utf8').catch(() => '');

    expect(security).toContain('export function isTrustedRendererSender');
    expect(security).toContain('event.sender !== win.webContents');
    expect(security).toContain('event.senderFrame !== win.webContents.mainFrame');
    expect(security).toContain('isAllowedRendererNavigation');
  });

  it('declares both renderer bridges through the shared API contract', async () => {
    const viteEnv = await readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8');

    expect(viteEnv).toContain("import type { StoryDreamApi } from './shared/storydream-api';");
    expect(viteEnv).toContain('storydream?: StoryDreamApi;');
    expect(viteEnv).toContain('storybound?: StoryDreamApi;');
    expect(viteEnv).not.toContain('getState:');
  });

  it('declares typed history pages and all four-family governance methods at the renderer boundary', async () => {
    const types = await readFile(new URL('../src/shared/types.ts', import.meta.url), 'utf8');
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');

    for (const typeName of [
      'HistoryFamily',
      'HistoryArchiveFilter',
      'TaskHistoryStatusFilter',
      'HistoryListRequest',
      'HistoryPage',
      'TaskTombstoneResult',
      'ViralAnalysisTombstoneResult',
      'ImageLabTombstoneResult',
      'VoiceLabTombstoneResult',
    ]) {
      expect(types).toContain(`export type ${typeName}`);
    }

    for (const method of [
      'archiveTask',
      'restoreTask',
      'deleteTaskPermanently',
      'archiveViralAnalysis',
      'restoreViralAnalysis',
      'deleteViralAnalysisPermanently',
      'archiveImageLabRecord',
      'restoreImageLabRecord',
      'deleteImageLabRecordPermanently',
      'archiveVoiceLabRecord',
      'restoreVoiceLabRecord',
      'deleteVoiceLabRecordPermanently',
    ]) {
      expect(apiContract).toContain(`${method}:`);
      expect(preload).toContain(`${method}:`);
    }
  });

  it('serializes every history governance handler through a synchronous governing reservation', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const helperStart = main.indexOf('async function runHistoryGovernanceMutation');
    const helperEnd = main.indexOf('\n}', helperStart) + 2;
    const helper = main.slice(helperStart, helperEnd);

    expect(helperStart).toBeGreaterThan(-1);
    expect(helper.indexOf('reserveGovernance(family, id)')).toBeGreaterThan(-1);
    expect(helper.indexOf('reserveGovernance(family, id)')).toBeLessThan(helper.indexOf('await getDb()'));
    expect(helper).toContain("family === 'task' && runningTasks.has(id)");
    expect(helper).toContain("family === 'viral-analysis' && runningViralAnalyses.has(id)");
    expect(helper).toContain('finally');
    expect(helper).toContain('reservation.release()');

    for (const [channel, family, method] of [
      ['task:archive', 'task', 'archiveTask'],
      ['task:restore', 'task', 'restoreTask'],
      ['task:delete', 'task', 'deleteTaskPermanently'],
      ['viral:archive', 'viral-analysis', 'archiveViralAnalysis'],
      ['viral:restore', 'viral-analysis', 'restoreViralAnalysis'],
      ['viral:delete', 'viral-analysis', 'deleteViralAnalysisPermanently'],
      ['image-lab:archive', 'image-lab', 'archiveImageLabRecord'],
      ['image-lab:restore', 'image-lab', 'restoreImageLabRecord'],
      ['image-lab:delete', 'image-lab', 'deleteImageLabRecordPermanently'],
      ['voice-lab:archive', 'voice-lab', 'archiveVoiceLabRecord'],
      ['voice-lab:restore', 'voice-lab', 'restoreVoiceLabRecord'],
      ['voice-lab:delete', 'voice-lab', 'deleteVoiceLabRecordPermanently'],
    ] as const) {
      const handler = handlerSource(main, channel);
      expect(handler).toContain(`runHistoryGovernanceMutation('${family}', id`);
      if (channel.endsWith(':delete')) {
        expect(handler).toContain(`deleteHistoryPermanently(database, '${family}', id)`);
      } else {
        expect(handler).toContain(`database.${method}(id)`);
      }
    }
  });

  it('acquires active history through latest-control coordination or before direct provider work', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const lifecycle = await readFile(new URL('../electron/task-run-lifecycle.ts', import.meta.url), 'utf8');

    for (const [channel, family, idExpression] of [
      ['task:update-status', 'task', 'input.id'],
      ['task:retry', 'task', 'id'],
      ['task:regenerate-image', 'task', 'input.id'],
      ['task:regenerate-narration', 'task', 'input.id'],
      ['task:update-image-prompt', 'task', 'input.id'],
      ['task:rerun-step', 'task', 'input.id'],
      ['viral:update-status', 'viral-analysis', 'input.id'],
      ['viral:retry', 'viral-analysis', 'id'],
    ] as const) {
      const handler = handlerSource(main, channel);
      const coordinator = handler.indexOf('return runLatestTaskControlRequest(');
      const reservation = handler.indexOf(`reserveActive('${family}', ${idExpression})`);
      expect(coordinator, `${channel} enters latest-control coordination`).toBeGreaterThan(-1);
      expect(reservation, `${channel} supplies active acquisition`).toBeGreaterThan(coordinator);
    }
    expect(lifecycle.indexOf('acquireHistoryActivityReservation(activityReservationSource)'))
      .toBeLessThan(lifecycle.indexOf('return await operation(isCurrent, transferReservation)'));

    for (const [channel, family, idExpression, firstAsyncWork] of [
      ['image-lab:generate', 'image-lab', 'id', 'await getDb()'],
      ['voice-lab:generate', 'voice-lab', 'id', 'await getDb()'],
    ] as const) {
      const handler = handlerSource(main, channel);
      const reservation = handler.indexOf(`reserveActive('${family}', ${idExpression})`);
      expect(reservation, `${channel} reserves its active ID`).toBeGreaterThan(-1);
      expect(reservation, `${channel} reserves before work`).toBeLessThan(handler.indexOf(firstAsyncWork));
      expect(handler).toContain('finally');
    }

    for (const [channel, family, createCall, workCall] of [
      ['task:create-and-run', 'task', 'await database.createTask', 'taskWorkDir(task)'],
      ['html-video:create-task', 'task', 'await database.createTask', 'taskWorkDir(task)'],
      ['viral:create-and-run', 'viral-analysis', 'await database.createViralAnalysis', 'viralAnalysisWorkDir(record)'],
      ['viral:create-production-task', 'task', 'await database.createTask', 'taskWorkDir(task)'],
    ] as const) {
      const handler = handlerSource(main, channel);
      const created = handler.indexOf(createCall);
      const reserved = handler.indexOf(`reserveActive('${family}'`);
      expect(created).toBeGreaterThan(-1);
      expect(reserved).toBeGreaterThan(created);
      expect(reserved).toBeLessThan(handler.indexOf(workCall));
      expect(handler).toContain('finally');
      expect(handler).toContain('activityReservation.release()');
    }
  });

  it('keeps active reservations through terminal persistence and releases all four families in finally', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const taskOwner = main.slice(main.indexOf('function startOwnedTaskRun'), main.indexOf('async function applyTaskRunIntent'));
    const viralOwner = main.slice(main.indexOf('function startViralAnalysisRun'), main.indexOf('async function resumeViralAnalysisRun'));

    expect(taskOwner.indexOf('await execute(controller)')).toBeLessThan(taskOwner.lastIndexOf('activityReservation.release()'));
    expect(taskOwner).toContain('const restartedTask = await database.beginTaskRun(restartTask.id)');
    expect(taskOwner).toContain('startTaskRun(database, restartedTask, workDir, restartReservation)');
    expect(viralOwner.indexOf("status: 'completed'")).toBeLessThan(viralOwner.lastIndexOf('activityReservation.release()'));
    expect(viralOwner.indexOf("status: cancelled ? 'cancelled' : 'failed'")).toBeLessThan(viralOwner.lastIndexOf('activityReservation.release()'));

    for (const [channel, terminalUpdate] of [
      ['image-lab:generate', 'database.updateImageLabRecord'],
      ['voice-lab:generate', 'database.updateVoiceLabRecord'],
    ] as const) {
      const handler = handlerSource(main, channel);
      expect(handler).toContain('finally');
      expect(handler.lastIndexOf(terminalUpdate)).toBeLessThan(handler.lastIndexOf('activityReservation.release()'));
    }
  });

  it('reuses or transfers existing runtime reservations without duplicate active acquisition', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const taskStatus = handlerSource(main, 'task:update-status');
    const taskRetry = handlerSource(main, 'task:retry');
    const viralStatus = handlerSource(main, 'viral:update-status');
    const viralRetry = handlerSource(main, 'viral:retry');

    expect(taskStatus).toContain('existingControlRun?.activityReservation');
    expect(taskRetry).toContain('existingRunAtEntry?.activityReservation');
    expect(viralStatus).toContain('takeHistoryActivityReservation(existingRunAtEntry)');
    expect(viralRetry).toContain('takeHistoryActivityReservation(existingRunAtEntry)');
    for (const channel of [
      'task:regenerate-image',
      'task:regenerate-narration',
      'task:update-image-prompt',
      'task:rerun-step',
    ]) {
      expect(handlerSource(main, channel)).toContain('takeHistoryActivityReservation(existingActiveRun)');
    }
  });

  it('returns exact four-family history pages through the shared API and preload bridge', async () => {
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const contracts = [
      ['listTasks', 'archiveTask', "HistoryPage<'task', TaskSummary>"],
      ['listViralAnalyses', 'archiveViralAnalysis', "HistoryPage<'viral-analysis', ViralAnalysisSummary>"],
      ['listImageLabRecords', 'archiveImageLabRecord', "HistoryPage<'image-lab', ImageLabSummary>"],
      ['listVoiceLabRecords', 'archiveVoiceLabRecord', "HistoryPage<'voice-lab', VoiceLabSummary>"],
    ] as const;

    for (const [method, nextMethod, returnType] of contracts) {
      for (const [owner, source] of [['StoryDreamApi', apiContract], ['preload', preload]] as const) {
        const start = source.indexOf(`${method}:`);
        const end = source.indexOf(`${nextMethod}:`, start);
        expect(start, `${owner}.${method} is declared`).toBeGreaterThan(-1);
        expect(end, `${owner}.${method} has a bounded declaration`).toBeGreaterThan(start);
        expect(source.slice(start, end), `${owner}.${method} preserves history metadata`).toContain(`Promise<${returnType}>`);
      }
    }
  });

  it('requires complete history pages from the bootstrap database boundary', async () => {
    const configService = await readFile(new URL('../electron/config-service.ts', import.meta.url), 'utf8');
    const contracts = [
      ['listTaskSummaries', 'listViralAnalyses', "HistoryPage<'task', TaskSummary>"],
      ['listViralAnalyses', 'listImageLabRecords', "HistoryPage<'viral-analysis', ViralAnalysisSummary>"],
      ['listImageLabRecords', 'listVoiceLabRecords', "HistoryPage<'image-lab', ImageLabSummary>"],
      ['listVoiceLabRecords', 'listPromptTemplateSummaries', "HistoryPage<'voice-lab', VoiceLabSummary>"],
    ] as const;

    for (const [method, nextMethod, returnType] of contracts) {
      const start = configService.indexOf(`${method}:`);
      const end = configService.indexOf(`${nextMethod}:`, start);
      expect(start, `ConfigDatabase.${method} is declared`).toBeGreaterThan(-1);
      expect(end, `ConfigDatabase.${method} has a bounded declaration`).toBeGreaterThan(start);
      expect(configService.slice(start, end), `ConfigDatabase.${method} preserves history metadata`).toContain(
        `Promise<${returnType}>`,
      );
    }
  });

  it('exposes product shell persistence channels to the renderer', async () => {
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');

    for (const channel of [
      'app:get-bootstrap',
      'app:reconcile-deltas',
      'task:list',
      'task:get-detail',
      'task:list-events',
      'viral:list',
      'viral:list-events',
      'image-lab:list',
      'voice-lab:list',
      'viral:get-detail',
      'image-lab:get-detail',
      'voice-lab:get-detail',
      'prompt-template:list',
      'prompt-template:get-detail',
      'draft-template:list',
      'draft-template:get-detail',
      'prompt-template:save',
      'prompt-template:reset',
      'custom-style:save',
      'custom-style:generate-draft',
      'draft-template:save',
      'image-lab:generate',
      'image-lab:add-record',
      'voice-lab:generate',
      'account:save',
      'activation:save',
      'ui:save-preferences',
      'task:update-status',
      'task:retry',
      'task:regenerate-image',
      'task:regenerate-narration',
      'task:get-artifacts',
      'asset:read-data-url',
      'config:test',
      'llm:test-config',
      'models:list',
      'volcengine:speakers:list',
      'research:web-search',
      'research:compose-copy',
      'diagnostics:run',
      'local-image:select',
      'local-audio:select',
      'local-folder:select',
      'cookie-file:select',
      'viral:open-login-window',
      'jianying:draft-path:detect',
      'jianying:effect-catalog',
      'viral:create-and-run',
      'viral:update-status',
      'viral:retry',
      'viral:get-result',
      'viral:create-production-task',
    ]) {
      expect(preload).toContain(channel);
      expect(main).toContain(channel);
    }
    const preloadInvokeChannels = [...preload.matchAll(/invokeTrusted(?:<[^>]+>)?\('([^']+)'/gu)].map((match) => match[1]);
    expect(preloadInvokeChannels).toEqual(INVOKE_CHANNELS);
  });

  it('keeps bootstrap list SQL off heavy record and template body columns', async () => {
    const storage = await readFile(new URL('../src/shared/storage.ts', import.meta.url), 'utf8');
    const viralList = storage.slice(storage.indexOf('async listViralAnalyses'), storage.indexOf('async getViralAnalysisDetail'));
    const imageList = storage.slice(storage.indexOf('async listImageLabRecords'), storage.indexOf('async getImageLabRecordDetail'));
    const voiceList = storage.slice(storage.indexOf('async listVoiceLabRecords'), storage.indexOf('async getVoiceLabRecordDetail'));
    const listHelper = storage.slice(storage.indexOf('private async listCreatedRecords'), storage.indexOf('async addTaskEvent'));
    const draftList = storage.slice(storage.indexOf('async listDraftTemplateSummaries'), storage.indexOf('async getDraftTemplateDetail'));

    expect(viralList).not.toContain('SELECT *');
    expect(viralList).not.toContain('settings_json');
    expect(imageList).not.toContain('SELECT *');
    expect(storage).toMatch(/const imageLabSummaryColumns[\s\S]*?substr\(prompt/u);
    expect(imageList).not.toContain('reference_image_paths_json');
    expect(voiceList).not.toContain('SELECT *');
    expect(storage).toMatch(/const voiceLabSummaryColumns[\s\S]*?substr\(text/u);
    expect(listHelper).not.toContain('SELECT *');
    expect(draftList).not.toContain('SELECT id, data');
  });

  it('exposes viral analyzer state and production-task handoff to the renderer', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');

    expect(main).toContain('startViralAnalysisRun');
    expect(main).toContain('runViralAnalysis');
    expect(main).toContain('createViralProductionTaskInput');
    expect(preload).toContain('createAndRunViralAnalysis');
    expect(preload).toContain('createProductionTaskFromViral');
    expect(apiContract).toContain('createAndRunViralAnalysis');
    expect(apiContract).toContain('createProductionTaskFromViral');
  });

  it('publishes the initial running viral summary before waiting for runtime events', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const runner = main.slice(main.indexOf('function startViralAnalysisRun'), main.indexOf('async function resumeViralAnalysisRun'));
    const runningUpdate = runner.indexOf("status: 'running'");
    const initialPublish = runner.indexOf('await publishViralUpsert(database, record.id);', runningUpdate);
    const runtimeStart = runner.indexOf('const completed = await runViralAnalysis', runningUpdate);

    expect(runningUpdate).toBeGreaterThan(-1);
    expect(initialPublish).toBeGreaterThan(runningUpdate);
    expect(initialPublish).toBeLessThan(runtimeStart);
  });

  it('starts newly created tasks in the background so the renderer can open task detail immediately', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const handler = main.slice(main.indexOf("trustedHandle('task:create-and-run'"), main.indexOf("trustedHandle('viral:create-and-run'"));

    expect(handler).toContain('const delta = await publishTaskUpsert(database, task.id)');
    expect(handler).toContain('const workDir = taskWorkDir(task)');
    expect(handler).toContain('const runningTask = await database.beginTaskRun(task.id)');
    expect(handler).toContain('startTaskRun(database, runningTask, workDir, activityReservation)');
    expect(handler).toContain('return delta');
    expect(handler).not.toContain('getPublicState()');
    expect(main.match(/return getPublicState\(\)/gu)).toHaveLength(1);
  });

  it('routes resume and retry through a background task runner instead of only mutating status', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');

    expect(main).toContain('runningTasks');
    expect(main).toContain('AbortController');
    expect(main).toContain('requestTaskRunIntent');
    expect(main).toContain('latestTaskControlRequests');
    expect(main).not.toContain('restartAfterAbort');
    expect(main).toContain('resumeTaskRun');
    expect(main).toContain("input.status === 'running'");
    const retryHandler = main.slice(main.indexOf("trustedHandle('task:retry'"), main.indexOf("trustedHandle('diagnostics:run'"));
    expect(retryHandler).toContain("requestTaskRunIntent(existingRun, 'restart', '用户重试')");
    expect(retryHandler).toContain('runLatestTaskControlRequest(latestTaskControlRequests, id, async (isCurrent, transferReservation) => {');
    expect(retryHandler).toContain('await resumeTaskRun(database, task, workDir, isCurrent, transferReservation)');
    expect(retryHandler).not.toContain('runTask(');
  });

  it('keeps aborting task runners registered until they exit to avoid duplicate runs', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const statusHandler = main.slice(main.indexOf("trustedHandle('task:update-status'"), main.indexOf("trustedHandle('task:retry'"));

    const requestIntent = statusHandler.indexOf('requestTaskRunIntent(');
    const firstAwait = statusHandler.indexOf('await getDb()');
    expect(requestIntent).toBeGreaterThan(-1);
    expect(requestIntent).toBeLessThan(firstAwait);
    expect(statusHandler).toContain('latestTaskControlRequests');
    expect(statusHandler).not.toContain('existingRun.controller.abort');
    expect(statusHandler).not.toContain('runningTasks.delete(input.id)');
  });

  it('pushes revisioned app deltas and exposes narrow bootstrap APIs', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');

    expect(main).toContain('publishAppDelta');
    expect(main).toContain("target.webContents.send('app:delta', delta)");
    expect(main).toContain('publishTaskUpsert');
    expect(preload).toContain('getBootstrap');
    expect(preload).toContain('getTaskDetail');
    expect(preload).toContain('listTaskEvents');
    expect(preload).toContain('onAppDelta');
    expect(preload).toContain('testLlmConfig');
    expect(preload).toContain('listProviderModels');
    expect(preload).toContain('listVolcengineSpeakers');
    expect(preload).toContain('searchWebSources');
    expect(preload).toContain('composeResearchCopy');
    expect(preload).toContain('saveCustomStyle');
    expect(preload).toContain('generateCustomStyleDraft');
    expect(preload).toContain('getTaskArtifacts');
    expect(apiContract).toContain('callback: (delta: AppDelta) => void');
    expect(apiContract).toContain('testLlmConfig');
    expect(apiContract).toContain('listProviderModels');
    expect(apiContract).toContain('listVolcengineSpeakers');
    expect(apiContract).toContain('composeResearchCopy');
    expect(apiContract).toContain('saveCustomStyle');
    expect(apiContract).toContain('generateCustomStyleDraft');
    expect(apiContract).toContain('getTaskArtifacts');
  });

  it('publishes committed runner events and narrow heartbeat task summaries', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const buildOptions = main.slice(main.indexOf('async function buildRunOptions'), main.indexOf('function startTaskRun'));
    const heartbeat = buildOptions.slice(buildOptions.indexOf('onHeartbeat:'), buildOptions.indexOf('\n    },', buildOptions.indexOf('onHeartbeat:')));

    expect(buildOptions).toContain('onEvent: (event: SequencedTaskEvent)');
    expect(buildOptions).toContain('void publishTaskEvent(event)');
    expect(heartbeat).toContain('publishTaskUpsert(database, task.id)');
    expect(heartbeat).not.toContain('getState(');
    expect(heartbeat).not.toContain('getPublicState(');
    expect(heartbeat).not.toContain('sendTaskState(');
  });

  it('wires standard production tasks to the real pyJianYingDraft bridge', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const buildOptions = main.slice(main.indexOf('async function buildRunOptions'), main.indexOf('function startTaskRun'));

    expect(main).toContain("import { runPyJianYingDraftBridge } from '../src/shared/jianying-bridge';");
    expect(buildOptions).toContain('draftWriterOptions: { runBridge: runPyJianYingDraftBridge }');
  });

  it('exposes safe local image data URLs for task artifact thumbnails', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');

    expect(main).toContain("trustedHandle('asset:read-data-url'");
    expect(main).toContain('readLocalImageDataUrl');
    expect(main).toContain('data:image/');
    expect(main).toContain('Unsupported preview image extension');
    expect(preload).toContain('readAssetDataUrl');
    expect(preload).toContain('asset:read-data-url');
    expect(apiContract).toContain('readAssetDataUrl: (path: string) => Promise<string>');
  });

  it('routes image lab submissions through the configured real image generator', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');
    const handler = main.slice(main.indexOf("trustedHandle('image-lab:generate'"), main.indexOf("trustedHandle('image-lab:add-record'"));

    expect(main).toContain('generateImageLabRecord');
    expect(handler).toContain('imageLabWorkDir');
    expect(handler).toContain('database.addImageLabRecord(record)');
    expect(preload).toContain('generateImageLab');
    expect(preload).toContain('image-lab:generate');
    expect(apiContract).toContain('generateImageLab: (input: ImageLabGenerateInput) => Promise<AppMutationResult | null>');
  });

  it('routes voice lab preview generation through the configured TTS provider', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');
    const handler = main.slice(main.indexOf("trustedHandle('voice-lab:generate'"), main.indexOf("trustedHandle('account:save'"));

    expect(main).toContain('generateConfiguredVoicePreview');
    expect(handler).toContain('voiceLabWorkDir');
    expect(handler).toContain('database.addVoiceLabRecord(record)');
    expect(preload).toContain('generateVoiceLabPreview');
    expect(preload).toContain('voice-lab:generate');
    expect(apiContract).toContain('generateVoiceLabPreview: (input: VoiceLabGenerateInput) => Promise<AppMutationResult | null>');
  });

  it('exposes a safe local image picker for draft template background images', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');

    expect(main).toContain("trustedHandle('local-image:select'");
    expect(main).toContain('dialog.showOpenDialog');
    expect(main).toContain("properties: ['openFile']");
    expect(preload).toContain('selectLocalImage');
    expect(preload).toContain('local-image:select');
    expect(apiContract).toContain('selectLocalImage: () => Promise<string | null>');
  });

  it('keeps raw audio selection for voice cloning and exposes managed BGM imports', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');

    expect(main).toContain("trustedHandle('local-audio:select'");
    expect(main).toContain('selectLocalAudio');
    expect(main).toContain("purpose === 'managed-bgm' ? importManagedBgm(selectedPath, appDataDir()) : selectedPath");
    expect(main).toContain('await ensureRuntimeManagedBgmPaths(database, service, dir)');
    expect(main).toContain('resolveRuntimeManagedBgmLibrary(dataDir, current)');
    expect(main).toContain("extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']");
    expect(preload).toContain('selectLocalAudio');
    expect(preload).toContain('importBgmAudio');
    expect(preload).toContain('local-audio:select');
    expect(apiContract).toContain('(): Promise<string | null>');
    expect(apiContract).toContain("(purpose: 'managed-bgm'): Promise<ManagedBgmImport | null>");
    expect(apiContract).toContain('importBgmAudio: () => Promise<ManagedBgmImport | null>');
  });

  it('exposes Jianying draft folder detection and folder picking to the renderer', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');

    expect(main).toContain("trustedHandle('local-folder:select'");
    expect(main).toContain("properties: ['openDirectory']");
    expect(main).toContain("trustedHandle('jianying:draft-path:detect'");
    expect(main).toContain('detectJianyingDraftPath');
    expect(preload).toContain('selectLocalFolder');
    expect(preload).toContain('local-folder:select');
    expect(preload).toContain('detectJianyingDraftPath');
    expect(preload).toContain('jianying:draft-path:detect');
    expect(apiContract).toContain('selectLocalFolder: () => Promise<string | null>');
    expect(apiContract).toContain('detectJianyingDraftPath: () => Promise<JianyingDraftPathDetection>');
    expect(apiContract).toContain("import type { JianyingDraftPathDetection } from './jianying-paths'");
  });

  it('exposes viral cookie file picking and a persistent login browser', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');

    expect(main).toContain("trustedHandle('cookie-file:select'");
    expect(main).toContain("trustedHandle('viral:open-login-window'");
    expect(main).toContain('partition:');
    expect(main).toContain('persist:storydream-viral-douyin');
    expect(main).toContain('async function openViralLoginWindow(): Promise<string | null>');
    expect(main).toContain('resolve(cookiePath)');
    expect(main).toContain('exportBenchmarkLoginCookies');
    expect(main).toContain('benchmark-cookies');
    expect(main).toContain('cookieCount');
    expect(preload).toContain('selectCookieFile');
    expect(preload).toContain('openViralLoginWindow');
    expect(preload).toContain('openViralLoginWindow: (): Promise<string | null>');
    expect(apiContract).toContain('selectCookieFile: () => Promise<string | null>');
    expect(apiContract).toContain('openViralLoginWindow: () => Promise<string | null>');
  });

  it('exposes pyJianYingDraft effect catalog loading to the renderer', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');

    expect(main).toContain("trustedHandle('jianying:effect-catalog'");
    expect(main).toContain('loadJianyingEffectCatalog');
    expect(preload).toContain('getJianyingEffectCatalog');
    expect(preload).toContain('jianying:effect-catalog');
    expect(apiContract).toContain('getJianyingEffectCatalog: () => Promise<JianyingEffectCatalog>');
  });

  it('checks Storybound-compatible sidecar dependencies in diagnostics', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');

    expect(main).toContain('checkStoryboundSidecarDependencies');
    expect(main).toContain('pyJianYingDraft, imageio_ffmpeg, pydub, jieba');
    expect(main).toContain("id: 'storybound-sidecar'");
  });

  it('keeps HTML video capture behind a typed dedicated runner and narrow preview IPC', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');
    const renderer = await readFile(new URL('../electron/html-video-renderer.ts', import.meta.url), 'utf8');

    expect(main).toContain("trustedHandle('html-video:create-task'");
    const configUpdate = handlerSource(main, 'html-video:update-config');
    expect(configUpdate).toContain("runHistoryGovernanceMutation('task', input.id");
    expect(configUpdate).toContain("applied.invalidateFrom === 'preview'");
    expect(configUpdate).toContain('rebuildHtmlVideoEditorialPreviews');
    expect(configUpdate).toContain('database.updateHtmlVideoTaskConfig(input.id, input.changes)');
    expect(configUpdate).toContain("kind: 'task-upsert'");
    expect(configUpdate).not.toContain('publishTaskEvent');
    expect(main).toContain('createElectronHtmlVideoRuntime');
    expect(main).toContain('runHtmlVideoPipeline');
    expect(main).toContain('startHtmlVideoTaskRun');
    expect(renderer).toContain('BrowserWindow');
    expect(renderer).toContain('executeJavaScript');
    expect(renderer).toContain('capturePage');
    expect(renderer).toContain('frame_%04d.jpg');
    expect(preload).toContain('createHtmlVideoTask');
    expect(preload).toContain("invokeTrusted('html-video:update-config', { id, changes })");
    expect(preload).toContain('openHtmlVideoPreview');
    expect(preload).toContain('getHtmlVideoMediaUrl');
    expect(apiContract).toContain('createHtmlVideoTask: (input: CreateTaskInput) => Promise<AppMutationResult | null>');
    expect(apiContract).toContain('updateHtmlVideoConfig: (id: string, changes: HtmlVideoConfigChange[]) => Promise<AppMutationResult | null>');
    expect(apiContract).toContain('openHtmlVideoPreview: (id: string, sceneIndex?: number) => Promise<void>');
    expect(apiContract).toContain('getHtmlVideoMediaUrl: (id: string, path: string) => Promise<string>');
    expect(preload).not.toContain('eval_in_window');
    expect(preload).not.toContain('capture_webview_by_label');
    expect(preload).not.toContain('executeJavaScript');
    expect(apiContract).not.toContain('eval_in_window');
    expect(apiContract).not.toContain('capture_webview_by_label');
    expect(apiContract).not.toContain('executeJavaScript');
    expect(main).not.toContain("trustedHandle('eval_in_window'");
    expect(main).not.toContain("trustedHandle('capture_webview_by_label'");
    expect(main).not.toContain("trustedHandle('executeJavaScript'");
  });

  it('updates music MV parameters under task governance before rerunning content', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const handler = handlerSource(main, 'music-mv:update');
    expect(handler).toContain("runHistoryGovernanceMutation('task', input.id");
    expect(handler).toContain("markTaskStepForRerun(task.artifactStatePath, 0, 'regenerate')");
    expect(handler).toContain('database.updateMusicMvTask(input)');
    expect(preload).toContain("invokeTrusted('music-mv:update', input)");
  });

  it('preserves the current HTML video canvas resolution when rebuilding editorial previews', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const runtimeFactoryStart = main.indexOf('async function createHtmlVideoEditorialRuntime(');
    const rebuildStart = main.indexOf('async function rebuildHtmlVideoEditorialPreviews(');
    const rebuildEnd = main.indexOf('\ninterface HtmlVideoEditorialEvent', rebuildStart);
    const runtimeFactory = main.slice(runtimeFactoryStart, rebuildStart);
    const rebuild = main.slice(rebuildStart, rebuildEnd);

    expect(runtimeFactoryStart).toBeGreaterThan(-1);
    expect(rebuildStart).toBeGreaterThan(runtimeFactoryStart);
    expect(rebuildEnd).toBeGreaterThan(rebuildStart);
    expect(runtimeFactory).toContain('options: { maxLongEdge?: number } = {}');
    expect(runtimeFactory).toContain('{ maxLongEdge: options.maxLongEdge }');
    expect(rebuild).toContain('const existingCanvas = pipeline.compositions[0]?.canvas');
    expect(rebuild).toContain('parseHtmlVideoPipelineData(task.pipelineData).compositions[0]?.canvas');
    expect(rebuild).toContain('Math.max(existingCanvas.w, existingCanvas.h)');
    expect(rebuild).toContain('createHtmlVideoEditorialRuntime(task, { maxLongEdge })');
  });

  it('imports manual HTML covers under governance without accepting renderer paths', async () => {
    const [main, preload, apiContract] = await Promise.all([
      readFile(new URL('../electron/main.ts', import.meta.url), 'utf8'),
      readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8'),
    ]);
    const start = main.indexOf("trustedHandle('html-video:import-cover'");
    const end = main.indexOf("trustedHandle('html-video:open-preview'", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const handler = main.slice(start, end);
    expect(handler).toContain("runHistoryGovernanceMutation('task', id");
    expect(handler.indexOf('database.getTaskDetail(id)')).toBeLessThan(handler.indexOf('dialog.showOpenDialog'));
    expect(handler).toContain('inspectHtmlVideoCoverImage');
    expect(handler).toContain('database.importHtmlVideoCover');
    expect(handler).toContain('publishTaskUpsert');
    expect(handler).not.toContain('sourcePath: input');
    expect(handler).not.toContain('rm(sourcePath');
    expect(preload).toContain("invokeTrusted('html-video:import-cover', id)");
    expect(apiContract).toContain('importHtmlVideoCover: (id: string) => Promise<AppMutationResult | null>');
  });

  it('waits for a fully ready hidden HTML scene before capture begins', async () => {
    const renderer = await readFile(new URL('../electron/html-video-renderer.ts', import.meta.url), 'utf8');
    const openHiddenWindow = renderer.slice(renderer.indexOf('async function openHiddenHtmlWindow'));

    expect(renderer).toContain('waitForHiddenHtmlSceneReady');
    expect(openHiddenWindow).toContain('await waitForHiddenHtmlSceneReady(window)');
    expect(renderer).toContain("document.readyState !== 'loading'");
    expect(renderer).toContain('window.__ready === true');
    expect(renderer).toContain("typeof window.__tl.seek === 'function'");
    expect(renderer).toContain('document.fonts.ready');
    expect(renderer).toContain('document.images');
    expect(renderer).toContain("document.querySelectorAll('video')");
  });

  it('uses a real font cmap probe instead of treating Chromium glyph counts as proof', async () => {
    const renderer = await readFile(new URL('../electron/director-renderer.ts', import.meta.url), 'utf8');
    const sidecar = await readFile(new URL('../src/shared/storybound-sidecar.ts', import.meta.url), 'utf8');
    expect(renderer).toContain("mode: 'probe_glyphs'");
    expect(renderer).toContain('missing_code_points.map((codePoint) => String.fromCodePoint(codePoint))');
    expect(sidecar).toContain('Read the selected Windows font cmap');
    expect(sidecar).toContain('probe_glyphs(payload)');
    expect(sidecar).not.toContain('GetGlyphIndicesW');
  });

  it('seeks each hidden scene frame onto an animation frame before writing recovered JPEG names', async () => {
    const renderer = await readFile(new URL('../electron/html-video-renderer.ts', import.meta.url), 'utf8');
    const captureLoop = renderer.slice(renderer.indexOf('for (let frameIndex = 0'), renderer.indexOf('capturedScenes.push'));

    expect(renderer).toContain("const sidecarFramePattern = 'frame_%04d.jpg'");
    expect(captureLoop).toContain('const frameNumber = frameIndex + 1');
    expect(captureLoop).toContain("sidecarFramePattern.replace('%04d', String(frameNumber).padStart(4, '0'))");
    expect(captureLoop).toContain('await seekHiddenHtmlSceneFrame(window, time)');
    expect(renderer).toContain('requestAnimationFrame');
    expect(renderer).toContain('const result = timeline.seek(${JSON.stringify(time)}, false);');
    expect(renderer).toContain('return Promise.resolve(result === timeline ? undefined : result).then');
    expect(renderer).toContain('window.__tl.play(); return true;');
    expect(renderer).not.toContain('Promise.resolve(window.__tl.play())');
    expect(captureLoop).toContain('capturePage');
  });

  it('regenerates a single scene image through cache invalidation and background resume', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');
    const regenerateHandler = main.slice(main.indexOf("trustedHandle('task:regenerate-image'"), main.indexOf("trustedHandle('task:get-artifacts'"));

    expect(main).toContain('markSceneImageForRegeneration');
    expect(regenerateHandler).toContain('runLatestTaskControlRequest(latestTaskControlRequests, input.id, async (isCurrent, transferReservation) => {');
    expect(regenerateHandler).toContain('retryFromStep: 4');
    expect(regenerateHandler).toContain('failedStep: 4');
    expect(regenerateHandler).toContain('resumeLatestTaskRun(database, task.id, workDir, isCurrent, transferReservation,');
    expect(regenerateHandler).not.toContain('runTask(');
    expect(preload).toContain('regenerateTaskImage');
    expect(preload).toContain('task:regenerate-image');
    expect(apiContract).toContain('regenerateTaskImage: (id: string, sceneId: number) => Promise<AppMutationResult | null>');
  });

  it('regenerates a single scene narration through cache invalidation and background resume', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');
    const regenerateHandler = main.slice(main.indexOf("trustedHandle('task:regenerate-narration'"), main.indexOf("trustedHandle('task:get-artifacts'"));

    expect(main).toContain('markSceneNarrationForRegeneration');
    expect(regenerateHandler).toContain('runLatestTaskControlRequest(latestTaskControlRequests, input.id, async (isCurrent, transferReservation) => {');
    expect(regenerateHandler).toContain('retryFromStep: 5');
    expect(regenerateHandler).toContain('failedStep: 5');
    expect(regenerateHandler).toContain('resumeLatestTaskRun(database, task.id, workDir, isCurrent, transferReservation,');
    expect(regenerateHandler).not.toContain('runTask(');
    expect(preload).toContain('regenerateTaskNarration');
    expect(preload).toContain('task:regenerate-narration');
    expect(apiContract).toContain('regenerateTaskNarration: (id: string, sceneId: number) => Promise<AppMutationResult | null>');
  });

  it('updates one scene image prompt through a narrow task artifact API', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');
    const updateHandler = main.slice(main.indexOf("trustedHandle('task:update-image-prompt'"), main.indexOf("trustedHandle('task:rerun-step'"));

    expect(main).toContain("trustedHandle('task:update-image-prompt'");
    expect(main).toContain('updateSceneImagePrompt');
    expect(updateHandler).toContain('artifactStatePath');
    expect(updateHandler).toContain('const event = await database.addTaskEvent');
    expect(updateHandler).toContain('await publishTaskEvent(event)');
    expect(updateHandler).not.toContain('resumeTaskRun(database, updatedTask)');
    expect(preload).toContain('updateTaskImagePrompt');
    expect(preload).toContain('task:update-image-prompt');
    expect(apiContract).toContain('updateTaskImagePrompt: (id: string, sceneId: number, prompt: string) => Promise<AppMutationResult | null>');
  });

  it('reruns an artifact pipeline step through cache invalidation and background resume', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const apiContract = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');
    const rerunHandler = main.slice(main.indexOf("trustedHandle('task:rerun-step'"), main.indexOf("trustedHandle('task:get-artifacts'"));

    expect(main).toContain('markTaskStepForRerun');
    expect(rerunHandler).toContain('runLatestTaskControlRequest(latestTaskControlRequests, input.id, async (isCurrent, transferReservation) => {');
    expect(rerunHandler).toContain('retryFromStep: step');
    expect(rerunHandler).toContain('failedStep: step');
    expect(rerunHandler).toContain('resumeLatestTaskRun(database, task.id, workDir, isCurrent, transferReservation,');
    expect(rerunHandler).not.toContain('runTask(');
    expect(preload).toContain('rerunTaskStep');
    expect(preload).toContain('task:rerun-step');
    expect(apiContract).toContain('TaskStepRerunMode');
    expect(apiContract).toContain('rerunTaskStep: (id: string, step: number, mode: TaskStepRerunMode) => Promise<AppMutationResult | null>');
  });
});

function handlerSource(source: string, channel: string): string {
  const start = source.indexOf(`trustedHandle('${channel}'`);
  const end = source.indexOf('\ntrustedHandle(', start + 1);
  if (start < 0) throw new Error(`Missing trusted IPC handler: ${channel}`);
  return source.slice(start, end < 0 ? source.length : end);
}
