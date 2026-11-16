import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { FileDatabase } from '../src/shared/storage';
import { MotionComicScriptBatchService } from '../electron/motion-comic-script-batch-service';
import { motionComicAssetExtractSchema, type MotionComicAssetCategory } from '../src/shared/motion-comic-asset-extraction';
import type { ConfiguredJsonLlm } from '../src/shared/llm-provider';
const config = { provider: 'fake', model: 'fake' };
const prop = { key: 'letter', label: '信', description: '信封', prompt: '纸信封' };
const character = { key: 'qing', name: '阿青', aliases: [], role: '主角', identityPrompt: '青年', personality: '冷静', voiceNotes: '清朗', looks: [{ key: 'daily', label: '日常', appearancePrompt: '青年', wardrobe: '便服', continuityNotes: '一致' }] };
async function fixture(run: (db: FileDatabase, id: string, file: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'asset-extract-')); const file = join(root, 'data.sqlite');
  const db = await FileDatabase.open(file);
  try { const task = await db.createMotionComicTask({ title: '来信', premise: '阿青拿信走进门厅。', ratio: '9:16', source: { kind: 'novel', adaptationMode: 'novel-adaptation', fileName: '信.txt', originalText: '阿青拿信走进门厅。', episodes: [{ title: '第一集', sourceText: '阿青拿信走进门厅。' }] } }); await run(db, task.id, file); }
  finally { await db.close(); await rm(root, { recursive: true, force: true }); }
}
async function input(db: FileDatabase, id: string, category: MotionComicAssetCategory = 'props', requestId = 'request') {
  const doc = await db.motionComicScripts.readProject(id);
  return { id, category, sourceEpisodeId: doc.sourceDocument!.episodes[0].id, expectedUpdatedAt: doc.updatedAt, requestId };
}
function service(db: FileDatabase, output: unknown) {
  const run = vi.fn().mockResolvedValue({ json: output, raw: JSON.stringify(output), requestId: 'receipt' });
  const runtime = vi.fn().mockResolvedValue({ ...config, llm: { protocol: 'openai', run } as unknown as ConfiguredJsonLlm });
  return { worker: new MotionComicScriptBatchService(db.motionComicScripts, runtime), run, runtime };
}
describe('durable category extraction', () => {
  it.each(['characters', 'sceneAssets', 'props'] as const)('keeps %s empty results valid and project unchanged', async category => fixture(async (db, id) => {
    const before = await db.motionComicScripts.readProject(id); const { worker, run, runtime } = service(db, { [category]: [] });
    const request = await input(db, id, category); const result = await worker.extractAssets(request);
    expect(result.assetExtractions![0].status).toBe('ready'); expect(await db.motionComicScripts.readProject(id)).toEqual(before);
    await worker.extractAssets(request); expect(run).toHaveBeenCalledTimes(1); expect(run.mock.calls[0][0].maxRetries).toBe(0);
    expect(runtime.mock.calls[0][1]).toEqual({ disableFallback: true });
    await expect(worker.extractAssets({ ...request, category: category === 'props' ? 'characters' : 'props' })).rejects.toThrow('REQUEST_CONFLICT');
    expect(motionComicAssetExtractSchema.safeParse({ ...request, sourceText: 'fake source' }).success).toBe(false);
    await worker.stop();
  }));
  it('appends only selected props, CAS rejects stale apply and repeat apply is idempotent', async () => fixture(async (db, id) => {
    const before = await db.motionComicScripts.readProject(id); const { worker } = service(db, { props: [prop, { ...prop, key: 'ignored', label: '另一个' }] });
    const request = await input(db, id); const result = await worker.extractAssets(request); const c = result.assetExtractions![0];
    const apply = { id, candidateId: c.id, revision: c.revision, inputFingerprint: c.inputFingerprint, expectedUpdatedAt: before.updatedAt, selections: [{ key: prop.key, mode: 'new' as const }] };
    await expect(db.motionComicScripts.applyAssetExtraction({ ...apply, expectedUpdatedAt: '2000-01-01T00:00:00.000Z' })).rejects.toThrow('STALE');
    await expect(db.motionComicScripts.applyAssetExtraction({ ...apply, revision: 99 })).rejects.toThrow('REVISION');
    await db.motionComicScripts.applyAssetExtraction(apply); const after = await db.motionComicScripts.readProject(id);
    expect(after.props).toHaveLength(before.props.length + 1); expect(after.series.propAssetIds).toContain(after.props.at(-1)!.id);
    expect(after.characters).toEqual(before.characters); expect(after.sceneAssets).toEqual(before.sceneAssets); expect(after.episodes).toEqual(before.episodes);
    await db.motionComicScripts.applyAssetExtraction(apply); expect(await db.motionComicScripts.readProject(id)).toEqual(after); await worker.stop();
  }));
  it('requires explicit choice for ambiguous names and reuses exact character without modifying looks or voice', async () => fixture(async (db, id) => {
    const doc = await db.motionComicScripts.readProject(id);
    const existing = { id: 'character-one', name: '阿青', aliases: [], role: '既有', identityPrompt: '既有', personality: '既有', voiceNotes: '既有', voiceProvider: 'minimax' as const, voiceId: 'voice-one', looks: [{ id: 'look-one', characterId: 'character-one', label: '既有', appearancePrompt: '既有', wardrobe: '既有', continuityNotes: '既有', referenceAssetVersionIds: [], pinned: true }] };
    await db.saveMotionComicTask({ id, expectedUpdatedAt: doc.updatedAt, document: { ...doc, characters: [existing, { ...existing, id: 'character-two', looks: [] }], series: { ...doc.series, characterIds: ['character-one', 'character-two'] } } });
    const before = await db.motionComicScripts.readProject(id); const { worker } = service(db, { characters: [character] }); const result = await worker.extractAssets(await input(db, id, 'characters')); const c = result.assetExtractions![0];
    const apply = { id, candidateId: c.id, revision: c.revision, inputFingerprint: c.inputFingerprint, expectedUpdatedAt: before.updatedAt, selections: [{ key: character.key, mode: 'existing' as const, existingId: 'character-one' }] };
    expect(() => db.motionComicScripts.applyAssetExtraction({ ...apply, selections: [] })).toThrow();
    await expect(db.motionComicScripts.applyAssetExtraction({ ...apply, selections: [{ ...apply.selections[0], existingId: 'missing' }] })).rejects.toThrow('BINDING');
    await db.motionComicScripts.applyAssetExtraction(apply); const after = await db.motionComicScripts.readProject(id); expect(after.characters).toEqual(before.characters); expect(after.props).toEqual(before.props); await worker.stop();
  }));
  it('reopens SQLite running as unknown and never replays even with same request', async () => fixture(async (db, id, file) => {
    const request = await input(db, id); const started = await db.motionComicScripts.beginAssetExtraction(request, config); await db.motionComicScripts.markAssetExtractionDispatched(id, started.candidate.id);
    await db.close(); const reopened = await FileDatabase.open(file);
    try { const { worker, run } = service(reopened, { props: [prop] }); await worker.restore(); const result = await worker.extractAssets(request); expect(result.assetExtractions![0]).toMatchObject({ status: 'unknown', dispatchState: 'unknown' }); expect(run).not.toHaveBeenCalled(); await worker.stop(); } finally { await reopened.close(); }
  }));
  it('retains a received response as unknown after a transient persistence failure without another POST', async () => fixture(async (db, id) => {
    const { worker, run } = service(db, { props: [prop] }); const request = await input(db, id);
    const original = db.motionComicScripts.finishAssetExtraction.bind(db.motionComicScripts);
    const finish = vi.spyOn(db.motionComicScripts, 'finishAssetExtraction').mockRejectedValueOnce(new Error('disk temporarily unavailable'));
    finish.mockImplementationOnce(original);
    const result = await worker.extractAssets(request);
    expect(result.assetExtractions![0]).toMatchObject({ status: 'unknown', output: { props: [prop] } });
    await worker.extractAssets(request); expect(run).toHaveBeenCalledTimes(1); finish.mockRestore(); await worker.stop();
  }));
  it('rejects changed source fingerprints and preserves stale complete responses', async () => fixture(async (db, id) => {
    const request = await input(db, id); const started = await db.motionComicScripts.beginAssetExtraction(request, config);
    const doc = await db.motionComicScripts.readProject(id);
    await db.saveMotionComicTask({ id, expectedUpdatedAt: doc.updatedAt, document: { ...doc, sourceDocument: { ...doc.sourceDocument!, episodes: doc.sourceDocument!.episodes.map(e => ({ ...e, sourceText: '修改后的源文本' })) } } });
    const result = await db.motionComicScripts.finishAssetExtraction(id, started.candidate.id, { props: [prop] });
    expect(result.assetExtractions![0]).toMatchObject({ status: 'stale', output: { props: [prop] } });
    expect((await db.motionComicScripts.readProject(id)).props).toEqual(doc.props);
  }));
  it.each(['changed', 'missing', 'definitions'] as const)('persists stale on apply with %s input and leaves the project untouched', async kind => fixture(async (db, id) => {
    const { worker } = service(db, { props: [prop] }); const result = await worker.extractAssets(await input(db, id)); const candidate = result.assetExtractions![0];
    const doc = await db.motionComicScripts.readProject(id);
    const changed = structuredClone(doc);
    if (kind === 'missing') changed.sourceDocument = undefined;
    else if (kind === 'changed') changed.sourceDocument!.episodes[0].sourceText = '人工作出的源文本修改';
    else changed.props.push({ id: 'human-prop', label: '人工道具', description: '人工', prompt: '人工', referenceAssetVersionIds: [] });
    await db.saveMotionComicTask({ id, expectedUpdatedAt: doc.updatedAt, document: changed });
    const beforeApply = await db.motionComicScripts.readProject(id);
    const applied = await db.motionComicScripts.applyAssetExtraction({ id, candidateId: candidate.id, revision: candidate.revision, inputFingerprint: candidate.inputFingerprint, expectedUpdatedAt: beforeApply.updatedAt, selections: [{ key: prop.key, mode: 'new' }] });
    expect(applied.assetExtractions![0]).toMatchObject({ status: 'stale', error: expect.stringContaining('INPUT_CHANGED') });
    expect((await db.motionComicScripts.snapshot(id)).assetExtractions![0].status).toBe('stale');
    expect(await db.motionComicScripts.readProject(id)).toEqual(beforeApply);
    await worker.stop();
  }));
  it('strictly rejects cross-category output without repair and marks transport loss unknown', async () => fixture(async (db, id) => {
    const { worker, run } = service(db, { props: [], characters: [] }); const request = await input(db, id);
    expect((await worker.extractAssets(request)).assetExtractions![0].status).toBe('failed'); expect(run).toHaveBeenCalledTimes(1);
    run.mockRejectedValue(Object.assign(new Error('socket lost'), { code: 'ECONNRESET' }));
    const next = { ...request, requestId: 'unknown' }; expect((await worker.extractAssets(next)).assetExtractions![1].status).toBe('unknown'); await worker.extractAssets(next); expect(run).toHaveBeenCalledTimes(2); await worker.stop();
  }));
});
