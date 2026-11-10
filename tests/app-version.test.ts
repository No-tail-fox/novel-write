import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { APP_VERSION, APP_VERSION_LABEL } from '../src/app/app-version';

describe('application version', () => {
  it('derives every visible release version from package.json instead of hard-coding it', async () => {
    const [packageSource, shellSource, settingsSource, fallbackSource] = await Promise.all([
      readFile(new URL('../package.json', import.meta.url), 'utf8'),
      readFile(new URL('../src/app/AppShell.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/settings/SettingsPage.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/app/browser-fallback.ts', import.meta.url), 'utf8'),
    ]);
    const packageVersion = (JSON.parse(packageSource) as { version: string }).version;
    expect(APP_VERSION).toBe(packageVersion);
    expect(APP_VERSION_LABEL).toBe(`V${packageVersion}`);
    for (const source of [shellSource, settingsSource]) {
      expect(source).not.toMatch(/V\d+\.\d+\.\d+/u);
      expect(source).not.toContain('beta');
    }
    expect(fallbackSource).not.toMatch(/currentVersion: '\d/u);
    expect(settingsSource).toContain('APP_VERSION_LABEL');
    expect(fallbackSource).toContain('currentVersion: APP_VERSION');
  });
});
