import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '@shared/config';
import { configFilePath } from '@shared/config-file';
import { normalizeAppConfig, validateConfigTarget } from '@shared/config-utils';
import { applyConfigSecrets, extractConfigSecrets, isSecretId, stripConfigSecrets } from '@shared/config-secrets';
import {
  addMusicProfile, addVideoProfile, buildConfigForSelectedProfileTest, copyMusicProfile, copyVideoProfile,
  enableMusicProfile, enableVideoProfile, getMusicProfile, getVideoProfile, removeMusicProfile,
  removeVideoProfile, saveMusicProfile, saveVideoProfile,
} from '@shared/provider-profile-utils';
import { FileDatabase } from '@shared/storage';
import type { AppConfig } from '@shared/types';
import { ConfigService } from '../electron/config-service';
import { CredentialVault } from '../electron/credential-vault';

function musicConfig(): AppConfig {
  return normalizeAppConfig({
    ...defaultConfig,
    music: {
      enabled: true,
      activeProfileId: 'music-a',
      profiles: [
        { ...defaultConfig.music.profiles[0], id: 'music-a', name: '账户 A', model: 'suno-v6', apiKey: 'music-key-a', useEnvironmentKey: false },
        { ...defaultConfig.music.profiles[0], id: 'music-b', name: '账户 B', model: 'suno-v6-mini', apiKey: 'music-key-b', useEnvironmentKey: false },
      ],
    },
  });
}

const fakeEncryption = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from([...Buffer.from(value, 'utf8')].map((byte) => byte ^ 0x5a)),
  decryptString: (value: Buffer) => Buffer.from([...value].map((byte) => byte ^ 0x5a)).toString('utf8'),
};

describe('music and video model profiles', () => {
  it('migrates configs without music to the existing environment-backed Suno channel', () => {
    const legacy = { ...defaultConfig } as Partial<AppConfig>;
    delete legacy.music;
    const config = normalizeAppConfig(legacy);
    expect(config.music).toEqual(defaultConfig.music);
    expect(config.music.profiles).not.toBe(defaultConfig.music.profiles);
    expect(getMusicProfile(config).apiKey).toBe('');
  });

  it('migrates a legacy singleton without silently using another account key', () => {
    const config = normalizeAppConfig({ music: { baseUrl: 'https://music.example/', apiKey: 'legacy-secret', model: 'suno-v6-wild' } });
    expect(config.music).toMatchObject({ enabled: true, activeProfileId: 'default-music' });
    expect(getMusicProfile(config)).toMatchObject({ baseUrl: 'https://music.example', apiKey: 'legacy-secret', model: 'suno-v6-wild', useEnvironmentKey: false });
  });

  it('keeps every saved profile and chooses a deterministic fallback for removed active ids', () => {
    const config = musicConfig();
    const restored = normalizeAppConfig(JSON.parse(JSON.stringify(config)));
    expect(restored.music).toEqual(config.music);
    expect(normalizeAppConfig({ ...config, music: { ...config.music, activeProfileId: 'missing' } }).music.activeProfileId).toBe('music-a');
    expect(normalizeAppConfig({ music: { profiles: [] } }).music.profiles).toHaveLength(1);
  });

  it('edits inactive music without activating it and tests the selected profile without mutating the saved choice', () => {
    const config = musicConfig();
    const saved = saveMusicProfile(config, { ...getMusicProfile(config, 'music-b'), model: 'suno-v6-wild' });
    const testConfig = buildConfigForSelectedProfileTest(saved, 'music', { music: 'music-b' });
    expect(saved.music.activeProfileId).toBe('music-a');
    expect(getMusicProfile(saved).apiKey).toBe('music-key-a');
    expect(getMusicProfile(testConfig)).toMatchObject({ id: 'music-b', apiKey: 'music-key-b', model: 'suno-v6-wild' });
    expect(enableMusicProfile(saved, 'music-b').music.activeProfileId).toBe('music-b');
    expect(config.music.profiles[1].model).toBe('suno-v6-mini');
  });

  it('adds and copies independent music profiles with no inherited credentials or environment fallback', () => {
    const config = musicConfig();
    const added = addMusicProfile(config);
    expect(added.music.activeProfileId).toBe('music-a');
    expect(added.music.profiles[0]).toMatchObject({ apiKey: '', useEnvironmentKey: false });
    const copied = copyMusicProfile(config, 'music-a');
    expect(copied.music.profiles[1]).toMatchObject({ name: '账户 A 副本', apiKey: '', useEnvironmentKey: false });
    expect(copied.music.profiles[1].id).not.toBe('music-a');
    expect(copied.music.activeProfileId).toBe('music-a');
  });

  it('removes music without enabling a disabled service, and preserves its final profile', () => {
    const config = musicConfig();
    config.music.enabled = false;
    const removed = removeMusicProfile(config, 'music-a');
    expect(removed.music).toMatchObject({ enabled: false, activeProfileId: 'music-b' });
    expect(removeMusicProfile(removed, 'music-b').music.profiles).toHaveLength(1);
    expect(enableMusicProfile(removed, 'music-b').music.enabled).toBe(true);
  });

  it('keeps video drafts inactive and enables exactly the selected video while preserving its parameters', () => {
    const initial = normalizeAppConfig(defaultConfig);
    const config = addVideoProfile(initial);
    const draft = config.video.providers[0];
    const saved = saveVideoProfile(config, { ...draft, baseUrl: 'https://video.example', apiKey: 'video-b', model: 'model-b', capabilities: ['i2v'] });
    expect(saved.video.activeProviderId).toBe(initial.video.activeProviderId);
    expect(getVideoProfile(saved, draft.id)).toMatchObject({ enabled: false, model: 'model-b' });
    const testConfig = buildConfigForSelectedProfileTest(saved, 'video', { video: draft.id });
    expect(getVideoProfile(testConfig)).toMatchObject({ id: draft.id, enabled: true, model: 'model-b', apiKey: 'video-b', capabilities: ['i2v'] });
    expect(enableVideoProfile(saved, draft.id).video.providers.filter((item) => item.enabled)).toHaveLength(1);
    expect(saved.video.providers.find((item) => item.id === draft.id)?.enabled).toBe(false);
  });

  it('copies video without secrets and removes active video with a valid fallback and whitelist', () => {
    const added = addVideoProfile(normalizeAppConfig(defaultConfig));
    const source = { ...added.video.providers[0], apiKey: 'video-secret', capabilities: ['i2v'] as const };
    const saved = saveVideoProfile(added, { ...source, capabilities: [...source.capabilities] });
    const copied = copyVideoProfile(saved, source.id);
    expect(copied.video.providers[1]).toMatchObject({ apiKey: '', enabled: false });
    expect(copied.video.providers[1].capabilities).not.toBe(copied.video.providers[0].capabilities);
    const removed = removeVideoProfile(enableVideoProfile(copied, source.id), source.id);
    expect(removed.video.providers.some((item) => item.id === source.id)).toBe(false);
    expect(getVideoProfile(removed).enabled).toBe(true);
    expect(removed.video.automation.providerWhitelist).not.toContain(source.id);
  });
});

describe('music configuration validation and secrets', () => {
  it('checks music fields without performing a paid request', () => {
    const config = musicConfig();
    expect(validateConfigTarget('music', config)).toMatchObject({ status: 'pass', endpoint: 'https://www.suno-api.io/api/user/balance' });
    config.music.enabled = false;
    expect(validateConfigTarget('music', config).status).toBe('fail');
    config.music.enabled = true;
    config.music.profiles[0].apiKey = '';
    expect(validateConfigTarget('music', config).status).toBe('fail');
    config.music.profiles[0].useEnvironmentKey = true;
    expect(validateConfigTarget('music', config).status).toBe('pass');
  });

  it.each(['http://music.example', 'https://user:pass@music.example', 'https://music.example?key=bad', 'https://music.example#bad', 'not a url'])('rejects invalid credential destinations: %s', (baseUrl) => {
    const config = musicConfig();
    config.music.profiles[0].baseUrl = baseUrl;
    expect(validateConfigTarget('music', config).status).toBe('fail');
  });

  it('strips and restores music keys by stable ID, independent of profile order or active choice', () => {
    const config = musicConfig();
    const secrets = extractConfigSecrets(config);
    expect(secrets).toMatchObject({ 'music/music-a/apiKey': 'music-key-a', 'music/music-b/apiKey': 'music-key-b' });
    expect(isSecretId('music/music-a/apiKey')).toBe(true);
    const stripped = stripConfigSecrets(config);
    expect(JSON.stringify(stripped)).not.toContain('music-key-');
    stripped.music.profiles.reverse();
    stripped.music.activeProfileId = 'music-b';
    const restored = applyConfigSecrets(stripped, secrets);
    expect(getMusicProfile(restored).apiKey).toBe('music-key-b');
    expect(getMusicProfile(restored, 'music-a').apiKey).toBe('music-key-a');
    expect(config.music.profiles[0].apiKey).toBe('music-key-a');
  });

  it('rejects ambiguous duplicate music IDs at the secret boundary', () => {
    const config = musicConfig();
    config.music.profiles[1].id = 'music-a';
    expect(() => extractConfigSecrets(config)).toThrow(/Duplicate music profile id/);
    config.music.profiles[1].id = '';
    expect(() => extractConfigSecrets(config)).toThrow(/stable profile id/);
  });

  it('persists multiple music keys encrypted, tests drafts without activation, and clears/deletes only their own secrets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-music-settings-'));
    const database = await FileDatabase.open(join(dir, 'data.db'));
    const vault = new CredentialVault(join(dir, 'secrets.v1.json'), fakeEncryption);
    try {
      const service = new ConfigService({ database, dataDir: dir, vault });
      const config = stripConfigSecrets(musicConfig());
      await service.save({ config, secretChanges: { 'music/music-a/apiKey': 'vault-music-a', 'music/music-b/apiKey': 'vault-music-b', 'llm/default-llm/apiKey': 'keep-llm-secret' } });
      const reopened = new ConfigService({ database, dataDir: dir, vault: new CredentialVault(join(dir, 'secrets.v1.json'), fakeEncryption) });
      expect(getMusicProfile(await reopened.getRuntimeConfig()).apiKey).toBe('vault-music-a');
      const publicState = await reopened.getPublicState();
      expect(publicState.secretStatus['music/music-b/apiKey']).toBe(true);
      expect(JSON.stringify(publicState.config)).not.toContain('vault-music-');
      expect(await readFile(configFilePath(dir), 'utf8')).not.toContain('vault-music-');
      expect(await readFile(join(dir, 'secrets.v1.json'), 'utf8')).not.toContain('vault-music-');

      const testConfig = buildConfigForSelectedProfileTest(publicState.config, 'music', { music: 'music-b' });
      const tested = await reopened.getRuntimeConfigFor({ config: testConfig, secretChanges: { 'music/music-b/apiKey': 'unsaved-test-key' } });
      expect(getMusicProfile(tested).apiKey).toBe('unsaved-test-key');
      expect(getMusicProfile(await reopened.getRuntimeConfig())).toMatchObject({ id: 'music-a', apiKey: 'vault-music-a' });
      expect((await vault.load())['music/music-b/apiKey']).toBe('vault-music-b');

      await reopened.save({ config: testConfig, secretChanges: { 'music/music-b/apiKey': null } });
      expect(getMusicProfile(await reopened.getRuntimeConfig()).apiKey).toBe('');
      expect((await vault.load())['music/music-a/apiKey']).toBe('vault-music-a');
      const removed = removeMusicProfile(testConfig, 'music-a');
      await reopened.save({ config: removed, secretChanges: {} });
      expect((await vault.load())['music/music-a/apiKey']).toBeUndefined();
      expect((await vault.load())['llm/default-llm/apiKey']).toBe('keep-llm-secret');
      expect((await reopened.getPublicState()).secretStatus['music/music-a/apiKey']).toBeUndefined();
    } finally {
      await database.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
