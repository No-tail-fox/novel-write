import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { mkdir } from 'node:fs/promises';
import { lemoCapabilityIdentity } from '../electron/lemo-capability-store';
import { createLemoCapabilityHandlers, LemoProviderCapabilityService } from '../electron/lemo-provider-capability-service';
import { decideLemoProviderCapability, lemoCapabilityTestPlan, type LemoCapabilityTestRequest } from '../src/shared/lemo-provider-capabilities';
import type { LlmConfig } from '../src/shared/types';
import type { FetchWithTimeoutOptions } from '../src/shared/http';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const config: LlmConfig = { id: 'configured-profile', provider: 'custom', protocol: 'anthropic', apiKey: 'secret-no-log-key', baseUrl: 'https://messages.example.test/v1', model: 'actual-channel-model-id', proxyUrl: '', requestParamsJson: '{"max_tokens":1024}' };
const approval = (patch: Partial<LemoCapabilityTestRequest> = {}): LemoCapabilityTestRequest => ({ profileId: config.id!, testId: 'explicit-test-0001', expectedFingerprint: lemoCapabilityIdentity(config).fingerprint, acknowledgePotentialCharges: true, maxRequests: 6, outputBudget: 1024, maxOutputTokensTotal: 1472, ...patch });
type Body = Record<string, any>;
function message(content: unknown[], stop = 'end_turn') {
  return { id: 'msg_evidence', type: 'message', role: 'assistant', model: config.model, content, stop_reason: stop, usage: { input_tokens: 31, output_tokens: 12 } };
}
function json(content: unknown[], stop = 'end_turn') { return new Response(JSON.stringify(message(content, stop)), { headers: { 'content-type': 'application/json' } }); }
const text = (value: string) => [{ type: 'text', text: value }];
const event = (type: string, value: Body) => 'event: ' + type + '\ndata: ' + JSON.stringify({ type, ...value }) + '\n\n';
const start = () => event('message_start', { message: { ...message([]), stop_reason: null } });
const sse = () => start() + event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
  + event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'OK' } }) + event('content_block_stop', { index: 0 })
  + event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } }) + event('message_stop', {});
function pngColor(data: string) {
  const png = Buffer.from(data, 'base64'); let offset = 8;
  while (offset < png.length) { const n = png.readUInt32BE(offset); const kind = png.toString('ascii', offset + 4, offset + 8);
    if (kind === 'IDAT') { const pixels = inflateSync(png.subarray(offset + 8, offset + 8 + n)); return pixels[1] === 255 ? 'red' : pixels[2] === 190 ? 'green' : 'blue'; } offset += n + 12; }
  throw new Error('fixture PNG missing');
}
async function compatible(body: Body, options: FetchWithTimeoutOptions) {
  if (body.tools && body.tool_choice.type === 'tool') return json([{ type: 'tool_use', id: 'tool_echo', name: body.tools[0].name, input: { token: body.tools[0].input_schema.properties.token.enum[0] } }], 'tool_use');
  if (body.tools) return json(text(body.messages.at(-1).content[0].content));
  if (Array.isArray(body.messages[0].content)) return json(text(pngColor(body.messages[0].content[0].source.data)));
  if (options.onResponseChunk) { options.onResponseChunk(Buffer.from(start()), new Response(null, { headers: { 'content-type': 'text/event-stream' } }));
    if (options.signal?.aborted) throw new DOMException('private response details must not be persisted', 'AbortError'); }
  if (body.stream) return new Response(sse(), { headers: { 'content-type': 'text/event-stream' } });
  return json(text('OK'));
}
async function fixture(override?: (body: Body, options: FetchWithTimeoutOptions, index: number) => Promise<Response | undefined>, live = false) {
  const base = resolve('.artifacts/capability-unit-tests'); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, 'case-')); roots.push(directory);
  const calls: Array<{ body: Body; options: FetchWithTimeoutOptions }> = [];
  const transport = vi.fn(async (_url: string, options: FetchWithTimeoutOptions) => { const body = JSON.parse(String(options.body)); calls.push({ body, options }); return await override?.(body, options, calls.length - 1) ?? compatible(body, options); });
  const service = new LemoProviderCapabilityService({ directory, transport, ...(live ? { evidenceSource: 'live-provider' as const } : {}) });
  return { directory, calls, transport, service };
}
describe('Lemo configured channel identity and zero-charge preflight', () => {
  it('uses canonical key order but invalidates model, endpoint, credentials and relevant configuration', () => {
    const a = lemoCapabilityIdentity({ ...config, requestParamsJson: '{"max_tokens":1024,"temperature":0}' });
    expect(lemoCapabilityIdentity({ ...config, requestParamsJson: '{"temperature":0,"max_tokens":1024}' }).fingerprint).toBe(a.fingerprint);
    for (const patch of [{ model: 'other' }, { baseUrl: 'https://different.test' }, { apiKey: 'other' }, { timeoutMs: 9000 }, { requestParamsJson: '{}' }, { id: 'other' }]) expect(lemoCapabilityIdentity({ ...config, ...patch }).fingerprint).not.toBe(lemoCapabilityIdentity(config).fingerprint);
    expect(JSON.stringify(a)).not.toContain(config.apiKey);
  });
  it.each(['https://user:password@example.test', 'https://example.test?api_key=secret', 'http://example.test', 'http://127.0.0.1:99'])('rejects unsafe endpoint %s', baseUrl => expect(() => lemoCapabilityIdentity({ ...config, baseUrl })).toThrow('LEMO_CAPABILITY_ENDPOINT'));
  it('never infers Messages from a Claude name or dispatches during preflight', async () => {
    const f = await fixture(); const p = await f.service.preflight({ ...config, protocol: 'openai', model: 'claude-any-name' }, 1024);
    expect(p.staticReady).toBe(false); expect(p.blockers).toContain('LEMO_CAPABILITY_MESSAGES_REQUIRED'); expect(f.transport).not.toHaveBeenCalled();
    expect(p.profile).toBeNull(); expect(p.testPlan).toEqual({ maxRequests: 6, outputBudget: 1024, maxOutputTokensTotal: 1472 });
  });
  it('requires explicit fixture bypass and confines it to loopback Messages', async () => {
    const f = await fixture(); const local = { ...config, baseUrl: 'http://127.0.0.1:32123' };
    await expect(f.service.assertReady(local, 1024)).rejects.toThrow('LEMO_CAPABILITY_ENDPOINT');
    await expect(f.service.assertReady(local, 1024, { allowLoopbackTestProvider: true })).resolves.toMatchObject({ ready: true });
    await expect(f.service.assertReady(config, 1024, { allowLoopbackTestProvider: true })).rejects.toThrow('LEMO_CAPABILITY_FIXTURE_BYPASS');
    expect(f.transport).not.toHaveBeenCalled();
  });
});
describe('Lemo explicit bounded capability probes', () => {
  it('checks all five capabilities in six non-retried requests, persists only sanitized evidence and reuses completed test IDs', async () => {
    const f = await fixture(); const p = await f.service.test(config, approval());
    expect(p.status).toBe('complete'); expect(Object.values(p.checks).map(c => c.status)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass']);
    expect(p.requests).toHaveLength(6); expect(p.reservedOutputTokens).toBe(1472); expect(p.acceptedMaxOutputTokens).toBe(1024);
    expect(p.requests[4].state).toBe('cancelled-locally'); expect(p.checks['client-cancel'].code).toContain('REMOTE_COST_UNKNOWN');
    expect(p.checks['output-budget'].code).toContain('NOT_FULL_LENGTH_GENERATED');
    expect(f.calls[0].body.tools).toEqual(f.calls[1].body.tools); expect(f.calls[1].body.messages.at(-1).content[0].type).toBe('tool_result');
    for (const call of f.calls) { expect(call.options.retryConnectTimeout).toBe(false); expect(call.options.maxRedirects).toBe(0); }
    const persisted = await readFile(join(f.directory, p.fingerprint, p.testId + '.json'), 'utf8');
    for (const secret of [config.apiKey, 'private response details', 'input_schema', 'base64', 'headers', f.calls[0].body.tools[0].input_schema.properties.token.enum[0]]) expect(persisted).not.toContain(secret);
    expect(await f.service.test(config, approval())).toEqual(p); expect(f.calls).toHaveLength(6);
    expect((await f.service.decision(config, 1024)).blockers).toContain('LEMO_CAPABILITY_FIXTURE_ONLY');
  });
  it('authorizes only live successful evidence at the requested budget and never silently lowers it', async () => {
    const f = await fixture(undefined, true); await f.service.test(config, approval());
    await expect(f.service.assertReady(config, 1024)).resolves.toMatchObject({ ready: true, maxOutputTokens: 1024 });
    await expect(f.service.assertReady(config, 2048)).rejects.toThrow('OUTPUT_BUDGET_UNVERIFIED');
    await expect(f.service.assertReady({ ...config, model: 'changed' }, 1024)).rejects.toThrow('NOT_TESTED');
  });
  it.each([{ maxRequests: 5 }, { maxOutputTokensTotal: 1471 }])('rejects insufficient approval before any request: %j', async patch => {
    const f = await fixture(); await expect(f.service.test(config, approval(patch))).rejects.toThrow('APPROVAL_BUDGET'); expect(f.calls).toHaveLength(0);
  });
  it('requires explicit charge acknowledgement and matching saved profile', async () => {
    const f = await fixture(); await expect(f.service.test(config, { ...approval(), acknowledgePotentialCharges: false } as unknown as LemoCapabilityTestRequest)).rejects.toThrow();
    await expect(f.service.test(config, approval({ profileId: 'other' }))).rejects.toThrow('PROFILE_MISMATCH'); expect(f.calls).toHaveLength(0);
  });
  it('blocks stale approval when saved credentials, endpoint or model changed after preflight', async () => {
    const f = await fixture();
    for (const patch of [{ apiKey: 'changed-key' }, { baseUrl: 'https://changed.test' }, { model: 'changed-model' }]) {
      await expect(f.service.test({ ...config, ...patch }, approval())).rejects.toThrow('CONFIGURATION_CHANGED');
    }
    expect(f.calls).toHaveLength(0);
  });
  it('does not remove tools or retry when the provider refuses them', async () => {
    const f = await fixture(async (_body, _options, index) => index === 0 ? new Response('sensitive upstream failure secret-no-log-key', { status: 400 }) : undefined);
    const p = await f.service.test(config, approval()); expect(p.checks['tool-roundtrip'].status).toBe('fail'); expect(p.requests[0].state).toBe('rejected');
    expect(f.calls.filter(c => c.body.tools)).toHaveLength(1); expect(p.requests).toHaveLength(5);
    expect(JSON.stringify(p)).not.toContain('sensitive');
  });
  it('rejects a tool response without the required round-trip token', async () => {
    const f = await fixture(async (_body, _options, index) => index === 1 ? json(text('ignored tool result')) : undefined);
    const p = await f.service.test(config, approval()); expect(p.checks['tool-roundtrip'].status).toBe('fail');
  });
  it('fails image capability if the endpoint ignores the actual image', async () => {
    const f = await fixture(async body => Array.isArray(body.messages[0].content) ? json(text('unknown')) : undefined);
    expect((await f.service.test(config, approval())).checks['image-input'].status).toBe('fail');
  });
  it('stops on a truncated SSE response and never marks HTTP 200 as compatibility', async () => {
    const f = await fixture(async (body, options) => body.stream && !options.onResponseChunk ? new Response(start(), { headers: { 'content-type': 'text/event-stream' } }) : undefined);
    const p = await f.service.test(config, approval()); expect(p.status).toBe('interrupted'); expect(p.checks.sse.status).toBe('unknown');
    expect(p.checks['client-cancel'].status).toBe('not-tested'); expect(f.calls).toHaveLength(4);
    await f.service.test(config, approval()); expect(f.calls).toHaveLength(4);
  });
  it('stops all probes on authentication rejection without recording provider bodies', async () => {
    const f = await fixture(async () => new Response('credentials-reflected-here', { status: 401 })); const p = await f.service.test(config, approval());
    expect(p.status).toBe('interrupted'); expect(f.calls).toHaveLength(1); expect(JSON.stringify(p)).not.toContain('credentials-reflected');
  });
  it('records an in-flight transport failure as unknown and never replays its ID', async () => {
    const f = await fixture(async () => { throw new Error('secret URL ' + config.apiKey); });
    const p = await f.service.test(config, approval()); expect(p.requests[0].state).toBe('unknown'); expect(p.status).toBe('interrupted');
    await f.service.test(config, approval()); expect(f.calls).toHaveLength(1); expect(JSON.stringify(p)).not.toContain(config.apiKey);
  });
  it('does not pass cancellation when the transport ignores abort and returns a complete response', async () => {
    const f = await fixture(async (_body, options) => { if (!options.onResponseChunk) return; options.onResponseChunk(Buffer.from(start()), new Response(null, { headers: { 'content-type': 'text/event-stream' } })); return new Response(sse(), { headers: { 'content-type': 'text/event-stream' } }); });
    const p = await f.service.test(config, approval()); expect(p.checks['client-cancel'].status).not.toBe('pass'); expect(p.checks['output-budget'].status).toBe('not-tested');
  });
  it('records a rejected requested output budget without adapting downward', async () => {
    const f = await fixture(async body => body.max_tokens === 1024 ? new Response('unsupported max tokens', { status: 400 }) : undefined);
    const p = await f.service.test(config, approval()); expect(p.acceptedMaxOutputTokens).toBe(0); expect(p.checks['output-budget'].status).toBe('fail'); expect(f.calls).toHaveLength(6);
  });
  it('leaves a crashed sent record interrupted and does not resume paid dispatch', async () => {
    const f = await fixture(); const p = await f.service.test(config, approval()); p.status = 'running'; p.requests[0].state = 'sent'; await f.service.store.save(p);
    const recovered = await f.service.test(config, approval()); expect(recovered.status).toBe('interrupted'); expect(f.calls).toHaveLength(6);
  });
  it('serializes simultaneous tests of one endpoint/configuration', async () => {
    let started!: () => void; let finish!: () => void; const pending = new Promise<void>(r => { finish = r; }); const sent = new Promise<void>(r => { started = r; });
    const f = await fixture(async (_body, _options, i) => { if (i === 0) { started(); await pending; } return undefined; });
    const first = f.service.test(config, approval()); await sent;
    await expect(f.service.test(config, approval({ testId: 'explicit-test-0002' }))).rejects.toThrow('TEST_LOCKED'); finish(); await first; expect(f.calls).toHaveLength(6);
  });
  it('rejects forged or corrupt persisted profile metadata', async () => {
    const f = await fixture(); const p = await f.service.test(config, approval());
    await writeFile(join(f.directory, p.fingerprint, p.testId + '.json'), JSON.stringify({ ...p, unexpectedSecret: 'not allowed' }), 'utf8');
    await expect(f.service.preflight(config, 1024)).rejects.toThrow();
  });
  it('expires evidence and keeps budgets separate from configured model names', async () => {
    const f = await fixture(undefined, true); const p = await f.service.test(config, approval());
    const d = decideLemoProviderCapability({ fingerprint: p.fingerprint, protocol: 'anthropic', maxOutputTokens: 1024, profile: p, now: Date.parse(p.updatedAt) + 31 * 86400000 });
    expect(d.blockers).toContain('LEMO_CAPABILITY_EXPIRED'); expect(() => lemoCapabilityTestPlan(NaN)).toThrow('BUDGET');
  });
  it('resolves credentials only in the host IPC facade and cancellation stops the active request', async () => {
    let started!: () => void; const sent = new Promise<void>(r => { started = r; });
    const f = await fixture(async (_body, options) => { started(); await new Promise<void>((_r, reject) => options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })); return undefined; });
    const resolver = vi.fn(async () => config); const ipc = createLemoCapabilityHandlers(f.service, resolver);
    const run = ipc.test(approval()); await sent; await ipc.cancel({ testId: approval().testId }); const p = await run;
    expect(p.status).toBe('interrupted'); expect(f.calls).toHaveLength(1); expect(resolver).toHaveBeenCalledWith(config.id);
  });
});
