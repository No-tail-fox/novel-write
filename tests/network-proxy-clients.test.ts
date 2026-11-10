import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { connect as netConnect, type AddressInfo, type Socket } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, ProxyAgent, type Dispatcher } from 'undici';

// No real DNS: fixed-endpoint providers resolve to a public fixture address; anything else fails.
vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns/promises')>();
  const fixtures: Record<string, string> = {
    'api.minimaxi.com': '93.184.216.34',
    'open.volcengineapi.com': '93.184.216.34',
    'music.example': '93.184.216.34',
  };
  const lookup = async (hostname: string) => {
    const address = fixtures[hostname];
    if (!address) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND', hostname });
    return [{ address, family: 4 }];
  };
  return { ...actual, lookup, default: { ...actual, lookup } };
});

import { defaultConfig } from '../src/shared/config';
import { normalizeAppConfig } from '../src/shared/config-utils';
import { resetGenerationAuthorization, setGenerationAuthorization } from '../src/shared/generation-authorization';
import { providerModelListSchema } from '../src/shared/ipc-contract';
import { listConfiguredProviderModels } from '../src/shared/llm-provider';
import { createConfiguredNarrationSynthesizer } from '../src/shared/media-providers';
import { createMusicProvider } from '../src/shared/music-provider';
import { probeRelayCapabilities } from '../src/shared/relay-capability-probe';
import { classifyProviderFailure } from '../src/shared/provider-failure';
import { createConfiguredVideoProvider } from '../src/shared/video-provider';
import { transcribeViralAudio } from '../src/shared/viral-runtime';
import { listVolcengineSpeakers } from '../src/shared/volcengine-speakers';
import { createMusicProfileService } from '../electron/music-profile-service';
import { downloadVerifiedVideoResult } from '../electron/resumable-transfer';
import type { AppConfig, StoryboardScene, Task } from '../src/shared/types';

// ---------------------------------------------------------------------------------------------
// Local harness: one fake provider (all configurable-endpoint clients) + one CONNECT/forward proxy.
// ---------------------------------------------------------------------------------------------

let target: Server;
let targetBase = '';
const targetRequests: string[] = [];
let proxy: Server;
let proxyPort = 0;
const proxyConnects: string[] = [];
const sockets = new Set<Socket>();
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18, ...Buffer.from('ftypisom'), 0, 0, 2, 0, ...Buffer.from('isomiso2')]), randomBytes(4096)]);

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
}

function track(server: Server): void {
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
}

function json(res: import('node:http').ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
}

beforeAll(async () => {
  target = createServer((req: IncomingMessage, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    targetRequests.push(`${req.method} ${url.pathname}`);
    req.resume();
    req.on('end', () => {
      if (url.pathname.endsWith('/models')) return json(res, { data: [{ id: 'model-a' }, { id: 'model-b' }] });
      if (url.pathname.endsWith('/chat/completions')) {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
          .end('data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":1}}\n\ndata: [DONE]\n\n');
        return;
      }
      if (url.pathname === '/api/v1/tts') return json(res, { code: 3000, data: Buffer.from('mp3-bytes').toString('base64') });
      if (url.pathname.endsWith('/audio/transcriptions')) return json(res, { text: '你好', segments: [{ start: 0, end: 1, text: '你好' }] });
      if (url.pathname.startsWith('/v1/videos/')) return json(res, { status: 'succeeded', output: { url: `${targetBase}/files/remote-1.mp4` } });
      if (url.pathname === '/files/remote-1.mp4') { res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': mp4.length }).end(mp4); return; }
      res.writeHead(404).end();
    });
  });
  track(target);
  targetBase = `http://127.0.0.1:${await listen(target)}`;

  // CONNECT-only forward proxy that may only dial the local fake provider.
  proxy = createServer((_req, res) => { res.writeHead(405).end(); });
  proxy.on('connect', (req: IncomingMessage, client: Socket, head: Buffer) => {
    proxyConnects.push(req.url ?? '');
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

let workDir = '';
beforeEach(async () => {
  targetRequests.length = 0;
  proxyConnects.length = 0;
  setGenerationAuthorization(async () => undefined);
  workDir = await mkdtemp(join(tmpdir(), 'opc-proxy-clients-'));
});
afterEach(async () => {
  resetGenerationAuthorization();
  vi.unstubAllGlobals();
  await rm(workDir, { recursive: true, force: true });
});

const proxyUrl = () => `http://127.0.0.1:${proxyPort}`;
const targetHostPort = () => targetBase.replace('http://', '');

async function closedPort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function proxyUriOf(dispatcher: Dispatcher | undefined): string | undefined {
  if (!dispatcher) return undefined;
  const key = Object.getOwnPropertySymbols(dispatcher).find((symbol) => symbol.description === 'proxy agent options');
  return key ? (dispatcher as unknown as Record<symbol, { uri: string }>)[key]?.uri : undefined;
}

/** fetch stand-in that records the dispatcher the network policy chose (for fixed public endpoints). */
function recordingFetch(respond: (url: string) => Response) {
  const seen: Array<{ url: string; dispatcher?: Dispatcher }> = [];
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit & { dispatcher?: Dispatcher }) => {
    seen.push({ url: String(url), dispatcher: init?.dispatcher });
    return respond(String(url));
  });
  return { seen, fetchImpl: fetchImpl as unknown as typeof fetch };
}

const llmProfile = (extra: Partial<AppConfig['llm']> = {}): AppConfig['llm'] => ({
  ...defaultConfig.llm, provider: 'custom', protocol: 'openai', baseUrl: `${targetBase}/v1`, apiKey: 'probe-key', model: 'model-a', ...extra,
});

const scene: StoryboardScene = { id: 1, cap: '测试旁白', descPrompt: '', durationMs: 1200 };
const task = { id: 'task-proxy', title: 'Task', ratio: '9:16', ttsSpeed: 1, speaker: 'BV001_streaming' } as Task;

function ttsConfig(provider: 'volcengine' | 'minimax', proxy?: string): AppConfig {
  const volcengine = {
    ...defaultConfig.tts.volcengine, apiKey: '', apiVersion: 'legacy' as const, apiVersionExplicit: true,
    appId: 'app-1', accessKey: 'tts-token', speaker: 'BV001_streaming', endpoint: `${targetBase}/api/v1/tts`, legacyEndpoint: `${targetBase}/api/v1/tts`,
  };
  const minimax = { apiKey: 'mm-key', model: 'speech-02-hd', voiceId: 'male-qn-qingse' };
  return normalizeAppConfig({
    ...defaultConfig,
    ttsProfiles: [{ id: 'tts-a', name: 'TTS', enabled: true, provider, volcengine, minimax, ...(proxy === undefined ? {} : { proxyUrl: proxy }) }],
    activeTtsProfileId: 'tts-a',
  });
}

function sttConfig(proxy?: string): AppConfig {
  const profile = {
    ...defaultConfig.speechToText, id: 'stt-a', name: 'STT', enabled: true, provider: 'openai-compatible' as const,
    baseUrl: `${targetBase}/v1`, apiKey: 'stt-key', model: 'whisper-1', responseFormat: 'json' as const,
    ...(proxy === undefined ? {} : { proxyUrl: proxy }),
  };
  return normalizeAppConfig({ ...defaultConfig, speechToText: profile, speechToTextProfiles: [profile], activeSpeechToTextProfileId: 'stt-a' });
}

function videoConfig(proxy?: string): AppConfig {
  return normalizeAppConfig({ ...defaultConfig, video: { ...defaultConfig.video, providers: [{
    ...defaultConfig.video.providers[0], id: 'local-remote', enabled: true, baseUrl: `${targetBase}/v1`, apiKey: 'video-key',
    model: 'local-model', submitPath: '/videos', statusPathTemplate: '/videos/{id}', pollIntervalMs: 1, timeoutMs: 10_000,
    pricePerSecond: 0, capabilities: ['t2v'], ...(proxy === undefined ? {} : { proxyUrl: proxy }),
  }], activeProviderId: 'local-remote', automation: { ...defaultConfig.video.automation, providerWhitelist: ['local-remote'], fallback: 'disabled' } } });
}

// ---------------------------------------------------------------------------------------------

describe('G-5 proxy reaches the remaining provider clients (real local CONNECT proxy)', () => {
  it('relay capability probe tunnels both requests through the LLM profile proxy, direct when absent', async () => {
    const result = await probeRelayCapabilities(llmProfile({ proxyUrl: proxyUrl() }));
    expect(result.requests).toBe(2);
    expect(proxyConnects.length).toBeGreaterThanOrEqual(1);
    expect(new Set(proxyConnects)).toEqual(new Set([targetHostPort()]));
    expect(targetRequests).toEqual(['POST /v1/chat/completions', 'POST /v1/chat/completions']);

    proxyConnects.length = 0; targetRequests.length = 0;
    await probeRelayCapabilities(llmProfile({ proxyUrl: '' }));
    expect(proxyConnects).toEqual([]);
    expect(targetRequests).toHaveLength(2);
  });

  it('model list fetching uses the request proxy (OpenAI and Anthropic), direct when absent', async () => {
    const listed = await listConfiguredProviderModels({ baseUrl: `${targetBase}/v1`, apiKey: 'k', proxyUrl: proxyUrl() });
    expect(listed.status).toBe('pass');
    expect(listed.models.map((model) => model.id)).toEqual(['model-a', 'model-b']);
    expect(proxyConnects).toEqual([targetHostPort()]);

    await listConfiguredProviderModels({ baseUrl: `${targetBase}/v1`, apiKey: 'k', protocol: 'anthropic', proxyUrl: proxyUrl() });
    expect(proxyConnects).toHaveLength(2);

    proxyConnects.length = 0;
    const direct = await listConfiguredProviderModels({ baseUrl: `${targetBase}/v1`, apiKey: 'k' });
    expect(direct.status).toBe('pass');
    expect(proxyConnects).toEqual([]);
  });

  it('Volcengine TTS synthesis uses the TTS profile proxy, direct when absent', async () => {
    const assets = await createConfiguredNarrationSynthesizer(ttsConfig('volcengine', proxyUrl()), workDir)([scene], task);
    expect(await readFile(assets[0].path, 'utf8')).toBe('mp3-bytes');
    expect(proxyConnects).toEqual([targetHostPort()]);
    expect(targetRequests).toEqual(['POST /api/v1/tts']);

    proxyConnects.length = 0;
    await createConfiguredNarrationSynthesizer(ttsConfig('volcengine'), workDir)([{ ...scene, id: 2 }], task);
    expect(proxyConnects).toEqual([]);
    expect(targetRequests).toHaveLength(2);
  });

  it('speech-to-text transcription uses the STT profile proxy, direct when absent', async () => {
    const audio = join(workDir, 'clip.mp3');
    await writeFile(audio, Buffer.from('ID3fake-audio-bytes'));
    const segments = await transcribeViralAudio(audio, sttConfig(proxyUrl()));
    expect(JSON.stringify(segments)).toContain('你好');
    expect(proxyConnects).toEqual([targetHostPort()]);
    expect(targetRequests).toEqual(['POST /v1/audio/transcriptions']);

    proxyConnects.length = 0;
    await transcribeViralAudio(audio, sttConfig());
    expect(proxyConnects).toEqual([]);
    expect(targetRequests).toHaveLength(2);
  });

  it('video status polling and both result downloaders use the video profile proxy, direct when absent', async () => {
    // Built-in downloader.
    const viaProxy = await createConfiguredVideoProvider(videoConfig(proxyUrl()), workDir, undefined, { recoveryProviderId: 'local-remote' })
      .resume!('remote-1', { estimatedCost: 0 });
    expect((await readFile(viaProxy.path)).equals(mp4)).toBe(true);
    expect(targetRequests).toEqual(['GET /v1/videos/remote-1', 'GET /files/remote-1.mp4']);
    expect(proxyConnects.length).toBeGreaterThanOrEqual(1);
    expect(new Set(proxyConnects)).toEqual(new Set([targetHostPort()]));

    // Resumable downloader used by the Electron main process.
    proxyConnects.length = 0; targetRequests.length = 0;
    const resumable = await createConfiguredVideoProvider(videoConfig(proxyUrl()), workDir, undefined, {
      recoveryProviderId: 'local-remote', downloadResult: downloadVerifiedVideoResult,
    }).resume!('remote-1', { estimatedCost: 0 });
    expect((await readFile(resumable.path)).equals(mp4)).toBe(true);
    expect(targetRequests).toContain('GET /files/remote-1.mp4');
    expect(proxyConnects.length).toBeGreaterThanOrEqual(2);

    proxyConnects.length = 0; targetRequests.length = 0;
    await createConfiguredVideoProvider(videoConfig(), workDir, undefined, { recoveryProviderId: 'local-remote', downloadResult: downloadVerifiedVideoResult })
      .resume!('remote-1', { estimatedCost: 0 });
    expect(proxyConnects).toEqual([]);
    expect(targetRequests).toHaveLength(2);
  });
});

describe('G-5 proxy reaches fixed-endpoint clients (dispatcher recorded, no network)', () => {
  it('MiniMax TTS picks a ProxyAgent for the profile proxy and a plain Agent without it', async () => {
    const audioHex = Buffer.from('mm-audio').toString('hex');
    const { seen, fetchImpl } = recordingFetch(() => new Response(JSON.stringify({ base_resp: { status_code: 0 }, data: { audio: audioHex } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchImpl);
    await createConfiguredNarrationSynthesizer(ttsConfig('minimax', 'http://u:pw@127.0.0.1:7895'), workDir)([scene], task).catch(() => undefined);
    expect(seen[0]?.url).toContain('api.minimaxi.com');
    expect(seen[0]?.dispatcher).toBeInstanceOf(ProxyAgent);
    expect(proxyUriOf(seen[0]?.dispatcher)).toBe('http://127.0.0.1:7895/');

    await createConfiguredNarrationSynthesizer(ttsConfig('minimax'), workDir)([{ ...scene, id: 2 }], task).catch(() => undefined);
    expect(seen[1]?.dispatcher).toBeInstanceOf(Agent);
    expect(seen[1]?.dispatcher).not.toBeInstanceOf(ProxyAgent);
  });

  it('Volcengine speaker listing uses the request proxy', async () => {
    const { seen, fetchImpl } = recordingFetch(() => new Response(JSON.stringify({ Result: { Speakers: [], Total: 0 } }), { status: 200 }));
    const request = { accessKeyId: 'AK', secretAccessKey: 'SK' };
    await listVolcengineSpeakers({ ...request, proxyUrl: 'http://127.0.0.1:7896' }, { fetchImpl });
    expect(proxyUriOf(seen[0]?.dispatcher)).toBe('http://127.0.0.1:7896/');
    await listVolcengineSpeakers(request, { fetchImpl });
    expect(seen[1]?.dispatcher).toBeInstanceOf(Agent);
    expect(seen[1]?.dispatcher).not.toBeInstanceOf(ProxyAgent);
  });

  it('music provider and the music profile service (config test + runtimes) use the music profile proxy', async () => {
    const { seen, fetchImpl } = recordingFetch(() => new Response(JSON.stringify({ data: { balance: 12.5 } }), { status: 200 }));
    await expect(createMusicProvider({ apiKey: 'mk', baseUrl: 'https://music.example', fetchImpl, proxyUrl: 'http://127.0.0.1:7897' }).getBalance())
      .resolves.toMatchObject({ balance: 12.5 });
    expect(proxyUriOf(seen[0]?.dispatcher)).toBe('http://127.0.0.1:7897/');
    await createMusicProvider({ apiKey: 'mk', baseUrl: 'https://music.example', fetchImpl }).getBalance();
    expect(seen[1]?.dispatcher).not.toBeInstanceOf(ProxyAgent);

    const profile = { ...defaultConfig.music.profiles[0], id: 'music-a', baseUrl: 'https://music.example', apiKey: 'mk', useEnvironmentKey: false };
    let config = normalizeAppConfig({ ...defaultConfig, music: { enabled: true, activeProfileId: 'music-a', profiles: [{ ...profile, proxyUrl: 'http://127.0.0.1:7898' }] } });
    const service = createMusicProfileService({ dataDir: workDir, getConfig: async () => config, resolveEnvironmentApiKey: async () => '', fetchImpl, autoPoll: false });
    try {
      await expect(service.testConfiguration(config)).resolves.toMatchObject({ status: 'pass' });
      expect(proxyUriOf(seen[2]?.dispatcher)).toBe('http://127.0.0.1:7898/');

      // Runtime path: an existing context picks up the latest saved proxy of its profile.
      const context = await service.active();
      await context.lab.getBalance();
      expect(proxyUriOf(seen[3]?.dispatcher)).toBe('http://127.0.0.1:7898/');
      config = normalizeAppConfig({ ...config, music: { ...config.music, profiles: [profile] } });
      await context.lab.getBalance();
      expect(seen[4]?.dispatcher).not.toBeInstanceOf(ProxyAgent);
    } finally {
      service.close();
    }
  });
});

describe('G-5 proxy failures stay redacted and old configs stay compatible', () => {
  it('reports an unreachable TTS / STT proxy without credentials and keeps the not-sent code for STT', async () => {
    const port = await closedPort();
    const secretProxy = `http://alice:pw-secret@127.0.0.1:${port}`;
    const ttsError = await createConfiguredNarrationSynthesizer(ttsConfig('volcengine', secretProxy), workDir, { retry: { maxAttempts: 1 } })([scene], task)
      .then(() => null, (error: Error) => error);
    expect(ttsError?.message).toContain('代理连接失败');
    expect(ttsError?.message).toContain(`http://127.0.0.1:${port}`);
    expect(`${ttsError?.message} ${JSON.stringify(ttsError)}`).not.toMatch(/alice|pw-secret/u);

    const audio = join(workDir, 'clip.mp3');
    await writeFile(audio, Buffer.from('ID3fake-audio-bytes'));
    const sttError = await transcribeViralAudio(audio, sttConfig(secretProxy)).then(() => null, (error: Error) => error);
    expect(sttError?.message).not.toMatch(/alice|pw-secret/u);
    expect((sttError as { code?: string } | null)?.code).toBe('NETWORK_PROXY_FAILED');
    expect(classifyProviderFailure({ error: sttError })).toMatchObject({ outcome: 'not-sent' });
    expect(targetRequests).toEqual([]);
  });

  it('old configs without proxyUrl load unchanged; saved proxies survive normalization', () => {
    const legacy = normalizeAppConfig({ ...defaultConfig });
    expect('proxyUrl' in legacy.tts).toBe(false);
    expect(legacy.ttsProfiles.some((profile) => 'proxyUrl' in profile)).toBe(false);
    expect('proxyUrl' in legacy.speechToText).toBe(false);
    expect(legacy.speechToTextProfiles.some((profile) => 'proxyUrl' in profile)).toBe(false);
    expect(legacy.video.providers.some((provider) => 'proxyUrl' in provider)).toBe(false);
    expect(legacy.music.profiles.some((profile) => 'proxyUrl' in profile)).toBe(false);
    expect(normalizeAppConfig(legacy)).toEqual(legacy);

    const proxied = 'http://127.0.0.1:7890';
    expect(ttsConfig('volcengine', proxied).tts.proxyUrl).toBe(proxied);
    expect(ttsConfig('volcengine', proxied).ttsProfiles[0].proxyUrl).toBe(proxied);
    expect(sttConfig(proxied).speechToText.proxyUrl).toBe(proxied);
    expect(videoConfig(proxied).video.providers[0].proxyUrl).toBe(proxied);
    const music = normalizeAppConfig({ ...defaultConfig, music: { ...defaultConfig.music, profiles: [{ ...defaultConfig.music.profiles[0], proxyUrl: proxied }] } });
    expect(music.music.profiles[0].proxyUrl).toBe(proxied);
    // Blank proxy = direct = field dropped.
    expect('proxyUrl' in sttConfig('  ').speechToText).toBe(false);

    // IPC request for model listing: old shape still valid, proxy accepted, unknown keys still rejected.
    expect(providerModelListSchema.safeParse({ baseUrl: 'https://x', apiKey: 'k' }).success).toBe(true);
    expect(providerModelListSchema.safeParse({ baseUrl: 'https://x', apiKey: 'k', proxyUrl: proxied }).success).toBe(true);
    expect(providerModelListSchema.safeParse({ baseUrl: 'https://x', apiKey: 'k', other: 1 }).success).toBe(false);
  });
});
