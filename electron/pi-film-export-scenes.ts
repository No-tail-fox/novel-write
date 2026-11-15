import type { EditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { buildDirectorRenderScenes, type DirectorRenderScene } from '../src/shared/director-render';
import { lemoReservedWindows } from '../src/shared/lemo-locked-shots';
import type { PiNarrationTimelineResult } from './pi-narration-timeline';
import { piFilmReadyErrors } from '../src/shared/creative-animation/pi-film';

/** The v4 master and authoritative timeline replace per-shot audio; locked pictures retain their exact windows. */
export function buildPiFilmExportScenes(document: EditorialCollagePipelineData, picturePath: string, masterPath: string, timeline: PiNarrationTimelineResult): DirectorRenderScene[] {
  const film = document.piFilm;
  if (!film || film.runId !== document.productionRun?.id || piFilmReadyErrors(film).length || !film.audioMaster) throw new Error('PI_EXPORT_NOT_READY');
  if (film.audioMaster.sourceHash !== film.sourceHash || film.audioMaster.timelineHash !== film.timelineHash || Math.abs(film.actualDurationSeconds * 1000 - timeline.durationMs) > 1) throw new Error('PI_EXPORT_STALE');
  const boundaries = new Set([0, timeline.durationMs]);
  const windows = lemoReservedWindows(document) ?? [];
  for (const window of windows) { boundaries.add(window.startMs); boundaries.add(window.endMs); }
  const points = [...boundaries].sort((a, b) => a - b);
  const scenes: DirectorRenderScene[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i], end = points[i + 1];
    const window = windows.find(window => window.startMs === start && window.endMs === end);
    let scene: DirectorRenderScene;
    if (window) {
      const [lockedScene] = buildDirectorRenderScenes({ ...document, productionRun: undefined }, undefined, { shotIds: [window.shotId] });
      if (!lockedScene || lockedScene.durationMs !== end - start) throw new Error('PI_LOCKED_EXPORT_DURATION');
      scene = lockedScene;
    } else scene = { id: `pi-film-${i}`, index: i, title: document.title, caption: '', durationMs: end - start,
      renderStrategy: 'living-poster', preserveSourcePicture: true, videoPath: picturePath, videoStartMs: start, layers: [], camera: [], audioPath: '' };
    const subtitleCues = film.policy.captionMode === 'host' || window ? timeline.cues.filter(cue => cue.startMs < end && cue.endMs > start)
      .map(cue => ({ id: cue.id, text: cue.text, startMs: Math.max(start, cue.startMs) - start, endMs: Math.min(end, cue.endMs) - start })) : [];
    scenes.push({ ...scene, index: i, caption: '', subtitleCues, transitionIn: { type: 'cut', durationMs: 0 }, audioPath: '',
      audioClips: [{ id: `pi-master-${i}`, assetVersionId: 'pi-master', path: masterPath, trackType: 'narration', startMs: 0,
        durationMs: end - start, sourceStartMs: start, sourceDurationMs: end - start, sourceMediaDurationMs: timeline.durationMs, gainDb: 0 }] });
  }
  return scenes;
}
