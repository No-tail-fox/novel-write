import { createHash, createPublicKey, verify } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import type { PlatformLicense, PlatformUser } from '../src/shared/commercial-contract';
import { canonicalDocument } from './platform-update-service';

const instant = z.string().datetime({ offset: true });
const boundedId = z.string().min(1).max(128);
const leasePayloadSchema = z.object({
  licenseId: boundedId, userId: boundedId, deviceId: boundedId,
  devicePublicKeyHash: z.string().regex(/^[a-f0-9]{64}$/),
  entitlementVersion: z.number().int().positive(), features: z.array(z.string().min(1).max(100)).max(100),
  issuedAt: instant, notAfter: instant, keyId: boundedId,
}).strict();
const signedLeaseSchema = z.object({ payload: leasePayloadSchema, keyId: boundedId, signature: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(128) }).strict();
export const offlineLicenseCacheSchema = z.object({
  user: z.object({ id: boundedId, displayName: z.string().max(100), phone: z.string().max(32) }),
  deviceId: boundedId, environment: z.enum(['development', 'production']),
  license: z.object({ id: boundedId, plan: z.string().max(100), status: z.literal('active'), expiresAt: instant.nullable(), deviceLimit: z.number().int().min(0).max(1000), features: z.array(z.string().max(100)).max(100), lease: z.string().max(20000) }),
  maxObservedWallMs: z.number().int().nonnegative(), clockRollbackDetected: z.boolean().default(false),
});
export type OfflineLicenseCache = z.infer<typeof offlineLicenseCacheSchema>;
interface LicenseIdentity { userId: string; deviceId: string; publicKey: string }
export interface LicenseServiceOptions { publicKeys?: Record<string, string>; now?: () => number; monotonicNow?: () => number }
const CLOCK_TOLERANCE_MS = 120000;
const MAX_LEASE_MS = 72 * 60 * 60 * 1000;

/** Verifies only software rights. It never caches a wallet or authorizes platform spending. */
export function createLicenseService(options: LicenseServiceOptions) {
  const now = options.now ?? Date.now, monotonicNow = options.monotonicNow ?? (() => performance.now());
  const anchors = new Map<string, { wall: number; monotonic: number }>();
  function parseLease(license: PlatformLicense, identity: LicenseIdentity) {
    let signed: z.infer<typeof signedLeaseSchema>;
    try { signed = signedLeaseSchema.parse(JSON.parse(license.lease ?? '')); }
    catch { throw new Error('LICENSE_LEASE_INVALID: 离线授权数据无效，请联网同步。'); }
    const { payload, keyId, signature } = signed;
    try {
      const pem = options.publicKeys?.[keyId];
      if (!pem || keyId !== payload.keyId) throw new Error('Unknown license key');
      const key = createPublicKey(pem), bytes = Buffer.from(signature, 'base64');
      if (key.asymmetricKeyType !== 'ed25519' || bytes.length !== 64 || bytes.toString('base64') !== signature || !verify(null, Buffer.from(canonicalDocument(payload)), key, bytes)) throw new Error('Invalid signature');
    } catch { throw new Error('LICENSE_SIGNATURE_INVALID: 离线授权签名校验失败。'); }
    if (payload.userId !== identity.userId || payload.deviceId !== identity.deviceId || payload.devicePublicKeyHash !== createHash('sha256').update(identity.publicKey).digest('hex') || payload.licenseId !== license.id) throw new Error('LICENSE_IDENTITY_MISMATCH: 此授权不属于当前账号或设备。');
    if (license.status !== 'active' || canonicalDocument([...payload.features].sort()) !== canonicalDocument([...license.features].sort())) throw new Error('LICENSE_RIGHTS_MISMATCH: 授权权益与签名不一致。');
    const issued = Date.parse(payload.issuedAt), expires = Date.parse(payload.notAfter);
    if (expires <= issued || expires - issued > MAX_LEASE_MS || (license.expiresAt && expires > Date.parse(license.expiresAt))) throw new Error('LICENSE_PERIOD_INVALID: 离线授权有效期无效。');
    return signed;
  }
  function trustedTime(cache: OfflineLicenseCache): number {
    let anchor = anchors.get(cache.license.lease);
    if (!anchor) { anchor = { wall: cache.maxObservedWallMs, monotonic: monotonicNow() }; anchors.set(cache.license.lease, anchor); }
    return Math.max(now(), cache.maxObservedWallMs, Math.floor(anchor.wall + Math.max(0, monotonicNow() - anchor.monotonic)));
  }
  function acceptOnline(input: { user: PlatformUser; license: PlatformLicense; environment: 'development' | 'production'; deviceId: string; publicKey: string; previous?: OfflineLicenseCache }): OfflineLicenseCache {
    const signed = parseLease(input.license, { userId: input.user.id, deviceId: input.deviceId, publicKey: input.publicKey });
    const wall = now(), issued = Date.parse(signed.payload.issuedAt);
    if (Math.abs(issued - wall) > CLOCK_TOLERANCE_MS || wall >= Date.parse(signed.payload.notAfter)) throw new Error('LICENSE_CLOCK_INVALID: 系统时间与授权时间不一致，请校正时间后同步。');
    if (input.previous?.user.id === input.user.id) {
      // The encrypted cache was verified on receipt. Its retired signing key may no longer
      // be distributed, but its version/time watermark still prevents lease rollback.
      const prior = signedLeaseSchema.parse(JSON.parse(input.previous.license.lease));
      if (prior.payload.licenseId === signed.payload.licenseId && (signed.payload.entitlementVersion < prior.payload.entitlementVersion || issued < Date.parse(prior.payload.issuedAt))) throw new Error('LICENSE_REPLAY_REJECTED: 离线授权版本已回退。');
    }
    const cache = offlineLicenseCacheSchema.parse({ user: input.user, deviceId: input.deviceId, environment: input.environment, license: input.license, maxObservedWallMs: wall, clockRollbackDetected: false });
    anchors.set(cache.license.lease, { wall, monotonic: monotonicNow() });
    return cache;
  }
  function readOffline(cache: OfflineLicenseCache, identity: LicenseIdentity): { cache: OfflineLicenseCache; license: PlatformLicense; message: string } {
    const next = structuredClone(cache);
    const blocked = (message: string) => ({ cache: next, license: { ...next.license, status: 'expired' as const, features: [], lease: undefined }, message });
    try {
      const signed = parseLease(cache.license, identity);
      if (cache.clockRollbackDetected || now() + CLOCK_TOLERANCE_MS < cache.maxObservedWallMs) {
        next.clockRollbackDetected = true;
        return blocked('检测到系统时间回退，离线授权已暂停；请校正时间并联网同步。本地作品仍可查看和导出。');
      }
      const effectiveNow = trustedTime(cache); next.maxObservedWallMs = effectiveNow;
      if (Date.parse(signed.payload.issuedAt) > effectiveNow + CLOCK_TOLERANCE_MS || effectiveNow >= Date.parse(signed.payload.notAfter)) return blocked('离线授权已到期，请联网同步；本地作品仍可查看和导出。');
      return { cache: next, license: { ...cache.license, features: [...signed.payload.features], expiresAt: signed.payload.notAfter, lease: undefined }, message: `当前离线，软件授权可用至 ${signed.payload.notAfter}。平台积分、充值和模型生成需要联网。` };
    } catch { return blocked('离线授权无法通过签名或设备验证，请联网同步；本地作品仍可查看和导出。'); }
  }
  return { configured: () => Object.keys(options.publicKeys ?? {}).length > 0, acceptOnline, readOffline };
}
