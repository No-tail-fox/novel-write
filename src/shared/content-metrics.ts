export interface TargetWordCountRange {
  target: number;
  min: number;
  max: number;
}

export interface StoryboardSceneCountRange {
  target: number;
  min: number;
  max: number;
  explicit: boolean;
}

export function countVisibleCharacters(value: string): number {
  return value.replace(/\s+/g, '').length;
}

export function normalizeTargetLength(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(5000, Math.max(100, Math.round(parsed)));
}

export function targetWordCountRange(targetLength: unknown, sourceText = ''): TargetWordCountRange | null {
  const target = normalizeTargetLength(targetLength);
  if (target) {
    return {
      target,
      min: Math.floor(target * 0.8),
      max: Math.ceil(target * 1.2),
    };
  }
  const sourceLength = countVisibleCharacters(sourceText);
  if (sourceLength <= 0) return null;
  return {
    target: sourceLength,
    min: Math.max(1, Math.floor(sourceLength * 0.8)),
    max: Math.max(1, Math.ceil(sourceLength * 1.2)),
  };
}

export function normalizeStoryboardSceneCount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(60, Math.max(1, Math.round(parsed)));
}

function storyboardSceneCountRangeFromLength(length: number): StoryboardSceneCountRange {
  const normalizedLength = Math.max(0, Math.round(length));
  const min = Math.max(10, Math.min(30, Math.floor(normalizedLength / 40)));
  const max = Math.min(60, Math.max(min + 10, Math.floor(normalizedLength / 30)));
  return {
    target: Math.floor((min + max) / 2),
    min,
    max,
    explicit: false,
  };
}

export function storyboardSceneCountPreviewRange(text: string, targetLength: unknown): StoryboardSceneCountRange | null {
  const normalizedTargetLength = normalizeTargetLength(targetLength);
  if (normalizedTargetLength !== null) {
    return storyboardSceneCountRangeFromLength(normalizedTargetLength);
  }

  const sourceLength = countVisibleCharacters(text.trim());
  if (sourceLength <= 0) return null;
  return storyboardSceneCountRangeFromLength(sourceLength);
}

export function storyboardSceneCountRange(rewrittenCopy: string, targetSceneCount?: unknown): StoryboardSceneCountRange {
  const target = normalizeStoryboardSceneCount(targetSceneCount);
  if (target !== null && target > 0) {
    return {
      target,
      min: Math.max(3, Math.floor(target * 0.9)),
      max: Math.ceil(target * 1.1),
      explicit: true,
    };
  }

  return storyboardSceneCountRangeFromLength(countVisibleCharacters(rewrittenCopy.trim()));
}

export function resolveEffectiveStoryboardSceneCount(rewrittenCopy: string, targetSceneCount?: unknown): number {
  return storyboardSceneCountRange(rewrittenCopy, targetSceneCount).target;
}
