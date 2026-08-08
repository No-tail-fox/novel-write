import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('application version', () => {
  it('keeps the visible release version aligned with the package version', async () => {
    const [packageSource, shellSource, settingsSource] = await Promise.all([
      readFile(new URL('../package.json', import.meta.url), 'utf8'),
      readFile(new URL('../src/app/AppShell.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/settings/SettingsPage.tsx', import.meta.url), 'utf8'),
    ]);
    const packageVersion = (JSON.parse(packageSource) as { version: string }).version;

    expect(packageVersion).toBe('1.0.0');
    for (const source of [shellSource, settingsSource]) {
      expect(source).toContain(`V${packageVersion}`);
      expect(source).not.toContain('v0.10.4');
      expect(source).not.toContain('beta');
    }
  });
});
