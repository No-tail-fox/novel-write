import type { LlmConfig, LlmModelTestResult, ProviderModel, ProviderModelListRequest, ProviderModelListResult } from './types';
import { fetchWithTimeout } from './http';

export type LlmRole = 'system' | 'user' | 'assistant';

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface LlmJsonRequest {
  step: number;
  name: string;
  messages: LlmMessage[];
  signal?: AbortSignal;
}

export interface LlmJsonResult<T = unknown> {
  json: T;
  raw: string;
  requestId: string | null;
}

export type JsonLlm = <T = unknown>(request: LlmJsonRequest) => Promise<LlmJsonResult<T>>;

export class LlmJsonParseError extends Error {
  constructor(
    message: string,
    public readonly rawResponse: string,
  ) {
    super(message);
    this.name = 'LlmJsonParseError';
  }
}

export function createOpenAiCompatibleJsonLlm(config: LlmConfig): JsonLlm {
  return async <T = unknown>(request: LlmJsonRequest): Promise<LlmJsonResult<T>> => {
    if (!config.apiKey) {
      throw new Error('LLM API key is missing; cannot run real task content generation.');
    }
    const baseUrl = normalizeOpenAiBaseUrl(config.baseUrl || 'https://api.openai.com');
    const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
      method: 'POST',
      timeoutMs: config.timeoutMs ?? 120_000,
      timeoutLabel: `LLM step ${request.step} ${request.name}`,
      signal: request.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: request.messages,
        response_format: { type: 'json_object' },
      }),
    });
    if (!response.ok) {
      throw new Error(`LLM API error (${response.status}) at step ${request.step} ${request.name}: ${await response.text()}`);
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
          model,
          messages: [
            { role: 'system', content: 'Return strict JSON only.' },
            { role: 'user', content: 'Return {"ok":true} to confirm this model is usable.' },
          ],
          response_format: { type: 'json_object' },
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

function normalizeOpenAiBaseUrl(value: string): string {
  const trimmed = value.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
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
        // Keep looking; compatible providers sometimes add prose or fences around the payload.
      }
    }
    throw new SyntaxError('No valid JSON payload found.');
  }
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
