import { invalidateSubtitleAlignment } from './audio-alignment';
import { rebuildEditorialTimeline } from './editorial-collage';
import type { DirectorSubtitleDocument } from './director-subtitles';
import type { MotionComicDialogueCue } from './motion-comic';
import type { ProductionSubtitleCue, ProductionTimelineClip } from './production-workflow';

export function addDirectorSubtitleCue<T extends DirectorSubtitleDocument>(document: T, shotId: string, id: string): T {
  if (!id.trim() || id.length > 256) throw new Error('字幕标识无效。');
  const allCues = document.workflowKind === 'editorial-collage' ? document.beats.flatMap((beat) => beat.subtitleCues) : document.episodes.flatMap((episode) => episode.dialogueCues);
  if (allCues.some((cue) => cue.id === id)) throw new Error('字幕标识重复。');
  return changeStructure(document, shotId, (cues, clip) => {
    if (cues.length >= 100) throw new Error('当前镜头最多支持 100 句字幕。');
    const ordered = [...cues].sort((a, b) => a.startMs - b.startMs);
    const last = ordered.at(-1);
    if (last && last.endMs - last.startMs < 2) throw new Error('末句时长不足以新增字幕，请先调整时间。');
    const startMs = last ? Math.floor((last.startMs + last.endMs) / 2) : clip.startMs;
    const endMs = last?.endMs ?? clip.startMs + clip.durationMs;
    return [...ordered.map((cue) => cue === last ? { ...cue, endMs: startMs } : cue), { id, shotId, startMs, endMs, text: '' }];
  });
}

export function removeDirectorSubtitleCue<T extends DirectorSubtitleDocument>(document: T, shotId: string, cueId: string): T {
  return changeStructure(document, shotId, (cues) => {
    if (!cues.some((cue) => cue.id === cueId)) throw new Error('该字幕不属于当前镜头。');
    return cues.filter((cue) => cue.id !== cueId);
  });
}

export function invalidateDirectorShotSpeech<T extends DirectorSubtitleDocument>(document: T, shotId: string): T {
  return changeStructure(document, shotId, (cues) => cues.map((cue) => {
    const next = { ...cue };
    delete next.voiceId;
    delete next.voiceSpeed;
    return next;
  }));
}

function changeStructure<T extends DirectorSubtitleDocument>(document: T, shotId: string, edit: (cues: ProductionSubtitleCue[], clip: ProductionTimelineClip) => ProductionSubtitleCue[]): T {
  const vox = document.workflowKind === 'editorial-collage';
  const shots = vox ? document.beats.flatMap((beat) => beat.shots) : document.episodes.flatMap((episode) => episode.scenes.flatMap((scene) => scene.shots));
  const owners = shots.filter((shot) => shot.id === shotId);
  if (owners.length !== 1) throw new Error('未找到唯一的当前镜头。');
  const shot = owners[0];
  const episode = !vox ? document.episodes.find((item) => item.scenes.some((scene) => scene.shots.some((item) => item.id === shotId))) : undefined;
  const beat = vox ? document.beats.find((item) => item.shots.some((item) => item.id === shotId)) : undefined;
  const timeline = vox ? document.timeline : episode?.timeline;
  const clip = timeline?.clips.find((item) => item.shotId === shotId);
  if (!clip || clip.durationMs !== shot.durationMs) throw new Error('当前镜头时间线无效。');
  const ids = 'subtitleCueIds' in shot ? shot.subtitleCueIds : shot.dialogueCueIds;
  const pool = beat?.subtitleCues ?? episode?.dialogueCues ?? [];
  const cues = ids.map((id) => pool.find((cue) => cue.id === id));
  if (cues.some((cue) => !cue) || new Set(ids).size !== ids.length) throw new Error('当前镜头字幕引用无效。');
  const nextCues = edit(cues as ProductionSubtitleCue[], clip).map((cue) => {
    if (cue.startMs < clip.startMs || cue.endMs > clip.startMs + clip.durationMs || cue.endMs <= cue.startMs) throw new Error('字幕时间必须在所属镜头内。');
    // Structure changes alter the spoken sequence. Keep historical assets, but
    // do not silently export audio generated for the previous sequence.
    const next = invalidateSubtitleAlignment(cue, { audioAssetVersionId: null });
    if ('voiceAssetVersionId' in next) delete next.voiceAssetVersionId;
    return next;
  });
  const nextIds = nextCues.map((cue) => cue.id);
  if (vox && beat) {
    const subtitleCues = [...pool.filter((cue) => !ids.includes(cue.id)), ...nextCues].sort((a, b) => a.startMs - b.startMs);
    return rebuildEditorialTimeline({
      ...document,
      ...(document.timeline?.audioClips ? {
        timeline: {
          ...document.timeline,
          audioClips: document.timeline.audioClips.filter((item) => item.shotId !== shotId || (item.trackType !== 'dialogue' && item.trackType !== 'narration')),
        },
      } : {}),
      beats: document.beats.map((item) => item !== beat ? item : { ...beat, subtitleCues, narration: subtitleCues.map((cue) => cue.text).join(' '), shots: beat.shots.map((item) => item.id !== shotId ? item : { ...item, voiceAssetVersionId: undefined, subtitleCueIds: nextIds }) }),
    }) as T;
  }
  if (!vox && episode) {
    const staleAudioIds = new Set([shot.voiceAssetVersionId, ...cues.flatMap((cue) => [cue?.audioAssetVersionId, (cue as MotionComicDialogueCue)?.voiceAssetVersionId])].filter(Boolean));
    const dialogueCues = [...episode.dialogueCues.filter((cue) => !ids.includes(cue.id)), ...nextCues.map((cue): MotionComicDialogueCue => ({ ...cue, shotId, emotion: (cue as MotionComicDialogueCue).emotion ?? '自然' }))].sort((a, b) => a.startMs - b.startMs);
    const retainedAudioIds = new Set([
      ...episode.scenes.flatMap((scene) => scene.shots).filter((item) => item.id !== shotId).map((item) => item.voiceAssetVersionId),
      ...dialogueCues.filter((cue) => cue.shotId !== shotId).flatMap((cue) => [cue.audioAssetVersionId, cue.voiceAssetVersionId]),
    ].filter(Boolean));
    return { ...document, episodes: document.episodes.map((item) => item !== episode ? item : {
      ...episode,
      dialogueCues,
      scenes: episode.scenes.map((scene) => ({ ...scene, shots: scene.shots.map((item) => item.id !== shotId ? item : { ...item, voiceAssetVersionId: undefined, dialogueCueIds: nextIds }) })),
      timeline: { ...episode.timeline, audioAssetVersionIds: episode.timeline.audioAssetVersionIds.filter((id) => !staleAudioIds.has(id) || retainedAudioIds.has(id)), ...(episode.timeline.audioClips ? { audioClips: episode.timeline.audioClips.filter((item) => item.shotId !== shotId || item.trackType !== 'dialogue') } : {}), clips: episode.timeline.clips.map((item) => item !== clip ? item : { ...clip, subtitleCueIds: nextIds, assetVersionIds: clip.assetVersionIds.filter((id) => !staleAudioIds.has(id)) }) },
    }) } as T;
  }
  throw new Error('未找到字幕所有者。');
}
