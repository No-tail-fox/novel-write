import { describe, expect, it, vi } from 'vitest';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, type EditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { voxProductionSettings, type VoxProductionControl, type VoxProductionNode } from '../src/shared/vox-production';
import { createVoxProductionRuntime, type VoxProductionOperations } from '../electron/vox-production-runtime';
import { VoxProductionService, voxInputHash, type VoxProductionRuntime } from '../electron/vox-production-service';

function fixture(authoringVersion: 1 | 2 | 3 | undefined) {
  const d = createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'v3', title: '测试', ratio: '16:9' }), '道路吸收阳光。', '2026-10-23T00:00:00.000Z', 15000);
  const node: VoxProductionNode = { id: 'film-edit:1', kind: 'film-edit', fileId: '1', paid: true, dependencies: [], status: 'pending', attempt: 0 };
  d.productionRun = { version: 1, id: 'run', engine: 'lemo-native-v1', authoringVersion: authoringVersion as unknown as 2 | 3 | undefined, status: 'paused', settings: voxProductionSettings(), nodes: [node], sourceHash: voxInputHash(d.sourceText), runtimeIdentity: 'test', createdAt: d.createdAt, updatedAt: d.updatedAt };
  return d;
}
function harness(initial: EditorialCollagePipelineData, execute = vi.fn(async (d: EditorialCollagePipelineData) => d)) {
  let doc = structuredClone(initial);
  const save = vi.fn(async (d: EditorialCollagePipelineData) => (doc = structuredClone(d)));
  const preflight = vi.fn();
  const runtime: VoxProductionRuntime = { identity: 'test', nativeWorkflowVersion: 3, preflight, input: (_d, n) => n.id, execute };
  const factory = vi.fn(async () => runtime);
  const service = new VoxProductionService({ load: async () => structuredClone(doc), save, projects: async () => [doc.id] }, factory);
  return { service, save, preflight, factory, get: () => doc };
}

describe('v3 execution boundary', () => {
  it.each([undefined, 1, 2] as const)('rejects historical native version %s without changing saved data', async version => {
    const d = fixture(version), h = harness(d);
    for (const action of ['resume', 'retry-unknown', 'reconcile', 'confirm-no-result', 'recheck-code']) {
      await expect(h.service.control({ id: d.id, runId: 'run', action, nodeId: 'film-edit:1', evidence: '服务商已确认请求没有结果' } as VoxProductionControl)).rejects.toThrow('LEMO_LEGACY_RUN_UNSUPPORTED');
    }
    await h.service.restore();
    expect(h.get()).toEqual(d);
    expect(h.save).not.toHaveBeenCalled();
    expect(h.factory).not.toHaveBeenCalled();
  });

  it('rejects old runtime entry points before invoking providers', async () => {
    const call = vi.fn(async (): Promise<never> => { throw new Error('provider called'); });
    const ops: VoxProductionOperations = { identity: 'test', imageModel: '', voiceModel: '', voice: { provider: 'volcengine', voiceId: '', voiceLabel: '', speed: 1 }, preflight: call, plan: call, image: call, speech: call, cutout: call, render: call, compileCode: () => ({ compiled: '' }), verifyVideo: call, upstreamStep: call };
    const runtime = createVoxProductionRuntime(ops), d = fixture(2), node = d.productionRun!.nodes[0];
    expect(() => runtime.expand!(d)).toThrow('LEMO_LEGACY_RUN_UNSUPPORTED');
    expect(() => runtime.input(d, node)).toThrow('LEMO_LEGACY_RUN_UNSUPPORTED');
    await expect(runtime.execute(d, node)).rejects.toThrow('LEMO_LEGACY_RUN_UNSUPPORTED');
    await expect(runtime.recover!(d, node)).rejects.toThrow('LEMO_LEGACY_RUN_UNSUPPORTED');
    expect(call).not.toHaveBeenCalled();
  });

  it('keeps v3 pause, resume and explicit unknown retry', async () => {
    const d = fixture(3), execute = vi.fn(async (doc: EditorialCollagePipelineData) => doc), h = harness(d, execute);
    await h.service.control({ id: d.id, runId: 'run', action: 'pause' });
    await h.service.control({ id: d.id, runId: 'run', action: 'resume' });
    await h.service.idle(d.id);
    expect(h.get().productionRun!.status).toBe('completed');
    expect(execute).toHaveBeenCalledOnce();
    const unknown = fixture(3);
    unknown.productionRun!.status = 'failed';
    unknown.productionRun!.nodes[0].status = 'unknown';
    unknown.productionRun!.nodes[0].requestId = 'old-receipt';
    const retry = harness(unknown);
    await retry.service.control({ id: d.id, runId: 'run', action: 'retry-unknown', nodeId: 'film-edit:1' });
    await retry.service.idle(d.id);
    expect(retry.get().productionRun!.status).toBe('completed');
    expect(retry.get().productionRun!.nodes[0].retryOfRequestId).toBe('old-receipt');
  });
});
