import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { LemoRequestLedger, requestFingerprint } from './request-ledger';
import { LLM_PROTOCOLS, type LlmProtocol } from '../../src/shared/llm-protocol';
import { verifyLemoProviderReceipt } from './provider-receipt';

export interface MessagesGatewayOptions {
  ledger: LemoRequestLedger;
  provider: { protocol: LlmProtocol; messagesUrl: string; apiKey: string; auth: 'bearer' | 'x-api-key'; model: string };
  maxOutputTokens: number;
  timeoutMs: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  /** Protocol tests only: only 127.0.0.1 is permitted, never arbitrary HTTP. */
  allowLoopbackTestProvider?: boolean;
}
import { LemoResponseStore } from './response-store';
export { verifyMessagesReceipt } from './message-receipt';
function object(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v); }

function reply(res: ServerResponse, status: number, message: string) {
  if (res.destroyed || res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message } }));
}
async function readRequest(req: IncomingMessage, limit: number) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    const b = Buffer.from(chunk); size += b.length;
    if (size > limit) throw new Error('LEMO_GATEWAY_REQUEST_SIZE'); chunks.push(b);
  }
  return Buffer.concat(chunks);
}
/** Authenticated loopback boundary. Buffers SSE until a complete provider receipt is durable.
 * Deliberately no transparent retry, response replay, endpoint fallback, redirects or token clamping.
 * This validates protocol completion, not artistic quality, billing settlement or production readiness.
 */
export async function startLemoMessagesGateway(options: MessagesGatewayOptions) {
  // Pin this stage's provider/model configuration; later settings edits must not reroute in-flight work.
  options = { ...options, provider: { ...options.provider } };
  const protocol = options.provider.protocol;
  const route = protocol === 'anthropic' ? '/messages' : protocol === 'responses' ? '/responses' : '/chat/completions';
  const endpoint = new URL(options.provider.messagesUrl);
  if ((endpoint.protocol !== 'https:' && !(options.allowLoopbackTestProvider && endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1'))
    || !LLM_PROTOCOLS.includes(protocol) || endpoint.username || endpoint.password || endpoint.hash || endpoint.search || !endpoint.pathname.endsWith(route)
    || (protocol !== 'anthropic' && options.provider.auth !== 'bearer')
    || !options.provider.apiKey || /[\r\n]/.test(options.provider.apiKey) || !['bearer','x-api-key'].includes(options.provider.auth)
    || !options.provider.model || !Number.isInteger(options.maxOutputTokens) || options.maxOutputTokens < 1
    || !Number.isInteger(options.timeoutMs) || options.timeoutMs < 1) throw new Error('LEMO_GATEWAY_OPTIONS');
  const requestLimit = options.maxRequestBytes ?? 8 * 1024 * 1024;
  const responseLimit = options.maxResponseBytes ?? 32 * 1024 * 1024;
  if (![requestLimit,responseLimit].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('LEMO_GATEWAY_OPTIONS');
  const responseStore = await LemoResponseStore.open(options.ledger.responseDirectory, responseLimit);
  const localToken = randomBytes(32).toString('hex');
  const controllers = new Set<AbortController>(); const tasks = new Set<Promise<void>>();
  let closing = false; let forwardedRequests = 0; let blockedRequests = 0;
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const supplied = req.headers['x-api-key'] ?? req.headers.authorization?.replace(/^Bearer /, '');
    if (typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(localToken)
      || !timingSafeEqual(Buffer.from(supplied), Buffer.from(localToken))) { blockedRequests++; reply(res, 403, 'LEMO_GATEWAY_AUTH'); return; }
    if (closing || req.method !== 'POST' || !(req.url === '/v1' + route || (protocol === 'anthropic' && req.url === '/v1/messages?beta=true'))
      || !req.headers['content-type']?.startsWith('application/json') || req.headers['content-encoding']) {
      blockedRequests++; reply(res, 400, 'LEMO_GATEWAY_ROUTE'); return;
    }
    const length = req.headers['content-length'];
    if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > requestLimit)) {
      blockedRequests++; reply(res, 413, 'LEMO_GATEWAY_REQUEST_SIZE'); req.resume(); return;
    }
    const controller = new AbortController(); controllers.add(controller);
    const timer = setTimeout(() => { controller.abort(); if (!req.complete) req.destroy(); }, options.timeoutMs);
    const disconnect = () => { if (!res.writableFinished) controller.abort(); };
    res.once('close', disconnect);
    let id: string | undefined; let status: number | undefined;
    try {
      const bytes = await readRequest(req, requestLimit);
      const body: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!object(body)) throw new Error('LEMO_GATEWAY_REQUEST');
      const messages = protocol === 'responses' ? body.input : body.messages;
      const budget = protocol === 'responses' ? body.max_output_tokens : protocol === 'openai' ? body.max_completion_tokens ?? body.max_tokens : body.max_tokens;
      if (body.model !== options.provider.model || !Array.isArray(messages) || !messages.length
        || (body.stream !== undefined && typeof body.stream !== 'boolean') || !Number.isInteger(budget)
        || (budget as number) < 1 || (budget as number) > options.maxOutputTokens
        || (protocol === 'openai' && body.max_tokens !== undefined && body.max_completion_tokens !== undefined)
        || (protocol === 'responses' && (body.store !== false || body.background === true || body.previous_response_id !== undefined))) throw new Error('LEMO_GATEWAY_REQUEST');
      if (controller.signal.aborted) throw new Error('LEMO_GATEWAY_CANCELLED');
      // SDK retry metadata is not a new creative instruction and cannot bypass deduplication.
      const { metadata: _metadata, ...semanticBody } = body;
      const fingerprint = requestFingerprint({ endpoint: endpoint.href, body: semanticBody });
      id = await options.ledger.begin(fingerprint);
      if (controller.signal.aborted) {
        await options.ledger.settle(id, { outcome: 'rejected' }); id = undefined; throw new Error('LEMO_GATEWAY_CANCELLED');
      }
      const headers: Record<string, string> = { 'content-type': 'application/json', ...(protocol === 'anthropic' ? { 'anthropic-version': '2023-06-01' } : {}) };
      if (options.provider.auth === 'bearer') headers.authorization = `Bearer ${options.provider.apiKey}`;
      else headers['x-api-key'] = options.provider.apiKey;
      const beta = req.headers['anthropic-beta'];
      if (protocol === 'anthropic' && typeof beta === 'string' && beta.length <= 4096) headers['anthropic-beta'] = beta;
      forwardedRequests++;
      const upstream = await fetch(endpoint, { method: 'POST', body: bytes, headers, redirect: 'manual', signal: controller.signal });
      status = upstream.status;
      if (status !== 200) {
        // No upstream error text in logs/UI. Even rate limits are not retried behind the user's back.
        await upstream.body?.cancel();
        await options.ledger.settle(id, { outcome: status >= 400 && status < 500 && status !== 408 ? 'rejected' : 'unknown', httpStatus: status });
        id = undefined; reply(res, 400, 'LEMO_GATEWAY_PROVIDER_REJECTED_OR_UNRESOLVED'); return;
      }
      const contentType = upstream.headers.get('content-type') ?? '';
      if (body.stream ? !contentType.startsWith('text/event-stream') : !contentType.startsWith('application/json')) throw new Error('LEMO_GATEWAY_CONTENT_TYPE');
      if (!upstream.body) throw new Error('LEMO_GATEWAY_INCOMPLETE');
      const reader = upstream.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
          if (size > responseLimit) throw new Error('LEMO_GATEWAY_RESPONSE_SIZE'); chunks.push(part.value); }
      } finally { await reader.cancel().catch(() => {}); }
      const response = Buffer.concat(chunks);
      const receipt = verifyLemoProviderReceipt(protocol, response, body.stream === true);
      // Persist the complete private result BEFORE its receipt or delivery to the SDK.
      // A crash here is recovered explicitly from local evidence, never by recharging.
      await responseStore.save({ requestId: id, fingerprint, stream: body.stream === true, response, ...(protocol === 'anthropic' ? {} : { protocol }) });
      await options.ledger.settle(id, { outcome: 'received', httpStatus: 200, ...receipt }); id = undefined;
      res.writeHead(200, { 'content-type': body.stream ? 'text/event-stream; charset=utf-8' : 'application/json', 'cache-control': 'no-store' });
      res.end(response);
    } catch (error) {
      if (id) { try { await options.ledger.settle(id, { outcome: 'unknown', ...(status === undefined ? {} : { httpStatus: status }) }); } catch { /* A failed journal write poisons this run; never forward another request. */ } }
      blockedRequests++;
      const safe = error instanceof Error && /^LEMO_(LEDGER|GATEWAY)_[A-Z_]+/.test(error.message) ? error.message.split(':')[0] : 'LEMO_GATEWAY_UNRESOLVED';
      reply(res, 400, safe);
    } finally { clearTimeout(timer); controllers.delete(controller); res.off('close', disconnect); }
  };
  const server = createServer((req, res) => { const task = handle(req, res); tasks.add(task); void task.finally(() => tasks.delete(task)); });
  server.requestTimeout = options.timeoutMs; server.headersTimeout = Math.min(options.timeoutMs, 10000);
  await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', () => { server.off('error', fail); ok(); }); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('LEMO_GATEWAY_ADDRESS');
  return { baseUrl: `http://127.0.0.1:${address.port}`, localToken,
    summary: () => ({ forwardedRequests, blockedRequests, ...options.ledger.summary() }),
    close: async () => { if (closing) return; closing = true; for (const c of controllers) c.abort();
      server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await Promise.allSettled([...tasks]); },
  };
}
