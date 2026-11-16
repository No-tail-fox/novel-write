import { z } from 'zod';

const finite = z.number().finite();
const time = finite.nonnegative();
const label = z.string().trim().min(1);
export const lemoAudioStemSchema = z.enum(['music', 'ambience', 'sfx']);
const gain = z.object({ gainDb: finite }).strict();
export const lemoAudioSilenceSchema = z.object({ t0: time, t1: time, reason: label }).strict()
  .refine(value => value.t1 > value.t0, { path: ['t1'], message: 'Silence must end after it starts.' });
export const lemoAudioTransitionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('J'), at: time, lead: time }).strict(),
  z.object({ kind: z.literal('L'), at: time, tail: time }).strict(),
]);
/** Omitted stem keys explicitly mean that the production does not request those stems. */
export const lemoAudioMixSchema = z.object({
  version: z.literal(1),
  stems: z.object({ music: gain.optional(), ambience: gain.optional(), sfx: gain.optional() }).strict(),
  duck: z.object({
    under: z.literal('narration'), music: finite.max(0).optional(), ambience: finite.max(0).optional(),
    attackMs: time, releaseMs: time,
  }).strict(),
  silences: z.array(lemoAudioSilenceSchema),
  transitions: z.array(lemoAudioTransitionSchema),
}).strict();
/** Host-normalized event. `sound` absent means no sound is requested for this visual event. */
export const lemoSoundEventSchema = z.object({ id: label, time, kind: label, sound: label.optional() }).strict();
/** Measurements supplied by the host's decoder, never inferred from a filename or mix declaration.
 * Linear peak keeps digital silence representable as 0 (rather than non-finite -Infinity dBFS).
 */
export const lemoAudioStemMetadataSchema = z.object({
  stem: lemoAudioStemSchema, durationSeconds: finite.positive(), sampleRate: finite.int().positive(),
  channels: finite.int().positive(), format: z.enum(['float32', 'pcm24']),
  peakAmplitude: time, nonFiniteSamples: finite.int().nonnegative(),
}).strict();
export const lemoAudioOnsetEvidenceSchema = z.discriminatedUnion('provenance', [
  z.object({ eventId: label, provenance: z.literal('measured'), time, method: label }).strict(),
  z.object({ eventId: label, provenance: z.literal('declared'), time, source: label }).strict(),
  z.object({ eventId: label, provenance: z.literal('unavailable'), reason: label }).strict(),
]);
const interval = z.object({ t0: time, t1: time }).strict()
  .refine(value => value.t1 > value.t0, { path: ['t1'], message: 'Interval must end after it starts.' });
export const lemoAudioValidationInputSchema = z.object({
  durationSeconds: finite.positive(), fps: finite.positive(), mix: lemoAudioMixSchema,
  events: z.array(lemoSoundEventSchema), stems: z.array(lemoAudioStemMetadataSchema),
  onsets: z.array(lemoAudioOnsetEvidenceSchema).optional(),
  /** Omit if cue timing is unavailable; an empty list explicitly means no narration. */
  narration: z.array(interval).optional(),
  /** Host-measured maxima over the entire requested silence, after mix gains, before mastering. */
  silenceMeasurements: z.array(z.object({
    silenceIndex: finite.int().nonnegative(), stem: z.enum(['music', 'ambience', 'sfx', 'narration']),
    peakAmplitude: time, provenance: z.literal('measured'), method: label,
  }).strict()).optional(),
}).strict();
export type LemoAudioMix = z.infer<typeof lemoAudioMixSchema>;
export type LemoSoundEvent = z.infer<typeof lemoSoundEventSchema>;
export type LemoAudioStemMetadata = z.infer<typeof lemoAudioStemMetadataSchema>;
export type LemoAudioValidationInput = z.infer<typeof lemoAudioValidationInputSchema>;
export interface LemoAudioIssue {
  code: string;
  severity: 'failure' | 'warning';
  path: string;
  message: string;
}

/** Deterministic contract/evidence checks only. An empty result is not a loudness, spectral,
 * music-grid or perceptual certification; those require separate host measurements.
 * Intervals are half-open [t0,t1); equality at one frame is allowed, at -45 dBFS is not.
 */
export function validateLemoAgentAudio(input: unknown): LemoAudioIssue[] {
  const parsed = lemoAudioValidationInputSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map(issue => ({
    code: 'invalid_contract', severity: 'failure', path: issue.path.join('.'),
    message: `Correct ${issue.path.join('.') || 'audio input'}: ${issue.message}`,
  }));
  const data = parsed.data;
  const issues: LemoAudioIssue[] = [];
  const add = (code: string, severity: LemoAudioIssue['severity'], path: string, message: string) => {
    issues.push({ code, severity, path, message });
  };
  const frame = 1 / data.fps;
  // Only absorb floating-point subtraction noise; never round to milliseconds or whole frames.
  const exceedsFrame = (delta: number) => delta - frame > Number.EPSILON * Math.max(1, data.durationSeconds) * 8;
  const requested = Object.keys(data.mix.stems) as Array<z.infer<typeof lemoAudioStemSchema>>;
  const seenStems = new Set<string>();
  data.stems.forEach((stem, index) => {
    const path = `stems.${index}`;
    if (seenStems.has(stem.stem)) add('duplicate_stem', 'failure', path, `Provide only one measurement for ${stem.stem}.`);
    seenStems.add(stem.stem);
    if (!requested.includes(stem.stem)) add('undeclared_stem', 'failure', path, `Declare ${stem.stem} in mix.stems or remove its rendered file.`);
    if (stem.sampleRate !== 48000 || stem.channels !== 2) add('stem_format', 'failure', path, 'Render this stem at 48000 Hz in stereo.');
    if (exceedsFrame(Math.abs(stem.durationSeconds - data.durationSeconds))) add('stem_duration', 'failure', `${path}.durationSeconds`, `Pad or trim this stem to DUR (${data.durationSeconds}s); tolerance is ${frame}s at ${data.fps} fps.`);
    if (stem.nonFiniteSamples > 0) add('non_finite_samples', 'failure', `${path}.nonFiniteSamples`, 'Regenerate this stem without NaN or infinite samples.');
    if (stem.peakAmplitude > 1) add('stem_clipping', 'failure', `${path}.peakAmplitude`, 'Reduce the rendered stem peak to at most 1 (0 dBFS) before mastering.');
  });
  requested.forEach(stem => {
    if (!seenStems.has(stem)) add('missing_stem', 'failure', `mix.stems.${stem}`, `Render and measure the requested ${stem} stem, or omit it from mix.stems if intentionally absent.`);
  });
  (['music', 'ambience'] as const).forEach(stem => {
    if (data.mix.duck[stem] !== undefined && !requested.includes(stem)) add('duck_absent_stem', 'failure', `mix.duck.${stem}`, `Remove ducking for the absent ${stem} stem or declare it in mix.stems.`);
  });
  const seenEvents = new Set<string>();
  data.events.forEach((event, index) => {
    const path = `events.${index}`;
    if (seenEvents.has(event.id)) add('duplicate_event', 'failure', `${path}.id`, `Assign a unique event ID instead of ${event.id}.`);
    seenEvents.add(event.id);
    if (event.time >= data.durationSeconds) add('event_bounds', 'failure', `${path}.time`, 'Move the event inside [0, DUR).');
    if (!event.sound) return;
    if (!requested.includes('sfx')) add('missing_sfx', 'failure', path, 'Declare and render an sfx stem for this sound event, or remove its sound request.');
    const evidence = (data.onsets ?? []).filter(onset => onset.eventId === event.id);
    if (evidence.length > 1) add('duplicate_onset_evidence', 'failure', path, 'Supply one unambiguous onset evidence record for this event.');
    const onset = evidence[0];
    if (!onset || onset.provenance !== 'measured') {
      const detail = onset?.provenance === 'unavailable' ? ` (${onset.reason})` : '';
      add('onset_evidence_missing', 'warning', path, `Synchronization is unverified${detail}; supply a host-measured onset with its detection method. Declared synthesis timing alone is not measured evidence.`);
    } else if (exceedsFrame(Math.abs(onset.time - event.time))) {
      add('onset_sync', 'failure', path, `Align the measured sfx onset within ${frame}s (one frame at ${data.fps} fps) of event ${event.id}.`);
    }
  });
  (data.onsets ?? []).forEach((onset, index) => {
    if (!data.events.some(event => event.id === onset.eventId && event.sound)) add('orphan_onset_evidence', 'failure', `onsets.${index}`, 'Associate onset evidence with an existing event that requests sound.');
    if ('time' in onset && onset.time >= data.durationSeconds) add('onset_bounds', 'failure', `onsets.${index}.time`, 'Move the onset inside [0, DUR).');
  });
  (data.narration ?? []).forEach((cue, index) => {
    if (cue.t1 > data.durationSeconds) add('narration_bounds', 'failure', `narration.${index}`, 'Keep narration intervals within DUR.');
  });
  if (requested.length && data.mix.silences.length < 2) add('silence_count', 'warning', 'mix.silences', 'Design at least two near-silence intervals where appropriate.');
  data.mix.silences.forEach((silence, index) => {
    const path = `mix.silences.${index}`;
    if (silence.t1 > data.durationSeconds) add('silence_bounds', 'failure', path, 'Keep the entire silence interval within [0, DUR].');
    if (data.narration === undefined) add('narration_evidence_missing', 'warning', path, 'Supply narration cue intervals (or an explicit empty list) to verify this silence.');
    if (data.narration?.some(cue => cue.t0 < silence.t1 && cue.t1 > silence.t0)) add('silence_narration_overlap', 'warning', path, 'Move this silence or the overlapping narration so their intervals do not overlap.');
    const measurements = (data.silenceMeasurements ?? []).filter(item => item.silenceIndex === index);
    const expected: string[] = [...requested, ...(data.narration?.length ? ['narration'] : [])];
    expected.forEach(stem => {
      const matches = measurements.filter(item => item.stem === stem);
      if (!matches.length) add('silence_evidence_missing', 'warning', path, `Measure the full interval for ${stem}; silence is unverified without its peak.`);
      if (matches.length > 1) add('duplicate_silence_evidence', 'failure', path, `Provide one full-interval peak measurement for ${stem}.`);
    });
    measurements.forEach(item => {
      if (item.peakAmplitude >= 10 ** (-45 / 20)) add('silence_level', 'warning', path, `Lower ${item.stem} below -45 dBFS throughout this silence.`);
    });
  });
  (data.silenceMeasurements ?? []).forEach((item, index) => {
    if (item.silenceIndex >= data.mix.silences.length) add('orphan_silence_evidence', 'failure', `silenceMeasurements.${index}`, 'Reference an existing silence interval.');
  });
  data.mix.transitions.forEach((transition, index) => {
    const start = transition.kind === 'J' ? transition.at - transition.lead : transition.at;
    const end = transition.kind === 'L' ? transition.at + transition.tail : transition.at;
    if (start < 0 || end > data.durationSeconds) add('transition_bounds', 'failure', `mix.transitions.${index}`, 'Keep the transition and its lead/tail within [0, DUR].');
  });
  return issues;
}
