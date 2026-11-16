import { describe, expect, it } from 'vitest';
import { narrationPauseChangeDecision, planNarrationPauses, type NarrationPauseBase } from '../src/shared/creative-animation/narration-pauses';
const base: NarrationPauseBase = { durationMs: 30_000, targetDurationSeconds: 30, allowed: true, musicMv: false, lockedWindows: [], cues: [
  { id: 'a', startMs: 0, endMs: 5000, sentenceEnd: false },
  { id: 'b', startMs: 5000, endMs: 10000, sentenceEnd: true },
  { id: 'c', startMs: 10000, endMs: 25000, sentenceEnd: true },
] };
const pause = { afterCueId: 'b', ms: 500, reason: 'Pause before the reveal' };
describe('host narration pause planning', () => {
  it('preserves voiced durations and shifts later cues without mutating baseline', () => {
    const result = planNarrationPauses(base, [pause]);
    expect(result.durationMs).toBe(30500);
    expect(result.cues[1]).toEqual(base.cues[1]);
    expect(result.cues[2]).toMatchObject({ startMs: 10500, endMs: 25500 });
    expect(base.cues[2].startMs).toBe(10000);
    expect(planNarrationPauses(base, [pause])).toEqual(result);
    expect(planNarrationPauses(base, []).durationMs).toBe(30000);
  });
  it('does not treat a wrapped subtitle line as an allowed sentence break', () => {
    expect(() => planNarrationPauses(base, [{ ...pause, afterCueId: 'a' }])).toThrow('NOT_SENTENCE_BOUNDARY');
    expect(() => planNarrationPauses(base, [{ ...pause, afterCueId: 'missing' }])).toThrow('NOT_SENTENCE_BOUNDARY');
    expect(() => planNarrationPauses(base, [pause, pause])).toThrow('DUPLICATE');
  });
  it('permits intro and outro silence while retaining cue lengths', () => {
    const result = planNarrationPauses(base, [{ ...pause, afterCueId: null }, { ...pause, afterCueId: 'c' }]);
    expect(result.cues[0].startMs).toBe(500);
    expect(result.cues[2].endMs).toBe(25500);
    expect(result.durationMs).toBe(31000);
  });
  it('rejects changes before or inside a locked window, but permits a pause after it', () => {
    const locked = { ...base, lockedWindows: [{ startMs: 20000, endMs: 25000 }] };
    expect(() => planNarrationPauses(locked, [pause])).toThrow('LOCKED_WINDOW');
    expect(planNarrationPauses(locked, [{ ...pause, afterCueId: 'c' }]).addedDurationMs).toBe(500);
  });
  it('enforces exact duration limits and fixed-song exclusion', () => {
    expect(() => planNarrationPauses({ ...base, musicMv: true }, [pause])).toThrow('DISABLED');
    expect(() => planNarrationPauses({ ...base, allowed: false }, [pause])).toThrow('DISABLED');
    expect(() => planNarrationPauses(base, [{ ...pause, ms: 2000 }, { ...pause, afterCueId: 'c', ms: 2000 }])).toThrow('TARGET_LIMIT');
    expect(() => planNarrationPauses({ ...base, durationMs: 40000, targetDurationSeconds: 60 }, [{ ...pause, ms: 2001 }])).toThrow();
  });
  it('replays receipts without consuming the accepted-change limit', () => {
    expect(narrationPauseChangeDecision([pause], [{ ...pause, reason: 'Reworded explanation' }], 3)).toBe('unchanged');
    expect(() => narrationPauseChangeDecision([pause], [], 3)).toThrow('CHANGE_LIMIT');
    expect(narrationPauseChangeDecision([], [pause], 0)).toBe('apply');
  });
});
