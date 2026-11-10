/**
 * G-7: one policy for failed / unknown steps in both executors (VOX production DAG and HTML runner).
 *
 * Order of preference after a step fails:
 *  1. `recover-from-receipt` — the outcome is unknown but a free, read-only receipt lookup exists
 *     (journal checkpoint, provider task receipt). Always tried first; it never dispatches generation.
 *  2. `auto-retry`           — resending cannot double-bill: the step is free (or provider-idempotent)
 *     and the failure is transient, or a paid single-request step provably never left this machine
 *     (`not-sent`, e.g. connect timeout, 521–523). Bounded by a shared {@link RetryBudget}.
 *  3. `await-user`           — paid work whose outcome is (or may be) unknown. Never resent automatically.
 *  4. `fail`                 — definitive or non-transient failure; the existing failure path applies.
 *
 * Everything here is pure and deterministic so the budget can be persisted in run state.
 */
import type { ProviderFailure, ProviderFailureOutcome, ProviderRetryPolicy } from './provider-failure';

export type UnknownNodeAction = 'recover-from-receipt' | 'auto-retry' | 'await-user' | 'fail';

export interface RetryBudgetLimits {
  /** Automatic retries allowed for the whole run (all steps together). */
  runLimit: number;
  /** Automatic retries allowed for one step / node. */
  nodeLimit: number;
}

export const DEFAULT_RETRY_BUDGET_LIMITS: Readonly<RetryBudgetLimits> = Object.freeze({ runLimit: 6, nodeLimit: 2 });
const MAX_RETRY_LIMIT = 50;
const MAX_NODE_KEY_CHARS = 256;

/** Plain JSON so it can live in persisted run state. `nodes` only holds nodes that consumed retries. */
export interface RetryBudget {
  version: 1;
  runLimit: number;
  nodeLimit: number;
  used: number;
  nodes: Record<string, number>;
}

export interface UnknownNodeInfo {
  /** The step may bill (image/LLM/TTS). HTML steps are treated as paid conservatively. */
  paid: boolean;
  /** Diagnostic only. */
  kind?: string;
  /** A request id / receipt key exists for the last attempt. */
  hasReceipt: boolean;
  /** A free, read-only receipt recovery operation exists for this node. */
  recoverable: boolean;
  /** Proven outcome of the last attempt; see {@link provenFailureOutcome}. */
  outcome: ProviderFailureOutcome;
  /** Classifier retry policy; defaults from the outcome when omitted. */
  retry?: ProviderRetryPolicy;
  /** The step sends exactly one provider request, so `not-sent` covers all paid work in it. */
  singleRequest?: boolean;
  /** The provider deduplicates resends (resend cannot double-bill). */
  idempotent?: boolean;
  /** Receipt recovery was already tried for this failure. */
  recoveryAttempted?: boolean;
  /** Automatic retries already used by this node; used when no budget is supplied. */
  attempts?: number;
  budget?: RetryBudget;
  nodeId?: string;
}

function boundedLimit(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? Math.min(MAX_RETRY_LIMIT, value) : fallback;
}

function ownCount(nodes: Record<string, number>, nodeId: string): number {
  return Object.prototype.hasOwnProperty.call(nodes, nodeId) ? nodes[nodeId] : 0;
}

export function createRetryBudget(limits: Partial<RetryBudgetLimits> = {}): RetryBudget {
  return {
    version: 1,
    runLimit: boundedLimit(limits.runLimit, DEFAULT_RETRY_BUDGET_LIMITS.runLimit),
    nodeLimit: boundedLimit(limits.nodeLimit, DEFAULT_RETRY_BUDGET_LIMITS.nodeLimit),
    used: 0,
    nodes: {},
  };
}

/** Strict reader for persisted state: returns undefined for anything that is not a valid v1 budget. */
export function parseRetryBudget(value: unknown): RetryBudget | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return undefined;
  const isCount = (item: unknown): item is number => typeof item === 'number' && Number.isSafeInteger(item) && item >= 0 && item <= MAX_RETRY_LIMIT;
  if (!isCount(record.runLimit) || !isCount(record.nodeLimit) || !isCount(record.used)) return undefined;
  if (!record.nodes || typeof record.nodes !== 'object' || Array.isArray(record.nodes)) return undefined;
  const entries = Object.entries(record.nodes as Record<string, unknown>);
  if (entries.length > MAX_RETRY_LIMIT) return undefined;
  const nodes: Record<string, number> = {};
  let total = 0;
  for (const [key, count] of entries) {
    if (!key || key.length > MAX_NODE_KEY_CHARS || !isCount(count)) return undefined;
    if (count > 0) Object.defineProperty(nodes, key, { value: count, enumerable: true, writable: true, configurable: true });
    total += count;
  }
  return { version: 1, runLimit: record.runLimit, nodeLimit: record.nodeLimit, used: Math.min(MAX_RETRY_LIMIT, Math.max(record.used, total)), nodes };
}

/** Old run states have no budget field: they start with a fresh default budget. */
export function normalizeRetryBudget(value: unknown, limits: Partial<RetryBudgetLimits> = {}): RetryBudget {
  return parseRetryBudget(value) ?? createRetryBudget(limits);
}

export function retryBudgetNodeUsed(budget: RetryBudget, nodeId: string): number {
  return ownCount(budget.nodes, nodeId);
}

export function retryBudgetAllows(budget: RetryBudget, nodeId: string): boolean {
  return budget.used < budget.runLimit && ownCount(budget.nodes, nodeId) < budget.nodeLimit;
}

/** Remaining automatic retries for the run, or for one node when `nodeId` is given. */
export function retryBudgetRemaining(budget: RetryBudget, nodeId?: string): number {
  const run = Math.max(0, budget.runLimit - budget.used);
  return nodeId === undefined ? run : Math.min(run, Math.max(0, budget.nodeLimit - ownCount(budget.nodes, nodeId)));
}

/** Returns a new budget with one retry charged to `nodeId`; throws when the budget does not allow it. */
export function consumeRetryBudget(budget: RetryBudget, nodeId: string): RetryBudget {
  if (!nodeId || nodeId.length > MAX_NODE_KEY_CHARS) throw new RangeError('RETRY_BUDGET_NODE_INVALID');
  if (!retryBudgetAllows(budget, nodeId)) throw new RangeError('RETRY_BUDGET_EXHAUSTED');
  const nodes: Record<string, number> = {};
  for (const [key, count] of Object.entries(budget.nodes)) Object.defineProperty(nodes, key, { value: count, enumerable: true, writable: true, configurable: true });
  Object.defineProperty(nodes, nodeId, { value: ownCount(budget.nodes, nodeId) + 1, enumerable: true, writable: true, configurable: true });
  return { ...budget, used: budget.used + 1, nodes };
}

/**
 * The classifier labels purely local errors `not-sent`. When the error may have been raised after the
 * request was dispatched (any local/unclassified error, or a result that already arrived) the only
 * honest answer is `unknown`.
 */
export function provenFailureOutcome(failure: Pick<ProviderFailure, 'kind' | 'outcome'>, resultReceived = false): ProviderFailureOutcome {
  if (resultReceived || failure.kind === 'local' || failure.kind === 'unknown' || failure.kind === 'aborted') return 'unknown';
  return failure.outcome;
}

function defaultRetry(outcome: ProviderFailureOutcome): ProviderRetryPolicy {
  return outcome === 'not-sent' ? 'always' : outcome === 'unknown' ? 'idempotent' : 'never';
}

/** Whether resending is safe at all, ignoring the budget. */
export function isAutoRetryEligible(info: UnknownNodeInfo): boolean {
  const retry = info.retry ?? defaultRetry(info.outcome);
  if (retry === 'never') return false;
  if (!info.paid || info.idempotent === true) return true;
  return retry === 'always' && info.outcome === 'not-sent' && info.singleRequest === true;
}

function budgetAllows(info: UnknownNodeInfo): boolean {
  if (info.budget && info.nodeId) return retryBudgetAllows(info.budget, info.nodeId);
  return (info.attempts ?? 0) < DEFAULT_RETRY_BUDGET_LIMITS.nodeLimit;
}

export function decideUnknownNodeAction(info: UnknownNodeInfo): UnknownNodeAction {
  if (info.outcome === 'unknown' && info.recoverable && info.hasReceipt && !info.recoveryAttempted) return 'recover-from-receipt';
  if (isAutoRetryEligible(info) && budgetAllows(info)) return 'auto-retry';
  // A paid request that may have been processed is never resent without a person deciding.
  if (info.paid && info.outcome !== 'rejected') return 'await-user';
  return 'fail';
}

/** Short Chinese explanations for logs and UI. */
export const UNKNOWN_NODE_ACTION_TEXT: Readonly<Record<UnknownNodeAction, string>> = Object.freeze({
  'recover-from-receipt': '结果未知，先免费核对已保存的回执，不会重新提交。',
  'auto-retry': '请求未发出或该步骤不计费，已在重试预算内自动重试。',
  'await-user': '收费请求结果未知，可能已生成并计费，不会自动重发；请核对服务商记录后手动重试或确认无结果。',
  fail: '失败原因不可通过重试解决，已停止；请检查配置或输入后重新执行。',
});

export function describeUnknownNodeAction(action: UnknownNodeAction): string {
  return UNKNOWN_NODE_ACTION_TEXT[action];
}

export function autoRetryNotice(step: string, budget: RetryBudget, nodeId: string, reason?: string): string {
  const used = retryBudgetNodeUsed(budget, nodeId);
  return `「${step}」${reason ? `${reason}，` : ''}已自动重试（本步骤第 ${used}/${budget.nodeLimit} 次，本次运行共 ${budget.used}/${budget.runLimit} 次）。`;
}

export function retryBudgetExhaustedText(budget: RetryBudget, nodeId: string): string {
  return retryBudgetNodeUsed(budget, nodeId) >= budget.nodeLimit
    ? `本步骤自动重试已达上限（${budget.nodeLimit} 次），已停止自动重试，请检查网络或服务后手动继续。`
    : `本次运行自动重试已达上限（${budget.runLimit} 次），已停止自动重试，请检查网络或服务后手动继续。`;
}

export function receiptRecoveredText(step: string): string {
  return `「${step}」结果曾未知，已从保存的回执免费恢复，未重新提交。`;
}
