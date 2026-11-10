/**
 * L-3: locked shots inside a Lemo v3 (upstream Agent) film.
 *
 * Semantics: the Agent still authors one continuous film over the whole absolute timeline,
 * but locked shots keep their existing per-shot picture, narration and subtitles. At export the
 * director compositor renders every shot window on one global frame clock; a locked window uses the
 * shot's own (legacy/native per-shot) render path instead of the Agent picture. Window frame counts
 * depend only on the shot durations, so the spliced film has exactly the Agent film's frames and
 * total duration. Runs without locks never call into this module's context/graph additions.
 *
 * Browser-safe and dependency-light on purpose (imported by the graph and director-render).
 */
import type { EditorialCollagePipelineData, EditorialCollageShot } from './editorial-collage';

/** Matches the upstream picture and the director output clock (DIRECTOR_VISUAL_FPS). */
export const LEMO_SPLICE_FPS = 24;

type LockSettings = { lockedShotIds: readonly string[] };
type Doc = Pick<EditorialCollagePipelineData, 'beats' | 'timeline'> & { productionRun?: { authoringVersion?: number; settings: LockSettings } };

/** Same rule as voxShotLocked: a narration continuation inherits its source shot's lock. */
export function lemoShotLocked(settings: LockSettings, shot: Pick<EditorialCollageShot, 'id' | 'narrationSplit'>): boolean {
  return settings.lockedShotIds.includes(shot.id) || !!shot.narrationSplit && settings.lockedShotIds.includes(shot.narrationSplit.sourceShotId);
}

/** Locked shot ids in timeline order (empty when nothing is locked). */
export function lemoLockedShotIds(document: Doc, settings: LockSettings | undefined = document.productionRun?.settings): string[] {
  if (!settings?.lockedShotIds.length) return [];
  return document.beats.flatMap(beat => beat.shots).filter(shot => lemoShotLocked(settings, shot)).map(shot => shot.id);
}

/** Shots whose picture is NOT taken from the Agent film: only for a v3 run with locks. */
export function lemoLockedPictureShotIds(document: Doc & { workflowKind?: string }): Set<string> {
  if (document.workflowKind !== undefined && document.workflowKind !== 'editorial-collage') return new Set();
  if (document.productionRun?.authoringVersion !== 3) return new Set();
  return new Set(lemoLockedShotIds(document));
}

/**
 * Integer frame counts per window against cumulative boundaries — the same arithmetic as the
 * compositor's allocateHtmlVideoSceneFrameCounts (seconds, floor(x + 0.5), at least one frame).
 */
export function allocateLemoWindowFrames(durationsMs: readonly number[], fps = LEMO_SPLICE_FPS): number[] {
  let elapsedSeconds = 0, previousEndFrame = 0;
  return durationsMs.map(durationMs => {
    if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('LEMO_SPLICE_WINDOW: 镜头时长无效。');
    elapsedSeconds += durationMs / 1000;
    const endFrame = Math.max(previousEndFrame + 1, Math.floor(elapsedSeconds * fps + 0.5));
    const count = endFrame - previousEndFrame;
    previousEndFrame = endFrame;
    return count;
  });
}

export interface LemoSpliceSegment {
  shotId: string;
  source: 'agent' | 'locked';
  startMs: number;
  durationMs: number;
  startFrame: number;
  frameCount: number;
}
export interface LemoSplicePlan { fps: number; totalFrames: number; durationMs: number; segments: LemoSpliceSegment[] }

/** Frame-exact window plan of the exported film (every shot, in order). */
export function lemoSplicePlan(document: Doc, settings: LockSettings | undefined = document.productionRun?.settings, fps = LEMO_SPLICE_FPS): LemoSplicePlan {
  const shots = document.beats.flatMap(beat => beat.shots);
  const counts = allocateLemoWindowFrames(shots.map(shot => shot.durationMs), fps);
  const locked = new Set(lemoLockedShotIds(document, settings));
  let startFrame = 0, startMs = 0;
  const segments = shots.map((shot, index): LemoSpliceSegment => {
    const clipStart = document.timeline?.clips.find(clip => clip.shotId === shot.id)?.startMs;
    const segment = { shotId: shot.id, source: locked.has(shot.id) ? 'locked' as const : 'agent' as const,
      startMs: clipStart ?? startMs, durationMs: shot.durationMs, startFrame, frameCount: counts[index] };
    startFrame += counts[index]; startMs += shot.durationMs;
    return segment;
  });
  return { fps, totalFrames: startFrame, durationMs: startMs, segments };
}

/** Reserved windows for the Agent context; undefined without locks (default context unchanged). */
export function lemoReservedWindows(document: Doc, settings: LockSettings | undefined = document.productionRun?.settings) {
  if (!lemoLockedShotIds(document, settings).length) return undefined;
  const plan = lemoSplicePlan(document, settings);
  return plan.segments.filter(segment => segment.source === 'locked').map(segment => ({
    shotId: segment.shotId, startMs: segment.startMs, endMs: segment.startMs + segment.durationMs,
    frames: [segment.startFrame, segment.startFrame + segment.frameCount] as [number, number],
  }));
}

export function lemoReservedWindowsBrief(document: Doc, settings: LockSettings | undefined = document.productionRun?.settings): string | undefined {
  const windows = lemoReservedWindows(document, settings);
  if (!windows?.length) return undefined;
  return 'Reserved locked-shot windows (absolute milliseconds; 24 fps frames [start, end)). The host keeps these shots from the existing film and replaces exactly these frames of your film at export, together with their narration and subtitles. '
    + 'Still author the full timeline and total duration; inside these windows keep only simple continuous background motion, and put no unique story content, titles or credits there; cut cleanly at their edges: '
    + JSON.stringify(windows);
}
