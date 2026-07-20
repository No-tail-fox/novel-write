import { describe, expect, it } from 'vitest';
import { buildMusicMvPlan } from '@shared/runner';
import type { Task } from '@shared/types';

function musicTask(inputText: string): Task {
  return {
    inputText, title: 'Timestamp MV', style: 'modern-film', ratio: '16:9',
    storyboardSceneCount: 2, targetScenes: 2,
    musicMv: { rhythmMode: 'lyric-sync', captionStyle: 'minimal', visualMotif: 'neon rain', audioPath: 'song.wav' },
  } as Task;
}

describe('Music MV runtime contract', () => {
  it('bounds timestamped lyrics to requested scenes and synchronizes them to probed audio', () => {
    const plan = buildMusicMvPlan(musicTask('[00:01.00]First lyric\n[00:03.50]Second lyric\n[00:06.00]Ignored lyric'), 8_000);
    expect(plan.audioDurationMs).toBe(8_000);
    expect(plan.segments).toEqual([
      expect.objectContaining({ id: 1, lyric: 'First lyric', startMs: 1_000, durationMs: 2_500 }),
      expect.objectContaining({ id: 2, lyric: 'Second lyric', startMs: 3_500, durationMs: 4_500 }),
    ]);
  });

  it('uses deterministic untimed durations without exceeding the requested scene count', () => {
    const plan = buildMusicMvPlan(musicTask('One\nTwo\nThree'), 6_000);
    expect(plan.segments).toHaveLength(2);
    expect(plan.segments.map((item) => [item.startMs, item.durationMs])).toEqual([[0, 3_000], [3_000, 3_000]]);
  });
});
