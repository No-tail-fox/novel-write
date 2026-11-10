import { describe, expect, it } from 'vitest';
import { classifyProviderFailure } from '../src/shared/provider-failure';
import {
  autoRetryNotice,
  consumeRetryBudget,
  createRetryBudget,
  decideUnknownNodeAction,
  DEFAULT_RETRY_BUDGET_LIMITS,
  describeUnknownNodeAction,
  isAutoRetryEligible,
  normalizeRetryBudget,
  parseRetryBudget,
  provenFailureOutcome,
  retryBudgetAllows,
  retryBudgetExhaustedText,
  retryBudgetRemaining,
  UNKNOWN_NODE_ACTION_TEXT,
  type UnknownNodeInfo,
} from '../src/shared/retry-budget';

const base: UnknownNodeInfo = { paid: true, hasReceipt: true, recoverable: true, outcome: 'unknown' };

describe('decideUnknownNodeAction', () => {
  it('tries a free receipt recovery first for unknown outcomes', () => {
    expect(decideUnknownNodeAction(base)).toBe('recover-from-receipt');
    expect(decideUnknownNodeAction({ ...base, paid: false })).toBe('recover-from-receipt');
  });
  it('never auto-resends paid unknown work once recovery is unavailable or already tried', () => {
    expect(decideUnknownNodeAction({ ...base, recoveryAttempted: true })).toBe('await-user');
    expect(decideUnknownNodeAction({ ...base, recoverable: false })).toBe('await-user');
    expect(decideUnknownNodeAction({ ...base, hasReceipt: false, retry: 'idempotent', singleRequest: true })).toBe('await-user');
  });
  it('auto-retries a paid single request only when it provably was not sent', () => {
    const notSent: UnknownNodeInfo = { paid: true, hasReceipt: true, recoverable: true, outcome: 'not-sent', retry: 'always', singleRequest: true };
    expect(decideUnknownNodeAction(notSent)).toBe('auto-retry');
    expect(decideUnknownNodeAction({ ...notSent, singleRequest: false })).toBe('await-user');
    expect(decideUnknownNodeAction({ ...notSent, retry: 'never' })).toBe('await-user');
  });
  it('auto-retries unpaid or idempotent work unless the classifier forbids retrying', () => {
    expect(decideUnknownNodeAction({ paid: false, hasReceipt: false, recoverable: false, outcome: 'unknown', retry: 'idempotent' })).toBe('auto-retry');
    expect(decideUnknownNodeAction({ paid: true, idempotent: true, hasReceipt: false, recoverable: false, outcome: 'unknown', retry: 'idempotent' })).toBe('auto-retry');
    expect(decideUnknownNodeAction({ paid: false, hasReceipt: false, recoverable: false, outcome: 'rejected', retry: 'never' })).toBe('fail');
    expect(decideUnknownNodeAction({ paid: false, hasReceipt: false, recoverable: false, outcome: 'not-sent', retry: 'never' })).toBe('fail');
  });
  it('fails definitive paid refusals instead of waiting for the user', () => {
    expect(decideUnknownNodeAction({ paid: true, hasReceipt: true, recoverable: true, outcome: 'rejected', retry: 'never' })).toBe('fail');
    // Paid 429 is not auto-retried by this policy (rate limits are handled inside providers).
    expect(decideUnknownNodeAction({ paid: true, hasReceipt: true, recoverable: false, outcome: 'rejected', retry: 'always', singleRequest: true })).toBe('fail');
  });
  it('respects the budget, falling back to attempts when no budget is supplied', () => {
    const free: UnknownNodeInfo = { paid: false, hasReceipt: false, recoverable: false, outcome: 'not-sent', retry: 'always', nodeId: 'n' };
    let budget = createRetryBudget({ nodeLimit: 1 });
    expect(decideUnknownNodeAction({ ...free, budget })).toBe('auto-retry');
    budget = consumeRetryBudget(budget, 'n');
    expect(decideUnknownNodeAction({ ...free, budget })).toBe('fail');
    expect(decideUnknownNodeAction({ ...free, paid: true, singleRequest: true, budget })).toBe('await-user');
    expect(isAutoRetryEligible({ ...free, budget })).toBe(true);
    expect(decideUnknownNodeAction({ ...free, nodeId: undefined, attempts: 1 })).toBe('auto-retry');
    expect(decideUnknownNodeAction({ ...free, nodeId: undefined, attempts: DEFAULT_RETRY_BUDGET_LIMITS.nodeLimit })).toBe('fail');
  });
  it('treats local errors and received results as unknown outcomes', () => {
    const local = classifyProviderFailure({ error: new Error('disk fault') });
    expect(local.outcome).toBe('not-sent');
    expect(provenFailureOutcome(local)).toBe('unknown');
    const refused = classifyProviderFailure({ error: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
    expect(provenFailureOutcome(refused)).toBe('not-sent');
    expect(provenFailureOutcome(refused, true)).toBe('unknown');
    expect(provenFailureOutcome(classifyProviderFailure({ status: 522 }))).toBe('not-sent');
    expect(provenFailureOutcome(classifyProviderFailure({ status: 524 }))).toBe('unknown');
  });
});

describe('RetryBudget', () => {
  it('defaults to 6 per run and 2 per node and enforces both caps immutably', () => {
    const fresh = createRetryBudget();
    expect(fresh).toEqual({ version: 1, runLimit: 6, nodeLimit: 2, used: 0, nodes: {} });
    const once = consumeRetryBudget(fresh, 'a');
    expect(fresh.used).toBe(0); expect(once).toEqual({ version: 1, runLimit: 6, nodeLimit: 2, used: 1, nodes: { a: 1 } });
    const twice = consumeRetryBudget(once, 'a');
    expect(retryBudgetAllows(twice, 'a')).toBe(false); expect(retryBudgetAllows(twice, 'b')).toBe(true);
    expect(() => consumeRetryBudget(twice, 'a')).toThrow('RETRY_BUDGET_EXHAUSTED');
    expect(retryBudgetRemaining(twice)).toBe(4); expect(retryBudgetRemaining(twice, 'a')).toBe(0);
    let run = createRetryBudget({ runLimit: 3, nodeLimit: 5 });
    for (const node of ['a', 'b', 'c']) run = consumeRetryBudget(run, node);
    expect(retryBudgetAllows(run, 'd')).toBe(false);
  });
  it('is deterministic and round-trips through JSON', () => {
    const steps = ['plan', 'render', 'plan'];
    const build = () => steps.reduce((budget, node) => consumeRetryBudget(budget, node), createRetryBudget());
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
    expect(parseRetryBudget(JSON.parse(JSON.stringify(build())))).toEqual(build());
  });
  it('treats missing or malformed persisted budgets as a fresh default', () => {
    expect(normalizeRetryBudget(undefined)).toEqual(createRetryBudget());
    expect(normalizeRetryBudget({ version: 2 })).toEqual(createRetryBudget());
    expect(parseRetryBudget({ version: 1, runLimit: 6, nodeLimit: 2, used: -1, nodes: {} })).toBeUndefined();
    expect(parseRetryBudget({ version: 1, runLimit: 6, nodeLimit: 2, used: 0, nodes: { a: 'x' } })).toBeUndefined();
    expect(parseRetryBudget({ version: 1, runLimit: 6, nodeLimit: 2, used: 0, nodes: [] })).toBeUndefined();
    // `used` can never be lower than the per-node counts it summarises.
    expect(parseRetryBudget({ version: 1, runLimit: 6, nodeLimit: 2, used: 0, nodes: { a: 2 } })?.used).toBe(2);
    const proto = parseRetryBudget(JSON.parse('{"version":1,"runLimit":6,"nodeLimit":2,"used":1,"nodes":{"__proto__":1}}'));
    expect(Object.getPrototypeOf(proto!.nodes)).toBe(Object.prototype);
    expect(Object.keys(proto!.nodes)).toEqual(['__proto__']);
    expect(createRetryBudget({ runLimit: -1, nodeLimit: 1.5 })).toMatchObject({ runLimit: 6, nodeLimit: 2 });
  });
  it('explains every action and budget state in Chinese', () => {
    for (const action of ['recover-from-receipt', 'auto-retry', 'await-user', 'fail'] as const) {
      expect(describeUnknownNodeAction(action)).toBe(UNKNOWN_NODE_ACTION_TEXT[action]);
      expect(describeUnknownNodeAction(action)).toMatch(/[\u4e00-\u9fff]/u);
    }
    expect(UNKNOWN_NODE_ACTION_TEXT['await-user']).toContain('不会自动重发');
    const budget = consumeRetryBudget(createRetryBudget(), 'plan');
    expect(autoRetryNotice('场景规划', budget, 'plan')).toContain('第 1/2 次');
    expect(retryBudgetExhaustedText(consumeRetryBudget(budget, 'plan'), 'plan')).toContain('本步骤');
    expect(retryBudgetExhaustedText(createRetryBudget({ runLimit: 0 }), 'plan')).toContain('本次运行');
  });
});
