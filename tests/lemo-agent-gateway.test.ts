import { LemoResponseStore, recoverStoredLemoResponse } from '../services/lemo-agent-worker/response-store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { LemoRequestLedger, requestFingerprint, type RequestReceipt } from '../services/lemo-agent-worker/request-ledger';
import { startLemoMessagesGateway, verifyMessagesReceipt, type MessagesGatewayOptions } from '../services/lemo-agent-worker/messages-gateway';
const roots: string[] = []; const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function root() { const dir = await mkdtemp(join(tmpdir(), 'lemo-gateway-')); roots.push(dir); return dir; }
async function ledger(max = 8) { const path = await root(); const value = await LemoRequestLedger.open(path, max); cleanup.push(() => value.close()); return { path, value }; }
const hash = (s: string) => requestFingerprint({ instruction: s });
const complete: RequestReceipt = { outcome: 'received', httpStatus: 200, messageId: 'msg_offline', stopReason: 'end_turn', responseSha256: 'a'.repeat(64) };
const message = { id: 'msg_offline', type: 'message', role: 'assistant', model: 'offline-model', content: [{ type: 'text', text: '中文测试' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 2 } };
const frame = (type: string, fields: Record<string, unknown> = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`;
function sse(stopReason = 'end_turn') {
  return frame('message_start', { message: { ...message, content: [], stop_reason: null } })
    + frame('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
    + frame('content_block_delta', { index: 0, delta: { type: 'text_delta', text: '中文测试 message_stop 是正文' } })
    + frame('content_block_stop', { index: 0 })
    + frame('message_delta', { delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 2 } })
    + frame('message_stop');
}
async function gateway(handler: (req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>) => void | Promise<void>, overrides: Partial<MessagesGatewayOptions> = {}) {
  let calls = 0; const headers: IncomingMessage['headers'][] = []; const bodies: Record<string, unknown>[] = [];
  const upstream = createServer(async (req, res) => { try {
    calls++; headers.push(req.headers); let data = ''; for await (const part of req) data += part;
    const body = JSON.parse(data); bodies.push(body); await handler(req, res, body);
  } catch { res.destroy(); } });
  await new Promise<void>(r => upstream.listen(0, '127.0.0.1', r));
  cleanup.push(async () => { upstream.closeAllConnections(); await new Promise<void>(r => upstream.close(() => r())); });
  const address = upstream.address(); if (!address || typeof address === 'string') throw new Error('TEST_ADDRESS');
  const state = await ledger();
  const options: MessagesGatewayOptions = { ledger: state.value,
    provider: { protocol: 'anthropic', messagesUrl: `http://127.0.0.1:${address.port}/v1/messages`, apiKey: 'upstream-test-secret', auth: 'bearer', model: 'offline-model' },
    maxOutputTokens: 16384, timeoutMs: 3000, allowLoopbackTestProvider: true, ...overrides };
  const g = await startLemoMessagesGateway(options); cleanup.push(() => g.close());
  const request = (body: Record<string, unknown> = {}, token = g.localToken, route = '/v1/messages?beta=true') => fetch(g.baseUrl + route, {
    method: 'POST', headers: { 'x-api-key': token, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'offline-model', max_tokens: 8192, messages: [{ role: 'user', content: 'private creative prompt' }], ...body }),
  });
  return { g, state, options, request, calls: () => calls, headers, bodies };
}
const sendJson = (_: IncomingMessage, res: ServerResponse) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(message)); };

describe('durable official SDK request ledger', () => {
  it('flushes submission before dispatch and stores no prompts or credentials', async () => {
    const { path, value } = await ledger(); const id = await value.begin(hash('secret prompt'));
    const disk = await readFile(join(path, 'requests.jsonl'), 'utf8');
    expect(JSON.parse(disk).requestId).toBe(id); expect(disk).not.toContain('secret prompt');
    expect(value.summary()).toMatchObject({ requests: 1, unknown: 1, blocked: true });
    await value.settle(id, complete); expect(value.summary()).toMatchObject({ received: 1, unknown: 0, blocked: false });
  });
  it('canonicalizes object order without conflating different instructions', () => {
    expect(requestFingerprint({ a: 1, b: [2] })).toBe(requestFingerprint({ b: [2], a: 1 }));
    expect(hash('one')).not.toBe(hash('two'));
  });
  it('never automatically replays a received request, including after reopening', async () => {
    const { path, value } = await ledger(); const id = await value.begin(hash('one')); await value.settle(id, complete);
    await expect(value.begin(hash('one'))).rejects.toThrow('DUPLICATE'); await value.close();
    const recovered = await LemoRequestLedger.open(path, 8); cleanup.push(() => recovered.close());
    await expect(recovered.begin(hash('one'))).rejects.toThrow('DUPLICATE');
    expect(await recovered.begin(hash('two'))).toBeTypeOf('string');
  });
  it.each(['pending','unknown','rejected'])('blocks all automatic requests after %s across restart', async outcome => {
    const { path, value } = await ledger(); const id = await value.begin(hash('one'));
    if (outcome !== 'pending') await value.settle(id, { outcome: outcome as 'unknown' | 'rejected' });
    await value.close(); const recovered = await LemoRequestLedger.open(path, 8); cleanup.push(() => recovered.close());
    await expect(recovered.begin(hash('different retry body'))).rejects.toThrow('BLOCKED');
  });
  it('prevents two live workers from owning the same journal', async () => {
    const { path } = await ledger(); await expect(LemoRequestLedger.open(path, 8)).rejects.toThrow('LOCKED');
  });
  it('does not automatically steal an abandoned owner lock', async () => {
    const path = await root(); await writeFile(join(path, 'owner.lock'), JSON.stringify({ pid: 2147483000 }));
    await expect(LemoRequestLedger.open(path, 8)).rejects.toThrow('LOCKED');
  });
  it('rejects a torn journal instead of discarding its uncertain last request', async () => {
    const path = await root(); await writeFile(join(path, 'requests.jsonl'), '{"version":1');
    await expect(LemoRequestLedger.open(path, 8)).rejects.toThrow('CORRUPT');
    expect(await readFile(join(path, 'requests.jsonl'), 'utf8')).toBe('{"version":1');
  });
  it.each(['{}\n', '{"version":2}\n', 'null\n'])('rejects malformed persisted records %s', async data => {
    const path = await root(); await writeFile(join(path, 'requests.jsonl'), data); await expect(LemoRequestLedger.open(path, 8)).rejects.toThrow('CORRUPT');
  });
  it('rejects a junction before creating journal or lock outside the assigned state', async () => {
    const path = await root(); const target = join(path, 'outside'); await mkdir(target);
    await symlink(target, join(path, 'state'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(LemoRequestLedger.open(join(path, 'state'), 8)).rejects.toThrow('LINK');
    await expect(readFile(join(target, 'owner.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('enforces an explicit per-stage request allowance rather than unlimited repair', async () => {
    const { value } = await ledger(1); const id = await value.begin(hash('one')); await value.settle(id, complete);
    await expect(value.begin(hash('two'))).rejects.toThrow('REQUEST_LIMIT');
  });
  it('refuses fabricated success receipts and duplicate settlement', async () => {
    const { value } = await ledger(); const id = await value.begin(hash('one'));
    await expect(value.settle(id, { outcome: 'received' })).rejects.toThrow('RECEIPT');
    await value.settle(id, complete); await expect(value.settle(id, complete)).rejects.toThrow('UNAVAILABLE');
  });
});

describe('official Messages gateway with local upstream', () => {
  it('requires explicit protocol, secure URL, model and positive configurable limits', async () => {
    const { value } = await ledger();
    const base: MessagesGatewayOptions = { ledger: value, provider: { protocol: 'anthropic', messagesUrl: 'https://provider.invalid/v1/messages', apiKey: 'not-real', auth: 'bearer', model: 'm' }, maxOutputTokens: 32768, timeoutMs: 1000 };
    for (const url of ['http://provider.invalid/v1/messages','http://127.0.0.1/v1/messages','https://user:secret@provider.invalid/v1/messages','https://provider.invalid/v1/messages?token=secret'])
      await expect(startLemoMessagesGateway({ ...base, provider: { ...base.provider, messagesUrl: url } })).rejects.toThrow('OPTIONS');
    await expect(startLemoMessagesGateway({ ...base, provider: { ...base.provider, protocol: 'openai' as 'anthropic' } })).rejects.toThrow('PROTOCOL');
    await expect(startLemoMessagesGateway({ ...base, maxOutputTokens: 0 })).rejects.toThrow('OPTIONS');
  });
  it('does not forward requests without the random loopback token or on a different route', async () => {
    const t = await gateway(sendJson);
    expect((await t.request({}, 'wrong')).status).toBe(403);
    expect((await t.request({}, t.g.localToken, '/v1/messages/count_tokens')).status).toBe(400);
    expect(t.calls()).toBe(0); expect(t.g.summary().requests).toBe(0);
  });
  it('preserves tools/images and >4096 token limits while replacing loopback authentication', async () => {
    const t = await gateway(sendJson);
    const body = { tools: [{ name: 'preview', description: 'test', input_schema: { type: 'object' } }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'private prompt' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'local-fixture' } }] }] };
    const r = await t.request(body); expect(r.status).toBe(200); expect(await r.json()).toEqual(message);
    expect(t.bodies[0]).toMatchObject({ ...body, max_tokens: 8192 });
    expect(t.headers[0].authorization).toBe('Bearer upstream-test-secret'); expect(t.headers[0]['x-api-key']).toBeUndefined();
    const journal = await readFile(join(t.state.path, 'requests.jsonl'), 'utf8');
    expect(journal).not.toContain('private prompt'); expect(journal).not.toContain('upstream-test-secret'); expect(journal).not.toContain(t.g.localToken);
    expect(t.g.summary()).toMatchObject({ received: 1, unknown: 0, forwardedRequests: 1 });
  });
  it('persists the submission before the upstream receives any request bytes', async () => {
    let journal = ''; let durable = false;
    const t = await gateway(async (_req, res) => { durable = JSON.parse((await readFile(journal, 'utf8')).trim()).kind === 'submitted'; sendJson(_req, res); });
    journal = join(t.state.path, 'requests.jsonl'); await t.request(); expect(durable).toBe(true);
  });
  it('blocks SDK retries even if SDK metadata changed after success acknowledgment was lost', async () => {
    const t = await gateway(sendJson);
    expect((await t.request({ metadata: { user_id: 'first' } })).status).toBe(200);
    const retry = await t.request({ metadata: { user_id: 'second' } }); expect(retry.status).toBe(400);
    expect(await retry.text()).toContain('DUPLICATE'); expect(t.calls()).toBe(1);
  });
  it.each([{ model: 'different' }, { max_tokens: 32768 }, { max_tokens: 0 }, { stream: 'true' }, { messages: [] }])('rejects incompatible request without changing it or spending: %j', async body => {
    const t = await gateway(sendJson); expect((await t.request(body)).status).toBe(400); expect(t.calls()).toBe(0);
  });
  it('accepts complete chunked UTF-8 SSE and preserves its complete wire payload', async () => {
    const bytes = Buffer.from(sse().replace(/\n/g, '\r\n'));
    const t = await gateway((_req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (let i=0;i<bytes.length;i+=7) res.write(bytes.subarray(i,i+7)); res.end(); });
    const r = await t.request({ stream: true }); expect(r.status).toBe(200); expect(Buffer.from(await r.arrayBuffer())).toEqual(bytes);
    expect(t.g.summary()).toMatchObject({ received: 1, unknown: 0 });
  });
  it('records max_tokens as a completed provider receipt, not as a complete film or an automatic retry', async () => {
    const t = await gateway((_req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(sse('max_tokens')); });
    expect((await t.request({ stream: true })).status).toBe(200);
    expect(await readFile(join(t.state.path, 'requests.jsonl'), 'utf8')).toContain('max_tokens');
    expect(t.calls()).toBe(1);
  });
  it.each([400,401,429,500,503])('never transparently retries or leaks a provider %s response', async status => {
    const t = await gateway((_req, res) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end('{"secret":"upstream-test-secret"}'); });
    const r = await t.request(); expect(r.status).toBe(400); expect(await r.text()).not.toContain('upstream-test-secret');
    expect((await t.request({ messages: [{ role: 'user', content: 'different internal retry' }] })).status).toBe(400);
    expect(t.calls()).toBe(1); expect(t.g.summary().blocked).toBe(true);
  });
  it('does not follow upstream redirects with credentials', async () => {
    const t = await gateway((_req, res) => { res.writeHead(307, { location: '/v1/messages' }); res.end(); });
    expect((await t.request()).status).toBe(400); expect(t.calls()).toBe(1); expect(t.g.summary().unknown).toBe(1);
  });
  it.each(['truncated-sse','html','empty','invalid-json'])('marks HTTP 200 with %s unresolved and prevents SDK replays', async mode => {
    const stream = mode === 'truncated-sse';
    const t = await gateway((_req, res) => { res.writeHead(200, { 'content-type': stream ? 'text/event-stream' : mode === 'html' ? 'text/html' : 'application/json' });
      res.end(stream ? sse().replace(frame('message_stop'), '') : mode === 'html' ? '<html>error</html>' : mode === 'empty' ? '' : '{bad'); });
    expect((await t.request({ stream })).status).toBe(400); expect(t.g.summary().unknown).toBe(1);
    expect((await t.request({ stream })).status).toBe(400); expect(t.calls()).toBe(1);
  });
  it('records upstream disconnect as unknown before blocking the next request', async () => {
    const t = await gateway((_req, res) => { res.destroy(); }); expect((await t.request()).status).toBe(400);
    expect(t.g.summary().unknown).toBe(1); expect((await t.request()).status).toBe(400); expect(t.calls()).toBe(1);
  });
  it('aborts slow upstream rather than retrying under a new SDK request', async () => {
    const t = await gateway(() => {}, { timeoutMs: 150 }); expect((await t.request()).status).toBe(400);
    expect(t.g.summary().unknown).toBe(1); expect((await t.request()).status).toBe(400); expect(t.calls()).toBe(1);
  });
  it('limits response buffering and persists unresolved status', async () => {
    const t = await gateway(sendJson, { maxResponseBytes: 10 }); expect((await t.request()).status).toBe(400); expect(t.g.summary().unknown).toBe(1);
  });
  it('allows only one concurrent upstream request per stage', async () => {
    let finish!: () => void; let entered!: () => void; const pending = new Promise<void>(r => { entered=r; });
    const t = await gateway((_req, res) => { entered(); finish = () => sendJson(_req, res); });
    const first = t.request(); await pending;
    expect((await t.request({ messages: [{ role: 'user', content: 'concurrent' }] })).status).toBe(400);
    finish(); expect((await first).status).toBe(200); expect(t.calls()).toBe(1);
  });
  it('does not silently reroute an active stage when caller settings change', async () => {
    const t = await gateway(sendJson); t.options.provider.apiKey = 'changed-after-start'; t.options.provider.model = 'changed-model';
    expect((await t.request()).status).toBe(200); expect(t.headers[0].authorization).toBe('Bearer upstream-test-secret');
  });
  it('rejects oversized request bodies before submission or upstream dispatch', async () => {
    const t = await gateway(sendJson, { maxRequestBytes: 16 }); expect((await t.request()).status).toBe(413);
    expect(t.calls()).toBe(0); expect(t.g.summary().requests).toBe(0);
  });
  it('does not dispatch if the initial submission cannot be flushed to disk', async () => {
    const t = await gateway(sendJson);
    const journal = (t.state.value as unknown as { journal: { sync(): Promise<void> } }).journal;
    vi.spyOn(journal, 'sync').mockRejectedValueOnce(Object.assign(new Error('Disk full'), { code: 'ENOSPC' }));
    const r = await t.request(); expect(r.status).toBe(400); expect(await r.text()).toContain('PERSIST_FAILED');
    expect(t.calls()).toBe(0); expect(t.g.summary().blocked).toBe(true);
    expect((await t.request()).status).toBe(400); expect(t.calls()).toBe(0);
  });
  it('does not acknowledge completion or retry when final receipt persistence fails', async () => {
    const t = await gateway(sendJson);
    const journal = (t.state.value as unknown as { journal: { sync(): Promise<void> } }).journal;
    const realSync = journal.sync.bind(journal); let flushes = 0;
    vi.spyOn(journal, 'sync').mockImplementation(async () => { if (++flushes === 2) throw new Error('Disk full'); await realSync(); });
    const r = await t.request(); expect(r.status).toBe(400); expect(await r.text()).toContain('PERSIST_FAILED');
    expect(t.g.summary()).toMatchObject({ received: 0, unknown: 1, blocked: true });
    expect((await t.request()).status).toBe(400); expect(t.calls()).toBe(1);
  });
  it('marks unknown and finishes shutdown when the caller cancels an active request', async () => {
    let entered!: () => void; const started = new Promise<void>(r => { entered = r; });
    const t = await gateway(() => { entered(); });
    const pending = t.request().catch(() => null); await started;
    await t.g.close(); await pending;
    expect(t.g.summary()).toMatchObject({ forwardedRequests: 1, unknown: 1, blocked: true });
  });
  it('requires an actual terminal SSE frame, not the word message_stop inside generated content', () => {
    const text = sse().replace(frame('message_stop'), ''); expect(() => verifyMessagesReceipt(Buffer.from(text), true)).toThrow('INCOMPLETE');
  });
});


describe('gateway response durability before delivery', () => {
  it('saves the complete provider result before returning success without leaking it into receipts', async () => {
    const t = await gateway(sendJson); expect((await t.request()).status).toBe(200);
    const { metadata: _ignored, ...semanticBody } = t.bodies[0];
    const fingerprint = requestFingerprint({ endpoint: t.options.provider.messagesUrl, body: semanticBody });
    const artifact = await recoverStoredLemoResponse(t.state.value, fingerprint);
    expect(JSON.parse(artifact.response.toString())).toEqual(message);
    expect(t.calls()).toBe(1);
    expect((await t.request()).status).toBe(400); expect(t.calls()).toBe(1);
  });
  it('blocks delivery and subsequent requests when the private result cannot be saved', async () => {
    const t = await gateway(sendJson);
    vi.spyOn(LemoResponseStore.prototype, 'save').mockRejectedValueOnce(new Error('disk unavailable'));
    expect((await t.request()).status).toBe(400);
    expect(t.state.value.summary().unknown).toBe(1);
    expect((await t.request({ messages: [{ role: 'user', content: 'try another request' }] })).status).toBe(400);
    expect(t.calls()).toBe(1);
  });
  it('recovers the crash window after private persistence but before receipt persistence, with no extra upstream call', async () => {
    const t = await gateway(sendJson);
    vi.spyOn(t.state.value, 'settle').mockRejectedValueOnce(new Error('simulated receipt failure'));
    expect((await t.request()).status).toBe(400); expect(t.state.value.summary().unknown).toBe(1);
    const { metadata: _ignored, ...semanticBody } = t.bodies[0];
    const fingerprint = requestFingerprint({ endpoint: t.options.provider.messagesUrl, body: semanticBody });
    expect(JSON.parse((await recoverStoredLemoResponse(t.state.value, fingerprint)).response.toString())).toEqual(message);
    expect(t.state.value.summary().unknown).toBe(0); expect(t.calls()).toBe(1);
  });
});
