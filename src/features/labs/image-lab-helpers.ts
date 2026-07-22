import { smartImageModeOptions } from '../../shared/editorial-options';
import type { ImageLabSmartMode } from '../../shared/types';

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
