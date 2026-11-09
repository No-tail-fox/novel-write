import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Database } from 'sql.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileDatabase } from '../src/shared/storage';
import * as covers from '../src/shared/project-cover';
import type { TaskSummary } from '../src/shared/types';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'project-summary-cache-'));
  roots.push(root);
  const file = join(root, 'data.db');
  const db = await FileDatabase.open(file);
  const task = await db.createTask({ title: '缓存测试', inputText: '正文内容', taskType: 'editorial-collage' });
  const workDir = join(root, 'tasks', task.managedStorageKey!);
  await mkdir(workDir, { recursive: true });
  const cover = join(workDir, 'cover.png');
  await writeFile(cover, 'cover image');
  await db.updateTask(task.id, { status: 'draft', pipelineData: JSON.stringify({ coverPath: cover, stage: 'episode-script', privatePrompt: 'never-cache-this' }) });
  return { db, file, task, cover };
}
function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('cached project list summaries', () => {
  it('returns the list before cover I/O finishes and publishes the background result once', async () => {
    const { db, task, cover } = await fixture();
    const pending = gate<TaskSummary['projectCover']>();
    const spy = vi.spyOn(covers, 'readProjectCover').mockImplementationOnce(() => pending.promise);
    const changed = vi.fn();
    db.onProjectCoverReady = changed;
    try {
      const first = await db.listTaskSummaries();
      expect(first.items[0]).toMatchObject({ id: task.id, title: '缓存测试', projectCover: null });
      await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
      // The background cover read is deliberately still unresolved here.
      expect((await db.listTaskSummaries()).items[0].id).toBe(task.id);
      expect(changed).not.toHaveBeenCalled();
      pending.resolve({ path: cover, revision: 'test-revision' });
      await vi.waitFor(() => expect(changed).toHaveBeenCalledWith(task.id));
      expect((await db.listTaskSummaries()).items[0].projectCover?.path).toBe(cover);
    } finally { pending.resolve(null); await db.close(); }
  });

  it('reuses persistent media hints and activity without parsing pipeline data on a warm read', async () => {
    const { db, task, cover } = await fixture();
    try {
      await db.getTaskSummary(task.id);
      const sql = (db as unknown as { db: Database }).db;
      const prepare = vi.spyOn(sql, 'prepare');
      const first = (await db.listTaskSummaries()).items[0];
      expect(first.projectCover?.path).toBe(cover);
      await db.getTaskSummary(task.id);
      expect(prepare.mock.calls.map(([query]) => String(query)).filter((query) => /json_(?:extract|each|tree|valid)/.test(query))).toEqual([]);
      expect(first).not.toHaveProperty('pipelineData');
      expect(first).not.toHaveProperty('inputText');
    } finally { await db.close(); }
  });

  it('keeps the last card immediately after a project change, then refreshes only that project', async () => {
    const { db, task, cover } = await fixture();
    try {
      await db.getTaskSummary(task.id);
      const replacement = join(cover, '..', 'replacement.png');
      await writeFile(replacement, 'replacement');
      await db.updateTask(task.id, { pipelineData: JSON.stringify({ coverPath: replacement, stage: 'shot-board' }) });
      expect((await db.listTaskSummaries()).items[0].projectCover?.path).toBe(cover);
      await vi.waitFor(async () => expect((await db.listTaskSummaries()).items[0].projectCover?.path).toBe(replacement));
      const updated = (await db.listTaskSummaries()).items[0];
      expect(updated.projectActivity?.detail).toContain('分镜');
    } finally { await db.close(); }
  });

  it('loads the saved summary immediately after reopen and recovers from a corrupt cache', async () => {
    const { db, file, task, cover } = await fixture();
    await db.getTaskSummary(task.id);
    db.beginProjectActivity(task.id, '临时运行状态不应写入缓存');
    expect((await db.getTaskSummary(task.id))?.projectActivity?.status).toBe('running');
    await db.close();
    const source = await readFile(`${file}.project-summaries.json`, 'utf8');
    expect(source).not.toContain('never-cache-this');
    let reopened = await FileDatabase.open(file);
    try {
      const restored = (await reopened.listTaskSummaries()).items[0];
      expect(restored.projectCover?.path).toBe(cover);
      expect(restored.projectActivity?.status).toBe('draft');
    }
    finally { await reopened.close(); }
    await writeFile(`${file}.project-summaries.json`, '{broken', 'utf8');
    reopened = await FileDatabase.open(file);
    try {
      expect((await reopened.listTaskSummaries()).items[0].projectCover).toBeNull();
      await vi.waitFor(async () => expect((await reopened.listTaskSummaries()).items[0].projectCover?.path).toBe(cover));
    } finally { await reopened.close(); }
  });

  it('discards an in-flight stale cover when the project changes', async () => {
    const { db, task, cover } = await fixture();
    const pending = gate<TaskSummary['projectCover']>();
    const spy = vi.spyOn(covers, 'readProjectCover').mockImplementationOnce(() => pending.promise);
    try {
      await db.listTaskSummaries();
      await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
      const replacement = join(cover, '..', 'new.png');
      await writeFile(replacement, 'new');
      await db.updateTask(task.id, { pipelineData: JSON.stringify({ coverPath: replacement }) });
      pending.resolve({ path: cover, revision: 'obsolete' });
      await vi.waitFor(async () => expect((await db.listTaskSummaries()).items[0].projectCover?.path).toBe(replacement));
    } finally { pending.resolve(null); await db.close(); }
  });

  it('never publishes or restores a project deleted while its cover is being refreshed', async () => {
    const { db, task, cover } = await fixture();
    const pending = gate<TaskSummary['projectCover']>();
    const spy = vi.spyOn(covers, 'readProjectCover').mockImplementationOnce(() => pending.promise);
    const changed = vi.fn();
    db.onProjectCoverReady = changed;
    try {
      await db.listTaskSummaries();
      await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
      await db.archiveTask(task.id);
      await rm(dirname(cover), { recursive: true, force: true });
      await db.deleteTaskPermanently(task.id, { cleanupState: 'missing', quarantineName: null, quarantineIdentityJson: '{}', diagnostic: 'Isolated fixture directory removed.' });
      pending.resolve({ path: cover, revision: 'deleted' });
      await (db as unknown as { projectSummaryRefresh: Promise<void> }).projectSummaryRefresh;
      expect(changed).not.toHaveBeenCalled();
      expect((await db.listTaskSummaries({ filter: 'archived' })).items).toEqual([]);
      expect(await db.getTaskSummary(task.id)).toBeNull();
    } finally { pending.resolve(null); await db.close(); }
  });

});
