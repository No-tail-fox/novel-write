import type { Dirent } from 'node:fs';
import { copyFile, mkdir, readdir, rename, rm, stat, writeFile, readFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SceneAsset } from './draft';
import type { StoryboardScene } from './types';

export interface PersonAssetSummary {
  name: string;
  count: number;
  dir: string;
  updatedAt: number;
}

export interface PersonAssetImage {
  name: string;
  path: string;
  updatedAt: number;
}

export interface LocalMaterialCopyResult {
  assets: SceneAsset[];
  origins: Record<string, string>;
}

export interface RecycledPersonAsset {
  name: string;
  token: string;
  path: string;
  recycledAt: number;
}

const acceptedImageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const invalidWindowsPathChars = /[<>:"/\\|?*\x00-\x1F]/g;

export function sanitizePersonName(name: string): string {
  const sanitized = name.trim().replace(invalidWindowsPathChars, '_').replace(/[. ]+$/g, '');
  if (!sanitized) {
    throw new Error('人物名称不能为空');
  }
  return sanitized;
}

export async function createPersonAsset(rootDir: string, name: string): Promise<PersonAssetSummary> {
  const dir = personDir(rootDir, name);
  await mkdir(dir, { recursive: true });
  return summarizePersonDir(dir);
}

export async function listPersonAssets(rootDir: string): Promise<PersonAssetSummary[]> {
  const entries = await safeReaddir(rootDir);
  const summaries = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => summarizePersonDir(join(rootDir, entry.name))),
  );
  return summaries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

export async function listPersonImages(rootDir: string, person: string): Promise<PersonAssetImage[]> {
  const dir = personDir(rootDir, person);
  const entries = await safeReaddir(dir);
  const images = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && isAcceptedImage(entry.name))
      .map(async (entry) => {
        const path = join(dir, entry.name);
        const info = await stat(path);
        return { name: entry.name, path, updatedAt: info.mtimeMs };
      }),
  );
  return images.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

export async function importPersonAssetFiles(rootDir: string, person: string, sourcePaths: string[]): Promise<number> {
  const dir = personDir(rootDir, person);
  await mkdir(dir, { recursive: true });
  let copied = 0;
  for (const sourcePath of sourcePaths) {
    const ext = normalizedImageExtension(sourcePath);
    if (!ext) continue;
    const destination = await uniqueDestinationPath(dir, safeImageFileName(sourcePath, ext));
    await copyFile(sourcePath, destination);
    copied += 1;
  }
  return copied;
}

export async function renamePersonAsset(rootDir: string, oldName: string, newName: string): Promise<string> {
  const from = personDir(rootDir, oldName);
  const to = personDir(rootDir, newName);
  await mkdir(rootDir, { recursive: true });
  if (from === to) return to;
  await rename(from, to);
  return to;
}

export async function deletePersonAsset(rootDir: string, person: string): Promise<void> {
  await rm(personDir(rootDir, person), { recursive: true, force: true });
}

/** Move a library into the local recycle area so an accidental delete can be undone. */
export async function recyclePersonAsset(rootDir: string, person: string): Promise<RecycledPersonAsset> {
  const source = personDir(rootDir, person);
  const info = await stat(source).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`人物素材库不存在或已删除：${person}`);
  const recycledAt = Date.now();
  const token = `${recycledAt}-${randomUUID()}`;
  const trashDir = join(rootDir, '.trash');
  await mkdir(trashDir, { recursive: true });
  const target = join(trashDir, token);
  await rename(source, target);
  await writeFile(join(target, '.person-asset.json'), JSON.stringify({ name: sanitizePersonName(person), recycledAt }), 'utf8');
  return { name: sanitizePersonName(person), token, path: target, recycledAt };
}

export async function restoreRecycledPersonAsset(rootDir: string, token: string): Promise<PersonAssetSummary> {
  if (!/^[0-9]+-[0-9a-f-]+$/i.test(token)) throw new Error('人物素材回收令牌无效。');
  const target = join(rootDir, '.trash', token);
  const metadataPath = join(target, '.person-asset.json');
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as { name?: string };
  const name = sanitizePersonName(metadata.name ?? '');
  const destination = personDir(rootDir, name);
  if (await fileExists(destination)) throw new Error(`人物素材库「${name}」已存在，无法撤销删除。`);
  await rename(target, destination);
  await rm(join(destination, '.person-asset.json'), { force: true });
  return summarizePersonDir(destination);
}

export async function copyPersonMaterialsForScenes(input: {
  rootDir: string;
  person: string;
  scenes: StoryboardScene[];
  taskDir: string;
  ratio: string;
  signal?: AbortSignal;
}): Promise<LocalMaterialCopyResult> {
  throwIfAborted(input.signal);
  const images = await listPersonImages(input.rootDir, input.person);
  if (images.length === 0) {
    throw new Error(`人物素材库中「${input.person}」没有图片`);
  }

  const imageDir = join(input.taskDir, 'images');
  await mkdir(imageDir, { recursive: true });
  const assets: SceneAsset[] = [];
  const origins: Record<string, string> = {};

  for (const [index, scene] of input.scenes.entries()) {
    throwIfAborted(input.signal);
    const source = images[index % images.length];
    const ext = normalizedImageExtension(source.path) ?? '.png';
    const destination = join(imageDir, `${scene.id}${ext}`);
    await copyFile(source.path, destination);
    assets.push({ sceneId: scene.id, path: destination });
    origins[String(scene.id)] = source.path;
  }

  await writeFile(join(input.taskDir, '04-local-meta.json'), JSON.stringify({ version: 1, person: input.person, ratio: input.ratio, origins }, null, 2), 'utf8');
  return { assets, origins };
}

async function summarizePersonDir(dir: string): Promise<PersonAssetSummary> {
  const images = await listPersonImages(dirname(dir), basename(dir));
  const dirInfo = await stat(dir);
  const updatedAt = images.reduce((max, image) => Math.max(max, image.updatedAt), dirInfo.mtimeMs);
  return { name: basename(dir), count: images.length, dir, updatedAt };
}

function personDir(rootDir: string, person: string): string {
  return join(rootDir, sanitizePersonName(person));
}

async function safeReaddir(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function isAcceptedImage(name: string): boolean {
  return normalizedImageExtension(name) !== null;
}

function normalizedImageExtension(path: string): string | null {
  const ext = extname(path).toLowerCase();
  return acceptedImageExtensions.has(ext) ? ext : null;
}

function safeImageFileName(sourcePath: string, ext: string): string {
  const stem = basename(sourcePath, extname(sourcePath)).trim().replace(invalidWindowsPathChars, '_').replace(/[. ]+$/g, '') || 'image';
  return `${stem}${ext}`;
}

async function uniqueDestinationPath(dir: string, fileName: string): Promise<string> {
  const ext = extname(fileName);
  const stem = basename(fileName, ext);
  let index = 1;
  let candidate = join(dir, fileName);
  while (await fileExists(candidate)) {
    index += 1;
    candidate = join(dir, `${stem}-${index}${ext}`);
  }
  return candidate;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('Operation aborted.');
  }
}
