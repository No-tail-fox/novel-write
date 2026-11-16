/**
 * Final-film loudness, shared by every route (Lemo mux, template/director renders and HTML video).
 *
 * User decision (backlog E-1 / T-1 / H-2): −14 LUFS integrated, true peak −1 dBTP, two-pass EBU R128
 * `loudnorm` (pass 1 measures with print_format=json, pass 2 applies the measured values with linear=true).
 * Pure module: no Node/Electron imports, so it can be used by the renderer, main process and tests.
 */
export interface LoudnessTarget {
  /** Integrated loudness, LUFS. */
  readonly integratedLufs: number;
  /** Maximum true peak, dBTP. */
  readonly truePeakDb: number;
  /** Loudness range, LU. */
  readonly lra: number;
}

export const FINAL_FILM_LOUDNESS: LoudnessTarget = Object.freeze({ integratedLufs: -14, truePeakDb: -1, lra: 11 });

/** AAC reconstruction can overshoot the PCM limiter. Reserve 0.5 dB before encoding;
 * keep the published loudness goal and post-decode acceptance ceiling unchanged.
 * Both normalization passes must use this target so their target_offset agrees.
 */
export const AAC_ENCODE_LOUDNESS: LoudnessTarget = Object.freeze({
  ...FINAL_FILM_LOUDNESS,
  truePeakDb: FINAL_FILM_LOUDNESS.truePeakDb - 0.5,
});

/** First-pass `loudnorm` JSON fields (ffmpeg names), as strings exactly as ffmpeg printed them. */
export interface LoudnormMeasurement { input_i: string; input_tp: string; input_lra: string; input_thresh: string; target_offset: string }
export const LOUDNORM_MEASUREMENT_KEYS = ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'] as const;

const filterNumber = (value: number, name: string) => {
  if (!Number.isFinite(value)) throw new Error(`LOUDNESS_TARGET_INVALID: ${name} must be finite`);
  return String(Number(value.toFixed(3)));
};

/** `loudnorm=I=-14:TP=-1:LRA=11` — the shared target, without pass-specific options. */
export function loudnormTargetFilter(target: LoudnessTarget = FINAL_FILM_LOUDNESS): string {
  return `loudnorm=I=${filterNumber(target.integratedLufs, 'I')}:TP=${filterNumber(target.truePeakDb, 'TP')}:LRA=${filterNumber(target.lra, 'LRA')}`;
}

/** Pass 1: measure only; ffmpeg prints the JSON block on stderr. */
export function loudnormMeasureFilter(target: LoudnessTarget = FINAL_FILM_LOUDNESS): string {
  return `${loudnormTargetFilter(target)}:print_format=json`;
}

/** A measured value is usable when present and finite (silence yields `-inf`, `inf` or `nan`). */
export function isUsableLoudnormValue(value: string | undefined | null): boolean {
  const text = String(value ?? '').trim();
  return text !== '' && !/inf|nan/i.test(text) && Number.isFinite(Number(text));
}

/** True when every pass-1 field is finite; silent / below-gate audio must skip normalisation instead of failing. */
export function isUsableLoudnormMeasurement(measurement: Partial<Record<keyof LoudnormMeasurement, string>> | null | undefined): measurement is LoudnormMeasurement {
  return !!measurement && LOUDNORM_MEASUREMENT_KEYS.every(key => isUsableLoudnormValue(measurement[key]));
}

/** Pass 2: linear normalisation with the pass-1 measurement. */
export function loudnormApplyFilter(measurement: LoudnormMeasurement, target: LoudnessTarget = FINAL_FILM_LOUDNESS): string {
  if (!isUsableLoudnormMeasurement(measurement)) throw new Error('LOUDNESS_MEASUREMENT_INVALID: loudnorm 第一遍测量值不可用（静音或无音轨应跳过标准化）');
  return `${loudnormTargetFilter(target)}:measured_I=${measurement.input_i.trim()}:measured_TP=${measurement.input_tp.trim()}:measured_LRA=${measurement.input_lra.trim()}:measured_thresh=${measurement.input_thresh.trim()}:offset=${measurement.target_offset.trim()}:linear=true`;
}

/**
 * Parse the first-pass loudnorm JSON from ffmpeg stderr.
 * - `null`: no loudnorm JSON at all (ffmpeg failed / no audio).
 * - `{ measurement: null }`: silent or quieter than −70 LUFS (a value is empty/inf/nan) → skip normalisation.
 */
export function parseLoudnormJson(stderr: string): { measurement: LoudnormMeasurement | null } | null {
  const start = stderr.lastIndexOf('\n{') >= 0 ? stderr.lastIndexOf('\n{') + 1 : stderr.startsWith('{') ? 0 : -1;
  if (start < 0) return null;
  const end = stderr.indexOf('}', start);
  if (end < 0) return null;
  const block = stderr.slice(start, end + 1);
  const values: Partial<Record<keyof LoudnormMeasurement, string>> = {};
  for (const key of LOUDNORM_MEASUREMENT_KEYS) {
    const m = new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`).exec(block);
    values[key] = m ? m[1].trim() : '';
  }
  if (!LOUDNORM_MEASUREMENT_KEYS.some(key => values[key])) return null;
  return { measurement: isUsableLoudnormMeasurement(values) ? values : null };
}

/**
 * Final renders normalise loudness by default. Only an explicit `false` (e.g. Music MVs that keep the
 * song's authored gain, or an old project that disabled it) turns it off; `undefined`/`null` mean "on".
 */
export function resolveNormalizeAudio(explicit: boolean | null | undefined): boolean {
  return explicit !== false;
}

/** mux.sh's acceptance check: off target when integrated loudness is outside target ±1 LU or the true peak exceeds the ceiling. */
export function loudnessOffTarget(summary: { integratedLufs: number | null; truePeak: number | null }, target: LoudnessTarget = FINAL_FILM_LOUDNESS): boolean {
  const i = summary.integratedLufs ?? 0, p = summary.truePeak ?? 0; // awk treats a missing value as 0
  return i < target.integratedLufs - 1 || i > target.integratedLufs + 1 || p > target.truePeakDb;
}

/** Human-readable target, e.g. `-14 LUFS，真峰值 ≤ -1 dB`. */
export function describeLoudnessTarget(target: LoudnessTarget = FINAL_FILM_LOUDNESS): string {
  return `${target.integratedLufs} LUFS，真峰值 ≤ ${target.truePeakDb} dB`;
}
