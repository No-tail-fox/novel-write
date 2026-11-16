import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { hostname } from 'node:os';
import { readMachineIdentity, type MachineIdentity } from './license-machine-identity';
import { z } from 'zod';
import { AppError } from '../src/shared/app-error';
import type { AnyLicenseLease, LicenseLease, LicenseLeaseV3, LicenseStatus, RecoveryRequest, SignedEnvelope } from '../src/shared/licensing';
import { licenseConfigSchema, LicenseRemoteError, LicenseTransport, verifyEnvelope, verifyLease, verifyLeaseV3, type LicensePublicConfig } from './license-security';

interface Encryption {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

const pendingRecoverySchema = z.object({ id: z.string().uuid(), licenseId: z.string().uuid(), expiresAt: z.number().int().nonnegative() }).strict();

// V1/V2 vault schema (kept for read-back and migration).
const vaultSchemaLegacy = z.object({
  pendingRecovery: pendingRecoverySchema.optional(),
  version: z.literal(1), deviceId: z.string().regex(/^[a-f0-9]{64}$/), privateKey: z.string().max(4096),
  legacyDeviceId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  lastClock: z.number().nonnegative(), releaseSequence: z.number().int().nonnegative(), releaseHash: z.string(),
  lease: z.object({ payload: z.string().max(65536), signature: z.string().max(128) }).strict().optional(),
}).strict();

// V3 vault schema: server-assigned device record + credential IDs, binding metadata.
const vaultSchemaV3 = z.object({
  version: z.literal(3),
  /** Server-assigned device record UUID. */
  deviceRecordId: z.string().uuid().optional(),
  /** Server-assigned credential UUID for the active public key. */
  credentialId: z.string().uuid().optional(),
  privateKey: z.string().max(4096),
  /** Incremented on rebind/recovery; from last signed lease. */
  bindingRevision: z.number().int().nonnegative().optional(),
  bindingId: z.string().uuid().optional(),
  licenseId: z.string().uuid().optional(),
  credentialEpoch: z.number().int().nonnegative().optional(),
  lastClock: z.number().nonnegative(),
  releaseSequence: z.number().int().nonnegative(),
  releaseHash: z.string(),
  lease: z.object({ payload: z.string().max(65536), signature: z.string().max(128) }).strict().optional(),
  /** Stash of pending recovery request so the user can resume after restart. */
  pendingRecovery: pendingRecoverySchema.optional(),
}).strict();

type LegacyVault = z.infer<typeof vaultSchemaLegacy>;
type VaultV3 = z.infer<typeof vaultSchemaV3>;
type AnyVault = LegacyVault | VaultV3;

function isV3(vault: AnyVault): vault is VaultV3 { return vault?.version === 3; }

const messages: Record<string, string> = {
  INVALID_ACTIVATION_CODE: '激活码无效。', DEVICE_LIMIT_REACHED: '授权设备数量已满，请先解绑旧设备。',
  DEVICE_ALREADY_BOUND: '此设备编号已有授权绑定，或本机凭据与绑定不一致。请让管理员核对设备编号是否重复，勿直接解绑其他用户的设备。',
  DEVICE_IDENTITY_MIGRATED: '此设备凭据已迁移，请使用新版软件；若仍失败，请联系管理员核对设备身份。',
  INVALID_DEVICE_IDENTITY: '设备身份信息无效，请联系管理员检查设备凭据。',
  NOT_FOUND: '授权服务尚未支持当前设备身份协议，请联系管理员先升级授权服务。',
  DEVICE_NOT_BOUND: '本机尚未绑定授权，或已被远程解绑。', DEVICE_LOCKED: '本机已被管理员锁定。',
  LICENSE_REVOKED: '此授权已被管理员停用。', LICENSE_EXPIRED: '授权已到期。',
  CLOCK_SKEW: '本机时间与服务器不一致，请校准系统时间。', RATE_LIMITED: '请求过于频繁，请稍后重试。',
  CREDENTIAL_NOT_FOUND: '本机凭据与服务器记录不匹配，请通过恢复流程重新绑定。',
  CREDENTIAL_REVOKED: '本机旧凭据已被撤销，请使用已批准恢复的凭据。',
  CREDENTIAL_ALREADY_ACTIVE: '此凭据已有活动绑定，不能作为恢复申请的新凭据。',
  BINDING_CHANGED: '授权绑定已变化，请重新激活或联系管理员核对绑定。',
  CHALLENGE_INVALID: '授权验证挑战已失效，请重试。',
  RECOVERY_PENDING: '已有待处理的恢复申请，请联系管理员审核或等待审核完成。',
  RECOVERY_EXPIRED: '恢复申请已过期，请重新发起恢复申请。',
  RECOVERY_NOT_FOUND: '恢复申请不存在或已完成。',
  BINDING_CONFLICT: '设备绑定冲突，请联系管理员处理。',
};

export async function readMachineId(): Promise<string> {
  return (await readMachineIdentity()).deviceId;
}

export class LicenseService {
  config: LicensePublicConfig | null = null;
  transport: LicenseTransport | null = null;
  private vault: AnyVault | null = null;
  private identity: MachineIdentity | null = null;
  private lease: AnyLicenseLease | null = null;
  private state: LicenseStatus = { configured: false, status: 'unconfigured', deviceId: '', deviceLabel: hostname().slice(0, 120), expiresAt: null, validUntil: null, devices: [], message: '授权服务尚未配置。' };
  private queue: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private expiryTimer?: ReturnType<typeof setTimeout>;
  private readonly startWall = Date.now() / 1000;
  private readonly startMono = performance.now();
  private lastCheck = 0;

  constructor(private readonly options: { config: unknown; vaultPath: string; encryption: Encryption; packaged: boolean; machineId?: () => Promise<string>; machineIdentity?: () => Promise<MachineIdentity>; onChange?: (status: LicenseStatus) => Promise<void> | void }) {}

  get enforced(): boolean { return true; }
  now(): number { return Math.floor(Math.max(Date.now() / 1000, this.startWall + (performance.now() - this.startMono) / 1000, this.vault?.lastClock ?? 0)); }

  async initialize(): Promise<void> {
    const parsed = licenseConfigSchema.safeParse(this.options.config);
    if (!parsed.success) {
      if (this.options.packaged) this.state.message = '此安装包未配置授权服务，无法生成新内容。';
      await this.notify();
      return;
    }
    this.config = parsed.data;
    this.transport = new LicenseTransport(this.config);
    this.state.configured = true;
    try {
      if (!this.options.encryption.isEncryptionAvailable()) throw new Error('ENCRYPTION_UNAVAILABLE');
      const identity: MachineIdentity = await (this.options.machineIdentity ? this.options.machineIdentity()
        : this.options.machineId ? this.options.machineId().then(deviceId => ({ deviceId })) : readMachineIdentity()).catch(() => ({ deviceId: '' }));
      this.identity = identity;
      try {
        const raw = vaultSchemaV3.safeParse(JSON.parse(this.options.encryption.decryptString(await readFile(this.options.vaultPath))));
        if (raw.success) {
          const v3 = raw.data;
          if (createPrivateKey(v3.privateKey).asymmetricKeyType !== 'ed25519') throw new Error('DEVICE_CREDENTIAL_MISMATCH');
          this.vault = v3;
          this.state.deviceId = v3.deviceRecordId ?? '';
        } else {
          // Try legacy vault for migration path.
          const legacy = vaultSchemaLegacy.parse(JSON.parse(this.options.encryption.decryptString(await readFile(this.options.vaultPath))));
          if (createPrivateKey(legacy.privateKey).asymmetricKeyType !== 'ed25519') throw new Error('DEVICE_CREDENTIAL_MISMATCH');
          this.vault = legacy;
          this.state.deviceId = legacy.deviceId;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        // Brand-new installation: generate key but do NOT create device record yet.
        // The server assigns deviceRecordId + credentialId on first successful activate.
        const keys = generateKeyPairSync('ed25519');
        this.vault = {
          version: 3, privateKey: keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
          lastClock: 0, releaseSequence: 0, releaseHash: '',
        };
        this.state.deviceId = '';
        await this.persist();
      }
      this.state.status = 'inactive';
      this.state.message = '本机尚未激活。';
      await this.restoreStoredLease();
      await this.refresh().catch(() => undefined);
      this.timer = setInterval(() => { void this.refresh().catch(() => undefined); }, 120000);
      this.timer.unref();
    } catch (error) {
      const reason = error instanceof z.ZodError ? 'VAULT_SCHEMA_INVALID:' + error.issues.slice(0, 3).map((issue) => issue.path.join('.') + ' ' + issue.code).join(',')
        : error instanceof Error ? (error.message.split('\n')[0] ?? '').slice(0, 120) : 'UNKNOWN';
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      this.vault = null;
      this.state.status = 'error';
      this.state.message = '无法读取本机加密凭据，请检查系统加密功能或联系管理员。（原因：' + reason + (code ? ' / ' + code : '') + '）';
      await mkdir(dirname(this.options.vaultPath), { recursive: true }).catch(() => undefined);
      await writeFile(this.options.vaultPath + '.error.log', new Date().toISOString() + ' ' + reason + ' ' + (code ?? '') + '\n', { flag: 'a' }).catch(() => undefined);
    }
    await this.notify();
  }

  private async restoreStoredLease(): Promise<void> {
    if (!this.vault || !this.config) return;
    const stored = this.vault.lease;
    if (!stored) return;
    try {
      if (isV3(this.vault)) {
        const lease = verifyLeaseV3(stored, this.config, this.vault.credentialId ?? null, this.publicKey(), this.now(), true);
        this.assertV3Identity(lease);
        Object.assign(this.vault, this.leaseIdentity(lease));
        this.setActiveLease(lease, 'offline', '已使用本机保存的授权，请尽快联网验证。');
        return;
      }
      // Legacy offline authority remains bound to the retained ID and key, not fresh hardware evidence.
      const legacy = this.vault as LegacyVault;
      const lease = verifyLease(stored, this.config, legacy.deviceId, this.publicKey(), this.now(), true);
      this.setActiveLease(lease, 'offline', '已使用本机保存的授权，请尽快联网验证。');
    } catch {
      delete this.vault.lease;
      await this.persist().catch(() => undefined);
    }
  }

  close(): void { clearInterval(this.timer); clearTimeout(this.expiryTimer); }
  private deadline(lease: AnyLicenseLease): number { return Math.min(lease.expiresAt, lease.offlineGraceUntil ?? lease.validUntil); }

  status(): LicenseStatus {
    const result = structuredClone(this.state);
    if (this.lease && ['active', 'offline'].includes(result.status)) {
      const now = this.now();
      if (this.deadline(this.lease) <= now) {
        result.status = 'expired'; result.message = '联网授权已过期，请重新验证。';
      } else if (this.lease.validUntil <= now) {
        result.status = 'offline';
        result.message = '暂时无法连接授权服务，离线宽限期将于 ' + new Date(this.deadline(this.lease) * 1000).toLocaleString() + ' 结束，请尽快联网验证。';
      }
    }
    return result;
  }

  async requireActive(): Promise<void> {
    if (!this.enforced) return;
    if (this.lease && this.lease.validUntil > this.now() && performance.now() - this.lastCheck < 120000) return;
    await this.refresh().catch(() => undefined);
    if (!this.lease || this.deadline(this.lease) <= this.now()) throw new AppError('LICENSE_REQUIRED', this.status().message);
  }

  activate(code: string): Promise<LicenseStatus> {
    return this.exclusive(async () => {
      if (!this.vault) throw new AppError('LICENSE_UNAVAILABLE', this.state.message);
      return this.activateV3(code);
    });
  }

  refresh(): Promise<LicenseStatus> {
    return this.exclusive(async () => {
      if (!this.vault) throw new AppError('LICENSE_UNAVAILABLE', this.state.message);
      if (isV3(this.vault)) {
        if (!this.vault.bindingId || !this.vault.licenseId || this.vault.credentialEpoch === undefined) return this.status();
        return this.exchangeV3('/v3/license/refresh');
      }
      return this.exchange('/v1/license/refresh');
    });
  }

  release(): Promise<LicenseStatus> {
    return this.exclusive(async () => {
      try {
        const path = isV3(this.vault!) ? '/v3/license/release' : '/v1/license/release';
        await this.send(path);
        if (this.vault?.lease) { delete this.vault.lease; await this.persist().catch(() => undefined); }
        this.clearLease('inactive', '本机已解绑。');
        await this.notify();
        return this.status();
      } catch (error) { await this.handleError(error); throw new AppError('LICENSE_RELEASE_FAILED', this.state.message); }
    });
  }

  async acceptRelease(sequence: number, hash: string): Promise<void> {
    await this.exclusive(async () => {
      if (!this.vault || sequence < this.vault.releaseSequence || sequence === this.vault.releaseSequence && this.vault.releaseHash !== hash) throw new AppError('UPDATE_REPLAY_REJECTED', '更新版本记录校验失败。');
      this.vault.releaseSequence = sequence; this.vault.releaseHash = hash;
      await this.persist();
    });
  }

  /** Returns info about a pending recovery request if one is stored locally. */
  pendingRecovery(): { id: string; licenseId: string; expiresAt: number } | null {
    if (!this.vault) return null;
    const rec = this.vault.pendingRecovery;
    if (!rec || rec.expiresAt < this.now()) return null;
    return rec;
  }

  /** Request recovery: attach new public key to an existing device record via admin approval. */
  requestRecovery(licenseCode: string): Promise<RecoveryRequest> {
    return this.exclusive(async () => {
      if (!this.vault || !this.transport || !this.config) throw new AppError('LICENSE_UNAVAILABLE', this.state.message);
      // Obtain a challenge scoped to recovery + new public key.
      const challengeResult = await this.challenge('recovery', licenseCode);
      const payload = JSON.stringify({
        challengeId: challengeResult.challengeId,
        code: licenseCode.trim(),
        label: this.state.deviceLabel,
        publicKey: this.publicKey(),
        nonce: randomUUID(),
        timestamp: Math.floor(Date.now() / 1000),
      });
      const signature = sign(null, Buffer.from(`/v3/license/recover\n${payload}`), this.vault.privateKey).toString('base64');
      const result = await this.transport.json<RecoveryRequest>('/v3/license/recover', { payload, signature });
      const pending = pendingRecoverySchema.parse({ id: result.id, licenseId: result.licenseId, expiresAt: result.expiresAt });
      this.vault.pendingRecovery = pending;
      await this.persist();
      return result;
    });
  }

  /** Reenter the original code after approval; the proposed key survives restart. */
  resumeRecovery(code: string): Promise<LicenseStatus> {
    return this.exclusive(async () => {
      if (!this.vault?.pendingRecovery) throw new AppError('RECOVERY_NOT_FOUND', messages.RECOVERY_NOT_FOUND);
      return this.activateV3(code);
    });
  }

  private async challenge(purpose: 'activate' | 'recovery', code: string): Promise<{ challengeId: string; expiresAt: number }> {
    if (!this.transport || !this.vault) throw new AppError('LICENSE_UNAVAILABLE', this.state.message);
    const result = z.object({ challengeId: z.string().uuid(), expiresAt: z.number().int().nonnegative() }).strict().parse(
      await this.transport.json('/v3/license/challenge', this.signedPayload('/v3/license/challenge', { purpose, code: code.trim(), publicKey: this.publicKey() })));
    if (result.expiresAt <= this.now() || result.expiresAt > this.now() + 600) throw new AppError('LICENSE_CHALLENGE_INVALID', '服务挑战已失效。');
    return result;
  }

  private async activateV3(code: string): Promise<LicenseStatus> {
    try {
      const challenge = await this.challenge('activate', code);
      const envelope = await this.transport!.json<SignedEnvelope>('/v3/license/activate', this.signedPayload('/v3/license/activate', {
        code: code.trim(), label: this.state.deviceLabel, publicKey: this.publicKey(), challengeId: challenge.challengeId,
      }));
      return await this.commitV3Lease(envelope, true);
    } catch (error) {
      await this.handleError(error);
      throw new AppError('LICENSE_VERIFICATION_FAILED', this.state.message);
    }
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const task = this.queue.then(work);
    this.queue = task.catch(() => undefined);
    return task;
  }

  private publicKey(): string { return createPublicKey(this.vault!.privateKey).export({ format: 'pem', type: 'spki' }).toString(); }

  private signedPayload(path: string, extra: Record<string, unknown>): SignedEnvelope {
    if (!this.vault) throw new AppError('LICENSE_UNAVAILABLE', this.state.message);
    const payload = JSON.stringify({ ...extra, nonce: randomUUID(), timestamp: Math.floor(Date.now() / 1000) });
    const signature = sign(null, Buffer.from(`${path}\n${payload}`), this.vault.privateKey).toString('base64');
    return { payload, signature };
  }

  private async send(path: string, extra: Record<string, unknown> = {}): Promise<SignedEnvelope> {
    if (!this.vault || !this.transport || !this.identity) throw new AppError('LICENSE_UNAVAILABLE', this.state.message);
    if (isV3(this.vault)) {
      const payload = JSON.stringify({
        ...extra,
        deviceRecordId: this.vault.deviceRecordId,
        credentialId: this.vault.credentialId,
        bindingId: this.vault.bindingId, licenseId: this.vault.licenseId,
        bindingRevision: this.vault.bindingRevision, credentialEpoch: this.vault.credentialEpoch,
        publicKey: this.publicKey(),
        nonce: randomUUID(),
        timestamp: Math.floor(Date.now() / 1000),
      });
      const signature = sign(null, Buffer.from(`${path}\n${payload}`), this.vault.privateKey).toString('base64');
      return this.transport.json<SignedEnvelope>(path, { payload, signature });
    }
    // Legacy path.
    const legacy = this.vault as LegacyVault;
    const requestPath = legacy.legacyDeviceId ? path.replace('/v1/license/', '/v2/license/') : path;
    const payload = JSON.stringify({ ...extra, deviceId: legacy.deviceId, ...(legacy.legacyDeviceId ? { legacyDeviceId: legacy.legacyDeviceId } : {}), publicKey: this.publicKey(), nonce: randomUUID(), timestamp: Math.floor(Date.now() / 1000) });
    const signature = sign(null, Buffer.from(`${requestPath}\n${payload}`), legacy.privateKey).toString('base64');
    return this.transport.json<SignedEnvelope>(requestPath, { payload, signature });
  }

  /** Exchange for v1/v2 endpoints; upgrades vault to v3 when server returns schemaVersion 3. */
  private async exchange(path: string, extra: Record<string, unknown> = {}): Promise<LicenseStatus> {
    try {
      const envelope = await this.send(path, extra);
      // Server may return a v3 lease (after migration) or v1.
      const parsed = verifyEnvelope(envelope, this.config!.signingPublicKey);
      if (parsed && typeof parsed === 'object' && (parsed as Record<string, unknown>).schemaVersion === 3) {
        return await this.commitV3Lease(envelope as SignedEnvelope);
      }
      const lease = verifyLease(envelope, this.config!, (this.vault as LegacyVault).deviceId, this.publicKey(), this.now());
      const previousVault = this.vault!;
      const nextVault = { ...previousVault, lastClock: Math.max(previousVault.lastClock, lease.issuedAt) } as LegacyVault;
      if (lease.offlineGraceUntil !== undefined) nextVault.lease = { payload: (envelope as unknown as { payload: string }).payload, signature: (envelope as unknown as { signature: string }).signature };
      else delete nextVault.lease;
      this.vault = nextVault;
      try { await this.persist(); } catch (error) { this.vault = previousVault; throw error; }
      this.setActiveLease(lease, 'active', '授权有效。');
      await this.notify();
      return this.status();
    } catch (error) {
      await this.handleError(error);
      throw new AppError('LICENSE_VERIFICATION_FAILED', this.state.message);
    }
  }

  /** Exchange for v3 endpoints. */
  private async exchangeV3(path: string, extra: Record<string, unknown> = {}): Promise<LicenseStatus> {
    try {
      const envelope = await this.send(path, extra);
      return await this.commitV3Lease(envelope);
    } catch (error) {
      await this.handleError(error);
      throw new AppError('LICENSE_VERIFICATION_FAILED', this.state.message);
    }
  }

  private leaseIdentity(lease: LicenseLeaseV3) {
    return { deviceRecordId: lease.deviceRecordId, credentialId: lease.credentialId, licenseId: lease.licenseId,
      bindingId: lease.bindingId, bindingRevision: lease.bindingRevision, credentialEpoch: lease.credentialEpoch };
  }

  private assertV3Identity(lease: LicenseLeaseV3, enrollment = false): void {
    if (!this.vault || !isV3(this.vault)) return;
    const vault = this.vault;
    for (const field of ['deviceRecordId', 'credentialId', 'credentialEpoch'] as const) {
      if (vault[field] !== undefined && vault[field] !== lease[field]) throw new AppError('LICENSE_LEASE_INVALID', '设备身份校验失败。');
    }
    if (!enrollment) {
      for (const field of ['bindingId', 'licenseId', 'bindingRevision'] as const) {
        if (vault[field] !== undefined && vault[field] !== lease[field]) throw new AppError('LICENSE_LEASE_INVALID', '设备绑定校验失败。');
      }
    }
  }

  private async commitV3Lease(envelope: SignedEnvelope, enrollment = false): Promise<LicenseStatus> {
    // Assigned IDs are accepted only from a server-signed lease bound to our retained key.
    const lease = verifyLeaseV3(envelope, this.config!, null, this.publicKey(), this.now());
    this.assertV3Identity(lease, enrollment);
    const previousVault = this.vault!;
    if (enrollment && previousVault.pendingRecovery && lease.licenseId !== previousVault.pendingRecovery.licenseId) {
      throw new AppError('LICENSE_LEASE_INVALID', '恢复授权与申请不匹配。');
    }
    const v3Vault: VaultV3 = {
      version: 3, ...this.leaseIdentity(lease), privateKey: previousVault.privateKey,
      lastClock: Math.max(previousVault.lastClock, lease.issuedAt),
      releaseSequence: previousVault.releaseSequence, releaseHash: previousVault.releaseHash,
      ...(!enrollment && previousVault.pendingRecovery ? { pendingRecovery: previousVault.pendingRecovery } : {}),
    };
    if (lease.offlineGraceUntil !== undefined) v3Vault.lease = envelope;
    this.vault = v3Vault;
    try { await this.persist(); } catch (error) { this.vault = previousVault; throw error; }
    this.state.deviceId = lease.deviceRecordId;
    this.setActiveLease(lease, 'active', '授权有效。');
    await this.notify();
    return this.status();
  }

  private async handleError(error: unknown): Promise<void> {
    if (error instanceof LicenseRemoteError && error.status >= 400 && error.status < 500 && error.status !== 429) {
      if (this.vault?.lease) { delete this.vault.lease; await this.persist().catch(() => undefined); }
      this.clearLease(['DEVICE_LOCKED', 'LICENSE_REVOKED'].includes(error.code) ? 'locked' : error.code === 'LICENSE_EXPIRED' ? 'expired' : 'inactive', messages[error.code] ?? '设备验证失败，请联系管理员。');
    } else if (this.lease && this.deadline(this.lease) > this.now()) {
      const inGrace = this.lease.validUntil <= this.now();
      this.state.status = 'offline';
      this.state.message = inGrace
        ? '暂时无法连接授权服务，离线宽限期将于 ' + new Date(this.deadline(this.lease) * 1000).toLocaleString() + ' 结束，请尽快联网验证。'
        : '暂时无法连接授权服务，当前授权将于 ' + new Date(this.lease.validUntil * 1000).toLocaleTimeString() + ' 失效。';
    } else {
      this.clearLease(this.config ? 'error' : 'unconfigured', error instanceof AppError ? error.message : messages[(error as LicenseRemoteError).code] ?? '无法连接授权服务，请检查网络和系统时间。');
    }
    await this.notify();
  }

  private setActiveLease(lease: AnyLicenseLease, status: 'active' | 'offline', message: string): void {
    this.lease = lease;
    this.lastCheck = performance.now();
    const devices = 'deviceRecordId' in lease
      ? (lease as LicenseLeaseV3).devices.map(d => ({ deviceId: d.deviceRecordId, label: d.label, lastSeen: d.lastSeen }))
      : (lease as LicenseLease).devices;
    this.state = { ...this.state, status, expiresAt: new Date(lease.expiresAt * 1000).toISOString(), validUntil: new Date(lease.validUntil * 1000).toISOString(), devices, message };
    clearTimeout(this.expiryTimer);
    this.expiryTimer = setTimeout(() => {
      this.clearLease('expired', '联网授权已过期，请重新验证。');
      void this.notify().catch(() => undefined);
    }, Math.max(0, (this.deadline(lease) - this.now()) * 1000));
    this.expiryTimer.unref();
  }

  private clearLease(status: LicenseStatus['status'], message: string): void {
    clearTimeout(this.expiryTimer);
    this.lease = null;
    this.state = { ...this.state, status, message, validUntil: null, expiresAt: null, devices: [] };
  }

  private async notify(): Promise<void> { await this.options.onChange?.(this.status()); }
  private async persist(): Promise<void> {
    if (!this.vault) throw new Error('MACHINE_VAULT_UNAVAILABLE');
    await mkdir(dirname(this.options.vaultPath), { recursive: true });
    const temporary = `${this.options.vaultPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, this.options.encryption.encryptString(JSON.stringify(this.vault)), { mode: 0o600, flag: 'wx' });
      await rename(temporary, this.options.vaultPath);
    } finally { await rm(temporary, { force: true }); }
  }
}
