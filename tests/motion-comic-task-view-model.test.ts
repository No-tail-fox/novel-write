import { describe, expect, it } from 'vitest';
import { appendMotionComicEpisode, createMotionComicDraft, createMotionComicStarterProject } from '../src/shared/motion-comic';
import type { MotionComicScriptSnapshot, MotionComicScriptTask } from '../src/shared/motion-comic-script-batch';
import type { DirectorBatchRecord } from '../src/shared/director-batch-persistence';
import type { ProductionProviderJob } from '../src/shared/production-workflow';
import { buildMotionComicTaskViewModel, safeMotionComicTaskMediaUrl } from '../src/features/motion-comic/motion-comic-task-view-model';

const now = '2026-11-12T00:00:00.000Z';
function project() { return createMotionComicStarterProject(createMotionComicDraft({ id: 'tasks', title: '雨夜来信', premise: '信', now })); }
function job(id: string, nodeId: string, changes: Partial<ProductionProviderJob> = {}): ProductionProviderJob {
  return { id, nodeId, workflowKind: 'motion-comic', providerId: 'test', model: 'local-fixture', capability: 'image-to-video', status: 'running', inputHash: 'hash', idempotencyKey: id, estimatedCost: 0, attempt: 1, createdAt: now, updatedAt: now, ...changes };
}
function batch(projectId: string, targetId: string): DirectorBatchRecord {
  return { id: 'batch', workflowKind: 'image-lab', projectId, episodeId: null, status: 'completed', concurrency: 1, pauseRequested: false, cancelRequested: false, recoveryRequired: false, recoveryReason: '', createdAt: now, updatedAt: now,
    plan: { purpose: 'reference-generation', scope: 'all', capabilities: { image: true, video: false, voice: false, render: false }, outputReady: false, renderFailed: false, shots: [] },
    nodes: [{ id: 'node', title: '参考图', capability: 'image', status: 'completed', estimatedCost: 0, dependencies: [], reference: { target: { kind: 'look', id: targetId }, requestId: 'request', attempt: 1, submissionState: 'resolved', applyState: 'applied', resultAssetVersionId: 'reference', inputFingerprint: 'hash', configurationFingerprint: 'config', referenceFiles: [], inputSnapshot: {} as never, provider: {} as never } }] };
}
describe('motion comic task projection (pure, no API or DB)', () => {
  it('restores all episode titles and thumbnails without discarding shot history', () => {
    const document = appendMotionComicEpisode(project(), { id: 'second', title: '第二集', now });
    const first = document.episodes[0].scenes[0].shots[0];
    const second = document.episodes[1].scenes[0].shots[0];
    first.firstFrameAssetVersionId = 'frame';
    document.assets.push({ id: 'frame', assetId: 'frame', kind: 'image', localPath: 'I:/frames/first.png', createdAt: now });
    document.providerJobs = [job('old', first.id, { status: 'failed', episodeId: first.episodeId }), job('new', first.id, { attempt: 2, episodeId: first.episodeId }), job('other', second.id, { episodeId: second.episodeId })];
    const before = JSON.stringify(document);
    const result = buildMotionComicTaskViewModel({ project: document });
    expect(result.items).toHaveLength(3);
    expect(result.items.find(item => item.providerJobId === 'old')).toMatchObject({ title: first.title, thumbnailPath: 'I:/frames/first.png', navigation: { kind: 'episode', episodeId: first.episodeId } });
    expect(result.items.find(item => item.providerJobId === 'other')?.subtitle).toContain('第二集');
    expect(result.counts).toMatchObject({ total: 3, failed: 1, running: 2, attention: 1 });
    expect(JSON.stringify(document)).toBe(before);
    expect(result.items.every(item => !('progress' in item))).toBe(true);
  });
  it('deduplicates only exact linked provider jobs, retains other attempts', () => {
    const document = project();
    const targetId = document.characters[0].looks[0].id;
    const referenceBatch = batch(document.id, targetId);
    document.assets.push({ id: 'reference', assetId: targetId, kind: 'image', localPath: 'I:/reference.png', providerJobId: 'linked', createdAt: now });
    const nodeId = `reference-look-${targetId}`;
    document.providerJobs = [job('linked', nodeId, { capability: 'text-to-image', status: 'completed' }), job('historical', nodeId, { capability: 'text-to-image', status: 'failed' })];
    const result = buildMotionComicTaskViewModel({ project: document, referenceBatches: [referenceBatch] });
    expect(result.items).toHaveLength(2);
    expect(result.items.find(item => item.source === 'reference')).toMatchObject({ status: 'candidate', providerJobId: 'linked', thumbnailPath: 'I:/reference.png' });
    expect(result.items.some(item => item.providerJobId === 'historical')).toBe(true);
    expect(result.counts.candidate).toBe(1);
  });
  it('retains unknown, stale, cancelled and review evidence without generic retries', () => {
    const document = project();
    document.sourceDocument = { kind: 'novel', adaptationMode: 'novel-adaptation', originalText: '原文', importedAt: now, episodes: [{ id: 'source', number: 1, title: '来信', sourceText: '雨声中，她打开信封。' }] };
    const base: MotionComicScriptTask = { id: 'script', projectId: document.id, sourceEpisodeId: 'source', status: 'review', inputFingerprint: 'a', seriesBibleVersion: 'b', previousStateVersion: 'c', provider: 'test', model: 'test', promptVersion: '1', instructions: '', outputRevision: 1, attempt: 1, progress: 80, createdAt: now, updatedAt: now };
    const snapshot: MotionComicScriptSnapshot = { projectId: document.id, paused: false, tasks: [base, { ...base, id: 'cancelled', status: 'cancelled' }, { ...base, id: 'stale', status: 'stale' }], candidates: [], approvals: [], storyboards: [] };
    const referenceBatch = batch(document.id, document.characters[0].looks[0].id);
    referenceBatch.nodes[0].reference!.submissionState = 'unknown';
    referenceBatch.nodes[0].status = 'failed';
    referenceBatch.nodes[0].error = 'Original provider error: timeout';
    document.providerJobs = [job('uncertain-video', document.episodes[0].scenes[0].shots[0].id, { error: 'connection reset' })];
    const result = buildMotionComicTaskViewModel({ project: document, scriptSnapshot: snapshot, referenceBatches: [referenceBatch] });
    expect(result.counts).toMatchObject({ unknown: 2, review: 1, cancelled: 1, stale: 1, attention: 3 });
    expect(result.items.find(item => item.source === 'reference')?.error).toBe('Original provider error: timeout');
    expect(result.items.find(item => item.id === 'script:script')).toMatchObject({ kind: 'script', excerpt: '雨声中，她打开信封。', navigation: { kind: 'script', sourceEpisodeId: 'source' } });
  });
  it('labels each task with its own type and keeps separator rulers out of excerpts', () => {
    const document = project();
    document.sourceDocument = { kind: 'novel', adaptationMode: 'novel-adaptation', originalText: '原文', importedAt: now, episodes: [{ id: 'source', number: 1, title: '来信', sourceText: `${'='.repeat(30)}\n更多小说请到某站\n${'='.repeat(30)}\n雨声中。` }] };
    const base: MotionComicScriptTask = { id: 'script', projectId: document.id, sourceEpisodeId: 'source', status: 'approved', storyboardStatus: 'running', inputFingerprint: 'a', seriesBibleVersion: 'b', previousStateVersion: 'c', provider: 'test', model: 'test', promptVersion: '1', instructions: '', outputRevision: 1, attempt: 1, progress: 80, createdAt: now, updatedAt: now };
    document.providerJobs = [job('video', document.episodes[0].scenes[0].shots[0].id)];
    const result = buildMotionComicTaskViewModel({ project: document, scriptSnapshot: { projectId: document.id, paused: false, tasks: [base], candidates: [], approvals: [], storyboards: [] }, referenceBatches: [batch(document.id, document.characters[0].looks[0].id)] });
    const byId = new Map(result.items.map(item => [item.id, item]));
    expect(byId.get('script:script')).toMatchObject({ taskType: 'script', excerpt: '更多小说请到某站 雨声中。' });
    expect(byId.get('script-storyboard:script')).toMatchObject({ taskType: 'storyboard', excerpt: undefined, status: 'running' });
    expect(byId.get('provider:video')?.taskType).toBe('video');
    expect(result.items.find(item => item.source === 'reference')?.taskType).toBe('reference');
  });
  it('ignores foreign snapshots and batches', () => {
    const document = project();
    expect(buildMotionComicTaskViewModel({ project: document, referenceBatches: [batch('other-project', 'look')] }).items).toEqual([]);
  });
  it('rejects raw filesystem and active-content URLs', () => {
    for (const value of ['I:/image.png', 'file:///I:/image.png', '/home/image.png', '\\\\host\\share', 'javascript:alert(1)', 'data:text/html,test']) expect(safeMotionComicTaskMediaUrl(value)).toBeUndefined();
    for (const value of ['storydream-media://task/project/frame.png', 'https://localhost/frame.png', 'blob:https://localhost/id']) expect(safeMotionComicTaskMediaUrl(value)).toBe(value);
  });
});
