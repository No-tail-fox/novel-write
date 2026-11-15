import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deflateSync } from 'node:zlib';
const mocks = vi.hoisted(() => ({ submit: undefined as undefined | ((body: Record<string, unknown>) => Promise<void>), begin: vi.fn() }));
vi.mock('../services/pi-gateway/index', () => ({
  PiRequestLedger: { open: async () => ({ receipts: () => [], summary: () => ({ requests: 0 }), close: async () => {} }) },
  startPiGateway: async (options: { beforeSubmit: typeof mocks.submit }) => {
    mocks.submit = async body => { await options.beforeSubmit!(body); mocks.begin(); };
    return { baseUrl: 'http://127.0.0.1:1', localToken: 'test', summary: () => ({}), close: async () => {} };
  },
}));
vi.mock('../src/shared/generation-authorization', () => ({ requireGenerationAuthorization: async () => {} }));
vi.mock('../src/shared/http', () => ({ fetchWithTimeout: vi.fn(() => { throw new Error('NO_NETWORK'); }) }));
import { createPiGatewayHost, piRequestInputTokenUpperBound } from '../electron/pi-gateway-host';
import type { LlmConfig } from '../src/shared/types';

// Real PNG framing and compressed pixel bytes, including CRCs; no image decoder/network needed.
function png(width: number, height: number) {
  const chunk = (kind: string, data: Buffer) => {
    const bytes = Buffer.concat([Buffer.from(kind), data]); let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const size = Buffer.alloc(4), checksum = Buffer.alloc(4); size.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, bytes, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc((width * 3 + 1) * height))), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
const chat = (text = 'hello') => ({ model: 'gpt-4o', max_tokens: 100, messages: [{ role: 'user', content: text }] });
async function host(limits: { maxRequests: number; maxCost?: number; maxTokens?: number } = { maxRequests: 2, maxCost: 0.02 }) {
  return createPiGatewayHost({ directory: 'unused', config: { model: 'gpt-4o', apiKey: 'test', baseUrl: 'https://api.openai.com/v1', protocol: 'openai' } as LlmConfig,
    capabilities: { contextWindow: 128000, maxOutputTokens: 4096, images: true, reasoning: false, tools: true }, limits,
    pricing: { inputPerMillion: 1, outputPerMillion: 2 } });
}
beforeEach(() => { mocks.begin.mockClear(); });
describe('native request input reservation', () => {
  it.each([
    ['anthropic-messages', 'anthropic', 'claude-sonnet-4-20250514'],
    ['openai-completions', 'openai-chat', 'gpt-4o'],
    ['openai-responses', 'openai-responses', 'gpt-4o'],
  ] as const)('accepts actual SDK %s payload without network', async (api, protocol, id) => {
    const modulePath = `../services/pi-agent-worker/node_modules/@earendil-works/pi-ai/dist/api/${api}.js`;
    const sdk = await import(modulePath);
    let captured: Record<string, unknown> | undefined;
    const stream = sdk.stream({ id, name: id, api, provider: protocol === 'anthropic' ? 'anthropic' : 'openai',
      baseUrl: 'http://127.0.0.1:1/v1', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096,
      cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } },
    { systemPrompt: 'Offline test', messages: [{ role: 'user', content: 'hello', timestamp: 1 }],
      tools: [{ name: 'inspect', description: 'Inspect', parameters: { type: 'object', properties: { type: { type: 'string' } } } }] },
    { apiKey: 'offline', maxTokens: 1000, onPayload: (body: Record<string, unknown>) => { captured = JSON.parse(JSON.stringify(body)); throw new Error('OFFLINE_CAPTURE'); },
      fetch: () => { throw new Error('NETWORK_FORBIDDEN'); } });
    await stream.result();
    expect(captured).toBeDefined();
    expect(() => piRequestInputTokenUpperBound(captured!, protocol, false)).not.toThrow();
    await createPiGatewayHost({ directory: 'unused', config: { model: id, apiKey: 'offline', baseUrl: 'https://api.openai.com/v1',
      protocol: protocol === 'anthropic' ? 'anthropic' : protocol === 'openai-responses' ? 'responses' : 'openai' } as LlmConfig,
      capabilities: { contextWindow: 128000, maxOutputTokens: 4096, images: false, reasoning: false, tools: true },
      limits: { maxRequests: 2, maxCost: 0.1 }, pricing: { inputPerMillion: 1, outputPerMillion: 2 } });
    await mocks.submit!(captured!); expect(mocks.begin).toHaveBeenCalledOnce();
  });
  it('treats Anthropic tool input as JSON data, not protocol blocks', () => {
    const body = { ...chat(), messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 'tool_1', name: 'inspect',
      input: { type: 'movie', image: { type: 'arbitrary', file_id: 'user-data-only' } } }] }] };
    expect(() => piRequestInputTokenUpperBound(body, 'anthropic', false)).not.toThrow();
  });
  it.each(['anthropic', 'openai-chat', 'openai-responses'] as const)('bounds UTF8 text and tool schemas for %s', protocol => {
    const body = { ...chat('漢字🙂'.repeat(200)), tools: [protocol === 'anthropic'
      ? { name: 'test', description: 'x'.repeat(5000), input_schema: { type: 'object', properties: {} } }
      : { type: 'function', function: { name: 'test', description: 'x'.repeat(5000), parameters: { type: 'object', properties: {} } } }] };
    expect(piRequestInputTokenUpperBound(body, protocol, true)).toBeGreaterThan(Buffer.byteLength(JSON.stringify(body)));
  });
  it('admits a small request with request-specific reservation', async () => {
    await host(); await mocks.submit!(chat()); expect(mocks.begin).toHaveBeenCalledOnce();
  });
  it.each(['text', 'tools'])('rejects oversized %s before submission', async kind => {
    await host(); const body = kind === 'text' ? chat('x'.repeat(150000)) : { ...chat(), tools: [{ type: 'function', function: { name: 'large', description: 'x'.repeat(150000) } }] };
    await expect(mocks.submit!(body)).rejects.toThrow('PI_INPUT_CONTEXT_LIMIT'); expect(mocks.begin).not.toHaveBeenCalled();
  });
  it('rejects conflicting output aliases before submission', async () => {
    await host(); await expect(mocks.submit!({ ...chat(), max_output_tokens: 1 })).rejects.toThrow('PI_OUTPUT_BOUND_REQUIRED');
    expect(mocks.begin).not.toHaveBeenCalled();
  });
  it('blocks cost overrun even below context limit', async () => {
    await host(); await expect(mocks.submit!(chat('x'.repeat(30000)))).rejects.toThrow('PI_BUDGET_COST_LIMIT'); expect(mocks.begin).not.toHaveBeenCalled();
  });
  it('enforces input plus output against token limit', async () => {
    await host({ maxRequests: 2, maxTokens: 1000 }); await expect(mocks.submit!(chat())).rejects.toThrow('PI_BUDGET_TOKEN_LIMIT'); expect(mocks.begin).not.toHaveBeenCalled();
  });
  it('counts compressed images by pixels as well as encoded bytes', async () => {
    const uri = png(1920, 1080), body = { ...chat(), messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: uri } }] }] };
    expect(uri.length).toBeLessThan(20000);
    expect(piRequestInputTokenUpperBound(body, 'openai-chat', true)).toBeGreaterThan(1920 * 1080 * 4);
    await host(); await expect(mocks.submit!(body)).rejects.toThrow('PI_INPUT_CONTEXT_LIMIT'); expect(mocks.begin).not.toHaveBeenCalled();
  });
  it.each(['https://example.com/image.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,YQ=='])('fails closed for unbounded/invalid images %s', uri => {
    expect(() => piRequestInputTokenUpperBound({ ...chat(), messages: [{ content: [{ type: 'image_url', image_url: { url: uri } }] }] }, 'openai-chat', true)).toThrow();
  });
  it.each([{ previous_response_id: 'resp_old' }, { tools: [{ type: 'web_search' }] }, { input: [{ type: 'reasoning', encrypted_content: 'opaque' }] }, { n: 10 }])('rejects expansion or multiplied output %#', extra => {
    expect(() => piRequestInputTokenUpperBound({ ...chat(), ...extra }, 'openai-responses', true)).toThrow('PI_INPUT_BOUND_UNSUPPORTED');
  });
  it('uses a user-supplied per-image ceiling instead of the pixel reserve, still rejecting a ceiling that overflows the context', async () => {
    const uri = png(1920, 1080), body = { ...chat(), messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: uri } }] }] };
    const base = piRequestInputTokenUpperBound(body, 'openai-chat', true);
    const limited = piRequestInputTokenUpperBound(body, 'openai-chat', true, true, 1500);
    expect(base).toBeGreaterThan(1920 * 1080 * 4);
    expect(limited).toBeLessThan(20000);
    expect(limited).toBeGreaterThan(1500);
    expect(() => piRequestInputTokenUpperBound({ ...body, messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,YQ==' } }] }] }, 'openai-chat', true, true, 1500)).toThrow();
    await createPiGatewayHost({ directory: 'unused', config: { model: 'gpt-4o', apiKey: 'test', baseUrl: 'https://api.openai.com/v1', protocol: 'openai', imageInputTokenLimit: 1500 } as LlmConfig,
      capabilities: { contextWindow: 128000, maxOutputTokens: 4096, images: true, reasoning: false, tools: true }, limits: { maxRequests: 2, maxCost: 0.02 }, pricing: { inputPerMillion: 1, outputPerMillion: 2 } });
    await mocks.submit!(body); expect(mocks.begin).toHaveBeenCalledOnce();
  });
  it('preserves native images and opaque reasoning when only request count is capped', async () => {
    await host({ maxRequests: 2 });
    await mocks.submit!({ ...chat(), input: [{ type: 'reasoning', encrypted_content: 'opaque' }], messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: png(1920, 1080) } }] }] });
    expect(mocks.begin).toHaveBeenCalledOnce();
  });
});
