import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '@shared/config';
import { normalizeAppConfig, validateConfigTarget } from '@shared/config-utils';
import { applyConfigSecrets, extractConfigSecrets, stripConfigSecrets } from '@shared/config-secrets';
import { createConfiguredVideoProvider, selectVideoGenerationRoute } from '@shared/video-provider';

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
            capabilities: ['t2v', 'i2v'],
          }],
        },
      });
      const provider = createConfiguredVideoProvider(config, dir);
      const result = await provider.generate({
        prompt: '电影感城市清晨',
        durationSec: 5,
        ratio: '9:16',
        firstFramePath: firstFrame,
      });

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
          }],
        },
      });
      const provider = createConfiguredVideoProvider(config, dir);
      const result = await provider.generate({ prompt: '海边日落', durationSec: 4, ratio: '16:9' });
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
});
