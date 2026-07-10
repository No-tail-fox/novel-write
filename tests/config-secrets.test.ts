import { describe, expect, it } from 'vitest';
import { defaultConfig } from '@shared/config';
import type { AppConfig, ImageProviderProfile, TtsProviderProfile } from '@shared/types';

async function loadConfigSecrets() {
  return import('../src/shared/config-secrets').catch(() => null);
}

function configWithUniqueSecrets(): { config: AppConfig; sentinels: string[] } {
  const config = structuredClone(defaultConfig);
  const sentinels: string[] = [];
  const secret = (label: string) => {
    const value = `sentinel-${String(sentinels.length + 1).padStart(2, '0')}-${label}`;
    sentinels.push(value);
    return value;
  };

  config.llm.apiKey = secret('llm-active-compat');
  config.llmProfiles = [
    { ...config.llm, id: 'llm-active', enabled: true, apiKey: secret('llm-profile-active') },
    { ...config.llm, id: 'llm-inactive', enabled: false, apiKey: secret('llm-profile-inactive') },
  ];
  config.activeLlmProfileId = 'llm-active';

  config.image.apiKey = secret('image-legacy');
  config.gptImage.apiKey = secret('image-active-gpt');
  config.jimeng.sessionId = secret('image-active-jimeng-session');
  config.jimeng.accessKeyId = secret('image-active-jimeng-access');
  config.jimeng.secretAccessKey = secret('image-active-jimeng-secret');
  config.customImage.apiKey = secret('image-active-custom');

  const imageProfile = (id: string, enabled: boolean): ImageProviderProfile => ({
    id,
    name: id,
    enabled,
    provider: enabled ? 'gpt_image' : 'jimeng',
    gptImage: { ...config.gptImage, apiKey: secret(`${id}-gpt`) },
    jimeng: {
      ...config.jimeng,
      sessionId: secret(`${id}-jimeng-session`),
      accessKeyId: secret(`${id}-jimeng-access`),
      secretAccessKey: secret(`${id}-jimeng-secret`),
    },
    customImage: { ...config.customImage, apiKey: secret(`${id}-custom`) },
  });
  config.imageProfiles = [imageProfile('image-active', true), imageProfile('image-inactive', false)];
  config.activeImageProfileId = 'image-active';

  config.tts.accessKey = secret('tts-active-legacy');
  config.tts.volcengine.apiKey = secret('tts-active-volc-api');
  config.tts.volcengine.accessKeyId = secret('tts-active-volc-access-id');
  config.tts.volcengine.secretAccessKey = secret('tts-active-volc-secret');
  config.tts.volcengine.accessKey = secret('tts-active-volc-access');
  config.tts.minimax.apiKey = secret('tts-active-minimax');

  const ttsProfile = (id: string, enabled: boolean): TtsProviderProfile => ({
    id,
    name: id,
    enabled,
    provider: enabled ? 'volcengine' : 'minimax',
    appId: `app-${id}`,
    accessKey: secret(`${id}-legacy-access`),
    speaker: `speaker-${id}`,
    volcengine: {
      ...config.tts.volcengine,
      apiKey: secret(`${id}-volc-api`),
      accessKeyId: secret(`${id}-volc-access-id`),
      secretAccessKey: secret(`${id}-volc-secret`),
      accessKey: secret(`${id}-volc-access`),
    },
    minimax: { ...config.tts.minimax, apiKey: secret(`${id}-minimax`) },
  });
  config.ttsProfiles = [ttsProfile('tts-active', true), ttsProfile('tts-inactive', false)];
  config.activeTtsProfileId = 'tts-active';

  config.speechToText.apiKey = secret('speech-to-text');
  config.ima.apiKey = secret('ima');
  config.viral.vision.apiKey = secret('viral-vision');

  return { config, sentinels };
}

describe('config secret inventory', () => {
  it('extracts, strips, and reapplies every top-level and profile secret without loss', async () => {
    const module = await loadConfigSecrets();
    expect(module).not.toBeNull();
    if (!module) return;
    const { config, sentinels } = configWithUniqueSecrets();

    const extracted = module.extractConfigSecrets(config);

    expect(Object.values(extracted).sort()).toEqual([...sentinels].sort());
    expect(extracted['llm/llm-active/apiKey']).toBe('sentinel-02-llm-profile-active');
    expect(extracted['image/image-inactive/jimeng/sessionId']).toContain('image-inactive-jimeng-session');
    expect(extracted['tts/tts-inactive/minimax/apiKey']).toContain('tts-inactive-minimax');
    expect(extracted['speechToText/apiKey']).toContain('speech-to-text');
    expect(extracted['ima/apiKey']).toContain('ima');
    expect(extracted['viralVision/apiKey']).toContain('viral-vision');

    const stripped = module.stripConfigSecrets(config);
    expect(JSON.stringify(stripped)).not.toContain('sentinel-');
    expect(stripped.jimeng.reqKey).toBe(config.jimeng.reqKey);
    expect(stripped.tts.volcengine.appId).toBe(config.tts.volcengine.appId);
    expect(module.applyConfigSecrets(stripped, extracted)).toEqual(config);

    const status = module.secretStatus(extracted);
    expect(status['llm/llm-active/apiKey']).toBe(true);
    expect(status['image/image-inactive/jimeng/sessionId']).toBe(true);
    expect(status['tts/tts-inactive/minimax/apiKey']).toBe(true);
    expect(module.collectSecretRedactionTokens(extracted).sort()).toEqual([...sentinels].sort());
  });

  it('uses stable profile ids instead of array positions', async () => {
    const module = await loadConfigSecrets();
    expect(module).not.toBeNull();
    if (!module) return;
    const { config } = configWithUniqueSecrets();
    const before = module.extractConfigSecrets(config);
    const reordered: AppConfig = {
      ...config,
      llmProfiles: [...config.llmProfiles].reverse(),
      imageProfiles: [...config.imageProfiles].reverse(),
      ttsProfiles: [...config.ttsProfiles].reverse(),
    };

    expect(module.extractConfigSecrets(reordered)).toEqual(before);
  });

  it('rejects profiles that cannot be assigned a stable secret id', async () => {
    const module = await loadConfigSecrets();
    expect(module).not.toBeNull();
    if (!module) return;
    const config = structuredClone(defaultConfig);
    config.llmProfiles = [{ ...config.llm, id: undefined }];

    expect(() => module.extractConfigSecrets(config)).toThrow(/stable profile id/i);
  });
});
