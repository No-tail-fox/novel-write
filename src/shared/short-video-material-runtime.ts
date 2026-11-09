import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { StoryboardScene, TaskArtifactVideoPreview } from './types';
import { shortVideoMaterialsSchema, type ShortVideoMaterials } from './short-video-materials';

export interface ShortVideoMaterialProbe { width: number; height: number; durationMs: number }
export interface ManagedShortVideoMaterial extends ShortVideoMaterialProbe {
  path: string; originalName: string; sourceHash: string; outputHash: string;
}
interface MaterialHost {
  signal?: AbortSignal;
  normalize: (source: string, output: string, signal?: AbortSignal) => Promise<ShortVideoMaterialProbe>;
}
const MAX_BYTES = 2 * 1024 * 1024 * 1024;
export async function hashShortVideoMaterial(path: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk);
  return hash.digest('hex');
}
function assertProbe(value: ShortVideoMaterialProbe): void {
  if (![value.width, value.height, value.durationMs].every(n => Number.isFinite(n) && n > 0)) throw new Error('素材视频尺寸或时长无效');
}
/** Import before creating model providers. Content-addressed, cancellation-safe and restartable. */
export async function bindShortVideoMaterials(settings: ShortVideoMaterials, workDir: string, host: MaterialHost): Promise<{ settings: ShortVideoMaterials; assets: ManagedShortVideoMaterial[] }> {
  const parsed = shortVideoMaterialsSchema.parse(settings);
  const directory = resolve(workDir, 'sources', 'short-video');
  await mkdir(directory, { recursive: true });
  const assets: ManagedShortVideoMaterial[] = [];
  const paths = new Set<string>();
  for (const sourcePath of parsed.files) {
    host.signal?.throwIfAborted();
    const source = resolve(sourcePath);
    const before = await stat(source);
    if (!before.isFile() || before.size < 1 || before.size > MAX_BYTES) throw new Error('本地视频必须是有效文件，且不超过 2 GB');
    const sourceHash = await hashShortVideoMaterial(source, host.signal);
    let cached: ManagedShortVideoMaterial | undefined;
    // A persisted task references its managed output, not the removable original.
    for (const receipt of [source + '.json', join(directory, sourceHash + '.mp4.json')]) {
      try {
        const candidate = JSON.parse(await readFile(receipt, 'utf8')) as ManagedShortVideoMaterial;
        const expected = join(directory, candidate.sourceHash + '.mp4');
        if (!/^[a-f0-9]{64}$/.test(candidate.sourceHash) || resolve(candidate.path) !== expected) continue;
        if (candidate.sourceHash !== sourceHash && candidate.path !== source) continue;
        assertProbe(candidate);
        if (await hashShortVideoMaterial(expected, host.signal) !== candidate.outputHash) continue;
        cached = candidate; break;
      } catch { host.signal?.throwIfAborted(); }
    }
    if (cached) { if (!paths.has(cached.path)) { assets.push(cached); paths.add(cached.path); } continue; }
    // Managed bytes with a damaged receipt must not silently become a new source.
    if (source.startsWith(directory + '/') || source.startsWith(directory + '\\')) throw new Error('托管素材回执丢失或校验失败，请重新导入原视频');
    const path = join(directory, sourceHash + '.mp4');
    const temporary = join(directory, randomUUID() + '.partial.mp4');
    const temporaryReceipt = temporary + '.json';
    try {
      const probe = await host.normalize(source, temporary, host.signal);
      assertProbe(probe);
      const after = await stat(source);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('素材导入期间原文件发生变化，请重试');
      if (await hashShortVideoMaterial(source, host.signal) !== sourceHash) throw new Error('素材导入期间原文件内容发生变化，请重试');
      const outputStat = await stat(temporary);
      if (!outputStat.isFile() || outputStat.size === 0) throw new Error('素材视频标准化结果为空');
      const outputHash = await hashShortVideoMaterial(temporary, host.signal);
      const item: ManagedShortVideoMaterial = { ...probe, path, originalName: basename(source), sourceHash, outputHash };
      await writeFile(temporaryReceipt, JSON.stringify(item, null, 2), { encoding: 'utf8', flag: 'wx' });
      host.signal?.throwIfAborted();
      await rename(temporary, path);
      await rename(temporaryReceipt, path + '.json');
      if (!paths.has(path)) { assets.push(item); paths.add(path); }
    } finally { await Promise.all([rm(temporary, { force: true }), rm(temporaryReceipt, { force: true })]); }
  }
  return { settings: { ...parsed, files: assets.map(asset => asset.path) }, assets };
}
/** Deterministic ordered allocation; original audio never enters either delivery branch. */
export function allocateShortVideoMaterials(scenes: StoryboardScene[], assets: ManagedShortVideoMaterial[], fit: ShortVideoMaterials['fit']): TaskArtifactVideoPreview[] {
  if (!assets.length) throw new Error('素材混剪至少需要一个有效视频');
  const offsets = new Map<string, number>();
  return scenes.map((scene, index) => {
    if (!Number.isFinite(scene.durationMs) || scene.durationMs <= 0) throw new Error('素材混剪镜头时长无效');
    const asset = assets[index % assets.length];
    assertProbe(asset);
    const offset = offsets.get(asset.path) ?? 0;
    const trimStartMs = offset + scene.durationMs <= asset.durationMs ? offset : 0;
    offsets.set(asset.path, trimStartMs + scene.durationMs);
    return { sceneId: scene.id, path: asset.path, source: 'local-upload', originalName: asset.originalName,
      durationMs: asset.durationMs, width: asset.width, height: asset.height, trimStartMs, fit, muted: true,
      license: '用户提供素材；使用者需确认授权' };
  });
}
