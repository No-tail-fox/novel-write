import { createHash } from 'node:crypto';
import { readFile, rename, rm, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileDatabase } from '@shared/storage';

const createdDirectories: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(createdDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createDatabase(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  createdDirectories.push(directory);
  const file = join(directory, 'app.db');
  return { directory, file, db: await FileDatabase.open(file) };
}

async function mutateDatabase(file: string, sql: string, params: Array<string | number | null> = []): Promise<void> {
  const SQL = await initSqlJs();
  const database = new SQL.Database(await readFile(file));
  try {
    database.run(sql, params);
    await writeFile(file, database.export());
  } finally {
    database.close();
  }
}

async function sqliteSchema(file: string): Promise<string> {
  const SQL = await initSqlJs();
  const database = new SQL.Database(await readFile(file));
  try {
    return database.exec("SELECT type || ':' || name || ':' || coalesce(sql, '') FROM sqlite_master ORDER BY type, name")
      .flatMap((result) => result.values)
      .flat()
      .join('\n');
  } finally {
    database.close();
  }
}

async function queryDatabase<T extends Record<string, unknown>>(
  file: string,
  sql: string,
  params: Array<string | number | null> = [],
): Promise<T[]> {
  const SQL = await initSqlJs();
  const database = new SQL.Database(await readFile(file));
  const statement = database.prepare(sql, params);
  try {
    const rows: T[] = [];
    while (statement.step()) rows.push(statement.getAsObject() as T);
    return rows;
  } finally {
    statement.free();
    database.close();
  }
}

async function createGovernedRecords(db: FileDatabase) {
  const task = await db.createTask({ title: 'Governed task', inputText: 'task input', taskType: 'story' });
  await db.updateTask(task.id, { status: 'completed' });
  const viral = await db.createViralAnalysis({
    title: 'Governed viral analysis',
    url: 'https://example.test/governed',
    settings: { track: 'story', style: 'photo-real', ratio: '9:16', templateId: 'portrait' },
  });
  await db.updateViralAnalysis(viral.id, { status: 'completed' });
  const image = await db.addImageLabRecord({
    prompt: 'governed image',
    ratio: '9:16',
    style: 'photo-real',
    provider: 'mock',
    status: 'generated',
  });
  const voice = await db.addVoiceLabRecord({
    text: 'governed voice',
    provider: 'mock',
    voiceId: 'voice-governed',
    speed: 1,
  });
  const [storedTask, storedViral] = await Promise.all([
    db.getTaskDetail(task.id),
    db.getViralAnalysisDetail(viral.id),
  ]);
  if (!storedTask || !storedViral) throw new Error('Governed fixture did not persist canonical records.');
  return { task: storedTask, viral: storedViral, image, voice };
}

function managedCleanup(managedStorageKey: string | null | undefined, identity = '1') {
  if (!managedStorageKey) throw new Error('Expected a managed storage key in the governed test fixture.');
  const keyHash = createHash('sha256').update(managedStorageKey, 'utf8').digest('hex');
  return {
    cleanupState: 'pending' as const,
    quarantineName: `.history.${keyHash}.${identity.padStart(32, '0')}.quarantine`,
    quarantineIdentityJson: JSON.stringify({ version: 1, dev: identity, ino: identity }),
    diagnostic: '',
  };
}

const missingCleanup = {
  cleanupState: 'missing' as const,
  quarantineName: null,
  quarantineIdentityJson: '{}',
  diagnostic: 'Managed history directory was already missing; no filesystem cleanup was required.',
};

describe('history governance storage', () => {
  it('migrates every governed family with archive/key columns, stable indexes, and tombstones', async () => {
    const { db, file } = await createDatabase('storydream-history-schema-');
    await db.close();

    const schema = await sqliteSchema(file);
    for (const table of ['tasks', 'viral_analyses', 'image_lab_records', 'voice_lab_records']) {
      expect(schema).toMatch(new RegExp(`table:${table}:[\\s\\S]*?archived_at`, 'u'));
      expect(schema).toMatch(new RegExp(`table:${table}:[\\s\\S]*?managed_storage_key`, 'u'));
    }
    expect(schema).toContain('table:history_tombstones:');
    const tombstoneStart = schema.indexOf('table:history_tombstones:');
    const tombstoneEnd = schema.indexOf('\ntable:', tombstoneStart + 1);
    const tombstoneSchema = schema.slice(tombstoneStart, tombstoneEnd);
    for (const column of [
      'family',
      'entity_id',
      'managed_storage_key',
      'cleanup_state',
      'quarantine_name',
      'quarantine_identity_json',
      'diagnostic',
      'deleted_at',
    ]) {
      expect(tombstoneSchema).toMatch(new RegExp(`\\b${column}\\b`, 'u'));
    }
    for (const index of [
      'idx_tasks_active_history',
      'idx_tasks_archived_history',
      'idx_viral_analyses_active_history',
      'idx_viral_analyses_archived_history',
      'idx_image_lab_records_active_history',
      'idx_image_lab_records_archived_history',
      'idx_voice_lab_records_active_history',
      'idx_voice_lab_records_archived_history',
      'idx_tasks_managed_storage_key',
      'idx_viral_analyses_managed_storage_key',
      'idx_image_lab_records_managed_storage_key',
      'idx_voice_lab_records_managed_storage_key',
    ]) {
      expect(schema).toContain(`index:${index}:`);
    }
    expect(await readFile(new URL('../src/shared/storage.ts', import.meta.url), 'utf8')).toContain('COUNT(*) AS total_count');
  });

  it('rejects case-insensitive managed key collisions within a family but permits the same key across families', async () => {
    const { db, file } = await createDatabase('storydream-history-key-collision-');
    const first = await db.createTask({ title: 'First owner', inputText: 'first' });
    const second = await db.createTask({ title: 'Second owner', inputText: 'second' });
    const image = await db.addImageLabRecord({ prompt: 'Other family', ratio: '9:16', style: 'photo-real', provider: 'mock' });
    await db.close();
    await mutateDatabase(file, 'UPDATE tasks SET managed_storage_key = NULL WHERE id IN (?, ?)', [first.id, second.id]);
    await mutateDatabase(file, 'UPDATE image_lab_records SET managed_storage_key = NULL WHERE id = ?', [image.id]);

    const reopened = await FileDatabase.open(file);
    expect(await reopened.backfillManagedStorageKey('task', first.id, 'CaseSensitiveLegacyKey')).toBe(true);
    expect(await reopened.backfillManagedStorageKey('task', second.id, 'casesensitivelegacykey')).toBe(false);
    expect(await reopened.backfillManagedStorageKey('image-lab', image.id, 'casesensitivelegacykey')).toBe(true);
    expect((await reopened.getTaskDetail(first.id))?.managedStorageKey).toBe('CaseSensitiveLegacyKey');
    expect((await reopened.getTaskDetail(second.id))?.managedStorageKey).toBeNull();
    expect((await reopened.getImageLabRecordDetail(image.id))?.managedStorageKey).toBe('casesensitivelegacykey');
    await reopened.close();
  });

  it('refuses every single-row backfill for case-insensitive business id collisions', async () => {
    const { db, file } = await createDatabase('storydream-history-id-collision-');
    const first = await db.createTask({ title: 'First legacy id owner', inputText: 'first' });
    const second = await db.createTask({ title: 'Second legacy id owner', inputText: 'second' });
    await db.close();
    const firstLegacyId = 'CaseLegacyOwner123456';
    const secondLegacyId = firstLegacyId.toLowerCase();
    await mutateDatabase(file, 'UPDATE tasks SET id = ?, managed_storage_key = NULL WHERE id = ?', [firstLegacyId, first.id]);
    await mutateDatabase(file, 'UPDATE tasks SET id = ?, managed_storage_key = NULL WHERE id = ?', [secondLegacyId, second.id]);

    const reopened = await FileDatabase.open(file);
    expect(await reopened.backfillManagedStorageKey('task', firstLegacyId, firstLegacyId)).toBe(false);
    expect(await reopened.backfillManagedStorageKey('task', secondLegacyId, secondLegacyId)).toBe(false);
    expect((await reopened.getTaskDetail(firstLegacyId))?.managedStorageKey).toBeNull();
    expect((await reopened.getTaskDetail(secondLegacyId))?.managedStorageKey).toBeNull();
    await reopened.close();
  });

  it('downgrades every ambiguous case-insensitive legacy key owner before creating unique indexes', async () => {
    const { db, file } = await createDatabase('storydream-history-key-migration-');
    const first = await db.createTask({ title: 'First legacy owner', inputText: 'first' });
    const second = await db.createTask({ title: 'Second legacy owner', inputText: 'second' });
    const unique = await db.createTask({ title: 'Unique legacy owner', inputText: 'unique' });
    await db.close();
    await mutateDatabase(file, 'DROP INDEX IF EXISTS idx_tasks_managed_storage_key');
    await mutateDatabase(file, 'UPDATE tasks SET managed_storage_key = ? WHERE id = ?', ['SharedLegacyKey', first.id]);
    await mutateDatabase(file, 'UPDATE tasks SET managed_storage_key = ? WHERE id = ?', ['sharedlegacykey', second.id]);
    await mutateDatabase(file, 'UPDATE tasks SET managed_storage_key = ? WHERE id = ?', ['UniqueLegacyKey', unique.id]);

    const reopened = await FileDatabase.open(file);
    expect((await reopened.getTaskDetail(first.id))?.managedStorageKey).toBeNull();
    expect((await reopened.getTaskDetail(second.id))?.managedStorageKey).toBeNull();
    expect((await reopened.getTaskDetail(unique.id))?.managedStorageKey).toBe('UniqueLegacyKey');
    await reopened.close();
    expect(await sqliteSchema(file)).toContain('index:idx_tasks_managed_storage_key:');
  });

  it('migrates persisted Task 5 tombstones without losing cleanup ownership or deletion time', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'storydream-history-legacy-tombstones-'));
    createdDirectories.push(directory);
    const file = join(directory, 'app.db');
    const SQL = await initSqlJs();
    const legacy = new SQL.Database();
    try {
      legacy.run(`
        CREATE TABLE history_tombstones (
          family TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          managed_storage_key TEXT,
          deleted_at TEXT NOT NULL,
          PRIMARY KEY (family, entity_id)
        )
      `);
      legacy.run(
        'INSERT INTO history_tombstones (family, entity_id, managed_storage_key, deleted_at) VALUES (?, ?, ?, ?)',
        ['task', 'legacy-unmanaged', null, '2026-05-01T00:00:00.000Z'],
      );
      legacy.run(
        'INSERT INTO history_tombstones (family, entity_id, managed_storage_key, deleted_at) VALUES (?, ?, ?, ?)',
        ['image-lab', 'legacy-managed', 'legacy-managed-key', '2026-05-02T00:00:00.000Z'],
      );
      await writeFile(file, legacy.export());
    } finally {
      legacy.close();
    }

    const migrated = await FileDatabase.open(file);
    await migrated.close();

    const reopened = await FileDatabase.open(file);
    const unmanaged = await reopened.deleteTaskPermanently('legacy-unmanaged');
    expect(unmanaged).toMatchObject({
      managedStorageKey: null,
      cleanupState: 'unmanaged-legacy',
      quarantineName: null,
      quarantineIdentityJson: '{}',
      deletedAt: '2026-05-01T00:00:00.000Z',
    });
    expect(unmanaged.diagnostic.trim()).not.toBe('');

    expect(await reopened.deleteImageLabRecordPermanently('legacy-managed')).toEqual({
      family: 'image-lab',
      id: 'legacy-managed',
      managedStorageKey: 'legacy-managed-key',
      cleanupState: 'pending',
      quarantineName: null,
      quarantineIdentityJson: '{}',
      diagnostic: '',
      deletedAt: '2026-05-02T00:00:00.000Z',
    });
    await reopened.close();
  });

  it('returns stable task pages with exact totals and canonical status cursor binding', async () => {
    const { db } = await createDatabase('storydream-history-task-pages-');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00.000Z'));
    const tasks = await Promise.all([
      db.createTask({ title: 'Running one', inputText: 'one', taskType: 'story' }),
      db.createTask({ title: 'Paused one', inputText: 'two', taskType: 'story' }),
      db.createTask({ title: 'Completed one', inputText: 'three', taskType: 'story' }),
    ]);
    await Promise.all([
      db.updateTask(tasks[0].id, { status: 'running' }),
      db.updateTask(tasks[1].id, { status: 'paused' }),
      db.updateTask(tasks[2].id, { status: 'completed' }),
    ]);

    const first = await db.listTaskSummaries({
      filter: 'active',
      statuses: ['running', 'paused'],
      limit: 1,
    });
    const second = await db.listTaskSummaries({
      filter: 'active',
      statuses: ['paused', 'running'],
      cursor: first.nextCursor,
      limit: 1,
    });

    expect(first).toMatchObject({ family: 'task', totalCount: 2, hasMore: true });
    expect(first.hasMore).toBe(first.nextCursor !== null);
    expect(second.hasMore).toBe(second.nextCursor !== null);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(2);
    expect([...first.items, ...second.items].map((item) => item.id)).toEqual(
      [...first.items, ...second.items].map((item) => item.id).sort().reverse(),
    );

    const cursorPayload = Buffer.from(first.nextCursor ?? '', 'base64url').toString('utf8');
    expect(cursorPayload).toContain('task');
    expect(cursorPayload).not.toContain('Running one');

    await expect(db.listTaskSummaries({ filter: 'active', status: 'running', cursor: first.nextCursor })).rejects.toThrow('CURSOR_INVALID');
    await expect(db.listTaskSummaries({ filter: 'archived', statuses: ['running', 'paused'], cursor: first.nextCursor })).rejects.toThrow('CURSOR_INVALID');
    await expect(db.listTaskSummaries({ filter: 'active', statuses: ['running', 'paused'], taskType: 'story', cursor: first.nextCursor })).rejects.toThrow('CURSOR_INVALID');
    await expect(db.listTaskSummaries({ filter: 'active', statuses: ['running', 'paused'], query: 'changed', cursor: first.nextCursor })).rejects.toThrow('CURSOR_INVALID');
    await db.close();
  });

  it('searches complete persisted fields and treats LIKE metacharacters literally', async () => {
    const { db } = await createDatabase('storydream-history-search-');
    const tailToken = 'needle-after-preview';
    const literalToken = String.raw`100%_literal\\path`;
    await db.createTask({
      title: 'Deep task',
      inputText: `${'x'.repeat(220)} ${tailToken}`,
      aiKeyword: 'keyword-only-token',
      taskType: 'story',
    });
    await db.createTask({ title: literalToken, inputText: 'literal holder', taskType: 'story' });
    await db.createTask({ title: '100XXliteral/path', inputText: 'wildcard lookalike', taskType: 'story' });

    const byTail = await db.listTaskSummaries({ filter: 'active', query: tailToken });
    const byKeyword = await db.listTaskSummaries({ filter: 'active', query: 'keyword-only-token' });
    const byLiteral = await db.listTaskSummaries({ filter: 'active', query: literalToken });
    expect(byTail.items).toHaveLength(1);
    expect(byTail.items[0]).not.toHaveProperty('inputText');
    expect(byTail.items[0].inputPreview).not.toContain(tailToken);
    expect(byKeyword.items).toHaveLength(1);
    expect(byLiteral.items.map((item) => item.title)).toEqual([literalToken]);

    const viral = await db.createViralAnalysis({
      title: 'Viral searchable title',
      url: 'https://example.test/full-url-token',
      platform: 'douyin',
      settings: { track: 'story', style: 'photo-real', ratio: '9:16', templateId: 'portrait' },
    });
    const image = await db.addImageLabRecord({
      prompt: `${'p'.repeat(220)} image-tail-token`,
      ratio: '9:16',
      style: 'searchable-style',
      provider: 'custom-provider',
    });
    const voice = await db.addVoiceLabRecord({
      text: `${'v'.repeat(220)} voice-tail-token`,
      provider: 'mock',
      voiceId: 'voice-id',
      voiceLabel: 'searchable-voice-label',
      speed: 1,
    });
    expect((await db.listViralAnalyses({ filter: 'active', query: 'full-url-token' })).items.map((item) => item.id)).toEqual([viral.id]);
    expect((await db.listViralAnalyses({ filter: 'active', query: 'douyin' })).items.map((item) => item.id)).toEqual([viral.id]);
    expect((await db.listImageLabRecords({ filter: 'active', query: 'image-tail-token' })).items.map((item) => item.id)).toEqual([image.id]);
    expect((await db.listImageLabRecords({ filter: 'active', query: 'searchable-style' })).items.map((item) => item.id)).toEqual([image.id]);
    expect((await db.listVoiceLabRecords({ filter: 'active', query: 'voice-tail-token' })).items.map((item) => item.id)).toEqual([voice.id]);
    expect((await db.listVoiceLabRecords({ filter: 'active', query: 'searchable-voice-label' })).items.map((item) => item.id)).toEqual([voice.id]);
    await db.close();
  });

  it('binds cursors to family, status, filter, task type, and query fingerprint', async () => {
    const { db } = await createDatabase('storydream-history-cursors-');
    await Promise.all([
      db.createTask({ title: 'Cursor task 1', inputText: 'cursor search', taskType: 'story' }),
      db.createTask({ title: 'Cursor task 2', inputText: 'cursor search', taskType: 'story' }),
      db.createViralAnalysis({
        title: 'Cursor viral',
        url: 'https://example.test/cursor',
        settings: { track: 'story', style: 'photo-real', ratio: '9:16', templateId: 'portrait' },
      }),
    ]);
    const first = await db.listTaskSummaries({ filter: 'active', taskType: 'story', query: 'cursor search', limit: 1 });
    expect(first.nextCursor).not.toBeNull();

    await expect(db.listTaskSummaries({ filter: 'active', taskType: 'music-mv', query: 'cursor search', cursor: first.nextCursor })).rejects.toThrow('CURSOR_INVALID');
    await expect(db.listTaskSummaries({ filter: 'active', taskType: 'story', query: 'cursor changed', cursor: first.nextCursor })).rejects.toThrow('CURSOR_INVALID');
    await expect(db.listViralAnalyses({ filter: 'active', cursor: first.nextCursor })).rejects.toThrow('CURSOR_INVALID');
    await db.close();
  });

  it('normalizes legacy task types without disguising unknown non-empty values', async () => {
    const { db, file } = await createDatabase('storydream-history-task-types-');
    const valid = await db.createTask({ title: 'Valid legacy', inputText: 'valid' });
    const fallback = await db.createTask({ title: 'Fallback legacy', inputText: 'fallback', taskKind: 'music-mv' });
    const unknown = await db.createTask({ title: 'Unknown legacy', inputText: 'unknown' });
    await db.close();
    await mutateDatabase(file, 'UPDATE tasks SET task_type = ? WHERE id = ?', ['  html-video  ', valid.id]);
    await mutateDatabase(file, 'UPDATE tasks SET task_type = ? WHERE id = ?', ['   ', fallback.id]);
    await mutateDatabase(file, 'UPDATE tasks SET task_type = ? WHERE id = ?', ['legacy-special', unknown.id]);

    const reopened = await FileDatabase.open(file);
    expect((await reopened.getTaskDetail(valid.id))?.taskType).toBe('html-video');
    expect((await reopened.getTaskDetail(fallback.id))?.taskType).toBe('music-mv');
    expect((await reopened.getTaskDetail(unknown.id))?.taskType).toBe('legacy-special');
    expect((await reopened.listTaskSummaries({ filter: 'active' })).items.map((item) => item.id)).toContain(unknown.id);
    expect((await reopened.listTaskSummaries({ filter: 'active', taskType: 'story' })).items.map((item) => item.id)).not.toContain(unknown.id);
    expect((await reopened.listTaskSummaries({ filter: 'active', taskType: 'html-video' })).items.map((item) => item.id)).toEqual([valid.id]);
    expect((await reopened.listTaskSummaries({ filter: 'active', taskType: 'music-mv' })).items.map((item) => item.id)).toEqual([fallback.id]);
    await reopened.close();
  });

  it('orders archived pages by archived time and returns canonical ownership metadata', async () => {
    const { db, file } = await createDatabase('storydream-history-archive-');
    const task = await db.createTask({ title: 'Archived task', inputText: 'archive' });
    const viral = await db.createViralAnalysis({
      url: 'https://example.test/archive',
      settings: { track: 'story', style: 'photo-real', ratio: '9:16', templateId: 'portrait' },
    });
    const image = await db.addImageLabRecord({ prompt: 'archive image', ratio: '9:16', style: 'photo-real', provider: 'mock' });
    const voice = await db.addVoiceLabRecord({ text: 'archive voice', provider: 'mock', voiceId: 'voice', speed: 1 });
    for (const record of [task, viral, image, voice]) {
      expect(record.managedStorageKey).toMatch(/^[a-z0-9_-]{16,128}$/u);
      expect(record.managedStorageKey).not.toBe(record.id);
      expect(record.archivedAt).toBeNull();
    }
    expect(new Set([task, viral, image, voice].map((record) => record.managedStorageKey)).size).toBe(4);
    await db.close();

    for (const [table, id, archivedAt] of [
      ['tasks', task.id, '2026-06-01T00:00:00.000Z'],
      ['viral_analyses', viral.id, '2026-06-02T00:00:00.000Z'],
      ['image_lab_records', image.id, '2026-06-03T00:00:00.000Z'],
      ['voice_lab_records', voice.id, '2026-06-04T00:00:00.000Z'],
    ] as const) {
      await mutateDatabase(file, `UPDATE ${table} SET archived_at = ? WHERE id = ?`, [archivedAt, id]);
    }

    const reopened = await FileDatabase.open(file);
    const pages = await Promise.all([
      reopened.listTaskSummaries({ filter: 'archived' }),
      reopened.listViralAnalyses({ filter: 'archived' }),
      reopened.listImageLabRecords({ filter: 'archived' }),
      reopened.listVoiceLabRecords({ filter: 'archived' }),
    ]);
    expect(pages.map((page) => page.items.length)).toEqual([1, 1, 1, 1]);
    expect(pages.every((page) => page.totalCount === 1 && page.hasMore === false && page.nextCursor === null)).toBe(true);
    expect(pages.every((page) => page.items[0].archivedAt !== null && page.items[0].managedStorageKey !== null)).toBe(true);
    await reopened.close();
  });

  it('archives and restores every family idempotently without changing business status', async () => {
    const { db } = await createDatabase('storydream-history-lifecycle-');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-05T12:00:00.000Z'));
    const records = await createGovernedRecords(db);
    const lifecycles = [
      { record: records.task, archive: () => db.archiveTask(records.task.id), restore: () => db.restoreTask(records.task.id) },
      {
        record: records.viral,
        archive: () => db.archiveViralAnalysis(records.viral.id),
        restore: () => db.restoreViralAnalysis(records.viral.id),
      },
      {
        record: records.image,
        archive: () => db.archiveImageLabRecord(records.image.id),
        restore: () => db.restoreImageLabRecord(records.image.id),
      },
      {
        record: records.voice,
        archive: () => db.archiveVoiceLabRecord(records.voice.id),
        restore: () => db.restoreVoiceLabRecord(records.voice.id),
      },
    ] as const;

    for (const lifecycle of lifecycles) {
      vi.setSystemTime(new Date('2026-06-05T12:00:00.000Z'));
      const archived = await lifecycle.archive();
      expect(archived.archivedAt).toBe('2026-06-05T12:00:00.000Z');
      expect(archived.status).toBe(lifecycle.record.status);

      vi.setSystemTime(new Date('2026-06-05T13:00:00.000Z'));
      const archivedAgain = await lifecycle.archive();
      expect(archivedAgain.archivedAt).toBe(archived.archivedAt);
      expect(archivedAgain.status).toBe(archived.status);

      const restored = await lifecycle.restore();
      expect(restored.archivedAt).toBeNull();
      expect(restored.status).toBe(archived.status);
      expect(await lifecycle.restore()).toEqual(restored);
    }
    await db.close();
  });

  it('rejects task and viral archive or delete while pending or running and requires archive for every delete', async () => {
    const { db } = await createDatabase('storydream-history-active-rejection-');
    const task = await db.createTask({ title: 'Active task', inputText: 'active' });
    const viral = await db.createViralAnalysis({
      url: 'https://example.test/active',
      settings: { track: 'story', style: 'photo-real', ratio: '9:16', templateId: 'portrait' },
    });

    for (const operation of [
      () => db.archiveTask(task.id),
      () => db.deleteTaskPermanently(task.id),
      () => db.archiveViralAnalysis(viral.id),
      () => db.deleteViralAnalysisPermanently(viral.id),
    ]) {
      await expect(operation()).rejects.toThrow(/pending|running|active/i);
    }

    await db.updateTask(task.id, { status: 'running' });
    await db.updateViralAnalysis(viral.id, { status: 'running' });
    for (const operation of [
      () => db.archiveTask(task.id),
      () => db.deleteTaskPermanently(task.id),
      () => db.archiveViralAnalysis(viral.id),
      () => db.deleteViralAnalysisPermanently(viral.id),
    ]) {
      await expect(operation()).rejects.toThrow(/pending|running|active/i);
    }

    await db.updateTask(task.id, { status: 'completed' });
    await db.updateViralAnalysis(viral.id, { status: 'completed' });
    const image = await db.addImageLabRecord({ prompt: 'active image', ratio: '9:16', style: 'photo-real', provider: 'mock' });
    const voice = await db.addVoiceLabRecord({ text: 'active voice', provider: 'mock', voiceId: 'voice', speed: 1 });
    for (const operation of [
      () => db.deleteTaskPermanently(task.id),
      () => db.deleteViralAnalysisPermanently(viral.id),
      () => db.deleteImageLabRecordPermanently(image.id),
      () => db.deleteVoiceLabRecordPermanently(voice.id),
    ]) {
      await expect(operation()).rejects.toThrow(/archived/i);
    }
    await db.close();
  });

  it('revalidates a narrow deletion target before path work and returns an existing tombstone idempotently', async () => {
    const { db } = await createDatabase('storydream-history-delete-target-');
    const task = await db.createTask({ title: 'Deletion target', inputText: 'target' });
    await db.updateTask(task.id, { status: 'completed' });

    await expect(db.getHistoryDeletionTarget('task', task.id)).rejects.toThrow(/archived/i);
    await db.archiveTask(task.id);
    const target = await db.getHistoryDeletionTarget('task', task.id);
    expect(target).toEqual({
      family: 'task',
      id: task.id,
      managedStorageKey: task.managedStorageKey,
      tombstone: null,
    });

    const deleted = await db.deleteTaskPermanently(task.id, managedCleanup(task.managedStorageKey));
    expect(await db.getHistoryDeletionTarget('task', task.id)).toEqual({
      family: 'task',
      id: task.id,
      managedStorageKey: task.managedStorageKey,
      tombstone: deleted,
    });
    await db.close();
  });

  it('commits quarantine metadata atomically and exposes only pending cleanup ledgers', async () => {
    const { db, file } = await createDatabase('storydream-history-quarantine-ledger-');
    const task = await db.createTask({ title: 'Pending cleanup', inputText: 'pending' });
    await db.updateTask(task.id, { status: 'completed' });
    await db.addTaskEvent(task.id, { type: 'owned', detail: 'delete atomically' });
    const image = await db.addImageLabRecord({ prompt: 'missing cleanup', ratio: '9:16', style: 'photo-real', provider: 'mock' });
    await db.archiveTask(task.id);
    await db.archiveImageLabRecord(image.id);
    const cleanup = managedCleanup(task.managedStorageKey, '2');

    const pending = await db.deleteTaskPermanently(task.id, cleanup);
    const missing = await db.deleteImageLabRecordPermanently(image.id, missingCleanup);

    expect(pending).toMatchObject(cleanup);
    expect(missing).toMatchObject(missingCleanup);
    expect(await db.getTaskDetail(task.id)).toBeNull();
    expect((await db.listTaskEvents(task.id)).items).toEqual([]);
    expect(await db.listPendingHistoryTombstones()).toEqual([pending]);
    const [persisted] = await queryDatabase<{
      cleanup_state: string;
      quarantine_name: string;
      quarantine_identity_json: string;
      diagnostic: string;
    }>(file, 'SELECT cleanup_state, quarantine_name, quarantine_identity_json, diagnostic FROM history_tombstones WHERE family = ? AND entity_id = ?', ['task', task.id]);
    expect(persisted).toEqual({
      cleanup_state: cleanup.cleanupState,
      quarantine_name: cleanup.quarantineName,
      quarantine_identity_json: cleanup.quarantineIdentityJson,
      diagnostic: cleanup.diagnostic,
    });
    await db.close();
  });

  it('updates cleanup state and diagnostics without exposing non-pending tombstones to the reaper', async () => {
    const { db } = await createDatabase('storydream-history-cleanup-update-');
    const task = await db.createTask({ title: 'Cleanup update', inputText: 'cleanup' });
    await db.updateTask(task.id, { status: 'completed' });
    await db.archiveTask(task.id);
    const deleted = await db.deleteTaskPermanently(task.id, managedCleanup(task.managedStorageKey, '3'));

    const diagnosed = await db.updateHistoryTombstoneCleanup('task', task.id, 'pending', 'injected cleanup failure');
    expect(diagnosed).toEqual({ ...deleted, diagnostic: 'injected cleanup failure' });
    expect(await db.listPendingHistoryTombstones()).toEqual([diagnosed]);
    const cleaned = await db.updateHistoryTombstoneCleanup('task', task.id, 'cleaned', '');
    expect(cleaned).toEqual({ ...deleted, cleanupState: 'cleaned', diagnostic: '' });
    expect(await db.listPendingHistoryTombstones()).toEqual([]);
    await expect(db.updateHistoryTombstoneCleanup('task', task.id, 'pending', 'reopen')).rejects.toThrow(/terminal|cleanup/i);
    expect(await db.updateHistoryTombstoneCleanup('task', task.id, 'cleaned', '')).toEqual(cleaned);
    await expect(db.updateHistoryTombstoneCleanup('task', 'missing-id', 'cleaned', '')).rejects.toThrow(/not found|tombstone/i);
    await db.close();
  });

  it('deletes governed rows atomically, cascades owned rows, and preserves clone voice assets', async () => {
    const { db: initialDb, file, directory } = await createDatabase('storydream-history-delete-');
    const clone = { voiceId: 'clone-preserved', displayName: 'Preserved clone voice' };
    const sourceAudio = join(directory, 'clone-source.wav');
    await writeFile(sourceAudio, 'clone-source', 'utf8');
    await initialDb.close();
    await mutateDatabase(
      file,
      `INSERT INTO minimax_clone_voices
       (voice_id, display_name, source_audio_path, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)`,
      [clone.voiceId, clone.displayName, sourceAudio, 1, 1],
    );
    const db = await FileDatabase.open(file);
    const cloneVoicesBefore = (await db.getState()).minimaxCloneVoices;
    const task = await db.createTask({ title: 'Delete task', inputText: 'delete task' });
    await db.updateTask(task.id, { status: 'completed' });
    await db.addTaskEvent(task.id, { type: 'complete', detail: 'task event' });
    const viral = await db.createViralAnalysis({
      title: 'Delete viral',
      url: 'https://example.test/delete',
      settings: { track: 'story', style: 'photo-real', ratio: '9:16', templateId: 'portrait' },
    });
    await db.updateViralAnalysis(viral.id, { status: 'completed' });
    await db.addViralAnalysisEvent(viral.id, { type: 'complete', stage: 'completed', detail: 'viral event' });
    const image = await db.addImageLabRecord({ prompt: 'delete image', ratio: '9:16', style: 'photo-real', provider: 'mock' });
    const voice = await db.addVoiceLabRecord({
      text: 'delete voice',
      provider: 'minimax',
      voiceId: clone.voiceId,
      voiceLabel: clone.displayName,
      speed: 1,
      audioPath: join(directory, 'generated-voice.wav'),
    });

    await Promise.all([
      db.archiveTask(task.id),
      db.archiveViralAnalysis(viral.id),
      db.archiveImageLabRecord(image.id),
      db.archiveVoiceLabRecord(voice.id),
    ]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-06T00:00:00.000Z'));
    const tombstones = await Promise.all([
      db.deleteTaskPermanently(task.id, managedCleanup(task.managedStorageKey, '4')),
      db.deleteViralAnalysisPermanently(viral.id, managedCleanup(viral.managedStorageKey, '5')),
      db.deleteImageLabRecordPermanently(image.id, managedCleanup(image.managedStorageKey, '6')),
      db.deleteVoiceLabRecordPermanently(voice.id, managedCleanup(voice.managedStorageKey, '7')),
    ]);
    vi.setSystemTime(new Date('2026-06-07T00:00:00.000Z'));
    const duplicateTombstones = await Promise.all([
      db.deleteTaskPermanently(task.id),
      db.deleteViralAnalysisPermanently(viral.id),
      db.deleteImageLabRecordPermanently(image.id),
      db.deleteVoiceLabRecordPermanently(voice.id),
    ]);

    expect(duplicateTombstones).toEqual(tombstones);
    expect(tombstones.map((item) => item.deletedAt)).toEqual(Array(4).fill('2026-06-06T00:00:00.000Z'));
    expect(await db.getTaskDetail(task.id)).toBeNull();
    expect(await db.getViralAnalysisDetail(viral.id)).toBeNull();
    expect(await db.getImageLabRecordDetail(image.id)).toBeNull();
    expect(await db.getVoiceLabRecordDetail(voice.id)).toBeNull();
    expect((await db.listTaskEvents(task.id)).items).toEqual([]);
    expect((await db.listViralAnalysisEvents(viral.id)).items).toEqual([]);
    expect(await queryDatabase(file, 'SELECT id FROM playground_jobs WHERE id = ?', [image.id])).toEqual([]);
    expect((await db.getState()).minimaxCloneVoices).toEqual(cloneVoicesBefore);
    expect(await readFile(sourceAudio, 'utf8')).toBe('clone-source');

    const ledger = await queryDatabase<{
      family: string;
      entity_id: string;
      managed_storage_key: string;
      cleanup_state: string;
      quarantine_name: string;
      quarantine_identity_json: string;
      diagnostic: string;
      deleted_at: string;
    }>(file, 'SELECT * FROM history_tombstones ORDER BY family ASC');
    expect(ledger).toHaveLength(4);
    expect(ledger.map((row) => row.family)).toEqual(['image-lab', 'task', 'viral-analysis', 'voice-lab']);
    expect(ledger.every((row) => row.managed_storage_key.length > 0)).toBe(true);
    expect(ledger.every((row) => row.cleanup_state === 'pending')).toBe(true);
    expect(ledger.every((row) => typeof row.quarantine_name === 'string' && row.quarantine_name.endsWith('.quarantine'))).toBe(true);
    expect(ledger.every((row) => JSON.parse(row.quarantine_identity_json).version === 1 && row.diagnostic === '')).toBe(true);
    expect(ledger.every((row) => row.deleted_at === '2026-06-06T00:00:00.000Z')).toBe(true);
    await db.close();
  });

  it('rolls back the entity, owned rows, and tombstone when permanent deletion cannot persist', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'storydream-history-delete-rollback-'));
    createdDirectories.push(directory);
    const file = join(directory, 'app.db');
    let failNextReplace = false;
    const db = await FileDatabase.open(file, {
      replaceFile: async (source, target) => {
        if (failNextReplace) {
          failNextReplace = false;
          throw Object.assign(new Error('injected permanent delete persistence failure'), { code: 'EIO' });
        }
        await rename(source, target);
      },
    });
    const task = await db.createTask({ title: 'Rollback delete', inputText: 'must survive' });
    await db.updateTask(task.id, { status: 'completed' });
    await db.addTaskEvent(task.id, { type: 'owned', detail: 'must survive' });
    await db.archiveTask(task.id);

    failNextReplace = true;
    await expect(db.deleteTaskPermanently(task.id, managedCleanup(task.managedStorageKey, '8'))).rejects.toThrow(/persist|failure|EIO/i);

    expect(await db.getTaskDetail(task.id)).toMatchObject({ id: task.id, archivedAt: expect.any(String) });
    expect((await db.listTaskEvents(task.id)).items.map((event) => event.detail)).toEqual(['must survive']);
    expect(await queryDatabase(file, 'SELECT entity_id FROM history_tombstones WHERE family = ? AND entity_id = ?', ['task', task.id])).toEqual([]);
    await db.close();
  });

  it('records unmanaged legacy deletion without touching a path derived from the business ID', async () => {
    const { db, file, directory } = await createDatabase('storydream-history-legacy-delete-');
    const task = await db.createTask({ title: 'Legacy task', inputText: 'legacy' });
    await db.updateTask(task.id, { status: 'completed' });
    await db.close();
    await mutateDatabase(file, 'UPDATE tasks SET managed_storage_key = NULL WHERE id = ?', [task.id]);
    const legacySentinel = join(directory, task.id);
    await writeFile(legacySentinel, 'unmanaged legacy data', 'utf8');

    const reopened = await FileDatabase.open(file);
    await reopened.archiveTask(task.id);
    const tombstone = await reopened.deleteTaskPermanently(task.id);
    expect(tombstone.managedStorageKey).toBeNull();
    expect(tombstone.cleanupState).toBe('unmanaged-legacy');
    expect(tombstone.diagnostic).toMatch(/legacy|managed storage key/i);
    expect(await readFile(legacySentinel, 'utf8')).toBe('unmanaged legacy data');
    const [ledger] = await queryDatabase<{
      cleanup_state: string;
      quarantine_name: null;
      quarantine_identity_json: string;
      diagnostic: string;
    }>(file, 'SELECT cleanup_state, quarantine_name, quarantine_identity_json, diagnostic FROM history_tombstones WHERE family = ? AND entity_id = ?', ['task', task.id]);
    expect(ledger).toMatchObject({
      cleanup_state: 'unmanaged-legacy',
      quarantine_name: null,
      quarantine_identity_json: '{}',
    });
    expect(ledger.diagnostic).toMatch(/legacy|managed storage key/i);
    await reopened.close();
  });

  it('rejects every public business write while a governed record is archived', async () => {
    const { db } = await createDatabase('storydream-history-archived-writes-');
    const records = await createGovernedRecords(db);
    await Promise.all([
      db.archiveTask(records.task.id),
      db.archiveViralAnalysis(records.viral.id),
      db.archiveImageLabRecord(records.image.id),
      db.archiveVoiceLabRecord(records.voice.id),
    ]);

    const writes = [
      () => db.updateTask(records.task.id, { status: 'failed', retryFromStep: 2, artifactStatePath: 'task-state.json', outputDir: 'task-output' }),
      () => db.updateTask(records.task.id, {}),
      () => db.addTaskEvent(records.task.id, { type: 'retry', detail: 'must reject' }),
      () => db.updateViralAnalysis(records.viral.id, { status: 'failed', resultPath: 'result.json', videoPath: 'video.mp4' }),
      () => db.updateViralAnalysis(records.viral.id, {}),
      () => db.addViralAnalysisEvent(records.viral.id, { type: 'retry', stage: 'failed', detail: 'must reject' }),
      () => db.addImageLabRecord({ ...records.image, id: records.image.id }),
      () => db.updateImageLabRecord(records.image.id, { status: 'failed', imagePath: 'image.png' }),
      () => db.addVoiceLabRecord({ ...records.voice, id: records.voice.id }),
      () => db.updateVoiceLabRecord(records.voice.id, { status: 'failed', audioPath: 'voice.wav' }),
    ];
    for (const write of writes) await expect(write()).rejects.toThrow(/archived/i);
    await db.close();
  });

  it('never resurrects tombstoned IDs through any public write or restore path', async () => {
    const { db } = await createDatabase('storydream-history-tombstoned-writes-');
    const records = await createGovernedRecords(db);
    await db.archiveTask(records.task.id);
    await db.archiveViralAnalysis(records.viral.id);
    await db.archiveImageLabRecord(records.image.id);
    await db.archiveVoiceLabRecord(records.voice.id);
    await db.deleteTaskPermanently(records.task.id, managedCleanup(records.task.managedStorageKey, '9'));
    await db.deleteViralAnalysisPermanently(records.viral.id, managedCleanup(records.viral.managedStorageKey, '10'));
    await db.deleteImageLabRecordPermanently(records.image.id, managedCleanup(records.image.managedStorageKey, '11'));
    await db.deleteVoiceLabRecordPermanently(records.voice.id, managedCleanup(records.voice.managedStorageKey, '12'));

    const writes = [
      () => db.archiveTask(records.task.id),
      () => db.restoreTask(records.task.id),
      () => db.updateTask(records.task.id, { status: 'running', retryFromStep: 1, artifactStatePath: 'resurrect-task.json' }),
      () => db.updateTask(records.task.id, {}),
      () => db.addTaskEvent(records.task.id, { type: 'resurrect', detail: 'must reject' }),
      () => db.backfillManagedStorageKey('task', records.task.id, 'resurrect-task-key'),
      () => db.archiveViralAnalysis(records.viral.id),
      () => db.restoreViralAnalysis(records.viral.id),
      () => db.updateViralAnalysis(records.viral.id, { status: 'running', resultPath: 'resurrect-result.json' }),
      () => db.updateViralAnalysis(records.viral.id, {}),
      () => db.addViralAnalysisEvent(records.viral.id, { type: 'resurrect', stage: 'queued', detail: 'must reject' }),
      () => db.backfillManagedStorageKey('viral-analysis', records.viral.id, 'resurrect-viral-key'),
      () => db.archiveImageLabRecord(records.image.id),
      () => db.restoreImageLabRecord(records.image.id),
      () => db.addImageLabRecord({ ...records.image, id: records.image.id }),
      () => db.updateImageLabRecord(records.image.id, { status: 'generated', imagePath: 'resurrect-image.png' }),
      () => db.backfillManagedStorageKey('image-lab', records.image.id, 'resurrect-image-key'),
      () => db.archiveVoiceLabRecord(records.voice.id),
      () => db.restoreVoiceLabRecord(records.voice.id),
      () => db.addVoiceLabRecord({ ...records.voice, id: records.voice.id }),
      () => db.updateVoiceLabRecord(records.voice.id, { status: 'generated', audioPath: 'resurrect-voice.wav' }),
      () => db.backfillManagedStorageKey('voice-lab', records.voice.id, 'resurrect-voice-key'),
    ];
    for (const write of writes) await expect(write()).rejects.toThrow(/deleted|tombstone/i);
    await db.close();
  });
});
