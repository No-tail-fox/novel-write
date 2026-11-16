import { expect, it } from 'vitest';
import { validateFilmCaptions } from '../src/shared/creative-animation/film-captions';
const cue = { id: 'a', text: '原文', startMs: 1000, endMs: 3000 };
const observation = { id: 'cap:a', text: '原文', startMs: 1000, endMs: 3000, inSafeArea: true };
const input = { cues: [cue], observations: [observation], captionsDisabledObservations: [], fps: 24, mode: 'film' as const };
it('requires exact caption text and continuous coverage', () => {
  expect(validateFilmCaptions(input)).toEqual([]);
  expect(validateFilmCaptions({ ...input, observations: [{ ...observation, text: '改文' }] })).toContainEqual({ code: 'FILM_CAPTIONS_TEXT_MISMATCH', cueId: 'a' });
  expect(validateFilmCaptions({ ...input, observations: [{ ...observation, endMs: 1500 }, { ...observation, startMs: 1800 }] })).toContainEqual({ code: 'FILM_CAPTIONS_COVERAGE_GAP', cueId: 'a' });
});
it('requires captions off for host overlay and editable draft', () => {
  expect(validateFilmCaptions({ ...input, captionsDisabledObservations: [observation] })).toContainEqual({ code: 'FILM_CAPTIONS_DISABLE_FAILED' });
  expect(validateFilmCaptions({ ...input, mode: 'host' })).toContainEqual({ code: 'FILM_CAPTIONS_DUPLICATE_HOST' });
  expect(validateFilmCaptions({ ...input, mode: 'host', observations: [] })).toEqual([]);
});
