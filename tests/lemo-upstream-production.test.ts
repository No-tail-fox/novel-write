import { describe, expect, it, vi } from 'vitest';
import { nativeDocument, nativeHarness, nativeSettings } from './lemo-native.fixture';
import { buildLemoUpstreamNodes } from '../src/shared/lemo-upstream-graph';
import { LEMO_AGENT_MAX_TURNS } from '../src/shared/creative-animation/upstream-agent';
import { LEMO_NATIVE_ENGINE } from '../src/shared/creative-animation/native-film';
import { parseEditorialCollagePipelineData, type EditorialCollagePipelineData } from '../src/shared/editorial-collage';
import type { VoxProductionControl } from '../src/shared/vox-production';
import { voxInputHash } from '../electron/vox-production-service';

function archivedRun() {
  const d = nativeDocument(), settings = nativeSettings();
  d.productionRun = { version: 1, id: 'historical-v3', engine: LEMO_NATIVE_ENGINE, authoringVersion: 3, status: 'paused', settings,
    nodes: buildLemoUpstreamNodes(d, settings), sourceHash: voxInputHash(d.sourceText), runtimeIdentity: 'native-offline-test', createdAt: d.createdAt, updatedAt: d.updatedAt };
  const node = d.productionRun.nodes.find(n => n.kind === 'film-edit')!;
  node.status = 'unknown'; node.attempt = 1; node.requestId = 'old-provider-request';
  return parseEditorialCollagePipelineData(d);
}

describe('retired v3 production entrypoints', () => {
  it('never substitutes the custom upstream agent for missing official SDK operations', async () => {
    const upstreamStep = vi.fn(async (d: EditorialCollagePipelineData) => d), recoverUpstreamStep = vi.fn();
    const h = nativeHarness({ upstreamStep, recoverUpstreamStep });
    await expect(h.start()).rejects.toThrow('LEMO_OFFICIAL_UNAVAILABLE');
    expect(h.get().productionRun).toBeUndefined(); expect(h.calls).toEqual([]);
    expect(upstreamStep).not.toHaveBeenCalled(); expect(recoverUpstreamStep).not.toHaveBeenCalled();
  });
  it('keeps historical v3 journals readable without implicitly migrating them', () => {
    const d = archivedRun(); expect(parseEditorialCollagePipelineData(d).productionRun).toEqual(d.productionRun);
  });
  it.each(['resume', 'reconcile', 'retry-unknown', 'confirm-no-result', 'recheck-code'] as const)('rejects historical v3 %s without dispatch or journal changes', async action => {
    const initial = archivedRun(), node = initial.productionRun!.nodes.find(n => n.kind === 'film-edit')!;
    const officialStep = vi.fn(), upstreamStep = vi.fn(), h = nativeHarness({ officialStep, recoverOfficialStep: vi.fn(), upstreamStep }, initial);
    const input: VoxProductionControl = { id: initial.id, runId: initial.productionRun!.id, action, nodeId: node.id, evidence: 'Historical provider request remains unresolved.' };
    await expect(h.service.control(input)).rejects.toThrow('LEMO_WORKFLOW_UNSUPPORTED');
    expect(h.get()).toEqual(initial); expect(officialStep).not.toHaveBeenCalled(); expect(upstreamStep).not.toHaveBeenCalled();
  });
  it('rejects restart, execution and receipt recovery of v3 without creating another run', async () => {
    const initial = archivedRun(), h = nativeHarness({}, initial), node = initial.productionRun!.nodes.find(n => n.kind === 'film-edit')!;
    await expect(h.start()).rejects.toThrow('LEMO_WORKFLOW_UNSUPPORTED');
    await expect(h.runtime.execute(initial, node)).rejects.toThrow('LEMO_WORKFLOW_UNSUPPORTED');
    await expect(h.runtime.recover!(initial, node)).rejects.toThrow('LEMO_WORKFLOW_UNSUPPORTED');
    expect(h.get()).toEqual(initial);
  });
  it('preserves the pure historical graph helper and its bounded terminal state', () => {
    const d = archivedRun();
    d.upstreamFilm = { version: 1, runId: d.productionRun!.id, styleId: 'watercolor', directory: 'archived-fixture', turn: LEMO_AGENT_MAX_TURNS, status: 'authoring', sourceHash: 'historical-fixture', lastTool: 'write_file', message: 'Historical graph fixture' };
    const nodes = buildLemoUpstreamNodes(d, nativeSettings());
    expect(nodes.some(n => n.kind === 'film-finalize')).toBe(true);
    expect(nodes.filter(n => n.kind === 'film-edit')).toHaveLength(LEMO_AGENT_MAX_TURNS);
    expect(nodes.every((n, index) => n.dependencies.every(dep => nodes.findIndex(parent => parent.id === dep) < index))).toBe(true);
  });
});
