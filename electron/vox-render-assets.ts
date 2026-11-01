import { constants } from 'node:fs';
import { copyFile, link, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import type { VoxAnimationPayload } from '../src/shared/vox-animation';

/** Snapshot original bytes once; share immutable snapshots, never link mutable user originals. */
export async function stageVoxRenderAssets(directory: string, assets: readonly { id: string; kind: 'image' | 'audio'; path: string }[], cacheDirectory = directory): Promise<VoxAnimationPayload['assets']> {
  await mkdir(directory, { recursive: true });
  await mkdir(cacheDirectory, { recursive: true });
  const staged: VoxAnimationPayload['assets'] = [];
  // Bound memory and temporary disk usage: a film can reference dozens of large images.
  for (const asset of assets) {
    const extension = extname(asset.path).toLowerCase();
    const supported = asset.kind === 'image' ? ['.png', '.jpg', '.jpeg', '.webp', '.gif'] : ['.mp3', '.wav', '.m4a', '.ogg', '.flac'];
    if (!supported.includes(extension)) throw new Error('动画素材格式不受支持：' + asset.id);
    const info = await stat(asset.path);
    if (!info.isFile() || info.size > 48 * 1024 * 1024) throw new Error('单个动画素材不能超过 48 MB');
    const bytes = await readFile(asset.path);
    if (bytes.length > 48 * 1024 * 1024) throw new Error('单个动画素材不能超过 48 MB');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const cached = join(cacheDirectory, hash + extension);
    try { await stat(cached); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const temporary = join(cacheDirectory, randomUUID() + '.tmp');
      try {
        await writeFile(temporary, bytes, { flag: 'wx' });
        try { await link(temporary, cached); }
        catch (cause) {
          const code = (cause as NodeJS.ErrnoException).code;
          if (code !== 'EEXIST') {
            if (!['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP'].includes(code ?? '')) throw cause;
            try { await copyFile(temporary, cached, constants.COPYFILE_EXCL); }
            catch (copyError) { if ((copyError as NodeJS.ErrnoException).code !== 'EEXIST') throw copyError; }
          }
        }
      } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    }
    // Detect corrupt/incomplete cache files rather than rendering incorrect content.
    if (createHash('sha256').update(await readFile(cached)).digest('hex') !== hash) throw new Error('VOX_RENDER_ASSET_CACHE_INVALID: ' + asset.id);
    const target = join(directory, randomUUID() + extension);
    try { await link(cached, target); }
    catch (error) {
      if (!['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      await copyFile(cached, target, constants.COPYFILE_EXCL);
    }
    staged.push({ id: asset.id, label: asset.id, kind: asset.kind, url: pathToFileURL(target).href });
  }
  return staged;
}

/** Existing verified hard-linked snapshots already occupy the volume; a retry
 * must not charge those bytes a second time. Copy-only caches stay charged. */
export async function additionalVoxRenderAssetBytes(path: string, cacheDirectory: string): Promise<number> {
  const info = await stat(path);
  if (!info.isFile() || info.size > 48 * 1024 * 1024) throw new Error('单个动画素材不能超过 48 MB');
  const bytes = await readFile(path);
  if (bytes.length > 48 * 1024 * 1024) throw new Error('单个动画素材不能超过 48 MB');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const cached = join(cacheDirectory, hash + extname(path).toLowerCase());
  try {
    const cachedInfo = await stat(cached);
    if (!cachedInfo.isFile() || cachedInfo.nlink < 2 || cachedInfo.size !== bytes.length) return bytes.length;
    return createHash('sha256').update(await readFile(cached)).digest('hex') === hash ? 0 : bytes.length;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return bytes.length;
    throw error;
  }
}
