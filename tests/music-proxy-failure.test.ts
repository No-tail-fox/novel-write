import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// No real DNS: the music site resolves to a public fixture address so the policy lets the request out.
vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns/promises')>();
  const lookup = async (hostname: string) => {
    if (hostname === 'music.example') return [{ address: '93.184.216.34', family: 4 }];
    throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND', hostname });
  };
  return { ...actual, lookup, default: { ...actual, lookup } };
});

import { createMusicProvider, isMusicRequestNotSent, MusicProviderError } from '../src/shared/music-provider';
import { classifyProviderFailure, shouldRetryProviderFailure } from '../src/shared/provider-failure';
import { NetworkPolicyError } from '../src/shared/network-policy';
import { createMusicLabRuntime } from '../electron/music-lab-runtime';
import { createMusicVoiceRuntime } from '../electron/music-voice-runtime';
import type { MusicGenerateInput } from '../src/shared/music-lab';

const SITE = 'https://music.example';
const KEY = 'music-test-only-key';
const input: MusicGenerateInput = { mode: 'description', model: 'suno-v6', description: '轻柔钢琴', instrumental: true, maxMode: false, variety: 1 };

let deadProxyPort = 0;
let authProxy: Server;
let authProxyPort = 0;
const sockets = new Set<Socket>();
const directories: string[] = [];
const runtimes: Array<{ close(): void }> = [];

beforeAll(async () => {
  const probe = createServer();
  deadProxyPort = await new Promise<number>((resolve) => probe.listen(0, '127.0.0.1', () => resolve((probe.address() as AddressInfo).port)));
  await new Promise((resolve) => probe.close(resolve));
  // Proxy that demands credentials on every CONNECT (never tunnels anything).
  authProxy = createServer((_req, res) => res.writeHead(405).end());
  authProxy.on('connect', (_req, client: Socket) => {
    client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="t"\r\nContent-Length: 0\r\n\r\n');
  });
  authProxy.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  authProxyPort = await new Promise<number>((resolve) => authProxy.listen(0, '127.0.0.1', () => resolve((authProxy.address() as AddressInfo).port)));
});
afterAll(async () => {
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => authProxy.close(resolve));
});
afterEach(async () => {
  runtimes.splice(0).forEach((runtime) => runtime.close());
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function directory() {
  const dir = await mkdtemp(join(tmpdir(), 'opc-music-proxy-')); directories.push(dir); return dir;
}
async function rejection(promise: Promise<unknown>): Promise<MusicProviderError> {
  try { await promise; } catch (error) { return error as MusicProviderError; }
  throw new Error('expected rejection');
}
/** Transport drop after the request was written (what undici reports when the peer closes mid-response). */
function droppedAfterSend(): Error {
  return Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) });
}

describe('music provider keeps the network code through MUSIC_NETWORK_ERROR (G-5)', () => {
  it('an unreachable proxy stays not-sent / retryable, definitive for the job, and credential-free', async () => {
    const proxyUrl = `http://alice:pw-secret@127.0.0.1:${deadProxyPort}`;
    const error = await rejection(createMusicProvider({ apiKey: KEY, baseUrl: SITE, proxyUrl }).generate(input));
    expect(error).toBeInstanceOf(MusicProviderError);
    expect(error.message).toMatch(/^MUSIC_NETWORK_ERROR: 代理连接失败/u);
    expect(error.code).toBe('NETWORK_PROXY_FAILED');
    expect(error.cause).toBeInstanceOf(NetworkPolicyError);
    expect(error.definitive).toBe(true);
    expect(isMusicRequestNotSent(error)).toBe(true);
    const failure = classifyProviderFailure({ error });
    expect(failure).toMatchObject({ kind: 'connect', outcome: 'not-sent', retry: 'always', code: 'NETWORK_PROXY_FAILED' });
    expect(shouldRetryProviderFailure(failure, { idempotent: false })).toBe(true);
    expect(`${error.message} ${String(error.cause)} ${JSON.stringify(failure)}`).not.toMatch(/alice|pw-secret|music-test-only-key/u);
  });

  it('a proxy 407 stays not-sent but is never auto-retried', async () => {
    const error = await rejection(createMusicProvider({ apiKey: KEY, baseUrl: SITE, proxyUrl: `http://127.0.0.1:${authProxyPort}` }).getBalance());
    expect(error.code).toBe('NETWORK_PROXY_FAILED');
    expect(classifyProviderFailure({ error })).toMatchObject({ outcome: 'not-sent', retry: 'never' });
    expect(error.definitive).toBe(true);
  });

  it('a drop after sending (proxy configured) stays unknown and non-definitive', async () => {
    const fetchImpl = vi.fn(async () => { throw droppedAfterSend(); }) as unknown as typeof fetch;
    const error = await rejection(createMusicProvider({ apiKey: KEY, baseUrl: SITE, fetchImpl, proxyUrl: 'http://127.0.0.1:7899' }).generate(input));
    expect(error.message).toMatch(/^MUSIC_NETWORK_ERROR:/u);
    expect(error.definitive).toBe(false);
    expect(isMusicRequestNotSent(error)).toBe(false);
    const failure = classifyProviderFailure({ error });
    expect(failure.outcome).toBe('unknown');
    expect(shouldRetryProviderFailure(failure, { idempotent: false })).toBe(false);
  });
});

describe('music job status separates "never sent" from "outcome unknown" (G-5)', () => {
  it('music lab: proxy failure → failed (safe to resubmit); drop after send → needs-recovery', async () => {
    const dataDir = await directory();
    const lab = createMusicLabRuntime({ dataDir, baseUrl: SITE, resolveApiKey: () => KEY, resolveProxyUrl: () => `http://127.0.0.1:${deadProxyPort}`, autoPoll: false });
    runtimes.push(lab);
    const notSent = await lab.generate(input);
    expect(notSent.status).toBe('failed');
    expect(notSent.errorMessage).toContain('代理连接失败');

    const fetchImpl = vi.fn(async () => { throw droppedAfterSend(); }) as unknown as typeof fetch;
    const lab2 = createMusicLabRuntime({ dataDir: await directory(), baseUrl: SITE, resolveApiKey: () => KEY, fetchImpl, resolveProxyUrl: () => 'http://127.0.0.1:7899', autoPoll: false });
    runtimes.push(lab2);
    const unknown = await lab2.generate(input);
    expect(unknown.status).toBe('needs-recovery');
    expect(unknown.errorMessage).not.toContain(KEY);
  });

  it('voice runtime: proxy failure on the paid submit → failed; other transport failures → needs-recovery', async () => {
    const generation = { action: 'generate' as const, taskId: 12, model: 'suno-v6' as const, prompt: '夏夜', custom: false, style: '', title: '夏夜', maxMode: false, variety: 0, styleWeight: 0.5, weirdness: 0.5 };
    const run = async (submitError: () => Error) => {
      const dataDir = await directory();
      await mkdir(join(dataDir, 'music-voices'), { recursive: true });
      await writeFile(join(dataDir, 'music-voices', 'voices.json'), JSON.stringify({ voices: [], jobs: [] }));
      const fetchImpl = vi.fn(async (url: string | URL | Request) => {
        if (String(url).endsWith('/check')) return new Response(JSON.stringify({ voice: { voice_task_id: 12, is_available: true, voice_id: 'v' } }), { headers: { 'content-type': 'application/json' } });
        throw submitError();
      }) as unknown as typeof fetch;
      return createMusicVoiceRuntime({ dataDir, resolveApiKey: async () => KEY, onSongsReady: async () => undefined, fetchImpl }).execute(generation);
    };
    const proxyFailed = await run(() => new NetworkPolicyError('NETWORK_PROXY_FAILED', '代理连接失败：http://127.0.0.1:1 ECONNREFUSED（代理地址已隐去凭据）'));
    expect(proxyFailed.jobs[0]).toMatchObject({ status: 'failed' });
    expect(proxyFailed.jobs[0].error).toContain('代理连接失败');
    const dropped = await run(droppedAfterSend);
    expect(dropped.jobs[0].status).toBe('needs-recovery');
  });
});
