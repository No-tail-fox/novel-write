import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { nativeDocument, nativeOperations, nativeSettings } from './lemo-native.fixture';
import { parseEditorialCollagePipelineData, type EditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { buildLemoOfficialNodes } from '../src/shared/lemo-upstream-graph';
import { buildVoxProductionNodes, voxProductionRunSchema, type VoxProductionNode } from '../src/shared/vox-production';
import { LEMO_NATIVE_ENGINE } from '../src/shared/creative-animation/native-film';
import { buildDirectorRenderScenes, directorDocumentRenderFingerprint } from '../src/shared/director-render';
import { createVoxProductionRuntime, type VoxProductionOperations } from '../electron/vox-production-runtime';
import { VoxProductionService, voxInputHash } from '../electron/vox-production-service';
import { defaultLemoProductionBudget } from '../src/shared/lemo-production-budget';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
async function readyDocument(d: EditorialCollagePipelineData) {
  const base = resolve('.artifacts/lemo-official-unit'); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, 'film-')); roots.push(directory);
  const bytes = Buffer.from('<html>offline scheduler fixture, not a rendered film</html>');
  await writeFile(join(directory, 'index.html'), bytes);
  const sourceHash = hash(JSON.stringify([{ path: 'index.html', sha256: hash(bytes), bytes: bytes.length }]));
  return { ...d, upstreamFilm: { version: 1 as const, runId: d.productionRun!.id, styleId: 'watercolor', directory,
    turn: 1, status: 'ready' as const, sourceHash, lastTool: 'official-finish', message: 'Offline test receipt',
    review: { sourceHash, technicalPassed: true, frames: [], durationSeconds: d.timeline!.durationMs / 1000 },
    visualReview: { sourceHash, notes: 'Offline test-only visual review receipt; no artistic acceptance is claimed.', turn: 1 } } };
}
function withRun(version: 2 | 3 | 4 = 4, identity = 'native-offline-test') {
  const d = nativeDocument(), settings = nativeSettings();
  d.productionRun = { version: 1, id: 'fixed-run', status: 'paused', engine: LEMO_NATIVE_ENGINE, authoringVersion: version,
    settings, nodes: buildVoxProductionNodes(d, settings, LEMO_NATIVE_ENGINE, 4),
    sourceHash: voxInputHash(d.sourceText), runtimeIdentity: identity, createdAt: d.createdAt, updatedAt: d.updatedAt };
  return d;
}
function harness(overrides: Partial<VoxProductionOperations> = {}, initial = nativeDocument(), executeRender = false) {
  let document = initial, revision = Date.parse(initial.updatedAt);
  const calls: string[] = [], errors: unknown[] = [], receipts = new Map<string, EditorialCollagePipelineData>();
  const officialStep = vi.fn<NonNullable<VoxProductionOperations['officialStep']>>(async d => readyDocument(d));
  const recoverOfficialStep = vi.fn<NonNullable<VoxProductionOperations['recoverOfficialStep']>>(async () => undefined);
  const preflight = vi.fn();
  // These cases inject only the final authoring failure; dedicated staged tests cover the earlier real artifact boundaries.
  const finalStep = Object.hasOwn(overrides, 'officialStep') ? overrides.officialStep : officialStep;
  const runtime = createVoxProductionRuntime(nativeOperations({ recoverOfficialStep, preflight, ...overrides,
    officialStep: finalStep ? (d, n, s) => n.id === 'official-authoring' ? finalStep(d, n, s) : Promise.resolve(d) : undefined }));
  const execute = runtime.execute;
  runtime.execute = async (d, node, signal) => { calls.push(node.id); return node.kind === 'verify' || node.kind === 'render' && !executeRender ? d : execute(d, node, signal); };
  const store = { load: async () => structuredClone(document), projects: async () => [document.id],
    save: async (d: EditorialCollagePipelineData) => { document = parseEditorialCollagePipelineData({ ...d, updatedAt: new Date(++revision).toISOString() }); return structuredClone(document); },
    checkpoint: async (_id: string, n: VoxProductionNode, d: EditorialCollagePipelineData) => { receipts.set(n.requestId!, structuredClone(d)); },
    recover: async (_id: string, n: VoxProductionNode) => receipts.get(n.requestId!),
  };
  const service = new VoxProductionService(store, async () => runtime, e => errors.push(e));
  return { service, runtime, store, officialStep, recoverOfficialStep, preflight, calls, errors,
    get: () => structuredClone(document), set: (d: EditorialCollagePipelineData) => { document = structuredClone(d); },
    start: (settings = nativeSettings()) => service.start({ id: document.id, expectedUpdatedAt: document.updatedAt, settings }),
    control: (action: 'pause' | 'cancel' | 'resume' | 'reconcile') => service.control({ id: document.id, runId: document.productionRun!.id, action }),
    idle: () => service.idle(document.id) };
}

describe('official v4 production graph', () => {
  it('orders treatment, images, real style frame, measured voice lock and official film stages', () => {
    const d = nativeDocument(), settings = nativeSettings({ generateImages: true, narration: true });
    const nodes = buildLemoOfficialNodes(d, settings);
    expect(nodes.filter(n => n.kind === 'film-edit').map(n => [n.id, n.paid])).toEqual([['official-treatment', true], ['official-style-frame', true], ['official-voice-lock', false], ['official-authoring', true]]);
    for (const node of nodes) expect(node.dependencies.every(dep => nodes.findIndex(n => n.id === dep) >= 0 && nodes.findIndex(n => n.id === dep) < nodes.indexOf(node)), node.id).toBe(true);
    expect(nodes.some(n => n.kind === 'image' && n.paid)).toBe(true);
    expect(nodes.some(n => n.kind === 'cutout')).toBe(true);
    const stage = nodes.find(n => n.id === 'official-authoring')!;
    expect(stage.dependencies).toEqual(['official-voice-lock']);
    expect(nodes.find(n => n.id === 'official-voice-lock')!.dependencies).toEqual(nodes.filter(n => n.kind === 'timing').map(n => n.id));
    for (const timing of nodes.filter(n => n.kind === 'timing')) {
      expect(timing.dependencies).toContain('voice:' + timing.shotId);
      expect(timing.dependencies.some(dep => /^(image|cutout):/.test(dep))).toBe(true);
    }
    expect(nodes.slice(-3).map(n => [n.id, n.dependencies])).toEqual([['official-ready', ['official-authoring']], ['render', ['official-ready']], ['verify', ['render']]]);
  });
  it('keeps no-image production free of image calls and binds imported archives without fabricating them', () => {
    const d = nativeDocument();
    expect(buildLemoOfficialNodes(d, nativeSettings()).some(n => ['image', 'cutout', 'voice'].includes(n.kind))).toBe(false);
    const archives = buildLemoOfficialNodes(d, nativeSettings({ presetId: 'archival-story', generateImages: false }));
    expect(archives.some(n => n.kind === 'image')).toBe(true);
    expect(archives.filter(n => n.kind === 'image').every(n => !n.paid)).toBe(true);
  });
  it('defaults new native graphs to v4 and rejects explicitly requested old graphs', () => {
    const h = harness(); expect(h.runtime.nativeWorkflowVersion).toBe(4);
    for (const version of [1, 2, 3]) expect(() => buildVoxProductionNodes(nativeDocument(), nativeSettings(), LEMO_NATIVE_ENGINE, version)).toThrow('LEMO_WORKFLOW_UNSUPPORTED');
    expect(buildVoxProductionNodes(nativeDocument(), nativeSettings()).some(n => n.id === 'official-authoring')).toBe(true);
    expect(voxProductionRunSchema.parse(withRun().productionRun).authoringVersion).toBe(4);
  });
  it.each(['execution', 'recovery', 'both'] as const)('fails before starting when official %s dependencies are missing instead of falling back', async missing => {
    const upstreamStep = vi.fn(async (d: EditorialCollagePipelineData) => d), authorFilmFile = vi.fn();
    const h = harness({ upstreamStep, authorFilmFile, ...(missing !== 'recovery' ? { officialStep: undefined } : {}), ...(missing !== 'execution' ? { recoverOfficialStep: undefined } : {}) });
    expect(h.runtime.nativeWorkflowVersion).toBe(4);
    await expect(h.start()).rejects.toThrow('LEMO_OFFICIAL_UNAVAILABLE');
    expect(h.get().productionRun).toBeUndefined(); expect(h.preflight).not.toHaveBeenCalled();
    expect(upstreamStep).not.toHaveBeenCalled(); expect(authorFilmFile).not.toHaveBeenCalled(); expect(h.calls).toEqual([]);
  });
  it.each([undefined, 2, 3] as const)('rejects an old runtime advertising %s before creating a production run', async version => {
    const h = harness(); h.runtime.nativeWorkflowVersion = version;
    await expect(h.start()).rejects.toThrow('LEMO_OFFICIAL_UNAVAILABLE');
    expect(h.get().productionRun).toBeUndefined(); expect(h.calls).toEqual([]);
  });
  it.each([undefined, 2, 3] as const)('refuses stored native version %s rather than resuming or migrating it', async version => {
    const old = withRun(3); old.productionRun!.authoringVersion = version;
    const upstreamStep = vi.fn(async (d: EditorialCollagePipelineData) => d), h = harness({ upstreamStep }, old);
    const node = old.productionRun!.nodes.find(n => n.kind === 'film-edit')!;
    expect(() => h.runtime.expand!(old)).toThrow('LEMO_WORKFLOW_UNSUPPORTED');
    await expect(h.runtime.execute(old, node)).rejects.toThrow('LEMO_WORKFLOW_UNSUPPORTED');
    await expect(h.runtime.recover!(old, node)).rejects.toThrow('LEMO_WORKFLOW_UNSUPPORTED');
    await expect(h.control('resume')).rejects.toThrow('LEMO_WORKFLOW_UNSUPPORTED');
    await expect(h.start()).rejects.toThrow('LEMO_WORKFLOW_UNSUPPORTED');
    expect(upstreamStep).not.toHaveBeenCalled(); expect(h.officialStep).not.toHaveBeenCalled(); expect(h.get()).toEqual(old);
  });
  it('passes the live signal to v4 and rejects legacy planning nodes inside a v4 run', async () => {
    const officialStep = vi.fn(async (d: EditorialCollagePipelineData) => d);
    const h = harness({ officialStep }), d = withRun(), signal = new AbortController().signal;
    const node = d.productionRun!.nodes.find(n => n.id === 'official-authoring')!;
    await h.runtime.execute(d, node, signal); expect(officialStep).toHaveBeenCalledWith(d, node, signal);
    await expect(h.runtime.execute(d, { ...node, fileId: 'new-stage' }, signal)).rejects.toThrow('OFFICIAL_UNAVAILABLE');
    await expect(h.runtime.execute(d, { ...node, kind: 'plan' }, signal)).rejects.toThrow('LEMO_OFFICIAL_NODE_UNSUPPORTED');
  });
});

describe('official v4 durable scheduler', () => {
  it('repairs one shot in the original run and preserves successful source-stage receipts', async () => {
    const h = harness(); await h.start(nativeSettings({ lemoBudget: { ...defaultLemoProductionBudget(), maxRepairRounds: 1 } })); await h.idle();
    const before = h.get(), upstream = before.productionRun!.nodes.filter(n => !['official-ready', 'render', 'verify'].includes(n.id));
    const beforeCalls = h.calls.length;
    await h.service.control({ id: before.id, runId: before.productionRun!.id, action: 'repair-shot', shotId: before.beats[0].shots[0].id, instructions: 'Enlarge the selected foreground object.' }); await h.idle();
    const after = h.get(), repair = after.productionRun!.nodes.find(n => n.id.startsWith('official-repair:'))!;
    expect(after.productionRun).toMatchObject({ id: before.productionRun!.id, status: 'completed' });
    expect(h.calls.slice(beforeCalls)).toEqual([repair.id, 'official-ready', 'render', 'verify']);
    expect(after.productionRun!.nodes.filter(n => upstream.some(old => old.id === n.id))).toEqual(upstream);
    expect(h.officialStep).toHaveBeenCalledOnce();
    await expect(h.service.control({ id: after.id, runId: after.productionRun!.id, action: 'repair-shot', shotId: after.beats[0].shots[0].id, instructions: 'Apply another selected shot repair.' })).rejects.toThrow('LEMO_REPAIR_BUDGET_EXHAUSTED');
  });
  it('reconciles a saved repair and resumes only final checks without repurchasing prior stages', async () => {
    const h = harness(); await h.start(); await h.idle(); const before = h.get(), execute = h.runtime.execute;
    h.runtime.execute = async (d, n, signal) => { if (n.id.startsWith('official-repair:')) throw new Error('LEMO_OFFICIAL_SESSION_UNKNOWN'); return execute(d, n, signal); };
    await h.service.control({ id: before.id, runId: before.productionRun!.id, action: 'repair-shot', shotId: before.beats[0].shots[0].id, instructions: 'Repair only the selected composition.' }); await h.idle();
    const failed = h.get(), target = failed.productionRun!.nodes.find(n => n.id.startsWith('official-repair:'))!;
    expect(target.status).toBe('unknown');
    await expect(h.service.control({ id: before.id, runId: before.productionRun!.id, action: 'repair-shot', shotId: before.beats[0].shots[0].id, instructions: 'Do not bypass the prior unknown repair.' })).rejects.toThrow('LEMO_REPAIR_PENDING');
    h.recoverOfficialStep.mockImplementation(async d => readyDocument(d));
    await h.control('reconcile'); expect(h.get().productionRun!.nodes.find(n => n.id === target.id)!.status).toBe('completed');
    const count = h.calls.length; await h.control('resume'); await h.idle();
    expect(h.get().productionRun).toMatchObject({ id: before.productionRun!.id, status: 'completed' });
    expect(h.calls.slice(count)).toEqual(['official-ready', 'render', 'verify']); expect(h.officialStep).toHaveBeenCalledOnce();
  });
  it.each(['pause', 'cancel', 'shutdown'] as const)('propagates %s to the renderer and keeps the free render node pending', async action => {
    let entered!: () => void; const running = new Promise<void>(r => { entered = r; });
    const render = vi.fn<NonNullable<VoxProductionOperations['render']>>(async (_d, signal) => {
      expect(signal).toBeDefined(); entered();
      await new Promise<void>((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('RENDER_CANCELLED')), { once: true }));
      throw new Error('unreachable');
    });
    const h = harness({ render }, nativeDocument(), true); await h.start(); await running;
    if (action === 'shutdown') await h.service.stop(); else await h.control(action);
    await h.idle();
    expect(render).toHaveBeenCalledOnce(); expect(h.officialStep).toHaveBeenCalledOnce();
    expect(h.get().productionRun!.status).toBe(action === 'cancel' ? 'cancelled' : 'paused');
    expect(h.get().productionRun!.nodes.find(n => n.id === 'render')).toMatchObject({ status: 'pending', paid: false });
    expect(h.get().productionRun!.nodes.find(n => n.id === 'official-authoring')).toMatchObject({ status: 'completed' });
    expect(h.calls).not.toContain('verify'); expect(h.errors).toEqual([]);
  });
  it('uses official picture windows with host subtitles and invalidates output when source changes', async () => {
    const d = await readyDocument(withRun());
    expect(() => buildDirectorRenderScenes(d)).toThrow('LEMO_PICTURE_REQUIRED');
    const scenes = buildDirectorRenderScenes(d, undefined, { upstreamVideoPath: 'fixture-only-native.mp4' });
    const last = d.timeline!.clips.at(-1)!;
    const selected = buildDirectorRenderScenes(d, undefined, { shotIds: [last.shotId], upstreamVideoPath: 'fixture-only-native.mp4' });
    expect(selected).toHaveLength(1); expect(selected[0].videoStartMs).toBe(last.startMs);
    expect(scenes).toHaveLength(d.timeline!.clips.length);
    scenes.forEach((scene, i) => {
      expect(scene.preserveSourcePicture).toBe(true); expect(scene.videoPath).toBe('fixture-only-native.mp4');
      expect(scene.videoStartMs).toBe(d.timeline!.clips[i].startMs); expect(scene.layers).toEqual([]);
      expect(scene.transitionIn).toEqual({ type: 'cut', durationMs: 0 }); expect(scene.subtitleCues?.length).toBeGreaterThan(0);
    });
    const before = directorDocumentRenderFingerprint(d); d.upstreamFilm.message = 'progress only';
    expect(directorDocumentRenderFingerprint(d)).toBe(before); d.upstreamFilm.sourceHash = 'changed';
    expect(directorDocumentRenderFingerprint(d)).not.toBe(before);
  });
  it('completes through the ready gate and never reuses an old official stage for a fresh run', async () => {
    const h = harness(); await h.start(); await h.idle(); const first = h.get();
    expect(first.productionRun).toMatchObject({ status: 'completed', authoringVersion: 4 });
    expect(h.officialStep).toHaveBeenCalledOnce(); expect(h.calls.slice(-3)).toEqual(['official-ready', 'render', 'verify']);
    const before = h.runtime.input(first, first.productionRun!.nodes.find(n => n.id === 'official-authoring')!);
    first.upstreamFilm!.message = 'progress only'; first.upstreamFilm!.sourceHash = 'later-change';
    expect(h.runtime.input(first, first.productionRun!.nodes.find(n => n.id === 'official-authoring')!)).toEqual(before);
    await h.start(); await h.idle(); expect(h.officialStep).toHaveBeenCalledTimes(2);
    expect(h.get().productionRun!.id).not.toBe(first.productionRun!.id); expect(h.errors).toEqual([]);
  });
  it.each(['missing-review', 'tampered-file'] as const)('does not render an SDK success with %s', async fault => {
    const h = harness({ officialStep: async d => {
      const ready = await readyDocument(d);
      if (fault === 'missing-review') delete (ready.upstreamFilm as { visualReview?: unknown }).visualReview;
      else await writeFile(join(ready.upstreamFilm.directory, 'index.html'), 'changed after review', 'utf8');
      return ready;
    } });
    await h.start(); await h.idle(); expect(h.get().productionRun!.status).toBe('failed');
    expect(h.get().productionRun!.message).toContain('LEMO_AGENT_NOT_READY'); expect(h.calls).not.toContain('render');
  });
  it('recovers a durable ready artifact in the same run without another paid dispatch', async () => {
    let recovered: EditorialCollagePipelineData | undefined;
    const officialStep = vi.fn(async (d: EditorialCollagePipelineData) => { recovered = await readyDocument(d); throw new Error('checkpoint crash'); });
    const h = harness({ officialStep, recoverOfficialStep: async () => recovered });
    const run = await h.start(); await h.idle(); expect(h.get().productionRun!.nodes.find(n => n.id === 'official-authoring')!.status).toBe('unknown');
    await h.control('reconcile'); expect(h.get().productionRun!.nodes.find(n => n.id === 'official-authoring')!.status).toBe('completed');
    await h.control('resume'); await h.idle(); expect(h.get().productionRun).toMatchObject({ id: run.id, status: 'completed' });
    expect(officialStep).toHaveBeenCalledOnce(); expect(h.errors).toEqual([]);
  });
  it('does not adopt a forged recovery result before review and matching run validation', async () => {
    const d = withRun(), ready = await readyDocument(d); ready.upstreamFilm.runId = 'another-run';
    const h = harness({ recoverOfficialStep: async () => ready });
    await expect(h.runtime.recover!(d, d.productionRun!.nodes.find(n => n.id === 'official-authoring')!)).rejects.toThrow('LEMO_AGENT_NOT_READY');
  });
  it.each(['pause', 'cancel', 'shutdown'] as const)('aborts %s during a paid stage and retains unknown without replay', async action => {
    let entered!: () => void; const running = new Promise<void>(r => { entered = r; });
    const officialStep = vi.fn<NonNullable<VoxProductionOperations['officialStep']>>(async (_d, _node, signal) => {
      expect(signal).toBeDefined(); entered();
      await new Promise<void>((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('LEMO_SESSION_CANCELLED')), { once: true }));
      throw new Error('unreachable');
    });
    const h = harness({ officialStep }); const run = await h.start(); await running;
    if (action === 'shutdown') await h.service.stop(); else await h.control(action);
    await h.idle(); const current = h.get().productionRun!;
    expect(current.id).toBe(run.id); expect(current.status).toBe(action === 'cancel' ? 'cancelled' : 'paused');
    expect(current.nodes.find(n => n.id === 'official-authoring')).toMatchObject({ status: 'unknown', attempt: 1 });
    expect(h.calls).not.toContain('render'); expect(officialStep).toHaveBeenCalledOnce(); expect(h.errors).toEqual([]);
    if (action !== 'shutdown') await expect(h.start()).rejects.toThrow('VOX_PRODUCTION_UNKNOWN');
  });
  it('keeps a late result unknown after cancellation until explicit recovery', async () => {
    let entered!: () => void, finish!: () => void;
    const running = new Promise<void>(r => { entered = r; }), held = new Promise<void>(r => { finish = r; });
    const h = harness({ officialStep: async d => { entered(); await held; return readyDocument(d); } });
    await h.start(); await running; await h.control('pause'); finish(); await h.idle();
    expect(h.get().productionRun!.nodes.find(n => n.id === 'official-authoring')).toMatchObject({ status: 'unknown', resultReceived: true });
    expect(h.calls).not.toContain('render');
    await h.control('reconcile');
    expect(h.get().productionRun!.nodes.find(n => n.id === 'official-authoring')!.status).toBe('completed');
    expect(h.recoverOfficialStep).not.toHaveBeenCalled();
  });
  it('keeps explicit unknown retries in the original run and prevents confirm-no-result from bypassing its ledger', async () => {
    const officialStep = vi.fn(async () => { throw new Error('LEMO_LEDGER_BLOCKED'); });
    const h = harness({ officialStep }); const run = await h.start(); await h.idle();
    const first = h.get().productionRun!.nodes.find(n => n.id === 'official-authoring')!;
    await h.service.control({ id: h.get().id, runId: run.id, action: 'retry-unknown', nodeId: first.id }); await h.idle();
    const second = h.get().productionRun!.nodes.find(n => n.id === first.id)!;
    expect(second).toMatchObject({ fileId: 'official-film', retryOfRequestId: first.requestId, attempt: 2, status: 'unknown' });
    expect(h.get().productionRun!.id).toBe(run.id);
    await h.service.control({ id: h.get().id, runId: run.id, action: 'confirm-no-result', nodeId: first.id, evidence: 'Provider records reviewed; no result found.' });
    await expect(h.start()).rejects.toThrow('LEMO_OFFICIAL_RUN_PENDING');
    expect(h.get().productionRun!.id).toBe(run.id);
    await h.control('resume'); await h.idle(); expect(h.get().productionRun!.id).toBe(run.id);
    expect(h.get().productionRun!.nodes.find(n => n.id === first.id)!.status).toBe('unknown');
  });
  it('preflights changed runtime configuration without replacing the original v4 identity', async () => {
    const initial = withRun(4, 'original-config'), h = harness({}, initial); const before = h.get();
    await expect(h.control('resume')).rejects.toThrow('LEMO_OFFICIAL_CONFIG_CHANGED');
    expect(h.preflight).toHaveBeenCalledOnce(); expect(h.officialStep).not.toHaveBeenCalled(); expect(h.get()).toEqual(before);
  });
});
