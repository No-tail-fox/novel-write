import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('real Electron smoke contract', () => {
  it('launches the packaged application main instead of constructing a harness window', async () => {
    const smoke = await readFile(new URL('../scripts/smoke-electron.cjs', import.meta.url), 'utf8');
    const powershell = await readFile(new URL('../scripts/smoke-electron.ps1', import.meta.url), 'utf8');

    expect(smoke).toContain("spawn(electronPath, ['.']");
    expect(smoke).toContain('STORYDREAM_SMOKE_OUTPUT');
    expect(smoke).toContain('STORYDREAM_SMOKE_USER_DATA');
    expect(smoke).toContain('mkdtemp');
    expect(smoke).toContain('timeoutMs');
    expect(smoke).toContain('process.exitCode = 1');
    expect(smoke).not.toContain('new BrowserWindow');
    expect(smoke).not.toContain('loadFile(indexPath)');
    expect(powershell).toContain('run-npm-node.cmd');
    expect(powershell).not.toContain('node_modules/electron/cli.js');
  });

  it('uses a fixed main-process handshake to cover preload, IPC, policy, and the shell', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const setUserData = main.indexOf("app.setPath('userData'");
    const ready = main.indexOf('app.whenReady()');

    expect(main).toContain('STORYDREAM_SMOKE_OUTPUT');
    expect(main).toContain('STORYDREAM_SMOKE_USER_DATA');
    expect(main).toContain("outputFromUserData.startsWith('..')");
    expect(setUserData).toBeGreaterThan(-1);
    expect(setUserData).toBeLessThan(ready);
    expect(main).toContain('runSmokeHandshake');
    expect(main).toContain('window.storydream');
    expect(main).toContain('api.getState()');
    expect(main).toContain('api.saveUiPreferences');
    expect(main).toContain('mainWindowPolicyInstalled');
    expect(main).toContain('mainWindow.close()');
    for (const field of [
      'mainLoaded',
      'preloadExposed',
      'ipcStateLoaded',
      'preloadActionSucceeded',
      'windowPolicyInstalled',
      'shellRendered',
    ]) {
      expect(main).toContain(field);
    }
  });

  it('requires every fixed smoke assertion and propagates child failures', async () => {
    const smoke = await readFile(new URL('../scripts/smoke-electron.cjs', import.meta.url), 'utf8');

    for (const field of [
      'mainLoaded',
      'preloadExposed',
      'ipcStateLoaded',
      'preloadActionSucceeded',
      'windowPolicyInstalled',
      'shellRendered',
    ]) {
      expect(smoke).toContain(field);
    }
    expect(smoke).toContain('childResult.code !== 0');
    expect(smoke).toContain('failedAssertions');
    expect(smoke).toContain('delete childEnvironment.ELECTRON_RUN_AS_NODE');
    expect(smoke).toContain("VITE_DEV_SERVER_URL: ''");
    expect(smoke).toContain("throw new Error('Electron smoke failed");
  });
});
