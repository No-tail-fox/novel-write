import type { ImportGlobFunction } from 'vite';
import { defaultCustomStyles } from './config';
import type { CustomStyle } from './types';
import manifest from '../assets/drawing-style-previews/manifest.json';
import { validCustomStylePreview } from './custom-style-preview';

declare global {
  interface ImportMeta { glob: ImportGlobFunction }
}

const images = import.meta.glob<string>('../assets/drawing-style-previews/*.webp', { eager: true, query: '?url', import: 'default' });

/** Match prompt content too: an edited template must not inherit an unrelated stock sample. */
export function imageStylePreview(styleOrId: CustomStyle | string) {
  const style = typeof styleOrId === 'string' ? defaultCustomStyles.find(item => item.id === styleOrId) : styleOrId;
  if (!style) return undefined;
  const saved = validCustomStylePreview(style);
  if (saved) return { src: saved.imagePath, description: style.description, label: style.name, local: true };
  const equivalent = manifest.find(item => item.prefix.trim() === style.prefix.trim()
    && item.suffix.trim() === style.suffix.trim() && item.negativePrompt.trim() === style.negativePrompt.trim()
    && item.allowColor === style.allowColor);
  if (!equivalent) return undefined;
  const src = images[`../assets/drawing-style-previews/${equivalent.id}.webp`];
  return src ? { src, description: style.description, label: style.name, local: false } : undefined;
}
