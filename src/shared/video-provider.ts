import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fetchWithTimeout } from './http';
import { normalizeAppConfig } from './config-utils';
import type { AppConfig, VideoCapability, VideoProviderConfig } from './types';
import { selectVideoGenerationRoute, type VideoGenerationRouteRequest } from './video-routing';
import { isRemoteVideoReference, VIDEO_LAB_RATIOS, type VideoReferenceImage } from './video-lab';
import { videoModelLimits, videoReferenceToken } from './video-models';

export { selectVideoGenerationRoute } from './video-routing';
export type { VideoGenerationRoute, VideoGenerationRouteRequest } from './video-routing';

const MAX_VIDEO_BYTES = 512 * 1024 * 1024;
const MAX_REFERENCE_IMAGE_BYTES = 24 * 1024 * 1024;

export interface VideoGenerationRequest {
  prompt: string;
  durationSec: number;
  ratio: string;
  resolution?: string;
  generateAudio?: boolean;
  firstFramePath?: string;
  lastFramePath?: string;
  referenceImagePaths?: string[];
  referenceImages?: VideoReferenceImage[];
  referenceVideoPaths?: string[];
  referenceAudioPaths?: string[];
  signal?: AbortSignal;
  /** Called as soon as a provider returns a task id, before the first poll. */
  onSubmitted?: (remoteTaskId: string) => Promise<void> | void;
}

export interface VideoGenerationResult {
  path: string;
  providerId: string;
  providerName: string;
  model: string;
  remoteTaskId?: string;
  estimatedCost: number;
  license: string;
}

export interface VideoRecoveryRequest {
  /** Persisted estimate from the original billable submission. */
  estimatedCost: number;
  signal?: AbortSignal;
}

export interface VideoProvider {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly capabilities: readonly VideoCapability[];
  readonly license: string;
  estimateCost(durationSec: number): number;
  generate(input: VideoGenerationRequest): Promise<VideoGenerationResult>;
  /** Resume an already submitted billable task without issuing another POST. */
  resume?(remoteTaskId: string, input: VideoRecoveryRequest): Promise<VideoGenerationResult>;
}

export interface VideoProviderRuntimeOptions {
  /** POST retries can create duplicate billable jobs; explicit paid actions set this to zero. */
  submitRetryCount?: number;
  /** Pin a new request to one eligible provider. */
  providerId?: string;
  /** Recovery bypasses new-request routing and validation for an already submitted task. */
  recoveryProviderId?: string;
}

export function createConfiguredVideoProvider(
  input: AppConfig,
  workDir: string,
  routeRequest: VideoGenerationRouteRequest | undefined,
  runtimeOptions: VideoProviderRuntimeOptions = {},
): VideoProvider {
  const config = normalizeAppConfig(input);
  const recoveryProviderId = runtimeOptions.recoveryProviderId?.trim();
  const route = recoveryProviderId
    ? undefined
    : routeRequest
      ? runtimeOptions.providerId
        ? selectExactVideoGenerationRoute(config, routeRequest, runtimeOptions.providerId)
        : selectVideoGenerationRoute(config, routeRequest)
      : undefined;
  if (!recoveryProviderId && (!route || route.kind !== 'provider')) {
    throw new Error(`VIDEO_PROVIDER_NOT_CONFIGURED: ${route ? route.reason : '视频生成请求缺少 Provider 选路条件。'}`);
  }
  const provider = recoveryProviderId
    ? config.video.providers.find((candidate) => candidate.id === recoveryProviderId)
    : route?.kind === 'provider' ? route.provider : undefined;
  if (!provider) {
    throw new Error(`VIDEO_PROVIDER_NOT_CONFIGURED: 找不到原云端任务所属 Provider ${recoveryProviderId ?? runtimeOptions.providerId ?? ''}。`);
  }
  if (!provider.baseUrl || !provider.apiKey || !provider.model) {
    throw new Error('VIDEO_PROVIDER_NOT_CONFIGURED: 云端视频 API 的 Base URL、API Key 和模型不能为空。');
  }
  return {
    id: provider.id,
    name: provider.name,
    model: provider.model,
    capabilities: provider.capabilities,
    license: provider.license,
    estimateCost: (durationSec) => roundCurrency(provider.pricePerSecond * Math.max(0, durationSec)),
    generate: async (request) => {
      if (recoveryProviderId || !routeRequest) {
        throw new Error('VIDEO_PROVIDER_RECOVERY_ONLY: 已提交任务的恢复实例不能发起新的视频生成请求。');
      }
      assertVideoRequestMatchesRoute(routeRequest, request);
      return await generateVideo(provider, config, workDir, request, runtimeOptions.submitRetryCount);
    },
    resume: async (remoteTaskId, recovery) => {
      return await resumeVideo(provider, workDir, remoteTaskId, recovery);
    },
  };
}

function selectExactVideoGenerationRoute(
  config: AppConfig,
  request: VideoGenerationRouteRequest,
  providerId: string,
): ReturnType<typeof selectVideoGenerationRoute> {
  const provider = config.video.providers.find((candidate) => candidate.id === providerId);
  const allowed = provider?.enabled
    && config.video.automation.providerWhitelist.includes(provider.id)
    && request.requiredCapabilities.every((capability) => provider.capabilities.includes(capability))
    && request.durationSec <= provider.maxDurationSec
    && provider.pricePerSecond * request.durationSec <= request.remainingBudget;
  return provider && allowed
    ? { kind: 'provider', provider, estimatedCost: provider.pricePerSecond * request.durationSec }
    : { kind: 'unavailable', reason: `原云端任务所属 Provider ${providerId} 当前不可用、能力不匹配或超出预算。` };
}

export function requiredVideoCapabilities(
  request: Partial<VideoGenerationRequest>,
): VideoCapability[] {
  const firstFramePath = request.firstFramePath?.trim();
  const lastFramePath = request.lastFramePath?.trim();
  const referenceImagePaths = [
    ...(request.referenceImagePaths?.filter((path) => path.trim()) ?? []),
    ...(request.referenceImages?.map((reference) => reference.path).filter((path) => path.trim()) ?? []),
  ];
  const referenceVideoPaths = request.referenceVideoPaths?.filter((path) => path.trim()) ?? [];
  const referenceAudioPaths = request.referenceAudioPaths?.filter((path) => path.trim()) ?? [];
  if (lastFramePath && !firstFramePath) {
    throw new Error('VIDEO_PROVIDER_FIRST_FRAME_REQUIRED: 使用尾帧生成视频时必须同时提供首帧。');
  }
  const capabilities: VideoCapability[] = [];
  if (firstFramePath) capabilities.push('i2v');
  if (lastFramePath) capabilities.push('first-last-frame');
  if (referenceImagePaths.length > 0) capabilities.push('reference-image');
  if (referenceVideoPaths.length > 0) capabilities.push('reference-video');
  if (referenceAudioPaths.length > 0) capabilities.push('reference-audio');
  if (capabilities.length === 0) capabilities.push('t2v');
  return capabilities;
}

async function generateVideo(
  provider: VideoProviderConfig,
  config: AppConfig,
  workDir: string,
  request: VideoGenerationRequest,
  submitRetryCount?: number,
): Promise<VideoGenerationResult> {
  const prepared = prepareVideoGeneration(provider, config, request);
  const { prompt, durationSec, estimatedCost } = prepared;

  const customParams = parseRequestParams(provider.requestParamsJson);
  const references = request.referenceImages ?? (request.referenceImagePaths ?? []).map((path) => ({ path, kind: 'style' as const, description: '' }));
  const family = videoModelLimits(provider).family;
  const generatedBody: Record<string, unknown> = family !== 'generic'
    ? await multimodalVideoBody(provider, request, prompt, durationSec, references)
    : await legacyVideoBody(provider, request, prompt, durationSec, references);
  const body: Record<string, unknown> = { ...customParams, ...generatedBody };
  if (family === 'h3' && Buffer.byteLength(JSON.stringify(body), 'utf8') > 64 * 1024 * 1024) {
    throw new Error('VIDEO_PROVIDER_REFERENCE_INVALID: H3 请求体不能超过 64 MB，请减少参考素材大小或使用素材地址。');
  }

  const submitUrl = providerUrl(provider, provider.submitPath);
  const retryCount = submitRetryCount === undefined
    ? config.video.automation.retryCount
    : normalizedSubmitRetryCount(submitRetryCount);
  const submit = await requestJsonWithRetries(submitUrl, {
    method: 'POST',
    headers: providerHeaders(provider),
    body: JSON.stringify(body),
    signal: request.signal,
  }, provider, retryCount, '云端视频提交');
  const remoteTaskId = responseTaskId(submit);
  if (remoteTaskId) await request.onSubmitted?.(remoteTaskId);
  let finalResponse = submit;
  if (!responseVideoPayload(finalResponse) && remoteTaskId) {
    finalResponse = await pollVideoJob(provider, remoteTaskId, request.signal);
  }
  return await persistVideoResult(provider, workDir, finalResponse, estimatedCost, remoteTaskId, request.signal);
}

async function resumeVideo(
  provider: VideoProviderConfig,
  workDir: string,
  rawRemoteTaskId: string,
  recovery: VideoRecoveryRequest,
): Promise<VideoGenerationResult> {
  const remoteTaskId = rawRemoteTaskId.trim();
  if (!remoteTaskId) throw new Error('VIDEO_PROVIDER_TASK_ID_REQUIRED: 恢复云端视频任务需要有效的任务 ID。');
  const estimatedCost = normalizedRecoveryEstimatedCost(recovery.estimatedCost);
  const finalResponse = await pollVideoJob(provider, remoteTaskId, recovery.signal);
  return await persistVideoResult(provider, workDir, finalResponse, estimatedCost, remoteTaskId, recovery.signal);
}

function prepareVideoGeneration(
  provider: VideoProviderConfig,
  config: AppConfig,
  request: VideoGenerationRequest,
): { prompt: string; durationSec: number; estimatedCost: number } {
  const prompt = request.prompt.trim();
  if (!prompt) throw new Error('VIDEO_PROVIDER_PROMPT_REQUIRED: 视频生成提示词不能为空。');
  validateVideoGenerationRequest(provider, request);
  const durationSec = Math.max(1, request.durationSec);
  if (durationSec > provider.maxDurationSec) {
    throw new Error(`VIDEO_PROVIDER_DURATION_UNSUPPORTED: ${provider.name} 最长支持 ${provider.maxDurationSec} 秒。`);
  }
  const requiredCapabilities = requiredVideoCapabilities(request);
  const missingCapabilities = requiredCapabilities.filter((capability) => !provider.capabilities.includes(capability));
  if (missingCapabilities.length > 0) {
    throw new Error(`VIDEO_PROVIDER_CAPABILITY_MISSING: ${provider.name} 缺少视频生成能力：${missingCapabilities.join('、')}。`);
  }
  const estimatedCost = roundCurrency(provider.pricePerSecond * durationSec);
  if (estimatedCost > config.video.automation.budgetLimit) {
    throw new Error(`VIDEO_PROVIDER_BUDGET_EXCEEDED: 预计费用 ${estimatedCost.toFixed(2)}，超过预算上限 ${config.video.automation.budgetLimit.toFixed(2)}。`);
  }
  return { prompt, durationSec, estimatedCost };
}

async function persistVideoResult(
  provider: VideoProviderConfig,
  workDir: string,
  finalResponse: unknown,
  estimatedCost: number,
  remoteTaskId: string | undefined,
  signal?: AbortSignal,
): Promise<VideoGenerationResult> {
  const payload = responseVideoPayload(finalResponse);
  if (!payload) throw new Error('VIDEO_PROVIDER_INVALID_OUTPUT: 云端视频 API 没有返回视频 URL 或 base64 视频。');

  const outputDir = join(workDir, 'generated-videos');
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, `${Date.now()}-${randomUUID()}.mp4`);
  const temporaryPath = `${outputPath}.tmp`;
  try {
    const bytes = payload.base64
      ? decodeVideoBase64(payload.base64)
      : await downloadVideo(payload.url!, provider, signal);
    if (!bytes.length || bytes.length > MAX_VIDEO_BYTES) {
      throw new Error('VIDEO_PROVIDER_INVALID_OUTPUT: 返回的视频为空或超过 512 MB。');
    }
    await writeFile(temporaryPath, bytes, { flag: 'wx' });
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }

  return {
    path: outputPath,
    providerId: provider.id,
    providerName: provider.name,
    model: provider.model,
    ...(remoteTaskId ? { remoteTaskId } : {}),
    estimatedCost,
    license: provider.license,
  };
}

/** Shared preflight runs before copying local files or sending a billable request. */
export function validateVideoGenerationRequest(provider: VideoProviderConfig, request: VideoGenerationRequest): void {
  const limits = videoModelLimits(provider);
  if (!Number.isFinite(request.durationSec) || request.durationSec < limits.minDuration || request.durationSec > limits.maxDuration
    || (limits.family !== 'generic' && !Number.isInteger(request.durationSec))) {
    throw new Error(`VIDEO_PROVIDER_DURATION_UNSUPPORTED: 当前模型支持 ${limits.minDuration}–${limits.maxDuration} 秒${limits.family !== 'generic' ? '的整数时长' : ''}。`);
  }
  if (!(VIDEO_LAB_RATIOS as readonly string[]).includes(request.ratio)) {
    throw new Error('VIDEO_PROVIDER_RATIO_UNSUPPORTED: 请选择有效的画面比例。');
  }
  if (request.resolution && limits.family !== 'generic' && !limits.resolutions.includes(request.resolution.toUpperCase())) {
    throw new Error(`VIDEO_PROVIDER_RESOLUTION_UNSUPPORTED: 当前模型支持 ${limits.resolutions.join('、')}。`);
  }
  const references = request.referenceImages ?? (request.referenceImagePaths ?? []).map((path) => ({ path, kind: 'style' as const, description: '' }));
  const videos = request.referenceVideoPaths ?? [];
  const audio = request.referenceAudioPaths ?? [];
  if (references.length > limits.images || videos.length > limits.videos || audio.length > limits.audio) {
    throw new Error(`VIDEO_PROVIDER_REFERENCE_LIMIT: 当前模型最多支持 ${limits.images} 张参考图、${limits.videos} 段参考视频、${limits.audio} 段参考音频。`);
  }
  const count = references.length + videos.length + audio.length;
  if (limits.family === 'h3' && count > 12) throw new Error('VIDEO_PROVIDER_REFERENCE_LIMIT: H3 的图片、视频和音频参考合计不能超过 12 份。');
  if ((request.firstFramePath || request.lastFramePath) && count) {
    throw new Error('VIDEO_PROVIDER_REFERENCE_MODE_CONFLICT: 严格首尾帧不能与多模态参考混用；请将画面改为开场或结尾参考图。');
  }
  if (limits.family === 'h3' && request.ratio === 'adaptive' && !request.firstFramePath && !request.lastFramePath && !count) {
    throw new Error('VIDEO_PROVIDER_RATIO_UNSUPPORTED: H3 纯文本生成需要选择具体画面比例。');
  }
  if (limits.preset === 'seedance-2.0' && audio.length && !references.length && !videos.length) {
    throw new Error('VIDEO_PROVIDER_REFERENCE_INVALID: Seedance 2.0 不能只使用参考音频，请添加参考图或参考视频。');
  }
  for (const path of [request.firstFramePath, request.lastFramePath, ...references.map((reference) => reference.path), ...videos, ...audio]) {
    if (!path) continue;
    if (/^(?:https?|asset|mm_file):/iu.test(path) && !isRemoteVideoReference(path)) {
      throw new Error('VIDEO_PROVIDER_REFERENCE_INVALID: 素材地址必须使用有效的 HTTPS、asset:// 或 mm_file:// 地址。');
    }
    if ((limits.family === 'h3' && path.startsWith('asset://')) || (limits.family === 'seedance' && path.startsWith('mm_file://'))) {
      throw new Error(`VIDEO_PROVIDER_REFERENCE_INVALID: 当前模型不支持 ${path.split('://')[0]} 素材地址。`);
    }
  }
  if (limits.family === 'seedance' && videos.some((path) => !isRemoteVideoReference(path))) {
    throw new Error('VIDEO_PROVIDER_REFERENCE_INVALID: Seedance 参考视频需要 HTTPS 视频地址或 asset:// 素材地址，不支持直接提交本地视频。');
  }
  if (limits.family === 'h3' && guidedReferencePrompt(request.prompt.trim(), references, request, provider).length > 7000) {
    throw new Error('VIDEO_PROVIDER_PROMPT_TOO_LONG: H3 提示词和参考素材说明合计不能超过 7000 个字符。');
  }
}

function assertVideoRequestMatchesRoute(
  routeRequest: VideoGenerationRouteRequest,
  request: VideoGenerationRequest,
): void {
  const routedDurationSec = normalizedDurationSec(routeRequest.durationSec);
  const requestDurationSec = normalizedDurationSec(request.durationSec);
  const routedCapabilities = new Set(routeRequest.requiredCapabilities);
  const requestCapabilities = requiredVideoCapabilities(request);
  if (routedDurationSec !== requestDurationSec
    || routedCapabilities.size !== requestCapabilities.length
    || requestCapabilities.some((capability) => !routedCapabilities.has(capability))) {
    throw new Error('VIDEO_PROVIDER_ROUTE_MISMATCH: 视频生成请求的时长或能力与 Provider 选路条件不一致。');
  }
}

function normalizedDurationSec(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('VIDEO_PROVIDER_DURATION_INVALID: 视频时长必须是大于 0 的有限数字。');
  }
  return Math.max(1, value);
}

function normalizedSubmitRetryCount(value: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0 || value > 10) {
    throw new Error('VIDEO_PROVIDER_RETRY_INVALID: 视频提交重试次数必须是 0 到 10 之间的整数。');
  }
  return value;
}

function normalizedRecoveryEstimatedCost(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('VIDEO_PROVIDER_RECOVERY_COST_INVALID: 恢复云端视频任务需要有效的原始预计费用。');
  }
  return value;
}

async function pollVideoJob(provider: VideoProviderConfig, taskId: string, signal?: AbortSignal): Promise<unknown> {
  const startedAt = Date.now();
  const statusUrl = providerUrl(provider, provider.statusPathTemplate.replaceAll('{id}', encodeURIComponent(taskId)));
  while (Date.now() - startedAt < provider.timeoutMs) {
    if (signal?.aborted) throw signal.reason ?? new Error('Video generation aborted.');
    const response = await requestJsonWithRetries(statusUrl, {
      method: 'GET',
      headers: providerHeaders(provider),
      signal,
    }, provider, 1, '云端视频轮询');
    const status = responseStatus(response);
    if (responseVideoPayload(response) || ['succeeded', 'success', 'completed', 'done', 'finished'].includes(status)) return response;
    if (['failed', 'error', 'cancelled', 'canceled', 'rejected', 'expired'].includes(status)) {
      throw new Error(`VIDEO_PROVIDER_JOB_FAILED: ${responseError(response) || `任务 ${taskId} 失败。`}`);
    }
    await abortableDelay(provider.pollIntervalMs, signal);
  }
  throw new Error(`VIDEO_PROVIDER_TIMEOUT: 云端视频任务在 ${provider.timeoutMs}ms 内未完成。`);
}

async function requestJsonWithRetries(
  url: string,
  init: RequestInit,
  provider: VideoProviderConfig,
  retryCount: number,
  label: string,
): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, {
        ...init,
        timeoutMs: provider.timeoutMs,
        timeoutLabel: label,
        maxBytes: 4 * 1024 * 1024,
      });
      const text = await response.text();
      const parsed = text ? JSON.parse(text) as unknown : {};
      if (!response.ok) {
        const detail = responseError(parsed) || `${response.status} ${response.statusText}`;
        const error = new Error(`VIDEO_PROVIDER_HTTP_ERROR: ${detail}`);
        if (response.status !== 429 && response.status < 500) throw error;
        lastError = error;
      } else {
        return parsed;
      }
    } catch (error) {
      lastError = error;
      if (attempt >= retryCount || init.signal?.aborted) throw error;
    }
    await abortableDelay(Math.min(provider.pollIntervalMs * (attempt + 1), 5000), init.signal ?? undefined);
  }
  throw lastError instanceof Error ? lastError : new Error(`${label}失败。`);
}

async function downloadVideo(url: string, provider: VideoProviderConfig, signal?: AbortSignal): Promise<Buffer> {
  const response = await fetchWithTimeout(url, {
    method: 'GET',
    signal,
    timeoutMs: provider.timeoutMs,
    timeoutLabel: '云端视频下载',
    maxBytes: MAX_VIDEO_BYTES,
    purpose: 'provider-api',
  });
  if (!response.ok) throw new Error(`VIDEO_PROVIDER_DOWNLOAD_FAILED: ${response.status} ${response.statusText}`);
  return Buffer.from(await response.arrayBuffer());
}

function providerHeaders(provider: VideoProviderConfig): Record<string, string> {
  return {
    authorization: `Bearer ${provider.apiKey}`,
    'content-type': 'application/json',
  };
}

function providerUrl(provider: VideoProviderConfig, path: string): string {
  const baseUrl = provider.baseUrl.replace(/\/+$/u, '');
  return `${baseUrl}/${path.replace(/^\/+/, '')}`;
}

function parseRequestParams(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function responseTaskId(value: unknown): string {
  const records = responseRecords(value);
  for (const record of records) {
    for (const key of ['task_id', 'taskId', 'id', 'request_id']) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
  }
  return '';
}

function responseStatus(value: unknown): string {
  for (const record of responseRecords(value)) {
    for (const key of ['status', 'state', 'task_status']) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().toLowerCase();
    }
  }
  return '';
}

function responseError(value: unknown): string {
  for (const record of responseRecords(value)) {
    for (const key of ['error', 'message', 'detail', 'reason']) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().slice(0, 600);
      if (candidate && typeof candidate === 'object') {
        const message = (candidate as Record<string, unknown>).message;
        if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 600);
      }
    }
  }
  return '';
}

function responseVideoPayload(value: unknown): { url?: string; base64?: string } | null {
  for (const record of responseRecords(value)) {
    for (const key of ['url', 'video_url', 'download_url']) {
      const candidate = record[key];
      if (typeof candidate === 'string' && /^https?:\/\//iu.test(candidate)) return { url: candidate };
    }
    for (const key of ['b64_json', 'base64', 'video_base64']) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.trim()) return { base64: candidate.trim() };
    }
  }
  return null;
}

function responseRecords(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 4 || !value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((item) => responseRecords(item, depth + 1));
  const record = value as Record<string, unknown>;
  const nested = ['data', 'output', 'result', 'video', 'task', 'content']
    .flatMap((key) => responseRecords(record[key], depth + 1));
  return [record, ...nested];
}

async function imageDataUrl(path: string): Promise<string> {
  if (isRemoteVideoReference(path)) return path;
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error('VIDEO_PROVIDER_REFERENCE_INVALID: 参考图必须是 24 MB 以内的普通图片。');
  }
  const mime = imageMimeType(extname(path));
  const bytes = await readFile(path);
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

async function legacyVideoBody(
  provider: VideoProviderConfig,
  request: VideoGenerationRequest,
  prompt: string,
  durationSec: number,
  references: VideoReferenceImage[],
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    model: provider.model, prompt: guidedReferencePrompt(prompt, references, request, provider), duration: durationSec,
    aspect_ratio: request.ratio, resolution: request.resolution || provider.maxResolution,
  };
  if (request.generateAudio !== undefined) body.generate_audio = request.generateAudio;
  const firstFramePath = request.firstFramePath?.trim();
  if (firstFramePath) {
    const image = await imageDataUrl(firstFramePath);
    body.image = image;
    body.first_frame_image = image;
  }
  const lastFramePath = request.lastFramePath?.trim();
  if (lastFramePath) body.last_frame_image = await imageDataUrl(lastFramePath);
  if (references.length) body.reference_images = await Promise.all(references.map((reference) => imageDataUrl(reference.path)));
  if (request.referenceVideoPaths?.length) body.reference_videos = await Promise.all(request.referenceVideoPaths.map((path) => mediaDataUrl(path, 'video')));
  if (request.referenceAudioPaths?.length) body.reference_audios = await Promise.all(request.referenceAudioPaths.map((path) => mediaDataUrl(path, 'audio')));
  return body;
}

async function multimodalVideoBody(
  provider: VideoProviderConfig,
  request: VideoGenerationRequest,
  prompt: string,
  durationSec: number,
  references: VideoReferenceImage[],
): Promise<Record<string, unknown>> {
  const limits = videoModelLimits(provider);
  const content: Record<string, unknown>[] = [{ type: 'text', text: guidedReferencePrompt(prompt, references, request, provider) }];
  if (request.firstFramePath) content.push({ type: 'image_url', image_url: { url: await imageDataUrl(request.firstFramePath) }, role: 'first_frame' });
  if (request.lastFramePath) content.push({ type: 'image_url', image_url: { url: await imageDataUrl(request.lastFramePath) }, role: 'last_frame' });
  for (const reference of references) {
    content.push({ type: 'image_url', image_url: { url: await imageDataUrl(reference.path) }, role: 'reference_image' });
  }
  for (const path of request.referenceVideoPaths ?? []) {
    content.push({ type: 'video_url', video_url: { url: await mediaDataUrl(path, 'video') }, role: 'reference_video' });
  }
  for (const path of request.referenceAudioPaths ?? []) {
    content.push({ type: 'audio_url', audio_url: { url: await mediaDataUrl(path, 'audio') }, role: 'reference_audio' });
  }
  const isSeedance = limits.family === 'seedance';
  const configuredResolution = provider.maxResolution.toUpperCase();
  const resolution = request.resolution?.toUpperCase() || (limits.resolutions.includes(configuredResolution) ? configuredResolution : limits.resolutions[0]);
  const framesRequireAdaptive = limits.family === 'h3' || limits.preset === 'seedance-2.5';
  return {
    model: provider.model,
    content,
    duration: durationSec,
    ratio: framesRequireAdaptive && (request.firstFramePath || request.lastFramePath) ? 'adaptive' : request.ratio,
    resolution: isSeedance ? resolution.toLowerCase() : resolution,
    ...(isSeedance && request.generateAudio !== undefined ? { generate_audio: request.generateAudio } : {}),
  };
}

function guidedReferencePrompt(prompt: string, references: VideoReferenceImage[], request: VideoGenerationRequest, provider: VideoProviderConfig): string {
  const kinds: Record<VideoReferenceImage['kind'], string> = {
    character: '人物', scene: '场景', object: '物体', style: '风格', opening: '开场画面', transition: '中段画面', ending: '结尾画面',
  };
  const token = (type: 'Image' | 'Video' | 'Audio', index: number) => videoReferenceToken(provider, type, index);
  const guidance = references.map((reference, index) => `${token('Image', index)} 用于${kinds[reference.kind]}${reference.description ? `：${reference.description}` : ''}。`);
  (request.referenceVideoPaths ?? []).forEach((_path, index) => guidance.push(`${token('Video', index)} 的动作、运镜或节奏，以正文描述为准。`));
  (request.referenceAudioPaths ?? []).forEach((_path, index) => guidance.push(`${token('Audio', index)} 的声音、节奏或氛围，以正文描述为准。`));
  return guidance.length ? `${prompt}\n\n参考素材关系：\n${guidance.join('\n')}` : prompt;
}

async function mediaDataUrl(path: string, kind: 'video' | 'audio'): Promise<string> {
  if (isRemoteVideoReference(path)) return path;
  const metadata = await stat(path);
  const maxMegabytes = kind === 'audio' ? 15 : 50;
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maxMegabytes * 1024 * 1024) {
    throw new Error(`VIDEO_PROVIDER_REFERENCE_INVALID: 参考${kind === 'audio' ? '音频' : '视频'}文件无效或超过 ${maxMegabytes} MB。`);
  }
  const extension = extname(path).toLowerCase();
  const mime = extension === '.mp4' ? 'video/mp4' : extension === '.mov' ? 'video/quicktime'
    : extension === '.wav' ? 'audio/wav' : extension === '.mp3' ? 'audio/mpeg' : '';
  if (!mime) throw new Error('VIDEO_PROVIDER_REFERENCE_INVALID: 参考媒体仅支持 MP4、MOV、WAV 或 MP3。');
  return `data:${mime};base64,${(await readFile(path)).toString('base64')}`;
}

function imageMimeType(extension: string): string {
  if (/^\.jpe?g$/iu.test(extension)) return 'image/jpeg';
  if (/^\.webp$/iu.test(extension)) return 'image/webp';
  if (/^\.gif$/iu.test(extension)) return 'image/gif';
  return 'image/png';
}

function decodeVideoBase64(value: string): Buffer {
  const payload = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value;
  return Buffer.from(payload, 'base64');
}

function roundCurrency(value: number): number {
  return Math.round(value * 10000) / 10000;
}

async function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw signal.reason ?? new Error('Video generation aborted.');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('Video generation aborted.'));
    }, { once: true });
  });
}
