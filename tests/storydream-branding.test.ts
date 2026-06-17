import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('StoryDream branding', () => {
  it('uses StoryDream across app shell, desktop metadata, and launch scripts', async () => {
    const rootFiles = await readdir(new URL('..', import.meta.url));
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      name: string;
      build?: { appId?: string; productName?: string };
    };
    const packageLock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8')) as {
      name: string;
      packages?: Record<string, { name?: string }>;
    };
    const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const electronMain = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const renderer = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
    const startScript = await readFile(new URL('../start-storydream.ps1', import.meta.url), 'utf8');
    const packageScript = await readFile(new URL('../scripts/package-win.ps1', import.meta.url), 'utf8');

    expect(pkg.name).toBe('storydream');
    expect(pkg.build).toMatchObject({
      appId: 'local.storydream',
      productName: 'StoryDream',
    });
    expect(packageLock.name).toBe('storydream');
    expect(packageLock.packages?.['']?.name).toBe('storydream');
    expect(index).toContain('<title>StoryDream</title>');
    expect(electronMain).toContain("title: 'StoryDream'");
    expect(electronMain).toContain("'storydream'");
    expect(renderer).toContain('<strong>StoryDream</strong>');
    expect(readme).toContain('# StoryDream');
    expect(startScript).toContain('StoryDream One-Click Startup');
    expect(packageScript).toContain('StoryDream-Portable-${Version}.zip');
    expect(rootFiles).toContain('启动 StoryDream.bat');
    expect(rootFiles).not.toContain('启动 Storybound Replica.bat');
  });
});
