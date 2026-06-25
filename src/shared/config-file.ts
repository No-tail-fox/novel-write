import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AppConfig } from './types';
import { normalizeAppConfig } from './config-utils';
import { defaultConfig } from './config';

const CONFIG_FILENAME = 'config.json';

export function configFilePath(dataDir: string): string {
  return join(dataDir, CONFIG_FILENAME);
}

export async function loadConfigFromFile(dataDir: string): Promise<AppConfig | null> {
  const filePath = configFilePath(dataDir);
  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return normalizeAppConfig(parsed);
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveConfigToFile(dataDir: string, config: AppConfig): Promise<void> {
  const filePath = configFilePath(dataDir);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');
}

export async function writeDefaultConfigFile(dataDir: string): Promise<void> {
  const filePath = configFilePath(dataDir);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
}
