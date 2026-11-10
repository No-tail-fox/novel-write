import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileDatabase } from '../src/shared/storage';
import { ConfigService } from '../electron/config-service';
import { DATABASE_RECOVERY_NOTICE_KEY, formatDatabaseRecoveryNotice, shouldShowDatabaseRecoveryNotice } from '../src/shared/database-recovery';

const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function tempDir() { const dir = await mkdtemp(join(tmpdir(), 'storydream-db-recovery-event-')); dirs.push(dir); return dir; }
const quietWarnings = () => vi.spyOn(console, 'warn').mockImplementation(() => undefined);

describe('malformed database recovery event (O-4)', () => {
  it('records the quarantined path, time and an empty-database outcome without deleting the original', async () => {
    const warn = quietWarnings();
    const dir = await tempDir(); const file = join(dir, 'data.db');
    await writeFile(file, 'not a sqlite database', 'utf8');
    const before = Date.now();
    const database = await FileDatabase.open(file);
    try {
      const event = database.getRecoveryEvent()!;
      expect(event).toMatchObject({ kind: 'malformed-database', tempRecovered: false });
      expect(event.quarantinedPath.startsWith(join(dir, 'data.db.'))).toBe(true);
      expect(event.quarantinedPath.endsWith('.malformed')).toBe(true);
      expect(Date.parse(event.detectedAt)).toBeGreaterThanOrEqual(before - 1000);
      expect(await readFile(event.quarantinedPath, 'utf8')).toBe('not a sqlite database');
      expect((await database.getState()).tasks).toEqual([]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(event.quarantinedPath));
    } finally { await database.close(); }
    expect((await readdir(dir)).filter(name => name.endsWith('.malformed'))).toHaveLength(1);
  });

  it('marks tempRecovered when a validated temp snapshot replaced the malformed file', async () => {
    quietWarnings();
    const dir = await tempDir(); const file = join(dir, 'data.db');
    const seed = await FileDatabase.open(file);
    const task = await seed.createTask({ inputText: 'survives in temp' });
    await seed.close();
    await rename(file, `${file}.999-recovery.tmp`);
    await writeFile(file, 'corrupted primary', 'utf8');
    const database = await FileDatabase.open(file);
    try {
      expect(database.getRecoveryEvent()).toMatchObject({ kind: 'malformed-database', tempRecovered: true });
      expect((await database.getState()).tasks.map(item => item.id)).toContain(task.id);
      expect(await readFile(database.getRecoveryEvent()!.quarantinedPath, 'utf8')).toBe('corrupted primary');
    } finally { await database.close(); }
  });

  it('records nothing for a healthy or missing database', async () => {
    const dir = await tempDir(); const file = join(dir, 'data.db');
    const created = await FileDatabase.open(file);
    expect(created.getRecoveryEvent()).toBeNull();
    await created.close();
    const reopened = await FileDatabase.open(file);
    expect(reopened.getRecoveryEvent()).toBeNull();
    await reopened.close();
  });

  it('exposes the event through the bootstrap state only when it happened', async () => {
    quietWarnings();
    const dir = await tempDir(); const file = join(dir, 'data.db');
    await writeFile(file, 'broken', 'utf8');
    const vault = { load: async () => ({}), save: async () => undefined };
    const broken = await FileDatabase.open(file);
    try {
      const bootstrap = await new ConfigService({ database: broken, dataDir: dir, vault }).getBootstrapState(1);
      expect(bootstrap.databaseRecovery).toEqual(broken.getRecoveryEvent());
      expect(bootstrap.databaseRecovery?.tempRecovered).toBe(false);
    } finally { await broken.close(); }
    const healthy = await FileDatabase.open(file);
    try {
      const bootstrap = await new ConfigService({ database: healthy, dataDir: dir, vault }).getBootstrapState(2);
      expect(bootstrap).not.toHaveProperty('databaseRecovery');
    } finally { await healthy.close(); }
  });

  it('formats a Chinese one-time notice naming the quarantined file', () => {
    const event = { kind: 'malformed-database' as const, quarantinedPath: 'C:\\data\\data.db.1-x.malformed', detectedAt: '2026-11-10T00:00:00.000Z', tempRecovered: false };
    expect(formatDatabaseRecoveryNotice(event)).toBe('数据库文件损坏，已隔离到 C:\\data\\data.db.1-x.malformed，并新建了空数据库。原文件未删除，可联系支持恢复。');
    expect(formatDatabaseRecoveryNotice({ ...event, tempRecovered: true })).toContain('临时文件恢复数据');
    expect(shouldShowDatabaseRecoveryNotice(event, null)).toBe(true);
    expect(shouldShowDatabaseRecoveryNotice(event, event.quarantinedPath)).toBe(false);
    expect(shouldShowDatabaseRecoveryNotice({ ...event, quarantinedPath: 'C:\\data\\data.db.2-y.malformed' }, event.quarantinedPath)).toBe(true);
    expect(shouldShowDatabaseRecoveryNotice(undefined, null)).toBe(false);
    expect(DATABASE_RECOVERY_NOTICE_KEY).toMatch(/database-recovery/);
  });
});
