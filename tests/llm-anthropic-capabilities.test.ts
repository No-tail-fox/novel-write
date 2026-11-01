import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../src/shared/config';
import { createConfiguredJsonLlm, LlmJsonParseError, testConfiguredLlm } from '../src/shared/llm-provider';

const config = { ...defaultConfig.llm, provider: 'custom', protocol: 'anthropic' as const, baseUrl: 'https://provider.example', apiKey: 'fixture-key', model: 'claude-opus-5-5', requestParamsJson: '{}' };
const request = { step: 1, name: 'capability-test', maxRetries: 0, messages: [{ role: 'user' as const, content: 'Return JSON.' }] };
const answer = { ok: true };
const reply = (tool = true, stop = tool ? 'tool_use' : 'end_turn') => Response.json({ id: 'msg-capability', stop_reason: stop, usage: { output_tokens: 64 }, content: tool ? [{ type: 'tool_use', name: 'return_json', input: answer }] : [{ type: 'text', text: JSON.stringify(answer) }] });
afterEach(() => vi.unstubAllGlobals());

describe('Anthropic model capabilities are distinct from transport selection', () => {
  it.each(['claude-opus-5-5', 'claude-opus-5-5-20261001', 'anthropic/claude-opus-5-5', 'anthropic.claude-opus-5-5-v1:0', 'CLAUDE-OPUS-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-mythos-5-1'])('automatically avoids forced tools for %s', async model => {
    const fetcher = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init.body));
      expect(body.tool_choice).toEqual({ type: 'auto' });
      expect(body.tools[0].name).toBe('return_json');
      expect(body.model).toBe(model);
      expect(body.max_tokens).toBe(4096);
      expect(body.system).toContain('complete valid JSON object');
      return reply();
    });
    vi.stubGlobal('fetch', fetcher);
    expect((await createConfiguredJsonLlm({ ...config, model }).run(request)).json).toEqual(answer);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe('https://provider.example/v1/messages');
  });

  it('preserves the original system instruction with real paragraph separators', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init.body));
      expect(body.system).toMatch(/^Keep the production schema unchanged\.\n\nReturn the final answer/);
      expect(body.system).not.toContain('\\n');
      return reply();
    }));
    await createConfiguredJsonLlm(config).run({
      ...request,
      messages: [{ role: 'system', content: 'Keep the production schema unchanged.' }, ...request.messages],
    });
  });

  it.each([{ system: 'Keep my configured prompt.' }, { system: [{ type: 'text', text: 'Keep my configured prompt.', cache_control: { type: 'ephemeral' } }] }])('preserves configured system content while appending the JSON instruction (%j)', async ({ system }) => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init.body));
      if (Array.isArray(system)) {
        expect(body.system.slice(0, -1)).toEqual(system);
        expect(body.system.at(-1)).toMatchObject({ type: 'text', text: expect.stringContaining('complete valid JSON object') });
      } else {
        expect(body.system).toMatch(/^Keep my configured prompt\.\n\nReturn the final answer/);
      }
      return reply();
    }));
    await createConfiguredJsonLlm({ ...config, requestParamsJson: JSON.stringify({ system }) }).run(request);
  });

  it.each(['enabled', 'adaptive'])('does not force tools while thinking is %s', async type => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init.body));
      expect(body.tool_choice).toEqual({ type: 'auto' });
      expect(body.thinking).toEqual({ type, budget_tokens: 1024 });
      return reply(false);
    }));
    await expect(createConfiguredJsonLlm({ ...config, model: 'claude-sonnet-4-5', requestParamsJson: JSON.stringify({ thinking: { type, budget_tokens: 1024 } }) }).run(request)).resolves.toMatchObject({ json: answer });
  });

  it.each(['claude-sonnet-4-5', 'claude-opus-5-50', 'custom-model'])('preserves established forcing for %s without thinking', async model => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      expect(JSON.parse(String(init.body)).tool_choice).toEqual({ type: 'tool', name: 'return_json' });
      return reply();
    }));
    await createConfiguredJsonLlm({ ...config, model }).run(request);
  });

  it.each(['claude-opus-5', 'claude-haiku-5-5'])('preserves explicit adaptive thinking for %s without treating its protocol as incompatible', async model => {
    const fetcher = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init.body));
      expect(body.tool_choice).toEqual(body.thinking ? { type: 'auto' } : { type: 'tool', name: 'return_json' });
      expect(body.model).toBe(model);
      return reply();
    });
    vi.stubGlobal('fetch', fetcher);
    await createConfiguredJsonLlm({ ...config, model }).run(request);
    await createConfiguredJsonLlm({ ...config, model, requestParamsJson: '{"thinking":{"type":"adaptive"}}' }).run(request);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('preserves the supplied strict tool schema and caller output budget', async () => {
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init.body));
      expect(body.tools[0]).toMatchObject({ strict: true, input_schema: schema });
      expect(body.tool_choice).toEqual({ type: 'auto' });
      expect(body.max_tokens).toBe(8192);
      return reply();
    }));
    await createConfiguredJsonLlm({ ...config, requestParamsJson: '{"max_tokens":8192}' }).run({ ...request, anthropic: { toolInputSchema: schema } });
  });

  it.each([true, false])('parses completed tool or text JSON (tool=%s)', async tool => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(tool)));
    await expect(createConfiguredJsonLlm(config).run(request)).resolves.toMatchObject({ json: answer, requestId: 'msg-capability' });
  });

  it.each([true, false])('rejects a truncated valid-looking JSON prefix (tool=%s)', async tool => {
    const fetcher = vi.fn(async () => reply(tool, 'max_tokens')); vi.stubGlobal('fetch', fetcher);
    const error = await createConfiguredJsonLlm(config).run(request).catch(error => error);
    expect(error).toBeInstanceOf(LlmJsonParseError);
    expect(error.message).toContain('LLM_JSON_TRUNCATED');
    expect(error.result).toMatchObject({ requestId: 'msg-capability', finishReason: 'max_tokens', raw: JSON.stringify(answer), usage: { output_tokens: 64 } });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each(['max_tokens', 'tool_use'])('retains malformed string tool input and its receipt (%s)', async stop => {
    const raw = '{"ok":';
    const fetcher = vi.fn(async () => Response.json({ id: 'msg-partial-tool', stop_reason: stop, usage: { output_tokens: 4096 }, content: [{ type: 'tool_use', name: 'return_json', input: raw }] }));
    vi.stubGlobal('fetch', fetcher);
    const error = await createConfiguredJsonLlm(config).run(request).catch(error => error);
    expect(error).toBeInstanceOf(LlmJsonParseError);
    expect(error.message).toContain(stop === 'max_tokens' ? 'LLM_JSON_TRUNCATED' : 'did not return valid JSON');
    expect(error.rawResponse).toBe(raw);
    expect(error.result).toMatchObject({ raw, requestId: 'msg-partial-tool', finishReason: stop, usage: { output_tokens: 4096 } });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('uses the same capability rules in the settings model test', async () => {
    const fetcher = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.tool_choice).toEqual({ type: 'auto' });
      expect(body.max_tokens).toBe(1024);
      return reply(false);
    });
    expect((await testConfiguredLlm(config, fetcher)).status).toBe('pass');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([{ jsonMode: 'none' as const }, { jsonRoot: 'array' as const }])('does not introduce tools in an intentionally tool-free request %j', async options => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init.body));
      expect(body).not.toHaveProperty('tools'); expect(body).not.toHaveProperty('tool_choice');
      return reply(false);
    }));
    await createConfiguredJsonLlm(config).run({ ...request, ...options });
  });

  it.each([400, 401, 403, 404])('does not switch protocols or replay a failed paid request (%s)', async status => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ error: 'rejected' }, { status })); vi.stubGlobal('fetch', fetcher);
    await expect(createConfiguredJsonLlm(config).run(request)).rejects.toThrow(`(${status})`);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe('https://provider.example/v1/messages');
  });
});
