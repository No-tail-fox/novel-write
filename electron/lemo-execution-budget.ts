import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { rejectLedgerLinks } from '../services/lemo-agent-worker/ledger-owner';

const policySchema = z.object({ timeoutMs: z.number().int().positive(), maxEstimatedCostUsd: z.number().finite().positive() }).strict();
const stateSchema = z.object({ version: z.literal(1), policy: policySchema, startedAt: z.number().int().positive(),
  costs: z.record(z.string(), z.number().finite().nonnegative()), pendingStage: z.string().optional() }).strict();
type State = z.infer<typeof stateSchema>;
/** Called while the shared request ledger's exclusive owner is held. */
export async function openLemoExecutionBudget(directory: string, policy: State['policy'], existingOnly = false, now = Date.now()) {
  policy = policySchema.parse(policy);
  const file = join(directory, 'execution-budget.json');
  await rejectLedgerLinks(file);
  let state: State;
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.nlink !== 1 || info.size > 65536) throw new Error('LEMO_BUDGET_FILE');
    state = stateSchema.parse(JSON.parse(await readFile(file, 'utf8')));
    if (JSON.stringify(state.policy) !== JSON.stringify(policy)) throw new Error('LEMO_BUDGET_POLICY_CHANGED');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (existingOnly) throw new Error('LEMO_BUDGET_RECEIPT_MISSING');
    state = { version: 1, policy, startedAt: now, costs: {} };
  }
  const save = async () => {
    await mkdir(directory, { recursive: true }); await rejectLedgerLinks(file);
    const temp = file + '.' + randomUUID() + '.tmp';
    const handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(state), 'utf8'); await handle.sync(); } finally { await handle.close(); }
    await rename(temp, file);
  };
  await save();
  return {
    snapshot: () => structuredClone(state),
    async claim(stageId: string, at = Date.now()) {
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(stageId)) throw new Error('LEMO_BUDGET_STAGE');
      if (state.pendingStage) throw new Error('LEMO_BUDGET_COST_UNKNOWN: 上次执行的费用回执缺失，已阻止重新发起请求。');
      const remainingMs = state.startedAt + state.policy.timeoutMs - at;
      const remainingCostUsd = state.policy.maxEstimatedCostUsd - Object.values(state.costs).reduce((a, b) => a + b, 0);
      if (remainingMs <= 0) throw new Error('LEMO_BUDGET_TIME_EXHAUSTED');
      if (remainingCostUsd <= 0) throw new Error('LEMO_BUDGET_COST_EXHAUSTED');
      state.pendingStage = stageId; await save();
      return { remainingMs, remainingCostUsd };
    },
    async settle(stageId: string, invocationEstimatedCostUsd: number | undefined) {
      if (state.pendingStage !== stageId || invocationEstimatedCostUsd === undefined || !Number.isFinite(invocationEstimatedCostUsd) || invocationEstimatedCostUsd < 0) {
        throw new Error('LEMO_BUDGET_COST_UNKNOWN');
      }
      // SDK total_cost_usd can include transcript-saved cost on resume, but can also
      // reset after startup/crash or /clear. Without a verified baseline, summing
      // each actual invocation is conservative; max(old, receipt) could undercount.
      // Receipt replay never reaches this path without a new persisted claim.
      state.costs[stageId] = (state.costs[stageId] ?? 0) + invocationEstimatedCostUsd;
      delete state.pendingStage; await save();
    },
  };
}
