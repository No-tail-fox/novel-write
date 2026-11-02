import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { defaultConfig } from '../src/shared/config';
import { createConfiguredJsonLlm, LlmJsonParseError } from '../src/shared/llm-provider';
import { LEMO_PLAN_MAX_TOKENS, lemoPlanRequest } from '../src/shared/creative-animation/native-film';
afterEach(() => vi.unstubAllGlobals());
const plan = { treatment: '完整导演方案'.repeat(12), fps: 24, materials: [] };
const prompt = JSON.stringify({ projectVersion: 2, script: '保留用户文稿', style: 'rubber-hose' });
it('runs Anthropic planning without forced tools and parses JSON after thinking blocks', async () => {
 const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
  const body = JSON.parse(String(init.body));
  if (body.tools || body.tool_choice) return new Response('upstream_error', { status: 400 });
  return new Response(JSON.stringify({ id: 'actual-plan-shape', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(plan) }] }));
 });
 vi.stubGlobal('fetch', fetch);
 const provider = createConfiguredJsonLlm({ ...defaultConfig.llm, provider: 'custom', protocol: 'anthropic', apiKey: 'test-key', baseUrl: 'https://provider.example', model: 'configured-model', requestParamsJson: '{}' });
 const request = lemoPlanRequest('complete style reference', prompt, provider.protocol);
 expect((await provider.run(request)).json).toEqual(plan);
 const [url, init] = fetch.mock.calls[0]; const body = JSON.parse(String(init.body));
 expect(url).toBe('https://provider.example/v1/messages');
 expect(body.model).toBe('configured-model'); expect(body.stream).toBe(true);
 expect(body.max_tokens).toBe(LEMO_PLAN_MAX_TOKENS);
 expect(request.timeoutMs).toBe(600000);
 expect(body.messages[0].content).toBe(prompt);
 expect(body.system).toContain('complete style reference');
 expect(body.system).toContain('Return only JSON');
 expect(body).not.toHaveProperty('tools'); expect(body).not.toHaveProperty('tool_choice');
 expect(fetch).toHaveBeenCalledOnce(); expect(request.maxRetries).toBe(0);
});
it('preserves JSON mode for OpenAI and Responses and both plan versions', () => {
 for (const protocol of ['openai', 'responses'] as const) expect(lemoPlanRequest('ref', prompt, protocol).jsonMode).toBe('required');
 expect(lemoPlanRequest('ref', '{}', 'anthropic').messages[0].content).toContain('Return only JSON');
});
it('does not retry a rejected plan or accept a malformed successful response', async () => {
 const provider = createConfiguredJsonLlm({ ...defaultConfig.llm, protocol: 'anthropic', apiKey: 'test-key', baseUrl: 'https://provider.example', model: 'configured-model' });
 const fetch = vi.fn(async () => new Response('upstream_error', { status: 400 })); vi.stubGlobal('fetch', fetch);
 await expect(provider.run(lemoPlanRequest('ref', prompt, provider.protocol))).rejects.toThrow('LLM API error (400)');
 expect(fetch).toHaveBeenCalledOnce();
 const invalid = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'not JSON' }] })));
 vi.stubGlobal('fetch', invalid);
 await expect(provider.run(lemoPlanRequest('ref', prompt, provider.protocol))).rejects.toThrow('did not return valid JSON');
 expect(invalid).toHaveBeenCalledOnce();
});
it('routes desktop native production with the configured protocol instead of the retired plan adapter', () => {
 const source = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');
 expect(source).toContain('createLemoOfficialOperations({ library: upstreamLibrary, work, session:');
 expect(source).toContain('...officialOperations');
 expect(source).toContain('provider: { protocol: resolveLlmProtocol(config.llm), messagesUrl: llmEndpoint(config.llm)');
 expect(source).toContain('await getLemoProviderCapabilities().assertReady(config.llm');
 expect(source).not.toContain('assertLemoSdkProviderProtocol(resolveLlmProtocol(config.llm))');
 expect(source).not.toContain('planFilm: async');
 expect(source).not.toContain('editFilmFile: async');
 expect(source).not.toContain('createLemoUpstreamOperations');
});

it.each([true, false])('requires a terminal event for a streamed director plan (complete=%s)', async complete => {
 const events = [
  { type: 'message_start', message: { id: 'streamed-plan', usage: { input_tokens: 20 } } },
  { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'private reasoning is not JSON output' } },
  { type: 'content_block_delta', delta: { type: 'text_delta', text: JSON.stringify(plan) } },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 50 } },
  ...(complete ? [{ type: 'message_stop' }] : []),
 ];
 const body = events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
 const fetch = vi.fn(async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
 vi.stubGlobal('fetch', fetch);
 const provider = createConfiguredJsonLlm({ ...defaultConfig.llm, protocol: 'anthropic', apiKey: 'test-key', baseUrl: 'https://provider.example', model: 'configured-model' });
 const result = provider.run(lemoPlanRequest('ref', prompt, provider.protocol));
 if (complete) expect(await result).toMatchObject({ json: plan, requestId: 'streamed-plan', finishReason: 'end_turn', usage: { input_tokens: 20, output_tokens: 50 } });
 else await expect(result).rejects.toThrow('LLM_STREAM_INTERRUPTED');
 expect(fetch).toHaveBeenCalledOnce();
});
it('does not silently turn a forced-tool JSON request into text streaming', async () => {
 const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
 const provider = createConfiguredJsonLlm({ ...defaultConfig.llm, protocol: 'anthropic', apiKey: 'test-key', baseUrl: 'https://provider.example', model: 'configured-model' });
 await expect(provider.run({ ...lemoPlanRequest('ref', prompt, provider.protocol), jsonMode: 'required' })).rejects.toThrow('LLM_JSON_STREAM_MODE');
 expect(fetch).not.toHaveBeenCalled();
});


it.each([JSON.stringify(plan), '{"treatment":"unfinished'])('rejects budget-exhausted plans even when the prefix is parseable (%s)', async raw => {
 const events = [
  { type: 'message_start', message: { id: 'budget-limited-plan' } },
  { type: 'content_block_delta', delta: { type: 'text_delta', text: raw } },
  { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 4096, output_tokens_details: { thinking_tokens: 2884 } } },
  { type: 'message_stop' },
 ];
 const body = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
 const fetch = vi.fn(async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
 vi.stubGlobal('fetch', fetch);
 const provider = createConfiguredJsonLlm({ ...defaultConfig.llm, protocol: 'anthropic', apiKey: 'test-key' });
 const error = await provider.run(lemoPlanRequest('ref', prompt, provider.protocol)).catch(error => error);
 expect(error).toBeInstanceOf(LlmJsonParseError);
 expect(error.message).toContain('LLM_JSON_TRUNCATED'); expect(error.message).toContain('4096');
 expect(error.rawResponse).toBe(raw);
 expect(error.result).toMatchObject({ raw, requestId: 'budget-limited-plan', finishReason: 'max_tokens', usage: { output_tokens: 4096 } });
 expect(fetch).toHaveBeenCalledOnce();
});
it('preserves completed invalid replies and their provider id instead of accepting or retrying them', async () => {
 const raw = '{"treatment":"a "quoted" sentence", "fps":24}';
 const fetch = vi.fn(async () => new Response(JSON.stringify({ id: 'invalid-plan', stop_reason: 'end_turn', content: [{ type: 'text', text: raw }] })));
 vi.stubGlobal('fetch', fetch);
 const provider = createConfiguredJsonLlm({ ...defaultConfig.llm, protocol: 'anthropic', apiKey: 'test-key' });
 const error = await provider.run(lemoPlanRequest('ref', prompt, provider.protocol)).catch(error => error);
 expect(error).toBeInstanceOf(LlmJsonParseError); expect(error.message).toContain('LLM_JSON_INVALID');
 expect(error.result).toMatchObject({ raw, requestId: 'invalid-plan', finishReason: 'end_turn' });
 expect(fetch).toHaveBeenCalledOnce();
});
it.each(['{}', '{"max_tokens":8192}'])('uses a stage budget only when the provider has no explicit limit (%s)', async requestParamsJson => {
 const fetch = vi.fn(async (_url: unknown, _init: RequestInit) => new Response(JSON.stringify({ id: 'plan', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(plan) }] })));
 vi.stubGlobal('fetch', fetch);
 const provider = createConfiguredJsonLlm({ ...defaultConfig.llm, protocol: 'anthropic', apiKey: 'test-key', requestParamsJson });
 await provider.run(lemoPlanRequest('ref', prompt, provider.protocol));
 expect(JSON.parse(String(fetch.mock.calls[0][1].body)).max_tokens).toBe(JSON.parse(requestParamsJson).max_tokens ?? LEMO_PLAN_MAX_TOKENS);
 expect(fetch).toHaveBeenCalledOnce();
});
