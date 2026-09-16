import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '@shared/config';
import { normalizeAppConfig, validateConfigTarget } from '@shared/config-utils';
import { applyConfigSecrets, extractConfigSecrets, stripConfigSecrets } from '@shared/config-secrets';
import {
  addSpeechToTextProfile, addVisionProfile, buildConfigForSelectedProfileTest,
  copySpeechToTextProfile, copyVisionProfile, enableSpeechToTextProfile, enableVisionProfile,
  getSpeechToTextProfile, getVisionProfile, removeSpeechToTextProfile, removeVisionProfile,
  saveSpeechToTextProfile, saveVisionProfile,
} from '@shared/provider-profile-utils';
import { FileDatabase } from '@shared/storage';
import { ConfigService, configMigrationMarkerPath } from '../electron/config-service';
import { CredentialVault } from '../electron/credential-vault';

const fakeEncryption = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from([...Buffer.from(value, 'utf8')].map((byte) => byte ^ 0x5a)),
  decryptString: (value: Buffer) => Buffer.from([...value].map((byte) => byte ^ 0x5a)).toString('utf8'),
};

function multipleProfiles() {
  const config = normalizeAppConfig(defaultConfig);
  return normalizeAppConfig({
    ...config,
    speechToTextProfiles: [
      { ...config.speechToTextProfiles[0], id: 'stt-a', name: '转写 A', enabled: true, apiKey: 'stt-a-secret', model: 'whisper-a' },
      { ...config.speechToTextProfiles[0], id: 'stt-b', name: '转写 B', enabled: false, provider: 'siliconflow', apiKey: 'stt-b-secret', model: 'FunAudioLLM/SenseVoiceSmall' },
    ],
    activeSpeechToTextProfileId: 'stt-a',
    viral: {
      ...config.viral,
      visionProfiles: [
        { ...config.viral.visionProfiles[0], id: 'vision-a', name: '视觉 A', enabled: true, apiKey: 'vision-a-secret', model: 'vision-model-a' },
        { ...config.viral.visionProfiles[0], id: 'vision-b', name: '视觉 B', enabled: false, apiKey: 'vision-b-secret', model: 'vision-model-b', protocol: 'anthropic' },
      ],
      activeVisionProfileId: 'vision-a',
    },
  });
}

describe('speech and vision provider profiles', () => {
  it('migrates legacy single settings and keeps runtime compatibility projections', () => {
    const config = normalizeAppConfig({
      speechToText: { ...defaultConfig.speechToText, apiKey: 'old-stt', model: 'old-transcription' },
      viral: { ...defaultConfig.viral, visionProfiles: undefined, activeVisionProfileId: undefined, vision: { ...defaultConfig.viral.vision, apiKey: 'old-vision', model: 'old-vision-model' } },
    });
    expect(getSpeechToTextProfile(config)).toMatchObject({ id: 'default-speech-to-text', enabled: true, apiKey: 'old-stt', model: 'old-transcription' });
    expect(config.speechToText.model).toBe('old-transcription');
    expect(getVisionProfile(config)).toMatchObject({ id: 'viral-vision', enabled: true, apiKey: 'old-vision', model: 'old-vision-model' });
    expect(config.viral.vision.model).toBe('old-vision-model');
    expect(normalizeAppConfig(JSON.parse(JSON.stringify(config)))).toEqual(config);
  });

  it('honors singleton edits made on existing default-config callers', () => {
    const input = structuredClone(defaultConfig);
    input.speechToText.model = 'legacy-edit';
    input.viral.vision.model = 'legacy-vision-edit';
    const config = normalizeAppConfig(input);
    expect(getSpeechToTextProfile(config).model).toBe('legacy-edit');
    expect(getVisionProfile(config).model).toBe('legacy-vision-edit');
  });

  it('saves inactive drafts without activation and tests only a temporary selected projection', () => {
    const original = multipleProfiles();
    const edited = saveVisionProfile(
      saveSpeechToTextProfile(original, { ...getSpeechToTextProfile(original, 'stt-b'), model: 'new-stt-model' }),
      { ...getVisionProfile(original, 'vision-b'), model: 'new-vision-model' },
    );
    expect(edited.speechToText).toMatchObject({ apiKey: 'stt-a-secret', model: 'whisper-a' });
    expect(edited.viral.vision).toMatchObject({ apiKey: 'vision-a-secret', model: 'vision-model-a' });
    const sttTest = buildConfigForSelectedProfileTest(edited, 'speechToText', { speechToText: 'stt-b' });
    expect(sttTest.speechToText).toMatchObject({ apiKey: 'stt-b-secret', model: 'new-stt-model', provider: 'siliconflow', responseFormat: 'json' });
    const visionTest = buildConfigForSelectedProfileTest(edited, 'vision', { vision: 'vision-b' });
    expect(visionTest.viral.vision).toMatchObject({ apiKey: 'vision-b-secret', model: 'new-vision-model', protocol: 'anthropic' });
    expect(edited.activeSpeechToTextProfileId).toBe('stt-a');
    expect(edited.viral.activeVisionProfileId).toBe('vision-a');
    expect(enableSpeechToTextProfile(edited, 'stt-b').speechToTextProfiles.filter((profile) => profile.enabled)).toHaveLength(1);
    expect(enableVisionProfile(edited, 'vision-b').viral.visionProfiles.filter((profile) => profile.enabled)).toHaveLength(1);
  });

  it('adds and copies independent drafts, with cleared secrets and independent nested settings', () => {
    const original = multipleProfiles();
    const added = addVisionProfile(addSpeechToTextProfile(original));
    expect(added.speechToTextProfiles[0]).toMatchObject({ apiKey: '', enabled: false });
    expect(added.viral.visionProfiles[0]).toMatchObject({ apiKey: '', enabled: false });
    const copies = copyVisionProfile(copySpeechToTextProfile(original, 'stt-a'), 'vision-a');
    expect(copies.speechToTextProfiles[1]).toMatchObject({ apiKey: '', enabled: false, name: '转写 A 副本' });
    expect(copies.viral.visionProfiles[1]).toMatchObject({ apiKey: '', enabled: false, name: '视觉 A 副本' });
    expect(copies.speechToTextProfiles[1].timestampGranularities).not.toBe(copies.speechToTextProfiles[0].timestampGranularities);
    expect(copies.activeSpeechToTextProfileId).toBe('stt-a');
    expect(copies.viral.activeVisionProfileId).toBe('vision-a');
  });

  it('removes enabled profiles with valid runtime fallbacks and keeps the final profile', () => {
    const removed = removeVisionProfile(removeSpeechToTextProfile(multipleProfiles(), 'stt-a'), 'vision-a');
    expect(removed.speechToText).toMatchObject({ model: 'FunAudioLLM/SenseVoiceSmall', apiKey: 'stt-b-secret' });
    expect(removed.viral.vision).toMatchObject({ model: 'vision-model-b', apiKey: 'vision-b-secret' });
    expect(removeSpeechToTextProfile(removed, 'stt-b').speechToTextProfiles).toHaveLength(1);
    expect(removeVisionProfile(removed, 'vision-b').viral.visionProfiles).toHaveLength(1);
  });

  it('allows resetting the only active profile to defaults without reviving old projected settings', () => {
    let config = normalizeAppConfig(defaultConfig);
    config = saveSpeechToTextProfile(config, { ...getSpeechToTextProfile(config), model: 'custom-stt' });
    config = saveVisionProfile(config, { ...getVisionProfile(config), model: 'custom-vision' });
    config = saveSpeechToTextProfile(config, defaultConfig.speechToTextProfiles[0]);
    config = saveVisionProfile(config, defaultConfig.viral.visionProfiles[0]);
    expect(config.speechToText.model).toBe(defaultConfig.speechToText.model);
    expect(config.viral.vision.model).toBe(defaultConfig.viral.vision.model);
  });

  it('validates the selected vision projection without treating it as the text model', () => {
    const config = multipleProfiles();
    expect(validateConfigTarget('vision', config)).toMatchObject({ target: 'vision', status: 'pass' });
    config.viral.visionProfiles[0].apiKey = '';
    config.viral.vision.apiKey = '';
    expect(validateConfigTarget('vision', config).status).toBe('fail');
  });

  it('strips and restores all profile secrets independently of profile order', () => {
    const original = multipleProfiles();
    const secrets = extractConfigSecrets(original);
    expect(secrets).toMatchObject({ 'speechToText/stt-a/apiKey': 'stt-a-secret', 'speechToText/stt-b/apiKey': 'stt-b-secret', 'viralVision/vision-a/apiKey': 'vision-a-secret', 'viralVision/vision-b/apiKey': 'vision-b-secret' });
    const clean = stripConfigSecrets(original);
    expect(JSON.stringify(clean)).not.toContain('-secret');
    clean.speechToTextProfiles.reverse();
    clean.viral.visionProfiles.reverse();
    const restored = applyConfigSecrets(clean, secrets);
    expect(getSpeechToTextProfile(restored, 'stt-b').apiKey).toBe('stt-b-secret');
    expect(getVisionProfile(restored, 'vision-b').apiKey).toBe('vision-b-secret');
  });
});

describe('upgrading encrypted singleton model credentials', () => {
  it('migrates previously vaulted singleton keys once and does not inherit them into a new blank profile', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-profile-migration-'));
    const database = await FileDatabase.open(join(dir, 'data.db'));
    const vault = new CredentialVault(join(dir, 'secrets.v1.json'), fakeEncryption);
    try {
      await writeFile(configMigrationMarkerPath(dir), '1\n', 'utf8');
      await vault.save({ 'speechToText/apiKey': 'legacy-stt-vault', 'viralVision/apiKey': 'legacy-vision-vault' });
      const service = new ConfigService({ database, dataDir: dir, vault });
      const first = await service.getRuntimeConfig();
      expect(getSpeechToTextProfile(first).apiKey).toBe('legacy-stt-vault');
      expect(getVisionProfile(first).apiKey).toBe('legacy-vision-vault');
      const published = await service.getPublicState();
      const added = addVisionProfile(addSpeechToTextProfile(published.config));
      const activeNew = enableVisionProfile(enableSpeechToTextProfile(added, added.speechToTextProfiles[0].id), added.viral.visionProfiles[0].id);
      await service.save({ config: activeNew, secretChanges: {} });
      const restarted = new ConfigService({ database, dataDir: dir, vault });
      const runtime = await restarted.getRuntimeConfig();
      expect(runtime.speechToText.apiKey).toBe('');
      expect(runtime.viral.vision.apiKey).toBe('');
      expect(getSpeechToTextProfile(runtime, 'default-speech-to-text').apiKey).toBe('legacy-stt-vault');
      expect(getVisionProfile(runtime, 'viral-vision').apiKey).toBe('legacy-vision-vault');
      expect(JSON.stringify((await restarted.getPublicState()).config)).not.toContain('-vault');
      expect(await readFile(join(dir, 'config.json'), 'utf8')).not.toContain('-vault');
    } finally {
      await database.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('saves, tests, clears and deletes independent speech/vision credentials without crossing profiles', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-profile-vault-'));
    const database = await FileDatabase.open(join(dir, 'data.db'));
    const vault = new CredentialVault(join(dir, 'secrets.v1.json'), fakeEncryption);
    try {
      const service = new ConfigService({ database, dataDir: dir, vault });
      const config = stripConfigSecrets(multipleProfiles());
      await service.save({ config, secretChanges: { 'speechToText/stt-a/apiKey': 'saved-stt-a', 'speechToText/stt-b/apiKey': 'saved-stt-b', 'viralVision/vision-a/apiKey': 'saved-vision-a', 'viralVision/vision-b/apiKey': 'saved-vision-b' } });
      const testConfig = buildConfigForSelectedProfileTest(config, 'speechToText', { speechToText: 'stt-b' });
      expect((await service.getRuntimeConfigFor({ config: testConfig, secretChanges: { 'speechToText/stt-b/apiKey': 'unsaved-stt-b' } })).speechToText.apiKey).toBe('unsaved-stt-b');
      expect((await service.getRuntimeConfig()).speechToText.apiKey).toBe('saved-stt-a');
      await service.save({ config, secretChanges: { 'speechToText/stt-a/apiKey': null, 'viralVision/vision-a/apiKey': null } });
      expect((await service.getRuntimeConfig()).speechToText.apiKey).toBe('');
      expect((await service.getRuntimeConfig()).viral.vision.apiKey).toBe('');
      const removed = removeVisionProfile(removeSpeechToTextProfile(config, 'stt-a'), 'vision-a');
      await service.save({ config: removed, secretChanges: {} });
      const stored = await vault.load();
      expect(stored['speechToText/stt-a/apiKey']).toBeUndefined();
      expect(stored['viralVision/vision-a/apiKey']).toBeUndefined();
      expect(stored['speechToText/stt-b/apiKey']).toBe('saved-stt-b');
      expect(stored['viralVision/vision-b/apiKey']).toBe('saved-vision-b');
      expect((await service.getRuntimeConfig()).speechToText.apiKey).toBe('saved-stt-b');
      expect((await service.getRuntimeConfig()).viral.vision.apiKey).toBe('saved-vision-b');
    } finally {
      await database.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
