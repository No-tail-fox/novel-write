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
