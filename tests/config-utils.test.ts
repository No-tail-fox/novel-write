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

  it('normalizes uploaded BGM library defaults without keeping an empty builtin track', () => {
    const uploaded = {
      id: 'bgm-uploaded',
      title: 'Uploaded Theme',
      path: 'I:/music/theme.mp3',
      durationMs: 0,
      volume: 0.25,
    };

    const normalized = normalizeAppConfig({
      ...defaultConfig,
      jianying: {
        draftPath: 'I:/drafts',
        bgmLibrary: [uploaded],
      },
    } as unknown as typeof defaultConfig);

    expect(normalized.jianying.bgmLibrary).toEqual([uploaded]);
    expect(normalized.jianying.defaultBgmId).toBe('bgm-uploaded');
    expect(normalized.jianying.bgmLibrary.some((item) => item.id === '__builtin__')).toBe(false);
  });

  it('falls back from a stale default BGM id to the first readable uploaded item shape', () => {
    const normalized = normalizeAppConfig({
      ...defaultConfig,
      jianying: {
        ...defaultConfig.jianying,
        defaultBgmId: 'missing',
        bgmLibrary: [
          { id: 'empty', title: 'Empty Path', path: '', durationMs: 0, volume: 0.25 },
          { id: 'real', title: 'Real BGM', path: 'I:/music/real.wav', durationMs: 0, volume: 0.25 },
        ],
      },
    });

    expect(normalized.jianying.defaultBgmId).toBe('real');
  });

  it('marks filled LLM credentials as configured for settings status', () => {
    const config = {
      ...defaultConfig,
      llm: {
        ...defaultConfig.llm,
        provider: 'custom' as const,
        baseUrl: 'https://glm-relayapi.top',
        apiKey: 'sk-test',
        model: 'glm-5.1',
      },
    };

    const result = validateConfigTarget('llm', config);

    expect(result.status).toBe('pass');
    expect(configTargetStatus('llm', config)).toBe('pass');
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

  it('normalizes image profiles and mirrors the enabled profile to legacy image fields', () => {
    const config = normalizeAppConfig({
      ...defaultConfig,
      imageProvider: 'gpt_image',
      imageProfiles: [
        {
          id: 'image-official',
          name: 'Official image',
          provider: 'gpt_image',
          enabled: false,
          gptImage: { ...defaultConfig.gptImage, apiKey: 'old-image-key', baseUrl: 'https://old-image.example', model: 'old-image-model' },
        },
        {
          id: 'image-custom',
          name: 'Custom image',
          provider: 'custom',
          enabled: true,
          customImage: { ...defaultConfig.customImage, apiKey: 'custom-image-key', baseUrl: 'https://custom-image.example', model: 'custom-image-model' },
        },
      ],
      activeImageProfileId: 'image-custom',
    } as unknown as typeof defaultConfig);

    expect(config.activeImageProfileId).toBe('image-custom');
    expect(config.imageProvider).toBe('custom');
    expect(config.customImage).toMatchObject({ apiKey: 'custom-image-key', baseUrl: 'https://custom-image.example', model: 'custom-image-model' });
    expect(config.imageProfiles.filter((profile) => profile.enabled)).toHaveLength(1);
    expect(config.imageProfiles.find((profile) => profile.enabled)?.id).toBe('image-custom');
  });

  it('preserves explicit GPT Image profile fields when the profile id matches the legacy fallback id', () => {
    const config = normalizeAppConfig({
      ...defaultConfig,
      imageProvider: 'gpt_image',
      imageProfiles: [
        {
          id: 'default-image',
          name: 'Edited GPT Image',
          provider: 'gpt_image',
          enabled: true,
          gptImage: {
            ...defaultConfig.gptImage,
            apiKey: 'edited-image-key',
            baseUrl: 'https://edited-image.example',
            model: 'edited-image-model',
          },
        },
      ],
      activeImageProfileId: 'default-image',
    });

    expect(config.activeImageProfileId).toBe('default-image');
    expect(config.gptImage).toMatchObject({
      apiKey: 'edited-image-key',
      baseUrl: 'https://edited-image.example',
      model: 'edited-image-model',
    });
    expect(config.imageProfiles.find((profile) => profile.id === 'default-image')?.gptImage).toMatchObject({
      apiKey: 'edited-image-key',
      baseUrl: 'https://edited-image.example',
      model: 'edited-image-model',
    });
  });

  it('preserves same-provider image profile credentials when activating by activeImageProfileId', () => {
    const config = normalizeAppConfig({
      ...defaultConfig,
      imageProvider: 'gpt_image',
      imageProfiles: [
        {
          id: 'image-old',
          name: 'Old GPT Image',
          provider: 'gpt_image',
          enabled: false,
          gptImage: { ...defaultConfig.gptImage, apiKey: 'old-key', baseUrl: 'https://old-image.example', model: 'old-model' },
        },
        {
          id: 'image-active',
          name: 'Active GPT Image',
          provider: 'gpt_image',
          enabled: true,
          gptImage: { ...defaultConfig.gptImage, apiKey: 'active-key', baseUrl: 'https://active-image.example', model: 'active-model' },
        },
      ],
      activeImageProfileId: 'image-active',
    });

    expect(config.activeImageProfileId).toBe('image-active');
    expect(config.gptImage).toMatchObject({
      apiKey: 'active-key',
      baseUrl: 'https://active-image.example',
      model: 'active-model',
    });
    expect(config.imageProfiles.find((profile) => profile.id === 'image-active')?.gptImage).toMatchObject({
      apiKey: 'active-key',
      baseUrl: 'https://active-image.example',
      model: 'active-model',
    });
  });

  it('normalizes TTS profiles and mirrors the enabled profile to legacy TTS fields', () => {
    const config = normalizeAppConfig({
      ...defaultConfig,
      ttsProfiles: [
        {
          id: 'tts-volc',
          name: 'Volcengine voice',
          provider: 'volcengine',
          enabled: false,
          volcengine: { ...defaultConfig.tts.volcengine, appId: 'old-app', accessKey: 'old-token', speaker: 'old-voice' },
        },
        {
          id: 'tts-minimax',
          name: 'MiniMax voice',
          provider: 'minimax',
          enabled: true,
          minimax: { ...defaultConfig.tts.minimax, apiKey: 'mini-key', model: 'speech-02-hd', voiceId: 'mini-voice' },
        },
      ],
      activeTtsProfileId: 'tts-minimax',
    } as unknown as typeof defaultConfig);

    expect(config.activeTtsProfileId).toBe('tts-minimax');
    expect(config.tts.provider).toBe('minimax');
    expect(config.tts.minimax).toMatchObject({ apiKey: 'mini-key', model: 'speech-02-hd', voiceId: 'mini-voice' });
    expect(config.ttsProfiles.filter((profile) => profile.enabled)).toHaveLength(1);
    expect(config.ttsProfiles.find((profile) => profile.enabled)?.id).toBe('tts-minimax');
  });

  it('normalizes Volcengine TTS V3 API key settings from the enabled profile', () => {
    const config = normalizeAppConfig({
      ...defaultConfig,
      ttsProfiles: [
        {
          id: 'tts-v3',
          name: 'Volcengine V3',
          provider: 'volcengine',
          enabled: true,
          volcengine: {
            ...defaultConfig.tts.volcengine,
            apiKey: 'v3-key',
            resourceId: 'seed-tts-2.0',
            endpoint: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
            speaker: 'zh_female_vv_uranus_bigtts',
          },
        },
      ],
      activeTtsProfileId: 'tts-v3',
    } as unknown as typeof defaultConfig);

    expect(config.tts.provider).toBe('volcengine');
    expect(config.tts.volcengine).toMatchObject({
      apiKey: 'v3-key',
      resourceId: 'seed-tts-2.0',
      endpoint: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
      speaker: 'zh_female_vv_uranus_bigtts',
    });
    expect(config.ttsProfiles.find((profile) => profile.enabled)?.id).toBe('tts-v3');
  });

  it('validates Volcengine TTS V3 API key settings without legacy credentials', () => {
    const config = normalizeAppConfig({
      ...defaultConfig,
      ttsProfiles: [
        {
          id: 'tts-v3-validation',
          name: 'Volcengine V3',
          provider: 'volcengine',
          enabled: true,
          volcengine: {
            ...defaultConfig.tts.volcengine,
            apiKey: 'v3-key',
            appId: '',
            accessKey: '',
            resourceId: 'seed-tts-2.0',
            speaker: 'zh_female_vv_uranus_bigtts',
          },
        },
      ],
      activeTtsProfileId: 'tts-v3-validation',
    });

    const result = validateConfigTarget('tts', config);

    expect(result.status).toBe('pass');
    expect(result.endpoint).toBe('https://openspeech.bytedance.com/api/v3/tts/unidirectional');
    expect(result.detail).toContain('seed-tts-2.0');
  });

  it('normalizes legacy Volcengine display speakers to a V3 voice type', () => {
    const config = normalizeAppConfig({
      ...defaultConfig,
      ttsProfiles: [
        {
          id: 'tts-v3-legacy-speaker',
          name: 'Volcengine V3',
          provider: 'volcengine',
          enabled: true,
          volcengine: {
            ...defaultConfig.tts.volcengine,
            apiKey: 'v3-key',
            resourceId: 'seed-tts-2.0',
            speaker: '灿博小叔',
          },
        },
      ],
      activeTtsProfileId: 'tts-v3-legacy-speaker',
    });

    expect(config.tts.volcengine.speaker).toBe('zh_female_vv_uranus_bigtts');
    expect(config.tts.speaker).toBe('zh_female_vv_uranus_bigtts');
  });

  it('rejects Ark model keys in Volcengine TTS V3 settings', () => {
    const config = normalizeAppConfig({
      ...defaultConfig,
      ttsProfiles: [
        {
          id: 'tts-v3-ark-key',
          name: 'Volcengine V3',
          provider: 'volcengine',
          enabled: true,
          volcengine: {
            ...defaultConfig.tts.volcengine,
            apiKey: 'ark-model-key',
            resourceId: 'seed-tts-2.0',
            speaker: 'zh_female_vv_uranus_bigtts',
          },
        },
      ],
      activeTtsProfileId: 'tts-v3-ark-key',
    });

    const result = validateConfigTarget('tts', config);

    expect(result.status).toBe('fail');
    expect(result.detail).toContain('Ark');
    expect(result.detail).toContain('TTS');
  });
});
