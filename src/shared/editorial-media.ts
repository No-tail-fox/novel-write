import { validateVoxAnimation } from './vox-animation';
import type { EditorialCollagePipelineData, EditorialCollageShot } from './editorial-collage';
import { createEditorialMotionLayers } from './editorial-motion';
import { editorialShotNarration, editorialShotTitle } from './editorial-storytelling';
import { editorialRecipe } from './editorial-recipe-catalog';
import type { VideoGenerationRequest } from './video-provider';

/** Legacy full-frame images remain usable as I2V keyframes, never as a new separated plate. */
export function editorialKeyframeAssetId(shot: EditorialCollageShot): string | undefined {
  return shot.keyframeAssetVersionId ?? shot.layers.find((layer) => layer.assetVersionId && layer.required !== true)?.assetVersionId;
}

export function editorialShotImagesReady(document: EditorialCollagePipelineData, shot: EditorialCollageShot): boolean {
  const exists = (id?: string) => Boolean(id && document.assets.some((asset) => asset.id === id && asset.kind === 'image' && asset.localPath));
  if (shot.renderStrategy === 'remotion') return Boolean(shot.animation && !validateVoxAnimation(shot.animation, document.assets).length);
  if (shot.renderStrategy === 'living-poster') return exists(editorialKeyframeAssetId(shot));
  if (shot.productionRecipe === 'paper-cut' && !exists(shot.keyframeAssetVersionId)) return false;
  const visible = shot.layers.filter((layer) => layer.visible !== false);
  const images = visible.filter((layer) => !layer.content);
  const independentPaths = new Set(images.flatMap((layer) => {
    const asset = document.assets.find((item) => item.id === layer.assetVersionId && item.kind === 'image');
    return asset?.localPath ? [asset.localPath.replaceAll('\\', '/').toLowerCase()] : [];
  }));
  return images.some((layer) => layer.kind === 'background' && exists(layer.assetVersionId))
    && images.some((layer) => ['subject', 'archival'].includes(layer.kind) && exists(layer.assetVersionId))
    && independentPaths.size >= 2
    && visible.every((layer) => layer.content?.text.trim() || exists(layer.assetVersionId) || layer.required === false);
}

export function editorialNeedsLayerUpgrade(shot: EditorialCollageShot): boolean {
  return !shot.layers.some((layer) => layer.required && ['subject', 'archival'].includes(layer.kind))
    && new Set(shot.layers.filter((layer) => !layer.content && layer.assetVersionId).map((layer) => layer.assetVersionId)).size < 2;
}

export function editorialImageGenerationCount(shot: EditorialCollageShot, document?: EditorialCollagePipelineData): number {
  if (shot.renderStrategy === 'remotion') return 0;
  if (shot.renderStrategy === 'living-poster') return 1;
  const heroCount = shot.productionRecipe === 'paper-cut' && !document?.assets.some(asset => asset.id === shot.keyframeAssetVersionId && asset.kind === 'image' && asset.localPath) ? 1 : 0;
  if (editorialNeedsLayerUpgrade(shot)) {
    const beat = document?.beats.find((item) => item.shots.some((item) => item.id === shot.id));
    if (!document || !beat) return (['comparison', 'evidence-stack'].includes(shot.motionStyle ?? '') ? 3 : 2) + heroCount;
    return createEditorialMotionLayers({ shotId: shot.id, narration: editorialShotNarration(beat, shot) || beat.narration, title: editorialShotTitle(document, beat, shot), durationMs: shot.durationMs, ratio: document.ratio, index: document.beats.flatMap((item) => item.shots).findIndex((item) => item.id === shot.id), motionStyle: shot.motionStyle }).filter((layer) => layer.visible !== false && !layer.content).length + heroCount;
  }
  const layers = shot.layers.filter((layer) => layer.visible !== false && !layer.content && layer.source !== 'local-file'
    && !(layer.kind === 'label' && layer.source === 'svg' && !layer.assetVersionId));
  const missing = document ? layers.filter((layer) => !document.assets.some((asset) => asset.id === layer.assetVersionId && asset.kind === 'image' && asset.localPath)) : [];
  return (missing.length ? missing : layers).length + heroCount;
}

export function editorialVideoFrames(document: EditorialCollagePipelineData, shot: EditorialCollageShot) {
  const first = document.assets.find(asset => asset.id === editorialKeyframeAssetId(shot) && asset.kind === 'image');
  const last = document.assets.find(asset => asset.id === shot.lastFrameAssetVersionId && asset.kind === 'image');
  const requiresLastFrame = shot.productionRecipe === 'nantian' || Boolean(shot.lastFrameAssetVersionId);
  const unavailableReason = !first?.localPath ? '请先生成或选择一张可读取的首帧图片。'
    : requiresLastFrame && !last?.localPath ? '请选择尾帧图片；拼贴艺术动画需要首帧和尾帧。' : '';
  return { first, last, requiresLastFrame, ready: !unavailableReason, unavailableReason };
}

export function editorialVideoPrompt(shot: Pick<EditorialCollageShot, 'scenePrompt' | 'motionPrompt' | 'productionRecipe' | 'lastFrameAssetVersionId'>): string {
  return [
    `SCENE: ${shot.scenePrompt.trim()}`,
    `ELEMENT ACTION: ${shot.motionPrompt.trim() || 'The main paper cutout enters, pivots and settles; secondary objects follow with delayed movement.'}`,
    ...(editorialRecipe(shot.productionRecipe) ? [`VISUAL DIRECTION: ${editorialRecipe(shot.productionRecipe)!.imagePrompt}`] : []),
    ...(shot.lastFrameAssetVersionId ? ['ENDING: Continuously assemble and transform the paper elements from the supplied first frame toward the supplied last frame. Match the last-frame composition and hold it at the end. No hard cut or whole-frame dissolve.'] : []),
    'CAMERA: One continuous restrained camera move that supports the element action; keep the main subject in frame.',
    'MATERIAL: Preserve the supplied paper collage, subject identity, cutout edges and palette throughout the shot.',
    'CONSTRAINTS: Animate objects within the composition, not only the full image. No text, new labels, watermarks, invented numbers, dissolving subjects or looping reversal. Captions and narration are added separately.',
  ].join('\n');
}

export function buildEditorialShotVideoRequest(document: EditorialCollagePipelineData, shot: EditorialCollageShot): VideoGenerationRequest {
  const frames = editorialVideoFrames(document, shot);
  if (!frames.ready) throw new Error(frames.unavailableReason);
  return { prompt: editorialVideoPrompt(shot), durationSec: Math.max(1, shot.durationMs / 1000), ratio: document.ratio,
    firstFramePath: frames.first!.localPath!, ...(frames.last?.localPath ? { lastFramePath: frames.last.localPath } : {}),
  };
}
