import { describe, expect, it } from 'vitest';
import {
  lemoAudioMixSchema, lemoSoundEventSchema, validateLemoAgentAudio,
  type LemoAudioValidationInput,
} from '../src/shared/creative-animation/agent-audio';

function fixture(): LemoAudioValidationInput {
  return {
    durationSeconds: 10, fps: 24,
    mix: {
      version: 1, stems: { sfx: { gainDb: -10 } },
      duck: { under: 'narration', attackMs: 80, releaseMs: 450 },
      silences: [{ t0: 0, t1: 1, reason: 'Opening' }, { t0: 9, t1: 10, reason: 'Ending' }],
      transitions: [{ kind: 'J', at: 4, lead: 0.6 }, { kind: 'L', at: 6, tail: 0.6 }],
    },
    events: [{ id: 'impact-1', time: 5, kind: 'impact', sound: 'tap' }],
    stems: [{ stem: 'sfx', durationSeconds: 10, sampleRate: 48000, channels: 2, format: 'float32', peakAmplitude: 1, nonFiniteSamples: 0 }],
    onsets: [{ eventId: 'impact-1', provenance: 'measured', time: 5, method: 'isolated transient analysis' }],
    narration: [{ t0: 1, t1: 9 }],
    silenceMeasurements: [0, 1].flatMap(silenceIndex => (['sfx', 'narration'] as const).map(stem => ({
      silenceIndex, stem, peakAmplitude: 0, provenance: 'measured' as const, method: 'full interval peak',
    }))),
  };
}
const codes = (input: unknown) => validateLemoAgentAudio(input).map(issue => issue.code);

describe('T3 shared audio contract', () => {
  it('accepts measured stems and half-open narration boundaries including silence ending at DUR', () => {
    expect(validateLemoAgentAudio(fixture())).toEqual([]);
  });

  it('strictly rejects unknown keys and invalid nested mix fields', () => {
    const mix = fixture().mix;
    for (const invalid of [
      { ...mix, unexpected: true },
      { ...mix, stems: { voice: { gainDb: 0 } } },
      { ...mix, stems: { music: { gainDb: NaN } } },
      { ...mix, duck: { ...mix.duck, music: 1 } },
      { ...mix, duck: { ...mix.duck, attackMs: -1 } },
      { ...mix, silences: [{ t0: 1, t1: 1, reason: 'empty' }] },
      { ...mix, transitions: [{ kind: 'J', at: 1, tail: 1 }] },
      { ...mix, transitions: [{ kind: 'L', at: 1, tail: Infinity }] },
    ]) expect(lemoAudioMixSchema.safeParse(invalid).success).toBe(false);
  });

  it.each([
    { id: '', time: 0, kind: 'hit' }, { id: 'x', time: -1, kind: 'hit' },
    { id: 'x', time: Infinity, kind: 'hit' }, { id: 'x', time: 0, kind: ' ' },
    { id: 'x', time: 0, kind: 'hit', sound: '' }, { id: 'x', time: 0, kind: 'hit', extra: 1 },
  ])('rejects invalid normalized events: %j', event => {
    expect(lemoSoundEventSchema.safeParse(event).success).toBe(false);
  });

  it.each([NaN, Infinity, -Infinity, 0, -24])('rejects invalid fps %s with actionable issues', fps => {
    const result = validateLemoAgentAudio({ ...fixture(), fps });
    expect(result).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid_contract', severity: 'failure', path: 'fps' })]));
    expect(result[0].message).toContain('Correct');
  });

  it.each([24, 30, 60, 29.97])('uses one frame at %s fps for duration and measured sync', fps => {
    const input = fixture();
    input.fps = fps;
    input.stems[0].durationSeconds += 1 / fps;
    input.onsets = [{ eventId: 'impact-1', provenance: 'measured', time: 5 - 1 / fps, method: 'transient' }];
    expect(codes(input)).not.toContain('stem_duration');
    expect(codes(input)).not.toContain('onset_sync');
    input.stems[0].durationSeconds += 0.00001;
    input.onsets = [{ eventId: 'impact-1', provenance: 'measured', time: 5 - 1 / fps - 0.00001, method: 'transient' }];
    expect(codes(input)).toEqual(expect.arrayContaining(['stem_duration', 'onset_sync']));
  });

  it('rejects bad sample format, non-finite samples and clipping independently', () => {
    const input = fixture();
    Object.assign(input.stems[0], { sampleRate: 44100, channels: 1, nonFiniteSamples: 2, peakAmplitude: 1.001 });
    expect(codes(input)).toEqual(expect.arrayContaining(['stem_format', 'non_finite_samples', 'stem_clipping']));
    for (const patch of [{ peakAmplitude: NaN }, { peakAmplitude: Infinity }, { durationSeconds: Infinity }, { sampleRate: NaN }, { format: 'pcm16' }]) {
      expect(codes({ ...fixture(), stems: [{ ...fixture().stems[0], ...patch }] })).toContain('invalid_contract');
    }
  });

  it('never treats declared or unavailable onset timing as measured synchronization', () => {
    const input = fixture();
    for (const onsets of [undefined, [],
      [{ eventId: 'impact-1', provenance: 'declared', time: 5, source: 'score.py' }],
      [{ eventId: 'impact-1', provenance: 'unavailable', reason: 'Overlapping sustained sounds cannot be separated' }],
    ]) {
      const result = validateLemoAgentAudio({ ...input, onsets });
      expect(result).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'onset_evidence_missing', severity: 'warning' })]));
      expect(result.some(issue => issue.code === 'onset_sync')).toBe(false);
    }
  });

  it('does not require audio or silence designs for intentionally absent stems', () => {
    const input = fixture();
    input.mix.stems = {};
    input.mix.silences = [];
    input.stems = [];
    input.events = [{ id: 'visual-only', time: 1, kind: 'cut' }];
    input.onsets = [];
    input.silenceMeasurements = [];
    expect(validateLemoAgentAudio(input)).toEqual([]);
    input.events[0].sound = 'tap';
    expect(codes(input)).toContain('missing_sfx');
  });

  it('reports requested missing stems and undeclared or duplicate measurements', () => {
    const input = fixture();
    input.mix.stems.music = { gainDb: -16 };
    input.stems.push({ ...input.stems[0] });
    input.stems.push({ ...input.stems[0], stem: 'ambience' });
    expect(codes(input)).toEqual(expect.arrayContaining(['missing_stem', 'duplicate_stem', 'undeclared_stem']));
  });

  it('warns on silence overlap and exact -45 dBFS while accepting levels below it', () => {
    const input = fixture();
    input.narration = [{ t0: 0.999, t1: 9.001 }];
    input.silenceMeasurements![0].peakAmplitude = 10 ** (-45 / 20);
    expect(codes(input).filter(code => code === 'silence_narration_overlap')).toHaveLength(2);
    expect(codes(input)).toContain('silence_level');
    input.silenceMeasurements![0].peakAmplitude = 10 ** (-45.001 / 20);
    expect(codes(input)).not.toContain('silence_level');
  });

  it('does not claim silence is measured when timing or peaks are missing', () => {
    const input = fixture();
    delete input.narration;
    delete input.silenceMeasurements;
    expect(codes(input)).toEqual(expect.arrayContaining(['narration_evidence_missing', 'silence_evidence_missing']));
  });

  it('checks timeline boundaries, duplicate IDs and orphan evidence', () => {
    const input = fixture();
    input.events.push({ ...input.events[0], time: 10 });
    input.mix.silences[1].t1 = 10.001;
    input.mix.transitions = [{ kind: 'J', at: 0, lead: 1 }, { kind: 'L', at: 10, tail: 1 }];
    input.onsets!.push({ eventId: 'missing', provenance: 'measured', time: 2, method: 'transient' });
    expect(codes(input)).toEqual(expect.arrayContaining(['duplicate_event', 'event_bounds', 'silence_bounds', 'transition_bounds', 'orphan_onset_evidence']));
  });
});
