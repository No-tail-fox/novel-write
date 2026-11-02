import { z } from 'zod';

/** User-visible execution ceilings; estimated USD is an SDK estimate, not an invoice. */
export const lemoProductionBudgetSchema = z.object({
  maxRequests: z.number().int().min(1).max(256).default(64),
  maxTurns: z.number().int().min(1).max(100).default(64),
  maxMinutes: z.number().int().min(1).max(240).default(30),
  maxOutputTokens: z.number().int().min(256).max(1000000).default(16384),
  maxEstimatedCostUsd: z.number().finite().min(0.01).max(1000).default(1),
  maxRepairRounds: z.number().int().min(0).max(8).default(2),
}).strict();
export type LemoProductionBudget = z.infer<typeof lemoProductionBudgetSchema>;
export const defaultLemoProductionBudget = (): LemoProductionBudget => lemoProductionBudgetSchema.parse({});
