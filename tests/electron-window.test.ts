import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('electron window chrome', () => {
  it('removes the native Electron menu bar while keeping the renderer chrome', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');

    expect(main).toContain('Menu.setApplicationMenu(null)');
    expect(main).toContain('autoHideMenuBar: true');
    expect(main).toContain('setMenuBarVisibility(false)');
  });
});
