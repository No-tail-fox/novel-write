import { expect, it } from 'vitest';
import { assertPiRequestBudget } from '../electron/pi-agent-budget';
const usage = { requests: 1, inputTokens: 1000, outputTokens: 100, estimatedCost: .02, unreportedRequests: 0 };
const reservation = { inputTokenUpperBound: 2000, outputTokenLimit: 1000, inputPricePerMillion: 10, outputPricePerMillion: 20 };
it('reserves the entire bounded request before admission', () => {
  expect(() => assertPiRequestBudget({ maxRequests: 2, maxTokens: 4100, maxCost: .06 }, usage, reservation)).not.toThrow();
  expect(() => assertPiRequestBudget({ maxRequests: 1 }, usage, reservation)).toThrow('REQUEST_LIMIT');
  expect(() => assertPiRequestBudget({ maxRequests: 2, maxTokens: 4099 }, usage, reservation)).toThrow('TOKEN_LIMIT');
  expect(() => assertPiRequestBudget({ maxRequests: 2, maxCost: .059 }, usage, reservation)).toThrow('COST_LIMIT');
});
it('does not treat unreported usage as zero', () => {
  expect(() => assertPiRequestBudget({ maxRequests: 2 }, { ...usage, unreportedRequests: 1 }, reservation)).toThrow('UNREPORTED');
  expect(() => assertPiRequestBudget({ maxRequests: 2 }, usage, { ...reservation, outputTokenLimit: Infinity })).toThrow('INVALID');
});
