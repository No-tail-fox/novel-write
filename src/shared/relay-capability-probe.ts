/**
 * G-9: relay (中转站) capability probe.
 *
 * Answers, with three tiny user-triggered requests (a few output tokens each), what the cost and
 * reliability layers otherwise have to guess: does the relay pass `stream_options.include_usage`
 * (usage numbers for U-5), does it accept a reasoning/thinking parameter, does it report prompt-cache
 * usage, and is it fronted by Cloudflare (non-streamed calls cut at ~100 s with 524). The idle cut
 * itself is not measured: that would need a deliberately slow paid request.
 *
 * Pure apart from the injected fetch; never retries, never resends.
 */
import { fetchWithTimeout } from './http';
import { llmEndpoint, resolveLlmProtocol } from './llm-protocol';
import type { NetworkFetch } from './network-policy';
import type { LlmConfig } from './types';

export type RelayProbeStatus = 'supported' | 'unsupported' | 'unknown';

export interface RelayProbeCheck {
  id: 'stream-usage' | 'reasoning' | 'prompt-cache' | 'idle-cutoff';
  status: RelayProbeStatus;
  detail: string;
}

export interface RelayProbeResult {
  endpoint: string;
  model: string;
  protocol: 'openai' | 'anthropic';
  requests: number;
  checks: RelayProbeCheck[];
  summary: string;
}

const PROBE_TIMEOUT_MS = 30_000;
const PROBE_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;
const PROBE_PROMPT = 'Reply with the single word: ok';

interface ProbeResponse { status: number; text: string; headers: Headers }

async function send(fetchImpl: typeof fetch, url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<ProbeResponse | Error> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: controller.signal });
    const text = (await response.text()).slice(0, 200_000);
    return { status: response.status, text, headers: response.headers };
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function rejectedParameter(response: ProbeResponse, pattern: RegExp): boolean {
  return response.status >= 400 && response.status < 500 && pattern.test(response.text);
}

function failureDetail(response: ProbeResponse | Error): string {
  if (response instanceof Error) return `请求失败：${response.message.slice(0, 200)}`;
  return `HTTP ${response.status}：${response.text.replace(/\s+/gu, ' ').slice(0, 200)}`;
}

/** Parse SSE `data:` lines into JSON objects, ignoring `[DONE]` and junk. */
export function parseSseJson(text: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  for (const line of text.split(/\r?\n/u)) {
    const match = line.match(/^data:\s*(.*)$/u);
    if (!match || match[1] === '[DONE]') continue;
    try {
      const value = JSON.parse(match[1]) as unknown;
      if (value && typeof value === 'object') events.push(value as Record<string, unknown>);
    } catch { /* partial line */ }
  }
  return events;
}

function cloudflareFronted(headers: Headers | undefined): boolean {
  if (!headers) return false;
  return Boolean(headers.get('cf-ray')) || /cloudflare/iu.test(headers.get('server') ?? '');
}

export function idleCutoffCheck(headers: Headers | undefined): RelayProbeCheck {
  return cloudflareFronted(headers)
    ? { id: 'idle-cutoff', status: 'supported', detail: '检测到 Cloudflare 前置：非流式请求超过约 100 秒无响应会被 524 断开，结果未知且可能已计费。长任务请开启流式输出。' }
    : { id: 'idle-cutoff', status: 'unknown', detail: '未检测到 Cloudflare 响应头；空闲断开时长没有实测（需要一个故意很慢的付费请求）。' };
}

async function probeOpenAi(config: LlmConfig, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<RelayProbeResult> {
  const endpoint = llmEndpoint({ ...config, provider: 'custom', protocol: 'openai' });
  const model = config.model.trim();
  const auth = { Authorization: `Bearer ${config.apiKey}` };
  const base = { model, messages: [{ role: 'user', content: PROBE_PROMPT }], max_tokens: 16 };
  const checks: RelayProbeCheck[] = [];
  let lastHeaders: Headers | undefined;

  const streamed = await send(fetchImpl, endpoint, auth, { ...base, stream: true, stream_options: { include_usage: true } }, signal);
  if (!(streamed instanceof Error)) lastHeaders = streamed.headers;
  let cacheReported: boolean | undefined;
  if (streamed instanceof Error || streamed.status >= 500) {
    checks.push({ id: 'stream-usage', status: 'unknown', detail: failureDetail(streamed) });
  } else if (rejectedParameter(streamed, /stream_options|include_usage/iu)) {
    checks.push({ id: 'stream-usage', status: 'unsupported', detail: '中转站拒绝 stream_options，流式请求拿不到用量，成本面板只能估算。' });
  } else if (streamed.status >= 400) {
    checks.push({ id: 'stream-usage', status: 'unknown', detail: failureDetail(streamed) });
  } else {
    const usage = parseSseJson(streamed.text).map(event => event.usage).find(value => value && typeof value === 'object') as Record<string, unknown> | undefined;
    checks.push(usage
      ? { id: 'stream-usage', status: 'supported', detail: `流式回复带用量（prompt ${String(usage.prompt_tokens ?? '?')} / completion ${String(usage.completion_tokens ?? '?')} tokens）。` }
      : { id: 'stream-usage', status: 'unsupported', detail: '流式回复没有 usage 块（参数被静默忽略），成本面板只能估算。' });
    if (usage) cacheReported = typeof (usage.prompt_tokens_details as Record<string, unknown> | undefined)?.cached_tokens === 'number';
  }

  const reasoning = await send(fetchImpl, endpoint, auth, { ...base, reasoning_effort: 'low' }, signal);
  if (!(reasoning instanceof Error)) lastHeaders = reasoning.headers;
  if (reasoning instanceof Error || reasoning.status >= 500) checks.push({ id: 'reasoning', status: 'unknown', detail: failureDetail(reasoning) });
  else if (rejectedParameter(reasoning, /reasoning|unrecognized|unknown (?:parameter|field)|not support|extra/iu)) checks.push({ id: 'reasoning', status: 'unsupported', detail: '中转站或模型拒绝 reasoning_effort；不要在“附加请求 JSON”里填写它。' });
  else if (reasoning.status >= 400) checks.push({ id: 'reasoning', status: 'unknown', detail: failureDetail(reasoning) });
  else checks.push({ id: 'reasoning', status: 'supported', detail: '接受 reasoning_effort（是否真的生效取决于模型）。' });

  checks.push(cacheReported === undefined
    ? { id: 'prompt-cache', status: 'unknown', detail: '拿不到用量，无法判断是否回报提示缓存。' }
    : cacheReported
      ? { id: 'prompt-cache', status: 'supported', detail: '用量里有 cached_tokens 字段，提示缓存命中会被统计。' }
      : { id: 'prompt-cache', status: 'unknown', detail: '用量里没有 cached_tokens；短提示本来不触发缓存，不能据此断定不支持。' });
  checks.push(idleCutoffCheck(lastHeaders));
  return finish(endpoint, model, 'openai', 2, checks);
}

async function probeAnthropic(config: LlmConfig, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<RelayProbeResult> {
  const endpoint = llmEndpoint({ ...config, provider: 'anthropic', protocol: 'anthropic' });
  const model = config.model.trim();
  const auth = { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' };
  const base = { model, max_tokens: 16, messages: [{ role: 'user', content: PROBE_PROMPT }] };
  const checks: RelayProbeCheck[] = [];
  let lastHeaders: Headers | undefined;

  const cached = await send(fetchImpl, endpoint, auth, { ...base, stream: true, system: [{ type: 'text', text: 'You are a probe.', cache_control: { type: 'ephemeral' } }] }, signal);
  if (!(cached instanceof Error)) lastHeaders = cached.headers;
  if (cached instanceof Error || cached.status >= 400) {
    checks.push({ id: 'stream-usage', status: 'unknown', detail: failureDetail(cached) });
    checks.push({ id: 'prompt-cache', status: rejectedParameter(cached as ProbeResponse, /cache_control/iu) ? 'unsupported' : 'unknown', detail: failureDetail(cached) });
  } else {
    const events = parseSseJson(cached.text);
    const usage = events.map(event => (event.message as Record<string, unknown> | undefined)?.usage ?? event.usage).filter(value => value && typeof value === 'object') as Array<Record<string, unknown>>;
    checks.push(usage.length
      ? { id: 'stream-usage', status: 'supported', detail: '流式事件带用量（message_start / message_delta）。' }
      : { id: 'stream-usage', status: 'unsupported', detail: '流式事件没有用量，成本面板只能估算。' });
    const cacheFields = usage.some(item => 'cache_creation_input_tokens' in item || 'cache_read_input_tokens' in item);
    checks.push(cacheFields
      ? { id: 'prompt-cache', status: 'supported', detail: '接受 cache_control 并回报缓存用量字段。' }
      : { id: 'prompt-cache', status: 'unknown', detail: '接受 cache_control，但没有回报缓存字段（可能被中转站丢弃）。' });
  }

  const thinking = await send(fetchImpl, endpoint, auth, { ...base, max_tokens: 1100, thinking: { type: 'enabled', budget_tokens: 1024 } }, signal);
  if (!(thinking instanceof Error)) lastHeaders = thinking.headers;
  if (thinking instanceof Error || thinking.status >= 500) checks.push({ id: 'reasoning', status: 'unknown', detail: failureDetail(thinking) });
  else if (rejectedParameter(thinking, /thinking|budget_tokens|unknown|not support|extra/iu)) checks.push({ id: 'reasoning', status: 'unsupported', detail: '中转站或模型拒绝 thinking 参数。' });
  else if (thinking.status >= 400) checks.push({ id: 'reasoning', status: 'unknown', detail: failureDetail(thinking) });
  else checks.push({ id: 'reasoning', status: 'supported', detail: '接受 thinking 参数（预算 1024 tokens）。' });
  checks.push(idleCutoffCheck(lastHeaders));
  return finish(endpoint, model, 'anthropic', 2, checks);
}

function finish(endpoint: string, model: string, protocol: 'openai' | 'anthropic', requests: number, checks: RelayProbeCheck[]): RelayProbeResult {
  const label: Record<RelayProbeCheck['id'], string> = { 'stream-usage': '流式用量', reasoning: '推理参数', 'prompt-cache': '提示缓存', 'idle-cutoff': '约 100 秒断流' };
  const mark: Record<RelayProbeStatus, string> = { supported: '✓', unsupported: '✗', unknown: '?' };
  const summary = `${checks.map(check => `${label[check.id]} ${mark[check.status]}`).join('，')}（共 ${requests} 个极小请求）`;
  return { endpoint, model, protocol, requests, checks, summary };
}

/** Run the probe for an LLM profile. Responses-protocol profiles are probed as OpenAI-compatible chat. */
export async function probeRelayCapabilities(config: LlmConfig, fetchImpl?: typeof fetch, signal?: AbortSignal): Promise<RelayProbeResult> {
  if (!config.apiKey.trim()) throw new Error('RELAY_PROBE_KEY_MISSING: 请先填写接口密钥。');
  if (!config.model.trim()) throw new Error('RELAY_PROBE_MODEL_MISSING: 请先选择模型。');
  // G-5: same network policy + profile proxy as the LLM client (empty proxyUrl = direct). Never redirects,
  // so the key is not forwarded elsewhere; proxy failures surface with the credential-free proxy address.
  const transport = ((url: string | URL | Request, init?: RequestInit) => fetchWithTimeout(String(url), {
    ...init,
    timeoutMs: PROBE_TIMEOUT_MS,
    timeoutLabel: '中转站能力探测',
    maxBytes: PROBE_RESPONSE_MAX_BYTES,
    maxRedirects: 0,
    proxyUrl: config.proxyUrl,
    fetchImpl: fetchImpl as NetworkFetch | undefined,
  })) as typeof fetch;
  return resolveLlmProtocol(config) === 'anthropic' ? probeAnthropic(config, transport, signal) : probeOpenAi(config, transport, signal);
}

/** One-paragraph Chinese report for the settings page (renderer imports it from the format module). */
export { formatRelayProbeResult } from './relay-capability-probe-format';
