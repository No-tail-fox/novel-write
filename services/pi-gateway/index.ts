import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, open, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { PiRequestLedger, rejectLinks, requestFingerprint } from './request-ledger';
import { object, verifyPiReceipt, type PiProtocol } from './receipt';
export { PiRequestLedger, requestFingerprint } from './request-ledger';
export { verifyPiReceipt, type PiReceipt, type PiProtocol } from './receipt';
export interface PiGatewayOptions {
  ledger: PiRequestLedger;
  provider: { protocol: PiProtocol; upstreamUrl: string; apiKey: string; auth: 'bearer' | 'x-api-key'; model: string };
  timeoutMs: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  allowLoopbackTestProvider?: boolean;
  /** Host admission only; rejection occurs before durable submission or upstream dispatch.
   * Receives an isolated copy so a budget hook cannot mutate the raw forwarded payload.
   */
  beforeSubmit?: (body: Readonly<Record<string, unknown>>) => void | Promise<void>;
  /** Trusted host transport (for example configured proxy); must honor signal and redirect:manual. */
  transport?: typeof fetch;
}
const routes: Record<PiProtocol, string> = { anthropic: '/v1/messages', 'openai-chat': '/v1/chat/completions', 'openai-responses': '/v1/responses' };
const admissionErrorCodes = new Set([
  'PI_OUTPUT_BOUND_REQUIRED', 'PI_INPUT_BOUND_UNSUPPORTED', 'PI_INPUT_CONTEXT_LIMIT', 'PI_BUDGET_INVALID',
  'PI_BUDGET_USAGE_UNREPORTED', 'PI_BUDGET_REQUEST_LIMIT', 'PI_BUDGET_TOKEN_LIMIT', 'PI_BUDGET_COST_LIMIT',
]);
function admissionErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  // Preserve only specific host preflight codes; never echo arbitrary provider/input data.
  return admissionErrorCodes.has(message) ? message : 'PI_GATEWAY_ADMISSION_REJECTED';
}
function reply(res: ServerResponse, status: number, message: string) {
  if (res.destroyed || res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message } }));
}
async function readRequest(req: IncomingMessage, limit: number) {
  let size = 0; const chunks: Buffer[] = [];
  for await (const part of req) { const bytes = Buffer.from(part); size += bytes.length; if (size > limit) throw new Error('PI_GATEWAY_REQUEST_SIZE'); chunks.push(bytes); }
  return Buffer.concat(chunks);
}
async function durableFile(path: string, bytes: Uint8Array) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
/** Native protocol boundary: no shared LLM adapter, retries, redirects, fallback or token clamping.
 * Full SSE is buffered; private response and receipt are synced before delivery. Directory ACLs
 * remain the host's responsibility. Neither usage nor protocol completion proves billing settlement.
 */
export async function startPiGateway(input: PiGatewayOptions) {
  const options = { ...input, provider: { ...input.provider } }; const p = options.provider;
  const endpoint = new URL(p.upstreamUrl);
  if (!Object.hasOwn(routes, p.protocol) || (endpoint.protocol !== 'https:' && !(options.allowLoopbackTestProvider && endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1'))
    || endpoint.username || endpoint.password || endpoint.hash || endpoint.search || !p.apiKey || /[\r\n]/.test(p.apiKey)
    || !['bearer', 'x-api-key'].includes(p.auth) || !p.model || !Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1) throw new Error('PI_GATEWAY_OPTIONS');
  const requestLimit = options.maxRequestBytes ?? 8 * 1024 * 1024; const responseLimit = options.maxResponseBytes ?? 32 * 1024 * 1024;
  if (![requestLimit, responseLimit].every(x => Number.isSafeInteger(x) && x > 0)) throw new Error('PI_GATEWAY_OPTIONS');
  const store = join(options.ledger.directory, 'private-responses'); await rejectLinks(store); await mkdir(store, { recursive: true, mode: 0o700 });
  const localToken = randomBytes(32).toString('hex'); const tasks = new Set<Promise<void>>(); const controllers = new Set<AbortController>();
  let closing = false; let active = false; let forwardedRequests = 0; let blockedRequests = 0; let closePromise: Promise<void> | undefined;
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const supplied = req.headers['x-api-key'] ?? req.headers.authorization?.replace(/^Bearer /, '');
    if (typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(localToken) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(localToken))) {
      blockedRequests++; reply(res, 403, 'PI_GATEWAY_AUTH'); req.resume(); return;
    }
    const route = req.url === routes[p.protocol] || (p.protocol === 'anthropic' && req.url === '/v1/messages?beta=true');
    if (closing || req.method !== 'POST' || !route || !req.headers['content-type']?.startsWith('application/json') || req.headers['content-encoding']) {
      blockedRequests++; reply(res, 400, 'PI_GATEWAY_ROUTE'); req.resume(); return;
    }
    // Reject overlapping calls rather than queueing a possibly automatic retry.
    if (active) { blockedRequests++; reply(res, 409, 'PI_GATEWAY_BUSY'); req.resume(); return; }
    active = true;
    const controller = new AbortController(); controllers.add(controller);
    const timer = setTimeout(() => { controller.abort(); if (!req.complete) req.destroy(); }, options.timeoutMs);
    const disconnect = () => { if (!res.writableFinished) controller.abort(); }; res.once('close', disconnect);
    let id: string | undefined; let status: number | undefined;
    try {
      const bytes = await readRequest(req, requestLimit); const body: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!object(body) || body.model !== p.model || (body.stream !== undefined && typeof body.stream !== 'boolean')
        || (p.protocol === 'openai-responses' ? body.input === undefined : !Array.isArray(body.messages) || !body.messages.length)) throw new Error('PI_GATEWAY_REQUEST');
      if (controller.signal.aborted) throw new Error('PI_GATEWAY_CANCELLED');
      const fingerprint = requestFingerprint({ endpoint: endpoint.href, protocol: p.protocol, body });
      try { await options.beforeSubmit?.(structuredClone(body)); }
      catch (error) { throw new Error(admissionErrorCode(error)); }
      if (controller.signal.aborted) throw new Error('PI_GATEWAY_CANCELLED');
      id = await options.ledger.begin(fingerprint);
      if (controller.signal.aborted) throw new Error('PI_GATEWAY_CANCELLED');
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (p.auth === 'bearer') headers.authorization = `Bearer ${p.apiKey}`; else headers['x-api-key'] = p.apiKey;
      if (p.protocol === 'anthropic') {
        headers['anthropic-version'] = '2023-06-01';
        const beta = req.headers['anthropic-beta']; if (typeof beta === 'string' && beta.length <= 4096) headers['anthropic-beta'] = beta;
      }
      forwardedRequests++;
      const upstream = await (options.transport ?? fetch)(endpoint, { method: 'POST', body: bytes, headers, redirect: 'manual', signal: controller.signal }); status = upstream.status;
      if (status !== 200) {
        await upstream.body?.cancel(); await options.ledger.settle(id, { outcome: status >= 400 && status < 500 && status !== 408 ? 'rejected' : 'unknown', httpStatus: status, protocol: p.protocol });
        id = undefined; reply(res, 502, 'PI_GATEWAY_PROVIDER_REJECTED_OR_UNRESOLVED'); return;
      }
      const contentType = upstream.headers.get('content-type') ?? '';
      if (!upstream.body || (body.stream ? !contentType.startsWith('text/event-stream') : !contentType.startsWith('application/json'))) {
        await upstream.body?.cancel(); throw new Error('PI_GATEWAY_CONTENT_TYPE');
      }
      const reader = upstream.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
        if (size > responseLimit) throw new Error('PI_GATEWAY_RESPONSE_SIZE'); chunks.push(part.value); } }
      finally { await reader.cancel().catch(() => {}); }
      const response = Buffer.concat(chunks); const receipt = verifyPiReceipt(response, p.protocol, body.stream === true);
      const staging = join(store, `.${id}.pending`); const destination = join(store, id);
      await rejectLinks(staging); await rejectLinks(destination); await mkdir(staging, { mode: 0o700 });
      await durableFile(join(staging, 'response.bin'), response);
      await durableFile(join(staging, 'receipt.json'), Buffer.from(JSON.stringify({ version: 1, requestId: id, fingerprint, stream: body.stream === true, byteLength: response.length, receipt })));
      await rename(staging, destination);
      await options.ledger.settle(id, receipt); id = undefined;
      if (!res.destroyed) { res.writeHead(200, { 'content-type': body.stream ? 'text/event-stream; charset=utf-8' : 'application/json', 'cache-control': 'no-store' }); res.end(response); }
    } catch (e) {
      if (id) { try { await options.ledger.settle(id, { outcome: 'unknown', protocol: p.protocol, ...(status === undefined ? {} : { httpStatus: status }) }); } catch { /* Failed persistence leaves this ledger poisoned. */ } }
      blockedRequests++; const raw = e instanceof Error ? e.message : ''; const message = admissionErrorCodes.has(raw) ? raw : e instanceof Error && /^PI_(GATEWAY|LEDGER)_[A-Z_]+$/.test(raw) ? raw : 'PI_GATEWAY_UNRESOLVED'; reply(res, 400, message);
    } finally { clearTimeout(timer); controllers.delete(controller); res.off('close', disconnect); active = false; }
  };
  const server = createServer((req, res) => { const task = handle(req, res); tasks.add(task); void task.finally(() => tasks.delete(task)); });
  server.requestTimeout = options.timeoutMs; server.headersTimeout = Math.min(options.timeoutMs, 10000);
  await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', () => { server.off('error', fail); ok(); }); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('PI_GATEWAY_ADDRESS');
  return { baseUrl: `http://127.0.0.1:${address.port}`, localToken,
    summary: () => ({ forwardedRequests, blockedRequests, ...options.ledger.summary() }),
    close: () => closePromise ??= (async () => { closing = true; for (const c of controllers) c.abort(); server.closeAllConnections();
      await new Promise<void>(r => server.close(() => r())); await Promise.allSettled([...tasks]); })(),
  };
}
