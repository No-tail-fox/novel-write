import { randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import type { LlmConfig } from '../src/shared/types';
import { fetchWithTimeout, type FetchWithTimeoutOptions } from '../src/shared/http';
import { requireGenerationAuthorization, wasGenerationNotSubmitted } from '../src/shared/generation-authorization';
import { inspectLemoProviderResponse, verifyLemoProviderReceipt } from '../services/lemo-agent-worker/provider-receipt';
import { isLemoCapabilityStreamStart, lemoCapabilityWireBody } from './lemo-capability-protocol';
import { decideLemoProviderCapability, LEMO_PROVIDER_CAPABILITIES, lemoCapabilityTestPlan, lemoCapabilityTestRequestSchema,
  type LemoCapabilityPreflight, type LemoCapabilityProfile, type LemoCapabilityTestRequest, type LemoProviderCapability } from '../src/shared/lemo-provider-capabilities';
import { capabilityHash, lemoCapabilityIdentity, LemoCapabilityStore } from './lemo-capability-store';

type Json = Record<string, unknown>;
const object = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const fail = (code: string): never => { throw new Error(code); };
const safeCode = (e: unknown) => e instanceof Error && /^LEMO_CAPABILITY_[A-Z0-9_]+$/.test(e.message) ? e.message
  : e instanceof Error && e.message === 'LEMO_GATEWAY_INCOMPLETE' ? 'LEMO_CAPABILITY_INCOMPLETE_RESPONSE' : 'LEMO_CAPABILITY_UNRESOLVED';
const emptyCheck = (): LemoCapabilityProfile['checks']['sse'] => ({ status: 'not-tested', code: 'LEMO_CAPABILITY_NOT_TESTED', requestIndexes: [] });
function textOf(v: Json) {
  return (Array.isArray(v.content) ? v.content : []).filter(x => object(x) && x.type === 'text').map(x => (x as Json).text).join('').trim();
}
function checkMessage(v: Json, expected: string) {
  if (v.stop_reason !== 'end_turn' || textOf(v).replace(/[.!\s]+$/g, '').toLowerCase() !== expected.toLowerCase()) fail('LEMO_CAPABILITY_RESPONSE_MISMATCH');
}
function usage(v: unknown): { inputTokens?: number; outputTokens?: number } {
  if (!object(v)) return {};
  const good = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0;
  return { ...(good(v.input_tokens) ? { inputTokens: v.input_tokens as number } : {}), ...(good(v.output_tokens) ? { outputTokens: v.output_tokens as number } : {}) };
}
/** Small generated PNG; the answer is not disclosed in the image prompt. */
function colorImage() {
  const colors = [{ name: 'red', rgb: [255, 0, 0] }, { name: 'green', rgb: [0, 190, 0] }, { name: 'blue', rgb: [0, 0, 255] }];
  const selected = colors[randomBytes(1)[0] % colors.length];
  const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const n of b) { c ^= n; for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; };
  const chunk = (name: string, value: Buffer) => { const bytes = Buffer.concat([Buffer.from(name), value]); const header = Buffer.alloc(4); header.writeUInt32BE(value.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(bytes)); return Buffer.concat([header, bytes, crc]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(32, 0); header.writeUInt32BE(32, 4); header[8] = 8; header[9] = 2;
  const scan = Buffer.alloc(32 * 97); for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) selected.rgb.forEach((v, n) => { scan[y * 97 + 1 + x * 3 + n] = v; });
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(scan)), chunk('IEND', Buffer.alloc(0))]);
  return { data: png.toString('base64'), expected: selected.name };
}
export interface LemoCapabilityServiceOptions {
  directory: string;
  /** Injection is for deterministic tests. Production uses the normal authorized provider transport. */
  transport?: (url: string, options: FetchWithTimeoutOptions) => Promise<Response>;
  evidenceSource?: 'live-provider' | 'local-fixture';
  now?: () => number;
}
export class LemoProviderCapabilityService {
  readonly store: LemoCapabilityStore;
  private readonly transport;
  private readonly now;
  constructor(private readonly options: LemoCapabilityServiceOptions) {
    this.store = new LemoCapabilityStore(options.directory); this.transport = options.transport ?? fetchWithTimeout; this.now = options.now ?? Date.now;
  }
  /** Read-only, zero-charge: it never infers compatibility from a model name. */
  async preflight(config: LlmConfig, maxOutputTokens: number): Promise<LemoCapabilityPreflight> {
    const identity = lemoCapabilityIdentity(config);
    const blockers: string[] = [];
    if (!config.apiKey.trim()) blockers.push('LEMO_CAPABILITY_CREDENTIAL_REQUIRED');
    if (config.enabled === false) blockers.push('LEMO_CAPABILITY_PROFILE_DISABLED');
    return { fingerprint: identity.fingerprint, endpoint: identity.endpoint, model: identity.model, protocol: identity.protocol, staticReady: !blockers.length, blockers,
      profile: await this.store.latest(identity.fingerprint), testPlan: lemoCapabilityTestPlan(maxOutputTokens) };
  }
  async decision(config: LlmConfig, maxOutputTokens: number) {
    const preflight = await this.preflight(config, maxOutputTokens);
    const decision = decideLemoProviderCapability({ fingerprint: preflight.fingerprint, protocol: lemoCapabilityIdentity(config).protocol,
      maxOutputTokens, profile: preflight.profile, now: this.now() });
    return { ...decision, ready: preflight.staticReady && decision.ready, blockers: [...new Set([...preflight.blockers, ...decision.blockers])] };
  }
  async assertReady(config: LlmConfig, maxOutputTokens: number, options: { allowLoopbackTestProvider?: boolean } = {}) {
    if (options.allowLoopbackTestProvider === true) {
      const identity = lemoCapabilityIdentity(config, true);
      const url = new URL(identity.endpoint);
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') fail('LEMO_CAPABILITY_FIXTURE_BYPASS');
      lemoCapabilityTestPlan(maxOutputTokens);
      return { ready: true, protocol: identity.protocol, blockers: [], maxOutputTokens, fingerprint: identity.fingerprint };
    }
    const result = await this.decision(config, maxOutputTokens);
    if (!result.ready) throw new Error(result.blockers.join('; '));
    return result;
  }
  /** Each new testId is a separate explicit approval. Replaying an id never resends a request. */
  async test(config: LlmConfig, input: LemoCapabilityTestRequest, signal?: AbortSignal): Promise<LemoCapabilityProfile> {
    const request = lemoCapabilityTestRequestSchema.parse(input);
    if (!config.id || request.profileId !== config.id) fail('LEMO_CAPABILITY_PROFILE_MISMATCH');
    const preflight = await this.preflight(config, request.outputBudget);
    if (request.expectedFingerprint !== preflight.fingerprint) fail('LEMO_CAPABILITY_CONFIGURATION_CHANGED');
    if (!preflight.staticReady) fail(preflight.blockers[0]);
    if (request.maxRequests < 6 || request.maxOutputTokensTotal < preflight.testPlan.maxOutputTokensTotal) fail('LEMO_CAPABILITY_APPROVAL_BUDGET');
    const previous = await this.store.read(preflight.fingerprint, request.testId);
    if (previous) return previous;
    signal?.throwIfAborted(); await requireGenerationAuthorization();
    const release = await this.store.lock(preflight.fingerprint);
    try {
      const duplicate = await this.store.read(preflight.fingerprint, request.testId); if (duplicate) return duplicate;
      const identity = lemoCapabilityIdentity(config);
      const p: LemoCapabilityProfile = { version: 1, fingerprint: identity.fingerprint, configurationHash: identity.configurationHash, endpoint: identity.endpoint, model: identity.model, protocol: identity.protocol,
        testId: request.testId, evidenceSource: this.options.evidenceSource ?? (this.options.transport ? 'local-fixture' : 'live-provider'),
        startedAt: new Date(this.now()).toISOString(), updatedAt: new Date(this.now()).toISOString(), status: 'running', acceptedMaxOutputTokens: 0,
        approvedMaxRequests: request.maxRequests, approvedMaxOutputTokens: request.maxOutputTokensTotal, reservedOutputTokens: 0, requests: [],
        checks: { 'tool-roundtrip': emptyCheck(), 'image-input': emptyCheck(), sse: emptyCheck(), 'client-cancel': emptyCheck(), 'output-budget': emptyCheck() } };
      const save = async () => { p.updatedAt = new Date(this.now()).toISOString(); await this.store.save(p); };
      await save();
      const send = async (capability: LemoProviderCapability, body: Json, cancel = false): Promise<Json> => {
        signal?.throwIfAborted(); await requireGenerationAuthorization();
        const max = body.max_tokens as number;
        if (p.requests.length >= p.approvedMaxRequests || p.reservedOutputTokens + max > p.approvedMaxOutputTokens) fail('LEMO_CAPABILITY_BUDGET_EXHAUSTED');
        const bytes = JSON.stringify({ ...lemoCapabilityWireBody(identity.protocol, body), model: identity.model });
        const record: LemoCapabilityProfile['requests'][number] = { index: p.requests.length, capability, state: 'sent', maxOutputTokens: max, requestHash: capabilityHash(bytes) };
        p.requests.push(record); p.reservedOutputTokens += max; p.checks[capability].requestIndexes.push(record.index);
        await save(); // Durable intent precedes the only network dispatch. No transport retries.
        const controller = new AbortController();
        const onAbort = () => controller.abort(); signal?.addEventListener('abort', onAbort, { once: true });
        const timeoutMs = Math.min(config.timeoutMs ?? 180000, 180000);
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let cancellationObserved = false; let transportReturned = false; let beginning = '';
        try {
          const response = await this.transport(identity.endpoint, { method: 'POST', generation: true, redirect: 'manual', maxRedirects: 0, retryConnectTimeout: false,
            timeoutMs, maxBytes: 256 * 1024, signal: controller.signal, headers: { 'content-type': 'application/json',
              ...(identity.protocol === 'anthropic' ? { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' } : { authorization: 'Bearer ' + config.apiKey }) }, body: bytes,
            ...(cancel ? { onResponseChunk: (chunk: Uint8Array, upstream: Response) => {
              if (upstream.status !== 200 || !upstream.headers.get('content-type')?.startsWith('text/event-stream')) return;
              beginning += new TextDecoder().decode(chunk);
              if (beginning.length > 32768 || beginning.includes('event: message_stop')) return;
              for (const frame of beginning.replaceAll('\r\n', '\n').split('\n\n').slice(0, -1)) {
                const data = frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
                if (!data) continue;
                try { const event = JSON.parse(data); if (isLemoCapabilityStreamStart(identity.protocol, event)) { cancellationObserved = true; controller.abort(); return; } } catch { /* Only a complete protocol start qualifies. */ }
              }
            } } : {}) });
          transportReturned = true; record.httpStatus = response.status;
          if (response.status !== 200) {
            record.state = response.status >= 400 && response.status < 500 && response.status !== 408 ? 'rejected' : 'unknown';
            await response.body?.cancel(); fail('LEMO_CAPABILITY_HTTP_' + response.status);
          }
          if (cancel) { await response.body?.cancel(); fail('LEMO_CAPABILITY_CANCEL_NOT_OBSERVED'); }
          const stream = body.stream === true;
          if (!response.headers.get('content-type')?.startsWith(stream ? 'text/event-stream' : 'application/json')) fail('LEMO_CAPABILITY_CONTENT_TYPE');
          const received = new Uint8Array(await response.arrayBuffer());
          if (received.byteLength > 256 * 1024) fail('LEMO_CAPABILITY_RESPONSE_TOO_LARGE');
          const receipt = verifyLemoProviderReceipt(identity.protocol, received, stream);
          record.responseHash = receipt.responseSha256; record.messageId = receipt.messageId; record.stopReason = receipt.stopReason; record.state = 'received';
          if (stream) { if (receipt.stopReason !== 'end_turn') fail('LEMO_CAPABILITY_STREAM_TRUNCATED'); return { receipt }; }
          const message: unknown = inspectLemoProviderResponse(identity.protocol, received, false);
          if (!object(message)) return fail('LEMO_CAPABILITY_MESSAGE');
          Object.assign(record, usage(message.usage));
          return { ...message, ...(identity.protocol === 'responses' ? { rawResponse: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(received)) } : {}) };
        } catch (e) {
          if (cancel && !transportReturned && cancellationObserved && controller.signal.aborted && !signal?.aborted) {
            record.state = 'cancelled-locally'; return { cancelled: true };
          }
          if (record.state === 'sent') record.state = wasGenerationNotSubmitted(e) ? 'rejected' : 'unknown';
          throw new Error(safeCode(e));
        } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); await save(); }
      };
      const user = (content: unknown) => [{ role: 'user', content }];
      const toolName = 'storydream_capability_echo';
      const nonce = randomBytes(12).toString('hex');
      const tool = { name: toolName, description: 'Return the supplied capability-test token unchanged.', input_schema: { type: 'object', properties: { token: { type: 'string', enum: [nonce] } }, required: ['token'], additionalProperties: false } };
      const tests: Record<LemoProviderCapability, () => Promise<void>> = {
        'tool-roundtrip': async () => {
          const messages = user('Call the provided echo tool with the token ' + nonce + '. After its result, reply with only the returned token.');
          const first = await send('tool-roundtrip', { max_tokens: 128, stream: false, tools: [tool], tool_choice: { type: 'tool', name: toolName }, messages });
          const content = Array.isArray(first.content) ? first.content : [];
          const calls = content.filter(v => object(v) && v.type === 'tool_use');
          const call = calls[0];
          if (first.stop_reason !== 'tool_use' || calls.length !== 1 || !object(call) || call.name !== toolName || !object(call.input) || call.input.token !== nonce || typeof call.id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(call.id)) fail('LEMO_CAPABILITY_TOOL_MISMATCH');
          const final = await send('tool-roundtrip', { max_tokens: 64, stream: false, tools: [tool], tool_choice: { type: 'auto' },
            messages: [...messages, { role: 'assistant', content, ...(first.rawResponse ? { rawResponse: first.rawResponse } : {}) }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: nonce }] }] });
          checkMessage(final, nonce);
        },
        'image-input': async () => {
          const png = colorImage();
          const response = await send('image-input', { max_tokens: 64, stream: false, messages: user([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.data } }, { type: 'text', text: 'What is the colour of this image? Reply with exactly one lowercase English colour word.' }]) });
          checkMessage(response, png.expected);
        },
        sse: async () => { await send('sse', { max_tokens: 64, stream: true, messages: user('Reply with exactly OK.') }); },
        'client-cancel': async () => { await send('client-cancel', { max_tokens: 128, stream: true, messages: user('Count slowly from 1 to 200, writing each number on a separate line.') }, true); },
        'output-budget': async () => {
          const response = await send('output-budget', { max_tokens: request.outputBudget, stream: false, messages: user('Reply with exactly OK.') });
          checkMessage(response, 'OK'); p.acceptedMaxOutputTokens = request.outputBudget;
        },
      };
      for (const capability of LEMO_PROVIDER_CAPABILITIES) {
        try { await tests[capability](); p.checks[capability].status = 'pass'; p.checks[capability].code = capability === 'client-cancel' ? 'LEMO_CAPABILITY_LOCAL_CANCEL_REMOTE_COST_UNKNOWN' : capability === 'output-budget' ? 'LEMO_CAPABILITY_BUDGET_ACCEPTED_NOT_FULL_LENGTH_GENERATED' : 'LEMO_CAPABILITY_VERIFIED'; }
        catch (e) {
          const unknown = p.requests.some(r => r.state === 'unknown' || r.state === 'sent');
          p.checks[capability].status = unknown ? 'unknown' : 'fail'; p.checks[capability].code = safeCode(e);
          if (unknown || signal?.aborted || p.requests.some(r => r.httpStatus === 401 || r.httpStatus === 403)) { p.status = 'interrupted'; await save(); return p; }
        }
        await save();
      }
      p.status = 'complete'; await save(); return p;
    } finally { await release(); }
  }
}

/** IPC integration resolves stored configuration in the host, never takes renderer-supplied credentials. */
export function createLemoCapabilityHandlers(service: LemoProviderCapabilityService, resolveConfig: (profileId: string) => Promise<LlmConfig>) {
  const active = new Map<string, AbortController>();
  return {
    preflight: async (input: { profileId: string; maxOutputTokens: number }) => service.preflight(await resolveConfig(input.profileId), input.maxOutputTokens),
    test: async (input: LemoCapabilityTestRequest) => {
      const request = lemoCapabilityTestRequestSchema.parse(input);
      if (active.has(request.testId)) fail('LEMO_CAPABILITY_TEST_LOCKED');
      const controller = new AbortController(); active.set(request.testId, controller);
      try { return await service.test(await resolveConfig(request.profileId), request, controller.signal); }
      finally { active.delete(request.testId); }
    },
    cancel: async (input: { testId: string }) => {
      if (!/^[A-Za-z0-9_-]{8,100}$/.test(input?.testId)) fail('LEMO_CAPABILITY_TEST_ID');
      active.get(input.testId)?.abort();
    },
  };
}
