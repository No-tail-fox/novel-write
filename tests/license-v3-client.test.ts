import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, createPublicKey, generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LicenseService } from '../electron/license-service';
import { LicenseRemoteError, LicenseTransport, verifyLease, verifyLeaseV3, type LicensePublicConfig } from '../electron/license-security';
import type { SignedEnvelope } from '../src/shared/licensing';

const serverKeys = generateKeyPairSync('ed25519');
const deviceKeys = generateKeyPairSync('ed25519');
const publicKey = deviceKeys.publicKey.export({ format: 'pem', type: 'spki' }).toString();
const config: LicensePublicConfig = { schemaVersion: 1, baseUrl: 'https://127.0.0.1:8443', caPem: 'x'.repeat(100), signingPublicKey: serverKeys.publicKey.export({ format: 'pem', type: 'spki' }).toString() };
const keyHash = (pem: string) => createHash('sha256').update(createPublicKey(pem).export({ format: 'der', type: 'spki' })).digest('hex');
const assigned = { deviceRecordId: randomUUID(), credentialId: randomUUID(), bindingId: randomUUID(), licenseId: randomUUID(), bindingRevision: 0, credentialEpoch: 0 };
const signed = (value: unknown): SignedEnvelope => { const payload = JSON.stringify(value); return { payload, signature: sign(null, Buffer.from(payload), serverKeys.privateKey).toString('base64') }; };
const leaseV3 = (key: string, now: number, extra = {}) => ({ schemaVersion: 3, kind: 'lease', status: 'active', ...assigned, keyHash: keyHash(key), issuedAt: now, validUntil: now + 600, expiresAt: now + 30 * 86400, maxDevices: 1, devices: [{ deviceRecordId: assigned.deviceRecordId, label: 'Fixture', lastSeen: now }], ...extra });
const services: LicenseService[] = [];
const directories: string[] = [];
afterEach(async () => { services.splice(0).forEach(service => service.close()); vi.restoreAllMocks(); for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'storydream-v3-client-')); directories.push(directory);
  const encryption = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() };
  const options = { config, vaultPath: join(directory, 'vault'), packaged: true, encryption, machineIdentity: async () => ({ deviceId: 'a'.repeat(64), legacyDeviceId: 'b'.repeat(64) }) };
  const service = new LicenseService(options); services.push(service);
  return { options, service, saved: async () => JSON.parse(await readFile(options.vaultPath, 'utf8')) };
}

describe.each([1, 3])('strict v%s offline lease bounds', schema => {
  const now = 1000;
  const value = (extra = {}) => schema === 3 ? leaseV3(publicKey, now, extra) : { schemaVersion: 1, kind: 'lease', status: 'active', licenseId: assigned.licenseId, deviceId: 'a'.repeat(64), keyHash: keyHash(publicKey), issuedAt: now, validUntil: now + 600, expiresAt: now + 30 * 86400, maxDevices: 1, devices: [{ deviceId: 'a'.repeat(64), label: 'Legacy', lastSeen: now }], ...extra };
  const check = (extra: object, clock: number, offline = true) => schema === 3 ? verifyLeaseV3(signed(value(extra)), config, assigned.credentialId, publicKey, clock, offline) : verifyLease(signed(value(extra)), config, 'a'.repeat(64), publicKey, clock, offline);
  it('has no implicit license-long grace', () => { expect(() => check({}, now + 599)).not.toThrow(); expect(() => check({}, now + 600)).toThrow(); });
  it('allows exactly seven days only if explicitly signed', () => { expect(() => check({ offlineGraceUntil: now + 7 * 86400 }, now + 7 * 86400 - 1)).not.toThrow(); expect(() => check({ offlineGraceUntil: now + 7 * 86400 }, now + 7 * 86400)).toThrow(); });
  it.each([{ offlineGraceUntil: now + 7 * 86400 + 1 }, { offlineGraceUntil: now + 700, expiresAt: now + 600 }, { offlineGraceUntil: now + 599 }])('rejects invalid grace even online: %j', extra => { expect(() => check(extra, now + 1, false)).toThrow(); expect(() => check(extra, now + 1)).toThrow(); });
  it('ends at license expiry', () => { expect(() => check({ offlineGraceUntil: now + 700, expiresAt: now + 700 }, now + 699)).not.toThrow(); expect(() => check({ offlineGraceUntil: now + 700, expiresAt: now + 700 }, now + 700)).toThrow(); });
});

it('admits only supported transport paths before opening a connection', () => {
  const transport = new LicenseTransport(config);
  for (const path of ['/v1/license/refresh', '/v2/license/refresh', '/v3/license/challenge', '/v3/license/activate', '/v1/download/StoryDream-Setup-1.0.0-abcdef012345.exe.blockmap']) expect(() => transport.open(path, undefined, -1)).toThrow('INVALID_DOWNLOAD_RANGE');
  for (const path of ['/v4/license/activate', '//evil.example/v1/a', '/v3/license/../activate', '/v3/license/activate?x', '/v3/license/activate#x', '/v3/license/%2e%2e', String.raw`/v3/license/activate\evil`]) expect(() => transport.open(path)).toThrow('INVALID_LICENSE_PATH');
});

it('enrolls a new v3 vault through a code-bound challenge and signs complete refresh/release context', async () => {
  const { options, service, saved } = await fixture();
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const challengeId = randomUUID();
  const transport = vi.spyOn(LicenseTransport.prototype, 'json').mockImplementation(async (path, request) => {
    const body = JSON.parse(request!.payload); calls.push({ path, body });
    expect(verify(null, Buffer.from(`${path}\n${request!.payload}`), body.publicKey, Buffer.from(request!.signature, 'base64'))).toBe(true);
    const now = Math.floor(Date.now() / 1000);
    if (path.endsWith('/challenge')) { expect(body).toMatchObject({ purpose: 'activate', code: 'original-code' }); return { challengeId, expiresAt: now + 300 }; }
    if (path.endsWith('/activate')) { expect(body.challengeId).toBe(challengeId); expect(body.deviceRecordId).toBeUndefined(); expect(body.credentialId).toBeUndefined(); }
    else expect(body).toMatchObject(assigned);
    return path.endsWith('/release') ? { released: true } : signed(leaseV3(body.publicKey, now));
  });
  await service.initialize();
  expect(transport).not.toHaveBeenCalled();
  expect(await saved()).toMatchObject({ version: 3 });
  expect((await saved()).deviceRecordId).toBeUndefined();
  const originalKey = (await saved()).privateKey;
  expect((await service.activate(' original-code ')).status).toBe('active');
  expect(await saved()).toMatchObject({ version: 3, ...assigned, privateKey: originalKey });
  expect((await saved()).lease).toBeUndefined();
  service.close();
  const restarted = new LicenseService({ ...options, machineIdentity: async () => { throw new Error('probe unavailable'); } }); services.push(restarted);
  await restarted.initialize();
  expect(restarted.status()).toMatchObject({ status: 'active', deviceId: assigned.deviceRecordId });
  await restarted.release();
  expect(restarted.status().status).toBe('inactive');
  expect(calls.map(call => call.path)).toEqual(['/v3/license/challenge', '/v3/license/activate', '/v3/license/refresh', '/v3/license/release']);
});

it.each(['signature', 'key', 'epoch'])('never commits an untrusted assigned identity: %s', defect => {
  const value = leaseV3(publicKey, 1000);
  const envelope = defect === 'signature' ? { ...signed(value), payload: JSON.stringify({ ...value, deviceRecordId: randomUUID() }) } : signed(defect === 'key' ? { ...value, keyHash: 'f'.repeat(64) } : { ...value, credentialEpoch: undefined });
  expect(() => verifyLeaseV3(envelope, config, null, publicKey, 1001)).toThrow();
});

it.each(['deviceRecordId', 'credentialId', 'bindingId', 'licenseId', 'bindingRevision', 'credentialEpoch'])('rejects a signed refresh with substituted %s', async field => {
  const { service, saved } = await fixture();
  const transport = vi.spyOn(LicenseTransport.prototype, 'json').mockImplementation(async (path, request) => {
    const body = JSON.parse(request!.payload), now = Math.floor(Date.now() / 1000);
    return path.endsWith('/challenge') ? { challengeId: randomUUID(), expiresAt: now + 300 } : signed(leaseV3(body.publicKey, now));
  });
  await service.initialize(); await service.activate('code');
  const before = await saved();
  transport.mockImplementation(async (_path, request) => {
    const value = leaseV3(JSON.parse(request!.payload).publicKey, Math.floor(Date.now() / 1000), { [field]: field.endsWith('Revision') || field.endsWith('Epoch') ? 1 : randomUUID() });
    if (field === 'deviceRecordId') value.devices = [{ deviceRecordId: value.deviceRecordId, label: 'Other', lastSeen: value.issuedAt }];
    return signed(value);
  });
  await expect(service.refresh()).rejects.toThrow();
  expect(await saved()).toEqual(before);
});

it('keeps the proposed recovery key and metadata across restart, then commits approved identity atomically', async () => {
  const { options, service, saved } = await fixture();
  const now = Math.floor(Date.now() / 1000);
  const recovery = { id: randomUUID(), licenseId: assigned.licenseId, deviceRecordId: assigned.deviceRecordId, deviceLabel: 'Recovery', state: 'pending', createdAt: now, expiresAt: now + 86400 };
  let proposedKey = '';
  const transport = vi.spyOn(LicenseTransport.prototype, 'json').mockImplementation(async (path, request) => {
    const body = JSON.parse(request!.payload);
    if (path.endsWith('/challenge')) { expect(body).toMatchObject({ purpose: 'recovery', code: 'original-code' }); proposedKey = body.publicKey; return { challengeId: randomUUID(), expiresAt: now + 300 }; }
    expect(path).toBe('/v3/license/recover'); expect(body.publicKey).toBe(proposedKey); return recovery;
  });
  await service.initialize(); const originalKey = (await saved()).privateKey;
  await service.requestRecovery('original-code');
  expect(service.pendingRecovery()).toMatchObject({ id: recovery.id });
  expect(JSON.stringify(await saved())).not.toContain('original-code');
  service.close();
  const restarted = new LicenseService(options); services.push(restarted);
  await restarted.initialize(); expect(restarted.pendingRecovery()).toMatchObject({ id: recovery.id });
  transport.mockImplementation(async (path, request) => {
    const body = JSON.parse(request!.payload); expect(body.publicKey).toBe(proposedKey);
    if (path.endsWith('/challenge')) { expect(body).toMatchObject({ purpose: 'activate', code: 'original-code' }); return { challengeId: randomUUID(), expiresAt: now + 300 }; }
    return signed(leaseV3(body.publicKey, now, { credentialEpoch: 1, bindingRevision: 1 }));
  });
  expect((await restarted.resumeRecovery('original-code')).status).toBe('active');
  expect(await saved()).toMatchObject({ ...assigned, credentialEpoch: 1, bindingRevision: 1, privateKey: originalKey });
  expect((await saved()).pendingRecovery).toBeUndefined();
});

it('retains the same enrollment key after response loss and a failed atomic vault write', async () => {
  const { options, service, saved } = await fixture();
  let responseLost = true;
  const keys = new Set<string>();
  vi.spyOn(LicenseTransport.prototype, 'json').mockImplementation(async (path, request) => {
    const body = JSON.parse(request!.payload), now = Math.floor(Date.now() / 1000); keys.add(body.publicKey);
    if (path.endsWith('/challenge')) return { challengeId: randomUUID(), expiresAt: now + 300 };
    if (responseLost) { responseLost = false; throw new Error('response lost after commit'); }
    return signed(leaseV3(body.publicKey, now));
  });
  await service.initialize(); const initial = await saved();
  await expect(service.activate('code')).rejects.toThrow(); expect(await saved()).toEqual(initial);
  const encrypt = vi.spyOn(options.encryption, 'encryptString').mockImplementationOnce(() => { throw new Error('disk/encryption failure'); });
  await expect(service.activate('code')).rejects.toThrow(); expect(await saved()).toEqual(initial);
  encrypt.mockRestore();
  expect((await service.activate('code')).status).toBe('active');
  expect(keys.size).toBe(1); expect((await saved()).privateKey).toBe(initial.privateKey);
});

it('reports unsupported v3 without falling back to legacy enrollment', async () => {
  const { service, saved } = await fixture();
  const transport = vi.spyOn(LicenseTransport.prototype, 'json').mockRejectedValue(new LicenseRemoteError('NOT_FOUND', 404));
  await service.initialize();
  await expect(service.activate('code')).rejects.toThrow('协议');
  expect(transport).toHaveBeenCalledTimes(1); expect(transport.mock.calls[0][0]).toBe('/v3/license/challenge');
  expect(await saved()).toMatchObject({ version: 3 });
});
