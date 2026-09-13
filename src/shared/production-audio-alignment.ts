import { z } from 'zod';
import type { ProductionAssetVersion } from './production-workflow';

export type ProductionNarrationSampleStatus = 'aligned' | 'mismatch' | 'unavailable' | 'not-applicable';

export interface ProductionNarrationAlignmentSample {
  shotId: string;
  plannedDurationMs: number;
  graphemeCount: number;
  actualDurationMs?: number;
  plannedCharactersPerSecond?: number;
  actualCharactersPerSecond?: number;
  deltaMs?: number;
  status: ProductionNarrationSampleStatus;
  audioAssetVersionIds: string[];
  detail?: string;
}

export interface ProductionNarrationAlignmentEvidence {
  version: 1;
  measuredAt: string;
  status: 'passed' | 'pending' | 'failed';
  samples: ProductionNarrationAlignmentSample[];
}

const nonNegative = z.number().finite().nonnegative();
const positive = z.number().finite().positive();

export const productionNarrationAlignmentEvidenceSchema = z.object({
  version: z.literal(1),
  measuredAt: z.string().max(64).refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid timestamp.'),
  status: z.enum(['passed', 'pending', 'failed']),
  samples: z.array(z.object({
    shotId: z.string().trim().min(1).max(256),
    plannedDurationMs: positive,
    graphemeCount: nonNegative,
    actualDurationMs: positive.optional(),
    plannedCharactersPerSecond: positive.optional(),
    actualCharactersPerSecond: positive.optional(),
    deltaMs: z.number().finite().optional(),
    status: z.enum(['aligned', 'mismatch', 'unavailable', 'not-applicable']),
    audioAssetVersionIds: z.array(z.string().trim().min(1).max(256)).max(500),
    detail: z.string().max(2_000).optional(),
  }).strict()).max(500),
}).strict();

export interface ProductionNarrationAlignmentScene {
  id: string;
  durationMs: number;
  subtitleCues?: readonly { text: string; startMs: number; endMs: number }[];
  audioAssetVersionIds: readonly string[];
  /** Effective measured duration for each source occurrence, after trims. */
  audioDurationsMs?: readonly (number | undefined)[];
}

function graphemeCount(text: string): number {
  const normalized = text.normalize('NFC').replace(/\s+/gu, '');
  const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : undefined;
  return segmenter ? [...segmenter.segment(normalized)].length : Array.from(normalized).length;
}

function positiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Compare authored cue timing with measured local audio. Missing duration is
 * deliberately pending: a planned reading speed is not evidence of spoken
 * timing. A mismatch remains a manual review item rather than silently
 * changing the author's timeline.
 */
export function measureProductionNarrationAlignment(
  scenes: readonly ProductionNarrationAlignmentScene[],
  assets: ReadonlyMap<string, Pick<ProductionAssetVersion, 'durationMs'>>,
  measuredAt = new Date().toISOString(),
): ProductionNarrationAlignmentEvidence {
  const samples = scenes.map((scene): ProductionNarrationAlignmentSample => {
    const cues = (scene.subtitleCues ?? []).filter((cue) => cue.text.trim() && Number.isFinite(cue.startMs) && Number.isFinite(cue.endMs) && cue.endMs > cue.startMs);
    if (cues.length === 0) {
      return { shotId: scene.id, plannedDurationMs: Math.max(1, scene.durationMs), graphemeCount: 0, status: 'not-applicable', audioAssetVersionIds: [] };
    }
    const plannedStart = Math.min(...cues.map((cue) => cue.startMs));
    const plannedEnd = Math.max(...cues.map((cue) => cue.endMs));
    const plannedDurationMs = Math.max(1, plannedEnd - plannedStart);
    const count = graphemeCount(cues.map((cue) => cue.text).join(''));
    const plannedCharactersPerSecond = count > 0 ? count / (plannedDurationMs / 1000) : undefined;
    const sourceIds = scene.audioAssetVersionIds.filter(Boolean);
    const ids = [...new Set(sourceIds)];
    const actualDurationMs = sourceIds.reduce((sum, id, index) => {
      const duration = scene.audioDurationsMs?.[index] ?? assets.get(id)?.durationMs;
      return sum + (positiveFinite(duration) ? duration : 0);
    }, 0);
    if (!positiveFinite(actualDurationMs)) {
      return {
        shotId: scene.id, plannedDurationMs, graphemeCount: count, plannedCharactersPerSecond,
        status: 'unavailable', audioAssetVersionIds: ids,
        detail: '音频资产没有本地实测时长，无法确认实际口播速度。',
      };
    }
    const deltaMs = actualDurationMs - plannedDurationMs;
    const relativeDelta = Math.abs(deltaMs) / plannedDurationMs;
    const mismatch = Math.abs(deltaMs) > 250 && relativeDelta > 0.15;
    const actualCharactersPerSecond = count > 0 ? count / (actualDurationMs / 1000) : undefined;
    return {
      shotId: scene.id, plannedDurationMs, graphemeCount: count, actualDurationMs,
      plannedCharactersPerSecond, actualCharactersPerSecond, deltaMs, status: mismatch ? 'mismatch' : 'aligned',
      audioAssetVersionIds: ids,
      ...(mismatch ? { detail: `实测音频比字幕规划${deltaMs > 0 ? '长' : '短'} ${Math.abs(Math.round(deltaMs))}ms，请复核切句或语速。` } : {}),
    };
  });
  const applicable = samples.filter((sample) => sample.status !== 'not-applicable');
  const status = applicable.some((sample) => sample.status === 'mismatch')
    ? 'failed'
    : applicable.some((sample) => sample.status === 'unavailable')
      ? 'pending'
      : 'passed';
  return { version: 1, measuredAt, status, samples };
}
