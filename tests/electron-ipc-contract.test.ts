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
      'llm:test-config',
      'research:web-search',
      'diagnostics:run',
    ]) {
      expect(preload).toContain(channel);
      expect(main).toContain(channel);
    }
  });

  it('starts newly created tasks in the background so the renderer can open task detail immediately', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');

    expect(main).toContain('void runTask(database, task');
    expect(main).toContain('return database.getState()');
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
    expect(preload).toContain('searchWebSources');
    expect(viteEnv).toContain('callback: (state: AppState) => void');
    expect(viteEnv).toContain('testLlmConfig');
  });
});
