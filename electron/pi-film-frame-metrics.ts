/** Advisory frame statistics for host reviews. These never fail a review; they only point the model and the user at frames worth a second look. */
export interface PiFrameMetrics { time: number; meanLuma: number; highlightRatio: number; shadowRatio: number; contrast: number; changeFromPrevious?: number }
export interface PiFrameAdvisory { time: number; code: 'HIGHLIGHT_HEAVY' | 'VERY_DARK' | 'LOW_CONTRAST' | 'NEAR_DUPLICATE'; message: string }
export interface PiFrameSample { time: number; width: number; height: number; /** BGRA, as returned by Electron nativeImage.toBitmap(). */ bitmap: Uint8Array }

const HIGHLIGHT_LUMA = 245, SHADOW_LUMA = 10;

function lumaGrid(sample: PiFrameSample): Float32Array {
  const count = sample.width * sample.height;
  if (!Number.isSafeInteger(count) || count < 1 || sample.bitmap.length < count * 4) throw new Error('PI_FRAME_METRICS_BITMAP');
  const luma = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    luma[i] = 0.0722 * sample.bitmap[o] + 0.7152 * sample.bitmap[o + 1] + 0.2126 * sample.bitmap[o + 2];
  }
  return luma;
}

/** Metrics for an ordered frame list. Frames with a different grid size from their predecessor skip the change measure. */
export function piFrameSequenceMetrics(samples: readonly PiFrameSample[]): { metrics: PiFrameMetrics[]; advisories: PiFrameAdvisory[] } {
  const metrics: PiFrameMetrics[] = [], advisories: PiFrameAdvisory[] = [];
  let previous: { luma: Float32Array; width: number; height: number } | undefined;
  for (const sample of samples) {
    const luma = lumaGrid(sample), n = luma.length;
    let sum = 0, high = 0, low = 0;
    for (const value of luma) { sum += value; if (value >= HIGHLIGHT_LUMA) high++; if (value <= SHADOW_LUMA) low++; }
    const mean = sum / n;
    let variance = 0;
    for (const value of luma) variance += (value - mean) * (value - mean);
    const item: PiFrameMetrics = { time: sample.time, meanLuma: round(mean), highlightRatio: round(high / n), shadowRatio: round(low / n), contrast: round(Math.sqrt(variance / n)) };
    if (previous && previous.width === sample.width && previous.height === sample.height) {
      let diff = 0;
      for (let i = 0; i < n; i++) diff += Math.abs(luma[i] - previous.luma[i]);
      item.changeFromPrevious = round(diff / n);
    }
    metrics.push(item);
    previous = { luma, width: sample.width, height: sample.height };
    const at = `${sample.time.toFixed(2)}s`;
    if (item.highlightRatio >= 0.35) advisories.push({ time: sample.time, code: 'HIGHLIGHT_HEAVY', message: `${at}: ${Math.round(item.highlightRatio * 100)}% of pixels are near white. Check for overexposure or washed-out detail (a deliberate high-key style may be fine).` });
    if (item.meanLuma <= 25) advisories.push({ time: sample.time, code: 'VERY_DARK', message: `${at}: mean brightness is very low. Check that the subject is readable.` });
    if (item.contrast < 12) advisories.push({ time: sample.time, code: 'LOW_CONTRAST', message: `${at}: almost flat tonal range. Check that the subject separates from the background.` });
    if (item.changeFromPrevious !== undefined && item.changeFromPrevious < 2) advisories.push({ time: sample.time, code: 'NEAR_DUPLICATE', message: `${at}: nearly identical to the previous sampled frame. Check that the film actually moves between these times.` });
  }
  return { metrics, advisories };
}

function round(value: number) { return Math.round(value * 1000) / 1000; }

/** Decode frames with Electron and measure them on a small grid. Returns undefined outside Electron or when a frame cannot be decoded; the review itself is unaffected. */
export async function piMeasureFrameFiles(frames: readonly { time: number; path: string }[]): Promise<ReturnType<typeof piFrameSequenceMetrics> | undefined> {
  try {
    const { nativeImage } = await import('electron');
    const samples: PiFrameSample[] = [];
    for (const frame of frames) {
      const image = nativeImage.createFromPath(frame.path);
      if (image.isEmpty()) return undefined;
      const small = image.resize({ width: 64, height: 36 });
      const size = small.getSize();
      samples.push({ time: frame.time, width: size.width, height: size.height, bitmap: small.toBitmap() });
    }
    return piFrameSequenceMetrics(samples);
  } catch { return undefined; }
}
