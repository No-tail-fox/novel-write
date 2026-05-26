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
});
