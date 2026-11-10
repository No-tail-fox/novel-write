/**
 * Advisory (non-blocking) visual continuity score for AI 漫剧 remote shots, built on frame-hash.ts.
 *
 * Compares the last frame of shot N with the first frame of shot N+1 (cut continuity) and, when given,
 * the first frame of shot N+1 with the character reference (identity drift). Perceptual hashes only see
 * coarse layout/brightness: a low score means "worth a human look", never "wrong". It is not lip-sync
 * or identity verification and must not block generation, export or billing.
 */
import { z } from 'zod';
import { goldenFrameHashes, hammingDistance, type GoldenFrameHashes, type RawFrame } from './frame-hash';
import type { MotionComicEpisode, MotionComicShot } from './motion-comic';

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

/* ------------------------------------------------------------------------------------------------
 * Persisted advisory cut score on a motion-comic shot (backlog C-2).
 *
 * Stored as the optional `continuityAdvice` field of a shot (the name `continuity` already holds the
 * planned start/end-state notes). Old documents simply lack it. The record is bound to the exact video
 * versions it compared, so it silently stops showing once either shot's selected video changes.
 * ---------------------------------------------------------------------------------------------- */

export const MOTION_COMIC_CONTINUITY_LEVELS = ['good', 'fair', 'jump'] as const;
export type MotionComicContinuityLevel = (typeof MOTION_COMIC_CONTINUITY_LEVELS)[number];
/** Below `jump` matches the default `reviewBelow` of adviseMotionComicContinuity. */
export const MOTION_COMIC_CONTINUITY_THRESHOLDS = { good: 0.75, fair: 0.6 } as const;
export const MOTION_COMIC_CONTINUITY_LABELS: Record<MotionComicContinuityLevel, string> = { good: '好', fair: '一般', jump: '跳变' };

const continuityId = z.string().trim().min(1).max(256);
const hashDistance = z.number().int().min(0).max(4096);

export const motionComicShotContinuityAdviceSchema = z.object({
  version: z.literal(1),
  advisory: z.literal(true),
  method: z.literal('perceptual-hash'),
  /** Video version of this shot whose first frame was compared. */
  videoAssetVersionId: continuityId,
  previousShotId: continuityId,
  /** Video version of the previous shot whose last frame was compared. */
  previousVideoAssetVersionId: continuityId,
  score: z.number().finite().min(0).max(1),
  level: z.enum(MOTION_COMIC_CONTINUITY_LEVELS),
  ahashDistance: hashDistance,
  dhashDistance: hashDistance,
  meanLumaDelta: z.number().finite().min(0).max(255),
  computedAt: z.string().max(64),
}).strict();
export type MotionComicShotContinuityAdvice = z.infer<typeof motionComicShotContinuityAdviceSchema>;

export function motionComicContinuityLevel(score: number): MotionComicContinuityLevel {
  if (!Number.isFinite(score)) return 'jump';
  if (score >= MOTION_COMIC_CONTINUITY_THRESHOLDS.good) return 'good';
  if (score >= MOTION_COMIC_CONTINUITY_THRESHOLDS.fair) return 'fair';
  return 'jump';
}

export function motionComicContinuityBadgeText(level: MotionComicContinuityLevel): string {
  return `衔接：${MOTION_COMIC_CONTINUITY_LABELS[level]}（仅供参考）`;
}

/** Pure: last frame of the previous shot vs first frame of this shot → persistable advisory record. */
export function buildMotionComicShotContinuityAdvice(input: {
  previousLastFrame: RawFrame | GoldenFrameHashes;
  firstFrame: RawFrame | GoldenFrameHashes;
  videoAssetVersionId: string;
  previousShotId: string;
  previousVideoAssetVersionId: string;
  computedAt?: string;
}): MotionComicShotContinuityAdvice {
  const pair = continuityPairScore(input.previousLastFrame, input.firstFrame);
  return motionComicShotContinuityAdviceSchema.parse({
    version: 1,
    advisory: true,
    method: 'perceptual-hash',
    videoAssetVersionId: input.videoAssetVersionId,
    previousShotId: input.previousShotId,
    previousVideoAssetVersionId: input.previousVideoAssetVersionId,
    score: pair.score,
    level: motionComicContinuityLevel(pair.score),
    ahashDistance: pair.ahashDistance,
    dhashDistance: pair.dhashDistance,
    meanLumaDelta: pair.meanLumaDelta,
    computedAt: input.computedAt ?? new Date().toISOString(),
  });
}

/** The shot played immediately before `shotId` in the episode (scene order, then shot order). */
export function motionComicPreviousShot(episode: Pick<MotionComicEpisode, 'scenes'>, shotId: string): MotionComicShot | undefined {
  const shots = episode.scenes.flatMap((scene) => scene.shots);
  const index = shots.findIndex((shot) => shot.id === shotId);
  return index > 0 ? shots[index - 1] : undefined;
}

/** The stored advice, only while it still describes the currently selected videos of both shots. */
export function currentMotionComicShotContinuityAdvice(
  episode: Pick<MotionComicEpisode, 'scenes'>,
  shot: Pick<MotionComicShot, 'id' | 'videoAssetVersionId' | 'continuityAdvice'>,
): MotionComicShotContinuityAdvice | undefined {
  const advice = shot.continuityAdvice;
  if (!advice || !shot.videoAssetVersionId || advice.videoAssetVersionId !== shot.videoAssetVersionId) return undefined;
  const previous = motionComicPreviousShot(episode, shot.id);
  if (!previous || previous.id !== advice.previousShotId || previous.videoAssetVersionId !== advice.previousVideoAssetVersionId) return undefined;
  return advice;
}
