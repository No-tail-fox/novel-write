import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, parseEditorialCollagePipelineData, type EditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { buildVoxProductionNodes, recoverVoxProductionRun, voxProductionControlSchema, voxProductionInputErrors, voxProductionSettings } from '../src/shared/vox-production';
import { VoxProductionService, voxInputHash, type VoxProductionRuntime } from '../electron/vox-production-service';
import { createVoxProductionRuntime, type VoxProductionOperations } from '../electron/vox-production-runtime';
import { FileDatabase } from '../src/shared/storage';

const document = () => createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'vox', title: '城市热岛', ratio: '16:9' }), '道路与建筑吸收阳光。树荫可以降低地表温度。', '2026-10-23T00:00:00.000Z', 15000);
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
function harness(execute?: VoxProductionRuntime['execute']) {
  let doc = document(); let revision = Date.parse(doc.updatedAt); const receipts = new Map<string, EditorialCollagePipelineData>();
  const calls: string[] = [], errors: unknown[] = []; const release = vi.fn(); const acquire = vi.fn(() => release);
  const preflight = vi.fn();
  const runtime: VoxProductionRuntime = { identity: 'configured-models', preflight, input: (d, n) => ({ source: d.sourceText, kind: n.kind, shotId: n.shotId }), execute: async (d, n) => { calls.push(n.id); return execute ? execute(d, n) : d; } };
  const store = { load: async () => structuredClone(doc), save: async (d: EditorialCollagePipelineData) => { doc = structuredClone({ ...d, updatedAt: new Date(++revision).toISOString() }); return structuredClone(doc); }, projects: async () => [doc.id], acquire,
    checkpoint: async (_id: string, n: { requestId?: string }, d: EditorialCollagePipelineData) => { receipts.set(n.requestId!, structuredClone(d)); },
    recover: async (_id: string, n: { requestId?: string }) => receipts.get(n.requestId!),
  };
  const service = new VoxProductionService(store, async () => runtime, e => errors.push(e));
  return { service, store, runtime, calls, preflight, acquire, release, errors, get: () => structuredClone(doc), set: (d: EditorialCollagePipelineData) => { doc = d; }, start: () => service.start({ id: doc.id, expectedUpdatedAt: doc.updatedAt, settings: voxProductionSettings() }) };
}
function operations(overrides: Partial<VoxProductionOperations> = {}): VoxProductionOperations {
  const never = async (): Promise<never> => { throw new Error('unexpected provider call'); };
  return { identity: 'runtime', imageModel: 'image', voiceModel: 'voice', voice: { provider: 'volcengine', voiceId: 'test', voiceLabel: 'test', speed: 1 }, preflight() {}, plan: never, image: never, speech: never, cutout: never, render: never, compileCode: () => ({ compiled: '' }), verifyVideo: never, ...overrides };
}
describe('Vox preset contracts', () => {
  it('keeps legacy documents readable and requires sourced inputs', () => {
    const doc = document(); expect(parseEditorialCollagePipelineData(doc).productionRun).toBeUndefined();
    expect(voxProductionInputErrors(doc, voxProductionSettings())).toEqual([]);
    expect(voxProductionInputErrors(doc, voxProductionSettings('data-map')).join()).toContain('两条');
    expect(voxProductionInputErrors(doc, voxProductionSettings('archival-story')).join()).toContain('真实档案');
    const mixed = { ...voxProductionSettings('data-map'), data: [{ label: 'A', value: 1, source: 'source', lat: 20, lng: 100 }, { label: 'B', value: 2, source: 'source' }] };
    expect(voxProductionInputErrors(doc, mixed).join()).toContain('每条');
    expect(voxProductionControlSchema.safeParse({ id: doc.id, runId: 'run', action: 'confirm-no-result' }).success).toBe(false);
  });
  it('requires cutout for archival-shaped paper actors and never generates imported evidence', () => {
    const doc = document(), shot = doc.beats[0].shots[0]; shot.layers.find(l => l.kind === 'subject')!.kind = 'archival';
    const paper = buildVoxProductionNodes(doc, voxProductionSettings());
    expect(paper.filter(n => n.kind === 'cutout').length).toBeGreaterThan(0);
    const archives = buildVoxProductionNodes(doc, voxProductionSettings('archival-story'));
    expect(archives.filter(n => n.kind === 'image' && n.paid).every(n => doc.beats.flatMap(b => b.shots).find(s => s.id === n.shotId)?.layers.find(l => l.id === n.layerId)?.kind === 'background')).toBe(true);
    expect(buildVoxProductionNodes(doc, { ...voxProductionSettings(), lockedShotIds: [shot.id] }).filter(n => n.shotId === shot.id).map(n => n.kind)).toEqual(['timing', 'animation', 'compile']);
    for (const node of paper) expect(node.dependencies.every(dep => paper.findIndex(n => n.id === dep) < paper.indexOf(node))).toBe(true);
  });
  it('recovers remote ambiguity without blindly resubmitting', () => {
    const nodes = buildVoxProductionNodes(document(), voxProductionSettings());
    nodes[0].status = 'running'; nodes.find(n => n.kind === 'cutout')!.status = 'running';
    const run = recoverVoxProductionRun({ version: 1, id: 'run', status: 'running', settings: voxProductionSettings(), nodes, sourceHash: '', runtimeIdentity: '', createdAt: document().createdAt, updatedAt: document().updatedAt });
    expect(run.status).toBe('paused'); expect(run.nodes[0].status).toBe('unknown'); expect(run.nodes.find(n => n.kind === 'cutout')!.status).toBe('pending');
  });
});
describe('main-owned Vox production', () => {
  it('isolates an invalid historical project while recovering other interrupted runs without dispatching providers', async () => {
    const stale = document();
    stale.assets.push({ id: 'legacy-image', assetId: 'legacy-image', kind: 'image', createdAt: stale.createdAt });
    stale.beats[0].shots[0].layers[0].assetVersionId = 'legacy-image';
    const legacyJson = JSON.stringify(stale);
    const interrupted = document(), settings = voxProductionSettings();
    interrupted.id = 'interrupted';
    const nodes = buildVoxProductionNodes(interrupted, settings);
    nodes[0].status = 'running';
    nodes.find(node => node.kind === 'cutout')!.status = 'running';
    interrupted.productionRun = { version: 1, id: 'run', status: 'running', settings, nodes, sourceHash: '', runtimeIdentity: '', createdAt: interrupted.createdAt, updatedAt: interrupted.updatedAt };
    const saved: EditorialCollagePipelineData[] = [], errors: unknown[] = [];
    const runtime = vi.fn();
    const service = new VoxProductionService({
      projects: async () => [stale.id, interrupted.id],
      load: async id => parseEditorialCollagePipelineData(id === stale.id ? legacyJson : interrupted),
      save: async data => { saved.push(data); return data; },
    }, runtime, error => errors.push(error));

    expect(() => parseEditorialCollagePipelineData(legacyJson)).toThrow('Timeline must match');
    await expect(service.restore()).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain(stale.id);
    expect(String(errors[0])).toContain('Timeline must match');
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe(interrupted.id);
    expect(saved[0].productionRun!.status).toBe('paused');
    expect(saved[0].productionRun!.nodes[0].status).toBe('unknown');
    expect(saved[0].productionRun!.nodes.find(node => node.kind === 'cutout')!.status).toBe('pending');
    expect(JSON.stringify(stale)).toBe(legacyJson);
    expect(runtime).not.toHaveBeenCalled();
  });
  it('continues project recovery after a save failure and still reports project-list failures', async () => {
    const interrupted = document(), settings = voxProductionSettings();
    interrupted.productionRun = { version: 1, id: 'run', status: 'running', settings, nodes: buildVoxProductionNodes(interrupted, settings), sourceHash: '', runtimeIdentity: '', createdAt: interrupted.createdAt, updatedAt: interrupted.updatedAt };
    const save = vi.fn(async (data: EditorialCollagePipelineData) => {
      if (data.id === 'unwritable') throw new Error('disk fault');
      return data;
    });
    const store = {
      projects: async () => ['unwritable', 'recoverable'],
      load: async (id: string) => ({ ...structuredClone(interrupted), id }),
      save,
    };
    const errors: unknown[] = [], runtime = vi.fn();
    const service = new VoxProductionService(store, runtime, error => errors.push(error));

    await expect(service.restore()).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain('unwritable');
    expect(String(errors[0])).toContain('disk fault');
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].productionRun!.status).toBe('paused');
    expect(runtime).not.toHaveBeenCalled();

    store.projects = async () => { throw new Error('database unavailable'); };
    await expect(service.restore()).rejects.toThrow('database unavailable');
  });
  it('deduplicates concurrent starts, persists an in-flight result before pausing, and reuses it', async () => {
    const entered = deferred(), finish = deferred();
    const h = harness(async (d, n) => { if (n.kind === 'plan') { entered.resolve(); await finish.promise; } return d; });
    const run = await h.start(); await entered.promise;
    await expect(h.start()).rejects.toThrow('BUSY');
    await h.service.control({ id: 'vox', runId: run.id, action: 'pause' });
    expect(h.get().productionRun!.nodes[0].status).toBe('running'); finish.resolve(); await h.service.idle('vox');
    expect(h.get().productionRun!.status).toBe('paused'); expect(h.get().productionRun!.nodes[0]).toMatchObject({ kind: 'plan', status: 'completed' });
    expect(h.calls).toEqual(['plan']); expect(h.release).toHaveBeenCalledOnce();
    await h.service.control({ id: 'vox', runId: run.id, action: 'resume' }); await h.service.idle('vox');
    expect(h.get().productionRun!.status).toBe('completed'); expect(h.calls.filter(id => id === 'plan')).toHaveLength(1); expect(h.errors).toEqual([]);
    const count = h.calls.length; await h.start(); await h.service.idle('vox'); expect(h.calls).toHaveLength(count);
    expect(h.preflight.mock.calls.at(-1)?.[2]).toEqual([]);
  });
  it('blocks unknown paid retries until receipt reconciliation or explicit provider evidence', async () => {
    const h = harness(async () => { throw new Error('network closed after submit'); }); const run = await h.start(); await h.service.idle('vox');
    expect(h.get().productionRun!.nodes[0].status).toBe('unknown');
    await expect(h.service.control({ id: 'vox', runId: run.id, action: 'resume' })).rejects.toThrow('UNKNOWN');
    await expect(h.start()).rejects.toThrow('UNKNOWN'); expect(h.calls).toEqual(['plan']);
    await expect(h.service.control({ id: 'vox', runId: run.id, action: 'confirm-no-result', nodeId: 'plan' })).rejects.toThrow('依据');
    await h.service.control({ id: 'vox', runId: run.id, action: 'confirm-no-result', nodeId: 'plan', evidence: '服务商记录核对确认未收到请求' });
    expect(h.get().productionRun!.status).toBe('paused'); expect(h.get().productionRun!.nodes[0]).toMatchObject({ status: 'pending', recoveryNote: '服务商记录核对确认未收到请求' }); expect(h.calls).toEqual(['plan']);
  });
  it('restores a durable receipt after a result-save crash without a second remote call', async () => {
    const h = harness(); const save = h.store.save; let fail = true;
    h.store.save = async d => { if (fail && d.productionRun?.nodes[0].status === 'completed') { fail = false; throw new Error('disk fault'); } return save(d); };
    const run = await h.start(); await h.service.idle('vox'); expect(h.get().productionRun!.nodes[0].status).toBe('unknown');
    await h.service.control({ id: 'vox', runId: run.id, action: 'reconcile' }); expect(h.get().productionRun!.nodes[0].status).toBe('completed');
    await h.service.control({ id: 'vox', runId: run.id, action: 'resume' }); await h.service.idle('vox'); expect(h.calls.filter(id => id === 'plan')).toHaveLength(1);
  });
  it('invalidates only changed nodes and descendants while retaining other successful paid assets', async () => {
    const h = harness(); h.runtime.input = (d, n) => n.kind === 'image' ? { prompt: d.beats.flatMap(b => b.shots).find(s => s.id === n.shotId)!.layers.find(l => l.id === n.layerId)!.prompt } : n.kind;
    await h.start(); await h.service.idle('vox');
    const d = h.get(); d.productionRun!.status = 'paused'; const layer = d.beats[0].shots[0].layers.find(l => !l.content)!; layer.prompt += ' edited'; h.set(d);
    const before = [...h.calls]; await h.service.control({ id: 'vox', runId: d.productionRun!.id, action: 'resume' }); await h.service.idle('vox');
    const reruns = h.calls.slice(before.length); expect(reruns).toContain(`image:${d.beats[0].shots[0].id}:${layer.id}`); expect(reruns).not.toContain('plan'); expect(reruns.some(id => id.startsWith('voice:'))).toBe(false); expect(reruns).toContain('verify');
  });
  it('reconciles a provider image receipt without executing generation and refuses stale inputs', async () => {
    const h = harness(async (d, n) => { if (n.kind === 'image') throw new Error('download failed'); return d; });
    const run = await h.start(); await h.service.idle('vox');
    const node = h.get().productionRun!.nodes.find(n => n.status === 'unknown')!;
    const recover = vi.fn(async (d: EditorialCollagePipelineData) => d); h.runtime.recover = recover;
    const count = h.calls.length;
    const changed = h.get(); changed.sourceText += ' changed'; h.set(changed);
    await h.service.control({ id: 'vox', runId: run.id, action: 'reconcile' });
    expect(recover).not.toHaveBeenCalled(); expect(h.get().productionRun!.nodes.find(n => n.id === node.id)!.status).toBe('unknown');
    h.set({ ...h.get(), sourceText: document().sourceText });
    await h.service.control({ id: 'vox', runId: run.id, action: 'reconcile' });
    expect(recover).toHaveBeenCalledOnce(); expect(h.calls).toHaveLength(count);
    expect(h.get().productionRun!.nodes.find(n => n.id === node.id)).toMatchObject({ status: 'completed', requestId: node.requestId });
  });
  it('rejects a changed model identity on resume and stale input revisions on start', async () => {
    const h = harness(); await expect(h.service.start({ id: 'vox', expectedUpdatedAt: 'stale', settings: voxProductionSettings() })).rejects.toThrow('STALE');
    await h.start(); await h.service.idle('vox'); const d = h.get(); d.productionRun!.status = 'paused'; h.set(d); h.runtime.identity = 'other-model';
    await expect(h.service.control({ id: 'vox', runId: d.productionRun!.id, action: 'resume' })).rejects.toThrow('CONFIG_CHANGED');
  });
});
describe('Vox runtime gates', () => {
  it('assembles sourced data with its unit and exact values without image calls', async () => {
    const d = document(), shot = d.beats[0].shots[0];
    const settings = { ...voxProductionSettings('data-map'), dataUnit: '℃', data: [{ label: '2000', value: .39, source: 'NASA GISTEMP v4' }, { label: '2024', value: 1.28, source: 'NASA GISTEMP v4' }] };
    expect(buildVoxProductionNodes(d, settings).some(n => n.kind === 'image' || n.kind === 'cutout')).toBe(false);
    d.productionRun = { version: 1, id: 'r', status: 'running', settings, sourceHash: '', runtimeIdentity: '', nodes: [], createdAt: d.createdAt, updatedAt: d.updatedAt };
    const result = await createVoxProductionRuntime(operations()).execute(d, buildVoxProductionNodes(d, settings).find(n => n.kind === 'animation' && n.shotId === shot.id)!);
    expect(result.beats[0].shots[0].animation!.template).toMatchObject({ id: 'data-bars', props: { unit: '℃', source: 'NASA GISTEMP v4', items: [{ label: '2000', value: .39 }, { label: '2024', value: 1.28 }] } });
    expect(result.beats[0].shots[0].animation!.template.props.dataPresentation?.reveal).toBe(true);
    const later = d.beats.flatMap(beat => beat.shots).at(-1)!;
    const runtime = createVoxProductionRuntime(operations());
    const node = buildVoxProductionNodes(d, settings).find(n => n.kind === 'animation' && n.shotId === later.id)!;
    const next = await runtime.execute(result, node);
    expect(next.beats.flatMap(beat => beat.shots).at(-1)!.animation!.template.props.dataPresentation?.reveal).toBe(false);
    expect(runtime.input(d, node)).toMatchObject({ dataChartRevision: 2 });
    expect(voxProductionSettings()).not.toHaveProperty('dataUnit');
  });
  it('accepts a legacy one-layer image without requiring a second paid image', async () => {
    const d = document(), shot = d.beats[0].shots[0], settings = voxProductionSettings();
    shot.layers = [{ ...shot.layers[0], assetVersionId: 'plate' }];
    d.assets = [{ id: 'plate', assetId: 'plate', kind: 'image', localPath: 'local.png', createdAt: d.createdAt }];
    d.productionRun = { version: 1, id: 'r', status: 'running', settings, sourceHash: '', runtimeIdentity: '', nodes: [], createdAt: d.createdAt, updatedAt: d.updatedAt };
    const result = await createVoxProductionRuntime(operations()).execute(d, { id: `animation:${shot.id}`, kind: 'animation', shotId: shot.id, paid: false, dependencies: [], status: 'running', attempt: 1 });
    expect(result.beats[0].shots[0].animation!.template).toMatchObject({ id: 'paper-popup', props: { assetIds: ['plate'] } });
  });
  it('does not send punctuation-only legacy narration to a paid provider', async () => {
    const d = document(), shot = d.beats[0].shots[0];
    for (const beat of d.beats) for (const cue of beat.subtitleCues) if (shot.subtitleCueIds.includes(cue.id)) cue.text = '。';
    const settings = voxProductionSettings();
    expect(buildVoxProductionNodes(d, settings).some(n => n.kind === 'voice' && n.shotId === shot.id)).toBe(false);
    d.productionRun = { version: 1, id: 'r', status: 'running', settings, sourceHash: '', runtimeIdentity: '', nodes: [], createdAt: d.createdAt, updatedAt: d.updatedAt };
    const speech = vi.fn();
    await createVoxProductionRuntime(operations({ speech })).execute(d, { id: `voice:${shot.id}`, kind: 'voice', shotId: shot.id, paid: true, dependencies: ['plan'], status: 'running', attempt: 1 });
    expect(speech).not.toHaveBeenCalled();
  });
  it('reuses actual runtime inputs after image selection, cutout replacement, measured speech and animation assembly', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vox-runtime-reuse-'));
    try {
      const path = join(directory, 'image.png'); await writeFile(path, 'local compile fixture');
      const now = document().createdAt;
      const image = vi.fn(async (input, requestId) => ({ id: requestId, prompt: input.prompt, ratio: input.ratio, style: '', provider: 'gpt_image', imagePath: path,
        status: 'generated' as const, errorMessage: '', resolution: '1K' as const, smartMode: 'text-to-image' as const, referenceImagePaths: [], referenceImagePath: '', upstreamTaskId: null, createdAt: now, finishedAt: now }));
      const speech = vi.fn(async (input, requestId) => ({ durationMs: 4200, record: { id: requestId, text: input.text, provider: input.provider, voiceId: input.voiceId,
        voiceLabel: input.voiceLabel, speed: input.speed, audioPath: path, status: 'generated' as const, errorMessage: '', createdAt: now, finishedAt: now } }));
      const ops = operations({ image, speech,
        plan: async () => ({ shots: document().beats.flatMap(b => b.shots.map(s => ({ id: s.id, title: '城市热岛', scenePrompt: 'Concrete cut-paper city scene with separate subjects' }))) }),
        cutout: async () => ({ outputPath: path, metadata: { method: 'green-key', quality: 'passed', transparentFraction: .6, foregroundFraction: .4, edgeFraction: .05 } }),
      });
      const runtime = createVoxProductionRuntime(ops), h = harness();
      h.runtime.input = runtime.input;
      h.runtime.execute = async (d, n) => ['render', 'verify'].includes(n.kind) ? d : runtime.execute(d, n);
      await h.start(); await h.service.idle('vox');
      expect(h.get().productionRun!.status).toBe('completed');
      const before = h.get(), requests = before.productionRun!.nodes.filter(n => n.paid).map(n => n.requestId);
      before.productionRun!.status = 'paused'; h.set(before);
      await h.service.control({ id: 'vox', runId: before.productionRun!.id, action: 'resume' }); await h.service.idle('vox');
      expect(h.get().productionRun!.nodes.filter(n => n.paid).map(n => n.requestId)).toEqual(requests);
      expect(h.get().productionRun!.nodes.every(n => n.attempt === 1)).toBe(true);
      expect(image).toHaveBeenCalledTimes(requests.length - speech.mock.calls.length - 1);
      expect(h.errors).toEqual([]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('removes stale voice dependencies for a silent unlocked shot', async () => {
    const d = document(), settings = { ...voxProductionSettings(), narration: false }, shot = d.beats[0].shots[0];
    d.productionRun = { version: 1, id: 'r', status: 'running', settings, sourceHash: '', runtimeIdentity: '', nodes: [], createdAt: d.createdAt, updatedAt: d.updatedAt };
    shot.voiceAssetVersionId = 'old-voice'; const cue = d.beats[0].subtitleCues[0]; cue.audioAssetVersionId = 'old-voice'; cue.voiceId = 'old';
    const runtime = createVoxProductionRuntime(operations()); const result = await runtime.execute(d, buildVoxProductionNodes(d, settings).find(n => n.kind === 'timing')!);
    expect(result.beats[0].shots[0].voiceAssetVersionId).toBeUndefined(); expect(result.beats[0].subtitleCues[0].audioAssetVersionId).toBeUndefined(); expect(result.beats[0].subtitleCues[0].voiceId).toBeUndefined();
  });
  it('stops at compile before rendering invalid templates', async () => {
    const render = vi.fn(); const ops = operations({ render }); const runtime = createVoxProductionRuntime(ops); const h = harness();
    h.runtime.execute = async (d, n) => n.kind === 'compile' ? runtime.execute(d, n) : n.kind === 'render' ? ops.render(d) : d;
    await h.start(); await h.service.idle('vox'); expect(h.get().productionRun!.status).toBe('failed'); expect(h.get().productionRun!.nodes.find(n => n.kind === 'compile')!.error).toContain('没有动画'); expect(render).not.toHaveBeenCalled();
  });
});
describe('Vox production storage ownership', () => {
  it('persists through reopening, rejects renderer journal spoofing and running edits', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vox-journal-')); let db: FileDatabase | undefined;
    try {
      db = await FileDatabase.open(join(dir, 'data.db')); const task = await db.createEditorialCollageTask({ title: 'Vox', sourceText: '城市热岛' }); const d = parseEditorialCollagePipelineData(task.pipelineData);
      const settings = voxProductionSettings(); d.productionRun = { version: 1, id: 'owner', status: 'running', settings, sourceHash: voxInputHash(d.sourceText), runtimeIdentity: 'runtime', nodes: buildVoxProductionNodes(d, settings), createdAt: d.createdAt, updatedAt: d.updatedAt };
      const input = { id: d.id, expectedUpdatedAt: d.updatedAt, document: d };
      await expect(db.saveEditorialCollageTask(input)).rejects.toThrow('JOURNAL');
      const saved = parseEditorialCollagePipelineData((await db.saveEditorialCollageTask(input, 'owner')).pipelineData);
      await expect(db.saveEditorialCollageTask({ id: d.id, expectedUpdatedAt: saved.updatedAt, document: { ...saved, title: 'edit' } })).rejects.toThrow('ACTIVE');
      await db.close(); db = await FileDatabase.open(join(dir, 'data.db')); const restored = parseEditorialCollagePipelineData((await db.getTaskDetail(d.id))!.pipelineData); expect(restored.productionRun!.id).toBe('owner');
      expect(restored.productionRun!.nodes).toHaveLength(d.productionRun.nodes.length);
    } finally { await db?.close(); await rm(dir, { recursive: true, force: true }); }
  });
});
