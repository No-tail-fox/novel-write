import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '@shared/config';
import { normalizeAppConfig, validateConfigTarget } from '@shared/config-utils';
import { applyConfigSecrets, extractConfigSecrets, stripConfigSecrets } from '@shared/config-secrets';
import { createConfiguredVideoProvider, requiredVideoCapabilities, selectVideoGenerationRoute, type VideoGenerationRequest } from '@shared/video-provider';
import type { VideoProviderConfig } from '@shared/types';

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

  it.each([
    'MiniMax-H3',
    'MiniMax-H3-Max',
    'doubao-seedance-2-0-250428',
    'doubao-seedance-2-5-260101',
  ])('migrates legacy capability declarations for known multimodal model %s', (model) => {
    const config = normalizeAppConfig({
      ...defaultConfig,
      video: { ...defaultConfig.video, providers: [{
        ...defaultConfig.video.providers[0], model, capabilities: ['t2v', 'i2v'],
      }] },
    });
    expect(config.video.providers[0].capabilities).toEqual([
      't2v', 'i2v', 'first-last-frame', 'reference-image', 'reference-video', 'reference-audio', 'synchronized-audio',
    ]);
  });

  it('preserves an explicit custom capability declaration for known video models', () => {
    const config = normalizeAppConfig({
      ...defaultConfig,
      video: { ...defaultConfig.video, providers: [{
        ...defaultConfig.video.providers[0], model: 'MiniMax-H3', capabilities: ['i2v'],
      }] },
    });
    expect(config.video.providers[0].capabilities).toEqual(['i2v']);
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

  it.each(['MiniMax-H3', 'doubao-seedance-2-0-250428'])('uploads first and last frames with explicit roles for %s', async (model) => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-video-provider-frames-'));
    const firstFrame = join(dir, 'first.png');
    const lastFrame = join(dir, 'last.png');
    await Promise.all([writeFile(firstFrame, Buffer.from('first')), writeFile(lastFrame, Buffer.from('last'))]);
    let submitted: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      if (String(url).includes('/submit')) {
        submitted = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ content: { url: 'https://cdn.example/frames.mp4' } }), { status: 200 });
      }
      return new Response(Buffer.from('frames-video'), { status: 200, headers: { 'content-type': 'video/mp4' } });
    }));
    try {
      const config = normalizeAppConfig({ ...defaultConfig, video: { ...defaultConfig.video, providers: [{
        ...defaultConfig.video.providers[0], enabled: true, baseUrl: 'https://video.example', submitPath: '/submit',
        model, apiKey: 'key', capabilities: ['i2v', 'first-last-frame'],
      }] } });
      const request = { prompt: '从清晨过渡到夜晚', durationSec: 5, ratio: '16:9', firstFramePath: firstFrame, lastFramePath: lastFrame };
      const provider = createConfiguredVideoProvider(config, dir, {
        durationSec: 5, requiredCapabilities: requiredVideoCapabilities(request), remainingBudget: Number.POSITIVE_INFINITY,
      });
      await provider.generate(request);
      const content = submitted.content as Array<Record<string, unknown>>;
      expect(content.map((item) => item.role)).toEqual([undefined, 'first_frame', 'last_frame']);
      expect(content.slice(1).every((item) => String((item.image_url as { url: string }).url).startsWith('data:image/png;base64,'))).toBe(true);
      expect(submitted.ratio).toBe(model.includes('seedance') ? '16:9' : 'adaptive');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.each([
    { model: 'MiniMax-H3', resolution: '2K', expectedResolution: '2K', promptToken: '参考图片 1' },
    { model: 'doubao-seedance-2-0-250428', resolution: '1080P', expectedResolution: '1080p', promptToken: '@Image1' },
  ])('uses multimodal content roles for $model', async ({ model, resolution, expectedResolution, promptToken }) => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-video-provider-multimodal-'));
    const image = join(dir, 'person.png');
    const video = join(dir, 'motion.mp4');
    const audio = join(dir, 'voice.mp3');
    await Promise.all([writeFile(image, Buffer.from('image')), writeFile(video, Buffer.from('video')), writeFile(audio, Buffer.from('audio'))]);
    let submitted: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      if (String(url).includes('/submit')) {
        submitted = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ content: { url: 'https://cdn.example/multimodal.mp4' } }), { status: 200 });
      }
      return new Response(Buffer.from('multimodal-video'), { status: 200, headers: { 'content-type': 'video/mp4' } });
    }));
    try {
      const config = normalizeAppConfig({ ...defaultConfig, video: { ...defaultConfig.video, providers: [{
        ...defaultConfig.video.providers[0], enabled: true, baseUrl: 'https://video.example', submitPath: '/submit',
        model, apiKey: 'key', maxResolution: resolution,
        capabilities: ['reference-image', 'reference-video', 'reference-audio', 'synchronized-audio'],
      }] } });
      const request = {
        prompt: '人物转身看向镜头', durationSec: 5, ratio: '9:16', resolution, generateAudio: true,
        referenceImages: [{ path: image, kind: 'character' as const, description: '保持脸型和服装' }],
        referenceVideoPaths: [model.includes('seedance') ? 'https://media.example/motion.mp4' : video], referenceAudioPaths: [audio],
      };
      const provider = createConfiguredVideoProvider(config, dir, {
        durationSec: 5, requiredCapabilities: requiredVideoCapabilities(request), remainingBudget: Number.POSITIVE_INFINITY,
      });
      await provider.generate(request);
      expect(submitted).toMatchObject({ model, duration: 5, ratio: '9:16', resolution: expectedResolution });
      const content = submitted.content as Array<Record<string, unknown>>;
      expect(content.map((item) => [item.type, item.role])).toEqual([
        ['text', undefined], ['image_url', 'reference_image'], ['video_url', 'reference_video'], ['audio_url', 'reference_audio'],
      ]);
      expect(String(content[0].text)).toContain(promptToken);
      expect(submitted.generate_audio).toBe(model.includes('seedance') ? true : undefined);
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

  it('persists the remote task id before polling and resumes without another billable POST', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-video-provider-resume-'));
    const events: string[] = [];
    let submits = 0;
    const fetchMock = vi.fn(async (rawUrl: string, init: RequestInit = {}) => {
      const url = String(rawUrl);
      if ((init.method ?? 'GET') === 'POST') {
        submits += 1;
        events.push('submit');
        return new Response(JSON.stringify({ task_id: 'job-new', status: 'queued' }), { status: 202 });
      }
      if (url.endsWith('/job-new') || url.endsWith('/job-resume')) {
        events.push(`poll:${url.endsWith('/job-new') ? 'new' : 'resume'}`);
        return new Response(JSON.stringify({ status: 'succeeded', output: { url: `https://cdn.example/${url.endsWith('/job-new') ? 'new' : 'resume'}.mp4` } }), { status: 200 });
      }
      return new Response(Buffer.from(url.includes('resume') ? 'resumed-video' : 'new-video'), { status: 200, headers: { 'content-type': 'video/mp4' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const config = normalizeAppConfig({ ...defaultConfig, video: { ...defaultConfig.video, providers: [{
        ...defaultConfig.video.providers[0], id: 'paid-remote', enabled: true, baseUrl: 'https://video.example/v1', apiKey: 'video-key',
        model: 'async-model', pollIntervalMs: 1, capabilities: ['t2v'],
      }], activeProviderId: 'paid-remote', automation: { ...defaultConfig.video.automation, providerWhitelist: ['paid-remote'], fallback: 'disabled' } } });
      const request = { prompt: '雨夜中的人物缓慢抬头', durationSec: 4, ratio: '16:9' };
      const routeRequest = { durationSec: 4, requiredCapabilities: requiredVideoCapabilities(request), remainingBudget: Number.POSITIVE_INFINITY };
      const provider = createConfiguredVideoProvider(config, dir, routeRequest, { submitRetryCount: 0, providerId: 'paid-remote' });
      const created = await provider.generate({ ...request, onSubmitted: async (taskId) => { events.push(`persist:${taskId}`); } });
      expect(await readFile(created.path, 'utf8')).toBe('new-video');
      expect(events.slice(0, 3)).toEqual(['submit', 'persist:job-new', 'poll:new']);

      const recoveryConfig = normalizeAppConfig({ ...config, video: {
        ...config.video,
        providers: config.video.providers.map((candidate) => ({
          ...candidate,
          enabled: false,
          maxDurationSec: 1,
          capabilities: [],
        })),
        automation: { ...config.video.automation, providerWhitelist: [] },
      } });
      const recoveryProvider = createConfiguredVideoProvider(recoveryConfig, dir, undefined, { recoveryProviderId: 'paid-remote' });
      const submitsBeforeRecovery = submits;
      const fetchCallsBeforeRecovery = fetchMock.mock.calls.length;
      const resumed = await recoveryProvider.resume!('job-resume', { estimatedCost: 7.25 });
      expect(await readFile(resumed.path, 'utf8')).toBe('resumed-video');
      expect(resumed.remoteTaskId).toBe('job-resume');
      expect(resumed.estimatedCost).toBe(7.25);
      expect(submits).toBe(submitsBeforeRecovery);
      expect(fetchMock.mock.calls.slice(fetchCallsBeforeRecovery).map(([, init]) => init?.method ?? 'GET')).toEqual(['GET', 'GET']);
      await expect(recoveryProvider.generate({
        prompt: '当前镜头已删除首帧且时长、画幅均不再受支持',
        durationSec: 999,
        ratio: '3:2',
        lastFramePath: 'Z:/missing-last-frame.png',
      })).rejects.toThrow('VIDEO_PROVIDER_RECOVERY_ONLY');
      expect(submits).toBe(submitsBeforeRecovery);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects a terminal successful task with no usable media without polling it again', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-video-provider-terminal-empty-'));
    const fetchMock = vi.fn(async (_rawUrl: string, _init: RequestInit = {}) => new Response(JSON.stringify({
      status: 'completed',
      output: {},
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      const config = normalizeAppConfig({
        ...defaultConfig,
        video: {
          ...defaultConfig.video,
          providers: [{
            ...defaultConfig.video.providers[0],
            id: 'terminal-empty',
            enabled: true,
            baseUrl: 'https://video.example/v1',
            apiKey: 'video-key',
            model: 'async-model',
            pollIntervalMs: 1,
          }],
          activeProviderId: 'terminal-empty',
        },
      });
      const provider = createConfiguredVideoProvider(config, dir, undefined, { recoveryProviderId: 'terminal-empty' });

      await expect(provider.resume!('completed-without-media', { estimatedCost: 3.5 }))
        .rejects.toThrow('VIDEO_PROVIDER_INVALID_OUTPUT');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'GET' });
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

  it.each([
    { title: 'fractional H3 duration', model: 'MiniMax-H3', patch: { durationSec: 5.5 }, error: 'DURATION_UNSUPPORTED' },
    { title: 'short H3 duration', model: 'MiniMax-H3', patch: { durationSec: 3 }, error: 'DURATION_UNSUPPORTED' },
    { title: 'H3 Max minimum duration', model: 'MiniMax-H3-Max', patch: { durationSec: 4 }, error: 'DURATION_UNSUPPORTED' },
    { title: 'unsupported H3 resolution', model: 'MiniMax-H3', patch: { resolution: '480P' }, error: 'RESOLUTION_UNSUPPORTED' },
    { title: 'too many H3 images', model: 'MiniMax-H3', patch: { referenceImages: referenceImages(10) }, error: 'REFERENCE_LIMIT' },
    { title: 'H3 mixed reference total', model: 'MiniMax-H3', patch: { referenceImages: referenceImages(9), referenceVideoPaths: ['https://media.example/1.mp4', 'https://media.example/2.mp4', 'https://media.example/3.mp4'], referenceAudioPaths: ['https://media.example/voice.mp3'] }, error: 'REFERENCE_LIMIT' },
    { title: 'prompt length includes guidance', model: 'MiniMax-H3', patch: { prompt: '字'.repeat(6999), referenceImages: referenceImages(1) }, error: 'PROMPT_TOO_LONG' },
    { title: 'strict frames cannot mix with references', model: 'MiniMax-H3', patch: { firstFramePath: 'https://media.example/first.png', referenceImages: referenceImages(1) }, error: 'REFERENCE_MODE_CONFLICT' },
    { title: 'local Seedance reference video', model: 'doubao-seedance-2-0-260128', patch: { referenceVideoPaths: ['C:/motion.mp4'] }, error: 'HTTPS 视频地址或 asset://' },
    { title: 'Seedance Fast resolution', model: 'doubao-seedance-2-0-fast-260128', patch: { resolution: '1080P' }, error: 'RESOLUTION_UNSUPPORTED' },
  ])('rejects $title before any network call', async ({ model, patch, error }) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const config = multimodalConfig(model);
    const request: VideoGenerationRequest = { prompt: '保持人物一致，镜头缓慢推进', durationSec: 5, ratio: '16:9', ...patch };
    const provider = createConfiguredVideoProvider(config, 'C:/unused', {
      durationSec: request.durationSec, requiredCapabilities: requiredVideoCapabilities(request), remainingBudget: Infinity,
    });
    await expect(provider.generate(request)).rejects.toThrow(error);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses an explicit Seedance preset for opaque deployment IDs and preserves all remote references', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-video-provider-remote-'));
    let submitted: Record<string, unknown> = {};
    const fetchMock = vi.fn(async (_url: string, init: RequestInit = {}) => {
      submitted = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ b64_json: Buffer.from('video').toString('base64') }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const config = multimodalConfig('ep-202609180001', { modelPreset: 'seedance-2.5' });
      const images = referenceImages(30);
      images[0] = { path: 'asset://opening-frame', kind: 'opening', description: '以此画面开场' };
      images[1] = { path: 'asset://person', kind: 'character', description: '保持人物一致' };
      images[29] = { path: 'https://media.example/end.png', kind: 'ending', description: '最后定格' };
      const request: VideoGenerationRequest = {
        prompt: '从开场画面开始，人物经过广场，停在结尾画面。', durationSec: 30, ratio: 'adaptive', resolution: '1080P',
        referenceImages: images, referenceVideoPaths: ['asset://motion-video'], referenceAudioPaths: ['https://media.example/voice.mp3'],
      };
      const provider = createConfiguredVideoProvider(config, dir, {
        durationSec: request.durationSec, requiredCapabilities: requiredVideoCapabilities(request), remainingBudget: Infinity,
      });
      await provider.generate(request);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(submitted).toMatchObject({ model: 'ep-202609180001', duration: 30, resolution: '1080p' });
      const content = submitted.content as Array<{ type: string; role?: string; text?: string; image_url?: { url: string }; video_url?: { url: string } }>;
      expect(content.filter((item) => item.type === 'image_url').map((item) => item.image_url?.url)).toEqual(images.map((image) => image.path));
      expect(content.filter((item) => item.type === 'image_url').every((item) => item.role === 'reference_image')).toBe(true);
      expect(content.find((item) => item.type === 'video_url')?.video_url?.url).toBe('asset://motion-video');
      expect(content[0].text).toContain('@Image1 用于开场画面');
      expect(content[0].text).toContain('@Image30 用于结尾画面');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('forwards H3 mm_file references without loading them locally and chooses a valid default resolution', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-video-provider-h3-files-'));
    let submitted: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit = {}) => {
      submitted = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ b64_json: Buffer.from('video').toString('base64') }), { status: 200 });
    }));
    try {
      const request: VideoGenerationRequest = { prompt: '人物转身', durationSec: 5, ratio: '16:9', referenceImages: [{ path: 'mm_file://person', kind: 'character', description: '' }] };
      const provider = createConfiguredVideoProvider(multimodalConfig('MiniMax-H3'), dir, {
        durationSec: 5, requiredCapabilities: requiredVideoCapabilities(request), remainingBudget: Infinity,
      });
      await provider.generate(request);
      expect(submitted.resolution).toBe('768P');
      expect(submitted.content).toContainEqual({ type: 'image_url', image_url: { url: 'mm_file://person' }, role: 'reference_image' });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

function referenceImages(count: number): NonNullable<VideoGenerationRequest['referenceImages']> {
  return Array.from({ length: count }, (_, index) => ({ path: `https://media.example/${index}.png`, kind: 'style', description: '' }));
}

function multimodalConfig(model: string, patch: Partial<VideoProviderConfig> = {}) {
  return normalizeAppConfig({ ...defaultConfig, video: { ...defaultConfig.video, providers: [{
    ...defaultConfig.video.providers[0], enabled: true, baseUrl: 'https://video.example', apiKey: 'test-key', model,
    maxDurationSec: 30, maxResolution: '1080p', pricePerSecond: 0,
    capabilities: ['t2v', 'i2v', 'first-last-frame', 'reference-image', 'reference-video', 'reference-audio'], ...patch,
  }] } });
}
