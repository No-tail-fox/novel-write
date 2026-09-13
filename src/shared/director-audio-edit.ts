import type { ProductionAssetVersion, ProductionTimeline } from './production-workflow';
import type { EditorialCollagePipelineData } from './editorial-collage';
import type { MotionComicPipelineData } from './motion-comic';
import { materializeProductionAudioClipsForShot, validateProductionAudioTimeline, type ProductionAudioClip, type ProductionAudioTrackType } from './production-audio';
import { assertProductionHistoryCapacity } from './production-history';

export type DirectorAudioDocument = EditorialCollagePipelineData | MotionComicPipelineData;
export type DirectorAudioEdit = Partial<Pick<ProductionAudioClip, 'startMs' | 'durationMs' | 'sourceStartMs' | 'sourceDurationMs' | 'gainDb' | 'fadeInMs' | 'fadeOutMs' | 'muted' | 'trackType'>>;
export const DIRECTOR_SOUND_TRACKS = ['music', 'sfx', 'ambience', 'foley'] as const;
export const DIRECTOR_AUDIO_LABELS: Record<ProductionAudioTrackType, string> = { dialogue: '对白', narration: '旁白', music: '背景音乐', sfx: '音效', ambience: '环境声', foley: '拟音' };

function owner(document: DirectorAudioDocument, shotId: string) {
  const shot = document.workflowKind === 'editorial-collage'
    ? document.beats.flatMap(beat => beat.shots).find(item => item.id === shotId)
    : document.episodes.flatMap(episode => episode.scenes.flatMap(scene => scene.shots)).find(item => item.id === shotId);
  const episode = document.workflowKind === 'motion-comic' ? document.episodes.find(item => item.scenes.some(scene => scene.shots.some(shot => shot.id === shotId))) : undefined;
  const timeline = document.workflowKind === 'editorial-collage' ? document.timeline : episode?.timeline;
  if (!shot || !timeline || !timeline.clips.some(clip => clip.shotId === shotId)) throw new Error('声音编辑失败：镜头时间线不存在。');
  return { shot, timeline, episode };
}

/** Includes the old aggregate narration as an editable, explicitly owned clip. */
export function directorEditableAudioClips(document: DirectorAudioDocument, shotId: string): ProductionAudioClip[] {
  const { shot, timeline } = owner(document, shotId);
  return materializeProductionAudioClipsForShot(timeline, shot);
}

function replaceAudio<T extends DirectorAudioDocument>(document: T, shotId: string, clips: ProductionAudioClip[], asset?: ProductionAssetVersion): T {
  const { timeline, episode } = owner(document, shotId);
  const audioClips = [...(timeline.audioClips ?? []).filter(clip => clip.shotId !== shotId), ...clips];
  const assets = [...document.assets.map(item => {
    if (item.assetId !== 'director-final-video') return item;
    if (document.workflowKind === 'motion-comic' && episode && item.episodeId && item.episodeId !== episode.id) return item;
    return { ...item, selected: false, pinned: false };
  }), ...(asset ? [asset] : [])];
  const shots = document.workflowKind === 'editorial-collage' ? document.beats.flatMap(beat => beat.shots) : episode!.scenes.flatMap(scene => scene.shots);
  const nextTimeline: ProductionTimeline = { ...timeline, audioClips,
    audioAssetVersionIds: [...new Set([...shots.flatMap(shot => shot.voiceAssetVersionId ? [shot.voiceAssetVersionId] : []), ...audioClips.map(clip => clip.assetVersionId)])] };
  const issues = validateProductionAudioTimeline(nextTimeline, new Map(assets.map(item => [item.id, item])));
  if (issues.length) {
    const message = issues[0].message;
    const detail = message.includes('owning shot') ? '片段起点与时长不能超出当前镜头。'
      : message.includes('source file duration') ? '源裁剪范围不能超过音频文件时长。'
        : message.includes('fade') ? '淡入淡出不能超过片段时长。'
          : message.includes('gain') ? '音量必须在 -60 到 24 dB 之间。'
            : message.includes('audio asset') ? '音频资产不可用，请重新导入。' : '片段时间或资产无效，请检查后重试。';
    throw new Error(`声音编辑失败：${detail}`);
  }
  return (document.workflowKind === 'editorial-collage'
    ? { ...document, stage: 'assets', assets, timeline: nextTimeline }
    : { ...document, stage: 'audio', assets, episodes: document.episodes.map(item => item.id === episode!.id ? { ...item, status: 'draft', timeline: nextTimeline } : item) }) as T;
}

/** Speech timing remains subtitle-owned. Mixing edits never invalidate the recording. */
export function updateDirectorAudioClip<T extends DirectorAudioDocument>(document: T, shotId: string, clipId: string, patch: DirectorAudioEdit): T {
  const clips = directorEditableAudioClips(document, shotId);
  const clip = clips.find(item => item.id === clipId);
  if (!clip) throw new Error('声音片段已移除，请重新选择。');
  const allowed = ['startMs', 'durationMs', 'sourceStartMs', 'sourceDurationMs', 'gainDb', 'fadeInMs', 'fadeOutMs', 'muted', 'trackType'];
  if (Object.keys(patch).some(key => !allowed.includes(key))) throw new Error('不支持的声音编辑字段。');
  const speech = clip.trackType === 'dialogue' || clip.trackType === 'narration';
  if (speech && Object.keys(patch).some(key => !['gainDb', 'fadeInMs', 'fadeOutMs', 'muted'].includes(key))) throw new Error('对白和旁白时间由字幕控制，请在字幕页调整。');
  if (patch.trackType !== undefined && !(DIRECTOR_SOUND_TRACKS as readonly string[]).includes(patch.trackType)) throw new Error('导入音频只能使用背景音乐、音效、环境声或拟音轨道。');
  if (patch.muted !== undefined && typeof patch.muted !== 'boolean') throw new Error('静音值无效。');
  for (const field of ['startMs', 'durationMs', 'sourceStartMs', 'sourceDurationMs', 'fadeInMs', 'fadeOutMs'] as const) {
    if (patch[field] !== undefined && !Number.isInteger(patch[field])) throw new Error('时间必须为整数毫秒。');
  }
  const next = { ...clip, ...patch };
  if (['durationMs', 'sourceStartMs', 'sourceDurationMs', 'fadeInMs', 'fadeOutMs'].some(key => key in patch)) next.fadeEnvelope = undefined;
  const duration = next.durationMs ?? next.sourceDurationMs ?? owner(document, shotId).shot.durationMs;
  if ((next.fadeInMs ?? 0) > duration || (next.fadeOutMs ?? 0) > duration) throw new Error('淡入淡出不能超过片段时长。');
  return replaceAudio(document, shotId, clips.map(item => item.id === clipId ? next : item));
}

export function removeDirectorSoundClip<T extends DirectorAudioDocument>(document: T, shotId: string, clipId: string): T {
  const clips = directorEditableAudioClips(document, shotId);
  const clip = clips.find(item => item.id === clipId);
  if (!clip) throw new Error('声音片段已移除。');
  if (clip.trackType === 'dialogue' || clip.trackType === 'narration') throw new Error('请在字幕页管理对白录音；可在这里静音。');
  return replaceAudio(document, shotId, clips.filter(item => item.id !== clipId));
}

export function addDirectorSoundClip<T extends DirectorAudioDocument>(document: T, shotId: string, input: {
  id: string; title: string; path: string; durationMs: number; trackType: (typeof DIRECTOR_SOUND_TRACKS)[number]; createdAt: string;
}): T {
  const { shot, timeline } = owner(document, shotId);
  if (!input.id.trim() || document.assets.some(asset => asset.id === input.id) || !input.path.trim() || !Number.isFinite(input.durationMs) || input.durationMs <= 0) throw new Error('导入音频无效或重复。');
  if (!(DIRECTOR_SOUND_TRACKS as readonly string[]).includes(input.trackType)) throw new Error('声音轨道类型无效。');
  assertProductionHistoryCapacity(document, { assets: 1 });
  const durationMs = Math.min(shot.durationMs, Math.round(input.durationMs));
  const asset: ProductionAssetVersion = { id: input.id, assetId: input.id, kind: 'audio', localPath: input.path, prompt: input.title,
    provider: 'local-import', createdAt: input.createdAt, selected: true, pinned: false, durationMs: Math.round(input.durationMs) };
  const clip: ProductionAudioClip = { id: `sound-clip-${input.id}`, shotId, assetVersionId: asset.id, trackType: input.trackType,
    startMs: timeline.clips.find(item => item.shotId === shotId)!.startMs, durationMs, sourceStartMs: 0, sourceDurationMs: durationMs, sourceMediaDurationMs: Math.round(input.durationMs),
    gainDb: input.trackType === 'music' ? -18 : 0, fadeInMs: 0, fadeOutMs: 0, muted: false };
  return replaceAudio(document, shotId, [...directorEditableAudioClips(document, shotId), clip], asset);
}
