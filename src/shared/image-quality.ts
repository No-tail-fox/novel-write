import type { ImageGenerationQuality } from './types';

export const IMAGE_GENERATION_QUALITIES = ['low', 'medium', 'high'] as const satisfies readonly ImageGenerationQuality[];

export function normalizeImageGenerationQuality(
  value: unknown,
  fallback: ImageGenerationQuality = 'medium',
): ImageGenerationQuality {
  return IMAGE_GENERATION_QUALITIES.includes(value as ImageGenerationQuality)
    ? value as ImageGenerationQuality
    : fallback;
}

export function imageGenerationQualityLabel(quality: ImageGenerationQuality): string {
  if (quality === 'low') return '低';
  if (quality === 'high') return '高';
  return '标准';
}
