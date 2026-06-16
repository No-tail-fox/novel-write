import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfiguredImageGenerator, createConfiguredNarrationSynthesizer, generateConfiguredVoicePreview } from '@shared/media-providers';
import { buildOpenAiImageEditFormData } from '@shared/openai-image-edit';
import { defaultConfig } from '@shared/config';
import { normalizeAppConfig } from '@shared/config-utils';
import type { AppConfig, ImagePrompt, StoryboardScene, Task } from '@shared/types';

const scene: StoryboardScene = { id: 1, cap: 'A real scene', descPrompt: 'visual prompt', durationMs: 1200 };
const prompt: ImagePrompt = {
  sceneId: 1,
  cap: scene.cap,
  prompt: 'visual prompt',
  negativePrompt: 'none',
  style: 'photo-real',
  ratio: '9:16',
  characterProfile: 'same person',
};
const task = {
  id: 'task-1',
  title: 'Task',
  ratio: '9:16',
  ttsSpeed: 1,
  speaker: 'voice',
} as Task;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('configured media providers', () => {
  it('builds OpenAI-compatible image edit form data with prompt, model, size, and references', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-provider-image-edit-form-'));
    const first = join(dir, 'first.png');
    const second = join(dir, 'second.png');
    await writeFile(first, 'first-image');
    await writeFile(second, 'second-image');

    try {
      const form = await buildOpenAiImageEditFormData({
        model: 'gpt-image-2',
        prompt: 'Keep the face and change the background',
        ratio: '16:9',
        resolution: '2K',
        referenceImagePaths: [first, second],
      });

      expect(form.get('model')).toBe('gpt-image-2');
      expect(form.get('prompt')).toBe('Keep the face and change the background');
      expect(form.get('size')).toBe('1536x1024');
      const images = form.getAll('image');
      expect(images).toHaveLength(2);
      expect(images[0]).toBeInstanceOf(Blob);
      expect((images[0] as File).name).toBe('first.png');
      expect((images[1] as File).name).toBe('second.png');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects image edits with more than 10 reference images', async () => {
    await expect(
      buildOpenAiImageEditFormData({
        model: 'gpt-image-2',
        prompt: 'too many',
        ratio: '1:1',
        resolution: '2K',
        referenceImagePaths: Array.from({ length: 11 }, (_, index) => `ref-${index}.png`),
      }),
    ).rejects.toThrow(/10 reference images/i);
  });

  it('submits OpenAI-compatible custom image requests asynchronously and polls the task result', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-provider-image-async-'));
    const imageBytes = Buffer.from('async-image');
    const requests: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        requests.push({
          url,
          method: init.method ?? 'GET',
          body: init.body ? JSON.parse(String(init.body)) : undefined,
        });
        if (url.endsWith('/images/generations?async=true')) {
          return new Response(JSON.stringify({ id: 'image-task-1' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ status: 'succeeded', data: [{ b64_json: imageBytes.toString('base64') }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    try {
      const config: AppConfig = {
        ...defaultConfig,
        imageProvider: 'custom',
        customImage: {
          ...defaultConfig.customImage,
          apiKey: 'custom-key',
          baseUrl: 'https://image.example',
          model: 'async-image-model',
          asyncMode: true,
          timeoutMs: 1000,
          pollIntervalMs: 1,
        },
      };
      const generate = createConfiguredImageGenerator(config, dir);
      const assets = await generate([scene], [prompt], task);

      expect(await readFile(assets[0].path, 'utf8')).toBe('async-image');
      expect(requests[0]).toMatchObject({
        url: 'https://image.example/v1/images/generations?async=true',
        method: 'POST',
        body: { model: 'async-image-model', prompt: 'visual prompt' },
      });
      expect(requests[1]).toMatchObject({
        url: 'https://image.example/v1/images/generations/image-task-1',
        method: 'GET',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('applies custom image ratio mappings to OpenAI-compatible request bodies', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-provider-image-ratio-map-'));
    const imageBytes = Buffer.from('mapped-ratio-image');
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        requests.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ data: [{ b64_json: imageBytes.toString('base64') }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    try {
      const config: AppConfig = {
        ...defaultConfig,
        imageProvider: 'custom',
        customImage: {
          ...defaultConfig.customImage,
          apiKey: 'custom-key',
          baseUrl: 'https://image.example',
          model: 'mapped-image-model',
          ratioMappingJson: '{"9:16":{"size":"768x1344","aspect_ratio":"9:16"},"1:1":"1024x1024"}',
        },
      };
      const generate = createConfiguredImageGenerator(config, dir);
      await generate([scene], [prompt], task);

      expect(requests[0].url).toBe('https://image.example/v1/images/generations');
      expect(requests[0].body).toMatchObject({
        model: 'mapped-image-model',
        size: '768x1344',
        aspect_ratio: '9:16',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('generates image files from an OpenAI-compatible image endpoint', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-provider-image-'));
    const imageBytes = Buffer.from('real-image');
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        requests.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ data: [{ b64_json: imageBytes.toString('base64') }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    try {
      const config: AppConfig = {
        ...defaultConfig,
        imageProvider: 'gpt_image',
        gptImage: { ...defaultConfig.gptImage, apiKey: 'image-key', baseUrl: 'https://image.example', model: 'gpt-image-2' },
      };
      const generate = createConfiguredImageGenerator(config, dir);
      const assets = await generate([scene], [prompt], task);

      expect(assets).toHaveLength(1);
      expect(await readFile(assets[0].path, 'utf8')).toBe('real-image');
      expect(requests[0].url).toBe('https://image.example/v1/images/generations');
      expect(requests[0].body).toMatchObject({
        model: 'gpt-image-2',
        prompt: 'visual prompt',
        size: '1024x1536',
        quality: 'medium',
        output_format: 'png',
        moderation: 'auto',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('times out OpenAI-compatible image requests instead of hanging forever', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-provider-timeout-'));
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }),
    );

    try {
      const config: AppConfig = {
        ...defaultConfig,
        imageProvider: 'gpt_image',
        gptImage: { ...defaultConfig.gptImage, apiKey: 'image-key', baseUrl: 'https://image.example/v1', model: 'gpt-image-1', timeoutMs: 1 },
      };
      const generate = createConfiguredImageGenerator(config, dir);
      const pending = generate([scene], [prompt], task);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await expect(pending).rejects.toThrow(/timed out/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 10_000);

  it('propagates parent abort reasons instead of reporting them as provider timeouts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-provider-abort-'));
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }),
    );

    try {
      const config: AppConfig = {
        ...defaultConfig,
        imageProvider: 'gpt_image',
        gptImage: { ...defaultConfig.gptImage, apiKey: 'image-key', baseUrl: 'https://image.example/v1', model: 'gpt-image-1', timeoutMs: 180_000 },
      };
      const generate = createConfiguredImageGenerator(config, dir);
      const pending = generate([scene], [prompt], task, controller.signal);
      await new Promise((resolve) => setTimeout(resolve, 0));
      controller.abort('用户取消');

      await expect(pending).rejects.toThrow(/用户取消/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 10_000);

  it('generates narration files from MiniMax T2A hex audio', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-provider-tts-'));
    const audioBytes = Buffer.from('real-audio');
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        requests.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ data: { audio: audioBytes.toString('hex'), status: 2 }, base_resp: { status_code: 0, status_msg: 'success' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    try {
      const config: AppConfig = {
        ...defaultConfig,
        tts: {
          ...defaultConfig.tts,
          provider: 'minimax',
          minimax: { ...defaultConfig.tts.minimax, apiKey: 'tts-key', model: 'speech-02-hd', voiceId: 'voice-a' },
        },
      };
      const synthesize = createConfiguredNarrationSynthesizer(config, dir);
      const assets = await synthesize([scene], task);

      expect(assets).toHaveLength(1);
      expect(await readFile(assets[0].path, 'utf8')).toBe('real-audio');
      expect(requests[0].url).toBe('https://api.minimaxi.com/v1/t2a_v2');
      expect(requests[0].body).toMatchObject({ model: 'speech-02-hd', text: 'A real scene', stream: false });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('generates MiniMax two-host podcast turns with separate voice ids', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-provider-minimax-dual-voice-'));
    const audioBytes = Buffer.from('turn-audio');
    const requests: Array<{ body: Record<string, any> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push({ body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ data: { audio: audioBytes.toString('hex'), status: 2 }, base_resp: { status_code: 0, status_msg: 'success' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    try {
      const config: AppConfig = {
        ...defaultConfig,
        tts: {
          ...defaultConfig.tts,
          provider: 'minimax',
          minimax: { ...defaultConfig.tts.minimax, apiKey: 'tts-key', model: 'speech-02-hd', voiceId: 'default-voice' },
        },
      };
      const synthesize = createConfiguredNarrationSynthesizer(config, dir);
      const assets = await synthesize(
        [{ id: 1, cap: 'Host A: First line.\nHost B: Second line.', descPrompt: '', durationMs: 1200 }],
        { ...task, videoForm: 'two-host-podcast', podcastSpeakerA: 'voice-a', podcastSpeakerB: 'voice-b' },
      );

      expect(requests).toHaveLength(2);
      expect(requests[0].body).toMatchObject({ text: 'First line.', voice_setting: { voice_id: 'voice-a' } });
      expect(requests[1].body).toMatchObject({ text: 'Second line.', voice_setting: { voice_id: 'voice-b' } });
      expect(assets).toMatchObject([
        { sceneId: 1, speaker: 'A', turnIndex: 1, text: 'First line.' },
        { sceneId: 1, speaker: 'B', turnIndex: 2, text: 'Second line.' },
      ]);
      expect(assets[0].path).toContain('001-turn-001-A.mp3');
      expect(assets[1].path).toContain('001-turn-002-B.mp3');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('strips Chinese host labels from two-host podcast TTS text', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-provider-minimax-host-labels-'));
    const audioBytes = Buffer.from('turn-audio');
    const requests: Array<{ body: Record<string, any> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push({ body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ data: { audio: audioBytes.toString('hex'), status: 2 }, base_resp: { status_code: 0, status_msg: 'success' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    try {
      const config: AppConfig = {
        ...defaultConfig,
        tts: {
          ...defaultConfig.tts,
          provider: 'minimax',
          minimax: { ...defaultConfig.tts.minimax, apiKey: 'tts-key', model: 'speech-02-hd', voiceId: 'default-voice' },
        },
      };
      const synthesize = createConfiguredNarrationSynthesizer(config, dir);
      const assets = await synthesize(
        [{ id: 1, cap: '咔仔：你有没有发现，这件事一开始就不简单？\n大壹：对，真正的转折在后面。', descPrompt: '', durationMs: 1200 }],
        { ...task, videoForm: 'two-host-podcast', podcastSpeakers: 'kazai-dayi', podcastSpeakerA: 'voice-a', podcastSpeakerB: 'voice-b' },
      );

      expect(requests).toHaveLength(2);
      expect(requests[0].body).toMatchObject({ text: '你有没有发现，这件事一开始就不简单？', voice_setting: { voice_id: 'voice-a' } });
      expect(requests[1].body).toMatchObject({ text: '对，真正的转折在后面。', voice_setting: { voice_id: 'voice-b' } });
      expect(requests.map((request) => request.body.text)).not.toEqual(expect.arrayContaining([expect.stringContaining('咔仔'), expect.stringContaining('大壹')]));
      expect(assets).toMatchObject([
        { sceneId: 1, speaker: 'A', turnIndex: 1, text: '你有没有发现，这件事一开始就不简单？' },
        { sceneId: 1, speaker: 'B', turnIndex: 2, text: '对，真正的转折在后面。' },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses provider defaults for old two-host podcast tasks without stored voice ids', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-provider-dual-voice-defaults-'));
    const audioBytes = Buffer.from('turn-audio');
    const requests: Array<{ body: Record<string, any> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push({ body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ data: { audio: audioBytes.toString('hex'), status: 2 }, base_resp: { status_code: 0, status_msg: 'success' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    try {
      const config: AppConfig = {
        ...defaultConfig,
        tts: {
          ...defaultConfig.tts,
          provider: 'minimax',
          minimax: { ...defaultConfig.tts.minimax, apiKey: 'tts-key', model: 'speech-02-hd', voiceId: 'default-voice' },
        },
      };
      const synthesize = createConfiguredNarrationSynthesizer(config, dir);
      await synthesize(
        [{ id: 1, cap: 'Host A: First line.\nHost B: Second line.', descPrompt: '', durationMs: 1200 }],
        { ...task, videoForm: 'two-host-podcast', podcastSpeakers: 'kazai-dayi', podcastSpeakerA: '', podcastSpeakerB: '' },
      );

      expect(requests).toHaveLength(2);
      expect(requests[0].body).toMatchObject({ voice_setting: { voice_id: 'male-qn-qingse' } });
      expect(requests[1].body).toMatchObject({ voice_setting: { voice_id: 'female-yujie' } });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('generates image files from Jimeng async visual tasks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-provider-jimeng-'));
    const imageBytes = Buffer.from('jimeng-image');
    const requests: Array<{ url: string; body: Record<string, unknown>; auth: string | null }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        requests.push({
          url,
          body: JSON.parse(String(init.body)),
          auth: new Headers(init.headers).get('Authorization'),
        });
        if (url.includes('CVSync2AsyncSubmitTask')) {
          return new Response(JSON.stringify({ code: 10000, data: { task_id: 'task-jimeng' } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ code: 10000, data: { status: 'done', binary_data_base64: [imageBytes.toString('base64')] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    try {
      const config: AppConfig = {
        ...defaultConfig,
        imageProvider: 'jimeng',
        jimeng: {
          ...defaultConfig.jimeng,
          accessKeyId: 'ak',
          secretAccessKey: 'sk',
          reqKey: 'jimeng_t2i_v40',
          region: 'cn-north-1',
        },
      };
      const generate = createConfiguredImageGenerator(config, dir);
      const assets = await generate([scene], [prompt], task);

      expect(await readFile(assets[0].path, 'utf8')).toBe('jimeng-image');
      expect(requests[0].url).toContain('CVSync2AsyncSubmitTask');
      expect(requests[1].url).toContain('CVSync2AsyncGetResult');
      expect(requests[0].body).toMatchObject({ req_key: 'jimeng_t2i_v40', prompt: 'visual prompt' });
      expect(requests[0].auth).toContain('HMAC-SHA256 Credential=ak/');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('generates narration files from Volcengine TTS base64 audio', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-provider-volc-tts-'));
    const audioBytes = Buffer.from('volc-audio');
    const requests: Array<{ url: string; body: Record<string, unknown>; auth: string | null }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        requests.push({
          url,
          body: JSON.parse(String(init.body)),
          auth: new Headers(init.headers).get('Authorization'),
        });
        return new Response(JSON.stringify({ code: 3000, data: audioBytes.toString('base64') }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    try {
      const config: AppConfig = {
        ...defaultConfig,
        tts: {
          ...defaultConfig.tts,
          provider: 'volcengine',
          volcengine: {
            ...defaultConfig.tts.volcengine,
            appId: 'appid',
            accessKey: 'token',
            speaker: 'voice-volc',
            cluster: 'volcano_tts',
          },
        },
      };
      const synthesize = createConfiguredNarrationSynthesizer(config, dir);
      const assets = await synthesize([scene], task);

      expect(await readFile(assets[0].path, 'utf8')).toBe('volc-audio');
      expect(requests[0].url).toBe('https://openspeech.bytedance.com/api/v1/tts');
      expect(requests[0].auth).toBe('Bearer token');
      expect(requests[0].body).toMatchObject({
        app: { appid: 'appid', token: 'token', cluster: 'volcano_tts' },
        audio: { voice_type: 'voice-volc', encoding: 'mp3' },
        request: { text: 'A real scene', operation: 'query' },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('generates narration files from Volcengine TTS V3 chunked audio', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-provider-volc-v3-tts-'));
    const firstChunk = Buffer.from('volc-');
    const secondChunk = Buffer.from('v3-audio');
    const requests: Array<{ url: string; body: Record<string, any>; headers: Headers }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        requests.push({
          url,
          body: JSON.parse(String(init.body)),
          headers: new Headers(init.headers),
        });
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`${JSON.stringify({ code: 0, message: '', data: firstChunk.toString('base64') })}\n`));
            controller.enqueue(encoder.encode(`${JSON.stringify({ code: 0, message: '', data: secondChunk.toString('base64') })}\n`));
            controller.enqueue(encoder.encode(`${JSON.stringify({ code: 20000000, message: 'ok', data: null })}\n`));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    try {
      const config: AppConfig = {
        ...defaultConfig,
        tts: {
          ...defaultConfig.tts,
          provider: 'volcengine',
          volcengine: {
            ...defaultConfig.tts.volcengine,
            apiKey: 'v3-key',
            resourceId: 'seed-tts-2.0',
            endpoint: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
            speaker: 'zh_female_vv_uranus_bigtts',
          },
        },
      };
      const synthesize = createConfiguredNarrationSynthesizer(config, dir);
      const assets = await synthesize([scene], { ...task, ttsSpeed: 1.15 });

      expect(await readFile(assets[0].path, 'utf8')).toBe('volc-v3-audio');
      expect(requests[0].url).toBe('https://openspeech.bytedance.com/api/v3/tts/unidirectional');
      expect(requests[0].headers.get('X-Api-Key')).toBe('v3-key');
      expect(requests[0].headers.get('X-Api-Resource-Id')).toBe('seed-tts-2.0');
      expect(requests[0].headers.get('X-Api-Request-Id')).toBeTruthy();
      expect(requests[0].body).not.toHaveProperty('namespace');
      expect(requests[0].body).toMatchObject({
        user: { uid: 'task-1' },
        req_params: {
          text: 'A real scene',
          speaker: 'zh_female_vv_uranus_bigtts',
          audio_params: { format: 'mp3', sample_rate: 24000, speech_rate: 15 },
        },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('generates Volcengine V3 two-host podcast turns with separate speakers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-provider-volc-v3-dual-voice-'));
    const audioBytes = Buffer.from('volc-turn-audio');
    const requests: Array<{ body: Record<string, any> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push({ body: JSON.parse(String(init.body)) });
        return new Response(`${JSON.stringify({ code: 0, message: '', data: audioBytes.toString('base64') })}\n${JSON.stringify({ code: 20000000, message: 'ok', data: null })}\n`, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    try {
      const config: AppConfig = {
        ...defaultConfig,
        tts: {
          ...defaultConfig.tts,
          provider: 'volcengine',
          volcengine: {
            ...defaultConfig.tts.volcengine,
            apiKey: 'v3-key',
            resourceId: 'seed-tts-2.0',
            endpoint: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
            speaker: 'default-speaker',
          },
        },
      };
      const synthesize = createConfiguredNarrationSynthesizer(config, dir);
      const assets = await synthesize(
        [{ id: 1, cap: 'Host A: First line.\nHost B: Second line.', descPrompt: '', durationMs: 1200 }],
        { ...task, videoForm: 'two-host-podcast', podcastSpeakerA: 'zh_male_yuanboxiaoshu_moon_bigtts', podcastSpeakerB: 'zh_female_vv_uranus_bigtts' },
      );

      expect(requests).toHaveLength(2);
      expect(requests[0].body.req_params).toMatchObject({ text: 'First line.', speaker: 'zh_male_yuanboxiaoshu_moon_bigtts' });
      expect(requests[1].body.req_params).toMatchObject({ text: 'Second line.', speaker: 'zh_female_vv_uranus_bigtts' });
      expect(assets).toMatchObject([
        { sceneId: 1, speaker: 'A', turnIndex: 1, text: 'First line.' },
        { sceneId: 1, speaker: 'B', turnIndex: 2, text: 'Second line.' },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('generates a single voice lab preview using the selected MiniMax voice', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-provider-voice-lab-'));
    const audioBytes = Buffer.from('voice-lab-audio');
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        requests.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ data: { audio: audioBytes.toString('hex'), status: 2 }, base_resp: { status_code: 0, status_msg: 'success' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    try {
      const config: AppConfig = {
        ...defaultConfig,
        tts: {
          ...defaultConfig.tts,
          provider: 'minimax',
          minimax: { ...defaultConfig.tts.minimax, apiKey: 'tts-key', model: 'speech-02-hd', voiceId: 'male-qn-qingse' },
        },
      };
      const result = await generateConfiguredVoicePreview(config, dir, {
        text: '这是一条试听文案',
        provider: 'minimax',
        voiceId: 'female-yujie',
        speed: 1.3,
      });

      expect(await readFile(result.audioPath, 'utf8')).toBe('voice-lab-audio');
      expect(result).toMatchObject({
        text: '这是一条试听文案',
        provider: 'minimax',
        voiceId: 'female-yujie',
        speed: 1.3,
        status: 'generated',
      });
      expect(requests[0].body).toMatchObject({ text: '这是一条试听文案', voice_setting: { voice_id: 'female-yujie', speed: 1.3 } });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses the task-selected Volcengine voice instead of the configured default voice', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-provider-volc-v3-task-voice-'));
    const audioBytes = Buffer.from('task-voice-audio');
    const requests: Array<{ body: Record<string, any>; headers: Headers }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push({ body: JSON.parse(String(init.body)), headers: new Headers(init.headers) });
        return new Response(`${JSON.stringify({ code: 0, message: '', data: audioBytes.toString('base64') })}\n${JSON.stringify({ code: 20000000, message: 'ok', data: null })}\n`, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    try {
      const config: AppConfig = {
        ...defaultConfig,
        tts: {
          ...defaultConfig.tts,
          provider: 'volcengine',
          volcengine: {
            ...defaultConfig.tts.volcengine,
            apiKey: 'v3-key',
            resourceId: 'seed-tts-2.0',
            endpoint: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
            speaker: 'zh_female_vv_uranus_bigtts',
          },
        },
      };
      const synthesize = createConfiguredNarrationSynthesizer(config, dir);
      await synthesize([scene], { ...task, ttsProvider: 'volcengine', speaker: 'zh_male_yuanboxiaoshu_moon_bigtts' });

      expect(requests[0].body.req_params.speaker).toBe('zh_male_yuanboxiaoshu_moon_bigtts');
      expect(requests[0].headers.get('X-Api-Resource-Id')).toBe('seed-tts-1.0');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('normalizes legacy Volcengine display speakers before V3 requests', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-provider-volc-v3-legacy-speaker-'));
    const audioBytes = Buffer.from('legacy-speaker-audio');
    const requests: Array<{ body: Record<string, any> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push({ body: JSON.parse(String(init.body)) });
        return new Response(`${JSON.stringify({ code: 0, message: '', data: audioBytes.toString('base64') })}\n${JSON.stringify({ code: 20000000, message: 'ok', data: null })}\n`, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    try {
      const config: AppConfig = {
        ...defaultConfig,
        tts: {
          ...defaultConfig.tts,
          provider: 'volcengine',
          volcengine: {
            ...defaultConfig.tts.volcengine,
            apiKey: 'v3-key',
            resourceId: 'seed-tts-2.0',
            endpoint: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
            speaker: '灿博小叔',
          },
        },
      };
      const synthesize = createConfiguredNarrationSynthesizer(config, dir);
      await synthesize([scene], task);

      expect(requests[0].body.req_params.speaker).toBe('zh_male_yuanboxiaoshu_moon_bigtts');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects Ark model keys before calling Volcengine TTS V3', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-provider-volc-v3-ark-key-'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    try {
      const config: AppConfig = {
        ...defaultConfig,
        tts: {
          ...defaultConfig.tts,
          provider: 'volcengine',
          volcengine: {
            ...defaultConfig.tts.volcengine,
            apiKey: 'ark-model-key',
            resourceId: 'seed-tts-2.0',
            endpoint: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
            speaker: 'zh_female_vv_uranus_bigtts',
          },
        },
      };
      const synthesize = createConfiguredNarrationSynthesizer(config, dir);

      await expect(synthesize([scene], task)).rejects.toThrow(/Ark.*TTS/i);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses the enabled image profile after config normalization', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-provider-image-profile-'));
    const imageBytes = Buffer.from('profile-image');
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        requests.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ data: [{ b64_json: imageBytes.toString('base64') }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    try {
      const config = normalizeAppConfig({
        ...defaultConfig,
        imageProfiles: [
          {
            id: 'image-old',
            name: 'Old image',
            provider: 'gpt_image',
            enabled: false,
            gptImage: { ...defaultConfig.gptImage, apiKey: 'old-key', baseUrl: 'https://old-image.example', model: 'old-image-model' },
          },
          {
            id: 'image-active',
            name: 'Active image',
            provider: 'custom',
            enabled: true,
            customImage: { ...defaultConfig.customImage, apiKey: 'active-key', baseUrl: 'https://active-image.example', model: 'active-image-model' },
          },
        ],
        activeImageProfileId: 'image-active',
      } as unknown as AppConfig);
      const generate = createConfiguredImageGenerator(config, dir);
      await generate([scene], [prompt], task);

      expect(requests[0].url).toBe('https://active-image.example/v1/images/generations');
      expect(requests[0].body).toMatchObject({ model: 'active-image-model' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses the enabled TTS profile after config normalization', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-provider-tts-profile-'));
    const audioBytes = Buffer.from('profile-audio');
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        requests.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ data: { audio: audioBytes.toString('hex'), status: 2 }, base_resp: { status_code: 0, status_msg: 'success' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    try {
      const config = normalizeAppConfig({
        ...defaultConfig,
        ttsProfiles: [
          {
            id: 'tts-old',
            name: 'Old TTS',
            provider: 'volcengine',
            enabled: false,
            volcengine: { ...defaultConfig.tts.volcengine, appId: 'old-app', accessKey: 'old-token', speaker: 'old-voice' },
          },
          {
            id: 'tts-active',
            name: 'Active TTS',
            provider: 'minimax',
            enabled: true,
            minimax: { ...defaultConfig.tts.minimax, apiKey: 'active-tts-key', model: 'active-tts-model', voiceId: 'active-voice' },
          },
        ],
        activeTtsProfileId: 'tts-active',
      } as unknown as AppConfig);
      const synthesize = createConfiguredNarrationSynthesizer(config, dir);
      await synthesize([scene], task);

      expect(requests[0].url).toBe('https://api.minimaxi.com/v1/t2a_v2');
      expect(requests[0].body).toMatchObject({ model: 'active-tts-model', voice_setting: { voice_id: 'active-voice' } });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses the task-selected TTS provider and voice id for narration', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-provider-task-tts-'));
    const audioBytes = Buffer.from('task-selected-tts');
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        requests.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ data: { audio: audioBytes.toString('hex'), status: 2 }, base_resp: { status_code: 0, status_msg: 'success' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    try {
      const config = normalizeAppConfig({
        ...defaultConfig,
        tts: {
          ...defaultConfig.tts,
          provider: 'volcengine',
          minimax: { ...defaultConfig.tts.minimax, apiKey: 'tts-key', model: 'speech-02-hd', voiceId: 'male-qn-qingse' },
        },
        ttsProfiles: [
          {
            id: 'tts-volcengine',
            name: 'Volcengine',
            provider: 'volcengine',
            enabled: true,
            volcengine: { ...defaultConfig.tts.volcengine, appId: 'appid', accessKey: 'token', speaker: 'zh_female_vv_uranus_bigtts' },
          },
          {
            id: 'tts-minimax',
            name: 'MiniMax',
            provider: 'minimax',
            enabled: false,
            minimax: { ...defaultConfig.tts.minimax, apiKey: 'tts-key', model: 'speech-02-hd', voiceId: 'male-qn-qingse' },
          },
        ],
      });
      const synthesize = createConfiguredNarrationSynthesizer(config, dir);
      await synthesize([scene], { ...task, ttsProvider: 'minimax', speaker: 'female-yujie' });

      expect(requests[0].url).toBe('https://api.minimaxi.com/v1/t2a_v2');
      expect(requests[0].body).toMatchObject({ model: 'speech-02-hd', voice_setting: { voice_id: 'female-yujie' } });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
