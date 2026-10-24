import { nativeImage } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, readFile, stat, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { ensureBackgroundRemovalModel } from './background-removal-model';
import { resolvePythonRuntimeInfo } from '../src/shared/python-runtime';
import { inspectEditorialBitmapAlpha, removeEditorialGreenBackground } from '../src/shared/editorial-cutout';
import { BACKGROUND_REMOVAL_ERROR_CODES, backgroundRemovalMetadataFromAlpha } from '../src/shared/background-removal';
import type { BackgroundRemovalMetadata, BackgroundRemovalMethod } from '../src/shared/types';
import type { HtmlVideoBackgroundRemovalModel } from '../src/shared/html-video-background-removal';

const execute = promisify(execFile);
const digest = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex');

async function inspect(path: string) {
  const file = await stat(path);
  const image = nativeImage.createFromPath(path);
  if (!file.isFile() || !file.size || image.isEmpty()) throw new Error(`${BACKGROUND_REMOVAL_ERROR_CODES.invalidSource}: 无法读取原图。`);
  const { width, height } = image.getSize();
  return { image, width, height, metrics: inspectEditorialBitmapAlpha(image.toBitmap(), width, height) };
}

export async function inspectImageBackgroundRemoval(path: string): Promise<BackgroundRemovalMetadata> {
  const { metrics } = await inspect(path);
  const sha256 = await digest(path);
  return backgroundRemovalMetadataFromAlpha('native-alpha', metrics, { sourceSha256: sha256, outputSha256: sha256 });
}

/** Shared non-generative path: native alpha, suitable chroma key, then segmentation. */
export async function removeImageBackground(inputPath: string, outputPath: string, options: {
  method?: BackgroundRemovalMethod;
  modelDirectory: string;
  workerPath: string;
  model?: HtmlVideoBackgroundRemovalModel;
}): Promise<BackgroundRemovalMetadata> {
  const source = await inspect(inputPath);
  const sourceSha256 = await digest(inputPath);
  const native = backgroundRemovalMetadataFromAlpha('native-alpha', source.metrics, { sourceSha256, outputSha256: sourceSha256 });
  if (native.quality === 'passed' || options.method === 'native-alpha') {
    if (inputPath !== outputPath) await copyFile(inputPath, outputPath);
    return native;
  }
  if (options.method === 'green-key') {
    try {
      const keyed = removeEditorialGreenBackground(source.image.toBitmap(), source.width, source.height);
      const png = nativeImage.createFromBitmap(Buffer.from(keyed.bitmap), { width: source.width, height: source.height, scaleFactor: 1 }).toPNG();
      await writeFile(outputPath, png);
      const metadata = backgroundRemovalMetadataFromAlpha('green-key', (await inspect(outputPath)).metrics, { sourceSha256, outputSha256: await digest(outputPath) });
      if (metadata.quality === 'passed') return metadata;
    } catch (error) {
      if (!(error instanceof Error) || !/EDITORIAL_CUTOUT_(?:BACKGROUND_NOT_ISOLATED|EMPTY_FOREGROUND)/u.test(error.message)) throw error;
    }
  }
  if (!existsSync(options.workerPath)) throw new Error(`${BACKGROUND_REMOVAL_ERROR_CODES.workerMissing}: 本地抠图工具缺失。`);
  const model = options.model ?? await ensureBackgroundRemovalModel(options.modelDirectory);
  const runtime = resolvePythonRuntimeInfo();
  try {
    await execute(runtime.command, [options.workerPath, '--input', inputPath, '--output', outputPath, '--model', model.path, '--model-kind', model.kind], {
      timeout: 600_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(`${BACKGROUND_REMOVAL_ERROR_CODES.workerFailed}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return backgroundRemovalMetadataFromAlpha('onnx', (await inspect(outputPath)).metrics, {
    sourceSha256, outputSha256: await digest(outputPath), model: basename(model.path),
    modelVersion: model.revision ?? model.kind, modelSha256: await digest(model.path),
  });
}
