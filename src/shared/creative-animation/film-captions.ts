export interface FilmCaptionCue { id: string; text: string; startMs: number; endMs: number }
export interface FilmCaptionObservation { id: string; text: string; startMs: number; endMs: number; inSafeArea: boolean }
export interface FilmCaptionIssue { code: string; cueId?: string }
/** Observations must come from host sampling, not an Agent's self-reported finish notes. */
export function validateFilmCaptions(input: {
  cues: readonly FilmCaptionCue[];
  observations: readonly FilmCaptionObservation[];
  captionsDisabledObservations: readonly FilmCaptionObservation[];
  fps: number;
  mode: 'film' | 'host';
}): FilmCaptionIssue[] {
  if (!Number.isFinite(input.fps) || input.fps <= 0) throw new Error('FILM_CAPTION_FPS');
  const issues: FilmCaptionIssue[] = [];
  const frameMs = 1000 / input.fps;
  if (input.captionsDisabledObservations.some(observation => observation.id.startsWith('cap:'))) issues.push({ code: 'FILM_CAPTIONS_DISABLE_FAILED' });
  const captions = input.observations.filter(observation => observation.id.startsWith('cap:'));
  if (input.mode === 'host') {
    if (captions.length) issues.push({ code: 'FILM_CAPTIONS_DUPLICATE_HOST' });
    return issues;
  }
  const expected = new Map(input.cues.map(cue => ['cap:' + cue.id, cue]));
  if (expected.size !== input.cues.length) issues.push({ code: 'FILM_CAPTIONS_DUPLICATE_CUE' });
  for (const observation of captions) {
    if (!expected.has(observation.id)) issues.push({ code: 'FILM_CAPTIONS_UNEXPECTED', cueId: observation.id });
  }
  for (const [id, cue] of expected) {
    const observed = captions.filter(observation => observation.id === id).sort((a, b) => a.startMs - b.startMs);
    if (!Number.isFinite(cue.startMs) || !Number.isFinite(cue.endMs) || cue.startMs < 0 || cue.endMs <= cue.startMs) {
      issues.push({ code: 'FILM_CAPTIONS_CUE_INVALID', cueId: cue.id }); continue;
    }
    if (!observed.length) { issues.push({ code: 'FILM_CAPTIONS_MISSING', cueId: cue.id }); continue; }
    let coverageEnd = cue.startMs;
    for (const observation of observed) {
      if (observation.text !== cue.text) issues.push({ code: 'FILM_CAPTIONS_TEXT_MISMATCH', cueId: cue.id });
      if (!observation.inSafeArea) issues.push({ code: 'FILM_CAPTIONS_OUTSIDE_SAFE_AREA', cueId: cue.id });
      if (!Number.isFinite(observation.startMs) || !Number.isFinite(observation.endMs) || observation.endMs <= observation.startMs) {
        issues.push({ code: 'FILM_CAPTIONS_OBSERVATION_INVALID', cueId: cue.id }); continue;
      }
      if (observation.startMs - coverageEnd > frameMs) issues.push({ code: 'FILM_CAPTIONS_COVERAGE_GAP', cueId: cue.id });
      coverageEnd = Math.max(coverageEnd, observation.endMs);
    }
    if (cue.endMs - coverageEnd > frameMs) issues.push({ code: 'FILM_CAPTIONS_EARLY_END', cueId: cue.id });
  }
  return issues;
}
