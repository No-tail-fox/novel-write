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

async function motionComicVideoGenerator(): Promise<string> {
  const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
  const start = main.indexOf('async function generateMotionComicShotVideo');
  const end = main.indexOf("trustedHandle('director:generate-shot-video'", start);
  if (start < 0 || end <= start) throw new Error('Motion-comic video generator was not found.');
  return main.slice(start, end);
}

describe('director video main-process lifecycle', () => {
  it('marks explicit motion-comic submit rejections failed while preserving uncertain submissions', async () => {
    const generator = await motionComicVideoGenerator();

    expect(generator).toContain('motionComicVideoFailureIsTerminal(error, normalized.code');
    expect(generator).toContain('status >= 400 && status < 500');
    expect(generator).toContain('UNCERTAIN_VIDEO_SUBMISSION_HTTP_STATUSES = new Set([408, 425, 429])');
    expect(generator.indexOf('VIDEO_PROVIDER_(?:JOB_FAILED|INVALID_OUTPUT)')).toBeGreaterThan(-1);
    expect(generator.indexOf('VIDEO_PROVIDER_(?:JOB_FAILED|INVALID_OUTPUT)')).toBeLessThan(generator.indexOf('if (state.remoteTaskId) return false'));
    expect(generator.indexOf('if (state.remoteTaskId) return false')).toBeGreaterThan(-1);
    expect(generator.indexOf('if (state.remoteTaskId) return false')).toBeLessThan(generator.indexOf('const status = videoProviderHttpStatus(error)'));
    expect(generator).toContain("normalizedCode === 'VIDEO_PROVIDER_HTTP_ERROR'");
    expect(generator).toContain('VIDEO_PROVIDER_(?:NOT_CONFIGURED|PROMPT_REQUIRED|FIRST_FRAME_REQUIRED');
    expect(generator).toContain("status: terminal ? 'failed' as const : 'running' as const");
    expect(generator).toContain('if (state.charged) return true');
  });

  it('resumes a persisted motion-comic remote task without another paid POST', async () => {
    const generator = await motionComicVideoGenerator();
    const resumeGuard = generator.indexOf('if (resumableJob && !resumableJob.remoteTaskId)');
    const providerCall = generator.indexOf('const generated = resumableJob');
    const resumeCall = generator.indexOf('await provider.resume!(resumableJob.remoteTaskId!, { estimatedCost: resumableJob.estimatedCost })', providerCall);
    const submitCall = generator.indexOf('await provider.generate({ ...request!, onSubmitted: persistRemoteTaskId })', providerCall);

    expect(generator).toContain('DIRECTOR_VIDEO_SUBMIT_STATE_UNKNOWN');
    expect(generator).toContain('createConfiguredVideoProvider(runtimeConfig, taskWorkDir(task), undefined');
    expect(generator).toContain('recoveryProviderId: resumableJob.providerId');
    expect(resumeGuard).toBeGreaterThan(0);
    expect(providerCall).toBeGreaterThan(resumeGuard);
    expect(resumeCall).toBeGreaterThan(providerCall);
    expect(submitCall).toBeGreaterThan(resumeCall);
    expect(generator.slice(providerCall, submitCall + 80)).toContain('? await provider.resume!');
    expect(generator.slice(providerCall, submitCall + 80)).toContain(': await provider.generate');
  });

  it('recovers after current frames, duration, or ratio changed and preserves the output as stale history', async () => {
    const generator = await motionComicVideoGenerator();
    const recoveryBranch = generator.indexOf('if (resumableJob) {');
    const newSubmissionBranch = generator.indexOf('const frames = motionComicVideoFrames(document, shot);', recoveryBranch);
    const frameStat = generator.indexOf('await stat(asset.localPath)', newSubmissionBranch);
    const buildRequest = generator.indexOf('request = buildMotionComicShotVideoRequest(document, shot)', newSubmissionBranch);
    const validateRequest = generator.indexOf('validateVideoGenerationRequest(route.provider, request)', newSubmissionBranch);
    const resume = generator.indexOf('await provider.resume!', newSubmissionBranch);
    const currentHash = generator.indexOf("let currentHash = ''", resume);
    const hashCatch = generator.indexOf('catch {', currentHash);

    expect(recoveryBranch).toBeGreaterThan(0);
    expect(newSubmissionBranch).toBeGreaterThan(recoveryBranch);
    expect(frameStat).toBeGreaterThan(newSubmissionBranch);
    expect(buildRequest).toBeGreaterThan(newSubmissionBranch);
    expect(validateRequest).toBeGreaterThan(newSubmissionBranch);
    expect(resume).toBeGreaterThan(validateRequest);
    expect(generator.slice(recoveryBranch, newSubmissionBranch)).not.toContain('motionComicVideoFrames');
    expect(generator.slice(recoveryBranch, newSubmissionBranch)).not.toContain('buildMotionComicShotVideoRequest');
    expect(generator.slice(recoveryBranch, newSubmissionBranch)).not.toContain('validateVideoGenerationRequest');
    expect(currentHash).toBeGreaterThan(resume);
    expect(hashCatch).toBeGreaterThan(currentHash);
    expect(generator.indexOf("currentHash = '';", hashCatch)).toBeGreaterThan(hashCatch);
    expect(generator).toContain('currentPrompt = currentFingerprint.prompt');
    expect(generator).toContain('prompt: (request?.prompt ?? currentPrompt) || shot.prompt');
    expect(generator).toContain('selected: !stale');
    expect(generator).toContain("error: '生成完成，但镜头输入已变化；结果保留在历史版本中。'");
    expect(generator).toContain('DIRECTOR_VIDEO_INPUT_CHANGED: 生成期间镜头已发生变化，结果已保留为未选中的历史版本。');
  });

  it('validates a resumed result against the current shot before selecting it', async () => {
    const generator = await motionComicVideoGenerator();
    const normalize = generator.indexOf('const probe = await normalizeSceneVideo(generated.path, temporaryPath)');
    const stale = generator.indexOf('const stale = !latestShot', normalize);
    const currentOnlyValidation = generator.indexOf('if (!stale && currentValidation)', stale);
    const durationValidation = generator.indexOf('probe.durationMs + 100 < currentValidation.durationMs', currentOnlyValidation);
    const ratioValidation = generator.indexOf('assertMotionComicVideoOutputRatio(currentValidation.ratio, probe.width, probe.height)', durationValidation);
    const persist = generator.indexOf('await rename(temporaryPath, outputPath)', ratioValidation);

    expect(normalize).toBeGreaterThan(0);
    expect(stale).toBeGreaterThan(normalize);
    expect(currentOnlyValidation).toBeGreaterThan(stale);
    expect(durationValidation).toBeGreaterThan(currentOnlyValidation);
    expect(ratioValidation).toBeGreaterThan(durationValidation);
    expect(persist).toBeGreaterThan(ratioValidation);
    expect(generator).not.toContain('if (!resumableJob && probe.durationMs');
    expect(generator).not.toContain('if (!resumableJob) assertMotionComicVideoOutputRatio');
  });

  it('rejects a motion-comic video whose normalized aspect ratio differs by more than three percent', async () => {
    const generator = await motionComicVideoGenerator();
    const handler = await directorVideoHandler();
    const normalize = generator.indexOf('const probe = await normalizeSceneVideo(generated.path, temporaryPath)');
    const validateDimensions = generator.indexOf('if (probe.width <= 0 || probe.height <= 0)', normalize);
    const validateRatio = generator.indexOf('assertMotionComicVideoOutputRatio(currentValidation.ratio, probe.width, probe.height)', validateDimensions);
    const persist = generator.indexOf('await rename(temporaryPath, outputPath)', validateRatio);

    expect(normalize).toBeGreaterThan(0);
    expect(validateDimensions).toBeGreaterThan(normalize);
    expect(validateRatio).toBeGreaterThan(validateDimensions);
    expect(persist).toBeGreaterThan(validateRatio);
    expect(generator).toContain('const relativeError = Math.abs(actualAspectRatio / expectedAspectRatio - 1)');
    expect(generator).toContain('if (relativeError > 0.03)');
    expect(generator).toContain('DIRECTOR_VIDEO_OUTPUT_RATIO_MISMATCH');
    expect(generator).toContain('DIRECTOR_VIDEO_OUTPUT_(?:TOO_SHORT|INVALID|RATIO_MISMATCH)');
    expect(handler).not.toContain('assertMotionComicVideoOutputRatio');
  });

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
