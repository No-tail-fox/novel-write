import { link, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportMotionComicRender } from '../electron/motion-comic-render-export';
import { ensureHtmlVideoTaskWorkDir } from '../electron/html-video-runtime';
import { createMotionComicDraft } from '../src/shared/motion-comic';
import { ipcInputSchemas } from '../src/shared/ipc-contract';
import type { Task } from '../src/shared/types';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'render-export-')); roots.push(root);
  const identity = await ensureHtmlVideoTaskWorkDir(root, 'task-one');
  const other = await ensureHtmlVideoTaskWorkDir(root, 'task-two');
  const oldPath = join(identity.workDir.canonicalPath, 'old.mp4');
  const latestPath = join(identity.workDir.canonicalPath, 'latest.mp4');
  await writeFile(oldPath, 'old render bytes'); await writeFile(latestPath, 'latest render bytes');
  const document = createMotionComicDraft({ id: 'comic', title: 'test', premise: 'test', now: '2026-01-01T00:00:00.000Z' });
  document.assets = [oldPath, latestPath].map((localPath, i) => ({ id: `render-${i}`, assetId: 'director-final-video', kind: 'video', localPath, createdAt: document.createdAt }));
  const task = { id: document.id, taskType: 'motion-comic', pipelineData: JSON.stringify(document), archivedAt: '2026-01-02T00:00:00.000Z' } as Task;
  const destination = join(root, 'saved.mp4');
  const deps = { getTask: vi.fn(async () => task), taskDirectory: async () => identity, selectDestination: vi.fn(async (): Promise<string | null> => destination) };
  return { root, identity, other, oldPath, latestPath, document, task, destination, deps, input: { taskId: 'comic', assetVersionId: 'render-0' } };
}

describe('persisted motion comic render export', () => {
  it('copies the selected historical ID, allows archives, and replaces a confirmed existing destination', async () => {
    const f = await fixture(); const before = f.task.pipelineData;
    await writeFile(f.destination, 'existing destination');
    expect(await exportMotionComicRender(f.input, f.deps)).toBe(true);
    expect(await readFile(f.destination, 'utf8')).toBe('old render bytes');
    expect(await readFile(f.latestPath, 'utf8')).toBe('latest render bytes');
    expect(f.task.pipelineData).toBe(before);
    expect((await readdir(f.root)).some(name => name.startsWith('.render-export-'))).toBe(false);
  });
  it('cancel returns false without copying', async () => {
    const f = await fixture(); f.deps.selectDestination.mockResolvedValue(null);
    expect(await exportMotionComicRender(f.input, f.deps)).toBe(false);
    expect(await readdir(f.root)).not.toContain('saved.mp4');
  });
  it('rejects a foreign ID, ordinary video, external path, other task path, and missing source before dialog', async () => {
    const f = await fixture();
    await expect(exportMotionComicRender({ ...f.input, assetVersionId: 'foreign' }, f.deps)).rejects.toThrow('所选成片版本');
    f.document.assets[0].assetId = 'shot-video'; f.task.pipelineData = JSON.stringify(f.document);
    await expect(exportMotionComicRender(f.input, f.deps)).rejects.toThrow('所选成片版本');
    f.document.assets[0].assetId = 'director-final-video';
    for (const path of [join(f.root, 'external.mp4'), join(f.other.workDir.canonicalPath, 'other.mp4')]) {
      await writeFile(path, 'forbidden'); f.document.assets[0].localPath = path; f.task.pipelineData = JSON.stringify(f.document);
      await expect(exportMotionComicRender(f.input, f.deps)).rejects.toThrow('受管目录');
    }
    f.document.assets[0].localPath = join(f.identity.workDir.canonicalPath, 'missing.mp4'); f.task.pipelineData = JSON.stringify(f.document);
    await expect(exportMotionComicRender(f.input, f.deps)).rejects.toThrow('不存在');
    expect(f.deps.selectDestination).not.toHaveBeenCalled();
  });
  it('rejects same source and hardlink aliases without changing bytes', async () => {
    const f = await fixture();
    await link(f.oldPath, f.destination);
    for (const destination of [f.oldPath, f.destination]) {
      f.deps.selectDestination.mockResolvedValue(destination);
      await expect(exportMotionComicRender(f.input, f.deps)).rejects.toThrow('不能与原成片相同');
      expect(await readFile(f.oldPath, 'utf8')).toBe('old render bytes');
    }
  });
  it('reports copy failures and preserves existing destination if the source disappears during the dialog', async () => {
    const f = await fixture(); await writeFile(f.destination, 'keep me');
    f.deps.selectDestination.mockImplementation(async () => { await rm(f.oldPath); return f.destination; });
    await expect(exportMotionComicRender(f.input, f.deps)).rejects.toThrow('不存在');
    expect(await readFile(f.destination, 'utf8')).toBe('keep me');
    f.deps.selectDestination.mockResolvedValue(join(f.root, 'missing-dir', 'saved.mp4'));
    await writeFile(f.oldPath, 'restored');
    await expect(exportMotionComicRender(f.input, f.deps)).rejects.toThrow('另存失败');
  });
  it('preserves an existing target and removes only its temporary file if final publication fails', async () => {
    const f = await fixture(); await writeFile(f.destination, 'keep original');
    vi.mocked(fs.rename).mockRejectedValueOnce(new Error('disk failure'));
    await expect(exportMotionComicRender(f.input, f.deps)).rejects.toThrow('另存失败');
    expect(await readFile(f.destination, 'utf8')).toBe('keep original');
    expect(await readFile(f.oldPath, 'utf8')).toBe('old render bytes');
    expect((await readdir(f.root)).filter(name => name.startsWith('.render-export-'))).toEqual([]);
  });
  it('accepts IDs only at IPC boundary', () => {
    const input = { taskId: 'comic', assetVersionId: 'render-0' };
    expect(ipcInputSchemas['motion-comic:export-render'].safeParse(input).success).toBe(true);
    expect(ipcInputSchemas['motion-comic:export-render'].safeParse({ ...input, path: 'outside.mp4' }).success).toBe(false);
  });
});
