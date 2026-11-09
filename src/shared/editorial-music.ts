import type { VoxProjectMusic } from './vox-production';
import type { ProductionAudioClip } from './production-audio';
import { sliceProductionAudioClip } from './production-audio';
import type { ProductionTimeline } from './production-workflow';

export const PROJECT_MUSIC_PREFIX = 'project-music-';

/** One music clock across shots, split only for the existing scene mixer. */
export function editorialProjectMusicClips(timeline: ProductionTimeline, music: VoxProjectMusic): ProductionAudioClip[] {
  const result: ProductionAudioClip[] = [];
  const endMs = music.loop ? timeline.durationMs : Math.min(timeline.durationMs, music.durationMs);
  for (const shot of timeline.clips) {
    let cursor = shot.startMs;
    const end = Math.min(shot.startMs + shot.durationMs, endMs);
    while (cursor < end) {
      const cycle = Math.floor(cursor / music.durationMs);
      const cycleStart = cycle * music.durationMs;
      const cycleDuration = Math.min(music.durationMs, endMs - cycleStart);
      const source: ProductionAudioClip = {
        id: `${PROJECT_MUSIC_PREFIX}${shot.shotId}-${cycle}`, assetVersionId: `${PROJECT_MUSIC_PREFIX}${music.id}`,
        shotId: shot.shotId, trackType: 'music', startMs: cycleStart,
        sourceStartMs: 0, sourceDurationMs: cycleDuration, sourceMediaDurationMs: music.durationMs, durationMs: cycleDuration,
        gainDb: music.gainDb, fadeInMs: cycle === 0 ? Math.min(music.fadeInMs, cycleDuration) : 0,
        fadeOutMs: cycleStart + cycleDuration === endMs ? Math.min(music.fadeOutMs, cycleDuration) : 0,
      };
      const clip = sliceProductionAudioClip(source, cursor, end, endMs);
      if (!clip) break;
      result.push(clip);
      cursor = clip.startMs + clip.durationMs!;
    }
  }
  return result;
}


