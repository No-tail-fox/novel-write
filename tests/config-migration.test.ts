import initSqlJs from 'sql.js';
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '@shared/config';
import { configFilePath, saveConfigToFile } from '@shared/config-file';
import { normalizeAppConfig } from '@shared/config-utils';
import { FileDatabase } from '@shared/storage';
import type { AppConfig } from '@shared/types';
import { CredentialVault } from '../electron/credential-vault';

async function loadConfigService() {
  return import('../electron/config-service').catch(() => null);
}

function fakeEncryption() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from([...Buffer.from(value, 'utf8')].map((byte) => byte ^ 0x5a)),
    decryptString: (value: Buffer) => Buffer.from([...value].map((byte) => byte ^ 0x5a)).toString('utf8'),
  };
}

function configWithLlmSecret(secret: string): AppConfig {
  return normalizeAppConfig({
    ...structuredClone(defaultConfig),
    llm: { ...defaultConfig.llm, apiKey: secret },
    llmProfiles: [{ ...defaultConfig.llmProfiles[0], apiKey: secret }],
  });
}

function configWithVaultOnlyVolcengineProfiles(): AppConfig {
  const config = structuredClone(defaultConfig);
  const versionlessVolcengine = {
    ...config.tts.volcengine,
    apiKey: '',
  };
  delete versionlessVolcengine.apiVersion;
  const explicitLegacyVolcengine = {
    ...config.tts.volcengine,
    apiVersion: 'legacy' as const,
    apiKey: '',
    appId: 'explicit-legacy-app',
    accessKey: '',
  };
  return {
    ...config,
    tts: {
      ...config.tts,
      volcengine: versionlessVolcengine,
    },
    ttsProfiles: [
      {
        ...config.ttsProfiles[0],
        id: 'vault-only-v3',
        enabled: true,
        volcengine: versionlessVolcengine,
      },
      {
        ...config.ttsProfiles[0],
        id: 'explicit-legacy',
        enabled: false,
        volcengine: explicitLegacyVolcengine,
      },
    ],
    activeTtsProfileId: 'vault-only-v3',
  };
}

async function seedLegacyDatabase(file: string, config: AppConfig): Promise<FileDatabase> {
  const created = await FileDatabase.open(file);
  await created.close();
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database(await readFile(file));
  sqlite.run('INSERT OR REPLACE INTO config (id, data) VALUES (1, ?)', [JSON.stringify(config)]);
  const bytes = sqlite.export();
  sqlite.close();
  await writeFile(file, bytes);
  return FileDatabase.open(file);
}

describe('config credential migration', () => {
  it('uses an external legacy theme when the database was unversioned on this startup', async () => {
    const module = await loadConfigService();
    expect(module).not.toBeNull();
    if (!module) return;
    const dir = await mkdtemp(join(tmpdir(), 'storydream-theme-external-legacy-'));
    const databasePath = join(dir, 'data.db');
    const seeded = await FileDatabase.open(databasePath);
    await seeded.close();
    const SQL = await initSqlJs();
    const sqlite = new SQL.Database(await readFile(databasePath));
    sqlite.run('INSERT OR REPLACE INTO config (id, data) VALUES (1, ?)', [JSON.stringify(defaultConfig)]);
    sqlite.run('INSERT OR REPLACE INTO ui_preferences (id, data) VALUES (1, ?)', [JSON.stringify({
      theme: 'dark', activeView: 'history',
    })]);
    const bytes = sqlite.export();
    sqlite.close();
    await writeFile(databasePath, bytes);

    const database = await FileDatabase.open(databasePath);
    const vault = new CredentialVault(join(dir, 'secrets.v1.json'), fakeEncryption());
    try {
      await writeFile(configFilePath(dir), JSON.stringify({
        ...structuredClone(defaultConfig),
        ui: { theme: 'light' },
      }), 'utf8');
      const service = new module.ConfigService({ database, dataDir: dir, vault });
      await service.migrateLegacySecrets();

      const state = await database.getState();
      expect(state.ui).toEqual({ theme: 'light', activeView: 'history', themePreferenceVersion: 1 });
      expect(state.config.ui.theme).toBe('light');
      expect(JSON.parse(await readFile(configFilePath(dir), 'utf8')).ui.theme).toBe('light');
    } finally {
      await database.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps a marker-present database theme authoritative over an external legacy config', async () => {
    const module = await loadConfigService();
    expect(module).not.toBeNull();
    if (!module) return;
    const dir = await mkdtemp(join(tmpdir(), 'storydream-theme-config-migration-'));
    const database = await FileDatabase.open(join(dir, 'data.db'));
    const vault = new CredentialVault(join(dir, 'secrets.v1.json'), fakeEncryption());
    try {
      await database.upsertUiPreferences({ activeView: 'history' });
      await writeFile(configFilePath(dir), JSON.stringify({
        ...structuredClone(defaultConfig),
        ui: { theme: 'light' },
      }), 'utf8');

      const service = new module.ConfigService({ database, dataDir: dir, vault });
      await service.migrateLegacySecrets();

      const state = await database.getState();
      expect(state.ui).toEqual({ theme: 'dark', activeView: 'history', themePreferenceVersion: 1 });
      expect(state.config.ui.theme).toBe('dark');
      expect(JSON.parse(await readFile(configFilePath(dir), 'utf8')).ui.theme).toBe('dark');
    } finally {
      await database.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('moves SQLite and JSON secrets into the encrypted vault, returns public state, and is idempotent', async () => {
    const module = await loadConfigService();
    expect(module).not.toBeNull();
    if (!module) return;
    const dir = await mkdtemp(join(tmpdir(), 'storydream-config-migration-'));
    const databasePath = join(dir, 'data.db');
    const vaultPath = join(dir, 'secrets.v1.json');
    const jsonConfig = { ...configWithLlmSecret(''), ima: { ...defaultConfig.ima, apiKey: 'json-legacy-secret' } };
    const database = await seedLegacyDatabase(databasePath, configWithLlmSecret('db-legacy-secret'));
    try {
      await writeFile(configFilePath(dir), JSON.stringify(jsonConfig, null, 2), 'utf8');
      const vault = new CredentialVault(vaultPath, fakeEncryption());
      const service = new module.ConfigService({ database, dataDir: dir, vault });

      await service.migrateLegacySecrets();

      const vaultText = await readFile(vaultPath, 'utf8');
      const configText = await readFile(configFilePath(dir), 'utf8');
      expect(vaultText).not.toContain('db-legacy-secret');
      expect(vaultText).not.toContain('json-legacy-secret');
      expect(configText).not.toContain('db-legacy-secret');
      expect(configText).not.toContain('json-legacy-secret');
      expect(JSON.stringify((await database.getState()).config)).not.toContain('legacy-secret');

      const publicState = await service.getPublicState();
      expect(publicState.secretStatus['llm/default-llm/apiKey']).toBe(true);
      expect(publicState.secretStatus['ima/apiKey']).toBe(true);
      expect(publicState.config.llm.apiKey).toBe('');
      expect(publicState.config.ima.apiKey).toBe('');
      const runtimeConfig = await service.getRuntimeConfig();
      expect(runtimeConfig.llm.apiKey).toBe('db-legacy-secret');
      expect(runtimeConfig.ima.apiKey).toBe('json-legacy-secret');

      const beforeSecondRun = await readFile(vaultPath, 'utf8');
      await service.migrateLegacySecrets();
      expect(await readFile(vaultPath, 'utf8')).toBe(beforeSecondRun);
      await expect(access(module.configMigrationMarkerPath(dir))).resolves.toBeUndefined();
      expect((await readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    } finally {
      await database.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('infers a versionless Volcengine profile from vault-only credentials without overriding explicit legacy', async () => {
    const module = await loadConfigService();
    expect(module).not.toBeNull();
    if (!module) return;
    const dir = await mkdtemp(join(tmpdir(), 'storydream-volcengine-vault-version-'));
    const databasePath = join(dir, 'data.db');
    const vault = new CredentialVault(join(dir, 'secrets.v1.json'), fakeEncryption());
    const database = await seedLegacyDatabase(databasePath, configWithVaultOnlyVolcengineProfiles());
    try {
      await vault.save({
        'tts/vault-only-v3/volcengine/apiKey': 'vault-only-v3-key',
        'tts/explicit-legacy/volcengine/apiKey': 'stored-but-not-selected-v3-key',
      });
      const service = new module.ConfigService({ database, dataDir: dir, vault });

      const publicState = await service.getPublicState();
      expect(publicState.config.tts.volcengine.apiVersion).toBe('v3');
      expect(publicState.config.tts.volcengine.apiKey).toBe('');
      expect(publicState.config.ttsProfiles.find((profile) => profile.id === 'vault-only-v3')?.volcengine?.apiVersion).toBe('v3');
      expect(publicState.config.ttsProfiles.find((profile) => profile.id === 'explicit-legacy')?.volcengine?.apiVersion).toBe('legacy');

      const previewConfig = await service.getRuntimeConfigFor({ config: publicState.config, secretChanges: {} });
      expect(previewConfig.tts.volcengine.apiVersion).toBe('v3');
      expect(previewConfig.tts.volcengine.apiKey).toBe('vault-only-v3-key');

      await service.save({ config: publicState.config, secretChanges: {} });
      const runtimeConfig = await service.getRuntimeConfig();
      expect(runtimeConfig.tts.volcengine.apiVersion).toBe('v3');
      expect(runtimeConfig.tts.volcengine.apiKey).toBe('vault-only-v3-key');
      expect(runtimeConfig.ttsProfiles.find((profile) => profile.id === 'explicit-legacy')?.volcengine?.apiVersion).toBe('legacy');
    } finally {
      await database.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('leaves legacy SQLite and JSON values untouched when the vault write fails', async () => {
    const module = await loadConfigService();
    expect(module).not.toBeNull();
    if (!module) return;
    const dir = await mkdtemp(join(tmpdir(), 'storydream-config-migration-fail-'));
    const databasePath = join(dir, 'data.db');
    const legacy = configWithLlmSecret('must-remain-legacy-secret');
    const database = await seedLegacyDatabase(databasePath, legacy);
    try {
      await writeFile(configFilePath(dir), JSON.stringify(legacy, null, 2), 'utf8');
      const service = new module.ConfigService({
        database,
        dataDir: dir,
        vault: {
          load: async () => ({}),
          save: async () => {
            throw new Error('injected vault failure');
          },
        },
      });

      await expect(service.migrateLegacySecrets()).rejects.toThrow(/injected vault failure/);
      expect(JSON.stringify((await database.getState()).config)).toContain('must-remain-legacy-secret');
      expect(await readFile(configFilePath(dir), 'utf8')).toContain('must-remain-legacy-secret');
      await expect(access(module.configMigrationMarkerPath(dir))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await database.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not mark malformed legacy JSON as migrated or clear the database', async () => {
    const module = await loadConfigService();
    expect(module).not.toBeNull();
    if (!module) return;
    const dir = await mkdtemp(join(tmpdir(), 'storydream-config-migration-invalid-'));
    const databasePath = join(dir, 'data.db');
    const database = await seedLegacyDatabase(databasePath, configWithLlmSecret('database-secret-must-remain'));
    try {
      await writeFile(configFilePath(dir), '{"apiKey":"json-secret-must-remain"', 'utf8');
      const service = new module.ConfigService({
        database,
        dataDir: dir,
        vault: new CredentialVault(join(dir, 'secrets.v1.json'), fakeEncryption()),
      });

      await expect(service.migrateLegacySecrets()).rejects.toThrow(/CONFIG_FILE_INVALID/);
      expect(JSON.stringify((await database.getState()).config)).toContain('database-secret-must-remain');
      expect(await readFile(configFilePath(dir), 'utf8')).toContain('json-secret-must-remain');
      await expect(access(module.configMigrationMarkerPath(dir))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await database.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('preserves untouched secrets, replaces explicit values, and clears only null changes', async () => {
    const module = await loadConfigService();
    expect(module).not.toBeNull();
    if (!module) return;
    const dir = await mkdtemp(join(tmpdir(), 'storydream-config-save-'));
    const databasePath = join(dir, 'data.db');
    const vault = new CredentialVault(join(dir, 'secrets.v1.json'), fakeEncryption());
    const database = await seedLegacyDatabase(databasePath, configWithLlmSecret('saved-secret'));
    try {
      const service = new module.ConfigService({ database, dataDir: dir, vault });
      await service.migrateLegacySecrets();
      const publicState = await service.getPublicState();

      await service.save({ config: { ...publicState.config, activeLlmProfileId: 'default-llm' }, secretChanges: {} });
      expect((await service.getRuntimeConfig()).llm.apiKey).toBe('saved-secret');

      await service.save({
        config: (await service.getPublicState()).config,
        secretChanges: { 'llm/default-llm/apiKey': 'replacement-secret' },
      });
      expect((await service.getRuntimeConfig()).llm.apiKey).toBe('replacement-secret');

      const cleared = await service.save({
        config: (await service.getPublicState()).config,
        secretChanges: { 'llm/default-llm/apiKey': null },
      });
      expect((await service.getRuntimeConfig()).llm.apiKey).toBe('');
      expect(cleared.secretStatus['llm/default-llm/apiKey']).toBeFalsy();
      expect(await readFile(configFilePath(dir), 'utf8')).not.toContain('replacement-secret');
    } finally {
      await database.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('defensively strips secrets from normal JSON config persistence', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-config-file-redaction-'));
    try {
      await saveConfigToFile(dir, configWithLlmSecret('must-never-reach-config-json'));
      expect(await readFile(configFilePath(dir), 'utf8')).not.toContain('must-never-reach-config-json');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
