import { access, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

async function loadCredentialVault() {
  return import('../electron/credential-vault').catch(() => null);
}

function fakeEncryption(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value: string) => Buffer.from([...Buffer.from(value, 'utf8')].map((byte) => byte ^ 0xa5)),
    decryptString: (value: Buffer) => Buffer.from([...value].map((byte) => byte ^ 0xa5)).toString('utf8'),
  };
}

describe('CredentialVault', () => {
  it('encrypts and decrypts a versioned payload with atomic temp replacement and no plaintext on disk', async () => {
    const module = await loadCredentialVault();
    expect(module).not.toBeNull();
    if (!module) return;
    const dir = await mkdtemp(join(tmpdir(), 'storydream-vault-'));
    const file = join(dir, 'secrets.v1.json');
    const operations: string[] = [];
    try {
      const vault = new module.CredentialVault(file, {
        ...fakeEncryption(),
        writeText: async (path: string, value: string, options: { encoding: 'utf8'; mode: number; flag: 'wx' }) => {
          operations.push(`write:${path}`);
          await writeFile(path, value, options);
        },
        replaceFile: async (source: string, target: string) => {
          operations.push(`replace:${source}->${target}`);
          await rename(source, target);
        },
      });
      const first = { 'llm/default-llm/apiKey': 'sentinel-first-plaintext' };
      const second = { 'llm/default-llm/apiKey': 'sentinel-second-plaintext', 'ima/apiKey': 'sentinel-ima-plaintext' };

      await vault.save(first);
      expect(await vault.load()).toEqual(first);
      await vault.save(second);
      expect(await vault.load()).toEqual(second);

      const disk = await readFile(file, 'utf8');
      expect(disk).not.toContain('sentinel-first-plaintext');
      expect(disk).not.toContain('sentinel-second-plaintext');
      expect(disk).not.toContain('sentinel-ima-plaintext');
      expect(JSON.parse(disk)).toMatchObject({ version: 1, encryption: 'electron-safe-storage', ciphertext: expect.any(String) });
      expect(operations.some((operation) => operation.startsWith(`write:${file}.`) && operation.endsWith('.tmp'))).toBe(true);
      expect(operations.some((operation) => operation.includes(`->${file}`))).toBe(true);
      expect((await readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps the previous vault and removes the temp file when replacement fails', async () => {
    const module = await loadCredentialVault();
    expect(module).not.toBeNull();
    if (!module) return;
    const dir = await mkdtemp(join(tmpdir(), 'storydream-vault-replace-'));
    const file = join(dir, 'secrets.v1.json');
    try {
      const working = new module.CredentialVault(file, fakeEncryption());
      const original = { 'llm/default-llm/apiKey': 'original-secret' };
      await working.save(original);
      const failing = new module.CredentialVault(file, {
        ...fakeEncryption(),
        replaceFile: async () => {
          throw new Error('replace failed');
        },
      });

      await expect(failing.save({ 'llm/default-llm/apiKey': 'replacement-secret' })).rejects.toThrow(/CREDENTIAL_VAULT_WRITE_FAILED/);
      expect(await working.load()).toEqual(original);
      expect((await readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects corrupt ciphertext without exposing decrypted contents', async () => {
    const module = await loadCredentialVault();
    expect(module).not.toBeNull();
    if (!module) return;
    const dir = await mkdtemp(join(tmpdir(), 'storydream-vault-corrupt-'));
    const file = join(dir, 'secrets.v1.json');
    try {
      await writeFile(
        file,
        JSON.stringify({ version: 1, encryption: 'electron-safe-storage', ciphertext: Buffer.from('not-a-vault').toString('base64') }),
        'utf8',
      );
      const vault = new module.CredentialVault(file, fakeEncryption());

      await expect(vault.load()).rejects.toThrow(/^CREDENTIAL_VAULT_CORRUPT/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('fails closed when OS encryption is unavailable and does not create a file', async () => {
    const module = await loadCredentialVault();
    expect(module).not.toBeNull();
    if (!module) return;
    const dir = await mkdtemp(join(tmpdir(), 'storydream-vault-unavailable-'));
    const file = join(dir, 'secrets.v1.json');
    try {
      const vault = new module.CredentialVault(file, fakeEncryption(false));

      await expect(vault.save({ 'ima/apiKey': 'must-not-write' })).rejects.toThrow(/CREDENTIAL_ENCRYPTION_UNAVAILABLE/);
      await expect(vault.load()).rejects.toThrow(/CREDENTIAL_ENCRYPTION_UNAVAILABLE/);
      await expect(access(file)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
