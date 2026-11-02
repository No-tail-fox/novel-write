import { lstat, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { rejectLedgerLinks } from '../services/lemo-agent-worker/ledger-owner';
import { LEMO_NATIVE_AGENT_VERSION } from '../src/shared/lemo-agent-session';

const policySchema = z.object({ protocol: z.enum(['openai', 'responses']), timeoutMs: z.number().int().positive(),
  maxRequests: z.number().int().min(1).max(1000), maxOutputTokens: z.number().int().min(1).max(1000000) }).strict();
const schema = z.object({ version: z.literal(1), backend: z.literal(LEMO_NATIVE_AGENT_VERSION), startedAt: z.number().int().positive(), policy: policySchema }).strict();
/** Called under the existing shared ledger lock. USD prices are not invented for custom channels. */
export async function openLemoNativeBudget(directory: string, policy: z.infer<typeof policySchema>, existingOnly = false, now = Date.now()) {
  policy = policySchema.parse(policy); const file = join(directory, 'native-execution-budget.json');
  await rejectLedgerLinks(file);
  let state: z.infer<typeof schema>;
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 8192) throw new Error('LEMO_BUDGET_FILE');
    state = schema.parse(JSON.parse(await readFile(file, 'utf8')));
    if (JSON.stringify(state.policy) !== JSON.stringify(policy)) throw new Error('LEMO_BUDGET_POLICY_CHANGED');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (existingOnly) throw new Error('LEMO_BUDGET_RECEIPT_MISSING');
    state = { version: 1, backend: LEMO_NATIVE_AGENT_VERSION, startedAt: now, policy };
    const fileHandle = await open(file, 'wx', 0o600);
    try { await fileHandle.writeFile(JSON.stringify(state), 'utf8'); await fileHandle.sync(); } finally { await fileHandle.close(); }
  }
  const remainingMs = state.startedAt + policy.timeoutMs - now;
  if (remainingMs <= 0 || now < state.startedAt) throw new Error('LEMO_BUDGET_TIME_EXHAUSTED');
  return { remainingMs, maximumOutputTokens: policy.maxRequests * policy.maxOutputTokens, costEstimate: 'unavailable' as const };
}
