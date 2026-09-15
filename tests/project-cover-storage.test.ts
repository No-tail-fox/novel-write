import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileDatabase } from '@shared/storage';
import { readProjectCover } from '@shared/project-cover';
import type { TaskSummary } from '@shared/types';

const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });

describe('project cover summaries', () => {
  it('loads existing auto covers, updates the revision, and keeps them after reopening the database', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'project-cover-'));
    directories.push(dir);
    const file = join(dir, 'data.db');
    let db = await FileDatabase.open(file);
    try {
      const task = await db.createTask({ title: '自动封面', inputText: '完整正文'.repeat(1000), coverImageMode: 'auto' });
      const workDir = join(dir, 'tasks', task.managedStorageKey!);
      await mkdir(join(workDir, 'pipeline'), { recursive: true });
      const cover = join(workDir, 'cover-image.png');
      const statePath = join(workDir, 'pipeline', 'state.json');
      await writeFile(statePath, JSON.stringify({ taskId: task.id, assets: { cover: [{ path: cover }] } }));
      await db.updateTask(task.id, { artifactStatePath: statePath, outputDir: join(dir, 'external-draft') });
      expect((await db.listTaskSummaries()).items[0].projectCover).toBeNull();
      await writeFile(cover, 'existing cover');
      const first = (await db.listTaskSummaries()).items[0];
      expect(first.projectCover?.path).toBe(cover);
      expect(first).not.toHaveProperty('pipelineData');
      expect(first).not.toHaveProperty('inputText');
      expect(first.inputPreview.length).toBeLessThanOrEqual(160);
      expect((await db.setTaskFavorite(task.id, true)).projectCover?.path).toBe(cover);
      await db.updateTask(task.id, { status: 'completed' });
      expect((await db.archiveTask(task.id)).projectCover?.path).toBe(cover);
      expect((await db.restoreTask(task.id)).projectCover?.path).toBe(cover);
      await writeFile(cover, 'replacement cover with different size');
      expect((await db.getTaskSummary(task.id))?.projectCover?.revision).not.toBe(first.projectCover?.revision);
      await db.close();
      db = await FileDatabase.open(file);
      expect((await db.listTaskSummaries()).items[0].projectCover?.path).toBe(cover);
      expect(await readFile(cover, 'utf8')).toBe('replacement cover with different size');
    } finally { await db.close(); }
  });

  it('includes manual and HTML cover metadata and resolves task-relative image paths', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'project-cover-manual-'));
    directories.push(dir);
    const db = await FileDatabase.open(join(dir, 'data.db'));
    try {
      for (const taskType of ['story', 'html-video'] as const) {
        const input = { title: taskType, inputText: '封面验证', taskType };
        const task = taskType === 'story' ? await db.createTaskWithOrdinaryCover(input, {
          sourcePath: join(dir, 'source.png'), sourceBytes: Buffer.from('cover'), exists: true, isFile: true,
          sizeBytes: 5, width: 1280, height: 720, mimeType: 'image/png', originalName: '封面.png',
        }, '16:9', {
          prepareImage: async ({ destinationPath }) => {
            await writeFile(destinationPath, 'cover');
            return { sizeBytes: 5, width: 1280, height: 720, mimeType: 'image/png', sha256: 'a'.repeat(64) };
          },
          ensureDirectory: async (path) => { await mkdir(path, { recursive: true }); },
          promoteFile: rename,
          removeFile: async (path) => { await rm(path, { force: true }); },
          now: () => new Date().toISOString(),
        }) : await db.createTask(input);
        const workDir = join(dir, 'tasks', task.managedStorageKey!);
        await mkdir(join(workDir, 'covers'), { recursive: true });
        const path = 'covers/cover-manual.png';
        await writeFile(join(workDir, path), 'cover');
        if (taskType === 'story') {
          expect((await db.getTaskSummary(task.id))?.ordinaryCoverAsset?.path).toBe(path);
        } else {
          await db.updateTask(task.id, { pipelineData: JSON.stringify({ coverAsset: { path }, largeDocument: 'x'.repeat(100000) }) });
        }
        expect((await db.getTaskSummary(task.id))?.projectCover?.path).toBe(join(workDir, path));
        expect((await db.listTaskSummaries()).items.find((item) => item.id === task.id)?.projectCover?.path).toBe(join(workDir, path));
      }
    } finally { await db.close(); }
  });

  it('ignores malformed, foreign-task and oversized state without blocking the list', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'project-cover-invalid-'));
    directories.push(dir);
    const path = join(dir, 'state.json');
    const cover = join(dir, 'cover.png');
    await writeFile(cover, 'cover');
    const task = { id: 'target', artifactStatePath: path } as TaskSummary;
    for (const state of ['{', JSON.stringify({ taskId: 'another', assets: { cover: [{ path: cover }] } }), ' '.repeat(4 * 1024 * 1024 + 1)]) {
      await writeFile(path, state);
      expect(await readProjectCover(task, dir)).toBeNull();
    }
  });
});
