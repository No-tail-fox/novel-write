import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig } from '../src/shared/config';
import { normalizeAppConfig, validateConfigTarget } from '../src/shared/config-utils';
import { ipcInputSchemas } from '../src/shared/ipc-contract';
import { LLM_PROTOCOLS, llmEndpoint, resolveLlmProtocol } from '../src/shared/llm-protocol';
import { createConfiguredJsonLlm, createConfiguredTextLlm, listConfiguredProviderModels, LlmJsonParseError, testConfiguredLlm } from '../src/shared/llm-provider';
import { activateSelectedProviderProfileForTarget, buildConfigForSelectedProfileTest, copyLlmProfile, editableLlmProfileProvider, normalizeEditableConfigProviders, saveLlmProfile } from '../src/shared/provider-profile-utils';
import { createViralRuntimeProviders } from '../src/shared/viral-runtime';

const profile = { ...defaultConfig.llm, id: 'custom-protocol', provider: 'custom', protocol: 'responses' as const, apiKey: 'test-key', baseUrl: 'https://llm.example/relay/v1/', model: 'test-model' };
const request = { step: 1, name: 'protocol-test', messages: [{ role: 'system' as const, content: 'Return JSON.' }, { role: 'user' as const, content: 'Test' }] };
const responseBody = (text = '{"ok":true}') => ({ id: 'resp-test', status: 'completed', output: [
  { type: 'reasoning', summary: [] },
  { type: 'message', content: [{ type: 'output_text', text }] },
] });

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('LLM protocol persistence', () => {
  it.each(LLM_PROTOCOLS)('preserves custom %s through edit/save/copy/activate/test normalization', (protocol) => {
    const selected = { ...profile, protocol };
    let config = normalizeAppConfig({ ...defaultConfig, llm: selected, llmProfiles: [selected], activeLlmProfileId: selected.id });
    config = normalizeEditableConfigProviders(saveLlmProfile(config, { ...selected, name: 'Protocol test' }));
    config = copyLlmProfile(config, selected.id);
    const copied = config.llmProfiles.find((item) => item.id !== selected.id)!;
    expect(copied).toMatchObject({ protocol, provider: 'custom', apiKey: 'test-key', model: selected.model, baseUrl: selected.baseUrl });
    expect(editableLlmProfileProvider(copied)).toBe('custom');
    for (const build of [buildConfigForSelectedProfileTest, activateSelectedProviderProfileForTarget]) {
      const result = normalizeAppConfig(build(config, 'llm', { llm: copied.id }));
      expect(result.llm).toMatchObject({ protocol, provider: 'custom', id: copied.id });
      expect(validateConfigTarget('llm', result).endpoint).toBe(llmEndpoint(copied));
    }
    const restored = normalizeAppConfig(JSON.parse(JSON.stringify(config)));
    expect(restored.llm.protocol).toBe(protocol);
    expect(restored.llmProfiles.every((item) => item.protocol === protocol)).toBe(true);
  });

  it('retains legacy defaults and official provider behavior', () => {
    expect(resolveLlmProtocol({ provider: 'custom' })).toBe('openai');
    expect(resolveLlmProtocol({ provider: 'anthropic' })).toBe('anthropic');
    expect(resolveLlmProtocol({ provider: 'openai', protocol: 'responses' })).toBe('responses');
    expect(llmEndpoint({ provider: 'custom', protocol: 'responses', baseUrl: 'https://llm.example/relay/' })).toBe('https://llm.example/relay/v1/responses');
  });

  it.each(LLM_PROTOCOLS)('validates %s at both strict IPC boundaries', (protocol) => {
    expect(ipcInputSchemas['llm:test-config'].parse({ ...profile, protocol }).protocol).toBe(protocol);
    expect(ipcInputSchemas['models:list'].parse({ protocol, baseUrl: profile.baseUrl, apiKey: '' }).protocol).toBe(protocol);
    expect(() => ipcInputSchemas['llm:test-config'].parse({ ...profile, protocol: 'unknown' })).toThrow();
  });
});

describe('Responses generation adapter', () => {
  it('uses Responses input/text format and never sends stale Chat or conversation fields', async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({ model: profile.model, input: request.messages, text: { format: { type: 'json_object' }, verbosity: 'low' }, max_output_tokens: 8192, reasoning: { effort: 'high' }, stream: false, store: false, background: false });
      for (const key of ['messages', 'response_format', 'max_tokens', 'max_completion_tokens', 'reasoning_effort', 'stream_options', 'previous_response_id', 'conversation', 'tools', 'tool_choice']) expect(body).not.toHaveProperty(key);
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test-key');
      return Response.json(responseBody());
    });
    vi.stubGlobal('fetch', fetcher);
    const llm = createConfiguredJsonLlm({ ...profile, requestParamsJson: JSON.stringify({ model: 'wrong', messages: [], input: [], max_tokens: 20, max_completion_tokens: 4096, max_output_tokens: 8192, reasoning_effort: 'high', response_format: { type: 'text' }, text: { verbosity: 'low' }, stream: true, store: true, background: true, previous_response_id: 'old', conversation: 'old', tools: [], tool_choice: 'auto', stream_options: {} }) });
    expect(llm.protocol).toBe('responses');
    expect(await llm.run(request)).toEqual({ json: { ok: true }, raw: '{"ok":true}', requestId: 'resp-test' });
    expect(fetcher.mock.calls[0][0]).toBe('https://llm.example/relay/v1/responses');
  });

  it('joins output_text parts while ignoring reasoning and honors text overrides', async () => {
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toMatchObject({ max_output_tokens: 500, temperature: 0.4, text: { format: { type: 'text' } } });
      return Response.json({ ...responseBody(), output: [{ type: 'reasoning', content: [{ type: 'output_text', text: 'ignore' }] }, { type: 'message', content: [{ type: 'output_text', text: 'part one ' }, { type: 'output_text', text: 'part two' }] }] });
    });
    const result = await createConfiguredTextLlm({ ...profile, requestParamsJson: '{"max_tokens":20,"temperature":1}' }).run({ ...request, maxTokens: 500, temperature: 0.4, maxRetries: 0 });
    expect(result.text).toBe('part one part two');
  });

  it.each([{ jsonRoot: 'array' as const }, { jsonMode: 'none' as const }])('does not force object mode for %j', async (options) => {
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body)).text.format).toEqual({ type: 'text' });
      return Response.json(responseBody('[1,2]'));
    });
    expect((await createConfiguredJsonLlm(profile).run({ ...request, ...options })).json).toEqual([1, 2]);
  });

  it.each(['{"ok": true', 'not JSON', ''])('rejects malformed/empty JSON without repairing it: %s', async (raw) => {
    vi.stubGlobal('fetch', async () => Response.json(responseBody(raw)));
    await expect(createConfiguredJsonLlm(profile).run(request)).rejects.toBeInstanceOf(LlmJsonParseError);
  });

  it.each([
    { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
    { status: 'incomplete', incomplete_details: { reason: 'content_filter' } },
    { status: 'failed', error: { message: 'upstream failed' } },
    { status: 'queued' },
    { output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'refused' }, { type: 'output_text', text: '{"ok":true}' }] }] },
  ])('rejects non-final/refused output even when it contains valid JSON: %j', async (extra) => {
    vi.stubGlobal('fetch', async () => Response.json({ ...responseBody(), ...extra }));
    await expect(createConfiguredJsonLlm(profile).run(request)).rejects.toThrow();
    await expect(createConfiguredTextLlm(profile).run(request)).rejects.toThrow();
    const test = await testConfiguredLlm(profile);
    expect(test.status).not.toBe('pass');
    expect(test.requestId).toBe('resp-test');
  });

  it('retries transient errors on the same protocol', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('busy', { status: 429 })).mockImplementation(async () => Response.json(responseBody()));
    vi.stubGlobal('fetch', fetcher);
    const result = createConfiguredJsonLlm(profile).run(request);
    await vi.advanceTimersByTimeAsync(501);
    expect((await result).json).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every((call) => String(call[0]).endsWith('/responses'))).toBe(true);
  });

  it('does not fallback to Chat Completions when Responses is unsupported', async () => {
    const fetcher = vi.fn(async () => new Response('unsupported', { status: 404 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(createConfiguredJsonLlm(profile).run(request)).rejects.toThrow('404');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('honors cancellation and per-text timeout', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(createConfiguredTextLlm(profile).run({ ...request, signal: controller.signal, maxRetries: 0 })).rejects.toThrow('cancelled');
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));
    const result = expect(createConfiguredTextLlm(profile).run({ ...request, timeoutMs: 50, maxRetries: 0 })).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(51);
    await result;
  });
});

describe('Responses settings probes', () => {
  it('uses a non-streaming 1024 output-token probe without changing generation settings', async () => {
    const test = await testConfiguredLlm({ ...profile, requestParamsJson: '{"max_output_tokens":32768,"max_tokens":20,"stream":true}' }, async (url, init) => {
      expect(String(url)).toBe('https://llm.example/relay/v1/responses');
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ max_output_tokens: 1024, stream: false, store: false, text: { format: { type: 'json_object' } } });
      expect(body).not.toHaveProperty('max_tokens');
      expect(body).not.toHaveProperty('max_completion_tokens');
      return Response.json(responseBody());
    });
    expect(test.status).toBe('pass');
  });

  it.each(['', '{"ok": true', '{"ok":false}', '[{"ok":true}]'])('warns on invalid probe confirmation: %s', async (text) => {
    expect((await testConfiguredLlm(profile, async () => Response.json(responseBody(text)))).status).toBe('warn');
  });

  it('uses Bearer authentication and /models for Responses model listing', async () => {
    const result = await listConfiguredProviderModels(profile, async (url, init) => {
      expect(String(url)).toBe('https://llm.example/relay/v1/models');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-key');
      return Response.json({ data: [{ id: profile.model }] });
    });
    expect(result.status).toBe('pass');
  });
});

describe('configured frame vision protocol', () => {
  it.each(['responses', 'anthropic'] as const)('sends images with %s instead of Chat Completions', async (protocol) => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-protocol-'));
    const framePath = join(dir, 'frame.png');
    await writeFile(framePath, 'qa-image');
    try {
      vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
        expect(String(url)).toBe(llmEndpoint({ ...profile, protocol }));
        const body = JSON.parse(String(init.body));
        if (protocol === 'responses') {
          expect(body.input[1].content[1]).toMatchObject({ type: 'input_image', image_url: 'data:image/png;base64,cWEtaW1hZ2U=' });
          return Response.json(responseBody('{"visualDescription":"frame"}'));
        }
        expect(new Headers(init.headers).get('x-api-key')).toBe('test-key');
        expect(body.messages[0].content[1]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'cWEtaW1hZ2U=' } });
        return Response.json({ content: [{ type: 'text', text: '{"visualDescription":"frame"}' }], stop_reason: 'end_turn' });
      });
      const config = { ...defaultConfig, llm: { ...profile, protocol }, viral: { ...defaultConfig.viral, vision: { ...defaultConfig.viral.vision, apiKey: '' } } };
      const result = await createViralRuntimeProviders(config, dir).analyzeFrame({ timestamp: 0, framePath }, null, { title: 'Test frame' } as never);
      expect(result.visualDescription).toBe('frame');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
