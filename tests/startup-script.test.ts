import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('one-click startup script', () => {
  it('cleans stale Electron output and syntax-checks the generated main process before launch', async () => {
    const script = await readFile(new URL('../start-storydream.ps1', import.meta.url), 'utf8');

    expect(script).toContain('Remove-Item -LiteralPath "dist-electron"');
    expect(script).toContain('node --check');
    expect(script).toContain('dist-electron\\electron\\main.js');
    expect(script).toContain('dist-electron\\electron\\preload.js');
  });

  it('selects a Node runtime compatible with the Vite toolchain', async () => {
    const script = await readFile(new URL('../start-storydream.ps1', import.meta.url), 'utf8');

    expect(script).toContain('Test-NodeVersionCompatible');
    expect(script).toContain('Find-CompatibleNodePath');
    expect(script).toContain('20.19.0');
    expect(script).toContain('22.12.0');
    expect(script).toContain('$node = Find-CompatibleNodePath');
  });

  it('reinstalls dependencies when the native Vite/Vitest binding is missing', async () => {
    const script = await readFile(new URL('../start-storydream.ps1', import.meta.url), 'utf8');

    expect(script).toContain('Test-DependenciesReady');
    expect(script).toContain('@rolldown\\binding-win32-x64-msvc');
    expect(script).toContain('Installing dependencies');
  });

  it('boots through the UTF-8 helper and prefers pwsh when available', async () => {
    const script = await readFile(new URL('../start-storydream.ps1', import.meta.url), 'utf8');
    const helper = await readFile(new URL('../scripts/utf8-bootstrap.ps1', import.meta.url), 'utf8');
    const launcher = await readFile(new URL('../启动 StoryDream.bat', import.meta.url), 'utf8');

    expect(script).toContain('Invoke-Utf8Bootstrap');
    expect(script).toContain('$PSCommandPath');
    expect(helper).toContain('chcp 65001');
    expect(helper).toContain('UTF8Encoding');
    expect(helper).toContain('Get-Command pwsh');
    expect(launcher).toContain('where pwsh');
    expect(launcher).toContain('PS_EXE=pwsh');
  });
});
