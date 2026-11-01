import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { access, readFile } from 'node:fs/promises';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const CONFIG_DIR = path.join(ROOT, 'config');
export const CATALOG_PATH = path.join(DATA_DIR, 'catalog.json');
export const HEALTH_PATH = path.join(DATA_DIR, 'health.json');

const EXAMPLE_CONFIG_PATH = path.join(CONFIG_DIR, 'providers.example.json');
const USER_CONFIG_PATH = path.join(CONFIG_DIR, 'providers.json');

export async function loadConfig() {
  const configPath = await exists(USER_CONFIG_PATH) ? USER_CONFIG_PATH : EXAMPLE_CONFIG_PATH;
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  return {
    ...config,
    configPath,
    listen: {
      host: process.env.FREE_API_HOST || config.listen?.host || '127.0.0.1',
      port: Number(process.env.FREE_API_PORT || config.listen?.port || 8787),
    },
    selection: {
      maxAttempts: Number(process.env.FREE_API_MAX_ATTEMPTS || config.selection?.maxAttempts || 3),
      cooldownMs: Number(process.env.FREE_API_COOLDOWN_MS || config.selection?.cooldownMs || 30000),
    },
    sync: {
      intervalMs: Number(process.env.FREE_API_SYNC_INTERVAL_MS || config.sync?.intervalMs || 21600000),
    },
  };
}

export async function loadCatalog() {
  try {
    return JSON.parse(await readFile(CATALOG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

export async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
