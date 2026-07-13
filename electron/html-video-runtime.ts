import { createHash, randomUUID } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { copyFile, link, lstat, mkdir, readdir, realpath, rename, rm, rmdir, stat, statfs, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { AppError } from '../src/shared/app-error';
import {
  buildHtmlVideoExportInput,
  type HtmlVideoExportInput,
  type HtmlVideoExportResult,
} from '../src/shared/html-video';
import type {
  HtmlVideoPreviewInput,
  HtmlVideoPreviewOutput,
  HtmlVideoRenderInput,
} from '../src/shared/html-video-runner';
import type {
  BgmItem,
  HtmlVideoCompositionSnapshot,
  HtmlVideoOutput,
  PipelineArtifact,
} from '../src/shared/types';

const defaultFps = 24;
const defaultMaxLongEdge = 1280;
const maxRenderFrames = 120_000;
const renderDiskReserveBytes = 64 * 1024 * 1024;
const estimatedJpegBytesPerPixel = 0.45;
const htmlVideoBgmExtensions = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac']);
const htmlVideoRuntimeStagingDirectoryName = '.html-video-staging';
const htmlVideoRuntimeStageNamePattern = /^(?:preview|render)-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const htmlVideoRuntimeCleanupStageNamePattern = /^cleanup-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const htmlVideoUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export const htmlVideoBgmMaxBytes = 256 * 1024 * 1024;
export const htmlVideoBgmDiskReserveBytes = 64 * 1024 * 1024;
export const htmlVideoMediaScheme = 'storydream-media';
const htmlVideoTaskIdPattern = /^[A-Za-z0-9_-]{1,256}$/u;

export interface HtmlVideoCanvas {
  width: number;
  height: number;
}

export interface HtmlVideoPreviewCaptureInput {
  workDir: string;
  htmlPath: string;
  outputPath: string;
  canvas: HtmlVideoCanvas;
  signal?: AbortSignal;
}

export interface HtmlVideoRuntimeRenderer {
  capturePreview(input: HtmlVideoPreviewCaptureInput): Promise<string>;
  render(input: HtmlVideoExportInput, options?: { signal?: AbortSignal }): Promise<HtmlVideoExportResult>;
}

export interface HtmlVideoMediaProbeResult {
  duration?: number;
  hasAudio?: boolean;
  hasVideo?: boolean;
  width?: number;
  height?: number;
}

export interface ElectronHtmlVideoRuntimeOptions {
  taskDirectory: HtmlVideoTaskDirectoryIdentity;
  taskTitle: string;
  fps?: number;
  maxLongEdge?: number;
  bgmPath?: string;
  signal?: AbortSignal;
  renderer: HtmlVideoRuntimeRenderer;
  probeMedia(workDir: string, path: string, signal?: AbortSignal): Promise<HtmlVideoMediaProbeResult>;
  getAvailableDiskBytes?(workDir: string): Promise<number>;
  publicationFileOperations?: Partial<HtmlVideoPublicationFileOperations>;
  stagingFileOperations?: Partial<HtmlVideoStagingFileOperations>;
}

export interface HtmlVideoPublicationFileOperations {
  lstat(path: string): Promise<BigIntStats>;
  unlink(path: string): Promise<void>;
}

export interface HtmlVideoStagingFileOperations {
  readdir(path: string): Promise<string[]>;
}

export interface ElectronHtmlVideoRuntime {
  measureAudioDuration(path: string, signal?: AbortSignal): Promise<number>;
  createPreviews(input: HtmlVideoPreviewInput): Promise<HtmlVideoPreviewOutput>;
  render(input: HtmlVideoRenderInput): Promise<HtmlVideoOutput>;
}

export interface HtmlVideoRenderPreflightInput {
  workDir: string;
  canvas: HtmlVideoCanvas;
  fps: number;
  durations: number[];
}

export interface HtmlVideoRenderPreflightDependencies {
  getAvailableDiskBytes?: (workDir: string) => Promise<number>;
}

export interface HtmlVideoDirectoryIdentity {
  readonly canonicalPath: string;
  readonly device: string;
  readonly inode: string;
}

export interface HtmlVideoTaskDirectoryIdentity {
  readonly trustedTaskRoot: HtmlVideoDirectoryIdentity;
  readonly workDir: HtmlVideoDirectoryIdentity;
}

export interface HtmlVideoMediaFileIdentity {
  readonly canonicalPath: string;
  readonly device: string;
  readonly inode: string;
  readonly size: string;
  readonly modifiedNs: string;
}

export interface HtmlVideoMediaResource {
  readonly path: string;
  readonly identity: HtmlVideoMediaFileIdentity;
}

export async function ensureHtmlVideoTaskWorkDir(
  trustedAppDataRoot: string,
  appDataDirectoryName: string,
  taskId: string,
): Promise<HtmlVideoTaskDirectoryIdentity> {
  const appDataName = validateHtmlVideoTaskId(appDataDirectoryName);
  const checkedTaskId = validateHtmlVideoTaskId(taskId);
  const trustedRoot = await realpath(trustedAppDataRoot);
  const trustedTaskRoot = await ensureTaskLocalDirectory(trustedRoot, [appDataName, 'tasks']);
  const workDir = await ensureTaskLocalDirectory(trustedTaskRoot, [checkedTaskId]);
  return Object.freeze({
    trustedTaskRoot: await pinHtmlVideoDirectory(trustedTaskRoot),
    workDir: await pinHtmlVideoDirectory(workDir),
  });
}

export interface PrepareHtmlVideoBgmOptions {
  taskDirectory: HtmlVideoTaskDirectoryIdentity;
  bgmId: string;
  bgmLibrary: BgmItem[];
  signal?: AbortSignal;
  probeMedia(workDir: string, path: string, signal?: AbortSignal): Promise<HtmlVideoMediaProbeResult>;
}

export interface PrepareHtmlVideoBgmDependencies {
  copyFile(source: string, destination: string): Promise<void>;
  statSourceFile(path: string): Promise<{ isFile(): boolean; size: number }>;
  statLocalBgmFile(path: string): Promise<BigIntStats>;
  getAvailableDiskBytes(workDir: string): Promise<number>;
}

interface HtmlVideoBgmDirectoryContext {
  taskDirectory: HtmlVideoTaskDirectoryIdentity;
  bgmDir: string;
}

interface HtmlVideoBgmFileIdentity {
  device: string;
  inode: string;
}

type HtmlVideoBgmCasRemoval = 'removed' | 'missing' | 'replaced';

interface HtmlVideoBgmLockEntry {
  waiters: HtmlVideoBgmLockWaiter[];
}

interface HtmlVideoBgmLockWaiter {
  resolve(release: () => void): void;
  reject(reason: unknown): void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

interface HtmlVideoRuntimeStage {
  taskDirectory: HtmlVideoTaskDirectoryIdentity;
  stagingRoot: HtmlVideoDirectoryIdentity;
  directory: HtmlVideoDirectoryIdentity;
}

interface HtmlVideoStagedFilePublication {
  stagedPath: string;
  destinationPath: string;
}

interface HtmlVideoPreparedFilePublication extends HtmlVideoStagedFilePublication {
  stagedIdentity: HtmlVideoPublishedFileIdentity;
  destinationDirectory: HtmlVideoDirectoryIdentity;
  backup?: {
    path: string;
    identity: HtmlVideoPublishedFileIdentity;
  };
  published: boolean;
}

interface HtmlVideoPublishedFileIdentity {
  device: string;
  inode: string;
  size: string;
}

const htmlVideoBgmLocks = new Map<string, HtmlVideoBgmLockEntry>();
const activeHtmlVideoRuntimeStages = new Set<string>();
const htmlVideoRuntimeStageMaintenanceTails = new Map<string, Promise<void>>();
const htmlVideoPublicationTails = new Map<string, Promise<void>>();

export async function prepareHtmlVideoBgm(
  options: PrepareHtmlVideoBgmOptions,
  dependencies: Partial<PrepareHtmlVideoBgmDependencies> = {},
): Promise<string | undefined> {
  const bgmId = options.bgmId.trim();
  if (!bgmId) return undefined;
  const matches = options.bgmLibrary.filter((item) => item.id === bgmId);
  if (!matches.length) {
    throw new AppError('HTML_VIDEO_BGM_NOT_FOUND', '所选背景音乐不存在或已被移除。');
  }
  if (matches.length !== 1) {
    throw new AppError('HTML_VIDEO_BGM_ID_DUPLICATE', '背景音乐配置包含重复 ID。');
  }
  const selected = matches[0];
  const sourcePath = selected.path.trim();
  const extension = extname(sourcePath).toLowerCase();
  if (!htmlVideoBgmExtensions.has(extension)) {
    throw new AppError('HTML_VIDEO_BGM_FORMAT_INVALID', '所选背景音乐格式不受支持。');
  }
  const cacheKey = createHash('sha256').update(`${bgmId}\0${sourcePath}`).digest('hex');
  const lockKey = JSON.stringify([
    options.taskDirectory.workDir.canonicalPath,
    options.taskDirectory.workDir.device,
    options.taskDirectory.workDir.inode,
    cacheKey,
  ]);
  return withHtmlVideoBgmLock(lockKey, options.signal, () => prepareHtmlVideoBgmLocked(
    options,
    dependencies,
    sourcePath,
    extension,
    cacheKey,
  ));
}

async function prepareHtmlVideoBgmLocked(
  options: PrepareHtmlVideoBgmOptions,
  dependencies: Partial<PrepareHtmlVideoBgmDependencies>,
  sourcePath: string,
  extension: string,
  cacheKey: string,
): Promise<string> {
  throwIfAborted(options.signal);
  const { workDir } = await validateHtmlVideoTaskDirectory(options.taskDirectory);
  const bgmDir = await ensureTaskLocalDirectory(workDir, ['inputs', 'bgm']);
  const directoryContext: HtmlVideoBgmDirectoryContext = {
    taskDirectory: options.taskDirectory,
    bgmDir,
  };
  const bgmPath = join(bgmDir, `${cacheKey}${extension}`);

  let cachedStat: BigIntStats | undefined;
  try {
    await revalidateHtmlVideoBgmDirectory(directoryContext);
    cachedStat = await (dependencies.statLocalBgmFile ?? statHtmlVideoBgmLocalFile)(bgmPath);
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
  if (cachedStat) {
    const cachedIdentity = htmlVideoBgmFileIdentity(cachedStat);
    if (cachedStat.isFile() && cachedStat.size > 0n) {
      assertHtmlVideoBgmSize(cachedStat.size);
      let cachedPath: string;
      try {
        await revalidateHtmlVideoBgmDirectory(directoryContext);
        cachedPath = await taskLocalFile(workDir, bgmPath);
      } catch (error) {
        const replacement = await removeInvalidHtmlVideoBgmCache(
          options,
          directoryContext,
          workDir,
          bgmPath,
          cachedIdentity,
        );
        if (replacement) return replacement;
        if (!(error instanceof AppError)) throw error;
        cachedPath = '';
      }
      if (cachedPath) {
        try {
          await probeHtmlVideoBgm(options, workDir, cachedPath);
          return cachedPath;
        } catch (error) {
          if (!(error instanceof AppError) || error.code !== 'HTML_VIDEO_BGM_MEDIA_INVALID') throw error;
          const replacement = await removeInvalidHtmlVideoBgmCache(
            options,
            directoryContext,
            workDir,
            bgmPath,
            cachedIdentity,
          );
          if (replacement) return replacement;
        }
      }
    } else {
      const replacement = await removeInvalidHtmlVideoBgmCache(
        options,
        directoryContext,
        workDir,
        bgmPath,
        cachedIdentity,
      );
      if (replacement) return replacement;
    }
  }

  let sourceFile: string;
  let sourceSize: number;
  try {
    sourceFile = await realpath(sourcePath);
    const sourceStat = await (dependencies.statSourceFile ?? stat)(sourceFile);
    if (!sourceStat.isFile() || sourceStat.size <= 0) throw invalidHtmlVideoBgmSource();
    assertHtmlVideoBgmSize(sourceStat.size);
    sourceSize = sourceStat.size;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw invalidHtmlVideoBgmSource();
  }

  throwIfAborted(options.signal);
  const availableBytes = await (dependencies.getAvailableDiskBytes ?? availableDiskBytes)(workDir);
  const requiredBytes = sourceSize + htmlVideoBgmDiskReserveBytes;
  if (!Number.isFinite(availableBytes) || availableBytes < requiredBytes) {
    throw new AppError(
      'HTML_VIDEO_BGM_DISK_SPACE_LOW',
      `磁盘空间不足，复制背景音乐至少需要 ${formatMegabytes(requiredBytes)} MB 可用空间。`,
      true,
    );
  }

  const temporaryPath = join(bgmDir, `${cacheKey}.${randomUUID()}.tmp${extension}`);
  try {
    throwIfAborted(options.signal);
    await revalidateHtmlVideoBgmDirectory(directoryContext);
    try {
      await (dependencies.copyFile ?? copyFile)(sourceFile, temporaryPath);
    } catch (error) {
      if (isHtmlVideoBgmSourceCopyError(error, sourceFile)) throw invalidHtmlVideoBgmSource();
      throw error;
    }
    await revalidateHtmlVideoBgmDirectory(directoryContext);
    const temporaryStat = await (dependencies.statLocalBgmFile ?? statHtmlVideoBgmLocalFile)(temporaryPath);
    if (!temporaryStat.isFile() || temporaryStat.size <= 0n) throw invalidHtmlVideoBgmSource();
    assertHtmlVideoBgmSize(temporaryStat.size);
    throwIfAborted(options.signal);
    const localTemporaryPath = await taskLocalFile(workDir, temporaryPath);
    await revalidateHtmlVideoBgmDirectory(directoryContext);
    await probeHtmlVideoBgm(options, workDir, localTemporaryPath);
    throwIfAborted(options.signal);
    await revalidateHtmlVideoBgmDirectory(directoryContext);
    try {
      await link(localTemporaryPath, bgmPath);
    } catch (error) {
      if (!isExistingFileError(error)) throw error;
      await revalidateHtmlVideoBgmDirectory(directoryContext);
      const existingPath = await taskLocalFile(workDir, bgmPath);
      await probeHtmlVideoBgm(options, workDir, existingPath);
      return existingPath;
    }
    await revalidateHtmlVideoBgmDirectory(directoryContext);
    return taskLocalFile(workDir, bgmPath);
  } finally {
    await removeHtmlVideoBgmTemporaryFile(directoryContext, temporaryPath).catch(() => undefined);
  }
}

async function withHtmlVideoBgmLock<T>(
  key: string,
  signal: AbortSignal | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  const release = await acquireHtmlVideoBgmLock(key, signal);
  try {
    throwIfAborted(signal);
    return await operation();
  } finally {
    release();
  }
}

function acquireHtmlVideoBgmLock(key: string, signal: AbortSignal | undefined): Promise<() => void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  const existing = htmlVideoBgmLocks.get(key);
  if (!existing) {
    const entry: HtmlVideoBgmLockEntry = { waiters: [] };
    htmlVideoBgmLocks.set(key, entry);
    return Promise.resolve(createHtmlVideoBgmLockRelease(key, entry));
  }

  return new Promise<() => void>((resolveLock, rejectLock) => {
    const waiter: HtmlVideoBgmLockWaiter = {
      resolve: resolveLock,
      reject: rejectLock,
      signal,
    };
    existing.waiters.push(waiter);
    if (!signal) return;
    const onAbort = () => {
      const index = existing.waiters.indexOf(waiter);
      if (index < 0) return;
      existing.waiters.splice(index, 1);
      signal.removeEventListener('abort', onAbort);
      waiter.onAbort = undefined;
      rejectLock(signal.reason);
    };
    waiter.onAbort = onAbort;
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function createHtmlVideoBgmLockRelease(
  key: string,
  entry: HtmlVideoBgmLockEntry,
): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    while (entry.waiters.length) {
      const waiter = entry.waiters.shift()!;
      if (waiter.signal && waiter.onAbort) {
        waiter.signal.removeEventListener('abort', waiter.onAbort);
        waiter.onAbort = undefined;
      }
      if (waiter.signal?.aborted) {
        waiter.reject(waiter.signal.reason);
        continue;
      }
      waiter.resolve(createHtmlVideoBgmLockRelease(key, entry));
      return;
    }
    if (htmlVideoBgmLocks.get(key) === entry) htmlVideoBgmLocks.delete(key);
  };
}

function invalidHtmlVideoBgmSource(): AppError {
  return new AppError('HTML_VIDEO_BGM_SOURCE_INVALID', '所选背景音乐文件为空或不可用。');
}

function statHtmlVideoBgmLocalFile(path: string): Promise<BigIntStats> {
  return lstat(path, { bigint: true });
}

function assertHtmlVideoBgmSize(size: number | bigint): void {
  const value = typeof size === 'bigint' ? size : BigInt(Math.ceil(size));
  if (value > BigInt(htmlVideoBgmMaxBytes)) {
    throw new AppError(
      'HTML_VIDEO_BGM_SIZE_EXCEEDED',
      `所选背景音乐超过 ${formatMegabytes(htmlVideoBgmMaxBytes)} MB 上限。`,
    );
  }
}

async function probeHtmlVideoBgm(
  options: PrepareHtmlVideoBgmOptions,
  workDir: string,
  bgmPath: string,
): Promise<void> {
  throwIfAborted(options.signal);
  const probe = await options.probeMedia(workDir, bgmPath, options.signal);
  throwIfAborted(options.signal);
  if (
    probe.hasAudio !== true
    || typeof probe.duration !== 'number'
    || !Number.isFinite(probe.duration)
    || probe.duration <= 0
  ) {
    throw new AppError('HTML_VIDEO_BGM_MEDIA_INVALID', '所选背景音乐未通过音频校验。');
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function isExistingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST');
}

function isHtmlVideoBgmSourceCopyError(error: unknown, sourcePath: string): boolean {
  if (!error || typeof error !== 'object' || (error as { name?: unknown }).name === 'AbortError') return false;
  const candidate = error as { code?: unknown; path?: unknown };
  if (candidate.code !== 'ENOENT' && candidate.code !== 'EACCES' && candidate.code !== 'EPERM') return false;
  return typeof candidate.path === 'string' && !relative(resolve(sourcePath), resolve(candidate.path));
}

async function revalidateHtmlVideoBgmDirectory(context: HtmlVideoBgmDirectoryContext): Promise<string> {
  const { workDir } = await validateHtmlVideoTaskDirectory(context.taskDirectory);
  const bgmDir = await resolveTaskLocalDirectoryFromPinnedRoot(workDir, context.bgmDir);
  if (relative(context.bgmDir, bgmDir)) throw invalidHtmlVideoMediaPath();
  await validateHtmlVideoTaskDirectory(context.taskDirectory);
  return bgmDir;
}

function htmlVideoBgmFileIdentity(value: Pick<BigIntStats, 'dev' | 'ino'>): HtmlVideoBgmFileIdentity {
  return {
    device: value.dev.toString(),
    inode: value.ino.toString(),
  };
}

function isSameHtmlVideoBgmFile(
  value: Pick<BigIntStats, 'dev' | 'ino'>,
  identity: HtmlVideoBgmFileIdentity,
): boolean {
  return value.dev.toString() === identity.device && value.ino.toString() === identity.inode;
}

async function removeInvalidHtmlVideoBgmCache(
  options: PrepareHtmlVideoBgmOptions,
  context: HtmlVideoBgmDirectoryContext,
  workDir: string,
  path: string,
  expectedIdentity: HtmlVideoBgmFileIdentity,
): Promise<string | undefined> {
  const removal = await removeHtmlVideoBgmCacheIfIdentity(context, path, expectedIdentity);
  if (removal !== 'replaced') return undefined;
  return probeReplacedHtmlVideoBgmCache(options, context, workDir, path);
}

async function removeHtmlVideoBgmCacheIfIdentity(
  context: HtmlVideoBgmDirectoryContext,
  path: string,
  expectedIdentity: HtmlVideoBgmFileIdentity,
): Promise<HtmlVideoBgmCasRemoval> {
  const bgmDir = await revalidateHtmlVideoBgmDirectory(context);
  if (relative(context.bgmDir, dirname(resolve(path)))) throw invalidHtmlVideoMediaPath();
  const currentPath = join(bgmDir, basename(path));
  let current: BigIntStats;
  try {
    current = await lstat(currentPath, { bigint: true });
  } catch (error) {
    if (isMissingFileError(error)) return 'missing';
    throw error;
  }
  if (!isSameHtmlVideoBgmFile(current, expectedIdentity)) return 'replaced';
  await rm(currentPath, { force: true });
  return 'removed';
}

async function probeReplacedHtmlVideoBgmCache(
  options: PrepareHtmlVideoBgmOptions,
  context: HtmlVideoBgmDirectoryContext,
  workDir: string,
  path: string,
): Promise<string | undefined> {
  throwIfAborted(options.signal);
  const bgmDir = await revalidateHtmlVideoBgmDirectory(context);
  if (relative(context.bgmDir, dirname(resolve(path)))) throw invalidHtmlVideoMediaPath();
  const currentPath = join(bgmDir, basename(path));
  let before: BigIntStats;
  try {
    before = await lstat(currentPath, { bigint: true });
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
  if (!before.isFile() || before.size <= 0n) throw htmlVideoBgmCacheConflict();
  assertHtmlVideoBgmSize(before.size);

  let canonicalPath: string;
  try {
    canonicalPath = await taskLocalFile(workDir, currentPath);
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    if (error instanceof AppError) throw htmlVideoBgmCacheConflict();
    throw error;
  }
  try {
    await probeHtmlVideoBgm(options, workDir, canonicalPath);
  } catch (error) {
    if (error instanceof AppError && error.code === 'HTML_VIDEO_BGM_MEDIA_INVALID') {
      throw htmlVideoBgmCacheConflict();
    }
    throw error;
  }

  await revalidateHtmlVideoBgmDirectory(context);
  let after: BigIntStats;
  try {
    after = await lstat(currentPath, { bigint: true });
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
  if (!isSameHtmlVideoBgmFile(after, htmlVideoBgmFileIdentity(before))) {
    throw htmlVideoBgmCacheConflict();
  }
  assertHtmlVideoBgmSize(after.size);
  return canonicalPath;
}

function htmlVideoBgmCacheConflict(): AppError {
  return new AppError(
    'HTML_VIDEO_BGM_CACHE_CONFLICT',
    '背景音乐缓存已被其他进程更新，请重试。',
    true,
  );
}

async function removeHtmlVideoBgmTemporaryFile(context: HtmlVideoBgmDirectoryContext, path: string): Promise<void> {
  const bgmDir = await revalidateHtmlVideoBgmDirectory(context);
  if (relative(context.bgmDir, dirname(resolve(path)))) throw invalidHtmlVideoMediaPath();
  await rm(join(bgmDir, basename(path)), { force: true });
}

async function ensureTaskLocalDirectory(workDir: string, segments: string[]): Promise<string> {
  const root = await realpath(workDir);
  let parent = root;
  for (const segment of segments) {
    const candidate = join(parent, segment);
    let value: Awaited<ReturnType<typeof lstat>>;
    try {
      value = await lstat(candidate);
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
      try {
        await mkdir(candidate);
      } catch (createError) {
        if (!isExistingFileError(createError)) throw createError;
      }
      value = await lstat(candidate);
    }
    if (!value.isDirectory() || value.isSymbolicLink()) throw invalidHtmlVideoMediaPath();
    let actual: string;
    try {
      actual = await realpath(candidate);
    } catch {
      throw invalidHtmlVideoMediaPath();
    }
    assertTaskLocalPath(root, actual);
    parent = actual;
  }
  return parent;
}

async function pinHtmlVideoDirectory(path: string): Promise<HtmlVideoDirectoryIdentity> {
  try {
    const lexicalPath = resolve(path);
    const lexicalValue = await lstat(lexicalPath, { bigint: true });
    if (!lexicalValue.isDirectory() || lexicalValue.isSymbolicLink()) throw invalidHtmlVideoMediaPath();
    const canonicalPath = await realpath(lexicalPath);
    const canonicalValue = await lstat(canonicalPath, { bigint: true });
    if (
      !canonicalValue.isDirectory()
      || canonicalValue.isSymbolicLink()
      || lexicalValue.dev !== canonicalValue.dev
      || lexicalValue.ino !== canonicalValue.ino
    ) {
      throw invalidHtmlVideoMediaPath();
    }
    return Object.freeze({
      canonicalPath,
      device: canonicalValue.dev.toString(),
      inode: canonicalValue.ino.toString(),
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw invalidHtmlVideoMediaPath();
  }
}

async function validateHtmlVideoDirectoryIdentity(identity: HtmlVideoDirectoryIdentity): Promise<string> {
  try {
    const value = await lstat(identity.canonicalPath, { bigint: true });
    if (
      !value.isDirectory()
      || value.isSymbolicLink()
      || value.dev.toString() !== identity.device
      || value.ino.toString() !== identity.inode
    ) {
      throw invalidHtmlVideoMediaPath();
    }
    const actual = await realpath(identity.canonicalPath);
    if (relative(identity.canonicalPath, actual)) throw invalidHtmlVideoMediaPath();
    return actual;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw invalidHtmlVideoMediaPath();
  }
}

async function validateHtmlVideoTaskDirectory(
  identity: HtmlVideoTaskDirectoryIdentity,
): Promise<{ trustedTaskRoot: string; workDir: string }> {
  const trustedTaskRoot = await validateHtmlVideoDirectoryIdentity(identity.trustedTaskRoot);
  const workDir = await resolveTaskLocalDirectoryFromPinnedRoot(trustedTaskRoot, identity.workDir.canonicalPath);
  if (relative(identity.workDir.canonicalPath, workDir)) throw invalidHtmlVideoMediaPath();
  await Promise.all([
    validateHtmlVideoDirectoryIdentity(identity.trustedTaskRoot),
    validateHtmlVideoDirectoryIdentity(identity.workDir),
  ]);
  return { trustedTaskRoot, workDir };
}

async function resolveTaskLocalDirectoryFromPinnedRoot(trustedRoot: string, path: string): Promise<string> {
  const root = resolve(trustedRoot);
  const candidate = resolve(path);
  assertTaskLocalPath(root, candidate);
  const segments = relative(root, candidate).split(/[\\/]+/u).filter(Boolean);
  let parent = root;
  for (const segment of segments) {
    const child = join(parent, segment);
    let value: Awaited<ReturnType<typeof lstat>>;
    try {
      value = await lstat(child);
    } catch {
      throw invalidHtmlVideoMediaPath();
    }
    if (!value.isDirectory() || value.isSymbolicLink()) throw invalidHtmlVideoMediaPath();
    let actual: string;
    try {
      actual = await realpath(child);
    } catch {
      throw invalidHtmlVideoMediaPath();
    }
    assertTaskLocalPath(root, actual);
    parent = actual;
  }
  return parent;
}

export async function createHtmlVideoMediaUrl(
  taskId: string,
  taskDirectory: HtmlVideoTaskDirectoryIdentity,
  path: string,
): Promise<string> {
  const checkedTaskId = validateHtmlVideoTaskId(taskId);
  const { workDir } = await validateHtmlVideoTaskDirectory(taskDirectory);
  const mediaPath = await taskLocalFile(workDir, path);
  await validateHtmlVideoTaskDirectory(taskDirectory);
  const mediaFromRoot = relative(workDir, mediaPath);
  const encodedPath = mediaFromRoot
    .split(/[\\/]+/u)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${htmlVideoMediaScheme}://task/${encodeURIComponent(checkedTaskId)}/${encodedPath}`;
}

export async function resolveHtmlVideoMediaUrl(
  value: string,
  resolveTaskDirectory: (
    taskId: string,
  ) => HtmlVideoTaskDirectoryIdentity | Promise<HtmlVideoTaskDirectoryIdentity>,
): Promise<string> {
  return (await resolveHtmlVideoMediaResource(value, resolveTaskDirectory)).path;
}

export async function fetchHtmlVideoMediaResponse(
  value: string,
  resolveTaskDirectory: (
    taskId: string,
  ) => HtmlVideoTaskDirectoryIdentity | Promise<HtmlVideoTaskDirectoryIdentity>,
  fetchMedia: (path: string) => Promise<Response>,
): Promise<Response> {
  let pinnedTaskId: string | null = null;
  let pinnedTaskDirectory: Promise<HtmlVideoTaskDirectoryIdentity> | null = null;
  const resolvePinnedTaskDirectory = (taskId: string): Promise<HtmlVideoTaskDirectoryIdentity> => {
    if (pinnedTaskId !== null && pinnedTaskId !== taskId) throw invalidHtmlVideoMediaPath();
    if (!pinnedTaskDirectory) {
      pinnedTaskId = taskId;
      pinnedTaskDirectory = Promise.resolve().then(() => resolveTaskDirectory(taskId));
    }
    return pinnedTaskDirectory;
  };

  const resource = await resolveHtmlVideoMediaResource(value, resolvePinnedTaskDirectory);
  const response = await fetchMedia(resource.path);
  try {
    await resolveHtmlVideoMediaResource(value, resolvePinnedTaskDirectory, resource.identity);
    return response;
  } catch (error) {
    await response.body?.cancel().catch(() => undefined);
    throw error;
  }
}

async function resolveHtmlVideoMediaResource(
  value: string,
  resolveTaskDirectory: (
    taskId: string,
  ) => HtmlVideoTaskDirectoryIdentity | Promise<HtmlVideoTaskDirectoryIdentity>,
  expectedIdentity?: HtmlVideoMediaFileIdentity,
): Promise<HtmlVideoMediaResource> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidHtmlVideoMediaPath();
  }
  if (url.protocol !== `${htmlVideoMediaScheme}:` || url.hostname !== 'task' || url.search || url.hash) {
    throw invalidHtmlVideoMediaPath();
  }
  const segments = url.pathname.split('/').filter(Boolean).map(decodeHtmlVideoMediaSegment);
  const taskId = validateHtmlVideoTaskId(segments.shift() ?? '');
  if (!segments.length) throw invalidHtmlVideoMediaPath();
  const taskDirectory = await resolveTaskDirectory(taskId);
  const { workDir } = await validateHtmlVideoTaskDirectory(taskDirectory);
  const resource = await pinHtmlVideoMediaFile(workDir, join(...segments));
  await validateHtmlVideoTaskDirectory(taskDirectory);
  if (expectedIdentity && !isSameHtmlVideoMediaFile(resource.identity, expectedIdentity)) {
    throw invalidHtmlVideoMediaPath();
  }
  return resource;
}

export function htmlVideoCanvasForRatio(ratio: string | undefined, maxLongEdge = defaultMaxLongEdge): HtmlVideoCanvas {
  const longEdge = Math.max(320, Math.min(1920, Math.round(Number.isFinite(maxLongEdge) ? maxLongEdge : defaultMaxLongEdge)));
  const normalized = ratio === '16:9' || ratio === '1:1' || ratio === '4:3' ? ratio : '9:16';
  if (normalized === '16:9') return { width: longEdge, height: Math.round(longEdge * 9 / 16) };
  if (normalized === '1:1') return { width: longEdge, height: longEdge };
  if (normalized === '4:3') return { width: longEdge, height: Math.round(longEdge * 3 / 4) };
  return { width: Math.round(longEdge * 9 / 16), height: longEdge };
}

export async function preflightHtmlVideoRender(
  input: HtmlVideoRenderPreflightInput,
  dependencies: HtmlVideoRenderPreflightDependencies = {},
): Promise<void> {
  const fps = clampFps(input.fps);
  if (!input.durations.length || input.durations.some((duration) => !Number.isFinite(duration) || duration <= 0)) {
    throw new AppError('HTML_VIDEO_DURATION_INVALID', 'HTML 视频包含无效的场景时长。');
  }
  const totalFrames = input.durations.reduce((total, duration) => total + Math.max(1, Math.ceil(duration * fps)), 0);
  if (totalFrames > maxRenderFrames) {
    throw new AppError('HTML_VIDEO_FRAME_BUDGET_EXCEEDED', 'HTML 视频总帧数过多，请减少场景、时长或帧率。');
  }
  const requiredBytes = Math.ceil(
    totalFrames * input.canvas.width * input.canvas.height * estimatedJpegBytesPerPixel,
  ) + renderDiskReserveBytes;
  const getAvailableDiskBytes = dependencies.getAvailableDiskBytes ?? availableDiskBytes;
  const availableBytes = await getAvailableDiskBytes(input.workDir);
  if (!Number.isFinite(availableBytes) || availableBytes < requiredBytes) {
    throw new AppError(
      'HTML_VIDEO_DISK_SPACE_LOW',
      `磁盘空间不足，HTML 视频渲染至少需要 ${formatMegabytes(requiredBytes)} MB 可用空间。`,
      true,
    );
  }
}

async function withHtmlVideoRuntimeStage<T>(
  taskDirectory: HtmlVideoTaskDirectoryIdentity,
  kind: 'preview' | 'render',
  operation: (stage: HtmlVideoRuntimeStage, stageDir: string) => Promise<T>,
  fileOperations: Partial<HtmlVideoStagingFileOperations> = {},
): Promise<T> {
  const stage = await createHtmlVideoRuntimeStage(taskDirectory, kind, fileOperations);
  let primaryError: unknown;
  try {
    return await operation(stage, await validateHtmlVideoRuntimeStage(stage));
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await removeHtmlVideoRuntimeStage(stage);
    } catch (cleanupError) {
      if (primaryError !== undefined) {
        throw new AggregateError(
          [primaryError, cleanupError],
          'HTML video runtime operation and staging cleanup both failed.',
        );
      }
      throw cleanupError;
    } finally {
      activeHtmlVideoRuntimeStages.delete(htmlVideoDirectoryIdentityKey(stage.directory));
    }
  }
}

async function createHtmlVideoRuntimeStage(
  taskDirectory: HtmlVideoTaskDirectoryIdentity,
  kind: 'preview' | 'render',
  fileOperations: Partial<HtmlVideoStagingFileOperations>,
): Promise<HtmlVideoRuntimeStage> {
  const { workDir } = await validateHtmlVideoTaskDirectory(taskDirectory);
  const stagingRootPath = await ensureTaskLocalDirectory(workDir, [htmlVideoRuntimeStagingDirectoryName]);
  const stagingRoot = await pinHtmlVideoDirectory(stagingRootPath);
  return withHtmlVideoRuntimeStageMaintenanceLock(
    htmlVideoDirectoryIdentityKey(stagingRoot),
    async () => {
      await Promise.all([
        validateHtmlVideoTaskDirectory(taskDirectory),
        validateHtmlVideoDirectoryIdentity(stagingRoot),
      ]);
      await cleanupStaleHtmlVideoRuntimeStages(stagingRoot, fileOperations);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const candidate = join(stagingRoot.canonicalPath, `${kind}-${randomUUID()}`);
        try {
          await mkdir(candidate);
        } catch (error) {
          if (isExistingFileError(error)) continue;
          throw error;
        }
        try {
          const directory = await pinHtmlVideoDirectory(candidate);
          const stage = { taskDirectory, stagingRoot, directory };
          activeHtmlVideoRuntimeStages.add(htmlVideoDirectoryIdentityKey(directory));
          try {
            await validateHtmlVideoRuntimeStage(stage);
            return stage;
          } catch (error) {
            activeHtmlVideoRuntimeStages.delete(htmlVideoDirectoryIdentityKey(directory));
            throw error;
          }
        } catch (error) {
          await rm(candidate, { recursive: true, force: true }).catch(() => undefined);
          throw error;
        }
      }
      throw new AppError('HTML_VIDEO_STAGE_CREATE_FAILED', '无法创建 HTML 视频临时工作目录，请重试。', true);
    },
  );
}

async function withHtmlVideoRuntimeStageMaintenanceLock<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = htmlVideoRuntimeStageMaintenanceTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  const tail = previous.catch(() => undefined).then(() => gate);
  htmlVideoRuntimeStageMaintenanceTails.set(key, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    void tail.finally(() => {
      if (htmlVideoRuntimeStageMaintenanceTails.get(key) === tail) {
        htmlVideoRuntimeStageMaintenanceTails.delete(key);
      }
    });
  }
}

async function cleanupStaleHtmlVideoRuntimeStages(
  stagingRoot: HtmlVideoDirectoryIdentity,
  fileOperations: Partial<HtmlVideoStagingFileOperations>,
): Promise<void> {
  await validateHtmlVideoDirectoryIdentity(stagingRoot);
  const names = await stagingReaddir(fileOperations, stagingRoot.canonicalPath);
  for (const name of names) {
    const isRuntimeStage = htmlVideoRuntimeStageNamePattern.test(name);
    const isCleanupStage = htmlVideoRuntimeCleanupStageNamePattern.test(name);
    if (!isRuntimeStage && !isCleanupStage) continue;
    await validateHtmlVideoDirectoryIdentity(stagingRoot);
    const path = join(stagingRoot.canonicalPath, name);
    let value: BigIntStats;
    try {
      value = await lstat(path, { bigint: true });
    } catch (error) {
      if (isMissingFileError(error)) continue;
      throw error;
    }
    if (value.isDirectory() && !value.isSymbolicLink()) {
      if (isRuntimeStage && activeHtmlVideoRuntimeStages.has(htmlVideoBigIntDirectoryKey(value))) continue;
      try {
        const cleanup = isRuntimeStage
          ? await moveHtmlVideoStaleStageToCleanupPath(stagingRoot, path, value)
          : { path, value };
        await removeHtmlVideoStaleStageTree(stagingRoot, cleanup.path, cleanup.value, fileOperations);
      } catch (error) {
        if (error instanceof AppError && error.code === 'HTML_VIDEO_STAGE_CLEANUP_CONFLICT') continue;
        throw error;
      }
      continue;
    }
    await unlink(path);
  }
  await validateHtmlVideoDirectoryIdentity(stagingRoot);
}

async function removeHtmlVideoStaleStageTree(
  stagingRoot: HtmlVideoDirectoryIdentity,
  path: string,
  expected: Pick<BigIntStats, 'dev' | 'ino'>,
  fileOperations: Partial<HtmlVideoStagingFileOperations>,
): Promise<void> {
  await validateHtmlVideoStaleStageDirectory(stagingRoot, path, expected);
  const names = await stagingReaddir(fileOperations, path);
  for (const name of names) {
    await validateHtmlVideoStaleStageDirectory(stagingRoot, path, expected);
    const childPath = join(path, name);
    let child: BigIntStats;
    try {
      child = await lstat(childPath, { bigint: true });
    } catch (error) {
      if (isMissingFileError(error)) continue;
      throw error;
    }
    if (child.isDirectory() && !child.isSymbolicLink()) {
      await removeHtmlVideoStaleStageTree(stagingRoot, childPath, child, fileOperations);
    } else {
      await validateHtmlVideoStaleStageDirectory(stagingRoot, path, expected);
      await unlink(childPath);
    }
  }
  await validateHtmlVideoStaleStageDirectory(stagingRoot, path, expected);
  await rmdir(path);
}

async function moveHtmlVideoStaleStageToCleanupPath(
  stagingRoot: HtmlVideoDirectoryIdentity,
  path: string,
  expected: Pick<BigIntStats, 'dev' | 'ino'>,
): Promise<{ path: string; value: BigIntStats }> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const cleanupPath = join(stagingRoot.canonicalPath, `cleanup-${randomUUID()}`);
    try {
      await lstat(cleanupPath);
      continue;
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
    await validateHtmlVideoStaleStageDirectory(stagingRoot, path, expected);
    await rename(path, cleanupPath);
    const value = await lstat(cleanupPath, { bigint: true });
    if (!isSameHtmlVideoDirectory(value, expected)) throw htmlVideoStageCleanupConflict();
    return { path: cleanupPath, value };
  }
  throw htmlVideoStageCleanupConflict();
}

async function validateHtmlVideoStaleStageDirectory(
  stagingRoot: HtmlVideoDirectoryIdentity,
  path: string,
  expected: Pick<BigIntStats, 'dev' | 'ino'>,
): Promise<void> {
  await validateHtmlVideoDirectoryIdentity(stagingRoot);
  let current: BigIntStats;
  try {
    current = await lstat(path, { bigint: true });
  } catch (error) {
    if (isMissingFileError(error)) throw htmlVideoStageCleanupConflict();
    throw error;
  }
  if (!current.isDirectory() || current.isSymbolicLink() || !isSameHtmlVideoDirectory(current, expected)) {
    throw htmlVideoStageCleanupConflict();
  }
}

function isSameHtmlVideoDirectory(
  value: Pick<BigIntStats, 'dev' | 'ino'>,
  expected: Pick<BigIntStats, 'dev' | 'ino'>,
): boolean {
  return value.dev === expected.dev && value.ino === expected.ino;
}

function htmlVideoStageCleanupConflict(): AppError {
  return new AppError(
    'HTML_VIDEO_STAGE_CLEANUP_CONFLICT',
    'HTML 视频临时目录在清理期间发生变化，已跳过该目录。',
    true,
  );
}

function stagingReaddir(
  fileOperations: Partial<HtmlVideoStagingFileOperations>,
  path: string,
): Promise<string[]> {
  return fileOperations.readdir?.(path) ?? readdir(path);
}

function htmlVideoDirectoryIdentityKey(identity: HtmlVideoDirectoryIdentity): string {
  return `${identity.device}:${identity.inode}`;
}

function htmlVideoBigIntDirectoryKey(value: Pick<BigIntStats, 'dev' | 'ino'>): string {
  return `${value.dev.toString()}:${value.ino.toString()}`;
}

async function validateHtmlVideoRuntimeStage(stage: HtmlVideoRuntimeStage): Promise<string> {
  const { workDir } = await validateHtmlVideoTaskDirectory(stage.taskDirectory);
  const stagingRoot = await resolveTaskLocalDirectoryFromPinnedRoot(workDir, stage.stagingRoot.canonicalPath);
  if (relative(stage.stagingRoot.canonicalPath, stagingRoot)) throw invalidHtmlVideoMediaPath();
  const stageDir = await resolveTaskLocalDirectoryFromPinnedRoot(stagingRoot, stage.directory.canonicalPath);
  if (relative(stage.directory.canonicalPath, stageDir)) throw invalidHtmlVideoMediaPath();
  await Promise.all([
    validateHtmlVideoDirectoryIdentity(stage.stagingRoot),
    validateHtmlVideoDirectoryIdentity(stage.directory),
    validateHtmlVideoTaskDirectory(stage.taskDirectory),
  ]);
  return stageDir;
}

async function removeHtmlVideoRuntimeStage(stage: HtmlVideoRuntimeStage): Promise<void> {
  let stageDir: string;
  try {
    stageDir = await validateHtmlVideoRuntimeStage(stage);
  } catch (error) {
    if (error instanceof AppError && error.code === 'HTML_VIDEO_MEDIA_PATH_INVALID') return;
    throw error;
  }
  await rm(stageDir, { recursive: true, force: true });
}

async function publishHtmlVideoStagedFiles(
  taskDirectory: HtmlVideoTaskDirectoryIdentity,
  stage: HtmlVideoRuntimeStage,
  publications: HtmlVideoStagedFilePublication[],
  fileOperations: Partial<HtmlVideoPublicationFileOperations> = {},
): Promise<string[]> {
  const { workDir } = await validateHtmlVideoTaskDirectory(taskDirectory);
  const stageDir = await validateHtmlVideoRuntimeStage(stage);
  const prepared: HtmlVideoPreparedFilePublication[] = [];
  for (const publication of publications) {
    const stagedPath = await taskLocalFile(stageDir, publication.stagedPath);
    const stagedStat = await publicationLstat(fileOperations, stagedPath);
    if (!stagedStat.isFile() || stagedStat.isSymbolicLink() || stagedStat.size <= 0n) {
      throw new AppError('HTML_VIDEO_OUTPUT_INVALID', 'HTML 视频临时产物为空或不可用。', true);
    }
    const destinationPath = resolve(publication.destinationPath);
    assertTaskLocalPath(workDir, destinationPath);
    const requestedParent = dirname(destinationPath);
    const destinationParent = relative(workDir, requestedParent)
      ? await resolveTaskLocalDirectoryFromPinnedRoot(workDir, requestedParent)
      : workDir;
    if (relative(dirname(destinationPath), destinationParent)) throw invalidHtmlVideoMediaPath();
    prepared.push({
      stagedPath,
      destinationPath: join(destinationParent, basename(destinationPath)),
      stagedIdentity: htmlVideoPublishedFileIdentity(stagedStat),
      destinationDirectory: await pinHtmlVideoDirectory(destinationParent),
      published: false,
    });
  }

  return withHtmlVideoPublicationLock(
    htmlVideoDirectoryIdentityKey(taskDirectory.workDir),
    async () => {
      for (const publication of prepared) {
        await recoverHtmlVideoPublicationQuarantines(publication, fileOperations);
      }

      let publishedPaths: string[];
      try {
        for (const publication of prepared) {
          await Promise.all([
            validateHtmlVideoTaskDirectory(taskDirectory),
            validateHtmlVideoRuntimeStage(stage),
            validateHtmlVideoDirectoryIdentity(publication.destinationDirectory),
          ]);
          let existing: BigIntStats | undefined;
          try {
            existing = await publicationLstat(fileOperations, publication.destinationPath);
          } catch (error) {
            if (!isMissingFileError(error)) throw error;
          }
          if (existing) {
            if (!existing.isFile() || existing.isSymbolicLink()) throw htmlVideoPublishConflict();
            const backupPath = await unusedHtmlVideoBackupPath(publication.destinationPath, fileOperations);
            const backup = {
              path: backupPath,
              identity: htmlVideoPublishedFileIdentity(existing),
            };
            await rename(publication.destinationPath, backupPath);
            publication.backup = backup;
            const backupStat = await publicationLstat(fileOperations, backupPath);
            if (!isSameHtmlVideoPublishedFile(backupStat, backup.identity)) {
              throw htmlVideoPublishConflict();
            }
          }
          await rename(publication.stagedPath, publication.destinationPath);
          publication.published = true;
          const publishedStat = await publicationLstat(fileOperations, publication.destinationPath);
          if (!isSameHtmlVideoPublishedFile(publishedStat, publication.stagedIdentity)) {
            throw htmlVideoPublishConflict();
          }
        }

        await Promise.all([
          validateHtmlVideoTaskDirectory(taskDirectory),
          validateHtmlVideoRuntimeStage(stage),
        ]);
        publishedPaths = await Promise.all(prepared.map(async (publication) => {
          await validateHtmlVideoDirectoryIdentity(publication.destinationDirectory);
          return taskLocalFile(workDir, publication.destinationPath);
        }));
      } catch (error) {
        const rollbackErrors = await rollbackHtmlVideoFilePublications(prepared, fileOperations);
        if (rollbackErrors.length) {
          throw new AggregateError(
            [error, ...rollbackErrors],
            'HTML video publication and rollback both failed.',
          );
        }
        throw error;
      }

      await Promise.all(prepared.map(async (publication) => {
        if (!publication.backup) return;
        try {
          await validateHtmlVideoDirectoryIdentity(publication.destinationDirectory);
          const backupStat = await publicationLstat(fileOperations, publication.backup.path);
          if (!isSameHtmlVideoPublishedFile(backupStat, publication.backup.identity)) return;
          await publicationUnlink(fileOperations, publication.backup.path);
          publication.backup = undefined;
        } catch {
          // The stable files are committed; a later publication safely reaps strict quarantine names.
        }
      }));
      return publishedPaths;
    },
  );
}

async function withHtmlVideoPublicationLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = htmlVideoPublicationTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  const tail = previous.catch(() => undefined).then(() => gate);
  htmlVideoPublicationTails.set(key, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    void tail.finally(() => {
      if (htmlVideoPublicationTails.get(key) === tail) htmlVideoPublicationTails.delete(key);
    });
  }
}

async function recoverHtmlVideoPublicationQuarantines(
  publication: HtmlVideoPreparedFilePublication,
  fileOperations: Partial<HtmlVideoPublicationFileOperations>,
): Promise<void> {
  const destinationDir = await validateHtmlVideoDirectoryIdentity(publication.destinationDirectory);
  const destinationName = basename(publication.destinationPath);
  const quarantinePrefix = `.${destinationName}.`;
  const quarantineSuffix = '.quarantine';
  const names = (await readdir(destinationDir)).filter((name) => (
    name.startsWith(quarantinePrefix)
    && name.endsWith(quarantineSuffix)
    && htmlVideoUuidPattern.test(name.slice(quarantinePrefix.length, -quarantineSuffix.length))
  ));
  if (!names.length) return;

  let destination: BigIntStats | undefined;
  try {
    destination = await publicationLstat(fileOperations, publication.destinationPath);
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
  if (destination && (!destination.isFile() || destination.isSymbolicLink())) {
    throw htmlVideoPublishConflict();
  }

  const regularQuarantines: Array<{ path: string; identity: HtmlVideoPublishedFileIdentity }> = [];
  for (const name of names) {
    await validateHtmlVideoDirectoryIdentity(publication.destinationDirectory);
    const path = join(destinationDir, name);
    let value: BigIntStats;
    try {
      value = await publicationLstat(fileOperations, path);
    } catch (error) {
      if (isMissingFileError(error)) continue;
      throw error;
    }
    if (value.isSymbolicLink()) {
      await publicationUnlink(fileOperations, path);
      continue;
    }
    if (!value.isFile()) throw htmlVideoPublishConflict();
    regularQuarantines.push({ path, identity: htmlVideoPublishedFileIdentity(value) });
  }

  if (destination) {
    for (const quarantine of regularQuarantines) {
      await validateHtmlVideoDirectoryIdentity(publication.destinationDirectory);
      const value = await publicationLstat(fileOperations, quarantine.path);
      if (!isSameHtmlVideoPublishedFile(value, quarantine.identity)) throw htmlVideoPublishConflict();
      await publicationUnlink(fileOperations, quarantine.path);
    }
    return;
  }
  if (!regularQuarantines.length) return;
  if (regularQuarantines.length !== 1) throw htmlVideoPublishConflict();
  const [quarantine] = regularQuarantines;
  await validateHtmlVideoDirectoryIdentity(publication.destinationDirectory);
  await rename(quarantine.path, publication.destinationPath);
  const restored = await publicationLstat(fileOperations, publication.destinationPath);
  if (!isSameHtmlVideoPublishedFile(restored, quarantine.identity)) throw htmlVideoPublishConflict();
}

async function rollbackHtmlVideoFilePublications(
  publications: HtmlVideoPreparedFilePublication[],
  fileOperations: Partial<HtmlVideoPublicationFileOperations>,
): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const publication of [...publications].reverse()) {
    try {
      await validateHtmlVideoDirectoryIdentity(publication.destinationDirectory);
      if (publication.published) {
        const publishedStat = await publicationLstat(fileOperations, publication.destinationPath);
        if (!isSameHtmlVideoPublishedFile(publishedStat, publication.stagedIdentity)) {
          throw htmlVideoPublishConflict();
        }
        await rename(publication.destinationPath, publication.stagedPath);
        publication.published = false;
      }
      if (publication.backup) {
        const backupStat = await publicationLstat(fileOperations, publication.backup.path);
        if (!isSameHtmlVideoPublishedFile(backupStat, publication.backup.identity)) {
          throw htmlVideoPublishConflict();
        }
        await rename(publication.backup.path, publication.destinationPath);
        publication.backup = undefined;
      }
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

async function unusedHtmlVideoBackupPath(
  destinationPath: string,
  fileOperations: Partial<HtmlVideoPublicationFileOperations>,
): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidate = join(
      dirname(destinationPath),
      `.${basename(destinationPath)}.${randomUUID()}.quarantine`,
    );
    try {
      await publicationLstat(fileOperations, candidate);
    } catch (error) {
      if (isMissingFileError(error)) return candidate;
      throw error;
    }
  }
  throw htmlVideoPublishConflict();
}

function publicationLstat(
  fileOperations: Partial<HtmlVideoPublicationFileOperations>,
  path: string,
): Promise<BigIntStats> {
  return fileOperations.lstat?.(path) ?? lstat(path, { bigint: true });
}

function publicationUnlink(
  fileOperations: Partial<HtmlVideoPublicationFileOperations>,
  path: string,
): Promise<void> {
  return fileOperations.unlink?.(path) ?? unlink(path);
}

function htmlVideoPublishedFileIdentity(
  value: Pick<BigIntStats, 'dev' | 'ino' | 'size'>,
): HtmlVideoPublishedFileIdentity {
  return {
    device: value.dev.toString(),
    inode: value.ino.toString(),
    size: value.size.toString(),
  };
}

function isSameHtmlVideoPublishedFile(
  value: Pick<BigIntStats, 'dev' | 'ino' | 'size'>,
  identity: HtmlVideoPublishedFileIdentity,
): boolean {
  return value.dev.toString() === identity.device
    && value.ino.toString() === identity.inode
    && value.size.toString() === identity.size;
}

function htmlVideoPublishConflict(): AppError {
  return new AppError(
    'HTML_VIDEO_PUBLISH_CONFLICT',
    'HTML 视频产物发布路径已被其他进程修改，请重试。',
    true,
  );
}

export function createElectronHtmlVideoRuntime(options: ElectronHtmlVideoRuntimeOptions): ElectronHtmlVideoRuntime {
  const fps = clampFps(options.fps ?? defaultFps);
  const maxLongEdge = options.maxLongEdge ?? defaultMaxLongEdge;
  let durationProbeTail = Promise.resolve();

  return {
    measureAudioDuration(path, signal) {
      const activeSignal = signal ?? options.signal;
      const operation = durationProbeTail.then(async () => {
        throwIfAborted(activeSignal);
        const { workDir } = await validateHtmlVideoTaskDirectory(options.taskDirectory);
        const mediaPath = await taskLocalFile(workDir, path);
        const probe = await options.probeMedia(workDir, mediaPath, activeSignal);
        throwIfAborted(activeSignal);
        const duration = probe.duration;
        if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
          throw new AppError('HTML_VIDEO_AUDIO_DURATION_INVALID', '无法读取配音文件时长。', true);
        }
        return duration;
      });
      durationProbeTail = operation.then(() => undefined, () => undefined);
      return operation;
    },

    async createPreviews(input) {
      const signal = input.signal ?? options.signal;
      throwIfAborted(signal);
      const { workDir } = await validateHtmlVideoTaskDirectory(options.taskDirectory);
      const localInput = await resolveTaskLocalRuntimeMedia(workDir, input);
      await validateHtmlVideoTaskDirectory(options.taskDirectory);
      throwIfAborted(signal);
      const [htmlDir, thumbnailDir] = await Promise.all([
        ensureTaskLocalDirectory(workDir, ['html-scenes']),
        ensureTaskLocalDirectory(workDir, ['preview-thumbnails']),
      ]);
      return withHtmlVideoRuntimeStage(options.taskDirectory, 'preview', async (stage, stageDir) => {
        const composition = buildRuntimeComposition(options, localInput, fps, maxLongEdge, stageDir, undefined);
        const [stageHtmlDir, stageThumbnailDir] = await Promise.all([
          ensureTaskLocalDirectory(stageDir, ['html-scenes']),
          ensureTaskLocalDirectory(stageDir, ['preview-thumbnails']),
        ]);
        const pending: Array<{
          sceneId: number;
          sourceScene: HtmlVideoPreviewInput['scenes'][number];
          background: HtmlVideoPreviewInput['assets'][number];
          voice: HtmlVideoPreviewInput['voices'][number];
          stagedHtmlPath: string;
          stagedThumbnailPath: string;
          htmlPath: string;
          thumbnailPath: string;
        }> = [];

        for (const scene of composition.scenes) {
          throwIfAborted(signal);
          await validateHtmlVideoRuntimeStage(stage);
          const filename = `scene-${String(scene.sceneId).padStart(3, '0')}`;
          const stagedHtmlPath = join(stageHtmlDir, `${filename}.html`);
          const stagedThumbnailPath = join(stageThumbnailDir, `${filename}.jpg`);
          await writeFile(stagedHtmlPath, scene.html, 'utf8');
          const renderedThumbnailPath = await options.renderer.capturePreview({
            workDir: stageDir,
            htmlPath: stagedHtmlPath,
            outputPath: stagedThumbnailPath,
            canvas: { width: composition.canvas_w, height: composition.canvas_h },
            signal,
          });
          await validateHtmlVideoRuntimeStage(stage);
          const checkedThumbnailPath = await taskLocalFile(stageDir, renderedThumbnailPath);
          if (relative(resolve(stagedThumbnailPath), checkedThumbnailPath)) {
            throw new AppError('HTML_VIDEO_PREVIEW_OUTPUT_INVALID', 'HTML 视频预览图路径无效。', true);
          }
          const sourceScene = localInput.scenes.find((item) => item.index === scene.sceneId);
          const background = localInput.assets.find((asset) => asset.sceneIndex === scene.sceneId && asset.kind === 'bg');
          const voice = localInput.voices.find((clip) => clip.sceneIndex === scene.sceneId);
          if (!sourceScene || !background || !voice) {
            throw new AppError('HTML_VIDEO_PREVIEW_INPUT_INVALID', `场景 ${scene.sceneId} 的预览媒体不完整。`);
          }
          pending.push({
            sceneId: scene.sceneId,
            sourceScene,
            background,
            voice,
            stagedHtmlPath,
            stagedThumbnailPath: checkedThumbnailPath,
            htmlPath: join(htmlDir, `${filename}.html`),
            thumbnailPath: join(thumbnailDir, `${filename}.jpg`),
          });
        }

        throwIfAborted(signal);
        const publishedPaths = await publishHtmlVideoStagedFiles(
          options.taskDirectory,
          stage,
          pending.flatMap((item) => [
            { stagedPath: item.stagedHtmlPath, destinationPath: item.htmlPath },
            { stagedPath: item.stagedThumbnailPath, destinationPath: item.thumbnailPath },
          ]),
          options.publicationFileOperations,
        );
        const compositions = pending.map<HtmlVideoCompositionSnapshot>((item, index) => ({
          index: item.sceneId,
          durationSec: item.voice.durationSec,
          canvas: { w: composition.canvas_w, h: composition.canvas_h },
          audio: { src: item.voice.src, durationSec: item.voice.durationSec },
          background: { src: item.background.src },
          captions: captionTimeline(item.sourceScene.captions, item.voice.durationSec, item.sceneId),
          htmlPath: publishedPaths[index * 2],
          thumbnailPath: publishedPaths[index * 2 + 1],
          rev: 1,
        }));
        return { compositions };
      }, options.stagingFileOperations);
    },

    async render(input) {
      const signal = input.signal ?? options.signal;
      throwIfAborted(signal);
      const { workDir } = await validateHtmlVideoTaskDirectory(options.taskDirectory);
      const bgmPath = options.bgmPath
        ? await taskLocalFile(workDir, options.bgmPath)
        : undefined;
      const localInput = await resolveTaskLocalRuntimeMedia(workDir, input);
      await validateHtmlVideoTaskDirectory(options.taskDirectory);
      throwIfAborted(signal);
      return withHtmlVideoRuntimeStage(options.taskDirectory, 'render', async (stage, stageDir) => {
        const composition = buildRuntimeComposition(options, localInput, fps, maxLongEdge, stageDir, bgmPath);
        await preflightHtmlVideoRender({
          workDir: stageDir,
          canvas: { width: composition.canvas_w, height: composition.canvas_h },
          fps,
          durations: composition.scenes.map((scene) => scene.duration),
        }, {
          getAvailableDiskBytes: options.getAvailableDiskBytes,
        });
        const result = await options.renderer.render(composition, { signal });
        throwIfAborted(signal);
        await validateHtmlVideoRuntimeStage(stage);
        const outputPath = await taskLocalFile(stageDir, result.outputPath || composition.outputPath);
        const expectedOutputPath = await taskLocalFile(stageDir, composition.outputPath);
        if (relative(expectedOutputPath, outputPath)) {
          throw new AppError('HTML_VIDEO_OUTPUT_INVALID', 'HTML 视频渲染结果路径无效。', true);
        }
        const outputStat = await stat(outputPath);
        if (!outputStat.isFile() || outputStat.size <= 0) {
          throw new AppError('HTML_VIDEO_OUTPUT_INVALID', 'HTML 视频渲染结果为空。', true);
        }
        throwIfAborted(signal);
        const probe = await options.probeMedia(stageDir, outputPath, signal);
        throwIfAborted(signal);
        if (
          probe.hasAudio !== true
          || probe.hasVideo !== true
          || probe.width !== composition.canvas_w
          || probe.height !== composition.canvas_h
          || typeof probe.duration !== 'number'
          || !Number.isFinite(probe.duration)
          || probe.duration <= 0
        ) {
          throw new AppError(
            'HTML_VIDEO_OUTPUT_INVALID',
            'HTML 视频渲染结果未通过完整性校验。',
            true,
          );
        }
        assertHtmlVideoOutputDuration(composition, probe.duration);
        const [publishedPath] = await publishHtmlVideoStagedFiles(
          options.taskDirectory,
          stage,
          [{
            stagedPath: outputPath,
            destinationPath: join(workDir, 'final.mp4'),
          }],
          options.publicationFileOperations,
        );
        const publishedStat = await stat(publishedPath);
        return {
          path: publishedPath,
          sizeBytes: publishedStat.size,
          durationSec: probe.duration,
        };
      }, options.stagingFileOperations);
    },
  };
}

function buildRuntimeComposition(
  options: ElectronHtmlVideoRuntimeOptions,
  input: Pick<HtmlVideoPreviewInput, 'scenes' | 'assets' | 'voices' | 'config'>,
  fps: number,
  maxLongEdge: number,
  workDir: string,
  bgmPath: string | undefined,
): HtmlVideoExportInput {
  const canvas = htmlVideoCanvasForRatio(input.config.ratio, maxLongEdge);
  const scenes = input.scenes.map((scene) => {
    const voice = input.voices.find((clip) => clip.sceneIndex === scene.index);
    if (!voice || !Number.isFinite(voice.durationSec) || voice.durationSec <= 0) {
      throw new AppError('HTML_VIDEO_VOICE_MISSING', `场景 ${scene.index} 缺少有效配音。`);
    }
    return {
      id: scene.index,
      cap: scene.narration,
      descPrompt: scene.background.prompt,
      durationMs: Math.max(800, Math.round(voice.durationSec * 1000)),
    };
  });
  const artifact: PipelineArtifact = {
    reviewedText: input.scenes.map((scene) => scene.narration).join('\n\n'),
    rewrittenCopy: input.scenes.map((scene) => scene.narration).join('\n\n'),
    cover: {
      title: options.taskTitle,
      subtitle: [],
      summary: input.scenes[0]?.narration ?? options.taskTitle,
      tags: [],
      comments: [],
    },
    scenes,
    imagePrompts: [],
    subtitles: { cues: [], srt: '' },
  };
  return buildHtmlVideoExportInput({
    workDir,
    outputPath: join(workDir, 'final.mp4'),
    title: options.taskTitle,
    artifact,
    generatedImages: input.assets
      .filter((asset) => asset.kind === 'bg')
      .map((asset) => ({ sceneId: asset.sceneIndex, path: asset.src })),
    foregroundImages: input.assets
      .filter((asset) => asset.kind === 'fg')
      .map((asset) => ({ sceneId: asset.sceneIndex, path: asset.src })),
    narrationAudio: input.voices.map((voice) => ({ sceneId: voice.sceneIndex, path: voice.src })),
    bgmPath,
    bgmTargetDb: bgmTargetDb(input.config.bgmVolume),
    fps,
    canvas_w: canvas.width,
    canvas_h: canvas.height,
    transition: {
      type: input.config.transitionType?.trim() || 'fade',
      duration: 0.3,
    },
  });
}

async function resolveTaskLocalRuntimeMedia(
  workDir: string,
  input: Pick<HtmlVideoPreviewInput, 'scenes' | 'assets' | 'voices' | 'config'>,
): Promise<Pick<HtmlVideoPreviewInput, 'scenes' | 'assets' | 'voices' | 'config'>> {
  const [assets, voices] = await Promise.all([
    Promise.all(input.assets.map(async (asset) => ({
      ...asset,
      src: await taskLocalFile(workDir, asset.src),
    }))),
    Promise.all(input.voices.map(async (voice) => ({
      ...voice,
      src: await taskLocalFile(workDir, voice.src),
    }))),
  ]);
  return { ...input, assets, voices };
}

function captionTimeline(captions: string[], durationSec: number, sceneIndex: number) {
  const lines = captions.length ? captions : [''];
  const slotDuration = durationSec / lines.length;
  return lines.map((text, index) => ({
    id: `${sceneIndex}-${index}`,
    text,
    startSec: index * slotDuration,
    durationSec: slotDuration,
  }));
}

function bgmTargetDb(volume: 'soft' | 'medium' | 'loud' | undefined): number {
  if (volume === 'loud') return -16;
  if (volume === 'medium') return -22;
  return -28;
}

function assertHtmlVideoOutputDuration(composition: HtmlVideoExportInput, actualDuration: number): void {
  const expectedDuration = expectedHtmlVideoOutputDuration(composition);
  const tolerance = Math.max(0.5, expectedDuration * 0.05);
  if (Math.abs(actualDuration - expectedDuration) <= tolerance) return;
  throw new AppError(
    'HTML_VIDEO_OUTPUT_DURATION_MISMATCH',
    'HTML 视频渲染结果时长与场景编排不一致。',
    true,
  );
}

function expectedHtmlVideoOutputDuration(composition: HtmlVideoExportInput): number {
  const segmentDurations = composition.scenes.map((scene) => scene.duration);
  if (composition.coverPath) segmentDurations.unshift(composition.scenes[0]?.duration || 2);
  const totalDuration = segmentDurations.reduce((sum, duration) => sum + duration, 0);
  if (segmentDurations.length < 2) return totalDuration;
  const requestedTransition = composition.transition?.duration || 0.3;
  const shortestHalfDuration = Math.min(...segmentDurations.map((duration) => duration / 2));
  const transitionDuration = Math.min(
    Math.max(0.01, requestedTransition),
    Math.max(0.01, shortestHalfDuration),
  );
  return totalDuration - transitionDuration * (segmentDurations.length - 1);
}

async function availableDiskBytes(workDir: string): Promise<number> {
  const value = await statfs(workDir);
  return value.bavail * value.bsize;
}

async function taskLocalFile(workDir: string, path: string): Promise<string> {
  const trimmedPath = path.trim();
  if (
    /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(trimmedPath)
    && !/^[A-Za-z]:[\\/]/u.test(trimmedPath)
  ) {
    throw invalidHtmlVideoMediaPath();
  }
  const root = await realpath(workDir);
  const actual = await realpath(isAbsolute(trimmedPath) ? resolve(trimmedPath) : resolve(workDir, trimmedPath));
  assertTaskLocalPath(root, actual);
  const value = await stat(actual);
  if (!value.isFile() || value.size <= 0) {
    throw new AppError('HTML_VIDEO_MEDIA_FILE_INVALID', 'HTML 视频媒体文件为空或不可用。');
  }
  return actual;
}

async function pinHtmlVideoMediaFile(workDir: string, path: string): Promise<HtmlVideoMediaResource> {
  const canonicalPath = await taskLocalFile(workDir, path);
  const value = await lstat(canonicalPath, { bigint: true });
  if (!value.isFile() || value.isSymbolicLink() || value.size <= 0n) {
    throw new AppError('HTML_VIDEO_MEDIA_FILE_INVALID', 'HTML 视频媒体文件为空或不可用。');
  }
  return Object.freeze({
    path: canonicalPath,
    identity: Object.freeze({
      canonicalPath,
      device: value.dev.toString(),
      inode: value.ino.toString(),
      size: value.size.toString(),
      modifiedNs: value.mtimeNs.toString(),
    }),
  });
}

function isSameHtmlVideoMediaFile(
  value: HtmlVideoMediaFileIdentity,
  expected: HtmlVideoMediaFileIdentity,
): boolean {
  return value.canonicalPath === expected.canonicalPath
    && value.device === expected.device
    && value.inode === expected.inode
    && value.size === expected.size
    && value.modifiedNs === expected.modifiedNs;
}

function assertTaskLocalPath(root: string, actual: string): void {
  const fromRoot = relative(root, actual);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(fromRoot)) {
    throw invalidHtmlVideoMediaPath();
  }
}

function validateHtmlVideoTaskId(value: string): string {
  if (!htmlVideoTaskIdPattern.test(value)) throw invalidHtmlVideoMediaPath();
  return value;
}

function decodeHtmlVideoMediaSegment(value: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw invalidHtmlVideoMediaPath();
  }
  if (!decoded || decoded === '.' || decoded === '..' || /[\\/\0]/u.test(decoded)) {
    throw invalidHtmlVideoMediaPath();
  }
  return decoded;
}

function invalidHtmlVideoMediaPath(): AppError {
  return new AppError('HTML_VIDEO_MEDIA_PATH_INVALID', 'HTML 视频媒体文件必须位于任务目录内。');
}

function clampFps(value: number): number {
  return Math.max(1, Math.min(60, Math.round(Number.isFinite(value) ? value : defaultFps)));
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException('The HTML video operation was cancelled.', 'AbortError');
}

function formatMegabytes(bytes: number): number {
  return Math.max(1, Math.ceil(bytes / (1024 * 1024)));
}
