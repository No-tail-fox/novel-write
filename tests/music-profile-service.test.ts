import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../src/shared/config';
import { normalizeAppConfig } from '../src/shared/config-utils';
import type { MusicGenerateInput } from '../src/shared/music-lab';
import { createMusicProfileService, musicProfileStorageDirectory } from '../electron/music-profile-service';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
const input: MusicGenerateInput = { mode: 'description', model: 'suno-v6', description: '测试旋律', instrumental: true, maxMode: false, variety: 0 };

async function setup() {
  const dataDir = await mkdtemp(join(tmpdir(), 'music-profiles-'));
  const config = normalizeAppConfig({ ...defaultConfig, music: { enabled: true, activeProfileId: 'a', profiles: [
    { ...defaultConfig.music.profiles[0], id: 'a', name: '音乐 A', apiKey: 'test-key-a', useEnvironmentKey: false, baseUrl: 'https://music-a.example' },
    { ...defaultConfig.music.profiles[0], id: 'b', name: '音乐 B', apiKey: 'test-key-b', useEnvironmentKey: false, baseUrl: 'https://music-b.example', model: 'suno-v6-mini' },
  ] } });
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url) => new Response(JSON.stringify(String(url).endsWith('/balance') ? { balance: 12 } : [
    { id: 'cloud-song', status: 'processing', title: '测试' },
  ]), { headers: { 'Content-Type': 'application/json' } }));
  const resolveEnvironmentApiKey = vi.fn(async () => 'environment-test-key');
  const service = createMusicProfileService({ dataDir, getConfig: async () => config, resolveEnvironmentApiKey, fetchImpl, autoPoll: false });
  cleanup.push(async () => { service.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { dataDir, config, fetchImpl, resolveEnvironmentApiKey, service };
}

describe('active music profile service', () => {
  it('switches new work and keeps existing work bound to its original service and credentials', async () => {
    const { config, fetchImpl, service } = await setup();
    const a = await service.active();
    const record = await a.lab.generate(input);
    config.music.activeProfileId = 'b';
    const b = await service.active();
    expect(b).not.toBe(a);
    await b.lab.getBalance();
    await a.lab.refresh(record.id);
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      'https://music-a.example/api/music/create', 'https://music-b.example/api/user/balance', 'https://music-a.example/api/music/query',
    ]);
    expect(fetchImpl.mock.calls.map(([, options]) => new Headers(options?.headers).get('Authorization'))).toEqual(['Bearer test-key-a', 'Bearer test-key-b', 'Bearer test-key-a']);
    expect(await b.lab.list()).toEqual([]);
    expect((await a.lab.list()).map((item) => item.id)).toEqual([record.id]);
    const status = await service.getServiceStatus();
    expect(status).toMatchObject({ configured: true, profileId: 'b', providerName: '音乐 B', defaultModel: 'suno-v6-mini' });
    expect(JSON.stringify(status)).not.toContain('test-key');
  });

  it('isolates endpoint edits from existing paid job contexts', async () => {
    const { config, service, fetchImpl } = await setup();
    const original = await service.active();
    config.music.profiles[0].baseUrl = 'https://changed.example';
    config.music.profiles[0].apiKey = 'changed-test-key';
    const changed = await service.active();
    await original.lab.getBalance();
    await changed.lab.getBalance();
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual(['https://music-a.example/api/user/balance', 'https://changed.example/api/user/balance']);
    expect(new Headers(fetchImpl.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer test-key-a');
    expect(new Headers(fetchImpl.mock.calls[1][1]?.headers).get('Authorization')).toBe('Bearer changed-test-key');
  });

  it('blocks new work when disabled but still permits local history', async () => {
    const { config, service, fetchImpl } = await setup();
    config.music.enabled = false;
    await expect(service.active()).rejects.toThrow('已停用');
    expect(await (await service.active(false)).lab.list()).toEqual([]);
    expect(await service.getServiceStatus()).toMatchObject({ configured: false, enabled: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('tests a selected standby profile with only a free balance request and does not activate it', async () => {
    const { config, service, fetchImpl } = await setup();
    const selected = { ...config, music: { ...config.music, activeProfileId: 'b' } };
    expect(await service.testConfiguration(selected)).toMatchObject({ target: 'music', status: 'pass' });
    expect(config.music.activeProfileId).toBe('a');
    expect(fetchImpl.mock.calls).toHaveLength(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://music-b.example/api/user/balance');
    expect(fetchImpl.mock.calls[0][1]?.method).toBe('GET');
  });

  it('never resolves or sends the registered environment key to a custom site', async () => {
    const { config, service, resolveEnvironmentApiKey, fetchImpl } = await setup();
    config.music.profiles[0].useEnvironmentKey = true;
    expect(await service.testConfiguration(config)).toMatchObject({ status: 'fail' });
    expect(await service.getServiceStatus()).toMatchObject({ configured: false });
    expect(resolveEnvironmentApiKey).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    config.music.profiles[0].baseUrl = 'https://www.suno-api.io';
    expect(await service.testConfiguration(config)).toMatchObject({ status: 'pass' });
    expect(new Headers(fetchImpl.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer environment-test-key');
  });

  it('preserves legacy history and hashes profile and endpoint into safe separate directories', async () => {
    const { dataDir } = await setup();
    const profile = defaultConfig.music.profiles[0];
    expect(musicProfileStorageDirectory(dataDir, 'music-lab', profile)).toBe(join(dataDir, 'music-lab'));
    const custom = { ...profile, id: '../../other' };
    const location = musicProfileStorageDirectory(dataDir, 'music-lab', custom);
    expect(location).toMatch(/[\\/]profiles[\\/][a-f0-9]{64}$/);
    expect(location.startsWith(join(dataDir, 'music-lab', 'profiles'))).toBe(true);
    expect(musicProfileStorageDirectory(dataDir, 'music-lab', { ...custom, baseUrl: 'https://another.example' })).not.toBe(location);
  });
});
