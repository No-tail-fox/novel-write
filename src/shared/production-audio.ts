import { z } from 'zod';
import type { ProductionAssetVersion, ProductionTimeline } from './production-workflow';

export const productionAudioFadeEnvelopeSchema = z.object({
  offsetMs: z.number().finite().nonnegative(),
  durationMs: z.number().finite().positive(),
  fadeInMs: z.number().finite().nonnegative(),
  fadeOutMs: z.number().finite().nonnegative(),
}).strict();
export type ProductionAudioFadeEnvelope = z.infer<typeof productionAudioFadeEnvelopeSchema>;

/** Semantic lanes used by both preview and the final mixer. */
export type ProductionAudioTrackType = 'dialogue' | 'narration' | 'sfx' | 'ambience' | 'music' | 'foley';

/** A non-destructive audio edit on the project timeline (all times are ms). */
export interface ProductionAudioClip {
  id: string;
  /** Asset version containing the source audio. */
  assetVersionId: string;
  /** Owning shot when stored on a multi-shot production timeline. */
  shotId?: string;
  trackType: ProductionAudioTrackType;
  /** Project/scene-relative start position. */
  startMs: number;
  /** Offset into the source file. Defaults to zero. */
  sourceStartMs?: number;
  /** Amount read from source. Defaults to the remaining source duration. */
  sourceDurationMs?: number;
  /** Probed duration of the full source file, retained across trims. */
  sourceMediaDurationMs?: number;
  /** Clip duration on the timeline. Defaults to sourceDurationMs. */
  durationMs?: number;
  /** Linear level adjustment expressed in dB. 0 leaves the source unchanged. */
  gainDb?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
  /** Original fade clock retained when a clip is split. */
  fadeEnvelope?: ProductionAudioFadeEnvelope;
  muted?: boolean;
}

export interface ResolvedProductionAudioClip extends Omit<ProductionAudioClip, 'assetVersionId'> {
  assetVersionId: string;
  path: string;
  durationMs: number;
}

/** Legacy shot speech stays audible when adding SFX/music to an old project. */
export function productionAudioClipsForShot(timeline: ProductionTimeline | undefined, shot: { id: string; durationMs: number; voiceAssetVersionId?: string }): ProductionAudioClip[] | undefined {
  const clips = timeline?.audioClips?.filter((clip) => clip.shotId === shot.id);
  if (!clips?.length) return undefined;
  if (!shot.voiceAssetVersionId || clips.some((clip) => clip.trackType === 'dialogue' || clip.trackType === 'narration')) return clips;
  return [{ id: `legacy-narration-${shot.id}`, shotId: shot.id, assetVersionId: shot.voiceAssetVersionId, trackType: 'narration', startMs: timeline?.clips.find((clip) => clip.shotId === shot.id)?.startMs ?? 0, durationMs: shot.durationMs, gainDb: 0 }, ...clips];
}

export function materializeProductionAudioClipsForShot(timeline: ProductionTimeline | undefined, shot: { id: string; durationMs: number; voiceAssetVersionId?: string }): ProductionAudioClip[] {
  const startMs = timeline?.clips.find((clip) => clip.shotId === shot.id)?.startMs ?? 0;
  const clips = productionAudioClipsForShot(timeline, shot) ?? (shot.voiceAssetVersionId ? [{
    id: `legacy-narration-${shot.id}`, shotId: shot.id, assetVersionId: shot.voiceAssetVersionId, trackType: 'narration',
    startMs, durationMs: shot.durationMs, gainDb: 0,
  }] : []);
  return clips.map((clip) => ({ ...clip, durationMs: clip.durationMs ?? clip.sourceDurationMs ?? startMs + shot.durationMs - clip.startMs }));
}

type AudioTiming = Pick<ProductionAudioClip, 'startMs' | 'durationMs' | 'sourceDurationMs' | 'gainDb' | 'fadeInMs' | 'fadeOutMs' | 'fadeEnvelope' | 'muted'>;

export function productionAudioClipGainAtTime(clip: AudioTiming, atMs: number): number {
  const elapsed = atMs - clip.startMs;
  const audible = Math.min(clip.durationMs ?? clip.sourceDurationMs ?? 0, clip.sourceDurationMs ?? clip.durationMs ?? 0);
  if (clip.muted || elapsed < 0 || elapsed >= audible) return 0;
  const envelope = clip.fadeEnvelope ?? { offsetMs: 0, durationMs: audible, fadeInMs: Math.min(clip.fadeInMs ?? 0, audible), fadeOutMs: Math.min(clip.fadeOutMs ?? 0, audible) };
  const position = elapsed + envelope.offsetMs;
  const fadeIn = envelope.fadeInMs ? Math.min(1, position / Math.min(envelope.fadeInMs, envelope.durationMs)) : 1;
  const fadeOut = envelope.fadeOutMs ? Math.min(1, (envelope.durationMs - position) / Math.min(envelope.fadeOutMs, envelope.durationMs)) : 1;
  return Math.pow(10, (clip.gainDb ?? 0) / 20) * Math.max(0, fadeIn * fadeOut);
}

/** Preserve normal-speed source trims and the original envelope, including padded silence. */
export function sliceProductionAudioClip(clip: ProductionAudioClip, startMs: number, endMs: number, ownerEndMs: number): ProductionAudioClip | undefined {
  const duration = clip.durationMs ?? clip.sourceDurationMs ?? ownerEndMs - clip.startMs;
  const start = Math.max(startMs, clip.startMs);
  const end = Math.min(endMs, clip.startMs + duration);
  if (end <= start) return undefined;
  if (start === clip.startMs && end === clip.startMs + duration) return { ...clip };
  const elapsed = start - clip.startMs;
  const audible = Math.min(duration, clip.sourceDurationMs ?? duration);
  const sourceOffset = Math.min(elapsed, audible);
  const sourceDurationMs = Math.max(0, Math.min(end - start, audible - elapsed));
  const envelope = clip.fadeEnvelope ?? { offsetMs: 0, durationMs: audible, fadeInMs: Math.min(clip.fadeInMs ?? 0, audible), fadeOutMs: Math.min(clip.fadeOutMs ?? 0, audible) };
  return {
    ...clip, startMs: start, durationMs: end - start,
    sourceStartMs: (clip.sourceStartMs ?? 0) + sourceOffset, sourceDurationMs,
    ...(clip.fadeInMs === undefined ? {} : { fadeInMs: Math.min(sourceDurationMs, Math.max(0, envelope.fadeInMs - envelope.offsetMs - elapsed)) }),
    ...(clip.fadeOutMs === undefined ? {} : { fadeOutMs: Math.min(sourceDurationMs, Math.max(0, envelope.offsetMs + elapsed + sourceDurationMs - (envelope.durationMs - envelope.fadeOutMs))) }),
    fadeEnvelope: sourceDurationMs > 0 && (envelope.fadeInMs > 0 || envelope.fadeOutMs > 0)
      ? { ...envelope, offsetMs: envelope.offsetMs + elapsed } : undefined,
  };
}

export function normalizeProductionAudioClips(
  clips: readonly ProductionAudioClip[] | undefined,
  sceneDurationMs: number,
): ProductionAudioClip[] {
  const duration = Math.max(1, Math.round(sceneDurationMs));
  return (clips ?? []).map((clip) => ({
    ...clip,
    startMs: clampInt(clip.startMs, 0, duration),
    sourceStartMs: clampInt(clip.sourceStartMs ?? 0, 0, Number.MAX_SAFE_INTEGER),
    ...(clip.sourceDurationMs === undefined ? {} : { sourceDurationMs: clampInt(clip.sourceDurationMs, 0, Number.MAX_SAFE_INTEGER) }),
    ...(clip.durationMs === undefined ? {} : { durationMs: clampInt(clip.durationMs, 1, duration) }),
    gainDb: clampNumber(clip.gainDb ?? 0, -60, 24),
    ...(clip.fadeInMs === undefined ? {} : { fadeInMs: clampInt(clip.fadeInMs, 0, duration) }),
    ...(clip.fadeOutMs === undefined ? {} : { fadeOutMs: clampInt(clip.fadeOutMs, 0, duration) }),
    muted: clip.muted === true,
  })).filter((clip) => !clip.muted && (clip.durationMs ?? clip.sourceDurationMs ?? 1) > 0);
}

export function resolveProductionAudioClips(
  clips: readonly ProductionAudioClip[] | undefined,
  assets: ReadonlyMap<string, ProductionAssetVersion>,
  sceneDurationMs: number,
): ResolvedProductionAudioClip[] {
  return normalizeProductionAudioClips(clips, sceneDurationMs).flatMap((clip) => {
    const asset = assets.get(clip.assetVersionId);
    if (!asset || asset.kind !== 'audio' || !asset.localPath?.trim()) throw new Error(`DIRECTOR_AUDIO_ASSET_MISSING: 音频片段 ${clip.id} 引用的音频资产不可用。`);
    const durationMs = Math.max(1, Math.min(
      clip.durationMs ?? clip.sourceDurationMs ?? sceneDurationMs,
      Math.max(1, sceneDurationMs - clip.startMs),
    ));
    return [{ ...clip, path: asset.localPath, durationMs }];
  });
}

/** Reject broken persisted edits instead of silently dropping sounds at export. */
export function validateProductionAudioTimeline(timeline: ProductionTimeline, assets: ReadonlyMap<string, ProductionAssetVersion>, path = 'timeline') {
  const issues: Array<{ path: string; message: string }> = [];
  const ids = new Set<string>();
  for (const [index, clip] of (timeline.audioClips ?? []).entries()) {
    const prefix = `${path}.audioClips[${index}]`;
    if (ids.has(clip.id)) issues.push({ path: `${prefix}.id`, message: 'Audio clip IDs must be unique.' });
    ids.add(clip.id);
    const asset = assets.get(clip.assetVersionId);
    if (!asset || asset.kind !== 'audio') issues.push({ path: `${prefix}.assetVersionId`, message: 'Audio clip must reference an audio asset.' });
    const shot = timeline.clips.find((item) => item.shotId === clip.shotId);
    if (!shot) issues.push({ path: `${prefix}.shotId`, message: 'Audio clip must belong to a timeline shot.' });
    const duration = clip.durationMs ?? clip.sourceDurationMs ?? (shot ? shot.startMs + shot.durationMs - clip.startMs : 0);
    if (!Number.isFinite(clip.startMs) || !Number.isFinite(duration) || duration <= 0 || (shot && (clip.startMs < shot.startMs || clip.startMs + duration > shot.startMs + shot.durationMs))) issues.push({ path: prefix, message: 'Audio clip must stay inside its owning shot.' });
    for (const field of ['sourceStartMs', 'sourceDurationMs', 'sourceMediaDurationMs', 'fadeInMs', 'fadeOutMs'] as const) {
      const value = clip[field];
      if (value !== undefined && (!Number.isFinite(value) || value < 0 || (field === 'sourceMediaDurationMs' && value === 0))) issues.push({ path: `${prefix}.${field}`, message: 'Audio edit time is invalid.' });
    }
    if (clip.sourceMediaDurationMs !== undefined && (clip.sourceStartMs ?? 0) + (clip.sourceDurationMs ?? duration) > clip.sourceMediaDurationMs) issues.push({ path: prefix, message: 'Audio source trim exceeds the source file duration.' });
    if ((clip.fadeInMs ?? 0) > duration || (clip.fadeOutMs ?? 0) > duration) issues.push({ path: prefix, message: 'Audio fade exceeds the clip duration.' });
    if (clip.fadeEnvelope) {
      const envelope = clip.fadeEnvelope;
      const audible = Math.min(duration, clip.sourceDurationMs ?? duration);
      if (!productionAudioFadeEnvelopeSchema.safeParse(envelope).success || envelope.fadeInMs > envelope.durationMs || envelope.fadeOutMs > envelope.durationMs
        || envelope.offsetMs + audible > envelope.durationMs || envelope.offsetMs > (clip.sourceStartMs ?? 0)) {
        issues.push({ path: `${prefix}.fadeEnvelope`, message: 'Audio fade envelope is invalid.' });
      }
    }
    if (clip.gainDb !== undefined && (!Number.isFinite(clip.gainDb) || clip.gainDb < -60 || clip.gainDb > 24)) issues.push({ path: `${prefix}.gainDb`, message: 'Audio gain must be between -60 and 24 dB.' });
  }
  return issues;
}

/** Clips audible at a preview position, used by UI and render smoke tests. */
export function audioClipsAtTime(clips: readonly ProductionAudioClip[], atMs: number): ProductionAudioClip[] {
  return clips.filter((clip) => !clip.muted && atMs >= clip.startMs && atMs < clip.startMs + (clip.durationMs ?? clip.sourceDurationMs ?? Number.MAX_SAFE_INTEGER));
}

function clampInt(value: number, minimum: number, maximum: number): number {
  const next = Number.isFinite(value) ? Math.round(value) : minimum;
  return Math.min(maximum, Math.max(minimum, next));
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  const next = Number.isFinite(value) ? value : 0;
  return Math.min(maximum, Math.max(minimum, next));
}
