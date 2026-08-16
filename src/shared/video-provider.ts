import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fetchWithTimeout } from './http';
import { normalizeAppConfig } from './config-utils';
import type { AppConfig, VideoCapability, VideoGenerationFallback, VideoProviderConfig } from './types';

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

export type VideoGenerationRoute =
  | { kind: 'provider'; provider: VideoProviderConfig; estimatedCost: number }
  | { kind: 'fallback'; fallback: Exclude<VideoGenerationFallback, 'disabled'>; reason: string }
  | { kind: 'unavailable'; reason: string };

export function selectVideoGenerationRoute(
  input: AppConfig,
  request: { durationSec: number; requiredCapabilities: VideoCapability[]; remainingBudget?: number },
): VideoGenerationRoute {
  const config = normalizeAppConfig(input);
  const whitelist = new Set(config.video.automation.providerWhitelist);
  const candidates = config.video.providers
    .filter((provider) => provider.enabled && whitelist.has(provider.id))
    .filter((provider) => request.requiredCapabilities.every((capability) => provider.capabilities.includes(capability)))
    .filter((provider) => request.durationSec <= provider.maxDurationSec)
    .sort((left, right) => {
      if (left.id === config.video.activeProviderId) return -1;
      if (right.id === config.video.activeProviderId) return 1;
      return left.pricePerSecond - right.pricePerSecond;
    });
  const budget = request.remainingBudget ?? config.video.automation.budgetLimit;
  const selected = candidates.find((provider) => provider.pricePerSecond * request.durationSec <= budget);
  if (selected) {
    return { kind: 'provider', provider: selected, estimatedCost: selected.pricePerSecond * request.durationSec };
  }
  const reason = candidates.length ? '本次生成会超过剩余预算。' : '没有满足能力、时长和白名单要求的云端视频 Provider。';
  if (config.video.automation.fallback !== 'disabled') {
    return { kind: 'fallback', fallback: config.video.automation.fallback, reason };
  }
  return { kind: 'unavailable', reason };
}

export function createConfiguredVideoProvider(input: AppConfig, workDir: string): VideoProvider {
  const config = normalizeAppConfig(input);
  const route = selectVideoGenerationRoute(config, { durationSec: 1, requiredCapabilities: ['t2v'], remainingBudget: Number.POSITIVE_INFINITY });
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
    generate: (request) => generateVideo(provider, config, workDir, request),
  };
}

async function generateVideo(
  provider: VideoProviderConfig,
  config: AppConfig,
  workDir: string,
  request: VideoGenerationRequest,
): Promise<VideoGenerationResult> {
  const prompt = request.prompt.trim();
  if (!prompt) throw new Error('VIDEO_PROVIDER_PROMPT_REQUIRED: 视频生成提示词不能为空。');
  const durationSec = Math.max(1, request.durationSec);
  if (durationSec > provider.maxDurationSec) {
    throw new Error(`VIDEO_PROVIDER_DURATION_UNSUPPORTED: ${provider.name} 最长支持 ${provider.maxDurationSec} 秒。`);
  }
  const usesImage = Boolean(request.firstFramePath || request.lastFramePath || request.referenceImagePaths?.length);
  if (usesImage && !provider.capabilities.includes('i2v') && !provider.capabilities.includes('reference-image')) {
    throw new Error(`VIDEO_PROVIDER_CAPABILITY_MISSING: ${provider.name} 未声明图生视频或参考图能力。`);
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
  if (request.firstFramePath) {
    const image = await imageDataUrl(request.firstFramePath);
    body.image = image;
    body.first_frame_image = image;
  }
  if (request.lastFramePath) body.last_frame_image = await imageDataUrl(request.lastFramePath);
  if (request.referenceImagePaths?.length) {
    body.reference_images = await Promise.all(request.referenceImagePaths.slice(0, 8).map(imageDataUrl));
  }

  const submitUrl = providerUrl(provider, provider.submitPath);
  const submit = await requestJsonWithRetries(submitUrl, {
    method: 'POST',
    headers: providerHeaders(provider),
    body: JSON.stringify(body),
    signal: request.signal,
  }, provider, config.video.automation.retryCount, '云端视频提交');
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
