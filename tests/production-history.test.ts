import { describe, expect, it } from 'vitest';
import { assertProductionHistoryCapacity, createProductionHistoryReservations, MAX_PRODUCTION_HISTORY_ITEMS, productionHistoryCapacityError } from '../src/shared/production-history';

function document(id = 'project-1', assets = 0, providerJobs = 0, qualityReports = 0) {
  return { id, assets: Array(assets).fill(null), providerJobs: Array(providerJobs).fill(null), qualityReports: Array(qualityReports).fill(null) };
}

describe('production history capacity', () => {
  it('allows multi-round long projects and rejects each full history before new work', () => {
    expect(() => assertProductionHistoryCapacity(document('long', 15010, 15010, 10), { assets: 1501, providerJobs: 1501, qualityReports: 1 })).not.toThrow();
    for (const key of ['assets', 'providerJobs', 'qualityReports'] as const) {
      const usage = { assets: 0, providerJobs: 0, qualityReports: 0, [key]: MAX_PRODUCTION_HISTORY_ITEMS };
      expect(productionHistoryCapacityError(usage, { [key]: 1 })).toContain('容量不足');
      expect(productionHistoryCapacityError(usage, {})).toBeUndefined();
    }
  });

  it('prevents concurrent requests from consuming the same final slots', () => {
    const reservations = createProductionHistoryReservations();
    const source = document('project-1', MAX_PRODUCTION_HISTORY_ITEMS - 4, MAX_PRODUCTION_HISTORY_ITEMS - 4);
    const held = Array.from({ length: 4 }, () => reservations.reserve(source, { assets: 1, providerJobs: 1 }));
    expect(() => reservations.reserve(source, { assets: 1, providerJobs: 1 })).toThrow('PRODUCTION_HISTORY_CAPACITY');
    held[0].release();
    expect(() => reservations.reserve(source, { assets: 1, providerJobs: 1 })).not.toThrow();
    expect(source.assets).toHaveLength(MAX_PRODUCTION_HISTORY_ITEMS - 4);
  });

  it('releases consumed cue reservations as saved history grows, without double counting', () => {
    const reservations = createProductionHistoryReservations();
    const source = document('project-1', MAX_PRODUCTION_HISTORY_ITEMS - 4, MAX_PRODUCTION_HISTORY_ITEMS - 4);
    const dialogue = reservations.reserve(source, { assets: 3, providerJobs: 3 });
    source.assets.push(null);
    source.providerJobs.push(null);
    dialogue.consume({ assets: 1, providerJobs: 1 });
    expect(() => reservations.reserve(source, { assets: 1, providerJobs: 1 })).not.toThrow();
    expect(() => reservations.reserve(source, { assets: 1, providerJobs: 1 })).toThrow('容量不足');
    expect(() => dialogue.consume({ assets: 3 })).toThrow('超出已预留容量');
  });

  it('isolates projects and retains reservations while returning to a still-running project', () => {
    const reservations = createProductionHistoryReservations();
    const first = document('first', MAX_PRODUCTION_HISTORY_ITEMS - 1);
    const held = reservations.reserve(first, { assets: 1 });
    expect(() => reservations.reserve(document('second'), { assets: 1 })).not.toThrow();
    expect(() => reservations.reserve(first, { assets: 1 })).toThrow('容量不足');
    held.release();
    held.release();
    expect(() => reservations.reserve(first, { assets: 1 })).not.toThrow();
  });

  it('rejects invalid demand without disabling capacity checks', () => {
    for (const count of [-1, 0.5, NaN, Infinity]) {
      expect(() => assertProductionHistoryCapacity(document(), { assets: count })).toThrow('参数无效');
    }
  });
});
