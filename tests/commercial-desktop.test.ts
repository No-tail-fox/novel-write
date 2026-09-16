import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCommercialService } from '../electron/commercial-service';
import { canonicalDocument, createPlatformUpdateService } from '../electron/platform-update-service';
import type { UpdateManifest } from '../src/shared/commercial-contract';

const directories: string[] = [];
async function directory() { const dir = await mkdtemp(join(tmpdir(), 'commercial-desktop-')); directories.push(dir); return dir; }
afterEach(async () => { await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from([...Buffer.from(value)].map((byte) => byte ^ 0xa5)),
  decryptString: (value: Buffer) => Buffer.from([...value].map((byte) => byte ^ 0xa5)).toString(),
};
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
const catalog = [{ id: 'music-v6', name: 'Music', capability: 'music', operation: 'generate', priceUnits: '100000', unit: 'request', status: 'available', version: '1', description: 'Music model' }];
const publicConfig = { environment: 'development', paymentAvailable: false, catalog };
function fixture() {
  let publicKey = ''; const requests: { path: string; init: RequestInit }[] = [];
  let override: ((path: string, init: RequestInit) => Promise<Response | undefined>) | undefined;
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)), request = init!; requests.push({ path: url.pathname, init: request });
    const body = request.body ? JSON.parse(String(request.body)) : undefined;
    if (url.pathname.endsWith('/auth/verify')) publicKey = body.device.publicKey;
    if (publicKey) {
      const headers = new Headers(request.headers), payload = [request.method, url.pathname + url.search, headers.get('X-Device-Timestamp'), headers.get('X-Device-Nonce'), createHash('sha256').update(String(request.body ?? '')).digest('hex')].join('\n');
      expect(verify(null, Buffer.from(payload), publicKey, Buffer.from(headers.get('X-Device-Signature')!, 'base64'))).toBe(true);
    }
    const supplied = await override?.(url.pathname, request); if (supplied) return supplied;
    if (url.pathname === '/v1/public/config') return response(publicConfig);
    if (url.pathname === '/v1/auth/challenges') return response({ challengeId: 'challenge', expiresAt: new Date(Date.now() + 300000).toISOString(), retryAfter: 60, developmentCode: '123456' });
    if (url.pathname === '/v1/auth/verify') return response({ accessToken: `access-${body.code}`, refreshToken: `refresh-${body.code}`, userId: body.code, expiresAt: new Date(Date.now() + 3600000).toISOString(), extraServerSecret: 'never-return' });
    if (url.pathname === '/v1/auth/logout') return response({ ok: true });
    if (url.pathname === '/v1/me/snapshot') {
      const id = new Headers(request.headers).get('authorization')!.replace('Bearer access-', '').replace('new-', '');
      return response({ user: { id, displayName: 'Test', phone: '138****0000', refreshToken: 'hidden' }, wallet: { availableUnits: '100000', reservedUnits: '0', frozenUnits: '0', revision: '1', secret: 'hidden' }, license: null, devices: [], accessToken: 'never-render' });
    }
    if (url.pathname === '/v1/wallet/transactions') return response([]);
    if (url.pathname === '/v1/jobs') return response([]);
    throw new Error(`Unhandled path ${url.pathname}`);
  }) as unknown as typeof fetch;
  return { fetchImpl, requests, setOverride(value: typeof override) { override = value; } };
}
async function loggedIn(f = fixture(), dataDir?: string) {
  const dir = dataDir ?? await directory();
  const service = createCommercialService({ dataDir: dir, appVersion: '1.0.0', baseUrl: 'https://platform.example', safeStorage, fetchImpl: f.fetchImpl });
  await service.login({ challengeId: 'challenge', code: '111111' }); return { service, fixture: f, dir };
}

describe('commercial desktop account isolation', () => {
  it('fails closed without service configuration and rejects non-HTTPS remote endpoints', async () => {
    const dataDir = await directory(), fetchImpl = vi.fn();
    const unconfigured = createCommercialService({ dataDir, appVersion: '1.0.0', safeStorage, fetchImpl });
    expect(await unconfigured.getSnapshot()).toMatchObject({ configured: false, wallet: null, license: null });
    await expect(unconfigured.sendCode('13800000000')).rejects.toThrow('PLATFORM_UNCONFIGURED');
    const insecure = createCommercialService({ dataDir, appVersion: '1.0.0', baseUrl: 'http://example.com', safeStorage, fetchImpl, allowInsecureLoopback: true });
    expect((await insecure.getSnapshot()).configured).toBe(false); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('encrypts sessions and installation keys, signs requests and never returns token fields', async () => {
    const { service, dir } = await loggedIn();
    const snapshot = await service.getSnapshot();
    expect(snapshot.user?.id).toBe('111111');
    const serialized = JSON.stringify(snapshot);
    for (const value of ['accessToken', 'refreshToken', 'privateKey', 'never-render', 'hidden']) expect(serialized).not.toContain(value);
    const file = await readFile(join(dir, 'auth.v1.json'), 'utf8');
    expect(file).not.toContain('access-111111'); expect(file).not.toContain('PRIVATE KEY');
  });
  it('never writes credentials or calls the service when OS encryption is unavailable', async () => {
    const dataDir = await directory(), fetchImpl = vi.fn();
    const service = createCommercialService({ dataDir, appVersion: '1.0.0', baseUrl: 'https://platform.example', safeStorage: { ...safeStorage, isEncryptionAvailable: () => false }, fetchImpl });
    await expect(service.login({ challengeId: 'challenge', code: '111111' })).rejects.toThrow('AUTH_ENCRYPTION_UNAVAILABLE');
    expect(fetchImpl).not.toHaveBeenCalled(); expect(await readdir(dataDir)).toEqual([]);
  });
  it('does not expose development OTP on production services', async () => {
    const { service } = await loggedIn(); expect((await service.sendCode('13800000000')).developmentCode).toBeUndefined();
  });
  it('rejects a late old-account snapshot and keeps profiles private to each account', async () => {
    const { service, fixture: f } = await loggedIn();
    await service.saveModelProfile({ id: 'my-local', name: 'Private profile', capability: 'music', source: 'byok', modelId: '', localProfileId: 'local-only' });
    await service.activateModelProfile('my-local');
    const started = deferred<void>(), late = deferred<Response>(); let hold = true;
    f.setOverride(async (path, init) => { if (path === '/v1/me/snapshot' && new Headers(init.headers).get('authorization') === 'Bearer access-111111' && hold) { started.resolve(); return late.promise; } return undefined; });
    const pending = service.getSnapshot(); const rejection = expect(pending).rejects.toThrow('ACCOUNT_CHANGED');
    await started.promise; await service.logout(); hold = false;
    expect((await service.login({ challengeId: 'challenge', code: '222222' })).profiles.profiles).toHaveLength(0);
    late.resolve(response({})); await rejection;
    expect((await service.getSnapshot()).user?.id).toBe('222222');
    const again = await service.login({ challengeId: 'challenge', code: '111111' });
    expect(again.profiles.active.music).toBe('my-local');
    expect(f.requests.filter((r) => String(r.init.body).includes('local-only'))).toHaveLength(0);
  });
  it('shares one refresh across simultaneous requests and reuses a persisted refresh operation after uncertain network failure', async () => {
    const { service, fixture: f } = await loggedIn(); let refreshes = 0;
    const keys: string[] = []; let fail = true;
    f.setOverride(async (path, init) => {
      const headers = new Headers(init.headers);
      if (path === '/v1/wallet/transactions' && headers.get('authorization') === 'Bearer access-111111') return response({ error: { code: 'AUTH_REQUIRED' } }, 401);
      if (path === '/v1/auth/refresh') {
        refreshes++; keys.push(headers.get('idempotency-key')!);
        if (fail) { fail = false; throw new Error('connection reset'); }
        return response({ accessToken: 'access-new-111111', refreshToken: 'refresh-next', userId: '111111', expiresAt: new Date(Date.now() + 3600000).toISOString() });
      }
      return undefined;
    });
    await expect(service.listTransactions()).rejects.toThrow('PLATFORM_NETWORK_ERROR');
    await Promise.all([service.listTransactions(), service.listTransactions(), service.listTransactions()]);
    expect(refreshes).toBe(2); expect(keys[0]).toBe(keys[1]);
  });
  it('discards a late refresh after switching accounts', async () => {
    const { service, fixture: f } = await loggedIn(); const started = deferred<void>(), delayed = deferred<Response>();
    f.setOverride(async (path, init) => {
      if (path === '/v1/wallet/transactions' && new Headers(init.headers).get('authorization') === 'Bearer access-111111') return response({ error: { code: 'AUTH_REQUIRED' } }, 401);
      if (path === '/v1/auth/refresh') { started.resolve(); return delayed.promise; }
      return undefined;
    });
    const pending = service.listTransactions(); const rejection = expect(pending).rejects.toThrow('ACCOUNT_CHANGED');
    await started.promise; await service.login({ challengeId: 'challenge', code: '222222' });
    delayed.resolve(response({ accessToken: 'access-new-111111', refreshToken: 'refresh-late', userId: '111111', expiresAt: new Date(Date.now() + 3600000).toISOString() }));
    await rejection; expect((await service.getSnapshot()).user?.id).toBe('222222');
  });
  it('requires explicit model activation and does not upload BYOK secrets', async () => {
    const { service, fixture: f } = await loggedIn();
    const profile = { id: 'p1', name: 'Music', capability: 'music' as const, source: 'platform' as const, modelId: 'music-v6' };
    expect((await service.saveModelProfile(profile)).active.music).toBeUndefined();
    expect((await service.activateModelProfile('p1')).active.music).toBe('p1');
    expect((await service.saveModelProfile({ ...profile, name: 'Edited' })).active.music).toBeUndefined();
    await expect(service.saveModelProfile({ ...profile, apiKey: 'secret' } as typeof profile)).rejects.toThrow();
    expect(f.requests.some((r) => String(r.init.body).includes('secret'))).toBe(false);
  });
  it('checks artifact owner, exact length and checksum and contains filenames inside the account folder', async () => {
    const { service, fixture: f, dir } = await loggedIn(); const content = Buffer.from('music artifact'); let corrupt = false;
    f.setOverride(async (path) => {
      if (path === '/v1/jobs') return response([{ id: 'job1', modelId: 'music-v6', state: 'succeeded_settled', reservedUnits: '1000', settledUnits: '1000', createdAt: new Date().toISOString(), artifacts: [{ id: 'a1', name: '../../outside.mp3', mime: 'audio/mpeg', size: content.length, sha256: createHash('sha256').update(content).digest('hex') }] }]);
      if (path === '/v1/artifacts/a1') return new Response(corrupt ? Buffer.alloc(content.length) : content);
      return undefined;
    });
    await expect(service.downloadArtifact('unknown')).rejects.toThrow('ARTIFACT_NOT_FOUND');
    const result = await service.downloadArtifact('a1'); expect(result.path.startsWith(join(dir, 'artifacts'))).toBe(true); expect(await readFile(result.path)).toEqual(content);
    corrupt = true; await expect(service.downloadArtifact('a1')).rejects.toThrow('DOWNLOAD_HASH_MISMATCH');
    const ownerDirs = await readdir(join(dir, 'artifacts')); expect((await readdir(join(dir, 'artifacts', ownerDirs[0]))).filter((name) => name.endsWith('.part'))).toHaveLength(0);
  });
  it('cancels an artifact stream when its account is switched', async () => {
    const { service, fixture: f, dir } = await loggedIn(); const content = Buffer.from('private song'), reading = deferred<void>();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    f.setOverride(async (path) => {
      if (path === '/v1/jobs') return response([{ id: 'job1', modelId: 'music-v6', state: 'succeeded_settled', reservedUnits: '1000', settledUnits: '1000', createdAt: new Date().toISOString(), artifacts: [{ id: 'a1', name: 'song.mp3', mime: 'audio/mpeg', size: content.length, sha256: createHash('sha256').update(content).digest('hex') }] }]);
      if (path === '/v1/artifacts/a1') return new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; }, pull() { reading.resolve(); } }));
      return undefined;
    });
    const pending = service.downloadArtifact('a1'), rejection = expect(pending).rejects.toThrow('ACCOUNT_CHANGED');
    await reading.promise; await service.login({ challengeId: 'challenge', code: '222222' }); controller.enqueue(content); controller.close();
    await rejection;
    const owners = await readdir(join(dir, 'artifacts')); expect(await readdir(join(dir, 'artifacts', owners[0]))).toEqual([]);
  });
});

function releaseFixture() {
  const keys = generateKeyPairSync('ed25519'); const content = Buffer.from('signed complete package');
  const publicKey = keys.publicKey.export({ format: 'pem', type: 'spki' }).toString();
  function manifest(overrides: Partial<UpdateManifest> = {}): UpdateManifest {
    const unsigned = { version: '1.1.0', platform: process.platform, arch: process.arch, channel: 'stable' as const, publishedAt: '2026-01-01T00:00:00.000Z', releaseNotes: 'Verified update', url: 'https://cdn.example/StoryDream.zip', sha256: createHash('sha256').update(content).digest('hex'), size: content.length, minAppVersion: '1.0.0', keyId: 'release-1', ...overrides };
    const { signature: _, ...payload } = unsigned as UpdateManifest;
    return { ...payload, signature: sign(null, Buffer.from(canonicalDocument(payload)), keys.privateKey).toString('base64') };
  }
  return { content, publicKey, manifest };
}
describe('commercial desktop signed E1 updates', () => {
  it('fails closed without a trust root and rejects wrong signatures and origins', async () => {
    const f = releaseFixture(), dataDir = await directory(); let manifest = f.manifest();
    const getManifest = async () => manifest;
    const missing = createPlatformUpdateService({ dataDir, appVersion: '1.0.0', getManifest });
    expect((await missing.checkUpdate('stable')).status).toBe('unconfigured');
    const service = createPlatformUpdateService({ dataDir, appVersion: '1.0.0', getManifest, updatePublicKeys: { 'release-1': f.publicKey }, allowedDownloadOrigins: ['https://cdn.example'] });
    manifest = { ...manifest, version: '1.2.0' }; await expect(service.checkUpdate('stable')).rejects.toThrow('UPDATE_SIGNATURE_INVALID');
    manifest = f.manifest({ url: 'https://evil.example/update.zip' }); await expect(service.checkUpdate('stable')).rejects.toThrow('UPDATE_ORIGIN_REJECTED');
  });
  it('rejects downgrade, same-version replacement and replay across restarts', async () => {
    const f = releaseFixture(), dataDir = await directory(); let manifest = f.manifest({ version: '1.3.0' });
    const options = { dataDir, appVersion: '1.0.0', getManifest: async () => manifest, updatePublicKeys: { 'release-1': f.publicKey }, allowedDownloadOrigins: ['https://cdn.example'] };
    await createPlatformUpdateService(options).checkUpdate('stable');
    manifest = f.manifest({ version: '1.2.0' }); await expect(createPlatformUpdateService(options).checkUpdate('stable')).rejects.toThrow('UPDATE_REPLAY_REJECTED');
    manifest = f.manifest({ version: '1.3.0', releaseNotes: 'Changed after publication' }); await expect(createPlatformUpdateService(options).checkUpdate('stable')).rejects.toThrow('UPDATE_REPLAY_REJECTED');
    manifest = f.manifest({ version: '0.9.0' }); await expect(createPlatformUpdateService(options).checkUpdate('stable')).rejects.toThrow('UPDATE_DOWNGRADE_REJECTED');
  });
  it('verifies complete package and blocks opening while tasks run or release is withdrawn', async () => {
    const f = releaseFixture(), dataDir = await directory(); let count = 1; let manifest: UpdateManifest | null = f.manifest(); const openPath = vi.fn(async () => '');
    const service = createPlatformUpdateService({ dataDir, appVersion: '1.0.0', getManifest: async () => manifest, updatePublicKeys: { 'release-1': f.publicKey }, allowedDownloadOrigins: ['https://cdn.example'], fetchImpl: vi.fn(async () => new Response(f.content)) as typeof fetch, getActiveTaskCount: () => count, openPath });
    expect((await service.checkUpdate('stable')).status).toBe('available');
    expect((await service.downloadUpdate()).status).toBe('downloaded');
    expect((await service.openUpdateFolder()).status).toBe('blocked'); expect(openPath).not.toHaveBeenCalled();
    count = 0; await service.openUpdateFolder(); expect(openPath).toHaveBeenCalledWith(join(dataDir, 'updates'));
    manifest = null; await expect(service.openUpdateFolder()).rejects.toThrow('UPDATE_WITHDRAWN'); expect(openPath).toHaveBeenCalledTimes(1);
  });
  it('removes partial packages on checksum mismatch and never follows redirect responses', async () => {
    const f = releaseFixture(), dataDir = await directory(); const fetchImpl = vi.fn(async () => new Response(Buffer.alloc(f.content.length)));
    const service = createPlatformUpdateService({ dataDir, appVersion: '1.0.0', getManifest: async () => f.manifest(), updatePublicKeys: { 'release-1': f.publicKey }, allowedDownloadOrigins: ['https://cdn.example'], fetchImpl: fetchImpl as typeof fetch });
    await service.checkUpdate('stable'); await expect(service.downloadUpdate()).rejects.toThrow('DOWNLOAD_HASH_MISMATCH');
    expect(fetchImpl.mock.calls[0]?.length).toBe(2);
    expect((await readdir(join(dataDir, 'updates'))).filter((name) => name.endsWith('.part'))).toHaveLength(0);
  });
});
