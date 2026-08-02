import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateImageLabRecord, selectImageLabProviderConfig } from '@shared/image-lab';
import { defaultConfig } from '@shared/config';
import type { AppConfig } from '@shared/types';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('image lab generation', () => {
  it('switches a page-level provider request onto the matching configured image profile', () => {
    const config: AppConfig = {
      ...defaultConfig,
      imageProfiles: [
        { ...defaultConfig.imageProfiles[0], id: 'gpt-active', enabled: true },
        {
          id: 'custom-lab',
          name: '内网绘图',
          enabled: false,
          provider: 'custom',
          customImage: {
            ...defaultConfig.customImage,
            displayName: '内网绘图',
            baseUrl: 'https://custom.example',
            apiKey: 'custom-key',
            model: 'custom-model',
          },
        },
      ],
      activeImageProfileId: 'gpt-active',
    };

    const selected = selectImageLabProviderConfig(config, 'custom');

    expect(selected.imageProvider).toBe('custom');
    expect(selected.activeImageProfileId).toBe('custom-lab');
    expect(selected.customImage).toMatchObject({
      baseUrl: 'https://custom.example',
      apiKey: 'custom-key',
      model: 'custom-model',
    });
  });

  it('calls the configured image provider and returns a generated record with the real file path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-image-lab-'));
    const imageBytes = Buffer.from('lab-image');
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

      const record = await generateImageLabRecord(config, dir, {
        prompt: 'Tang palace portrait',
        ratio: '1:1',
        style: 'photo-real',
        provider: 'gpt_image',
        resolution: '2K',
        quality: 'high',
      });

      expect(record.status).toBe('generated');
      expect(record.provider).toBe('gpt_image');
      expect(record.quality).toBe('high');
      expect(record.imagePath).toMatch(/provider-images/);
      expect(await readFile(record.imagePath, 'utf8')).toBe('lab-image');
      expect(requests[0].url).toBe('https://image.example/v1/images/generations');
      expect(requests[0].body).toMatchObject({
        model: 'gpt-image-2',
        prompt: expect.stringContaining('Tang palace portrait'),
        size: '1024x1024',
        quality: 'high',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('records provider failures as failed records instead of mock records', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-image-lab-failure-'));

    try {
      const config: AppConfig = {
        ...defaultConfig,
        imageProvider: 'gpt_image',
        gptImage: { ...defaultConfig.gptImage, apiKey: '', baseUrl: 'https://image.example', model: 'gpt-image-2' },
      };

      const record = await generateImageLabRecord(config, dir, {
        prompt: 'Tang palace portrait',
        ratio: '9:16',
        style: 'photo-real',
        provider: 'gpt_image',
        resolution: '2K',
      });

      expect(record.status).toBe('failed');
      expect(record.imagePath).toBe('');
      expect(record.errorMessage).toMatch(/api key/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('builds a smart podcast cover prompt for image lab requests', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-image-lab-smart-'));
    const imageBytes = Buffer.from('smart-cover');
    const requests: Array<{ body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push({ body: JSON.parse(String(init.body)) });
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

      const record = await generateImageLabRecord(config, dir, {
        prompt: '两位主播聊武则天回宫',
        ratio: '1:1',
        style: 'photo-real',
        smartMode: 'podcast-cover',
      });

      expect(record.status).toBe('generated');
      expect(record.smartMode).toBe('podcast-cover');
      expect(requests[0].body.prompt).toContain('播客封面');
      expect(requests[0].body.prompt).toContain('两位主播');
      expect(requests[0].body.prompt).toContain('标题留白');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses the OpenAI-compatible image edits endpoint for reference edit smart requests', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-image-lab-reference-edit-'));
    const first = join(dir, 'first.png');
    const second = join(dir, 'second.webp');
    await writeFile(first, 'first-reference');
    await writeFile(second, 'second-reference');
    const imageBytes = Buffer.from('edited-image');
    const requests: Array<{ url: string; method: string; body: BodyInit | null | undefined }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        requests.push({ url, method: init.method ?? 'GET', body: init.body });
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

      const record = await generateImageLabRecord(config, dir, {
        prompt: 'Keep the host identity and replace the studio background',
        ratio: '16:9',
        style: 'photo-real',
        smartMode: 'reference-edit',
        quality: 'low',
        referenceImagePaths: [first, second],
      });

      expect(record.status).toBe('generated');
      expect(await readFile(record.imagePath, 'utf8')).toBe('edited-image');
      expect(requests[0].url).toBe('https://image.example/v1/images/edits');
      expect(requests[0].method).toBe('POST');
      expect(requests[0].body).toBeInstanceOf(FormData);
      const form = requests[0].body as FormData;
      expect(form.get('model')).toBe('gpt-image-2');
      expect(form.get('prompt')).toContain('Keep the host identity');
      expect(form.get('size')).toBe('1536x1024');
      expect(form.get('quality')).toBe('low');
      expect(form.getAll('image')).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses reference images for smart image requests when references are provided', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-image-lab-smart-reference-'));
    const first = join(dir, 'first.png');
    const second = join(dir, 'second.webp');
    await writeFile(first, 'first-reference');
    await writeFile(second, 'second-reference');
    const imageBytes = Buffer.from('smart-reference-image');
    const requests: Array<{ url: string; method: string; body: BodyInit | null | undefined }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        requests.push({ url, method: init.method ?? 'GET', body: init.body });
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

      const record = await generateImageLabRecord(config, dir, {
        prompt: '根据参考图生成同一角色的播客封面',
        ratio: '9:16',
        style: 'photo-real',
        smartMode: 'podcast-cover',
        referenceImagePaths: [first, second],
      });

      expect(record.status).toBe('generated');
      expect(record.referenceImagePaths).toEqual([first, second]);
      expect(requests[0].url).toBe('https://image.example/v1/images/edits');
      expect(requests[0].method).toBe('POST');
      expect(requests[0].body).toBeInstanceOf(FormData);
      const form = requests[0].body as FormData;
      expect(form.get('prompt')).toContain('根据参考图生成同一角色的播客封面');
      expect(form.get('prompt')).toContain('参考图');
      expect(form.getAll('image')).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('fails reference edit smart requests without a reference image', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-image-lab-reference-empty-'));

    try {
      const record = await generateImageLabRecord(defaultConfig, dir, {
        prompt: '换背景',
        ratio: '1:1',
        style: 'photo-real',
        smartMode: 'reference-edit',
        referenceImagePaths: [],
      });

      expect(record.status).toBe('failed');
      expect(record.errorMessage).toMatch(/reference image/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('accepts up to 10 reference images and fails when the limit is exceeded', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-image-lab-reference-too-many-'));
    const references = await Promise.all(Array.from({ length: 11 }, async (_, index) => {
      const path = join(dir, `ref-${index}.png`);
      await writeFile(path, `reference-${index}`);
      return path;
    }));
    const imageBytes = Buffer.from('ten-reference-image');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: imageBytes.toString('base64') }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })),
    );

    try {
      const config: AppConfig = {
        ...defaultConfig,
        imageProvider: 'gpt_image',
        gptImage: { ...defaultConfig.gptImage, apiKey: 'image-key', baseUrl: 'https://image.example', model: 'gpt-image-2' },
      };
      const accepted = await generateImageLabRecord(config, dir, {
        prompt: '换背景',
        ratio: '1:1',
        style: 'photo-real',
        smartMode: 'podcast-cover',
        referenceImagePaths: references.slice(0, 10),
      });

      expect(accepted.status).toBe('generated');

      const record = await generateImageLabRecord(config, dir, {
        prompt: '换背景',
        ratio: '1:1',
        style: 'photo-real',
        smartMode: 'podcast-cover',
        referenceImagePaths: references,
      });

      expect(record.status).toBe('failed');
      expect(record.errorMessage).toMatch(/10 reference images/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
