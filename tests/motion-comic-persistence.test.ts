import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ipcInputSchemas } from '../src/shared/ipc-contract';
import { parseMotionComicPipelineData } from '../src/shared/motion-comic';
import { FileDatabase } from '../src/shared/storage';

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('motion comic persistence', () => {
  it('strictly validates dedicated create and save IPC requests', () => {
    const create = ipcInputSchemas['motion-comic:create'];
    expect(create.parse({ title: '雨夜来信', premise: '一封来自未来的信。', ratio: '9:16' })).toMatchObject({ ratio: '9:16' });
    expect(() => create.parse({ title: '雨夜来信', premise: '故事', runNow: true })).toThrow();
  });

  it('creates a task-backed series project and rejects stale saves', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storydream-motion-comic-'));
    cleanupPaths.push(root);
    const database = await FileDatabase.open(join(root, 'storydream.sqlite'));
    try {
      const created = await database.createMotionComicTask({ title: '雨夜来信', premise: '一封来自未来的信。', ratio: '9:16' });
      expect(created.taskType).toBe('motion-comic');
      const document = parseMotionComicPipelineData(created.pipelineData);
      expect(document.series.title).toBe('雨夜来信');
      expect(document.providerJobs).toEqual([]);

      const saved = await database.saveMotionComicTask({
        id: created.id,
        expectedUpdatedAt: document.updatedAt,
        document: { ...document, title: '雨夜来信：第一季' },
      });
      const savedDocument = parseMotionComicPipelineData(saved.pipelineData);
      expect(saved.title).toBe('雨夜来信：第一季');
      expect(savedDocument.updatedAt).not.toBe(document.updatedAt);

      await expect(database.saveMotionComicTask({ id: created.id, expectedUpdatedAt: document.updatedAt, document }))
        .rejects.toThrow(/MOTION_COMIC_STALE_WRITE/u);
    } finally {
      await database.close();
    }
  });
});
