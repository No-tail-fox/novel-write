import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('electron ipc contract', () => {
  it('exposes product shell persistence channels to the renderer', async () => {
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');

    for (const channel of [
      'prompt-template:save',
      'prompt-template:reset',
      'draft-template:save',
      'image-lab:add-record',
      'account:save',
      'activation:save',
      'ui:save-preferences',
      'task:update-status',
      'task:retry',
      'task:get-artifacts',
      'config:test',
      'llm:test-config',
      'models:list',
      'research:web-search',
      'research:compose-copy',
      'diagnostics:run',
    ]) {
      expect(preload).toContain(channel);
      expect(main).toContain(channel);
    }
  });

  it('starts newly created tasks in the background so the renderer can open task detail immediately', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');

    expect(main).toContain('startTaskRun(database, task');
    expect(main).toContain('return database.getState()');
  });

  it('routes resume and retry through a background task runner instead of only mutating status', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');

    expect(main).toContain('runningTasks');
    expect(main).toContain('AbortController');
    expect(main).toContain('restartAfterAbort');
    expect(main).toContain('resumeTaskRun');
    expect(main).toContain("input.status === 'running'");
    const retryHandler = main.slice(main.indexOf("ipcMain.handle('task:retry'"), main.indexOf("ipcMain.handle('diagnostics:run'"));
    expect(retryHandler).toContain('resumeTaskRun(database, task)');
    expect(retryHandler).not.toContain('runTask(');
  });

  it('keeps aborting task runners registered until they exit to avoid duplicate runs', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const statusHandler = main.slice(main.indexOf("ipcMain.handle('task:update-status'"), main.indexOf("ipcMain.handle('task:retry'"));

    expect(statusHandler).toContain('existingRun.controller.abort');
    expect(statusHandler).toContain('existingRun.restartAfterAbort = false');
    expect(statusHandler).not.toContain('runningTasks.delete(input.id)');
  });

  it('pushes a fresh app state snapshot for live task detail updates', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const viteEnv = await readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8');

    expect(main).toContain('sendTaskState');
    expect(main).toContain("mainWindow?.webContents.send('task:event', state)");
    expect(main).toContain('notifyTaskState');
    expect(preload).toContain('callback(state)');
    expect(preload).toContain('testLlmConfig');
    expect(preload).toContain('listProviderModels');
    expect(preload).toContain('searchWebSources');
    expect(preload).toContain('composeResearchCopy');
    expect(preload).toContain('getTaskArtifacts');
    expect(viteEnv).toContain('callback: (state: AppState) => void');
    expect(viteEnv).toContain('testLlmConfig');
    expect(viteEnv).toContain('listProviderModels');
    expect(viteEnv).toContain('composeResearchCopy');
    expect(viteEnv).toContain('getTaskArtifacts');
  });
});
