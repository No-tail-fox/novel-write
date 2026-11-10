/**
 * Advisory (non-blocking) visual continuity score for AI 漫剧 remote shots, built on frame-hash.ts.
 *
 * Compares the last frame of shot N with the first frame of shot N+1 (cut continuity) and, when given,
 * the first frame of shot N+1 with the character reference (identity drift). Perceptual hashes only see
 * coarse layout/brightness: a low score means "worth a human look", never "wrong". It is not lip-sync
 * or identity verification and must not block generation, export or billing.
 */
import { goldenFrameHashes, hammingDistance, type GoldenFrameHashes, type RawFrame } from './frame-hash';

export interface ContinuityPairScore {
  /** 0–1, 1 = perceptually identical. */
  score: number;
  ahashDistance: number;
  dhashDistance: number;
  meanLumaDelta: number;
}

export interface MotionComicContinuityAdvice {
  advisory: true;
  /** Cut continuity between the previous shot's last frame and this shot's first frame. */
  cut?: ContinuityPairScore;
  /** Similarity of this shot's first frame to the character reference image. */
  reference?: ContinuityPairScore;
  /** Weighted overall score (cut 0.7, reference 0.3 when both exist). */
  score?: number;
  level: 'ok' | 'review' | 'unknown';
  notes: string[];
}

export interface ContinuityFrames {
  previousLastFrame?: RawFrame | GoldenFrameHashes;
  firstFrame?: RawFrame | GoldenFrameHashes;
  characterReference?: RawFrame | GoldenFrameHashes;
}

const HASH_BITS = 64;

function hashesOf(frame: RawFrame | GoldenFrameHashes): GoldenFrameHashes {
  return 'ahash' in frame ? frame : goldenFrameHashes(frame);
}

export function continuityPairScore(a: RawFrame | GoldenFrameHashes, b: RawFrame | GoldenFrameHashes): ContinuityPairScore {
  const left = hashesOf(a);
  const right = hashesOf(b);
  const ahashDistance = hammingDistance(left.ahash, right.ahash);
  const dhashDistance = hammingDistance(left.dhash, right.dhash);
  const meanLumaDelta = Math.round(Math.abs(left.meanLuma - right.meanLuma) * 10) / 10;
  // Two unrelated images differ in ~half of the bits, so half the hash length maps to similarity 0.
  const half = HASH_BITS / 2;
  const hashSimilarity = (Math.max(0, 1 - ahashDistance / half) + Math.max(0, 1 - dhashDistance / half)) / 2;
  const lumaSimilarity = 1 - Math.min(1, meanLumaDelta / 128);
  const score = Math.round(Math.max(0, Math.min(1, hashSimilarity * 0.8 + lumaSimilarity * 0.2)) * 1000) / 1000;
  return { score, ahashDistance, dhashDistance, meanLumaDelta };
}

/** Threshold defaults are deliberately loose; this is a reminder for human review only. */
export function adviseMotionComicContinuity(frames: ContinuityFrames, options: { reviewBelow?: number } = {}): MotionComicContinuityAdvice {
  const reviewBelow = options.reviewBelow ?? 0.6;
  const notes: string[] = [];
  const cut = frames.previousLastFrame && frames.firstFrame ? continuityPairScore(frames.previousLastFrame, frames.firstFrame) : undefined;
  const reference = frames.characterReference && frames.firstFrame ? continuityPairScore(frames.characterReference, frames.firstFrame) : undefined;
  if (!cut && !reference) return { advisory: true, level: 'unknown', notes: ['缺少可比较的帧，未计算连续性。'] };
  const score = cut && reference
    ? Math.round((cut.score * 0.7 + reference.score * 0.3) * 1000) / 1000
    : (cut ?? reference)!.score;
  if (cut && cut.score < reviewBelow) notes.push(`与上一镜尾帧差异较大（${cut.score}），建议人工核对衔接。`);
  if (reference && reference.score < reviewBelow) notes.push(`首帧与角色参考图差异较大（${reference.score}），建议人工核对角色一致性。`);
  notes.push('感知哈希只反映构图/明暗，仅供参考，不代表角色身份或口型已验收。');
  return { advisory: true, ...(cut ? { cut } : {}), ...(reference ? { reference } : {}), score, level: score < reviewBelow ? 'review' : 'ok', notes };
}
