import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('windows packaging', () => {
  it('defines a one-command Windows exe packaging path', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      scripts: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      build?: Record<string, unknown>;
    };
    const packageScript = await readFile(new URL('../scripts/package-win.ps1', import.meta.url), 'utf8');
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

    expect(pkg.scripts['package:win']).toContain('scripts/package-win.ps1');
    expect(deps['electron-builder']).toBeDefined();
    expect(pkg.build).toMatchObject({
      electronDist: 'node_modules/electron/dist',
      productName: 'Storybound Replica',
      directories: { output: 'release' },
      win: { artifactName: 'Storybound-Replica-Setup-${version}.${ext}', signAndEditExecutable: false },
    });
    expect(packageScript).toContain('node_modules/electron-builder/cli.js');
    expect(packageScript).toContain('--dir');
    expect(packageScript).toContain('release\\win-unpacked\\Storybound Replica.exe');
    expect(packageScript).toContain('node --check');
  });
});
