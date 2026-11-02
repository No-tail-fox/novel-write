import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { inspectLemoProviderResponse, verifyLemoProviderReceipt } from '../services/lemo-agent-worker/provider-receipt';
import { LemoProviderCapabilityService } from '../electron/lemo-provider-capability-service';
import { lemoCapabilityIdentity } from '../electron/lemo-capability-store';
import { decideLemoProviderCapability } from '../src/shared/lemo-provider-capabilities';
import { openLemoNativeBudget } from '../electron/lemo-native-budget';
import type { LlmConfig } from '../src/shared/types';

type Json = Record<string, any>;
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function temporary() { const root = await mkdtemp(join(tmpdir(), 'lemo-native-protocol-')); roots.push(root); return root; }
import { frame, nativeReply, nativeStream } from './fixtures/lemo-native-wire';
describe.each(['openai', 'responses'] as const)('%s durable provider receipts', protocol => {
  it('checks a native text/tool response without losing the original wire hash', () => {
    for (const calls of [[], [{ name: 'write_text', input: { path: 'FILM.html', content: '中文' } }]]) {
      const raw = Buffer.from(JSON.stringify(nativeReply(protocol, 'OK', calls)));
      expect(verifyLemoProviderReceipt(protocol, raw, false)).toMatchObject({ stopReason: calls.length ? 'tool_use' : 'end_turn', responseSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
      expect(inspectLemoProviderResponse(protocol, raw, false).content[0].type).toBe(calls.length ? 'tool_use' : 'text');
    }
  });
  it('requires protocol completion, rather than a terminal-looking word in text', () => {
    expect(verifyLemoProviderReceipt(protocol, Buffer.from(nativeStream(protocol)), true).stopReason).toBe('end_turn');
    expect(() => verifyLemoProviderReceipt(protocol, Buffer.from(nativeStream(protocol, true)), true)).toThrow('INCOMPLETE');
    expect(() => verifyLemoProviderReceipt(protocol, Buffer.from(nativeStream(protocol) + frame({ text: 'late data' })), true)).toThrow('INCOMPLETE');
  });
  it.each(['missing-id', 'bad-arguments', 'duplicate-call', 'wrong-role', 'unfinished'])('rejects %s before tool execution', kind => {
    const value = nativeReply(protocol, 'OK', kind === 'bad-arguments' || kind === 'duplicate-call' ? [{ name: 'write_text', input: {} }] : []);
    if (kind === 'missing-id') delete value.id;
    if (kind === 'bad-arguments') { if (protocol === 'openai') value.choices[0].message.tool_calls[0].function.arguments = '{'; else value.output[0].arguments = '{'; }
    if (kind === 'duplicate-call') { if (protocol === 'openai') value.choices[0].message.tool_calls.push(value.choices[0].message.tool_calls[0]); else value.output.push(value.output[0]); }
    if (kind === 'wrong-role') { if (protocol === 'openai') value.choices[0].message.role = 'user'; else value.output[0].role = 'user'; }
    if (kind === 'unfinished') { if (protocol === 'openai') value.choices[0].finish_reason = null; else value.status = 'in_progress'; }
    expect(() => verifyLemoProviderReceipt(protocol, Buffer.from(JSON.stringify(value)), false)).toThrow('INCOMPLETE');
  });
});
function pngColor(data: string) {
  const png = Buffer.from(data, 'base64');
  for (let offset = 8; offset < png.length;) {
    const n = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') { const pixels = inflateSync(png.subarray(offset + 8, offset + 8 + n)); return pixels[1] === 255 ? 'red' : pixels[2] === 190 ? 'green' : 'blue'; }
    offset += n + 12;
  }
  throw new Error('fixture PNG');
}
describe.each(['openai', 'responses'] as const)('%s configured capability gate', protocol => {
  it('runs six native probes, retains local-fixture status and never replays an approval', async () => {
    const directory = await temporary(); const calls: Json[] = [];
    const config: LlmConfig = { id: 'native-profile', provider: 'custom', protocol, baseUrl: 'https://fixture.invalid/v1', apiKey: 'private-key', model: 'fixture-model', proxyUrl: '', requestParamsJson: '{}' };
    const service = new LemoProviderCapabilityService({ directory, transport: async (url, options) => {
      const body = JSON.parse(String(options.body)); calls.push(body);
      expect(url).toMatch(protocol === 'openai' ? /chat\/completions$/ : /responses$/);
      expect(options.headers).toMatchObject({ authorization: 'Bearer private-key' });
      expect(options.retryConnectTimeout).toBe(false);
      let answer = 'OK'; let toolCalls: Array<{ name: string; input: unknown }> = [];
      if (calls.length === 1) { const definition = protocol === 'openai' ? body.tools[0].function : body.tools[0]; toolCalls = [{ name: definition.name, input: { token: definition.parameters.properties.token.enum[0] } }]; }
      else if (calls.length === 2) answer = protocol === 'openai' ? body.messages.at(-1).content : body.input.at(-1).output;
      else if (calls.length === 3) { const part = (protocol === 'openai' ? body.messages : body.input)[0].content[0]; answer = pngColor((protocol === 'openai' ? part.image_url.url : part.image_url).split(',')[1]); }
      if (options.onResponseChunk) {
        options.onResponseChunk(Buffer.from(nativeStream(protocol, true)), new Response(null, { headers: { 'content-type': 'text/event-stream' } }));
        expect(options.signal?.aborted).toBe(true); throw new DOMException('aborted', 'AbortError');
      }
      return new Response(body.stream ? nativeStream(protocol) : JSON.stringify(nativeReply(protocol, answer, toolCalls)), { headers: { 'content-type': body.stream ? 'text/event-stream' : 'application/json' } });
    } });
    const preflight = await service.preflight(config, 1024); expect(preflight).toMatchObject({ protocol, staticReady: true }); expect(calls).toHaveLength(0);
    const approval = { profileId: config.id!, testId: 'native-test-0001', expectedFingerprint: lemoCapabilityIdentity(config).fingerprint, acknowledgePotentialCharges: true as const, maxRequests: 6, maxOutputTokensTotal: 1472, outputBudget: 1024 };
    const profile = await service.test(config, approval);
    expect(Object.values(profile.checks).map(c => c.status)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass']);
    expect(profile.protocol).toBe(protocol); expect(profile.evidenceSource).toBe('local-fixture'); expect(calls).toHaveLength(6);
    expect((await service.decision(config, 1024)).blockers).toContain('LEMO_CAPABILITY_FIXTURE_ONLY');
    expect(decideLemoProviderCapability({ fingerprint: profile.fingerprint, protocol: protocol === 'openai' ? 'responses' : 'openai', maxOutputTokens: 1024, profile }).blockers).toContain('LEMO_CAPABILITY_PROTOCOL_MISMATCH');
    expect(await service.test(config, approval)).toEqual(profile); expect(calls).toHaveLength(6);
    expect(await readFile(join(directory, profile.fingerprint, profile.testId + '.json'), 'utf8')).not.toContain('private-key');
  });
});
it('keeps one native time/token policy across stages and pauses without inventing costs', async () => {
  const directory = await temporary(); const policy = { protocol: 'openai' as const, maxRequests: 10, maxOutputTokens: 1024, timeoutMs: 10000 };
  expect(await openLemoNativeBudget(directory, policy, false, 1000)).toMatchObject({ remainingMs: 10000, maximumOutputTokens: 10240, costEstimate: 'unavailable' });
  expect((await openLemoNativeBudget(directory, policy, true, 5000)).remainingMs).toBe(6000);
  await expect(openLemoNativeBudget(directory, { ...policy, maxRequests: 20 }, true, 5000)).rejects.toThrow('POLICY_CHANGED');
  await expect(openLemoNativeBudget(directory, policy, true, 11000)).rejects.toThrow('TIME_EXHAUSTED');
});
