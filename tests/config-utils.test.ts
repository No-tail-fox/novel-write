import { describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '@shared/config';
import { configTargetStatus, normalizeAppConfig, testConfigTarget, validateConfigTarget } from '@shared/config-utils';

describe('config validation utilities', () => {
  it('validates Jianying draft paths through the injected filesystem check', () => {
    const config = {
      ...defaultConfig,
      jianying: {
        ...defaultConfig.jianying,
        draftPath: 'I:/missing-draft-root-for-test',
      },
    };

    const result = validateConfigTarget('jianying', config, { pathExists: () => false });

    expect(result.status).toBe('fail');
    expect(result.endpoint).toBe('I:/missing-draft-root-for-test');
    expect(configTargetStatus('jianying', config, { pathExists: () => true })).toBe('pass');
  });

  it('runs a real OpenAI-compatible image probe with normalized base URL and generation params', async () => {
    const requests: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify({ id: 'img-test', data: [{ b64_json: 'abc123' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const config = {
      ...defaultConfig,
      imageProvider: 'gpt_image' as const,
      gptImage: {
        ...defaultConfig.gptImage,
        baseUrl: 'https://input.codes',
        apiKey: 'image-key',
        model: 'gpt-image-2',
      },
    };

    const result = await testConfigTarget('image', config, { fetchImpl });

    expect(result.status).toBe('pass');
    expect(result.endpoint).toBe('https://input.codes/v1/images/generations');
    expect(requests).toHaveLength(1);
    expect(requests[0].headers.get('Authorization')).toBe('Bearer image-key');
    expect(requests[0].body).toMatchObject({
      model: 'gpt-image-2',
      size: '1024x1536',
      quality: 'medium',
      output_format: 'png',
      moderation: 'auto',
    });
  });

  it('normalizes LLM profiles with stable ids and keeps the active config in the profile list', () => {
    const config = normalizeAppConfig({
      ...defaultConfig,
      llm: { ...defaultConfig.llm, provider: 'custom', baseUrl: 'https://active.example', apiKey: 'active-key', model: 'active-model' },
      llmProfiles: [
        { ...defaultConfig.llm, id: 'custom-a', name: 'Custom A', provider: 'custom', baseUrl: 'https://custom.example', apiKey: 'k', model: 'custom-model' },
      ],
    });

    expect(config.activeLlmProfileId).toBeTruthy();
    expect(config.llmProfiles[0]).toMatchObject({ id: 'custom-a', name: 'Custom A' });
    expect(config.llmProfiles.some((profile) => profile.baseUrl === 'https://active.example' && profile.model === 'active-model')).toBe(true);
  });
});
