import { describe, expect, it, vi } from 'vitest';
import { createReferenceBatchService, type ReferenceBatchDependencies } from '../electron/reference-batch-service';
import { createMotionComicDraft, createMotionComicStarterProject } from '../src/shared/motion-comic';
import type { DirectorBatchRecord } from '../src/shared/director-batch-persistence';
import type { ImageLabRecord, Task } from '../src/shared/types';
import { formatOpenAiImageProviderError } from '../src/shared/image-provider-error';
import { AppError, normalizeAppError, serializeAppErrorForBridge } from '../src/shared/app-error';

function fixture() {
  let document = createMotionComicStarterProject(createMotionComicDraft({ id: 'reference-qa', title: '来信', premise: '在邮局找到线索。', now: '2026-10-20T00:00:00.000Z' }));
  const batches = new Map<string, DirectorBatchRecord>();
  const records = new Map<string, ImageLabRecord>();
  let clock = 0;
  let casFailures = 0;
  const db = {
    getTaskDetail: async () => ({ id: document.id, taskType: 'motion-comic', pipelineData: JSON.stringify(document) } as Task),
    saveMotionComicTask: vi.fn(async (input: any) => {
      if (casFailures-- > 0) throw new Error('MOTION_COMIC_STALE_WRITE');
      if (input.expectedUpdatedAt !== document.updatedAt) throw new Error('MOTION_COMIC_STALE_WRITE');
      document = { ...input.document, updatedAt: new Date(1800000000000 + ++clock).toISOString() };
      return db.getTaskDetail();
    }),
    createDirectorBatch: async (input: any) => { const b = { ...input, id: `batch-${batches.size}`, createdAt: 'now', updatedAt: `${++clock}`, pauseRequested: false, cancelRequested: false, recoveryRequired: false, recoveryReason: '' }; batches.set(b.id, structuredClone(b)); return b; },
    getDirectorBatch: async (id: string) => structuredClone(batches.get(id) ?? null),
    listDirectorBatches: async () => [...batches.values()].map(b => structuredClone(b)),
    updateDirectorBatch: async (id: string, patch: any) => { const prior = batches.get(id)!; if (patch.expectedUpdatedAt && prior.updatedAt !== patch.expectedUpdatedAt) throw new Error('DIRECTOR_BATCH_CONFLICT'); const next = { ...prior, ...patch, updatedAt: `${++clock}` }; batches.set(id, structuredClone(next)); return next; },
    getImageLabRecordDetail: async (id: string) => records.get(id) ?? null,
  };
  const provider = { profileId: 'image-profile', connected: true, provider: 'gpt_image' as const, supportsReferenceImages: true, maxReferenceImages: 10, label: 'fake', model: 'fake', resolution: '2K' as const, quality: 'high' as const };
  const generate = vi.fn(async (input: any, _options: { recoveryOnly: boolean }) => {
    const record = { ...input, id: input.id, provider: 'gpt_image', imagePath: `fixtures/${input.id}.png`, status: 'generated', errorMessage: '', referenceImagePaths: [], createdAt: document.createdAt, finishedAt: document.updatedAt } as ImageLabRecord;
    records.set(record.id, record); return record;
  });
  const deps: ReferenceBatchDependencies = { getDb: async () => db, getProvider: async () => ({ provider, configurationFingerprint: 'model-v1' }), generate, authorize: async () => {}, hashFile: async () => 'hash', publishProject: async () => {}, publishBatch: async () => {}, reserveProject: () => () => {} };
  const service = createReferenceBatchService(deps);
  const submit = () => service.submit({ projectId: document.id, expectedProjectUpdatedAt: document.updatedAt, selectionMode: 'selected', concurrency: 2, targets: [{ kind: 'scene', id: document.sceneAssets[0].id }, { kind: 'prop', id: document.props[0].id }] });
  return { service, deps, db, generate, batches, records, submit, get document() { return document; }, conflict: () => { casFailures = 2; } };
}

describe('persistent reference batch main-process host', () => {
  it('submits three separate look views, merges unrelated edits and retains unadopted roles', async () => {
    const f = fixture();
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const original = f.generate.getMockImplementation()!;
    f.generate.mockImplementation(async (input, options) => { entered(); await gate; return original(input, options); });
    const look = f.document.characters[0].looks[0];
    look.generationReferenceImagePaths = ['fixtures/user-input.png'];
    const batch = await f.service.submit({ projectId: f.document.id, expectedProjectUpdatedAt: f.document.updatedAt,
      selectionMode: 'selected', concurrency: 3, targets: [{ kind: 'look', id: look.id }] });
    expect(batch.nodes.map(node => node.reference?.view)).toEqual(['front', 'side', 'back']);
    expect(new Set(batch.nodes.map(node => node.reference?.requestId)).size).toBe(3);
    expect(new Set(batch.nodes.map(node => node.reference?.inputSnapshot.prompt)).size).toBe(3);
    await started;
    expect(f.document.assets).toHaveLength(0);
    f.document.series.premise = 'A concurrent story edit';
    f.conflict();
    release(); await f.service.waitForIdle(batch.id);
    expect(f.document.series.premise).toBe('A concurrent story edit');
    expect(f.document.assets.map(asset => asset.referenceRole).sort()).toEqual(['back', 'front', 'side']);
    expect(f.document.assets.every(asset => !asset.pinned && !asset.selected)).toBe(true);
    expect(f.document.characters[0].looks[0].referenceAssetVersionIds).toHaveLength(3);
    expect(f.generate.mock.calls.every(([input]) => input.referenceImagePaths[0] === 'fixtures/user-input.png')).toBe(true);
    await f.service.control({ id: batch.id, action: 'reconcile' }); await f.service.waitForIdle(batch.id);
    expect(f.generate).toHaveBeenCalledTimes(3);
  });
  it('retains the front in history and does not submit dependent views after the look is removed', async () => {
    const f = fixture(); const original = f.generate.getMockImplementation()!;
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    f.generate.mockImplementation(async (input, options) => { entered(); await gate; return original(input, options); });
    const batch = await f.service.submit({ projectId: f.document.id, expectedProjectUpdatedAt: f.document.updatedAt,
      selectionMode: 'selected', concurrency: 3, targets: [{ kind: 'look', id: f.document.characters[0].looks[0].id }] });
    await started;
    expect(f.generate).toHaveBeenCalledTimes(1);
    const removedId = f.document.characters[0].looks[0].id;
    f.document.characters[0].looks[0].id = 'replacement-look';
    for (const episode of f.document.episodes) for (const scene of episode.scenes) for (const shot of scene.shots) shot.characterLookIds = shot.characterLookIds.filter(id => id !== removedId);
    release(); await f.service.waitForIdle(batch.id);
    expect(f.records.size).toBe(1);
    expect(f.document.assets).toHaveLength(0);
    expect(f.batches.get(batch.id)?.nodes.every(node => node.reference?.applyState === 'stale')).toBe(true);
  });
  it('persists front dependencies and derives side/back from the generated identity before POST', async () => {
    const f = fixture();
    const look = f.document.characters[0].looks[0];
    const original = f.generate.getMockImplementation()!;
    f.generate.mockImplementation(async (input, options) => {
      const saved = [...f.batches.values()][0];
      const node = saved.nodes.find(n => n.reference?.requestId === input.id)!;
      if (node.reference?.view !== 'front') {
        const front = saved.nodes[0];
        expect(node.dependencies).toEqual([front.id]);
        expect(front.reference?.submissionState).toBe('resolved');
        expect(node.reference?.identityAnchor).toEqual({ requestId: front.reference?.requestId, path: `fixtures/${front.reference?.requestId}.png`, sha256: 'hash' });
        expect(node.reference?.inputSnapshot).toEqual(input);
        expect(input.smartMode).toBe('reference-edit');
        expect(input.referenceImagePaths).toEqual([`fixtures/${front.reference?.requestId}.png`]);
      }
      return original(input, options);
    });
    const batch = await f.service.submit({ projectId: f.document.id, expectedProjectUpdatedAt: f.document.updatedAt, selectionMode: 'selected', concurrency: 3, targets: [{ kind: 'look', id: look.id }] });
    expect(batch.nodes[1].dependencies).toEqual([batch.nodes[0].id]);
    expect(batch.nodes[2].dependencies).toEqual([batch.nodes[0].id]);
    await f.service.waitForIdle(batch.id);
    expect(f.generate).toHaveBeenCalledTimes(3);
    expect(f.batches.get(batch.id)?.status).toBe('completed');
    expect(f.document.assets).toHaveLength(3);
  });
  it('reconciles only the unknown front, then resumes derived views using that saved result', async () => {
    const f = fixture();
    f.generate.mockRejectedValueOnce(new Error('unknown transport'));
    const batch = await f.service.submit({ projectId: f.document.id, expectedProjectUpdatedAt: f.document.updatedAt, selectionMode: 'selected', concurrency: 3, targets: [{ kind: 'look', id: f.document.characters[0].looks[0].id }] });
    await f.service.waitForIdle(batch.id);
    expect(f.generate).toHaveBeenCalledTimes(1);
    await f.service.control({ id: batch.id, action: 'reconcile' }); await f.service.waitForIdle(batch.id);
    expect(f.generate).toHaveBeenCalledTimes(2);
    expect(f.generate.mock.calls[1][1].recoveryOnly).toBe(true);
    const saved = f.batches.get(batch.id)!;
    expect(saved.nodes[0].status).toBe('completed');
    expect(saved.nodes.slice(1).every(n => n.reference?.submissionState === 'not-submitted')).toBe(true);
    await f.service.control({ id: batch.id, action: 'resume' }); await f.service.waitForIdle(batch.id);
    expect(f.generate).toHaveBeenCalledTimes(4);
    expect(f.generate.mock.calls.slice(2).every(([input]) => input.referenceImagePaths[0] === `fixtures/${saved.nodes[0].reference?.requestId}.png`)).toBe(true);
    expect(f.batches.get(batch.id)?.status).toBe('completed');
  });
  it('reconciliation never dispatches not-submitted nodes; resume revalidates changed definitions', async () => {
    const f = fixture();
    const batch = await f.submit(); await f.service.waitForIdle(batch.id);
    const saved = f.batches.get(batch.id)!;
    saved.status = 'paused';
    const node = saved.nodes[0]; node.status = 'pending'; node.reference!.submissionState = 'not-submitted'; node.reference!.requestId = 'never-posted'; node.reference!.inputSnapshot.id = 'never-posted';
    f.document.sceneAssets[0].prompt += ' edited';
    await f.service.control({ id: batch.id, action: 'reconcile' }); await f.service.waitForIdle(batch.id);
    expect(f.generate).toHaveBeenCalledTimes(2);
    expect(f.batches.get(batch.id)?.nodes[0].status).toBe('pending');
    await f.service.control({ id: batch.id, action: 'resume' }); await f.service.waitForIdle(batch.id);
    expect(f.generate).toHaveBeenCalledTimes(2);
    expect(f.batches.get(batch.id)?.nodes[0].reference?.applyState).toBe('stale');
  });
  it('pauses dispatch while an issued call drains and resumes the remaining original targets', async () => {
    const f = fixture();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const original = f.generate.getMockImplementation()!;
    f.generate.mockImplementationOnce(async (input, options) => { entered(); await gate; return original(input, options); });
    const batch = await f.service.submit({ projectId: f.document.id, expectedProjectUpdatedAt: f.document.updatedAt, selectionMode: 'selected', concurrency: 1, targets: [{ kind: 'scene', id: f.document.sceneAssets[0].id }, { kind: 'prop', id: f.document.props[0].id }] });
    await started;
    await f.service.control({ id: batch.id, action: 'pause' });
    release();
    // Persist notification gives a deterministic boundary after the first item has applied.
    await vi.waitFor(() => expect(f.document.assets).toHaveLength(1));
    expect(f.generate).toHaveBeenCalledTimes(1);
    await f.service.control({ id: batch.id, action: 'resume' }); await f.service.waitForIdle(batch.id);
    expect(f.document.assets).toHaveLength(2);
  });
  it('reconciles an unknown request in a paused live runner without dispatching waiting work', async () => {
    const f = fixture();
    let entered!: () => void; let release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    f.generate.mockImplementationOnce(async () => { entered(); await gate; throw new Error('unknown transport'); });
    const batch = await f.service.submit({ projectId: f.document.id, expectedProjectUpdatedAt: f.document.updatedAt, selectionMode: 'selected', concurrency: 1, targets: [{ kind: 'scene', id: f.document.sceneAssets[0].id }, { kind: 'prop', id: f.document.props[0].id }] });
    await started; await f.service.control({ id: batch.id, action: 'pause' }); release();
    await vi.waitFor(() => expect(f.batches.get(batch.id)?.nodes[0].reference?.submissionState).toBe('unknown'));
    await f.service.control({ id: batch.id, action: 'reconcile' }); await f.service.waitForIdle(batch.id);
    expect(f.generate).toHaveBeenCalledTimes(2);
    expect(f.generate.mock.calls[1][1].recoveryOnly).toBe(true);
    expect(f.batches.get(batch.id)?.nodes[1].status).toBe('pending');
    expect(f.document.assets).toHaveLength(1);
  });
  it.each(['throw', 'failed-record'] as const)('settles an explicit submission 404 as rejected (%s) and permits a new batch', async mode => {
    const f = fixture();
    const message = formatOpenAiImageProviderError({ status: 404, operation: 'generation', model: 'image',
      bodyText: JSON.stringify({ error: { message: 'Invalid URL (POST /v1/v1/images/generations)', type: 'invalid_request_error', param: '', code: '' } }) });
    f.generate.mockImplementation(async input => {
      if (mode === 'throw') throw new Error(message);
      const record = { ...input, status: 'failed', imagePath: '', errorMessage: message } as ImageLabRecord;
      f.records.set(record.id, record);
      return record;
    });
    const batch = await f.submit(); await f.service.waitForIdle(batch.id);
    const settled = f.batches.get(batch.id)!;
    expect(settled).toMatchObject({ status: 'failed', recoveryRequired: false, recoveryReason: '' });
    expect(settled.nodes.every(node => node.status === 'failed' && node.reference?.submissionState === 'rejected' && node.error === message)).toBe(true);
    expect(f.generate).toHaveBeenCalledTimes(2);
    expect(f.document.assets).toHaveLength(0);
    await f.service.control({ id: batch.id, action: 'reconcile' }); await f.service.waitForIdle(batch.id);
    await f.service.control({ id: batch.id, action: 'resume' }); await f.service.waitForIdle(batch.id);
    expect(f.batches.get(batch.id)).toMatchObject({ status: 'failed', recoveryRequired: false });
    expect(f.batches.get(batch.id)?.nodes.every(node => node.status === 'failed' && node.reference?.submissionState === 'rejected')).toBe(true);
    expect(f.generate).toHaveBeenCalledTimes(2);
    const next = await f.submit(); await f.service.waitForIdle(next.id);
    expect(next.id).not.toBe(batch.id);
    expect(f.generate).toHaveBeenCalledTimes(4);
    expect(f.generate.mock.calls.every(([, options]) => !options.recoveryOnly)).toBe(true);
  });
  it.each([
    'Image provider API error (502): lost upstream response',
    'Image provider async poll error (404): task not found',
    'Image provider request timed out after 180000ms.',
    'connection lost after POST',
  ])('keeps ambiguous or polling failures paused without retry: %s', async message => {
    const f = fixture();
    f.generate.mockRejectedValue(new Error(message));
    const batch = await f.submit(); await f.service.waitForIdle(batch.id);
    expect(f.batches.get(batch.id)).toMatchObject({ status: 'paused', recoveryRequired: true });
    expect(f.batches.get(batch.id)?.nodes.every(node => node.reference?.submissionState === 'unknown')).toBe(true);
    expect(f.generate).toHaveBeenCalledTimes(2);
    await expect(f.service.control({ id: batch.id, action: 'resume' })).rejects.toMatchObject({ code: 'REFERENCE_BATCH_RECONCILE_REQUIRED', message: expect.stringContaining('先点击“恢复查询”') });
    await expect(f.submit()).rejects.toMatchObject({ code: 'REFERENCE_BATCH_PROJECT_BUSY' });
    expect(f.generate).toHaveBeenCalledTimes(2);
  });
  it('blocks a new scene batch while a character batch is paused with an actionable IPC error and no new work', async () => {
    const f = fixture();
    f.generate.mockRejectedValueOnce(new Error('connection lost after POST'));
    const characterBatch = await f.service.submit({ projectId: f.document.id, expectedProjectUpdatedAt: f.document.updatedAt,
      selectionMode: 'selected', targets: [{ kind: 'look', id: f.document.characters[0].looks[0].id }] });
    await f.service.waitForIdle(characterBatch.id);
    expect(f.batches.get(characterBatch.id)).toMatchObject({ status: 'paused', recoveryRequired: true });
    expect(f.generate).toHaveBeenCalledTimes(1);
    const before = structuredClone([...f.batches.values()]);
    const create = vi.spyOn(f.db, 'createDirectorBatch');
    const failure = await f.service.submit({ projectId: f.document.id, expectedProjectUpdatedAt: f.document.updatedAt,
      selectionMode: 'selected', targets: [{ kind: 'scene', id: f.document.sceneAssets[0].id }] }).catch(error => error);
    expect(failure).toBeInstanceOf(AppError);
    expect(failure).toMatchObject({ code: 'REFERENCE_BATCH_PROJECT_BUSY', retryable: false });
    const bridged = normalizeAppError(new Error(serializeAppErrorForBridge(failure)), { code: 'IPC_HANDLER_FAILED', message: '请求处理失败。' });
    expect(bridged.code).toBe('REFERENCE_BATCH_PROJECT_BUSY');
    expect(bridged.message).toContain('恢复查询并完成当前批次');
    expect(bridged.message).toContain('取消当前批次');
    expect(bridged.message).toContain('请勿重复点击提交');
    expect(create).not.toHaveBeenCalled();
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect([...f.batches.values()]).toEqual(before);
    expect(f.records.size).toBe(0);
  });
  it.each([
    ['stale', 'MOTION_COMIC_STALE_WRITE', '刷新项目'],
    ['empty', 'REFERENCE_BATCH_TARGET_LIMIT', '请选择'],
    ['duplicate', 'REFERENCE_BATCH_DUPLICATE_TARGET', '取消重复选择'],
    ['missing', 'MOTION_COMIC_REFERENCE_TARGET_MISSING', '重新选择'],
  ] as const)('rejects %s submission before creating a batch or calling the provider', async (kind, code, message) => {
    const f = fixture();
    const target = { kind: 'scene' as const, id: kind === 'missing' ? 'removed-scene' : f.document.sceneAssets[0].id };
    const create = vi.spyOn(f.db, 'createDirectorBatch');
    await expect(f.service.submit({ projectId: f.document.id,
      expectedProjectUpdatedAt: kind === 'stale' ? 'old-version' : f.document.updatedAt,
      selectionMode: 'selected', targets: kind === 'empty' ? [] : kind === 'duplicate' ? [target, target] : [target],
    })).rejects.toMatchObject({ code, message: expect.stringContaining(message) });
    expect(create).not.toHaveBeenCalled();
    expect(f.generate).not.toHaveBeenCalled();
    expect(f.batches.size).toBe(0);
  });
  it('does not settle a previously unknown request from a 404 during recovery', async () => {
    const f = fixture();
    f.generate.mockRejectedValueOnce(new Error('connection lost after POST'));
    const batch = await f.submit(); await f.service.waitForIdle(batch.id);
    f.generate.mockRejectedValue(new Error('Image provider API error (404): Invalid URL (POST /v1/v1/images/generations)'));
    await f.service.control({ id: batch.id, action: 'reconcile' }); await f.service.waitForIdle(batch.id);
    expect(f.batches.get(batch.id)).toMatchObject({ status: 'paused', recoveryRequired: true });
    expect(f.batches.get(batch.id)?.nodes[0].reference?.submissionState).toBe('unknown');
    expect(f.generate).toHaveBeenCalledTimes(3);
    expect(f.generate.mock.calls[2][1].recoveryOnly).toBe(true);
  });
  it('drains submissions during shutdown and rejects new work', async () => {
    const f = fixture();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    f.deps.getProvider = async () => { await gate; return { provider: { profileId: 'fake', connected: true, provider: 'gpt_image', supportsReferenceImages: true, maxReferenceImages: 10, label: 'fake', model: 'fake', resolution: '2K', quality: 'high' }, configurationFingerprint: 'fake' }; };
    const pending = f.submit();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const stopping = f.service.stop(); release();
    await Promise.allSettled([pending, stopping]);
    expect(f.generate).not.toHaveBeenCalled();
    expect(f.service.busy).toBe(false);
    await expect(f.submit()).rejects.toMatchObject({ code: 'REFERENCE_BATCH_STOPPING' });
  });
  it('runs independently of a renderer, preserves explicit targets and CAS retries, never fixes candidates', async () => {
    const f = fixture(); f.conflict();
    const batch = await f.submit();
    await f.service.waitForIdle(batch.id);
    expect(f.batches.get(batch.id)?.status).toBe('completed');
    expect(f.document.assets).toHaveLength(2);
    expect(f.document.assets.every(a => !a.pinned && !a.selected)).toBe(true);
    expect(f.batches.get(batch.id)?.nodes.every(n => !n.shotId && n.reference?.applyState === 'applied')).toBe(true);
    expect(f.generate).toHaveBeenCalledTimes(2);
    expect(f.generate.mock.calls.every(call => !call[1].recoveryOnly)).toBe(true);
    await f.service.control({ id: batch.id, action: 'reconcile' }); await f.service.waitForIdle(batch.id);
    expect(f.generate).toHaveBeenCalledTimes(2);
    expect(f.document.assets).toHaveLength(2);
  });
  it('keeps partial success and unknown requests use only original request recovery after restart', async () => {
    const f = fixture(); const original = f.generate.getMockImplementation()!;
    f.generate.mockImplementation(async (input, options) => { if (input.ratio === '1:1') throw new Error('connection lost after POST'); return original(input, options); });
    const batch = await f.submit(); await f.service.waitForIdle(batch.id);
    expect(f.document.assets).toHaveLength(1);
    const before = f.batches.get(batch.id)!;
    expect(before.status).toBe('paused');
    const unknown = before.nodes.find(n => n.reference?.submissionState === 'unknown')!;
    expect(unknown.reference?.requestId).toBeTruthy();
    const resumed = createReferenceBatchService(f.deps);
    await resumed.control({ id: batch.id, action: 'reconcile' }); await resumed.waitForIdle(batch.id);
    expect(f.generate).toHaveBeenCalledTimes(3);
    expect(f.generate.mock.calls[2]).toMatchObject([{ id: unknown.reference!.requestId }, { recoveryOnly: true }]);
    expect(f.document.assets).toHaveLength(1);
  });
  it('repairs saved result without provider POST and is idempotent across applied-but-unacknowledged restart', async () => {
    const f = fixture();
    const batch = await f.submit(); await f.service.waitForIdle(batch.id);
    const saved = f.batches.get(batch.id)!;
    saved.status = 'paused'; saved.nodes.forEach(n => { n.status = 'pending'; n.reference!.applyState = 'pending'; n.reference!.submissionState = 'submitted'; });
    const restarted = createReferenceBatchService(f.deps);
    await restarted.control({ id: batch.id, action: 'reconcile' }); await restarted.waitForIdle(batch.id);
    expect(f.generate).toHaveBeenCalledTimes(2);
    expect(f.document.assets).toHaveLength(2);
  });
  it('retains generated history without attaching when definitions change during generation', async () => {
    const f = fixture(); const original = f.generate.getMockImplementation()!;
    f.generate.mockImplementation(async (input, options) => { f.document.sceneAssets[0].prompt += ' changed'; f.document.props[0].prompt += ' changed'; return original(input, options); });
    const batch = await f.submit(); await f.service.waitForIdle(batch.id);
    expect(f.records.size).toBe(2);
    expect(f.document.assets).toHaveLength(0);
    expect(f.batches.get(batch.id)?.nodes.every(n => n.reference?.applyState === 'stale')).toBe(true);
  });
  it('keeps history after attachment failure and later attaches without generation', async () => {
    const f = fixture(); f.db.saveMotionComicTask.mockRejectedValueOnce(new Error('disk busy'));
    const batch = await f.submit(); await f.service.waitForIdle(batch.id);
    expect(f.records.size).toBe(2);
    await f.service.control({ id: batch.id, action: 'reconcile' }); await f.service.waitForIdle(batch.id);
    expect(f.generate).toHaveBeenCalledTimes(2);
    expect(f.document.assets).toHaveLength(2);
  });
});
