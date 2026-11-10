/**
 * Resumable, verifiable GET downloads for already-generated remote results (backlog C-2 offline part).
 *
 * - Bytes stream into `<target>.part`; a sidecar `<target>.part.json` keeps only a hash of the URL's
 *   origin+path (never the query, which often carries signatures/tokens) plus the HTTP validators.
 * - A resume sends `Range: bytes=N-` with `If-Range` (strong ETag, else Last-Modified). Only a 206 whose
 *   Content-Range starts at N and whose validators still match is appended; 200 restarts from zero;
 *   412/416, a changed validator or a mismatched Content-Range discards the partial file and restarts.
 * - The final file is checked for length, media magic bytes (MP4/MOV/WebM) and an optional SHA-256, then
 *   atomically renamed onto the target. Aborting leaves a resumable `.part`.
 * - Retries are bounded and only for connect/not-sent errors and mid-body resets. This module only issues
 *   GETs of results that already exist; it never re-submits a paid generation.
 */
import { createHash } from 'node:crypto';
import { closeSync, createReadStream, ftruncateSync, openSync, writeFileSync, writeSync } from 'node:fs';
import { open, readFile, rename, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fetchWithTimeout } from '../src/shared/http';
import type { NetworkFetch } from '../src/shared/network-policy';

export type VideoContainer = 'mp4' | 'mov' | 'webm';

export interface ResumableDownloadOptions {
  url: string;
  targetPath: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  timeoutLabel?: string;
  /** Hard cap for the complete file. Defaults to 512 MiB. */
  maxBytes?: number;
  /** Optional lower-case hex SHA-256 of the complete file. */
  expectedSha256?: string;
  /** Optional expected complete length (bytes). */
  expectedLength?: number;
  /** Magic-byte verification. Defaults to 'video'. */
  verify?: 'video' | 'none';
  /** Attempts for retryable transport failures (connect / mid-body reset). Defaults to 3. */
  maxAttempts?: number;
  /** Restarts from zero after validator or range mismatch. Defaults to 2. */
  maxRestarts?: number;
  retryDelayMs?: number;
  allowPrivateNetwork?: boolean;
  fetchImpl?: NetworkFetch;
  /** G-5: optional HTTP(S) forward proxy for every attempt; absent/empty = direct. */
  proxyUrl?: string;
}

export interface ResumableDownloadResult {
  path: string;
  bytes: number;
  sha256: string;
  container?: VideoContainer;
  /** Byte offset the first request resumed from (0 = fresh). */
  resumedFrom: number;
  attempts: number;
  restarts: number;
}

interface PartSidecar {
  version: 1;
  urlKey: string;
  etag?: string;
  lastModified?: string;
  expectedLength?: number;
  updatedAt: string;
}

const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;
const RETRYABLE_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'EPIPE', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_CLOSED', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'NETWORK_TIMEOUT',
  'RESUMABLE_TRANSFER_TRUNCATED',
]);
const activeParts = new Set<string>();
/** Part keys a cleanup sweep is deleting right now (see claimResumablePartForCleanup). */
const cleanupClaims = new Map<string, Promise<void>>();

class TransferRestart extends Error {
  readonly code = 'RESUMABLE_TRANSFER_RESTART';
}

class TransferFatal extends Error {
  constructor(readonly code: string, message: string) { super(`${code}: ${message}`); }
}

export function resumablePartPaths(targetPath: string): { part: string; sidecar: string } {
  return { part: `${targetPath}.part`, sidecar: `${targetPath}.part.json` };
}

/** True while this process is writing `partPath` (cleanup sweeps must leave it alone). */
export function isResumablePartActive(partPath: string): boolean {
  return activeParts.has(partKey(partPath));
}

function partKey(partPath: string): string {
  const absolute = resolve(partPath);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

/**
 * Synchronously reserves `partPath` (and its side record) for deletion by a cleanup sweep.
 * Returns `null` when a download owns the part or another cleanup already holds it. While the claim is
 * held, a download of the same target waits before it reads or opens any file, so a sweep can never
 * unlink bytes between a download's resume check and its write. Always call the returned release.
 */
export function claimResumablePartForCleanup(partPath: string): (() => void) | null {
  const key = partKey(partPath);
  if (activeParts.has(key) || cleanupClaims.has(key)) return null;
  let release!: () => void;
  const claim = new Promise<void>((resolveClaim) => { release = resolveClaim; });
  cleanupClaims.set(key, claim);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (cleanupClaims.get(key) === claim) cleanupClaims.delete(key);
    release();
  };
}

/**
 * Failures after which the partial bytes can never be resumed: the remote result is gone (400/404/410)
 * or the payload itself was rejected (fatal size/format/hash errors). Auth (401/403, e.g. an expired
 * signed URL), 408/429 and 5xx keep the part: a later recovery polls a fresh URL for the same object.
 */
function isPermanentTransferFailure(error: unknown): boolean {
  if (error instanceof TransferFatal) return error.code !== 'RESUMABLE_TRANSFER_BUSY';
  const status = Number(errorText(error).match(/^(\d{3})\b/u)?.[1]);
  return status === 400 || status === 404 || status === 410;
}

/** Hash of origin + path only; query strings (signatures, tokens) never reach disk. */
export function transferUrlKey(url: string): string {
  const parsed = new URL(url);
  return createHash('sha256').update(`${parsed.protocol}//${parsed.host.toLowerCase()}${parsed.pathname}`).digest('hex');
}

export function detectVideoContainer(head: Uint8Array): VideoContainer | null {
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'webm';
  if (head.length < 8) return null;
  const ascii = (start: number, end: number) => String.fromCharCode(...head.subarray(start, end));
  const box = ascii(4, 8);
  if (box === 'ftyp') return head.length >= 12 && ascii(8, 12) === 'qt  ' ? 'mov' : 'mp4';
  if (['moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(box)) return 'mov';
  return null;
}

export async function resumableDownload(options: ResumableDownloadOptions): Promise<ResumableDownloadResult> {
  const { part, sidecar } = resumablePartPaths(options.targetPath);
  const key = partKey(part);
  // Marked active synchronously (no await before this point): a sweep that has not claimed the part yet
  // will now skip it; one that already claimed it is awaited below before any file is touched.
  if (activeParts.has(key)) throw new TransferFatal('RESUMABLE_TRANSFER_BUSY', '同一结果正在下载，请稍后再试。');
  activeParts.add(key);
  try {
    const cleanup = cleanupClaims.get(key);
    if (cleanup) await cleanup;
    return await runDownload(options, part, sidecar);
  } finally {
    activeParts.delete(key);
  }
}

async function runDownload(options: ResumableDownloadOptions, part: string, sidecarPath: string): Promise<ResumableDownloadResult> {
  const urlKey = transferUrlKey(options.url);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const maxRestarts = Math.max(0, options.maxRestarts ?? 2);
  let attempts = 0;
  let restarts = 0;
  let resumedFrom: number | undefined;
  let lastError: unknown;

  while (attempts < maxAttempts) {
    if (options.signal?.aborted) throw abortError(options.signal);
    attempts += 1;
    const state = await loadResumeState(part, sidecarPath, urlKey);
    resumedFrom ??= state.offset;
    try {
      await transferOnce(options, part, sidecarPath, urlKey, state, maxBytes);
      const verified = await verifyPart(options, part, sidecarPath, maxBytes);
      await rename(part, options.targetPath);
      await rm(sidecarPath, { force: true }).catch(() => undefined);
      return { path: options.targetPath, ...verified, resumedFrom, attempts, restarts };
    } catch (error) {
      if (options.signal?.aborted) throw abortError(options.signal, error);
      if (error instanceof TransferRestart) {
        await discardPart(part, sidecarPath);
        restarts += 1;
        attempts -= 1;
        if (restarts > maxRestarts) {
          throw new TransferFatal('RESUMABLE_TRANSFER_UNSTABLE', `远端结果在下载过程中多次变化：${error.message}`);
        }
        continue;
      }
      if (error instanceof TransferFatal) {
        await discardPart(part, sidecarPath);
        throw error;
      }
      if (!isRetryableTransferError(error)) {
        if (isPermanentTransferFailure(error)) await discardPart(part, sidecarPath);
        // Same message shape as the previous non-resumable downloader (no `status` property on purpose).
        throw new Error(`VIDEO_PROVIDER_DOWNLOAD_FAILED: ${errorText(error)}`, { cause: error });
      }
      lastError = error;
      if (attempts < maxAttempts) await abortableDelay((options.retryDelayMs ?? 400) * attempts, options.signal);
    }
  }
  throw new Error(`VIDEO_PROVIDER_DOWNLOAD_FAILED: 下载多次中断，已保留断点，可稍后继续。${lastError ? `（${errorText(lastError)}）` : ''}`, { cause: lastError });
}

interface ResumeState { offset: number; sidecar?: PartSidecar }

async function loadResumeState(part: string, sidecarPath: string, urlKey: string): Promise<ResumeState> {
  const info = await stat(part).catch(() => null);
  if (!info?.isFile() || info.size <= 0) {
    await discardPart(part, sidecarPath);
    return { offset: 0 };
  }
  const sidecar = parseSidecar(await readFile(sidecarPath, 'utf8').catch(() => ''));
  const validator = sidecar?.etag ?? sidecar?.lastModified;
  if (!sidecar || sidecar.urlKey !== urlKey || !validator
    || (sidecar.expectedLength !== undefined && info.size > sidecar.expectedLength)) {
    await discardPart(part, sidecarPath);
    return { offset: 0 };
  }
  return { offset: info.size, sidecar };
}

function parseSidecar(text: string): PartSidecar | undefined {
  try {
    const value = JSON.parse(text) as Partial<PartSidecar>;
    if (value?.version !== 1 || typeof value.urlKey !== 'string' || !/^[0-9a-f]{64}$/u.test(value.urlKey)) return undefined;
    return {
      version: 1,
      urlKey: value.urlKey,
      ...(typeof value.etag === 'string' && value.etag ? { etag: value.etag } : {}),
      ...(typeof value.lastModified === 'string' && value.lastModified ? { lastModified: value.lastModified } : {}),
      ...(Number.isSafeInteger(value.expectedLength) && value.expectedLength! > 0 ? { expectedLength: value.expectedLength } : {}),
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
    };
  } catch {
    return undefined;
  }
}

function strongEtag(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed && !/^W\//u.test(trimmed) ? trimmed : undefined;
}

function parseContentRange(value: string | null): { start: number; end: number; total?: number } | null {
  const match = value?.trim().match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/iu);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = match[3] === '*' ? undefined : Number(match[3]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start || (total !== undefined && end >= total)) return null;
  return { start, end, total };
}

async function transferOnce(
  options: ResumableDownloadOptions,
  part: string,
  sidecarPath: string,
  urlKey: string,
  state: ResumeState,
  maxBytes: number,
): Promise<void> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (state.offset > 0 && state.sidecar) {
    headers.range = `bytes=${state.offset}-`;
    headers['if-range'] = state.sidecar.etag ?? state.sidecar.lastModified!;
  }
  let fd: number | undefined;
  let decided: Response | undefined;
  let position = 0;
  let accept = false;

  const decide = (response: Response): void => {
    decided = response;
    if (response.status === 206) {
      const range = parseContentRange(response.headers.get('content-range'));
      const etag = strongEtag(response.headers.get('etag'));
      const lastModified = response.headers.get('last-modified') ?? undefined;
      if (!range || range.start !== state.offset) {
        throw new TransferRestart(`Content-Range 与断点不一致（${response.headers.get('content-range') ?? '缺失'}，期望从 ${state.offset} 开始）。`);
      }
      if (state.sidecar?.etag && etag && etag !== state.sidecar.etag) throw new TransferRestart('ETag 已变化。');
      if (!state.sidecar?.etag && state.sidecar?.lastModified && lastModified && lastModified !== state.sidecar.lastModified) {
        throw new TransferRestart('Last-Modified 已变化。');
      }
      if (range.total !== undefined && range.total > maxBytes) throw new TransferFatal('VIDEO_PROVIDER_INVALID_OUTPUT', '返回的视频超过大小上限。');
      fd = openSync(part, state.offset > 0 ? 'r+' : 'w');
      position = range.start;
      writeSidecar(sidecarPath, {
        version: 1,
        urlKey,
        ...(state.sidecar?.etag ?? etag ? { etag: state.sidecar?.etag ?? etag } : {}),
        ...(state.sidecar?.lastModified ?? lastModified ? { lastModified: state.sidecar?.lastModified ?? lastModified } : {}),
        ...(range.total ?? state.sidecar?.expectedLength ? { expectedLength: range.total ?? state.sidecar?.expectedLength } : {}),
        updatedAt: new Date().toISOString(),
      });
      accept = true;
      return;
    }
    if (response.status === 200) {
      // Server ignored Range or If-Range failed: restart from zero. Truncate before the sidecar changes
      // so a crash in between can never pair old bytes with a new validator.
      fd = openSync(part, 'w');
      ftruncateSync(fd, 0);
      position = 0;
      const encoded = (response.headers.get('content-encoding') ?? 'identity').toLowerCase() !== 'identity';
      const length = Number(response.headers.get('content-length'));
      const etag = strongEtag(response.headers.get('etag'));
      const lastModified = response.headers.get('last-modified') ?? undefined;
      writeSidecar(sidecarPath, {
        version: 1,
        urlKey,
        // Content-encoded bodies cannot be resumed by byte range; omit validators so a later attempt restarts.
        ...(!encoded && etag ? { etag } : {}),
        ...(!encoded && lastModified ? { lastModified } : {}),
        ...(!encoded && Number.isSafeInteger(length) && length > 0 ? { expectedLength: length } : {}),
        updatedAt: new Date().toISOString(),
      });
      accept = true;
    }
  };

  let response: Response;
  try {
    response = await fetchWithTimeout(options.url, {
      method: 'GET',
      headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      timeoutLabel: options.timeoutLabel ?? '结果下载',
      maxBytes,
      purpose: 'provider-api',
      allowPrivateNetwork: options.allowPrivateNetwork,
      fetchImpl: options.fetchImpl,
      proxyUrl: options.proxyUrl,
      onResponseChunk: (chunk, chunkResponse) => {
        if (decided !== chunkResponse) decide(chunkResponse);
        if (!accept || fd === undefined) return;
        if (position + chunk.byteLength > maxBytes) throw new TransferFatal('VIDEO_PROVIDER_INVALID_OUTPUT', '返回的视频超过大小上限。');
        writeSync(fd, chunk, 0, chunk.byteLength, position);
        position += chunk.byteLength;
      },
    });
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  // `response` is rebuilt by the network policy, so compare against "no chunk seen" rather than identity.
  if (decided === undefined && (response.status === 200 || response.status === 206)) {
    // Empty body: the chunk callback never ran.
    decide(response);
    if (fd !== undefined) { closeSync(fd); fd = undefined; }
  }
  if (response.status === 412) throw new TransferRestart('服务端拒绝断点条件（412）。');
  if (response.status === 416) {
    const total = Number(response.headers.get('content-range')?.match(/^bytes\s+\*\/(\d+)$/iu)?.[1]);
    if (state.offset > 0 && total === state.offset) return; // The .part is already complete.
    throw new TransferRestart('断点超出远端文件范围（416）。');
  }
  if (response.status !== 200 && response.status !== 206) {
    throw new Error(`${response.status} ${response.statusText}`.trim());
  }
}

function writeSidecar(path: string, value: PartSidecar): void {
  writeFileSync(path, `${JSON.stringify(value)}\n`, 'utf8');
}

async function verifyPart(
  options: ResumableDownloadOptions,
  part: string,
  sidecarPath: string,
  maxBytes: number,
): Promise<{ bytes: number; sha256: string; container?: VideoContainer }> {
  const info = await stat(part).catch(() => null);
  const size = info?.isFile() ? info.size : 0;
  const sidecar = parseSidecar(await readFile(sidecarPath, 'utf8').catch(() => ''));
  const expected = options.expectedLength ?? sidecar?.expectedLength;
  if (size <= 0) {
    await discardPart(part, sidecarPath);
    throw new TransferFatal('VIDEO_PROVIDER_INVALID_OUTPUT', '返回的视频为空。');
  }
  if (size > maxBytes || (expected !== undefined && size > expected)) {
    await discardPart(part, sidecarPath);
    throw new TransferFatal('VIDEO_PROVIDER_INVALID_OUTPUT', `下载长度 ${size} 超过预期 ${expected ?? maxBytes}。`);
  }
  if (expected !== undefined && size < expected) {
    // Keep the .part: the next attempt resumes with Range.
    throw Object.assign(new Error(`下载不完整：${size}/${expected} 字节。`), { code: 'RESUMABLE_TRANSFER_TRUNCATED' });
  }
  let container: VideoContainer | undefined;
  if ((options.verify ?? 'video') === 'video') {
    const handle = await open(part, 'r');
    const head = new Uint8Array(16);
    try { await handle.read(head, 0, head.length, 0); } finally { await handle.close(); }
    const detected = detectVideoContainer(head);
    if (!detected) {
      await discardPart(part, sidecarPath);
      throw new TransferFatal('VIDEO_PROVIDER_DOWNLOAD_INVALID', '下载内容不是 MP4/MOV/WebM 视频（可能是错误页或过期链接），已丢弃；可稍后重新查询结果再下载。');
    }
    container = detected;
  }
  const sha256 = await sha256File(part);
  if (options.expectedSha256 && sha256 !== options.expectedSha256.toLowerCase()) {
    await discardPart(part, sidecarPath);
    throw new TransferFatal('VIDEO_PROVIDER_DOWNLOAD_INVALID', 'SHA-256 校验不一致，已丢弃下载内容。');
  }
  return { bytes: size, sha256, ...(container ? { container } : {}) };
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function discardPart(part: string, sidecarPath: string): Promise<void> {
  await rm(part, { force: true }).catch(() => undefined);
  await rm(sidecarPath, { force: true }).catch(() => undefined);
}

export function isRetryableTransferError(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && RETRYABLE_CODES.has(code)) return true;
    const message = current instanceof Error ? current.message : '';
    if (/^(?:terminated|fetch failed|other side closed)$/iu.test(message)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function abortError(signal: AbortSignal, cause?: unknown): Error {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  return Object.assign(new Error('下载已取消，已保留断点。', { cause }), { name: 'AbortError', code: 'ABORT_ERR' });
}

async function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(abortError(signal!)); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Adapter for `VideoProviderRuntimeOptions.downloadResult`: verified video, same final target path. */
export async function downloadVerifiedVideoResult(input: {
  url: string;
  targetPath: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs: number;
  maxBytes: number;
  timeoutLabel: string;
  proxyUrl?: string;
}): Promise<void> {
  await resumableDownload({ ...input, verify: 'video' });
}
