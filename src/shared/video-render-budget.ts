export interface VideoRenderBudgetInput {
  width: number;
  height: number;
  fps: number;
  durations: readonly number[];
  outputDurationS?: number;
  coverDurationS?: number;
  stagedMediaBytes?: number;
}

const mib = 1024 * 1024;

export function estimateVideoRenderDiskBudget(input: VideoRenderBudgetInput) {
  const { width, height, fps, durations } = input;
  const coverDurationS = input.coverDurationS ?? 0;
  const stagedMediaBytes = input.stagedMediaBytes ?? 0;
  if (![width, height, fps].every((value) => Number.isFinite(value) && value > 0)
    || !durations.length || durations.some((value) => !Number.isFinite(value) || value <= 0)
    || ![coverDurationS, stagedMediaBytes].every((value) => Number.isFinite(value) && value >= 0)
    || (input.outputDurationS !== undefined && (!Number.isFinite(input.outputDurationS) || input.outputDurationS <= 0))) {
    throw new Error('Invalid video render budget input.');
  }
  const frames = durations.map((duration) => Math.max(1, Math.ceil(duration * fps)));
  const totalFrames = frames.reduce((total, count) => total + count, 0);
  const longestDuration = Math.max(...durations);
  const capturedDuration = totalFrames / fps + coverDurationS;
  const outputDuration = Math.max(capturedDuration, input.outputDurationS ?? 0);
  // JPEGs coexist for one scene. Encoded scenes, source, and a duration/BGM/final
  // copy can coexist; CRF output size is content-dependent, so keep headroom.
  const peakFrameBytes = Math.ceil(Math.max(...frames) * width * height * 0.45);
  const encodedBytesPerSecond = width * height * fps * 0.08 + 32_000;
  const segmentBytes = Math.ceil(capturedDuration * encodedBytesPerSecond);
  const outputCopyBytes = Math.ceil(outputDuration * encodedBytesPerSecond);
  const peakMixBytes = Math.ceil(longestDuration * 44100 * 2 * 2) + 4096;
  const compositionAudioBytes = durations.length + (coverDurationS > 0 ? 1 : 0) > 8
    ? Math.ceil(capturedDuration * 44100 * 2 * 4) + Math.ceil((durations.length + 1) / 8) * 4096
    : 0;
  const reserveBytes = 64 * mib;
  const subtotal = peakFrameBytes + peakMixBytes + compositionAudioBytes + segmentBytes + outputCopyBytes * 2 + stagedMediaBytes;
  const requiredBytes = Math.ceil(subtotal * 1.2) + reserveBytes;
  if (!Number.isSafeInteger(requiredBytes)) throw new Error('Video render budget exceeds supported capacity.');
  return { totalFrames, peakFrameBytes, peakMixBytes, compositionAudioBytes, segmentBytes, outputCopyBytes, stagedMediaBytes, reserveBytes, requiredBytes };
}
