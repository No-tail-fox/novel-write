import { z } from 'zod';
import { alignSubtitleCue, alignSubtitleCueFromTimestampFile, hashSubtitleAlignment, invalidateSubtitleAlignment } from './audio-alignment';
import {
  rebuildEditorialTimeline,
  type EditorialCollagePipelineData,
  type EditorialCollageShot,
  type EditorialSubtitleCue,
} from './editorial-collage';
import type { MotionComicDialogueCue, MotionComicPipelineData, MotionComicShot } from './motion-comic';
import type { ProductionSubtitleCue, ProductionTimeline, ProductionTimelineClip } from './production-workflow';
import { validatePersistedSubtitleCue } from './production-subtitle-schema';

export type DirectorSubtitleDocument = EditorialCollagePipelineData | MotionComicPipelineData;
export type DirectorSubtitleCueUpdate = Partial<Pick<ProductionSubtitleCue, 'text' | 'startMs' | 'endMs' | 'styleRef'>> & { characterId?: string };
type DirectorCue = EditorialSubtitleCue | MotionComicDialogueCue;
type DirectorShot = EditorialCollageShot | MotionComicShot;

const updateSchema = z.object({
  text: z.string().max(10_000).optional(),
  startMs: z.number().finite().nonnegative().optional(),
  endMs: z.number().finite().nonnegative().optional(),
  styleRef: z.string().max(256).optional(),
  characterId: z.string().max(256).optional(),
}).strict();

/** Edits one existing cue using the document's stored, global millisecond range. */
export function updateDirectorSubtitleCue<T extends DirectorSubtitleDocument>(
  document: T,
  shotId: string,
  cueId: string,
  update: DirectorSubtitleCueUpdate,
): T {
  const parsed = updateSchema.safeParse(update);
  if (!parsed.success) throw new Error('DIRECTOR_SUBTITLE_INVALID_UPDATE: 字幕正文、时间或样式格式无效。');
  if (parsed.data.characterId !== undefined && (document.workflowKind !== 'motion-comic' || (parsed.data.characterId && !document.characters.some((character) => character.id === parsed.data.characterId)))) throw new Error('字幕配音角色不存在。');
  return editDirectorCue(document, shotId, cueId, (cue) => {
    const text = parsed.data.text ?? cue.text;
    const startMs = parsed.data.startMs ?? cue.startMs;
    const endMs = parsed.data.endMs ?? cue.endMs;
    const styleRef = Object.prototype.hasOwnProperty.call(parsed.data, 'styleRef') ? parsed.data.styleRef : cue.styleRef;
    const characterChanged = parsed.data.characterId !== undefined && parsed.data.characterId !== ((cue as MotionComicDialogueCue).characterId ?? '');
    const textChanged = text !== cue.text || characterChanged;
    const timingChanged = startMs !== cue.startMs || endMs !== cue.endMs;
    if (!textChanged && !timingChanged && styleRef === cue.styleRef) return cue;
    const next: DirectorCue = textChanged || timingChanged
      ? invalidateSubtitleAlignment(cue, { text, startMs, endMs, audioAssetVersionId: textChanged ? null : undefined })
      : { ...cue };
    if (styleRef === undefined) delete next.styleRef;
    else next.styleRef = styleRef;
    if (parsed.data.characterId !== undefined) {
      const dialogue = next as MotionComicDialogueCue;
      if (parsed.data.characterId) dialogue.characterId = parsed.data.characterId;
      else delete dialogue.characterId;
    }
    if (textChanged && 'voiceAssetVersionId' in next) delete next.voiceAssetVersionId;
    return next;
  });
}

/** Estimates only the selected cue; never labels estimated timing as observed audio. */
export function estimateDirectorSubtitleCue<T extends DirectorSubtitleDocument>(document: T, shotId: string, cueId: string): T {
  return editDirectorCue(document, shotId, cueId, (cue, shot) => {
    const options = {
      source: 'estimated' as const,
      timestamps: [],
      audioAssetVersionId: cue.audioAssetVersionId
        ?? ('voiceAssetVersionId' in cue ? cue.voiceAssetVersionId : undefined)
        ?? shot.voiceAssetVersionId,
      voiceId: cue.voiceId ?? shot.voiceId,
      voiceSpeed: cue.voiceSpeed ?? shot.voiceSpeed,
    };
    if (Number.isInteger(cue.startMs) && Number.isInteger(cue.endMs)) return alignSubtitleCue(cue, options);
    // Imported documents may contain fractional milliseconds. Keep their exact
    // cue range rather than allowing integer token estimates to cross it.
    const duration = cue.endMs - cue.startMs;
    const estimateDuration = Math.max(1, Math.ceil(duration));
    const estimated = alignSubtitleCue({ ...cue, startMs: 0, endMs: estimateDuration }, options);
    const next = {
      ...estimated,
      startMs: cue.startMs,
      endMs: cue.endMs,
      tokens: estimated.tokens?.map((token) => ({
        ...token,
        startMs: cue.startMs + token.startMs / estimateDuration * duration,
        endMs: token.endMs === estimateDuration ? cue.endMs : cue.startMs + token.endMs / estimateDuration * duration,
      })),
    };
    next.alignmentFingerprint = hashSubtitleAlignment(next);
    return next;
  });
}

/** Apply a local JSON/SRT/VTT transcript to one owned cue. */
export function alignDirectorSubtitleCueFromTimestampFile<T extends DirectorSubtitleDocument>(
  document: T,
  shotId: string,
  cueId: string,
  contents: string,
  fileName = '',
): { document: T; issues: string[] } {
  let issues: string[] = [];
  const next = editDirectorCue(document, shotId, cueId, (cue) => {
    const result = alignSubtitleCueFromTimestampFile(cue, contents, fileName);
    issues = result.issues;
    return result.cue;
  });
  return { document: next, issues };
}

function editDirectorCue<T extends DirectorSubtitleDocument>(
  document: T,
  shotId: string,
  cueId: string,
  edit: (cue: DirectorCue, shot: DirectorShot) => DirectorCue,
): T {
  if (document.workflowKind === 'editorial-collage') {
    const owners = document.beats.flatMap((beat) => beat.shots.filter((shot) => shot.id === shotId).map((shot) => ({ beat, shot })));
    if (owners.length !== 1) throw shotNotFound();
    const { beat, shot } = owners[0];
    const cues = document.beats.flatMap((item) => item.subtitleCues).filter((cue) => cue.id === cueId);
    const cue = cues[0];
    if (cues.length !== 1 || !beat.subtitleCues.includes(cue) || !shot.subtitleCueIds.includes(cueId)
      || beat.shots.filter((item) => item.subtitleCueIds.includes(cueId)).length !== 1
      || (cue.shotId && cue.shotId !== shotId)) throw cueNotOwned();
    const clip = subtitleClip(document.timeline, shot, cueId);
    const nextCue = edit(cue, shot);
    assertCueInsideClip(nextCue, clip);
    assertNoCueOverlap(nextCue, beat.subtitleCues.filter((item) => shot.subtitleCueIds.includes(item.id)));
    if (nextCue === cue) return document;
    const textChanged = nextCue.text !== cue.text;
    const staleSpeechIds = new Set([
      shot.voiceAssetVersionId,
      ...(document.timeline?.audioClips ?? []).filter((item) => item.shotId === shotId && (item.trackType === 'dialogue' || item.trackType === 'narration')).map((item) => item.assetVersionId),
    ].filter((id): id is string => !!id));
    const subtitleCues = beat.subtitleCues.map((item) => item === cue ? nextCue
      : textChanged && shot.subtitleCueIds.includes(item.id) && item.audioAssetVersionId && staleSpeechIds.has(item.audioAssetVersionId)
        ? invalidateSubtitleAlignment(item, { audioAssetVersionId: null })
        : item);
    const next: EditorialCollagePipelineData = {
      ...(document as EditorialCollagePipelineData),
      // VOX records the whole shot narration. Any sentence text edit makes all
      // explicit speech for that shot stale; music and effects stay authored.
      ...(textChanged && document.timeline?.audioClips ? {
        timeline: {
          ...document.timeline,
          audioClips: document.timeline.audioClips.filter((item) => item.shotId !== shotId || (item.trackType !== 'dialogue' && item.trackType !== 'narration')),
        },
      } : {}),
      beats: document.beats.map((item) => item !== beat ? item : {
        ...beat,
        subtitleCues,
        narration: textChanged ? subtitleCues.map((item) => item.text).join(' ') : beat.narration,
        shots: textChanged ? beat.shots.map((item) => item === shot ? withoutShotVoice(shot) : item) : beat.shots,
      }),
    };
    return (textChanged ? rebuildEditorialTimeline(next) : next) as T;
  }

  const owners = document.episodes.flatMap((episode) => episode.scenes.flatMap((scene) => scene.shots.filter((shot) => shot.id === shotId).map((shot) => ({ episode, scene, shot }))));
  if (owners.length !== 1) throw shotNotFound();
  const { episode, scene, shot } = owners[0];
  const cues = document.episodes.flatMap((item) => item.dialogueCues).filter((cue) => cue.id === cueId);
  const cue = cues[0];
  if (cues.length !== 1 || !episode.dialogueCues.includes(cue) || cue.shotId !== shotId || !shot.dialogueCueIds.includes(cueId)) throw cueNotOwned();
  const clip = subtitleClip(episode.timeline, shot, cueId);
  const nextCue = edit(cue, shot) as MotionComicDialogueCue;
  assertCueInsideClip(nextCue, clip);
  assertNoCueOverlap(nextCue, episode.dialogueCues.filter((item) => shot.dialogueCueIds.includes(item.id)));
  if (nextCue === cue) return document;
  const textChanged = nextCue.text !== cue.text || nextCue.characterId !== cue.characterId;
  const timingChanged = nextCue.startMs !== cue.startMs || nextCue.endMs !== cue.endMs;
  const dialogueCues = episode.dialogueCues.map((item) => item === cue ? nextCue : item);
  const scenes = textChanged ? episode.scenes.map((item) => item !== scene ? item : {
    ...scene,
    shots: scene.shots.map((item) => item === shot ? withoutShotVoice(shot) : item),
  }) : episode.scenes;
  const invalidatedAudioIds = new Set([shot.voiceAssetVersionId, cue.audioAssetVersionId, cue.voiceAssetVersionId].filter((id): id is string => !!id));
  const retainedAudioIds = new Set([
    ...scenes.flatMap((item) => item.shots).filter((item) => item.id !== shotId).flatMap((item) => item.voiceAssetVersionId ? [item.voiceAssetVersionId] : []),
    ...dialogueCues.filter((item) => item.id !== cueId).flatMap((item) => [item.audioAssetVersionId, item.voiceAssetVersionId].filter((id): id is string => !!id && (item.shotId !== shotId || id !== shot.voiceAssetVersionId))),
  ]);
  const timeline = textChanged || (timingChanged && episode.timeline.audioClips?.some((item) => item.id === `dialogue-clip-${cueId}`)) ? {
    ...episode.timeline,
    audioAssetVersionIds: textChanged ? episode.timeline.audioAssetVersionIds.filter((id) => !invalidatedAudioIds.has(id) || retainedAudioIds.has(id)) : episode.timeline.audioAssetVersionIds,
    ...(episode.timeline.audioClips ? { audioClips: episode.timeline.audioClips.flatMap((item) => {
      if (item.id !== `dialogue-clip-${cueId}`) return [item];
      if (textChanged) return [];
      return [{ ...item, startMs: nextCue.startMs, durationMs: nextCue.endMs - nextCue.startMs }];
    }) } : {}),
    clips: episode.timeline.clips.map((item) => item !== clip ? item : {
      ...item,
      assetVersionIds: textChanged ? item.assetVersionIds.filter((id) => !invalidatedAudioIds.has(id)) : item.assetVersionIds,
    }),
  } : episode.timeline;
  return {
    ...document,
    episodes: document.episodes.map((item) => item !== episode ? item : { ...episode, dialogueCues, scenes, timeline }),
  } as T;
}

function subtitleClip(timeline: ProductionTimeline | undefined, shot: DirectorShot, cueId: string): ProductionTimelineClip {
  const clips = timeline?.clips.filter((clip) => clip.shotId === shot.id) ?? [];
  const clip = clips[0];
  if (clips.length !== 1 || !clip.subtitleCueIds.includes(cueId)) throw cueNotOwned();
  if (!Number.isFinite(timeline?.durationMs) || !Number.isFinite(clip.startMs) || clip.startMs < 0 || !Number.isFinite(clip.durationMs) || clip.durationMs <= 0
    || clip.durationMs !== shot.durationMs || clip.startMs + clip.durationMs > timeline!.durationMs) {
    throw new Error('DIRECTOR_SUBTITLE_INVALID_TIMELINE: 镜头时间线无效，请先修复镜头时长。');
  }
  return clip;
}

function assertCueInsideClip(cue: DirectorCue, clip: ProductionTimelineClip): void {
  if (!Number.isFinite(cue.startMs) || !Number.isFinite(cue.endMs) || cue.endMs <= cue.startMs
    || cue.startMs < clip.startMs || cue.endMs > clip.startMs + clip.durationMs) {
    throw new Error('DIRECTOR_SUBTITLE_OUTSIDE_SHOT: 字幕起止时间必须在所属镜头内，且结束时间晚于开始时间。');
  }
  if (validatePersistedSubtitleCue(cue).length > 0) {
    throw new Error('DIRECTOR_SUBTITLE_INVALID_ALIGNMENT: 字幕词级时间与正文或字幕区间不一致。');
  }
}

function assertNoCueOverlap(cue: ProductionSubtitleCue, siblings: readonly ProductionSubtitleCue[]): void {
  if (siblings.some((item) => item.id !== cue.id && cue.startMs < item.endMs && cue.endMs > item.startMs)) {
    throw new Error('DIRECTOR_SUBTITLE_OVERLAP: 当前字幕轨道的句子不能重叠，请调整起止时间。');
  }
}

function withoutShotVoice<T extends DirectorShot>(shot: T): T {
  const next = { ...shot };
  delete next.voiceAssetVersionId;
  return next;
}

function shotNotFound(): Error {
  return new Error('DIRECTOR_SUBTITLE_SHOT_NOT_FOUND: 未找到唯一的所属镜头。');
}

function cueNotOwned(): Error {
  return new Error('DIRECTOR_SUBTITLE_NOT_OWNED: 该字幕不属于所选镜头或其时间线。');
}
