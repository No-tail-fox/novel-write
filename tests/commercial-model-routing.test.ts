import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyCommercialByokProfiles, assertLegacyModelSource, legacyPaidCapabilitiesFor } from '../electron/commercial-model-routing';
import { defaultConfig } from '../src/shared/config';
import type { AppConfig } from '../src/shared/types';
import { capabilities, type CommercialModelProfile, type CommercialProfiles, type ModelCapability } from '../src/shared/commercial-contract';
import { getMusicProfile, getVideoProfile } from '../src/shared/provider-profile-utils';
import { createTaskRuntimeProviders } from '../src/shared/task-runtime-providers';
import { createConfiguredImageGenerator, createConfiguredNarrationSynthesizer } from '../src/shared/media-providers';
import { selectImageLabProviderConfig } from '../src/shared/image-lab';
import type { Task } from '../src/shared/types';

afterEach(() => vi.unstubAllGlobals());

function frozen<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}

function configFixture(): AppConfig {
  const config = structuredClone(defaultConfig);
  config.llm.apiKey = 'test-primary-text';
  config.llmProfiles[0].apiKey = 'test-primary-text';
  config.llmProfiles.push({ ...config.llm, id: 'alternate-text', name: 'Alternate text', enabled: false, apiKey: 'test-alternate-text', model: 'text-alternate' });
  config.gptImage.apiKey = 'test-primary-image';
  config.imageProfiles[0].gptImage!.apiKey = 'test-primary-image';
  config.imageProfiles.push({ id: 'alternate-image', name: 'Alternate image', enabled: false, provider: 'gpt_image', gptImage: { ...config.gptImage, apiKey: 'test-alternate-image', model: 'image-alternate' } });
  config.video.providers[0].apiKey = 'test-primary-video';
  config.video.providers.push({ ...config.video.providers[0], id: 'alternate-video', name: 'Alternate video', enabled: false, apiKey: 'test-alternate-video', model: 'video-alternate' });
  config.music.profiles[0].apiKey = 'test-primary-music';
  config.music.profiles[0].useEnvironmentKey = false;
  config.music.profiles.push({ ...config.music.profiles[0], id: 'alternate-music', name: 'Alternate music', apiKey: 'test-alternate-music', model: 'suno-v6-mini' });
  config.tts.minimax.apiKey = 'test-primary-tts';
  config.ttsProfiles.push({ id: 'alternate-tts', name: 'Alternate TTS', enabled: false, provider: 'minimax', minimax: { ...config.tts.minimax, apiKey: 'test-alternate-tts', model: 'speech-alternate' } });
  config.speechToText.apiKey = 'test-primary-speechToText';
  config.speechToTextProfiles[0].apiKey = 'test-primary-speechToText';
  config.speechToTextProfiles.push({ ...config.speechToTextProfiles[0], id: 'alternate-speechToText', name: 'Alternate STT', enabled: false, apiKey: 'test-alternate-speechToText', model: 'stt-alternate' });
  config.viral.vision.apiKey = 'test-primary-vision';
  config.viral.visionProfiles[0].apiKey = 'test-primary-vision';
  config.viral.visionProfiles.push({ ...config.viral.visionProfiles[0], id: 'alternate-vision', name: 'Alternate vision', enabled: false, apiKey: 'test-alternate-vision', model: 'vision-alternate' });
  return config;
}

function savedProfile(capability: ModelCapability, source: 'platform' | 'byok' = 'byok'): CommercialModelProfile {
  return { id: `account-${capability}`, name: `Account ${capability}`, capability, source, modelId: `model-${capability}`, ...(source === 'byok' ? { localProfileId: `alternate-${capability}` } : {}) };
}
function selected(...profiles: CommercialModelProfile[]): CommercialProfiles {
  return { profiles, active: Object.fromEntries(profiles.map(profile => [profile.capability, profile.id])) };
}

describe('account-owned BYOK routing', () => {
  it('resolves all seven selected credentials without changing the saved configuration', () => {
    const config = frozen(configFixture());
    const before = structuredClone(config);
    const profiles = frozen(selected(...capabilities.map(capability => savedProfile(capability))));
    const result = applyCommercialByokProfiles(config, profiles);
    expect(result.llm.apiKey).toBe('test-alternate-text');
    expect(result.gptImage.apiKey).toBe('test-alternate-image');
    expect(result.image.apiKey).toBe('test-alternate-image');
    expect(getVideoProfile(result).apiKey).toBe('test-alternate-video');
    expect(getMusicProfile(result).apiKey).toBe('test-alternate-music');
    expect(getMusicProfile(result).useEnvironmentKey).toBe(false);
    expect(result.tts.provider).toBe('minimax');
    expect(result.tts.minimax.apiKey).toBe('test-alternate-tts');
    expect(result.speechToText.apiKey).toBe('test-alternate-speechToText');
    expect(result.viral.vision.apiKey).toBe('test-alternate-vision');
    expect(result.video.providers.filter(profile => profile.enabled).map(profile => profile.id)).toEqual(['alternate-video']);
    expect(config).toEqual(before);
    expect(result).not.toBe(config);
  });

  it.each(capabilities)('rejects a deleted %s BYOK reference instead of falling back to primary', capability => {
    const profile = { ...savedProfile(capability), localProfileId: 'deleted-reference' };
    expect(() => applyCommercialByokProfiles(configFixture(), selected(profile))).toThrowError(expect.objectContaining({ code: 'BYOK_PROFILE_MISSING' }));
  });

  it.each(capabilities)('rejects an absent local reference for %s', capability => {
    const profile = { ...savedProfile(capability), localProfileId: undefined };
    expect(() => applyCommercialByokProfiles(configFixture(), selected(profile))).toThrowError(expect.objectContaining({ code: 'BYOK_PROFILE_MISSING' }));
  });

  it('does not activate a saved spare profile or mutate an unselected machine config', () => {
    const config = frozen(configFixture());
    const profiles = { profiles: capabilities.map(capability => savedProfile(capability)), active: {} };
    expect(applyCommercialByokProfiles(config, profiles)).toBe(config);
  });

  it('rejects ambiguous local profile IDs before selecting any credentials', () => {
    const config = configFixture();
    config.llmProfiles.push({ ...config.llmProfiles[1], apiKey: 'different-duplicate-key' });
    expect(() => applyCommercialByokProfiles(config, selected(savedProfile('text')))).toThrowError(expect.objectContaining({ code: 'BYOK_PROFILE_MISSING' }));
  });

  it('rejects an active profile removed from the account rather than silently using global config', () => {
    const profiles: CommercialProfiles = { profiles: [], active: { text: 'deleted-account-profile' } };
    expect(() => applyCommercialByokProfiles(configFixture(), profiles)).toThrowError(expect.objectContaining({ code: 'MODEL_PROFILE_MISSING' }));
    expect(() => assertLegacyModelSource('research:compose-copy', profiles)).toThrowError(expect.objectContaining({ code: 'MODEL_PROFILE_MISSING' }));
  });

  it('rejects a capability mismatch and ambiguous duplicate account IDs', () => {
    const profile = savedProfile('image');
    expect(() => applyCommercialByokProfiles(configFixture(), { profiles: [profile], active: { text: profile.id } })).toThrowError(expect.objectContaining({ code: 'MODEL_PROFILE_MISSING' }));
    expect(() => applyCommercialByokProfiles(configFixture(), { profiles: [profile, profile], active: { image: profile.id } })).toThrowError(expect.objectContaining({ code: 'MODEL_PROFILE_MISSING' }));
  });

  it('does not replace an explicitly empty selected key with a previous profile key', () => {
    const config = configFixture();
    config.llmProfiles[1].apiKey = '';
    config.imageProfiles[1].gptImage!.apiKey = '';
    config.video.providers[1].apiKey = '';
    config.music.profiles[1].apiKey = '';
    config.ttsProfiles[1].minimax!.apiKey = '';
    config.speechToTextProfiles[1].apiKey = '';
    config.viral.visionProfiles[1].apiKey = '';
    const result = applyCommercialByokProfiles(config, selected(...capabilities.map(capability => savedProfile(capability))));
    expect([result.llm.apiKey, result.gptImage.apiKey, getVideoProfile(result).apiKey, getMusicProfile(result).apiKey, result.tts.minimax.apiKey, result.speechToText.apiKey, result.viral.vision.apiKey]).toEqual(['', '', '', '', '', '', '']);
  });

  it('routes a real legacy LLM adapter with a stale task profile ID to the explicitly selected key', async () => {
    const config = configFixture();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const runtime = applyCommercialByokProfiles(config, selected(savedProfile('text')));
    const providers = createTaskRuntimeProviders(runtime, 'unused-routing-test-directory', { llmProfileId: config.activeLlmProfileId });
    await providers.llm!.run({ step: 0, name: 'routing test', messages: [{ role: 'user', content: 'test' }] });
    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get('Authorization')).toBe('Bearer test-alternate-text');
    expect(config.llmProfiles).toHaveLength(2);
    expect(runtime.llmProfiles.map(item => item.id)).toEqual(['alternate-text']);
  });

  it('rejects a stale voice provider before sending a different saved TTS key', async () => {
    const config = configFixture();
    config.tts.volcengine.apiKey = 'test-primary-volcengine-key';
    config.ttsProfiles[0].volcengine!.apiKey = 'test-primary-volcengine-key';
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const runtime = applyCommercialByokProfiles(config, selected(savedProfile('tts')));
    const synthesize = createConfiguredNarrationSynthesizer(runtime, 'unused-routing-test-directory');
    await expect(synthesize([{ id: 1, cap: '测试', descPrompt: '', durationMs: 1000 }], { ttsProvider: 'volcengine', speaker: 'old-speaker' } as Task)).rejects.toThrow(/required|missing/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(config.tts.volcengine.apiKey).toBe('test-primary-volcengine-key');
  });

  it('rejects an image provider override instead of reusing another saved provider key', async () => {
    const config = configFixture();
    config.customImage.apiKey = 'test-other-image-key';
    config.imageProfiles.push({ id: 'other-image', provider: 'custom', customImage: { ...config.customImage, apiKey: 'test-other-image-key' } });
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const runtime = applyCommercialByokProfiles(config, selected(savedProfile('image')));
    const overridden = selectImageLabProviderConfig(runtime, 'custom');
    const generate = createConfiguredImageGenerator(overridden, 'unused-routing-test-directory');
    await expect(generate([{ id: 1, cap: 'test', descPrompt: 'test', durationMs: 1000 }], [], { ratio: '16:9' } as Task)).rejects.toThrow(/key is missing/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(config.customImage.apiKey).toBe('test-other-image-key');
  });
});

describe('legacy paid IPC source guards', () => {
  const auditedPaidRoutes: [string, ModelCapability, unknown?][] = [
    ['research:compose-copy', 'text'], ['vox:generate', 'text'], ['custom-style:generate-draft', 'text'], ['book-selection:discover', 'text'],
    ['image-lab:generate', 'image'], ['voice-lab:generate', 'tts'], ['video-lab:generate', 'video'], ['director:generate-shot-video', 'video'],
    ['task:create-and-run', 'text'], ['task:retry', 'image'], ['task:rerun-step', 'tts'], ['task:update-status', 'text', { status: 'running' }],
    ['task:regenerate-image', 'image'], ['task:regenerate-images', 'image'], ['task:reference-edit-image', 'image'], ['task:regenerate-narration', 'tts'], ['task:replace-video', 'video', { source: { kind: 'ai' } }],
    ['html-video:create-task', 'text'], ['html-video:regenerate-asset', 'image'], ['html-video:regenerate-voice', 'tts'], ['html-video:regenerate-cover', 'image'],
    ['viral:analyze-prepared', 'vision'], ['viral:create-and-run', 'speechToText'], ['viral:retry', 'text'], ['viral:update-status', 'vision', { status: 'running' }], ['viral:create-production-task', 'image'],
    ['music-lab:generate', 'music'], ['music-lab:lyrics', 'music'], ['music-lab:boost-style', 'music'], ['music-lab:operation', 'music'], ['music-lab:upload-source', 'music'],
    ['music-lab:voice', 'music', { action: 'generate' }], ['music-lab:voice', 'music', { action: 'validate' }], ['music-lab:voice', 'music', { action: 'verify' }], ['music-lab:voice', 'music', { action: 'regenerate' }], ['music-lab:enhanced', 'music', { action: 'submit' }],
  ];

  it.each(auditedPaidRoutes)('stops platform-selected %s before any old provider call', (channel, capability, input) => {
    expect(() => assertLegacyModelSource(channel, selected(savedProfile(capability, 'platform')), input)).toThrowError(expect.objectContaining({ code: 'PLATFORM_PIPELINE_PENDING' }));
    expect(() => assertLegacyModelSource(channel, selected(savedProfile(capability, 'byok')), input)).not.toThrow();
  });

  const freeRoutes: [string, unknown?][] = [
    ['task:update-status', { status: 'paused' }], ['task:update-status', { status: 'cancelled' }], ['viral:update-status', { status: 'paused' }], ['viral:update-status', { status: 'cancelled' }],
    ['task:replace-video', { source: { kind: 'local' } }], ['task:replace-video', { source: { kind: 'library' } }], ['task:replace-video', { source: { kind: 'random' } }],
    ['html-video:add-asset'], ['html-video:replace-asset'], ['html-video:remove-asset-background'], ['html-video:remove-all-backgrounds'], ['html-video:rerender'],
    ['director:recheck-subtitles'], ['director:recheck-media'], ['director:render'], ['task:replace-image'], ['task:copy-image'], ['task:open-output-directory'],
    ['music-lab:list'], ['music-lab:download'], ['music-lab:refresh'], ['music-lab:voice', { action: 'list' }], ['music-lab:voice', { action: 'refresh' }], ['music-lab:voice', { action: 'poll' }], ['music-lab:voice', { action: 'delete' }], ['music-lab:enhanced', { action: 'list' }], ['music-lab:enhanced', { action: 'poll' }], ['music-lab:enhanced', { action: 'cancel' }],
  ];
  it.each(freeRoutes)('keeps non-generating %s available with platform profiles selected', (channel, input) => {
    const allPlatform = selected(...capabilities.map(capability => savedProfile(capability, 'platform')));
    expect(legacyPaidCapabilitiesFor(channel, input)).toEqual([]);
    expect(() => assertLegacyModelSource(channel, allPlatform, input)).not.toThrow();
  });

  it('does not let a missing mixed-route payload prove an operation free', () => {
    expect(() => assertLegacyModelSource('task:replace-video', selected(savedProfile('video', 'platform')))).toThrowError(expect.objectContaining({ code: 'PLATFORM_PIPELINE_PENDING' }));
    expect(() => assertLegacyModelSource('task:update-status', selected(savedProfile('text', 'platform')), {})).toThrowError(expect.objectContaining({ code: 'PLATFORM_PIPELINE_PENDING' }));
  });

  it('keeps unrelated platform selections and inactive platform spares from blocking a BYOK request', () => {
    const image = savedProfile('image', 'platform');
    expect(() => assertLegacyModelSource('vox:generate', selected(image))).not.toThrow();
    expect(() => assertLegacyModelSource('image-lab:generate', { profiles: [image], active: {} })).not.toThrow();
  });
});
