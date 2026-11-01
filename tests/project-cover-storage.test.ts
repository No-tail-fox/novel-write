import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileDatabase } from '@shared/storage';
import { readProjectCover } from '@shared/project-cover';
import type { TaskSummary } from '@shared/types';
import { generateProjectCoverImage } from '@shared/project-cover-generation';
import { defaultConfig } from '@shared/config';
import { resolveReferenceFfmpeg } from '@shared/viral-reference-media';
import { runBoundedProcess } from '@shared/process-runner';
import { ipcInputSchemas } from '@shared/ipc-contract';

const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });

describe('project cover summaries', () => {
  it('keeps 上传封面 and 生成封面 overrides through workflow saves and reopening; 恢复自动封面 restores storyboard imagery', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'project-cover-override-'));
    directories.push(dir);
    const file = join(dir, 'data.db');
    let db = await FileDatabase.open(file);
    try {
      const task = await db.createTask({ title: '封面操作', inputText: 'test', taskType: 'editorial-collage' });
      const workDir = join(dir, 'tasks', task.managedStorageKey!);
      await mkdir(workDir, { recursive: true });
      const frame = join(workDir, 'shot.png');
      const override = join(workDir, 'custom.png');
      await writeFile(frame, 'storyboard');
      await writeFile(override, 'custom cover');
      const pipeline = { assets: [{ id: 'a', kind: 'image', localPath: frame }], beats: [{ shots: [{ keyframeAssetVersionId: 'a' }] }] };
      await db.updateTask(task.id, { pipelineData: JSON.stringify(pipeline) });
      expect((await db.getTaskSummary(task.id))?.projectCover?.path).toBe(frame);
      expect((await db.setProjectCover(task.id, override)).projectCover?.path).toBe(override);
      await db.updateTask(task.id, { pipelineData: JSON.stringify({ ...pipeline, revision: 2 }) });
      await db.close();
      db = await FileDatabase.open(file);
      expect((await db.getTaskSummary(task.id))?.projectCover?.path).toBe(override);
      expect((await db.setProjectCover(task.id, null)).projectCover?.path).toBe(frame);
      await db.updateTask(task.id, { status: 'draft' });
      await db.archiveTask(task.id);
      await expect(db.setProjectCover(task.id, override)).rejects.toThrow('HISTORY_ARCHIVED');
    } finally { await db.close(); }
  });

  it('resolves motion-comic shot frames, HTML composition previews and ordinary storyboard images', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'project-cover-workflows-'));
    directories.push(dir);
    const db = await FileDatabase.open(join(dir, 'data.db'));
    try {
      for (const taskType of ['motion-comic', 'html-video', 'story'] as const) {
        const task = await db.createTask({ title: taskType, taskType, inputText: 'test', referenceImagePath: join(dir, 'reference.png') });
        const workDir = join(dir, 'tasks', task.managedStorageKey!);
        await mkdir(workDir, { recursive: true });
        const image = join(workDir, 'first.png');
        await writeFile(image, taskType);
        await writeFile(join(dir, 'reference.png'), 'reference');
        const state = join(workDir, 'state.json');
        await writeFile(state, JSON.stringify({ taskId: task.id, assets: { images: [{ sceneId: 2, path: 'missing.png' }, { sceneId: 1, path: image }] } }));
        const pipeline = taskType === 'motion-comic'
          ? { assets: [{ id: 'a', kind: 'image', localPath: image }], episodes: [{ scenes: [{ shots: [{ firstFrameAssetVersionId: 'a' }] }] }] }
          : { compositions: [{ thumbnailPath: image }] };
        await db.updateTask(task.id, { pipelineData: JSON.stringify(pipeline), ...(taskType === 'story' ? { artifactStatePath: state } : {}) });
        const summary = await db.getTaskSummary(task.id);
        expect(summary?.projectCover?.path).toBe(image);
        expect(summary).not.toHaveProperty('pipelineData');
      }
    } finally { await db.close(); }
  });

  it('extracts and caches a real final-video first frame ahead of storyboard imagery and invalidates after replacement', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'project-cover-video-'));
    directories.push(dir);
    const db = await FileDatabase.open(join(dir, 'data.db'));
    try {
      const task = await db.createTask({ title: '视频首帧', inputText: 'test', taskType: 'editorial-collage' });
      const workDir = join(dir, 'tasks', task.managedStorageKey!);
      await mkdir(workDir, { recursive: true });
      const video = join(workDir, 'final.mp4');
      const image = join(workDir, 'shot.png');
      await writeFile(image, 'storyboard image');
      const ffmpeg = await resolveReferenceFfmpeg();
      async function makeVideo(color: string) {
        const result = await runBoundedProcess(ffmpeg, ['-y', '-f', 'lavfi', '-i', `color=c=${color}:s=320x180:d=0.2`, '-threads', '1', '-pix_fmt', 'yuv420p', video],
          { cwd: workDir, timeoutMs: 20_000, maxStdoutBytes: 4096, maxStderrBytes: 16_384 });
        expect(result.code).toBe(0);
      }
      await makeVideo('red');
      await db.updateTask(task.id, { pipelineData: JSON.stringify({
        assets: [{ id: 's', kind: 'image', localPath: image }, { id: 'v', assetId: 'director-final-video', kind: 'video', localPath: video, selected: true }],
        beats: [{ shots: [{ keyframeAssetVersionId: 's' }] }],
      }) });
      // A list read returns the existing shot while decoding runs in the background.
      const ready = vi.fn();
      db.onProjectCoverReady = ready;
      const list = await db.listTaskSummaries();
      expect(list.items[0].projectCover).toBeNull();
      await vi.waitFor(() => expect(ready).toHaveBeenCalledWith(task.id));
      const [first, concurrent] = await Promise.all([db.getTaskSummary(task.id), db.getTaskSummary(task.id)]);
      expect(first?.projectCover?.path).toMatch(/frame-.*\.jpg$/);
      expect(concurrent?.projectCover).toEqual(first?.projectCover);
      const bytes = await readFile(first!.projectCover!.path);
      expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      expect((await db.getTaskSummary(task.id))?.projectCover).toEqual(first?.projectCover);
      await makeVideo('blue');
      expect((await db.getTaskSummary(task.id))?.projectCover?.path).not.toBe(first?.projectCover?.path);
      await vi.waitFor(() => expect(ready).toHaveBeenCalledWith(task.id));
    } finally { await db.close(); }
  }, 30_000);

  it('journals failed cover generation without changing an existing override; accepts a later successful generation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'project-cover-generate-'));
    directories.push(dir);
    const db = await FileDatabase.open(join(dir, 'data.db'));
    try {
      const task = await db.createTask({ title: '生成封面', inputText: 'test' });
      const cover = join(dir, 'existing.png');
      await writeFile(cover, 'cover');
      await db.setProjectCover(task.id, cover);
      const failed = vi.fn(async () => ({ status: 'failed', errorMessage: 'Image provider API error (400): no image' }) as never);
      await expect(generateProjectCoverImage(defaultConfig, task, dir, '封面', failed)).rejects.toMatchObject({
        code: 'PROJECT_COVER_GENERATION_FAILED', message: 'Image provider API error (400): no image', retryable: true,
      });
      expect(failed).toHaveBeenCalledTimes(1);
      expect((await db.getTaskSummary(task.id))?.projectCover?.path).toBe(cover);
      const generated = vi.fn(async (_config, directory) => {
        const path = join(directory, 'generated.png');
        await writeFile(path, 'generated image');
        return { status: 'generated', imagePath: path } as never;
      });
      const path = await generateProjectCoverImage(defaultConfig, task, dir, '封面', generated);
      expect((await db.setProjectCover(task.id, path)).projectCover?.path).toBe(path);
      const journal = JSON.parse(await readFile(join(path, '..', 'request.json'), 'utf8'));
      expect(journal.status).toBe('generated');
    } finally { await db.close(); }
  });

  it('bounds project cover IPC prompts and never accepts renderer-supplied filesystem paths', () => {
    expect(ipcInputSchemas['project-cover:generate'].parse({ id: 'task-1', prompt: '封面' })).toEqual({ id: 'task-1', prompt: '封面' });
    expect(() => ipcInputSchemas['project-cover:generate'].parse({ id: 'task-1', prompt: 'x'.repeat(4001) })).toThrow();
    expect(() => ipcInputSchemas['project-cover:import'].parse({ id: 'task-1', path: 'C:/private' })).toThrow();
    expect(ipcInputSchemas['project-cover:reset'].parse('task-1')).toBe('task-1');
  });
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
      await vi.waitFor(async () => expect((await db.listTaskSummaries()).items[0].projectCover?.path).toBe(cover));
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

  it('recovers legacy story covers stored in pipeline data', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'project-cover-pipeline-'));
    directories.push(dir);
    const db = await FileDatabase.open(join(dir, 'data.db'));
    try {
      const task = await db.createTask({ title: '旧项目封面', inputText: '历史项目' });
      const workDir = join(dir, 'tasks', task.managedStorageKey!);
      await mkdir(join(workDir, 'covers'), { recursive: true });
      const cover = join(workDir, 'covers', 'legacy.png');
      await writeFile(cover, 'legacy cover');
      await db.updateTask(task.id, {
        pipelineData: JSON.stringify({ assets: { cover: [{ path: 'covers/legacy.png' }] } }),
      });
      expect((await db.getTaskSummary(task.id))?.projectCover?.path).toBe(cover);
      expect((await db.listTaskSummaries()).items.find((item) => item.id === task.id)?.projectCover?.path).toBe(cover);
    } finally { await db.close(); }
  });

  it('resolves a legacy task-relative reference image as a project cover fallback', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'project-cover-reference-'));
    directories.push(dir);
    const db = await FileDatabase.open(join(dir, 'data.db'));
    try {
      const task = await db.createTask({ title: '参考图封面', inputText: '历史项目', referenceImagePath: 'references/first-frame.png' });
      const workDir = join(dir, 'tasks', task.managedStorageKey!);
      await mkdir(join(workDir, 'references'), { recursive: true });
      const reference = join(workDir, 'references', 'first-frame.png');
      await writeFile(reference, 'reference cover');
      expect((await db.getTaskSummary(task.id))?.projectCover?.path).toBe(reference);
      expect((await db.listTaskSummaries()).items.find((item) => item.id === task.id)?.projectCover?.path).toBe(reference);
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
