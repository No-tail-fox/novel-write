import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('electron window chrome', () => {
  it('removes the native Electron menu bar while keeping the renderer chrome', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');

    expect(main).toContain('Menu.setApplicationMenu(null)');
    expect(main).toContain('autoHideMenuBar: true');
    expect(main).toContain('setMenuBarVisibility(false)');
  });

  it('uses a frameless window controlled by the renderer dark title bar', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');

    expect(main).toContain('frame: false');
    expect(main).toContain("ipcMain.handle('window:control'");
    expect(main).toContain('mainWindow?.minimize()');
    expect(main).toContain('mainWindow?.isMaximized()');
    expect(main).toContain('mainWindow?.close()');
    expect(preload).toContain('windowControl');
    expect(preload).toContain('window:control');
  });
});
