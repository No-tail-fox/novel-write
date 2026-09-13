import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '@shared/config';
import { normalizeAppConfig, validateConfigTarget } from '@shared/config-utils';
import { applyConfigSecrets, extractConfigSecrets, stripConfigSecrets } from '@shared/config-secrets';
import { createConfiguredVideoProvider, requiredVideoCapabilities, selectVideoGenerationRoute } from '@shared/video-provider';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cloud video provider', () => {
  it('migrates old configs and keeps the provider key in the encrypted secret inventory', () => {
    const config = normalizeAppConfig(defaultConfig);
    expect(config.video.providers[0]).toMatchObject({
      id: 'default-cloud-video',
      submitPath: '/videos/generations',
      statusPathTemplate: '/videos/generations/{id}',
    });

    config.video.providers[0].baseUrl = 'https://video.example/v1';
    config.video.providers[0].apiKey = 'video-secret';
    config.video.providers[0].model = 'video-model';
    config.video.providers[0].enabled = true;
    expect(validateConfigTarget('video', config).status).toBe('pass');
    expect(extractConfigSecrets(config)['video/default-cloud-video/apiKey']).toBe('video-secret');

    const stripped = stripConfigSecrets(config);
    expect(stripped.video.providers[0].apiKey).toBe('');
    expect(applyConfigSecrets(stripped, { 'video/default-cloud-video/apiKey': 'video-secret' }).video.providers[0].apiKey).toBe('video-secret');
  });

  it('submits a synchronous I2V request and downloads the returned video', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-video-provider-sync-'));
    const firstFrame = join(dir, 'first.png');
    await writeFile(firstFrame, Buffer.from('frame'));
    const requests: Array<{ url: string; body?: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      requests.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith('/videos/generations')) {
        return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example/generated.mp4' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(Buffer.from('real-video'), { status: 200, headers: { 'content-type': 'video/mp4' } });
    }));

    try {
      const config = normalizeAppConfig({
        ...defaultConfig,
        video: {
          ...defaultConfig.video,
          providers: [{
            ...defaultConfig.video.providers[0],
            enabled: true,
            baseUrl: 'https://video.example/v1',
            apiKey: 'video-key',
            model: 'video-model',
            capabilities: ['i2v'],
          }],
        },
      });
      const request = {
        prompt: '电影感城市清晨',
        durationSec: 5,
        ratio: '9:16',
        firstFramePath: firstFrame,
      };
      const provider = createConfiguredVideoProvider(config, dir, {
        durationSec: request.durationSec,
        requiredCapabilities: requiredVideoCapabilities(request),
        remainingBudget: Number.POSITIVE_INFINITY,
      });
      const result = await provider.generate(request);

      expect(await readFile(result.path, 'utf8')).toBe('real-video');
      expect(requests[0]).toMatchObject({
        url: 'https://video.example/v1/videos/generations',
        body: {
          model: 'video-model',
          prompt: '电影感城市清晨',
          duration: 5,
          aspect_ratio: '9:16',
        },
      });
      expect(String(requests[0].body?.image)).toMatch(/^data:image\/png;base64,/u);
      expect(result.estimatedCost).toBe(defaultConfig.video.providers[0].pricePerSecond * 5);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('polls asynchronous jobs and routes over-budget work to the configured fallback', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-video-provider-async-'));
    let polls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/videos/generations')) {
        return new Response(JSON.stringify({ task_id: 'job-1', status: 'queued' }), { status: 202, headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/videos/generations/job-1')) {
        polls += 1;
        return new Response(JSON.stringify(polls === 1
          ? { status: 'processing' }
          : { status: 'succeeded', output: { url: 'https://cdn.example/job-1.mp4' } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(Buffer.from('async-video'), { status: 200, headers: { 'content-type': 'video/mp4' } });
    }));

    try {
      const config = normalizeAppConfig({
        ...defaultConfig,
        video: {
          ...defaultConfig.video,
          providers: [{
            ...defaultConfig.video.providers[0],
            enabled: true,
            baseUrl: 'https://video.example/v1',
            apiKey: 'video-key',
            model: 'async-model',
            pollIntervalMs: 1,
            pricePerSecond: 1,
            capabilities: ['t2v'],
          }],
        },
      });
      const request = { prompt: '海边日落', durationSec: 4, ratio: '16:9' };
      const provider = createConfiguredVideoProvider(config, dir, {
        durationSec: request.durationSec,
        requiredCapabilities: requiredVideoCapabilities(request),
        remainingBudget: Number.POSITIVE_INFINITY,
      });
      const result = await provider.generate(request);
      expect(await readFile(result.path, 'utf8')).toBe('async-video');
      expect(result.remoteTaskId).toBe('job-1');
      expect(polls).toBe(2);

      expect(selectVideoGenerationRoute(config, { durationSec: 8, requiredCapabilities: ['t2v'], remainingBudget: 0 })).toMatchObject({
        kind: 'fallback',
        fallback: 'dynamic-image',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('derives independent capabilities for text, first-frame, first-last-frame, and reference generation', () => {
    expect(requiredVideoCapabilities({})).toEqual(['t2v']);
    expect(requiredVideoCapabilities({ firstFramePath: 'first.png' })).toEqual(['i2v']);
    expect(requiredVideoCapabilities({ firstFramePath: 'first.png', lastFramePath: 'last.png' })).toEqual(['i2v', 'first-last-frame']);
    expect(requiredVideoCapabilities({ referenceImagePaths: ['reference.png'] })).toEqual(['reference-image']);
    expect(requiredVideoCapabilities({ firstFramePath: 'first.png', referenceImagePaths: ['reference.png'] })).toEqual(['i2v', 'reference-image']);
    expect(() => requiredVideoCapabilities({ lastFramePath: 'last.png' })).toThrow(/VIDEO_PROVIDER_FIRST_FRAME_REQUIRED/u);
  });

  it('routes with the real duration, required capability, and remaining budget', () => {
    const config = normalizeAppConfig({
      ...defaultConfig,
      video: {
        ...defaultConfig.video,
        activeProviderId: 'short-i2v',
        providers: [
          {
            ...defaultConfig.video.providers[0],
            id: 'short-i2v',
            enabled: true,
            maxDurationSec: 3,
            pricePerSecond: 1,
            capabilities: ['i2v'],
          },
          {
            ...defaultConfig.video.providers[0],
            id: 'long-i2v',
            enabled: true,
            maxDurationSec: 10,
            pricePerSecond: 2,
            capabilities: ['i2v'],
          },
          {
            ...defaultConfig.video.providers[0],
            id: 'text-only',
            enabled: true,
            maxDurationSec: 10,
            pricePerSecond: 0.1,
            capabilities: ['t2v'],
          },
        ],
        automation: {
          ...defaultConfig.video.automation,
          providerWhitelist: ['short-i2v', 'long-i2v', 'text-only'],
        },
      },
    });

    expect(selectVideoGenerationRoute(config, { durationSec: 5, requiredCapabilities: ['i2v'], remainingBudget: 10 })).toMatchObject({
      kind: 'provider',
      provider: { id: 'long-i2v' },
      estimatedCost: 10,
    });
    expect(selectVideoGenerationRoute(config, { durationSec: 5, requiredCapabilities: ['i2v'], remainingBudget: 9 })).toMatchObject({
      kind: 'fallback',
      fallback: 'dynamic-image',
    });
    expect(selectVideoGenerationRoute(config, { durationSec: 5, requiredCapabilities: ['t2v'], remainingBudget: 1 })).toMatchObject({
      kind: 'provider',
      provider: { id: 'text-only' },
    });
    expect(selectVideoGenerationRoute(config, { durationSec: 0.5, requiredCapabilities: ['t2v'], remainingBudget: 0.05 })).toMatchObject({
      kind: 'fallback',
      fallback: 'dynamic-image',
    });
    expect(() => selectVideoGenerationRoute(config, { durationSec: 5, requiredCapabilities: ['t2v'], remainingBudget: -1 })).toThrow(/VIDEO_PROVIDER_BUDGET_INVALID/u);
  });

  it('rejects a generation request that drifts from the route duration or capability set', async () => {
    const config = normalizeAppConfig({
      ...defaultConfig,
      video: {
        ...defaultConfig.video,
        providers: [{
          ...defaultConfig.video.providers[0],
          enabled: true,
          baseUrl: 'https://video.example/v1',
          apiKey: 'video-key',
          model: 'video-model',
          capabilities: ['t2v', 'i2v', 'first-last-frame', 'reference-image'],
        }],
      },
    });
    const provider = createConfiguredVideoProvider(config, 'D:/tmp/storydream-video', {
      durationSec: 5,
      requiredCapabilities: ['i2v'],
      remainingBudget: Number.POSITIVE_INFINITY,
    });

    await expect(provider.generate({ prompt: '纯文本请求', durationSec: 5, ratio: '9:16' })).rejects.toThrow(/VIDEO_PROVIDER_ROUTE_MISMATCH/u);
    await expect(provider.generate({ prompt: '错误时长', durationSec: 4, ratio: '9:16', firstFramePath: 'first.png' })).rejects.toThrow(/VIDEO_PROVIDER_ROUTE_MISMATCH/u);
    await expect(provider.generate({ prompt: '漏报尾帧能力', durationSec: 5, ratio: '9:16', firstFramePath: 'first.png', lastFramePath: 'last.png' })).rejects.toThrow(/VIDEO_PROVIDER_ROUTE_MISMATCH/u);
    await expect(provider.generate({ prompt: '尾帧缺少首帧', durationSec: 5, ratio: '9:16', lastFramePath: 'last.png' })).rejects.toThrow(/VIDEO_PROVIDER_FIRST_FRAME_REQUIRED/u);
  });

  it('does not retry a billable submit when the caller disables paid retries', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'temporary failure' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const config = normalizeAppConfig({
      ...defaultConfig,
      video: {
        ...defaultConfig.video,
        providers: [{
          ...defaultConfig.video.providers[0],
          enabled: true,
          baseUrl: 'https://video.example/v1',
          apiKey: 'video-key',
          model: 'video-model',
          capabilities: ['t2v'],
        }],
        automation: { ...defaultConfig.video.automation, retryCount: 3 },
      },
    });
    const request = { prompt: '单次付费提交', durationSec: 3, ratio: '9:16' };
    const provider = createConfiguredVideoProvider(config, 'D:/tmp/storydream-video', {
      durationSec: request.durationSec,
      requiredCapabilities: requiredVideoCapabilities(request),
      remainingBudget: Number.POSITIVE_INFINITY,
    }, { submitRetryCount: 0 });

    await expect(provider.generate(request)).rejects.toThrow(/VIDEO_PROVIDER_HTTP_ERROR/u);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
