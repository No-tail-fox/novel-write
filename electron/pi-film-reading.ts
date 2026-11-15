import type { LemoPageProbeReceipt } from './pi-lemo-page-probe';
/** Coverage provenance is explicit: contact sheets cannot certify all-frame reading. */
export function piReadingCoverage(probes: readonly LemoPageProbeReceipt[], durationSeconds: number, fps: number, mode: 0 | 1) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isInteger(fps) || fps <= 0) throw new Error('PI_READING_CLOCK');
  const count = Math.ceil(durationSeconds * fps);
  const observed = new Set<number>();
  const errors = new Set<string>();
  for (const probe of probes) {
    if (!probe.technicalPassed || !probe.textEvidenceComplete) errors.add('PI_READING_PROBE_FAILED');
    for (const sample of probe.modes.find(entry => entry.captions === mode)?.samples ?? []) {
      const frame = Math.round(sample.time * fps);
      if (frame < 0 || frame >= count || Math.abs(sample.time - frame / fps) > 1e-7) { errors.add('PI_READING_OFF_CLOCK'); continue; }
      observed.add(frame);
      for (const text of sample.texts) {
        if (text.x0 < 0 || text.y0 < 0 || text.x1 > probe.width || text.y1 > probe.height) errors.add('PI_READING_TEXT_OUTSIDE_CANVAS');
      }
    }
  }
  return { observedFrames: observed.size, expectedFrames: count, coverageComplete: observed.size === count,
    errors: [...errors], passed: observed.size === count && errors.size === 0 };
}
