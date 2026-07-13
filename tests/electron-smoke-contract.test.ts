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

  it('acquires a userData-scoped single-instance lock before primary startup and focuses the existing window', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const setUserData = main.indexOf("app.setPath('userData'");
    const requestLock = main.indexOf('app.requestSingleInstanceLock()');
    const getDatabase = main.indexOf('async function getDb()');
    const startTask = main.indexOf('function startTaskRun(');
    const ready = main.indexOf('app.whenReady()');

    expect(requestLock).toBeGreaterThan(setUserData);
    expect(requestLock).toBeLessThan(getDatabase);
    expect(requestLock).toBeLessThan(startTask);
    expect(requestLock).toBeLessThan(ready);
    expect(main).toContain(`if (!isPrimaryInstance) {
  app.quit();
}`);
    expect(main).toContain(`if (isPrimaryInstance) {
  app.whenReady().then`);
    expect(main).toContain("app.on('second-instance'");
    expect(main).toContain('mainWindow.isMinimized()');
    expect(main).toContain('mainWindow.restore();');
    expect(main).toContain('mainWindow.isVisible()');
    expect(main).toContain('mainWindow.show();');
    expect(main).toContain('mainWindow.focus();');
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

  it('installs graceful HTML smoke signals before temporary work and cleans up after abort', async () => {
    const smoke = await readFile(new URL('../scripts/smoke-html-video.ts', import.meta.url), 'utf8');
    const lifecycle = smoke.indexOf('runSmokeWithTempRoot({');
    const createTempRoot = smoke.indexOf('createTempRoot:', lifecycle);
    const run = smoke.indexOf('run: async ({ tempRoot, signal }) => {', createTempRoot);
    const createWorkDir = smoke.indexOf('await mkdir(workDir', run);
    const build = smoke.indexOf('await build({', createWorkDir);
    const abortCheckpoint = smoke.indexOf('signal.throwIfAborted()', build);
    const runner = smoke.indexOf('await runBoundedProcess(', createWorkDir);
    const runnerSignal = smoke.indexOf('signal,', runner);
    const cleanup = smoke.indexOf('cleanup:', runnerSignal);

    expect(lifecycle).toBeGreaterThan(-1);
    expect(createTempRoot).toBeGreaterThan(lifecycle);
    expect(run).toBeGreaterThan(createTempRoot);
    expect(createWorkDir).toBeGreaterThan(run);
    expect(build).toBeGreaterThan(createWorkDir);
    expect(abortCheckpoint).toBeGreaterThan(build);
    expect(runner).toBeGreaterThan(abortCheckpoint);
    expect(runnerSignal).toBeGreaterThan(runner);
    expect(cleanup).toBeGreaterThan(runnerSignal);
    expect(smoke).toContain('setSmokeFailureExitCode(process)');
    expect(smoke).toContain('formatSmokeError(error)');
  });
});
