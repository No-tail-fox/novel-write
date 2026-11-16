import { z } from 'zod';
import { codeVideoTargetDurationSchema } from './production-policy';

export const narrationPauseSchema = z.object({
  afterCueId: z.string().min(1).max(256).nullable(),
  ms: z.number().int().min(200).max(2000),
  reason: z.string().trim().min(1).max(400),
}).strict();
export const narrationPausesSchema = z.array(narrationPauseSchema).max(50);
export type NarrationPause = z.infer<typeof narrationPauseSchema>;
export interface NarrationPauseCue {
  id: string; startMs: number; endMs: number;
  /** Subtitle line wrapping is NOT a sentence boundary. Host must attest this. */
  sentenceEnd: boolean;
}
export interface NarrationPauseBase {
  /** Immutable, pre-pause timeline; never feed a previously shifted timeline here. */
  durationMs: number;
  cues: readonly NarrationPauseCue[];
  lockedWindows: readonly { startMs: number; endMs: number }[];
  targetDurationSeconds: number;
  allowed: boolean;
  musicMv: boolean;
}
export interface NarrationPausePlan {
  pauses: NarrationPause[];
  insertions: { atMs: number; durationMs: number; afterCueId: string | null }[];
  cues: NarrationPauseCue[];
  durationMs: number;
  addedDurationMs: number;
}

/** Pure planning only: host commits timeline + receipt atomically after validation. */
export function planNarrationPauses(base: NarrationPauseBase, requested: unknown): NarrationPausePlan {
  const pauses = narrationPausesSchema.parse(requested);
  if (!base.allowed || base.musicMv) throw new Error('NARRATION_PAUSES_DISABLED');
  codeVideoTargetDurationSchema.parse(base.targetDurationSeconds);
  if (!Number.isSafeInteger(base.durationMs) || base.durationMs <= 0) throw new Error('NARRATION_PAUSE_BASE_INVALID');
  const ids = new Set<string>();
  let previousEnd = 0;
  for (const cue of base.cues) {
    if (!cue.id || ids.has(cue.id) || !Number.isSafeInteger(cue.startMs) || !Number.isSafeInteger(cue.endMs)
      || cue.startMs < previousEnd || cue.endMs <= cue.startMs || cue.endMs > base.durationMs) throw new Error('NARRATION_PAUSE_CUES_INVALID');
    ids.add(cue.id); previousEnd = cue.endMs;
  }
  if (!base.cues.length && pauses.length) throw new Error('NARRATION_PAUSE_NO_NARRATION');
  for (const window of base.lockedWindows) {
    if (!Number.isSafeInteger(window.startMs) || !Number.isSafeInteger(window.endMs) || window.startMs < 0
      || window.endMs <= window.startMs || window.endMs > base.durationMs) throw new Error('NARRATION_PAUSE_LOCK_INVALID');
  }
  const boundaries = new Set<string | null>();
  const insertions = pauses.map(pause => {
    if (boundaries.has(pause.afterCueId)) throw new Error('NARRATION_PAUSE_DUPLICATE_BOUNDARY');
    boundaries.add(pause.afterCueId);
    const cue = pause.afterCueId === null ? undefined : base.cues.find(cue => cue.id === pause.afterCueId);
    if (pause.afterCueId !== null && (!cue || !cue.sentenceEnd)) throw new Error('NARRATION_PAUSE_NOT_SENTENCE_BOUNDARY');
    const atMs = cue?.endMs ?? 0;
    if (base.lockedWindows.some(window => atMs < window.endMs)) throw new Error('NARRATION_PAUSE_LOCKED_WINDOW');
    return { atMs, durationMs: pause.ms, afterCueId: pause.afterCueId };
  }).sort((a, b) => a.atMs - b.atMs);
  const addedDurationMs = insertions.reduce((sum, insertion) => sum + insertion.durationMs, 0);
  if (addedDurationMs > Math.min(Math.floor(base.durationMs * .15), 10_000)) throw new Error('NARRATION_PAUSE_TOTAL_LIMIT');
  if (base.durationMs + addedDurationMs > base.targetDurationSeconds * 1100) throw new Error('NARRATION_PAUSE_TARGET_LIMIT');
  const cues = base.cues.map(cue => {
    const shift = insertions.filter(insertion => insertion.atMs <= cue.startMs).reduce((sum, insertion) => sum + insertion.durationMs, 0);
    return { ...cue, startMs: cue.startMs + shift, endMs: cue.endMs + shift };
  });
  return { pauses: insertions.map(insertion => pauses.find(pause => pause.afterCueId === insertion.afterCueId)!), insertions, cues, durationMs: base.durationMs + addedDurationMs, addedDurationMs };
}

/** Receipt comparison happens before the change limit: a replay never consumes another change. */
export function narrationPauseChangeDecision(previous: readonly NarrationPause[], next: readonly NarrationPause[], acceptedChanges: number): 'unchanged' | 'apply' {
  if (!Number.isSafeInteger(acceptedChanges) || acceptedChanges < 0) throw new Error('NARRATION_PAUSE_RECEIPT_INVALID');
  const canonical = (items: readonly NarrationPause[]) => JSON.stringify([...items].sort((a, b) => (a.afterCueId ?? '').localeCompare(b.afterCueId ?? '')).map(({ afterCueId, ms }) => ({ afterCueId, ms })));
  if (canonical(previous) === canonical(next)) return 'unchanged';
  if (acceptedChanges >= 3) throw new Error('NARRATION_PAUSE_CHANGE_LIMIT');
  return 'apply';
}
