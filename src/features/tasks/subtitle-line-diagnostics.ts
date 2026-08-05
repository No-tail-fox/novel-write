import { splitCaptionLines } from '../../shared/story';

export interface SubtitleLineIssue {
  index: number;
  characterCount: number;
  kind: 'empty' | 'over-limit';
}

export function subtitleLineIssues(lines: readonly string[], maxCharsPerLine: number): SubtitleLineIssue[] {
  const limit = normalizeLineLimit(maxCharsPerLine);
  if (lines.length === 0) return [{ index: 0, characterCount: 0, kind: 'empty' }];
  const issues: SubtitleLineIssue[] = [];
  lines.forEach((line, index) => {
    const characterCount = line.trim().length;
    if (characterCount === 0) issues.push({ index, characterCount, kind: 'empty' });
    else if (characterCount > limit) issues.push({ index, characterCount, kind: 'over-limit' });
  });
  return issues;
}

export function repairSubtitleProblemLines(
  lines: readonly string[],
  fallbackText: string,
  maxCharsPerLine: number,
): string[] {
  const limit = normalizeLineLimit(maxCharsPerLine);
  const repaired = lines.flatMap((line) => {
    const normalized = line.trim();
    if (!normalized) return [];
    return normalized.length > limit ? splitCaptionLines(normalized, limit) : [normalized];
  });
  return repaired.length > 0 ? repaired : splitCaptionLines(fallbackText, limit);
}

function normalizeLineLimit(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.round(value)) : 12;
}
