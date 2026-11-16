import { describe, expect, it, vi } from 'vitest';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, type EditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { buildVoxProductionNodes, voxProductionSettings, voxProductionRunSchema, voxProductionSingleRequestNode, isVoxProductionSubmissionRejection, type VoxProductionNode } from '../src/shared/vox-production';
import { createVoxProductionRuntime, type VoxProductionOperations } from '../electron/vox-production-runtime';
import { VoxProductionService, voxInputHash } from '../electron/vox-production-service';
import { newCodeVideoPolicy } from '../src/shared/creative-animation/production-policy';

const hash = 'a'.repeat(64);
function document() {
  const d = createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'pi', title: 'Pi', ratio: '16:9' }), '道路吸收阳光。', '2026-10-23T00:00:00.000Z', 15000);
  const settings = { ...voxProductionSettings(), narration: false, authoring: { mode: 'ai-code' as const, styleId: 'auto' } };
  d.productionRun = { version: 1, id: 'run', engine: 'lemo-native-v1', authoringVersion: 4, status: 'paused', settings, nodes: [], sourceHash: voxInputHash(d.sourceText), runtimeIdentity: 'model/protocol/reasoning', createdAt: d.createdAt, updatedAt: d.updatedAt };
  return d;
}
function ready(d: EditorialCollagePipelineData) {
  return { ...d, piFilm: { version: 1 as const, authoringVersion: 4 as const, runId: d.productionRun!.id, styleId: 'auto', policy: newCodeVideoPolicy(), sessionRef: 'session.json', phase: 'ready' as const, segment: 1, completedModelRequests: 2, sourceHash: hash, timelineHash: hash, assetHash: hash, actualDurationSeconds: 15, narrationPauses: [], acceptedPauseChanges: 0, message: '', evidence: { sourceHash: hash, timelineHash: hash, assetHash: hash, renderIdentity: { engine: 'lemo-upstream' as const, browserVersion: 'test', sourceHash: hash, timelineHash: hash, assetHash: hash, width: 1920, height: 1080, fps: 30, captionMode: 'film' as const }, technicalPassed: true, readingPassed: true, audioPassed: true, contactSheetPasses: 2, previewRef: 'preview.mp4', creditsPassed: true, visuallyReviewed: false, humanReviewed: false } } };
}
function operations(overrides: Partial<VoxProductionOperations> = {}): VoxProductionOperations {
  const never = vi.fn(async (): Promise<never> => { throw new Error('unexpected paid call'); });
  return { identity: 'model/protocol/reasoning', nativeWorkflowVersion: 4, imageModel: '', voiceModel: '', voice: { provider: 'volcengine', voiceId: '', voiceLabel: '', speed: 1 }, preflight() {}, plan: never, image: never, speech: never, cutout: never, render: async d => d, compileCode: () => ({ compiled: '' }), verifyVideo: never, ...overrides };
}
const segment: VoxProductionNode = { id: 'pi-segment:1', kind: 'agent-segment', dependencies: [], paid: true, status: 'pending', attempt: 0 };
function harness(d: EditorialCollagePipelineData, ops: VoxProductionOperations) {
  let current = d;
  const runtime = createVoxProductionRuntime(ops);
  const service = new VoxProductionService({ load: async () => structuredClone(current), save: async value => (current = structuredClone(value)), projects: async () => [d.id] }, async () => runtime, () => {}, { retryDelayMs: () => 0 });
  return { service, runtime, get: () => current };
}

describe('Pi v4 production boundary', () => {
  it('gates v4 explicitly and leaves v3 default intact', () => {
    const ops = operations({ nativeWorkflowVersion: undefined, upstreamStep: async d => d });
    expect(createVoxProductionRuntime(ops).nativeWorkflowVersion).toBe(3);
    const d = document();
    expect(voxProductionRunSchema.parse(d.productionRun).authoringVersion).toBe(4);
    const nodes = buildVoxProductionNodes(d, d.productionRun!.settings, 'lemo-native-v1', 4);
    expect(nodes.some(n => n.kind === 'agent-segment')).toBe(true);
    expect(nodes.find(n => n.kind === 'render')!.dependencies).toContain('pi-audio-master');
    expect(voxProductionSingleRequestNode(segment)).toBe(false);
    expect(isVoxProductionSubmissionRejection(segment, 'HTTP 429 rate limit')).toBe(false);
  });

  it('routes segment/recovery without shot lookup and excludes v4 spending limits from content identity', async () => {
    const piSegment = vi.fn(async (d: EditorialCollagePipelineData) => ready(d));
    const recoverPiSegment = vi.fn(async (d: EditorialCollagePipelineData) => ready(d));
    const runtime = createVoxProductionRuntime(operations({ piSegment, recoverPiSegment })), d = document();
    expect(await runtime.execute(d, segment)).toHaveProperty('piFilm.segment', 1);
    await runtime.recover!(d, segment);
    expect(recoverPiSegment).toHaveBeenCalledOnce();
    const input = voxInputHash(runtime.input(d, segment));
    expect(voxInputHash(runtime.input({ ...d, sourceText: 'changed' }, segment))).not.toBe(input);
    expect(voxInputHash(runtime.input({ ...d, timeline: { ...d.timeline!, durationMs: 18000 } }, segment))).not.toBe(input);
    expect(voxInputHash(createVoxProductionRuntime(operations({ identity: 'other/protocol/reasoning' })).input(d, segment))).not.toBe(input);
    const budgetChanged = { ...d, productionRun: { ...d.productionRun!, settings: { ...d.productionRun!.settings, piMaxRequests: 240, agentMaxTokens: 2_000_000, agentMaxCost: 20, agentMaxTurns: 12 } } };
    expect(voxInputHash(runtime.input(budgetChanged, segment))).toBe(input);
  });

  it('checks final evidence and requires a current audio master before render', async () => {
    const render = vi.fn(async (d: EditorialCollagePipelineData) => d);
    const piAudioMaster = vi.fn(async (d: EditorialCollagePipelineData) => ({ ...d, piFilm: { ...d.piFilm!, audioMaster: { path: 'master.wav', sha256: hash, sourceHash: hash, timelineHash: hash, durationSeconds: 15, sampleRate: 48000 as const, channels: 2 as const } } }));
    const runtime = createVoxProductionRuntime(operations({ render, piAudioMaster }));
    const node = (kind: VoxProductionNode['kind']) => ({ ...segment, id: kind, kind, paid: false });
    await expect(runtime.execute(document(), node('film-finalize'))).rejects.toThrow('PI_FILM_NOT_READY');
    const d = ready(document());
    await runtime.execute(d, node('film-finalize'));
    await expect(runtime.execute(d, node('render'))).rejects.toThrow('PI_AUDIO_MASTER_STALE');
    const mastered = await runtime.execute(d, node('audio-master'));
    await runtime.execute(mastered, node('render'));
    expect(render).toHaveBeenCalledOnce();
  });

  it('never generically retries a multi-request segment and requires ledger reconciliation', async () => {
    const piSegment = vi.fn(async (): Promise<never> => { throw new Error('HTTP 429 rate limit'); });
    const recoverPiSegment = vi.fn(async () => undefined);
    const d = document(), h = harness(d, operations({ piSegment, recoverPiSegment }));
    await h.service.control({ id: d.id, runId: 'run', action: 'resume' });
    await h.service.idle(d.id);
    expect(piSegment).toHaveBeenCalledOnce();
    expect(recoverPiSegment).toHaveBeenCalledOnce();
    expect(h.get().productionRun!.nodes.find(n => n.kind === 'agent-segment')!.status).toBe('unknown');
    await expect(h.service.control({ id: d.id, runId: 'run', action: 'retry-unknown', nodeId: segment.id })).rejects.toThrow('PI_RECONCILIATION_REQUIRED');
    await expect(h.service.control({ id: d.id, runId: 'run', action: 'confirm-no-result', nodeId: segment.id, evidence: 'confirmed no result' })).rejects.toThrow('PI_RECONCILIATION_REQUIRED');
  });

  it('clears only Pi state for new v4 runs and defaults the request budget to 120', async () => {
    const d = ready(document());
    const h = harness(d, operations({ piSegment: async () => { throw new Error('stop fake'); } }));
    const run = await h.service.start({ id: d.id, expectedUpdatedAt: d.updatedAt, settings: d.productionRun!.settings });
    expect(run.settings.piMaxRequests).toBe(120);
    expect(h.get().piFilm).toBeUndefined();
    await h.service.idle(d.id);
    expect(voxProductionSettings().piMaxRequests).toBeUndefined();
  });

  it('adopts updated v4 request and usage budgets on resume', async () => {
    const d = document();
    const h = harness(d, operations({ piSegment: async () => { throw new Error('stop fake'); } }));
    const run = await h.service.control({ id: d.id, runId: 'run', action: 'resume', budget: { piMaxRequests: 240, agentMaxTokens: 2_000_000, agentMaxCost: 20 } });
    expect(run.settings).toMatchObject({ piMaxRequests: 240, agentMaxTokens: 2_000_000, agentMaxCost: 20 });
    expect(h.get().productionRun!.settings.piMaxRequests).toBe(240);
    await h.service.idle(d.id);
  });

  it('expands multiple segments through finalization, audio master and render without paid providers', async () => {
    const calls: string[] = [];
    const d = document();
    d.sourceText = '道'.repeat(12_001);
    d.productionRun!.sourceHash = voxInputHash(d.sourceText);
    let segmentRuns = 0;
    const h = harness(d, operations({
      piSegment: async (value, node) => {
        calls.push(node.id);
        segmentRuns++;
        const film = ready(value).piFilm;
        return { ...value, piFilm: { ...film, segment: segmentRuns > 1 ? 2 : 1, ...(segmentRuns > 1 ? { phase: 'ready' as const, audioMaster: { path: 'master.wav', sha256: hash, sourceHash: hash, timelineHash: hash, durationSeconds: 15, sampleRate: 48000 as const, channels: 2 as const } } : { phase: 'paused' as const }) } };
      },
      piAudioMaster: async value => { calls.push('master'); return { ...value, piFilm: { ...value.piFilm!, audioMaster: { path: 'master.wav', sha256: hash, sourceHash: hash, timelineHash: hash, durationSeconds: 15, sampleRate: 48000, channels: 2 } } }; },
      render: async value => { calls.push('render'); return value; },
    }));
    const execute = h.runtime.execute;
    h.runtime.execute = async (value, node) => node.kind === 'verify' ? value : execute(value, node);
    await h.service.control({ id: d.id, runId: 'run', action: 'resume' });
    await h.service.idle(d.id);
    expect(h.get().productionRun!.status).toBe('paused');
    expect(calls).toEqual(['pi-segment:1']);
    await h.service.control({ id: d.id, runId: 'run', action: 'resume' });
    await h.service.idle(d.id);
    expect(h.get().productionRun!.status).toBe('completed');
    expect(calls).toEqual(['pi-segment:1', 'pi-segment:1', 'pi-segment:2', 'master', 'render']);
    expect(h.get().productionRun!.nodes.every(node => node.status === 'completed')).toBe(true);
  });

  it('cooperatively interrupts the active runtime and persists pause', async () => {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const interrupt = vi.fn(() => release());
    const d = document(), h = harness(d, operations({ interrupt, piSegment: async () => { entered(); await waiting; throw new Error('interrupted'); } }));
    await h.service.control({ id: d.id, runId: 'run', action: 'resume' });
    await started;
    await h.service.control({ id: d.id, runId: 'run', action: 'pause' });
    await h.service.idle(d.id);
    expect(interrupt).toHaveBeenCalledWith('pause');
    expect(h.get().productionRun!.status).toBe('paused');
    expect(h.get().productionRun!.nodes.find(n => n.kind === 'agent-segment')!.status).toBe('unknown');
  });

  it('records human review only on current v4 evidence without any model request', async () => {
    const piSegment = vi.fn(async (d: EditorialCollagePipelineData) => ready(d));
    const d = ready(document()), h = harness(d, operations({ piSegment }));
    expect(h.get().piFilm!.evidence!.humanReviewed).toBe(false);
    const run = await h.service.control({ id: d.id, runId: 'run', action: 'confirm-human-review' });
    expect(run.id).toBe('run');
    expect(h.get().piFilm!.evidence!.humanReviewed).toBe(true);
    await h.service.control({ id: d.id, runId: 'run', action: 'confirm-human-review' });
    expect(h.get().piFilm!.evidence!.humanReviewed).toBe(true);
    expect(piSegment).not.toHaveBeenCalled();
  });

  it('rejects human review when v4 evidence is missing or stale', async () => {
    const missing = document(), a = harness(missing, operations());
    await expect(a.service.control({ id: missing.id, runId: 'run', action: 'confirm-human-review' })).rejects.toThrow('PI_HUMAN_REVIEW_NOT_READY');
    const base = ready(document()), stale = { ...base, piFilm: { ...base.piFilm, timelineHash: 'b'.repeat(64) } };
    const b = harness(stale as EditorialCollagePipelineData, operations());
    await expect(b.service.control({ id: base.id, runId: 'run', action: 'confirm-human-review' })).rejects.toThrow('PI_HUMAN_REVIEW_NOT_READY');
    expect(b.get().piFilm!.evidence!.humanReviewed).toBe(false);
  });
});
