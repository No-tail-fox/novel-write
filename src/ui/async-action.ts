import { useCallback, useEffect, useRef, useState } from 'react';
import { formatAppErrorMessage, isCancellation, normalizeAppError, type AppError } from '../shared/app-error';

export interface AsyncActionFeedback {
  tone: 'error' | 'success';
  message: string;
  diagnosticId?: string;
  retryable?: boolean;
}

export interface AsyncActionOptions<T> {
  successMessage?: string;
  onSuccess?: (value: T) => void;
  onError?: (error: AppError) => void;
  onCancel?: () => void;
}

export type AsyncActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'busy' | 'cancelled' | 'failed'; error?: AppError };

export function useAsyncAction() {
  const activeRef = useRef(false);
  const mountedRef = useRef(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<AsyncActionFeedback | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const clearFeedback = useCallback(() => setFeedback(null), []);

  const reportError = useCallback((error: unknown): AppError => {
    const normalized = normalizeAppError(error);
    if (!isCancellation(normalized) && mountedRef.current) {
      setFeedback({
        tone: 'error',
        message: formatAppErrorMessage(normalized),
        diagnosticId: normalized.diagnosticId,
        retryable: normalized.retryable,
      });
    }
    return normalized;
  }, []);

  const run = useCallback(async <T,>(operation: () => Promise<T>, options: AsyncActionOptions<T> = {}): Promise<AsyncActionResult<T>> => {
    if (activeRef.current) return { ok: false, reason: 'busy' };
    activeRef.current = true;
    if (mountedRef.current) {
      setBusy(true);
      setFeedback(null);
    }
    try {
      const value = await operation();
      if (mountedRef.current && options.successMessage) {
        setFeedback({ tone: 'success', message: options.successMessage });
      }
      options.onSuccess?.(value);
      return { ok: true, value };
    } catch (error) {
      if (isCancellation(error)) {
        options.onCancel?.();
        return { ok: false, reason: 'cancelled' };
      }
      const normalized = reportError(error);
      options.onError?.(normalized);
      return { ok: false, reason: 'failed', error: normalized };
    } finally {
      activeRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }, [reportError]);

  return { busy, feedback, run, clearFeedback, reportError };
}
