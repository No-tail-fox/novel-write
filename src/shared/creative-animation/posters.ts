import type { ImportGlobFunction } from 'vite';

declare global {
  interface ImportMeta { glob: ImportGlobFunction }
}

// The same bundled-asset path used by image styles. Cover previews must work
// before the user has a network connection or chooses to load a sample film.
// Extra covers come from the pinned upstream snapshot (scripts/sync-lemo-styles.py), CC BY 4.0 LemoLab.
const posters = import.meta.glob<string>('../../assets/creative-style-previews/*.webp', { eager: true, query: '?url', import: 'default' });
const upstreamPosters = import.meta.glob<string>('../../assets/creative-style-previews/lemo-upstream/*.webp', { eager: true, query: '?url', import: 'default' });
const opuscar98Posters = import.meta.glob<string>('../../assets/creative-style-previews/opuscar98/*.webp', { eager: true, query: '?url', import: 'default' });

export function creativeStylePoster(slug: string) {
  const o98 = /^o98-(\d{2})$/.exec(slug);
  if (o98) return opuscar98Posters[`../../assets/creative-style-previews/opuscar98/${o98[1]}.webp`];
  return posters[`../../assets/creative-style-previews/${slug}.webp`] ?? upstreamPosters[`../../assets/creative-style-previews/lemo-upstream/${slug}.webp`];
}
