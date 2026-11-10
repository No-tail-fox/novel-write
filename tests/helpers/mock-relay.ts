/**
 * Q-4: a scriptable local "relay station" (中转站) for provider fault-injection tests.
 *
 * Everything binds to 127.0.0.1 on an ephemeral port; nothing leaves the machine. Each incoming
 * request consumes the next scripted behaviour (or the fallback handler), and every request the
 * server actually received is recorded so tests can prove retry / no-resend policies.
 */
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createNetServer, type AddressInfo, type Server as NetServer, type Socket } from 'node:net';

export type RelayBehavior =
  /** Normal JSON (or text) response. */
  | { kind: 'json'; status?: number; body: unknown; headers?: Record<string, string>; delayMs?: number }
  /** Raw text response, e.g. a Cloudflare HTML/plain error page. */
  | { kind: 'text'; status: number; body: string; headers?: Record<string, string>; delayMs?: number }
  /** SSE stream. `truncate: 'end'` ends the HTTP body cleanly, `'destroy'` cuts the socket mid-stream. */
  | { kind: 'sse'; events: string[]; truncate?: 'end' | 'destroy'; gapMs?: number; headers?: Record<string, string> }
  /** Newline-delimited body written in chunks (Volcengine V3 TTS style), optionally cut before completion. */
  | { kind: 'ndjson'; lines: string[]; truncate?: 'end' | 'destroy' }
  /** Read the whole request body, then reset the socket: the request was delivered, the result is unknown. */
  | { kind: 'reset'; afterMs?: number }
  /** Destroy the socket as soon as headers arrive, before the body is read. */
  | { kind: 'close-before-body' }
  /** Destroy the TCP connection immediately on accept, before any HTTP is parsed. */
  | { kind: 'close-on-connect' }
  /** Cloudflare-style gateway timeout: wait, then 524 with `error code: 524`. */
  | { kind: 'cloudflare'; status: 520 | 521 | 522 | 523 | 524; delayMs?: number }
  /** 429 with Retry-After (seconds or HTTP date). */
  | { kind: 'rate-limit'; retryAfter?: string; body?: string }
  /** 503; `noChannel` uses the new-api/one-api "no available channel" body. */
  | { kind: 'unavailable'; noChannel?: boolean; model?: string }
  /** 200 with a Content-Length larger than the bytes sent, then the socket is closed. */
  | { kind: 'truncated-json'; body: unknown; sendBytes?: number }
  /** Hold the response headers for `delayMs` (to trip a client timeout), then answer normally. */
  | { kind: 'slow-headers'; delayMs: number; then?: RelayBehavior };

export interface RecordedRequest {
  index: number;
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  /** Raw body text; empty for behaviours that never read it. */
  body: string;
  /** Parsed JSON body, when the body was JSON. */
  json?: Record<string, unknown>;
  receivedAt: number;
  behavior: RelayBehavior['kind'] | 'unscripted';
}

export type RelayHandler = (request: RecordedRequest) => RelayBehavior | undefined;

export interface MockRelay {
  /** `http://127.0.0.1:PORT` */
  origin: string;
  port: number;
  requests: RecordedRequest[];
  /** TCP connections accepted (including ones destroyed before HTTP parsing). */
  connections: () => number;
  enqueue: (...behaviors: RelayBehavior[]) => void;
  /** Used when the queue is empty (e.g. route by requested model). */
  setHandler: (handler: RelayHandler | undefined) => void;
  /** Clear queue, handler, recorded requests and connection count. */
  reset: () => void;
  close: () => Promise<void>;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function sseData(value: unknown, event?: string): string {
  return `${event ? `event: ${event}\n` : ''}data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`;
}

export async function startMockRelay(): Promise<MockRelay> {
  const queue: RelayBehavior[] = [];
  const requests: RecordedRequest[] = [];
  const sockets = new Set<Socket>();
  const timers = new Set<NodeJS.Timeout>();
  let handler: RelayHandler | undefined;
  let connectionCount = 0;

  const wait = (ms: number) => new Promise<void>((resolve) => {
    const timer = setTimeout(() => { timers.delete(timer); resolve(); }, ms);
    timers.add(timer);
  });

  const server: Server = createServer();
  server.keepAliveTimeout = 1;

  server.on('connection', (socket: Socket) => {
    connectionCount += 1;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    if (queue[0]?.kind === 'close-on-connect') {
      queue.shift();
      socket.destroy();
    }
  });

  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res).catch(() => { req.socket.destroy(); });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const record: RecordedRequest = {
      index: requests.length,
      method: req.method ?? 'GET',
      url: req.url ?? '/',
      headers: req.headers,
      body: '',
      receivedAt: Date.now(),
      behavior: 'unscripted',
    };
    requests.push(record);
    const queued = queue.shift();
    if (queued?.kind === 'close-before-body') {
      record.behavior = queued.kind;
      req.socket.destroy();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    record.body = Buffer.concat(chunks).toString('utf8');
    try { record.json = JSON.parse(record.body) as Record<string, unknown>; } catch { /* not JSON */ }
    const behavior = queued ?? handler?.(record);
    record.behavior = behavior?.kind ?? 'unscripted';
    if (!behavior) {
      res.writeHead(500, { 'content-type': 'text/plain' }).end('mock relay: unscripted request');
      return;
    }
    await respond(behavior, req, res);
  }

  async function respond(behavior: RelayBehavior, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const socket = req.socket;
    switch (behavior.kind) {
      case 'json': {
        if (behavior.delayMs) await wait(behavior.delayMs);
        const text = typeof behavior.body === 'string' ? behavior.body : JSON.stringify(behavior.body);
        res.writeHead(behavior.status ?? 200, { 'content-type': 'application/json', ...behavior.headers }).end(text);
        return;
      }
      case 'text': {
        if (behavior.delayMs) await wait(behavior.delayMs);
        res.writeHead(behavior.status, { 'content-type': 'text/plain; charset=UTF-8', ...behavior.headers }).end(behavior.body);
        return;
      }
      case 'sse': {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', ...behavior.headers });
        for (const event of behavior.events) {
          res.write(event);
          await wait(behavior.gapMs ?? 5);
        }
        if (behavior.truncate === 'destroy') {
          socket.destroy();
          return;
        }
        res.end();
        return;
      }
      case 'ndjson': {
        res.writeHead(200, { 'content-type': 'application/json' });
        for (const line of behavior.lines) {
          res.write(`${line}\n`);
          await wait(5);
        }
        if (behavior.truncate === 'destroy') socket.destroy();
        else res.end();
        return;
      }
      case 'reset': {
        if (behavior.afterMs) await wait(behavior.afterMs);
        // RST instead of FIN so the client sees ECONNRESET, exactly like a relay crash.
        if (typeof socket.resetAndDestroy === 'function') socket.resetAndDestroy();
        else socket.destroy();
        return;
      }
      case 'close-before-body':
      case 'close-on-connect':
        socket.destroy();
        return;
      case 'cloudflare': {
        if (behavior.delayMs) await wait(behavior.delayMs);
        res.writeHead(behavior.status, { 'content-type': 'text/plain; charset=UTF-8', server: 'cloudflare' })
          .end(`error code: ${behavior.status}`);
        return;
      }
      case 'rate-limit': {
        res.writeHead(429, { 'content-type': 'application/json', ...(behavior.retryAfter !== undefined ? { 'retry-after': behavior.retryAfter } : {}) })
          .end(behavior.body ?? JSON.stringify({ error: { message: 'Rate limit exceeded, please retry later', type: 'rate_limit_error' } }));
        return;
      }
      case 'unavailable': {
        const message = behavior.noChannel
          ? `当前分组 default 下对于模型 ${behavior.model ?? 'unknown'} 无可用渠道 (no available channel for model ${behavior.model ?? 'unknown'})`
          : 'The server is temporarily overloaded, please try again later';
        res.writeHead(503, { 'content-type': 'application/json' })
          .end(JSON.stringify({ error: { message, type: behavior.noChannel ? 'new_api_error' : 'overloaded_error' } }));
        return;
      }
      case 'truncated-json': {
        const text = typeof behavior.body === 'string' ? behavior.body : JSON.stringify(behavior.body);
        const full = Buffer.from(text, 'utf8');
        const sent = full.subarray(0, Math.min(full.length - 1, behavior.sendBytes ?? Math.floor(full.length / 2)));
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(full.length) });
        res.write(sent);
        await wait(20);
        socket.destroy();
        return;
      }
      case 'slow-headers': {
        await wait(behavior.delayMs);
        if (socket.destroyed) return;
        await respond(behavior.then ?? { kind: 'json', body: { ok: true } }, req, res);
        return;
      }
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const port = (server.address() as AddressInfo).port;

  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    requests,
    connections: () => connectionCount,
    enqueue: (...behaviors) => { queue.push(...behaviors); },
    setHandler: (next) => { handler = next; },
    reset: () => {
      queue.length = 0;
      requests.length = 0;
      handler = undefined;
      connectionCount = 0;
    },
    close: async () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

export interface MockTlsBreaker {
  /** `https://127.0.0.1:PORT` — a plain TCP server, so every TLS handshake fails. */
  origin: string;
  connections: () => number;
  reset: () => void;
  close: () => Promise<void>;
}

/**
 * "TLS" fault: the client speaks https:// to a plain TCP listener. `mode: 'plaintext'` answers the
 * ClientHello with an HTTP/1.1 error (OpenSSL "wrong version number"); `mode: 'hangup'` closes the
 * socket once the ClientHello arrives. No HTTP request can be delivered either way.
 */
export async function startTlsBreaker(mode: 'plaintext' | 'hangup' = 'plaintext'): Promise<MockTlsBreaker> {
  let connectionCount = 0;
  const sockets = new Set<Socket>();
  const server: NetServer = createNetServer((socket) => {
    connectionCount += 1;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    socket.once('data', () => {
      if (mode === 'plaintext') socket.end('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
      else socket.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const port = (server.address() as AddressInfo).port;
  return {
    origin: `https://127.0.0.1:${port}`,
    connections: () => connectionCount,
    reset: () => { connectionCount = 0; },
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

/** A loopback port with nothing listening (connection refused). */
export async function reserveClosedPort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

/** Wait a little so a (wrongly) scheduled automatic resend would have reached the relay. */
export function settle(ms = 250): Promise<void> {
  return sleep(ms);
}
