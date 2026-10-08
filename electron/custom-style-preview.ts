import { randomUUID } from 'node:crypto';
import { mkdir, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { CUSTOM_STYLE_PREVIEW_SUBJECT, customStylePreviewSignature } from '../src/shared/custom-style-preview';
import { generateImageLabRecord } from '../src/shared/image-lab';
import type { AppConfig, CustomStyle } from '../src/shared/types';

/** One explicit generation, returning a draft. Saving the template remains a separate user action. */
export async function generateCustomStylePreviewDraft(
  config: AppConfig,
  appDataDirectory: string,
  style: CustomStyle,
  generate: typeof generateImageLabRecord = generateImageLabRecord,
): Promise<CustomStyle> {
  const { preview: _previousPreview, ...draft } = style;
  const workDir = join(appDataDirectory, 'custom-style-previews', randomUUID());
  await mkdir(workDir, { recursive: true });
  const record = await generate(config, workDir, {
    prompt: CUSTOM_STYLE_PREVIEW_SUBJECT,
    ratio: '16:9',
    style: draft.id,
    resolution: '1K',
    quality: 'medium',
    smartMode: 'text-to-image',
  }, undefined, draft);
  if (record.status !== 'generated' || !record.imagePath) {
    throw new Error(`CUSTOM_STYLE_PREVIEW_FAILED: ${record.errorMessage || '生图模型没有返回有效的模板样图。'}`);
  }
  const relativePath = relative(resolve(workDir), resolve(record.imagePath));
  if (!relativePath || isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
    throw new Error('CUSTOM_STYLE_PREVIEW_INVALID_OUTPUT: 模板样图未保存在本次生成目录中。');
  }
  const output = await stat(record.imagePath);
  if (!output.isFile() || output.size === 0) {
    throw new Error('CUSTOM_STYLE_PREVIEW_INVALID_OUTPUT: 模板样图文件为空或不可用。');
  }
  return {
    ...draft,
    preview: {
      imagePath: record.imagePath,
      styleSignature: customStylePreviewSignature(draft),
      generatedAt: new Date().toISOString(),
    },
  };
}
