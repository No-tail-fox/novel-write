import { describe, expect, it } from 'vitest';
import { clampPlaybackTime, formatPlaybackTime, playbackShotAt, playbackShotOffset } from '../src/features/director-desk/director-playback';

const shots = [
  { id: 'shot-1', durationMs: 3_000 },
  { id: 'shot-2', durationMs: 9_000 },
  { id: 'shot-3', durationMs: 9_000 },
];

describe('director desk playback helpers', () => {
  it('uses an unambiguous minutes and seconds display', () => {
    expect(formatPlaybackTime(0)).toBe('00:00');
    expect(formatPlaybackTime(30_000)).toBe('00:30');
    expect(formatPlaybackTime(65_900)).toBe('01:05');
  });

  it('resolves shot offsets and exact timeline boundaries', () => {
    expect(playbackShotOffset(shots, 'shot-2')).toBe(3_000);
    expect(playbackShotAt(shots, 2_999)?.id).toBe('shot-1');
    expect(playbackShotAt(shots, 3_000)?.id).toBe('shot-2');
    expect(playbackShotAt(shots, 12_000)?.id).toBe('shot-3');
  });

  it('clamps seeks to the available timeline', () => {
    expect(clampPlaybackTime(-500, 21_000)).toBe(0);
    expect(clampPlaybackTime(8_250, 21_000)).toBe(8_250);
    expect(clampPlaybackTime(25_000, 21_000)).toBe(21_000);
  });
});
