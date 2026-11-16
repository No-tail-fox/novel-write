import { z } from 'zod';

export const piLiveActivitySchema = z.object({
  runId: z.string().min(1).max(256),
  updatedAt: z.string().datetime(),
  phase: z.enum(['starting', 'waiting-model', 'running-tool', 'idle', 'error']),
  modelRequests: z.number().int().nonnegative(),
  latestTool: z.string().max(80).optional(),
  received: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  maxRequests: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  error: z.string().max(500).optional(),
}).strict();
export type PiLiveActivity = z.infer<typeof piLiveActivitySchema>;
