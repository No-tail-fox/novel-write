import { randomUUID } from 'node:crypto';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateImageLabRecord } from './image-lab';
import { AppError, redactErrorText } from './app-error';
import { creativeStyle } from './creative-animation/styles';
import type { AppConfig, Task } from './types';

export async function generateProjectCoverImage(
  config: AppConfig,
  task: Task,
  workDir: string,
  prompt: string,
  generate = generateImageLabRecord,
): Promise<string> {
  const id = randomUUID();
  const directory = join(workDir, 'project-covers', id);
  await mkdir(directory, { recursive: true });
  let styleDescription = '';
  if (task.taskType === 'editorial-collage') {
    try {
      const document = JSON.parse(task.pipelineData || '{}');
      const style = creativeStyle(document.productionSettings?.authoring?.styleId);
      if (style) styleDescription = `\n作品视觉风格：${style.cn}。${style.description}`;
    } catch { /* Legacy projects may not have a readable style setting. */ }
  }
  const input = {
    id, prompt: `${prompt}${styleDescription}`, ratio: task.ratio, style: 'none',
    smartMode: 'text-to-image' as const,
  };
  async function journal(status: string, imagePath?: string, error?: string) {
    const temporary = join(directory, 'request.pending.json');
    await writeFile(temporary, JSON.stringify({ id, taskId: task.id, input, status, imagePath, error: error ? redactErrorText(error) : undefined, updatedAt: new Date().toISOString() }), 'utf8');
    await rename(temporary, join(directory, 'request.json'));
  }
  // Persist intent before submission. Restarting or listing projects never resubmits paid requests.
  await journal('submitted');
  try {
    const result = await generate(config, directory, input);
    if (result.status !== 'generated' || !result.imagePath) {
      throw new AppError('PROJECT_COVER_GENERATION_FAILED', result.errorMessage || '封面生成失败，请重试。', true);
    }
    const info = await stat(result.imagePath);
    if (!info.isFile() || !info.size) throw new Error('生图服务未返回有效的封面文件。');
    await journal('generated', result.imagePath);
    return result.imagePath;
  } catch (error) {
    await journal('failed', undefined, error instanceof Error ? error.message : String(error));
    throw error;
  }
}
