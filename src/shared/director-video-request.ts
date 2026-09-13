import type { DirectorGenerateShotVideoRequest } from './director-render';

/**
 * Browser-safe validation for the narrow VOX video request.
 *
 * The Electron IPC boundary performs the authoritative Zod validation. The
 * browser fallback only needs to reject malformed input before it reports
 * that paid media generation is desktop-only, and must not pull the full
 * renderer contract (and its Zod runtime) into the browser bundle.
 */
export function validateDirectorGenerateShotVideoRequest(input: unknown): DirectorGenerateShotVideoRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('DIRECTOR_VIDEO_INVALID_INPUT: Request must be an object.');
  }

  const record = input as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 3 || keys[0] !== 'expectedUpdatedAt' || keys[1] !== 'id' || keys[2] !== 'shotId') {
    throw new Error('DIRECTOR_VIDEO_INVALID_INPUT: Request contains unsupported fields.');
  }

  const id = record.id;
  const shotId = record.shotId;
  const expectedUpdatedAt = record.expectedUpdatedAt;
  if (!isBoundedNonEmptyString(id, 256) || !isBoundedNonEmptyString(shotId, 256)) {
    throw new Error('DIRECTOR_VIDEO_INVALID_INPUT: Project and shot identifiers are required.');
  }
  if (!isBoundedNonEmptyString(expectedUpdatedAt, 64) || Number.isNaN(Date.parse(expectedUpdatedAt))) {
    throw new Error('DIRECTOR_VIDEO_INVALID_INPUT: Revision token must be a valid timestamp.');
  }

  return { id, shotId, expectedUpdatedAt };
}

function isBoundedNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength && value.trim().length > 0;
}
