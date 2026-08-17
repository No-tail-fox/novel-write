import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ipcInputSchemas } from '../src/shared/ipc-contract';
import { parseEditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { FileDatabase } from '../src/shared/storage';

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('editorial collage persistence', () => {
  it('strictly validates dedicated create and save IPC requests', () => {
    const create = ipcInputSchemas['editorial-collage:create'];
    expect(create.parse({ title: '城市咖啡馆', sourceText: '一段解释型视频文案。', ratio: '9:16' })).toMatchObject({ ratio: '9:16' });
    expect(() => create.parse({ title: '城市咖啡馆', sourceText: '文案', runNow: true })).toThrow();

    const document = parseEditorialCollagePipelineData({
      version: 1,
      id: 'vox-1',
      workflowKind: 'editorial-collage',
      title: '城市咖啡馆',
      ratio: '9:16',
      createdAt: '2026-08-17T00:00:00.000Z',
      updatedAt: '2026-08-17T00:00:00.000Z',
      stage: 'draft',
      styleCandidates: [],
      beats: [],
      assets: [],
      providerJobs: [],
      qualityReports: [],
      estimatedCost: 0,
    });
    const save = ipcInputSchemas['editorial-collage:save'];
    expect(save.parse({ id: document.id, expectedUpdatedAt: document.updatedAt, document })).toMatchObject({ id: 'vox-1' });
    expect(() => save.parse({ id: document.id, expectedUpdatedAt: document.updatedAt, document, force: true })).toThrow();
  });

  it('atomically creates a task-backed project and rejects stale saves', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storydream-vox-'));
    cleanupPaths.push(root);
    const database = await FileDatabase.open(join(root, 'storydream.sqlite'));
    try {
      const created = await database.createEditorialCollageTask({
        title: '城市咖啡馆',
        sourceText: '咖啡馆改变了消息流通。报纸和交易聚到一起。新的公共讨论出现。它最终改变了城市生活。',
        ratio: '9:16',
      });
      expect(created.taskType).toBe('editorial-collage');
      expect(created.status).toBe('draft');
      const document = parseEditorialCollagePipelineData(created.pipelineData);
      expect(document.id).toBe(created.id);
      expect(document.timeline?.durationMs).toBe(30_000);

      const saved = await database.saveEditorialCollageTask({
        id: created.id,
        expectedUpdatedAt: document.updatedAt,
        document: { ...document, title: '城市咖啡馆与公共空间' },
      });
      const savedDocument = parseEditorialCollagePipelineData(saved.pipelineData);
      expect(saved.title).toBe('城市咖啡馆与公共空间');
      expect(savedDocument.updatedAt).not.toBe(document.updatedAt);

      await expect(database.saveEditorialCollageTask({
        id: created.id,
        expectedUpdatedAt: document.updatedAt,
        document,
      })).rejects.toThrow(/EDITORIAL_COLLAGE_STALE_WRITE/u);
    } finally {
      await database.close();
    }
  });
});
