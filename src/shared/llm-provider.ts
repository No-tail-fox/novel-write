import type { LlmConfig, LlmModelTestResult, ProviderModel, ProviderModelListRequest, ProviderModelListResult } from './types';
import { fetchWithTimeout } from './http';
import { readJsonBounded, readTextBounded, type NetworkFetch } from './network-policy';
import { llmEndpoint, resolveLlmProtocol, type LlmProtocol } from './llm-protocol';

export type LlmRole = 'system' | 'user' | 'assistant';

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface BaseLlmJsonRequest {
  step: number;
  name: string;
  messages: LlmMessage[];
  signal?: AbortSignal;
  jsonRoot?: 'object' | 'array';
  jsonMode?: 'required' | 'none';
}

export interface OpenAiCompatibleJsonRequest extends BaseLlmJsonRequest {
  openai?: Record<string, never>;
}

export interface AnthropicMessagesJsonRequest extends BaseLlmJsonRequest {
  anthropic?: {
    toolInputSchema?: Record<string, unknown>;
  };
}

export type LlmJsonRequest = OpenAiCompatibleJsonRequest & AnthropicMessagesJsonRequest;

export interface LlmJsonResult<T = unknown> {
  json: T;
  raw: string;
  requestId: string | null;
}

export interface BaseLlmTextRequest {
  step: number;
  name: string;
  messages: LlmMessage[];
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface OpenAiCompatibleTextRequest extends BaseLlmTextRequest {
  openai?: Record<string, never>;
}

export interface AnthropicMessagesTextRequest extends BaseLlmTextRequest {
  anthropic?: Record<string, never>;
}

export type LlmTextRequest = OpenAiCompatibleTextRequest & AnthropicMessagesTextRequest;

export interface LlmTextResult {
  text: string;
  raw: string;
  requestId: string | null;
}

export type JsonLlm = <T = unknown>(request: LlmJsonRequest) => Promise<LlmJsonResult<T>>;
export type OpenAiCompatibleJsonLlm = <T = unknown>(request: OpenAiCompatibleJsonRequest) => Promise<LlmJsonResult<T>>;
export type AnthropicMessagesJsonLlm = <T = unknown>(request: AnthropicMessagesJsonRequest) => Promise<LlmJsonResult<T>>;
export type TextLlm = (request: LlmTextRequest) => Promise<LlmTextResult>;
export type OpenAiCompatibleTextLlm = (request: OpenAiCompatibleTextRequest) => Promise<LlmTextResult>;
export type AnthropicMessagesTextLlm = (request: AnthropicMessagesTextRequest) => Promise<LlmTextResult>;

export type ConfiguredJsonLlm =
  | { protocol: 'openai'; run: OpenAiCompatibleJsonLlm }
  | { protocol: 'responses'; run: OpenAiCompatibleJsonLlm }
  | { protocol: 'anthropic'; run: AnthropicMessagesJsonLlm };

export type ConfiguredTextLlm =
  | { protocol: 'openai'; run: OpenAiCompatibleTextLlm }
  | { protocol: 'responses'; run: OpenAiCompatibleTextLlm }
  | { protocol: 'anthropic'; run: AnthropicMessagesTextLlm };

interface AnthropicContentPart {
  type?: string;
  text?: string | null;
  name?: string | null;
  input?: unknown;
}

const TRANSIENT_LLM_STATUS_CODES = new Set([429, 500, 502, 503, 504, 529]);
const LLM_RETRY_DELAYS_MS = [500, 1500];
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_ANTHROPIC_MAX_TOKENS = 4096;
const ANTHROPIC_JSON_TOOL_NAME = 'return_json';
// Thinking models and tool envelopes need more than the visible JSON's token count.
const MODEL_TEST_MAX_TOKENS = 1024;
const MODEL_TEST_TIMEOUT_MS = 60_000;

export class LlmJsonParseError extends Error {
  constructor(
    message: string,
    public readonly rawResponse: string,
  ) {
    super(message);
    this.name = 'LlmJsonParseError';
  }
}

const LLM_RESPONSE_MAX_BYTES = 8 * 1024 * 1024;

export function createConfiguredJsonLlm(config: LlmConfig): ConfiguredJsonLlm {
  if (resolveLlmProtocol(config) === 'responses') return { protocol: 'responses', run: createResponsesJsonLlm(config) };
  return isAnthropicLlmConfig(config)
    ? { protocol: 'anthropic', run: createAnthropicMessagesJsonLlm(config) }
    : { protocol: 'openai', run: createOpenAiCompatibleJsonLlm(config) };
}

export function createConfiguredTextLlm(config: LlmConfig): ConfiguredTextLlm {
  if (resolveLlmProtocol(config) === 'responses') return { protocol: 'responses', run: createResponsesTextLlm(config) };
  return isAnthropicLlmConfig(config)
    ? { protocol: 'anthropic', run: createAnthropicMessagesTextLlm(config) }
    : { protocol: 'openai', run: createOpenAiCompatibleTextLlm(config) };
}

export function createOpenAiCompatibleJsonLlm(config: LlmConfig): OpenAiCompatibleJsonLlm {
  return async <T = unknown>(request: OpenAiCompatibleJsonRequest): Promise<LlmJsonResult<T>> => {
    if (!config.apiKey) {
      throw new Error('LLM API key is missing; cannot run real task content generation.');
    }
    const baseUrl = normalizeOpenAiBaseUrl(config.baseUrl || 'https://api.openai.com');
    const endpoint = `${baseUrl}/chat/completions`;
    const response = await fetchLlmJsonWithRetries(endpoint, config, request);
    if (!response.ok) {
      throw new Error(`LLM API error (${response.status}) at step ${request.step} ${request.name} via ${endpoint}: ${await readTextBounded(response, LLM_RESPONSE_MAX_BYTES)}`);
    }
    const body = await readJsonBounded<{
      id?: string;
      choices?: Array<{ message?: { content?: string | null }; text?: string | null }>;
    }>(response, LLM_RESPONSE_MAX_BYTES);
    const raw = body.choices?.[0]?.message?.content ?? body.choices?.[0]?.text ?? '';
    if (!raw.trim()) {
      throw new LlmJsonParseError(`LLM step ${request.step} ${request.name} returned empty content.`, raw);
    }
    try {
      return {
        json: parseLlmJsonContent<T>(raw),
        raw,
        requestId: body.id ?? null,
      };
    } catch {
      throw new LlmJsonParseError(`LLM step ${request.step} ${request.name} did not return valid JSON.${formatRawPreview(raw)}`, raw);
    }
  };
}

export function createAnthropicMessagesJsonLlm(config: LlmConfig): AnthropicMessagesJsonLlm {
  return async <T = unknown>(request: AnthropicMessagesJsonRequest): Promise<LlmJsonResult<T>> => {
    if (!config.apiKey) {
      throw new Error('LLM API key is missing; cannot run real task content generation.');
    }
    const baseUrl = normalizeAnthropicBaseUrl(config.baseUrl || 'https://api.anthropic.com');
    const endpoint = `${baseUrl}/messages`;
    const response = await fetchAnthropicJsonWithRetries(endpoint, config, request);
    if (!response.ok) {
      throw new Error(`LLM API error (${response.status}) at step ${request.step} ${request.name} via ${endpoint}: ${await readTextBounded(response, LLM_RESPONSE_MAX_BYTES)}`);
    }
    const body = await readJsonBounded<{
      id?: string;
      content?: AnthropicContentPart[];
    }>(response, LLM_RESPONSE_MAX_BYTES);
    const toolResult = extractAnthropicToolUseResult<T>(body);
    if (toolResult) {
      return {
        ...toolResult,
        requestId: body.id ?? null,
      };
    }
    const raw = extractAnthropicTextContent(body);
    if (!raw.trim()) {
      throw new LlmJsonParseError(`LLM step ${request.step} ${request.name} returned empty content.`, raw);
    }
    try {
      return {
        json: parseLlmJsonContent<T>(raw),
        raw,
        requestId: body.id ?? null,
      };
    } catch {
      throw new LlmJsonParseError(`LLM step ${request.step} ${request.name} did not return valid JSON.${formatRawPreview(raw)}`, raw);
    }
  };
}

export function createOpenAiCompatibleTextLlm(config: LlmConfig): OpenAiCompatibleTextLlm {
  return async (request: OpenAiCompatibleTextRequest): Promise<LlmTextResult> => {
    if (!config.apiKey) {
      throw new Error('LLM API key is missing; cannot run real task content generation.');
    }
    const baseUrl = normalizeOpenAiBaseUrl(config.baseUrl || 'https://api.openai.com');
    const endpoint = `${baseUrl}/chat/completions`;
    const response = await fetchLlmTextWithRetries(endpoint, config, request);
    if (!response.ok) {
      throw new Error(`LLM API error (${response.status}) at step ${request.step} ${request.name} via ${endpoint}: ${await readTextBounded(response, LLM_RESPONSE_MAX_BYTES)}`);
    }
    const body = await readJsonBounded<{
      id?: string;
      choices?: Array<{ message?: { content?: string | null }; text?: string | null }>;
    }>(response, LLM_RESPONSE_MAX_BYTES);
    const raw = body.choices?.[0]?.message?.content ?? body.choices?.[0]?.text ?? '';
    if (!raw.trim()) {
      throw new Error(`LLM step ${request.step} ${request.name} returned empty content.`);
    }
    return {
      text: raw,
      raw,
      requestId: body.id ?? null,
    };
  };
}

export function createAnthropicMessagesTextLlm(config: LlmConfig): AnthropicMessagesTextLlm {
  return async (request: AnthropicMessagesTextRequest): Promise<LlmTextResult> => {
    if (!config.apiKey) {
      throw new Error('LLM API key is missing; cannot run real task content generation.');
    }
    const baseUrl = normalizeAnthropicBaseUrl(config.baseUrl || 'https://api.anthropic.com');
    const endpoint = `${baseUrl}/messages`;
    const response = await fetchAnthropicTextWithRetries(endpoint, config, request);
    if (!response.ok) {
      throw new Error(`LLM API error (${response.status}) at step ${request.step} ${request.name} via ${endpoint}: ${await readTextBounded(response, LLM_RESPONSE_MAX_BYTES)}`);
    }
    const body = await readJsonBounded<{
      id?: string;
      content?: AnthropicContentPart[];
    }>(response, LLM_RESPONSE_MAX_BYTES);
    const raw = extractAnthropicTextContent(body);
    if (!raw.trim()) {
      throw new Error(`LLM step ${request.step} ${request.name} returned empty content.`);
    }
    return {
      text: raw,
      raw,
      requestId: body.id ?? null,
    };
  };
}

interface ResponsesBody {
  id?: string;
  status?: string;
  error?: { message?: string } | null;
  incomplete_details?: { reason?: string } | null;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; refusal?: string }> }>;
}

function responsesText(body: ResponsesBody): string {
  return (body.output ?? []).filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
    .map((part) => part.text).join('');
}

function responsesProblem(body: ResponsesBody): Pick<LlmModelTestResult, 'status' | 'detail'> | null {
  if (body.error || body.status === 'failed') {
    return { status: 'fail', detail: `Responses API 请求失败：${body.error?.message || body.status}` };
  }
  if (body.status === 'incomplete' || body.incomplete_details) {
    const reason = body.incomplete_details?.reason || 'incomplete';
    return { status: 'warn', detail: reason === 'max_output_tokens'
      ? `Responses API 回复达到输出上限而被截断（${reason}），请检查模型的思考预算或服务端输出限制。`
      : `Responses API 回复未完成（${reason}）。` };
  }
  if (body.status && body.status !== 'completed') {
    return { status: 'fail', detail: `Responses API 未返回最终结果（${body.status}）。` };
  }
  const refusal = (body.output ?? []).flatMap((item) => item.content ?? []).find((part) => part.type === 'refusal');
  return refusal ? { status: 'warn', detail: `Responses API 拒绝回答：${refusal.refusal || 'refusal'}` } : null;
}

async function readResponsesResult(response: Response, request: BaseLlmJsonRequest | BaseLlmTextRequest, endpoint: string): Promise<LlmTextResult> {
  if (!response.ok) {
    throw new Error(`LLM API error (${response.status}) at step ${request.step} ${request.name} via ${endpoint}: ${await readTextBounded(response, LLM_RESPONSE_MAX_BYTES)}`);
  }
  const body = await readJsonBounded<ResponsesBody>(response, LLM_RESPONSE_MAX_BYTES);
  const raw = extractResponsesTextContent(body);
  return { text: raw, raw, requestId: body.id ?? null };
}

export function extractResponsesTextContent(body: ResponsesBody): string {
  const problem = responsesProblem(body);
  if (problem) throw new Error(problem.detail);
  const raw = responsesText(body);
  if (!raw.trim()) throw new LlmJsonParseError('Responses API returned empty content.', raw);
  return raw;
}

export function createResponsesJsonLlm(config: LlmConfig): OpenAiCompatibleJsonLlm {
  return async <T = unknown>(request: OpenAiCompatibleJsonRequest): Promise<LlmJsonResult<T>> => {
    if (!config.apiKey) throw new Error('LLM API key is missing; cannot run real task content generation.');
    const endpoint = llmEndpoint({ ...config, provider: 'custom', protocol: 'responses' });
    const response = await fetchLlmJsonWithRetries(endpoint, config, request, buildResponsesRequestBody(config, request, request.jsonMode !== 'none' && request.jsonRoot !== 'array'));
    const result = await readResponsesResult(response, request, endpoint);
    try {
      return { json: parseLlmJsonContent<T>(result.raw), raw: result.raw, requestId: result.requestId };
    } catch {
      throw new LlmJsonParseError(`LLM step ${request.step} ${request.name} did not return valid JSON.${formatRawPreview(result.raw)}`, result.raw);
    }
  };
}

export function createResponsesTextLlm(config: LlmConfig): OpenAiCompatibleTextLlm {
  return async (request: OpenAiCompatibleTextRequest): Promise<LlmTextResult> => {
    if (!config.apiKey) throw new Error('LLM API key is missing; cannot run real task content generation.');
    const endpoint = llmEndpoint({ ...config, provider: 'custom', protocol: 'responses' });
    const response = await fetchLlmTextWithRetries(endpoint, config, request, buildResponsesRequestBody(config, request, false));
    return readResponsesResult(response, request, endpoint);
  };
}

async function fetchLlmJsonWithRetries(endpoint: string, config: LlmConfig, request: OpenAiCompatibleJsonRequest, body = buildRequestBody(config, request)): Promise<Response> {
  const maxAttempts = LLM_RETRY_DELAYS_MS.length + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      timeoutMs: config.timeoutMs ?? 120_000,
      timeoutLabel: `LLM step ${request.step} ${request.name}`,
      maxBytes: LLM_RESPONSE_MAX_BYTES,
      signal: request.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!TRANSIENT_LLM_STATUS_CODES.has(response.status) || attempt === maxAttempts) {
      return response;
    }
    await sleepBeforeRetry(LLM_RETRY_DELAYS_MS[attempt - 1], request.signal, `LLM step ${request.step} ${request.name}`);
  }
  throw new Error('Unexpected LLM retry state.');
}

async function fetchAnthropicJsonWithRetries(endpoint: string, config: LlmConfig, request: AnthropicMessagesJsonRequest): Promise<Response> {
  const maxAttempts = LLM_RETRY_DELAYS_MS.length + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      timeoutMs: config.timeoutMs ?? 120_000,
      timeoutLabel: `LLM step ${request.step} ${request.name}`,
      maxBytes: LLM_RESPONSE_MAX_BYTES,
      signal: request.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(buildAnthropicRequestBody(config, request)),
    });
    if (!TRANSIENT_LLM_STATUS_CODES.has(response.status) || attempt === maxAttempts) {
      return response;
    }
    await sleepBeforeRetry(LLM_RETRY_DELAYS_MS[attempt - 1], request.signal, `LLM step ${request.step} ${request.name}`);
  }
  throw new Error('Unexpected LLM retry state.');
}

async function fetchLlmTextWithRetries(endpoint: string, config: LlmConfig, request: OpenAiCompatibleTextRequest, body = buildTextRequestBody(config, request)): Promise<Response> {
  const maxAttempts = textRequestMaxAttempts(request);
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        timeoutMs: request.timeoutMs ?? config.timeoutMs ?? 120_000,
        timeoutLabel: `LLM step ${request.step} ${request.name}`,
        maxBytes: LLM_RESPONSE_MAX_BYTES,
        signal: request.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!TRANSIENT_LLM_STATUS_CODES.has(response.status) || attempt === maxAttempts) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || request.signal?.aborted) {
        throw error;
      }
    }
    await sleepBeforeRetry(retryDelayForAttempt(attempt), request.signal, `LLM step ${request.step} ${request.name}`);
  }
  if (lastError) throw lastError instanceof Error ? lastError : new Error(String(lastError));
  throw new Error('Unexpected LLM retry state.');
}

async function fetchAnthropicTextWithRetries(endpoint: string, config: LlmConfig, request: AnthropicMessagesTextRequest): Promise<Response> {
  const maxAttempts = textRequestMaxAttempts(request);
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        timeoutMs: request.timeoutMs ?? config.timeoutMs ?? 120_000,
        timeoutLabel: `LLM step ${request.step} ${request.name}`,
        maxBytes: LLM_RESPONSE_MAX_BYTES,
        signal: request.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(buildAnthropicTextRequestBody(config, request)),
      });
      if (!TRANSIENT_LLM_STATUS_CODES.has(response.status) || attempt === maxAttempts) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || request.signal?.aborted) {
        throw error;
      }
    }
    await sleepBeforeRetry(retryDelayForAttempt(attempt), request.signal, `LLM step ${request.step} ${request.name}`);
  }
  if (lastError) throw lastError instanceof Error ? lastError : new Error(String(lastError));
  throw new Error('Unexpected LLM retry state.');
}

function textRequestMaxAttempts(request: Pick<BaseLlmTextRequest, 'maxRetries'>): number {
  const retries = Number(request.maxRetries ?? LLM_RETRY_DELAYS_MS.length);
  return Math.max(1, Math.floor(Number.isFinite(retries) ? retries : LLM_RETRY_DELAYS_MS.length) + 1);
}

function retryDelayForAttempt(attempt: number): number {
  return LLM_RETRY_DELAYS_MS[Math.min(Math.max(0, attempt - 1), LLM_RETRY_DELAYS_MS.length - 1)] ?? 1500;
}

function sleepBeforeRetry(ms: number, signal: AbortSignal | undefined, label: string): Promise<void> {
  if (signal?.aborted) throw abortSignalError(signal, label);
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timeout);
      cleanup();
      reject(abortSignalError(signal, label));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function abortSignalError(signal: AbortSignal | undefined, label: string): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  if (typeof reason === 'string') return new Error(reason);
  return new Error(`${label} aborted.`);
}

function buildRequestBody(config: LlmConfig, request: OpenAiCompatibleJsonRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    ...parseRequestParamsJson(config.requestParamsJson),
    model: config.model,
    messages: request.messages,
  };
  if (request.jsonRoot === 'array' || request.jsonMode === 'none') {
    delete body.response_format;
    delete body.tools;
    delete body.tool_choice;
  } else {
    body.response_format = { type: 'json_object' };
  }
  return body;
}

function buildTextRequestBody(config: LlmConfig, request: OpenAiCompatibleTextRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    ...parseRequestParamsJson(config.requestParamsJson),
    model: config.model,
    messages: request.messages,
  };
  delete body.response_format;
  delete body.tools;
  delete body.tool_choice;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
  return body;
}

export function buildResponsesRequestBody(config: LlmConfig, request: BaseLlmTextRequest, json: boolean): Record<string, unknown> {
  const extra = parseRequestParamsJson(config.requestParamsJson);
  const body: Record<string, unknown> = {
    ...extra,
    model: config.model,
    input: request.messages,
    text: { ...(isRecord(extra.text) ? extra.text : {}), format: { type: json ? 'json_object' : 'text' } },
    store: false,
    stream: false,
    background: false,
  };
  const maxTokens = request.maxTokens ?? extra.max_output_tokens ?? extra.max_completion_tokens ?? extra.max_tokens;
  if (maxTokens !== undefined) body.max_output_tokens = maxTokens;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (extra.reasoning_effort !== undefined) {
    body.reasoning = { effort: extra.reasoning_effort, ...(isRecord(extra.reasoning) ? extra.reasoning : {}) };
  }
  // These tasks consume one final answer, with no tool loop or server-side conversation.
  for (const key of ['messages', 'response_format', 'max_tokens', 'max_completion_tokens', 'reasoning_effort', 'stream_options', 'tools', 'tool_choice', 'parallel_tool_calls', 'previous_response_id', 'conversation']) {
    delete body[key];
  }
  return body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function buildAnthropicRequestBody(config: LlmConfig, request: AnthropicMessagesJsonRequest): Record<string, unknown> {
  const extra = parseRequestParamsJson(config.requestParamsJson);
  const system = request.messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join('\n\n');
  const anthropicMessages = request.messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
  const body: Record<string, unknown> = {
    ...extra,
    model: config.model,
    max_tokens: normalizeAnthropicMaxTokens(extra.max_tokens, DEFAULT_ANTHROPIC_MAX_TOKENS),
    messages: anthropicMessages,
  };
  if (request.jsonRoot === 'array' || request.jsonMode === 'none') {
    delete body.response_format;
    delete body.tools;
    delete body.tool_choice;
  } else {
    body.tools = [buildAnthropicJsonTool(request.anthropic?.toolInputSchema)];
    body.tool_choice = { type: 'tool', name: ANTHROPIC_JSON_TOOL_NAME };
  }
  if (system) body.system = system;
  return body;
}

function buildAnthropicTextRequestBody(config: LlmConfig, request: AnthropicMessagesTextRequest): Record<string, unknown> {
  const extra = parseRequestParamsJson(config.requestParamsJson);
  const system = request.messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join('\n\n');
  const anthropicMessages = request.messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
  const body: Record<string, unknown> = {
    ...extra,
    model: config.model,
    max_tokens: request.maxTokens ?? normalizeAnthropicMaxTokens(extra.max_tokens, DEFAULT_ANTHROPIC_MAX_TOKENS),
    messages: anthropicMessages,
  };
  delete body.response_format;
  delete body.tools;
  delete body.tool_choice;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (system) body.system = system;
  return body;
}

function buildAnthropicJsonTool(toolInputSchema?: Record<string, unknown>): Record<string, unknown> {
  const tool: Record<string, unknown> = {
    name: ANTHROPIC_JSON_TOOL_NAME,
    description: 'Return the final answer as a JSON object.',
    input_schema: toolInputSchema ?? { type: 'object', properties: {}, additionalProperties: true },
  };
  if (toolInputSchema) tool.strict = true;
  return tool;
}

function normalizeAnthropicMaxTokens(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function parseRequestParamsJson(value: string | undefined): Record<string, unknown> {
  const text = String(value ?? '').trim();
  if (!text || text === '{}') return {};
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('LLM requestParamsJson must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

function buildModelTestBody(config: LlmConfig, protocol: LlmProtocol): Record<string, unknown> {
  const request: LlmJsonRequest = {
    step: 0,
    name: 'model-test',
    messages: [
      { role: 'system', content: 'Return strict JSON only.' },
      { role: 'user', content: 'Return {"ok":true} to confirm this model is usable.' },
    ],
  };
  const body = protocol === 'anthropic' ? buildAnthropicRequestBody(config, request)
    : protocol === 'responses' ? buildResponsesRequestBody(config, request, true) : buildRequestBody(config, request);
  const tokenField = protocol === 'responses' ? 'max_output_tokens'
    : protocol === 'openai' && 'max_completion_tokens' in body ? 'max_completion_tokens' : 'max_tokens';
  delete body.max_tokens;
  delete body.max_completion_tokens;
  delete body.max_output_tokens;
  delete body.stream_options;
  return { ...body, model: config.model.trim(), stream: false, [tokenField]: MODEL_TEST_MAX_TOKENS };
}

function evaluateModelTestResponse(model: string, raw: string, latencyMs: number, stopReason?: string | null): Pick<LlmModelTestResult, 'status' | 'detail'> {
  if (stopReason === 'length' || stopReason === 'max_tokens') {
    return { status: 'warn', detail: `模型 ${model} 已连接，但测试回复达到输出上限而被截断（${stopReason}），暂不能确认 JSON 能力。请检查模型的思考预算或服务端输出限制。` };
  }
  if (!raw.trim()) {
    return { status: 'warn', detail: `模型 ${model} 已连接，但测试回复为空${stopReason ? `（${stopReason}）` : ''}，暂不能确认 JSON 能力。` };
  }
  try {
    const json = parseLlmJsonContent<unknown>(raw);
    if (!json || typeof json !== 'object' || Array.isArray(json) || !('ok' in json) || json.ok !== true) {
      return { status: 'warn', detail: `模型 ${model} 已返回 JSON，但未返回预期的 {"ok":true}，请检查接口响应。` };
    }
    return { status: 'pass', detail: `模型 ${model} 连接和 JSON 测试通过，耗时 ${latencyMs} ms。` };
  } catch {
    return { status: 'warn', detail: `模型 ${model} 已连接，但测试回复不是完整有效的 JSON${stopReason ? `（${stopReason}）` : ''}。响应片段：${raw.slice(0, 160)}` };
  }
}

export async function testOpenAiCompatibleLlm(config: LlmConfig, fetchImpl: typeof fetch = fetch): Promise<LlmModelTestResult> {
  return testOpenAiProtocolLlm(config, 'openai', fetchImpl);
}

export async function testResponsesLlm(config: LlmConfig, fetchImpl: typeof fetch = fetch): Promise<LlmModelTestResult> {
  return testOpenAiProtocolLlm(config, 'responses', fetchImpl);
}

async function testOpenAiProtocolLlm(config: LlmConfig, protocol: 'openai' | 'responses', fetchImpl: typeof fetch): Promise<LlmModelTestResult> {
  const startedAt = Date.now();
  const model = config.model.trim();
  const endpoint = llmEndpoint({ ...config, provider: 'custom', protocol });
  const baseResult = {
    latencyMs: 0,
    model,
    endpoint,
    requestId: null,
  };

  if (!config.apiKey.trim()) {
    return { ...baseResult, status: 'fail', detail: 'API key is missing; fill it before testing the model.' };
  }
  if (!model) {
    return { ...baseResult, status: 'fail', detail: 'Model name is missing; choose a model before testing.' };
  }

  try {
    const response = await fetchWithInjectedTimeout(
      fetchImpl,
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(buildModelTestBody(config, protocol)),
      },
      Math.min(config.timeoutMs ?? MODEL_TEST_TIMEOUT_MS, MODEL_TEST_TIMEOUT_MS),
    );
    const latencyMs = Date.now() - startedAt;
    const bodyText = await readTextBounded(response, LLM_RESPONSE_MAX_BYTES);
    if (!response.ok) {
      return {
        ...baseResult,
        latencyMs,
        status: 'fail',
        detail: `Model test failed with HTTP ${response.status}: ${bodyText.slice(0, 300)}`,
      };
    }

    if (protocol === 'responses') {
      const body = JSON.parse(bodyText) as ResponsesBody;
      return {
        ...baseResult,
        latencyMs,
        requestId: body.id ?? null,
        ...(responsesProblem(body) ?? evaluateModelTestResponse(model, responsesText(body), latencyMs)),
      };
    }
    const body = JSON.parse(bodyText) as {
      id?: string;
      choices?: Array<{ message?: { content?: string | null }; text?: string | null; finish_reason?: string | null }>;
    };
    const raw = body.choices?.[0]?.message?.content ?? body.choices?.[0]?.text ?? '';
    return {
      ...baseResult,
      latencyMs,
      requestId: body.id ?? null,
      ...evaluateModelTestResponse(model, raw, latencyMs, body.choices?.[0]?.finish_reason),
    };
  } catch (error) {
    return {
      ...baseResult,
      latencyMs: Date.now() - startedAt,
      status: 'fail',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function testConfiguredLlm(config: LlmConfig, fetchImpl: typeof fetch = fetch): Promise<LlmModelTestResult> {
  if (resolveLlmProtocol(config) === 'responses') return testResponsesLlm(config, fetchImpl);
  return isAnthropicLlmConfig(config) ? testAnthropicMessagesLlm(config, fetchImpl) : testOpenAiCompatibleLlm(config, fetchImpl);
}

export async function testAnthropicMessagesLlm(config: LlmConfig, fetchImpl: typeof fetch = fetch): Promise<LlmModelTestResult> {
  const startedAt = Date.now();
  const model = config.model.trim();
  const baseUrl = normalizeAnthropicBaseUrl(config.baseUrl || 'https://api.anthropic.com');
  const endpoint = `${baseUrl}/messages`;
  const baseResult = {
    latencyMs: 0,
    model,
    endpoint,
    requestId: null,
  };

  if (!config.apiKey.trim()) {
    return { ...baseResult, status: 'fail', detail: 'API key is missing; fill it before testing the model.' };
  }
  if (!model) {
    return { ...baseResult, status: 'fail', detail: 'Model name is missing; choose a model before testing.' };
  }

  try {
    const response = await fetchWithInjectedTimeout(
      fetchImpl,
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(buildModelTestBody(config, 'anthropic')),
      },
      Math.min(config.timeoutMs ?? MODEL_TEST_TIMEOUT_MS, MODEL_TEST_TIMEOUT_MS),
    );
    const latencyMs = Date.now() - startedAt;
    const bodyText = await readTextBounded(response, LLM_RESPONSE_MAX_BYTES);
    if (!response.ok) {
      return {
        ...baseResult,
        latencyMs,
        status: 'fail',
        detail: `Model test failed with HTTP ${response.status}: ${bodyText.slice(0, 300)}`,
      };
    }

    const body = JSON.parse(bodyText) as {
      id?: string;
      content?: AnthropicContentPart[];
      stop_reason?: string | null;
    };
    const toolUse = body.content?.find((part) => part.type === 'tool_use' && part.name === ANTHROPIC_JSON_TOOL_NAME && part.input !== undefined);
    const raw = toolUse
      ? typeof toolUse.input === 'string' ? toolUse.input : JSON.stringify(toolUse.input) ?? ''
      : extractAnthropicTextContent(body);
    return {
      ...baseResult,
      latencyMs,
      requestId: body.id ?? null,
      ...evaluateModelTestResponse(model, raw, latencyMs, body.stop_reason),
    };
  } catch (error) {
    return {
      ...baseResult,
      latencyMs: Date.now() - startedAt,
      status: 'fail',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function listOpenAiCompatibleModels(
  request: ProviderModelListRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderModelListResult> {
  const startedAt = Date.now();
  const endpoint = `${normalizeOpenAiBaseUrl(request.baseUrl || 'https://api.openai.com')}/models`;
  const baseResult = {
    latencyMs: 0,
    endpoint,
    models: [] as ProviderModel[],
  };

  if (!request.apiKey.trim()) {
    return { ...baseResult, status: 'fail', detail: 'API key is missing; fill it before fetching models.' };
  }

  try {
    const response = await fetchWithInjectedTimeout(
      fetchImpl,
      endpoint,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${request.apiKey}`,
        },
      },
      15000,
    );
    const latencyMs = Date.now() - startedAt;
    const bodyText = await readTextBounded(response, LLM_RESPONSE_MAX_BYTES);
    if (!response.ok) {
      return {
        ...baseResult,
        latencyMs,
        status: 'fail',
        detail: `Model list failed with HTTP ${response.status}: ${bodyText.slice(0, 300)}`,
      };
    }

    const body = JSON.parse(bodyText) as { data?: unknown[] };
    if (!Array.isArray(body.data)) {
      return {
        ...baseResult,
        latencyMs,
        status: 'fail',
        detail: 'Model list response did not include data[].',
      };
    }

    const seen = new Set<string>();
    const models = body.data
      .map(parseProviderModel)
      .filter((model): model is ProviderModel => Boolean(model))
      .filter((model) => {
        if (seen.has(model.id)) return false;
        seen.add(model.id);
        return true;
      });

    if (!models.length) {
      return {
        ...baseResult,
        latencyMs,
        status: 'warn',
        detail: 'Model list returned no usable model ids.',
      };
    }

    return {
      ...baseResult,
      latencyMs,
      status: 'pass',
      detail: `Loaded ${models.length} models.`,
      models,
    };
  } catch (error) {
    return {
      ...baseResult,
      latencyMs: Date.now() - startedAt,
      status: 'fail',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function listConfiguredProviderModels(
  request: ProviderModelListRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderModelListResult> {
  return request.protocol === 'anthropic' ? listAnthropicModels(request, fetchImpl) : listOpenAiCompatibleModels(request, fetchImpl);
}

export async function listAnthropicModels(
  request: ProviderModelListRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderModelListResult> {
  const startedAt = Date.now();
  const endpoint = `${normalizeAnthropicBaseUrl(request.baseUrl || 'https://api.anthropic.com')}/models`;
  const baseResult = {
    latencyMs: 0,
    endpoint,
    models: [] as ProviderModel[],
  };

  if (!request.apiKey.trim()) {
    return { ...baseResult, status: 'fail', detail: 'API key is missing; fill it before fetching models.' };
  }

  try {
    const response = await fetchWithInjectedTimeout(
      fetchImpl,
      endpoint,
      {
        method: 'GET',
        headers: {
          'x-api-key': request.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
      },
      15000,
    );
    const latencyMs = Date.now() - startedAt;
    const bodyText = await readTextBounded(response, LLM_RESPONSE_MAX_BYTES);
    if (!response.ok) {
      return {
        ...baseResult,
        latencyMs,
        status: 'fail',
        detail: `Model list failed with HTTP ${response.status}: ${bodyText.slice(0, 300)}`,
      };
    }

    const body = JSON.parse(bodyText) as { data?: unknown[] };
    if (!Array.isArray(body.data)) {
      return {
        ...baseResult,
        latencyMs,
        status: 'fail',
        detail: 'Model list response did not include data[].',
      };
    }

    const seen = new Set<string>();
    const models = body.data
      .map(parseAnthropicProviderModel)
      .filter((model): model is ProviderModel => Boolean(model))
      .filter((model) => {
        if (seen.has(model.id)) return false;
        seen.add(model.id);
        return true;
      });

    if (!models.length) {
      return {
        ...baseResult,
        latencyMs,
        status: 'warn',
        detail: 'Model list returned no usable model ids.',
      };
    }

    return {
      ...baseResult,
      latencyMs,
      status: 'pass',
      detail: `Loaded ${models.length} models.`,
      models,
    };
  } catch (error) {
    return {
      ...baseResult,
      latencyMs: Date.now() - startedAt,
      status: 'fail',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseProviderModel(value: unknown): ProviderModel | null {
  if (typeof value === 'string' && value.trim()) {
    return { id: value.trim() };
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || !record.id.trim()) return null;
  return {
    id: record.id.trim(),
    created: typeof record.created === 'number' ? record.created : undefined,
    ownedBy: typeof record.owned_by === 'string' ? record.owned_by : typeof record.ownedBy === 'string' ? record.ownedBy : undefined,
  };
}

function parseAnthropicProviderModel(value: unknown): ProviderModel | null {
  if (typeof value === 'string' && value.trim()) {
    return { id: value.trim(), ownedBy: 'anthropic' };
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || !record.id.trim()) return null;
  return {
    id: record.id.trim(),
    created: typeof record.created === 'number' ? record.created : parseAnthropicCreatedAt(record.created_at),
    ownedBy: typeof record.owned_by === 'string' ? record.owned_by : typeof record.ownedBy === 'string' ? record.ownedBy : 'anthropic',
  };
}

function parseAnthropicCreatedAt(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : undefined;
}

function normalizeOpenAiBaseUrl(value: string): string {
  const trimmed = value.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

function normalizeAnthropicBaseUrl(value: string): string {
  const trimmed = value.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

function isAnthropicLlmConfig(config: Pick<LlmConfig, 'provider' | 'protocol'>): boolean {
  return resolveLlmProtocol(config) === 'anthropic';
}

function extractAnthropicToolUseResult<T = unknown>(body: { content?: AnthropicContentPart[] }): LlmJsonResult<T> | null {
  const toolUse = body.content?.find((part) => part.type === 'tool_use' && part.name === ANTHROPIC_JSON_TOOL_NAME && part.input !== undefined);
  if (!toolUse) return null;
  if (typeof toolUse.input === 'string') {
    return {
      json: parseLlmJsonContent<T>(toolUse.input),
      raw: toolUse.input,
      requestId: null,
    };
  }
  const raw = JSON.stringify(toolUse.input);
  if (!raw) return null;
  return {
    json: toolUse.input as T,
    raw,
    requestId: null,
  };
}

function extractAnthropicTextContent(body: { content?: AnthropicContentPart[] }): string {
  return (
    body.content
      ?.filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n') ?? ''
  );
}

function parseLlmJsonContent<T = unknown>(raw: string): T {
  const trimmed = raw.replace(/^\uFEFF/, '').trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    for (const candidate of extractJsonCandidates(trimmed)) {
      try {
        return JSON.parse(candidate) as T;
      } catch {
        const repaired = escapeControlCharactersInJsonStrings(candidate);
        if (repaired !== candidate) {
          try {
            return JSON.parse(repaired) as T;
          } catch {
            // Keep looking; compatible providers sometimes add prose or fences around the payload.
          }
        }
      }
    }
    throw new SyntaxError('No valid JSON payload found.');
  }
}

function escapeControlCharactersInJsonStrings(input: string): string {
  let output = '';
  let inString = false;
  let escaped = false;
  let changed = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (!inString) {
      output += char;
      if (char === '"') inString = true;
      continue;
    }

    if (escaped) {
      escaped = false;
      const replacement = escapedControlCharacterReplacement(input, index);
      if (replacement) {
        output += replacement.value;
        index += replacement.skip;
        changed = true;
      } else {
        output += char;
      }
      continue;
    }

    if (char === '\\') {
      output += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      output += char;
      inString = false;
      continue;
    }

    const replacement = controlCharacterReplacement(input, index);
    if (replacement) {
      output += replacement.value;
      index += replacement.skip;
      changed = true;
      continue;
    }

    output += char;
  }

  return changed ? output : input;
}

function escapedControlCharacterReplacement(input: string, index: number): { value: string; skip: number } | null {
  const char = input[index];
  if (char === '\r' && input[index + 1] === '\n') return { value: 'n', skip: 1 };
  if (char === '\n' || char === '\r') return { value: 'n', skip: 0 };
  if (char === '\t') return { value: 't', skip: 0 };
  if (char === '\b') return { value: 'b', skip: 0 };
  if (char === '\f') return { value: 'f', skip: 0 };
  const code = char.charCodeAt(0);
  return code < 0x20 ? { value: `u${code.toString(16).padStart(4, '0')}`, skip: 0 } : null;
}

function controlCharacterReplacement(input: string, index: number): { value: string; skip: number } | null {
  const char = input[index];
  if (char === '\r' && input[index + 1] === '\n') return { value: '\\n', skip: 1 };
  if (char === '\n' || char === '\r') return { value: '\\n', skip: 0 };
  if (char === '\t') return { value: '\\t', skip: 0 };
  if (char === '\b') return { value: '\\b', skip: 0 };
  if (char === '\f') return { value: '\\f', skip: 0 };
  const code = char.charCodeAt(0);
  return code < 0x20 ? { value: `\\u${code.toString(16).padStart(4, '0')}`, skip: 0 } : null;
}

function extractJsonCandidates(input: string): string[] {
  const candidates: string[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char !== '{' && char !== '[') continue;
    const end = findJsonValueEnd(input, index);
    if (end !== -1) {
      candidates.push(input.slice(index, end + 1));
    }
  }
  return candidates;
}

function findJsonValueEnd(input: string, start: number): number {
  const first = input[start];
  const stack = [first === '{' ? '}' : ']'];
  let inString = false;
  let escaped = false;

  for (let index = start + 1; index < input.length; index += 1) {
    const char = input[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      stack.push('}');
      continue;
    }
    if (char === '[') {
      stack.push(']');
      continue;
    }
    if (char === '}' || char === ']') {
      if (char !== stack[stack.length - 1]) return -1;
      stack.pop();
      if (stack.length === 0) return index;
    }
  }

  return -1;
}

function formatRawPreview(raw: string): string {
  const preview = raw.replace(/\s+/g, ' ').trim().slice(0, 180);
  return preview ? ` Response preview: ${preview}` : '';
}

async function fetchWithInjectedTimeout(fetchImpl: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return fetchWithTimeout(url, {
    ...init,
    timeoutMs,
    timeoutLabel: 'Request',
    maxBytes: LLM_RESPONSE_MAX_BYTES,
    fetchImpl: fetchImpl as NetworkFetch,
  });
}
