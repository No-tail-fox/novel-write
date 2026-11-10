import type { LlmReceiptEntry } from './llm-receipt-ledger';

/**
 * U-5: per-project paid-call ledger and cost estimate (pure; safe for the renderer).
 *
 * Every route keeps its own evidence (LLM receipt journal, VOX node journal, Lemo turn receipts,
 * HTML pipeline state, provider output folders). The main process normalizes those records into
 * `CostLedgerEntry` rows — read-only, never a new paid call — and `summarizeProjectCost` turns them
 * into counts and an estimate priced by the user-editable `CostPriceTable` (AppConfig.costPriceTable).
 *
 * Rules:
 *  - Only `received` calls are priced. `unknown` calls are counted separately as "可能已计费":
 *    the provider may have billed them, but we cannot prove it.
 *  - `rejected` / `not-sent` calls cost nothing.
 *  - No matching price row, or a row without the needed unit price / quantity → the call is counted
 *    but not priced ("未定价"); an estimate is never invented.
 *  - LLM `inputTokens` include cached tokens (OpenAI convention); cached tokens are priced with
 *    `cachedPer1M` when set, otherwise with the normal input price.
 */

export const COST_KINDS = ['llm', 'image', 'tts', 'video', 'music'] as const;
export type CostKind = (typeof COST_KINDS)[number];
export type CostOutcome = 'received' | 'rejected' | 'unknown' | 'not-sent';

export const COST_KIND_LABELS: Record<CostKind, string> = { llm: '文本模型', image: '生图', tts: '配音', video: '视频', music: '音乐' };
export const DEFAULT_COST_CURRENCY = 'CNY';
export const MAX_COST_PRICE_ROWS = 200;

export interface CostLedgerEntry {
  kind: CostKind;
  provider: string;
  model: string;
  outcome: CostOutcome;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  characters?: number;
  images?: number;
  seconds?: number;
  at: string;
  /** Which record produced the row (diagnostics only). */
  source?: string;
}

/** One price row. All prices are in the table currency; absent = not priced for that unit. */
export interface CostPriceRow {
  /** Model id as reported by the provider/config (case-insensitive); a provider id also matches. */
  model: string;
  /** Restrict the row to one kind; absent = any kind with this model name. */
  kind?: CostKind;
  inputPer1M?: number;
  outputPer1M?: number;
  cachedPer1M?: number;
  perImage?: number;
  per1kChars?: number;
  perSecond?: number;
  /** Flat price per received call (used when the unit quantity is unknown). */
  perCall?: number;
}

export interface CostPriceTable {
  currency: string;
  rows: CostPriceRow[];
}

export interface CostOutcomeCounts {
  calls: number;
  received: number;
  rejected: number;
  unknown: number;
  notSent: number;
}

export interface ProjectCostKindSummary extends CostOutcomeCounts {
  kind: CostKind;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  characters: number;
  images: number;
  seconds: number;
  /** Sum of priced received calls; null when none of them could be priced. */
  cost: number | null;
  /** Received calls that could not be priced (no row, or no quantity for the row's unit). */
  unpricedReceived: number;
}

export interface ProjectCostModelSummary extends CostOutcomeCounts {
  kind: CostKind;
  provider: string;
  model: string;
  cost: number | null;
  priced: boolean;
}

export interface ProjectCostSummary {
  currency: string;
  kinds: ProjectCostKindSummary[];
  models: ProjectCostModelSummary[];
  totals: CostOutcomeCounts & { inputTokens: number; outputTokens: number; cachedTokens: number };
  estimatedCost: number | null;
  unpricedReceived: number;
  /** Calls with an unknown outcome: "可能已计费 N 次". */
  possiblyBilled: number;
}

/** H-5: expected image generations for the project's current plan (before / without starting). */
export interface ProjectCostImageEstimate {
  count: number;
  /** After de-duplicating identical prompts within one run (HTML route); absent when not applicable. */
  unique?: number;
  /** `upper-bound` = a budget cap (Lemo v3 agent images), not a plan. */
  basis: 'plan' | 'upper-bound';
  label: string;
}

/** IPC `project:cost-summary` result. */
export interface ProjectCostReport {
  taskId: string;
  generatedAt: string;
  summary: ProjectCostSummary;
  expectedImages?: ProjectCostImageEstimate;
  /** Evidence limitations in plain Chinese (lower bounds, unknown models, …). */
  notes: string[];
}

const finiteNonNegative = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
const priceValue = (value: unknown): number | undefined => {
  const number = typeof value === 'string' && value.trim() ? Number(value) : value;
  return finiteNonNegative(number);
};

export function emptyCostPriceTable(): CostPriceTable {
  return { currency: DEFAULT_COST_CURRENCY, rows: [] };
}

/** Accepts absent / partial / legacy input (old configs have no table) and never throws. */
export function normalizeCostPriceTable(input: unknown): CostPriceTable {
  const value = input && typeof input === 'object' ? input as Partial<CostPriceTable> : {};
  const currency = typeof value.currency === 'string' && /^[A-Za-z]{3}$/u.test(value.currency.trim()) ? value.currency.trim().toUpperCase() : DEFAULT_COST_CURRENCY;
  const rows = (Array.isArray(value.rows) ? value.rows : []).slice(0, MAX_COST_PRICE_ROWS).flatMap((raw): CostPriceRow[] => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as unknown as Record<string, unknown>;
    const model = typeof row.model === 'string' ? row.model.trim().slice(0, 256) : '';
    if (!model) return [];
    const kind = COST_KINDS.includes(row.kind as CostKind) ? row.kind as CostKind : undefined;
    const normalized: CostPriceRow = { model, ...(kind ? { kind } : {}) };
    for (const key of ['inputPer1M', 'outputPer1M', 'cachedPer1M', 'perImage', 'per1kChars', 'perSecond', 'perCall'] as const) {
      const price = priceValue(row[key]);
      if (price !== undefined) normalized[key] = price;
    }
    return [normalized];
  });
  return { currency, rows };
}

export function findCostPrice(table: CostPriceTable | undefined, entry: Pick<CostLedgerEntry, 'kind' | 'model' | 'provider'>): CostPriceRow | undefined {
  if (!table?.rows.length) return undefined;
  const candidates = table.rows.filter((row) => !row.kind || row.kind === entry.kind);
  const model = entry.model.trim().toLowerCase();
  const provider = entry.provider.trim().toLowerCase();
  return (model ? candidates.find((row) => row.model.toLowerCase() === model) : undefined)
    ?? (provider ? candidates.find((row) => row.model.toLowerCase() === provider) : undefined);
}

/** Cost of one received call, or undefined when the row lacks the unit price / the entry lacks the quantity. */
export function estimateCostEntry(entry: CostLedgerEntry, row: CostPriceRow | undefined): number | undefined {
  if (!row || entry.outcome !== 'received') return undefined;
  if (entry.kind === 'llm') {
    const input = finiteNonNegative(entry.inputTokens);
    const output = finiteNonNegative(entry.outputTokens);
    if ((input !== undefined || output !== undefined) && (row.inputPer1M !== undefined || row.outputPer1M !== undefined)) {
      if ((input ?? 0) > 0 && row.inputPer1M === undefined) return undefined;
      if ((output ?? 0) > 0 && row.outputPer1M === undefined) return undefined;
      const cached = Math.min(finiteNonNegative(entry.cachedTokens) ?? 0, input ?? 0);
      const uncached = (input ?? 0) - cached;
      return (uncached * (row.inputPer1M ?? 0) + cached * (row.cachedPer1M ?? row.inputPer1M ?? 0) + (output ?? 0) * (row.outputPer1M ?? 0)) / 1_000_000;
    }
    return row.perCall;
  }
  if (entry.kind === 'image') {
    if (row.perImage !== undefined) return (finiteNonNegative(entry.images) ?? 1) * row.perImage;
    return row.perCall;
  }
  if (entry.kind === 'tts') {
    const characters = finiteNonNegative(entry.characters);
    if (row.per1kChars !== undefined && characters !== undefined) return characters / 1000 * row.per1kChars;
    return row.perCall;
  }
  const seconds = finiteNonNegative(entry.seconds);
  if (row.perSecond !== undefined && seconds !== undefined) return seconds * row.perSecond;
  return row.perCall;
}

const emptyCounts = (): CostOutcomeCounts => ({ calls: 0, received: 0, rejected: 0, unknown: 0, notSent: 0 });
function countOutcome(target: CostOutcomeCounts, outcome: CostOutcome) {
  target.calls += 1;
  if (outcome === 'received') target.received += 1;
  else if (outcome === 'rejected') target.rejected += 1;
  else if (outcome === 'not-sent') target.notSent += 1;
  else target.unknown += 1;
}
const roundCost = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

export function summarizeProjectCost(entries: readonly CostLedgerEntry[], priceTable?: CostPriceTable | null): ProjectCostSummary {
  const table = normalizeCostPriceTable(priceTable ?? undefined);
  const kinds = new Map<CostKind, ProjectCostKindSummary & { pricedAny: boolean; sum: number }>(COST_KINDS.map((kind) => [kind, {
    kind, ...emptyCounts(), inputTokens: 0, outputTokens: 0, cachedTokens: 0, characters: 0, images: 0, seconds: 0, cost: null, unpricedReceived: 0, pricedAny: false, sum: 0,
  }]));
  const models = new Map<string, ProjectCostModelSummary & { sum: number }>();
  for (const entry of entries) {
    const kind = kinds.get(entry.kind);
    if (!kind) continue;
    countOutcome(kind, entry.outcome);
    // Usage is evidence of what the provider processed, so it is totalled for every outcome that has it.
    kind.inputTokens += finiteNonNegative(entry.inputTokens) ?? 0;
    kind.outputTokens += finiteNonNegative(entry.outputTokens) ?? 0;
    kind.cachedTokens += finiteNonNegative(entry.cachedTokens) ?? 0;
    if (entry.outcome === 'received') {
      kind.characters += finiteNonNegative(entry.characters) ?? 0;
      kind.seconds += finiteNonNegative(entry.seconds) ?? 0;
      kind.images += entry.kind === 'image' ? finiteNonNegative(entry.images) ?? 1 : 0;
    }
    const key = `${entry.kind}\u0000${entry.provider}\u0000${entry.model}`;
    const model = models.get(key) ?? { kind: entry.kind, provider: entry.provider, model: entry.model, ...emptyCounts(), cost: null, priced: false, sum: 0 };
    models.set(key, model);
    countOutcome(model, entry.outcome);
    const row = findCostPrice(table, entry);
    if (row) model.priced = true;
    if (entry.outcome !== 'received') continue;
    const cost = estimateCostEntry(entry, row);
    if (cost === undefined) { kind.unpricedReceived += 1; continue; }
    kind.pricedAny = true; kind.sum += cost;
    model.sum += cost; model.cost = roundCost(model.sum);
  }
  const kindList = [...kinds.values()].map(({ pricedAny, sum, ...kind }) => ({ ...kind, cost: pricedAny ? roundCost(sum) : null }));
  const totals = { ...emptyCounts(), inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
  for (const kind of kindList) {
    for (const key of ['calls', 'received', 'rejected', 'unknown', 'notSent', 'inputTokens', 'outputTokens', 'cachedTokens'] as const) totals[key] += kind[key];
  }
  const priced = kindList.filter((kind) => kind.cost !== null);
  return {
    currency: table.currency,
    kinds: kindList,
    models: [...models.values()].map(({ sum: _sum, ...model }) => model)
      .sort((a, b) => COST_KINDS.indexOf(a.kind) - COST_KINDS.indexOf(b.kind) || b.calls - a.calls || a.model.localeCompare(b.model)),
    totals,
    estimatedCost: priced.length ? roundCost(priced.reduce((sum, kind) => sum + kind.cost!, 0)) : null,
    unpricedReceived: kindList.reduce((sum, kind) => sum + kind.unpricedReceived, 0),
    possiblyBilled: totals.unknown,
  };
}

const usageNumber = (value: unknown) => {
  const number = finiteNonNegative(value);
  return number === undefined ? undefined : Math.round(number);
};

/** OpenAI chat (prompt/completion + prompt_tokens_details), Responses (input/output + input_tokens_details), Anthropic (input + cache_*). */
export function llmUsageTokens(usage: Record<string, unknown> | undefined | null): Pick<CostLedgerEntry, 'inputTokens' | 'outputTokens' | 'cachedTokens'> | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const details = (value: unknown) => (value && typeof value === 'object' ? value as Record<string, unknown> : {});
  const prompt = usageNumber(usage.prompt_tokens);
  const input = usageNumber(usage.input_tokens);
  const output = usageNumber(usage.completion_tokens) ?? usageNumber(usage.output_tokens);
  const cacheRead = usageNumber(usage.cache_read_input_tokens);
  const cacheWrite = usageNumber(usage.cache_creation_input_tokens);
  const anthropic = prompt === undefined && (cacheRead !== undefined || cacheWrite !== undefined);
  const inputTokens = prompt ?? (input === undefined && !anthropic ? undefined : (input ?? 0) + (anthropic ? (cacheRead ?? 0) + (cacheWrite ?? 0) : 0));
  const cachedTokens = usageNumber(details(usage.prompt_tokens_details).cached_tokens)
    ?? usageNumber(details(usage.input_tokens_details).cached_tokens)
    ?? cacheRead ?? usageNumber(usage.cached_tokens);
  if (inputTokens === undefined && output === undefined) return undefined;
  return { ...(inputTokens !== undefined ? { inputTokens } : {}), ...(output !== undefined ? { outputTokens: output } : {}), ...(cachedTokens ? { cachedTokens } : {}) };
}

/**
 * G-3 journal → ledger. A `submitted` without `settled` is unknown (possibly billed) — also after the
 * user acknowledged it: acknowledging lets the next request through, it does not undo a charge.
 */
export function costEntriesFromLlmReceipts(entries: readonly LlmReceiptEntry[], provider = ''): CostLedgerEntry[] {
  const result: CostLedgerEntry[] = [];
  const pending = new Map<string, LlmReceiptEntry[]>();
  const unknown = (entry: LlmReceiptEntry) => result.push({ kind: 'llm', provider, model: entry.model ?? '', outcome: 'unknown', at: entry.at, source: 'llm-receipts' });
  for (const entry of entries) {
    const open = pending.get(entry.key) ?? [];
    if (entry.kind === 'submitted') { open.push(entry); pending.set(entry.key, open); continue; }
    if (entry.kind === 'acknowledged') { open.forEach(unknown); pending.delete(entry.key); continue; }
    open.shift();
    const outcome: CostOutcome = entry.outcome === 'received' || entry.outcome === 'rejected' || entry.outcome === 'not-sent' ? entry.outcome : 'unknown';
    result.push({ kind: 'llm', provider, model: entry.fallbackModel || entry.model || '', outcome, at: entry.at, source: 'llm-receipts', ...(llmUsageTokens(entry.usage) ?? {}) });
  }
  for (const open of pending.values()) open.forEach(unknown);
  return result;
}

export function formatCostAmount(value: number | null | undefined, currency = DEFAULT_COST_CURRENCY): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '未定价';
  const digits = value > 0 && value < 0.01 ? 4 : 2;
  try { return new Intl.NumberFormat('zh-CN', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: digits }).format(value); }
  catch { return `${currency} ${value.toFixed(digits)}`; }
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 10_000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}
