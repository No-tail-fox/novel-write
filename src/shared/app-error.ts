export interface AppErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
  diagnosticId: string;
  field?: string;
}

export interface AppErrorDefaults {
  code?: string;
  message?: string;
  retryable?: boolean;
  field?: string;
}

const CANCELLATION_CODES = new Set(['ABORT_ERR', 'ERR_ABORTED', 'ERR_CANCELED', 'ACTION_CANCELLED']);
const CODE_PREFIX = /^([A-Z][A-Z0-9_]{2,63}):\s*(.*)$/su;
const BRIDGE_MARKER = '__STORYDREAM_SAFE_APP_ERROR_V1__:';
const SECRET_NAME = '(?:x[-_]?api[-_]?key|api[-_]?key|access[-_]?key(?:[-_]?id)?|access[-_]?token|refresh[-_]?token|id[-_]?token|token|password|passwd|secret(?:[-_]?access[-_]?key)?|session(?:[-_]?id)?|authorization|cookie)';
const REDACTED = '[REDACTED]';

export class AppError extends Error {
  readonly name = 'AppError';
  readonly diagnosticId: string;

  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    diagnosticId = createDiagnosticId(),
    readonly field?: string,
  ) {
    super(redactErrorText(message));
    this.diagnosticId = sanitizeDiagnosticId(diagnosticId);
  }
}

export function redactErrorText(value: string): string {
  let text = value;
  text = text.replace(/^(\s*(?:authorization|proxy-authorization)\s*:\s*).*$/gimu, `$1${REDACTED}`);
  text = text.replace(/^(\s*(?:cookie|set-cookie)\s*:\s*).*$/gimu, `$1${REDACTED}`);
  text = text.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/giu, `$1 ${REDACTED}`);
  text = text.replace(new RegExp(`([?&]${SECRET_NAME}=)[^&#\\s]+`, 'giu'), `$1${REDACTED}`);
  text = text.replace(
    new RegExp(`(["']?${SECRET_NAME}["']?\\s*[:=]\\s*)(["']?)([^"'\\s,;}&#?]+)(["']?)`, 'giu'),
    (_match, prefix: string, quote: string) => `${prefix}${quote}${REDACTED}${quote}`,
  );
  text = text.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, REDACTED);
  return text;
}

export function isCancellation(error: unknown): boolean {
  if (!error || (typeof error !== 'object' && typeof error !== 'string')) return false;
  if (typeof error === 'object') {
    const candidate = error as { name?: unknown; code?: unknown; message?: unknown };
    if (candidate.name === 'AbortError') return true;
    if (typeof candidate.code === 'string' && CANCELLATION_CODES.has(candidate.code.toUpperCase())) return true;
    if (candidate instanceof AppError && candidate.code === 'ACTION_CANCELLED') return true;
  }
  return false;
}

export function normalizeAppError(error: unknown, defaults: AppErrorDefaults = {}): AppError {
  const bridged = readBridgedAppError(error);
  if (bridged) return bridged;
  if (error instanceof AppError) {
    return new AppError(error.code, error.message, error.retryable, error.diagnosticId, error.field);
  }
  if (isCancellation(error)) {
    return new AppError('ACTION_CANCELLED', '操作已取消。', false, readDiagnosticId(error));
  }
  if (error instanceof Error) {
    const safeMessage = redactErrorText(error.message || '');
    const coded = CODE_PREFIX.exec(safeMessage);
    const code = coded?.[1] ?? defaults.code ?? 'UNEXPECTED_ERROR';
    const message = coded?.[2]?.trim() || defaults.message || '操作失败，请重试。';
    return new AppError(
      code,
      message,
      coded ? inferRetryable(code) : defaults.retryable ?? inferRetryable(code),
      readDiagnosticId(error),
      defaults.field,
    );
  }
  return new AppError(
    defaults.code ?? 'UNEXPECTED_ERROR',
    defaults.message ?? '操作失败，请重试。',
    defaults.retryable ?? false,
    createDiagnosticId(),
    defaults.field,
  );
}

export function toAppErrorPayload(error: unknown, defaults: AppErrorDefaults = {}): AppErrorPayload {
  const normalized = normalizeAppError(error, defaults);
  return {
    code: normalized.code,
    message: normalized.message,
    retryable: normalized.retryable,
    diagnosticId: normalized.diagnosticId,
    ...(normalized.field ? { field: normalized.field } : {}),
  };
}

export function serializeAppErrorForBridge(error: unknown): string {
  const payload = toAppErrorPayload(error);
  return `${BRIDGE_MARKER}${encodeURIComponent(JSON.stringify(payload))}`;
}

export function appErrorFromPayload(payload: unknown): AppError {
  if (!payload || typeof payload !== 'object') return normalizeAppError(payload);
  const candidate = payload as Partial<AppErrorPayload>;
  if (typeof candidate.code !== 'string' || typeof candidate.message !== 'string') {
    return normalizeAppError(payload);
  }
  return new AppError(
    sanitizeCode(candidate.code),
    candidate.message,
    candidate.retryable === true,
    sanitizeDiagnosticId(candidate.diagnosticId),
    typeof candidate.field === 'string' ? redactErrorText(candidate.field) : undefined,
  );
}

export function formatAppErrorMessage(error: AppError): string {
  const retry = error.retryable ? ' 可以重试。' : '';
  return `${error.message}${retry}（诊断号：${error.diagnosticId}）`;
}

function sanitizeCode(code: string): string {
  return /^[A-Z][A-Z0-9_]{2,63}$/u.test(code) ? code : 'UNEXPECTED_ERROR';
}

function inferRetryable(code: string): boolean {
  return /(?:TIMEOUT|NETWORK|RATE_LIMIT|TEMPORARY|UNAVAILABLE|IPC_HANDLER_FAILED)/u.test(code);
}

function readBridgedAppError(error: unknown): AppError | null {
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const markerIndex = text.lastIndexOf(BRIDGE_MARKER);
  if (markerIndex < 0) return null;
  const encoded = text.slice(markerIndex + BRIDGE_MARKER.length).match(/^[^\s]+/u)?.[0];
  if (!encoded || encoded.length > 16_384) return null;
  try {
    return appErrorFromPayload(JSON.parse(decodeURIComponent(encoded)));
  } catch {
    return null;
  }
}

function readDiagnosticId(error: unknown): string {
  const value = error && typeof error === 'object' ? (error as { diagnosticId?: unknown }).diagnosticId : undefined;
  return sanitizeDiagnosticId(value);
}

function sanitizeDiagnosticId(value: unknown): string {
  return typeof value === 'string' && /^[a-zA-Z0-9-]{8,64}$/u.test(value) ? value : createDiagnosticId();
}

function createDiagnosticId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `diag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
