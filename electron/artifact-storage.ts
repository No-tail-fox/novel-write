import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ARTIFACT_STORAGE_DIRECTORIES, rebaseArtifactPathText } from '../src/shared/artifact-paths';
export { ARTIFACT_STORAGE_DIRECTORIES } from '../src/shared/artifact-paths';
import type { ArtifactStorageLocation } from '../src/shared/artifact-storage';
import { AppError, normalizeAppError } from '../src/shared/app-error';

interface StorageManifest {
  version: 1;
  directory: string;
  pendingDirectory: string | null;
  previousDirectories: string[];
  databaseSources: string[];
}

async function inspect(path: string) {
  try { return await lstat(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function normalizedPath(path: string): string {
  const normalized = resolve(path).replace(/[\\/]+$/u, '');
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

function samePath(left: string, right: string): boolean {
  return normalizedPath(left) === normalizedPath(right);
}

function contains(parent: string, child: string): boolean {
  const pathFromParent = relative(parent, child);
  return pathFromParent === '' || (pathFromParent !== '..' && !pathFromParent.startsWith('..' + sep) && !isAbsolute(pathFromParent));
}

function checkedPath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || value.includes('\0') || !isAbsolute(value)) {
    throw new AppError('ARTIFACT_STORAGE_INVALID_DIRECTORY', '请选择有效的绝对文件夹路径。');
  }
  return resolve(value);
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function mergeArtifactDirectory(source: string, target: string, pathSources: readonly string[], artifactRoot: string): Promise<void> {
  const sourceInfo = await lstat(source);
  if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) {
    throw new Error(`产物目录包含不受支持的链接或非文件夹：${source}`);
  }
  const targetInfo = await inspect(target);
  if (targetInfo && (!targetInfo.isDirectory() || targetInfo.isSymbolicLink())) {
    throw new Error(`目标位置存在同名非文件夹，未覆盖任何已有文件：${target}`);
  }
  await mkdir(target, { recursive: true });

  for (const name of await readdir(source)) {
    const sourcePath = join(source, name);
    const targetPath = join(target, name);
    const childInfo = await lstat(sourcePath);
    if (childInfo.isSymbolicLink()) {
      throw new Error(`产物中包含目录链接，迁移已停止以保护路径安全：${sourcePath}`);
    }
    if (childInfo.isDirectory()) {
      await mergeArtifactDirectory(sourcePath, targetPath, pathSources, artifactRoot);
      continue;
    }
    if (!childInfo.isFile()) {
      throw new Error(`产物中包含不支持的文件类型：${sourcePath}`);
    }

    const updatedJson = extname(name).toLowerCase() === '.json'
      ? rebaseArtifactPathText(await readFile(sourcePath, 'utf8'), pathSources, artifactRoot) : null;
    const existing = await inspect(targetPath);
    if (existing) {
      const identical = existing.isFile() && !existing.isSymbolicLink() && (updatedJson !== null
        ? updatedJson === await readFile(targetPath, 'utf8')
        : existing.size === childInfo.size && await sha256(sourcePath) === await sha256(targetPath));
      if (!identical) {
        throw new Error(`目标目录已有不同内容，未覆盖文件：${targetPath}`);
      }
      continue;
    }

    const temporary = join(target, `.${name}.storydream-copy-${randomUUID()}.tmp`);
    try {
      if (updatedJson === null) await copyFile(sourcePath, temporary);
      else await writeFile(temporary, updatedJson, { encoding: 'utf8', flag: 'wx' });
      await rename(temporary, targetPath);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
}

/**
 * Keeps configuration and SQLite under Electron's userData folder while providing
 * an independently configurable root for generated and imported creative artifacts.
 * A requested switch is journaled first and copied on the next app startup; source
 * files are retained as a backup, and managed references are rebased to the new root.
 */
export class ArtifactStorage {
  readonly defaultDirectory: string;
  private readonly manifestPath: string;
  private manifest: StorageManifest;
  private migrationError: string | null = null;

  constructor(
    private readonly userDataDirectory: string,
    defaultDirectory: string,
  ) {
    this.defaultDirectory = checkedPath(defaultDirectory);
    this.manifestPath = join(userDataDirectory, 'artifact-storage.v1.json');
    this.manifest = { version: 1, directory: this.defaultDirectory, pendingDirectory: null, previousDirectories: [], databaseSources: [] };
  }

  get directory(): string { return this.manifest.directory; }
  get databaseSources(): readonly string[] { return this.manifest.databaseSources; }

  async completeDatabaseMigration(): Promise<void> {
    if (this.databaseSources.length) await this.persist({ ...this.manifest, databaseSources: [] });
  }

  location(): ArtifactStorageLocation {
    return {
      directory: this.directory,
      defaultDirectory: this.defaultDirectory,
      pendingDirectory: this.manifest.pendingDirectory,
      migrationError: this.migrationError,
    };
  }

  private async persist(manifest: StorageManifest): Promise<void> {
    await mkdir(this.userDataDirectory, { recursive: true });
    const temporary = `${this.manifestPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      await rename(temporary, this.manifestPath);
      this.manifest = manifest;
    } catch (error) {
      throw normalizeAppError(error, { code: 'ARTIFACT_STORAGE_SAVE_FAILED', message: '无法保存产物存储设置，请检查应用数据目录的写入权限和磁盘空间。', retryable: true });
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  private async validateDisjointTarget(target: string): Promise<void> {
    // Windows can expose the same folder through both an 8.3 path and its full name.
    // Compare physical roots, while preserving saved aliases for reference migration.
    const canonical = async (directory: string) => {
      try { return await realpath(directory); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return directory;
        throw error;
      }
    };
    const [userData, defaultDirectory, current] = await Promise.all([
      canonical(this.userDataDirectory), canonical(this.defaultDirectory), canonical(this.directory),
    ]);
    if (samePath(target, defaultDirectory) || samePath(target, current)) return;
    if (contains(userData, target) || contains(target, userData)
      || contains(defaultDirectory, target) || contains(target, defaultDirectory)) {
      throw new AppError('ARTIFACT_STORAGE_INVALID_DIRECTORY', '产物目录不能放在应用配置目录内，也不能包含应用配置目录；请选择其他磁盘或独立文件夹。');
    }
    if (contains(current, target) || contains(target, current)) {
      throw new AppError('ARTIFACT_STORAGE_INVALID_DIRECTORY', '新产物目录不能是当前产物目录的父目录或子目录。');
    }
  }

  private async resolveDirectory(path: string, create: boolean): Promise<string> {
    const checked = checkedPath(path);
    if (create) await mkdir(checked, { recursive: true });
    const info = await inspect(checked);
    if (!info) throw new Error(`产物存储位置不可用，请连接对应磁盘或创建文件夹：${checked}`);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new AppError('ARTIFACT_STORAGE_INVALID_DIRECTORY', '请选择普通文件夹，不支持符号链接。');
    return await realpath(checked);
  }

  private async verifyWritable(directory: string): Promise<void> {
    const probe = join(directory, `.storydream-write-${randomUUID()}.tmp`);
    try {
      await writeFile(probe, '', { encoding: 'utf8', flag: 'wx' });
    } finally {
      await unlink(probe).catch(() => undefined);
    }
  }

  async initialize(): Promise<void> {
    try {
      const input: unknown = JSON.parse(await readFile(this.manifestPath, 'utf8'));
      if (!input || typeof input !== 'object') throw new Error('产物存储配置无效。');
      const saved = input as Partial<StorageManifest>;
      if (saved.version !== 1 || typeof saved.directory !== 'string'
        || !(saved.pendingDirectory === null || typeof saved.pendingDirectory === 'string')
        || (saved.previousDirectories !== undefined && !Array.isArray(saved.previousDirectories))
        || (saved.databaseSources !== undefined && !Array.isArray(saved.databaseSources))) {
        throw new Error('产物存储配置无效。');
      }
      this.manifest = {
        version: 1,
        directory: checkedPath(saved.directory),
        pendingDirectory: saved.pendingDirectory === null ? null : checkedPath(saved.pendingDirectory),
        previousDirectories: (saved.previousDirectories ?? []).map(checkedPath),
        databaseSources: (saved.databaseSources ?? []).map(checkedPath),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    const current = await this.resolveDirectory(this.directory, samePath(this.directory, this.defaultDirectory));
    if (this.manifest.pendingDirectory) {
      this.migrationError = null;
      try {
        await this.applyPendingDirectory(current);
      } catch (error) {
        this.migrationError = error instanceof Error ? error.message : String(error);
        console.error('产物目录迁移暂未完成，仍使用原目录：', this.migrationError);
      }
    }
  }

  private async applyPendingDirectory(source: string): Promise<void> {
    const requested = this.manifest.pendingDirectory;
    if (!requested) return;
    const target = await this.resolveDirectory(requested, true);
    await this.validateDisjointTarget(target);
    if (samePath(source, target)) {
      await this.persist({ ...this.manifest, directory: source, pendingDirectory: null });
      return;
    }
    await this.verifyWritable(target);
    const pathSources = [...new Set([...this.manifest.previousDirectories, this.directory, source])].filter((directory) => !samePath(directory, target));
    for (const name of ARTIFACT_STORAGE_DIRECTORIES) {
      const sourcePath = join(source, name);
      const info = await inspect(sourcePath);
      if (!info) continue;
      await mergeArtifactDirectory(sourcePath, join(target, name), pathSources, target);
    }
    await this.persist({ ...this.manifest, directory: target, pendingDirectory: null, previousDirectories: pathSources, databaseSources: pathSources });
    this.migrationError = null;
  }

  async requestDirectory(path: string): Promise<ArtifactStorageLocation> {
    try {
      const target = await this.resolveDirectory(path, true);
      await this.validateDisjointTarget(target);
      await this.verifyWritable(target);
      if (samePath(target, await realpath(this.directory))) {
        await this.persist({ ...this.manifest, pendingDirectory: null });
      } else {
        await this.persist({ ...this.manifest, pendingDirectory: target });
      }
      this.migrationError = null;
      return this.location();
    } catch (error) {
      throw normalizeAppError(error, { code: 'ARTIFACT_STORAGE_CHANGE_FAILED', message: '无法设置产物存储位置，请检查磁盘连接、剩余空间和文件夹权限后重试。', retryable: true });
    }
  }

  async cancelPendingDirectory(): Promise<ArtifactStorageLocation> {
    if (this.manifest.pendingDirectory) {
      await this.persist({ ...this.manifest, pendingDirectory: null });
    }
    this.migrationError = null;
    return this.location();
  }
}
