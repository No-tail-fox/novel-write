import { z } from 'zod';
import { PIXELLE_REVISION, type PixelleCatalog, type PixelleTemplateDescriptor, type PixelleTaskOptions } from './pixelle';
import type { CreateTaskInput } from './types';
import { isOrdinaryTask } from '../features/tasks/task-control-manifest';

export const pixelleRefSchema = z.object({
  provider: z.literal('pixelle'), revision: z.literal(PIXELLE_REVISION),
  path: z.string().regex(/^\d+x\d+\/[a-zA-Z0-9_-]+\.html$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const pixelleOptionsSchema = z.object({
  parameters: z.record(z.string().max(128), z.union([z.string().max(10000), z.number().finite(), z.boolean()])).optional(),
  subtitleMode: z.enum(['template', 'timed-overlay', 'off']),
  mediaKind: z.enum(['image', 'video']).optional(),
  videoPath: z.string().max(32768).optional(),
  padStrategy: z.enum(['freeze', 'black']).optional(),
}).strict();
export function pixelleRatio(template: PixelleTemplateDescriptor): string {
  return template.orientation === 'portrait' ? '9:16' : template.orientation === 'landscape' ? '16:9' : '1:1';
}
export function pixelleUsesVideo(template: PixelleTemplateDescriptor, options?: PixelleTaskOptions): boolean {
  return template.type === 'video' || template.type === 'asset' && options?.mediaKind === 'video';
}
export function resolvePixelleTask(input: Pick<CreateTaskInput, 'visualTemplateRef' | 'pixelleOptions' | 'ratio' | 'taskKind' | 'taskType' | 'shortVideoMaterials'>, catalog: PixelleCatalog): PixelleTemplateDescriptor | undefined {
  if (!input.visualTemplateRef) {
    if (input.pixelleOptions) throw new Error('Pixelle 参数缺少原版模板引用');
    return undefined;
  }
  if (!isOrdinaryTask({taskKind: input.taskKind ?? 'story', taskType: input.taskType})) throw new Error('Pixelle 仅用于短片生成');
  const ref = pixelleRefSchema.parse(input.visualTemplateRef);
  const options = pixelleOptionsSchema.parse(input.pixelleOptions ?? { subtitleMode: 'template' });
  const template = catalog.templates.find(item => item.ref.path === ref.path && item.ref.sha256 === ref.sha256 && item.ref.revision === ref.revision);
  if (!template) throw new Error('Pixelle 原模板版本或校验值不匹配，请重新选择');
  if (input.ratio !== undefined && input.ratio !== pixelleRatio(template)) throw new Error('所选 Pixelle 原模板与视频画幅不匹配');
  if (input.shortVideoMaterials && !pixelleUsesVideo(template, options)) throw new Error('素材混剪请选择 Pixelle 视频模板或素材模板的视频模式');
  if (pixelleUsesVideo(template, options) && !options.videoPath?.trim() && !input.shortVideoMaterials?.files.length) throw new Error('此 Pixelle 模板需要真实视频素材，请先选择本地视频');
  if (template.type !== 'asset' && options.mediaKind && options.mediaKind !== (template.type === 'video' ? 'video' : 'image')) throw new Error('Pixelle 素材类型与原模板不匹配');
  for (const [key, value] of Object.entries(options.parameters ?? {})) {
    const parameter = template.parameters[key];
    if (!parameter || ['image', 'video', 'title', 'text', 'index'].includes(key)) throw new Error(`不可覆盖 Pixelle 保留或未知参数: ${key}`);
    const expected = parameter.type === 'bool' ? 'boolean' : parameter.type === 'number' ? 'number' : 'string';
    if (parameter.type === 'color' && (typeof value !== 'string' || !/^#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{4}|[a-fA-F0-9]{6}|[a-fA-F0-9]{8})$/.test(value))) throw new Error(`Pixelle 颜色参数必须为十六进制颜色: ${key}`);
    if (typeof value !== expected) throw new Error(`Pixelle 参数类型不正确: ${key}`);
  }
  return template;
}
