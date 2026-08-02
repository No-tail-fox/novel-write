import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { resolveOpenAiImageQuality, resolveOpenAiImageSize, type OpenAiImageQuality, type OpenAiImageResolution } from './openai-image';

export async function buildOpenAiImageEditFormData(input: {
  model: string;
  prompt: string;
  ratio: string;
  resolution: OpenAiImageResolution;
  quality?: OpenAiImageQuality;
  referenceImagePaths: string[];
}): Promise<FormData> {
  if (input.referenceImagePaths.length < 1) {
    throw new Error('Image edit requires at least 1 reference image.');
  }
  if (input.referenceImagePaths.length > 10) {
    throw new Error('Image edit supports at most 10 reference images.');
  }
  const form = new FormData();
  form.set('model', input.model);
  form.set('prompt', input.prompt);
  form.set('size', resolveOpenAiImageSize(input.ratio));
  form.set('quality', input.quality ?? resolveOpenAiImageQuality(input.resolution));
  form.set('output_format', 'png');
  for (const path of input.referenceImagePaths) {
    const bytes = await readFile(path);
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    form.append('image', new Blob([arrayBuffer], { type: imageMimeType(path) }), basename(path));
  }
  return form;
}

function imageMimeType(path: string): string {
  const extension = extname(path).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  return 'image/png';
}
