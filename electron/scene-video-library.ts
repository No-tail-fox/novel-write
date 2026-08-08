import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import type { SceneVideoLibraryItem } from '../src/shared/types';

export const SCENE_VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm'] as const;
export const MAX_SCENE_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;

export interface SceneVideoProbe {
  durationMs: number;
  width: number;
  height: number;
}

export interface ImportSceneVideoOptions {
  libraryRoot: string;
  sourcePath: string;
  normalize: (sourcePath: string, outputPath: string) => Promise<SceneVideoProbe>;
}

export async function importSceneVideoToLibrary(options: ImportSceneVideoOptions): Promise<SceneVideoLibraryItem> {
  const sourcePath = resolve(options.sourcePath);
  const extension = extname(sourcePath).slice(1).toLowerCase();
  if (!SCENE_VIDEO_EXTENSIONS.includes(extension as (typeof SCENE_VIDEO_EXTENSIONS)[number])) {
    throw new Error('SCENE_VIDEO_FORMAT_UNSUPPORTED: 仅支持 MP4、MOV 和 WebM 视频。');
  }
  const source = await stat(sourcePath);
  if (!source.isFile() || source.size <= 0 || source.size > MAX_SCENE_VIDEO_BYTES) {
    throw new Error(`SCENE_VIDEO_SOURCE_INVALID: 视频必须是 1 到 ${MAX_SCENE_VIDEO_BYTES} 字节的普通文件。`);
  }

  const libraryRoot = resolve(options.libraryRoot);
  await mkdir(libraryRoot, { recursive: true });
  const id = randomUUID();
  const outputPath = join(libraryRoot, `${id}.mp4`);
  const temporaryVideoPath = join(libraryRoot, `${id}.tmp.mp4`);
  const manifestPath = join(libraryRoot, `${id}.json`);
  const temporaryManifestPath = join(libraryRoot, `${id}.tmp.json`);
  try {
    const probe = await options.normalize(sourcePath, temporaryVideoPath);
    assertSceneVideoProbe(probe);
    await rename(temporaryVideoPath, outputPath);
    const item: SceneVideoLibraryItem = {
      id,
      path: outputPath,
      originalName: basename(sourcePath),
      durationMs: Math.floor(probe.durationMs),
      width: Math.floor(probe.width),
      height: Math.floor(probe.height),
      createdAt: new Date().toISOString(),
    };
    await writeFile(temporaryManifestPath, JSON.stringify(item, null, 2), { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryManifestPath, manifestPath);
    return item;
  } catch (error) {
    await Promise.all([
      rm(temporaryVideoPath, { force: true }).catch(() => undefined),
      rm(temporaryManifestPath, { force: true }).catch(() => undefined),
    ]);
    throw error;
  }
}

export async function listSceneVideoLibrary(libraryRoot: string): Promise<SceneVideoLibraryItem[]> {
  const root = resolve(libraryRoot);
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  const items = await Promise.all(entries
    .filter((entry) => entry.isFile() && /^[0-9a-f-]+\.json$/iu.test(entry.name))
    .map(async (entry) => readSceneVideoManifest(root, join(root, entry.name))));
  return items
    .filter((item): item is SceneVideoLibraryItem => item !== null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function copySceneVideoToTask(
  item: SceneVideoLibraryItem,
  taskVideoDir: string,
  sceneId: number,
): Promise<string> {
  if (!Number.isSafeInteger(sceneId) || sceneId < 0) throw new Error('SCENE_VIDEO_SCENE_INVALID: 分镜编号无效。');
  const source = await stat(item.path);
  if (!source.isFile() || source.size <= 0 || source.size > MAX_SCENE_VIDEO_BYTES) {
    throw new Error('SCENE_VIDEO_LIBRARY_MISSING: 素材库视频已丢失或无效。');
  }
  const outputDir = resolve(taskVideoDir);
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, `${String(sceneId).padStart(3, '0')}-${randomUUID()}.mp4`);
  const temporaryPath = `${outputPath}.tmp`;
  try {
    await copyFile(item.path, temporaryPath);
    await rename(temporaryPath, outputPath);
    return outputPath;
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readSceneVideoManifest(root: string, manifestPath: string): Promise<SceneVideoLibraryItem | null> {
  try {
    const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as Partial<SceneVideoLibraryItem>;
    if (!parsed.id || !/^[0-9a-f-]+$/iu.test(parsed.id)) return null;
    const path = join(root, `${parsed.id}.mp4`);
    const value = await stat(path);
    if (!value.isFile() || value.size <= 0 || value.size > MAX_SCENE_VIDEO_BYTES) return null;
    const item: SceneVideoLibraryItem = {
      id: parsed.id,
      path,
      originalName: typeof parsed.originalName === 'string' && parsed.originalName.trim() ? parsed.originalName : `${parsed.id}.mp4`,
      durationMs: Number(parsed.durationMs),
      width: Number(parsed.width),
      height: Number(parsed.height),
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date(value.mtimeMs).toISOString(),
    };
    assertSceneVideoProbe(item);
    return item;
  } catch {
    return null;
  }
}

function assertSceneVideoProbe(probe: SceneVideoProbe): void {
  if (
    !Number.isFinite(probe.durationMs)
    || probe.durationMs <= 0
    || !Number.isSafeInteger(Math.floor(probe.width))
    || !Number.isSafeInteger(Math.floor(probe.height))
    || probe.width <= 0
    || probe.height <= 0
  ) {
    throw new Error('SCENE_VIDEO_PROBE_INVALID: 视频时长或画面尺寸无效。');
  }
}
