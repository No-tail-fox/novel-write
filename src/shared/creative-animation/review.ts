/** Narrow factual guard, not a substitute for source checking or a visual model review. */
export const CREATIVE_REVIEW_REVISION = 3;

/** Display pixels at the authored canvas size; 24 px on a 1080p short edge. */
export function creativeMinimumFontSize(width: number, height: number): number {
  return Math.max(14, Math.min(width, height) / 45);
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
    /(?:all[ -]time|record) high/gi, /(?:warning|critical) threshold/gi, /(?:baseline|基准期)\s*1951\s*[-–]\s*1980/gi];
  return [...new Set(patterns.flatMap(pattern => [...visibleText.matchAll(pattern)].map(match => match[0])))].filter(claim => !approved.includes(normalize(claim)));
}
