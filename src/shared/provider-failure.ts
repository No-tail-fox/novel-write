/**
 * G-2: one classification for every provider failure (LLM, image, TTS, video).
 *
 * The question every caller has to answer is "may I send this again?". That depends on whether the
 * provider can have received (and billed) the request:
 *  - `not-sent`  — no HTTP request left this machine (connect timeout, refused, DNS). Safe to resend.
 *  - `rejected`  — the provider answered with a definitive refusal (429, 503 overload, 4xx). Nothing
 *                  was produced; resend is safe only when the refusal is transient.
 *  - `unknown`   — the request may have been processed (socket reset after send, 500/502/520/524,
 *                  read timeouts). Paid, non-idempotent work must NOT be resent automatically.
 */

export type ProviderFailureKind =
  | 'aborted'
  | 'connect'
  | 'dns'
  | 'transport-lost'
  | 'response-timeout'
  | 'rate-limit'
  | 'overloaded'
  | 'gateway'
  | 'gateway-timeout'
  | 'server'
  | 'auth'
  | 'billing'
  | 'model-not-found'
  | 'not-found'
  | 'bad-request'
  | 'content-policy'
  | 'local'
  | 'unknown';

export type ProviderFailureOutcome = 'not-sent' | 'rejected' | 'unknown';

/** `always`: resend freely. `idempotent`: only for free/idempotent calls. `never`: requires a human or a different config. */
export type ProviderRetryPolicy = 'always' | 'idempotent' | 'never';

export interface ProviderFailure {
  kind: ProviderFailureKind;
  outcome: ProviderFailureOutcome;
  retry: ProviderRetryPolicy;
  /** A different model/route may succeed (G-1 fallback candidates). */
  fallback: boolean;
  status?: number;
  code?: string;
  host?: string;
  retryAfterMs?: number;
  /** Short Chinese explanation for logs and UI. */
  label: string;
}

export interface ProviderFailureInput {
  status?: number;
  error?: unknown;
  /** Response body or message text, used for model_not_found / policy detection. */
  body?: string;
  headers?: Headers | Record<string, string | null | undefined>;
}

const NOT_SENT_CODES = new Set(['UND_ERR_CONNECT_TIMEOUT', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EADDRNOTAVAIL']);
const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN']);
// TLS handshake failures happen before any request byte is sent (Q-4). Certificate problems do not heal by retrying.
const TLS_CERT_CODES = /^(?:CERT_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_(?:VERIFY|GET)_|ERR_TLS_CERT_)/u;
const TLS_HANDSHAKE_CODES = /^(?:ERR_SSL_|ERR_TLS_)/u;
const LOST_CODES = new Set(['ECONNRESET', 'UND_ERR_SOCKET', 'EPIPE', 'ECONNABORTED', 'UND_ERR_CLOSED', 'ERR_STREAM_PREMATURE_CLOSE']);
const RESPONSE_TIMEOUT_CODES = new Set(['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ETIMEDOUT', 'NETWORK_TIMEOUT']);
const MAX_RETRY_AFTER_MS = 60_000;

function header(headers: ProviderFailureInput['headers'], name: string): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name) ?? undefined;
  const record = headers as Record<string, string | null | undefined>;
  const key = Object.keys(record).find(candidate => candidate.toLowerCase() === name.toLowerCase());
  return key ? record[key] ?? undefined : undefined;
}

/** Retry-After as delta-seconds or HTTP date; capped so a hostile header cannot stall a run. */
export function parseRetryAfterMs(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value?.trim()) return undefined;
  const seconds = Number(value.trim());
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  return Math.min(MAX_RETRY_AFTER_MS, Math.round(ms));
}

function causeChain(error: unknown): Array<Error & { code?: unknown; hostname?: unknown; status?: unknown; name: string }> {
  const chain: Array<Error & { code?: unknown; hostname?: unknown; status?: unknown }> = [];
  let current = error;
  while (current instanceof Error && chain.length < 6 && !chain.includes(current)) {
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

function hostFromText(text: string): string | undefined {
  return text.match(/\b((?:[a-z0-9-]+\.)+[a-z]{2,})(?::\d+)?\b/iu)?.[1];
}

function statusFromText(text: string): number | undefined {
  const match = text.match(/\((\d{3})\)|\bHTTP\s*(\d{3})\b|\bstatus\s*[:=]?\s*(\d{3})\b/iu);
  const value = Number(match?.[1] ?? match?.[2] ?? match?.[3]);
  return Number.isInteger(value) && value >= 400 && value < 600 ? value : undefined;
}

function make(kind: ProviderFailureKind, outcome: ProviderFailureOutcome, retry: ProviderRetryPolicy, label: string, extra: Partial<ProviderFailure> = {}): ProviderFailure {
  return { kind, outcome, retry, fallback: false, label, ...extra };
}

export function classifyHttpStatus(status: number, body = ''): ProviderFailure {
  const text = body.slice(0, 4000);
  if (status === 429) return make('rate-limit', 'rejected', 'always', '请求过于频繁（429），稍后重试', { status });
  if (status === 529 || (status === 503 && !/no available (?:compatible )?(?:accounts?|channel)/iu.test(text))) {
    return make('overloaded', 'rejected', 'always', `服务暂时过载（${status}）`, { status, fallback: true });
  }
  if (status === 503) return make('model-not-found', 'rejected', 'never', '当前分组没有可用的模型通道（503）', { status, fallback: true });
  if (status === 524 || status === 504) return make('gateway-timeout', 'unknown', 'idempotent', `网关等待上游超时（${status}），结果未知`, { status });
  if (status === 521 || status === 522 || status === 523) return make('gateway', 'not-sent', 'always', `网关无法连接上游（${status}）`, { status });
  if (status === 502 || status === 520) return make('gateway', 'unknown', 'idempotent', `上游网关错误（${status}），结果未知`, { status });
  if (status >= 500) return make('server', 'unknown', 'idempotent', `服务端错误（${status}）`, { status });
  if (status === 401 || status === 403) {
    if (/not enabled for this group|分组未开通/iu.test(text)) return make('auth', 'rejected', 'never', '当前分组未开通此能力', { status, fallback: true });
    return make('auth', 'rejected', 'never', `鉴权失败（${status}），请检查 API Key`, { status });
  }
  if (status === 402 || /insufficient[_ ](?:quota|balance)|余额不足|额度不足/iu.test(text)) return make('billing', 'rejected', 'never', '账户余额或额度不足', { status });
  if (/model[_ ]not[_ ]found|does not exist|not supported model|unknown model|no available channel for model|无可用渠道|模型不存在/iu.test(text)) {
    return make('model-not-found', 'rejected', 'never', `模型不可用（${status}）`, { status, fallback: true });
  }
  if (status === 404) return make('not-found', 'rejected', 'never', '接口地址不存在（404）', { status });
  if (/content[_ ]policy|safety|moderation|sensitive|违规|敏感/iu.test(text)) return make('content-policy', 'rejected', 'never', '内容未通过服务商审核', { status });
  return make('bad-request', 'rejected', 'never', `请求被拒绝（${status}）`, { status });
}

export function classifyProviderFailure(input: ProviderFailureInput): ProviderFailure {
  const retryAfterMs = parseRetryAfterMs(header(input.headers, 'retry-after'));
  const chain = causeChain(input.error);
  const text = [input.body ?? '', ...chain.map(item => item.message)].join(' ');
  const host = chain.map(item => typeof item.hostname === 'string' ? item.hostname : undefined).find(Boolean) ?? hostFromText(text);
  const withMeta = (failure: ProviderFailure): ProviderFailure => ({
    ...failure,
    ...(host ? { host } : {}),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  });
  if (chain.some(item => item.name === 'AbortError') || chain.some(item => item.code === 'NETWORK_ABORTED')) return withMeta(make('aborted', 'unknown', 'never', '已取消'));
  const status = input.status ?? chain.map(item => typeof item.status === 'number' ? item.status : undefined).find(Boolean);
  if (status && status >= 400) return withMeta(classifyHttpStatus(status, text));
  const code = chain.map(item => typeof item.code === 'string' ? item.code : undefined).find(Boolean)
    ?? text.match(/\b(UND_ERR_[A-Z_]+|E[A-Z]{4,}|NETWORK_TIMEOUT)\b/u)?.[1];
  if (code) {
    // G-5: the proxy refused/was unreachable or the CONNECT tunnel was rejected; the target never saw the request.
    if (code === 'NETWORK_PROXY_FAILED') {
      const proxyAuth = chain.some(item => (item as { proxyStatus?: unknown }).proxyStatus === 407);
      return withMeta(make('connect', 'not-sent', proxyAuth ? 'never' : 'always', proxyAuth ? '代理认证失败（407），请求未发出' : '代理连接失败，请求未发出', { code }));
    }
    if (code === 'NETWORK_PROXY_INVALID' || code === 'NETWORK_PROXY_UNSUPPORTED') return withMeta(make('local', 'not-sent', 'never', '代理地址配置无效，请求未发出', { code }));
    if (NOT_SENT_CODES.has(code)) return withMeta(make('connect', 'not-sent', 'always', `连接失败（${code}），请求未发出`, { code }));
    if (TLS_CERT_CODES.test(code)) return withMeta(make('connect', 'not-sent', 'never', `证书校验失败（${code}），请求未发出`, { code }));
    if (TLS_HANDSHAKE_CODES.test(code)) return withMeta(make('connect', 'not-sent', 'always', `TLS 握手失败（${code}），请求未发出`, { code }));
    if (DNS_CODES.has(code)) return withMeta(make('dns', 'not-sent', code === 'EAI_AGAIN' ? 'always' : 'never', `域名解析失败（${code}）`, { code }));
    if (LOST_CODES.has(code)) return withMeta(make('transport-lost', 'unknown', 'idempotent', `连接中断（${code}），结果未知`, { code }));
    if (RESPONSE_TIMEOUT_CODES.has(code)) return withMeta(make('response-timeout', 'unknown', 'idempotent', `等待响应超时（${code}），结果未知`, { code }));
  }
  const textStatus = statusFromText(text);
  if (textStatus) return withMeta(classifyHttpStatus(textStatus, text));
  if (/fetch failed|socket hang up|terminated|other side closed/iu.test(text)) return withMeta(make('transport-lost', 'unknown', 'idempotent', '连接中断，结果未知'));
  if (input.error && !chain.length) return withMeta(make('local', 'not-sent', 'never', '本地错误'));
  if (chain.length && !code) return withMeta(make('local', 'not-sent', 'never', '本地错误'));
  return withMeta(make('unknown', 'unknown', 'never', '未知错误', code ? { code } : {}));
}

/** Whether to resend automatically. Paid, non-idempotent calls never resend an `unknown` outcome. */
export function shouldRetryProviderFailure(failure: ProviderFailure, call: { idempotent: boolean }): boolean {
  if (failure.retry === 'always') return true;
  return failure.retry === 'idempotent' && call.idempotent;
}

export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  /** 0..1; 0 gives the deterministic exponential schedule. */
  jitter?: number;
  random?: () => number;
  retryAfterMs?: number;
}

/** Exponential backoff (attempt starts at 1) honouring Retry-After as a lower bound. */
export function providerBackoffMs(attempt: number, options: BackoffOptions = {}): number {
  const base = options.baseMs ?? 500;
  const max = options.maxMs ?? 30_000;
  const exponential = Math.min(max, base * 3 ** Math.max(0, attempt - 1));
  const jitter = Math.min(1, Math.max(0, options.jitter ?? 0));
  const jittered = jitter ? exponential * (1 - jitter + jitter * (options.random ?? Math.random)()) : exponential;
  return Math.round(Math.max(jittered, Math.min(options.retryAfterMs ?? 0, MAX_RETRY_AFTER_MS)));
}
