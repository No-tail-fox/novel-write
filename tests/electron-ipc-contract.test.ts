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
      'diagnostics:run',
    ]) {
      expect(preload).toContain(channel);
      expect(main).toContain(channel);
    }
  });
});
