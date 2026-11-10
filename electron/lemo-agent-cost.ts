import { basename, resolve } from 'node:path';
import { lemoAgentCostSnapshot, type LemoAgentCostSnapshot } from '../src/shared/creative-animation/agent-cost';
import { costEntriesFromLemoTurns, type CostModelHints } from '../src/shared/project-cost-sources';
import { readLemoRunTurnEvidence } from './project-cost-collector';
import type { LemoAgentCostControl } from './lemo-upstream-agent';

/** Price table (AppConfig.costPriceTable, optional) and the project's model names used to price Lemo receipts. */
export interface LemoAgentCostPricing { priceTable?: unknown; hints: CostModelHints }

/**
 * L-4: estimated spend of ONE Lemo v3 run (`<work>/lemo-agent/<runId>`) from its turn receipts, priced exactly
 * like the U-5 cost panel. Read-only: never writes, never calls a provider.
 */
export async function estimateLemoAgentRunCost(root: string, pricing: LemoAgentCostPricing): Promise<LemoAgentCostSnapshot> {
  const runDir = resolve(root);
  const turns = await readLemoRunTurnEvidence(runDir, basename(runDir));
  return lemoAgentCostSnapshot(costEntriesFromLemoTurns(turns, pricing.hints), pricing.priceTable);
}

export function createLemoAgentCostControl(root: string, maxCost: number | undefined, pricing: LemoAgentCostPricing | (() => LemoAgentCostPricing | Promise<LemoAgentCostPricing>)): LemoAgentCostControl {
  return {
    ...(maxCost !== undefined ? { maxCost } : {}),
    estimate: async () => estimateLemoAgentRunCost(root, typeof pricing === 'function' ? await pricing() : pricing),
  };
}
