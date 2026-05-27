import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenAiCompatibleJsonLlm, listOpenAiCompatibleModels, LlmJsonParseError, testOpenAiCompatibleLlm } from '@shared/llm-provider';
import { defaultConfig } from '@shared/config';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAI-compatible LLM JSON adapter', () => {
  it('posts chat messages and parses strict JSON content', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown>; auth: string | null }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        requests.push({
          url,
          body: JSON.parse(String(init.body)),
          auth: new Headers(init.headers).get('Authorization'),
        });
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"reviewedText":"clean"}' } }], id: 'chatcmpl-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    const runJson = createOpenAiCompatibleJsonLlm({
      ...defaultConfig.llm,
      apiKey: 'llm-key',
      baseUrl: 'https://llm.example',
      model: 'model-a',
    });
    const result = await runJson({
      step: 0,
      name: 'review',
      messages: [{ role: 'user', content: 'clean this' }],
    });

    expect(result.json).toEqual({ reviewedText: 'clean' });
    expect(result.raw).toBe('{"reviewedText":"clean"}');
    expect(result.requestId).toBe('chatcmpl-1');
    expect(requests[0].url).toBe('https://llm.example/v1/chat/completions');
    expect(requests[0].auth).toBe('Bearer llm-key');
    expect(requests[0].body).toMatchObject({
      model: 'model-a',
      response_format: { type: 'json_object' },
    });
  });

  it('throws with the raw response when the model does not return JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }], id: 'chatcmpl-bad' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const runJson = createOpenAiCompatibleJsonLlm({ ...defaultConfig.llm, apiKey: 'llm-key' });

    await expect(
      runJson({
        step: 1,
        name: 'rewrite',
        messages: [{ role: 'user', content: 'rewrite this' }],
      }),
    ).rejects.toBeInstanceOf(LlmJsonParseError);
    await expect(
      runJson({
        step: 1,
        name: 'rewrite',
        messages: [{ role: 'user', content: 'rewrite this' }],
      }),
    ).rejects.toMatchObject({ rawResponse: 'not json' });
  });

  it('tests whether the configured model can answer a JSON probe', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown>; auth: string | null }> = [];
    const result = await testOpenAiCompatibleLlm(
      { ...defaultConfig.llm, apiKey: 'llm-key', baseUrl: 'https://llm.example', model: 'model-a' },
      async (url, init) => {
        requests.push({
          url: String(url),
          body: JSON.parse(String(init?.body)),
          auth: new Headers(init?.headers).get('Authorization'),
        });
        return new Response(JSON.stringify({ id: 'probe-1', choices: [{ message: { content: '{"ok":true}' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    );

    expect(result.status).toBe('pass');
    expect(result.detail).toContain('model-a');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(requests[0].url).toBe('https://llm.example/v1/chat/completions');
    expect(requests[0].auth).toBe('Bearer llm-key');
    expect(requests[0].body).toMatchObject({ model: 'model-a', response_format: { type: 'json_object' } });
  });

  it('reports missing LLM credentials without calling the network', async () => {
    let called = false;
    const result = await testOpenAiCompatibleLlm({ ...defaultConfig.llm, apiKey: '' }, async () => {
      called = true;
      return new Response('{}');
    });

    expect(called).toBe(false);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('API key');
  });

  it('fetches selectable models from the configured OpenAI-compatible base URL', async () => {
    const requests: Array<{ url: string; method: string | undefined; auth: string | null }> = [];
    const result = await listOpenAiCompatibleModels(
      { baseUrl: 'https://llm.example', apiKey: 'llm-key' },
      async (url, init) => {
        requests.push({
          url: String(url),
          method: init?.method,
          auth: new Headers(init?.headers).get('Authorization'),
        });
        return new Response(
          JSON.stringify({
            data: [
              { id: 'model-a', created: 1710000000, owned_by: 'provider' },
              { id: 'model-b' },
            ],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      },
    );

    expect(result.status).toBe('pass');
    expect(result.endpoint).toBe('https://llm.example/v1/models');
    expect(result.models).toEqual([
      { id: 'model-a', created: 1710000000, ownedBy: 'provider' },
      { id: 'model-b', created: undefined, ownedBy: undefined },
    ]);
    expect(requests[0]).toEqual({
      url: 'https://llm.example/v1/models',
      method: 'GET',
      auth: 'Bearer llm-key',
    });
  });

  it('reports missing model-list credentials without calling the network', async () => {
    let called = false;
    const result = await listOpenAiCompatibleModels({ baseUrl: 'https://llm.example', apiKey: '' }, async () => {
      called = true;
      return new Response('{}');
    });

    expect(called).toBe(false);
    expect(result.status).toBe('fail');
    expect(result.models).toEqual([]);
    expect(result.detail).toContain('API key');
  });
});
