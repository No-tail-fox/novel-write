import { z } from 'zod';
import { codeVideoPolicySchema, codeVideoRenderIdentitySchema } from './production-policy';
import { narrationPausesSchema } from './narration-pauses';

const id = z.string().min(1).max(256);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
/** References are relative to the trusted host run root, never renderer-supplied absolute paths. */
export const piArtifactRefSchema = z.string().min(1).max(512).refine(value =>
  !value.includes('\\') && !value.includes(':') && !value.startsWith('/')
  && value.split('/').every(part => !!part && part !== '.' && part !== '..' && !/[\u0000-\u001f]/u.test(part)), 'Invalid relative artifact reference');
export const piFilmEvidenceSchema = z.object({
  sourceHash: hash, timelineHash: hash, assetHash: hash,
  renderIdentity: codeVideoRenderIdentitySchema,
  technicalPassed: z.boolean(), readingPassed: z.boolean(), audioPassed: z.boolean(),
  contactSheetPasses: z.number().int().min(0).max(100),
  previewRef: piArtifactRefSchema.optional(),
  creditsPassed: z.boolean(),
  /** True only when the model was actually shown at least two full sets of host-rendered frames. Without image input this stays false. */
  visuallyReviewed: z.boolean().default(false),
  /** A model/tool receipt is not human audiovisual acceptance. */
  humanReviewed: z.boolean().default(false),
}).strict();
export const piFilmStateSchema = z.object({
  version: z.literal(1), authoringVersion: z.literal(4),
  runId: id, styleId: id, policy: codeVideoPolicySchema,
  sessionRef: piArtifactRefSchema,
  phase: z.enum(['authoring', 'paused', 'reconciliation-required', 'ready']),
  segment: z.number().int().min(0).max(1000),
  segmentHandoff: z.string().max(4000).optional(),
  completedModelRequests: z.number().int().nonnegative(),
  sourceHash: hash, timelineHash: hash, assetHash: hash,
  actualDurationSeconds: z.number().finite().positive(),
  narrationPauses: narrationPausesSchema,
  acceptedPauseChanges: z.number().int().min(0).max(3),
  evidence: piFilmEvidenceSchema.optional(),
  audioMaster: z.object({ path: piArtifactRefSchema, sha256: hash, sourceHash: hash, timelineHash: hash,
    durationSeconds: z.number().finite().positive(), sampleRate: z.literal(48000), channels: z.literal(2) }).strict().optional(),
  message: z.string().max(12000),
}).strict();
export type PiFilmState = z.infer<typeof piFilmStateSchema>;

export function piFilmReadyErrors(film: PiFilmState): string[] {
  const errors: string[] = [];
  if (film.phase !== 'ready') errors.push('PI_FILM_NOT_READY');
  if (film.actualDurationSeconds > film.policy.targetDurationSeconds * 1.1) errors.push('PI_FILM_DURATION_OVER_TARGET');
  const evidence = film.evidence;
  if (!evidence) return [...errors, 'PI_FILM_EVIDENCE_MISSING'];
  if (evidence.sourceHash !== film.sourceHash || evidence.timelineHash !== film.timelineHash || evidence.assetHash !== film.assetHash
    || evidence.renderIdentity.sourceHash !== film.sourceHash || evidence.renderIdentity.timelineHash !== film.timelineHash
    || evidence.renderIdentity.assetHash !== film.assetHash || evidence.renderIdentity.captionMode !== film.policy.captionMode) errors.push('PI_FILM_EVIDENCE_STALE');
  if (evidence.renderIdentity.engine !== 'lemo-upstream') errors.push('PI_FILM_RENDER_ENGINE_MISMATCH');
  if (!evidence.technicalPassed) errors.push('PI_FILM_TECHNICAL_CHECK_REQUIRED');
  if (!evidence.readingPassed) errors.push('PI_FILM_READING_CHECK_REQUIRED');
  if (!evidence.audioPassed) errors.push('PI_FILM_AUDIO_CHECK_REQUIRED');
  if (!evidence.creditsPassed) errors.push('PI_FILM_CREDITS_REQUIRED');
  if (evidence.contactSheetPasses < 2 || !evidence.previewRef) errors.push('PI_FILM_REVIEW_REQUIRED');
  return errors;
}
