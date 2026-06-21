import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('electron build', () => {
  it('keeps sql.js and undici external so Node runtime code is not bundled into ESM output', async () => {
    const script = await readFile(new URL('../scripts/build-electron.mjs', import.meta.url), 'utf8');

    expect(script).toMatch(/external:\s*\[[^\]]*['"]electron['"][^\]]*['"]sql\.js['"][^\]]*['"]undici['"][^\]]*\]/s);
    expect(await readFile(new URL('../package.json', import.meta.url), 'utf8')).toMatch(/"node_modules\/undici\/\*\*\/\*"/);
  });
});
