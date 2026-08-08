import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildSubtitleTrackFromSceneLines } from './story';
import type { ImagePrompt, PipelineArtifact, SubtitleTrack, TaskArtifactAssetPreview, TaskArtifactImageErrorPreview, TaskArtifactSnapshot, TaskArtifactStepPreview, TaskArtifactVideoPreview, TaskStepRerunMode, TaskSubtitleSceneLines } from './types';

interface PipelineStateFile {
  version?: number;
  taskId?: string;
  updatedAt?: string;
  steps?: Record<string, Partial<TaskArtifactStepPreview>>;
  artifact?: Partial<PipelineArtifact>;
  assets?: {
    images?: TaskArtifactAssetPreview[];
    videos?: TaskArtifactVideoPreview[];
    imageErrors?: TaskArtifactImageErrorPreview[];
    narration?: TaskArtifactAssetPreview[];
  };
  draft?: TaskArtifactSnapshot['draft'];
  rerun?: TaskStepRerunMarker;
}

interface TaskStepRerunMarker {
  step: number;
  mode: TaskStepRerunMode;
  requestedAt: string;
  context?: Partial<PipelineArtifact>;
}

export interface RegenerateSceneImageResult {
  removed: boolean;
  remainingImages: TaskArtifactAssetPreview[];
}

export interface RegenerateSceneImagesResult {
  removedSceneIds: number[];
  remainingImages: TaskArtifactAssetPreview[];
}

export interface ReplaceSceneImageAssetInput {
  sceneId: number;
  path: string;
  borrowedFrom?: number;
}

export interface ReplaceSceneImageAssetsResult {
  replacedSceneIds: number[];
  images: TaskArtifactAssetPreview[];
}

export interface ReplaceSceneVideoAssetResult {
  video: TaskArtifactVideoPreview;
  videos: TaskArtifactVideoPreview[];
}

export interface RemoveSceneVideoAssetResult {
  removed: boolean;
  videos: TaskArtifactVideoPreview[];
}

export interface RegenerateSceneNarrationResult {
  removed: boolean;
  remainingNarration: TaskArtifactAssetPreview[];
}

export interface TaskStepRerunResult {
  step: number;
  mode: TaskStepRerunMode;
  clearedSteps: number[];
}

export interface UpdateSceneImagePromptResult {
  updatedPrompt: ImagePrompt;
}

export interface UpdateTaskSubtitleLinesResult {
  subtitles: SubtitleTrack;
  sceneCount: number;
}

const pipelineStepMin = 0;
const pipelineStepMax = 6;
const pipelineStateMutationTails = new Map<string, Promise<void>>();

export async function markTaskStepForRerun(statePath: string, step: number, mode: TaskStepRerunMode): Promise<TaskStepRerunResult> {
  const rerunStep = normalizeRerunStep(step);
  if (mode !== 'regenerate' && mode !== 'rewrite') {
    throw new Error(`Unsupported task step rerun mode: ${String(mode)}`);
  }

  return withPipelineStateLock(statePath, async (normalizedStatePath) => {
    const state = JSON.parse(await readFile(normalizedStatePath, 'utf8')) as PipelineStateFile;
    state.steps ??= {};
    state.artifact ??= {};
    state.assets ??= {};

    const context = mode === 'rewrite' ? cloneRerunContext(state.artifact, rerunStep) : undefined;
    state.rerun = {
      step: rerunStep,
      mode,
      requestedAt: new Date().toISOString(),
      ...(context && Object.keys(context).length > 0 ? { context } : {}),
    };

    clearArtifactFromStep(state.artifact, rerunStep);
    clearAssetsFromStep(state, rerunStep);
    const clearedSteps = markStepsPendingFrom(state, rerunStep);
    state.updatedAt = new Date().toISOString();

    await writeFile(normalizedStatePath, JSON.stringify(state, null, 2), 'utf8');
    return { step: rerunStep, mode, clearedSteps };
  });
}

export async function markTaskDraftForRepack(statePath: string): Promise<void> {
  await withPipelineStateLock(statePath, async (normalizedStatePath) => {
    const state = JSON.parse(await readFile(normalizedStatePath, 'utf8')) as PipelineStateFile;
    state.steps ??= {};
    state.steps['6'] = pendingStep(state.steps['6']);
    state.updatedAt = new Date().toISOString();
    await writeFile(normalizedStatePath, JSON.stringify(state, null, 2), 'utf8');
  });
}

export async function updateTaskSubtitleLines(
  statePath: string,
  sceneLines: readonly TaskSubtitleSceneLines[],
): Promise<UpdateTaskSubtitleLinesResult> {
  if (sceneLines.length === 0) throw new Error('At least one storyboard subtitle entry is required.');
  const normalized = sceneLines.map((item) => ({
    sceneId: Number(item.sceneId),
    lines: item.lines.map((line) => line.trim()),
  }));
  const sceneIds = normalizeSceneIds(normalized.map((item) => item.sceneId), 'subtitle update');
  if (sceneIds.length !== normalized.length) throw new Error('Storyboard subtitle entries must use unique scene ids.');
  const emptyLine = normalized.find((item) => item.lines.length === 0 || item.lines.some((line) => !line));
  if (emptyLine) throw new Error(`Storyboard scene ${emptyLine.sceneId} must contain nonempty subtitle lines.`);

  return withPipelineStateLock(statePath, async (normalizedStatePath) => {
    const state = JSON.parse(await readFile(normalizedStatePath, 'utf8')) as PipelineStateFile;
    state.steps ??= {};
    state.artifact ??= {};
    const scenes = state.artifact.scenes ?? [];
    if (scenes.length === 0) throw new Error('Task storyboard is not available for subtitle editing.');
    const knownSceneIds = scenes.map((scene) => Number(scene.id));
    const knownSceneIdSet = new Set(knownSceneIds);
    const unknownSceneId = sceneIds.find((sceneId) => !knownSceneIdSet.has(sceneId));
    if (unknownSceneId !== undefined) throw new Error(`Scene ${unknownSceneId} is not present in the task storyboard.`);
    const missingSceneId = knownSceneIds.find((sceneId) => !sceneIds.includes(sceneId));
    if (missingSceneId !== undefined) throw new Error(`Subtitle lines are missing for storyboard scene ${missingSceneId}.`);

    const subtitles = buildSubtitleTrackFromSceneLines(scenes, normalized);
    state.artifact.subtitles = subtitles;
    state.steps['6'] = pendingStep(state.steps['6']);
    state.updatedAt = new Date().toISOString();
    await writeFile(normalizedStatePath, JSON.stringify(state, null, 2), 'utf8');
    return { subtitles, sceneCount: scenes.length };
  });
}

export async function updateSceneImagePrompt(statePath: string, sceneId: number, prompt: string): Promise<UpdateSceneImagePromptResult> {
  if (!Number.isFinite(sceneId)) {
    throw new Error('Scene id is required for image prompt update.');
  }
  const nextPrompt = prompt.trim();
  if (!nextPrompt) {
    throw new Error('Image prompt cannot be empty.');
  }

  return withPipelineStateLock(statePath, async (normalizedStatePath) => {
    const state = JSON.parse(await readFile(normalizedStatePath, 'utf8')) as PipelineStateFile;
    state.artifact ??= {};
    const imagePrompts = Array.isArray(state.artifact.imagePrompts) ? state.artifact.imagePrompts : [];
    const promptIndex = imagePrompts.findIndex((item) => Number(item.sceneId) === sceneId);
    if (promptIndex < 0) {
      throw new Error(`Image prompt not found for scene ${sceneId}.`);
    }

    const updatedPrompt = { ...imagePrompts[promptIndex], prompt: nextPrompt };
    state.artifact.imagePrompts = [
      ...imagePrompts.slice(0, promptIndex),
      updatedPrompt,
      ...imagePrompts.slice(promptIndex + 1),
    ];
    state.updatedAt = new Date().toISOString();

    await writeFile(normalizedStatePath, JSON.stringify(state, null, 2), 'utf8');
    return { updatedPrompt };
  });
}

export async function markSceneImageForRegeneration(statePath: string, sceneId: number): Promise<RegenerateSceneImageResult> {
  const result = await markSceneImagesForRegeneration(statePath, [sceneId]);
  return { removed: result.removedSceneIds.includes(sceneId), remainingImages: result.remainingImages };
}

export async function markSceneImagesForRegeneration(statePath: string, sceneIds: number[]): Promise<RegenerateSceneImagesResult> {
  const normalizedSceneIds = normalizeSceneIds(sceneIds, 'image regeneration');

  return withPipelineStateLock(statePath, async (normalizedStatePath) => {
    const state = JSON.parse(await readFile(normalizedStatePath, 'utf8')) as PipelineStateFile;
    state.steps ??= {};
    state.assets ??= {};
    const images = Array.isArray(state.assets.images) ? state.assets.images : [];
    const requested = new Set(normalizedSceneIds);
    const removedSceneIds = images
      .filter((asset) => requested.has(Number(asset.sceneId)))
      .map((asset) => Number(asset.sceneId));
    const remainingImages = images.filter((asset) => !requested.has(Number(asset.sceneId)));

    state.assets.images = remainingImages;
    state.assets.imageErrors = (state.assets.imageErrors ?? []).filter((item) => !requested.has(Number(item.sceneId)));
    state.steps['4'] = pendingStep(state.steps['4'], imageOutputPath(remainingImages));
    state.steps['6'] = pendingStep(state.steps['6']);
    delete state.draft;
    state.updatedAt = new Date().toISOString();

    await writeFile(normalizedStatePath, JSON.stringify(state, null, 2), 'utf8');
    return { removedSceneIds: [...new Set(removedSceneIds)], remainingImages };
  });
}

export async function replaceSceneImageAssets(
  statePath: string,
  replacements: ReplaceSceneImageAssetInput[],
): Promise<ReplaceSceneImageAssetsResult> {
  if (replacements.length === 0) throw new Error('At least one task image replacement is required.');
  const normalizedSceneIds = normalizeSceneIds(replacements.map((item) => item.sceneId), 'image replacement');
  if (normalizedSceneIds.length !== replacements.length) {
    throw new Error('Task image replacements must use unique scene ids.');
  }
  for (const replacement of replacements) {
    if (!replacement.path.trim()) throw new Error(`Replacement image path is required for scene ${replacement.sceneId}.`);
  }

  return withPipelineStateLock(statePath, async (normalizedStatePath) => {
    const state = JSON.parse(await readFile(normalizedStatePath, 'utf8')) as PipelineStateFile;
    state.steps ??= {};
    state.artifact ??= {};
    state.assets ??= {};
    const knownSceneIds = new Set((state.artifact.scenes ?? []).map((scene) => Number(scene.id)));
    if (knownSceneIds.size > 0) {
      const unknownSceneId = normalizedSceneIds.find((sceneId) => !knownSceneIds.has(sceneId));
      if (unknownSceneId !== undefined) throw new Error(`Scene ${unknownSceneId} is not present in the task storyboard.`);
    }

    const replacementBySceneId = new Map(replacements.map((item) => [item.sceneId, item] as const));
    const currentImages = Array.isArray(state.assets.images) ? state.assets.images : [];
    const retainedImages = currentImages.filter((asset) => !replacementBySceneId.has(Number(asset.sceneId)));
    const replacementAssets = normalizedSceneIds.map((sceneId) => {
      const replacement = replacementBySceneId.get(sceneId)!;
      return {
        sceneId,
        path: replacement.path.trim(),
        ...(replacement.borrowedFrom === undefined ? {} : { borrowedFrom: replacement.borrowedFrom }),
      } satisfies TaskArtifactAssetPreview;
    });
    const images = [...retainedImages, ...replacementAssets].sort((left, right) => left.sceneId - right.sceneId);
    const replaced = new Set(normalizedSceneIds);
    const updatedAt = new Date().toISOString();

    state.assets.images = images;
    state.assets.imageErrors = (state.assets.imageErrors ?? []).filter((item) => !replaced.has(Number(item.sceneId)));
    const allStoryboardImagesReady = knownSceneIds.size > 0 && [...knownSceneIds].every((sceneId) => images.some((asset) => asset.sceneId === sceneId));
    state.steps['4'] = allStoryboardImagesReady
      ? completedStep(state.steps['4'], imageOutputPath(images), updatedAt)
      : pendingStep(state.steps['4'], imageOutputPath(images));
    state.steps['6'] = pendingStep(state.steps['6']);
    delete state.draft;
    state.updatedAt = updatedAt;

    await writeFile(normalizedStatePath, JSON.stringify(state, null, 2), 'utf8');
    return { replacedSceneIds: normalizedSceneIds, images };
  });
}

export async function replaceSceneVideoAsset(
  statePath: string,
  video: TaskArtifactVideoPreview,
): Promise<ReplaceSceneVideoAssetResult> {
  if (!Number.isSafeInteger(video.sceneId) || video.sceneId < 0) throw new Error('Scene id is required for video replacement.');
  if (!video.path.trim()) throw new Error('Video asset path is required.');

  return withPipelineStateLock(statePath, async (normalizedStatePath) => {
    const state = JSON.parse(await readFile(normalizedStatePath, 'utf8')) as PipelineStateFile;
    state.steps ??= {};
    state.assets ??= {};
    const scene = state.artifact?.scenes?.find((item) => Number(item.id) === video.sceneId);
    if (!scene) throw new Error(`Scene ${video.sceneId} is not present in the task storyboard.`);
    const maxTrimStartMs = Math.max(0, Math.floor(video.durationMs - scene.durationMs));
    const normalizedVideo: TaskArtifactVideoPreview = {
      ...video,
      trimStartMs: Math.min(maxTrimStartMs, Math.max(0, Math.floor(video.trimStartMs))),
      fit: video.fit === 'contain' ? 'contain' : 'cover',
      muted: true,
    };
    const current = Array.isArray(state.assets.videos) ? state.assets.videos : [];
    const videos = [...current.filter((item) => Number(item.sceneId) !== video.sceneId), normalizedVideo]
      .sort((left, right) => left.sceneId - right.sceneId);
    state.assets.videos = videos;
    state.steps['6'] = pendingStep(state.steps['6']);
    delete state.draft;
    state.updatedAt = new Date().toISOString();
    await writeFile(normalizedStatePath, JSON.stringify(state, null, 2), 'utf8');
    return { video: normalizedVideo, videos };
  });
}

export async function removeSceneVideoAsset(statePath: string, sceneId: number): Promise<RemoveSceneVideoAssetResult> {
  if (!Number.isSafeInteger(sceneId) || sceneId < 0) throw new Error('Scene id is required for restoring the image.');
  return withPipelineStateLock(statePath, async (normalizedStatePath) => {
    const state = JSON.parse(await readFile(normalizedStatePath, 'utf8')) as PipelineStateFile;
    state.steps ??= {};
    state.assets ??= {};
    if (!(state.assets.images ?? []).some((item) => Number(item.sceneId) === sceneId)) {
      throw new Error(`Scene ${sceneId} does not have an original image to restore.`);
    }
    const current = Array.isArray(state.assets.videos) ? state.assets.videos : [];
    const videos = current.filter((item) => Number(item.sceneId) !== sceneId);
    const removed = videos.length !== current.length;
    state.assets.videos = videos;
    if (removed) {
      state.steps['6'] = pendingStep(state.steps['6']);
      delete state.draft;
      state.updatedAt = new Date().toISOString();
      await writeFile(normalizedStatePath, JSON.stringify(state, null, 2), 'utf8');
    }
    return { removed, videos };
  });
}

export async function updateSceneVideoTrim(
  statePath: string,
  sceneId: number,
  trimStartMs: number,
): Promise<ReplaceSceneVideoAssetResult> {
  if (!Number.isFinite(trimStartMs)) throw new Error('Video trim start must be a finite number.');
  return withPipelineStateLock(statePath, async (normalizedStatePath) => {
    const state = JSON.parse(await readFile(normalizedStatePath, 'utf8')) as PipelineStateFile;
    state.steps ??= {};
    state.assets ??= {};
    const current = Array.isArray(state.assets.videos) ? state.assets.videos : [];
    const video = current.find((item) => Number(item.sceneId) === sceneId);
    if (!video) throw new Error(`Scene ${sceneId} does not have a video replacement.`);
    const scene = state.artifact?.scenes?.find((item) => Number(item.id) === sceneId);
    if (!scene) throw new Error(`Scene ${sceneId} is not present in the task storyboard.`);
    const maxTrimStartMs = Math.max(0, Math.floor(video.durationMs - scene.durationMs));
    const updatedVideo: TaskArtifactVideoPreview = {
      ...video,
      trimStartMs: Math.min(maxTrimStartMs, Math.max(0, Math.floor(trimStartMs))),
      muted: true,
    };
    const videos = current.map((item) => Number(item.sceneId) === sceneId ? updatedVideo : item);
    state.assets.videos = videos;
    state.steps['6'] = pendingStep(state.steps['6']);
    delete state.draft;
    state.updatedAt = new Date().toISOString();
    await writeFile(normalizedStatePath, JSON.stringify(state, null, 2), 'utf8');
    return { video: updatedVideo, videos };
  });
}

export async function markSceneNarrationForRegeneration(statePath: string, sceneId: number): Promise<RegenerateSceneNarrationResult> {
  if (!Number.isFinite(sceneId)) {
    throw new Error('Scene id is required for narration regeneration.');
  }

  return withPipelineStateLock(statePath, async (normalizedStatePath) => {
    const state = JSON.parse(await readFile(normalizedStatePath, 'utf8')) as PipelineStateFile;
    state.steps ??= {};
    state.assets ??= {};
    const narration = Array.isArray(state.assets.narration) ? state.assets.narration : [];
    const remainingNarration = narration.filter((asset) => Number(asset.sceneId) !== sceneId);
    const removed = remainingNarration.length !== narration.length;

    state.assets.narration = remainingNarration;
    state.steps['5'] = pendingStep(state.steps['5'], remainingNarration.map((asset) => asset.path).join('\n') || undefined);
    state.steps['6'] = pendingStep(state.steps['6']);
    delete state.draft;
    state.updatedAt = new Date().toISOString();

    await writeFile(normalizedStatePath, JSON.stringify(state, null, 2), 'utf8');
    return { removed, remainingNarration };
  });
}

export function withPipelineStateLock<T>(
  statePath: string,
  operation: (normalizedStatePath: string) => Promise<T>,
): Promise<T> {
  const normalizedStatePath = resolve(statePath);
  const key = process.platform === 'win32' ? normalizedStatePath.toLowerCase() : normalizedStatePath;
  const previous = pipelineStateMutationTails.get(key) ?? Promise.resolve();
  const result = previous.then(() => operation(normalizedStatePath));
  const tail = result.then(() => undefined, () => undefined);
  pipelineStateMutationTails.set(key, tail);
  return result.finally(() => {
    if (pipelineStateMutationTails.get(key) === tail) pipelineStateMutationTails.delete(key);
  });
}

function normalizeRerunStep(step: number): number {
  const normalized = Number(step);
  if (!Number.isInteger(normalized) || normalized < pipelineStepMin || normalized > pipelineStepMax) {
    throw new Error(`Task step must be an integer from ${pipelineStepMin} to ${pipelineStepMax}.`);
  }
  return normalized;
}

function cloneRerunContext(artifact: Partial<PipelineArtifact>, step: number): Partial<PipelineArtifact> {
  const context: Partial<PipelineArtifact> = {};
  if (artifact.sourceContext) context.sourceContext = artifact.sourceContext;
  if (artifact.reviewedText) context.reviewedText = artifact.reviewedText;
  if (step >= 1) {
    if (artifact.rewrittenCopy) context.rewrittenCopy = artifact.rewrittenCopy;
    if (artifact.cover) context.cover = artifact.cover;
  }
  if (step >= 2 && artifact.scenes) context.scenes = artifact.scenes;
  if (step >= 3) {
    if (artifact.imagePrompts) context.imagePrompts = artifact.imagePrompts;
    if (artifact.subtitles) context.subtitles = artifact.subtitles;
  }
  return JSON.parse(JSON.stringify(context)) as Partial<PipelineArtifact>;
}

function clearArtifactFromStep(artifact: Partial<PipelineArtifact>, step: number): void {
  if (step <= 0) {
    delete artifact.reviewedText;
  }
  if (step <= 1) {
    delete artifact.rewrittenCopy;
    delete artifact.cover;
  }
  if (step <= 2) {
    delete artifact.scenes;
    delete artifact.subtitles;
  }
  if (step <= 3) {
    delete artifact.imagePrompts;
  }
}

function clearAssetsFromStep(state: PipelineStateFile, step: number): void {
  state.assets ??= {};
  if (step <= 2) {
    state.assets.videos = [];
  }
  if (step <= 4) {
    state.assets.images = [];
    state.assets.imageErrors = [];
  }
  if (step <= 5) {
    state.assets.narration = [];
  }
  if (step <= 6) {
    delete state.draft;
  }
}

function markStepsPendingFrom(state: PipelineStateFile, step: number): number[] {
  state.steps ??= {};
  const clearedSteps: number[] = [];
  for (let currentStep = step; currentStep <= pipelineStepMax; currentStep += 1) {
    state.steps[String(currentStep)] = pendingStep(state.steps[String(currentStep)]);
    clearedSteps.push(currentStep);
  }
  return clearedSteps;
}

function pendingStep(input: Partial<TaskArtifactStepPreview> | undefined, outputPath?: string): TaskArtifactStepPreview {
  const step: TaskArtifactStepPreview = { ...input, status: 'pending' };
  delete step.error;
  delete step.completedAt;
  if (outputPath) {
    step.outputPath = outputPath;
  } else {
    delete step.outputPath;
  }
  return step;
}

function completedStep(
  input: Partial<TaskArtifactStepPreview> | undefined,
  outputPath: string | undefined,
  completedAt: string,
): TaskArtifactStepPreview {
  const step: TaskArtifactStepPreview = { ...input, status: 'completed', completedAt };
  delete step.error;
  if (outputPath) step.outputPath = outputPath;
  else delete step.outputPath;
  return step;
}

function imageOutputPath(images: TaskArtifactAssetPreview[]): string | undefined {
  return images.map((asset) => asset.path).join('\n') || undefined;
}

function normalizeSceneIds(sceneIds: number[], operation: string): number[] {
  if (sceneIds.length === 0) throw new Error(`At least one scene id is required for ${operation}.`);
  const normalized = sceneIds.map(Number);
  if (normalized.some((sceneId) => !Number.isInteger(sceneId) || sceneId < 0)) {
    throw new Error(`Scene ids must be non-negative integers for ${operation}.`);
  }
  return [...new Set(normalized)];
}

function removeImageErrorsByScene(errors: TaskArtifactImageErrorPreview[] | undefined, sceneId: number): TaskArtifactImageErrorPreview[] {
  return (errors ?? []).filter((item) => Number(item.sceneId) !== sceneId);
}
