import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppConfig, AppState, CreateTaskInput, Task, TaskEvent } from '@shared/types';

interface StorageDependencies {
  readFile: (path: string) => Promise<Uint8Array>;
  writeTempFile: (path: string, data: Uint8Array) => Promise<void>;
  replaceFile: (source: string, target: string) => Promise<void>;
  removeFile: (path: string) => Promise<void>;
  ensureDirectory: (path: string) => Promise<void>;
  readDirectory: (path: string) => Promise<string[]>;
  delay: (milliseconds: number) => Promise<void>;
  createTempSuffix: () => string;
}

interface ReliableDatabase {
  createTask: (input: CreateTaskInput) => Promise<Task>;
  addTaskEvent: (taskId: string, input: { type: string; detail: string }) => Promise<TaskEvent>;
  updateTask: (id: string, patch: { status?: Task['status']; errorMessage?: string }) => Promise<void>;
  upsertConfig: (config: AppConfig) => Promise<void>;
  getState: () => Promise<AppState>;
  close: () => Promise<void>;
}

interface ReliabilityStorageModule {
  FileDatabase: {
    open: (file: string, dependencies?: Partial<StorageDependencies>) => Promise<ReliableDatabase>;
  };
  atomicWriteDatabase?: (
    file: string,
    data: Uint8Array,
    dependencies?: Partial<StorageDependencies>,
  ) => Promise<void>;
}

async function loadStorageModule(): Promise<ReliabilityStorageModule> {
  return import('../src/shared/storage') as unknown as Promise<ReliabilityStorageModule>;
}

function errno(code: string, message = code): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe('file database reliability', () => {
  it('exposes an injectable atomic database writer', async () => {
    const storage = await loadStorageModule();

    expect(storage.atomicWriteDatabase).toBeTypeOf('function');
    expect(storage.FileDatabase.open.length).toBeGreaterThanOrEqual(2);
  });

  it('serializes delayed concurrent mutations without losing an older or newer snapshot', async () => {
    const storage = await loadStorageModule();
    if (!storage.atomicWriteDatabase) return;
    const dir = await mkdtemp(join(tmpdir(), 'storydream-db-concurrent-'));
    const file = join(dir, 'app.db');
    let writeIndex = 0;
    try {
      const database = await storage.FileDatabase.open(file, {
        writeTempFile: async (path, data) => {
          writeIndex += 1;
          await wait(writeIndex % 3 === 0 ? 8 : 1);
          await writeFile(path, data, { flag: 'wx', mode: 0o600 });
        },
      });
      const task = await database.createTask({ inputText: 'concurrency' });

      await Promise.all(
        Array.from({ length: 50 }, (_, index) =>
          database.addTaskEvent(task.id, { type: 'tick', detail: String(index) }),
        ),
      );
      await database.close();

      const reopened = await storage.FileDatabase.open(file);
      const events = (await reopened.getState()).events.filter((event) => event.taskId === task.id && event.type === 'tick');
      expect(events).toHaveLength(50);
      expect(new Set(events.map((event) => event.detail))).toEqual(new Set(Array.from({ length: 50 }, (_, index) => String(index))));
      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('retries transient replace failures and removes the committed temp file', async () => {
    const storage = await loadStorageModule();
    if (!storage.atomicWriteDatabase) return;
    const dir = await mkdtemp(join(tmpdir(), 'storydream-db-replace-retry-'));
    const file = join(dir, 'app.db');
    let attempts = 0;
    try {
      await storage.atomicWriteDatabase(file, Uint8Array.from([1, 2, 3, 4]), {
        createTempSuffix: () => 'retry-case',
        delay: async () => undefined,
        replaceFile: async (source, target) => {
          attempts += 1;
          if (attempts < 3) throw errno('EPERM', 'temporarily locked');
          await rename(source, target);
        },
      });

      expect(attempts).toBe(3);
      expect([...await readFile(file)]).toEqual([1, 2, 3, 4]);
      expect((await readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('recovers a valid crash temp when the primary database is missing', async () => {
    const storage = await loadStorageModule();
    if (!storage.atomicWriteDatabase) return;
    const dir = await mkdtemp(join(tmpdir(), 'storydream-db-temp-recovery-'));
    const file = join(dir, 'app.db');
    const tempFile = `${file}.999-recovery.tmp`;
    try {
      const database = await storage.FileDatabase.open(file);
      const task = await database.createTask({ inputText: 'recover me' });
      await database.addTaskEvent(task.id, { type: 'checkpoint', detail: 'from temp' });
      await database.close();
      await rename(file, tempFile);

      const recovered = await storage.FileDatabase.open(file);
      expect((await recovered.getState()).events).toEqual(
        expect.arrayContaining([expect.objectContaining({ taskId: task.id, detail: 'from temp' })]),
      );
      await recovered.close();
      await expect(access(tempFile)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('preserves a valid crash temp when recovery replacement fails', async () => {
    const storage = await loadStorageModule();
    if (!storage.atomicWriteDatabase) return;
    const dir = await mkdtemp(join(tmpdir(), 'storydream-db-temp-recovery-failure-'));
    const file = join(dir, 'app.db');
    const tempFile = `${file}.999-recovery.tmp`;
    try {
      const database = await storage.FileDatabase.open(file);
      const task = await database.createTask({ inputText: 'preserve recovery temp' });
      await database.close();
      await rename(file, tempFile);

      await expect(
        storage.FileDatabase.open(file, {
          replaceFile: async (source, target) => {
            if (source === tempFile) throw errno('EACCES', 'recovery target denied');
            await rename(source, target);
          },
        }),
      ).rejects.toMatchObject({ code: 'EACCES' });
      await expect(access(tempFile)).resolves.toBeUndefined();

      const recovered = await storage.FileDatabase.open(file);
      expect((await recovered.getState()).tasks).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: task.id })]),
      );
      await recovered.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('creates on ENOENT but propagates EACCES instead of silently replacing the database', async () => {
    const storage = await loadStorageModule();
    if (!storage.atomicWriteDatabase) return;
    const dir = await mkdtemp(join(tmpdir(), 'storydream-db-open-errors-'));
    const file = join(dir, 'app.db');
    try {
      const created = await storage.FileDatabase.open(file);
      await created.close();
      await expect(access(file)).resolves.toBeUndefined();

      await expect(
        storage.FileDatabase.open(join(dir, 'denied.db'), {
          readFile: async () => {
            throw errno('EACCES', 'access denied');
          },
        }),
      ).rejects.toMatchObject({ code: 'EACCES' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('quarantines malformed SQLite and starts a valid replacement', async () => {
    const storage = await loadStorageModule();
    if (!storage.atomicWriteDatabase) return;
    const dir = await mkdtemp(join(tmpdir(), 'storydream-db-malformed-'));
    const file = join(dir, 'app.db');
    try {
      await writeFile(file, 'not a sqlite database', 'utf8');
      const database = await storage.FileDatabase.open(file);
      expect((await database.getState()).tasks).toEqual([]);
      await database.close();

      const names = await readdir(dir);
      expect(names.some((name) => name.startsWith('app.db.') && name.endsWith('.malformed'))).toBe(true);
      expect((await readFile(file)).byteLength).toBeGreaterThan(100);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rolls back a failed snapshot before allowing the next queued mutation', async () => {
    const storage = await loadStorageModule();
    if (!storage.atomicWriteDatabase) return;
    const dir = await mkdtemp(join(tmpdir(), 'storydream-db-failed-commit-'));
    const file = join(dir, 'app.db');
    let failNextReplace = false;
    try {
      const database = await storage.FileDatabase.open(file, {
        replaceFile: async (source, target) => {
          if (failNextReplace) {
            failNextReplace = false;
            throw errno('EIO', 'injected permanent replace failure');
          }
          await rename(source, target);
        },
      });
      const task = await database.createTask({ inputText: 'rollback' });
      failNextReplace = true;

      await expect(database.addTaskEvent(task.id, { type: 'failed', detail: 'must roll back' })).rejects.toThrow(/replace|persist|write|EIO/i);
      await database.addTaskEvent(task.id, { type: 'saved', detail: 'must remain' });
      await database.close();

      const reopened = await storage.FileDatabase.open(file);
      const details = (await reopened.getState()).events.map((event) => event.detail);
      expect(details).not.toContain('must roll back');
      expect(details).toContain('must remain');
      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('waits for accepted commits during close, rejects new writes, and closes only once', async () => {
    const storage = await loadStorageModule();
    if (!storage.atomicWriteDatabase) return;
    const dir = await mkdtemp(join(tmpdir(), 'storydream-db-close-'));
    const file = join(dir, 'app.db');
    let blockNextReplace = false;
    let releaseReplace!: () => void;
    let enteredReplace!: () => void;
    const replaceEntered = new Promise<void>((resolve) => { enteredReplace = resolve; });
    const replaceReleased = new Promise<void>((resolve) => { releaseReplace = resolve; });
    try {
      const database = await storage.FileDatabase.open(file, {
        replaceFile: async (source, target) => {
          if (blockNextReplace) {
            blockNextReplace = false;
            enteredReplace();
            await replaceReleased;
          }
          await rename(source, target);
        },
      });
      const task = await database.createTask({ inputText: 'close waits' });
      blockNextReplace = true;
      const pending = database.addTaskEvent(task.id, { type: 'pending-close', detail: 'committed before close' });
      await replaceEntered;

      let closeSettled = false;
      const closing = database.close().then(() => { closeSettled = true; });
      await wait(10);
      expect(closeSettled).toBe(false);
      await expect(database.addTaskEvent(task.id, { type: 'too-late', detail: 'reject me' })).rejects.toThrow(/closing|closed/i);

      releaseReplace();
      await pending;
      await Promise.all([closing, database.close()]);

      const reopened = await storage.FileDatabase.open(file);
      const details = (await reopened.getState()).events.map((event) => event.detail);
      expect(details).toContain('committed before close');
      expect(details).not.toContain('reject me');
      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not expose an in-memory mutation before its snapshot is committed', async () => {
    const storage = await loadStorageModule();
    if (!storage.atomicWriteDatabase) return;
    const dir = await mkdtemp(join(tmpdir(), 'storydream-db-read-barrier-'));
    const file = join(dir, 'app.db');
    let blockNextReplace = false;
    let releaseReplace!: () => void;
    let enteredReplace!: () => void;
    const replaceEntered = new Promise<void>((resolve) => { enteredReplace = resolve; });
    const replaceReleased = new Promise<void>((resolve) => { releaseReplace = resolve; });
    try {
      const database = await storage.FileDatabase.open(file, {
        replaceFile: async (source, target) => {
          if (blockNextReplace) {
            blockNextReplace = false;
            enteredReplace();
            await replaceReleased;
          }
          await rename(source, target);
        },
      });
      const task = await database.createTask({ inputText: 'read barrier' });
      blockNextReplace = true;
      const pending = database.addTaskEvent(task.id, { type: 'pending-read', detail: 'commit first' });
      await replaceEntered;

      let readSettled = false;
      const statePromise = database.getState().then((state) => {
        readSettled = true;
        return state;
      });
      await wait(10);
      try {
        expect(readSettled).toBe(false);
      } finally {
        releaseReplace();
      }

      await pending;
      expect((await statePromise).events).toEqual(
        expect.arrayContaining([expect.objectContaining({ taskId: task.id, detail: 'commit first' })]),
      );
      await database.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('coordinates Electron shutdown before allowing the app to quit', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const beforeQuit = main.slice(main.indexOf("app.on('before-quit'"));

    expect(beforeQuit).toContain('event.preventDefault()');
    expect(main).toContain('shutdownPromise');
    expect(main).toContain('completion: Promise<void>');
    expect(main).toContain('isShuttingDown');
    expect(main).toContain('controller.abort');
    expect(main).toContain('Promise.allSettled');
    expect(main).toContain('await database.close()');
  });
});
