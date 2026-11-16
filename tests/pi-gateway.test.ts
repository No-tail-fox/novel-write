import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiRequestLedger, startPiGateway, verifyPiReceipt, type PiProtocol, type PiGatewayOptions } from '../services/pi-gateway';
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
const paths = { anthropic: '/v1/messages', 'openai-chat': '/v1/chat/completions', 'openai-responses': '/v1/responses' };
const usage = { input_tokens: 12, output_tokens: 4 };
const event = (type: string, value: unknown) => `event: ${type}\ndata: ${JSON.stringify(value)}\n\n`;
function result(protocol: PiProtocol, stream: boolean) {
  const message = { id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'inspect', input: { image: true } }], stop_reason: 'tool_use', usage };
  const chat = { id: 'chat_1', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'inspect', arguments: '{}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } };
  const response = { id: 'resp_1', object: 'response', status: 'completed', output: [{ type: 'function_call', call_id: 'call_1', name: 'inspect', arguments: '{}' }], usage };
  if (!stream) return JSON.stringify(protocol === 'anthropic' ? message : protocol === 'openai-chat' ? chat : response);
  if (protocol === 'anthropic') return event('message_start', { type: 'message_start', message: { ...message, stop_reason: null } })
    + event('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 4 } }) + event('message_stop', { type: 'message_stop' });
  if (protocol === 'openai-chat') return `data: ${JSON.stringify({ ...chat, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { tool_calls: chat.choices[0].message.tool_calls }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`;
  return event('response.completed', { type: 'response.completed', response });
}
async function setup(protocol: PiProtocol, handler: (req: IncomingMessage, res: ServerResponse) => void, maxRequests = 10, timeoutMs = 2000, beforeSubmit?: PiGatewayOptions['beforeSubmit']) {
  const directory = await mkdtemp(join(tmpdir(), 'pi-gateway-')); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const server = createServer(handler); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  cleanup.push(() => new Promise<void>(r => { server.closeAllConnections(); server.close(() => r()); }));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('address');
  const ledger = await PiRequestLedger.open(directory, maxRequests); cleanup.push(() => ledger.close());
  const gateway = await startPiGateway({ ledger, beforeSubmit, provider: { protocol, upstreamUrl: `http://127.0.0.1:${address.port}/exact/upstream`, apiKey: 'provider-secret', auth: protocol === 'anthropic' ? 'x-api-key' : 'bearer', model: 'fixed-model' }, timeoutMs, allowLoopbackTestProvider: true });
  cleanup.push(() => gateway.close());
  const send = (body: unknown, token = gateway.localToken, signal?: AbortSignal) => fetch(gateway.baseUrl + paths[protocol], { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  return { directory, ledger, gateway, send };
}
function body(protocol: PiProtocol, stream = false) {
  return { model: 'fixed-model', stream, ...(protocol === 'openai-chat' && stream ? { stream_options: { include_usage: true } } : {}), tools: [{ type: 'function', name: 'inspect', description: 'image tool', parameters: { type: 'object' } }],
    ...(protocol === 'openai-responses' ? { input: [{ role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,AA==' }] }] }
      : { messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA==' } }] }], max_tokens: 123 }) };
}
describe('Pi native raw gateway (local mocks only)', () => {
  for (const protocol of Object.keys(paths) as PiProtocol[]) for (const stream of [false, true]) {
    it(`${protocol} preserves tools/images and ${stream ? 'SSE' : 'JSON'} with durable usage`, async () => {
      let raw = ''; let target = ''; let auth: unknown;
      const expected = result(protocol, stream);
      const h = await setup(protocol, async (req, res) => { target = req.url!; auth = protocol === 'anthropic' ? req.headers['x-api-key'] : req.headers.authorization;
        for await (const chunk of req) raw += chunk; res.writeHead(200, { 'content-type': stream ? 'text/event-stream' : 'application/json' }); res.end(expected); });
      const input = body(protocol, stream); const reply = await h.send(input);
      expect(reply.status).toBe(200); expect(await reply.text()).toBe(expected); expect(raw).toBe(JSON.stringify(input)); expect(target).toBe('/exact/upstream');
      expect(auth).toBe(protocol === 'anthropic' ? 'provider-secret' : 'Bearer provider-secret');
      const journal = (await readFile(join(h.directory, 'requests.jsonl'), 'utf8')).trim().split('\n').map(x => JSON.parse(x));
      expect(journal[1].receipt).toMatchObject({ outcome: 'received', protocol, usage: expect.any(Object), terminalEvidence: expect.any(String) });
      expect(await readFile(join(h.directory, 'private-responses', journal[0].requestId, 'response.bin'), 'utf8')).toBe(expected);
      expect(h.gateway.summary()).toMatchObject({ requests: 1, received: 1, blocked: false });
      const snapshot = h.ledger.receipts(); expect(snapshot[0]).toEqual({ requestId: journal[0].requestId, receipt: journal[1].receipt });
      snapshot[0].receipt!.usage!.output_tokens = 999;
      expect(h.ledger.receipts()[0].receipt).toEqual(journal[1].receipt);
    });
  }
  for (const protocol of Object.keys(paths) as PiProtocol[]) it(`${protocol} rejects missing terminal evidence and blocks the next call`, async () => {
    let calls = 0; const h = await setup(protocol, (_req, res) => { calls++; res.writeHead(200, { 'content-type': 'text/event-stream' });
      const incomplete = protocol === 'anthropic' ? event('message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', usage } })
        : protocol === 'openai-chat' ? 'data: {"id":"chat_1","object":"chat.completion.chunk","choices":[]}\n\n' : event('response.created', { type: 'response.created' }); res.end(incomplete); });
    expect((await h.send(body(protocol, true))).status).toBe(400);
    expect(h.gateway.summary()).toMatchObject({ unknown: 1, blocked: true });
    expect((await h.send({ ...body(protocol), metadata: { next: true } })).status).toBe(400); expect(calls).toBe(1);
    await h.gateway.close(); await h.ledger.close(); const reopened = await PiRequestLedger.open(h.directory, 10); cleanup.push(() => reopened.close()); expect(reopened.summary().blocked).toBe(true);
  });
  it('cancels an interrupted upstream stream on client disconnect and blocks later calls', async () => {
    let started!: () => void; const upstreamStarted = new Promise<void>(r => { started = r; });
    let disconnected!: () => void; const upstreamDisconnected = new Promise<void>(r => { disconnected = r; });
    const h = await setup('openai-responses', (_req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(event('response.created', { type: 'response.created' })); res.on('close', disconnected); started(); });
    const controller = new AbortController(); const pending = h.send(body('openai-responses', true), undefined, controller.signal).catch(() => undefined);
    await upstreamStarted; controller.abort(); await pending; await upstreamDisconnected;
    await h.gateway.close(); expect(h.gateway.summary()).toMatchObject({ unknown: 1, blocked: true, forwardedRequests: 1 });
  });
  it('serializes by rejecting overlap and aborts active work at shutdown', async () => {
    let started!: () => void; const ready = new Promise<void>(r => { started = r; });
    const h = await setup('anthropic', (_req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.flushHeaders(); started(); });
    const pending = h.send(body('anthropic', true)).catch(() => undefined); await ready;
    expect((await h.send(body('anthropic'))).status).toBe(409); await h.gateway.close(); await pending;
    expect(h.gateway.summary()).toMatchObject({ forwardedRequests: 1, unknown: 1, blocked: true });
  });
  it('authenticates locally, pins model, counts maxRequests, and never follows redirects', async () => {
    let calls = 0; const h = await setup('openai-chat', (_req, res) => { calls++; res.writeHead(200, { 'content-type': 'application/json' }); res.end(result('openai-chat', false)); }, 1);
    expect((await h.send(body('openai-chat'), 'wrong')).status).toBe(403);
    expect((await h.send({ ...body('openai-chat'), model: 'other' })).status).toBe(400);
    expect((await h.send(body('openai-chat'))).status).toBe(200);
    expect((await h.send({ ...body('openai-chat'), metadata: { next: 1 } })).status).toBe(400); expect(calls).toBe(1);
    const redirect = await setup('anthropic', (_req, res) => { res.writeHead(307, { location: h.gateway.baseUrl }); res.end(); });
    expect((await redirect.send(body('anthropic'))).status).toBe(502); expect(redirect.gateway.summary()).toMatchObject({ unknown: 1, forwardedRequests: 1 });
  });
  it('marks a broken HTTP stream unknown and blocks all later requests', async () => {
    let calls = 0;
    const h = await setup('openai-chat', (_req, res) => { calls++; res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"id":"chat_1","object":"chat.completion.chunk","choices":[]}\n\n', () => res.destroy()); });
    expect((await h.send(body('openai-chat', true))).status).toBe(400);
    expect(h.gateway.summary()).toMatchObject({ unknown: 1, blocked: true });
    expect((await h.send(body('openai-chat'))).status).toBe(400); expect(calls).toBe(1);
  });
  it('times out an incomplete stream without retrying', async () => {
    const h = await setup('openai-responses', (_req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(event('response.created', { type: 'response.created' })); }, 10, 100);
    expect((await h.send(body('openai-responses', true))).status).toBe(400);
    expect(h.gateway.summary()).toMatchObject({ forwardedRequests: 1, unknown: 1, blocked: true });
  });
  for (const protocol of Object.keys(paths) as PiProtocol[]) it(`${protocol} records terminal reply with unknown usage and stops spending`, async () => {
    const payload = JSON.parse(result(protocol, false)); delete payload.usage;
    const h = await setup(protocol, (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); });
    expect((await h.send(body(protocol))).status).toBe(200);
    expect(h.gateway.summary()).toMatchObject({ received: 1, unknown: 0, usageUnknown: 1, blocked: true });
    expect((await h.send({ ...body(protocol), metadata: { next: true } })).status).toBe(400);
    expect(h.gateway.summary().forwardedRequests).toBe(1);
  });
  it('preserves only sanitized host admission codes before submission', async () => {
    for (const [error, expected] of [[new Error('PI_INPUT_CONTEXT_LIMIT'), 'PI_INPUT_CONTEXT_LIMIT'], [new Error('secret details 123'), 'PI_GATEWAY_ADMISSION_REJECTED']] as const) {
      const h = await setup('anthropic', (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(result('anthropic', false)); }, 10, 2000, () => { throw error; });
      const response = await h.send(body('anthropic'));
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).toContain(expected);
      expect(text).not.toContain('secret details');
      expect(h.gateway.summary()).toMatchObject({ requests: 0, unknown: 0, blocked: false });
    }
  });
  it('rejects host admission before submission and preserves bytes despite hook mutation', async () => {
    let calls = 0; let admit = false; let raw = '';
    const h = await setup('openai-responses', async (req, res) => { calls++; for await (const chunk of req) raw += chunk;
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(result('openai-responses', false)); }, 10, 2000,
    async input => { await Promise.resolve(); if (!admit) throw Error('budget'); (input as Record<string, unknown>).model = 'mutated'; });
    const input = body('openai-responses');
    expect((await h.send(input)).status).toBe(400); expect(calls).toBe(0);
    expect(h.gateway.summary()).toMatchObject({ requests: 0, unknown: 0, blocked: false });
    admit = true; expect((await h.send(input)).status).toBe(200); expect(raw).toBe(JSON.stringify(input));
  });
  for (const status of ['incomplete', 'failed']) for (const stream of [false, true]) it(`records Responses ${status} terminal as received (${stream})`, async () => {
    const response = { id: 'resp_terminal', object: 'response', status, output: [], usage,
      ...(status === 'incomplete' ? { incomplete_details: { reason: 'max_output_tokens' } } : { error: { code: 'server_error' } }) };
    const payload = stream ? event(`response.${status}`, { type: `response.${status}`, response }) : JSON.stringify(response);
    const h = await setup('openai-responses', (_req, res) => { res.writeHead(200, { 'content-type': stream ? 'text/event-stream' : 'application/json' }); res.end(payload); });
    expect((await h.send(body('openai-responses', stream))).status).toBe(200);
    expect(h.gateway.summary()).toMatchObject({ received: 1, unknown: 0, blocked: status === 'failed' });
    expect(h.ledger.receipts()[0].receipt).toMatchObject({ terminalEvidence: `response.${status}`, stopReason: status === 'incomplete' ? 'max_output_tokens' : 'failed' });
  });
  it('retains exclusive owner lock and classifies missing usage separately', async () => {
    const h = await setup('anthropic', () => {}); await expect(PiRequestLedger.open(h.directory, 10)).rejects.toThrow('PI_LEDGER_LOCKED');
    expect(await readdir(h.directory)).toContain('owner.lock');
    expect(verifyPiReceipt(Buffer.from(JSON.stringify({ id: 'x', object: 'response', status: 'completed', output: [] })), 'openai-responses', false)).toMatchObject({ outcome: 'received', usageStatus: 'unknown' });
  });
});
