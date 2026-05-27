import type { LlmConfig, LlmModelTestResult } from './types';

export type LlmRole = 'system' | 'user' | 'assistant';

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface LlmJsonRequest {
  step: number;
  name: string;
  messages: LlmMessage[];
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
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
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
        json: JSON.parse(raw) as T,
        raw,
        requestId: body.id ?? null,
      };
    } catch {
      throw new LlmJsonParseError(`LLM step ${request.step} ${request.name} did not return valid JSON.`, raw);
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
    const response = await fetchWithTimeout(
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
      JSON.parse(raw);
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

function normalizeOpenAiBaseUrl(value: string): string {
  const trimmed = value.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
