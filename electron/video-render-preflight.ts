import { statfs } from 'node:fs/promises';
import { AppError } from '../src/shared/app-error';
import { estimateVideoRenderDiskBudget, type VideoRenderBudgetInput } from '../src/shared/video-render-budget';

export async function preflightVideoRenderDisk(
  workDir: string,
  input: VideoRenderBudgetInput,
  options: { code?: string; label?: string; getAvailableDiskBytes?: (path: string) => Promise<number> } = {},
) {
  const budget = estimateVideoRenderDiskBudget(input);
  const availableBytes = await (options.getAvailableDiskBytes ?? availableDiskBytes)(workDir);
  if (!Number.isFinite(availableBytes) || availableBytes < budget.requiredBytes) {
    throw new AppError(options.code ?? 'VIDEO_RENDER_DISK_SPACE_LOW',
      `磁盘空间不足，${options.label ?? '视频'}渲染预计需要 ${Math.ceil(budget.requiredBytes / 1024 / 1024)} MB 可用空间（含临时片段、混音和成片副本）。`, true);
  }
  return budget;
}

async function availableDiskBytes(path: string): Promise<number> {
  const value = await statfs(path);
  return Number(value.bavail) * Number(value.bsize);
}
