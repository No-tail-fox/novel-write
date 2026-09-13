import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function directorVideoHandler(): Promise<string> {
  const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
  const start = main.indexOf("trustedHandle('director:generate-shot-video'");
  const end = main.indexOf("trustedHandle('motion-comic:create'", start);
  if (start < 0 || end <= start) throw new Error('Director video handler was not found.');
  return main.slice(start, end);
}

async function normalizeSceneVideoContract(): Promise<string> {
  const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
  const start = main.indexOf('async function normalizeSceneVideo');
  const end = main.indexOf('function selectRandomSceneVideo', start);
  if (start < 0 || end <= start) throw new Error('Scene-video normalization contract was not found.');
  return main.slice(start, end);
}

describe('director video main-process lifecycle', () => {
  it('persists a running I2V job before the paid provider call and disables submit retries', async () => {
    const handler = await directorVideoHandler();
    const runningSave = handler.indexOf('const runningTask = await database.saveEditorialCollageTask');
    const providerCall = handler.indexOf('const generated = await provider.generate(request)');

    expect(handler).toContain("capability: 'image-to-video'");
    expect(handler).toContain("status: 'running'");
    expect(handler).toContain('const requiredCapabilities = requiredVideoCapabilities(request)');
    expect(handler).toContain('{ submitRetryCount: 0 }');
    expect(handler).toContain('remainingBudget');
    expect(runningSave).toBeGreaterThan(0);
    expect(providerCall).toBeGreaterThan(runningSave);
  });

  it('creates a selected video asset only after normalization and completes the matching job', async () => {
    const handler = await directorVideoHandler();
    const normalize = handler.indexOf('normalizeSceneVideo(generated.path, temporaryPath)');
    const videoAsset = handler.indexOf("kind: 'video'");
    const completed = handler.indexOf("status: 'completed' as const");

    expect(normalize).toBeGreaterThan(0);
    expect(videoAsset).toBeGreaterThan(normalize);
    expect(completed).toBeGreaterThan(videoAsset);
    expect(handler).toContain('videoAssetVersionId: assetId');
    expect(handler).toContain('videoJobId: jobId');
    expect(handler).toContain('actualCost: generated.estimatedCost');
    expect(handler).toContain('return { result, mutation: await publishTaskUpsert');
  });

  it('requires a non-black frame before a normalized provider video can be persisted', async () => {
    const normalize = await normalizeSceneVideoContract();
    const handler = await directorVideoHandler();
    const normalized = handler.indexOf('normalizeSceneVideo(generated.path, temporaryPath)');
    const videoAsset = handler.indexOf("kind: 'video'");

    expect(normalize).toContain('require_nonblack: true');
    expect(normalize).toContain('result.has_nonblack_video !== true');
    expect(normalize).toContain('SCENE_VIDEO_SOURCE_BLACK');
    expect(normalized).toBeGreaterThan(0);
    expect(videoAsset).toBeGreaterThan(normalized);
  });

  it('keeps a failed job visible, records post-submit cost, and never fabricates a failed asset', async () => {
    const handler = await directorVideoHandler();
    const catchStart = handler.indexOf('} catch (error) {');
    const failure = handler.slice(catchStart);

    expect(handler).toContain('chargedCost = generated.estimatedCost');
    expect(failure).toContain("status: 'failed' as const");
    expect(failure).toContain('actualCost: (latest.actualCost ?? 0) + chargedCost');
    expect(failure).toContain('actualCost: chargedCost');
    expect(failure).toContain('error: normalized.message.slice(0, 65_536)');
    expect(failure).not.toContain("kind: 'video'");
    expect(handler).toContain('AI 动态海报不会自动降级或重复付费。');
  });
});
