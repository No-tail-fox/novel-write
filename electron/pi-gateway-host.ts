import { startPiGateway, PiRequestLedger } from '../services/pi-gateway/index';
import { fetchWithTimeout } from '../src/shared/http';
import { requireGenerationAuthorization } from '../src/shared/generation-authorization';
import type { LlmConfig } from '../src/shared/types';
import { resolvePiModelConfig, type PiModelCapabilities } from './pi-model-config';
import { assertPiRequestBudget, type PiBudgetLimits } from './pi-agent-budget';

type NativeProtocol = 'anthropic' | 'openai-chat' | 'openai-responses';
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const unsupported = (): never => { throw new Error('PI_INPUT_BOUND_UNSUPPORTED'); };

/** Only inline, single-frame PNG/JPEG: dimensions in these formats are authoritative.
 * This is deliberately NOT a token estimate or a universal custom-provider guarantee.
 * For the vetted native byte-tokenizer families, reserve four tokens per source pixel
 * plus 65,536 per image (covering resizing/minimum tiles), in addition to encoded bytes.
 * Do not replace this with compressed bytes alone: a tiny PNG can expand enormously.
 */
function imageReserve(uri: unknown): number {
  if (typeof uri !== 'string') return unsupported();
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(uri);
  if (!match || match[2].length % 4 || match[2].length > 8 * 1024 * 1024) return unsupported();
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.toString('base64') !== match[2]) return unsupported();
  let width = 0, height = 0;
  if (match[1] === 'png') {
    if (bytes.length < 45 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return unsupported();
    let ended = false, data = false;
    for (let offset = 8; offset < bytes.length;) {
      if (offset + 12 > bytes.length) return unsupported();
      const size = bytes.readUInt32BE(offset), kind = bytes.toString('ascii', offset + 4, offset + 8);
      if (size > bytes.length - offset - 12 || ['acTL', 'fcTL', 'fdAT'].includes(kind)) return unsupported();
      if (offset === 8 && (kind !== 'IHDR' || size !== 13)) return unsupported();
      if (kind === 'IHDR') {
        if (offset !== 8) return unsupported();
        width = bytes.readUInt32BE(offset + 8); height = bytes.readUInt32BE(offset + 12);
      }
      if (kind === 'IDAT') data = true;
      offset += size + 12;
      if (kind === 'IEND') { if (size || offset !== bytes.length) return unsupported(); ended = true; }
    }
    if (!ended || !data) return unsupported();
  } else {
    if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8) return unsupported();
    let scanned = false;
    for (let offset = 2; offset < bytes.length;) {
      if (bytes[offset++] !== 0xff) return unsupported();
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda) { scanned = true; break; }
      if (offset + 2 > bytes.length) return unsupported();
      const size = bytes.readUInt16BE(offset);
      if (size < 2 || offset + size > bytes.length) return unsupported();
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (width || size < 8) return unsupported();
        height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5);
      } else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return unsupported();
      offset += size;
    }
    if (!scanned || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) return unsupported();
  }
  const reserve = width * height * 4 + 65_536;
  if (!width || !height || !Number.isSafeInteger(reserve)) return unsupported();
  return reserve;
}

/** Admission bound for vetted native byte-tokenizer models, not arbitrary compatible APIs.
 * JSON UTF-8 bytes bound visible text, tool schemas/arguments/results and escaped text;
 * 256 per JSON node plus 4096 covers native message/tool framing. External expansion,
 * hosted tools and opaque state fail closed. The caller must vet model/tokenizer/pricing.
 */
export function piRequestInputTokenUpperBound(body: Readonly<Record<string, unknown>>, protocol: NativeProtocol, images: boolean, strict = true, imageTokenLimit?: number): number {
  const allowed = new Set(['model', 'messages', 'input', 'system', 'instructions', 'tools', 'tool_choice', 'parallel_tool_calls',
    'max_tokens', 'max_completion_tokens', 'max_output_tokens', 'stream', 'stream_options', 'temperature', 'top_p', 'top_k',
    'stop', 'stop_sequences', 'seed', 'store', 'metadata', 'user', 'reasoning', 'reasoning_effort', 'thinking', 'text',
    'response_format', 'include', 'service_tier', 'prompt_cache_key', 'prompt_cache_retention', 'prompt_cache_options', 'output_config']);
  if (Object.keys(body).some(key => !allowed.has(key)) || body.n !== undefined) return unsupported();
  if (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.some(tool => !record(tool)
    || (protocol === 'anthropic' ? tool.type !== undefined && tool.type !== 'custom' : tool.type !== 'function')))) return unsupported();
  let total = Buffer.byteLength(JSON.stringify(body), 'utf8') + 4096;
  const visit = (value: unknown, depth: number, schema = false): void => {
    if (depth > 64) return unsupported();
    total += 256;
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1, schema); return; }
    if (!record(value)) return;
    if (!schema) {
      if (['file_id', 'file_data', 'file_url', 'audio', 'input_audio', 'video', 'previous_response_id', 'conversation'].some(key => key in value)
        || strict && 'encrypted_content' in value) return unsupported();
      if (!(value.type === 'reasoning' && !strict) && typeof value.type === 'string' && !['text', 'input_text', 'output_text', 'image', 'image_url', 'input_image', 'message',
        'function', 'custom', 'function_call', 'function_call_output', 'tool_use', 'tool_result', 'thinking', 'enabled', 'disabled',
        'adaptive', 'auto', 'any', 'tool', 'json_schema', 'json_object', 'ephemeral'].includes(value.type)) return unsupported();
      if (['image', 'image_url', 'input_image'].includes(String(value.type))) {
        if (!images) return unsupported();
        let uri: unknown;
        if (value.type === 'image') {
          if (!record(value.source) || value.source.type !== 'base64') return unsupported();
          uri = `data:${value.source.media_type};base64,${value.source.data}`;
        } else uri = record(value.image_url) ? value.image_url.url : value.image_url;
        if (strict) {
          // Always validate format/size; a user-supplied provider ceiling replaces the pixel reserve and the base64 bytes already counted above.
          const reserve = imageReserve(uri), text = String(uri);
          total += imageTokenLimit ? imageTokenLimit - (text.length - text.indexOf(',') - 1) : reserve;
        }
        else if (typeof uri !== 'string' || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(uri)) return unsupported();
        // Its bytes are already included; do not interpret the source object as another content block.
        return;
      }
    }
    for (const [key, child] of Object.entries(value)) visit(child, depth + 1,
      schema || ['parameters', 'input_schema', 'schema', 'metadata'].includes(key) || value.type === 'tool_use' && key === 'input');
  };
  visit(body, 0);
  if (!Number.isSafeInteger(total)) return unsupported();
  return total;
}

export async function createPiGatewayHost(options: {
  directory: string; config: LlmConfig; capabilities: PiModelCapabilities; limits: PiBudgetLimits;
  pricing: { inputPerMillion: number; outputPerMillion: number };
  beforeSubmit?: () => void | Promise<void>;
}) {
  const model = resolvePiModelConfig(options.config, options.capabilities);
  const ledger = await PiRequestLedger.open(options.directory, options.limits.maxRequests);
  try {
    const gateway = await startPiGateway({ ledger, provider: model.provider, timeoutMs: model.timeoutMs,
      beforeSubmit: async body => {
        await requireGenerationAuthorization();
        await options.beforeSubmit?.();
        let inputTokens = 0, outputTokens = 0, unreportedRequests = 0;
        for (const { receipt } of ledger.receipts()) {
          if (!receipt || receipt.outcome !== 'received') continue;
          if (receipt.usageStatus !== 'known' || !receipt.usage) { unreportedRequests++; continue; }
          const usage = receipt.usage;
          const input = Number(usage.input_tokens ?? usage.prompt_tokens);
          const output = Number(usage.output_tokens ?? usage.completion_tokens);
          if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output)) { unreportedRequests++; continue; }
          inputTokens += input + (receipt.protocol === 'anthropic' ? Number(usage.cache_creation_input_tokens ?? 0) + Number(usage.cache_read_input_tokens ?? 0) : 0);
          outputTokens += output;
        }
        // Reject cross-protocol aliases so a small ignored field cannot hide a larger native limit.
        if (model.provider.protocol === 'anthropic' && (body.max_output_tokens !== undefined || body.max_completion_tokens !== undefined)
          || model.provider.protocol === 'openai-responses' && (body.max_tokens !== undefined || body.max_completion_tokens !== undefined)
          || model.provider.protocol === 'openai-chat' && (body.max_output_tokens !== undefined || body.max_tokens !== undefined && body.max_completion_tokens !== undefined)) throw new Error('PI_OUTPUT_BOUND_REQUIRED');
        const requestedOutput = body.max_output_tokens ?? body.max_completion_tokens ?? body.max_tokens;
        if (typeof requestedOutput !== 'number' || !Number.isSafeInteger(requestedOutput) || requestedOutput < 1 || requestedOutput > options.capabilities.maxOutputTokens) throw new Error('PI_OUTPUT_BOUND_REQUIRED');
        const strictInputBudget = options.limits.maxCost !== undefined || options.limits.maxTokens !== undefined;
        const bound = piRequestInputTokenUpperBound(body, model.provider.protocol, options.capabilities.images, strictInputBudget, options.config.imageInputTokenLimit);
        // Without an input/cost cap, preserve native vision/reasoning; no input bound is claimed.
        const inputTokenUpperBound = strictInputBudget ? bound : 0;
        if (strictInputBudget && inputTokenUpperBound > options.capabilities.contextWindow - requestedOutput) throw new Error('PI_INPUT_CONTEXT_LIMIT');
        assertPiRequestBudget(options.limits, {
          requests: ledger.summary().requests, inputTokens, outputTokens, unreportedRequests,
          estimatedCost: (inputTokens * options.pricing.inputPerMillion + outputTokens * options.pricing.outputPerMillion) / 1_000_000,
        }, {
          inputTokenUpperBound,
          outputTokenLimit: requestedOutput,
          inputPricePerMillion: options.pricing.inputPerMillion, outputPricePerMillion: options.pricing.outputPerMillion,
        });
      },
      transport: async (input, init) => {
        if (typeof input !== 'string' && !(input instanceof URL)) throw new Error('PI_GATEWAY_TRANSPORT_INPUT');
        return fetchWithTimeout(input, { ...init, generation: false, proxyUrl: model.proxyUrl,
          timeoutMs: model.timeoutMs, maxRedirects: 0, retryConnectTimeout: false, timeoutLabel: 'Pi native model request' });
      },
    });
    return {
      model: { ...model.workerModel, baseUrl: model.workerModel.api === 'anthropic-messages' ? gateway.baseUrl : gateway.baseUrl + '/v1' },
      localToken: gateway.localToken,
      summary: gateway.summary,
      close: async () => { await gateway.close(); await ledger.close(); },
    };
  } catch (error) { await ledger.close(); throw error; }
}
