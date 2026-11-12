/**
 * Shared output aspect ratios for editorial, motion-comic, HTML and music-MV creation.
 * Routes keep their historical constant names as aliases so stored documents and
 * schema enums stay byte-for-byte compatible.
 */
export const ASPECT_RATIOS = ['9:16', '16:9', '1:1', '4:3'] as const;

export type AspectRatio = (typeof ASPECT_RATIOS)[number];

const ASPECT_RATIO_SET: ReadonlySet<string> = new Set(ASPECT_RATIOS);

export function isAspectRatio(value: unknown): value is AspectRatio {
  return typeof value === 'string' && ASPECT_RATIO_SET.has(value);
}

export function normalizeAspectRatio(value: unknown, fallback: AspectRatio = '16:9'): AspectRatio {
  return isAspectRatio(value) ? value : fallback;
}
