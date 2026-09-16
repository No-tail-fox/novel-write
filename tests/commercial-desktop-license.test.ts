import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLicenseService } from '../electron/license-service';
import { createCommercialService } from '../electron/commercial-service';
import { canonicalDocument } from '../electron/platform-update-service';
import type { PlatformLicense } from '../src/shared/commercial-contract';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
function keys() { const key = generateKeyPairSync('ed25519'); return { privateKey: key.privateKey, publicKey: key.publicKey.export({ type: 'spki', format: 'pem' }).toString() }; }
function fixture() {
  const signer = keys(), device = keys(); let wall = Date.parse('2026-09-16T10:00:00.000Z'), monotonic = 0;
  const user = { id: 'account-1', displayName: 'User', phone: '138****0000' }, deviceId = 'device-1';
  const service = createLicenseService({ publicKeys: { 'license-1': signer.publicKey }, now: () => wall, monotonicNow: () => monotonic });
  function license(overrides: Record<string, unknown> = {}, installationPublicKey = device.publicKey): PlatformLicense {
    const payload = { licenseId: 'license-id', userId: user.id, deviceId, devicePublicKeyHash: createHash('sha256').update(installationPublicKey).digest('hex'), entitlementVersion: 1, features: ['local'], issuedAt: new Date(wall).toISOString(), notAfter: new Date(wall + 72 * 3600000).toISOString(), keyId: 'license-1', ...overrides };
    const signed = { payload, keyId: 'license-1', signature: sign(null, Buffer.from(canonicalDocument(payload)), signer.privateKey).toString('base64') };
    return { id: 'license-id', plan: 'pro', status: 'active', expiresAt: null, deviceLimit: 2, features: ['local'], lease: JSON.stringify(signed) };
  }
  const identity = { userId: user.id, deviceId, publicKey: device.publicKey };
  return { signer, device, service, user, identity, license, advance(ms: number) { wall += ms; monotonic += Math.max(0, ms); }, clock(ms: number) { wall += ms; }, monotonic(ms: number) { monotonic += ms; } };
}

describe('signed offline software license', () => {
  it('binds a lease to the user, device, installation key and exact signed rights', () => {
    const f = fixture(); const license = f.license();
    const input = { user: f.user, license, environment: 'production' as const, deviceId: f.identity.deviceId, publicKey: f.device.publicKey };
    const cached = f.service.acceptOnline(input);
    expect(f.service.readOffline(cached, f.identity).license.status).toBe('active');
    expect(f.service.readOffline(cached, { ...f.identity, userId: 'another-account' }).license.status).toBe('expired');
    expect(f.service.readOffline(cached, { ...f.identity, deviceId: 'another-device' }).license.status).toBe('expired');
    expect(f.service.readOffline(cached, { ...f.identity, publicKey: keys().publicKey }).license.status).toBe('expired');
    expect(() => f.service.acceptOnline({ ...input, license: { ...license, features: ['platform', 'admin'] } })).toThrow('LICENSE_RIGHTS_MISMATCH');
    const forged = JSON.parse(license.lease!); forged.payload.notAfter = '2036-01-01T00:00:00.000Z';
    expect(() => f.service.acceptOnline({ ...input, license: { ...license, lease: JSON.stringify(forged) } })).toThrow('LICENSE_SIGNATURE_INVALID');
  });
  it('rejects leases longer than 72 hours, expired leases and replayed versions', () => {
    const f = fixture(); const input = { user: f.user, license: f.license(), environment: 'production' as const, deviceId: f.identity.deviceId, publicKey: f.device.publicKey };
    const cached = f.service.acceptOnline(input);
    expect(() => f.service.acceptOnline({ ...input, license: f.license({ notAfter: '2027-01-01T00:00:00.000Z' }) })).toThrow('LICENSE_PERIOD_INVALID');
    f.advance(72 * 3600000); expect(f.service.readOffline(cached, f.identity).license.status).toBe('expired');
    const fresh = f.service.acceptOnline({ ...input, license: f.license({ entitlementVersion: 2 }) });
    expect(() => f.service.acceptOnline({ ...input, license: f.license({ entitlementVersion: 1 }), previous: fresh })).toThrow('LICENSE_REPLAY_REJECTED');
  });
  it('persists detected wall-clock rollback and only clears it after a valid online sync', () => {
    const f = fixture(); const input = { user: f.user, license: f.license(), environment: 'production' as const, deviceId: f.identity.deviceId, publicKey: f.device.publicKey };
    let cached = f.service.acceptOnline(input);
    f.advance(3600000); cached = f.service.readOffline(cached, f.identity).cache;
    f.clock(-600000); const blocked = f.service.readOffline(cached, f.identity);
    expect(blocked.license.status).toBe('expired'); expect(blocked.cache.clockRollbackDetected).toBe(true);
    f.clock(600000); expect(f.service.readOffline(blocked.cache, f.identity).license.status).toBe('expired');
    cached = f.service.acceptOnline({ ...input, license: f.license(), previous: blocked.cache });
    expect(f.service.readOffline(cached, f.identity).license.status).toBe('active');
  });
  it('uses elapsed monotonic time so a frozen wall clock does not prolong an active process lease', () => {
    const f = fixture(); const cached = f.service.acceptOnline({ user: f.user, license: f.license(), environment: 'production', deviceId: f.identity.deviceId, publicKey: f.device.publicKey });
    f.monotonic(72 * 3600000 + 1); const result = f.service.readOffline(cached, f.identity);
    expect(result.license.status).toBe('expired'); expect(result.cache.maxObservedWallMs).toBeGreaterThan(cached.maxObservedWallMs);
  });
});

const fakeEncryption = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from([...Buffer.from(value)].map((byte) => byte ^ 0xa5)), decryptString: (value: Buffer) => Buffer.from([...value].map((byte) => byte ^ 0xa5)).toString() };
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'commercial-license-')); dirs.push(dir);
  const signer = fixture(); let installation = '', offline = false, revoked = false, restricted = false;
  const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
  const fetchImpl: typeof fetch = async (input, request) => {
    if (offline) throw new Error('offline'); const path = new URL(String(input)).pathname;
    if (path === '/v1/public/config') return response({ environment: 'production', paymentAvailable: true, catalog: [] });
    if (path === '/v1/auth/verify') {
      installation = JSON.parse(String(request?.body)).device.publicKey;
      return response({ userId: signer.user.id, deviceId: signer.identity.deviceId, accessToken: 'access-original', refreshToken: 'refresh-original', expiresAt: new Date(Date.now() + 3600000).toISOString() });
    }
    if (path === '/v1/auth/logout') return response({ ok: true });
    if (path === '/v1/me/devices/device-1/binding') { restricted = true; return response({ ok: true }); }
    if (restricted && (path === '/v1/me/snapshot' || path === '/v1/auth/refresh')) return response({ error: { code: 'SESSION_REVOKED' } }, 401);
    if (path === '/v1/me/snapshot') return response({ user: signer.user, wallet: { availableUnits: '90000', reservedUnits: '0', frozenUnits: '0', revision: '1' }, license: revoked ? null : signer.license({ issuedAt: new Date().toISOString(), notAfter: new Date(Date.now() + 3600000).toISOString() }, installation), devices: [{ id: signer.identity.deviceId, name: 'Current', current: true, lastSeenAt: new Date().toISOString() }] });
    throw new Error('unexpected route');
  };
  const options = { dataDir: dir, appVersion: '1.0.0', baseUrl: 'https://platform.example', safeStorage: fakeEncryption, fetchImpl, licensePublicKeys: { 'license-1': signer.signer.publicKey } };
  const service = createCommercialService(options); await service.login({ challengeId: 'challenge', code: '123456' });
  return { dir, service, options, offline(value = true) { offline = value; }, revoke() { revoked = true; }, restrict() { restricted = true; } };
}
describe('offline lease integration', () => {
  it('restores only verified local rights after restart and never restores wallet funds or permits offline platform submissions', async () => {
    const f = await setup(); f.offline();
    const restarted = createCommercialService(f.options), snapshot = await restarted.getSnapshot();
    expect(snapshot.license?.status).toBe('active'); expect(snapshot.wallet).toBeNull(); expect(snapshot.catalog).toEqual([]); expect(snapshot.paymentAvailable).toBe(false); expect(snapshot.message).toContain('离线');
    expect((await restarted.getLocalModelContext()).userId).toBe('account-1');
    await expect(restarted.submit({ quoteId: 'quote-1', operationId: 'operation-1' })).rejects.toThrow('PLATFORM_NETWORK_ERROR');
    const disk = await readFile(join(f.dir, 'auth.v1.json'), 'utf8'); expect(disk).not.toContain('signature'); expect(disk).not.toContain('account-1');
  });
  it('discards cached rights when a connected server returns inactive or revoked entitlement', async () => {
    const f = await setup(); f.revoke(); expect((await f.service.getSnapshot()).license).toBeNull();
    f.offline(); await expect(f.service.getSnapshot()).rejects.toThrow('PLATFORM_NETWORK_ERROR');
  });
  it('does not turn a revoked online session into offline access', async () => {
    const f = await setup(); f.restrict(); await expect(f.service.getSnapshot()).rejects.toThrow();
    f.offline(); await expect(f.service.getSnapshot()).rejects.toThrow('PLATFORM_NETWORK_ERROR');
    expect((await f.service.getLocalModelContext()).userId).toBeNull();
  });
  it('clears the lease on explicit logout and never uses it for the next account', async () => {
    const f = await setup(); await f.service.logout(); f.offline();
    await expect(f.service.getSnapshot()).rejects.toThrow('PLATFORM_NETWORK_ERROR');
    expect((await f.service.getLocalModelContext()).profiles.profiles).toEqual([]);
  });
  it('returns signed-out state immediately after unbinding the current device', async () => {
    const f = await setup(); const snapshot = await f.service.unbindDevice('device-1');
    expect(snapshot.authenticated).toBe(false); expect(snapshot.license).toBeNull();
    f.offline(); await expect(f.service.getSnapshot()).rejects.toThrow('PLATFORM_NETWORK_ERROR');
  });
});
