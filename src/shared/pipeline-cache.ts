import { readFile, writeFile } from 'node:fs/promises';
import type { PipelineArtifact, TaskArtifactAssetPreview, TaskArtifactSnapshot, TaskArtifactStepPreview } from './types';

interface PipelineStateFile {
  version?: number;
  taskId?: string;
  updatedAt?: string;
  steps?: Record<string, Partial<TaskArtifactStepPreview>>;
  artifact?: Partial<PipelineArtifact>;
  assets?: {
    images?: TaskArtifactAssetPreview[];
    narration?: TaskArtifactAssetPreview[];
  };
  draft?: TaskArtifactSnapshot['draft'];
}

export interface RegenerateSceneImageResult {
  removed: boolean;
  remainingImages: TaskArtifactAssetPreview[];
}

export interface RegenerateSceneNarrationResult {
  removed: boolean;
  remainingNarration: TaskArtifactAssetPreview[];
}

export async function markSceneImageForRegeneration(statePath: string, sceneId: number): Promise<RegenerateSceneImageResult> {
  if (!Number.isFinite(sceneId)) {
    throw new Error('Scene id is required for image regeneration.');
  }

  const state = JSON.parse(await readFile(statePath, 'utf8')) as PipelineStateFile;
  state.steps ??= {};
  state.assets ??= {};
  const images = Array.isArray(state.assets.images) ? state.assets.images : [];
  const remainingImages = images.filter((asset) => Number(asset.sceneId) !== sceneId);
  const removed = remainingImages.length !== images.length;

  state.assets.images = remainingImages;
  state.steps['4'] = pendingStep(state.steps['4'], remainingImages.map((asset) => asset.path).join('\n') || undefined);
  state.steps['6'] = pendingStep(state.steps['6']);
  delete state.draft;
  state.updatedAt = new Date().toISOString();

  await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
  return { removed, remainingImages };
}

export async function markSceneNarrationForRegeneration(statePath: string, sceneId: number): Promise<RegenerateSceneNarrationResult> {
  if (!Number.isFinite(sceneId)) {
    throw new Error('Scene id is required for narration regeneration.');
  }

  const state = JSON.parse(await readFile(statePath, 'utf8')) as PipelineStateFile;
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

  await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
  return { removed, remainingNarration };
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
