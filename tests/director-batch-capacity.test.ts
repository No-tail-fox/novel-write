import { describe, expect, it } from 'vitest';
import { ipcInputSchemas } from '../src/shared/ipc-contract';
import { createDirectorBatchPlan, type DirectorBatchShotState } from '../src/features/director-desk/director-batch';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileDatabase } from '../src/shared/storage';

function batchInput(count: number, dynamic: boolean) {
  const shots: DirectorBatchShotState[] = Array.from({ length: count }, (_, index) => ({
    id: `shot-${index}`, title: `Shot ${index}`, renderStrategy: dynamic ? 'living-poster' : 'deterministic-layers',
    imageReady: false, videoReady: false, voiceReady: false, imageFailed: false, videoFailed: false, voiceFailed: false,
  }));
  const plan = { scope: 'all' as const, capabilities: { image: true, video: true, voice: true, render: true }, shots, outputReady: false, renderFailed: false };
  return { workflowKind: 'director' as const, projectId: 'long-project', concurrency: 4, plan, nodes: createDirectorBatchPlan(plan).nodes };
}

describe('long director batch capacity', () => {
  it.each([[300, false, 601], [500, true, 1501]] as const)('recovers %s shots from SQLite without losing completed work', async (count, dynamic, expected) => {
    const directory = await mkdtemp(join(tmpdir(), 'director-capacity-'));
    let database: FileDatabase | undefined;
    try {
      const path = join(directory, 'data.db');
      database = await FileDatabase.open(path);
      const input = ipcInputSchemas['director:batch-create'].parse(batchInput(count, dynamic));
      const created = await database.createDirectorBatch(input);
      const nodes = created.nodes.map((node, index) => ({ ...node, status: index < 300 ? 'completed' as const : index === 300 ? 'running' as const : 'pending' as const }));
      await database.updateDirectorBatch(created.id, ipcInputSchemas['director:batch-update'].parse({ id: created.id, patch: { expectedUpdatedAt: created.updatedAt, status: 'running', nodes } }).patch);
      await database.close();
      database = await FileDatabase.open(path);
      const restored = (await database.getDirectorBatch(created.id))!;
      expect(restored.nodes).toHaveLength(expected);
      expect(restored.nodes.slice(0, 300)).toEqual(nodes.slice(0, 300));
      expect(restored.nodes[300].status).toBe('pending');
      expect(restored.nodes.map((node) => node.dependencies)).toEqual(nodes.map((node) => node.dependencies));
      expect(restored.plan).toEqual(input.plan);
      expect(restored).toMatchObject({ status: 'paused', recoveryRequired: true });
    } finally {
      await database?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([[300, false, 601], [500, true, 1501]] as const)('persists every node and dependency for %s shots', (count, dynamic, expected) => {
    const input = batchInput(count, dynamic);
    const created = ipcInputSchemas['director:batch-create'].parse(input);
    expect(created.nodes).toHaveLength(expected);
    expect(created.nodes.at(-1)!.dependencies).toHaveLength(expected - 1);
    const updated = ipcInputSchemas['director:batch-update'].parse({ id: 'batch-1', patch: { plan: input.plan, nodes: input.nodes } });
    expect(updated.patch.nodes).toEqual(input.nodes);
    expect(created.nodes).toEqual(input.nodes);
  });

  it('keeps separate limits for shots, DAG nodes and dependency references', () => {
    expect(() => ipcInputSchemas['director:batch-create'].parse(batchInput(501, true))).toThrow();
    const input = batchInput(500, true);
    expect(() => ipcInputSchemas['director:batch-create'].parse({ ...input, nodes: [...input.nodes, { ...input.nodes[0], id: 'extra' }] })).toThrow();
    expect(() => ipcInputSchemas['director:batch-update'].parse({ id: 'batch-1', patch: { nodes: [{ ...input.nodes.at(-1), dependencies: Array.from({ length: 1501 }, (_, index) => `node-${index}`) }] } })).toThrow();
  });
});
