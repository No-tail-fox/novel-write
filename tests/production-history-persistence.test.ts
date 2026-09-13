import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileDatabase } from '../src/shared/storage';
import { editorialCollagePipelineSchema, parseEditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { motionComicPipelineSchema, parseMotionComicPipelineData } from '../src/shared/motion-comic';
import { MAX_PRODUCTION_HISTORY_ITEMS } from '../src/shared/production-history';
import { ipcInputSchemas } from '../src/shared/ipc-contract';
import type { ProductionAssetVersion, ProductionProviderJob } from '../src/shared/production-workflow';

describe('long production history persistence', () => {
  it.each(['editorial-collage', 'motion-comic'] as const)('enforces the advertised limit on all three %s history arrays', (kind) => {
    const schema = kind === 'editorial-collage' ? editorialCollagePipelineSchema : motionComicPipelineSchema;
    const createdAt = '2026-09-08T12:00:00.000Z';
    const fixtures = {
      assets: { id: 'asset', assetId: 'history', kind: 'image', createdAt, selected: false, pinned: false },
      providerJobs: { id: 'job', workflowKind: kind, nodeId: 'shot', providerId: 'local', model: 'fixture', capability: 'text-to-image', status: 'completed', inputHash: 'hash', idempotencyKey: 'key', estimatedCost: 0, attempt: 1, createdAt, updatedAt: createdAt },
      qualityReports: { id: 'report', workflowKind: kind, stage: 'export', status: 'passed', checks: [], createdAt },
    };
    for (const key of ['assets', 'providerJobs', 'qualityReports'] as const) {
      const records = Array.from({ length: MAX_PRODUCTION_HISTORY_ITEMS }, (_, index) => ({ ...fixtures[key], id: `${key}-${index}` }));
      expect(schema.shape[key].safeParse(records).success, key).toBe(true);
      expect(schema.shape[key].safeParse([...records, { ...fixtures[key], id: 'overflow' }]).success, key).toBe(false);
    }
  });

  it.each(['editorial-collage', 'motion-comic'] as const)('retains three rounds of 500-shot media history in %s across restart', async (kind) => {
    const directory = await mkdtemp(join(tmpdir(), 'production-history-'));
    const path = join(directory, 'data.db');
    let database = await FileDatabase.open(path);
    try {
      const task = kind === 'editorial-collage'
        ? await database.createEditorialCollageTask({ title: '历史容量验收', sourceText: '全部历史版本保留。' })
        : await database.createMotionComicTask({ title: '历史容量验收', premise: '全部历史版本保留。' });
      const document = kind === 'editorial-collage' ? parseEditorialCollagePipelineData(task.pipelineData) : parseMotionComicPipelineData(task.pipelineData);
      const assets: ProductionAssetVersion[] = [];
      const providerJobs: ProductionProviderJob[] = [];
      for (let round = 0; round < 3; round += 1) {
        for (let shot = 0; shot < 500; shot += 1) {
          for (const capability of ['image', 'audio', 'video'] as const) {
            const id = `${round}-${shot}-${capability}`;
            providerJobs.push({ id: `job-${id}`, workflowKind: kind, nodeId: `shot-${shot}`, providerId: 'local-qa', model: 'fixture', capability,
              status: 'completed', inputHash: id, idempotencyKey: id, estimatedCost: 0, actualCost: 0, attempt: round + 1, createdAt: document.createdAt, updatedAt: document.createdAt });
            assets.push({ id: `asset-${id}`, assetId: `shot-${shot}-${capability}`, kind: capability, localPath: `I:/qa/${id}`, providerJobId: `job-${id}`,
              prompt: `第 ${round + 1} 轮镜头 ${shot + 1}`, selected: round === 2, pinned: false, createdAt: document.createdAt });
          }
        }
      }
      const timeline = document.workflowKind === 'editorial-collage' ? document.timeline! : document.episodes[0].timeline;
      const audio = assets.filter((asset) => asset.kind === 'audio' && asset.selected);
      timeline.audioAssetVersionIds = audio.map((asset) => asset.id);
      timeline.audioClips = audio.map((asset, index) => ({ id: `audio-clip-${index}`, shotId: timeline.clips[0].shotId, assetVersionId: asset.id, trackType: 'ambience', startMs: 0, durationMs: 1000 }));
      const input = { id: document.id, expectedUpdatedAt: document.updatedAt, document: { ...document, assets, providerJobs } };
      const saved = kind === 'editorial-collage'
        ? await database.saveEditorialCollageTask(ipcInputSchemas['editorial-collage:save'].parse(input))
        : await database.saveMotionComicTask(ipcInputSchemas['motion-comic:save'].parse(input));
      await database.close();
      database = await FileDatabase.open(path);
      const reopened = (await database.getTaskDetail(task.id))!;
      expect(reopened.pipelineData).toBe(saved.pipelineData);
      const restored = kind === 'editorial-collage' ? parseEditorialCollagePipelineData(reopened.pipelineData) : parseMotionComicPipelineData(reopened.pipelineData);
      expect(restored.assets).toEqual(assets);
      expect(restored.providerJobs).toEqual(providerJobs);
      expect(restored.assets.filter((asset) => asset.selected)).toHaveLength(1500);
      expect(restored.assets).toHaveLength(4500);
      const restoredTimeline = restored.workflowKind === 'editorial-collage' ? restored.timeline! : restored.episodes[0].timeline;
      expect(restoredTimeline.audioAssetVersionIds).toEqual(timeline.audioAssetVersionIds);
      expect(restoredTimeline.audioClips).toEqual(timeline.audioClips);
    } finally {
      await database.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
