import type { LlmConfig, LlmModelTestResult, ProviderModel, ProviderModelListRequest, ProviderModelListResult } from './types';
import { fetchWithTimeout } from './http';

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
  | { protocol: 'anthropic'; run: AnthropicMessagesJsonLlm };

export type ConfiguredTextLlm =
  | { protocol: 'openai'; run: OpenAiCompatibleTextLlm }
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

export class LlmJsonParseError extends Error {
  constructor(
    message: string,
    public readonly rawResponse: string,
  ) {
    super(message);
    this.name = 'LlmJsonParseError';
  }
}

export function createConfiguredJsonLlm(config: LlmConfig): ConfiguredJsonLlm {
  return isAnthropicLlmConfig(config)
    ? { protocol: 'anthropic', run: createAnthropicMessagesJsonLlm(config) }
    : { protocol: 'openai', run: createOpenAiCompatibleJsonLlm(config) };
}

export function createConfiguredTextLlm(config: LlmConfig): ConfiguredTextLlm {
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
      throw new Error(`LLM API error (${response.status}) at step ${request.step} ${request.name} via ${endpoint}: ${await response.text()}`);
    }
    const body = (await response.json()) as {
      id?: string;
      choices?: Array<{ message?: { content?: string | null }; text?: string | null }>;
    };
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
      throw new Error(`LLM API error (${response.status}) at step ${request.step} ${request.name} via ${endpoint}: ${await response.text()}`);
    }
    const body = (await response.json()) as {
      id?: string;
      content?: AnthropicContentPart[];
    };
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
      throw new Error(`LLM API error (${response.status}) at step ${request.step} ${request.name} via ${endpoint}: ${await response.text()}`);
    }
    const body = (await response.json()) as {
      id?: string;
      choices?: Array<{ message?: { content?: string | null }; text?: string | null }>;
    };
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
      throw new Error(`LLM API error (${response.status}) at step ${request.step} ${request.name} via ${endpoint}: ${await response.text()}`);
    }
    const body = (await response.json()) as {
      id?: string;
      content?: AnthropicContentPart[];
    };
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

async function fetchLlmJsonWithRetries(endpoint: string, config: LlmConfig, request: OpenAiCompatibleJsonRequest): Promise<Response> {
  const maxAttempts = LLM_RETRY_DELAYS_MS.length + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      timeoutMs: config.timeoutMs ?? 120_000,
      timeoutLabel: `LLM step ${request.step} ${request.name}`,
      signal: request.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(buildRequestBody(config, request.messages)),
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
      signal: request.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(buildAnthropicRequestBody(config, request.messages, request.anthropic?.toolInputSchema)),
    });
    if (!TRANSIENT_LLM_STATUS_CODES.has(response.status) || attempt === maxAttempts) {
      return response;
    }
    await sleepBeforeRetry(LLM_RETRY_DELAYS_MS[attempt - 1], request.signal, `LLM step ${request.step} ${request.name}`);
  }
  throw new Error('Unexpected LLM retry state.');
}

async function fetchLlmTextWithRetries(endpoint: string, config: LlmConfig, request: OpenAiCompatibleTextRequest): Promise<Response> {
  const maxAttempts = textRequestMaxAttempts(request);
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        timeoutMs: request.timeoutMs ?? config.timeoutMs ?? 120_000,
        timeoutLabel: `LLM step ${request.step} ${request.name}`,
        signal: request.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(buildTextRequestBody(config, request)),
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

function buildRequestBody(config: LlmConfig, messages: LlmMessage[]): Record<string, unknown> {
  const baseBody: Record<string, unknown> = {
    model: config.model,
    messages,
    response_format: { type: 'json_object' },
  };
  const extra = parseRequestParamsJson(config.requestParamsJson);
  return { ...extra, ...baseBody };
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

function buildAnthropicRequestBody(config: LlmConfig, messages: LlmMessage[], toolInputSchema?: Record<string, unknown>): Record<string, unknown> {
  const extra = parseRequestParamsJson(config.requestParamsJson);
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join('\n\n');
  const anthropicMessages = messages
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
    tools: [buildAnthropicJsonTool(toolInputSchema)],
    tool_choice: { type: 'tool', name: ANTHROPIC_JSON_TOOL_NAME },
  };
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

export async function testOpenAiCompatibleLlm(config: LlmConfig, fetchImpl: typeof fetch = fetch): Promise<LlmModelTestResult> {
  const startedAt = Date.now();
  const model = config.model.trim();
  const baseUrl = normalizeOpenAiBaseUrl(config.baseUrl || 'https://api.openai.com');
  const endpoint = `${baseUrl}/chat/completions`;
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
        body: JSON.stringify({
          ...buildRequestBody(config, [
            { role: 'system', content: 'Return strict JSON only.' },
            { role: 'user', content: 'Return {"ok":true} to confirm this model is usable.' },
          ]),
          model,
          max_tokens: 20,
        }),
      },
      15000,
    );
    const latencyMs = Date.now() - startedAt;
    const bodyText = await response.text();
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
      choices?: Array<{ message?: { content?: string | null }; text?: string | null }>;
    };
    const raw = body.choices?.[0]?.message?.content ?? body.choices?.[0]?.text ?? '';
    if (!raw.trim()) {
      return { ...baseResult, latencyMs, requestId: body.id ?? null, status: 'warn', detail: `Model ${model} responded, but returned empty content.` };
    }
    try {
      parseLlmJsonContent(raw);
      return { ...baseResult, latencyMs, requestId: body.id ?? null, status: 'pass', detail: `Model ${model} is usable. Latency ${latencyMs} ms.` };
    } catch {
      return {
        ...baseResult,
        latencyMs,
        requestId: body.id ?? null,
        status: 'warn',
        detail: `Model ${model} responded, but did not follow JSON mode: ${raw.slice(0, 160)}`,
      };
    }
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
        body: JSON.stringify({
          ...buildAnthropicRequestBody(config, [
            { role: 'system', content: 'Return strict JSON only.' },
            { role: 'user', content: 'Return {"ok":true} to confirm this model is usable.' },
          ]),
          model,
          max_tokens: 20,
        }),
      },
      15000,
    );
    const latencyMs = Date.now() - startedAt;
    const bodyText = await response.text();
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
      content?: Array<{ type?: string; text?: string | null }>;
    };
    const raw = extractAnthropicTextContent(body);
    if (!raw.trim()) {
      return { ...baseResult, latencyMs, requestId: body.id ?? null, status: 'warn', detail: `Model ${model} responded, but returned empty content.` };
    }
    try {
      parseLlmJsonContent(raw);
      return { ...baseResult, latencyMs, requestId: body.id ?? null, status: 'pass', detail: `Model ${model} is usable. Latency ${latencyMs} ms.` };
    } catch {
      return {
        ...baseResult,
        latencyMs,
        requestId: body.id ?? null,
        status: 'warn',
        detail: `Model ${model} responded, but did not follow JSON mode: ${raw.slice(0, 160)}`,
      };
    }
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
    const bodyText = await response.text();
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
    const bodyText = await response.text();
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
  return config.protocol === 'anthropic' || config.provider === 'anthropic';
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms.`)), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      const reason = controller.signal.reason;
      if (reason instanceof Error) throw reason;
      if (typeof reason === 'string') throw new Error(reason);
      throw new Error('Request aborted.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
