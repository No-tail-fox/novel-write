import { z } from 'zod';
import { AppError } from './app-error';
import type { CreateTaskInput } from './types';
import { isOrdinaryTask } from '../features/tasks/task-control-manifest';

/** A material pool belongs to one short-video task, never to another generation route. */
export const shortVideoMaterialsSchema = z.object({
  files: z.array(z.string().trim().min(1).max(32768)).min(1).max(100),
  fit: z.enum(['cover', 'contain']),
}).strict();
export type ShortVideoMaterials = z.infer<typeof shortVideoMaterialsSchema>;
export function resolveShortVideoMaterials(input: Pick<CreateTaskInput, 'shortVideoMaterials' | 'taskKind' | 'taskType'>): ShortVideoMaterials | undefined {
  if (!input.shortVideoMaterials) return undefined;
  if (!isOrdinaryTask({ taskKind: input.taskKind ?? 'story', taskType: input.taskType })) throw new AppError('SHORT_VIDEO_MATERIAL_SCOPE', '素材混剪仅用于短片生成');
  const value = shortVideoMaterialsSchema.parse(input.shortVideoMaterials);
  if (value.files.some(path => !/\.(mp4|mov|webm)$/i.test(path))) throw new AppError('SHORT_VIDEO_MATERIAL_FORMAT', '素材混剪仅支持 MP4、MOV、WebM 视频');
  return { ...value, files: [...new Set(value.files)] };
}

/** Keep selection atomic: never silently discard files above the task limit. */
export function appendShortVideoMaterialFiles(current: ShortVideoMaterials, selected: string[]): ShortVideoMaterials {
  if (!selected.length) return current;
  const files = [...new Set([...current.files, ...selected])];
  if (files.length > 100) throw new AppError('SHORT_VIDEO_MATERIAL_LIMIT', `每个短片最多添加 100 个素材；当前选择合计 ${files.length} 个，请减少后重选。`);
  return resolveShortVideoMaterials({ shortVideoMaterials: { ...current, files } })!;
}
