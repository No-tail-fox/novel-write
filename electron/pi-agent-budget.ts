export interface PiBudgetLimits { maxRequests: number; maxTokens?: number; maxCost?: number }
export interface PiBudgetUsage { requests: number; inputTokens: number; outputTokens: number; estimatedCost: number; unreportedRequests: number }
export interface PiBudgetReservation { inputTokenUpperBound: number; outputTokenLimit: number; inputPricePerMillion: number; outputPricePerMillion: number }
const nonnegative = (value: number) => Number.isFinite(value) && value >= 0;
/** Must be invoked inside the gateway's serialized admission window, before any provider request. */
export function assertPiRequestBudget(limits: PiBudgetLimits, usage: PiBudgetUsage, reservation: PiBudgetReservation): void {
  if (!Number.isSafeInteger(limits.maxRequests) || limits.maxRequests < 1 || !Number.isSafeInteger(usage.requests) || usage.requests < 0
    || ![usage.inputTokens, usage.outputTokens, usage.estimatedCost, usage.unreportedRequests, reservation.inputTokenUpperBound,
      reservation.outputTokenLimit, reservation.inputPricePerMillion, reservation.outputPricePerMillion].every(nonnegative)
    || !Number.isSafeInteger(reservation.inputTokenUpperBound) || !Number.isSafeInteger(reservation.outputTokenLimit)
    || reservation.outputTokenLimit < 1
    || limits.maxTokens !== undefined && (!Number.isSafeInteger(limits.maxTokens) || limits.maxTokens < 1)
    || limits.maxCost !== undefined && (!nonnegative(limits.maxCost) || limits.maxCost <= 0)) throw new Error('PI_BUDGET_INVALID');
  if (usage.unreportedRequests > 0) throw new Error('PI_BUDGET_USAGE_UNREPORTED');
  if (usage.requests >= limits.maxRequests) throw new Error('PI_BUDGET_REQUEST_LIMIT');
  const tokens = reservation.inputTokenUpperBound + reservation.outputTokenLimit;
  if (limits.maxTokens !== undefined && usage.inputTokens + usage.outputTokens + tokens > limits.maxTokens) throw new Error('PI_BUDGET_TOKEN_LIMIT');
  const cost = (reservation.inputTokenUpperBound * reservation.inputPricePerMillion + reservation.outputTokenLimit * reservation.outputPricePerMillion) / 1_000_000;
  if (limits.maxCost !== undefined && usage.estimatedCost + cost > limits.maxCost) throw new Error('PI_BUDGET_COST_LIMIT');
}
