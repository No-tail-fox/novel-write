import upstreamCatalog from './lemo-upstream-catalog.json';
import opuscar98 from './opuscar98-catalog.json';

/** Public media paths listed in LemoLab's official gallery (checked 2026-11-09).
 * Kept separate from the pinned text references and production adapters.
 */
export const LEMO_GALLERY_URL = 'https://lemomo-ai.github.io/lemo-opuscar/';
export const LEMO_REPOSITORY_URL = 'https://github.com/lemomo-ai/lemo-opuscar';
export const LEMO_LIBRARY_STYLE_COUNT = upstreamCatalog.styles.length;
export const OPUSCAR98_PAGE_URL = `${LEMO_GALLERY_URL}opuscar98/#styles`;
const sampleSlugs = new Set(upstreamCatalog.styles.map(style => style.slug));
const opuscar98Segments = new Map(opuscar98.styles.map(style => [style.slug, style]));
const nonCcVoice = new Set(['game-show', 'paper-lantern', 'news-package']);
export function creativeStyleSample(slug: string) {
  const segment = opuscar98Segments.get(slug);
  // OPUSCAR 98 is one film; each light style is a few seconds of it (media fragment, no separate download).
  if (segment) return {
    video: `${LEMO_GALLERY_URL}films/opuscar98.mp4#t=${segment.t0.toFixed(3)},${(segment.t0 + segment.dur).toFixed(3)}`,
    voiceExcludedFromCc: false,
    segment: { start: segment.t0, duration: segment.dur },
  };
  if (!sampleSlugs.has(slug)) return undefined;
  return {
    poster: `${LEMO_GALLERY_URL}img/${slug}_0.jpg`,
    video: `${LEMO_GALLERY_URL}films/${slug}.mp4`,
    voiceExcludedFromCc: nonCcVoice.has(slug),
  };
}
