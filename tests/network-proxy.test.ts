import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import { connect as netConnect, type AddressInfo, type Socket } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, ProxyAgent, type Dispatcher } from 'undici';

// No real DNS: fixture hostnames resolve to fixed addresses, everything else fails like an unknown host.
vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns/promises')>();
  const fixtures: Record<string, string> = {
    'private-target.test': '10.1.2.3',
    'public-target.test': '93.184.216.34',
    'llm.example': '93.184.216.34',
    'image.example': '93.184.216.34',
  };
  const lookup = async (hostname: string) => {
    const address = fixtures[hostname];
    if (!address) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND', hostname });
    return [{ address, family: 4 }];
  };
  return { ...actual, lookup, default: { ...actual, lookup } };
});

import { fetchWithNetworkPolicy, normalizeProxyUrl, redactProxyUrl, NetworkPolicyError } from '../src/shared/network-policy';
import { classifyProviderFailure, shouldRetryProviderFailure } from '../src/shared/provider-failure';
import { createConfiguredJsonLlm, testConfiguredLlm } from '../src/shared/llm-provider';
import { createConfiguredImageGenerator } from '../src/shared/media-providers';
import { testConfigTarget } from '../src/shared/config-test-runtime';
import { defaultConfig } from '../src/shared/config';
import type { AppConfig, ImagePrompt, StoryboardScene, Task } from '../src/shared/types';

interface ProxyLog {
  connects: string[];
  forwards: string[];
  proxyAuthorization: Array<string | undefined>;
}

let target: Server;
let targetPort = 0;
const targetRequests: Array<{ url: string; cookie?: string; authorization?: string }> = [];
let proxy: Server;
let proxyPort = 0;
let proxyLog: ProxyLog;
let proxyRequiredAuth: string | null = null;
const sockets = new Set<Socket>();

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
}

function track(server: Server): void {
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
}

function authorized(req: IncomingMessage): boolean {
  if (!proxyRequiredAuth) return true;
  return req.headers['proxy-authorization'] === `Basic ${Buffer.from(proxyRequiredAuth).toString('base64')}`;
}

beforeAll(async () => {
  target = createServer((req, res) => {
    targetRequests.push({ url: req.url ?? '', cookie: req.headers.cookie, authorization: req.headers.authorization });
    const url = req.url ?? '/';
    if (url === '/r1') { res.writeHead(302, { location: '/r2' }).end(); return; }
    if (url === '/r2') { res.writeHead(302, { location: '/ok' }).end(); return; }
    if (url === '/to-metadata') { res.writeHead(302, { location: 'http://169.254.169.254/latest' }).end(); return; }
    if (url === '/big') { res.writeHead(200, { 'content-type': 'text/plain' }).end('x'.repeat(4096)); return; }
    res.writeHead(200, { 'content-type': 'text/plain' }).end('hello via target');
  });
  track(target);
  targetPort = await listen(target);

  // Minimal forward proxy: CONNECT tunnels plus absolute-URI forwarding. Only dials the local target.
  proxy = createServer((req, res) => {
    proxyLog.proxyAuthorization.push(req.headers['proxy-authorization']);
    if (!authorized(req)) { res.writeHead(407, { 'proxy-authenticate': 'Basic realm="test"' }).end(); return; }
    const url = new URL(req.url ?? '');
    proxyLog.forwards.push(url.host);
    if (url.hostname !== '127.0.0.1') { res.writeHead(502).end(); return; }
    const upstream = httpRequest({ host: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, method: req.method, headers: req.headers }, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    });
    req.pipe(upstream);
  });
  proxy.on('connect', (req: IncomingMessage, client: Socket, head: Buffer) => {
    proxyLog.connects.push(req.url ?? '');
    proxyLog.proxyAuthorization.push(req.headers['proxy-authorization']);
    if (!authorized(req)) {
      client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="test"\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const [host, port] = (req.url ?? '').split(':');
    if (host !== '127.0.0.1') { client.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n'); return; }
    const upstream = netConnect(Number(port), host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  });
  track(proxy);
  proxyPort = await listen(proxy);
});

afterAll(async () => {
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => target.close(resolve));
  await new Promise((resolve) => proxy.close(resolve));
});

function resetLogs() {
  proxyLog = { connects: [], forwards: [], proxyAuthorization: [] };
  targetRequests.length = 0;
  proxyRequiredAuth = null;
}
resetLogs();

afterEach(() => {
  resetLogs();
  vi.unstubAllGlobals();
});

async function closedPort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function rejection(promise: Promise<unknown>): Promise<NetworkPolicyError & { proxyCauseCode?: string; proxyStatus?: number }> {
  try { await promise; } catch (error) { return error as NetworkPolicyError & { proxyCauseCode?: string; proxyStatus?: number }; }
  throw new Error('expected rejection');
}

function proxyUriOf(dispatcher: Dispatcher | undefined): string | undefined {
  if (!dispatcher) return undefined;
  const key = Object.getOwnPropertySymbols(dispatcher).find((symbol) => symbol.description === 'proxy agent options');
  return key ? (dispatcher as unknown as Record<symbol, { uri: string }>)[key]?.uri : undefined;
}

describe('network policy proxy channel (G-5)', () => {
  it('sends the request through the configured proxy while header filtering still applies', async () => {
    const response = await fetchWithNetworkPolicy(`http://127.0.0.1:${targetPort}/ok`, {
      purpose: 'provider-api',
      proxyUrl: `http://127.0.0.1:${proxyPort}`,
      headers: { Cookie: 'session=leak', Authorization: 'Bearer k' },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('hello via target');
    expect(proxyLog.connects).toEqual([`127.0.0.1:${targetPort}`]);
    expect(targetRequests).toEqual([{ url: '/ok', cookie: undefined, authorization: 'Bearer k' }]);
  });

  it('keeps the direct path (plain Agent, no proxy traffic) when proxyUrl is empty or whitespace', async () => {
    for (const proxyUrl of [undefined, '', '   ']) {
      const response = await fetchWithNetworkPolicy(`http://127.0.0.1:${targetPort}/ok`, { purpose: 'provider-api', proxyUrl });
      expect(await response.text()).toBe('hello via target');
    }
    expect(proxyLog.connects).toEqual([]);
    expect(targetRequests).toHaveLength(3);

    const dispatchers: Array<Dispatcher | undefined> = [];
    await fetchWithNetworkPolicy('https://public.example/', {
      purpose: 'provider-api',
      proxyUrl: ' ',
      fetchImpl: async (_url, init) => { dispatchers.push(init?.dispatcher); return new Response('ok'); },
    });
    expect(dispatchers[0]).toBeInstanceOf(Agent);
    expect(dispatchers[0]).not.toBeInstanceOf(ProxyAgent);
  });

  it('enforces the byte limit and redirect rules through the proxy', async () => {
    const proxyUrl = `http://127.0.0.1:${proxyPort}`;
    await expect(fetchWithNetworkPolicy(`http://127.0.0.1:${targetPort}/big`, { purpose: 'provider-api', proxyUrl, maxBytes: 1024 }))
      .rejects.toMatchObject({ code: 'NETWORK_RESPONSE_TOO_LARGE' });
    await expect(fetchWithNetworkPolicy(`http://127.0.0.1:${targetPort}/r1`, { purpose: 'provider-api', proxyUrl, maxRedirects: 1 }))
      .rejects.toMatchObject({ code: 'NETWORK_TOO_MANY_REDIRECTS' });
    resetLogs();
    const followed = await fetchWithNetworkPolicy(`http://127.0.0.1:${targetPort}/r1`, { purpose: 'provider-api', proxyUrl });
    expect(await followed.text()).toBe('hello via target');
    expect(followed.redirected).toBe(true);
    expect(proxyLog.connects).toHaveLength(3);
    resetLogs();
    await expect(fetchWithNetworkPolicy(`http://127.0.0.1:${targetPort}/to-metadata`, { purpose: 'provider-api', proxyUrl }))
      .rejects.toMatchObject({ code: 'NETWORK_ADDRESS_BLOCKED' });
    expect(proxyLog.connects).toEqual([`127.0.0.1:${targetPort}`]);
  });

  it('still blocks forbidden targets when a proxy is configured, before contacting the proxy', async () => {
    const proxyUrl = `http://127.0.0.1:${proxyPort}`;
    await expect(fetchWithNetworkPolicy(`http://127.0.0.1:${targetPort}/ok`, { purpose: 'public-research', proxyUrl }))
      .rejects.toMatchObject({ code: 'NETWORK_LOOPBACK_BLOCKED' });
    // DNS answer is validated locally even though the proxy would resolve the name itself.
    await expect(fetchWithNetworkPolicy('https://private-target.test/v1', { purpose: 'provider-api', proxyUrl }))
      .rejects.toMatchObject({ code: 'NETWORK_PRIVATE_BLOCKED' });
    await expect(fetchWithNetworkPolicy('ftp://public-target.test/', { purpose: 'provider-api', proxyUrl }))
      .rejects.toMatchObject({ code: 'NETWORK_SCHEME_BLOCKED' });
    expect(proxyLog.connects).toEqual([]);
    expect(targetRequests).toEqual([]);
  });

  it('maps 407 to NETWORK_PROXY_FAILED with redacted credentials and not-sent classification', async () => {
    proxyRequiredAuth = 'alice:s3cret';
    const error = await rejection(fetchWithNetworkPolicy(`http://127.0.0.1:${targetPort}/ok`, {
      purpose: 'provider-api', proxyUrl: `http://alice:wrongpass@127.0.0.1:${proxyPort}`,
    }));
    expect(error).toBeInstanceOf(NetworkPolicyError);
    expect(error.code).toBe('NETWORK_PROXY_FAILED');
    expect(error.proxyStatus).toBe(407);
    expect(error.message).toMatch(/^代理连接失败：.*407.*（代理地址已隐去凭据）$/u);
    expect(error.message).not.toMatch(/alice|wrongpass/u);
    expect(JSON.stringify(error)).not.toMatch(/alice|wrongpass/u);
    expect(targetRequests).toEqual([]);
    const failure = classifyProviderFailure({ error });
    expect(failure).toMatchObject({ outcome: 'not-sent', code: 'NETWORK_PROXY_FAILED', retry: 'never' });

    const ok = await fetchWithNetworkPolicy(`http://127.0.0.1:${targetPort}/ok`, {
      purpose: 'provider-api', proxyUrl: `http://alice:s3cret@127.0.0.1:${proxyPort}`,
    });
    expect(await ok.text()).toBe('hello via target');
    expect(proxyLog.proxyAuthorization.at(-1)).toBe(`Basic ${Buffer.from('alice:s3cret').toString('base64')}`);
  });

  it('maps an unreachable proxy and a rejected tunnel to NETWORK_PROXY_FAILED (not sent, retryable)', async () => {
    const port = await closedPort();
    const down = await rejection(fetchWithNetworkPolicy(`http://127.0.0.1:${targetPort}/ok`, {
      purpose: 'provider-api', proxyUrl: `http://user:pw-secret@127.0.0.1:${port}`, method: 'POST', body: '{}',
    }));
    expect(down.code).toBe('NETWORK_PROXY_FAILED');
    expect(down.proxyCauseCode).toBe('ECONNREFUSED');
    expect(down.message).toContain(`http://127.0.0.1:${port}`);
    expect(down.message).not.toContain('pw-secret');
    const failure = classifyProviderFailure({ error: down });
    expect(failure).toMatchObject({ outcome: 'not-sent', retry: 'always', kind: 'connect' });
    expect(shouldRetryProviderFailure(failure, { idempotent: false })).toBe(true);
    expect(targetRequests).toEqual([]);

    const tunnel = await rejection(fetchWithNetworkPolicy('https://public-target.test/v1', {
      purpose: 'provider-api', proxyUrl: `http://127.0.0.1:${proxyPort}`,
    }));
    expect(tunnel).toMatchObject({ code: 'NETWORK_PROXY_FAILED', proxyStatus: 502 });
    expect(proxyLog.connects).toEqual(['public-target.test:443']);
    expect(classifyProviderFailure({ error: tunnel })).toMatchObject({ outcome: 'not-sent', retry: 'always' });
  });

  it('rejects unsupported or malformed proxy URLs without echoing credentials', async () => {
    for (const [proxyUrl, code] of [
      ['socks5://user:topsecret@127.0.0.1:1080', 'NETWORK_PROXY_UNSUPPORTED'],
      ['socks://127.0.0.1:1080', 'NETWORK_PROXY_UNSUPPORTED'],
      ['ftp://user:topsecret@127.0.0.1:21', 'NETWORK_PROXY_INVALID'],
      ['http://user:topsecret@', 'NETWORK_PROXY_INVALID'],
    ] as const) {
      const error = await rejection(fetchWithNetworkPolicy(`http://127.0.0.1:${targetPort}/ok`, { purpose: 'provider-api', proxyUrl }));
      expect(error.code).toBe(code);
      expect(error.message).not.toContain('topsecret');
      expect(classifyProviderFailure({ error })).toMatchObject({ outcome: 'not-sent', retry: 'never' });
    }
    expect(targetRequests).toEqual([]);
    expect(normalizeProxyUrl('127.0.0.1:7890')?.url.href).toBe('http://127.0.0.1:7890/');
    expect(normalizeProxyUrl('  ')).toBeNull();
    expect(normalizeProxyUrl('https://u:p%40ss@proxy.corp:8443/ignored')).toEqual({
      url: new URL('https://proxy.corp:8443'), authorization: `Basic ${Buffer.from('u:p@ss').toString('base64')}`,
    });
    expect(redactProxyUrl('http://u:secret@10.0.0.2:3128')).toBe('http://10.0.0.2:3128');
  });
});

describe('config proxyUrl reaches provider requests (G-5)', () => {
  const scene: StoryboardScene = { id: 1, cap: 'scene', descPrompt: 'prompt', durationMs: 1200 };
  const prompt: ImagePrompt = { sceneId: 1, cap: 'scene', prompt: 'prompt', negativePrompt: '', style: 'photo-real', ratio: '9:16', characterProfile: '' };
  const task = { id: 'task-proxy', title: 'Task', ratio: '9:16', ttsSpeed: 1, speaker: 'voice' } as Task;
  const llm = { ...defaultConfig.llm, apiKey: 'llm-key', baseUrl: 'https://llm.example', model: 'model-a' };

  it('passes the LLM profile proxy to model tests and generation requests', async () => {
    const seen: Array<Dispatcher | undefined> = [];
    const fake = vi.fn(async (_url: string, init?: RequestInit & { dispatcher?: Dispatcher }) => {
      seen.push(init?.dispatcher);
      return new Response(JSON.stringify({ id: 'r1', choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    await testConfiguredLlm({ ...llm, proxyUrl: 'http://127.0.0.1:7890' }, fake as unknown as typeof fetch);
    expect(proxyUriOf(seen[0])).toBe('http://127.0.0.1:7890/');

    vi.stubGlobal('fetch', fake);
    const result = await createConfiguredJsonLlm({ ...llm, proxyUrl: 'http://proxy-user:pw@127.0.0.1:7891' })
      .run({ step: 1, name: 'proxy-check', messages: [{ role: 'user', content: 'hi' }], maxRetries: 0 });
    expect(result.json).toEqual({ ok: true });
    expect(seen[1]).toBeInstanceOf(ProxyAgent);
    expect(proxyUriOf(seen[1])).toBe('http://127.0.0.1:7891/');

    await createConfiguredJsonLlm({ ...llm, proxyUrl: '' })
      .run({ step: 1, name: 'direct-check', messages: [{ role: 'user', content: 'hi' }], maxRetries: 0 });
    expect(seen[2]).toBeInstanceOf(Agent);
  });

  it('passes the active image config proxy to generation and config tests', async () => {
    const seen: Array<Dispatcher | undefined> = [];
    const fake = vi.fn(async (_url: string, init?: RequestInit & { dispatcher?: Dispatcher }) => {
      seen.push(init?.dispatcher);
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('img').toString('base64') }] }), { status: 200 });
    });
    const dir = await mkdtemp(join(tmpdir(), 'storydream-proxy-image-'));
    try {
      vi.stubGlobal('fetch', fake);
      const gpt: AppConfig = { ...defaultConfig, imageProvider: 'gpt_image',
        gptImage: { ...defaultConfig.gptImage, apiKey: 'k', baseUrl: 'https://image.example', proxyUrl: 'http://127.0.0.1:7892' } };
      const assets = await createConfiguredImageGenerator(gpt, dir)([scene], [prompt], task);
      expect(await readFile(assets[0].path, 'utf8')).toBe('img');
      expect(proxyUriOf(seen[0])).toBe('http://127.0.0.1:7892/');

      const custom: AppConfig = { ...defaultConfig, imageProvider: 'custom',
        customImage: { ...defaultConfig.customImage, apiKey: 'k', baseUrl: 'https://image.example', model: 'm', proxyUrl: 'http://127.0.0.1:7893' } };
      await createConfiguredImageGenerator(custom, dir)([{ ...scene, id: 2 }], [{ ...prompt, sceneId: 2 }], task);
      expect(proxyUriOf(seen[1])).toBe('http://127.0.0.1:7893/');

      await createConfiguredImageGenerator({ ...gpt, gptImage: { ...gpt.gptImage, proxyUrl: '' } }, dir)([{ ...scene, id: 3 }], [{ ...prompt, sceneId: 3 }], task);
      expect(seen[2]).toBeInstanceOf(Agent);

      await testConfigTarget('image', gpt, { fetchImpl: fake as unknown as typeof fetch });
      expect(proxyUriOf(seen[3])).toBe('http://127.0.0.1:7892/');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
