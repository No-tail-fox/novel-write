import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fetchWithTimeout } from './http';
import { normalizeAppConfig } from './config-utils';
import type { AppConfig, VideoCapability, VideoProviderConfig } from './types';
import { selectVideoGenerationRoute, type VideoGenerationRouteRequest } from './video-routing';

export { selectVideoGenerationRoute } from './video-routing';
export type { VideoGenerationRoute, VideoGenerationRouteRequest } from './video-routing';

const MAX_VIDEO_BYTES = 512 * 1024 * 1024;
const MAX_REFERENCE_IMAGE_BYTES = 24 * 1024 * 1024;

export interface VideoGenerationRequest {
  prompt: string;
  durationSec: number;
  ratio: string;
  resolution?: string;
  firstFramePath?: string;
  lastFramePath?: string;
  referenceImagePaths?: string[];
  signal?: AbortSignal;
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

export interface VideoProvider {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly capabilities: readonly VideoCapability[];
  readonly license: string;
  estimateCost(durationSec: number): number;
  generate(input: VideoGenerationRequest): Promise<VideoGenerationResult>;
}

export interface VideoProviderRuntimeOptions {
  /** POST retries can create duplicate billable jobs; explicit paid actions set this to zero. */
  submitRetryCount?: number;
}

export function createConfiguredVideoProvider(
  input: AppConfig,
  workDir: string,
  routeRequest: VideoGenerationRouteRequest,
  runtimeOptions: VideoProviderRuntimeOptions = {},
): VideoProvider {
  const config = normalizeAppConfig(input);
  const route = selectVideoGenerationRoute(config, routeRequest);
  if (route.kind !== 'provider') {
    throw new Error(`VIDEO_PROVIDER_NOT_CONFIGURED: ${route.reason}`);
  }
  const provider = route.provider;
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
      assertVideoRequestMatchesRoute(routeRequest, request);
      return await generateVideo(provider, config, workDir, request, runtimeOptions.submitRetryCount);
    },
  };
}

export function requiredVideoCapabilities(
  request: Partial<VideoGenerationRequest>,
): VideoCapability[] {
  const firstFramePath = request.firstFramePath?.trim();
  const lastFramePath = request.lastFramePath?.trim();
  const referenceImagePaths = request.referenceImagePaths?.filter((path) => path.trim()) ?? [];
  if (lastFramePath && !firstFramePath) {
    throw new Error('VIDEO_PROVIDER_FIRST_FRAME_REQUIRED: 使用尾帧生成视频时必须同时提供首帧。');
  }
  const capabilities: VideoCapability[] = [];
  if (firstFramePath) capabilities.push('i2v');
  if (lastFramePath) capabilities.push('first-last-frame');
  if (referenceImagePaths.length > 0) capabilities.push('reference-image');
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
  const prompt = request.prompt.trim();
  if (!prompt) throw new Error('VIDEO_PROVIDER_PROMPT_REQUIRED: 视频生成提示词不能为空。');
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

  const customParams = parseRequestParams(provider.requestParamsJson);
  const body: Record<string, unknown> = {
    ...customParams,
    model: provider.model,
    prompt,
    duration: durationSec,
    aspect_ratio: request.ratio,
    resolution: request.resolution || provider.maxResolution,
  };
  const firstFramePath = request.firstFramePath?.trim();
  const lastFramePath = request.lastFramePath?.trim();
  const referenceImagePaths = request.referenceImagePaths?.map((path) => path.trim()).filter(Boolean) ?? [];
  if (firstFramePath) {
    const image = await imageDataUrl(firstFramePath);
    body.image = image;
    body.first_frame_image = image;
  }
  if (lastFramePath) body.last_frame_image = await imageDataUrl(lastFramePath);
  if (referenceImagePaths.length > 0) {
    body.reference_images = await Promise.all(referenceImagePaths.slice(0, 8).map(imageDataUrl));
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
  let finalResponse = submit;
  if (!responseVideoPayload(finalResponse) && remoteTaskId) {
    finalResponse = await pollVideoJob(provider, remoteTaskId, request.signal);
  }
  const payload = responseVideoPayload(finalResponse);
  if (!payload) {
    throw new Error('VIDEO_PROVIDER_INVALID_OUTPUT: 云端视频 API 没有返回任务 ID、视频 URL 或 base64 视频。');
  }

  const outputDir = join(workDir, 'generated-videos');
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, `${Date.now()}-${randomUUID()}.mp4`);
  const temporaryPath = `${outputPath}.tmp`;
  try {
    const bytes = payload.base64
      ? decodeVideoBase64(payload.base64)
      : await downloadVideo(payload.url!, provider, request.signal);
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
    if (['failed', 'error', 'cancelled', 'canceled', 'rejected'].includes(status)) {
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
  const nested = ['data', 'output', 'result', 'video', 'task']
    .flatMap((key) => responseRecords(record[key], depth + 1));
  return [record, ...nested];
}

async function imageDataUrl(path: string): Promise<string> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error('VIDEO_PROVIDER_REFERENCE_INVALID: 参考图必须是 24 MB 以内的普通图片。');
  }
  const mime = imageMimeType(extname(path));
  const bytes = await readFile(path);
  return `data:${mime};base64,${bytes.toString('base64')}`;
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
