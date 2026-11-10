import { z } from 'zod';
import { estimateCostEntry, findCostPrice, formatCostAmount, normalizeCostPriceTable, summarizeProjectCost, type CostLedgerEntry } from '../project-cost';
import { projectCostModelHints } from '../project-cost-sources';
import type { AppConfig } from '../types';

/**
 * L-4 cost budget for the Lemo v3 Agent (pure; renderer-safe).
 *
 * The estimate is the U-5 project-cost estimate restricted to one Lemo run: the run's own turn receipts
 * (`submitted/response/rejected/image.json`) priced with the user's `AppConfig.costPriceTable`.
 *  - Only calls with a received result are priced; calls without a price row / unit ("未定价") are counted
 *    separately and never block — the budget cannot be enforced for them.
 *  - Unknown-result calls ("可能已计费") are counted separately, never priced and never resent.
 * The budget is a spending limit like the turn / token budget: it is not a node input and never reaches the Agent.
 * It is a cumulative-estimate stop, NOT a hard cap: a request sent while under budget may overshoot the remainder.
 */
export const LEMO_AGENT_COST_MIN = 0.1;
export const LEMO_AGENT_COST_MAX = 100_000;

/** Optional per-run cost budget in the price-table currency (default CNY); undefined = unlimited. */
export function lemoAgentMaxCost(value?: number | null): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(LEMO_AGENT_COST_MAX, Math.max(LEMO_AGENT_COST_MIN, Math.round(value * 100) / 100)) : undefined;
}

export const lemoAgentCostSnapshotSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  /** Sum of the priced received calls; null when none could be priced. */
  spent: z.number().min(0).nullable(),
  /** Received calls without a usable price (not in the budget). */
  unpricedCalls: z.number().int().min(0),
  /** Unknown-result calls: possibly billed, not priced. */
  possiblyBilled: z.number().int().min(0),
}).strict();
export type LemoAgentCostSnapshot = z.infer<typeof lemoAgentCostSnapshotSchema>;

export function lemoAgentCostSnapshot(entries: readonly CostLedgerEntry[], priceTable: unknown): LemoAgentCostSnapshot {
  const summary = summarizeProjectCost(entries, normalizeCostPriceTable(priceTable));
  return { currency: summary.currency, spent: summary.estimatedCost, unpricedCalls: summary.unpricedReceived, possiblyBilled: summary.possiblyBilled };
}

/** Only priced spend counts; unpriced / unknown calls never trigger the stop. */
export function lemoAgentCostExceeded(snapshot: LemoAgentCostSnapshot, maxCost: number | undefined): boolean {
  return maxCost !== undefined && snapshot.spent !== null && snapshot.spent >= maxCost;
}

const unpricedNote = (snapshot: LemoAgentCostSnapshot) => [
  snapshot.unpricedCalls ? `${snapshot.unpricedCalls} 次调用未定价，未计入` : '',
  snapshot.possiblyBilled ? `${snapshot.possiblyBilled} 次结果未知、可能已计费，未计入` : '',
].filter(Boolean).join('；');

export function lemoAgentCostLimitMessage(snapshot: LemoAgentCostSnapshot, maxCost: number, turn: number): string {
  const note = unpricedNote(snapshot);
  return `LEMO_AGENT_COST_LIMIT: 已达到费用预算 ${formatCostAmount(maxCost, snapshot.currency)}（已用约 ${formatCostAmount(snapshot.spent ?? 0, snapshot.currency)}），调高预算后可“重试失败步骤”续跑。`
    + `Lemo Agent 已完成 ${turn} 轮，下一次付费调用未提交；工程和每轮回执都已保留，已完成的轮次不会重新计费。费用是按“成本单价”的累计估算，不是硬性上限：预算用完前发出的最后一次调用可能超出预算，实际账单以服务商为准。${note ? note + '。' : ''}`;
}

/** "约 ¥Y / ¥X" (+ 未定价 warning) for the progress line; empty without a budget and without any price. */
export function lemoAgentCostProgressText(snapshot: LemoAgentCostSnapshot | undefined, maxCost: number | undefined): string {
  if (maxCost === undefined && (snapshot?.spent ?? null) === null) return '';
  const currency = snapshot?.currency ?? 'CNY';
  const spent = snapshot?.spent ?? null;
  const parts = [spent === null && snapshot?.unpricedCalls
    ? `费用预算 ${formatCostAmount(maxCost!, currency)}（尚无可定价的调用）`
    : `约 ${formatCostAmount(spent ?? 0, currency)}${maxCost !== undefined ? ` / ${formatCostAmount(maxCost, currency)}` : ''}`];
  if (snapshot?.unpricedCalls) parts.push(`${snapshot.unpricedCalls} 次调用未定价${maxCost !== undefined ? '（费用预算无法约束未定价的模型）' : ''}`);
  if (snapshot?.possiblyBilled) parts.push(`${snapshot.possiblyBilled} 次结果未知、可能已计费（未计入）`);
  return parts.join(' · ');
}

/** Settings unit of the budget: the normalized price-table currency; CNY reads "元", others their ISO code. */
export function lemoAgentCostUnit(config: Pick<AppConfig, 'costPriceTable'> | null | undefined): { currency: string; unit: string } {
  const currency = normalizeCostPriceTable(config?.costPriceTable).currency;
  return { currency, unit: currency === 'CNY' ? '元' : currency };
}

/**
 * Settings warning: which of the project's models the price table cannot price, so the budget cannot
 * constrain them. Undefined when everything relevant is priced (or no config is available).
 */
export function lemoAgentCostPricingWarning(config: AppConfig | null | undefined, options: { images: boolean }): string | undefined {
  if (!config) return undefined;
  const table = normalizeCostPriceTable(config.costPriceTable);
  const hints = projectCostModelHints(config);
  const missing: string[] = [];
  const llmPriced = estimateCostEntry({ kind: 'llm', ...hints.llm, outcome: 'received', inputTokens: 1, outputTokens: 1, at: '' }, findCostPrice(table, { kind: 'llm', ...hints.llm }));
  if (llmPriced === undefined) missing.push(`文本模型 ${hints.llm.model || hints.llm.provider || '（未配置）'}`);
  if (options.images) {
    const imagePriced = estimateCostEntry({ kind: 'image', ...hints.image, outcome: 'received', images: 1, at: '' }, findCostPrice(table, { kind: 'image', ...hints.image }));
    if (imagePriced === undefined) missing.push(`生图模型 ${hints.image.model || hints.image.provider || '（未配置）'}`);
  }
  return missing.length ? `${missing.join('、')} 未在“成本单价”中定价：这些调用只计次数，费用预算无法约束它们。可在“系统设置 → AI 创作 → 成本单价”中填写。` : undefined;
}
