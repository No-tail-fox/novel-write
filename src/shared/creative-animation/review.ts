/** Narrow factual guard, not a substitute for source checking or a visual model review. */
export const CREATIVE_REVIEW_REVISION = 8;

export function creativeReviewSampleTimes(durationMs: number, fps = 24): number[] {
  const lastFrame = Math.max(0, Math.ceil(durationMs * fps / 1000) - 1) * 1000 / fps;
  return [...new Set([0, durationMs * .15, durationMs * .5, durationMs * .85, lastFrame])].sort((a, b) => a - b);
}

/** Display pixels at the authored canvas size; 24 px on a 1080p short edge. */
export function creativeMinimumFontSize(width: number, height: number): number {
  return Math.max(14, Math.min(width, height) / 45);
}

/** Authoring and repair use the same display-pixel requirement as browser review. */
export function creativeTextLayoutRequirements(width: number, height: number) {
  return {
    minimumFontSizePx: creativeMinimumFontSize(width, height),
    units: 'output canvas pixels after all scaling and transforms',
    appliesTo: 'Every visible text draw, including labels, props, fine print and captions; both actual canvas draws and texts(t) metadata are inspected.',
    guidance: 'Keep rendered font size at or above the minimum at every sampled time. Account for the smallest animated scale. Update drawing code and matching texts(t) geometry together; omit optional fine print if it cannot fit legibly. Do not hide or falsify metadata to bypass review.'
  };
}

/** Allow slight tint/rounding differences, but not a light/dark palette substitution. */
export function creativeBackgroundMatches(actual: string, expected: string): boolean {
  const rgb = (value: string) => {
    if (/^#[\da-f]{6}$/i.test(value)) return [1, 3, 5].map(offset => parseInt(value.slice(offset, offset + 2), 16));
    const match = value.match(/^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i);
    return match && (match[4] === undefined || Number(match[4]) >= .95) ? match.slice(1, 4).map(Number) : undefined;
  };
  const left = rgb(actual), right = rgb(expected);
  return Boolean(left && right && left.every((channel, index) => Math.abs(channel - right[index]) <= 32));
}
export function creativeUnsupportedClaims(visibleText: string, approvedText: string): string[] {
  const normalize = (text: string) => text.replace(/\s+/g, '').toLowerCase();
  const approved = normalize(approvedText);
  const patterns = [/历史最高(?:纪录|记录|观测)?/g, /史上最高/g, /历史新高/g, /(?:升温)?警戒(?:线|阈值)/g,
    /(?:all[ -]time|record) high/gi, /(?:warning|critical) threshold/gi, /(?:baseline|基准期)\s*1951\s*[-–]\s*1980/gi, /\b\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*(?:[μµu]m|nm)\b/gi, /(?:接触角|contact[ -]?angle)\s*[:：=<>≥≤]?\s*\d+(?:\.\d+)?\s*(?:°|度|degrees?)/gi, /SCANNING ELECTRON MICROSCOPY/gi, /SURFACE BIO-MIMETICS CERTIFIED/gi];
  return [...new Set(patterns.flatMap(pattern => [...visibleText.matchAll(pattern)].map(match => match[0])))].filter(claim => !approved.includes(normalize(claim)));
}

/** Sparse native type and line art still count as artwork; ignore a narrow capture border. */
export function nativeFrameHasArtwork(bitmap: Uint8Array, width: number, height: number): boolean {
  if (width < 8 || height < 8 || bitmap.length !== width * height * 4) return false;
  const border = Math.max(1, Math.ceil(Math.min(width, height) * .015));
  const bins = new Map<number, { count: number; sums: number[] }>();
  for (let y = border; y < height - border; y++) for (let x = border; x < width - border; x++) {
    const offset = (y * width + x) * 4;
    const key = (bitmap[offset] >> 4) * 256 + (bitmap[offset + 1] >> 4) * 16 + (bitmap[offset + 2] >> 4);
    const bin = bins.get(key) ?? { count: 0, sums: [0, 0, 0] };
    bin.count++; for (let channel = 0; channel < 3; channel++) bin.sums[channel] += bitmap[offset + channel];
    bins.set(key, bin);
  }
  const dominant = [...bins.values()].sort((a, b) => b.count - a.count)[0];
  if (!dominant) return false;
  const background = dominant.sums.map(value => value / dominant.count);
  const threshold = Math.max(12, (width - 2 * border) * (height - 2 * border) * .0005);
  let different = 0;
  for (let y = border; y < height - border; y++) for (let x = border; x < width - border; x++) {
    const offset = (y * width + x) * 4;
    if (background.some((value, channel) => Math.abs(bitmap[offset + channel] - value) >= 16) && ++different >= threshold) return true;
  }
  return false;
}
