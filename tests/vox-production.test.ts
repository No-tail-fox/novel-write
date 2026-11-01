import { LlmJsonParseError } from '../src/shared/llm-provider';
import { LlmTextInterruptedError } from '../src/shared/llm-text-stream';
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, parseEditorialCollagePipelineData, type EditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { buildVoxProductionNodes, recoverVoxProductionRun, voxProductionControlSchema, voxProductionInputErrors, voxProductionNeedsTextModel, voxProductionNodeStatus, voxProductionSettings, voxProductionSettingsSchema, type VoxProductionSettings } from '../src/shared/vox-production';
import { VoxProductionService, voxInputHash, type VoxProductionRuntime } from '../electron/vox-production-service';
import { createVoxProductionRuntime, type VoxProductionOperations } from '../electron/vox-production-runtime';
import { FileDatabase } from '../src/shared/storage';
import { nativeHtml } from './lemo-native.fixture';
import { compileVoxCode } from '../electron/vox-animation-runtime';
import { directorDocumentRenderFingerprint } from '../src/shared/director-render';

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
  return { service, store, runtime, calls, preflight, acquire, release, errors, get: () => structuredClone(doc), set: (d: EditorialCollagePipelineData) => { doc = d; }, start: (settings: VoxProductionSettings = voxProductionSettings()) => service.start({ id: doc.id, expectedUpdatedAt: doc.updatedAt, settings }) };
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
  it('disables image generation independently of planning, code and narration, without requiring imported images', () => {
    const d = document(), settings = { ...voxProductionSettings(), generateImages: false, authoring: { mode: 'ai-code' as const, styleId: 'auto' } };
    const nodes = buildVoxProductionNodes(d, settings);
    expect(nodes.some(node => ['image', 'cutout'].includes(node.kind))).toBe(false);
    for (const kind of ['plan', 'voice', 'film-code', 'film-review', 'film-repair', 'film-finalize', 'compile', 'render', 'verify']) expect(nodes.some(node => node.kind === kind), kind).toBe(true);
    expect(voxProductionNeedsTextModel(nodes)).toBe(true);
    expect(nodes.every(node => node.dependencies.every(dependency => nodes.some(parent => parent.id === dependency)))).toBe(true);
    expect(nodes.find(node => node.kind === 'voice')?.dependencies).toEqual(['plan']);
    expect(voxProductionInputErrors(d, settings)).toEqual([]);
    expect(buildVoxProductionNodes(d, { ...settings, narration: false }).some(node => node.kind === 'voice')).toBe(false);
    expect(buildVoxProductionNodes(d, { ...settings, lockedShotIds: [d.beats[0].shots[0].id] }).filter(node => node.shotId === d.beats[0].shots[0].id).map(node => node.kind)).toEqual(['compile']);
  });
  it('defaults older settings to image generation and reads the retired existing-assets choice', () => {
    const { generateImages: _generateImages, ...legacy } = voxProductionSettings();
    expect(voxProductionSettingsSchema.parse(legacy).generateImages).toBe(true);
    const migrated = voxProductionSettingsSchema.safeParse({ ...legacy, narration: true, authoring: { mode: 'existing-assets', styleId: 'auto' } });
    expect(migrated.success && migrated.data).toMatchObject({ generateImages: false, narration: true, authoring: { mode: 'ai-code' } });
    const migratedSilent = voxProductionSettingsSchema.safeParse({ ...legacy, narration: false, authoring: { mode: 'existing-assets', styleId: 'auto' } });
    expect(migratedSilent.success && migratedSilent.data.narration).toBe(false);
  });
  it('still binds imported archives without generating an AI backdrop when images are disabled', () => {
    const nodes = buildVoxProductionNodes(document(), { ...voxProductionSettings('archival-story'), generateImages: false });
    expect(nodes.filter(node => node.kind === 'image').length).toBeGreaterThan(0);
    expect(nodes.filter(node => node.kind === 'image').every(node => !node.paid)).toBe(true);
    expect(nodes.some(node => node.kind === 'voice')).toBe(true);
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
  it('directly retries ambiguous paid steps one at a time and retains prior results', async () => {
    let images = 0;
    const h = harness(async (d, n) => {
      if (n.kind === 'image' && ++images === 1) throw new Error('network closed after submit');
      return d;
    });
    const run = await h.start(); await h.service.idle('vox');
    const before = h.get(), unknown = before.productionRun!.nodes.find(n => n.status === 'unknown')!;
    const completed = before.productionRun!.nodes.filter(n => n.status === 'completed');
    const nextUnknown = before.productionRun!.nodes.find(n => n.kind === 'image' && n.id !== unknown.id)!;
    nextUnknown.status = 'unknown'; before.productionRun!.status = 'failed'; h.set(before);

    await h.service.control({ id: 'vox', runId: run.id, action: 'retry-unknown', nodeId: unknown.id });
    await h.service.idle('vox');

    const after = h.get().productionRun!;
    expect(after.status).toBe('paused');
    expect(after.nodes.find(n => n.id === unknown.id)).toMatchObject({ status: 'completed', attempt: 2 });
    expect(after.nodes.find(n => n.id === nextUnknown.id)).toMatchObject({ status: 'unknown', attempt: 0 });
    for (const prior of completed) expect(h.calls.filter(id => id === prior.id)).toHaveLength(1);
    expect(h.calls.filter(id => id === unknown.id)).toHaveLength(2);

    await h.service.control({ id: 'vox', runId: run.id, action: 'retry-unknown', nodeId: nextUnknown.id });
    await h.service.idle('vox');
    expect(h.get().productionRun!.status).toBe('completed');
    expect(h.get().productionRun!.nodes.find(n => n.id === nextUnknown.id)).toMatchObject({ status: 'completed', attempt: 1 });
    expect(h.calls.filter(id => id === nextUnknown.id)).toHaveLength(1);
    expect(h.errors).toEqual([]);
  });
  it('can pause a targeted retry after saving its result without retaining the recovery message', async () => {
    let attempts = 0, finish!: () => void, entered!: () => void;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    const executing = new Promise<void>(resolve => { entered = resolve; });
    const h = harness(async (d, n) => {
      if (n.kind === 'image') {
        if (++attempts === 1) throw new Error('network closed after submit');
        if (attempts === 2) { entered(); await waiting; }
      }
      return d;
    });
    const run = await h.start(); await h.service.idle('vox');
    const node = h.get().productionRun!.nodes.find(n => n.status === 'unknown')!;
    await h.service.control({ id: 'vox', runId: run.id, action: 'retry-unknown', nodeId: node.id });
    await executing;
    expect(h.get().productionRun!.message).toBeUndefined();
    expect((await h.service.control({ id: 'vox', runId: run.id, action: 'pause' })).message).toContain('暂停中');
    finish(); await h.service.idle('vox');
    expect(h.get().productionRun!.status).toBe('paused');
    expect(h.get().productionRun!.nodes.find(n => n.id === node.id)).toMatchObject({ status: 'completed', attempt: 2 });
    expect(attempts).toBe(2);
    await h.service.control({ id: 'vox', runId: run.id, action: 'resume' }); await h.service.idle('vox');
    expect(h.get().productionRun!.status).toBe('completed');
    expect(h.calls.filter(id => id === node.id)).toHaveLength(2);
  });
  it.each([false, true].flatMap(legacy => [400, 401, 403, 404, 422, 429].map(status => ({ legacy, status }))))('allows explicit retry after a rejected plan without automatic paid resubmission ($legacy, $status)', async ({ legacy, status }) => {
    let attempts = 0;
    const h = harness(async (d, n) => {
      if (n.kind === 'plan' && ++attempts === 1) throw new Error(`LLM API error (${status}) at step 1 Lemo 全片导演方案 via https://provider.example/v1/messages: rejected`);
      return d;
    });
    const run = await h.start(); await h.service.idle('vox');
    const failed = h.get(), node = failed.productionRun!.nodes.find(n => n.kind === 'plan')!;
    expect(node.status).toBe('failed'); expect(attempts).toBe(1);
    if (legacy) { node.status = 'unknown'; h.set(failed); }
    expect(voxProductionNodeStatus(node)).toBe('failed');
    await h.service.control({ id: 'vox', runId: run.id, action: 'resume' }); await h.service.idle('vox');
    expect(h.get().productionRun!.status).toBe('completed');
    expect(attempts).toBe(2); expect(h.errors).toEqual([]);
  });
  it.each([
    'LLM API error (408) at step 1 plan via https://provider.example/v1/messages: timeout',
    'LLM API error (500) at step 1 plan via https://provider.example/v1/messages: failed',
    'LLM API error (502) at step 1 plan via https://provider.example/v1/messages: lost response',
    'LLM_STREAM_INTERRUPTED: disconnected', 'network closed after submit',
    'LLM returned invalid JSON: example LLM API error (400) at step 1',
  ])('retains paid-outcome uncertainty for a plan: %s', async message => {
    const h = harness(async (d, n) => { if (n.kind === 'plan') throw new Error(message); return d; });
    const run = await h.start(); await h.service.idle('vox');
    const node = h.get().productionRun!.nodes.find(n => n.kind === 'plan')!;
    expect(voxProductionNodeStatus(node)).toBe('unknown');
    await expect(h.service.control({ id: 'vox', runId: run.id, action: 'resume' })).rejects.toThrow('UNKNOWN');
    expect(h.calls).toEqual(['plan']);
  });
  it.each([false, true].flatMap(legacy => [
    'Image provider API error (400): image generation did not complete successfully.',
    'Image provider API error (503): 图片服务当前没有可用上游。上游信息: No available compatible accounts',
    'Image provider API error (503): No available channel for model gpt-image-2-Official under group distributor',
  ].map(message => ({ legacy, message }))))('retries rejected images and reuses successful paid steps ($legacy, $message)', async ({ legacy, message }) => {
    let images = 0;
    const h = harness(async (d, n) => {
      if (n.kind === 'image' && ++images === 2) throw new Error(message);
      return d;
    });
    const run = await h.start(); await h.service.idle('vox');
    const failed = h.get(), node = failed.productionRun!.nodes.find(n => n.status === 'failed')!;
    expect(node).toMatchObject({ kind: 'image', paid: true, attempt: 1 });
    expect(failed.productionRun!.status).toBe('failed');
    expect(h.calls.filter(id => id === node.id)).toHaveLength(1);
    const completed = failed.productionRun!.nodes.filter(n => n.status === 'completed');
    expect(completed.some(n => n.kind === 'image')).toBe(true);
    if (legacy) { node.status = 'unknown'; h.set(failed); }
    expect(voxProductionNodeStatus(node)).toBe('failed');
    await h.service.control({ id: 'vox', runId: run.id, action: 'resume' }); await h.service.idle('vox');
    expect(h.get().productionRun!.status).toBe('completed');
    for (const prior of completed) {
      expect(h.calls.filter(id => id === prior.id)).toHaveLength(1);
      expect(h.get().productionRun!.nodes.find(n => n.id === prior.id)).toMatchObject({ requestId: prior.requestId, attempt: 1 });
    }
    expect(h.calls.filter(id => id === node.id)).toHaveLength(2);
    expect(h.get().productionRun!.nodes.find(n => n.id === node.id)).toMatchObject({ attempt: 2, status: 'completed' });
    expect(h.get().productionRun!.nodes.find(n => n.id === node.id)!.requestId).not.toBe(node.requestId);
    expect(h.errors).toEqual([]);
  });
  it.each(['network closed after submit', 'Image provider API error (502): lost upstream response', 'Image provider async poll error (400): task not found', 'download failed'])('keeps image outcomes unknown and blocks resubmission after %s', async message => {
    const h = harness(async (d, n) => { if (n.kind === 'image') throw new Error(message); return d; });
    const run = await h.start(); await h.service.idle('vox');
    const node = h.get().productionRun!.nodes.find(n => n.kind === 'image')!;
    expect(voxProductionNodeStatus(node)).toBe('unknown');
    const calls = [...h.calls];
    await expect(h.service.control({ id: 'vox', runId: run.id, action: 'resume' })).rejects.toThrow('UNKNOWN');
    await expect(h.start()).rejects.toThrow('UNKNOWN');
    expect(h.calls).toEqual(calls);
  });
  it('never treats a post-result storage error as a rejected plan', async () => {
    const h = harness(), save = h.store.save; let fail = true;
    h.store.save = async d => {
      if (fail && d.productionRun?.nodes.some(n => n.kind === 'plan' && n.status === 'completed')) {
        fail = false; throw new Error('LLM API error (400) at step 1 plan via https://provider.example/v1/messages: storage failure with copied diagnostic');
      }
      return save(d);
    };
    const run = await h.start(); await h.service.idle('vox');
    const node = h.get().productionRun!.nodes.find(n => n.kind === 'plan')!;
    expect(node.resultReceived).toBe(true); expect(voxProductionNodeStatus(node)).toBe('unknown');
    await expect(h.service.control({ id: 'vox', runId: run.id, action: 'resume' })).rejects.toThrow('UNKNOWN');
    await h.service.control({ id: 'vox', runId: run.id, action: 'reconcile' });
    await h.service.control({ id: 'vox', runId: run.id, action: 'resume' }); await h.service.idle('vox');
    expect(h.calls.filter(id => id === 'plan')).toHaveLength(1);
    expect(h.get().productionRun!.status).toBe('completed');
  });
  it('recovers a generated image after a local save failure without resubmitting it', async () => {
    const h = harness(), save = h.store.save; let fail = true;
    h.store.save = async d => {
      if (fail && d.productionRun?.nodes.some(n => n.kind === 'image' && n.status === 'completed')) { fail = false; throw new Error('disk fault'); }
      return save(d);
    };
    const run = await h.start(); await h.service.idle('vox');
    const node = h.get().productionRun!.nodes.find(n => n.status === 'unknown')!;
    expect(node.kind).toBe('image');
    await expect(h.service.control({ id: 'vox', runId: run.id, action: 'resume' })).rejects.toThrow('UNKNOWN');
    await h.service.control({ id: 'vox', runId: run.id, action: 'reconcile' });
    await h.service.control({ id: 'vox', runId: run.id, action: 'resume' }); await h.service.idle('vox');
    expect(h.get().productionRun!.status).toBe('completed');
    expect(h.calls.filter(id => id === node.id)).toHaveLength(1);
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
  it('keeps stale source checks while accepting changed providers for pending work', async () => {
    const h = harness(); await expect(h.service.start({ id: 'vox', expectedUpdatedAt: 'stale', settings: voxProductionSettings() })).rejects.toThrow('STALE');
    await h.start(); await h.service.idle('vox'); const d = h.get(); d.productionRun!.status = 'paused'; h.set(d); h.runtime.identity = 'other-model';
    const calls = [...h.calls];
    await h.service.control({ id: 'vox', runId: d.productionRun!.id, action: 'resume' }); await h.service.idle('vox');
    expect(h.get().productionRun).toMatchObject({ status: 'completed', runtimeIdentity: 'other-model' });
    expect(h.calls).toEqual(calls);
    const changed = h.get(); changed.productionRun!.status = 'paused'; changed.sourceText += ' edited'; h.set(changed);
    await expect(h.service.control({ id: 'vox', runId: d.productionRun!.id, action: 'resume' })).rejects.toThrow('STALE');
  });
  it('does not update the journal or dispatch when the replacement provider fails preflight', async () => {
    const h = harness(async (d, n) => {
      if (n.kind === 'image') throw new Error('Image provider API error (400): no image');
      return d;
    });
    const run = await h.start(); await h.service.idle('vox');
    const before = h.get(), calls = [...h.calls]; h.runtime.identity = 'replacement-provider';
    h.preflight.mockRejectedValueOnce(new Error('请先配置图片接口凭证。'));
    await expect(h.service.control({ id: 'vox', runId: run.id, action: 'resume' })).rejects.toThrow('图片接口凭证');
    expect(h.get()).toEqual(before); expect(h.calls).toEqual(calls);
    expect(h.release).toHaveBeenCalledTimes(2);
  });
  it('still blocks a changed provider from resubmitting an unknown request', async () => {
    const h = harness(async (d, n) => { if (n.kind === 'image') throw new Error('network closed after submit'); return d; });
    const run = await h.start(); await h.service.idle('vox');
    const before = h.get(), calls = [...h.calls]; h.runtime.identity = 'replacement-provider';
    await expect(h.service.control({ id: 'vox', runId: run.id, action: 'resume' })).rejects.toThrow('UNKNOWN');
    expect(h.get()).toEqual(before); expect(h.calls).toEqual(calls);
  });
});
describe('Vox runtime gates', () => {
  it('keeps planning, AI animation code and narration while image generation is disabled', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vox-no-image-runtime-'));
    try {
      const path = join(directory, 'voice.wav'); await writeFile(path, 'local voice fixture');
      const settings: VoxProductionSettings = { ...voxProductionSettings(), generateImages: false, authoring: { mode: 'ai-code', styleId: 'auto' } };
      const now = document().createdAt;
      const planFilm = vi.fn(async () => ({ treatment: '在同一连续镜头中展开城市街道的热岛机制，画面先呈现道路蓄热，再以树荫覆盖街道来表达降温，文字配合实测旁白推进。', fps: 24 }));
      const image = vi.fn(async () => { throw new Error('image generation must stay disabled'); });
      const cutout = vi.fn(async () => { throw new Error('background removal must stay disabled'); });
      const speech = vi.fn(async (input, requestId) => ({ durationMs: 4200, record: { id: requestId, text: input.text, provider: input.provider, voiceId: input.voiceId,
        voiceLabel: input.voiceLabel, speed: input.speed, audioPath: path, status: 'generated' as const, errorMessage: '', createdAt: now, finishedAt: now } }));
      const generateFilm = vi.fn(async (prompt: string) => nativeHtml(JSON.parse(prompt).durationMs));
      const runtime = createVoxProductionRuntime(operations({ planFilm, image, cutout, speech, generateFilm, compileCode: compileVoxCode, previewCode: async () => ['preview.png'] }));
      const h = harness();
      h.runtime.identity = runtime.identity;
      h.runtime.input = (d, node) => runtime.input(d, node);
      h.runtime.execute = (d, node) => ['render', 'verify'].includes(node.kind) ? Promise.resolve(d) : runtime.execute(d, node);

      const started = await h.start(settings); await h.service.idle('vox');

      expect(h.get().productionRun, h.get().productionRun?.message).toMatchObject({ id: started.id, status: 'completed', settings: { generateImages: false, narration: true, authoring: { mode: 'ai-code' } } });
      expect(planFilm).toHaveBeenCalledOnce();
      expect(speech).toHaveBeenCalled();
      expect(generateFilm).toHaveBeenCalledOnce();
      expect(image).not.toHaveBeenCalled();
      expect(cutout).not.toHaveBeenCalled();
      expect(h.get().productionRun!.nodes.some(node => node.kind === 'image' || node.kind === 'cutout')).toBe(false);
      expect(h.get().productionRun!.nodes.some(node => node.kind === 'film-code' && node.status === 'completed')).toBe(true);
      expect(h.errors).toEqual([]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it.each([false, true])('retries a rejected image with a replacement model using actual runtime inputs (%s legacy journal)', async legacy => {
    const directory = await mkdtemp(join(tmpdir(), 'vox-model-retry-'));
    try {
      const path = join(directory, 'image.png'); await writeFile(path, 'local compile fixture');
      const now = document().createdAt;
      const generatedImage = (input: Parameters<VoxProductionOperations['image']>[0], requestId: string) => ({ id: requestId, prompt: input.prompt, ratio: input.ratio, style: '', provider: 'gpt_image' as const, imagePath: path,
        status: 'generated' as const, errorMessage: '', resolution: '1K' as const, smartMode: 'text-to-image' as const, referenceImagePaths: [], referenceImagePath: '', upstreamTaskId: null, createdAt: now, finishedAt: now });
      const firstImage = vi.fn(async (input, requestId) => {
        if (firstImage.mock.calls.length === 2) return { ...generatedImage(input, requestId), imagePath: '', status: 'failed' as const, errorMessage: 'Image provider API error (400): image generation did not complete successfully.' };
        return generatedImage(input, requestId);
      });
      const replacementImage = vi.fn(async (input, requestId) => generatedImage(input, requestId));
      const plan = vi.fn(async () => ({ shots: document().beats.flatMap(b => b.shots.map(s => ({ id: s.id, title: '城市热岛', scenePrompt: 'Concrete city scene with separate subjects and contextual environment' }))) }));
      const speech = vi.fn(async (input, requestId) => ({ durationMs: 4200, record: { id: requestId, text: input.text, provider: input.provider, voiceId: input.voiceId,
        voiceLabel: input.voiceLabel, speed: input.speed, audioPath: path, status: 'generated' as const, errorMessage: '', createdAt: now, finishedAt: now } }));
      const shared = { plan, speech, cutout: async () => ({ outputPath: path, metadata: { method: 'green-key' as const, quality: 'passed' as const, transparentFraction: .6, foregroundFraction: .4, edgeFraction: .05 } }) };
      let runtime = createVoxProductionRuntime(operations({ ...shared, identity: 'sunburst', imageModel: 'gpt-image-2.5-sunburst', image: firstImage }));
      const h = harness(); h.runtime.identity = runtime.identity;
      h.runtime.input = (d, n) => runtime.input(d, n);
      h.runtime.execute = (d, n) => ['render', 'verify'].includes(n.kind) ? Promise.resolve(d) : runtime.execute(d, n);
      await h.start(); await h.service.idle('vox');
      const before = h.get(), completed = before.productionRun!.nodes.filter(n => n.status === 'completed');
      const rejected = before.productionRun!.nodes.find(n => n.status === 'failed')!;
      expect(rejected.kind).toBe('image'); expect(completed.some(n => n.kind === 'image')).toBe(true);
      if (legacy) { rejected.status = 'unknown'; h.set(before); }
      runtime = createVoxProductionRuntime(operations({ ...shared, identity: 'flare', imageModel: 'gpt-image-2.5-flare', image: replacementImage }));
      h.runtime.identity = runtime.identity;
      await h.service.control({ id: 'vox', runId: before.productionRun!.id, action: 'resume' }); await h.service.idle('vox');
      const after = h.get(); expect(after.productionRun).toMatchObject({ id: before.productionRun!.id, status: 'completed', runtimeIdentity: 'flare' });
      expect(plan).toHaveBeenCalledOnce(); expect(firstImage).toHaveBeenCalledTimes(2);
      expect(replacementImage.mock.calls[0][1]).toBe(after.productionRun!.nodes.find(n => n.id === rejected.id)!.requestId);
      for (const node of completed) expect(after.productionRun!.nodes.find(n => n.id === node.id)).toMatchObject({ status: 'completed', requestId: node.requestId, attempt: 1 });
      expect(after.productionRun!.nodes.find(n => n.id === rejected.id)).toMatchObject({ status: 'completed', attempt: 2 });
      expect(h.preflight.mock.calls.at(-1)?.[2]?.some((n: { id: string }) => completed.some(done => done.id === n.id))).toBe(false);
      expect(h.errors).toEqual([]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
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
    expect(result.beats[0].shots[0].animation!.template.props.assetIds).toEqual(['plate']);
    expect(result.beats[0].shots[0].animation!.creativeStyle?.composition).toBe('scene');
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
  it('requires an audible final track for music-only films with narration disabled', async () => {
    const d = document(), settings = { ...voxProductionSettings(), narration: false, music: { id: 'song', title: 'Song', path: 'song.wav', durationMs: 15000, gainDb: 0, loop: false, fadeInMs: 0, fadeOutMs: 0 } };
    d.productionRun = { version: 1, id: 'r', status: 'running', settings, sourceHash: '', runtimeIdentity: '', nodes: [], createdAt: d.createdAt, updatedAt: d.updatedAt };
    const fingerprint = directorDocumentRenderFingerprint(d);
    d.assets.push({ id: 'final', assetId: 'director-final-video', kind: 'video', localPath: 'final.mp4', selected: true, renderFingerprint: fingerprint, createdAt: d.createdAt });
    d.qualityReports.push({ id: 'quality', workflowKind: d.workflowKind, stage: 'export', status: 'passed', checks: [], createdAt: d.createdAt });
    const verifyVideo = vi.fn(async () => {}), runtime = createVoxProductionRuntime(operations({ verifyVideo }));
    const node = buildVoxProductionNodes(d, settings).find(n => n.kind === 'verify')!;
    await runtime.execute(d, node);
    expect(verifyVideo).toHaveBeenCalledWith('final.mp4', d.timeline!.durationMs, true);
    verifyVideo.mockRejectedValueOnce(new Error('missing audio'));
    await expect(runtime.execute(d, node)).rejects.toThrow('missing audio');
  });
  it('keeps existing narration and subtitle alignment when new narration is disabled', async () => {
    const d = document(), settings = { ...voxProductionSettings(), narration: false }, shot = d.beats[0].shots[0];
    d.productionRun = { version: 1, id: 'r', status: 'running', settings, sourceHash: '', runtimeIdentity: '', nodes: [], createdAt: d.createdAt, updatedAt: d.updatedAt };
    shot.voiceAssetVersionId = 'old-voice'; const cue = d.beats[0].subtitleCues[0]; cue.audioAssetVersionId = 'old-voice'; cue.voiceId = 'old';
    d.timeline!.audioClips = [{ id: 'existing-narration', shotId: shot.id, trackType: 'narration', assetVersionId: 'old-voice', startMs: 0, durationMs: 4200 }];
    const runtime = createVoxProductionRuntime(operations()); const result = await runtime.execute(d, buildVoxProductionNodes(d, settings).find(n => n.kind === 'timing')!);
    expect(result.beats[0].shots[0].voiceAssetVersionId).toBe('old-voice');
    expect(result.beats[0].subtitleCues[0]).toMatchObject({ audioAssetVersionId: 'old-voice', voiceId: 'old' });
    expect(result.timeline!.audioClips).toEqual(d.timeline!.audioClips);
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


describe('planner failure receipts', () => {
 it.each([true, false])('retains the original paid reply without changing the film or resending (complete=%s)', async complete => {
  const raw = '{"treatment":"partial original text';
  const result = { raw, text: raw, requestId: 'provider-plan-receipt', ...(complete ? { finishReason: 'max_tokens' } : {}), usage: { output_tokens: 4096 } };
  const h = harness(async (d, n) => {
   if (n.kind === 'plan') throw complete ? new LlmJsonParseError('LLM_JSON_TRUNCATED: plan', raw, result) : new LlmTextInterruptedError(result, new Error('connection closed'));
   return d;
  });
  const before = h.get(); const run = await h.start(); await h.service.idle('vox');
  const failed = h.get(), node = failed.productionRun!.nodes.find(n => n.kind === 'plan')!;
  expect(node).toMatchObject({ status: complete ? 'failed' : 'unknown', resultReceived: complete, llmResponse: { text: raw, requestId: result.requestId, truncated: false, usage: result.usage } });
  expect(failed.sourceText).toBe(before.sourceText); expect(failed.creativeFilms).toEqual(before.creativeFilms);
  expect(parseEditorialCollagePipelineData(failed).productionRun!.nodes[0].llmResponse).toEqual(node.llmResponse);
  const receipt = await h.store.recover('vox', node); expect(receipt?.productionRun?.nodes[0].llmResponse?.text).toBe(raw);
  expect(h.calls).toEqual(['plan']); expect(h.errors).toEqual([]);
  if (!complete) {
   await expect(h.service.control({ id: 'vox', runId: run.id, action: 'resume' })).rejects.toThrow('UNKNOWN');
   await h.service.control({ id: 'vox', runId: run.id, action: 'reconcile' });
   expect(h.get().productionRun!.nodes[0].status).toBe('unknown'); expect(h.calls).toEqual(['plan']);
  }
 });
 it('does not apply a single-response outcome to non-planning paid nodes', async () => {
  const result = { text: 'bad JSON', raw: 'bad JSON', requestId: 'provider-image', finishReason: 'end_turn' };
  const h = harness(async (d, n) => { if (n.kind === 'image') throw new LlmJsonParseError('invalid', result.raw, result); return d; });
  await h.start(); await h.service.idle('vox');
  const node = h.get().productionRun!.nodes.find(n => n.kind === 'image')!;
  expect(node.status).toBe('unknown'); expect(node.llmResponse).toBeUndefined(); expect(node.resultReceived).toBe(false);
 });
});

it('reports disk-full worker interruption truthfully without calling it an application restart', async () => {
  const h = harness(); let fail = true;
  h.runtime.expand = () => { if (fail) { fail = false; throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' }); } return undefined; };
  const run = await h.start(); await h.service.idle('vox');
  expect(h.get().productionRun!.status).toBe('paused');
  expect(h.get().productionRun!.message).toContain('磁盘空间不足');
  expect(h.get().productionRun!.message).not.toContain('应用已重启');
  expect(h.calls).toHaveLength(0);
  await h.service.control({ id: 'vox', runId: run.id, action: 'resume' }); await h.service.idle('vox');
  expect(h.get().productionRun!.status).toBe('completed');
});
