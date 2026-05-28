import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateImageLabRecord } from '@shared/image-lab';
import { defaultConfig } from '@shared/config';
import type { AppConfig } from '@shared/types';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('image lab generation', () => {
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
      });

      expect(record.status).toBe('generated');
      expect(record.provider).toBe('gpt_image');
      expect(record.imagePath).toMatch(/provider-images/);
      expect(await readFile(record.imagePath, 'utf8')).toBe('lab-image');
      expect(requests[0].url).toBe('https://image.example/v1/images/generations');
      expect(requests[0].body).toMatchObject({
        model: 'gpt-image-2',
        prompt: expect.stringContaining('Tang palace portrait'),
        size: '1024x1024',
        quality: 'medium',
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
});
