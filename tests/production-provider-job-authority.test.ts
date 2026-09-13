import { describe, expect, it } from 'vitest';
import { latestProductionProviderJob, type ProductionProviderJob } from '../src/shared/production-workflow';

const job = (patch: Partial<ProductionProviderJob>): ProductionProviderJob => ({
  id: 'job', workflowKind: 'motion-comic', nodeId: 'shot-1', providerId: 'fixture', model: 'v1',
  capability: 'text-to-image', status: 'completed', inputHash: 'hash', idempotencyKey: 'key',
  estimatedCost: 0, attempt: 1, createdAt: '2026-09-07T00:00:00.000Z', updatedAt: '2026-09-07T00:00:01.000Z',
  ...patch,
});

describe('latestProductionProviderJob', () => {
  it('lets a newer running retry supersede an older completed attempt', () => {
    const latest = latestProductionProviderJob([
      job({ id: 'old', status: 'completed', attempt: 1 }),
      job({ id: 'retry', status: 'running', attempt: 2, updatedAt: '2026-09-07T00:00:02.000Z' }),
    ], 'shot-1', 'text-to-image');
    expect(latest?.id).toBe('retry');
    expect(latest?.status).toBe('running');
  });

  it('uses updated time when status changes within one attempt', () => {
    const latest = latestProductionProviderJob([
      job({ id: 'queued', status: 'queued', updatedAt: '2026-09-07T00:00:01.000Z' }),
      job({ id: 'failed', status: 'failed', updatedAt: '2026-09-07T00:00:03.000Z' }),
    ], 'shot-1', 'text-to-image');
    expect(latest?.id).toBe('failed');
  });

  it('keeps episode-owned jobs isolated', () => {
    const latest = latestProductionProviderJob([
      job({ id: 'other-episode', episodeId: 'episode-2', attempt: 9 }),
      job({ id: 'current', episodeId: 'episode-1', attempt: 1 }),
    ], 'shot-1', 'text-to-image', 'episode-1');
    expect(latest?.id).toBe('current');
  });
});
