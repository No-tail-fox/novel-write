import { z } from 'zod';

/** New code-video projects only; imported audio and legacy projects retain their clocks. */
export const CODE_VIDEO_DURATION_PRESETS = [30, 60, 90, 120, 180] as const;
export const CODE_VIDEO_DEFAULT_DURATION = 60;
export const DEFAULT_PI_MAX_REQUESTS = 120;
export const codeVideoTargetDurationSchema = z.number().int().min(15).max(180);
export const codeVideoPolicySchema = z.object({
  version: z.literal(1),
  targetDurationSeconds: codeVideoTargetDurationSchema,
  longTextMode: z.enum(['split', 'condense']),
  captionMode: z.enum(['film', 'host']),
  allowNarrationPauses: z.boolean(),
}).strict();
export type CodeVideoPolicy = z.infer<typeof codeVideoPolicySchema>;
export function newCodeVideoPolicy(): CodeVideoPolicy {
  return { version: 1, targetDurationSeconds: CODE_VIDEO_DEFAULT_DURATION, longTextMode: 'split', captionMode: 'film', allowNarrationPauses: true };
}

/** No default injection on load: missing policy means historical host captions. */
export function codeVideoCaptionMode(policy?: Pick<CodeVideoPolicy, 'captionMode'>): 'film' | 'host' {
  return policy?.captionMode ?? 'host';
}

export type CodeVideoDurationAssessment = {
  targetDurationSeconds: number; actualDurationSeconds: number;
  status: 'within-target' | 'short' | 'over-limit'; maximumDurationSeconds: number;
};
export function assessCodeVideoDuration(target: number, actualDurationSeconds: number): CodeVideoDurationAssessment {
  codeVideoTargetDurationSchema.parse(target);
  if (!Number.isFinite(actualDurationSeconds) || actualDurationSeconds <= 0) throw new Error('CODE_VIDEO_DURATION_INVALID');
  // Integer milliseconds avoid floating-point overflow at the exact +10% boundary.
  const actualMs = Math.round(actualDurationSeconds * 1000);
  return {
    targetDurationSeconds: target, actualDurationSeconds,
    maximumDurationSeconds: target * 1100 / 1000,
    status: actualMs > target * 1100 ? 'over-limit' : actualMs < target * 900 ? 'short' : 'within-target',
  };
}

/** Capture identity participates in review invalidation; never silently substitute engines. */
export const codeVideoRenderIdentitySchema = z.object({
  engine: z.enum(['lemo-upstream', 'electron-hyperframes', 'electron-remotion']),
  browserVersion: z.string().min(1), sourceHash: z.string().min(1), timelineHash: z.string().min(1), assetHash: z.string().min(1),
  width: z.number().int().positive(), height: z.number().int().positive(),
  fps: z.number().finite().positive().max(120), captionMode: z.enum(['film', 'host']),
}).strict();
export type CodeVideoRenderIdentity = z.infer<typeof codeVideoRenderIdentitySchema>;
export function codeVideoFrameSchedule(durationSeconds: number, fps: number): { frameCount: number; durationSeconds: number; frameTime: (index: number) => number } {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isFinite(fps) || fps <= 0 || fps > 120) throw new Error('CODE_VIDEO_FRAME_CLOCK_INVALID');
  const frameCount = Math.ceil(durationSeconds * fps);
  if (!Number.isSafeInteger(frameCount)) throw new Error('CODE_VIDEO_FRAME_CLOCK_INVALID');
  return { frameCount, durationSeconds: frameCount / fps, frameTime: index => {
    if (!Number.isInteger(index) || index < 0 || index >= frameCount) throw new Error('CODE_VIDEO_FRAME_OUTSIDE_FILM');
    return index / fps;
  } };
}
