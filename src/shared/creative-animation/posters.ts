import type { ImportGlobFunction } from 'vite';

declare global {
  interface ImportMeta { glob: ImportGlobFunction }
}

// The same bundled-asset path used by image styles. Cover previews must work
// before the user has a network connection or chooses to load a sample film.
const posters = import.meta.glob<string>('../../assets/creative-style-previews/*.webp', { eager: true, query: '?url', import: 'default' });

export function creativeStylePoster(slug: string) {
  return posters[`../../assets/creative-style-previews/${slug}.webp`];
}
