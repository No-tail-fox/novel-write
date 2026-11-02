import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openLemoExecutionBudget } from '../electron/lemo-execution-budget';
import { defaultLemoProductionBudget, lemoProductionBudgetSchema } from '../src/shared/lemo-production-budget';
import { lemoOfficialSessionLimits } from '../electron/lemo-official-runtime-config';
import { runOfficialLemoAgentSession, type OfficialLemoSessionOptions } from '../electron/lemo-agent-session-runtime';
import { LemoRequestLedger } from '../services/lemo-agent-worker/request-ledger';

const roots: string[] = [];
const directory = async () => { const root = await mkdtemp(join(tmpdir(), 'lemo-budget-')); roots.push(root); return root; };
const policy = { timeoutMs: 60000, maxEstimatedCostUsd: 1 };
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
describe('durable official execution budget', () => {
  const sharedSession = (root: string, child: boolean): OfficialLemoSessionOptions => ({
    action: 'start', executionRoot: root, runRoot: child ? join(root, 'stages', 'style-frame') : root,
    nodeExecutable: process.execPath, workerPath: join(root, 'must-not-be-started.cjs'), upstreamRoot: resolve('vendor/lemo-upstream'),
    runId: 'original_run', stageId: child ? 'style-frame' : 'film', prompt: 'Boundary check only; no provider requests.',
    provider: { protocol: 'anthropic', messagesUrl: 'https://provider.invalid/v1/messages', apiKey: 'unused', auth: 'x-api-key', model: 'fixture' },
    maxOutputTokens: 256, maxTurns: 1, maxRequests: 3, timeoutMs: policy.timeoutMs, requestTimeoutMs: 1000, maxEstimatedCostUsd: policy.maxEstimatedCostUsd,
  });
  it.each([false, true])('refuses missing shared ledger before starting a fresh stage (child=%s)', async child => {
    const root = await directory();
    await expect(runOfficialLemoAgentSession(sharedSession(root, child))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(root, 'ledger', 'requests.jsonl'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it.each([false, true])('does not recreate a deleted shared budget even with zero prior requests (child=%s)', async child => {
    const root = await directory(); const ledger = await LemoRequestLedger.open(join(root, 'ledger'), 3); await ledger.close();
    await expect(runOfficialLemoAgentSession(sharedSession(root, child))).rejects.toThrow('LEMO_BUDGET_RECEIPT_MISSING');
    await expect(readFile(join(root, 'execution-budget.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    const reopened = await LemoRequestLedger.open(join(root, 'ledger'), 3, { existingOnly: true });
    expect(reopened.summary().requests).toBe(0); await reopened.close();
  });
  it('shares the original deadline and conservatively accumulates cost across fresh resumed invocations', async () => {
    const root = await directory();
    let budget = await openLemoExecutionBudget(root, policy, false, 1000);
    expect(await budget.claim('treatment', 2000)).toEqual({ remainingMs: 59000, remainingCostUsd: 1 });
    await budget.settle('treatment', .2);
    budget = await openLemoExecutionBudget(root, policy, true, 3000);
    expect((await budget.claim('treatment', 4000)).remainingCostUsd).toBeCloseTo(.8);
    await budget.settle('treatment', .3);
    expect((await budget.claim('film', 5000)).remainingCostUsd).toBeCloseTo(.5);
    await budget.settle('film', .4);
    expect(budget.snapshot().costs).toEqual({ treatment: .5, film: .4 });
    await expect(budget.settle('film', .4)).rejects.toThrow('LEMO_BUDGET_COST_UNKNOWN');
    expect(budget.snapshot().costs.film).toBe(.4);
  });
  it('preserves an interrupted cost claim and refuses to obtain a new budget on reopen', async () => {
    const root = await directory(); const budget = await openLemoExecutionBudget(root, policy, false, 1000);
    await budget.claim('film', 1100);
    const resumed = await openLemoExecutionBudget(root, policy, true, 1200);
    await expect(resumed.claim('film', 1300)).rejects.toThrow('LEMO_BUDGET_COST_UNKNOWN');
    await expect(resumed.claim('other', 1300)).rejects.toThrow('LEMO_BUDGET_COST_UNKNOWN');
  });
  it('does not recreate a missing receipt on resume or accept changed ceilings', async () => {
    const root = await directory();
    await expect(openLemoExecutionBudget(root, policy, true)).rejects.toThrow('LEMO_BUDGET_RECEIPT_MISSING');
    await openLemoExecutionBudget(root, policy, false, 1000);
    await expect(openLemoExecutionBudget(root, { ...policy, maxEstimatedCostUsd: 5 })).rejects.toThrow('LEMO_BUDGET_POLICY_CHANGED');
  });
  it('refuses exhausted elapsed time without resetting the first start time', async () => {
    const root = await directory(); await openLemoExecutionBudget(root, policy, false, 1000);
    const resumed = await openLemoExecutionBudget(root, policy, true, 70000);
    await expect(resumed.claim('film', 70000)).rejects.toThrow('LEMO_BUDGET_TIME_EXHAUSTED');
    expect(JSON.parse(await readFile(join(root, 'execution-budget.json'), 'utf8')).startedAt).toBe(1000);
  });
  it('stops after the SDK estimate reaches the total rather than replenishing per stage', async () => {
    const root = await directory(); const budget = await openLemoExecutionBudget(root, policy, false, 1000);
    await budget.claim('film', 2000); await budget.settle('film', 1.01);
    await expect(budget.claim('repair', 3000)).rejects.toThrow('LEMO_BUDGET_COST_EXHAUSTED');
  });
  it('rejects corrupt records and missing/nonfinite cost receipts without clearing pending state', async () => {
    const root = await directory(); const budget = await openLemoExecutionBudget(root, policy, false, 1000);
    await budget.claim('film', 2000);
    for (const value of [undefined, -1, NaN, Infinity]) await expect(budget.settle('film', value)).rejects.toThrow('LEMO_BUDGET_COST_UNKNOWN');
    expect(budget.snapshot().pendingStage).toBe('film');
    await writeFile(join(root, 'execution-budget.json'), '{}', 'utf8');
    await expect(openLemoExecutionBudget(root, policy, true)).rejects.toThrow();
  });
  it('uses visible settings for execution limits and rejects malformed limits', () => {
    const budget = { ...defaultLemoProductionBudget(), maxRequests: 12, maxTurns: 15, maxMinutes: 8, maxOutputTokens: 8192, maxEstimatedCostUsd: .5 };
    expect(lemoOfficialSessionLimits({ requestParamsJson: '{"max_tokens":4096}', timeoutMs: 45000 }, budget))
      .toMatchObject({ maxRequests: 12, maxTurns: 15, timeoutMs: 480000, maxOutputTokens: 8192, maxEstimatedCostUsd: .5, requestTimeoutMs: 45000 });
    for (const patch of [{ maxRequests: 0 }, { maxTurns: 101 }, { maxMinutes: -1 }, { maxEstimatedCostUsd: 0 }, { maxRepairRounds: 9 }])
      expect(lemoProductionBudgetSchema.safeParse({ ...budget, ...patch }).success).toBe(false);
  });
});
