import { createHash, createPublicKey, verify } from 'node:crypto';
import { request } from 'node:https';
import { z } from 'zod';
import { AppError } from '../src/shared/app-error';
import type { LicenseLease, ReleaseManifest, SignedEnvelope } from '../src/shared/licensing';

export const licenseConfigSchema = z.object({
  schemaVersion: z.literal(1),
  baseUrl: z.url().refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
    } catch { return false; }
  }),
  caPem: z.string().min(100).max(16384),
  signingPublicKey: z.string().min(50).max(4096),
}).strict();
export type LicensePublicConfig = z.infer<typeof licenseConfigSchema>;

const time = z.number().int().nonnegative().safe();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const version = z.string().regex(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/);
const leaseSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('lease'), status: z.literal('active'),
  licenseId: z.string().uuid(), deviceId: hash, keyHash: hash, issuedAt: time, validUntil: time,
  expiresAt: time, maxDevices: z.number().int().min(1).max(100),
  devices: z.array(z.object({ deviceId: hash, label: z.string().max(120), lastSeen: time })).max(100),
}).strict();
const releaseSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('release'), sequence: z.number().int().positive().safe(),
  version, minimumVersion: version, platform: z.literal('win32'), arch: z.literal('x64'),
  filename: z.string().regex(/^StoryDream-Setup-[0-9.]+-[a-f0-9]{12}\.exe$/),
  sha256: hash, size: z.number().int().min(2).max(4 * 1024 ** 3), notes: z.string().max(8000),
  issuedAt: time, validUntil: time,
}).strict();

export function compareVersions(left: string, right: string): number {
  const a = version.parse(left).split('.').map(BigInt);
  const b = version.parse(right).split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

export function verifyEnvelope(value: unknown, publicKey: string): unknown {
  const envelope = z.object({ payload: z.string().max(65536), signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/) }).strict().parse(value);
  const key = createPublicKey(publicKey);
  if (key.asymmetricKeyType !== 'ed25519' || !verify(null, Buffer.from(envelope.payload), key, Buffer.from(envelope.signature, 'base64'))) {
    throw new AppError('LICENSE_SIGNATURE_INVALID', '服务签名校验失败。');
  }
  return JSON.parse(envelope.payload);
}

export function verifyLease(envelope: SignedEnvelope, config: LicensePublicConfig, deviceId: string, publicKey: string, now: number): LicenseLease {
  const lease = leaseSchema.parse(verifyEnvelope(envelope, config.signingPublicKey));
  const keyHash = createHash('sha256').update(createPublicKey(publicKey).export({ format: 'der', type: 'spki' })).digest('hex');
  if (lease.deviceId !== deviceId || lease.keyHash !== keyHash || lease.issuedAt > now + 60 || lease.validUntil <= now ||
      lease.validUntil > lease.issuedAt + 600 || lease.validUntil > lease.expiresAt || lease.issuedAt >= lease.validUntil ||
      !lease.devices.some((device) => device.deviceId === deviceId)) {
    throw new AppError('LICENSE_LEASE_INVALID', '设备授权已失效，请联网验证。');
  }
  return lease;
}

export function verifyRelease(envelope: SignedEnvelope, config: LicensePublicConfig, now: number): ReleaseManifest {
  const release = releaseSchema.parse(verifyEnvelope(envelope, config.signingPublicKey));
  if (release.issuedAt > now + 60 || release.validUntil <= now || release.validUntil > release.issuedAt + 86400 ||
      release.issuedAt >= release.validUntil || compareVersions(release.minimumVersion, release.version) > 0 ||
      !release.filename.startsWith(`StoryDream-Setup-${release.version}-`)) {
    throw new AppError('UPDATE_MANIFEST_INVALID', '更新清单已失效或不完整。');
  }
  return release;
}

export class LicenseRemoteError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

export class LicenseTransport {
  constructor(readonly config: LicensePublicConfig) {}

  async json<T>(path: string, body?: SignedEnvelope): Promise<T> {
    const serialized = body ? Buffer.from(JSON.stringify(body)) : undefined;
    const response = await this.open(path, serialized);
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const block of response) {
      length += block.length;
      if (length > 131072) { response.destroy(); throw new Error('LICENSE_RESPONSE_TOO_LARGE'); }
      chunks.push(Buffer.from(block));
    }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (response.statusCode !== 200) throw new LicenseRemoteError(typeof value.error === 'string' ? value.error : 'SERVER_UNAVAILABLE', response.statusCode ?? 503);
    return value as T;
  }

  open(path: string, body?: Buffer, offset?: number) {
    if (!path.startsWith('/v1/') || path.includes('..') || path.includes('?') || path.includes('#')) throw new Error('INVALID_LICENSE_PATH');
    return new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
      const req = request(new URL(path, this.config.baseUrl), {
        method: body ? 'POST' : 'GET', ca: this.config.caPem, rejectUnauthorized: true,
        minVersion: 'TLSv1.2', agent: false,
        headers: body ? { 'Content-Type': 'application/json', 'Content-Length': body.length } : offset ? { Range: `bytes=${offset}-` } : {},
      }, (response) => {
        response.setTimeout(30000, () => response.destroy(new Error('LICENSE_RESPONSE_TIMEOUT')));
        resolve(response);
      });
      req.setTimeout(15000, () => req.destroy(new Error('LICENSE_CONNECTION_TIMEOUT')));
      req.on('error', reject);
      req.end(body);
    });
  }
}
