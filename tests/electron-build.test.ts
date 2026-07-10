import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('electron build', () => {
  it('keeps native runtime modules external while bundling the IPC schema runtime', async () => {
    const script = await readFile(new URL('../scripts/build-electron.mjs', import.meta.url), 'utf8');
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      overrides?: Record<string, string>;
    };

    expect(script).toMatch(/external:\s*\[[^\]]*['"]electron['"][^\]]*['"]sql\.js['"][^\]]*['"]undici['"][^\]]*\]/s);
    expect(packageJson.dependencies).toMatchObject({
      'sql.js': expect.any(String),
      undici: '^6.27.0',
      zod: '^4.4.3',
    });
    expect(Object.keys(packageJson.dependencies ?? {}).sort()).toEqual(['sql.js', 'undici', 'zod']);
    expect(packageJson.devDependencies).toMatchObject({
      concurrently: '^9.2.1',
      esbuild: '^0.28.1',
      vite: '^8.1.4',
    });
    expect(packageJson.overrides).toMatchObject({ 'shell-quote': '1.9.0' });
  });

  it('keeps the smoke command on the npm-provided Node runtime', async () => {
    const script = await readFile(new URL('../scripts/smoke-electron.ps1', import.meta.url), 'utf8');
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { main?: string; scripts?: Record<string, string> };

    expect(manifest.main).toBe('dist-electron/electron/main.js');
    expect(manifest.scripts?.['smoke:electron']).toContain('smoke-electron.ps1');
    expect(script).toContain('run-npm-node.cmd');
  });
});
