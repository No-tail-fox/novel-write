import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LicenseService } from '../electron/license-service';
import { LicenseRemoteError, LicenseTransport } from '../electron/license-security';
import { windowsMachineIdentity } from '../electron/license-machine-identity';

const guid = '11111111-2222-3333-4444-555555555555';
const hardware = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const identity = windowsMachineIdentity(guid, hardware);
const encryption = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() };
const signing = generateKeyPairSync('ed25519');
const config = { schemaVersion: 1, baseUrl: 'https://127.0.0.1:8443', caPem: 'x'.repeat(100), signingPublicKey: signing.publicKey.export({ format: 'pem', type: 'spki' }).toString() };
const directories: string[] = [];
const services: LicenseService[] = [];

afterEach(async () => {
  for (const service of services.splice(0)) service.close();
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function fixture(legacy = true) {
  const directory = await mkdtemp(join(tmpdir(), 'storydream-identity-'));
  directories.push(directory);
  const vaultPath = join(directory, 'vault');
  const keys = generateKeyPairSync('ed25519');
  const vault = { version: 1, deviceId: legacy ? identity.legacyDeviceId : identity.deviceId,
    ...(legacy ? {} : { legacyDeviceId: identity.legacyDeviceId }),
    privateKey: keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    lastClock: 1, releaseSequence: 7, releaseHash: 'a'.repeat(64) };
  await writeFile(vaultPath, JSON.stringify(vault));
  const options = { config, vaultPath, packaged: true, encryption, machineIdentity: async () => identity };
  const service = new LicenseService(options);
  services.push(service);
  return { vaultPath, vault, options, service };
}

function signedLease(request: { payload: string; signature: string }, path: string, override: Record<string, unknown> = {}) {
  const device = JSON.parse(request.payload);
  expect(verify(null, Buffer.from(`${path}\n${request.payload}`), device.publicKey, Buffer.from(request.signature, 'base64'))).toBe(true);
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ schemaVersion: 1, kind: 'lease', status: 'active', licenseId: '8b44aad6-98fe-4ca2-b93a-19d4ca453945',
    deviceId: device.deviceId, keyHash: createHash('sha256').update(createPublicKey(device.publicKey).export({ format: 'der', type: 'spki' })).digest('hex'),
    issuedAt: now, validUntil: now + 600, offlineGraceUntil: now + 3600, expiresAt: now + 86400, maxDevices: 1,
    devices: [{ deviceId: device.deviceId, label: 'Identity fixture', lastSeen: now }], ...override });
  return { payload, signature: sign(null, Buffer.from(payload), signing.privateKey).toString('base64') };
}

describe('hardware-aware machine identity', () => {
  it('separates identical Windows images on different hardware and normalizes stable inputs', () => {
    const other = windowsMachineIdentity(guid, 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff');
    expect(identity.legacyDeviceId).toBe(other.legacyDeviceId);
    expect(identity.deviceId).not.toBe(other.deviceId);
    expect(windowsMachineIdentity(` ${guid.toUpperCase()}\r\n`, `\r\n${hardware.toUpperCase()}\r\n`)).toEqual(identity);
    expect(identity.legacyDeviceId).toBe(createHash('sha256').update(`storydream-device-v1\n${guid}`).digest('hex'));
  });

  it.each(['', 'unknown', '00000000-0000-0000-0000-000000000000', 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF', `${hardware}\n${hardware}`])('rejects invalid hardware UUID without a legacy fallback: %s', value => {
    expect(() => windowsMachineIdentity(guid, value)).toThrow('HARDWARE_ID_UNAVAILABLE');
  });

  it('rejects malformed MachineGuid', () => {
    expect(() => windowsMachineIdentity('not-a-guid', hardware)).toThrow('MACHINE_ID_UNAVAILABLE');
  });

  it.each([true, false])('refreshes retained legacy identity without hardware rewrite (v1=%s)', async legacy => {
    const { service, vaultPath, vault, options } = await fixture(legacy);
    const transport = vi.spyOn(LicenseTransport.prototype, 'json').mockImplementation(async (path, request) => {
      expect(path).toBe(legacy ? '/v1/license/refresh' : '/v2/license/refresh');
      expect(JSON.parse(request!.payload)).toMatchObject({ deviceId: vault.deviceId });
      expect(JSON.parse(await readFile(vaultPath, 'utf8'))).toMatchObject(vault);
      return signedLease(request!, path);
    });
    await service.initialize();
    expect(service.status()).toMatchObject({ status: 'active', deviceId: vault.deviceId });
    const persisted = JSON.parse(await readFile(vaultPath, 'utf8'));
    expect(persisted).toMatchObject({ deviceId: vault.deviceId, privateKey: vault.privateKey, releaseSequence: 7, releaseHash: vault.releaseHash });
    expect(persisted.lastClock).toBeGreaterThan(vault.lastClock);
    service.close();
    transport.mockRejectedValue(new Error('offline'));
    const restarted = new LicenseService(options);
    services.push(restarted);
    await restarted.initialize();
    expect(restarted.status()).toMatchObject({ status: 'offline', deviceId: vault.deviceId });
    await expect(restarted.requireActive()).resolves.toBeUndefined();
  });

  it.each(['unavailable', 'old-server', 'wrong-device', 'bad-signature'])('keeps legacy identity on disk when legacy verification fails: %s', async failure => {
    const { service, vaultPath, vault } = await fixture();
    const transport = vi.spyOn(LicenseTransport.prototype, 'json').mockImplementation(async (path, request) => {
      if (failure === 'unavailable') throw new Error('offline');
      if (failure === 'old-server') throw new LicenseRemoteError('NOT_FOUND', 404);
      const lease = signedLease(request!, path, failure === 'wrong-device' ? { deviceId: identity.deviceId } : {});
      if (failure === 'bad-signature') lease.signature = Buffer.alloc(64).toString('base64');
      return lease;
    });
    await service.initialize();
    expect(service.status().status).not.toBe('active');
    expect(JSON.parse(await readFile(vaultPath, 'utf8'))).toEqual(vault);
    await expect(service.requireActive()).rejects.toMatchObject({ code: 'LICENSE_REQUIRED' });
    expect(transport.mock.calls.every(([path]) => path === '/v1/license/refresh')).toBe(true);
  });

  it('retries a lost refresh response with the same key and identity after restart', async () => {
    const { service, options, vaultPath, vault } = await fixture();
    let firstPayload: Record<string, unknown> | undefined;
    const transport = vi.spyOn(LicenseTransport.prototype, 'json').mockImplementation(async (_path, request) => {
      firstPayload = JSON.parse(request!.payload);
      throw new Error('response lost after server commit');
    });
    await service.initialize();
    expect(JSON.parse(await readFile(vaultPath, 'utf8'))).toEqual(vault);
    service.close();
    transport.mockImplementation(async (path, request) => {
      expect(JSON.parse(request!.payload)).toMatchObject({ deviceId: firstPayload!.deviceId, publicKey: firstPayload!.publicKey });
      return signedLease(request!, path);
    });
    const restarted = new LicenseService(options);
    services.push(restarted);
    await restarted.initialize();
    expect(restarted.status().status).toBe('active');
  });

  it('restores only the retained legacy identity when a signed offline lease remains valid', async () => {
    const { service, vaultPath, vault } = await fixture();
    const publicKey = createPublicKey(vault.privateKey).export({ format: 'pem', type: 'spki' }).toString();
    const payload = JSON.stringify({ deviceId: vault.deviceId, publicKey });
    const path = '/v1/license/refresh';
    const lease = signedLease({ payload, signature: sign(null, Buffer.from(`${path}\n${payload}`), vault.privateKey).toString('base64') }, path);
    await writeFile(vaultPath, JSON.stringify({ ...vault, lease }));
    vi.spyOn(LicenseTransport.prototype, 'json').mockRejectedValue(new Error('offline'));
    await service.initialize();
    await expect(service.requireActive()).resolves.toBeUndefined();
    expect(service.status().deviceId).toBe(vault.deviceId);
    expect(JSON.parse(await readFile(vaultPath, 'utf8')).deviceId).toBe(vault.deviceId);
  });

  it('keeps a retained v2 key and identity usable after hardware evidence changes', async () => {
    const { options, vaultPath, vault } = await fixture(false);
    const transport = vi.spyOn(LicenseTransport.prototype, 'json').mockImplementation(async (path, request) => signedLease(request!, path));
    const changed = new LicenseService({ ...options, machineIdentity: async () => windowsMachineIdentity(guid, 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff') });
    services.push(changed);
    await changed.initialize();
    expect(changed.status()).toMatchObject({ status: 'active', deviceId: vault.deviceId });
    expect(transport.mock.calls[0][0]).toBe('/v2/license/refresh');
    expect(JSON.parse(await readFile(vaultPath, 'utf8'))).toMatchObject({ deviceId: vault.deviceId, privateKey: vault.privateKey });
  });

  it('does not create an alternate identity when hardware lookup fails', async () => {
    const { options, vaultPath, vault } = await fixture();
    const transport = vi.spyOn(LicenseTransport.prototype, 'json').mockImplementation(async (path, request) => signedLease(request!, path));
    const failed = new LicenseService({ ...options, machineIdentity: async () => { throw new Error('HARDWARE_ID_UNAVAILABLE'); } });
    services.push(failed);
    await failed.initialize();
    expect(failed.status()).toMatchObject({ status: 'active', deviceId: vault.deviceId });
    expect(transport.mock.calls[0][0]).toBe('/v1/license/refresh');
    expect(JSON.parse(await readFile(vaultPath, 'utf8'))).toMatchObject({ deviceId: vault.deviceId, privateKey: vault.privateKey });
  });
});
