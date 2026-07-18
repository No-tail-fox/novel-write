import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, realpath, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { AppError, isCancellation, normalizeAppError } from './app-error';
import {
  MAX_HTML_VIDEO_SCENES,
  MAX_HTML_VIDEO_SOURCE_CHARS,
  MAX_HTML_VIDEO_WARNINGS,
  MAX_HTML_VIDEO_PIPELINE_FILE_BYTES,
  MAX_HTML_VIDEO_PIPELINE_JSON_CHARS,
  htmlVideoVisibleSteps,
  parseHtmlVideoPipelineData,
  planHtmlVideoScenes,
  validateHtmlVideoAssets,
  validateHtmlVideoCompositions,
  validateHtmlVideoScenePlans,
  validateHtmlVideoVoices,
} from './html-video-workflow';
import type {
  HtmlVideoAsset,
  HtmlVideoCompositionSnapshot,
  HtmlVideoJobConfig,
  HtmlVideoOutput,
  HtmlVideoPipelineDataV2,
  HtmlVideoScenePlan,
  HtmlVideoVisibleStep,
  HtmlVideoVoiceClip,
} from './types';

export interface HtmlVideoRunnerInput {
  taskId: string;
  sourceText: string;
  state: HtmlVideoPipelineDataV2;
  rerunFrom?: HtmlVideoVisibleStep;
  ignoreCheckpoint?: boolean;
}

export interface HtmlVideoRewriteInput {
  sourceText: string;
  config: HtmlVideoJobConfig;
  signal?: AbortSignal;
}

export interface HtmlVideoRewriteOutput {
  rewrittenText: string;
  segments: string[];
}

export interface HtmlVideoPlanningInput extends HtmlVideoRewriteOutput {
  config: HtmlVideoJobConfig;
  signal?: AbortSignal;
}

export interface HtmlVideoAssetInput {
  scenes: HtmlVideoScenePlan[];
  config: HtmlVideoJobConfig;
  signal?: AbortSignal;
}

export interface HtmlVideoVoiceInput extends HtmlVideoAssetInput {}

export interface HtmlVideoPreviewInput extends HtmlVideoAssetInput {
  assets: HtmlVideoAsset[];
  voices: HtmlVideoVoiceClip[];
}

export interface HtmlVideoPreviewOutput {
  compositions: HtmlVideoCompositionSnapshot[];
}

export interface HtmlVideoRenderInput extends HtmlVideoPreviewInput {
  compositions: HtmlVideoCompositionSnapshot[];
}

export interface HtmlVideoRunnerOptions {
  workDir: string;
  signal?: AbortSignal;
  rewrite?: (input: HtmlVideoRewriteInput) => Promise<HtmlVideoRewriteOutput>;
  plan?: (input: HtmlVideoPlanningInput) => Promise<{ scenes: HtmlVideoScenePlan[] }>;
  generateAssets: (input: HtmlVideoAssetInput) => Promise<HtmlVideoAsset[]>;
  synthesizeVoices: (input: HtmlVideoVoiceInput) => Promise<HtmlVideoVoiceClip[]>;
  createPreviews: (input: HtmlVideoPreviewInput) => Promise<HtmlVideoPreviewOutput>;
  render: (input: HtmlVideoRenderInput) => Promise<HtmlVideoOutput>;
  consumeRenderArtifactDigest?: (
    output: HtmlVideoOutput,
    signal?: AbortSignal,
  ) => Promise<HtmlVideoRenderArtifactDigest>;
  onCheckpoint: (state: HtmlVideoPipelineDataV2) => Promise<void>;
}

export interface HtmlVideoRenderArtifactDigest {
  size: number;
  sha256: string;
}

interface RunnerContext {
  rewrite?: HtmlVideoRewriteOutput;
  trustedRenderDigest?: StepFileDigest;
}

interface StepArtifact {
  relativePath: string;
  size: number;
  hash: string;
}

interface AtomicWriteResult {
  size: number;
  hash: string;
}

interface StepFileDigest {
  path: string;
  size: number;
  sha256: string;
}

interface StepFileReference {
  path: string;
  expectedSize?: number;
}

interface ResolvedLocalFile {
  workDir: string;
  root: string;
  candidate: string;
  canonicalPath: string;
  relativePath: string;
}

interface OpenValidatedLocalFile extends ResolvedLocalFile {
  handle: Awaited<ReturnType<typeof open>>;
  identity: {
    device: string;
    inode: string;
    size: string;
    modifiedNs: string;
  };
}

const checkpointFileName = 'html-video-pipeline.v2.json';
const stepArtifactDir = 'steps';
const stepFileDigestsKey = '__storydreamFileDigests';
export const MAX_HTML_VIDEO_MEDIA_FILE_BYTES = 1024 * 1024 * 1024;
const maxAtomicReplaceAttempts = 8;
const boundedReadChunkBytes = 64 * 1024;
const activeHtmlVideoTasks = new Set<string>();

class InvalidPipelineFileError extends Error {}

export async function runHtmlVideoPipeline(
  input: HtmlVideoRunnerInput,
  options: HtmlVideoRunnerOptions,
): Promise<HtmlVideoPipelineDataV2> {
  if (input.sourceText.length > MAX_HTML_VIDEO_SOURCE_CHARS) {
    throw new AppError(
      'HTML_VIDEO_SOURCE_TOO_LARGE',
      `HTML video source text must not exceed ${MAX_HTML_VIDEO_SOURCE_CHARS} characters.`,
    );
  }
  const taskId = input.taskId.trim();
  if (!taskId) throw new AppError('HTML_VIDEO_TASK_INVALID', 'HTML video task id is required.');
  if (activeHtmlVideoTasks.has(taskId)) {
    throw new AppError('HTML_VIDEO_ALREADY_RUNNING', 'HTML video task is already running.');
  }

  activeHtmlVideoTasks.add(taskId);
  try {
    return await runOwnedPipeline({ ...input, taskId }, options);
  } finally {
    activeHtmlVideoTasks.delete(taskId);
  }
}

export function invalidateHtmlVideoPipeline(
  value: HtmlVideoPipelineDataV2,
  fromStep: HtmlVideoVisibleStep,
): HtmlVideoPipelineDataV2 {
  const state = cloneValidatedState(value);
  const fromIndex = htmlVideoVisibleSteps.indexOf(fromStep);
  if (fromIndex < 0) throw new AppError('HTML_VIDEO_STEP_INVALID', 'HTML video rerun step is invalid.');

  for (const step of htmlVideoVisibleSteps.slice(fromIndex)) {
    state.steps[step] = { status: 'pending' };
  }
  if (fromIndex <= htmlVideoVisibleSteps.indexOf('planning')) state.scenes = [];
  if (fromIndex <= htmlVideoVisibleSteps.indexOf('assets')) state.assets = [];
  if (fromIndex <= htmlVideoVisibleSteps.indexOf('voice')) state.voices = [];
  if (fromIndex <= htmlVideoVisibleSteps.indexOf('preview')) state.compositions = [];
  if (fromIndex <= htmlVideoVisibleSteps.indexOf('render')) delete state.output;
  state.current = fromStep;
  return state;
}

export async function synchronizeHtmlVideoPipelineCheckpoint(
  workDir: string,
  state: HtmlVideoPipelineDataV2,
): Promise<void> {
  await atomicWriteJson(join(workDir, checkpointFileName), cloneValidatedState(state));
}

async function runOwnedPipeline(
  input: HtmlVideoRunnerInput,
  options: HtmlVideoRunnerOptions,
): Promise<HtmlVideoPipelineDataV2> {
  await mkdir(join(options.workDir, stepArtifactDir), { recursive: true });
  let state = input.ignoreCheckpoint
    ? cloneValidatedState(input.state)
    : await loadCheckpoint(options.workDir, input.state);
  const context: RunnerContext = {};

  if (input.rerunFrom) {
    state = invalidateHtmlVideoPipeline(state, input.rerunFrom);
    await persistCheckpoint(state, options);
  }

  for (const step of htmlVideoVisibleSteps) {
    await checkpointCancellationIfAborted(state, options);
    let inputHash = hashStepInput(step, input.sourceText, state, context);

    if (state.steps[step].status === 'completed') {
      try {
        const artifact = await validateCompletedStep(options.workDir, step, state, inputHash, options.signal);
        if (step === 'rewrite') {
          context.rewrite = validateRewriteOutput(
            artifact,
            state.config.maxScenes ?? MAX_HTML_VIDEO_SCENES,
          );
        }
        continue;
      } catch (error) {
        if (options.signal?.aborted || isCancellation(error)) {
          throw cancellationReason(error, options.signal);
        }
        state = invalidateHtmlVideoPipeline(state, step);
        inputHash = hashStepInput(step, input.sourceText, state, context);
      }
    } else if (state.steps[step].status !== 'pending') {
      state = invalidateHtmlVideoPipeline(state, step);
      inputHash = hashStepInput(step, input.sourceText, state, context);
    }

    state.current = step;
    state.steps[step] = {
      status: 'running',
      inputHash,
      startedAt: Date.now(),
    };
    await persistCheckpoint(state, options);

    let payload: unknown;
    try {
      payload = await executeStep(step, input.sourceText, state, context, options);
      throwIfAborted(options.signal);
      const artifact = await writeStepArtifact(options.workDir, step, payload, state, context, options.signal);
      state.steps[step] = {
        ...state.steps[step],
        status: 'completed',
        artifactPath: artifact.relativePath,
        artifactSize: artifact.size,
        artifactHash: artifact.hash,
        completedAt: Date.now(),
      };
    } catch (error) {
      const cancelled = options.signal?.aborted || isCancellation(error);
      if (cancelled) {
        const cancellation = cancellationReason(error, options.signal);
        state.steps[step] = {
          ...state.steps[step],
          status: 'cancelled',
          completedAt: Date.now(),
        };
        state.current = step;
        throw await persistCheckpointPreservingPrimaryError(state, options, cancellation);
      }

      const normalized = normalizeAppError(error, {
        code: `HTML_VIDEO_${step.toUpperCase()}_FAILED`,
        message: `HTML video ${step} step failed.`,
      });
      state.steps[step] = {
        ...state.steps[step],
        status: 'failed',
        error: normalized.message,
        completedAt: Date.now(),
      };
      state.current = step;
      throw await persistCheckpointPreservingPrimaryError(state, options, normalized);
    }

    const stepIndex = htmlVideoVisibleSteps.indexOf(step);
    state.current = htmlVideoVisibleSteps[stepIndex + 1] ?? 'done';
    await persistCheckpoint(state, options);
  }

  return cloneValidatedState(state);
}

async function executeStep(
  step: HtmlVideoVisibleStep,
  sourceText: string,
  state: HtmlVideoPipelineDataV2,
  context: RunnerContext,
  options: HtmlVideoRunnerOptions,
): Promise<unknown> {
  if (step === 'rewrite') {
    const maxSegments = state.config.maxScenes ?? MAX_HTML_VIDEO_SCENES;
    const rewrite = options.rewrite
      ? validateRewriteOutput(
          await options.rewrite({ sourceText, config: structuredClone(state.config), signal: options.signal }),
          maxSegments,
        )
      : deterministicRewrite(sourceText, maxSegments);
    if (!options.rewrite) addWarning(state, '未配置 LLM，已保留原文并仅执行分句。');
    context.rewrite = rewrite;
    return rewrite;
  }

  if (step === 'planning') {
    if (!context.rewrite) throw new AppError('HTML_VIDEO_REWRITE_MISSING', 'HTML video rewrite output is missing.');
    const rawScenes = options.plan
      ? (await options.plan({
          ...structuredClone(context.rewrite),
          config: structuredClone(state.config),
          signal: options.signal,
        })).scenes
      : planHtmlVideoScenes(context.rewrite.segments.join('\n\n'), state.config.maxScenes ?? 8);
    if (!options.plan) addWarning(state, '未配置场景规划 LLM，已使用确定性场景规划。');
    state.scenes = validateHtmlVideoScenePlans(
      rawScenes,
      state.config.maxScenes ?? MAX_HTML_VIDEO_SCENES,
    );
    return { scenes: state.scenes };
  }

  if (step === 'assets') {
    const generated = await options.generateAssets({
      scenes: structuredClone(state.scenes),
      config: structuredClone(state.config),
      signal: options.signal,
    });
    state.assets = await validateAssets(options.workDir, state, generated);
    return { assets: state.assets };
  }

  if (step === 'voice') {
    const generated = await options.synthesizeVoices({
      scenes: structuredClone(state.scenes),
      config: structuredClone(state.config),
      signal: options.signal,
    });
    state.voices = await validateVoices(options.workDir, state, generated);
    return { voices: state.voices };
  }

  if (step === 'preview') {
    await revalidateCompletedMediaSteps(options.workDir, state, ['assets', 'voice'], options.signal);
    const generated = await options.createPreviews({
      scenes: structuredClone(state.scenes),
      assets: structuredClone(state.assets),
      voices: structuredClone(state.voices),
      config: structuredClone(state.config),
      signal: options.signal,
    });
    await revalidateCompletedMediaSteps(options.workDir, state, ['assets', 'voice'], options.signal);
    state.compositions = await validateCompositions(options.workDir, state, generated.compositions);
    return { compositions: state.compositions };
  }

  await revalidateCompletedMediaSteps(options.workDir, state, ['assets', 'voice', 'preview'], options.signal);
  const generated = await options.render({
    scenes: structuredClone(state.scenes),
    assets: structuredClone(state.assets),
    voices: structuredClone(state.voices),
    compositions: structuredClone(state.compositions),
    config: structuredClone(state.config),
    signal: options.signal,
  });
  await revalidateCompletedMediaSteps(options.workDir, state, ['assets', 'voice', 'preview'], options.signal);
  state.output = await validateOutput(options.workDir, state, generated);
  context.trustedRenderDigest = undefined;
  if (options.consumeRenderArtifactDigest) {
    throwIfAborted(options.signal);
    const digest = await options.consumeRenderArtifactDigest(generated, options.signal);
    throwIfAborted(options.signal);
    if (
      !Number.isSafeInteger(digest.size)
      || digest.size <= 0
      || digest.size !== state.output.sizeBytes
      || !/^[a-f0-9]{64}$/u.test(digest.sha256)
    ) {
      throw new Error('HTML video trusted render digest is invalid.');
    }
    const resolved = await resolveLocalFile(options.workDir, state.output.path);
    throwIfAborted(options.signal);
    context.trustedRenderDigest = {
      path: resolved.relativePath,
      size: digest.size,
      sha256: digest.sha256,
    };
  }
  return { output: state.output };
}

async function revalidateCompletedMediaSteps(
  workDir: string,
  state: HtmlVideoPipelineDataV2,
  steps: HtmlVideoVisibleStep[],
  signal?: AbortSignal,
): Promise<void> {
  for (const step of steps) {
    const stepState = state.steps[step];
    if (stepState.status !== 'completed' || !stepState.inputHash) {
      throw new Error(`HTML video ${step} checkpoint is unavailable for media validation.`);
    }
    await validateCompletedStep(workDir, step, state, hashStepInput(step, '', state, {}), signal);
  }
}

async function validateCompletedStep(
  workDir: string,
  step: HtmlVideoVisibleStep,
  state: HtmlVideoPipelineDataV2,
  expectedHash: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const stepState = state.steps[step];
  if (stepState.inputHash !== expectedHash) throw new Error(`HTML video ${step} input changed.`);
  const payload = await readStepArtifact(
    workDir,
    stepState.artifactPath,
    stepState.artifactSize,
    stepState.artifactHash,
  );
  await validateStepFileDigests(workDir, step, state, payload, signal);

  if (step === 'rewrite') {
    return validateRewriteOutput(payload, state.config.maxScenes ?? MAX_HTML_VIDEO_SCENES);
  }
  const record = requireRecord(payload, `${step} artifact`);
  if (step === 'planning') {
    const scenes = validateHtmlVideoScenePlans(
      record.scenes,
      state.config.maxScenes ?? MAX_HTML_VIDEO_SCENES,
    );
    assertSameJson(scenes, state.scenes, 'planning');
    state.scenes = scenes;
  } else if (step === 'assets') {
    assertSameJson(record.assets, state.assets, 'assets');
    state.assets = await validateAssets(workDir, state, state.assets);
  } else if (step === 'voice') {
    assertSameJson(record.voices, state.voices, 'voice');
    state.voices = await validateVoices(workDir, state, state.voices);
  } else if (step === 'preview') {
    assertSameJson(record.compositions, state.compositions, 'preview');
    state.compositions = await validateCompositions(workDir, state, state.compositions);
  } else {
    assertSameJson(record.output, state.output, 'render');
    if (!state.output) throw new Error('HTML video render output is missing.');
    state.output = await validateOutput(workDir, state, state.output);
  }
  return payload;
}

async function validateAssets(
  workDir: string,
  state: HtmlVideoPipelineDataV2,
  value: unknown,
): Promise<HtmlVideoAsset[]> {
  const parsedAssets = validateHtmlVideoAssets(value, state.scenes, state.config);
  const assets = validatePatchedState(state, { assets: parsedAssets }).assets;
  for (const scene of state.scenes) {
    if (!assets.some((asset) => asset.sceneIndex === scene.index && asset.kind === 'bg')) {
      throw new Error(`HTML video assets are missing a background for scene ${scene.index}.`);
    }
    if (state.config.foreground !== false && scene.elements.length > 0 && !assets.some((asset) => asset.sceneIndex === scene.index && asset.kind === 'fg')) {
      throw new Error(`HTML video assets are missing a foreground for scene ${scene.index}.`);
    }
  }
  return Promise.all(assets.map(async (asset) => ({
    ...asset,
    src: await localFilePath(workDir, asset.src, asset.sizeBytes),
    sizeBytes: (await stat(await localFilePath(workDir, asset.src))).size,
  })));
}

async function validateVoices(
  workDir: string,
  state: HtmlVideoPipelineDataV2,
  value: unknown,
): Promise<HtmlVideoVoiceClip[]> {
  const parsedVoices = validateHtmlVideoVoices(value, state.scenes);
  const voices = validatePatchedState(state, { voices: parsedVoices }).voices;
  for (const scene of state.scenes) {
    if (!voices.some((voice) => voice.sceneIndex === scene.index && voice.durationSec > 0)) {
      throw new Error(`HTML video voice is missing for scene ${scene.index}.`);
    }
  }
  return Promise.all(voices.map(async (voice) => {
    if (!(voice.durationSec > 0)) throw new Error(`HTML video voice duration is invalid for scene ${voice.sceneIndex}.`);
    const src = await localFilePath(workDir, voice.src, voice.sizeBytes);
    return { ...voice, src, sizeBytes: (await stat(src)).size };
  }));
}

async function validateCompositions(
  workDir: string,
  state: HtmlVideoPipelineDataV2,
  value: unknown,
): Promise<HtmlVideoCompositionSnapshot[]> {
  const parsedCompositions = validateHtmlVideoCompositions(value, state.scenes);
  const compositions = validatePatchedState(state, { compositions: parsedCompositions }).compositions;
  if (compositions.length !== state.scenes.length) throw new Error('HTML video preview count does not match the scene count.');
  for (const scene of state.scenes) {
    const composition = compositions.find((item) => item.index === scene.index);
    if (!composition?.htmlPath) throw new Error(`HTML video preview is missing for scene ${scene.index}.`);
    composition.htmlPath = await localFilePath(workDir, composition.htmlPath);
    if (composition.thumbnailPath) composition.thumbnailPath = await localFilePath(workDir, composition.thumbnailPath);
    composition.audio.src = await localFilePath(workDir, composition.audio.src);
    composition.background.src = await localFilePath(workDir, composition.background.src);
  }
  return compositions;
}

async function validateOutput(
  workDir: string,
  state: HtmlVideoPipelineDataV2,
  value: unknown,
): Promise<HtmlVideoOutput> {
  const output = validatePatchedState(state, { output: value }).output;
  if (!output) throw new Error('HTML video output is missing.');
  const path = await localFilePath(workDir, output.path, output.sizeBytes || undefined);
  const file = await stat(path);
  return { ...output, path, sizeBytes: file.size };
}

function validatePatchedState(
  state: HtmlVideoPipelineDataV2,
  patch: Partial<Record<'scenes' | 'assets' | 'voices' | 'compositions' | 'output', unknown>>,
): HtmlVideoPipelineDataV2 {
  return cloneValidatedState({ ...state, ...patch });
}

function validateRewriteOutput(value: unknown, maxSegments: number): HtmlVideoRewriteOutput {
  const record = requireRecord(value, 'rewrite output');
  if (typeof record.rewrittenText !== 'string' || record.rewrittenText.length > MAX_HTML_VIDEO_SOURCE_CHARS) {
    throw new Error('HTML video rewrite output text is invalid or too large.');
  }
  const rewrittenText = requireNonEmptyString(record.rewrittenText, 'rewrite output text');
  if (
    !Array.isArray(record.segments)
    || record.segments.length === 0
    || record.segments.length > maxSegments
  ) {
    throw new Error('HTML video rewrite segments are invalid.');
  }
  const segments: string[] = [];
  let segmentChars = 0;
  for (const segment of record.segments) {
    if (typeof segment !== 'string') throw new Error('HTML video rewrite segment is invalid.');
    segmentChars += segment.length;
    if (segmentChars > MAX_HTML_VIDEO_SOURCE_CHARS) {
      throw new Error('HTML video rewrite segments are too large.');
    }
    segments.push(requireNonEmptyString(segment, 'rewrite segment'));
  }
  return { rewrittenText, segments };
}

function deterministicRewrite(sourceText: string, maxSegments: number): HtmlVideoRewriteOutput {
  if (sourceText.length > MAX_HTML_VIDEO_SOURCE_CHARS) {
    throw new Error(`HTML video source text must not exceed ${MAX_HTML_VIDEO_SOURCE_CHARS} characters.`);
  }
  const rewrittenText = requireNonEmptyString(sourceText.trim(), 'source text');
  const segments = splitDeterministicRewriteSegments(rewrittenText, maxSegments);
  if (segments.length === 0) throw new Error('HTML video source text could not be segmented.');
  return { rewrittenText, segments };
}

function splitDeterministicRewriteSegments(sourceText: string, maxSegments: number): string[] {
  if (!Number.isSafeInteger(maxSegments) || maxSegments < 1 || maxSegments > MAX_HTML_VIDEO_SCENES) {
    throw new Error('HTML video rewrite segment limit is invalid.');
  }
  const segments: string[] = [];
  const separator = /\n{2,}|[。！？!?；;]\s*/gu;
  let start = 0;
  while (segments.length < maxSegments - 1) {
    const match = separator.exec(sourceText);
    if (!match) break;
    const nextStart = match.index + match[0].length;
    const includesSeparator = /^[。！？!?；;]/u.test(match[0]);
    const segment = sourceText.slice(start, includesSeparator ? nextStart : match.index).trim();
    if (segment) segments.push(segment);
    start = nextStart;
  }
  const remainder = sourceText.slice(start).trim();
  if (remainder) segments.push(remainder);
  return segments;
}

function hashStepInput(
  step: HtmlVideoVisibleStep,
  sourceText: string,
  state: HtmlVideoPipelineDataV2,
  context: RunnerContext,
): string {
  let input: unknown;
  if (step === 'rewrite') input = { sourceText, config: state.config };
  else if (step === 'planning') input = { rewrite: context.rewrite, config: state.config };
  else if (step === 'assets') input = { scenes: state.scenes, config: pickConfig(state.config, ['style', 'ratio', 'foreground']) };
  else if (step === 'voice') input = { scenes: state.scenes, config: pickConfig(state.config, ['voiceId', 'ttsProvider', 'ttsSpeed']) };
  else if (step === 'preview') input = { scenes: state.scenes, assets: state.assets, voices: state.voices, config: state.config };
  else input = { compositions: state.compositions, config: state.config };
  return createHash('sha256').update(JSON.stringify({ step, input })).digest('hex');
}

function pickConfig(config: HtmlVideoJobConfig, keys: Array<keyof HtmlVideoJobConfig>): Partial<HtmlVideoJobConfig> {
  return Object.fromEntries(keys.filter((key) => config[key] !== undefined).map((key) => [key, config[key]])) as Partial<HtmlVideoJobConfig>;
}

async function loadCheckpoint(workDir: string, fallback: HtmlVideoPipelineDataV2): Promise<HtmlVideoPipelineDataV2> {
  let value: string;
  try {
    value = await readBoundedUtf8File(
      join(workDir, checkpointFileName),
      MAX_HTML_VIDEO_PIPELINE_FILE_BYTES,
    );
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return cloneValidatedState(fallback);
    if (error instanceof InvalidPipelineFileError) return recoveredCheckpoint(fallback);
    throw error;
  }
  try {
    return cloneValidatedState(parseHtmlVideoPipelineData(value));
  } catch {
    return recoveredCheckpoint(fallback);
  }
}

function recoveredCheckpoint(fallback: HtmlVideoPipelineDataV2): HtmlVideoPipelineDataV2 {
  const recovered = cloneValidatedState(fallback);
  addWarning(recovered, '检测到磁盘 HTML 视频 checkpoint 损坏，已使用数据库快照恢复。');
  return recovered;
}

async function persistCheckpoint(state: HtmlVideoPipelineDataV2, options: HtmlVideoRunnerOptions): Promise<void> {
  const snapshot = cloneValidatedState({ ...state, revision: state.revision + 1 });
  state.revision = snapshot.revision;
  await atomicWriteJson(join(options.workDir, checkpointFileName), snapshot);
  await options.onCheckpoint(structuredClone(snapshot));
}

async function persistCheckpointPreservingPrimaryError(
  state: HtmlVideoPipelineDataV2,
  options: HtmlVideoRunnerOptions,
  primaryError: unknown,
): Promise<unknown> {
  try {
    await persistCheckpoint(state, options);
    return primaryError;
  } catch (checkpointError) {
    return attachCheckpointFailure(primaryError, checkpointError);
  }
}

function attachCheckpointFailure(primaryError: unknown, checkpointError: unknown): unknown {
  if ((typeof primaryError !== 'object' || primaryError === null) && typeof primaryError !== 'function') {
    return primaryError;
  }
  const carrier = primaryError as { cause?: unknown; checkpointError?: unknown };
  try {
    const key = carrier.cause === undefined ? 'cause' : 'checkpointError';
    Object.defineProperty(carrier, key, {
      value: checkpointError,
      configurable: true,
    });
    return primaryError;
  } catch {
    const source = primaryError as {
      name?: unknown;
      message?: unknown;
      code?: unknown;
      retryable?: unknown;
      diagnosticId?: unknown;
      field?: unknown;
    };
    const wrapper = new AggregateError(
      [primaryError, checkpointError],
      typeof source.message === 'string' ? source.message : 'HTML video operation failed.',
      { cause: primaryError },
    ) as AggregateError & {
      code?: unknown;
      retryable?: unknown;
      diagnosticId?: unknown;
      field?: unknown;
      checkpointError?: unknown;
    };
    if (typeof source.name === 'string') wrapper.name = source.name;
    for (const key of ['code', 'retryable', 'diagnosticId', 'field'] as const) {
      if (source[key] !== undefined) Object.defineProperty(wrapper, key, { value: source[key], configurable: true });
    }
    Object.defineProperty(wrapper, 'checkpointError', {
      value: checkpointError,
      configurable: true,
    });
    return wrapper;
  }
}

async function writeStepArtifact(
  workDir: string,
  step: HtmlVideoVisibleStep,
  payload: unknown,
  state: HtmlVideoPipelineDataV2,
  context: RunnerContext,
  signal?: AbortSignal,
): Promise<StepArtifact> {
  const relativePath = join(stepArtifactDir, `${step}.json`);
  const path = join(workDir, relativePath);
  const record = requireRecord(payload, `${step} artifact`);
  throwIfAborted(signal);
  const fileDigests = await createStepFileDigests(
    workDir,
    step,
    state,
    signal,
    new Map(),
    context.trustedRenderDigest,
  );
  throwIfAborted(signal);
  try {
    const written = await atomicWriteJson(path, {
      ...record,
      [stepFileDigestsKey]: fileDigests,
    });
    throwIfAborted(signal);
    return { relativePath, size: written.size, hash: written.hash };
  } catch (error) {
    if (signal?.aborted || isCancellation(error)) await rm(path, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readStepArtifact(
  workDir: string,
  artifactPath: string | undefined,
  artifactSize: number | undefined,
  artifactHash: string | undefined,
): Promise<unknown> {
  if (!artifactPath || !artifactSize) throw new Error('HTML video step artifact metadata is missing.');
  const path = await localFilePath(workDir, artifactPath);
  const value = await readBoundedUtf8File(
    path,
    MAX_HTML_VIDEO_PIPELINE_FILE_BYTES,
    artifactSize,
  );
  if (value.length > MAX_HTML_VIDEO_PIPELINE_JSON_CHARS) throw new Error('HTML video step artifact is too large.');
  if (artifactHash && sha256Text(value) !== artifactHash) {
    throw new Error('HTML video step artifact content changed.');
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error('HTML video step artifact JSON is invalid.');
  }
}

async function validateStepFileDigests(
  workDir: string,
  step: HtmlVideoVisibleStep,
  state: HtmlVideoPipelineDataV2,
  payload: unknown,
  signal?: AbortSignal,
): Promise<void> {
  const record = requireRecord(payload, `${step} artifact`);
  const value = record[stepFileDigestsKey];
  const requiresDigests = htmlVideoVisibleSteps.indexOf(step) >= htmlVideoVisibleSteps.indexOf('assets');
  if (value === undefined) {
    if (requiresDigests) throw new Error(`HTML video ${step} artifact file digests are missing.`);
    return;
  }
  if (!Array.isArray(value) || value.length > MAX_HTML_VIDEO_SCENES * 8) {
    throw new Error(`HTML video ${step} artifact file digests are invalid.`);
  }
  const stored = value.map((item, index): StepFileDigest => {
    const digest = requireRecord(item, `${step} artifact file digest ${index}`);
    if (
      typeof digest.path !== 'string'
      || !digest.path
      || typeof digest.size !== 'number'
      || !Number.isSafeInteger(digest.size)
      || digest.size <= 0
      || typeof digest.sha256 !== 'string'
      || !/^[a-f0-9]{64}$/u.test(digest.sha256)
    ) {
      throw new Error(`HTML video ${step} artifact file digest ${index} is invalid.`);
    }
    return { path: digest.path, size: digest.size, sha256: digest.sha256 };
  });
  const expected = new Map(stored.map((digest) => [digest.path, digest]));
  const current = await createStepFileDigests(workDir, step, state, signal, expected);
  assertSameJson(stored, current, `${step} file digests`);
}

async function createStepFileDigests(
  workDir: string,
  step: HtmlVideoVisibleStep,
  state: HtmlVideoPipelineDataV2,
  signal?: AbortSignal,
  expectedDigests: ReadonlyMap<string, StepFileDigest> = new Map(),
  trustedRenderDigest?: StepFileDigest,
): Promise<StepFileDigest[]> {
  const files = new Map<string, StepFileDigest>();
  for (const reference of stepFileReferences(step, state)) {
    throwIfAborted(signal);
    const resolved = await resolveLocalFile(workDir, reference.path);
    const expected = expectedDigests.get(resolved.relativePath);
    if (expected && reference.expectedSize !== undefined && expected.size !== reference.expectedSize) {
      throw new Error(`HTML video ${step} artifact size metadata changed.`);
    }
    let digest: Pick<StepFileDigest, 'size' | 'sha256'>;
    if (trustedRenderDigest && step === 'render') {
      if (
        resolved.relativePath !== trustedRenderDigest.path
        || (reference.expectedSize !== undefined && reference.expectedSize !== trustedRenderDigest.size)
      ) {
        throw new Error('HTML video trusted render digest does not match the output.');
      }
      digest = trustedRenderDigest;
    } else {
      digest = await hashFile(resolved, expected?.size ?? reference.expectedSize, signal);
    }
    files.set(resolved.relativePath, { path: resolved.relativePath, ...digest });
  }
  if (trustedRenderDigest && (step !== 'render' || files.get(trustedRenderDigest.path)?.sha256 !== trustedRenderDigest.sha256)) {
    throw new Error('HTML video trusted render digest is not associated with the render output.');
  }
  if (files.size !== expectedDigests.size && expectedDigests.size > 0) {
    throw new Error(`HTML video ${step} artifact file set changed.`);
  }
  return [...files.values()].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

function stepFileReferences(step: HtmlVideoVisibleStep, state: HtmlVideoPipelineDataV2): StepFileReference[] {
  if (step === 'assets') {
    return state.assets.map((asset) => ({ path: asset.src, expectedSize: positiveFileSize(asset.sizeBytes) }));
  }
  if (step === 'voice') {
    return state.voices.map((voice) => ({ path: voice.src, expectedSize: positiveFileSize(voice.sizeBytes) }));
  }
  if (step === 'preview') {
    const assetSizes = new Map(state.assets.map((asset) => [asset.src, positiveFileSize(asset.sizeBytes)]));
    const voiceSizes = new Map(state.voices.map((voice) => [voice.src, positiveFileSize(voice.sizeBytes)]));
    return state.compositions.flatMap((composition): StepFileReference[] => [
      ...(composition.htmlPath ? [{ path: composition.htmlPath }] : []),
      ...(composition.thumbnailPath ? [{ path: composition.thumbnailPath }] : []),
      { path: composition.audio.src, expectedSize: voiceSizes.get(composition.audio.src) },
      { path: composition.background.src, expectedSize: assetSizes.get(composition.background.src) },
    ]);
  }
  if (step === 'render' && state.output?.path) {
    return [{ path: state.output.path, expectedSize: positiveFileSize(state.output.sizeBytes) }];
  }
  return [];
}

function positiveFileSize(value: number | undefined): number | undefined {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

async function resolveLocalFile(workDir: string, path: string): Promise<ResolvedLocalFile> {
  const root = await realpath(workDir);
  const candidate = isAbsolute(path) ? resolve(path) : resolve(workDir, path);
  const canonicalPath = await realpath(candidate);
  assertLocalFilePath(root, canonicalPath);
  return {
    workDir,
    root,
    candidate,
    canonicalPath,
    relativePath: relative(root, canonicalPath),
  };
}

async function hashFile(
  resolved: ResolvedLocalFile,
  expectedSize: number | undefined,
  signal?: AbortSignal,
): Promise<Pick<StepFileDigest, 'size' | 'sha256'>> {
  const opened = await openValidatedLocalFile(resolved, expectedSize, signal);
  const { handle } = opened;
  try {
    const size = Number(opened.identity.size);
    const hash = createHash('sha256');
    let position = 0;
    while (position < size) {
      throwIfAborted(signal);
      const buffer = Buffer.allocUnsafe(Math.min(boundedReadChunkBytes, size - position));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) throw new Error('HTML video artifact changed while hashing.');
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    throwIfAborted(signal);
    await validateOpenLocalFile(opened, signal);
    return { size, sha256: hash.digest('hex') };
  } finally {
    await handle.close();
  }
}

async function openValidatedLocalFile(
  resolved: ResolvedLocalFile,
  expectedSize: number | undefined,
  signal?: AbortSignal,
): Promise<OpenValidatedLocalFile> {
  throwIfAborted(signal);
  const currentRoot = await realpath(resolved.workDir);
  const currentPath = await realpath(resolved.candidate);
  if (!sameLocalPath(currentRoot, resolved.root) || !sameLocalPath(currentPath, resolved.canonicalPath)) {
    throw new Error('HTML video artifact path changed before hashing.');
  }
  assertLocalFilePath(currentRoot, currentPath);
  const pinned = await lstat(currentPath, { bigint: true });
  assertDigestFile(pinned, expectedSize);
  const handle = await open(currentPath, 'r');
  try {
    const opened = await handle.stat({ bigint: true });
    if (!isSameFileIdentity(opened, fileIdentity(pinned))) {
      throw new Error('HTML video artifact changed while opening.');
    }
    const value: OpenValidatedLocalFile = {
      ...resolved,
      handle,
      identity: fileIdentity(opened),
    };
    await validateOpenLocalFile(value, signal);
    return value;
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

async function validateOpenLocalFile(value: OpenValidatedLocalFile, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  const [currentRoot, currentPath, lexical, opened] = await Promise.all([
    realpath(value.workDir),
    realpath(value.candidate),
    lstat(value.canonicalPath, { bigint: true }),
    value.handle.stat({ bigint: true }),
  ]);
  if (
    !sameLocalPath(currentRoot, value.root)
    || !sameLocalPath(currentPath, value.canonicalPath)
    || lexical.isSymbolicLink()
    || !isSameFileIdentity(lexical, value.identity)
    || !isSameFileIdentity(opened, value.identity)
  ) {
    throw new Error('HTML video artifact identity changed while hashing.');
  }
  assertLocalFilePath(currentRoot, currentPath);
  throwIfAborted(signal);
}

function assertDigestFile(
  value: Awaited<ReturnType<typeof lstat>>,
  expectedSize: number | undefined,
): void {
  const size = BigInt(value.size);
  if (!value.isFile() || value.isSymbolicLink() || size <= 0n) {
    throw new Error('HTML video artifact is empty or invalid.');
  }
  if (size > BigInt(MAX_HTML_VIDEO_MEDIA_FILE_BYTES)) {
    throw new Error('HTML video media file is too large to checkpoint safely.');
  }
  if (expectedSize !== undefined && size !== BigInt(expectedSize)) {
    throw new Error('HTML video artifact size changed before hashing.');
  }
}

function fileIdentity(value: { dev: bigint | number; ino: bigint | number; size: bigint | number; mtimeNs?: bigint }): OpenValidatedLocalFile['identity'] {
  return {
    device: value.dev.toString(),
    inode: value.ino.toString(),
    size: value.size.toString(),
    modifiedNs: value.mtimeNs?.toString() ?? '',
  };
}

function isSameFileIdentity(
  value: { dev: bigint | number; ino: bigint | number; size: bigint | number; mtimeNs?: bigint },
  identity: OpenValidatedLocalFile['identity'],
): boolean {
  const current = fileIdentity(value);
  return current.device === identity.device
    && current.inode === identity.inode
    && current.size === identity.size
    && current.modifiedNs === identity.modifiedNs;
}

function sameLocalPath(left: string, right: string): boolean {
  return relative(resolve(left), resolve(right)) === '' && relative(resolve(right), resolve(left)) === '';
}

function assertLocalFilePath(root: string, path: string): void {
  const fromRoot = relative(root, path);
  if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error('HTML video artifact must stay inside the task directory.');
  }
}

async function readBoundedUtf8File(
  path: string,
  maximumBytes: number,
  expectedSize?: number,
): Promise<string> {
  const handle = await open(path, 'r');
  try {
    const file = await handle.stat();
    if (!file.isFile() || file.size <= 0) {
      throw new InvalidPipelineFileError('HTML video pipeline file is empty or invalid.');
    }
    if (file.size > maximumBytes) {
      throw new InvalidPipelineFileError('HTML video pipeline file is too large.');
    }
    if (expectedSize !== undefined && file.size !== expectedSize) {
      throw new InvalidPipelineFileError('HTML video artifact size changed.');
    }

    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= maximumBytes) {
      const remaining = maximumBytes - total + 1;
      const buffer = Buffer.allocUnsafe(Math.min(boundedReadChunkBytes, remaining));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, total);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maximumBytes) {
        throw new InvalidPipelineFileError('HTML video pipeline file is too large.');
      }
      chunks.push(buffer.subarray(0, bytesRead));
    }
    if (expectedSize !== undefined && total !== expectedSize) {
      throw new InvalidPipelineFileError('HTML video artifact size changed.');
    }
    return Buffer.concat(chunks, total).toString('utf8');
  } finally {
    await handle.close();
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<AtomicWriteResult> {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (serialized.length > MAX_HTML_VIDEO_PIPELINE_JSON_CHARS) throw new Error('HTML video checkpoint is too large.');
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(temp, 'wx');
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    for (let attempt = 0; attempt < maxAtomicReplaceAttempts; attempt += 1) {
      try {
        await rename(temp, path);
        return { size: Buffer.byteLength(serialized), hash: sha256Text(serialized) };
      } catch (error) {
        if (!isRetryableReplaceError(error) || attempt === maxAtomicReplaceAttempts - 1) throw error;
        await delay(10 * (attempt + 1));
      }
    }
    throw new Error('HTML video atomic replace did not complete.');
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temp, { force: true }).catch(() => undefined);
  }
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function localFilePath(workDir: string, path: string, expectedSize?: number): Promise<string> {
  const root = await realpath(workDir);
  const candidate = isAbsolute(path) ? resolve(path) : resolve(workDir, path);
  const actual = await realpath(candidate);
  const fromRoot = relative(root, actual);
  if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error('HTML video artifact must stay inside the task directory.');
  }
  const file = await stat(actual);
  if (!file.isFile() || file.size <= 0) throw new Error('HTML video artifact is empty or invalid.');
  if (expectedSize !== undefined && file.size !== expectedSize) throw new Error('HTML video artifact size changed.');
  return actual;
}

function cloneValidatedState(value: unknown): HtmlVideoPipelineDataV2 {
  const serialized = JSON.stringify(value);
  if (!serialized) throw new Error('HTML video pipeline state is invalid.');
  const parsed = parseHtmlVideoPipelineData(serialized);
  return JSON.parse(JSON.stringify(parsed)) as HtmlVideoPipelineDataV2;
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`HTML video ${field} is invalid.`);
  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`HTML video ${field} is invalid.`);
  return value.trim();
}

function assertSameJson(actual: unknown, expected: unknown, step: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`HTML video ${step} artifact does not match its checkpoint.`);
}

function addWarning(state: HtmlVideoPipelineDataV2, warning: string): void {
  if (state.warnings.includes(warning)) return;
  state.warnings.push(warning);
  if (state.warnings.length > MAX_HTML_VIDEO_WARNINGS) {
    state.warnings.splice(0, state.warnings.length - MAX_HTML_VIDEO_WARNINGS);
  }
}

async function checkpointCancellationIfAborted(
  state: HtmlVideoPipelineDataV2,
  options: HtmlVideoRunnerOptions,
): Promise<void> {
  if (!options.signal?.aborted) return;
  const step = htmlVideoVisibleSteps.find((candidate) => state.steps[candidate].status !== 'completed');
  if (step) {
    const previous = state.steps[step];
    state.current = step;
    state.steps[step] = {
      status: 'cancelled',
      ...(previous.inputHash ? { inputHash: previous.inputHash } : {}),
      ...(previous.startedAt === undefined ? {} : { startedAt: previous.startedAt }),
      completedAt: Date.now(),
    };
    const cancellation = cancellationReason(options.signal.reason, options.signal);
    throw await persistCheckpointPreservingPrimaryError(state, options, cancellation);
  }
  throw cancellationReason(options.signal.reason, options.signal);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw cancellationReason(signal.reason, signal);
}

function cancellationReason(error: unknown, signal: AbortSignal | undefined): unknown {
  if (isCancellation(error)) return error;
  if (isCancellation(signal?.reason)) return signal?.reason;
  return new DOMException('The HTML video operation was cancelled.', 'AbortError');
}

function isRetryableReplaceError(error: unknown): boolean {
  return isNodeError(error, 'EACCES') || isNodeError(error, 'EBUSY') || isNodeError(error, 'EPERM');
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
