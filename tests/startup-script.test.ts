import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('one-click startup script', () => {
  it('cleans stale Electron output and syntax-checks the generated main process before launch', async () => {
    const script = await readFile(new URL('../start-storybound.ps1', import.meta.url), 'utf8');

    expect(script).toContain('Remove-Item -LiteralPath "dist-electron"');
    expect(script).toContain('node --check');
    expect(script).toContain('dist-electron\\electron\\main.js');
    expect(script).toContain('dist-electron\\electron\\preload.js');
  });

  it('selects a Node runtime compatible with the Vite toolchain', async () => {
    const script = await readFile(new URL('../start-storybound.ps1', import.meta.url), 'utf8');

    expect(script).toContain('Test-NodeVersionCompatible');
    expect(script).toContain('Find-CompatibleNodePath');
    expect(script).toContain('20.19.0');
    expect(script).toContain('22.12.0');
    expect(script).toContain('$node = Find-CompatibleNodePath');
  });

  it('reinstalls dependencies when the native Vite/Vitest binding is missing', async () => {
    const script = await readFile(new URL('../start-storybound.ps1', import.meta.url), 'utf8');

    expect(script).toContain('Test-DependenciesReady');
    expect(script).toContain('@rolldown\\binding-win32-x64-msvc');
    expect(script).toContain('Installing dependencies');
  });
});
