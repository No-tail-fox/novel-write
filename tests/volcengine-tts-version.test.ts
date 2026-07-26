import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig } from '@shared/config';
import { normalizeAppConfig, validateConfigTarget } from '@shared/config-utils';
import { createConfiguredNarrationSynthesizer } from '@shared/media-providers';
import { saveTtsProfile } from '@shared/provider-profile-utils';
import type { AppConfig, StoryboardScene, Task, TtsProviderProfile } from '@shared/types';

const scene: StoryboardScene = { id: 1, cap: '版本路由测试', descPrompt: 'version routing', durationMs: 1000 };
const task = {
  id: 'volcengine-version-task',
  title: 'Volcengine version routing',
  ratio: '9:16',
  ttsSpeed: 1,
  speaker: 'voice-version-test',
} as Task;

afterEach(() => {
  vi.unstubAllGlobals();
});

function rawVolcengineConfig(volcengine: Record<string, unknown>): unknown {
  return {
    tts: {
      provider: 'volcengine',
      appId: '',
      accessKey: '',
      speaker: 'voice-version-test',
      volcengine,
      minimax: { apiKey: '', model: 'speech-02-hd', voiceId: 'male-qn-qingse' },
    },
  };
}

describe('Volcengine TTS API version switching', () => {
  it('defaults new profiles to V3 and migrates versionless profiles according to their previous runtime behavior', () => {
    expect(defaultConfig.tts.volcengine.apiVersion).toBe('v3');

    const migratedV3 = normalizeAppConfig(rawVolcengineConfig({
      apiKey: 'existing-v3-key',
      appId: 'also-saved-app',
      accessKey: 'also-saved-token',
      speaker: 'zh_female_vv_uranus_bigtts',
      endpoint: 'https://v3-existing.example/api/v3/tts/unidirectional',
      resourceId: 'seed-tts-2.0',
    }));
    expect(migratedV3.tts.volcengine).toMatchObject({
      apiVersion: 'v3',
      v3Endpoint: 'https://v3-existing.example/api/v3/tts/unidirectional',
      legacyEndpoint: 'https://openspeech.bytedance.com/api/v1/tts',
    });

    const migratedLegacy = normalizeAppConfig(rawVolcengineConfig({
      apiKey: '',
      appId: 'existing-app',
      accessKey: 'existing-token',
      speaker: 'legacy-voice',
      cluster: 'volcano_tts',
      endpoint: 'https://legacy-existing.example/api/v1/tts',
    }));
    expect(migratedLegacy.tts.volcengine).toMatchObject({
      apiVersion: 'legacy',
      v3Endpoint: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
      legacyEndpoint: 'https://legacy-existing.example/api/v1/tts',
    });

    const migratedTopLevelLegacy = normalizeAppConfig({
      ttsProfiles: [{
        id: 'top-level-legacy',
        name: '早期旧版配置',
        enabled: true,
        provider: 'volcengine',
        appId: 'top-level-app',
        accessKey: 'top-level-token',
        speaker: 'top-level-voice',
      }],
      activeTtsProfileId: 'top-level-legacy',
    });
    expect(migratedTopLevelLegacy.tts.volcengine).toMatchObject({
      apiVersion: 'legacy',
      appId: 'top-level-app',
      accessKey: 'top-level-token',
    });
  });

  it('validates only the explicitly selected credential family', () => {
    const selectedLegacy = normalizeAppConfig(rawVolcengineConfig({
      apiVersion: 'legacy',
      apiKey: 'saved-v3-key',
      appId: '',
      accessKey: '',
      speaker: 'legacy-voice',
      v3Endpoint: 'https://v3.example/api/v3/tts/unidirectional',
      legacyEndpoint: 'https://legacy.example/api/v1/tts',
      resourceId: 'seed-tts-2.0',
    }));
    const legacyResult = validateConfigTarget('tts', selectedLegacy);
    expect(legacyResult.status).toBe('fail');
    expect(legacyResult.endpoint).toBe('https://legacy.example/api/v1/tts');
    expect(legacyResult.detail).toContain('旧版');
    expect(legacyResult.detail).toContain('App ID');

    const selectedV3 = normalizeAppConfig(rawVolcengineConfig({
      apiVersion: 'v3',
      apiKey: '',
      appId: 'saved-legacy-app',
      accessKey: 'saved-legacy-token',
      speaker: 'zh_female_vv_uranus_bigtts',
      v3Endpoint: 'https://v3.example/api/v3/tts/unidirectional',
      legacyEndpoint: 'https://legacy.example/api/v1/tts',
      resourceId: 'seed-tts-2.0',
    }));
    const v3Result = validateConfigTarget('tts', selectedV3);
    expect(v3Result.status).toBe('fail');
    expect(v3Result.endpoint).toBe('https://v3.example/api/v3/tts/unidirectional');
    expect(v3Result.detail).toContain('V3');
    expect(v3Result.detail).toContain('API Key');
  });

  it('routes an explicit legacy profile to V1 even when a V3 key is also saved', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'storydream-volcengine-legacy-version-'));
    const requests: Array<{ url: string; authorization: string | null }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, authorization: new Headers(init.headers).get('Authorization') });
      return new Response(JSON.stringify({ code: 3000, data: Buffer.from('legacy-audio').toString('base64') }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));

    try {
      const config = {
        ...defaultConfig,
        tts: {
          ...defaultConfig.tts,
          provider: 'volcengine' as const,
          volcengine: {
            ...defaultConfig.tts.volcengine,
            apiVersion: 'legacy',
            apiKey: 'saved-v3-key',
            appId: 'legacy-app',
            accessKey: 'legacy-token',
            speaker: 'legacy-voice',
            cluster: 'legacy-cluster',
            v3Endpoint: 'https://v3.example/api/v3/tts/unidirectional',
            legacyEndpoint: 'https://legacy.example/api/v1/tts',
          },
        },
      } as AppConfig;
      const assets = await createConfiguredNarrationSynthesizer(config, directory)([scene], task);

      expect(await readFile(assets[0].path, 'utf8')).toBe('legacy-audio');
      expect(requests).toEqual([{ url: 'https://legacy.example/api/v1/tts', authorization: 'Bearer legacy-token' }]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('routes an explicit V3 profile to its own endpoint even when legacy credentials are also saved', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'storydream-volcengine-v3-version-'));
    const requests: Array<{ url: string; apiKey: string | null }> = [];
    const audio = Buffer.from('v3-audio').toString('base64');
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, apiKey: new Headers(init.headers).get('X-Api-Key') });
      return new Response(`${JSON.stringify({ code: 0, data: audio })}\n${JSON.stringify({ code: 20000000, message: 'ok' })}\n`, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));

    try {
      const config = {
        ...defaultConfig,
        tts: {
          ...defaultConfig.tts,
          provider: 'volcengine' as const,
          volcengine: {
            ...defaultConfig.tts.volcengine,
            apiVersion: 'v3',
            apiKey: 'v3-key',
            appId: 'saved-legacy-app',
            accessKey: 'saved-legacy-token',
            speaker: 'zh_female_vv_uranus_bigtts',
            endpoint: 'https://legacy-compat.example/api/v1/tts',
            v3Endpoint: 'https://v3.example/api/v3/tts/unidirectional',
            legacyEndpoint: 'https://legacy.example/api/v1/tts',
            resourceId: 'seed-tts-2.0',
          },
        },
      } as AppConfig;
      const assets = await createConfiguredNarrationSynthesizer(config, directory)([scene], task);

      expect(await readFile(assets[0].path, 'utf8')).toBe('v3-audio');
      expect(requests).toEqual([{ url: 'https://v3.example/api/v3/tts/unidirectional', apiKey: 'v3-key' }]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves both protocol parameter sets when only the selected version changes', () => {
    const config = normalizeAppConfig(rawVolcengineConfig({
      apiVersion: 'v3',
      apiKey: 'v3-key',
      appId: 'legacy-app',
      accessKey: 'legacy-token',
      speaker: 'shared-voice',
      cluster: 'legacy-cluster',
      resourceId: 'seed-tts-2.0',
      v3Endpoint: 'https://v3.example/api/v3/tts/unidirectional',
      legacyEndpoint: 'https://legacy.example/api/v1/tts',
    }));
    const selected = config.ttsProfiles[0];
    const changed = saveTtsProfile(config, {
      ...selected,
      volcengine: { ...selected.volcengine!, apiVersion: 'legacy' },
    } as TtsProviderProfile);

    expect(changed.ttsProfiles[0].volcengine).toMatchObject({
      apiVersion: 'legacy',
      apiKey: 'v3-key',
      appId: 'legacy-app',
      accessKey: 'legacy-token',
      cluster: 'legacy-cluster',
      resourceId: 'seed-tts-2.0',
      v3Endpoint: 'https://v3.example/api/v3/tts/unidirectional',
      legacyEndpoint: 'https://legacy.example/api/v1/tts',
    });
  });

  it('exposes the real version switch and every version-specific setting in the TTS profile editor', async () => {
    const source = await readFile(new URL('../src/features/settings/ProviderProfileManagers.tsx', import.meta.url), 'utf8');

    for (const label of ['接口版本', '新版 V3', '旧版接口', 'V3 Resource ID', 'V3 接口地址', '旧版 App ID', '旧版 Access Token', '旧版 Cluster', '旧版接口地址']) {
      expect(source, label).toContain(label);
    }
    expect(source).toContain("options={['v3', 'legacy']}");
    expect(source).toContain('apiVersion: value');
    expect(source).toContain('apiVersionExplicit: true');
    expect(source).toContain('v3Endpoint: value');
    expect(source).toContain('legacyEndpoint: value');
    expect(source).toContain("profileSecretId('tts', selectedProfile.id, 'volcengine/accessKey')");
  });
});
