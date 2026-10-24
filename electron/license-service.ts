import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { hostname } from 'node:os';
import { promisify } from 'node:util';
import { z } from 'zod';
import { AppError } from '../src/shared/app-error';
import type { LicenseLease, LicenseStatus, SignedEnvelope } from '../src/shared/licensing';
import { licenseConfigSchema, LicenseRemoteError, LicenseTransport, verifyLease, type LicensePublicConfig } from './license-security';

interface Encryption {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
const vaultSchema = z.object({
  version: z.literal(1), deviceId: z.string().regex(/^[a-f0-9]{64}$/), privateKey: z.string().max(4096),
  lastClock: z.number().nonnegative(), releaseSequence: z.number().int().nonnegative(), releaseHash: z.string(),
}).strict();
type MachineVault = z.infer<typeof vaultSchema>;
const messages: Record<string, string> = {
  INVALID_ACTIVATION_CODE: '激活码无效。', DEVICE_LIMIT_REACHED: '授权设备数量已满，请先解绑旧设备。',
  DEVICE_ALREADY_BOUND: '本机已绑定其他授权，或设备凭据已变化，请联系管理员释放设备。',
  DEVICE_NOT_BOUND: '本机尚未绑定授权，或已被远程解绑。', DEVICE_LOCKED: '本机已被管理员锁定。',
  LICENSE_REVOKED: '此授权已被管理员停用。', LICENSE_EXPIRED: '授权已到期。',
  CLOCK_SKEW: '本机时间与服务器不一致，请校准系统时间。', RATE_LIMITED: '请求过于频繁，请稍后重试。',
};

export async function readMachineId(): Promise<string> {
  let raw: string;
  if (process.platform === 'win32') {
    const result = await promisify(execFile)('reg.exe', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64'], { windowsHide: true, timeout: 10000 });
    const match = /MachineGuid\s+REG_SZ\s+([a-f0-9-]{36})/i.exec(result.stdout);
    if (!match) throw new Error('MACHINE_ID_UNAVAILABLE');
    raw = match[1].toLowerCase();
  } else {
    raw = (await readFile('/etc/machine-id', 'utf8')).trim();
  }
  return createHash('sha256').update(`storydream-device-v1\n${raw}`).digest('hex');
}

export class LicenseService {
  config: LicensePublicConfig | null = null;
  transport: LicenseTransport | null = null;
  private vault: MachineVault | null = null;
  private lease: LicenseLease | null = null;
  private state: LicenseStatus = { configured: false, status: 'unconfigured', deviceId: '', deviceLabel: hostname().slice(0, 120), expiresAt: null, validUntil: null, devices: [], message: '授权服务尚未配置。' };
  private queue: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private expiryTimer?: ReturnType<typeof setTimeout>;
  private readonly startWall = Date.now() / 1000;
  private readonly startMono = performance.now();
  private lastCheck = 0;

  constructor(private readonly options: { config: unknown; vaultPath: string; encryption: Encryption; packaged: boolean; machineId?: () => Promise<string>; onChange?: (status: LicenseStatus) => Promise<void> | void }) {}

  get enforced(): boolean { return this.options.packaged || !!this.config; }
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
      const deviceId = await (this.options.machineId ?? readMachineId)();
      try {
        this.vault = vaultSchema.parse(JSON.parse(this.options.encryption.decryptString(await readFile(this.options.vaultPath))));
        if (this.vault.deviceId !== deviceId || createPrivateKey(this.vault.privateKey).asymmetricKeyType !== 'ed25519') throw new Error('DEVICE_CREDENTIAL_MISMATCH');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const keys = generateKeyPairSync('ed25519');
        this.vault = { version: 1, deviceId, privateKey: keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), lastClock: 0, releaseSequence: 0, releaseHash: '' };
        await this.persist();
      }
      this.state.deviceId = deviceId;
      this.state.status = 'inactive';
      this.state.message = '本机尚未激活。';
      await this.refresh().catch(() => undefined);
      this.timer = setInterval(() => { void this.refresh().catch(() => undefined); }, 120000);
      this.timer.unref();
    } catch {
      this.vault = null;
      this.state.status = 'error';
      this.state.message = '无法读取本机加密凭据，请检查系统加密功能或联系管理员。';
    }
    await this.notify();
  }

  close(): void { clearInterval(this.timer); clearTimeout(this.expiryTimer); }
  status(): LicenseStatus {
    const result = structuredClone(this.state);
    if (this.lease && this.lease.validUntil <= this.now() && ['active', 'offline'].includes(result.status)) {
      result.status = 'expired'; result.message = '联网授权已过期，请重新验证。';
    }
    return result;
  }

  async requireActive(): Promise<void> {
    if (!this.enforced) return;
    if (this.lease && this.lease.validUntil > this.now() && performance.now() - this.lastCheck < 120000) return;
    await this.refresh().catch(() => undefined);
    if (!this.lease || this.lease.validUntil <= this.now()) throw new AppError('LICENSE_REQUIRED', this.status().message);
  }

  activate(code: string): Promise<LicenseStatus> { return this.exclusive(() => this.exchange('/v1/license/activate', { code: code.trim(), label: this.state.deviceLabel })); }
  refresh(): Promise<LicenseStatus> { return this.exclusive(() => this.exchange('/v1/license/refresh')); }
  release(): Promise<LicenseStatus> {
    return this.exclusive(async () => {
      try {
        await this.send('/v1/license/release');
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

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const task = this.queue.then(work);
    this.queue = task.catch(() => undefined);
    return task;
  }
  private publicKey(): string { return createPublicKey(this.vault!.privateKey).export({ format: 'pem', type: 'spki' }).toString(); }
  private async send(path: string, extra = {}): Promise<SignedEnvelope> {
    if (!this.vault || !this.transport) throw new AppError('LICENSE_UNAVAILABLE', this.state.message);
    const payload = JSON.stringify({ deviceId: this.vault.deviceId, publicKey: this.publicKey(), nonce: randomUUID(), timestamp: Math.floor(Date.now() / 1000), ...extra });
    const signature = sign(null, Buffer.from(`${path}\n${payload}`), this.vault.privateKey).toString('base64');
    return this.transport.json<SignedEnvelope>(path, { payload, signature });
  }
  private async exchange(path: string, extra = {}): Promise<LicenseStatus> {
    try {
      const envelope = await this.send(path, extra);
      const lease = verifyLease(envelope, this.config!, this.vault!.deviceId, this.publicKey(), this.now());
      this.vault!.lastClock = Math.max(this.vault!.lastClock, lease.issuedAt);
      await this.persist();
      this.lease = lease;
      this.lastCheck = performance.now();
      this.state = { ...this.state, status: 'active', expiresAt: new Date(lease.expiresAt * 1000).toISOString(), validUntil: new Date(lease.validUntil * 1000).toISOString(), devices: lease.devices, message: '授权有效。' };
      clearTimeout(this.expiryTimer);
      this.expiryTimer = setTimeout(() => {
        this.clearLease('expired', '联网授权已过期，请重新验证。');
        void this.notify().catch(() => undefined);
      }, Math.max(0, (lease.validUntil - this.now()) * 1000));
      this.expiryTimer.unref();
      await this.notify();
      return this.status();
    } catch (error) {
      await this.handleError(error);
      throw new AppError('LICENSE_VERIFICATION_FAILED', this.state.message);
    }
  }
  private async handleError(error: unknown): Promise<void> {
    if (error instanceof LicenseRemoteError && error.status >= 400 && error.status < 500 && error.status !== 429) {
      this.clearLease(['DEVICE_LOCKED', 'LICENSE_REVOKED'].includes(error.code) ? 'locked' : error.code === 'LICENSE_EXPIRED' ? 'expired' : 'inactive', messages[error.code] ?? '设备验证失败，请联系管理员。');
    } else if (this.lease && this.lease.validUntil > this.now()) {
      this.state.status = 'offline'; this.state.message = '暂时无法连接授权服务，当前授权将于 ' + new Date(this.lease.validUntil * 1000).toLocaleTimeString() + ' 失效。';
    } else {
      this.clearLease(this.config ? 'error' : 'unconfigured', error instanceof AppError ? error.message : messages[(error as LicenseRemoteError).code] ?? '无法连接授权服务，请检查网络和系统时间。');
    }
    await this.notify();
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
