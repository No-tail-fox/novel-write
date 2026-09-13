import { describe, expect, it } from 'vitest';
import { validateDirectorGenerateShotVideoRequest } from '../src/shared/director-video-request';

describe('browser-safe director video request validation', () => {
  const input = {
    id: 'vox-project-1',
    shotId: 'shot-1',
    expectedUpdatedAt: '2026-09-05T00:00:00.000Z',
  };

  it('returns the narrow persisted request', () => {
    expect(validateDirectorGenerateShotVideoRequest(input)).toEqual(input);
  });

  it('rejects secrets, paths, budgets, and malformed revisions', () => {
    for (const value of [
      { ...input, apiKey: 'sk-secret' },
      { ...input, firstFramePath: 'C:/private/frame.png' },
      { ...input, budget: 10 },
      { ...input, outputPath: 'C:/private/output.mp4' },
      { ...input, expectedUpdatedAt: 'not-a-date' },
    ]) {
      expect(() => validateDirectorGenerateShotVideoRequest(value)).toThrow();
    }
  });
});
