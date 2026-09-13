import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('director video page contract', () => {
  it('bridges the narrow video request from the VOX page to the Director Desk', async () => {
    const page = await source('src/features/editorial-collage/EditorialCollagePage.tsx');
    expect(page).toContain('api.generateDirectorShotVideo({');
    expect(page).toMatch(/id: (?:projectId|current\.id)/u);
    expect(page).toContain('shotId');
    expect(page).toMatch(/expectedUpdatedAt: (?:savedBeforeGeneration|current)\.updatedAt/u);
    expect(page.includes('onGenerateVideo={(shotId) => withHistoryCapacity(PRODUCTION_MEDIA_HISTORY_DEMAND, () => generateVideo(shotId))}')).toBe(true);
    expect(page.includes('onRetryVideo={(shotId) => withHistoryCapacity(PRODUCTION_MEDIA_HISTORY_DEMAND, () => generateVideo(shotId))}')).toBe(true);
    expect(page).not.toContain('apiKey:');
    expect(page).not.toContain('firstFramePath:');
    expect(page).not.toContain('outputPath:');
    expect(page).not.toContain('budget:');
  });

  it('exposes provider readiness, failure, retry, and playable asset state', async () => {
    const workspace = await source('src/features/director-desk/DirectorDeskWorkspace.tsx');
    for (const marker of [
      'videoProviderConnected',
      'videoProviderUnavailableReason',
      'videoJobStatus',
      'onRetryVideo',
      '重试 AI 动态海报',
      'src={selectedShot.videoUrl}',
    ]) {
      expect(workspace).toContain(marker);
    }
  });
});
