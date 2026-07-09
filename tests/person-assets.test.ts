import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  copyPersonMaterialsForScenes,
  createPersonAsset,
  importPersonAssetFiles,
  listPersonAssets,
  listPersonImages,
} from '@shared/person-assets';
import type { StoryboardScene } from '@shared/types';

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3q/QAAAABJRU5ErkJggg==',
  'base64',
);

describe('person assets', () => {
  it('imports person images and copies them as local scene materials', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-person-assets-'));
    const root = join(dir, 'person-assets');
    const source = join(dir, 'source.png');
    const taskDir = join(dir, 'tasks', 'task-1');
    const scenes: StoryboardScene[] = [
      { id: 1, cap: '第一幕', descPrompt: '在河岸边', durationMs: 1200 },
      { id: 2, cap: '第二幕', descPrompt: '望向森林', durationMs: 1200 },
    ];

    try {
      await writeFile(source, tinyPng);
      await createPersonAsset(root, '迟子建');
      await expect(importPersonAssetFiles(root, '迟子建', [source])).resolves.toBe(1);

      const assets = await listPersonAssets(root);
      expect(assets).toHaveLength(1);
      expect(assets[0]).toMatchObject({ name: '迟子建', count: 1 });

      const images = await listPersonImages(root, '迟子建');
      expect(images).toHaveLength(1);
      expect(images[0].path).toContain('迟子建');

      const copied = await copyPersonMaterialsForScenes({ rootDir: root, person: '迟子建', scenes, taskDir, ratio: '9:16' });
      expect(copied.assets).toEqual([
        { sceneId: 1, path: join(taskDir, 'images', '1.png') },
        { sceneId: 2, path: join(taskDir, 'images', '2.png') },
      ]);
      expect(Object.keys(copied.origins).sort()).toEqual(['1', '2']);
      expect(copied.origins['1']).toBe(images[0].path);
      expect(copied.origins['2']).toBe(images[0].path);
      await expect(stat(join(taskDir, 'images', '1.png'))).resolves.toBeTruthy();
      await expect(stat(join(taskDir, 'images', '2.png'))).resolves.toBeTruthy();

      const meta = JSON.parse(await readFile(join(taskDir, '04-local-meta.json'), 'utf8'));
      expect(meta).toEqual({ version: 1, person: '迟子建', ratio: '9:16', origins: copied.origins });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
