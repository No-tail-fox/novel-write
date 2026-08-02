import { smartImageModeOptions } from '../../shared/editorial-options';
import type { ImageGenerationQuality, ImageLabGenerateInput, ImageLabRecord, ImageLabSmartMode } from '../../shared/types';

type ImageLabProviderChoice = 'gpt_image' | 'jimeng' | 'custom';

export interface ImageLabBatchSeed {
  prompt: string;
  ratios: string[];
  styles: string[];
  quantity: number;
  provider: ImageLabProviderChoice;
  resolution: ImageLabRecord['resolution'];
  quality?: ImageGenerationQuality;
  smartMode: ImageLabSmartMode;
  referenceImagePaths: string[];
}

export function buildImageLabBatchInputs(seed: ImageLabBatchSeed): ImageLabGenerateInput[] {
  const ratios = uniqueValues(seed.ratios, '9:16');
  const styles = uniqueValues(seed.styles, 'photo-real');
  const quantity = Math.max(1, Math.min(10, Math.floor(seed.quantity) || 1));
  const referenceImagePaths = uniqueValues(seed.referenceImagePaths);
  const inputs: ImageLabGenerateInput[] = [];

  for (const ratio of ratios) {
    for (const style of styles) {
      for (let index = 0; index < quantity; index += 1) {
        inputs.push({
          prompt: seed.prompt,
          ratio,
          style,
          provider: seed.provider,
          resolution: seed.resolution,
          quality: seed.quality ?? 'medium',
          smartMode: seed.smartMode,
          referenceImagePath: referenceImagePaths[0] ?? '',
          referenceImagePaths,
        });
      }
    }
  }

  return inputs;
}

export function imageLabRetryInput(record: ImageLabRecord): ImageLabGenerateInput {
  const provider = isImageLabProviderChoice(record.provider) ? record.provider : undefined;
  return {
    prompt: record.prompt,
    ratio: record.ratio,
    style: record.style,
    ...(provider ? { provider } : {}),
    resolution: record.resolution,
    quality: record.quality ?? 'medium',
    smartMode: record.smartMode,
    referenceImagePath: record.referenceImagePath,
    referenceImagePaths: [...record.referenceImagePaths],
    upstreamTaskId: record.upstreamTaskId,
  };
}

export function isImageLabProviderChoice(value: unknown): value is ImageLabProviderChoice {
  return value === 'gpt_image' || value === 'jimeng' || value === 'custom';
}

function uniqueValues(values: string[], fallback?: string): string[] {
  const unique = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  return unique.length > 0 ? unique : fallback ? [fallback] : [];
}

export function smartImageModeLabel(mode: ImageLabSmartMode = 'text-to-image'): string {
  if (mode === 'text-to-image') return '文生图';
  return smartImageModeOptions.find(([id]) => id === mode)?.[1] ?? mode;
}

export function resolveImageLabSmartMode(
  tab: 'smart' | 'text' | 'reference',
  smartMode: ImageLabSmartMode,
  references: string[],
): ImageLabSmartMode {
  return tab === 'smart' && references.length > 0 ? 'reference-edit' : tab === 'smart' ? smartMode : tab === 'reference' ? 'reference-edit' : 'text-to-image';
}

export function parseReferenceImagePaths(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}
