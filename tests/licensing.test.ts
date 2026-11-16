import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { LicenseService } from '../electron/license-service';
import { windowsMachineIdentity } from '../electron/license-machine-identity';
import { compareVersions, LicenseRemoteError, LicenseTransport, verifyEnvelope, verifyRelease, type LicensePublicConfig } from '../electron/license-security';
import { UpdateService } from '../electron/update-service';
import { resetGenerationAuthorization, setGenerationAuthorization } from '../src/shared/generation-authorization';
import { fetchWithTimeout } from '../src/shared/http';
import { needsLicense } from '../electron/license-policy';
import { defaultConfig } from '../src/shared/config';
import { createViralRuntimeProviders } from '../src/shared/viral-runtime';
import { testOpenAiCompatibleImageModel } from '../src/shared/openai-image';
import { testOpenAiCompatibleLlm } from '../src/shared/llm-provider';

// These tests drive a real Python TLS server and run synchronous python CLI commands (execFileSync blocks the
// worker). Alone they take 1-3 s; under a full parallel run each python start-up can take seconds, so the
// default 5 s budget is a scheduling race, not a correctness signal. Assertions are unchanged.
const REAL_PROCESS_TIMEOUT_MS = 60_000;

describe('real TLS licensing and signed updates', () => {
  let directory: string, config: LicensePublicConfig, server: ChildProcess, license: LicenseService;
  const python = process.env.STORYDREAM_TEST_PYTHON || 'python';
  const cwd = resolve('services/license-server');
  const command = (...args: string[]) => JSON.parse(execFileSync(python, ['server.py', '--data', join(directory, 'server'), ...args], { cwd, encoding: 'utf8', windowsHide: true }));
  const operate = (...args: string[]) => execFileSync(python, ['server.py', '--data', join(directory, 'server'), ...args], { cwd, encoding: 'utf8', windowsHide: true });
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'storydream-license-test-'));
    config = command('init', '--host', '127.0.0.1', '--port', '8443');
    server = spawn(python, ['-u', '-c', 'import sys; from server import LicenseStore, LicenseHTTPServer; s=LicenseHTTPServer(("127.0.0.1",0),LicenseStore(sys.argv[1])); print(s.server_address[1],flush=True); s.serve_forever()', join(directory, 'server')], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const port = await new Promise<string>((accept, reject) => {
      const timer = setTimeout(() => reject(new Error('TLS server startup timeout')), 30000);
      server.stdout!.once('data', data => { clearTimeout(timer); accept(data.toString().trim()); });
      server.once('error', reject);
      server.once('exit', code => reject(new Error(`TLS server exited ${code}`)));
    });
    config.baseUrl = `https://127.0.0.1:${port}`;
    // Test-only encryption adapter. Production passes Electron safeStorage/DPAPI.
    license = new LicenseService({ config, vaultPath: join(directory, 'vault'), packaged: true, machineId: async () => createHash('sha256').update('test-machine').digest('hex'),
      encryption: { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() } });
    await license.initialize();
  }, REAL_PROCESS_TIMEOUT_MS);
  afterAll(async () => {
    setGenerationAuthorization(async () => undefined);
    license?.close();
    if (server && server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; }
    if (directory) await rm(directory, { recursive: true, force: true });
  }, REAL_PROCESS_TIMEOUT_MS);
  it('activates, remotely locks/revokes, and unbinds without trusting renderer state', async () => {
    await expect(license.requireActive()).rejects.toMatchObject({ code: 'LICENSE_REQUIRED' });
    const issued = command('issue', '--days', '1');
    expect((await license.activate(issued.code)).status).toBe('active');
    await expect(license.requireActive()).resolves.toBeUndefined();
    execFileSync(python, ['-c', 'import sys; from server import LicenseStore; LicenseStore(sys.argv[1]).admin_lock_device_v3(sys.argv[2])', join(directory, 'server'), license.status().deviceId], { cwd, windowsHide: true });
    await expect(license.refresh()).rejects.toThrow();
    expect(license.status().status).toBe('locked');
    await expect(license.requireActive()).rejects.toMatchObject({ code: 'LICENSE_REQUIRED' });
    execFileSync(python, ['-c', 'import sys; from server import LicenseStore; LicenseStore(sys.argv[1]).admin_unlock_device_v3(sys.argv[2])', join(directory, 'server'), license.status().deviceId], { cwd, windowsHide: true });
    await license.refresh();
    operate('revoke-license', issued.licenseId);
    await expect(license.refresh()).rejects.toThrow();
    expect(license.status().status).toBe('locked');
    operate('restore-license', issued.licenseId);
    await license.refresh();
    await license.release();
    await expect(license.requireActive()).rejects.toThrow();
  }, REAL_PROCESS_TIMEOUT_MS);
  it.each([1, 2])('migrates a v%s seat by retained key and isolates identical hardware', async (protocol) => {
    const identity = windowsMachineIdentity('11111111-2222-3333-4444-555555555555', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    const firstCode = command('issue', '--days', '1');
    const secondCode = command('issue', '--days', '2');
    const encryption = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() };
    const base = { config, packaged: true, encryption, machineIdentity: async () => identity };
    const keys = generateKeyPairSync('ed25519');
    const publicKey = keys.publicKey.export({ format: 'pem', type: 'spki' }).toString();
    const deviceId = protocol === 1 ? identity.legacyDeviceId! : identity.deviceId;
    const legacyFields = { deviceId, ...(protocol === 2 ? { legacyDeviceId: identity.legacyDeviceId } : {}) };
    const transport = new LicenseTransport(config);
    const oldRequest = async (operation: string, extra = {}) => {
      const path = `/v${protocol}/license/${operation}`;
      const payload = JSON.stringify({ ...legacyFields, ...extra, publicKey, timestamp: Math.floor(Date.now() / 1000), nonce: crypto.randomUUID() });
      return transport.json<{ payload: string; signature: string }>(path, { payload, signature: sign(null, Buffer.from(`${path}
${payload}`), keys.privateKey).toString('base64') });
    };
    const oldEnvelope = await oldRequest('activate', { code: firstCode.code, label: 'Legacy fixture' });
    const oldLease = verifyEnvelope(oldEnvelope, config.signingPublicKey) as { expiresAt: number };
    const vaultPath = join(directory, `migration-${protocol}`);
    await writeFile(vaultPath, JSON.stringify({ version: 1, ...legacyFields, privateKey: keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), lastClock: 0, releaseSequence: 17, releaseHash: 'a'.repeat(64) }));
    const first = new LicenseService({ ...base, vaultPath });
    const second = new LicenseService({ ...base, vaultPath: join(directory, `same-hardware-${protocol}`) });
    try {
      await first.initialize();
      expect(first.status().status).toBe('active');
      await first.activate(firstCode.code);
      const firstId = first.status().deviceId;
      expect(firstId).not.toBe(deviceId);
      expect(first.status().expiresAt).toBe(new Date(oldLease.expiresAt * 1000).toISOString());
      const saved = JSON.parse(await readFile(vaultPath, 'utf8'));
      expect(saved).toMatchObject({ version: 3, releaseSequence: 17, releaseHash: 'a'.repeat(64), privateKey: keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString() });
      await second.initialize();
      await second.activate(secondCode.code);
      expect(second.status().deviceId).not.toBe(firstId);
      await expect(oldRequest('refresh')).rejects.toMatchObject({ code: 'DEVICE_IDENTITY_MIGRATED' });
      await expect(oldRequest('release')).rejects.toMatchObject({ code: 'DEVICE_IDENTITY_MIGRATED' });
      await first.release();
      expect((await second.refresh()).status).toBe('active');
      await first.activate(firstCode.code);
      expect(first.status()).toMatchObject({ deviceId: firstId, expiresAt: new Date(oldLease.expiresAt * 1000).toISOString() });
    } finally { first.close(); second.close(); }
  }, REAL_PROCESS_TIMEOUT_MS);
  it.each([1, 2])('resumes approved recovery with %s seats over TLS and retires the old key', async maxDevices => {
    const issued = command('issue', '--days', '1', '--max-devices', String(maxDevices));
    const encryption = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() };
    const base = { config, packaged: true, encryption, machineId: async () => 'a'.repeat(64) };
    const original = new LicenseService({ ...base, vaultPath: join(directory, `recovery-original-${maxDevices}`) });
    const vaultPath = join(directory, `recovery-proposed-${maxDevices}`);
    const proposed = new LicenseService({ ...base, vaultPath });
    const restarted = new LicenseService({ ...base, vaultPath });
    try {
      await original.initialize();
      const originalStatus = await original.activate(issued.code);
      await proposed.initialize();
      const before = JSON.parse(await readFile(vaultPath, 'utf8'));
      const pending = await proposed.requestRecovery(issued.code);
      await expect(proposed.resumeRecovery(issued.code)).rejects.toThrow();
      proposed.close();
      execFileSync(python, ['-c', 'import sys; from server import LicenseStore; LicenseStore(sys.argv[1]).admin_approve_recovery(sys.argv[2])', join(directory, 'server'), pending.id], { cwd, windowsHide: true });
      await restarted.initialize();
      expect(restarted.pendingRecovery()).toMatchObject({ id: pending.id });
      expect((await restarted.resumeRecovery(issued.code))).toMatchObject({ status: 'active', deviceId: originalStatus.deviceId, expiresAt: originalStatus.expiresAt });
      const committed = JSON.parse(await readFile(vaultPath, 'utf8'));
      expect(committed).toMatchObject({ version: 3, privateKey: before.privateKey, bindingRevision: 1, credentialEpoch: 1 });
      expect(committed.pendingRecovery).toBeUndefined();
      await expect(original.refresh()).rejects.toThrow();
      expect((await restarted.refresh()).status).toBe('active');
      await restarted.release();
      await expect(original.activate(issued.code)).rejects.toThrow();
    } finally { original.close(); proposed.close(); restarted.close(); }
  }, REAL_PROCESS_TIMEOUT_MS);
  it('checks signed manifests, resumes downloads, and rejects altered installer bytes', async () => {
    const source = join(directory, 'fixture.exe');
    const content = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(32768, 37)]);
    await writeFile(source, content);
    command('publish', '--file', source, '--version', '2.0.0', '--minimum-version', '1.5.0', '--notes', 'test');
    operate('announce', '--title', '服务问题公告', '--body', '服务临时维护说明');
    const updates = join(directory, 'updates');
    const service = new UpdateService({ license, version: '1.0.0', directory: updates, packaged: false, canInstall: () => true, quit: vi.fn() });
    const state = await service.check();
    expect(state.required).toBe(true);
    expect(state.announcements.map(({ category }) => category)).toEqual(['problem', 'update']);
    expect(state.announcements.find(({ category }) => category === 'update')).toMatchObject({ version: '2.0.0', body: 'test' });
    expect(() => service.assertVersionAllowed()).toThrow();
    await mkdir(updates);
    const partial = join(updates, `${state.release!.filename}.part`);
    await writeFile(partial, Buffer.alloc(0));
    expect((await service.download()).phase).toBe('ready');
    const file = join(updates, state.release!.filename);
    expect(await readFile(file)).toEqual(content);
    expect((await service.check()).phase).toBe('ready');
    const restarted = new UpdateService({ license, version: '1.0.0', directory: updates, packaged: false, canInstall: () => true, quit: vi.fn() });
    expect((await restarted.check()).phase).toBe('ready');
    await rm(file);
    await writeFile(partial, content.subarray(0, 103));
    expect((await service.download()).phase).toBe('ready');
    await rm(file);
    await writeFile(partial, Buffer.alloc(103, 99));
    await expect(service.download()).rejects.toThrow('校验失败');
    await expect(readFile(partial)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(license.acceptRelease(state.release!.sequence - 1, 'a'.repeat(64))).rejects.toThrow();
    await expect(license.acceptRelease(state.release!.sequence, 'a'.repeat(64))).rejects.toThrow();
    await expect(service.install()).rejects.toThrow();
    expect(service.installing).toBe(false);
    let blocked: UpdateService;
    const quit = vi.fn();
    blocked = new UpdateService({ license, version: '1.0.0', directory: updates, packaged: true,
      canInstall: () => { expect(blocked.installing).toBe(true); return false; }, quit });
    await expect(blocked.install()).rejects.toThrow('有任务正在运行');
    expect(blocked.installing).toBe(false);
    expect(quit).not.toHaveBeenCalled();
  }, REAL_PROCESS_TIMEOUT_MS);
  it('rejects a mismatched certificate authority', async () => {
    await expect(new LicenseTransport({ ...config, caPem: '' }).json('/v1/health')).rejects.toThrow();
  }, REAL_PROCESS_TIMEOUT_MS);
});

it('verifies Ed25519 signatures and rejects tampered/expired manifests', () => {
  const keys = generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const payload = JSON.stringify({ schemaVersion: 1, kind: 'release', sequence: 1, version: '2.0.0', minimumVersion: '1.0.0', platform: 'win32', arch: 'x64', filename: 'StoryDream-Setup-2.0.0-0123456789ab.exe', sha256: 'a'.repeat(64), size: 2, notes: '', issuedAt: 1000, validUntil: 2000 });
  const envelope = { payload, signature: sign(null, Buffer.from(payload), keys.privateKey).toString('base64') };
  const config = { signingPublicKey: publicKey } as LicensePublicConfig;
  expect(verifyRelease(envelope, config, 1500).version).toBe('2.0.0');
  expect(() => verifyRelease(envelope, config, 2000)).toThrow();
  expect(() => verifyEnvelope({ ...envelope, payload: payload.replace('2.0.0', '9.0.0') }, publicKey)).toThrow();
  expect(compareVersions('10.0.0', '2.9.9')).toBe(1);
});

it('fails closed when the generation authorization hook has not been initialized', async () => {
  const fetchImpl = vi.fn(async () => new Response('should not dispatch'));
  resetGenerationAuthorization();
  try {
    await expect(fetchWithTimeout('https://provider.example/v1/generate', { generation: true, fetchImpl }))
      .rejects.toMatchObject({ code: 'LICENSE_NOT_READY' });
    expect(fetchImpl).not.toHaveBeenCalled();
  } finally { setGenerationAuthorization(async () => undefined); }
});

it('denies generation at dispatch while preserving non-generating requests', async () => {
  const fetchImpl = vi.fn(async () => new Response('ok'));
  setGenerationAuthorization(async () => { throw new Error('locked'); });
  try {
    await expect(fetchWithTimeout('https://example.com', { generation: true, fetchImpl })).rejects.toThrow('locked');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(needsLicense('app:get-bootstrap')).toBe(true);
    expect(needsLicense('task:update-status')).toBe(true);
    expect(needsLicense('task:rerun-step')).toBe(true);
    expect(needsLicense('vox-production:control')).toBe(true);
    expect(needsLicense('llm:test-config')).toBe(true);
    expect(needsLicense('config:test')).toBe(true);
    for (const channel of ['license:status', 'license:activate', 'license:refresh', 'license:release', 'window:control', 'update:status', 'update:check', 'update:download', 'update:install'] as const) {
      expect(needsLicense(channel)).toBe(false);
    }
  } finally { setGenerationAuthorization(async () => undefined); }
});

it('fails closed in an unconfigured packaged build', async () => {
  const service = new LicenseService({ config: {}, vaultPath: '', packaged: true, encryption: { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' } });
  await service.initialize();
  await expect(service.requireActive()).rejects.toMatchObject({ code: 'LICENSE_REQUIRED' });
});

it('blocks queued transcription, frame analysis, and generating model probes after a lock', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'storydream-locked-providers-'));
  const media = join(directory, 'fixture.bin');
  await writeFile(media, Buffer.from('fixture'));
  const config = structuredClone(defaultConfig);
  config.llm = { ...config.llm, apiKey: 'fixture-key', baseUrl: 'https://provider.example/v1', model: 'fixture-model' };
  config.speechToText = { ...config.speechToText, apiKey: 'fixture-key', baseUrl: 'https://provider.example/v1', model: 'fixture-stt' };
  const fetchImpl = vi.fn(async () => new Response('{}'));
  const previousFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  setGenerationAuthorization(async () => { throw new Error('DEVICE_LOCKED'); });
  try {
    const providers = createViralRuntimeProviders(config, directory);
    await expect(providers.transcribe(media)).rejects.toThrow('DEVICE_LOCKED');
    await expect(providers.analyzeFrame({ timestamp: 0, framePath: media }, null, { title: 'Fixture' } as Parameters<typeof providers.analyzeFrame>[2])).rejects.toThrow('DEVICE_LOCKED');
    const image = await testOpenAiCompatibleImageModel({ baseUrl: config.llm.baseUrl, apiKey: 'fixture-key', model: 'fixture-image', ratio: '1:1', resolution: '1K', fetchImpl });
    expect(image).toMatchObject({ status: 'fail', detail: 'DEVICE_LOCKED' });
    const text = await testOpenAiCompatibleLlm(config.llm, fetchImpl);
    expect(text).toMatchObject({ status: 'fail', detail: 'DEVICE_LOCKED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  } finally {
    globalThis.fetch = previousFetch;
    setGenerationAuthorization(async () => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});

it('expires an offline lease, notifies the shell, and requires online verification after restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'storydream-lease-expiry-'));
  const keys = generateKeyPairSync('ed25519');
  const config = { schemaVersion: 1, baseUrl: 'https://127.0.0.1:8443', caPem: 'x'.repeat(100), signingPublicKey: keys.publicKey.export({ format: 'pem', type: 'spki' }).toString() };
  const notify = vi.fn();
  const options = { config, vaultPath: join(directory, 'vault'), packaged: true,
    machineId: async () => createHash('sha256').update('expiry-machine').digest('hex'), onChange: notify,
    encryption: { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() } };
  await writeFile(options.vaultPath, JSON.stringify({ version: 1, deviceId: await options.machineId(), privateKey: generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), lastClock: 0, releaseSequence: 0, releaseHash: '' }));
  const transport = vi.spyOn(LicenseTransport.prototype, 'json').mockImplementation(async (_path, request) => {
    const device = JSON.parse(request!.payload);
    const now = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ schemaVersion: 1, kind: 'lease', status: 'active', licenseId: '8b44aad6-98fe-4ca2-b93a-19d4ca453945',
      deviceId: device.deviceId, keyHash: createHash('sha256').update(createPublicKey(device.publicKey).export({ format: 'der', type: 'spki' })).digest('hex'),
      issuedAt: now, validUntil: now + 2, expiresAt: now + 3600, maxDevices: 1,
      devices: [{ deviceId: device.deviceId, label: 'Expiry fixture', lastSeen: now }] });
    return { payload, signature: sign(null, Buffer.from(payload), keys.privateKey).toString('base64') };
  });
  // LicenseService.now() also reads the monotonic clock (performance.now) to resist wall-clock rollback.
  // Fake it together with Date and construct the services afterwards, so the 2 s lease window is
  // driven only by advanceTimersByTimeAsync and not by how long key generation/IO takes under load.
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'performance'] });
  const service = new LicenseService(options);
  const restarted = new LicenseService(options);
  try {
    await service.initialize();
    expect(service.status().status).toBe('active');
    transport.mockRejectedValue(new Error('offline'));
    await expect(service.refresh()).rejects.toThrow();
    expect(service.status().status).toBe('offline');
    await expect(service.requireActive()).resolves.toBeUndefined();
    await restarted.initialize();
    await expect(restarted.requireActive()).rejects.toMatchObject({ code: 'LICENSE_REQUIRED' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(service.status().status).toBe('expired');
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ status: 'expired' }));
    await expect(service.requireActive()).rejects.toMatchObject({ code: 'LICENSE_REQUIRED' });
  } finally {
    service.close(); restarted.close(); transport.mockRestore(); vi.useRealTimers();
    await rm(directory, { recursive: true, force: true });
  }
});

describe('offline grace on a persisted lease', () => {
  const GRACE_SECONDS = 3600;
  async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), 'storydream-lease-grace-'));
    const keys = generateKeyPairSync('ed25519');
    const config = { schemaVersion: 1, baseUrl: 'https://127.0.0.1:8443', caPem: 'x'.repeat(100), signingPublicKey: keys.publicKey.export({ format: 'pem', type: 'spki' }).toString() };
    const options = { config, vaultPath: join(directory, 'vault'), packaged: true,
      machineId: async () => createHash('sha256').update('grace-machine').digest('hex'),
      encryption: { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() } };
    await writeFile(options.vaultPath, JSON.stringify({ version: 1, deviceId: await options.machineId(), privateKey: generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), lastClock: 0, releaseSequence: 0, releaseHash: '' }));
    const transport = vi.spyOn(LicenseTransport.prototype, 'json').mockImplementation(async (_path, request) => {
      const device = JSON.parse(request!.payload);
      const now = Math.floor(Date.now() / 1000);
      const payload = JSON.stringify({ schemaVersion: 1, kind: 'lease', status: 'active', licenseId: '8b44aad6-98fe-4ca2-b93a-19d4ca453945',
        deviceId: device.deviceId, keyHash: createHash('sha256').update(createPublicKey(device.publicKey).export({ format: 'der', type: 'spki' })).digest('hex'),
        issuedAt: now, validUntil: now + 600, offlineGraceUntil: now + GRACE_SECONDS, expiresAt: now + 86400, maxDevices: 1,
        devices: [{ deviceId: device.deviceId, label: 'Grace fixture', lastSeen: now }] });
      return { payload, signature: sign(null, Buffer.from(payload), keys.privateKey).toString('base64') };
    });
    return { directory, options, transport };
  }

  it('restores a persisted lease after restart while offline and rejects it once the grace window ends', async () => {
    const { directory, options, transport } = await fixture();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'performance'] });
    const first = new LicenseService(options);
    let restarted: LicenseService | undefined;
    try {
      await first.initialize();
      expect(first.status().status).toBe('active');
      first.close();
      transport.mockRejectedValue(new Error('offline'));
      await vi.advanceTimersByTimeAsync(700 * 1000);
      restarted = new LicenseService(options);
      await restarted.initialize();
      expect(restarted.status().status).toBe('offline');
      await expect(restarted.requireActive()).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync((GRACE_SECONDS + 10) * 1000);
      expect(restarted.status().status).toBe('expired');
      await expect(restarted.requireActive()).rejects.toMatchObject({ code: 'LICENSE_REQUIRED' });
    } finally {
      first.close(); restarted?.close(); transport.mockRestore(); vi.useRealTimers();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects a stored lease whose grace window has already passed at startup', async () => {
    const { directory, options, transport } = await fixture();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'performance'] });
    const first = new LicenseService(options);
    let restarted: LicenseService | undefined;
    try {
      await first.initialize();
      first.close();
      transport.mockRejectedValue(new Error('offline'));
      await vi.advanceTimersByTimeAsync((GRACE_SECONDS + 60) * 1000);
      restarted = new LicenseService(options);
      await restarted.initialize();
      await expect(restarted.requireActive()).rejects.toMatchObject({ code: 'LICENSE_REQUIRED' });
    } finally {
      first.close(); restarted?.close(); transport.mockRestore(); vi.useRealTimers();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('drops the stored lease when the server explicitly rejects the device', async () => {
    const { directory, options, transport } = await fixture();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'performance'] });
    const first = new LicenseService(options);
    let restarted: LicenseService | undefined;
    try {
      await first.initialize();
      transport.mockRejectedValue(new LicenseRemoteError('DEVICE_LOCKED', 403));
      await expect(first.refresh()).rejects.toThrow();
      expect(first.status().status).toBe('locked');
      first.close();
      transport.mockRejectedValue(new Error('offline'));
      restarted = new LicenseService(options);
      await restarted.initialize();
      await expect(restarted.requireActive()).rejects.toMatchObject({ code: 'LICENSE_REQUIRED' });
    } finally {
      first.close(); restarted?.close(); transport.mockRestore(); vi.useRealTimers();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
