/** A shared zero baseline keeps negative values on the correct side of a bar chart. */
export function voxBarGeometry(value: number, values: readonly number[], progress = 1) {
  const minimum = Math.min(0, ...values), maximum = Math.max(0, ...values);
  const span = maximum - minimum || 1;
  const animated = value * Math.max(0, Math.min(1, progress));
  return {
    zero: -minimum / span * 100,
    left: (Math.min(0, animated) - minimum) / span * 100,
    width: Math.abs(animated) / span * 100,
  };
}

/** Match the input's decimal precision instead of rounding sourced values to one place. */
export function formatVoxDataValue(value: number, progress = 1) {
  const [coefficient, exponent = '0'] = String(value).toLowerCase().split('e');
  const digits = Math.min(20, Math.max(0, (coefficient.split('.')[1]?.length ?? 0) - Number(exponent)));
  const animated = value * Math.max(0, Math.min(1, progress));
  return (Object.is(animated, -0) ? 0 : animated).toLocaleString('zh-CN', { maximumFractionDigits: digits });
}

/** Match spoken digit sequences (二零二四年) to supplied labels (2024 年). */
const normalizedLabel = (text: string) => text.replace(/[零〇○一二三四五六七八九]/g, digit => String('零一二三四五六七八九'.indexOf(digit.replace(/[〇○]/g, '零')))).replace(/[\s，。！？、,:;：；]/g, '').toLowerCase();

export function voxDataPresentation(
  labels: readonly string[],
  cues: readonly { text: string; startMs: number; endMs: number }[],
  shotStartMs: number,
  reveal: boolean,
) {
  return {
    reveal,
    cues: cues.flatMap(cue => {
      const spoken = normalizedLabel(cue.text);
      const mentioned = labels.filter(label => normalizedLabel(label).length > 0 && spoken.includes(normalizedLabel(label)));
      return mentioned.length ? [{ startMs: Math.max(0, cue.startMs - shotStartMs), endMs: Math.max(0, cue.endMs - shotStartMs), labels: mentioned }] : [];
    }),
  };
}

/** A short establishing reveal, then stable geometry across subsequent narrated shots. */
export function voxDataBarProgress(frame: number, fps: number, index: number, reveal: boolean) {
  if (!reveal) return 1;
  const progress = Math.max(0, Math.min(1, (frame / fps - index * .08) / .65));
  return 1 - (1 - progress) ** 3;
}
