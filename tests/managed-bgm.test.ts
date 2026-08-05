import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultConfig } from '@shared/config';
import { addUploadedBgm } from '../src/features/tasks/task-formatters';
import {
  importManagedBgm,
  managedBgmDirectory,
  removeUnreferencedManagedBgmFiles,
  resolveManagedBgmFilePath,
  resolveRuntimeManagedBgmLibrary,
} from '../electron/managed-bgm';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(label: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `storydream-${label}-`));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('managed BGM storage', () => {
  it('copies an imported track into the application BGM directory with a portable identity', async () => {
    const sourceDir = await temporaryDirectory('bgm-source');
    const dataDir = await temporaryDirectory('bgm-data');
    const source = join(sourceDir, '片头音乐.MP3');
    await writeFile(source, Buffer.from('managed-bgm-audio'));

    const imported = await importManagedBgm(source, dataDir);

    expect(imported.title).toBe('片头音乐');
    expect(imported.managedFileName).toMatch(/^[0-9a-f-]{36}\.mp3$/u);
    expect(imported.path).toBe(join(managedBgmDirectory(dataDir), imported.managedFileName));
    expect(await readFile(imported.path, 'utf8')).toBe('managed-bgm-audio');

    const added = addUploadedBgm(structuredClone(defaultConfig), imported);
    expect(added.config.jianying.bgmLibrary[0]).toMatchObject(imported);
    expect(added.config.jianying.defaultBgmId).toBe(added.bgmId);
  });

  it('creates independent managed files when the same source is imported twice', async () => {
    const sourceDir = await temporaryDirectory('bgm-duplicate-source');
    const dataDir = await temporaryDirectory('bgm-duplicate-data');
    const source = join(sourceDir, 'theme.wav');
    await writeFile(source, Buffer.from('same-source'));

    const first = await importManagedBgm(source, dataDir);
    const second = await importManagedBgm(source, dataDir);

    expect(second.managedFileName).not.toBe(first.managedFileName);
    expect(await readFile(first.path, 'utf8')).toBe('same-source');
    expect(await readFile(second.path, 'utf8')).toBe('same-source');
  });

  it('resolves a migrated managed item beneath the new computer data directory', () => {
    const managedFileName = 'a4bf19b7-0e26-4f25-804a-51891af02c9a.flac';
    const item = {
      id: 'bgm-managed',
      title: 'Portable',
      path: 'C:\\Users\\old-pc\\AppData\\Roaming\\storydream\\storydream\\bgm\\old.flac',
      managedFileName,
      durationMs: 0,
      volume: 0.25,
    };

    const [resolved] = resolveRuntimeManagedBgmLibrary('D:\\Portable\\storydream', [item]);

    expect(resolved.path).toBe(join('D:\\Portable\\storydream', 'bgm', managedFileName));
  });

  it('rejects unsupported and empty source files without creating a managed track', async () => {
    const sourceDir = await temporaryDirectory('bgm-invalid-source');
    const dataDir = await temporaryDirectory('bgm-invalid-data');
    const unsupported = join(sourceDir, 'notes.txt');
    const empty = join(sourceDir, 'empty.wav');
    await writeFile(unsupported, 'not audio');
    await writeFile(empty, '');

    await expect(importManagedBgm(unsupported, dataDir)).rejects.toThrow('BGM_IMPORT_FORMAT_INVALID');
    await expect(importManagedBgm(empty, dataDir)).rejects.toThrow('BGM_IMPORT_SOURCE_INVALID');
  });

  it('removes only unreferenced managed files and never deletes a legacy source path', async () => {
    const dataDir = await temporaryDirectory('bgm-remove-data');
    const legacyDir = await temporaryDirectory('bgm-legacy-source');
    const removedName = 'a4bf19b7-0e26-4f25-804a-51891af02c9a.mp3';
    const retainedName = '69ea3b3b-4b20-4c87-94f3-4adbb98e2f29.wav';
    const removedPath = resolveManagedBgmFilePath(dataDir, removedName)!;
    const retainedPath = resolveManagedBgmFilePath(dataDir, retainedName)!;
    const legacyPath = join(legacyDir, 'original.mp3');
    await mkdir(managedBgmDirectory(dataDir), { recursive: true });
    await Promise.all([
      writeFile(removedPath, 'remove'),
      writeFile(retainedPath, 'retain'),
      writeFile(legacyPath, 'legacy'),
    ]);
    const previous = [
      { id: 'removed', title: 'Removed', path: removedPath, managedFileName: removedName, durationMs: 0, volume: 0.25 },
      { id: 'retained', title: 'Retained', path: retainedPath, managedFileName: retainedName, durationMs: 0, volume: 0.25 },
      { id: 'legacy', title: 'Legacy', path: legacyPath, durationMs: 0, volume: 0.25 },
    ];

    const deleted = await removeUnreferencedManagedBgmFiles(dataDir, previous, [previous[1]]);

    expect(deleted).toEqual([removedName]);
    await expect(access(removedPath)).rejects.toThrow();
    await expect(access(retainedPath)).resolves.toBeUndefined();
    await expect(access(legacyPath)).resolves.toBeUndefined();
  });
});
