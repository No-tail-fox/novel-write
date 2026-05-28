import { describe, expect, it } from 'vitest';
import { defaultConfig } from '@shared/config';
import { normalizeAppConfig } from '@shared/config-utils';
import {
  addImageProfile,
  buildConfigForSelectedProfileTest,
  enableImageProfile,
  saveImageProfile,
  saveLlmProfile,
  saveTtsProfile,
} from '@shared/provider-profile-utils';
import type { AppConfig, ImageProviderProfile, TtsProviderProfile } from '@shared/types';

function gptImageProfile(id: string, enabled: boolean, apiKey: string, model: string): ImageProviderProfile {
  return {
    id,
    name: id,
    provider: 'gpt_image',
    enabled,
    gptImage: {
      ...defaultConfig.gptImage,
      apiKey,
      baseUrl: `https://${id}.example`,
      model,
    },
  };
}

function ttsVolcengineProfile(id: string, enabled: boolean, apiKey: string, speaker: string): TtsProviderProfile {
  return {
    id,
    name: id,
    provider: 'volcengine',
    enabled,
    volcengine: {
      ...defaultConfig.tts.volcengine,
      apiKey,
      resourceId: 'seed-tts-2.0',
      endpoint: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
      speaker,
    },
  };
}

describe('provider profile utilities', () => {
  it('adds image profiles as inactive drafts without changing the active image profile', () => {
    const config = normalizeAppConfig({
      ...defaultConfig,
      imageProfiles: [gptImageProfile('image-active', true, 'active-key', 'active-model')],
      activeImageProfileId: 'image-active',
    });

    const next = addImageProfile(config);

    expect(next.activeImageProfileId).toBe('image-active');
    expect(next.imageProfiles[0]).toMatchObject({ provider: 'gpt_image', enabled: false });
    expect(next.imageProfiles.find((profile) => profile.id === 'image-active')?.enabled).toBe(true);
  });

  it('saves inactive image profile edits without enabling them, then builds a temporary selected-profile test config', () => {
    const config = normalizeAppConfig({
      ...defaultConfig,
      imageProfiles: [
        gptImageProfile('image-active', true, 'active-key', 'active-model'),
        gptImageProfile('image-draft', false, 'old-draft-key', 'old-draft-model'),
      ],
      activeImageProfileId: 'image-active',
    });

    const saved = saveImageProfile(config, gptImageProfile('image-draft', false, 'draft-key', 'draft-model'));
    const testConfig = buildConfigForSelectedProfileTest(saved, 'image', { image: 'image-draft' });

    expect(saved.activeImageProfileId).toBe('image-active');
    expect(saved.gptImage).toMatchObject({ apiKey: 'active-key', model: 'active-model' });
    expect(testConfig.activeImageProfileId).toBe('image-draft');
    expect(testConfig.gptImage).toMatchObject({ apiKey: 'draft-key', model: 'draft-model' });
  });

  it('only changes the active image profile when enableImageProfile is called', () => {
    const config = normalizeAppConfig({
      ...defaultConfig,
      imageProfiles: [
        gptImageProfile('image-active', true, 'active-key', 'active-model'),
        gptImageProfile('image-draft', false, 'draft-key', 'draft-model'),
      ],
      activeImageProfileId: 'image-active',
    });

    const enabled = enableImageProfile(config, 'image-draft');

    expect(enabled.activeImageProfileId).toBe('image-draft');
    expect(enabled.gptImage).toMatchObject({ apiKey: 'draft-key', model: 'draft-model' });
    expect(enabled.imageProfiles.find((profile) => profile.id === 'image-active')?.enabled).toBe(false);
  });

  it('builds a temporary selected TTS V3 profile test config without changing saved active TTS profile', () => {
    const config = normalizeAppConfig({
      ...defaultConfig,
      ttsProfiles: [
        ttsVolcengineProfile('tts-active', true, 'active-v3-key', 'zh_male_m191_uranus_bigtts'),
        ttsVolcengineProfile('tts-draft', false, 'draft-v3-key', 'zh_female_vv_uranus_bigtts'),
      ],
      activeTtsProfileId: 'tts-active',
    });

    const saved = saveTtsProfile(config, ttsVolcengineProfile('tts-draft', false, 'draft-v3-key-updated', 'zh_female_vv_uranus_bigtts'));
    const testConfig = buildConfigForSelectedProfileTest(saved, 'tts', { tts: 'tts-draft' });

    expect(saved.activeTtsProfileId).toBe('tts-active');
    expect(saved.tts.volcengine.apiKey).toBe('active-v3-key');
    expect(testConfig.activeTtsProfileId).toBe('tts-draft');
    expect(testConfig.tts.volcengine).toMatchObject({
      apiKey: 'draft-v3-key-updated',
      resourceId: 'seed-tts-2.0',
      endpoint: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
      speaker: 'zh_female_vv_uranus_bigtts',
    });
  });

  it('builds a temporary selected LLM profile test config without enabling it in the saved config', () => {
    const config: AppConfig = normalizeAppConfig({
      ...defaultConfig,
      llm: { ...defaultConfig.llm, id: 'llm-active', enabled: true, apiKey: 'active-key', model: 'active-model' },
      llmProfiles: [
        { ...defaultConfig.llm, id: 'llm-active', name: 'Active LLM', enabled: true, apiKey: 'active-key', model: 'active-model' },
        { ...defaultConfig.llm, id: 'llm-draft', name: 'Draft LLM', enabled: false, apiKey: 'old-key', model: 'old-model' },
      ],
      activeLlmProfileId: 'llm-active',
    });

    const saved = saveLlmProfile(config, { ...defaultConfig.llm, id: 'llm-draft', name: 'Draft LLM', enabled: false, apiKey: 'draft-key', model: 'draft-model' });
    const testConfig = buildConfigForSelectedProfileTest(saved, 'llm', { llm: 'llm-draft' });

    expect(saved.activeLlmProfileId).toBe('llm-active');
    expect(saved.llm).toMatchObject({ apiKey: 'active-key', model: 'active-model' });
    expect(testConfig.activeLlmProfileId).toBe('llm-draft');
    expect(testConfig.llm).toMatchObject({ apiKey: 'draft-key', model: 'draft-model' });
  });
});
