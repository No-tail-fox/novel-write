import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { afterEach, describe, expect, it } from 'vitest';
import { FileDatabase } from '../src/shared/storage';

const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'script-migration-backup-'));
  directories.push(dir);
  return { dir, file: join(dir, 'data.db') };
}
async function backups(dir: string) { return (await readdir(dir)).filter(name => name.includes('.pre-script-proposals-') && name.endsWith('.bak')); }
async function legacy(file: string, missing = ['motion_comic_script_originals', 'motion_comic_script_proposals']) {
  const db = await FileDatabase.open(file);
  const task = await db.createTask({ inputText: 'legacy saved project' });
  await db.addTaskEvent(task.id, { type: 'checkpoint', detail: 'legacy saved event' });
  await db.close();
  const SQL = await initSqlJs();
  const old = new SQL.Database(await readFile(file));
  for (const table of missing) old.run(`DROP TABLE ${table}`);
  old.run('CREATE TABLE legacy_payload (value BLOB)');
  old.run('INSERT INTO legacy_payload VALUES (?)', [Uint8Array.from([0, 255, 7, 0, 99])]);
  await writeFile(file, old.export());
  old.close();
  return { task, bytes: await readFile(file) };
}

describe('script proposal migration disk backup', () => {
  it('backs up exact pre-migration bytes, preserves data, reopens once and permits restoring a copy', async () => {
    const { dir, file } = await fixture();
    const { task, bytes } = await legacy(file);
    const db = await FileDatabase.open(file);
    expect((await db.getState()).tasks).toEqual(expect.arrayContaining([expect.objectContaining({ id: task.id, inputText: 'legacy saved project' })]));
    await db.close();
    const names = await backups(dir);
    expect(names).toHaveLength(1);
    const backup = join(dir, names[0]);
    expect((await readFile(backup)).equals(bytes)).toBe(true);
    const SQL = await initSqlJs();
    const old = new SQL.Database(await readFile(backup));
    expect(old.exec("SELECT name FROM sqlite_master WHERE name IN ('motion_comic_script_originals', 'motion_comic_script_proposals')")).toEqual([]);
    expect(old.exec('SELECT value FROM legacy_payload')[0].values[0][0]).toEqual(Uint8Array.from([0, 255, 7, 0, 99]));
    old.close();
    const reopened = await FileDatabase.open(file);
    await reopened.close();
    expect(await backups(dir)).toEqual(names);
    expect((await readFile(backup)).equals(bytes)).toBe(true);
    // Restore a copy, never mutate the retained backup itself.
    const restoredFile = join(dir, 'restored.db');
    await writeFile(restoredFile, await readFile(backup));
    const restored = await FileDatabase.open(restoredFile);
    expect((await restored.getState()).events).toEqual(expect.arrayContaining([expect.objectContaining({ taskId: task.id, detail: 'legacy saved event' })]));
    await restored.close();
    expect((await readFile(backup)).equals(bytes)).toBe(true);
  });

  it.each(['motion_comic_script_originals', 'motion_comic_script_proposals'])('backs up when only %s is missing', async missing => {
    const { dir, file } = await fixture();
    const { bytes } = await legacy(file, [missing]);
    const db = await FileDatabase.open(file);
    await db.close();
    const names = await backups(dir);
    expect(names).toHaveLength(1);
    expect((await readFile(join(dir, names[0]))).equals(bytes)).toBe(true);
  });

  it.each(['reserve', 'write', 'replace'])('leaves the primary untouched if backup %s fails', async stage => {
    const { dir, file } = await fixture();
    const { bytes } = await legacy(file);
    let primaryReplaces = 0;
    await expect(FileDatabase.open(file, {
      writeTempFile: async (path, data) => {
        if ((stage === 'reserve' && path.endsWith('.bak')) || (stage === 'write' && path.includes('.bak.') && path.endsWith('.tmp'))) {
          throw Object.assign(new Error('backup denied'), { code: 'EACCES' });
        }
        await writeFile(path, data, { flag: 'wx', mode: 0o600 });
      },
      replaceFile: async (source, target) => {
        if (target === file) primaryReplaces += 1;
        if (stage === 'replace' && target.endsWith('.bak')) throw Object.assign(new Error('backup denied'), { code: 'EACCES' });
        await rename(source, target);
      },
    })).rejects.toThrow('backup denied');
    expect(primaryReplaces).toBe(0);
    expect((await readFile(file)).equals(bytes)).toBe(true);
    expect(await backups(dir)).toEqual([]);
    expect((await readdir(dir)).filter(name => name.endsWith('.tmp'))).toEqual([]);
    const retried = await FileDatabase.open(file);
    await retried.close();
    const names = await backups(dir);
    expect(names).toHaveLength(1);
    expect((await readFile(join(dir, names[0]))).equals(bytes)).toBe(true);
  });

  it('never overwrites or cleans a colliding reserved backup', async () => {
    const { file } = await fixture();
    const { bytes } = await legacy(file);
    let occupied = '';
    await expect(FileDatabase.open(file, {
      writeTempFile: async (path, data) => {
        if (path.endsWith('.bak')) { occupied = path; await writeFile(path, 'existing backup', { flag: 'wx' }); }
        await writeFile(path, data, { flag: 'wx' });
      },
    })).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(occupied, 'utf8')).toBe('existing backup');
    expect((await readFile(file)).equals(bytes)).toBe(true);
  });

  it('skips missing files and valid empty databases', async () => {
    const { dir, file } = await fixture();
    const fresh = await FileDatabase.open(file);
    await fresh.close();
    const SQL = await initSqlJs();
    const empty = new SQL.Database();
    empty.run('PRAGMA user_version = 1'); // Materialize a valid SQLite file without user tables.
    const emptyFile = join(dir, 'empty.db');
    await writeFile(emptyFile, empty.export());
    empty.close();
    const opened = await FileDatabase.open(emptyFile);
    await opened.close();
    expect(await backups(dir)).toEqual([]);
  });
});
