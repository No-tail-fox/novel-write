import { constants as fsConstants } from 'node:fs';
import { lstat, open, unlink, type FileHandle } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { ImageLabImportInput, ImageLabRecord } from '../src/shared/types';
import type { ImageLabRecordInput } from '../src/shared/storage';
import { createManagedHistoryWorkDirectory, createManagedStorageKey, removeQuarantineTreeNoFollow, stageManagedHistoryDirectory } from './managed-history-paths';

export const MAX_IMAGE_LAB_IMPORT_BYTES = 64 * 1024 * 1024;
export const MAX_IMAGE_LAB_IMPORT_DIMENSION = 16_384;
export const MAX_IMAGE_LAB_IMPORT_PIXELS = 64 * 1024 * 1024;

export interface ManagedImageLabImportDependencies {
  createManagedStorageKey?: () => string;
  beforeDestinationOpen?: () => Promise<void>;
  beforeCopy?: () => Promise<void>;
  beforeRollback?: () => Promise<void>;
  copyFile?: (source: FileHandle, destination: FileHandle, validatedBytes: Buffer) => Promise<void>;
  writeDestination?: (directoryPath: string, destinationPath: string, identityJson: string, validatedBytes: Buffer) => Promise<void>;
  inspectImage?: (bytes: Buffer) => Promise<{ width: number; height: number }> | { width: number; height: number };
}

export async function importManagedImageLabRecord(
  appDataDir: string,
  input: ImageLabImportInput,
  persist: (input: ImageLabRecordInput) => Promise<ImageLabRecord>,
  dependencies: ManagedImageLabImportDependencies = {},
): Promise<ImageLabRecord> {
  const sourcePath = input.imagePath.trim();
  const extension = extname(sourcePath).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extension)) {
    throw new Error('IMAGE_LAB_IMPORT_SOURCE_INVALID: Unsupported image extension or format.');
  }
  const sourcePathStat = await lstat(sourcePath, { bigint: true });
  if (!sourcePathStat.isFile() || sourcePathStat.isSymbolicLink()) {
    throw new Error('IMAGE_LAB_IMPORT_SOURCE_INVALID: Imported image must be a regular file.');
  }
  const sourceSize = Number(sourcePathStat.size);
  if (!Number.isSafeInteger(sourceSize) || sourceSize <= 0 || sourceSize > MAX_IMAGE_LAB_IMPORT_BYTES) {
    throw new Error(`IMAGE_LAB_IMPORT_SOURCE_INVALID: Image size must be from 1 to ${MAX_IMAGE_LAB_IMPORT_BYTES} bytes.`);
  }

  const sourceHandle = await open(sourcePath, 'r');
  try {
    const source = await sourceHandle.stat({ bigint: true });
    if (!source.isFile()
      || source.dev !== sourcePathStat.dev
      || source.ino !== sourcePathStat.ino
      || source.size !== sourcePathStat.size) {
      throw new Error('IMAGE_LAB_IMPORT_SOURCE_CHANGED: Selected image identity changed before it could be opened.');
    }
    const sourceBytes = await sourceHandle.readFile();
    if (sourceBytes.length !== sourceSize) {
      throw new Error('IMAGE_LAB_IMPORT_SOURCE_CHANGED: Selected image size changed while it was being read.');
    }
    const headerSize = imageDimensions(sourceBytes, extension);
    assertSafeImageDimensions(headerSize);
    if (dependencies.inspectImage) {
      const decodedSize = await dependencies.inspectImage(sourceBytes);
      assertSafeImageDimensions(decodedSize);
    }
    const managedStorageKey = (dependencies.createManagedStorageKey ?? createManagedStorageKey)();
    const anchor = await createManagedHistoryWorkDirectory(appDataDir, 'image-lab', managedStorageKey);
    const destinationPath = join(anchor.path, `imported${extension}`);
    let destinationHandle: FileHandle | null = null;
    try {
      await anchor.assertCurrent();
      await dependencies.beforeDestinationOpen?.();
      if (dependencies.writeDestination) {
        await anchor.assertCurrent();
        await dependencies.beforeCopy?.();
        await anchor.assertCurrent();
        await dependencies.writeDestination(anchor.path, destinationPath, anchor.identityJson, sourceBytes);
      } else {
        destinationHandle = await open(
          destinationPath,
          fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
          0o600,
        );
        await anchor.assertCurrent();
        await dependencies.beforeCopy?.();
        await anchor.assertCurrent();
        await (dependencies.copyFile ?? copyValidatedImage)(sourceHandle, destinationHandle, sourceBytes);
        const copied = await destinationHandle.stat({ bigint: true });
        if (!copied.isFile() || copied.size !== source.size) {
          throw new Error('IMAGE_LAB_IMPORT_COPY_INVALID: Managed image copy did not preserve the source file.');
        }
      }
      await anchor.assertCurrent();
      return await persist({
        ...input,
        managedStorageKey,
        imagePath: destinationPath,
        status: 'generated',
        errorMessage: '',
        finishedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (destinationHandle) {
        try {
          await removeOpenedDestination(destinationPath, destinationHandle);
          destinationHandle = null;
        } catch (cleanupError) {
          destinationHandle = null;
          throw new AggregateError(
            [error, cleanupError],
            `IMAGE_LAB_IMPORT_DESTINATION_CLEANUP_FAILED: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      let current = false;
      try {
        await anchor.assertCurrent();
        current = true;
      } catch {
        // Never follow a path whose directory identity has changed.
      }
      if (current) {
        try {
          await dependencies.beforeRollback?.();
          const staged = await stageManagedHistoryDirectory(
            appDataDir,
            'image-lab',
            managedStorageKey,
            {},
            anchor.identityJson,
          );
          if (staged) await removeQuarantineTreeNoFollow(staged);
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], 'IMAGE_LAB_IMPORT_ROLLBACK_FAILED');
        }
      }
      throw error;
    } finally {
      await destinationHandle?.close();
    }
  } finally {
    await sourceHandle.close();
  }
}

async function removeOpenedDestination(path: string, handle: FileHandle): Promise<void> {
  const opened = await handle.stat({ bigint: true });
  await handle.close();
  const current = await lstat(path, { bigint: true });
  if (!current.isFile()
    || current.isSymbolicLink()
    || current.dev !== opened.dev
    || current.ino !== opened.ino) {
    throw new Error('IMAGE_LAB_IMPORT_DESTINATION_CHANGED: Refusing to remove a destination whose identity changed.');
  }
  await unlink(path);
}

function imageDimensions(bytes: Buffer, extension: string): { width: number; height: number } {
  if (extension === '.png') return pngDimensions(bytes);
  if (extension === '.jpg' || extension === '.jpeg') return jpegDimensions(bytes);
  if (extension === '.webp') return webpDimensions(bytes);
  if (extension === '.gif') return gifDimensions(bytes);
  throw new Error('IMAGE_LAB_IMPORT_SOURCE_INVALID: Unsupported image extension or format.');
}

function pngDimensions(bytes: Buffer): { width: number; height: number } {
  const signature = '89504e470d0a1a0a';
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== signature || bytes.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error('IMAGE_LAB_IMPORT_SOURCE_INVALID: PNG signature or IHDR is invalid.');
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('IMAGE_LAB_IMPORT_SOURCE_INVALID: JPEG signature is invalid.');
  }
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 1 >= bytes.length) break;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    if (isJpegStartOfFrame(marker) && segmentLength >= 7) {
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    offset += segmentLength;
  }
  throw new Error('IMAGE_LAB_IMPORT_SOURCE_INVALID: JPEG dimensions are missing or invalid.');
}

function isJpegStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
}

function webpDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 30 || bytes.subarray(0, 4).toString('ascii') !== 'RIFF' || bytes.subarray(8, 12).toString('ascii') !== 'WEBP') {
    throw new Error('IMAGE_LAB_IMPORT_SOURCE_INVALID: WebP signature is invalid.');
  }
  const chunk = bytes.subarray(12, 16).toString('ascii');
  if (chunk === 'VP8X') {
    return { width: 1 + readUInt24LE(bytes, 24), height: 1 + readUInt24LE(bytes, 27) };
  }
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    return {
      width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
      height: 1 + ((bytes[22] & 0xc0) >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
    };
  }
  if (chunk === 'VP8 ' && bytes.subarray(23, 26).toString('hex') === '9d012a') {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  throw new Error('IMAGE_LAB_IMPORT_SOURCE_INVALID: WebP dimensions are missing or invalid.');
}

function gifDimensions(bytes: Buffer): { width: number; height: number } {
  const signature = bytes.subarray(0, 6).toString('ascii');
  if (bytes.length < 10 || (signature !== 'GIF87a' && signature !== 'GIF89a')) {
    throw new Error('IMAGE_LAB_IMPORT_SOURCE_INVALID: GIF signature is invalid.');
  }
  return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
}

function readUInt24LE(bytes: Buffer, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function assertSafeImageDimensions(size: { width: number; height: number }): void {
  if (!Number.isInteger(size.width)
    || !Number.isInteger(size.height)
    || size.width <= 0
    || size.height <= 0
    || size.width > MAX_IMAGE_LAB_IMPORT_DIMENSION
    || size.height > MAX_IMAGE_LAB_IMPORT_DIMENSION
    || size.width * size.height > MAX_IMAGE_LAB_IMPORT_PIXELS) {
    throw new Error(`IMAGE_LAB_IMPORT_SOURCE_INVALID: Image dimensions or pixel count exceed the safe limit (${MAX_IMAGE_LAB_IMPORT_DIMENSION}px, ${MAX_IMAGE_LAB_IMPORT_PIXELS} pixels).`);
  }
}

async function copyValidatedImage(_source: FileHandle, destination: FileHandle, validatedBytes: Buffer): Promise<void> {
  let position = 0;
  while (position < validatedBytes.length) {
    const result = await destination.write(validatedBytes, position, validatedBytes.length - position, position);
    position += result.bytesWritten;
  }
  await destination.sync();
}
