import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMotionComicShotVideo } from '../electron/motion-comic-shot-video';
import { recoverMotionComicVideoSubmission } from '../electron/motion-comic-video-recovery';
import { createMotionComicDraft, createMotionComicStarterProject, parseMotionComicPipelineData } from '../src/shared/motion-comic';
import { defaultConfig } from '../src/shared/config';
import type { FileDatabase } from '../src/shared/storage';
import type { Task } from '../src/shared/types';
import type { ProductionHistoryReservation } from '../src/shared/production-history';
import { directorGenerateShotVideoRequestSchema } from '../src/shared/director-render';
import { adoptMotionComicVideoVersion } from '../src/shared/motion-comic-video-versions';
import { validateDirectorGenerateShotVideoRequest } from '../src/shared/director-video-request';

const remote = vi.hoisted(() => ({ generate: vi.fn(), resume: vi.fn() }));
vi.mock('../src/shared/video-provider', async importOriginal => ({ ...await importOriginal<object>(), createConfiguredVideoProvider: () => remote }));
vi.mock('../electron/motion-comic-continuity-probe', () => ({ sampleMotionComicCutFrames: vi.fn() }));
const now = '2026-10-21T00:00:00.000Z';
const dirs: string[] = [];
afterEach(async () => { vi.resetAllMocks(); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'comic-candidate-')); dirs.push(dir);
  const path = join(dir, 'reference.png'); await writeFile(path, 'offline');
  let document = createMotionComicStarterProject(createMotionComicDraft({ id: 'candidate-service', title: 'candidate', premise: 'rain', now }));
  const shot = document.episodes[0].scenes[0].shots[0];
  shot.renderStrategy = 'remote-video'; delete shot.firstFrameAssetVersionId;
  shot.videoProduction = { version: 1, referenceMode: 'references', audioMode: 'post-mix' };
  for (const lookId of shot.characterLookIds) {
    const look = document.characters.flatMap(character => character.looks).find(look => look.id === lookId)!;
    const id = `ref-${lookId}`; look.referenceAssetVersionIds = [id];
    document.assets.push({ id, assetId: id, kind: 'image', localPath: path, pinned: true, selected: true, createdAt: now });
  }
  document.sceneAssets.find(scene => scene.id === shot.sceneAssetId)!.referenceAssetVersionIds = ['scene-ref']; shot.propAssetIds = [];
  document.assets.push({ id: 'scene-ref', assetId: 'scene-ref', kind: 'image', localPath: path, pinned: true, selected: true, createdAt: now });
  document.assets.push({ id: 'old-video', assetId: `shot-video-${shot.id}`, kind: 'video', localPath: path, selected: true, createdAt: now });
  document.providerJobs.push({ id: 'old-job', workflowKind: 'motion-comic', episodeId: shot.episodeId, nodeId: shot.id, providerId: 'old-provider', model: 'old-model', capability: 'image-to-video', status: 'completed', inputHash: 'old-hash', idempotencyKey: 'old-key', estimatedCost: 0, attempt: 1, createdAt: now, updatedAt: now });
  shot.videoJobId = 'old-job'; shot.videoAssetVersionId = 'old-video';
  document.episodes[0].timeline.clips.filter(c => c.shotId === shot.id).forEach(c => { c.assetVersionIds.push('old-video'); c.source = 'ai-video'; });
  const originalEpisodes = structuredClone(document.episodes);
  const config = structuredClone(defaultConfig); const provider = config.video.providers[0];
  Object.assign(provider, { enabled: true, baseUrl: 'https://offline.invalid', apiKey: 'fixture', model: 'fixture-model', modelPreset: 'custom', capabilities: ['reference-image'], maxDurationSec: 30 });
  config.video.automation.providerWhitelist = [provider.id]; config.video.automation.budgetLimit = 100;
  const task = () => ({ id: document.id, taskType: 'motion-comic', pipelineData: JSON.stringify(document) }) as Task;
  let revision = 0;
  const save = vi.fn(async (input) => {
    if (input.expectedUpdatedAt !== document.updatedAt) throw new Error('MOTION_COMIC_STALE_WRITE: stale');
    document = parseMotionComicPipelineData({ ...input.document, updatedAt: new Date(Date.parse(now) + ++revision).toISOString() });
    return task();
  });
  const database = { saveMotionComicTask: save, getTaskDetail: async () => task() } as unknown as FileDatabase;
  const normalizeSceneVideo = vi.fn(async (_source: string, output: string) => { await writeFile(output, 'offline-video'); return { width: 1080, height: 1920, durationMs: 60000 }; });
  const service = createMotionComicShotVideo({ getProjectRuntimeConfig: async () => config, taskWorkDir: () => dir, publishTaskUpsert: vi.fn(), normalizeSceneVideo });
  const generated = { path, providerId: provider.id, providerName: provider.name, model: provider.model, estimatedCost: 1, remoteTaskId: 'remote-id' };
  remote.generate.mockImplementation(async request => { await request.onSubmitted('remote-id'); return generated; });
  remote.resume.mockResolvedValue(generated);
  const run = (adoption?: 'candidate' | 'automatic') => service.generateMotionComicShotVideo(database, task(), { id: document.id, shotId: shot.id, expectedUpdatedAt: document.updatedAt, adoption }, { consume: vi.fn() } as unknown as ProductionHistoryReservation);
  const unchanged = () => { expect(document.episodes).toEqual(originalEpisodes); expect(document.assets.find(a => a.id === 'old-video')!.selected).toBe(true); };
  const recover = () => service.recoverMotionComicShotVideo(database, task(), { id: document.id, shotId: shot.id, expectedUpdatedAt: document.updatedAt }, { consume: vi.fn() } as unknown as ProductionHistoryReservation);
  return { run, recover, service, config, database, current: () => document, shotId: shot.id, unchanged, save, generated, normalizeSceneVideo };
}

describe('motion-comic candidate video backend (offline)', () => {
  it('settles an inactive unknown request under the shared lock while excluding concurrent submission', async () => {
    const f = await fixture();
    remote.generate.mockRejectedValueOnce(new Error('VIDEO_PROVIDER_HTTP_ERROR: unknown transport failure'));
    await expect(f.run('candidate')).rejects.toThrow();
    const d = f.current(); const job = d.providerJobs.at(-1)!;
    expect(job.status).toBe('running');
    expect(f.service.isActive(d.id, f.shotId)).toBe(false);
    const result = await f.service.withMotionComicShotVideoRecoveryLock(d.id, f.shotId, async () => {
      await expect(f.run('candidate')).rejects.toThrow('DIRECTOR_VIDEO_REQUEST_ACTIVE');
      return recoverMotionComicVideoSubmission({ id: d.id, shotId: f.shotId, jobId: job.id, expectedUpdatedAt: d.updatedAt, action: 'confirm-not-submitted', confirmedNotSubmitted: true }, {
        database: f.database, isActive: () => false, publishTaskUpsert: vi.fn(async () => null),
      });
    });
    expect(result.document.providerJobs.find(j => j.id === job.id)?.status).toBe('failed');
    expect(remote.generate).toHaveBeenCalledTimes(1);
    expect(f.service.isActive(d.id, f.shotId)).toBe(false);
  });
  it('strictly accepts optional adoption and rejects invalid values', () => {
    const input = { id: 'a', shotId: 'b', expectedUpdatedAt: now };
    for (const adoption of ['candidate', 'automatic'] as const) {
      expect(directorGenerateShotVideoRequestSchema.parse({ ...input, adoption }).adoption).toBe(adoption);
      expect(validateDirectorGenerateShotVideoRequest({ ...input, adoption }).adoption).toBe(adoption);
    }
    for (const adoption of ['wrong', null, 1]) {
      expect(() => directorGenerateShotVideoRequestSchema.parse({ ...input, adoption })).toThrow();
      expect(() => validateDirectorGenerateShotVideoRequest({ ...input, adoption })).toThrow();
    }
  });
  it('preserves old selection and timeline during submission and after success', async () => {
    const f = await fixture();
    remote.generate.mockImplementation(async request => { f.unchanged(); await request.onSubmitted('remote-id'); return f.generated; });
    const { result } = await f.run('candidate'); f.unchanged();
    expect(f.current().assets.find(a => a.id === result.videoAssetVersionId)?.selected).toBe(false);
    expect(f.current().providerJobs.at(-1)).toMatchObject({ id: result.videoJobId, status: 'completed', videoAdoption: 'candidate' });
  });
  it('preserves old bindings on terminal failure', async () => {
    const f = await fixture(); remote.generate.mockRejectedValue(new Error('VIDEO_PROVIDER_JOB_FAILED: failed'));
    await expect(f.run('candidate')).rejects.toThrow(); f.unchanged();
    expect(f.current().providerJobs.at(-1)?.status).toBe('failed');
  });
  it('blocks unknown submissions without another paid call', async () => {
    const f = await fixture(); remote.generate.mockRejectedValue(new Error('network timeout'));
    await expect(f.run('candidate')).rejects.toThrow(); f.unchanged();
    await expect(f.run()).rejects.toThrow('SUBMIT_STATE_UNKNOWN');
    expect(remote.generate).toHaveBeenCalledTimes(1); expect(remote.resume).not.toHaveBeenCalled();
  });
  it('resumes candidate with durable intent even when retry omits adoption', async () => {
    const f = await fixture(); remote.generate.mockImplementation(async request => { await request.onSubmitted('remote-id'); throw new Error('network timeout'); });
    await expect(f.run('candidate')).rejects.toThrow();
    const { result } = await f.run(); f.unchanged();
    expect(remote.generate).toHaveBeenCalledTimes(1); expect(remote.resume).toHaveBeenCalledTimes(1);
    expect(remote.resume).toHaveBeenCalledWith('remote-id', { estimatedCost: f.current().providerJobs.at(-1)!.estimatedCost });
    expect(f.current().assets.find(a => a.id === result.videoAssetVersionId)?.selected).toBe(false);
  });
  it.each([undefined, 'automatic'] as const)('keeps automatic adoption compatible (%s)', async adoption => {
    const f = await fixture(); const { result } = await f.run(adoption);
    expect(f.current().assets.find(a => a.id === result.videoAssetVersionId)?.selected).toBe(true);
    expect(f.current().episodes[0].scenes[0].shots[0].videoAssetVersionId).toBe(result.videoAssetVersionId);
    expect(f.current().assets.find(a => a.id === 'old-video')?.selected).toBe(false);
  });
  it('allows only one concurrent submission through the revision guard', async () => {
    const f = await fixture();
    const results = await Promise.allSettled([f.run('candidate'), f.run('candidate')]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(remote.generate).toHaveBeenCalledTimes(1); f.unchanged();
  });
  it('retries completion against a fresh revision without generating again', async () => {
    const f = await fixture();
    const save = f.save.getMockImplementation()!;
    let conflicted = false;
    f.save.mockImplementation(async input => {
      if (!conflicted && input.document.providerJobs.at(-1)?.status === 'completed') {
        conflicted = true;
        f.current().title = 'concurrent edit';
        f.current().updatedAt = '2026-10-22T00:00:00.000Z';
        throw new Error('MOTION_COMIC_STALE_WRITE: concurrent edit');
      }
      return save(input);
    });
    const { result } = await f.run();
    expect(conflicted).toBe(true);
    expect(f.current().title).toBe('concurrent edit');
    expect(f.current().assets.find(a => a.id === result.videoAssetVersionId)?.selected).toBe(true);
    expect(f.current().providerJobs.at(-1)?.status).toBe('completed');
    expect(remote.generate).toHaveBeenCalledTimes(1);
  });
  it('keeps the known remote task resumable when completion conflicts exhaust retries', async () => {
    const f = await fixture();
    const save = f.save.getMockImplementation()!;
    f.save.mockImplementation(async input => {
      if (input.document.providerJobs.at(-1)?.status === 'completed') throw new Error('MOTION_COMIC_STALE_WRITE: concurrent edit');
      return save(input);
    });
    await expect(f.run('candidate')).rejects.toMatchObject({ code: 'MOTION_COMIC_STALE_WRITE' });
    expect(f.current().providerJobs.at(-1)).toMatchObject({ status: 'running', remoteTaskId: 'remote-id' });
    f.save.mockImplementation(save);
    await f.run();
    expect(remote.generate).toHaveBeenCalledTimes(1);
    expect(remote.resume).toHaveBeenCalledTimes(1);
    f.unchanged();
  });
  it.each(['normalization', 'persistence'] as const)('resumes the paid remote result after a local %s failure', async failure => {
    const f = await fixture();
    if (failure === 'normalization') f.normalizeSceneVideo.mockRejectedValueOnce(new Error('ENOSPC: local disk full'));
    else {
      const save = f.save.getMockImplementation()!;
      let failed = false;
      f.save.mockImplementation(async input => {
        if (!failed && input.document.providerJobs.at(-1)?.status === 'completed') {
          failed = true;
          throw new Error('EIO: local database write failed');
        }
        return save(input);
      });
    }
    await expect(f.run('candidate')).rejects.toThrow();
    expect(f.current().providerJobs.at(-1)).toMatchObject({ status: 'running', remoteTaskId: 'remote-id' });
    await f.run();
    expect(remote.generate).toHaveBeenCalledTimes(1);
    expect(remote.resume).toHaveBeenCalledTimes(1);
    f.unchanged();
  });
  it.each([{ status: 400, expected: 'failed' }, { status: 429, expected: 'running' }, { status: 503, expected: 'running' }])('settles HTTP $status without confusing rejection with uncertain submission', async ({ status, expected }) => {
    const f = await fixture();
    remote.generate.mockRejectedValueOnce(Object.assign(new Error(`VIDEO_PROVIDER_HTTP_ERROR: HTTP ${status}: 存在未定义的参数`), { status }));
    await expect(f.run('candidate')).rejects.toMatchObject({ code: 'VIDEO_PROVIDER_HTTP_ERROR' });
    expect(f.current().providerJobs.at(-1)).toMatchObject({ status: expected, phase: 'prepared' });
    expect(f.current().providerJobs.at(-1)?.remoteTaskId).toBeUndefined();
    expect(remote.generate).toHaveBeenCalledTimes(1);
    f.unchanged();
  });
  it('keeps an explicitly invalid paid output terminal', async () => {
    const f = await fixture();
    f.normalizeSceneVideo.mockImplementationOnce(async (_source, output) => {
      await writeFile(output, 'too-short-video');
      return { width: 1080, height: 1920, durationMs: 1 };
    });
    await expect(f.run('candidate')).rejects.toMatchObject({ code: 'DIRECTOR_VIDEO_OUTPUT_TOO_SHORT' });
    expect(f.current().providerJobs.at(-1)?.status).toBe('failed');
  });
  it('does not complete or fail a job whose input binding was replaced', async () => {
    const f = await fixture(); remote.generate.mockImplementation(async request => {
      await request.onSubmitted('remote-id'); f.current().providerJobs.at(-1)!.inputHash = 'different-input'; return f.generated;
    });
    await expect(f.run('candidate')).rejects.toMatchObject({ code: 'DIRECTOR_VIDEO_JOB_INVALID' });
    f.unchanged(); expect(f.current().providerJobs.at(-1)?.status).toBe('running');
    expect(f.current().assets.filter(a => a.kind === 'video')).toHaveLength(1);
  });
  it('resumes legacy automatic jobs with no persisted adoption field', async () => {
    const f = await fixture(); remote.generate.mockImplementation(async request => {
      await request.onSubmitted('remote-id'); delete f.current().providerJobs.at(-1)!.videoAdoption; throw new Error('network timeout');
    });
    await expect(f.run()).rejects.toThrow();
    const { result } = await f.run('candidate');
    expect(f.current().assets.find(a => a.id === result.videoAssetVersionId)?.selected).toBe(true);
    expect(remote.generate).toHaveBeenCalledTimes(1); expect(remote.resume).toHaveBeenCalledTimes(1);
  });
  it('keeps rejected paid output reviewable, counts its estimate, and recovers without POST', async () => {
    const f = await fixture();
    f.normalizeSceneVideo.mockImplementation(async (_source, output) => { await writeFile(output, 'rejected-original'); return { width: 1920, height: 1080, durationMs: 60000 }; });
    await expect(f.run('automatic')).rejects.toMatchObject({ code: 'DIRECTOR_VIDEO_OUTPUT_RATIO_MISMATCH' });
    f.unchanged();
    const asset = f.current().assets.at(-1)!;
    expect(asset).toMatchObject({ selected: false, outputValidation: { status: 'rejected', expectedRatio: '9:16', width: 1920, height: 1080 } });
    expect(await readFile(asset.localPath!, 'utf8')).toBe('rejected-original');
    expect(() => adoptMotionComicVideoVersion(f.current(), asset.episodeId!, f.shotId, asset.id)).toThrow('输出校验未通过');
    f.config.video.automation.budgetLimit = 0.5;
    await expect(f.run('candidate')).rejects.toThrow('画幅为');
    await expect(f.recover()).rejects.toMatchObject({ code: 'DIRECTOR_VIDEO_OUTPUT_RATIO_MISMATCH' });
    expect(remote.generate).toHaveBeenCalledTimes(2); expect(remote.resume).toHaveBeenCalledTimes(1);
  });
  it('commits rejected synchronous output to the budget even without a remote task ID', async () => {
    const f = await fixture();
    f.config.video.providers[0].pricePerSecond = 1;
    f.config.video.automation.budgetLimit = 10;
    const { remoteTaskId: _remoteTaskId, ...synchronousResult } = f.generated;
    remote.generate.mockResolvedValue(synchronousResult);
    f.normalizeSceneVideo.mockImplementation(async (_source, output) => { await writeFile(output, 'wrong-ratio'); return { width: 1920, height: 1080, durationMs: 60000 }; });
    await expect(f.run('candidate')).rejects.toMatchObject({ code: 'DIRECTOR_VIDEO_OUTPUT_RATIO_MISMATCH' });
    const job = f.current().providerJobs.at(-1)!;
    expect(job).toMatchObject({ status: 'failed', phase: 'completed' });
    expect(job.remoteTaskId).toBeUndefined();
    expect(job.actualCost).toBeUndefined();
    expect(f.current().assets.at(-1)?.providerJobId).toBe(job.id);
    f.config.video.automation.budgetLimit = job.estimatedCost;
    await expect(f.run('candidate')).rejects.toThrow('超过剩余预算');
    expect(remote.generate).toHaveBeenCalledTimes(1);
  });
  it('retains a returned-result cost receipt when local normalization fails before creating an asset', async () => {
    const f = await fixture();
    f.config.video.providers[0].pricePerSecond = 1;
    f.config.video.automation.budgetLimit = 10;
    const { remoteTaskId: _remoteTaskId, ...synchronousResult } = f.generated;
    remote.generate.mockResolvedValue(synchronousResult);
    f.normalizeSceneVideo.mockRejectedValue(new Error('local decode failed'));
    await expect(f.run('candidate')).rejects.toThrow();
    const job = f.current().providerJobs.at(-1)!;
    expect(job).toMatchObject({ status: 'failed', phase: 'downloaded' });
    expect(job.remoteTaskId).toBeUndefined();
    expect(f.current().assets.some(asset => asset.providerJobId === job.id)).toBe(false);
    f.config.video.automation.budgetLimit = job.estimatedCost;
    await expect(f.run('candidate')).rejects.toThrow('超过剩余预算');
    expect(remote.generate).toHaveBeenCalledTimes(1);
  });
  it('does not reserve budget for a definitively rejected request with no result or task ID', async () => {
    const f = await fixture();
    f.config.video.providers[0].pricePerSecond = 1;
    f.config.video.automation.budgetLimit = 10;
    remote.generate.mockRejectedValueOnce(new Error('VIDEO_PROVIDER_JOB_FAILED: request rejected'));
    await expect(f.run('candidate')).rejects.toThrow();
    const rejected = f.current().providerJobs.at(-1)!;
    expect(rejected).toMatchObject({ status: 'failed', phase: 'prepared' });
    expect(rejected.remoteTaskId).toBeUndefined();
    f.config.video.automation.budgetLimit = rejected.estimatedCost;
    await expect(f.run('candidate')).resolves.toHaveProperty('result');
    expect(remote.generate).toHaveBeenCalledTimes(2);
  });
  it('records unpriced output as unknown rather than a zero-cost promise', async () => {
    const f = await fixture(); f.config.video.providers[0].pricePerSecond = 0;
    await f.run('candidate');
    expect(f.current().costSummary).toContain('费用未知，以服务商实际账单为准');
    expect(f.current().costSummary).not.toContain('预计 0.00');
  });
  it('serializes manual reconciliation against active requests and releases the lock', async () => {
    const f = await fixture(); let release!: () => void;
    const pending = f.service.withMotionComicShotVideoRecoveryLock(f.current().id, f.shotId, () => new Promise<void>(resolve => { release = resolve; }));
    expect(f.service.isActive(f.current().id, f.shotId)).toBe(true);
    await expect(f.run()).rejects.toThrow('REQUEST_ACTIVE');
    release(); await pending;
    expect(f.service.isActive(f.current().id, f.shotId)).toBe(false);
    await expect(f.recover()).rejects.toThrow('TASK_ID_REQUIRED');
    expect(remote.generate).not.toHaveBeenCalled();
  });
  it('keeps changed-input candidate only in history without clearing old bindings', async () => {
    const f = await fixture(); remote.generate.mockImplementation(async request => {
      await request.onSubmitted('remote-id'); f.current().episodes[0].scenes[0].shots[0].prompt += ' changed'; return f.generated;
    });
    await expect(f.run('candidate')).rejects.toMatchObject({ code: 'DIRECTOR_VIDEO_INPUT_CHANGED' });
    expect(f.current().assets.at(-1)?.selected).toBe(false);
    expect(f.current().assets.find(a => a.id === 'old-video')?.selected).toBe(true);
    expect(f.current().episodes[0].scenes[0].shots[0]).toMatchObject({ videoJobId: 'old-job', videoAssetVersionId: 'old-video' });
    expect(f.current().providerJobs.at(-1)?.status).toBe('completed');
  });
});
