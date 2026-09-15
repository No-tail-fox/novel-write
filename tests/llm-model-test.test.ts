import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../src/shared/config';
import { testConfiguredLlm } from '../src/shared/llm-provider';

const config = { ...defaultConfig.llm, apiKey: 'test-key', baseUrl: 'https://llm.example', model: 'gemini-flash-high' };

function openAiResponse(content: string, finishReason = 'stop'): Response {
  return Response.json({ id: 'probe-json', choices: [{ message: { content }, finish_reason: finishReason }] });
}

afterEach(() => vi.useRealTimers());

describe('LLM configuration JSON probes', () => {
  it('gives thinking models enough probe tokens without changing profile generation settings', async () => {
    const profile = { ...config, requestParamsJson: '{"reasoning_effort":"high","max_tokens":32768}' };
    const result = await testConfiguredLlm(profile, async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ max_tokens: 1024, reasoning_effort: 'high', response_format: { type: 'json_object' } });
      return body.max_tokens <= 20 ? openAiResponse('{"ok": true', 'length') : openAiResponse('{"ok":true}');
    });
    expect(result.status).toBe('pass');
    expect(profile.requestParamsJson).toBe('{"reasoning_effort":"high","max_tokens":32768}');
  });

  it('uses only the configured completion-token field and requests non-streaming JSON', async () => {
    const result = await testConfiguredLlm({
      ...config,
      requestParamsJson: '{"max_completion_tokens":4096,"max_tokens":20,"stream":true,"stream_options":{"include_usage":true}}',
    }, async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ max_completion_tokens: 1024, stream: false });
      expect(body).not.toHaveProperty('max_tokens');
      expect(body).not.toHaveProperty('stream_options');
      return openAiResponse('{"ok":true}');
    });
    expect(result.status).toBe('pass');
  });

  it.each(['{"ok": true', '', '{"ok":true}'])('reports length termination without blaming JSON mode: %s', async (content) => {
    const result = await testConfiguredLlm(config, async () => openAiResponse(content, 'length'));
    expect(result.status).toBe('warn');
    expect(result.requestId).toBe('probe-json');
    expect(result.detail).toContain('被截断');
    expect(result.detail).toContain('length');
    expect(result.detail).not.toContain('did not follow JSON mode');
  });

  it('does not silently repair an incomplete response even if the provider claims it stopped normally', async () => {
    const result = await testConfiguredLlm(config, async () => openAiResponse('{"ok": true'));
    expect(result.status).toBe('warn');
    expect(result.detail).toContain('不是完整有效的 JSON');
    expect(result.detail).toContain('{"ok": true');
  });

  it('distinguishes empty content from malformed JSON', async () => {
    const result = await testConfiguredLlm(config, async () => openAiResponse('', 'content_filter'));
    expect(result.status).toBe('warn');
    expect(result.detail).toContain('回复为空');
    expect(result.detail).toContain('content_filter');
  });

  it.each(['{}', '{"ok":false}', '{"ok":"true"}', '[{"ok":true}]', 'true', 'null'])('does not pass a JSON response without the expected marker: %s', async (content) => {
    const result = await testConfiguredLlm(config, async () => openAiResponse(content));
    expect(result.status).toBe('warn');
    expect(result.detail).toContain('未返回预期');
  });

  it('allows a thinking probe to take longer than the previous 15-second cap', async () => {
    vi.useFakeTimers();
    const resultPromise = testConfiguredLlm(config, async (_url, init) => new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(openAiResponse('{"ok":true}')), 20_000);
      init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(init.signal?.reason); }, { once: true });
    }));
    await vi.advanceTimersByTimeAsync(20_001);
    expect((await resultPromise).status).toBe('pass');
  });

  it.each([50, 120_000])('respects short configured timeouts and caps longer probes at 60 seconds: %s', async (timeoutMs) => {
    vi.useFakeTimers();
    const resultPromise = testConfiguredLlm({ ...config, timeoutMs }, async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));
    await vi.advanceTimersByTimeAsync(Math.min(timeoutMs, 60_000) + 1);
    const result = await resultPromise;
    expect(result.status).toBe('fail');
    expect(result.latencyMs).toBeLessThanOrEqual(60_001);
  });

  it.each([{ ok: true }, '{"ok":true}'])('accepts the requested Anthropic JSON tool output: %j', async (input) => {
    const result = await testConfiguredLlm({ ...config, protocol: 'anthropic', provider: 'anthropic' }, async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ max_tokens: 1024, tool_choice: { type: 'tool', name: 'return_json' } });
      return Response.json({ id: 'msg-probe', stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'return_json', input }] });
    });
    expect(result.status).toBe('pass');
    expect(result.requestId).toBe('msg-probe');
  });

  it('detects truncated Anthropic tool responses before accepting their JSON', async () => {
    const result = await testConfiguredLlm({ ...config, protocol: 'anthropic', provider: 'anthropic' }, async () => Response.json({
      stop_reason: 'max_tokens', content: [{ type: 'tool_use', name: 'return_json', input: { ok: true } }],
    }));
    expect(result.status).toBe('warn');
    expect(result.detail).toContain('被截断');
    expect(result.detail).toContain('max_tokens');
  });

  it('preserves HTTP failures without pretending the model is usable', async () => {
    const fetchMock = vi.fn(async () => Response.json({ error: { message: 'Unauthorized' } }, { status: 401 }));
    const result = await testConfiguredLlm(config, fetchMock);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('401');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
