import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfiguredImageGenerator, createConfiguredNarrationSynthesizer } from '@shared/media-providers';
import { defaultConfig } from '@shared/config';
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
});
