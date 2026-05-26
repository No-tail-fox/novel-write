import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('electron build', () => {
  it('keeps sql.js external so its CommonJS runtime can use Node require', async () => {
    const script = await readFile(new URL('../scripts/build-electron.mjs', import.meta.url), 'utf8');

    expect(script).toMatch(/external:\s*\[[^\]]*['"]electron['"][^\]]*['"]sql\.js['"][^\]]*\]/s);
  });
});
