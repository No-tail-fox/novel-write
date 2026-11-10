// HTML-video editorial operations (composition source, preview rebuild, asset/voice replacement), split out of main.ts (O-5).
// The editorial runtime factory itself stays in main.ts so the bundled-runtime path wiring keeps a single host file.
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { backgroundRemovalFailure } from '../src/shared/background-removal';
import { synchronizeHtmlVideoEditorialArtifacts, synchronizeHtmlVideoPipelineCheckpoint } from '../src/shared/html-video-runner';
import { htmlVideoVisibleSteps, isHtmlVideoTask, parseHtmlVideoPipelineData } from '../src/shared/html-video-workflow';
import { MAX_HYPERFRAMES_SOURCE_BYTES } from '../src/shared/hyperframes';
import type { projectRuntimeConfig } from '../src/shared/project-models';
import type { FileDatabase } from '../src/shared/storage';
import { createHtmlVideoRuntimeProviders } from '../src/shared/task-runtime-providers';
import type { AppDelta, BackgroundRemovalMetadata, HtmlVideoAsset, HtmlVideoAssetTarget, HtmlVideoCompositionSource, HtmlVideoPipelineDataV2, HtmlVideoSceneChange, HtmlVideoVoiceClip, Task } from '../src/shared/types';
import {
  createHtmlVideoMediaUrl,
  resolveHtmlVideoMediaUrl,
  type createElectronHtmlVideoRuntime,
  type resolveExistingHtmlVideoTaskWorkDir,
} from './html-video-runtime';
import type { createMediaAssetProcessing } from './media-asset-processing';

type MediaAssetProcessing = ReturnType<typeof createMediaAssetProcessing>;
type HtmlVideoTaskDirectory = Awaited<ReturnType<typeof resolveExistingHtmlVideoTaskWorkDir>>;

export interface HtmlVideoEditorialDependencies extends Pick<
  MediaAssetProcessing,
  | 'inspectHtmlVideoAssetTransparency'
  | 'inspectHtmlVideoAssetBackgroundRemoval'
  | 'prepareHtmlVideoForegroundAsset'
  | 'prepareHtmlVideoCoverImage'
  | 'resolveHtmlVideoBackgroundRemovalModel'
  | 'removeHtmlVideoImageBackground'
  | 'errorCodeFromBackgroundRemovalError'
  | 'sha256File'
> {
  htmlVideoTaskDirectory: (taskId: string) => Promise<HtmlVideoTaskDirectory>;
  createHtmlVideoEditorialRuntime: (task: Task, options?: { maxLongEdge?: number }) => Promise<{
    taskDirectory: HtmlVideoTaskDirectory;
    runtimeConfig: ReturnType<typeof projectRuntimeConfig>;
    runtime: ReturnType<typeof createElectronHtmlVideoRuntime>;
  }>;
  publishTaskUpsert: (database: FileDatabase, taskId: string, cached?: boolean) => Promise<AppDelta | null>;
}

export function createHtmlVideoEditorial(deps: HtmlVideoEditorialDependencies) {
const {
  htmlVideoTaskDirectory,
  createHtmlVideoEditorialRuntime,
  publishTaskUpsert,
  inspectHtmlVideoAssetTransparency,
  inspectHtmlVideoAssetBackgroundRemoval,
  prepareHtmlVideoForegroundAsset,
  prepareHtmlVideoCoverImage,
  resolveHtmlVideoBackgroundRemovalModel,
  removeHtmlVideoImageBackground,
  errorCodeFromBackgroundRemovalError,
  sha256File,
} = deps;

async function loadHtmlVideoCompositionSource(
  database: FileDatabase,
  taskId: string,
  sceneIndex: number,
): Promise<HtmlVideoCompositionSource> {
  const task = await getHtmlVideoTask(database, taskId);
  const pipeline = parseHtmlVideoPipelineData(task.pipelineData);
  const composition = pipeline.compositions.find((item) => item.index === sceneIndex);
  if (!composition?.htmlPath) {
    throw new Error(`HTML_VIDEO_COMPOSITION_NOT_FOUND: Scene ${sceneIndex} has no editable composition.`);
  }
  const taskDirectory = await htmlVideoTaskDirectory(taskId);
  const mediaUrl = await createHtmlVideoMediaUrl(taskId, taskDirectory, composition.htmlPath);
  const sourcePath = await resolveHtmlVideoMediaUrl(mediaUrl, () => taskDirectory);
  const sourceStat = await stat(sourcePath);
  if (!sourceStat.isFile() || sourceStat.size <= 0 || sourceStat.size > MAX_HYPERFRAMES_SOURCE_BYTES) {
    throw new Error('HYPERFRAMES_SOURCE_INVALID: HTML 源码文件为空或超过大小限制。');
  }
  const source = await readFile(sourcePath, 'utf8');
  const thumbnailUrl = composition.thumbnailPath
    ? await createHtmlVideoMediaUrl(taskId, taskDirectory, composition.thumbnailPath)
    : undefined;
  return {
    taskId,
    sceneIndex,
    revision: composition.rev ?? 1,
    source,
    mediaUrl,
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    durationSec: composition.durationSec,
    canvas: composition.canvas,
  };
}

async function getHtmlVideoTask(database: FileDatabase, id: string): Promise<Task> {
  const task = await database.getTaskDetail(id);
  if (!task || !isHtmlVideoTask(task)) {
    throw new Error('HTML_VIDEO_TASK_NOT_FOUND: HTML 视频任务不存在。');
  }
  return task;
}

async function getEditableHtmlVideoTask(database: FileDatabase, id: string): Promise<Task> {
  const task = await getHtmlVideoTask(database, id);
  if (task.archivedAt) throw new Error('HISTORY_ARCHIVED: 已归档任务只读。');
  if (task.status === 'pending' || task.status === 'running') {
    throw new Error(`HTML_VIDEO_EDITOR_ACTIVE: ${id} is ${task.status} and cannot be edited.`);
  }
  return task;
}

function htmlVideoSceneChangeAffectsPreview(field: HtmlVideoSceneChange['field']): boolean {
  return !['narration', 'backgroundPrompt', 'addElement', 'elementPrompt'].includes(field);
}

async function rebuildHtmlVideoEditorialPreviews(
  database: FileDatabase,
  task: Task,
  pipeline: HtmlVideoPipelineDataV2,
): Promise<HtmlVideoPipelineDataV2> {
  const complete = pipeline.scenes.length > 0 && pipeline.scenes.every((scene) => (
    pipeline.assets.some((asset) => asset.sceneIndex === scene.index && asset.kind === 'bg')
    && pipeline.voices.some((voice) => voice.sceneIndex === scene.index && voice.durationSec > 0)
  ));
  if (!complete) return pipeline;
  const existingCanvas = pipeline.compositions[0]?.canvas
    ?? parseHtmlVideoPipelineData(task.pipelineData).compositions[0]?.canvas;
  const maxLongEdge = existingCanvas
    ? Math.max(existingCanvas.w, existingCanvas.h)
    : undefined;
  const { runtime } = await createHtmlVideoEditorialRuntime(task, { maxLongEdge });
  const draftTemplate = pipeline.config.draftTemplate
    ? await database.getDraftTemplateDetail(pipeline.config.draftTemplate)
    : undefined;
  const previousRevisions = new Map(pipeline.compositions.map((composition) => [composition.index, composition.rev ?? 1]));
  const previews = await runtime.createPreviews({
    scenes: pipeline.scenes,
    assets: pipeline.assets,
    voices: pipeline.voices,
    config: pipeline.config,
    ...(draftTemplate ? { draftTemplate } : {}),
  });
  pipeline.compositions = previews.compositions.map((composition) => ({
    ...composition,
    rev: (previousRevisions.get(composition.index) ?? 0) + 1,
  }));
  pipeline.steps.preview = { status: 'completed', completedAt: Date.now() };
  pipeline.steps.render = { status: 'pending' };
  pipeline.current = 'render';
  delete pipeline.output;
  delete pipeline.configSnapshotHash;
  return pipeline;
}

interface HtmlVideoEditorialEvent {
  type: string;
  tool: string;
  detail: string;
  data: unknown;
}

async function persistHtmlVideoEditorialMutation(
  database: FileDatabase,
  task: Task,
  pipeline: HtmlVideoPipelineDataV2,
  event: HtmlVideoEditorialEvent,
) {
  const taskDirectory = await htmlVideoTaskDirectory(task.id);
  const persistedPipeline = await synchronizeHtmlVideoEditorialArtifacts(
    taskDirectory.workDir.canonicalPath, pipeline, task.inputText,
  );
  await synchronizeHtmlVideoPipelineCheckpoint(taskDirectory.workDir.canonicalPath, persistedPipeline);
  const currentStep = persistedPipeline.current === 'done'
    ? htmlVideoVisibleSteps.length
    : Math.max(0, htmlVideoVisibleSteps.indexOf(persistedPipeline.current));
  const needsResume = persistedPipeline.current !== 'done';
  const now = new Date().toISOString();
  await database.updateTask(task.id, {
    pipelineData: JSON.stringify(persistedPipeline),
    pipelineStep: persistedPipeline.current,
    currentStep,
    ...(needsResume ? { status: 'paused', completedAt: null, outputDir: '' } : {}),
    errorMessage: '',
    failedStep: null,
    retryFromStep: null,
    lastHeartbeatAt: now,
  });
  await database.addTaskEvent(task.id, {
    type: event.type,
    step: currentStep,
    agent: 'HTML Video',
    tool: event.tool,
    detail: event.detail,
    dataJson: JSON.stringify(event.data),
    ts: Date.now(),
  });
  return publishTaskUpsert(database, task.id);
}

async function replaceHtmlVideoEditorialAsset(
  database: FileDatabase,
  task: Task,
  pipeline: HtmlVideoPipelineDataV2,
  target: HtmlVideoAssetTarget,
  sourcePath: string,
  options: { rebuildPreview?: boolean; backgroundRemoval?: BackgroundRemovalMetadata } = {},
): Promise<HtmlVideoPipelineDataV2> {
  const scene = pipeline.scenes.find((item) => item.index === target.sceneIndex);
  if (!scene) throw new Error(`HTML_VIDEO_SCENE_NOT_FOUND: ${target.sceneIndex}`);
  if (target.kind === 'fg' && !scene.elements.some((element) => element.slot === target.slot)) {
    throw new Error(`HTML_VIDEO_ELEMENT_NOT_FOUND: ${target.sceneIndex}/${target.slot}`);
  }
  const extension = extname(sourcePath).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) {
    throw new Error('HTML_VIDEO_ASSET_INVALID: 仅支持 PNG、JPG、JPEG 或 WebP 图片。');
  }
  const sourceStat = await stat(sourcePath);
  if (!sourceStat.isFile() || sourceStat.size <= 0 || sourceStat.size > 512 * 1024 * 1024) {
    throw new Error('HTML_VIDEO_ASSET_INVALID: 图片为空或超过 512 MiB。');
  }
  const taskDirectory = await htmlVideoTaskDirectory(task.id);
  const directory = join(taskDirectory.workDir.canonicalPath, 'editorial-assets');
  await mkdir(directory, { recursive: true });
  const destination = join(
    directory,
    `scene-${String(target.sceneIndex).padStart(3, '0')}-${target.kind}-${target.slot}-${randomUUID()}${extension}`,
  );
  await copyFile(sourcePath, destination);
  const copied = await stat(destination);
  const existing = pipeline.assets.find((asset) => (
    asset.sceneIndex === target.sceneIndex && asset.kind === target.kind && asset.slot === target.slot
  ));
  const prompt = target.kind === 'bg'
    ? scene.background.prompt
    : scene.elements.find((element) => element.slot === target.slot)?.prompt;
  const replacement: HtmlVideoAsset = {
    sceneIndex: target.sceneIndex,
    kind: target.kind,
    slot: target.slot,
    src: destination,
    ...(prompt ? { prompt } : {}),
    ...(target.kind === 'fg'
      ? {
        transparency: await inspectHtmlVideoAssetTransparency(destination) ? 'transparent' as const : 'opaque' as const,
        backgroundRemoval: options.backgroundRemoval ?? await inspectHtmlVideoAssetBackgroundRemoval(destination),
      }
      : {}),
    sizeBytes: copied.size,
  };
  pipeline.assets = existing
    ? pipeline.assets.map((asset) => asset === existing ? replacement : asset)
    : [...pipeline.assets, replacement];
  pipeline.revision += 1;
  delete pipeline.configSnapshotHash;
  return options.rebuildPreview === false ? pipeline : rebuildHtmlVideoEditorialPreviews(database, task, pipeline);
}

async function removeHtmlVideoEditorialAssetBackground(
  database: FileDatabase,
  task: Task,
  pipeline: HtmlVideoPipelineDataV2,
  target: HtmlVideoAssetTarget,
): Promise<{ pipeline: HtmlVideoPipelineDataV2; skipped: boolean; failed: boolean }> {
  if (target.kind !== 'fg') throw new Error('HTML_VIDEO_BACKGROUND_TARGET_INVALID: 只能处理前景素材。');
  const asset = pipeline.assets.find((candidate) => (
    candidate.sceneIndex === target.sceneIndex && candidate.kind === 'fg' && candidate.slot === target.slot
  ));
  if (!asset) throw new Error(`HTML_VIDEO_ASSET_NOT_FOUND: ${target.sceneIndex}/fg/${target.slot}`);
  const nativeMetadata = await inspectHtmlVideoAssetBackgroundRemoval(asset.src);
  if (nativeMetadata.quality === 'passed') {
    pipeline.assets = pipeline.assets.map((candidate) => candidate === asset
      ? { ...candidate, transparency: 'transparent', backgroundRemoval: asset.backgroundRemoval?.quality === 'passed' ? asset.backgroundRemoval : nativeMetadata }
      : candidate);
    pipeline.revision += 1;
    return { pipeline, skipped: true, failed: false };
  }

  const temporaryPath = join(dirname(asset.src), `.${randomUUID()}-remove-background.png`);
  try {
    const model = await resolveHtmlVideoBackgroundRemovalModel();
    const backgroundRemoval = await removeHtmlVideoImageBackground(asset.src, temporaryPath, model);
    const replaced = await replaceHtmlVideoEditorialAsset(database, task, pipeline, target, temporaryPath, { backgroundRemoval });
    return { pipeline: replaced, skipped: false, failed: false };
  } catch (error) {
    const metadata = backgroundRemovalFailure(
      'onnx',
      errorCodeFromBackgroundRemovalError(error),
      error instanceof Error ? error.message : String(error),
      { sourceSha256: await sha256File(asset.src) },
    );
    pipeline.assets = pipeline.assets.map((candidate) => candidate === asset
      ? { ...candidate, transparency: 'opaque', backgroundRemoval: metadata }
      : candidate);
    pipeline.revision += 1;
    return { pipeline, skipped: false, failed: true };
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function removeAllHtmlVideoEditorialAssetBackgrounds(
  database: FileDatabase,
  task: Task,
  pipeline: HtmlVideoPipelineDataV2,
): Promise<{ pipeline: HtmlVideoPipelineDataV2; completed: number; skipped: number; failed: number }> {
  const targets = pipeline.assets
    .filter((asset) => asset.kind === 'fg')
    .map((asset) => ({ asset, target: { sceneIndex: asset.sceneIndex, kind: 'fg' as const, slot: asset.slot } }));
  if (targets.length === 0) throw new Error('HTML_VIDEO_FOREGROUND_EMPTY: 没有前景素材可去背景。');

  let completed = 0;
  let skipped = 0;
  let failed = 0;
  let metadataChanged = false;
  let model: Awaited<ReturnType<typeof resolveHtmlVideoBackgroundRemovalModel>> | null = null;
  let lastError: unknown;
  for (const item of targets) {
    const currentAsset = pipeline.assets.find((candidate) => (
      candidate.sceneIndex === item.target.sceneIndex && candidate.kind === 'fg' && candidate.slot === item.target.slot
    ));
    if (!currentAsset) continue;
    const nativeMetadata = await inspectHtmlVideoAssetBackgroundRemoval(currentAsset.src);
    if (nativeMetadata.quality === 'passed') {
      if (currentAsset.transparency !== 'transparent' || currentAsset.backgroundRemoval?.quality !== 'passed') {
        pipeline.assets = pipeline.assets.map((candidate) => candidate === currentAsset
          ? { ...candidate, transparency: 'transparent', backgroundRemoval: currentAsset.backgroundRemoval?.quality === 'passed' ? currentAsset.backgroundRemoval : nativeMetadata }
          : candidate);
        metadataChanged = true;
      }
      skipped += 1;
      continue;
    }

    const temporaryPath = join(dirname(currentAsset.src), `.${randomUUID()}-remove-background.png`);
    try {
      model ??= await resolveHtmlVideoBackgroundRemovalModel();
      const backgroundRemoval = await removeHtmlVideoImageBackground(currentAsset.src, temporaryPath, model);
      pipeline = await replaceHtmlVideoEditorialAsset(database, task, pipeline, item.target, temporaryPath, { rebuildPreview: false, backgroundRemoval });
      completed += 1;
    } catch (error) {
      lastError = error;
      failed += 1;
      const metadata = backgroundRemovalFailure(
        'onnx',
        errorCodeFromBackgroundRemovalError(error),
        error instanceof Error ? error.message : String(error),
        { sourceSha256: await sha256File(currentAsset.src) },
      );
      pipeline.assets = pipeline.assets.map((candidate) => candidate === currentAsset
        ? { ...candidate, transparency: 'opaque', backgroundRemoval: metadata }
        : candidate);
      metadataChanged = true;
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
  if (metadataChanged) pipeline.revision += 1;
  if (completed > 0) pipeline = await rebuildHtmlVideoEditorialPreviews(database, task, pipeline);
  return { pipeline, completed, skipped, failed };
}

async function regenerateHtmlVideoEditorialAsset(
  database: FileDatabase,
  task: Task,
  pipeline: HtmlVideoPipelineDataV2,
  target: HtmlVideoAssetTarget,
): Promise<HtmlVideoPipelineDataV2> {
  const scene = pipeline.scenes.find((item) => item.index === target.sceneIndex);
  if (!scene) throw new Error(`HTML_VIDEO_SCENE_NOT_FOUND: ${target.sceneIndex}`);
  const { taskDirectory, runtimeConfig, runtime } = await createHtmlVideoEditorialRuntime(task);
  const stageDirectory = join(taskDirectory.workDir.canonicalPath, '.editorial-regenerate', randomUUID());
  await mkdir(stageDirectory, { recursive: true });
  try {
    const providers = createHtmlVideoRuntimeProviders(runtimeConfig, stageDirectory, task, {
      measureAudioDuration: runtime.measureAudioDuration,
      jobConfig: pipeline.config,
      imageStyle: await database.getCustomStyleDetail(pipeline.config.style ?? ''),
      inspectAssetTransparency: inspectHtmlVideoAssetTransparency,
      inspectAssetBackgroundRemoval: inspectHtmlVideoAssetBackgroundRemoval,
      prepareForegroundAsset: prepareHtmlVideoForegroundAsset,
      prepareCoverImage: prepareHtmlVideoCoverImage,
    });
    const requestedScene = target.kind === 'bg'
      ? { ...scene, elements: [] }
      : { ...scene, elements: scene.elements.filter((element) => element.slot === target.slot) };
    if (target.kind === 'fg' && requestedScene.elements.length === 0) {
      throw new Error(`HTML_VIDEO_ELEMENT_NOT_FOUND: ${target.sceneIndex}/${target.slot}`);
    }
    const generated = await providers.generateAssets({
      scenes: [requestedScene],
      config: { ...pipeline.config, foreground: target.kind === 'fg' },
    });
    const selected = generated.find((asset) => asset.kind === target.kind && asset.slot === target.slot);
    if (!selected) throw new Error('HTML_VIDEO_ASSET_GENERATION_FAILED: 图片服务没有返回目标素材。');
    return await replaceHtmlVideoEditorialAsset(database, task, pipeline, target, selected.src, {
      ...(selected.backgroundRemoval ? { backgroundRemoval: selected.backgroundRemoval } : {}),
    });
  } finally {
    await rm(stageDirectory, { recursive: true, force: true });
  }
}

async function regenerateHtmlVideoEditorialVoice(
  database: FileDatabase,
  task: Task,
  pipeline: HtmlVideoPipelineDataV2,
  sceneIndex: number,
): Promise<HtmlVideoPipelineDataV2> {
  const scene = pipeline.scenes.find((item) => item.index === sceneIndex);
  if (!scene) throw new Error(`HTML_VIDEO_SCENE_NOT_FOUND: ${sceneIndex}`);
  const { taskDirectory, runtimeConfig, runtime } = await createHtmlVideoEditorialRuntime(task);
  const stageDirectory = join(taskDirectory.workDir.canonicalPath, '.editorial-regenerate', randomUUID());
  await mkdir(stageDirectory, { recursive: true });
  try {
    const providers = createHtmlVideoRuntimeProviders(runtimeConfig, stageDirectory, task, {
      measureAudioDuration: runtime.measureAudioDuration,
      jobConfig: pipeline.config,
      imageStyle: await database.getCustomStyleDetail(pipeline.config.style ?? ''),
      inspectAssetTransparency: inspectHtmlVideoAssetTransparency,
      inspectAssetBackgroundRemoval: inspectHtmlVideoAssetBackgroundRemoval,
      prepareForegroundAsset: prepareHtmlVideoForegroundAsset,
      prepareCoverImage: prepareHtmlVideoCoverImage,
    });
    const generated = await providers.synthesizeVoices({ scenes: [scene], config: pipeline.config });
    const voice = generated[0];
    if (!voice) throw new Error('HTML_VIDEO_VOICE_GENERATION_FAILED: 配音服务没有返回音频。');
    const extension = extname(voice.src).toLowerCase() || '.wav';
    const directory = join(taskDirectory.workDir.canonicalPath, 'editorial-voices');
    await mkdir(directory, { recursive: true });
    const destination = join(directory, `scene-${String(sceneIndex).padStart(3, '0')}-${randomUUID()}${extension}`);
    await copyFile(voice.src, destination);
    const copied = await stat(destination);
    const replacement: HtmlVideoVoiceClip = { ...voice, sceneIndex, src: destination, sizeBytes: copied.size };
    const existing = pipeline.voices.find((item) => item.sceneIndex === sceneIndex);
    pipeline.voices = existing
      ? pipeline.voices.map((item) => item === existing ? replacement : item)
      : [...pipeline.voices, replacement];
    pipeline.revision += 1;
    delete pipeline.configSnapshotHash;
    return await rebuildHtmlVideoEditorialPreviews(database, task, pipeline);
  } finally {
    await rm(stageDirectory, { recursive: true, force: true });
  }
}

  return {
    loadHtmlVideoCompositionSource,
    getHtmlVideoTask,
    getEditableHtmlVideoTask,
    htmlVideoSceneChangeAffectsPreview,
    rebuildHtmlVideoEditorialPreviews,
    persistHtmlVideoEditorialMutation,
    replaceHtmlVideoEditorialAsset,
    removeHtmlVideoEditorialAssetBackground,
    removeAllHtmlVideoEditorialAssetBackgrounds,
    regenerateHtmlVideoEditorialAsset,
    regenerateHtmlVideoEditorialVoice,
  };
}
