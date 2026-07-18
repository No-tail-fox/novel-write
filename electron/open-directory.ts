import type { BigIntStats } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { AppError } from '../src/shared/app-error';

export type DirectoryOpener = (path: string) => Promise<string>;
export interface DirectoryFileOperations {
  realpath(path: string): Promise<string>;
  stat(path: string): Promise<BigIntStats>;
}

export interface OpenExistingDirectoryOptions {
  allowedRoot?: string;
  fileOperations?: Partial<DirectoryFileOperations>;
}

interface DirectoryIdentity {
  canonicalPath: string;
  device: string;
  inode: string;
}

const maxDirectoryErrorDetailChars = 1024;

export async function openExistingDirectory(
  path: string,
  openPath: DirectoryOpener,
  options: OpenExistingDirectoryOptions = {},
): Promise<void> {
  const resolvePath = options.fileOperations?.realpath ?? realpath;
  const statPath = options.fileOperations?.stat ?? ((candidate: string) => stat(candidate, { bigint: true }));
  let canonicalPath: string;
  let value: BigIntStats;
  let rootIdentity: DirectoryIdentity | undefined;
  let targetIdentity: DirectoryIdentity;
  try {
    const canonicalRoot = options.allowedRoot ? await resolvePath(options.allowedRoot) : undefined;
    if (canonicalRoot) {
      const rootValue = await statPath(canonicalRoot);
      if (!rootValue.isDirectory()) {
        throw new AppError('DIRECTORY_INVALID', '允许的素材根路径不是目录。');
      }
      rootIdentity = directoryIdentity(canonicalRoot, rootValue);
    }
    canonicalPath = await resolvePath(path);
    if (canonicalRoot && !isPathInside(canonicalRoot, canonicalPath)) {
      throw new AppError('DIRECTORY_OUTSIDE_ROOT', '目标目录不在允许的素材目录内。');
    }
    value = await statPath(canonicalPath);
    targetIdentity = directoryIdentity(canonicalPath, value);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AppError('DIRECTORY_NOT_FOUND', `目录不存在：${path}`);
    }
    throw error;
  }
  if (!value.isDirectory()) {
    throw new AppError('DIRECTORY_INVALID', `目标不是目录：${path}`);
  }
  if (rootIdentity) {
    const validatedRoot = await revalidateDirectoryIdentity(rootIdentity, resolvePath, statPath);
    canonicalPath = await revalidateDirectoryIdentity(targetIdentity, resolvePath, statPath);
    if (!isPathInside(validatedRoot, canonicalPath)) {
      throw new AppError('DIRECTORY_OUTSIDE_ROOT', '目标目录不在允许的素材目录内。');
    }
  } else {
    canonicalPath = await revalidateDirectoryIdentity(targetIdentity, resolvePath, statPath);
  }
  const openError = await openPath(canonicalPath);
  if (openError.trim()) {
    throw new AppError(
      'DIRECTORY_OPEN_FAILED',
      `无法打开目录：${openError.trim().slice(0, maxDirectoryErrorDetailChars)}`,
      true,
    );
  }
}

function directoryIdentity(path: string, value: Pick<BigIntStats, 'dev' | 'ino'>): DirectoryIdentity {
  return {
    canonicalPath: path,
    device: value.dev.toString(),
    inode: value.ino.toString(),
  };
}

async function revalidateDirectoryIdentity(
  identity: DirectoryIdentity,
  resolvePath: DirectoryFileOperations['realpath'],
  statPath: DirectoryFileOperations['stat'],
): Promise<string> {
  try {
    const canonicalPath = await resolvePath(identity.canonicalPath);
    const value = await statPath(canonicalPath);
    if (
      relative(identity.canonicalPath, canonicalPath)
      || !value.isDirectory()
      || value.dev.toString() !== identity.device
      || value.ino.toString() !== identity.inode
    ) {
      throw new AppError('DIRECTORY_CHANGED', '目标目录在打开前发生变化，请重试。', true);
    }
    return canonicalPath;
  } catch (error) {
    if (error instanceof AppError && error.code === 'DIRECTORY_CHANGED') throw error;
    throw new AppError('DIRECTORY_CHANGED', '目标目录在打开前发生变化，请重试。', true);
  }
}

function isPathInside(root: string, target: string): boolean {
  const fromRoot = relative(root, target);
  return fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
}
