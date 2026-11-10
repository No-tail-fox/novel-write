/**
 * Q-4: fault injection against a local relay (中转站) — real client code, real sockets, no fetch stubs.
 *
 * Every assertion on `relay.requests.length` proves what actually reached the wire: retries that must
 * happen (429 / 521 / transient TTS) and resends that must never happen (524 / ECONNRESET on paid,
 * non-idempotent calls). Loopback targets are allowed by the `provider-api` network policy by design
 * (local relays such as one-api/new-api), so no policy seam is needed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readdir } from 'node:fs/promises';
import { createConfiguredJsonLlm, createConfiguredTextLlm, type LlmMessage } from '@shared/llm-provider';
import { LlmTextInterruptedError } from '@shared/llm-text-stream';
import { classifyProviderFailure } from '@shared/provider-failure';
import { createConfiguredImageGenerator, createConfiguredNarrationSynthesizer } from '@shared/media-providers';
import { isDefinitiveImageProviderFailure, isImageResultUnknown } from '@shared/image-provider-error';
import { classifyTtsFailure } from '@shared/tts-segment-synthesis';
import { defaultConfig } from '@shared/config';
import type { AppConfig, ImagePrompt, LlmConfig, StoryboardScene, Task } from '@shared/types';
import { reserveClosedPort, settle, sseData, startMockRelay, startTlsBreaker, type MockRelay, type MockTlsBreaker } from './helpers/mock-relay';
import { createTestTempDirectory, removeTestTempDirectories } from './helpers/test-temp-directories';

const messages: LlmMessage[] = [{ role: 'user', content: 'Return {"ok":true}' }];
const openAiOk = (content = '{"ok":true}', id = 'chatcmpl-ok') => ({
  kind: 'json' as const,
  body: { id, choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] },
});
const anthropicJsonOk = () => ({
  kind: 'json' as const,
  body: { id: 'msg_ok', type: 'message', content: [{ type: 'tool_use', id: 'tu_1', name: 'return_json', input: { ok: true } }], stop_reason: 'tool_use' },
});
const anthropicTextOk = (text = 'hello') => ({
  kind: 'json' as const,
  body: { id: 'msg_text', type: 'message', content: [{ type: 'text', text }], stop_reason: 'end_turn' },
});

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error('Expected the provider call to fail.');
}

const models = (relay: MockRelay) => relay.requests.map(request => request.json?.model);
const causeCodes = (error: unknown): string[] => {
  const codes: string[] = [];
  for (let current = error, depth = 0; current instanceof Error && depth < 6; current = current.cause, depth += 1) {
    const code = (current as NodeJS.ErrnoException).code;
    if (typeof code === 'string') codes.push(code);
  }
  return codes;
};

let relay: MockRelay;
let tls: MockTlsBreaker;

beforeAll(async () => {
  relay = await startMockRelay();
  tls = await startTlsBreaker('plaintext');
});

afterAll(async () => {
  await relay?.close();
  await tls?.close();
});

beforeEach(() => {
  relay.reset();
  tls.reset();
});

describe('LLM over OpenAI-compatible chat completions', () => {
  const config = (extra: Partial<LlmConfig> = {}): LlmConfig => ({
    provider: 'custom',
    protocol: 'openai',
    apiKey: 'relay-test-key',
    baseUrl: `${relay.origin}/v1`,
    model: 'primary',
    proxyUrl: '',
    timeoutMs: 10_000,
    ...extra,
  });
  const json = (cfg: LlmConfig, extra: { maxRetries?: number; timeoutMs?: number } = {}) =>
    createConfiguredJsonLlm(cfg).run({ step: 1, name: 'fault', messages, ...extra });
  const text = (cfg: LlmConfig, extra: { maxRetries?: number; stream?: boolean } = {}) =>
    createConfiguredTextLlm(cfg).run({ step: 1, name: 'fault', messages, ...extra });

  it('round-trips a normal JSON response through the relay', async () => {
    relay.enqueue(openAiOk());
    const result = await json(config());
    expect(result.json).toEqual({ ok: true });
    expect(relay.requests).toHaveLength(1);
    expect(relay.requests[0]).toMatchObject({ method: 'POST', url: '/v1/chat/completions' });
    expect(relay.requests[0].headers.authorization).toBe('Bearer relay-test-key');
    expect(relay.requests[0].json).toMatchObject({ model: 'primary', response_format: { type: 'json_object' } });
  });

  it('ECONNRESET after the request was delivered: JSON call is not resent, outcome unknown', async () => {
    relay.enqueue({ kind: 'reset' }, openAiOk());
    const error = await rejection(json(config(), { maxRetries: 2 }));
    await settle();
    expect(relay.requests).toHaveLength(1);
    expect(relay.requests[0].body).toContain('primary');
    expect(classifyProviderFailure({ error })).toMatchObject({ kind: 'transport-lost', outcome: 'unknown', retry: 'idempotent' });
  });

  it('socket closed before the body was read is still an unknown outcome (client cannot tell)', async () => {
    relay.enqueue({ kind: 'close-before-body' });
    const error = await rejection(json(config(), { maxRetries: 2 }));
    await settle();
    expect(relay.requests).toHaveLength(1);
    expect(classifyProviderFailure({ error })).toMatchObject({ kind: 'transport-lost', outcome: 'unknown' });
  });

  it('connection dropped on accept: nothing parsed, nothing resent by the JSON path', async () => {
    relay.enqueue({ kind: 'close-on-connect' });
    const error = await rejection(json(config(), { maxRetries: 2 }));
    await settle();
    expect(relay.connections()).toBe(1);
    expect(relay.requests).toHaveLength(0);
    expect(classifyProviderFailure({ error }).outcome).toBe('unknown');
  });

  it('connection refused is classified as not-sent (safe to resend)', async () => {
    const port = await reserveClosedPort();
    const error = await rejection(json(config({ baseUrl: `http://127.0.0.1:${port}/v1` }), { maxRetries: 0 }));
    expect(classifyProviderFailure({ error })).toMatchObject({ kind: 'connect', outcome: 'not-sent', retry: 'always', code: 'ECONNREFUSED' });
  });

  it('Cloudflare 524 after a delay is never resent, even with retries and fallback models configured', async () => {
    relay.enqueue({ kind: 'cloudflare', status: 524, delayMs: 150 }, openAiOk(), openAiOk());
    const error = await rejection(json(config({ fallbackModels: ['backup'] }), { maxRetries: 2 }));
    await settle();
    expect(relay.requests).toHaveLength(1);
    expect(models(relay)).toEqual(['primary']);
    expect(error.message).toContain('(524)');
    expect(error.message).toContain('error code: 524');
    expect(classifyProviderFailure({ error })).toMatchObject({ kind: 'gateway-timeout', outcome: 'unknown', status: 524, fallback: false });
  });

  it('429 honours Retry-After before the single resend', async () => {
    relay.enqueue({ kind: 'rate-limit', retryAfter: '1' }, openAiOk());
    const result = await json(config(), { maxRetries: 1 });
    expect(result.json).toEqual({ ok: true });
    expect(relay.requests).toHaveLength(2);
    const gap = relay.requests[1].receivedAt - relay.requests[0].receivedAt;
    expect(gap).toBeGreaterThanOrEqual(900); // Retry-After: 1 overrides the 500 ms schedule
    expect(gap).toBeLessThan(5_000);
  });

  it('persistent 429 stops after maxRetries and is a transient refusal', async () => {
    relay.enqueue({ kind: 'rate-limit', retryAfter: '0' }, { kind: 'rate-limit', retryAfter: '0' }, openAiOk());
    const error = await rejection(json(config(), { maxRetries: 1 }));
    await settle();
    expect(relay.requests).toHaveLength(2);
    expect(classifyProviderFailure({ error })).toMatchObject({ kind: 'rate-limit', outcome: 'rejected', retry: 'always', status: 429 });
  });

  it('503 "no available channel" moves to the fallback model only when fallbackModels is configured', async () => {
    relay.setHandler(request => request.json?.model === 'primary'
      ? { kind: 'unavailable', noChannel: true, model: 'primary' }
      : openAiOk('{"ok":"backup"}'));
    const result = await json(config({ fallbackModels: ['backup'] }), { maxRetries: 0 });
    expect(models(relay)).toEqual(['primary', 'backup']);
    expect(result).toMatchObject({ json: { ok: 'backup' }, modelUsed: 'backup', modelFallbacks: [{ from: 'primary', to: 'backup', reason: 'model-not-found', status: 503 }] });

    relay.reset();
    relay.setHandler(() => ({ kind: 'unavailable', noChannel: true, model: 'primary' }));
    const error = await rejection(json(config(), { maxRetries: 0 }));
    await settle();
    expect(models(relay)).toEqual(['primary']);
    expect(classifyProviderFailure({ error })).toMatchObject({ kind: 'model-not-found', outcome: 'rejected', retry: 'never', fallback: true, status: 503 });
  });

  it('503 overload is retried on the same model first, then falls back', async () => {
    relay.setHandler(request => request.json?.model === 'primary' ? { kind: 'unavailable' } : openAiOk('{"ok":"backup"}'));
    const result = await json(config({ fallbackModels: ['backup'] }), { maxRetries: 1 });
    expect(models(relay)).toEqual(['primary', 'primary', 'backup']);
    expect(result.modelFallbacks?.[0]).toMatchObject({ reason: 'overloaded', status: 503 });
  });

  it('never falls back after ECONNRESET (outcome unknown)', async () => {
    relay.enqueue({ kind: 'reset' });
    relay.setHandler(() => openAiOk());
    const error = await rejection(json(config({ fallbackModels: ['backup'] }), { maxRetries: 2 }));
    await settle();
    expect(models(relay)).toEqual(['primary']);
    expect(classifyProviderFailure({ error }).outcome).toBe('unknown');
  });

  it('521 is retried (gateway never reached the model); persistent 522 is not-sent', async () => {
    relay.enqueue({ kind: 'cloudflare', status: 521 }, openAiOk());
    expect((await json(config(), { maxRetries: 1 })).json).toEqual({ ok: true });
    expect(relay.requests).toHaveLength(2);

    relay.reset();
    relay.enqueue({ kind: 'cloudflare', status: 522 }, { kind: 'cloudflare', status: 522 }, openAiOk());
    const error = await rejection(json(config(), { maxRetries: 1 }));
    await settle();
    expect(relay.requests).toHaveLength(2);
    expect(classifyProviderFailure({ error })).toMatchObject({ kind: 'gateway', outcome: 'not-sent', retry: 'always', status: 522 });
  });

  it('truncated JSON body (Content-Length mismatch) is a lost transport, not a parse error, and not resent', async () => {
    relay.enqueue({ kind: 'truncated-json', body: openAiOk('{"ok":true,"padding":"' + 'x'.repeat(2000) + '"}').body }, openAiOk());
    const error = await rejection(json(config(), { maxRetries: 2 }));
    await settle();
    expect(relay.requests).toHaveLength(1);
    expect(error.name).not.toBe('LlmJsonParseError');
    expect(classifyProviderFailure({ error })).toMatchObject({ kind: 'transport-lost', outcome: 'unknown' });
  });

  it('slow headers trip the client timeout without an automatic resend', async () => {
    relay.enqueue({ kind: 'slow-headers', delayMs: 1_500 }, openAiOk());
    const started = Date.now();
    const error = await rejection(json(config(), { maxRetries: 2, timeoutMs: 300 }));
    expect(Date.now() - started).toBeLessThan(1_400);
    await settle();
    expect(relay.requests).toHaveLength(1);
    expect(error.message).toMatch(/timed out after 300ms/);
    // Fixed after Q-4: http.ts keeps code NETWORK_TIMEOUT, so the classifier reports an unknown outcome.
    expect(classifyProviderFailure({ error })).toMatchObject({ kind: 'response-timeout', outcome: 'unknown', retry: 'idempotent' });
  });

  // Fixed after Q-4: like the JSON path, the non-streamed text path no longer resends unknown outcomes
  // (reset after delivery, response timeout). Only provably unsent failures are retried.
  it('non-streamed text call does not resend after ECONNRESET or a response timeout (unknown outcomes)', async () => {
    relay.enqueue({ kind: 'reset' }, openAiOk('plain text'));
    const reset = await rejection(text(config(), { maxRetries: 1 }));
    await settle();
    expect(classifyProviderFailure({ error: reset })).toMatchObject({ outcome: 'unknown' });
    expect(relay.requests).toHaveLength(1);

    relay.reset();
    relay.enqueue({ kind: 'slow-headers', delayMs: 1_500 }, { kind: 'slow-headers', delayMs: 1_500 }, openAiOk());
    const error = await rejection(createConfiguredTextLlm(config()).run({ step: 1, name: 'fault', messages, maxRetries: 1, timeoutMs: 300 }));
    await settle();
    expect(error.message).toMatch(/timed out after 300ms/);
    expect(relay.requests).toHaveLength(1);
  });

  it('non-streamed text call retries a connection that was refused (not sent)', async () => {
    const closed = await reserveClosedPort();
    const error = await rejection(text(config({ baseUrl: `http://127.0.0.1:${closed}/v1` }), { maxRetries: 1 }));
    expect(classifyProviderFailure({ error })).toMatchObject({ outcome: 'not-sent', retry: 'always' });
  });

  it.each(['end', 'destroy'] as const)('truncated SSE (%s, no finish_reason/[DONE]) keeps the partial text and is never replayed', async (truncate) => {
    relay.enqueue({
      kind: 'sse',
      truncate,
      events: [
        sseData({ id: 'chatcmpl-stream', choices: [{ index: 0, delta: { content: 'Hello, ' } }] }),
        sseData({ id: 'chatcmpl-stream', choices: [{ index: 0, delta: { content: 'wor' } }] }),
      ],
    }, openAiOk('should not be requested'));
    const error = await rejection(text(config(), { stream: true, maxRetries: 2 }));
    await settle();
    expect(relay.requests).toHaveLength(1);
    expect(relay.requests[0].json).toMatchObject({ stream: true });
    expect(error).toBeInstanceOf(LlmTextInterruptedError);
    expect(error.message).toContain('LLM_STREAM_INTERRUPTED');
    expect((error as LlmTextInterruptedError).result).toMatchObject({ text: 'Hello, wor', requestId: 'chatcmpl-stream' });
  });

  it('a complete SSE stream succeeds', async () => {
    relay.enqueue({
      kind: 'sse',
      events: [
        sseData({ id: 'chatcmpl-stream', choices: [{ index: 0, delta: { content: 'Hello' } }] }),
        sseData({ id: 'chatcmpl-stream', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
        sseData('[DONE]'),
      ],
    });
    const result = await text(config(), { stream: true });
    expect(result).toMatchObject({ text: 'Hello', finishReason: 'stop', requestId: 'chatcmpl-stream' });
    expect(relay.requests).toHaveLength(1);
  });

  it('TLS handshake failure (https:// to a plain TCP listener) delivers no HTTP request and is not resent', async () => {
    const error = await rejection(json(config({ baseUrl: `${tls.origin}/v1` }), { maxRetries: 2 }));
    await settle();
    expect(tls.connections()).toBe(1);
    expect(causeCodes(error)).toContain('ERR_SSL_WRONG_VERSION_NUMBER');
    // Fixed after Q-4: a failed TLS handshake proves no HTTP request was sent.
    expect(classifyProviderFailure({ error })).toMatchObject({ kind: 'connect', outcome: 'not-sent', code: 'ERR_SSL_WRONG_VERSION_NUMBER' });
  });

  it('TLS peer hang-up during the handshake surfaces as ECONNRESET', async () => {
    const hangup = await startTlsBreaker('hangup');
    try {
      const error = await rejection(json(config({ baseUrl: `${hangup.origin}/v1` }), { maxRetries: 2 }));
      await settle();
      expect(hangup.connections()).toBe(1);
      expect(classifyProviderFailure({ error })).toMatchObject({ kind: 'transport-lost', outcome: 'unknown', code: 'ECONNRESET' });
    } finally {
      await hangup.close();
    }
  });
});

describe('LLM over Anthropic Messages', () => {
  const config = (extra: Partial<LlmConfig> = {}): LlmConfig => ({
    provider: 'anthropic',
    apiKey: 'relay-anthropic-key',
    baseUrl: `${relay.origin}/v1`,
    model: 'primary',
    proxyUrl: '',
    timeoutMs: 10_000,
    ...extra,
  });
  const json = (cfg: LlmConfig, extra: { maxRetries?: number } = {}) =>
    createConfiguredJsonLlm(cfg).run({ step: 2, name: 'fault', messages, ...extra });
  const text = (cfg: LlmConfig, extra: { maxRetries?: number; stream?: boolean } = {}) =>
    createConfiguredTextLlm(cfg).run({ step: 2, name: 'fault', messages, ...extra });

  it('round-trips a tool_use JSON response', async () => {
    relay.enqueue(anthropicJsonOk());
    const result = await json(config());
    expect(result.json).toEqual({ ok: true });
    expect(relay.requests[0]).toMatchObject({ url: '/v1/messages' });
    expect(relay.requests[0].headers['x-api-key']).toBe('relay-anthropic-key');
    expect(relay.requests[0].headers['anthropic-version']).toBe('2023-06-01');
  });

  it('524 and ECONNRESET are sent exactly once and never moved to a fallback model', async () => {
    relay.enqueue({ kind: 'cloudflare', status: 524, delayMs: 100 }, anthropicJsonOk());
    const gatewayError = await rejection(json(config({ fallbackModels: ['backup'] }), { maxRetries: 2 }));
    await settle();
    expect(models(relay)).toEqual(['primary']);
    expect(classifyProviderFailure({ error: gatewayError })).toMatchObject({ kind: 'gateway-timeout', outcome: 'unknown' });

    relay.reset();
    relay.enqueue({ kind: 'reset' }, anthropicJsonOk());
    const resetError = await rejection(json(config({ fallbackModels: ['backup'] }), { maxRetries: 2 }));
    await settle();
    expect(models(relay)).toEqual(['primary']);
    expect(classifyProviderFailure({ error: resetError })).toMatchObject({ kind: 'transport-lost', outcome: 'unknown' });
  });

  it('503 no available channel falls back to the next model', async () => {
    relay.setHandler(request => request.json?.model === 'primary' ? { kind: 'unavailable', noChannel: true, model: 'primary' } : anthropicJsonOk());
    const result = await json(config({ fallbackModels: ['backup'] }), { maxRetries: 0 });
    expect(models(relay)).toEqual(['primary', 'backup']);
    expect(result).toMatchObject({ json: { ok: true }, modelUsed: 'backup' });
  });

  it('429 Retry-After is honoured by the text path', async () => {
    relay.enqueue({ kind: 'rate-limit', retryAfter: '1' }, anthropicTextOk('after wait'));
    const result = await text(config(), { maxRetries: 1 });
    expect(result.text).toBe('after wait');
    expect(relay.requests).toHaveLength(2);
    expect(relay.requests[1].receivedAt - relay.requests[0].receivedAt).toBeGreaterThanOrEqual(900);
  });

  it('truncated SSE without message_stop is interrupted, partial text kept, not replayed', async () => {
    relay.enqueue({
      kind: 'sse',
      truncate: 'destroy',
      events: [
        sseData({ type: 'message_start', message: { id: 'msg_stream', usage: { input_tokens: 3 } } }, 'message_start'),
        sseData({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, 'content_block_start'),
        sseData({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial ' } }, 'content_block_delta'),
        sseData({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'answer' } }, 'content_block_delta'),
      ],
    }, anthropicTextOk('should not be requested'));
    const error = await rejection(text(config(), { stream: true, maxRetries: 2 }));
    await settle();
    expect(relay.requests).toHaveLength(1);
    expect(error).toBeInstanceOf(LlmTextInterruptedError);
    expect((error as LlmTextInterruptedError).result).toMatchObject({ text: 'partial answer', requestId: 'msg_stream' });
  });
});

describe('image provider (OpenAI-compatible /images/generations)', () => {
  const scene: StoryboardScene = { id: 1, cap: 'scene', descPrompt: 'a red apple', durationMs: 1200 };
  const prompt: ImagePrompt = { sceneId: 1, cap: 'scene', prompt: 'a red apple', negativePrompt: '', style: 'photo-real', ratio: '1:1', characterProfile: '' };
  const task = { id: 'q4-image', title: 'Q-4', ratio: '1:1', ttsSpeed: 1, speaker: 'voice' } as Task;
  const config = (baseUrl = relay.origin, timeoutMs = 10_000): AppConfig => ({
    ...defaultConfig,
    imageProvider: 'gpt_image',
    gptImage: { ...defaultConfig.gptImage, apiKey: 'relay-image-key', baseUrl, model: 'gpt-image-1', timeoutMs },
  });
  let dir: string;
  beforeEach(async () => { dir = await createTestTempDirectory(join(tmpdir(), 'q4-fault-image-')); });
  afterEach(async () => { await removeTestTempDirectories(dir); });
  const generate = (cfg: AppConfig) => createConfiguredImageGenerator(cfg, dir)([scene], [prompt], task);

  it('saves a normal b64 image', async () => {
    relay.enqueue({ kind: 'json', body: { data: [{ b64_json: Buffer.from('png-bytes').toString('base64') }] } });
    const assets = await generate(config());
    expect(assets).toHaveLength(1);
    expect(relay.requests).toHaveLength(1);
    expect(relay.requests[0].url).toBe('/v1/images/generations');
  });

  it('524 yields IMAGE_RESULT_UNKNOWN: and is never auto-retried', async () => {
    relay.enqueue({ kind: 'cloudflare', status: 524, delayMs: 200 }, { kind: 'json', body: { data: [{ b64_json: 'AA==' }] } });
    const error = await rejection(generate(config()));
    await settle(400);
    expect(relay.requests).toHaveLength(1);
    expect(error.message).toContain('IMAGE_RESULT_UNKNOWN:');
    expect(isImageResultUnknown(error.message)).toBe(true);
    expect(isDefinitiveImageProviderFailure(error.message)).toBe(false);
    expect(classifyProviderFailure({ error })).toMatchObject({ kind: 'gateway-timeout', outcome: 'unknown', status: 524 });
    expect(await readdir(join(dir, 'provider-images'))).toEqual([]);
  });

  it('ECONNRESET after submit is not resent and leaves no receipt', async () => {
    relay.enqueue({ kind: 'reset' }, { kind: 'json', body: { data: [{ b64_json: 'AA==' }] } });
    const error = await rejection(generate(config()));
    await settle();
    expect(relay.requests).toHaveLength(1);
    expect(classifyProviderFailure({ error })).toMatchObject({ kind: 'transport-lost', outcome: 'unknown' });
    expect(await readdir(join(dir, 'provider-images'))).toEqual([]);
  });

  it('429 and 503 no-channel are definitive refusals, sent once', async () => {
    relay.enqueue({ kind: 'rate-limit', retryAfter: '1' });
    const rateError = await rejection(generate(config()));
    expect(relay.requests).toHaveLength(1);
    expect(isDefinitiveImageProviderFailure(rateError.message)).toBe(true);
    expect(classifyProviderFailure({ error: rateError })).toMatchObject({ kind: 'rate-limit', outcome: 'rejected' });

    relay.reset();
    relay.enqueue({ kind: 'json', status: 503, body: { error: { message: 'no available channel for model gpt-image-1 under group default' } } });
    const channelError = await rejection(generate(config()));
    await settle();
    expect(relay.requests).toHaveLength(1);
    expect(channelError.message).toContain('gpt-image-1');
    expect(isDefinitiveImageProviderFailure(channelError.message)).toBe(true);
    expect(classifyProviderFailure({ error: channelError })).toMatchObject({ kind: 'model-not-found', outcome: 'rejected' });
  });

  it('slow headers time out as an unknown image result without a resend', async () => {
    relay.enqueue({ kind: 'slow-headers', delayMs: 1_500 }, { kind: 'json', body: { data: [{ b64_json: 'AA==' }] } });
    const error = await rejection(generate(config(relay.origin, 300)));
    await settle();
    expect(relay.requests).toHaveLength(1);
    expect(error.message).toMatch(/^Image provider request timed out after 300ms/);
    expect(isImageResultUnknown(error.message)).toBe(true);
  });

  it('TLS handshake failure reaches the listener once and produces no HTTP request', async () => {
    const error = await rejection(generate(config(tls.origin)));
    await settle();
    expect(tls.connections()).toBe(1);
    expect(causeCodes(error)).toContain('ERR_SSL_WRONG_VERSION_NUMBER');
    // The handshake failure is classified as not sent; the image path still makes a single attempt.
    expect(classifyProviderFailure({ error })).toMatchObject({ kind: 'connect', outcome: 'not-sent' });
  });
});

describe('TTS (Volcengine V3 endpoint on the relay)', () => {
  const task = { id: 'q4-tts', title: 'Q-4', ratio: '9:16', ttsSpeed: 1, speaker: 'voice' } as Task;
  const scene: StoryboardScene = { id: 1, cap: '第一段旁白。', descPrompt: 'scene', durationMs: 1200 };
  const config = (): AppConfig => {
    const endpoint = `${relay.origin}/api/v3/tts/unidirectional`;
    return {
      ...defaultConfig,
      tts: {
        ...defaultConfig.tts,
        provider: 'volcengine',
        volcengine: { ...defaultConfig.tts.volcengine, apiVersion: 'v3', apiKey: 'relay-tts-key', resourceId: 'seed-tts-2.0', speaker: 'test-speaker', endpoint, v3Endpoint: endpoint },
      },
    };
  };
  const audioOk = () => ({
    kind: 'ndjson' as const,
    lines: [
      JSON.stringify({ code: 0, data: Buffer.from('audio').toString('base64') }),
      JSON.stringify({ code: 20000000, message: 'ok', data: null }),
    ],
  });
  let dir: string;
  beforeEach(async () => { dir = await createTestTempDirectory(join(tmpdir(), 'q4-fault-tts-')); });
  afterEach(async () => { await removeTestTempDirectories(dir); });
  const synthesize = (maxAttempts = 3) => createConfiguredNarrationSynthesizer(config(), dir, {
    concurrency: 1,
    retry: { maxAttempts, baseMs: 20, random: () => 0.5, onRetry: () => undefined },
  })([scene], task);

  it('retries ECONNRESET with a fresh request id and succeeds', async () => {
    relay.enqueue({ kind: 'reset' }, audioOk());
    const assets = await synthesize();
    expect(assets).toHaveLength(1);
    expect(relay.requests).toHaveLength(2);
    expect(relay.requests[0].url).toBe('/api/v3/tts/unidirectional');
    expect(relay.requests[0].headers['x-api-key']).toBe('relay-tts-key');
    expect(relay.requests[0].headers['x-api-request-id']).not.toBe(relay.requests[1].headers['x-api-request-id']);
    expect(relay.requests[0].body).toBe(relay.requests[1].body);
  });

  it('persistent ECONNRESET stops at maxAttempts', async () => {
    relay.enqueue({ kind: 'reset' }, { kind: 'reset' }, { kind: 'reset' }, audioOk());
    const error = await rejection(synthesize(3));
    expect(relay.requests).toHaveLength(3);
    expect(classifyTtsFailure(error)).toMatchObject({ kind: 'transport-lost' });
  });

  it('401 is not retried', async () => {
    relay.enqueue({ kind: 'json', status: 401, body: { message: 'invalid api key' } }, audioOk());
    const error = await rejection(synthesize());
    await settle();
    expect(relay.requests).toHaveLength(1);
    expect(classifyTtsFailure(error)).toMatchObject({ kind: 'auth', retry: 'never', status: 401 });
  });

  it('429 Retry-After: 1 delays the retry by at least a second', async () => {
    relay.enqueue({ kind: 'rate-limit', retryAfter: '1' }, audioOk());
    await synthesize();
    expect(relay.requests).toHaveLength(2);
    const gap = relay.requests[1].receivedAt - relay.requests[0].receivedAt;
    expect(gap).toBeGreaterThanOrEqual(900);
    expect(gap).toBeLessThan(5_000);
  });

  it('524 is retried for TTS (idempotent re-synthesis)', async () => {
    relay.enqueue({ kind: 'cloudflare', status: 524, delayMs: 50 }, audioOk());
    expect(await synthesize()).toHaveLength(1);
    expect(relay.requests).toHaveLength(2);
  });

  it('a 200 stream cut before the completion frame is TTS_RESPONSE_INCOMPLETE and not resubmitted', async () => {
    relay.enqueue({ kind: 'ndjson', truncate: 'end', lines: [JSON.stringify({ code: 0, data: Buffer.from('half').toString('base64') })] }, audioOk());
    const error = await rejection(synthesize());
    await settle();
    expect(relay.requests).toHaveLength(1);
    expect(error.message).toContain('TTS_RESPONSE_INCOMPLETE');
    expect(classifyTtsFailure(error)).toMatchObject({ retry: 'never' });
  });
});
