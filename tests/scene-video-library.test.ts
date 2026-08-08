import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copySceneVideoToTask, importSceneVideoToLibrary, listSceneVideoLibrary } from '../electron/scene-video-library';

describe('scene video library', () => {
  it('normalizes an imported clip, persists metadata, and copies a task-local working asset', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-scene-video-library-'));
    const libraryRoot = join(dir, 'library');
    const sourcePath = join(dir, '片段.mov');
    try {
      await writeFile(sourcePath, Buffer.from('source-video'));
      const item = await importSceneVideoToLibrary({
        libraryRoot,
        sourcePath,
        normalize: async (source, output) => {
          expect(source).toBe(sourcePath);
          await writeFile(output, Buffer.from('normalized-h264-video'));
          return { durationMs: 6_400, width: 1080, height: 1920 };
        },
      });

      expect(item).toMatchObject({ originalName: '片段.mov', durationMs: 6_400, width: 1080, height: 1920 });
      expect(item.path).toMatch(/\.mp4$/u);
      expect(await listSceneVideoLibrary(libraryRoot)).toEqual([item]);

      const taskPath = await copySceneVideoToTask(item, join(dir, 'task', 'scene-videos'), 3);
      expect(taskPath).toMatch(/[\\/]003-[0-9a-f-]+\.mp4$/u);
      expect(await readFile(taskPath, 'utf8')).toBe('normalized-h264-video');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects unsupported source extensions before normalization', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-scene-video-invalid-'));
    const sourcePath = join(dir, 'clip.avi');
    try {
      await writeFile(sourcePath, Buffer.from('video'));
      await expect(importSceneVideoToLibrary({
        libraryRoot: join(dir, 'library'),
        sourcePath,
        normalize: async () => ({ durationMs: 1_000, width: 100, height: 100 }),
      })).rejects.toThrow('仅支持 MP4、MOV 和 WebM');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
