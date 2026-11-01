import type { StoryDreamApi } from '../../shared/storydream-api';

export async function resolveDirectorOutputMediaUrl(
  api: Pick<StoryDreamApi, 'getTaskMediaUrl'>,
  projectId: string,
  path: string,
): Promise<string> {
  if (!projectId.trim()) throw new Error('当前项目尚未就绪，无法解析成片地址。');
  if (!path.trim()) throw new Error('成片文件路径缺失。');
  return api.getTaskMediaUrl(projectId, path);
}
