import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ipcInputSchemas } from '../src/shared/ipc-contract';
import {
  editEditorialShotMotion,
  insertEditorialShot,
  mergeEditorialShots,
  parseEditorialCollagePipelineData,
  rebuildEditorialTimeline,
  removeEditorialShot,
  reorderEditorialShot,
  splitEditorialShot,
  type EditorialCollagePipelineData,
} from '../src/shared/editorial-collage';
import { FileDatabase } from '../src/shared/storage';

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('editorial collage persistence', () => {
  it('round-trips a full-length project through SQLite and rejects short-duration creation atomically', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storydream-vox-long-'));
    cleanupPaths.push(root);
    const path = join(root, 'storydream.sqlite');
    let database = await FileDatabase.open(path);
    try {
      const sourceText = '  原文开头\r\n' + '完整事实与上下文。'.repeat(1400) + '\n原文结尾  ';
      await expect(database.createEditorialCollageTask({ title: '时长不足', sourceText, durationMs: 60000 })).rejects.toThrow('EDITORIAL_SCRIPT_TOO_FAST');
      expect((await database.listTaskSummaries({ taskType: 'editorial-collage' })).items).toEqual([]);
      const created = await database.createEditorialCollageTask({ title: '全文保存', sourceText, durationMs: 'auto' });
      const document = parseEditorialCollagePipelineData(created.pipelineData);
      expect(document.timeline!.durationMs).toBeGreaterThan(120000);
      const edited = reorderEditorialShot(document, document.beats.at(-1)!.shots.at(-1)!.id, 0);
      const saved = await database.saveEditorialCollageTask({ id: created.id, expectedUpdatedAt: document.updatedAt, document: edited });
      await database.close();
      database = await FileDatabase.open(path);
      const reopened = await database.getTaskDetail(created.id);
      expect(reopened!.pipelineData).toEqual(saved.pipelineData);
      const persisted = parseEditorialCollagePipelineData(reopened!.pipelineData);
      expect(persisted.sourceText).toBe(sourceText);
      expect(persisted.beats).toEqual(edited.beats);
      expect(persisted.timeline).toEqual(edited.timeline);
    } finally { await database.close(); }
  });

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

    const generateVideo = ipcInputSchemas['director:generate-shot-video'];
    expect(generateVideo.parse({ id: document.id, shotId: 'shot-1', expectedUpdatedAt: document.updatedAt })).toEqual({ id: 'vox-1', shotId: 'shot-1', expectedUpdatedAt: document.updatedAt });
    expect(() => generateVideo.parse({ id: document.id, shotId: 'shot-1', expectedUpdatedAt: document.updatedAt, localPath: 'C:/forged.mp4' })).toThrow();
    expect(() => generateVideo.parse({ id: document.id, shotId: 'shot-1', expectedUpdatedAt: 'not-a-date' })).toThrow();
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

  it('saves structural and motion edits against the last persisted revision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storydream-vox-edits-'));
    cleanupPaths.push(root);
    const database = await FileDatabase.open(join(root, 'storydream.sqlite'));
    try {
      const created = await database.createEditorialCollageTask({
        title: 'Revision persistence', sourceText: 'An opening shot. A closing shot.', ratio: '16:9',
      });
      let document = parseEditorialCollagePipelineData(created.pipelineData);
      const originalShot = document.beats[0].shots[0];
      const generated = rebuildEditorialTimeline({
        ...document,
        providerJobs: [{
          id: 'image-job', nodeId: originalShot.id, workflowKind: 'editorial-collage',
          providerId: 'local-fixture', model: 'local-image', capability: 'text-to-image',
          status: 'completed', inputHash: 'input', idempotencyKey: 'image-job',
          estimatedCost: 0, attempt: 1, createdAt: document.createdAt, updatedAt: document.updatedAt,
        }],
        assets: [{ id: 'image-asset', assetId: 'image', kind: 'image', providerJobId: 'image-job', createdAt: document.createdAt }],
        beats: document.beats.map((beat, index) => index === 0 ? {
          ...beat, shots: [{ ...originalShot, providerJobId: 'image-job', layers: originalShot.layers.map((layer) => ({ ...layer, assetVersionId: 'image-asset' })) }],
        } : beat),
      });
      document = parseEditorialCollagePipelineData((await database.saveEditorialCollageTask({
        id: document.id, expectedUpdatedAt: document.updatedAt, document: generated,
      })).pipelineData);
      const edits: Array<(current: EditorialCollagePipelineData) => EditorialCollagePipelineData> = [
        (current) => splitEditorialShot(current, current.beats[0].shots[0].id, 1_000),
        (current) => reorderEditorialShot(current, current.beats[0].shots[0].id, 1),
        (current) => mergeEditorialShots(current, current.beats[0].shots[0].id, current.beats[0].shots[1].id),
        (current) => insertEditorialShot(current, current.beats[0].id),
        (current) => removeEditorialShot(current, current.beats[0].shots[1].id),
        (current) => editEditorialShotMotion(current, current.beats[0].shots[0].id, { kind: 'camera-frame', index: 0, patch: { zoom: 1.12 } }),
      ];
      for (const edit of edits) {
        const edited = edit(document);
        expect(edited.updatedAt).toBe(document.updatedAt);
        const saved = await database.saveEditorialCollageTask({
          id: edited.id, expectedUpdatedAt: edited.updatedAt, document: edited,
        });
        const persisted = parseEditorialCollagePipelineData(saved.pipelineData);
        expect(persisted.beats).toEqual(edited.beats);
        expect(persisted.timeline).toEqual(edited.timeline);
        expect(persisted.providerJobs).toEqual(generated.providerJobs);
        expect(persisted.assets).toEqual(generated.assets);
        expect(persisted.beats[0].shots.every((shot) => !shot.providerJobId)).toBe(true);
        expect(persisted.beats[0].shots.flatMap((shot) => shot.layers).every((layer) => layer.assetVersionId === 'image-asset')).toBe(true);
        expect(Date.parse(persisted.updatedAt)).toBeGreaterThan(Date.parse(document.updatedAt));
        await expect(database.saveEditorialCollageTask({
          id: edited.id, expectedUpdatedAt: edited.updatedAt, document: edited,
        })).rejects.toThrow(/EDITORIAL_COLLAGE_STALE_WRITE/u);
        document = persisted;
      }
    } finally {
      await database.close();
    }
  });
});
