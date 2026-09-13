import { z } from 'zod';
import {
  PRODUCTION_SUBTITLE_ALIGNMENT_SOURCES,
  hashSubtitleAlignment,
  hashSubtitleText,
  validateProductionSubtitleCue,
  type ProductionSubtitleCueValidationIssue,
} from './audio-alignment';
import type { ProductionSubtitleCue } from './production-workflow';

const idSchema = z.string().trim().min(1).max(256);
const millisecondsSchema = z.number().finite().nonnegative();

/** The optional canonical fields preserve older cue-only documents verbatim. */
export const productionSubtitleCueSchema = z.object({
  id: idSchema,
  shotId: idSchema.optional(),
  sourceId: idSchema.optional(),
  text: z.string().max(10_000),
  startMs: millisecondsSchema,
  endMs: millisecondsSchema,
  tokens: z.array(z.object({
    id: idSchema.optional(),
    text: z.string().max(10_000).refine((text) => text.trim().length > 0, 'Subtitle token text must be non-empty.'),
    startMs: millisecondsSchema,
    endMs: millisecondsSchema,
    confidence: z.number().finite().min(0).max(1).optional(),
  }).strict()).max(10_000).optional(),
  alignmentSource: z.enum(PRODUCTION_SUBTITLE_ALIGNMENT_SOURCES).optional(),
  textHash: z.string().min(1).max(256).optional(),
  audioAssetVersionId: idSchema.optional(),
  voiceId: z.string().max(512).optional(),
  voiceSpeed: z.number().finite().positive().optional(),
  styleRef: z.string().max(256).optional(),
  alignmentFingerprint: z.string().min(1).max(256).optional(),
}).strict().superRefine((cue, context) => {
  for (const issue of validatePersistedSubtitleCue(cue)) {
    const path = (issue.path.match(/[^.[\]]+/gu) ?? []).map((part) => /^\d+$/u.test(part) ? Number(part) : part);
    context.addIssue({ code: 'custom', path, message: issue.message });
  }
});

/** Also used by the domain validators, which accept already-typed documents. */
export function validatePersistedSubtitleCue(cue: ProductionSubtitleCue): ProductionSubtitleCueValidationIssue[] {
  const issues = validateProductionSubtitleCue(cue);
  if (Array.isArray(cue.tokens) && typeof cue.text === 'string' && cue.tokens.every((token) => token && typeof token.text === 'string')) {
    const compact = (text: string): string => text.normalize('NFC').replace(/\s+/gu, '');
    if (compact(cue.tokens.map((token) => token.text).join('')) !== compact(cue.text)) {
      issues.push({ path: 'tokens', message: 'Subtitle tokens must cover the complete cue text in order.' });
    }
  }
  if (cue.textHash !== undefined && typeof cue.text === 'string' && cue.textHash !== hashSubtitleText(cue.text)) {
    issues.push({ path: 'textHash', message: 'Subtitle text hash must match the current cue text.' });
  }
  if (cue.alignmentFingerprint !== undefined && typeof cue.text === 'string' && cue.alignmentFingerprint !== hashSubtitleAlignment(cue)) {
    issues.push({ path: 'alignmentFingerprint', message: 'Subtitle alignment fingerprint must match its current dependencies.' });
  }
  return issues;
}
