import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileDatabase } from '@shared/storage';
import type { CreateDirectorBatchInput } from '@shared/director-batch-persistence';

function input(overrides: Partial<CreateDirectorBatchInput> = {}): CreateDirectorBatchInput {
  return {
    workflowKind: 'director',
    projectId: 'project-1',
    episodeId: 'episode-1',
    concurrency: 9,
    plan: {
      scope: 'missing',
      capabilities: { image: true, video: true, voice: true, render: true },
      outputReady: false,
      renderFailed: false,
      shots: [{ id: 'shot-1', title: '镜头一' }],
    },
    nodes: [{
      id: 'batch:image:shot-1', capability: 'image', shotId: 'shot-1', title: '镜头一 · 画面',
      status: 'pending', estimatedCost: 0.2, dependencies: [],
    }],
    ...overrides,
  };
}

describe('director batch persistence', () => {
  it('persists the plan, target, dependencies and control intents across restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-director-batch-'));
    const file = join(dir, 'app.db');
    try {
      const db = await FileDatabase.open(file);
      const created = await db.createDirectorBatch(input());
      expect(created.concurrency).toBe(4);
      const updated = await db.updateDirectorBatch(created.id, {
        expectedUpdatedAt: created.updatedAt,
        status: 'paused',
        pauseRequested: true,
        nodes: [{ ...created.nodes[0], status: 'running', dependencies: ['external:image:shot-1'] }],
      });
      await db.close();

      const restarted = await FileDatabase.open(file);
      const restored = await restarted.getDirectorBatch(created.id);
      expect(restored).toMatchObject({
        projectId: 'project-1', episodeId: 'episode-1', status: 'paused', pauseRequested: true,
        recoveryRequired: false, nodes: [{ status: 'running', dependencies: ['external:image:shot-1'] }],
      });
      expect(restored?.updatedAt).toBe(updated.updatedAt);
      await restarted.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('marks in-flight batches as paused and requires remote reconciliation after restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-director-batch-recovery-'));
    const file = join(dir, 'app.db');
    try {
      const db = await FileDatabase.open(file);
      const created = await db.createDirectorBatch(input({ status: 'running' }));
      await db.updateDirectorBatch(created.id, {
        expectedUpdatedAt: created.updatedAt,
        status: 'running',
        nodes: [{ ...created.nodes[0], status: 'running' }],
      });
      await db.close();

      const restarted = await FileDatabase.open(file);
      const restored = await restarted.getDirectorBatch(created.id);
      expect(restored).toMatchObject({
        status: 'paused', pauseRequested: true, recoveryRequired: true,
        recoveryReason: '应用重启后等待远端任务状态确认。',
        nodes: [{ status: 'pending', error: '应用重启后等待远端任务状态确认。' }],
      });
      await restarted.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects stale writes and lists batches by project, episode and status', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-director-batch-cas-'));
    const file = join(dir, 'app.db');
    try {
      const db = await FileDatabase.open(file);
      const first = await db.createDirectorBatch(input({ id: 'batch-a', status: 'queued' }));
      const second = await db.createDirectorBatch(input({ id: 'batch-b', episodeId: 'episode-2', status: 'completed' }));
      await expect(db.updateDirectorBatch(first.id, { expectedUpdatedAt: 'stale', status: 'running' })).rejects.toThrow('DIRECTOR_BATCH_CONFLICT');
      const rows = await db.listDirectorBatches({ projectId: 'project-1', episodeId: 'episode-1', statuses: ['queued'] });
      expect(rows.map((row) => row.id)).toEqual(['batch-a']);
      expect((await db.listDirectorBatches({ statuses: ['completed'] })).map((row) => row.id)).toEqual(['batch-b']);
      await db.close();
      expect(second.id).toBe('batch-b');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
