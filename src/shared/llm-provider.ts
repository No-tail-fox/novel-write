import type { LlmConfig } from './types';

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

function normalizeOpenAiBaseUrl(value: string): string {
  const trimmed = value.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}
