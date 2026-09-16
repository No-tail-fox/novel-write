import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { commercialProfileSchema, capabilities, type CommercialProfiles } from '../src/shared/commercial-contract';
import { offlineLicenseCacheSchema } from './license-service';

export interface AuthSafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
const sessionSchema = z.object({ accessToken: z.string().min(1).max(16384), refreshToken: z.string().min(1).max(16384), userId: z.string().min(1).max(128).refine((value) => !['__proto__', 'constructor', 'prototype'].includes(value)), deviceId: z.string().min(1).max(128).optional(), expiresAt: z.string().datetime({ offset: true }) });
export type AuthSession = z.infer<typeof sessionSchema>;
const profilesSchema = z.object({ profiles: z.array(commercialProfileSchema).max(1000), active: z.partialRecord(z.enum(capabilities), z.string().max(128)) });
const vaultSchema = z.object({
  version: z.literal(1), serviceUrl: z.string(),
  installation: z.object({ id: z.string().uuid(), publicKey: z.string(), privateKey: z.string() }),
  session: sessionSchema.nullable(), pendingRefreshOperationId: z.string().uuid().optional(), profiles: z.record(z.string(), profilesSchema), offlineLicense: offlineLicenseCacheSchema.optional(),
});
export type AuthVaultState = z.infer<typeof vaultSchema>;
export function parseAuthSession(value: unknown): AuthSession {
  try { return sessionSchema.parse(value); } catch { throw new Error('AUTH_RESPONSE_INVALID: 账号服务返回了无效会话。'); }
}
export const emptyProfiles = (): CommercialProfiles => ({ profiles: [], active: {} });

/** Separate from the provider vault: identity keys and sessions never enter renderer config. */
export class AuthVault {
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly path: string, private readonly encryption: AuthSafeStorage) {}
  private available(): void {
    if (!this.encryption.isEncryptionAvailable()) throw new Error('AUTH_ENCRYPTION_UNAVAILABLE: 系统凭据加密不可用，请在安全环境中登录。');
  }
  async load(serviceUrl: string): Promise<AuthVaultState> {
    this.available();
    let raw: string;
    try { raw = await readFile(this.path, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('AUTH_VAULT_READ_FAILED');
      const pair = generateKeyPairSync('ed25519');
      const state: AuthVaultState = { version: 1, serviceUrl, installation: { id: randomUUID(), publicKey: pair.publicKey.export({ format: 'pem', type: 'spki' }).toString(), privateKey: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString() }, session: null, profiles: {} };
      await this.save(state); return state;
    }
    try {
      const envelope = z.object({ version: z.literal(1), encryption: z.literal('electron-safe-storage'), ciphertext: z.string().min(1).max(8_000_000) }).strict().parse(JSON.parse(raw));
      const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
      if (ciphertext.toString('base64') !== envelope.ciphertext) throw new Error('Invalid ciphertext');
      const state = vaultSchema.parse(JSON.parse(this.encryption.decryptString(ciphertext)));
      // A server switch must not forward another service's bearer tokens or profile identities.
      if (state.serviceUrl !== serviceUrl) { state.serviceUrl = serviceUrl; state.session = null; delete state.pendingRefreshOperationId; delete state.offlineLicense; state.profiles = {}; await this.save(state); }
      return state;
    } catch { throw new Error('AUTH_VAULT_CORRUPT: 加密账号资料无法读取，未恢复任何授权或余额。'); }
  }
  async save(state: AuthVaultState): Promise<void> {
    this.available();
    const payload = JSON.stringify(vaultSchema.parse(state));
    const run = this.writes.catch(() => {}).then(async () => {
      this.available();
      const temp = `${this.path}.${randomUUID()}.tmp`;
      try {
        const encrypted = this.encryption.encryptString(payload);
        if (!encrypted.length) throw new Error('Empty ciphertext');
        await mkdir(dirname(this.path), { recursive: true });
        await writeFile(temp, JSON.stringify({ version: 1, encryption: 'electron-safe-storage', ciphertext: encrypted.toString('base64') }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        await rename(temp, this.path);
      } catch { await rm(temp, { force: true }).catch(() => {}); throw new Error('AUTH_VAULT_WRITE_FAILED: 无法安全保存账号资料。'); }
    });
    this.writes = run; return run;
  }
}
