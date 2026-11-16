import { open, stat, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, extname, join } from 'node:path';
import { AppError } from '../src/shared/app-error';
import { parseMotionComicPipelineData } from '../src/shared/motion-comic';
import type { Task } from '../src/shared/types';
import { createHtmlVideoMediaUrl, resolveHtmlVideoMediaUrl, type HtmlVideoTaskDirectoryIdentity } from './html-video-runtime';

export interface MotionComicRenderExportDependencies {
  getTask: (id: string) => Promise<Task | null>;
  taskDirectory: (id: string) => Promise<HtmlVideoTaskDirectoryIdentity>;
  selectDestination: (defaultName: string) => Promise<string | null>;
}

/** Export persisted render bytes only; never renders or changes project state. */
export async function exportMotionComicRender(
  input: { taskId: string; assetVersionId: string },
  dependencies: MotionComicRenderExportDependencies,
): Promise<boolean> {
  async function sourcePath() {
    const task = await dependencies.getTask(input.taskId);
    if (!task || task.id !== input.taskId || task.taskType !== 'motion-comic') {
      throw new AppError('RENDER_EXPORT_PROJECT_INVALID', '漫剧项目不存在或已删除。');
    }
    const document = parseMotionComicPipelineData(task.pipelineData);
    const asset = document.assets.find(item => item.id === input.assetVersionId);
    if (!asset || asset.kind !== 'video' || asset.assetId !== 'director-final-video' || !asset.localPath || extname(asset.localPath).toLowerCase() !== '.mp4') {
      throw new AppError('RENDER_EXPORT_ASSET_INVALID', '所选成片版本不存在或没有本地 MP4 文件。');
    }
    try {
      const directory = await dependencies.taskDirectory(task.id);
      const url = await createHtmlVideoMediaUrl(task.id, directory, asset.localPath);
      return await resolveHtmlVideoMediaUrl(url, () => directory);
    } catch {
      throw new AppError('RENDER_EXPORT_SOURCE_INVALID', '所选历史成片文件不存在，或不在本项目的受管目录内。');
    }
  }
  const originalPath = await sourcePath();
  const selectedDestination = await dependencies.selectDestination(basename(originalPath));
  if (!selectedDestination) return false;
  const destination: string = selectedDestination;
  // A native save dialog can stay open while history is removed or files change.
  const checkedPath = await sourcePath();
  if (checkedPath !== originalPath) throw new AppError('RENDER_EXPORT_SOURCE_CHANGED', '所选成片文件已变化，请重新选择版本。');
  try {
    const source = await open(checkedPath, 'r');
    try {
      const sourceInfo = await source.stat();
      if (!sourceInfo.isFile() || sourceInfo.size === 0) throw new AppError('RENDER_EXPORT_SOURCE_INVALID', '所选历史成片文件为空或不可读取。');
      // Reuse the media gate after opening, before touching the destination.
      const recheckedPath = await sourcePath();
      const recheckedInfo = await stat(recheckedPath);
      if (recheckedPath !== checkedPath || recheckedInfo.dev !== sourceInfo.dev || recheckedInfo.ino !== sourceInfo.ino) {
        throw new AppError('RENDER_EXPORT_SOURCE_CHANGED', '所选成片文件已变化，请重新选择版本。');
      }
      async function checkTarget() {
        const targetInfo = await stat(destination).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
          return null;
        });
        if (targetInfo && sourceInfo.dev === targetInfo.dev && sourceInfo.ino === targetInfo.ino) {
          throw new AppError('RENDER_EXPORT_SAME_FILE', '另存位置不能与原成片相同，请选择其他文件。');
        }
        if (targetInfo && !targetInfo.isFile()) throw new AppError('RENDER_EXPORT_TARGET_INVALID', '请选择可写入的 MP4 文件位置。');
      }
      await checkTarget();
      const temporary = join(dirname(destination), `.render-export-${randomUUID()}.tmp`);
      const target = await open(temporary, 'wx');
      let published = false;
      try {
        try {
          const buffer = Buffer.allocUnsafe(1024 * 1024);
          let position = 0;
          while (position < sourceInfo.size) {
            const { bytesRead } = await source.read(buffer, 0, Math.min(buffer.length, sourceInfo.size - position), position);
            if (!bytesRead) throw new Error('Source changed while copying');
            let written = 0;
            while (written < bytesRead) {
              const { bytesWritten } = await target.write(buffer, written, bytesRead - written, position + written);
              if (!bytesWritten) throw new Error('Destination write failed');
              written += bytesWritten;
            }
            position += bytesRead;
          }
          await target.sync();
        } finally { await target.close(); }
        await checkTarget();
        // Replace only after the copy succeeds; failed copies preserve existing targets.
        await rename(temporary, destination);
        published = true;
      } finally {
        if (!published) await unlink(temporary).catch(() => undefined);
      }
    } finally { await source.close(); }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('RENDER_EXPORT_COPY_FAILED', '成片另存失败，请检查源文件、目标目录权限和可用磁盘空间。', true);
  }
  return true;
}
