import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createConfiguredJsonLlm,
  createConfiguredTextLlm,
  createOpenAiCompatibleJsonLlm,
  createOpenAiCompatibleTextLlm,
  listConfiguredProviderModels,
  listOpenAiCompatibleModels,
  LlmJsonParseError,
  testConfiguredLlm,
  testOpenAiCompatibleLlm,
} from '@shared/llm-provider';
import { defaultConfig } from '@shared/config';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('OpenAI-compatible LLM JSON adapter', () => {
  it('posts Storybound-style direct text chat requests without JSON mode', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown>; auth: string | null }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        requests.push({
          url,
          body: JSON.parse(String(init.body)),
          auth: new Headers(init.headers).get('Authorization'),
        });
        return new Response(JSON.stringify({ choices: [{ message: { content: '直接输出的口播稿' } }], id: 'chatcmpl-text-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    const runText = createOpenAiCompatibleTextLlm({
      ...defaultConfig.llm,
      apiKey: 'llm-key',
      baseUrl: 'https://llm.example',
      model: 'model-a',
      requestParamsJson: '{"reasoning_effort":"medium"}',
    });
    const result = await runText({
      step: 0,
      name: 'research-copy',
      temperature: 0.8,
      maxTokens: 32768,
      timeoutMs: 90_000,
      maxRetries: 2,
      messages: [
        { role: 'system', content: 'Storybound system prompt' },
        { role: 'user', content: 'Storybound user prompt' },
      ],
    });

    expect(result).toEqual({ text: '直接输出的口播稿', raw: '直接输出的口播稿', requestId: 'chatcmpl-text-1' });
    expect(requests[0].url).toBe('https://llm.example/v1/chat/completions');
    expect(requests[0].auth).toBe('Bearer llm-key');
    expect(requests[0].body).toMatchObject({
      model: 'model-a',
      messages: [
        { role: 'system', content: 'Storybound system prompt' },
        { role: 'user', content: 'Storybound user prompt' },
      ],
      temperature: 0.8,
      max_tokens: 32768,
      reasoning_effort: 'medium',
    });
    expect(requests[0].body).not.toHaveProperty('response_format');
    expect(requests[0].body).not.toHaveProperty('tools');
  });

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

  it('allows root JSON arrays without forcing object response format', async () => {
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ choices: [{ message: { content: '["第一段。","第二段。"]' } }], id: 'chatcmpl-array' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    const runJson = createOpenAiCompatibleJsonLlm({ ...defaultConfig.llm, apiKey: 'llm-key' });
    const result = await runJson<string[]>({
      step: 2,
      name: 'storyboard',
      jsonRoot: 'array',
      messages: [{ role: 'user', content: 'return tail anchors' }],
    });

    expect(result.json).toEqual(['第一段。', '第二段。']);
    expect(requests[0]).not.toHaveProperty('response_format');
    expect(requests[0]).not.toHaveProperty('tools');
    expect(requests[0]).not.toHaveProperty('tool_choice');
  });

  it('can retry a JSON task without response_format for compatible providers', async () => {
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"scenes":[]}' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    const runJson = createOpenAiCompatibleJsonLlm({ ...defaultConfig.llm, apiKey: 'llm-key' });
    await runJson({
      step: 1,
      name: 'html-video-planning',
      jsonMode: 'none',
      messages: [{ role: 'user', content: 'plan scenes' }],
    });

    expect(requests[0]).not.toHaveProperty('response_format');
    expect(requests[0]).not.toHaveProperty('tools');
    expect(requests[0]).not.toHaveProperty('tool_choice');
  });

  it('merges per-profile request params json into chat completions payload', async () => {
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], id: 'chatcmpl-json' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    const runJson = createOpenAiCompatibleJsonLlm({
      ...defaultConfig.llm,
      apiKey: 'llm-key',
      requestParamsJson: '{"reasoning_effort":"medium"}',
    });

    await runJson({
      step: 0,
      name: 'rewrite',
      messages: [{ role: 'user', content: 'rewrite this' }],
    });

    expect(requests[0]).toMatchObject({
      model: defaultConfig.llm.model,
      response_format: { type: 'json_object' },
    });
    expect(requests[0]).toMatchObject({
      reasoning_effort: 'medium',
    });
  });

  it('does not leak Anthropic tool options into OpenAI-compatible requests', async () => {
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], id: 'chatcmpl-separated' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    const runJson = createOpenAiCompatibleJsonLlm({
      ...defaultConfig.llm,
      apiKey: 'llm-key',
      requestParamsJson: '{"temperature":0}',
    });

    await runJson({
      step: 1,
      name: 'rewrite-round-1',
      messages: [{ role: 'user', content: 'rewrite this' }],
      anthropic: {
        toolInputSchema: {
          type: 'object',
          required: ['cover'],
          properties: { cover: { type: 'object' } },
        },
      },
    } as unknown as Parameters<typeof runJson>[0]);

    expect(requests[0]).toMatchObject({
      model: defaultConfig.llm.model,
      response_format: { type: 'json_object' },
      temperature: 0,
    });
    expect(requests[0]).not.toHaveProperty('tools');
    expect(requests[0]).not.toHaveProperty('tool_choice');
    expect(JSON.stringify(requests[0])).not.toContain('input_schema');
  });

  it('parses JSON wrapped in markdown fences from compatible providers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"reviewedText":"clean"}\n```' } }], id: 'chatcmpl-fenced' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const runJson = createOpenAiCompatibleJsonLlm({ ...defaultConfig.llm, apiKey: 'llm-key' });
    const result = await runJson<{ reviewedText: string }>({
      step: 0,
      name: 'review',
      messages: [{ role: 'user', content: 'clean this' }],
    });

    expect(result.json).toEqual({ reviewedText: 'clean' });
    expect(result.raw).toBe('```json\n{"reviewedText":"clean"}\n```');
    expect(result.requestId).toBe('chatcmpl-fenced');
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

  it('uses the configured LLM timeout for JSON calls', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init.signal as AbortSignal;
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          }),
      ),
    );

    const runJson = createOpenAiCompatibleJsonLlm({ ...defaultConfig.llm, apiKey: 'llm-key', timeoutMs: 5 });
    const pending = runJson({
      step: 3,
      name: 'image-prompts',
      messages: [{ role: 'user', content: 'slow' }],
    });

    const expectation = expect(pending).rejects.toThrow('LLM step 3 image-prompts timed out after 5ms.');
    await vi.advanceTimersByTimeAsync(120_000);

    await expectation;
  });

  it('rejects an oversized provider response before parsing JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'content-length': String(8 * 1024 * 1024 + 1),
          },
        }),
      ),
    );
    const runJson = createOpenAiCompatibleJsonLlm({
      ...defaultConfig.llm,
      apiKey: 'llm-key',
      baseUrl: 'https://llm.example',
    });

    await expect(
      runJson({
        step: 1,
        name: 'bounded-response',
        messages: [{ role: 'user', content: 'return json' }],
      }),
    ).rejects.toThrow(/byte|large|limit|大小|上限/i);
  });

  it('retries transient upstream failures before parsing JSON content', async () => {
    let attempts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        attempts += 1;
        if (attempts < 3) {
          return new Response(JSON.stringify({ error: { message: 'Upstream service temporarily unavailable', type: 'upstream_error' } }), {
            status: 502,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"imagePrompts":[]}' } }], id: 'chatcmpl-retry' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    const runJson = createOpenAiCompatibleJsonLlm({ ...defaultConfig.llm, apiKey: 'llm-key', baseUrl: 'https://llm.example' });
    const result = await runJson<{ imagePrompts: unknown[] }>({
      step: 3,
      name: 'image-prompts',
      messages: [{ role: 'user', content: 'make prompts' }],
    });

    expect(result.json).toEqual({ imagePrompts: [] });
    expect(result.requestId).toBe('chatcmpl-retry');
    expect(attempts).toBe(3);
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

  it('passes model tests when JSON probe responses are wrapped in markdown fences', async () => {
    const result = await testOpenAiCompatibleLlm(
      { ...defaultConfig.llm, apiKey: 'llm-key', baseUrl: 'https://llm.example', model: 'model-a' },
      async () =>
        new Response(JSON.stringify({ id: 'probe-fenced', choices: [{ message: { content: '```json\n{"ok":true}\n```' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );

    expect(result.status).toBe('pass');
    expect(result.requestId).toBe('probe-fenced');
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

describe('Anthropic Messages LLM JSON adapter', () => {
  it('posts Storybound-style direct text requests to Anthropic without tool JSON', async () => {
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return new Response(
          JSON.stringify({
            id: 'msg_text',
            content: [{ type: 'text', text: '直接输出的口播稿' }],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }),
    );

    const runText = createConfiguredTextLlm({
      ...defaultConfig.llm,
      provider: 'anthropic',
      protocol: 'anthropic',
      apiKey: 'anthropic-key',
      baseUrl: 'https://code.newcli.com/claude/ultra',
      model: 'claude-sonnet-4-5-20250929',
      requestParamsJson: '{"temperature":0.8}',
    });
    const result = await runText.run({
      step: 0,
      name: 'research-copy',
      temperature: 0.8,
      maxTokens: 32768,
      maxRetries: 2,
      messages: [
        { role: 'system', content: 'Storybound system prompt' },
        { role: 'user', content: 'Storybound user prompt' },
      ],
    });

    expect(result).toEqual({ text: '直接输出的口播稿', raw: '直接输出的口播稿', requestId: 'msg_text' });
    expect(requests[0]).toMatchObject({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 32768,
      temperature: 0.8,
      system: 'Storybound system prompt',
      messages: [{ role: 'user', content: 'Storybound user prompt' }],
    });
    expect(requests[0]).not.toHaveProperty('tools');
    expect(requests[0]).not.toHaveProperty('tool_choice');
  });

  it('posts messages with Anthropic headers and parses text content JSON', async () => {
    const requests: Array<{
      url: string;
      body: Record<string, unknown>;
      apiKey: string | null;
      version: string | null;
      auth: string | null;
    }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const headers = new Headers(init.headers);
        requests.push({
          url,
          body: JSON.parse(String(init.body)),
          apiKey: headers.get('x-api-key'),
          version: headers.get('anthropic-version'),
          auth: headers.get('Authorization'),
        });
        return new Response(
          JSON.stringify({
            id: 'msg_1',
            content: [{ type: 'text', text: '```json\n{"reviewedText":"clean"}\n```' }],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }),
    );

    const runJson = createConfiguredJsonLlm({
      ...defaultConfig.llm,
      provider: 'anthropic',
      protocol: 'anthropic',
      apiKey: 'anthropic-key',
      baseUrl: 'https://code.newcli.com/claude/ultra',
      model: 'claude-sonnet-4-5-20250929',
      requestParamsJson: '{"temperature":0}',
    });
    const result = await runJson.run({
      step: 0,
      name: 'review',
      messages: [
        { role: 'system', content: 'Return strict JSON only.' },
        { role: 'user', content: 'clean this' },
      ],
    });

    expect(result.json).toEqual({ reviewedText: 'clean' });
    expect(result.raw).toBe('```json\n{"reviewedText":"clean"}\n```');
    expect(result.requestId).toBe('msg_1');
    expect(requests[0].url).toBe('https://code.newcli.com/claude/ultra/v1/messages');
    expect(requests[0].apiKey).toBe('anthropic-key');
    expect(requests[0].version).toBe('2023-06-01');
    expect(requests[0].auth).toBeNull();
    expect(requests[0].body).toMatchObject({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      temperature: 0,
      system: 'Return strict JSON only.',
      messages: [{ role: 'user', content: 'clean this' }],
    });
  });

  it('repairs Anthropic fenced JSON when a long copy string contains literal line breaks', async () => {
    const raw = [
      '```json',
      '{',
      '  "title": "贫穷少年到韩国总统：李明博的《经营未来》",',
      '  "copy": "有一种人生，让你读完之后，只想沉默很久。',
      '',
      '李明博的故事，就是这样一种人生。',
      '',
      '---',
      '',
      '**一、贫穷，是他最初的老师**"',
      '}',
      '```',
    ].join('\n');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            id: 'msg_research',
            content: [{ type: 'text', text: raw }],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      ),
    );

    const runJson = createConfiguredJsonLlm({
      ...defaultConfig.llm,
      provider: 'anthropic',
      protocol: 'anthropic',
      apiKey: 'anthropic-key',
      baseUrl: 'https://code.newcli.com/claude/ultra',
      model: 'claude-sonnet-4-5-20250929',
    });
    const result = await runJson.run<{ title: string; copy: string }>({
      step: 0,
      name: 'research-copy',
      messages: [{ role: 'user', content: 'write source copy' }],
    });

    expect(result.json.title).toBe('贫穷少年到韩国总统：李明博的《经营未来》');
    expect(result.json.copy).toContain('李明博的故事，就是这样一种人生。');
    expect(result.json.copy).toContain('**一、贫穷，是他最初的老师**');
    expect(result.requestId).toBe('msg_research');
  });

  it('requests Anthropic tool use for JSON and parses tool input directly', async () => {
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return new Response(
          JSON.stringify({
            id: 'msg_tool',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_1',
                name: 'return_json',
                input: {
                  title: '从捡废品到总统再到囚徒——李明博的魔幻人生',
                  copy: '1941年，他出生在日本大阪。\\n\\n少年时的李明博，靠捡酒瓶、卖爆米花凑齐了学费。',
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }),
    );

    const runJson = createConfiguredJsonLlm({
      ...defaultConfig.llm,
      provider: 'anthropic',
      protocol: 'anthropic',
      apiKey: 'anthropic-key',
      baseUrl: 'https://code.newcli.com/claude/ultra',
      model: 'claude-sonnet-4-5-20250929',
    });
    const result = await runJson.run<{ title: string; copy: string }>({
      step: 0,
      name: 'research-copy',
      messages: [{ role: 'user', content: 'write source copy' }],
    });

    expect(result.json.title).toBe('从捡废品到总统再到囚徒——李明博的魔幻人生');
    expect(result.json.copy).toContain('捡酒瓶');
    expect(result.raw).toContain('李明博');
    expect(result.requestId).toBe('msg_tool');
    expect(requests[0].tool_choice).toEqual({ type: 'tool', name: 'return_json' });
    expect(requests[0].tools).toEqual([
      {
        name: 'return_json',
        description: 'Return the final answer as a JSON object.',
        input_schema: { type: 'object', properties: {}, additionalProperties: true },
      },
    ]);
  });

  it('allows Anthropic root JSON arrays without forcing an object tool', async () => {
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return new Response(
          JSON.stringify({
            id: 'msg_array',
            content: [{ type: 'text', text: '["第一段。","第二段。"]' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );

    const runJson = createConfiguredJsonLlm({
      ...defaultConfig.llm,
      provider: 'anthropic',
      protocol: 'anthropic',
      apiKey: 'anthropic-key',
      model: 'claude-sonnet-4-5-20250929',
    });
    const result = await runJson.run<string[]>({
      step: 2,
      name: 'storyboard',
      jsonRoot: 'array',
      messages: [
        { role: 'system', content: 'Return a JSON string array.' },
        { role: 'user', content: 'split this copy' },
      ],
    });

    expect(result.json).toEqual(['第一段。', '第二段。']);
    expect(requests[0]).toMatchObject({ system: 'Return a JSON string array.' });
    expect(requests[0]).not.toHaveProperty('tools');
    expect(requests[0]).not.toHaveProperty('tool_choice');
    expect(requests[0]).not.toHaveProperty('response_format');
  });

  it('uses Anthropic-specific tool input schema for Anthropic requests', async () => {
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return new Response(
          JSON.stringify({
            id: 'msg_schema',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_schema',
                name: 'return_json',
                input: {
                  rewrittenCopy: 'copy',
                  cover: { title: 'Title', subtitle: [], summary: '', tags: [], comments: [] },
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }),
    );
    const rewriteSchema = {
      type: 'object',
      required: ['rewrittenCopy', 'cover'],
      properties: {
        rewrittenCopy: { type: 'string' },
        cover: {
          type: 'object',
          required: ['title'],
          properties: {
            title: { type: 'string' },
          },
        },
      },
    };

    const runJson = createConfiguredJsonLlm({
      ...defaultConfig.llm,
      provider: 'anthropic',
      protocol: 'anthropic',
      apiKey: 'anthropic-key',
      baseUrl: 'https://code.newcli.com/claude/ultra',
      model: 'claude-sonnet-4-5-20250929',
    });
    const result = await runJson.run<{ rewrittenCopy: string; cover: { title: string } }>({
      step: 1,
      name: 'rewrite-round-1',
      messages: [{ role: 'user', content: 'rewrite this' }],
      anthropic: { toolInputSchema: rewriteSchema },
    });

    expect(result.json.cover.title).toBe('Title');
    expect(requests[0].tools).toEqual([
      {
        name: 'return_json',
        description: 'Return the final answer as a JSON object.',
        input_schema: rewriteSchema,
        strict: true,
      },
    ]);
  });

  it('tests Anthropic models with a Messages API JSON probe', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown>; apiKey: string | null; version: string | null }> = [];
    const result = await testConfiguredLlm(
      {
        ...defaultConfig.llm,
        provider: 'anthropic',
        protocol: 'anthropic',
        apiKey: 'anthropic-key',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-sonnet-4-5-20250929',
      },
      async (url, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: String(url),
          body: JSON.parse(String(init?.body)),
          apiKey: headers.get('x-api-key'),
          version: headers.get('anthropic-version'),
        });
        return new Response(
          JSON.stringify({
            id: 'msg_probe',
            content: [{ type: 'text', text: '{"ok":true}' }],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      },
    );

    expect(result.status).toBe('pass');
    expect(result.requestId).toBe('msg_probe');
    expect(result.endpoint).toBe('https://api.anthropic.com/v1/messages');
    expect(requests[0].apiKey).toBe('anthropic-key');
    expect(requests[0].version).toBe('2023-06-01');
    expect(requests[0].body).toMatchObject({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 20,
      system: 'Return strict JSON only.',
    });
  });

  it('fetches Anthropic models from the configured base URL', async () => {
    const requests: Array<{ url: string; method: string | undefined; apiKey: string | null; version: string | null; auth: string | null }> = [];
    const result = await listConfiguredProviderModels(
      { protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'anthropic-key' },
      async (url, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: String(url),
          method: init?.method,
          apiKey: headers.get('x-api-key'),
          version: headers.get('anthropic-version'),
          auth: headers.get('Authorization'),
        });
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'claude-sonnet-4-5-20250929',
                display_name: 'Claude Sonnet 4.5',
                created_at: '2025-09-29T00:00:00Z',
              },
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
    expect(result.endpoint).toBe('https://api.anthropic.com/v1/models');
    expect(result.models).toEqual([{ id: 'claude-sonnet-4-5-20250929', created: 1759104000, ownedBy: 'anthropic' }]);
    expect(requests[0]).toEqual({
      url: 'https://api.anthropic.com/v1/models',
      method: 'GET',
      apiKey: 'anthropic-key',
      version: '2023-06-01',
      auth: null,
    });
  });
});
