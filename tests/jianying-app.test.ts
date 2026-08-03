import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findJianyingExecutable } from '@shared/jianying-app';

describe('Jianying application discovery', () => {
  it('prefers the stable Apps entry over versioned installations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storydream-jianying-app-'));
    const apps = join(root, 'JianyingPro', 'Apps');
    try {
      await mkdir(join(apps, '9.1.0'), { recursive: true });
      await writeFile(join(apps, '9.1.0', 'JianyingPro.exe'), 'version');
      await writeFile(join(apps, 'JianyingPro.exe'), 'stable');
      await expect(findJianyingExecutable({ localAppData: root, programFiles: '', programFilesX86: '' }))
        .resolves.toBe(join(apps, 'JianyingPro.exe'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('falls back to the newest version directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storydream-jianying-version-'));
    const apps = join(root, 'JianyingPro', 'Apps');
    try {
      for (const version of ['8.9.0.13361', '10.0.1']) {
        await mkdir(join(apps, version), { recursive: true });
        await writeFile(join(apps, version, 'JianyingPro.exe'), version);
      }
      await expect(findJianyingExecutable({ localAppData: root, programFiles: '', programFilesX86: '' }))
        .resolves.toBe(join(apps, '10.0.1', 'JianyingPro.exe'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
