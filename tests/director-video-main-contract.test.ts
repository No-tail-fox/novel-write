import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

function descendants<T extends ts.Node>(root: ts.Node, guard: (node: ts.Node) => node is T): T[] {
  const matches: T[] = [];
  function visit(node: ts.Node) {
    if (guard(node)) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(root);
  return matches;
}
function parse(source: string) {
  return ts.createSourceFile('contract.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}
function namedFunction(source: string, name: string) {
  const node = descendants(parse(source), ts.isFunctionDeclaration).find(candidate => candidate.name?.text === name);
  if (!node) throw new Error(`Function ${name} was not found.`);
  return node.getText();
}
function ipcHandler(source: string, channel: string) {
  const node = descendants(parse(source), ts.isCallExpression).find(candidate =>
    candidate.expression.getText() === 'trustedHandle' && ts.isStringLiteral(candidate.arguments[0]) && candidate.arguments[0].text === channel);
  if (!node) throw new Error(`IPC handler ${channel} was not found.`);
  return node.getText();
}

async function directorVideoHandler(): Promise<string> {
  const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
  return ipcHandler(main, 'director:generate-shot-video');
}

async function normalizeSceneVideoContract(): Promise<string> {
  const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
  return namedFunction(main, 'normalizeSceneVideo');
}

async function motionComicVideoGenerator(): Promise<string> {
  // O-5: the generator moved from main.ts into electron/motion-comic-shot-video.ts (main keeps one factory line).
  const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
  const binding = descendants(parse(main), ts.isVariableDeclaration).find(node =>
    node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText() === 'createMotionComicShotVideo');
  expect(binding && ts.isObjectBindingPattern(binding.name)).toBe(true);
  const names = binding && ts.isObjectBindingPattern(binding.name) ? binding.name.elements.map(element => element.name.getText()) : [];
  expect(names).toEqual(expect.arrayContaining(['generateMotionComicShotVideo', 'recoverMotionComicShotVideo', 'withMotionComicShotVideoRecoveryLock']));
  const source = await readFile(new URL('../electron/motion-comic-shot-video.ts', import.meta.url), 'utf8');
  return namedFunction(source, 'createMotionComicShotVideo');
}

describe('director video main-process lifecycle', () => {
  it('rejects candidate mode for VOX before any provider setup', async () => {
    const handler = await directorVideoHandler();
    const dispatch = handler.indexOf('return generateMotionComicShotVideo(database, task, input, reservation)');
    const reject = handler.indexOf("if (input.adoption === 'candidate')");
    expect(reject).toBeGreaterThan(dispatch);
    expect(reject).toBeLessThan(handler.indexOf('const runtimeConfig = await getProjectRuntimeConfig(task)'));
    expect(handler).toContain('DIRECTOR_VIDEO_ADOPTION_UNSUPPORTED');
  });
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

  it('holds the shared exclusive lock around submission reconciliation and dispatches queries separately', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const handler = parse(ipcHandler(main, 'motion-comic:recover-video-submission'));
    const locks = descendants(handler, ts.isCallExpression).filter(node => node.expression.getText() === 'withMotionComicShotVideoRecoveryLock');
    expect(locks).toHaveLength(1);
    expect(locks[0].arguments.slice(0, 2).map(node => node.getText())).toEqual(['input.id', 'input.shotId']);
    const callback = locks[0].arguments[2];
    expect(ts.isArrowFunction(callback)).toBe(true);
    const recovery = descendants(callback, ts.isCallExpression).filter(node => node.expression.getText() === 'recoverMotionComicVideoSubmission');
    expect(recovery).toHaveLength(1);
    expect(descendants(handler, ts.isCallExpression).filter(node => node.expression.getText() === 'recoverMotionComicVideoSubmission')).toEqual(recovery);
    const active = descendants(recovery[0], ts.isPropertyAssignment).find(node => node.name.getText() === 'isActive');
    expect(active && ts.isArrowFunction(active.initializer) && active.initializer.body.kind === ts.SyntaxKind.FalseKeyword).toBe(true);
    const queryHandler = ipcHandler(main, 'director:resume-shot-video');
    expect(queryHandler).toContain('return recoverMotionComicShotVideo(database, task, input, reservation)');
    expect(queryHandler).not.toContain('generateMotionComicShotVideo(');
    const generator = await motionComicVideoGenerator();
    const lock = namedFunction(generator, 'withMotionComicShotVideoRecoveryLock');
    expect(lock.indexOf('if (active.has(key))')).toBeLessThan(lock.indexOf('active.add(key)'));
    expect(lock).toContain('try { return await work(); } finally { active.delete(key); }');
    expect(generator).toContain('() => executeMotionComicShotVideo(database, task, input, reservation, recoveryOnly)');
    expect(generator).toContain('=> run(true, database, task, input, reservation)');
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
    const generated = descendants(parse(generator), ts.isVariableDeclaration).find(node => node.name.getText() === 'generated');
    const dispatch = generated?.initializer;
    expect(dispatch && ts.isConditionalExpression(dispatch)).toBe(true);
    if (!dispatch || !ts.isConditionalExpression(dispatch)) throw new Error('Expected exclusive query/submit dispatch.');
    expect(dispatch.condition.getText()).toBe('resumableJob');
    expect(descendants(dispatch.whenTrue, ts.isCallExpression).map(node => node.expression.getText())).toEqual(['provider.resume!']);
    expect(descendants(dispatch.whenFalse, ts.isCallExpression).map(node => node.expression.getText())).toEqual(['provider.generate']);
    expect(generator).toContain("if (recoveryOnly && !latestJob?.remoteTaskId) throw new Error('DIRECTOR_VIDEO_TASK_ID_REQUIRED");
  });

  it('recovers after current frames, duration, or ratio changed and preserves the output as stale history', async () => {
    const generator = await motionComicVideoGenerator();
    const recoveryBranch = generator.indexOf('if (resumableJob) {');
    const newSubmissionBranch = generator.indexOf('const frames = motionComicVideoInputFrames(document, shot);', recoveryBranch);
    const frameStat = generator.indexOf('await stat(asset.localPath)', newSubmissionBranch);
    const buildRequest = generator.indexOf('const selection = selectMotionComicVideoRoute(runtimeConfig, document, shot, remainingBudget)', newSubmissionBranch);
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
    expect(generator.slice(recoveryBranch, newSubmissionBranch)).not.toContain('motionComicVideoInputFrames');
    expect(generator.slice(recoveryBranch, newSubmissionBranch)).not.toContain('buildMotionComicShotVideoRequest');
    expect(generator.slice(recoveryBranch, newSubmissionBranch)).not.toContain('validateVideoGenerationRequest');
    expect(currentHash).toBeGreaterThan(resume);
    expect(hashCatch).toBeGreaterThan(currentHash);
    expect(generator.indexOf("currentHash = '';", hashCatch)).toBeGreaterThan(hashCatch);
    expect(generator).toContain('currentPrompt = currentFingerprint.prompt');
    expect(generator).toContain('resumableJob?.videoInputSnapshot');
    expect(generator).toContain("submittedFingerprint?.production?.audioMode ?? 'post-mix'");
    expect(generator).toContain('normalizeSceneVideo(generated.path, temporaryPath, preserveSubmittedAudio)');
    expect(generator).toContain('prompt: (request?.prompt ?? currentPrompt) || shot.prompt');
    expect(generator).toContain('selected: shouldAdopt');
    expect(generator).toContain('const shouldAdopt = !candidateOnly && !stale');
    expect(generator).toContain("error: '生成完成，但镜头输入已变化；结果保留在历史版本中。'");
    expect(generator).toContain('DIRECTOR_VIDEO_INPUT_CHANGED: 生成期间镜头已发生变化，结果已保留为未选中的历史版本。');
  });

  it('validates the submitted contract and retains rejected output without adopting it', async () => {
    const generator = await motionComicVideoGenerator();
    const normalize = generator.indexOf('const probe = await normalizeSceneVideo(generated.path, temporaryPath, preserveSubmittedAudio)');
    const stale = generator.indexOf('const stale = !latestShot', normalize);
    const submittedValidation = generator.indexOf('const expectedRatio = submittedFingerprint?.ratio ?? request?.ratio ?? document.ratio', stale);
    const durationValidation = generator.indexOf('probe.durationMs + 100 < expectedDurationMs', submittedValidation);
    const ratioValidation = generator.indexOf('assertMotionComicVideoOutputRatio(expectedRatio, probe.width, probe.height)', durationValidation);
    const persist = generator.indexOf('saved = await database.saveMotionComicTask', ratioValidation);
    const preserve = generator.indexOf('preservedStaleResult = true', persist);
    const rejection = generator.indexOf('if (outputValidation) throw new Error', preserve);

    expect(normalize).toBeGreaterThan(0);
    expect(stale).toBeGreaterThan(normalize);
    expect(submittedValidation).toBeGreaterThan(stale);
    expect(durationValidation).toBeGreaterThan(submittedValidation);
    expect(ratioValidation).toBeGreaterThan(durationValidation);
    expect(persist).toBeGreaterThan(ratioValidation);
    expect(preserve).toBeGreaterThan(persist);
    expect(rejection).toBeGreaterThan(preserve);
    expect(generator).toContain('const expectedDurationMs = resumableJob ? (submittedFingerprint?.durationSec ?? shot.durationMs / 1000) * 1000 : request!.durationSec * 1000');
    expect(generator).toContain("outputValidation = { status: 'rejected', code: validation.code, reason: validation.message");
    expect(generator).toContain('...(outputValidation ? { outputValidation } : {})');
    expect(generator).toContain('const shouldAdopt = !candidateOnly && !stale && !outputValidation');
    expect(generator).toContain('selected: shouldAdopt');
    expect(generator).toContain("status: outputValidation ? 'failed' as const : 'completed' as const");
    expect(generator).toContain('if (!preservedStaleResult) await rm(outputPath');
    expect(generator).not.toContain('if (!resumableJob && probe.durationMs');
    expect(generator).not.toContain('if (!resumableJob) assertMotionComicVideoOutputRatio');
  });

  it('rejects a motion-comic video whose normalized aspect ratio differs by more than three percent', async () => {
    const generator = await motionComicVideoGenerator();
    const handler = await directorVideoHandler();
    const normalize = generator.indexOf('const probe = await normalizeSceneVideo(generated.path, temporaryPath, preserveSubmittedAudio)');
    const validateDimensions = generator.indexOf('if (probe.width <= 0 || probe.height <= 0)', normalize);
    const validateRatio = generator.indexOf('assertMotionComicVideoOutputRatio(expectedRatio, probe.width, probe.height)', validateDimensions);
    const persist = generator.indexOf('saved = await database.saveMotionComicTask', validateRatio);

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
