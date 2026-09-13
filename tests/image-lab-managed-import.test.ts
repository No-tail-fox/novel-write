import { access, mkdir, readFile, readdir, rename, stat, truncate, writeFile } from 'node:fs/promises';
import { createTestTempDirectory as mkdtemp, createTestDirectoryLink as symlink, removeTestTempDirectories } from './helpers/test-temp-directories';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_IMAGE_LAB_IMPORT_BYTES,
  importManagedImageLabRecord,
} from '../electron/image-lab-import';
import { FileDatabase } from '../src/shared/storage';
import { ipcInputSchemas } from '../src/shared/ipc-contract';

const cleanupRoots: string[] = [];
const validPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlNsAAAAASUVORK5CYII=', 'base64');

afterEach(async () => {
  await Promise.all(cleanupRoots.splice(0).map((root) => removeTestTempDirectories(root)));
});

describe('managed image lab import', () => {
  it('copies a validated image into its managed work directory before persisting the canonical path', async () => {
    const root = await temporaryRoot('storydream-managed-image-import-');
    const source = join(root, 'source.png');
    const bytes = validPng;
    await writeFile(source, bytes);
    const database = await FileDatabase.open(join(root, 'app.db'));
    try {
      const record = await importManagedImageLabRecord(
        root,
        importInput(source),
        (input) => database.addImageLabRecord(input),
      );
      expect(record.managedStorageKey).toMatch(/^[a-z0-9_-]{16,128}$/u);
      const managedPath = join(root, 'image-lab', record.managedStorageKey!, 'imported.png');
      expect(record.imagePath).toBe(managedPath);
      expect(await readFile(managedPath)).toEqual(bytes);
      expect((await database.getImageLabRecordDetail(record.id))?.imagePath).toBe(managedPath);
    } finally {
      await database.close();
    }
  });

  it('rejects unsupported extensions, directories, empty files, oversized files, fake images, and excessive dimensions before persistence', async () => {
    const root = await temporaryRoot('storydream-managed-image-invalid-');
    const unsupported = join(root, 'source.txt');
    const empty = join(root, 'empty.png');
    const directory = join(root, 'directory.png');
    const oversized = join(root, 'oversized.webp');
    const fakeImage = join(root, 'fake.png');
    const excessiveDimensions = join(root, 'excessive.png');
    const excessivePng = Buffer.from(validPng);
    excessivePng.writeUInt32BE(20_000, 16);
    await Promise.all([
      writeFile(unsupported, 'not an image'),
      writeFile(empty, ''),
      mkdir(directory),
      writeFile(oversized, 'x'),
      writeFile(fakeImage, 'not actually an image'),
      writeFile(excessiveDimensions, excessivePng),
    ]);
    await truncate(oversized, MAX_IMAGE_LAB_IMPORT_BYTES + 1);
    const persist = vi.fn();

    await expect(importManagedImageLabRecord(root, importInput(unsupported), persist)).rejects.toThrow(/format|extension/i);
    await expect(importManagedImageLabRecord(root, importInput(directory), persist)).rejects.toThrow(/regular file/i);
    await expect(importManagedImageLabRecord(root, importInput(empty), persist)).rejects.toThrow(/size/i);
    await expect(importManagedImageLabRecord(root, importInput(oversized), persist)).rejects.toThrow(/size/i);
    await expect(importManagedImageLabRecord(root, importInput(fakeImage), persist)).rejects.toThrow(/format|image/i);
    await expect(importManagedImageLabRecord(root, importInput(excessiveDimensions), persist)).rejects.toThrow(/dimension|pixel/i);
    expect(persist).not.toHaveBeenCalled();
    await expect(access(join(root, 'image-lab'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes the managed directory when copying or database persistence fails', async () => {
    const root = await temporaryRoot('storydream-managed-image-rollback-');
    const source = join(root, 'source.png');
    await writeFile(source, validPng);
    const copyKey = 'copy-failure-managed-key';
    const persistKey = 'persist-failure-managed-key';
    const persist = vi.fn();

    await expect(importManagedImageLabRecord(root, importInput(source), persist, {
      createManagedStorageKey: () => copyKey,
      copyFile: async () => { throw new Error('copy failed'); },
    })).rejects.toThrow('copy failed');
    expect(persist).not.toHaveBeenCalled();
    await expect(stat(join(root, 'image-lab', copyKey))).rejects.toMatchObject({ code: 'ENOENT' });

    await expect(importManagedImageLabRecord(root, importInput(source), async () => {
      throw new Error('database failed');
    }, {
      createManagedStorageKey: () => persistKey,
    })).rejects.toThrow('database failed');
    await expect(stat(join(root, 'image-lab', persistKey))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps ownership fields main-process-only and routes the trusted handler through the managed importer', async () => {
    const valid = importInput('D:/selected/source.png');
    expect(ipcInputSchemas['image-lab:add-record'].safeParse(valid).success).toBe(true);
    for (const field of [
      { managedStorageKey: 'renderer-owned-key' },
      { id: 'renderer-owned-id' },
      { status: 'generated' },
    ]) {
      expect(ipcInputSchemas['image-lab:add-record'].safeParse({ ...valid, ...field }).success).toBe(false);
    }

    const [main, apiContract, preload] = await Promise.all([
      readFile(new URL('../electron/main.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8'),
      readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8'),
    ]);
    const handler = main.slice(
      main.indexOf("trustedHandle('image-lab:add-record'"),
      main.indexOf("trustedHandle('voice-lab:generate'"),
    );
    expect(main).toContain("import { importManagedImageLabRecord } from './image-lab-import';");
    expect(handler).toContain('importManagedImageLabRecord(');
    expect(handler).toContain('appDataDir()');
    expect(handler).toContain('(record) => database.addImageLabRecord(record)');
    expect(handler).toContain('nativeImage.createFromBuffer');
    expect(handler).toContain('writeDestination: writeWindowsManagedFile');
    expect(handler).not.toContain('database.addImageLabRecord(input)');
    expect(apiContract).toContain('addImageLabRecord: (input: ImageLabImportInput)');
    expect(preload).toContain('addImageLabRecord: (input: ImageLabImportInput)');
  });

  it('copies from the validated open file when the selected path is replaced before copying', async () => {
    const root = await temporaryRoot('storydream-managed-image-source-race-');
    const source = join(root, 'source.png');
    const movedSource = join(root, 'validated-source.png');
    const replacement = join(root, 'replacement.png');
    const originalBytes = Buffer.concat([validPng, Buffer.from('original-image')]);
    const replacementBytes = Buffer.concat([validPng, Buffer.from('replaced-image')]);
    await writeFile(source, originalBytes);
    await writeFile(replacement, replacementBytes);
    const beforeCopy = vi.fn(async () => {
      await rename(source, movedSource);
      await writeFile(movedSource, replacementBytes);
      await rename(replacement, source);
    });

    const record = await importManagedImageLabRecord(root, importInput(source), async (input) => ({
      ...input,
      id: 'source-race',
      archivedAt: null,
      imagePath: input.imagePath ?? '',
      status: input.status ?? 'generated',
      errorMessage: input.errorMessage ?? '',
      resolution: input.resolution ?? '2K',
      smartMode: input.smartMode ?? 'text-to-image',
      referenceImagePaths: input.referenceImagePaths ?? [],
      referenceImagePath: input.referenceImagePath ?? '',
      upstreamTaskId: input.upstreamTaskId ?? null,
      createdAt: input.createdAt ?? new Date().toISOString(),
      finishedAt: input.finishedAt ?? new Date().toISOString(),
    }), { beforeCopy });

    expect(beforeCopy).toHaveBeenCalledOnce();
    expect(await readFile(record.imagePath)).toEqual(originalBytes);
  });

  it('rejects a pre-existing managed family junction without writing outside app data', async () => {
    const root = await temporaryRoot('storydream-managed-image-target-junction-');
    const outside = await temporaryRoot('storydream-managed-image-target-outside-');
    const source = join(root, 'source.png');
    await writeFile(source, validPng);
    await symlink(outside, join(root, 'image-lab'), process.platform === 'win32' ? 'junction' : 'dir');

    await expect(importManagedImageLabRecord(root, importInput(source), vi.fn())).rejects.toThrow(/reparse|identity|managed.*root/i);
    expect(await readdir(outside)).toEqual([]);
  });

  it('rechecks target directory identities after the copy boundary opens', async () => {
    const root = await temporaryRoot('storydream-managed-image-target-race-');
    const outside = await temporaryRoot('storydream-managed-image-race-outside-');
    const source = join(root, 'source.png');
    const displacedRoot = join(root, 'image-lab-displaced');
    await writeFile(source, validPng);
    const beforeCopy = vi.fn(async () => {
      await rename(join(root, 'image-lab'), displacedRoot);
      await symlink(outside, join(root, 'image-lab'), process.platform === 'win32' ? 'junction' : 'dir');
    });

    await expect(importManagedImageLabRecord(root, importInput(source), vi.fn(), { beforeCopy })).rejects.toThrow(/reparse|identity|changed|EPERM|operation not permitted/i);
    expect(beforeCopy).toHaveBeenCalledOnce();
    expect(await readdir(outside)).toEqual([]);
  });

  it('does not leave a destination file when the work directory is replaced before destination open', async () => {
    const root = await temporaryRoot('storydream-managed-image-destination-open-race-');
    const source = join(root, 'source.png');
    const key = 'destination-open-race-key';
    const workDir = join(root, 'image-lab', key);
    const displaced = join(root, 'image-lab', `${key}-displaced`);
    await writeFile(source, validPng);

    await expect(importManagedImageLabRecord(root, importInput(source), vi.fn(), {
      createManagedStorageKey: () => key,
      beforeDestinationOpen: async () => {
        await rename(workDir, displaced);
        await mkdir(workDir);
      },
    })).rejects.toThrow(/identity|changed|reparse/i);

    expect(await readdir(workDir)).toEqual([]);
  });

  it('refuses rollback cleanup when the managed work directory identity is replaced', async () => {
    const root = await temporaryRoot('storydream-managed-image-rollback-race-');
    const source = join(root, 'source.png');
    const key = 'rollback-race-managed-key';
    const workDir = join(root, 'image-lab', key);
    const displaced = join(root, 'image-lab', `${key}-displaced`);
    await writeFile(source, validPng);

    await expect(importManagedImageLabRecord(root, importInput(source), vi.fn(), {
      createManagedStorageKey: () => key,
      copyFile: async () => { throw new Error('copy failed'); },
      beforeRollback: async () => {
        await rename(workDir, displaced);
        await mkdir(workDir);
        await writeFile(join(workDir, 'replacement.txt'), 'must remain');
      },
    })).rejects.toThrow(/rollback|identity/i);

    expect(await readFile(join(workDir, 'replacement.txt'), 'utf8')).toBe('must remain');
  });

  it('makes browser preview reject managed imports instead of retaining an external path', async () => {
    const fallback = await readFile(new URL('../src/app/browser-fallback.ts', import.meta.url), 'utf8');
    const handler = fallback.slice(fallback.indexOf('async addImageLabRecord'), fallback.indexOf('async saveAccount'));
    expect(handler).toContain("throw new Error('IMAGE_LAB_IMPORT_REQUIRES_ELECTRON");
    expect(handler).not.toContain('imagePath: input.imagePath');
  });

  it('blocks permanent deletion while a managed image is referenced by a motion comic project', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const guard = main.slice(
      main.indexOf('async function assertImageLabRecordIsNotProjectReference'),
      main.indexOf('async function getConfigService'),
    );
    const handler = main.slice(
      main.indexOf("trustedHandle('image-lab:delete'"),
      main.indexOf("trustedHandle('voice-lab:archive'"),
    );
    expect(guard).toContain('database.getImageLabRecordDetail(id)');
    expect(guard).toContain('database.getTaskDetail(record.upstreamTaskId)');
    expect(guard).toContain('motionComicReferencesImageLabRecord(document, id)');
    expect(guard).toContain('HISTORY_REFERENCED');
    expect(handler.indexOf('assertImageLabRecordIsNotProjectReference')).toBeLessThan(handler.indexOf('deleteHistoryPermanently'));
  });
});

function importInput(imagePath: string) {
  return {
    prompt: 'Imported finished image',
    ratio: '9:16',
    style: 'photo-real',
    provider: 'mock',
    imagePath,
    resolution: '2K' as const,
    smartMode: 'text-to-image' as const,
  };
}

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  cleanupRoots.push(root);
  return root;
}
