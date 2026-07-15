import { readFile, rm, writeFile, mkdtemp } from 'node:fs/promises';
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
    for (const index of [
      'idx_tasks_active_history',
      'idx_tasks_archived_history',
      'idx_viral_analyses_active_history',
      'idx_viral_analyses_archived_history',
      'idx_image_lab_records_active_history',
      'idx_image_lab_records_archived_history',
      'idx_voice_lab_records_active_history',
      'idx_voice_lab_records_archived_history',
    ]) {
      expect(schema).toContain(`index:${index}:`);
    }
    expect(await readFile(new URL('../src/shared/storage.ts', import.meta.url), 'utf8')).toContain('COUNT(*) AS total_count');
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
});
