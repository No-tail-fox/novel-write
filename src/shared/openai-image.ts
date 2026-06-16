export type OpenAiImageResolution = '1K' | '2K' | '4K';
export type OpenAiImageQuality = 'low' | 'medium' | 'high';

export interface OpenAiImageGenerationBody {
  model: string;
  prompt: string;
  size: string;
  quality: OpenAiImageQuality;
  output_format: 'png';
  moderation: 'auto';
  [key: string]: string | OpenAiImageQuality;
}

export interface OpenAiImageProbeResult {
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  latencyMs: number;
  endpoint: string;
  requestId: string | null;
}

export interface OpenAiImageProbeInput {
  baseUrl: string;
  apiKey: string;
  model: string;
  ratio: string;
  resolution: OpenAiImageResolution;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_OPENAI_IMAGE_BASE_URL = 'https://api.openai.com';
const IMAGE_PROBE_PROMPT = 'Configuration smoke test: a simple geometric icon on a plain background, no text.';

export function normalizeOpenAiImageBaseUrl(value: string): string {
  const trimmed = value.replace(/\/+$/, '');
  const base = trimmed || DEFAULT_OPENAI_IMAGE_BASE_URL;
  return base.endsWith('/v1') ? base : `${base}/v1`;
}

export function buildOpenAiImageGenerationBody(input: {
  model: string;
  prompt: string;
  ratio: string;
  resolution: OpenAiImageResolution;
  ratioMappingJson?: string;
}): OpenAiImageGenerationBody {
  const ratioPatch = resolveCustomRatioMapping(input.ratioMappingJson, input.ratio);
  return {
    model: input.model,
    prompt: input.prompt,
    size: resolveOpenAiImageSize(input.ratio),
    quality: resolveOpenAiImageQuality(input.resolution),
    output_format: 'png',
    moderation: 'auto',
    ...ratioPatch,
  };
}

export async function testOpenAiCompatibleImageModel(input: OpenAiImageProbeInput): Promise<OpenAiImageProbeResult> {
  const startedAt = Date.now();
  const endpoint = `${normalizeOpenAiImageBaseUrl(input.baseUrl)}/images/generations`;
  const baseResult = {
    latencyMs: 0,
    endpoint,
    requestId: null,
  };

  if (!input.apiKey.trim()) {
    return { ...baseResult, status: 'fail', detail: 'Image provider API key is missing; fill it before testing.' };
  }
  if (!input.model.trim()) {
    return { ...baseResult, status: 'fail', detail: 'Image model is missing; choose a model before testing.' };
  }

  try {
    const response = await fetchWithTimeout(
      input.fetchImpl ?? fetch,
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${input.apiKey}`,
        },
        body: JSON.stringify(buildOpenAiImageGenerationBody({
          model: input.model,
          prompt: IMAGE_PROBE_PROMPT,
          ratio: input.ratio,
          resolution: input.resolution,
        })),
      },
      input.timeoutMs ?? 90000,
    );
    const latencyMs = Date.now() - startedAt;
    const bodyText = await response.text();
    if (!response.ok) {
      return {
        ...baseResult,
        latencyMs,
        status: 'fail',
        detail: `Image model test failed with HTTP ${response.status}: ${bodyText.slice(0, 300)}`,
      };
    }

    let body: { id?: string; data?: Array<{ b64_json?: string; url?: string }> };
    try {
      body = JSON.parse(bodyText) as typeof body;
    } catch {
      return {
        ...baseResult,
        latencyMs,
        status: 'fail',
        detail: 'Image model test returned non-JSON response.',
      };
    }

    const item = body.data?.[0];
    if (item?.b64_json || item?.url) {
      return {
        ...baseResult,
        latencyMs,
        requestId: body.id ?? response.headers.get('x-request-id') ?? null,
        status: 'pass',
        detail: `Image model ${input.model} is usable. Latency ${latencyMs} ms.`,
      };
    }

    return {
      ...baseResult,
      latencyMs,
      requestId: body.id ?? response.headers.get('x-request-id') ?? null,
      status: 'fail',
      detail: 'Image model test response did not include data[0].b64_json or data[0].url.',
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

export function resolveOpenAiImageQuality(resolution: OpenAiImageResolution): OpenAiImageQuality {
  if (resolution === '1K') return 'low';
  if (resolution === '4K') return 'high';
  return 'medium';
}

export function resolveOpenAiImageSize(ratio: string): string {
  if (ratio === '9:16' || ratio === '3:4' || ratio === '2:3') return '1024x1536';
  if (ratio === '16:9' || ratio === '4:3' || ratio === '3:2' || ratio === '21:9') return '1536x1024';
  return '1024x1024';
}

function resolveCustomRatioMapping(value: string | undefined, ratio: string): Record<string, string> {
  if (!value?.trim()) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const mapping = parsed[ratio];
    if (typeof mapping === 'string') return { size: mapping };
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return {};
    return Object.fromEntries(
      Object.entries(mapping)
        .filter((entry): entry is [string, string | number] => typeof entry[1] === 'string' || typeof entry[1] === 'number')
        .map(([key, mappedValue]) => [key, String(mappedValue)]),
    );
  } catch {
    return {};
  }
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
