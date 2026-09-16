import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { AppConfig, ConfigTestResult, MusicProviderProfile } from '../src/shared/types';
import type { MusicServiceStatus } from '../src/shared/music-lab';
import { createMusicProvider, normalizeMusicApiBaseUrl, SUNO_API_ORIGIN } from '../src/shared/music-provider';
import { createMusicLabRuntime } from './music-lab-runtime';
import { createMusicVoiceRuntime } from './music-voice-runtime';
import { createMusicEnhancedRuntime } from './music-enhanced-runtime';

interface Options {
  dataDir: string;
  getConfig: () => Promise<AppConfig>;
  resolveEnvironmentApiKey: () => Promise<string>;
  fetchImpl?: typeof fetch;
  autoPoll?: boolean;
  assertByok?: () => Promise<void>;
}

export function musicProfileStorageDirectory(dataDir: string, family: string, profile: MusicProviderProfile): string {
  const origin = normalizeMusicApiBaseUrl(profile.baseUrl);
  if (profile.id === 'default-music' && origin === SUNO_API_ORIGIN) return join(dataDir, family);
  // IDs and endpoints never become path segments directly; changing sites gets a separate history.
  const identity = createHash('sha256').update(`${profile.id}\n${origin}`).digest('hex');
  return join(dataDir, family, 'profiles', identity);
}

export function createMusicProfileService(options: Options) {
  const contexts = new Map<string, ReturnType<typeof createContext>>();
  function profileFrom(config: AppConfig): MusicProviderProfile {
    const profile = config.music.profiles.find((item) => item.id === config.music.activeProfileId);
    if (!profile) throw new Error('请先在系统设置中选择音乐配置。');
    return { ...profile, baseUrl: normalizeMusicApiBaseUrl(profile.baseUrl) };
  }
  async function keyFor(profile: MusicProviderProfile): Promise<string> {
    if (!profile.useEnvironmentKey) return profile.apiKey.trim();
    if (profile.baseUrl !== SUNO_API_ORIGIN) throw new Error('已登记的系统密钥只能用于 Suno-API 原站；其它地址请填写独立密钥。');
    return (await options.resolveEnvironmentApiKey()).trim();
  }
  function createContext(profile: MusicProviderProfile) {
    const original = { ...profile };
    const resolveApiKey = async () => {
      const current = (await options.getConfig()).music.profiles.find((item) => item.id === original.id);
      // A different active profile or edited endpoint must never redirect an existing paid job.
      let sameSite = false;
      try { sameSite = !!current && normalizeMusicApiBaseUrl(current.baseUrl) === original.baseUrl; } catch { /* Use original job binding. */ }
      return keyFor(current && sameSite ? { ...current, baseUrl: original.baseUrl } : original);
    };
    const common = { dataDir: options.dataDir, baseUrl: original.baseUrl, resolveApiKey, fetchImpl: options.fetchImpl };
    const lab = createMusicLabRuntime({ ...common, autoPoll: options.autoPoll, storageDirectory: musicProfileStorageDirectory(options.dataDir, 'music-lab', original) });
    const voice = createMusicVoiceRuntime({ ...common, storageDirectory: musicProfileStorageDirectory(options.dataDir, 'music-voices', original), onSongsReady: (ids, model) => lab.importSongs(ids, model) });
    const enhanced = createMusicEnhancedRuntime({ ...common, storageDirectory: musicProfileStorageDirectory(options.dataDir, 'music-enhanced', original), onSongsReady: (ids) => lab.importSongs(ids) });
    return { profile: original, lab, voice, enhanced };
  }
  async function active(requireEnabled = true) {
    if (requireEnabled) await options.assertByok?.();
    const config = await options.getConfig();
    if (requireEnabled && !config.music.enabled) throw new Error('音乐生成服务已停用，请在系统设置中启用。');
    const profile = profileFrom(config);
    const id = `${profile.id}\n${profile.baseUrl}`;
    let context = contexts.get(id);
    if (!context) { context = createContext(profile); contexts.set(id, context); }
    return context;
  }
  return {
    active,
    async getServiceStatus(): Promise<MusicServiceStatus> {
      const config = await options.getConfig();
      const profile = config.music.profiles.find((item) => item.id === config.music.activeProfileId);
      const metadata = { providerName: profile?.name || 'Suno-API', profileId: profile?.id, defaultModel: profile?.model, enabled: config.music.enabled };
      try {
        const normalized = profileFrom(config);
        return { ...metadata, configured: config.music.enabled && !!(await keyFor(normalized)) };
      } catch (error) { return { ...metadata, configured: false, errorMessage: error instanceof Error ? error.message : '音乐服务配置无效。' }; }
    },
    async testConfiguration(config: AppConfig): Promise<ConfigTestResult> {
      const started = Date.now();
      const requestId = randomUUID();
      let endpoint = '';
      try {
        const profile = profileFrom(config);
        endpoint = `${profile.baseUrl}/api/user/balance`;
        const apiKey = await keyFor(profile);
        if (!apiKey) return { target: 'music', status: 'fail', endpoint, requestId, detail: '请填写此配置的 API Key，或选择已登记的系统密钥。', latencyMs: Date.now() - started };
        const balance = await createMusicProvider({ apiKey, baseUrl: profile.baseUrl, fetchImpl: options.fetchImpl }).getBalance();
        return { target: 'music', status: 'pass', endpoint, requestId, detail: `${profile.name} 连接成功，余额 ¥${balance.balance.toFixed(2)}。仅查询余额，未提交音乐生成。`, latencyMs: Date.now() - started };
      } catch (error) {
        return { target: 'music', status: 'fail', endpoint, requestId, detail: error instanceof Error ? error.message : '音乐服务测试失败。', latencyMs: Date.now() - started };
      }
    },
    close() { for (const context of contexts.values()) context.lab.close(); contexts.clear(); },
  };
}
