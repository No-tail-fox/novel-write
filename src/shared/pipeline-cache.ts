import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ImagePrompt, PipelineArtifact, TaskArtifactAssetPreview, TaskArtifactImageErrorPreview, TaskArtifactSnapshot, TaskArtifactStepPreview, TaskStepRerunMode } from './types';

interface PipelineStateFile {
  version?: number;
  taskId?: string;
  updatedAt?: string;
  steps?: Record<string, Partial<TaskArtifactStepPreview>>;
  artifact?: Partial<PipelineArtifact>;
  assets?: {
    images?: TaskArtifactAssetPreview[];
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
  if (!Number.isFinite(sceneId)) {
    throw new Error('Scene id is required for image regeneration.');
  }

  return withPipelineStateLock(statePath, async (normalizedStatePath) => {
    const state = JSON.parse(await readFile(normalizedStatePath, 'utf8')) as PipelineStateFile;
    state.steps ??= {};
    state.assets ??= {};
    const images = Array.isArray(state.assets.images) ? state.assets.images : [];
    const remainingImages = images.filter((asset) => Number(asset.sceneId) !== sceneId);
    const removed = remainingImages.length !== images.length;

    state.assets.images = remainingImages;
    state.assets.imageErrors = removeImageErrorsByScene(state.assets.imageErrors, sceneId);
    state.steps['4'] = pendingStep(state.steps['4'], remainingImages.map((asset) => asset.path).join('\n') || undefined);
    state.steps['6'] = pendingStep(state.steps['6']);
    delete state.draft;
    state.updatedAt = new Date().toISOString();

    await writeFile(normalizedStatePath, JSON.stringify(state, null, 2), 'utf8');
    return { removed, remainingImages };
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

function removeImageErrorsByScene(errors: TaskArtifactImageErrorPreview[] | undefined, sceneId: number): TaskArtifactImageErrorPreview[] {
  return (errors ?? []).filter((item) => Number(item.sceneId) !== sceneId);
}
