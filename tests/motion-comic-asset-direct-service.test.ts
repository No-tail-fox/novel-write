import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMotionComicShotVideo } from '../electron/motion-comic-shot-video';
import { createMotionComicDraft, createMotionComicStarterProject } from '../src/shared/motion-comic';
import { defaultConfig } from '../src/shared/config';
import type { FileDatabase } from '../src/shared/storage';
import type { Task } from '../src/shared/types';
import type { ProductionHistoryReservation } from '../src/shared/production-history';

const now = '2026-10-21T00:00:00.000Z';
const dirs: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'comic-asset-direct-')); dirs.push(dir);
  const path = join(dir, 'reference.png'); await writeFile(path, 'offline-reference');
  const document = createMotionComicStarterProject(createMotionComicDraft({ id: 'direct-service', title: '资产直出', premise: '雨夜来信', now }));
  const shot = document.episodes[0].scenes[0].shots[0];
  shot.renderStrategy = 'remote-video'; delete shot.firstFrameAssetVersionId;
  shot.videoProduction = { version: 1, referenceMode: 'references', audioMode: 'post-mix' };
  for (const lookId of shot.characterLookIds) {
    const look = document.characters.flatMap(character => character.looks).find(look => look.id === lookId)!;
    const id = `ref-${lookId}`; look.referenceAssetVersionIds = [id];
    document.assets.push({ id, assetId: id, kind: 'image', localPath: path, pinned: true, selected: true, createdAt: now });
  }
  const scene = document.sceneAssets.find(scene => scene.id === shot.sceneAssetId)!;
  scene.referenceAssetVersionIds = ['scene-ref']; shot.propAssetIds = [];
  document.assets.push({ id: 'scene-ref', assetId: 'scene-ref', kind: 'image', localPath: path, pinned: true, selected: true, createdAt: now });
  const config = structuredClone(defaultConfig);
  const provider = config.video.providers[0];
  Object.assign(provider, { enabled: true, baseUrl: 'https://offline.invalid', apiKey: 'fixture-key', model: 'fixture-model', modelPreset: 'custom', capabilities: ['reference-image'], maxDurationSec: 30 });
  config.video.automation.providerWhitelist = [provider.id]; config.video.automation.budgetLimit = 100;
  const save = vi.fn().mockRejectedValue(new Error('OFFLINE_STOP_BEFORE_SUBMISSION'));
  const getProjectRuntimeConfig = vi.fn(async () => config);
  const fetch = vi.fn().mockRejectedValue(new Error('UNEXPECTED_NETWORK')); vi.stubGlobal('fetch', fetch);
  const service = createMotionComicShotVideo({ getProjectRuntimeConfig, taskWorkDir: () => dir, publishTaskUpsert: vi.fn(), normalizeSceneVideo: vi.fn() });
  const run = () => service.generateMotionComicShotVideo(
    { saveMotionComicTask: save } as unknown as FileDatabase,
    { id: document.id, pipelineData: JSON.stringify(document) } as Task,
    { id: document.id, shotId: shot.id, expectedUpdatedAt: document.updatedAt },
    { consume: vi.fn() } as unknown as ProductionHistoryReservation,
  );
  return { document, shot, provider, run, save, fetch, getProjectRuntimeConfig };
}

describe('asset-direct service preflight without paid submission', () => {
  it('accepts fixed references without frames and persists their exact input snapshot before submission', async () => {
    const { run, save, fetch } = await fixture();
    await expect(run()).rejects.toThrow('OFFLINE_STOP_BEFORE_SUBMISSION');
    expect(save).toHaveBeenCalledOnce();
    const job = save.mock.calls[0][0].document.providerJobs.at(-1);
    expect(job.status).toBe('running');
    const snapshot = JSON.parse(job.videoInputSnapshot);
    expect(snapshot.firstFrameAssetVersionId).toBeUndefined();
    expect(snapshot.submittedReferences.length).toBeGreaterThan(0);
    expect(snapshot.production.referenceMode).toBe('references');
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['missing-file', 'unsupported-provider', 'frames'] as const)('rejects %s before persistence or network', async kind => {
    const { document, shot, provider, run, save, fetch } = await fixture();
    if (kind === 'missing-file') document.assets.find(asset => asset.id === 'scene-ref')!.localPath += '.missing';
    if (kind === 'unsupported-provider') provider.capabilities = ['i2v'];
    if (kind === 'frames') shot.videoProduction!.referenceMode = 'frames';
    await expect(run()).rejects.toThrow(kind === 'missing-file' ? 'REFERENCE_MISSING' : kind === 'frames' ? 'FIRST_FRAME_REQUIRED' : 'PROVIDER_UNAVAILABLE');
    expect(save).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('retains unknown-submission protection even with valid frame-free references', async () => {
    const { document, shot, run, save, fetch, getProjectRuntimeConfig } = await fixture();
    document.providerJobs.push({ id: 'unknown', workflowKind: 'motion-comic', nodeId: shot.id, episodeId: shot.episodeId, providerId: 'fixture', model: 'fixture', capability: 'image-to-video', status: 'running', inputHash: 'old', idempotencyKey: 'old', estimatedCost: 1, attempt: 1, createdAt: now, updatedAt: now });
    await expect(run()).rejects.toThrow('SUBMIT_STATE_UNKNOWN');
    expect(getProjectRuntimeConfig).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
});
