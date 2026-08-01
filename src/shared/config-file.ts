import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rename, rm } from 'node:fs/promises';
import type { AppConfig } from './types';
import { normalizeAppConfig } from './config-utils';
import { defaultConfig } from './config';
import { stripConfigSecrets } from './config-secrets';

const CONFIG_FILENAME = 'config.json';

export function configFilePath(dataDir: string): string {
  return join(dataDir, CONFIG_FILENAME);
}

export async function loadConfigFromFile(dataDir: string): Promise<AppConfig | null> {
  try {
    return await loadConfigFromFileStrict(dataDir);
  } catch {
    return null;
  }
}

export async function loadConfigFromFileStrict(dataDir: string): Promise<AppConfig | null> {
  const filePath = configFilePath(dataDir);
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('CONFIG_FILE_READ_FAILED: Configuration file could not be read.');
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid config root.');
    return normalizeAppConfig(parsed);
  } catch {
    throw new Error('CONFIG_FILE_INVALID: Configuration file is not valid JSON.');
  }
}

export async function saveConfigToFile(dataDir: string, config: AppConfig): Promise<void> {
  const filePath = configFilePath(dataDir);
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  const serialized = `${JSON.stringify(stripConfigSecrets(normalizeAppConfig(config)), null, 2)}\n`;
  try {
    await writeFile(tempPath, serialized, { encoding: 'utf8', flag: 'wx' });
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writeDefaultConfigFile(dataDir: string): Promise<void> {
  const filePath = configFilePath(dataDir);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(stripConfigSecrets(defaultConfig), null, 2), 'utf-8');
}
