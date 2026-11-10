import { motionComicContinuityBadgeText, type MotionComicContinuityLevel } from '../../shared/motion-comic-continuity';

export interface DirectorContinuityAdvice {
  level: MotionComicContinuityLevel;
  /** 0–1 perceptual-hash similarity of the cut (advisory). */
  score: number;
}

/** Small advisory badge for the cut into this shot (C-2). Never a gate; renders nothing without data. */
export function DirectorContinuityBadge({ advice }: { advice?: DirectorContinuityAdvice }) {
  if (!advice) return null;
  const text = motionComicContinuityBadgeText(advice.level);
  return (
    <span
      className={`director-continuity-badge is-${advice.level}`}
      data-continuity-level={advice.level}
      title={`${text} · 与上一镜尾帧的感知哈希相似度 ${Math.round(advice.score * 100)}%，只反映构图/明暗，不代表人工审片结论。`}
    >
      {text}
    </span>
  );
}
