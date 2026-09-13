export const MAX_PRODUCTION_HISTORY_ITEMS = 20_000;

export interface ProductionHistoryUsage {
  assets: number;
  providerJobs: number;
  qualityReports: number;
}

export type ProductionHistoryDemand = Partial<ProductionHistoryUsage>;
export interface ProductionHistoryDocument {
  id: string;
  assets: readonly unknown[];
  providerJobs: readonly unknown[];
  qualityReports: readonly unknown[];
}

const keys = ['assets', 'providerJobs', 'qualityReports'] as const;
const labels = { assets: '素材版本', providerJobs: '生成记录', qualityReports: '审片记录' };
export const PRODUCTION_MEDIA_HISTORY_DEMAND = { assets: 1, providerJobs: 1 } as const;
export const PRODUCTION_RENDER_HISTORY_DEMAND = { assets: 1, providerJobs: 1, qualityReports: 1 } as const;

export function productionHistoryUsage(document: Omit<ProductionHistoryDocument, 'id'>): ProductionHistoryUsage {
  return { assets: document.assets.length, providerJobs: document.providerJobs.length, qualityReports: document.qualityReports.length };
}

export function productionHistoryCapacityError(usage: ProductionHistoryUsage, demand: ProductionHistoryDemand): string | undefined {
  for (const key of keys) {
    const requested = demand[key] ?? 0;
    if (!Number.isSafeInteger(requested) || requested < 0 || !Number.isSafeInteger(usage[key]) || usage[key] < 0) return '历史记录容量参数无效。';
    if (usage[key] + requested > MAX_PRODUCTION_HISTORY_ITEMS) {
      return `项目${labels[key]}容量不足：已有或已预留 ${usage[key]} 条，本次需要 ${requested} 条，上限 ${MAX_PRODUCTION_HISTORY_ITEMS} 条。请减少本次生成范围或在新项目中继续。现有历史不会被删除。`;
    }
  }
  return undefined;
}

export function assertProductionHistoryCapacity(document: Omit<ProductionHistoryDocument, 'id'>, demand: ProductionHistoryDemand): void {
  const error = productionHistoryCapacityError(productionHistoryUsage(document), demand);
  if (error) throw new Error(`PRODUCTION_HISTORY_CAPACITY: ${error}`);
}

/** Hold capacity until generated records have been applied and saved by their owner. */
export function createProductionHistoryReservations() {
  const pending = new Map<symbol, { projectId: string; remaining: ProductionHistoryUsage }>();
  return {
    reserve(document: ProductionHistoryDocument, demand: ProductionHistoryDemand) {
      const usage = productionHistoryUsage(document);
      for (const reservation of pending.values()) {
        if (reservation.projectId === document.id) for (const key of keys) usage[key] += reservation.remaining[key];
      }
      const error = productionHistoryCapacityError(usage, demand);
      if (error) throw new Error(`PRODUCTION_HISTORY_CAPACITY: ${error}`);
      const token = Symbol(document.id);
      const remaining = { assets: demand.assets ?? 0, providerJobs: demand.providerJobs ?? 0, qualityReports: demand.qualityReports ?? 0 };
      pending.set(token, { projectId: document.id, remaining });
      return {
        consume(saved: ProductionHistoryDemand) {
          if (!pending.has(token)) throw new Error('历史容量预留已结束。');
          for (const key of keys) {
            const count = saved[key] ?? 0;
            if (!Number.isSafeInteger(count) || count < 0 || count > remaining[key]) throw new Error('保存记录超出已预留容量。');
          }
          for (const key of keys) remaining[key] -= saved[key] ?? 0;
        },
        release() { pending.delete(token); },
      };
    },
  };
}

export type ProductionHistoryReservation = ReturnType<ReturnType<typeof createProductionHistoryReservations>['reserve']>;
