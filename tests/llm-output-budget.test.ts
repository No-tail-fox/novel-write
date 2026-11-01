import { afterEach, expect, it, vi } from 'vitest';
import { defaultConfig } from '../src/shared/config';
import { createConfiguredJsonLlm, createConfiguredTextLlm } from '../src/shared/llm-provider';
import { LEMO_PLAN_MAX_TOKENS, LEMO_FILE_MAX_TOKENS, LEMO_FILE_REQUEST_DEFAULTS, lemoPlanRequest } from '../src/shared/creative-animation/native-film';
import type { LlmProtocol } from '../src/shared/llm-protocol';

const protocols = ['openai', 'responses', 'anthropic'] as const;
const json = { treatment: '完整导演方案'.repeat(12), fps: 24, materials: [] };
const prompt = JSON.stringify({ projectVersion: 2, script: '原文不得删减', style: 'rubber-hose' });
const tokenField = (protocol: LlmProtocol) => protocol === 'responses' ? 'max_output_tokens' : 'max_tokens';
const config = (protocol: LlmProtocol, extra: Record<string, unknown> = {}) => ({ ...defaultConfig.llm, provider: 'custom' as const, protocol, apiKey: 'test-only', baseUrl: 'https://provider.example', model: 'user-selected-model', requestParamsJson: JSON.stringify(extra) });
function mockReply(protocol: LlmProtocol) {
  const raw = JSON.stringify(json);
  const body = protocol === 'anthropic' ? { id: 'receipt', stop_reason: 'end_turn', content: [{ type: 'text', text: raw }] }
    : protocol === 'responses' ? { id: 'receipt', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: raw }] }] }
    : { id: 'receipt', choices: [{ finish_reason: 'stop', message: { content: raw } }] };
  const fetch = vi.fn(async (_url: unknown, _init: RequestInit) => new Response(JSON.stringify(body)));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
afterEach(() => vi.unstubAllGlobals());

it.each(protocols)('sends the complete plan budget via the %s adapter without changing content or model', async protocol => {
  const fetch = mockReply(protocol);
  const provider = createConfiguredJsonLlm(config(protocol));
  const request = lemoPlanRequest('完整风格参考', prompt, protocol);
  expect((await provider.run(request)).json).toEqual(json);
  const body = JSON.parse(String(fetch.mock.calls[0][1].body));
  expect(body[tokenField(protocol)]).toBe(LEMO_PLAN_MAX_TOKENS);
  expect(body.model).toBe('user-selected-model');
  expect((body.messages ?? body.input).find((message: { role: string }) => message.role === 'user').content).toBe(prompt);
  expect(fetch).toHaveBeenCalledOnce();
  expect(request.maxRetries).toBe(0);
});

it.each(protocols.flatMap(protocol => [4096, 65536, 131072].map(limit => ({ protocol, limit }))))('respects an explicit $protocol output limit of $limit', async ({ protocol, limit }) => {
  const fetch = mockReply(protocol);
  await createConfiguredJsonLlm(config(protocol, { [tokenField(protocol)]: limit })).run(lemoPlanRequest('ref', prompt, protocol));
  const body = JSON.parse(String(fetch.mock.calls[0][1].body));
  expect(body[tokenField(protocol)]).toBe(limit);
});

it.each(protocols)('does not raise ordinary %s JSON requests to the film budget', async protocol => {
  const fetch = mockReply(protocol);
  await createConfiguredJsonLlm(config(protocol)).run({ step: 1, name: 'short task', messages: [{ role: 'user', content: 'Return JSON.' }] });
  const body = JSON.parse(String(fetch.mock.calls[0][1].body));
  if (protocol === 'anthropic') expect(body.max_tokens).toBe(4096);
  else expect(body).not.toHaveProperty(tokenField(protocol));
});

it.each(['max_tokens', 'max_completion_tokens', 'max_output_tokens'])('preserves Responses explicit %s instead of the task fallback', async field => {
  const fetch = mockReply('responses');
  await createConfiguredJsonLlm(config('responses', { [field]: 8192 })).run(lemoPlanRequest('ref', prompt, 'responses'));
  const body = JSON.parse(String(fetch.mock.calls[0][1].body));
  expect(body.max_output_tokens).toBe(8192);
  expect(body).not.toHaveProperty('max_tokens');
  expect(body).not.toHaveProperty('max_completion_tokens');
});

it('keeps Chat max_completion_tokens without adding a conflicting max_tokens', async () => {
  const fetch = mockReply('openai');
  await createConfiguredJsonLlm(config('openai', { max_completion_tokens: 8192 })).run(lemoPlanRequest('ref', prompt, 'openai'));
  const body = JSON.parse(String(fetch.mock.calls[0][1].body));
  expect(body.max_completion_tokens).toBe(8192);
  expect(body).not.toHaveProperty('max_tokens');
});

it.each(protocols)('carries a stage fallback through the %s text path without overriding explicit settings', async protocol => {
  for (const explicit of [undefined, 8192]) {
    const fetch = mockReply(protocol);
    await createConfiguredTextLlm(config(protocol, explicit ? { [tokenField(protocol)]: explicit } : {})).run({ step: 1, name: 'stage', messages: [{ role: 'user', content: prompt }], defaultMaxTokens: LEMO_PLAN_MAX_TOKENS });
    const body = JSON.parse(String(fetch.mock.calls[0][1].body));
    expect(body[tokenField(protocol)]).toBe(explicit ?? LEMO_PLAN_MAX_TOKENS);
  }
});

it('forwards the plan budget into the actual Anthropic SSE request', async () => {
  const events = [
    { type: 'message_start', message: { id: 'streamed-plan' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: JSON.stringify(json) } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5000 } },
    { type: 'message_stop' },
  ];
  const fetch = vi.fn(async (_url: unknown, _init: RequestInit) => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } }));
  vi.stubGlobal('fetch', fetch);
  const result = await createConfiguredJsonLlm(config('anthropic')).run(lemoPlanRequest('ref', prompt, 'anthropic'));
  expect(result.json).toEqual(json);
  expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toMatchObject({ stream: true, max_tokens: LEMO_PLAN_MAX_TOKENS });
  expect(fetch).toHaveBeenCalledOnce();
});

it('uses generous film defaults rather than a low fixed application ceiling', () => {
  expect(LEMO_PLAN_MAX_TOKENS).toBe(65536);
  expect(LEMO_FILE_MAX_TOKENS).toBe(65536);
  expect(LEMO_FILE_REQUEST_DEFAULTS).not.toHaveProperty('maxTokens');
  expect(LEMO_FILE_REQUEST_DEFAULTS.maxRetries).toBe(0);
  expect(LEMO_FILE_REQUEST_DEFAULTS.stream).toBe(true);
});

it.each(protocols.flatMap(protocol => ['outline', 'materials', 'scene'].map(stage => ({ protocol, stage }))))('sends the full $stage budget through the $protocol adapter', async ({protocol, stage}) => {
  const fetch = mockReply(protocol);
  const payload = JSON.stringify({ planningVersion: 1, planningStage: stage, script: '保留原文', style: 'rubber-hose' });
  await createConfiguredJsonLlm(config(protocol)).run(lemoPlanRequest('原始风格',payload,protocol));
  const body = JSON.parse(String(fetch.mock.calls[0][1].body));
  expect(body[tokenField(protocol)]).toBe(65536);
  expect(body.model).toBe('user-selected-model');
  expect(fetch).toHaveBeenCalledOnce();
});

it.each(protocols.flatMap(protocol => [undefined,4096,131072].map(limit => ({protocol,limit}))))('preserves configured file-authoring limits for $protocol ($limit)', async ({protocol,limit}) => {
  const fetch=mockReply(protocol);
  const request={step:1,name:'native file authoring',messages:[{role:'user' as const,content:'完整代码，不改文稿'}],...LEMO_FILE_REQUEST_DEFAULTS,stream:true,captureIncomplete:true};
  await createConfiguredTextLlm(config(protocol,limit===undefined?{}:{[tokenField(protocol)]:limit})).run(request);
  const body=JSON.parse(String(fetch.mock.calls[0][1].body));
  expect(body[tokenField(protocol)]).toBe(limit??65536);
  expect(body.model).toBe('user-selected-model');
  expect(body.stream).toBe(true);
  expect(fetch).toHaveBeenCalledOnce();
});

it('does not add max_tokens beside a configured Chat completion budget during authoring', async () => {
  const fetch=mockReply('openai');
  await createConfiguredTextLlm(config('openai',{max_completion_tokens:131072})).run({step:1,name:'native edits',messages:[{role:'user',content:'完整代码'}],...LEMO_FILE_REQUEST_DEFAULTS,stream:true});
  const body=JSON.parse(String(fetch.mock.calls[0][1].body));
  expect(body.max_completion_tokens).toBe(131072);
  expect(body).not.toHaveProperty('max_tokens');
});


it.each(protocols)('does not silently resend or reduce a provider-rejected %s budget', async protocol => {
  const fetch=vi.fn(async (_url:unknown,_init:RequestInit)=>new Response(JSON.stringify({error:{message:'Requested output budget is above the provider maximum'}}),{status:400}));
  vi.stubGlobal('fetch',fetch);
  await expect(createConfiguredTextLlm(config(protocol)).run({step:1,name:'native authoring',messages:[{role:'user',content:'Keep the complete source'}],...LEMO_FILE_REQUEST_DEFAULTS})).rejects.toThrow();
  expect(fetch).toHaveBeenCalledOnce();
  expect(JSON.parse(String(fetch.mock.calls[0][1].body))[tokenField(protocol)]).toBe(65536);
});
