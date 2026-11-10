import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '@shared/config';
import { createConfiguredNarrationSynthesizer } from '@shared/media-providers';
import {
  classifyTtsFailure,
  mapWithConcurrencyLimit,
  normalizeTtsSegmentConcurrency,
  runTtsSegmentWithRetry,
  TtsProviderHttpError,
} from '@shared/tts-segment-synthesis';
import type { AppConfig, StoryboardScene, Task } from '@shared/types';

const volcConfig: AppConfig = { ...defaultConfig, tts: { ...defaultConfig.tts, provider: 'volcengine', volcengine: {
  ...defaultConfig.tts.volcengine, apiKey: 'test', resourceId: 'seed-tts-2.0',
  endpoint: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional', speaker: 'test-speaker',
} } };
const minimaxConfig: AppConfig = { ...defaultConfig, tts: { ...defaultConfig.tts, provider: 'minimax', minimax: {
  ...defaultConfig.tts.minimax, apiKey: 'test', model: 'speech-02-hd', voiceId: 'voice',
} } };
const task = { id: 'tts-retry-test', title: 'TTS retry', ratio: '9:16', ttsSpeed: 1, speaker: 'voice' } as Task;
const scenes = (count: number): StoryboardScene[] => Array.from({ length: count }, (_, index) => ({
  id: index + 1, cap: `第 ${index + 1} 段旁白。`, descPrompt: 'scene', durationMs: 1200,
}));
const v3Ok = () => new Response([
  JSON.stringify({ code: 0, data: Buffer.from('audio').toString('base64') }),
  JSON.stringify({ code: 20000000, message: 'ok', data: null }),
].join('\n'));
const econnreset = () => new TypeError('fetch failed', {
  cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET', hostname: 'openspeech.bytedance.com' }),
});
const noSleep = vi.fn(async (_ms: number, signal?: AbortSignal) => { if (signal?.aborted) throw signal.reason; });

async function withDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'storybound-tts-retry-'));
  try { return await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  noSleep.mockClear();
});

describe('TTS segment retry (G-5)', () => {
  it('retries a Volcengine segment after ECONNRESET and succeeds with a fresh request id', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      if (fetchMock.mock.calls.length === 1) throw econnreset();
      return v3Ok();
    });
    vi.stubGlobal('fetch', fetchMock);
    await withDir(async (dir) => {
      const assets = await createConfiguredNarrationSynthesizer(volcConfig, dir, { retry: { sleep: noSleep, onRetry: () => undefined } })(scenes(1), task);
      expect(assets).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(noSleep).toHaveBeenCalledTimes(1);
      const ids = fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get('x-api-request-id'));
      expect(ids[0]).not.toBe(ids[1]);
      expect(fetchMock.mock.calls[0][1]?.body).toBe(fetchMock.mock.calls[1][1]?.body);
    });
  });

  it('gives up after 3 attempts on persistent transport loss', async () => {
    const fetchMock = vi.fn(async () => { throw econnreset(); });
    vi.stubGlobal('fetch', fetchMock);
    await withDir(async (dir) => {
      await expect(createConfiguredNarrationSynthesizer(volcConfig, dir, { retry: { sleep: noSleep, onRetry: () => undefined } })(scenes(1), task))
        .rejects.toThrow(/ECONNRESET|fetch failed/);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  it.each([
    [401, 'invalid api key'],
    [402, 'insufficient balance'],
    [400, 'bad text'],
  ])('does not retry HTTP %s', async (status, body) => {
    const fetchMock = vi.fn(async () => new Response(body, { status }));
    vi.stubGlobal('fetch', fetchMock);
    await withDir(async (dir) => {
      await expect(createConfiguredNarrationSynthesizer(volcConfig, dir, { retry: { sleep: noSleep } })(scenes(1), task))
        .rejects.toThrow(`Volcengine TTS V3 API error (${status}): ${body}`);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(noSleep).not.toHaveBeenCalled();
    });
  });

  it('honours MiniMax Retry-After on 429 before retrying', async () => {
    const fetchMock = vi.fn(async () => fetchMock.mock.calls.length === 1
      ? new Response('rate limited', { status: 429, headers: { 'Retry-After': '4' } })
      : new Response(JSON.stringify({ data: { audio: Buffer.from('mp3').toString('hex') }, base_resp: { status_code: 0 } })));
    vi.stubGlobal('fetch', fetchMock);
    await withDir(async (dir) => {
      const assets = await createConfiguredNarrationSynthesizer(minimaxConfig, dir, { retry: { sleep: noSleep, onRetry: () => undefined } })(scenes(1), task);
      expect(assets).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(noSleep.mock.calls[0][0]).toBeGreaterThanOrEqual(4000);
    });
  });

  it('keeps at most the configured number of segments in flight and preserves order', async () => {
    for (const [concurrency, expected] of [[undefined, 2], [3, 3], [1, 1]] as const) {
      let inFlight = 0;
      let peak = 0;
      const fetchMock = vi.fn(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return v3Ok();
      });
      vi.stubGlobal('fetch', fetchMock);
      await withDir(async (dir) => {
        const assets = await createConfiguredNarrationSynthesizer(volcConfig, dir, concurrency ? { concurrency } : {})(scenes(7), task);
        expect(assets.map((asset) => asset.sceneId)).toEqual([1, 2, 3, 4, 5, 6, 7]);
        expect(fetchMock).toHaveBeenCalledTimes(7);
        expect(peak).toBe(expected);
      });
    }
  });

  it('stops retrying once the caller aborts during backoff', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => { throw econnreset(); });
    vi.stubGlobal('fetch', fetchMock);
    await withDir(async (dir) => {
      const run = createConfiguredNarrationSynthesizer(volcConfig, dir, { retry: { onRetry: () => controller.abort(new Error('user cancelled')) } })(scenes(1), task, controller.signal);
      await expect(run).rejects.toThrow('user cancelled');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});

describe('runTtsSegmentWithRetry', () => {
  it('waits for Retry-After with fake timers before the next attempt', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const response = new Response('', { status: 429, headers: { 'Retry-After': '7' } });
    const run = runTtsSegmentWithRetry(async () => {
      attempts += 1;
      if (attempts === 1) throw new TtsProviderHttpError('TTS (429)', 429, { 'retry-after': response.headers.get('retry-after')! }, '');
      return 'ok';
    }, { random: () => 0, onRetry: () => undefined });
    await vi.advanceTimersByTimeAsync(6_999);
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(run).resolves.toBe('ok');
    expect(attempts).toBe(2);
  });

  it('uses exponential backoff with jitter and never retries auth or local errors', async () => {
    const delays: number[] = [];
    let attempts = 0;
    await expect(runTtsSegmentWithRetry(async () => {
      attempts += 1;
      throw new TtsProviderHttpError('TTS (502)', 502, {}, 'bad gateway');
    }, { sleep: async (ms) => { delays.push(ms); }, random: () => 1, onRetry: () => undefined })).rejects.toThrow('502');
    expect(attempts).toBe(3);
    expect(delays).toEqual([500, 1500]);

    let authAttempts = 0;
    await expect(runTtsSegmentWithRetry(async () => { authAttempts += 1; throw new TtsProviderHttpError('TTS (403)', 403, {}, 'forbidden'); }, { sleep: noSleep }))
      .rejects.toThrow('403');
    expect(authAttempts).toBe(1);
    expect(classifyTtsFailure(new Error('TTS_RESPONSE_INCOMPLETE: partial audio was not saved.')).retry).toBe('never');
  });

  it('does not start when already aborted and rejects the pending backoff on abort', async () => {
    const controller = new AbortController();
    controller.abort(new Error('stop'));
    const attempt = vi.fn(async () => 'never');
    await expect(runTtsSegmentWithRetry(attempt, { signal: controller.signal })).rejects.toThrow('stop');
    expect(attempt).not.toHaveBeenCalled();

    vi.useFakeTimers();
    const live = new AbortController();
    const failing = vi.fn(async () => { throw econnreset(); });
    const run = runTtsSegmentWithRetry(failing, { signal: live.signal, onRetry: () => undefined });
    const settled = expect(run).rejects.toThrow('cancelled');
    await vi.advanceTimersByTimeAsync(100);
    live.abort(new Error('cancelled'));
    await settled;
    expect(failing).toHaveBeenCalledTimes(1);
  });
});

describe('mapWithConcurrencyLimit', () => {
  it('stops scheduling and aborts siblings after the first failure', async () => {
    const started: number[] = [];
    const siblingAborted = vi.fn();
    await expect(mapWithConcurrencyLimit([0, 1, 2, 3, 4], 2, async (item, _index, signal) => {
      started.push(item);
      if (item === 0) throw new Error('boom');
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 1_000);
        signal.addEventListener('abort', () => { clearTimeout(timer); siblingAborted(); reject(signal.reason); }, { once: true });
      });
      return item;
    })).rejects.toThrow('boom');
    expect(started).toEqual([0, 1]);
    expect(siblingAborted).toHaveBeenCalledTimes(1);
  });

  it('clamps the configured concurrency', () => {
    expect(normalizeTtsSegmentConcurrency(undefined)).toBe(2);
    expect(normalizeTtsSegmentConcurrency(0)).toBe(1);
    expect(normalizeTtsSegmentConcurrency(99)).toBe(6);
    expect(normalizeTtsSegmentConcurrency(2.9)).toBe(2);
  });
});
