export interface FetchWithTimeoutOptions extends RequestInit {
  timeoutMs?: number;
  timeoutLabel?: string;
}

export async function fetchWithTimeout(url: string | URL, options: FetchWithTimeoutOptions = {}): Promise<Response> {
  const { timeoutMs = 120_000, timeoutLabel = 'Request', signal, ...init } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`${timeoutLabel} timed out after ${timeoutMs}ms.`)), timeoutMs);
  const abortFromParent = () => controller.abort(signal?.reason ?? new Error(`${timeoutLabel} aborted.`));

  try {
    if (signal?.aborted) abortFromParent();
    signal?.addEventListener('abort', abortFromParent, { once: true });
    if (controller.signal.aborted) throw abortError(controller.signal, timeoutLabel);
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw abortError(controller.signal, timeoutLabel);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromParent);
  }
}

function abortError(signal: AbortSignal, timeoutLabel: string): Error {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  if (typeof reason === 'string') return new Error(reason);
  return new Error(`${timeoutLabel} aborted.`);
}
