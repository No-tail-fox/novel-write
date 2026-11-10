// HTML-video cover/foreground preparation, image-lab cutouts and ordinary task cover staging, split out of main.ts (O-5).
import { nativeImage } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { BACKGROUND_REMOVAL_ERROR_CODES } from '../src/shared/background-removal';
import { type HtmlVideoBackgroundRemovalModel } from '../src/shared/html-video-background-removal';
import { MAX_HTML_VIDEO_COVER_BYTES, type HtmlVideoCoverImageProcessor, type HtmlVideoCoverInspection } from '../src/shared/html-video-cover';
import {
  MAX_ORDINARY_TASK_COVER_BYTES,
  createOrdinaryTaskCoverAsset,
  createOrdinaryTaskCoverSelection,
  ordinaryTaskCoverDimensions,
  validateOrdinaryTaskCoverInspection,
  validateOrdinaryTaskCoverSelection,
  type OrdinaryTaskCoverImageProcessor,
  type OrdinaryTaskCoverInspection,
} from '../src/shared/ordinary-task-cover';
import type { BackgroundRemovalMetadata, BackgroundRemovalMethod, ImageLabRecord, OrdinaryTaskCoverRatio, OrdinaryTaskCoverSelection } from '../src/shared/types';
import { ensureBackgroundRemovalModel } from './background-removal-model';
import { inspectImageBackgroundRemoval, removeImageBackground } from './background-removal';

export interface MediaAssetProcessingDependencies {
  appDataDir: () => string;
  artifactDataDir: () => string;
  /** Directory of the bundled Electron main script (main.ts passes its own __dirname). */
  electronDir: string;
}

export function createMediaAssetProcessing({ appDataDir, artifactDataDir, electronDir }: MediaAssetProcessingDependencies) {
async function inspectHtmlVideoCoverImage(sourcePath: string): Promise<HtmlVideoCoverInspection> {
  const value = await stat(sourcePath);
  if (!value.isFile() || value.size <= 0 || value.size > MAX_HTML_VIDEO_COVER_BYTES) {
    throw new Error(`HTML_VIDEO_COVER_SOURCE_INVALID: 封面图片必须是 1 到 ${MAX_HTML_VIDEO_COVER_BYTES} 字节的普通文件。`);
  }
  const extension = extname(sourcePath).toLowerCase();
  const mimeType = extension === '.png'
    ? 'image/png'
    : extension === '.jpg' || extension === '.jpeg'
      ? 'image/jpeg'
      : extension === '.webp'
        ? 'image/webp'
        : '';
  if (!mimeType) throw new Error('HTML_VIDEO_COVER_SOURCE_INVALID: 封面图片格式不受支持。');
  const image = nativeImage.createFromPath(sourcePath);
  if (image.isEmpty()) throw new Error('HTML_VIDEO_COVER_SOURCE_INVALID: 无法解码所选封面图片。');
  const size = image.getSize();
  return {
    sourcePath,
    exists: true,
    isFile: true,
    sizeBytes: value.size,
    width: size.width,
    height: size.height,
    mimeType,
  };
}

const prepareHtmlVideoCoverImage: HtmlVideoCoverImageProcessor = async (input) => {
  input.signal?.throwIfAborted();
  const value = await stat(input.sourcePath);
  if (!value.isFile() || value.size <= 0 || value.size > MAX_HTML_VIDEO_COVER_BYTES) {
    throw new Error('HTML_VIDEO_COVER_SOURCE_INVALID: 封面图片文件大小无效。');
  }
  const source = nativeImage.createFromPath(input.sourcePath);
  if (source.isEmpty()) throw new Error('HTML_VIDEO_COVER_SOURCE_INVALID: 无法解码封面图片。');
  const resized = source.resize({
    width: input.dimensions.width,
    height: input.dimensions.height,
    quality: 'best',
  });
  const size = resized.getSize();
  if (size.width !== input.dimensions.width || size.height !== input.dimensions.height) {
    throw new Error('HTML_VIDEO_COVER_DIMENSIONS_INVALID: 无法生成精确尺寸的封面图片。');
  }
  input.signal?.throwIfAborted();
  const bytes = resized.toPNG();
  if (bytes.length <= 0 || bytes.length > MAX_HTML_VIDEO_COVER_BYTES) {
    throw new Error('HTML_VIDEO_COVER_OUTPUT_INVALID: 规范化后的封面图片大小无效。');
  }
  await writeFile(input.destinationPath, bytes, { flag: 'wx' });
  input.signal?.throwIfAborted();
  return {
    sizeBytes: bytes.length,
    width: size.width,
    height: size.height,
    mimeType: 'image/png',
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
};

async function inspectHtmlVideoAssetTransparency(sourcePath: string): Promise<boolean> {
  return (await inspectImageBackgroundRemoval(sourcePath)).quality === 'passed';
}

const inspectHtmlVideoAssetBackgroundRemoval = inspectImageBackgroundRemoval;

// Keep local segmentation bounded even when the image provider runs in parallel.
let htmlVideoForegroundPreparationQueue = Promise.resolve();
function prepareHtmlVideoForegroundAsset(sourcePath: string, signal?: AbortSignal): Promise<{ src: string; backgroundRemoval: BackgroundRemovalMetadata }> {
  const operation = htmlVideoForegroundPreparationQueue.then(async () => {
    signal?.throwIfAborted();
    const outputPath = imageLabCutoutPath(sourcePath);
    try {
      const model = await resolveHtmlVideoBackgroundRemovalModel();
      signal?.throwIfAborted();
      const backgroundRemoval = await removeHtmlVideoImageBackground(sourcePath, outputPath, model);
      signal?.throwIfAborted();
      return { src: outputPath, backgroundRemoval };
    } catch (error) {
      await rm(outputPath, { force: true });
      throw error;
    }
  });
  htmlVideoForegroundPreparationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}


async function sha256File(sourcePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(sourcePath)).digest('hex');
}

function imageLabCutoutPath(sourcePath: string): string {
  return join(dirname(sourcePath), `${basename(sourcePath, extname(sourcePath))}.cutout-${randomUUID()}.png`);
}

function errorCodeFromBackgroundRemovalError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/\b(BACKGROUND_REMOVAL_[A-Z0-9_]+|EDITORIAL_CUTOUT_[A-Z0-9_]+|HTML_VIDEO_BACKGROUND_[A-Z0-9_]+)\b/);
  return match?.[1] ?? BACKGROUND_REMOVAL_ERROR_CODES.workerFailed;
}

async function removeImageLabBackgroundFromSource(
  sourcePath: string,
  method: BackgroundRemovalMethod,
): Promise<{ outputPath: string; metadata: BackgroundRemovalMetadata }> {
  const sourceSha256 = await sha256File(sourcePath);
  const outputPath = imageLabCutoutPath(sourcePath);
  try {
    const metadata = await removeImageBackground(sourcePath, outputPath, {
      method, modelDirectory: join(appDataDir(), 'models'), workerPath: join(electronDir, 'remove-background-worker.py'),
    });
    return { outputPath, metadata };
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      code: errorCodeFromBackgroundRemovalError(error), sourceSha256,
    });
  }
}

function imageLabCutoutFields(metadata: BackgroundRemovalMetadata, outputPath?: string): Partial<ImageLabRecord> {
  return {
    ...(outputPath ? { cutoutImagePath: outputPath, ...(metadata.quality === 'passed' ? { imagePath: outputPath } : {}) } : {}),
    cutoutMethod: metadata.method,
    cutoutModel: metadata.model ?? '',
    cutoutModelVersion: metadata.modelVersion ?? '',
    cutoutModelSha256: metadata.modelSha256 ?? '',
    cutoutSourceSha256: metadata.sourceSha256 ?? '',
    cutoutOutputSha256: metadata.outputSha256 ?? '',
    cutoutTransparentFraction: metadata.transparentFraction,
    cutoutForegroundFraction: metadata.foregroundFraction,
    cutoutEdgeFraction: metadata.edgeFraction,
    cutoutQuality: metadata.quality,
    cutoutErrorCode: metadata.errorCode ?? '',
    cutoutErrorMessage: metadata.errorMessage ?? '',
  };
}

async function resolveHtmlVideoBackgroundRemovalModel(): Promise<HtmlVideoBackgroundRemovalModel> {
  return ensureBackgroundRemovalModel(join(appDataDir(), 'models'));
}

async function removeHtmlVideoImageBackground(
  inputPath: string,
  outputPath: string,
  model: Awaited<ReturnType<typeof resolveHtmlVideoBackgroundRemovalModel>>,
): Promise<BackgroundRemovalMetadata> {
  const metadata = await removeImageBackground(inputPath, outputPath, {
    method: 'onnx', modelDirectory: join(appDataDir(), 'models'), workerPath: join(electronDir, 'remove-background-worker.py'), model,
  });
  if (metadata.quality !== 'passed') throw Object.assign(new Error(`${metadata.errorCode ?? 'BACKGROUND_REMOVAL_EDGE_REVIEW'}: 去底结果未通过 alpha 质量评估，原图已保留。`), { backgroundRemoval: metadata });
  return metadata;
}

function ordinaryTaskCoverPendingPaths(id: string): { image: string; metadata: string } {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(id)) {
    throw new Error('ORDINARY_MANUAL_COVER_ID_INVALID: 手动封面资产标识无效。');
  }
  const root = join(artifactDataDir(), 'pending-task-covers');
  return { image: join(root, `${id}.png`), metadata: join(root, `${id}.json`) };
}

async function inspectOrdinaryTaskCoverImage(
  sourcePath: string,
  ratio: OrdinaryTaskCoverRatio,
): Promise<OrdinaryTaskCoverInspection & { sourceBytes: Uint8Array }> {
  const value = await stat(sourcePath);
  if (!value.isFile()) {
    throw new Error('ORDINARY_MANUAL_COVER_SOURCE_INVALID: 封面图片必须是普通文件。');
  }
  const sourceBytes = await readFile(sourcePath);
  if (sourceBytes.length <= 0 || sourceBytes.length > MAX_ORDINARY_TASK_COVER_BYTES) {
    throw new Error(`ORDINARY_MANUAL_COVER_SOURCE_INVALID: 封面图片必须是 1 到 ${MAX_ORDINARY_TASK_COVER_BYTES} 字节的普通文件。`);
  }
  const extension = extname(sourcePath).toLowerCase();
  const mimeType = extension === '.png'
    ? 'image/png'
    : extension === '.jpg' || extension === '.jpeg'
      ? 'image/jpeg'
      : extension === '.webp'
        ? 'image/webp'
        : '';
  if (!mimeType) throw new Error('ORDINARY_MANUAL_COVER_SOURCE_INVALID: 封面图片格式不受支持。');
  const image = nativeImage.createFromBuffer(sourceBytes);
  if (image.isEmpty()) throw new Error('ORDINARY_MANUAL_COVER_SOURCE_INVALID: 无法解码所选封面图片。');
  const size = image.getSize();
  const inspection = validateOrdinaryTaskCoverInspection({
    sourcePath,
    exists: true,
    isFile: true,
    sizeBytes: sourceBytes.length,
    width: size.width,
    height: size.height,
    mimeType,
    originalName: basename(sourcePath),
  }, ratio);
  return { ...inspection, sourceBytes };
}

const prepareOrdinaryTaskCoverImage: OrdinaryTaskCoverImageProcessor = async (input) => {
  const source = nativeImage.createFromBuffer(Buffer.from(input.sourceBytes));
  if (source.isEmpty()) throw new Error('ORDINARY_MANUAL_COVER_SOURCE_INVALID: 无法解码封面图片。');
  const resized = source.resize({ width: input.dimensions.width, height: input.dimensions.height, quality: 'best' });
  const size = resized.getSize();
  if (size.width !== input.dimensions.width || size.height !== input.dimensions.height) {
    throw new Error('ORDINARY_MANUAL_COVER_DIMENSIONS_INVALID: 无法生成精确尺寸的封面图片。');
  }
  const bytes = resized.toPNG();
  if (bytes.length <= 0 || bytes.length > MAX_ORDINARY_TASK_COVER_BYTES) {
    throw new Error('ORDINARY_MANUAL_COVER_OUTPUT_INVALID: 规范化后的封面图片大小无效。');
  }
  await writeFile(input.destinationPath, bytes, { flag: 'wx' });
  return {
    sizeBytes: bytes.length,
    width: size.width,
    height: size.height,
    mimeType: 'image/png',
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
};

async function stageOrdinaryTaskCover(
  inspection: OrdinaryTaskCoverInspection & { sourceBytes: Uint8Array },
  ratio: OrdinaryTaskCoverRatio,
): Promise<OrdinaryTaskCoverSelection> {
  validateOrdinaryTaskCoverInspection(inspection, ratio);
  const id = randomUUID();
  const paths = ordinaryTaskCoverPendingPaths(id);
  const root = dirname(paths.image);
  const tempImage = join(root, `.${id}-${randomUUID()}.tmp`);
  await mkdir(root, { recursive: true });
  try {
    const prepared = await prepareOrdinaryTaskCoverImage({
      sourcePath: inspection.sourcePath,
      sourceBytes: inspection.sourceBytes,
      destinationPath: tempImage,
      dimensions: ordinaryTaskCoverDimensions(ratio),
    });
    const asset = createOrdinaryTaskCoverAsset({
      path: 'covers/cover-manual.png',
      originalName: basename(inspection.originalName || inspection.sourcePath).slice(0, 512),
      ...prepared,
      ratio,
      createdAt: new Date().toISOString(),
    });
    const selection = createOrdinaryTaskCoverSelection(id, asset);
    await rename(tempImage, paths.image);
    await writeFile(paths.metadata, JSON.stringify(selection), { encoding: 'utf8', flag: 'wx' });
    return selection;
  } catch (error) {
    await Promise.all([
      rm(tempImage, { force: true }),
      rm(paths.image, { force: true }),
      rm(paths.metadata, { force: true }),
    ]).catch(() => undefined);
    throw error;
  }
}

async function readStagedOrdinaryTaskCover(id: string): Promise<{
  selection: OrdinaryTaskCoverSelection;
  inspection: OrdinaryTaskCoverInspection;
  bytes: Uint8Array;
}> {
  const paths = ordinaryTaskCoverPendingPaths(id);
  const selection = validateOrdinaryTaskCoverSelection(JSON.parse(await readFile(paths.metadata, 'utf8')));
  if (selection.id !== id) throw new Error('ORDINARY_MANUAL_COVER_ID_INVALID: 手动封面元数据不匹配。');
  const inspected = await inspectOrdinaryTaskCoverImage(paths.image, selection.ratio);
  const { sourceBytes: bytes, ...inspection } = inspected;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== selection.sizeBytes || sha256 !== selection.sha256) {
    throw new Error('ORDINARY_MANUAL_COVER_TAMPERED: 手动封面暂存文件已变化，请重新导入。');
  }
  return {
    selection,
    inspection: { ...inspection, originalName: selection.originalName },
    bytes,
  };
}

async function removeStagedOrdinaryTaskCover(id: string): Promise<void> {
  const paths = ordinaryTaskCoverPendingPaths(id);
  await Promise.all([rm(paths.image, { force: true }), rm(paths.metadata, { force: true })]);
}

  return {
    inspectHtmlVideoCoverImage,
    prepareHtmlVideoCoverImage,
    inspectHtmlVideoAssetTransparency,
    inspectHtmlVideoAssetBackgroundRemoval,
    prepareHtmlVideoForegroundAsset,
    sha256File,
    errorCodeFromBackgroundRemovalError,
    removeImageLabBackgroundFromSource,
    imageLabCutoutFields,
    resolveHtmlVideoBackgroundRemovalModel,
    removeHtmlVideoImageBackground,
    inspectOrdinaryTaskCoverImage,
    prepareOrdinaryTaskCoverImage,
    stageOrdinaryTaskCover,
    readStagedOrdinaryTaskCover,
    removeStagedOrdinaryTaskCover,
  };
}
