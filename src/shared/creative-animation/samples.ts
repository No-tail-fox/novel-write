import catalog from './lemo-catalog.json';

/** Public media paths listed in LemoLab's official gallery, 2026-10-25.
 * Kept separate from the pinned text references and production adapters.
 */
export const LEMO_GALLERY_URL = 'https://lemomo-ai.github.io/lemo-opuscar/';
export const LEMO_REPOSITORY_URL = 'https://github.com/lemomo-ai/lemo-opuscar';
const sampleSlugs = new Set(catalog.map(style => style.slug));
const nonCcVoice = new Set(['game-show', 'paper-lantern', 'news-package']);
export function creativeStyleSample(slug: string) {
  if (!sampleSlugs.has(slug)) return undefined;
  return {
    poster: `${LEMO_GALLERY_URL}img/${slug}_0.jpg`,
    video: `${LEMO_GALLERY_URL}films/${slug}.mp4`,
    voiceExcludedFromCc: nonCcVoice.has(slug),
  };
}
