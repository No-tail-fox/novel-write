import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, join } from 'node:path';
import type { BgmItem, ManagedBgmImport } from '../src/shared/types';

export const managedBgmDirectoryName = 'bgm';
export const managedBgmMaxBytes = 256 * 1024 * 1024;

const managedBgmExtensions = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac']);
const managedBgmFileNamePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:mp3|wav|m4a|aac|ogg|flac)$/u;

export function managedBgmDirectory(dataDir: string): string {
  return join(dataDir, managedBgmDirectoryName);
}

export function resolveManagedBgmFilePath(dataDir: string, fileName: string): string | null {
  const normalized = fileName.trim().toLowerCase();
  if (!managedBgmFileNamePattern.test(normalized) || basename(normalized) !== normalized) return null;
  return join(managedBgmDirectory(dataDir), normalized);
}

export function resolveRuntimeManagedBgmLibrary(dataDir: string, library: BgmItem[]): BgmItem[] {
  return library.map((item) => {
    if (!item.managedFileName) return item;
    const path = resolveManagedBgmFilePath(dataDir, item.managedFileName);
    return path && path !== item.path ? { ...item, path } : item;
  });
}

export async function removeUnreferencedManagedBgmFiles(
  dataDir: string,
  previous: BgmItem[],
  current: BgmItem[],
): Promise<string[]> {
  const retained = new Set(current.map((item) => item.managedFileName?.trim().toLowerCase()).filter(Boolean));
  const removed: string[] = [];
  for (const item of previous) {
    const fileName = item.managedFileName?.trim().toLowerCase() ?? '';
    if (!fileName || retained.has(fileName) || removed.includes(fileName)) continue;
    const path = resolveManagedBgmFilePath(dataDir, fileName);
    if (!path) continue;
    const deleted = await rm(path, { force: true }).then(() => true).catch(() => false);
    if (deleted) removed.push(fileName);
  }
  return removed;
}

export async function importManagedBgm(sourcePath: string, dataDir: string): Promise<ManagedBgmImport> {
  const source = sourcePath.trim();
  if (!source || !isAbsolute(source)) throw new Error('BGM_IMPORT_PATH_INVALID: 请选择有效的本地音频文件。');
  const extension = extname(source).toLowerCase();
  if (!managedBgmExtensions.has(extension)) throw new Error('BGM_IMPORT_FORMAT_INVALID: 仅支持 MP3、WAV、M4A、AAC、OGG 和 FLAC。');

  const sourceStat = await stat(source).catch(() => null);
  if (!sourceStat?.isFile() || sourceStat.size <= 0) throw new Error('BGM_IMPORT_SOURCE_INVALID: 所选音频为空或不可读取。');
  if (sourceStat.size > managedBgmMaxBytes) throw new Error('BGM_IMPORT_SIZE_EXCEEDED: BGM 文件不能超过 256 MB。');

  const directory = managedBgmDirectory(dataDir);
  await mkdir(directory, { recursive: true });
  const managedFileName = `${randomUUID()}${extension}`;
  const destination = resolveManagedBgmFilePath(dataDir, managedFileName);
  if (!destination) throw new Error('BGM_IMPORT_DESTINATION_INVALID: 无法创建受管 BGM 文件名。');
  const temporary = join(directory, `.${managedFileName}.${randomUUID()}.tmp`);
  try {
    await copyFile(source, temporary, constants.COPYFILE_EXCL);
    const copied = await stat(temporary);
    if (!copied.isFile() || copied.size !== sourceStat.size) {
      throw new Error('BGM_IMPORT_COPY_INCOMPLETE: BGM 文件复制不完整。');
    }
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }

  const sourceFileName = basename(source);
  return {
    title: sourceFileName.slice(0, Math.max(0, sourceFileName.length - extension.length)) || 'BGM',
    path: destination,
    managedFileName,
  };
}
