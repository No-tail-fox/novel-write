import { expect, it } from 'vitest';
import { licenseConfigSchema } from '../electron/license-security';
import { LicenseService } from '../electron/license-service';

it('fails closed for an unconfigured development license without blocking application startup', async () => {
  const config = { schemaVersion: 1, baseUrl: '', caPem: '', signingPublicKey: '' };
  expect(licenseConfigSchema.safeParse(config).success).toBe(false);
  const license = new LicenseService({ config, vaultPath: 'unused', packaged: false,
    encryption: { isEncryptionAvailable: () => false, encryptString: () => { throw new Error('unexpected encryption'); }, decryptString: () => { throw new Error('unexpected decryption'); } },
  });
  await expect(license.initialize()).resolves.toBeUndefined();
  expect(license.status().status).toBe('unconfigured');
  expect(license.enforced).toBe(true);
  await expect(license.requireActive()).rejects.toMatchObject({ code: 'LICENSE_REQUIRED' });
});
