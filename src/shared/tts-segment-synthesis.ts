/**
 * G-5: TTS link hardening — bounded per-segment concurrency and classifier-driven retry.
 *
 * Re-synthesizing the same text segment is safe and cheap, so TTS is treated as an idempotent
 * call: `always` and `idempotent` failures (ECONNRESET, 429, 5xx, gateway errors) are retried
 * with exponential backoff + jitter honouring Retry-After. Auth, billing, bad-request, content
 * policy, local errors (including an incomplete-but-200 V3 stream) and cancellation are never
 * retried.
 */
import { wasGenerationNotSubmitted } from './generation-authorization';
import {
  classifyProviderFailure,
  providerBackoffMs,
  shouldRetryProviderFailure,
  type ProviderFailure,
} from './provider-failure';

export const DEFAULT_TTS_SEGMENT_CONCURRENCY = 2;
export const MAX_TTS_SEGMENT_CONCURRENCY = 6;
export const DEFAULT_TTS_SEGMENT_MAX_ATTEMPTS = 3;
const MAX_TTS_SEGMENT_ATTEMPTS = 5;
const TTS_BACKOFF_MAX_MS = 10_000;
const TTS_BACKOFF_JITTER = 0.3;

/** HTTP failure from a TTS endpoint that keeps status/headers for the shared classifier. */
export class TtsProviderHttpError extends Error {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;

  constructor(message: string, status: number, headers: Record<string, string>, body: string) {
    super(message);
    this.name = 'TtsProviderHttpError';
    this.status = status;
    this.headers = headers;
    this.body = body;
  }
}

export function ttsProviderHttpError(label: string, response: Response, body: string): TtsProviderHttpError {
  const headers: Record<string, string> = {};
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter !== null) headers['retry-after'] = retryAfter;
  return new TtsProviderHttpError(`${label} (${response.status}): ${body}`, response.status, headers, body);
}

export function classifyTtsFailure(error: unknown): ProviderFailure {
  if (error instanceof TtsProviderHttpError) {
    return classifyProviderFailure({ status: error.status, headers: error.headers, body: error.body, error });
  }
  return classifyProviderFailure({ error });
}

export function normalizeTtsSegmentConcurrency(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(numeric)) return DEFAULT_TTS_SEGMENT_CONCURRENCY;
  return Math.max(1, Math.min(MAX_TTS_SEGMENT_CONCURRENCY, Math.floor(numeric)));
}

export interface TtsSegmentRetryEvent {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  failure: ProviderFailure;
  label?: string;
}

export interface TtsSegmentRetryOptions {
  /** Total attempts including the first one (default 3, max 5). */
  maxAttempts?: number;
  signal?: AbortSignal;
  /** Short identifier for logs, e.g. `scene 3`. Must not contain secrets. */
  label?: string;
  baseMs?: number;
  random?: () => number;
  /** Injected for tests; must reject when the signal aborts. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  onRetry?: (event: TtsSegmentRetryEvent) => void;
}

export interface TtsSegmentSynthesisOptions {
  /** Max segments in flight at once (default 2, clamped to 1..6). */
  concurrency?: number;
  retry?: Omit<TtsSegmentRetryOptions, 'signal' | 'label'>;
}

function abortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  const error = new Error(typeof reason === 'string' ? reason : 'Request aborted.');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal!));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function defaultRetryLog(event: TtsSegmentRetryEvent): void {
  const where = [event.label, event.failure.host].filter(Boolean).join(' @ ');
  console.warn(`[tts] ${where || 'segment'}: ${event.failure.label}; retry ${event.attempt + 1}/${event.maxAttempts} in ${event.delayMs}ms`);
}

/** Run one TTS segment, retrying transient failures per the shared provider-failure classifier. */
export async function runTtsSegmentWithRetry<T>(
  attemptOnce: (attempt: number) => Promise<T>,
  options: TtsSegmentRetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, Math.min(MAX_TTS_SEGMENT_ATTEMPTS, Math.floor(options.maxAttempts ?? DEFAULT_TTS_SEGMENT_MAX_ATTEMPTS)));
  const sleep = options.sleep ?? abortableSleep;
  const onRetry = options.onRetry ?? defaultRetryLog;
  for (let attempt = 1; ; attempt += 1) {
    throwIfAborted(options.signal);
    try {
      return await attemptOnce(attempt);
    } catch (error) {
      if (options.signal?.aborted || attempt >= maxAttempts || wasGenerationNotSubmitted(error)) throw error;
      const failure = classifyTtsFailure(error);
      if (!shouldRetryProviderFailure(failure, { idempotent: true })) throw error;
      const delayMs = providerBackoffMs(attempt, {
        baseMs: options.baseMs,
        maxMs: TTS_BACKOFF_MAX_MS,
        jitter: TTS_BACKOFF_JITTER,
        random: options.random,
        retryAfterMs: failure.retryAfterMs,
      });
      onRetry({ attempt, maxAttempts, delayMs, failure, label: options.label });
      await sleep(delayMs, options.signal);
    }
  }
}

/**
 * Map items with at most `limit` workers in flight, preserving input order in the result.
 * On the first failure no new items start, in-flight siblings are aborted through the
 * per-batch signal, and the first error is rethrown after every worker settled.
 */
export async function mapWithConcurrencyLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number, signal: AbortSignal) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  throwIfAborted(signal);
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', forwardAbort, { once: true });
  const results = new Array<R>(items.length);
  const state: { next: number; failed: boolean; error?: unknown } = { next: 0, failed: false };
  const runWorker = async () => {
    while (!state.failed && !controller.signal.aborted && state.next < items.length) {
      const index = state.next;
      state.next += 1;
      try {
        results[index] = await worker(items[index]!, index, controller.signal);
      } catch (error) {
        if (!state.failed) {
          state.failed = true;
          state.error = error;
          controller.abort(error);
        }
      }
    }
  };
  try {
    const workers = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
    await Promise.all(Array.from({ length: workers }, runWorker));
  } finally {
    signal?.removeEventListener('abort', forwardAbort);
  }
  if (state.failed) throw signal?.aborted ? abortError(signal) : state.error;
  throwIfAborted(signal);
  return results;
}

/** Synthesize segments with bounded concurrency and per-segment retry. */
export function synthesizeTtsSegments<T, R>(
  segments: readonly T[],
  synthesizeOne: (segment: T, signal: AbortSignal, attempt: number) => Promise<R>,
  options: TtsSegmentSynthesisOptions & { signal?: AbortSignal; label?: (segment: T, index: number) => string } = {},
): Promise<R[]> {
  const limit = normalizeTtsSegmentConcurrency(options.concurrency ?? DEFAULT_TTS_SEGMENT_CONCURRENCY);
  return mapWithConcurrencyLimit(segments, limit, (segment, index, signal) => runTtsSegmentWithRetry(
    (attempt) => synthesizeOne(segment, signal, attempt),
    { ...options.retry, signal, label: options.label?.(segment, index) },
  ), options.signal);
}
