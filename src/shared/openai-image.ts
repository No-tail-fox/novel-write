import { fetchWithTimeout } from './http';
import { readTextBounded, type NetworkFetch } from './network-policy';
import { normalizeOpenAiImageBaseUrl } from './openai-image-config';
import type { ImageGenerationQuality } from './types';

export { normalizeOpenAiImageBaseUrl } from './openai-image-config';

export type OpenAiImageResolution = '1K' | '2K' | '4K';
export type OpenAiImageQuality = ImageGenerationQuality;

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
  quality?: OpenAiImageQuality;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const IMAGE_PROBE_PROMPT = 'Configuration smoke test: a simple geometric icon on a plain background, no text.';
const IMAGE_PROBE_RESPONSE_MAX_BYTES = 64 * 1024 * 1024;

export type OpenAiImageProviderOperation = 'generation' | 'edit' | 'async-submit' | 'async-poll' | 'model-test';

export function formatOpenAiImageProviderError(input: {
  status: number;
  bodyText: string;
  model: string;
  operation: OpenAiImageProviderOperation;
}): string {
  const prefix = input.operation === 'edit'
    ? 'Image provider edit API error'
    : input.operation === 'async-submit'
      ? 'Image provider async submit error'
      : input.operation === 'async-poll'
        ? 'Image provider async poll error'
        : input.operation === 'model-test'
          ? 'Image model test error'
          : 'Image provider API error';
  const detail = extractImageProviderErrorDetail(input.bodyText);
  if (input.status === 402) {
    return `${prefix} (${input.status}): 远程图片服务账户余额不足或套餐额度不可用。此错误由图片服务供应商返回，不是本地参数校验错误；请充值供应商账户，或切换其他图片服务/模型。降低生成质量只能减少后续消耗，无法绕过已无余额的账户。上游信息: ${detail}`;
  }
  if (input.status === 503 && /no available compatible accounts/iu.test(detail)) {
    return `${prefix} (${input.status}): 图片服务当前没有可用于模型 "${input.model}" 的上游账号或通道。API Key 和模型清单可能仍然正常；请稍后仅重试生图步骤，或切换其他图片服务/模型。上游信息: ${detail}`;
  }
  if (input.status === 503) {
    return `${prefix} (${input.status}): 图片服务暂时不可用，请稍后仅重试生图步骤，或切换其他图片服务。上游信息: ${detail}`;
  }
  return `${prefix} (${input.status}): ${detail}`;
}

function extractImageProviderErrorDetail(bodyText: string): string {
  const fallback = bodyText.replace(/\s+/gu, ' ').trim().slice(0, 600) || 'empty provider response';
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: string | { message?: unknown };
      message?: unknown;
    };
    const message = typeof parsed.error === 'string'
      ? parsed.error
      : typeof parsed.error?.message === 'string'
        ? parsed.error.message
        : typeof parsed.message === 'string'
          ? parsed.message
          : '';
    return message.replace(/\s+/gu, ' ').trim().slice(0, 600) || fallback;
  } catch {
    return fallback;
  }
}

export function buildOpenAiImageGenerationBody(input: {
  model: string;
  prompt: string;
  ratio: string;
  resolution: OpenAiImageResolution;
  quality?: OpenAiImageQuality;
  ratioMappingJson?: string;
}): OpenAiImageGenerationBody {
  const ratioPatch = resolveCustomRatioMapping(input.ratioMappingJson, input.ratio);
  return {
    model: input.model,
    prompt: input.prompt,
    size: resolveOpenAiImageSize(input.ratio),
    quality: input.quality ?? resolveOpenAiImageQuality(input.resolution),
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
    const response = await fetchWithTimeout(endpoint, {
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
        quality: input.quality,
      })),
      timeoutMs: input.timeoutMs ?? 90000,
      timeoutLabel: 'Image model test',
      maxBytes: IMAGE_PROBE_RESPONSE_MAX_BYTES,
      fetchImpl: input.fetchImpl as NetworkFetch | undefined,
    });
    const latencyMs = Date.now() - startedAt;
    const bodyText = await readTextBounded(response, IMAGE_PROBE_RESPONSE_MAX_BYTES);
    if (!response.ok) {
      return {
        ...baseResult,
        latencyMs,
        status: 'fail',
        detail: formatOpenAiImageProviderError({
          status: response.status,
          bodyText,
          model: input.model,
          operation: 'model-test',
        }),
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
