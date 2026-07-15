import { createHash } from 'node:crypto';
import { lstat, mkdtemp, mkdir, readFile, readdir, realpath, rename, rm, rmdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import initSqlJs from 'sql.js';
import { FileDatabase } from '@shared/storage';
import type { HistoryFamily } from '@shared/types';
import {
  backfillLegacyManagedHistoryStorage,
  createManagedStorageKey,
  deleteManagedHistoryWithQuarantine,
  managedHistoryFamilyRoot,
  reapHistoryQuarantines,
  removeQuarantineTreeNoFollow,
  resolveLegacyManagedHistoryWorkDir,
  resolveManagedHistoryWorkDir,
  rollbackManagedHistoryDirectory,
  stageManagedHistoryDirectory,
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

  it('stages only a direct managed child and records its post-rename identity', async () => {
    const appDataDir = await temporaryDirectory('storydream-managed-stage-');
    const key = createManagedStorageKey();
    const originalPath = resolveManagedHistoryWorkDir(appDataDir, 'task', key);
    await mkdir(originalPath, { recursive: true });
    await writeFile(join(originalPath, 'owned.txt'), 'owned', 'utf8');

    const staged = await stageManagedHistoryDirectory(appDataDir, 'task', key);
    expect(staged).not.toBeNull();
    if (!staged) throw new Error('Expected the managed directory to be staged.');
    expect(staged.originalPath).toBe(originalPath);
    expect(staged.quarantinePath).toBe(join(managedHistoryFamilyRoot(appDataDir, 'task'), staged.quarantineName));
    expect(staged.quarantineName).toBe(testQuarantineName(key, staged.quarantineName.split('.')[3]));
    expect(JSON.parse(staged.quarantineIdentityJson)).toEqual({
      version: 1,
      dev: expect.stringMatching(/^\d+$/u),
      ino: expect.stringMatching(/^\d+$/u),
    });
    await expect(lstat(originalPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(staged.quarantinePath, 'owned.txt'), 'utf8')).toBe('owned');
  });

  it('uses a fixed-length quarantine name for the longest filesystem-compatible legacy key', async () => {
    const appDataDir = await temporaryDirectory('storydream-managed-long-key-');
    const key = 'a'.repeat(255);
    const originalPath = resolveManagedHistoryWorkDir(appDataDir, 'task', key);
    await mkdir(originalPath, { recursive: true });

    const staged = await stageManagedHistoryDirectory(appDataDir, 'task', key);
    expect(staged).not.toBeNull();
    if (!staged) throw new Error('Expected the long-key managed directory to be staged.');
    expect(staged.quarantineName.length).toBeLessThanOrEqual(255);
  });

  it('rejects root, absolute, traversal, and separator keys before any path operation', async () => {
    const pathOperation = vi.fn(async () => {
      throw new Error('path operation must not run');
    });
    for (const key of ['', '.', '..', '../outside', '..\\outside', '/outside', 'C:\\outside', 'a/b', 'a\\b']) {
      await expect(stageManagedHistoryDirectory('C:\\trusted\\storydream', 'task', key, {
        lstat: pathOperation,
      })).rejects.toThrow(/managed storage key/i);
    }
    expect(pathOperation).not.toHaveBeenCalled();
  });

  it('rejects a managed directory represented by a symlink or junction', async () => {
    const appDataDir = await temporaryDirectory('storydream-managed-stage-link-');
    const outside = await temporaryDirectory('storydream-managed-stage-link-outside-');
    const outsideSentinel = join(outside, 'sentinel.txt');
    await writeFile(outsideSentinel, 'outside', 'utf8');
    const key = createManagedStorageKey();
    const root = managedHistoryFamilyRoot(appDataDir, 'task');
    await mkdir(root, { recursive: true });
    const linkedPath = resolveManagedHistoryWorkDir(appDataDir, 'task', key);
    await symlink(outside, linkedPath, process.platform === 'win32' ? 'junction' : 'dir');

    await expect(stageManagedHistoryDirectory(appDataDir, 'task', key)).rejects.toThrow(/link|reparse|directory/i);
    expect(await readFile(outsideSentinel, 'utf8')).toBe('outside');
  });

  it('rejects an app data root represented by a symlink or junction', async () => {
    const container = await temporaryDirectory('storydream-managed-app-root-link-');
    const outside = await temporaryDirectory('storydream-managed-app-root-link-outside-');
    const appDataDir = join(container, 'storydream-link');
    const key = createManagedStorageKey();
    const outsideTarget = join(outside, 'tasks', key);
    await mkdir(outsideTarget, { recursive: true });
    await writeFile(join(outsideTarget, 'sentinel.txt'), 'outside', 'utf8');
    await symlink(outside, appDataDir, process.platform === 'win32' ? 'junction' : 'dir');

    await expect(stageManagedHistoryDirectory(appDataDir, 'task', key)).rejects.toThrow(/app data|link|reparse/i);
    expect(await readFile(join(outsideTarget, 'sentinel.txt'), 'utf8')).toBe('outside');
  });

  it('refuses reaper cleanup through a linked app data root', async () => {
    const container = await temporaryDirectory('storydream-managed-reaper-app-link-');
    const outside = await temporaryDirectory('storydream-managed-reaper-app-link-outside-');
    const appDataDir = join(container, 'storydream-link');
    const key = createManagedStorageKey();
    const quarantineName = testQuarantineName(key, 'a'.repeat(32));
    const quarantinePath = join(outside, 'tasks', quarantineName);
    await mkdir(quarantinePath, { recursive: true });
    await writeFile(join(quarantinePath, 'sentinel.txt'), 'outside', 'utf8');
    await symlink(outside, appDataDir, process.platform === 'win32' ? 'junction' : 'dir');
    const quarantineStat = await lstat(quarantinePath, { bigint: true });
    const tombstone = {
      family: 'task' as const,
      id: 'task-reaper-app-link',
      managedStorageKey: key,
      cleanupState: 'pending',
      quarantineName,
      quarantineIdentityJson: JSON.stringify({ version: 1, dev: String(quarantineStat.dev), ino: String(quarantineStat.ino) }),
      diagnostic: '',
      deletedAt: '2026-07-16T00:00:00.000Z',
    };
    const updateHistoryTombstoneCleanup = vi.fn(async () => tombstone);

    await reapHistoryQuarantines(appDataDir, {
      listPendingHistoryTombstones: async () => [tombstone],
      updateHistoryTombstoneCleanup,
    });

    expect(await readFile(join(quarantinePath, 'sentinel.txt'), 'utf8')).toBe('outside');
    expect(updateHistoryTombstoneCleanup).toHaveBeenCalledWith(
      'task',
      tombstone.id,
      'pending',
      expect.stringMatching(/app data|link|reparse/i),
    );
  });

  it('detects replacement of the managed family root before rename', async () => {
    const appDataDir = await temporaryDirectory('storydream-managed-root-swap-');
    const key = createManagedStorageKey();
    const root = managedHistoryFamilyRoot(appDataDir, 'task');
    const originalPath = resolveManagedHistoryWorkDir(appDataDir, 'task', key);
    const displacedRoot = `${root}-displaced`;
    await mkdir(originalPath, { recursive: true });
    let rootReads = 0;

    await expect(stageManagedHistoryDirectory(appDataDir, 'task', key, {
      lstat: async (path: string) => {
        if (path === root && ++rootReads === 2) {
          await rename(root, displacedRoot);
          await mkdir(root, { recursive: true });
        }
        return lstat(path, { bigint: true });
      },
    })).rejects.toThrow(/root|identity|changed/i);
    expect(await lstat(join(displacedRoot, key))).toMatchObject({ isDirectory: expect.any(Function) });
  });

  it('detects a rename-time swap instead of accepting the replacement identity', async () => {
    const appDataDir = await temporaryDirectory('storydream-managed-rename-swap-');
    const key = createManagedStorageKey();
    const originalPath = resolveManagedHistoryWorkDir(appDataDir, 'task', key);
    const displacedPath = `${originalPath}-displaced`;
    await mkdir(originalPath, { recursive: true });
    await writeFile(join(originalPath, 'original.txt'), 'original', 'utf8');

    await expect(stageManagedHistoryDirectory(appDataDir, 'task', key, {
      rename: async (source: string, destination: string) => {
        await rename(source, displacedPath);
        await mkdir(source, { recursive: true });
        await writeFile(join(source, 'replacement.txt'), 'replacement', 'utf8');
        await rename(source, destination);
      },
    })).rejects.toThrow(/identity|changed/i);
    expect(await readFile(join(displacedPath, 'original.txt'), 'utf8')).toBe('original');
  });

  it('rolls a staged directory back only while its identity is unchanged', async () => {
    const appDataDir = await temporaryDirectory('storydream-managed-rollback-');
    const key = createManagedStorageKey();
    const originalPath = resolveManagedHistoryWorkDir(appDataDir, 'task', key);
    await mkdir(originalPath, { recursive: true });
    await writeFile(join(originalPath, 'owned.txt'), 'owned', 'utf8');
    const staged = await stageManagedHistoryDirectory(appDataDir, 'task', key);
    if (!staged) throw new Error('Expected a staged directory.');

    await rollbackManagedHistoryDirectory(staged);
    expect(await readFile(join(originalPath, 'owned.txt'), 'utf8')).toBe('owned');
    await expect(lstat(staged.quarantinePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses rollback when the original managed target was recreated', async () => {
    const appDataDir = await temporaryDirectory('storydream-managed-rollback-conflict-');
    const key = createManagedStorageKey();
    const originalPath = resolveManagedHistoryWorkDir(appDataDir, 'task', key);
    await mkdir(originalPath, { recursive: true });
    await writeFile(join(originalPath, 'old.txt'), 'old', 'utf8');
    const staged = await stageManagedHistoryDirectory(appDataDir, 'task', key);
    if (!staged) throw new Error('Expected a staged directory.');
    await mkdir(originalPath, { recursive: true });
    await writeFile(join(originalPath, 'new.txt'), 'new', 'utf8');

    await expect(rollbackManagedHistoryDirectory(staged)).rejects.toThrow(/exists|recreated|rollback/i);
    expect(await readFile(join(originalPath, 'new.txt'), 'utf8')).toBe('new');
    expect(await readFile(join(staged.quarantinePath, 'old.txt'), 'utf8')).toBe('old');
  });

  it('rechecks a recreated rollback target immediately before rename', async () => {
    const appDataDir = await temporaryDirectory('storydream-managed-rollback-race-');
    const key = createManagedStorageKey();
    const originalPath = resolveManagedHistoryWorkDir(appDataDir, 'task', key);
    await mkdir(originalPath, { recursive: true });
    await writeFile(join(originalPath, 'old.txt'), 'old', 'utf8');
    const staged = await stageManagedHistoryDirectory(appDataDir, 'task', key);
    if (!staged) throw new Error('Expected a staged directory.');
    let quarantineReads = 0;

    await expect(rollbackManagedHistoryDirectory(staged, {
      lstat: async (path: string) => {
        const stat = await lstat(path, { bigint: true });
        if (path === staged.quarantinePath && ++quarantineReads === 3) {
          await mkdir(originalPath, { recursive: true });
          await writeFile(join(originalPath, 'new.txt'), 'new', 'utf8');
        }
        return stat;
      },
      rename: async (source: string, destination: string) => {
        await rm(destination, { recursive: true, force: true });
        await rename(source, destination);
      },
    })).rejects.toThrow(/exists|recreated|rollback/i);
    expect(await readFile(join(originalPath, 'new.txt'), 'utf8')).toBe('new');
    expect(await readFile(join(staged.quarantinePath, 'old.txt'), 'utf8')).toBe('old');
  });

  it('removes a quarantine tree without following nested links', async () => {
    const appDataDir = await temporaryDirectory('storydream-managed-walker-');
    const outside = await temporaryDirectory('storydream-managed-walker-outside-');
    const outsideSentinel = join(outside, 'sentinel.txt');
    await writeFile(outsideSentinel, 'outside', 'utf8');
    const key = createManagedStorageKey();
    const originalPath = resolveManagedHistoryWorkDir(appDataDir, 'task', key);
    const nestedPath = join(originalPath, 'nested');
    await mkdir(nestedPath, { recursive: true });
    await writeFile(join(nestedPath, 'owned.txt'), 'owned', 'utf8');
    await symlink(outside, join(nestedPath, 'outside-link'), process.platform === 'win32' ? 'junction' : 'dir');
    const staged = await stageManagedHistoryDirectory(appDataDir, 'task', key);
    if (!staged) throw new Error('Expected a staged directory.');

    await removeQuarantineTreeNoFollow(staged);
    await expect(lstat(staged.quarantinePath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(outsideSentinel, 'utf8')).toBe('outside');
  });

  it('refuses a family-root replacement before touching children returned by readdir', async () => {
    const appDataDir = await temporaryDirectory('storydream-managed-walker-root-swap-');
    const key = createManagedStorageKey();
    const root = managedHistoryFamilyRoot(appDataDir, 'task');
    const displacedRoot = `${root}-displaced`;
    const originalPath = resolveManagedHistoryWorkDir(appDataDir, 'task', key);
    await mkdir(originalPath, { recursive: true });
    await writeFile(join(originalPath, 'owned.txt'), 'owned', 'utf8');
    const staged = await stageManagedHistoryDirectory(appDataDir, 'task', key);
    if (!staged) throw new Error('Expected a staged directory.');
    let replaced = false;

    await expect(removeQuarantineTreeNoFollow(staged, {
      readdir: async (path: string) => {
        const entries = await readdir(path);
        if (path === staged.quarantinePath && !replaced) {
          replaced = true;
          await rename(root, displacedRoot);
          await mkdir(staged.quarantinePath, { recursive: true });
          await writeFile(join(staged.quarantinePath, 'owned.txt'), 'replacement', 'utf8');
        }
        return entries;
      },
    })).rejects.toThrow(/root|identity|changed/i);
    expect(await readFile(join(staged.quarantinePath, 'owned.txt'), 'utf8')).toBe('replacement');
    expect(await readFile(join(displacedRoot, staged.quarantineName, 'owned.txt'), 'utf8')).toBe('owned');
  });

  it('refuses cleanup after the staged quarantine identity changes', async () => {
    const appDataDir = await temporaryDirectory('storydream-managed-cleanup-swap-');
    const key = createManagedStorageKey();
    const originalPath = resolveManagedHistoryWorkDir(appDataDir, 'task', key);
    await mkdir(originalPath, { recursive: true });
    const staged = await stageManagedHistoryDirectory(appDataDir, 'task', key);
    if (!staged) throw new Error('Expected a staged directory.');
    await rm(staged.quarantinePath, { recursive: true });
    await mkdir(staged.quarantinePath);
    await writeFile(join(staged.quarantinePath, 'replacement.txt'), 'replacement', 'utf8');

    await expect(removeQuarantineTreeNoFollow(staged)).rejects.toThrow(/identity|changed/i);
    expect(await readFile(join(staged.quarantinePath, 'replacement.txt'), 'utf8')).toBe('replacement');
  });

  it('restores the staged directory when the database commit fails', async () => {
    const appDataDir = await temporaryDirectory('storydream-managed-db-rollback-');
    const key = createManagedStorageKey();
    const originalPath = resolveManagedHistoryWorkDir(appDataDir, 'task', key);
    await mkdir(originalPath, { recursive: true });
    await writeFile(join(originalPath, 'owned.txt'), 'owned', 'utf8');
    const updateCleanup = vi.fn(async () => undefined);

    await expect(deleteManagedHistoryWithQuarantine(appDataDir, 'task', key, {
      commit: async () => { throw new Error('injected database persistence failure'); },
      updateCleanup,
    })).rejects.toThrow(/database persistence failure/i);
    expect(await readFile(join(originalPath, 'owned.txt'), 'utf8')).toBe('owned');
    expect((await readdir(managedHistoryFamilyRoot(appDataDir, 'task'))).filter((name) => name.endsWith('.quarantine'))).toEqual([]);
    expect(updateCleanup).not.toHaveBeenCalled();
  });

  it('returns the freshly persisted cleaned tombstone after successful cleanup', async () => {
    const appDataDir = await temporaryDirectory('storydream-managed-cleaned-result-');
    const key = createManagedStorageKey();
    const originalPath = resolveManagedHistoryWorkDir(appDataDir, 'task', key);
    await mkdir(originalPath, { recursive: true });
    let committed: Record<string, unknown> | null = null;

    const result = await deleteManagedHistoryWithQuarantine(appDataDir, 'task', key, {
      commit: async (cleanup) => {
        committed = { id: 'task-cleaned-result', ...cleanup };
        return committed;
      },
      updateCleanup: async (cleanupState, diagnostic) => ({
        ...committed,
        cleanupState,
        diagnostic,
      }),
    });

    expect(result).toMatchObject({ id: 'task-cleaned-result', cleanupState: 'cleaned', diagnostic: '' });
  });

  it('keeps a committed deletion pending when quarantine cleanup fails', async () => {
    const appDataDir = await temporaryDirectory('storydream-managed-cleanup-failure-');
    const key = createManagedStorageKey();
    const originalPath = resolveManagedHistoryWorkDir(appDataDir, 'task', key);
    await mkdir(originalPath, { recursive: true });
    let committed: Record<string, unknown> | null = null;
    const commit = vi.fn(async (cleanup) => {
      committed = { id: 'task-pending-result', ...cleanup };
      return committed;
    });
    const updateCleanup = vi.fn(async (cleanupState, diagnostic) => ({
      ...committed,
      cleanupState,
      diagnostic,
    }));

    const result = await deleteManagedHistoryWithQuarantine(appDataDir, 'task', key, {
      commit,
      updateCleanup,
    }, {
      rmdir: async (path: string) => {
        if (path.endsWith('.quarantine')) throw new Error('injected quarantine cleanup failure');
        await rmdir(path);
      },
    });

    expect(result).toMatchObject({
      id: 'task-pending-result',
      cleanupState: 'pending',
      diagnostic: expect.stringMatching(/cleanup failure/i),
    });
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({
      cleanupState: 'pending',
      quarantineName: expect.stringMatching(/\.quarantine$/u),
      quarantineIdentityJson: expect.stringContaining('"version":1'),
    }));
    expect(updateCleanup).toHaveBeenCalledWith('pending', expect.stringMatching(/cleanup failure/i));
  });

  it('records a missing managed directory and performs zero path operations for a null key', async () => {
    const appDataDir = await temporaryDirectory('storydream-managed-missing-');
    const missingCommit = vi.fn(async (cleanup) => cleanup);
    const missing = await deleteManagedHistoryWithQuarantine(appDataDir, 'task', createManagedStorageKey(), {
      commit: missingCommit,
      updateCleanup: async () => { throw new Error('Missing cleanup must be terminal at commit.'); },
    });
    expect(missing).toMatchObject({ cleanupState: 'missing', quarantineName: null, quarantineIdentityJson: '{}' });

    const pathOperation = vi.fn(async () => { throw new Error('path operation must not run'); });
    const unmanagedCommit = vi.fn(async (cleanup) => cleanup);
    const unmanaged = await deleteManagedHistoryWithQuarantine(appDataDir, 'task', null, {
      commit: unmanagedCommit,
      updateCleanup: async () => { throw new Error('Unmanaged cleanup must be terminal at commit.'); },
    }, {
      lstat: pathOperation,
      realpath: pathOperation,
      rename: pathOperation,
      readdir: pathOperation,
      unlink: pathOperation,
      rmdir: pathOperation,
    });
    expect(unmanaged).toMatchObject({ cleanupState: 'unmanaged-legacy', quarantineName: null, quarantineIdentityJson: '{}' });
    expect(pathOperation).not.toHaveBeenCalled();
  });

  it('reaps only the pending quarantine whose persisted identity still matches', async () => {
    const appDataDir = await temporaryDirectory('storydream-managed-reaper-');
    const key = createManagedStorageKey();
    const originalPath = resolveManagedHistoryWorkDir(appDataDir, 'task', key);
    await mkdir(originalPath, { recursive: true });
    await writeFile(join(originalPath, 'owned.txt'), 'owned', 'utf8');
    const staged = await stageManagedHistoryDirectory(appDataDir, 'task', key);
    if (!staged) throw new Error('Expected a staged directory.');
    const tombstone = {
      family: 'task' as const,
      id: 'task-reaper',
      managedStorageKey: key,
      cleanupState: 'pending',
      quarantineName: staged.quarantineName,
      quarantineIdentityJson: staged.quarantineIdentityJson,
      diagnostic: '',
      deletedAt: '2026-07-16T00:00:00.000Z',
    };
    const updateHistoryTombstoneCleanup = vi.fn(async () => tombstone);

    await reapHistoryQuarantines(appDataDir, {
      listPendingHistoryTombstones: async () => [tombstone],
      updateHistoryTombstoneCleanup,
    });

    await expect(lstat(staged.quarantinePath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(updateHistoryTombstoneCleanup).toHaveBeenCalledWith('task', tombstone.id, 'cleaned', '');
  });

  it.each([
    ['app data root', (appDataDir: string, _familyRoot: string) => appDataDir],
    ['family root', (_appDataDir: string, familyRoot: string) => familyRoot],
  ] as const)('keeps cleanup pending while the %s is temporarily displaced', async (_label, selectRoot) => {
    const appDataDir = await temporaryDirectory('storydream-managed-reaper-root-missing-');
    const key = createManagedStorageKey();
    const originalPath = resolveManagedHistoryWorkDir(appDataDir, 'task', key);
    await mkdir(originalPath, { recursive: true });
    await writeFile(join(originalPath, 'owned.txt'), 'owned', 'utf8');
    const staged = await stageManagedHistoryDirectory(appDataDir, 'task', key);
    if (!staged) throw new Error('Expected a staged directory.');
    const tombstone = {
      family: 'task' as const,
      id: `task-reaper-root-missing-${_label.replaceAll(' ', '-')}`,
      managedStorageKey: key,
      cleanupState: 'pending',
      quarantineName: staged.quarantineName,
      quarantineIdentityJson: staged.quarantineIdentityJson,
      diagnostic: '',
      deletedAt: '2026-07-16T00:00:00.000Z',
    };
    let cleanupState: 'pending' | 'cleaned' | 'missing' = 'pending';
    let diagnostic = '';
    const store = {
      async listPendingHistoryTombstones() {
        return cleanupState === 'pending' ? [{ ...tombstone, cleanupState, diagnostic }] : [];
      },
      async updateHistoryTombstoneCleanup(
        _family: HistoryFamily,
        _id: string,
        nextCleanupState: 'pending' | 'cleaned' | 'missing',
        nextDiagnostic: string,
      ) {
        cleanupState = nextCleanupState;
        diagnostic = nextDiagnostic;
        return { ...tombstone, cleanupState, diagnostic };
      },
    };
    const rootToDisplace = selectRoot(appDataDir, managedHistoryFamilyRoot(appDataDir, 'task'));
    const displacedRoot = `${rootToDisplace}.displaced-${key}`;
    if (rootToDisplace === appDataDir) createdDirectories.push(displacedRoot);

    await rename(rootToDisplace, displacedRoot);
    await reapHistoryQuarantines(appDataDir, store);

    expect(cleanupState).toBe('pending');
    expect(diagnostic).toMatch(/root|anchor|temporar|missing|unavailable/i);

    await rename(displacedRoot, rootToDisplace);
    await reapHistoryQuarantines(appDataDir, store);

    expect(cleanupState).toBe('cleaned');
    expect(diagnostic).toBe('');
    await expect(lstat(staged.quarantinePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('records a reaper diagnostic without deleting an identity-mismatched quarantine', async () => {
    const appDataDir = await temporaryDirectory('storydream-managed-reaper-mismatch-');
    const key = createManagedStorageKey();
    const originalPath = resolveManagedHistoryWorkDir(appDataDir, 'task', key);
    await mkdir(originalPath, { recursive: true });
    const staged = await stageManagedHistoryDirectory(appDataDir, 'task', key);
    if (!staged) throw new Error('Expected a staged directory.');
    await rm(staged.quarantinePath, { recursive: true });
    await mkdir(staged.quarantinePath);
    await writeFile(join(staged.quarantinePath, 'replacement.txt'), 'replacement', 'utf8');
    const tombstone = {
      family: 'task' as const,
      id: 'task-reaper-mismatch',
      managedStorageKey: key,
      cleanupState: 'pending',
      quarantineName: staged.quarantineName,
      quarantineIdentityJson: staged.quarantineIdentityJson,
      diagnostic: '',
      deletedAt: '2026-07-16T00:00:00.000Z',
    };
    const updateHistoryTombstoneCleanup = vi.fn(async () => tombstone);

    await reapHistoryQuarantines(appDataDir, {
      listPendingHistoryTombstones: async () => [tombstone],
      updateHistoryTombstoneCleanup,
    });

    expect(await readFile(join(staged.quarantinePath, 'replacement.txt'), 'utf8')).toBe('replacement');
    expect(updateHistoryTombstoneCleanup).toHaveBeenCalledWith(
      'task',
      tombstone.id,
      'pending',
      expect.stringMatching(/identity|changed/i),
    );
  });

  it('marks a pending ledger missing when its quarantine no longer exists', async () => {
    const appDataDir = await temporaryDirectory('storydream-managed-reaper-missing-');
    const key = createManagedStorageKey();
    await mkdir(managedHistoryFamilyRoot(appDataDir, 'task'), { recursive: true });
    const tombstone = {
      family: 'task' as const,
      id: 'task-reaper-missing',
      managedStorageKey: key,
      cleanupState: 'pending',
      quarantineName: testQuarantineName(key, 'f'.repeat(32)),
      quarantineIdentityJson: JSON.stringify({ version: 1, dev: '1', ino: '1' }),
      diagnostic: '',
      deletedAt: '2026-07-16T00:00:00.000Z',
    };
    const updateHistoryTombstoneCleanup = vi.fn(async () => tombstone);

    await reapHistoryQuarantines(appDataDir, {
      listPendingHistoryTombstones: async () => [tombstone],
      updateHistoryTombstoneCleanup,
    });

    expect(updateHistoryTombstoneCleanup).toHaveBeenCalledWith(
      'task',
      tombstone.id,
      'missing',
      expect.stringMatching(/missing|terminal/i),
    );
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

  it('never backfills legacy ownership through a linked app data root', async () => {
    const container = await temporaryDirectory('storydream-managed-legacy-app-link-');
    const outside = await temporaryDirectory('storydream-managed-legacy-app-link-outside-');
    const appDataDir = join(container, 'storydream-link');
    const legacyId = '11111111-1111-4111-8111-111111111111';
    await mkdir(join(outside, 'tasks', legacyId), { recursive: true });
    await symlink(outside, appDataDir, process.platform === 'win32' ? 'junction' : 'dir');
    const persist = vi.fn(async () => true);

    expect(await resolveLegacyManagedHistoryWorkDir(appDataDir, 'task', legacyId)).toBeNull();
    expect(await backfillLegacyManagedHistoryStorage(
      appDataDir,
      [{ family: 'task', id: legacyId, managedStorageKey: null }],
      persist,
    )).toBe(0);
    expect(persist).not.toHaveBeenCalled();
  });

  it('skips every case-insensitive legacy id collision before startup path resolution or persistence', async () => {
    const appDataDir = await temporaryDirectory('storydream-managed-legacy-id-collision-');
    const databaseFile = join(appDataDir, 'data.db');
    const database = await FileDatabase.open(databaseFile);
    const first = await database.createTask({ title: 'First legacy id owner', inputText: 'first' });
    const second = await database.createTask({ title: 'Second legacy id owner', inputText: 'second' });
    await database.close();
    const firstLegacyId = 'CaseLegacyOwner123456';
    const secondLegacyId = firstLegacyId.toLowerCase();
    await rewriteTaskIdsWithNullManagedKeys(databaseFile, [
      [first.id, firstLegacyId],
      [second.id, secondLegacyId],
    ]);
    await mkdir(join(managedHistoryFamilyRoot(appDataDir, 'task'), firstLegacyId), { recursive: true });

    const reopened = await FileDatabase.open(databaseFile);
    const candidates = await reopened.listMissingManagedStorageKeys();
    const persist = vi.fn((family: HistoryFamily, id: string, managedStorageKey: string) => (
      reopened.backfillManagedStorageKey(family, id, managedStorageKey)
    ));
    const migrated = await backfillLegacyManagedHistoryStorage(appDataDir, candidates, persist);

    expect(migrated).toBe(0);
    expect(persist).not.toHaveBeenCalled();
    expect((await reopened.getTaskDetail(firstLegacyId))?.managedStorageKey).toBeNull();
    expect((await reopened.getTaskDetail(secondLegacyId))?.managedStorageKey).toBeNull();
    await reopened.close();
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

  it('reaps pending managed quarantines before publishing the startup database instance', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const getDatabase = sourceSection(main, 'async function getDb', 'async function runHistoryGovernanceMutation');
    expectSourceOrder(getDatabase, [
      'FileDatabase.open',
      'backfillLegacyManagedHistoryStorage(',
      'reapHistoryQuarantines(dir, database)',
      'service.migrateLegacySecrets()',
      'db = database',
    ]);
  });

  it('single-flights database startup and makes shutdown wait for an unpublished initializer', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const startup = sourceSection(main, 'async function getDb', 'async function runHistoryGovernanceMutation');
    const shutdown = sourceSection(main, 'async function shutdownApplication', 'if (isPrimaryInstance)');

    expect(main).toContain('let dbInitializationPromise: Promise<FileDatabase> | null = null;');
    expectSourceOrder(startup, [
      'if (db) return db',
      'if (isShuttingDown)',
      'dbInitializationPromise ??= initializeDatabase()',
    ]);
    expect(startup).toContain('dbInitializationPromise ??= initializeDatabase()');
    expect(startup).toContain('return await initialization');
    expect(startup.match(/reapHistoryQuarantines\(dir, database\)/gu)).toHaveLength(1);
    expectSourceOrder(startup, [
      'async function initializeDatabase()',
      'FileDatabase.open',
      'reapHistoryQuarantines(dir, database)',
      'DATABASE_INITIALIZATION_CANCELLED',
      'db = database',
    ]);
    expectSourceOrder(shutdown, [
      'isShuttingDown = true',
      'const databaseInitialization = dbInitializationPromise',
      'await databaseInitialization.catch(() => undefined)',
      'const database = db',
      'await database.close()',
    ]);
  });

  it('orchestrates permanent deletion from the narrow canonical key without consulting stored artifact paths', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const deletion = sourceSection(main, 'async function deleteHistoryPermanently', 'async function getConfigService');
    expectSourceOrder(deletion, [
      'database.getHistoryDeletionTarget(family, id)',
      'if (target.tombstone)',
      'deleteManagedHistoryWithQuarantine(',
      'target.managedStorageKey',
    ]);
    expect(deletion).toContain('database.updateHistoryTombstoneCleanup(family, id, cleanupState, diagnostic)');
    for (const forbidden of ['database.getState()', 'outputDir', 'draftDir', 'artifactStatePath', 'resultPath', 'videoPath', 'imagePath', 'audioPath']) {
      expect(deletion).not.toContain(forbidden);
    }

    const handlers = sourceSection(main, "trustedHandle('task:archive'", "trustedHandle('prompt-template:list'");
    for (const [channel, family] of [
      ['task:delete', 'task'],
      ['viral:delete', 'viral-analysis'],
      ['image-lab:delete', 'image-lab'],
      ['voice-lab:delete', 'voice-lab'],
    ] as const) {
      expect(handlers).toContain(`trustedHandle('${channel}'`);
      expect(handlers).toContain(`deleteHistoryPermanently(database, '${family}', id)`);
    }
    expect(handlers.match(/deleteHistoryPermanently\(database,/gu)).toHaveLength(4);
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
      'const existingControlRun = runningTasks.get',
      'requestTaskRunIntent(',
      'const database = await getDb()',
      'const task = state.tasks.find',
      "const workDir = input.status === 'running' ? taskWorkDir(task) : null",
    ]);
    expect(taskStatus).toContain('resumeTaskRun(database, task, workDir, isCurrent, transferReservation)');

    expectSourceOrder(taskRetry, [
      'const existingRunAtEntry = runningTasks.get',
      'requestTaskRunIntent(',
      'const database = await getDb()',
      'const task = state.tasks.find',
      'const workDir = taskWorkDir(task)',
    ]);
    expect(taskRetry).toContain('resumeTaskRun(database, task, workDir, isCurrent, transferReservation)');

    expectSourceOrder(viralStatus, [
      'const record = state.viralAnalyses.find',
      'const workDir = viralAnalysisWorkDir(record)',
      'resumeViralAnalysisRun(database, record, workDir, isCurrent, transferReservation)',
    ]);
    expectSourceOrder(viralRetry, [
      'const record = state.viralAnalyses.find',
      'const workDir = viralAnalysisWorkDir(record)',
      'resumeViralAnalysisRun(database, record, workDir, isCurrent, transferReservation)',
    ]);

    expect(startTask).toContain('function startTaskRun(');
    expect(startTask).toContain('activityReservation: HistoryActivityReservation');
    expect(startTask).toContain('startStandardTaskRun(database, task, workDir, activityReservation)');
    expect(startTask).toContain('startHtmlVideoTaskRun(database, task, workDir, activityReservation)');
    expect(startTask).toContain('async function resumeTaskRun(');
    expect(startTask).toContain('workDir: string,');
    expect(startTask).not.toContain('taskWorkDir(task)');
    expect(runHtml).toContain('workDir: string,');
    expect(runHtml).not.toContain('taskWorkDir(task)');
    expect(viralRuntime).toContain('function startViralAnalysisRun(');
    expect(viralRuntime).toContain('activityReservation: HistoryActivityReservation');
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
        'stopTaskRunBeforeArtifactMutation(',
        'const database = await getDb()',
        'const task = state.tasks.find',
        'const workDir = taskWorkDir(task)',
        'if (!task.artifactStatePath)',
        `${mutation}(`,
      ]);
      expect(handler.match(/taskWorkDir\(task\)/gu)).toHaveLength(1);
      if (resumes) {
        expect(handler).toContain('outputDir: workDir');
        expect(handler).toContain('resumeLatestTaskRun(database, task.id, workDir, isCurrent, transferReservation)');
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
    const workDirHelpers = sourceSection(main, 'function taskWorkDir', 'function appDataDir');
    expect(workDirHelpers).toContain("resolveManagedHistoryWorkDir(appDataDir(), 'task', task.managedStorageKey)");
    expect(workDirHelpers).toContain("resolveManagedHistoryWorkDir(appDataDir(), 'viral-analysis', record.managedStorageKey)");
    expect(workDirHelpers).toContain("resolveManagedHistoryWorkDir(appDataDir(), 'image-lab', record.managedStorageKey)");
    expect(workDirHelpers).toContain("resolveManagedHistoryWorkDir(appDataDir(), 'voice-lab', record.managedStorageKey)");
    expect(workDirHelpers).not.toContain("'tasks', task.id");
    expect(workDirHelpers).not.toContain("'viral-analyses', record.id");
    expect(workDirHelpers).not.toContain("'image-lab', id");
    expect(workDirHelpers).not.toContain("'voice-lab', id");
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

async function rewriteTaskIdsWithNullManagedKeys(
  file: string,
  records: Array<[currentId: string, legacyId: string]>,
): Promise<void> {
  const SQL = await initSqlJs();
  const database = new SQL.Database(await readFile(file));
  try {
    for (const [currentId, legacyId] of records) {
      database.run('UPDATE tasks SET id = ?, managed_storage_key = NULL WHERE id = ?', [legacyId, currentId]);
    }
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

function testQuarantineName(managedStorageKey: string, token: string): string {
  const keyHash = createHash('sha256').update(managedStorageKey, 'utf8').digest('hex');
  return `.history.${keyHash}.${token}.quarantine`;
}
