import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { AppError, isCancellation, normalizeAppError } from './app-error';
import {
  MAX_HTML_VIDEO_PIPELINE_JSON_CHARS,
  htmlVideoVisibleSteps,
  parseHtmlVideoPipelineData,
  planHtmlVideoScenes,
  validateHtmlVideoScenePlans,
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
  onCheckpoint: (state: HtmlVideoPipelineDataV2) => Promise<void>;
}

interface RunnerContext {
  rewrite?: HtmlVideoRewriteOutput;
}

interface StepArtifact {
  relativePath: string;
  size: number;
}

const checkpointFileName = 'html-video-pipeline.v2.json';
const stepArtifactDir = 'steps';
const maxAtomicReplaceAttempts = 8;
const activeHtmlVideoTasks = new Set<string>();

export async function runHtmlVideoPipeline(
  input: HtmlVideoRunnerInput,
  options: HtmlVideoRunnerOptions,
): Promise<HtmlVideoPipelineDataV2> {
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

async function runOwnedPipeline(
  input: HtmlVideoRunnerInput,
  options: HtmlVideoRunnerOptions,
): Promise<HtmlVideoPipelineDataV2> {
  await mkdir(join(options.workDir, stepArtifactDir), { recursive: true });
  let state = await loadCheckpoint(options.workDir, input.state);
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
        const artifact = await validateCompletedStep(options.workDir, step, state, inputHash);
        if (step === 'rewrite') context.rewrite = validateRewriteOutput(artifact);
        continue;
      } catch {
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
      const artifact = await writeStepArtifact(options.workDir, step, payload);
      state.steps[step] = {
        ...state.steps[step],
        status: 'completed',
        artifactPath: artifact.relativePath,
        artifactSize: artifact.size,
        completedAt: Date.now(),
      };
    } catch (error) {
      const cancelled = options.signal?.aborted || isCancellation(error);
      if (cancelled) {
        state.steps[step] = {
          ...state.steps[step],
          status: 'cancelled',
          completedAt: Date.now(),
        };
        state.current = step;
        await persistCheckpoint(state, options);
        throw cancellationReason(error, options.signal);
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
      await persistCheckpoint(state, options);
      throw normalized;
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
    const rewrite = options.rewrite
      ? validateRewriteOutput(await options.rewrite({ sourceText, config: state.config, signal: options.signal }))
      : deterministicRewrite(sourceText);
    if (!options.rewrite) addWarning(state, '未配置 LLM，已保留原文并仅执行分句。');
    context.rewrite = rewrite;
    return rewrite;
  }

  if (step === 'planning') {
    if (!context.rewrite) throw new AppError('HTML_VIDEO_REWRITE_MISSING', 'HTML video rewrite output is missing.');
    const rawScenes = options.plan
      ? (await options.plan({ ...context.rewrite, config: state.config, signal: options.signal })).scenes
      : planHtmlVideoScenes(context.rewrite.segments.join('\n\n'), state.config.maxScenes ?? 8);
    if (!options.plan) addWarning(state, '未配置场景规划 LLM，已使用确定性场景规划。');
    state.scenes = validateHtmlVideoScenePlans(rawScenes);
    return { scenes: state.scenes };
  }

  if (step === 'assets') {
    const generated = await options.generateAssets({ scenes: state.scenes, config: state.config, signal: options.signal });
    state.assets = await validateAssets(options.workDir, state, generated);
    return { assets: state.assets };
  }

  if (step === 'voice') {
    const generated = await options.synthesizeVoices({ scenes: state.scenes, config: state.config, signal: options.signal });
    state.voices = await validateVoices(options.workDir, state, generated);
    return { voices: state.voices };
  }

  if (step === 'preview') {
    const generated = await options.createPreviews({
      scenes: state.scenes,
      assets: state.assets,
      voices: state.voices,
      config: state.config,
      signal: options.signal,
    });
    state.compositions = await validateCompositions(options.workDir, state, generated.compositions);
    return { compositions: state.compositions };
  }

  const generated = await options.render({
    scenes: state.scenes,
    assets: state.assets,
    voices: state.voices,
    compositions: state.compositions,
    config: state.config,
    signal: options.signal,
  });
  state.output = await validateOutput(options.workDir, state, generated);
  return { output: state.output };
}

async function validateCompletedStep(
  workDir: string,
  step: HtmlVideoVisibleStep,
  state: HtmlVideoPipelineDataV2,
  expectedHash: string,
): Promise<unknown> {
  const stepState = state.steps[step];
  if (stepState.inputHash !== expectedHash) throw new Error(`HTML video ${step} input changed.`);
  const payload = await readStepArtifact(workDir, stepState.artifactPath, stepState.artifactSize);

  if (step === 'rewrite') return validateRewriteOutput(payload);
  const record = requireRecord(payload, `${step} artifact`);
  if (step === 'planning') {
    const scenes = validateHtmlVideoScenePlans(record.scenes);
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
  const assets = validatePatchedState(state, { assets: value }).assets;
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
  const voices = validatePatchedState(state, { voices: value }).voices;
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
  const compositions = validatePatchedState(state, { compositions: value }).compositions;
  if (compositions.length !== state.scenes.length) throw new Error('HTML video preview count does not match the scene count.');
  for (const scene of state.scenes) {
    const composition = compositions.find((item) => item.index === scene.index);
    if (!composition?.htmlPath) throw new Error(`HTML video preview is missing for scene ${scene.index}.`);
    composition.htmlPath = await localFilePath(workDir, composition.htmlPath);
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

function validateRewriteOutput(value: unknown): HtmlVideoRewriteOutput {
  const record = requireRecord(value, 'rewrite output');
  const rewrittenText = requireNonEmptyString(record.rewrittenText, 'rewrite output text');
  if (!Array.isArray(record.segments) || record.segments.length === 0) {
    throw new Error('HTML video rewrite segments are invalid.');
  }
  const segments = record.segments.map((segment) => requireNonEmptyString(segment, 'rewrite segment'));
  return { rewrittenText, segments };
}

function deterministicRewrite(sourceText: string): HtmlVideoRewriteOutput {
  const rewrittenText = requireNonEmptyString(sourceText.trim(), 'source text');
  const segments = rewrittenText
    .split(/\n{2,}|(?<=[。！？!?；;])\s*/u)
    .map((item) => item.trim())
    .filter(Boolean);
  if (segments.length === 0) throw new Error('HTML video source text could not be segmented.');
  return { rewrittenText, segments };
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
  try {
    const value = await readFile(join(workDir, checkpointFileName), 'utf8');
    return cloneValidatedState(parseHtmlVideoPipelineData(value));
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return cloneValidatedState(fallback);
    throw error;
  }
}

async function persistCheckpoint(state: HtmlVideoPipelineDataV2, options: HtmlVideoRunnerOptions): Promise<void> {
  state.revision += 1;
  await atomicWriteJson(join(options.workDir, checkpointFileName), state);
  await options.onCheckpoint(structuredClone(state));
}

async function writeStepArtifact(workDir: string, step: HtmlVideoVisibleStep, payload: unknown): Promise<StepArtifact> {
  const relativePath = join(stepArtifactDir, `${step}.json`);
  const path = join(workDir, relativePath);
  const size = await atomicWriteJson(path, payload);
  return { relativePath, size };
}

async function readStepArtifact(
  workDir: string,
  artifactPath: string | undefined,
  artifactSize: number | undefined,
): Promise<unknown> {
  if (!artifactPath || !artifactSize) throw new Error('HTML video step artifact metadata is missing.');
  const path = await localFilePath(workDir, artifactPath, artifactSize);
  const value = await readFile(path, 'utf8');
  if (value.length > MAX_HTML_VIDEO_PIPELINE_JSON_CHARS) throw new Error('HTML video step artifact is too large.');
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error('HTML video step artifact JSON is invalid.');
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<number> {
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
        return Buffer.byteLength(serialized);
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
  if (!state.warnings.includes(warning)) state.warnings.push(warning);
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
    await persistCheckpoint(state, options);
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
