import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isSecretId, type ConfigSecrets } from '../src/shared/config-secrets';

const VAULT_VERSION = 1;
const MAX_SECRET_COUNT = 1_000;
const MAX_SECRET_VALUE_LENGTH = 1_048_576;

export interface CredentialVaultWriteOptions {
  encoding: 'utf8';
  mode: number;
  flag: 'wx';
}

export interface CredentialVaultDependencies {
  isEncryptionAvailable: () => boolean;
  encryptString: (value: string) => Buffer;
  decryptString: (value: Buffer) => string;
  readText?: (path: string) => Promise<string>;
  writeText?: (path: string, value: string, options: CredentialVaultWriteOptions) => Promise<void>;
  ensureDirectory?: (path: string) => Promise<void>;
  replaceFile?: (source: string, target: string) => Promise<void>;
  removeFile?: (path: string) => Promise<void>;
  createTempSuffix?: () => string;
}

interface ResolvedCredentialVaultDependencies extends Required<CredentialVaultDependencies> {}

interface VaultFileV1 {
  version: 1;
  encryption: 'electron-safe-storage';
  ciphertext: string;
}

interface VaultPayloadV1 {
  version: 1;
  secrets: ConfigSecrets;
}

function isErrno(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeSecrets(value: unknown): ConfigSecrets {
  if (!isRecord(value)) throw new Error('CREDENTIAL_VAULT_INVALID_SECRETS');
  const entries = Object.entries(value);
  if (entries.length > MAX_SECRET_COUNT) throw new Error('CREDENTIAL_VAULT_INVALID_SECRETS');
  const secrets: ConfigSecrets = {};
  for (const [id, secret] of entries) {
    if (!isSecretId(id) || typeof secret !== 'string' || secret.length > MAX_SECRET_VALUE_LENGTH) {
      throw new Error('CREDENTIAL_VAULT_INVALID_SECRETS');
    }
    if (secret.length > 0) secrets[id] = secret;
  }
  return secrets;
}

function decodeCiphertext(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
    throw new Error('Invalid ciphertext.');
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length === 0 || decoded.toString('base64') !== value) throw new Error('Invalid ciphertext.');
  return decoded;
}

export class CredentialVault {
  private readonly dependencies: ResolvedCredentialVaultDependencies;

  constructor(private readonly filePath: string, dependencies: CredentialVaultDependencies) {
    this.dependencies = {
      isEncryptionAvailable: dependencies.isEncryptionAvailable,
      encryptString: dependencies.encryptString,
      decryptString: dependencies.decryptString,
      readText: dependencies.readText ?? ((path) => readFile(path, 'utf8')),
      writeText: dependencies.writeText ?? ((path, value, options) => writeFile(path, value, options)),
      ensureDirectory: dependencies.ensureDirectory ?? (async (path) => { await mkdir(path, { recursive: true }); }),
      replaceFile: dependencies.replaceFile ?? ((source, target) => rename(source, target)),
      removeFile: dependencies.removeFile ?? (async (path) => { await rm(path, { force: true }); }),
      createTempSuffix: dependencies.createTempSuffix ?? randomUUID,
    };
  }

  async load(): Promise<ConfigSecrets> {
    this.assertEncryptionAvailable();
    let serialized: string;
    try {
      serialized = await this.dependencies.readText(this.filePath);
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return {};
      throw new Error('CREDENTIAL_VAULT_READ_FAILED: Unable to read encrypted credentials.');
    }

    try {
      const file = JSON.parse(serialized) as unknown;
      if (
        !isRecord(file) ||
        file.version !== VAULT_VERSION ||
        file.encryption !== 'electron-safe-storage'
      ) {
        throw new Error('Invalid vault envelope.');
      }
      const decrypted = this.dependencies.decryptString(decodeCiphertext(file.ciphertext));
      const payload = JSON.parse(decrypted) as unknown;
      if (!isRecord(payload) || payload.version !== VAULT_VERSION) throw new Error('Invalid vault payload.');
      return normalizeSecrets(payload.secrets);
    } catch {
      throw new Error('CREDENTIAL_VAULT_CORRUPT: Encrypted credentials could not be read.');
    }
  }

  async save(input: ConfigSecrets): Promise<void> {
    this.assertEncryptionAvailable();
    const secrets = normalizeSecrets(input);
    let encrypted: Buffer;
    try {
      const payload: VaultPayloadV1 = { version: VAULT_VERSION, secrets };
      encrypted = this.dependencies.encryptString(JSON.stringify(payload));
      if (!Buffer.isBuffer(encrypted) || encrypted.length === 0) throw new Error('Empty ciphertext.');
    } catch {
      throw new Error('CREDENTIAL_VAULT_ENCRYPT_FAILED: Credentials could not be encrypted.');
    }
    const file: VaultFileV1 = {
      version: VAULT_VERSION,
      encryption: 'electron-safe-storage',
      ciphertext: encrypted.toString('base64'),
    };
    await this.atomicWrite(`${JSON.stringify(file)}\n`);
  }

  private assertEncryptionAvailable(): void {
    let available = false;
    try {
      available = this.dependencies.isEncryptionAvailable();
    } catch {
      available = false;
    }
    if (!available) {
      throw new Error('CREDENTIAL_ENCRYPTION_UNAVAILABLE: OS credential encryption is not available.');
    }
  }

  private async atomicWrite(serialized: string): Promise<void> {
    const suffix = this.dependencies.createTempSuffix().replace(/[^a-zA-Z0-9_-]/gu, '');
    const tempPath = `${this.filePath}.${suffix || randomUUID()}.tmp`;
    try {
      await this.dependencies.ensureDirectory(dirname(this.filePath));
      await this.dependencies.writeText(tempPath, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await this.dependencies.replaceFile(tempPath, this.filePath);
    } catch {
      try {
        await this.dependencies.removeFile(tempPath);
      } catch {
        // The primary write failure remains the actionable error.
      }
      throw new Error('CREDENTIAL_VAULT_WRITE_FAILED: Encrypted credentials could not be persisted.');
    }
  }
}
