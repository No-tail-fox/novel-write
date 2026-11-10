import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { classifyProviderFailure, type ProviderFailureOutcome } from './provider-failure';
import type { ConfiguredJsonLlm } from './llm-provider';
import type { LlmConfig } from './types';

/**
 * G-3: a receipt journal for paid LLM calls on the template and HTML routes (the VOX/Lemo route keeps
 * its own node receipts). Each call writes `submitted` BEFORE the request leaves and `settled` with the
 * definitive outcome afterwards. The journal holds only hashes, ids, statuses and usage — never prompts,
 * responses or credentials.
 *
 * Policy:
 *  - A `submitted` entry with no `settled` entry means the app stopped mid-request: the provider may
 *    have billed it. The next identical request is refused ONCE with PROVIDER_RESULT_UNKNOWN so the
 *    user can reconcile with the provider; retrying again resends (explicit user decision).
 *  - A settled `unknown` outcome was already reported to the user by the failure itself, so a manual
 *    retry is allowed. Automatic resends are governed by provider-failure (never for unknown paid work).
 */

export const PROVIDER_RESULT_UNKNOWN = 'PROVIDER_RESULT_UNKNOWN';

export interface LlmReceiptEntry {
  v: 1;
  kind: 'submitted' | 'settled' | 'acknowledged';
  key: string;
  at: string;
  step?: number;
  name?: string;
  model?: string;
  outcome?: ProviderFailureOutcome | 'received';
  status?: number;
  failure?: string;
  requestId?: string | null;
  responseSha256?: string;
  usage?: Record<string, unknown>;
  fallbackModel?: string;
}

export interface LlmReceiptJournal {
  read(): Promise<LlmReceiptEntry[]>;
  append(entry: LlmReceiptEntry): Promise<void>;
}

const MAX_JOURNAL_BYTES = 4 * 1024 * 1024;

export function createFileLlmReceiptJournal(path: string): LlmReceiptJournal {
  let queue: Promise<unknown> = Promise.resolve();
  return {
    async read() {
      let text: string;
      try { text = await readFile(path, 'utf8'); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
      if (text.length > MAX_JOURNAL_BYTES) text = text.slice(-MAX_JOURNAL_BYTES);
      return text.split('\n').flatMap((line) => {
        try {
          const entry = JSON.parse(line) as LlmReceiptEntry;
          return entry?.v === 1 && typeof entry.key === 'string' ? [entry] : [];
        } catch { return []; }
      });
    },
    append(entry) {
      const next = queue.then(async () => {
        await mkdir(dirname(path), { recursive: true });
        await appendFile(path, JSON.stringify(entry) + '\n', 'utf8');
      });
      queue = next.catch(() => undefined);
      return next;
    },
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .filter((key) => key !== 'signal' && (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
}

export function llmReceiptKey(config: Pick<LlmConfig, 'baseUrl' | 'model' | 'protocol'>, request: unknown): string {
  return createHash('sha256').update(canonical({ baseUrl: config.baseUrl, model: config.model, protocol: config.protocol ?? '', request })).digest('hex');
}

/** Orphaned = submitted, never settled, never acknowledged since. */
export function orphanedLlmSubmission(entries: LlmReceiptEntry[], key: string): LlmReceiptEntry | undefined {
  let pending: LlmReceiptEntry | undefined;
  for (const entry of entries) {
    if (entry.key !== key) continue;
    pending = entry.kind === 'submitted' ? entry : undefined;
  }
  return pending;
}

export function withLlmReceiptJournal(llm: ConfiguredJsonLlm, config: Pick<LlmConfig, 'baseUrl' | 'model' | 'protocol'>, journal: LlmReceiptJournal, now: () => Date = () => new Date()): ConfiguredJsonLlm {
  // The journal is evidence, not a dependency: an unwritable work dir must not stop generation.
  const append = (entry: LlmReceiptEntry) => journal.append(entry).catch((error) => console.warn('[llm-receipts]', error instanceof Error ? error.message : error));
  const inFlight = new Map<string, number>();
  const run = async (request: { step: number; name: string; signal?: AbortSignal }) => {
    const key = llmReceiptKey(config, request);
    const base = { v: 1 as const, key, step: request.step, name: request.name, model: config.model };
    const orphan = inFlight.has(key) ? undefined : orphanedLlmSubmission(await journal.read().catch(() => []), key);
    if (orphan) {
      await append({ ...base, kind: 'acknowledged', at: now().toISOString() });
      throw Object.assign(new Error(`${PROVIDER_RESULT_UNKNOWN}: 「${request.name}」上次在 ${orphan.at} 已发出请求，但应用在收到结果前中断，服务商可能已经计费。请先到服务商后台核对；确认后再次重试会重新发送。`), { code: PROVIDER_RESULT_UNKNOWN });
    }
    await append({ ...base, kind: 'submitted', at: now().toISOString() });
    inFlight.set(key, (inFlight.get(key) ?? 0) + 1);
    try {
      const result = await (llm.run as unknown as (input: typeof request) => Promise<{ raw?: string; requestId?: string | null; usage?: Record<string, unknown>; modelUsed?: string }>)(request);
      await append({
        ...base, kind: 'settled', at: now().toISOString(), outcome: 'received', requestId: result.requestId ?? null,
        ...(typeof result.raw === 'string' ? { responseSha256: createHash('sha256').update(result.raw).digest('hex') } : {}),
        ...(result.usage ? { usage: result.usage } : {}),
        ...(result.modelUsed ? { fallbackModel: result.modelUsed } : {}),
      });
      return result;
    } catch (error) {
      const failure = classifyProviderFailure({ error });
      // A parse failure after a 200 is still a received (billed) response.
      const outcome = failure.kind === 'local' && /LLM_JSON_|JSON/u.test(error instanceof Error ? error.message : '') ? 'received' : failure.outcome;
      await append({ ...base, kind: 'settled', at: now().toISOString(), outcome, ...(failure.status ? { status: failure.status } : {}), failure: failure.kind });
      throw error;
    } finally {
      const count = (inFlight.get(key) ?? 1) - 1;
      if (count > 0) inFlight.set(key, count); else inFlight.delete(key);
    }
  };
  return { protocol: llm.protocol, run } as unknown as ConfiguredJsonLlm;
}

export interface LlmReceiptSummary { requests: number; received: number; rejected: number; unknown: number; notSent: number; orphaned: number; fallbacks: number }

/** For U-4/U-5: what the journal says about a task's paid LLM traffic. */
export function summarizeLlmReceipts(entries: LlmReceiptEntry[]): LlmReceiptSummary {
  const summary: LlmReceiptSummary = { requests: 0, received: 0, rejected: 0, unknown: 0, notSent: 0, orphaned: 0, fallbacks: 0 };
  const open = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === 'submitted') { summary.requests += 1; open.add(entry.key); continue; }
    if (entry.kind === 'acknowledged') { open.delete(entry.key); continue; }
    open.delete(entry.key);
    if (entry.outcome === 'received') summary.received += 1;
    else if (entry.outcome === 'rejected') summary.rejected += 1;
    else if (entry.outcome === 'not-sent') summary.notSent += 1;
    else summary.unknown += 1;
    if (entry.fallbackModel) summary.fallbacks += 1;
  }
  summary.orphaned = open.size;
  return summary;
}
