/**
 * S-1 / 工作包 A：素材站检索与安全下载（主进程）。
 *
 * - 检索：可注入 fetch 与 baseUrl（测试只连本机 mock relay），超时 + AbortSignal；密钥只放请求头/查询串，
 *   错误消息里从不拼接 URL 或响应正文，避免泄露 Pixabay 查询串里的 key。
 * - 下载：只接受最近检索结果中的 provider+id（渲染端不能指定任意 URL）；手动跟随重定向并逐跳校验
 *   https 与提供商域名；先写临时文件，校验 Content-Type、魔数、大小后原子改名进托管目录
 *   `<artifactDataDir>/stock-media/`；同目录写来源清单 `<provider>-<kind>-<id>.source.json`。
 * - 去重：provider+kind+id 已有清单且文件哈希一致则直接复用（零网络）；内容 sha256 相同则复用已托管文件。
 * - 素材随后仍走 short-video-material-runtime 的导入/标准化（ffmpeg 探测尺寸时长），导出不会再次下载。
 */
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { z } from 'zod';
import { classifyProviderFailure } from '../src/shared/provider-failure';
import {
  STOCK_MEDIA_DEFAULT_BASE_URLS,
  STOCK_MEDIA_DIRECTORY_NAME,
  STOCK_MEDIA_DOWNLOAD_HOSTS,
  STOCK_MEDIA_KINDS,
  STOCK_MEDIA_PROVIDERS,
  STOCK_MEDIA_PROVIDER_LABELS,
  STOCK_MEDIA_SECRET_IDS,
  StockMediaError,
  classifyStockMediaHttpFailure,
  filterStockMediaItems,
  parseAspectRatio,
  parseStockMediaSearch,
  ratioFromOrientation,
  selectBestRendition,
  stockMediaDownloadRequestSchema,
  stockMediaFingerprint,
  stockMediaKeyMissingMessage,
  stockMediaSearchRequestSchema,
  isAllowedStockMediaUrl,
  type ParsedStockMediaSearchRequest,
  type StockMediaDownloadRequest,
  type StockMediaDownloadResult,
  type StockMediaItem,
  type StockMediaKind,
  type StockMediaProviderId,
  type StockMediaSearchRequest,
  type StockMediaSearchResult,
  type StockMediaSourceManifest,
  type StockMediaUrlPolicy,
} from '../src/shared/stock-media';

export type StockMediaContainer = 'mp4' | 'mov' | 'webm' | 'jpg' | 'png';
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface StockMediaServiceOptions {
  resolveApiKey: (provider: StockMediaProviderId) => Promise<string>;
  /** Absolute managed directory (production: `<artifactDataDir>/stock-media`). */
  managedDirectory: () => string;
  fetch?: FetchLike;
  baseUrls?: Partial<Record<StockMediaProviderId, string>>;
  /** Download host suffix allowlist override (tests). */
  downloadHosts?: Partial<Record<StockMediaProviderId, readonly string[]>>;
  /** Test-only: permit http://127.0.0.1 for the mock relay. */
  allowLoopbackHttp?: boolean;
  searchTimeoutMs?: number;
  downloadTimeoutMs?: number;
  maxBytes?: Partial<Record<StockMediaKind, number>>;
  maxRedirects?: number;
  now?: () => Date;
}

const DEFAULT_MAX_BYTES: Record<StockMediaKind, number> = { video: 500 * 1024 * 1024, photo: 50 * 1024 * 1024 };
const GENERIC_BINARY = new Set(['application/octet-stream', 'binary/octet-stream']);
const ALLOWED_CONTENT_TYPES: Record<StockMediaKind, Set<string>> = {
  video: new Set(['video/mp4', 'video/quicktime', 'video/webm', ...GENERIC_BINARY]),
  photo: new Set(['image/jpeg', 'image/jpg', 'image/png', ...GENERIC_BINARY]),
};
const CONTAINERS_BY_KIND: Record<StockMediaKind, readonly StockMediaContainer[]> = { video: ['mp4', 'mov', 'webm'], photo: ['jpg', 'png'] };
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ITEM_CACHE_LIMIT = 1000;
const MANIFEST_SUFFIX = '.source.json';
const MANAGED_FILE_PATTERN = /^(?:pexels|pixabay)-(?:video|photo)-[0-9A-Za-z_-]{1,64}\.(?:mp4|mov|webm|jpg|png)$/u;

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  provider: z.enum(STOCK_MEDIA_PROVIDERS),
  kind: z.enum(STOCK_MEDIA_KINDS),
  id: z.string().regex(/^[0-9A-Za-z_-]{1,64}$/u),
  author: z.string(),
  authorUrl: z.string(),
  sourceUrl: z.string(),
  license: z.object({ name: z.string(), url: z.string(), attributionRequired: z.boolean() }),
  downloadUrl: z.string(),
  width: z.number(),
  height: z.number(),
  durationSeconds: z.number().optional(),
  downloadedAt: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  sizeBytes: z.number().int().positive(),
  contentType: z.string(),
  fileName: z.string().regex(MANAGED_FILE_PATTERN),
});

/** Magic-byte sniffing; `html` flags an error page served in place of media. */
export function detectStockMediaContainer(head: Uint8Array): StockMediaContainer | 'html' | null {
  const bytes = Buffer.from(head.buffer, head.byteOffset, head.byteLength);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (bytes.length >= 4 && bytes.readUInt32BE(0) === 0x1a45dfa3) return 'webm';
  if (bytes.length >= 12) {
    const box = bytes.toString('latin1', 4, 8);
    if (box === 'ftyp') return bytes.toString('latin1', 8, 12) === 'qt  ' ? 'mov' : 'mp4';
    if (box === 'moov' || box === 'mdat' || box === 'wide' || box === 'free' || box === 'skip') return 'mov';
  }
  const text = bytes.toString('utf8', 0, Math.min(bytes.length, 512)).replace(/^\uFEFF/u, '').trimStart().toLowerCase();
  if (text.startsWith('<!doctype') || text.startsWith('<html') || text.startsWith('<?xml') || text.startsWith('<head') || text.startsWith('<body') || text.startsWith('{') || text.startsWith('[')) return 'html';
  return null;
}

async function hashFile(path: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function contentTypeOf(response: Response): string {
  return (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
}

function isAbort(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError');
}

function isTimeout(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { name?: unknown }).name === 'TimeoutError');
}

export class StockMediaService {
  private readonly items = new Map<string, StockMediaItem>();
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: StockMediaServiceOptions) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  }

  async configuredProviders(): Promise<StockMediaProviderId[]> {
    const configured: StockMediaProviderId[] = [];
    for (const provider of STOCK_MEDIA_PROVIDERS) {
      if ((await this.options.resolveApiKey(provider)).trim()) configured.push(provider);
    }
    return configured;
  }

  async search(input: StockMediaSearchRequest, signal?: AbortSignal): Promise<StockMediaSearchResult> {
    const request = stockMediaSearchRequestSchema.parse(input);
    const provider = request.provider ?? (await this.configuredProviders())[0];
    if (!provider) throw new StockMediaError('STOCK_MEDIA_KEY_MISSING', stockMediaKeyMissingMessage());
    const apiKey = (await this.options.resolveApiKey(provider)).trim();
    if (!apiKey) throw new StockMediaError('STOCK_MEDIA_KEY_MISSING', stockMediaKeyMissingMessage(provider));
    const { url, headers } = this.buildSearchRequest(provider, request, apiKey);
    const response = await this.request(provider, url, { headers, redirect: 'error' }, this.options.searchTimeoutMs ?? 15_000, signal, async (current) => {
      if (current.ok) return current;
      const body = await current.text().catch(() => '');
      throw classifyStockMediaHttpFailure({ provider, status: current.status, body, headers: current.headers, phase: 'search', now: this.now().getTime() });
    });
    let json: unknown;
    try { json = await response.json(); } catch (error) {
      if (signal?.aborted) throw error;
      throw new StockMediaError('STOCK_MEDIA_RESPONSE_INVALID', `${STOCK_MEDIA_PROVIDER_LABELS[provider]} 返回的不是有效 JSON。`);
    }
    const parsed = parseStockMediaSearch(provider, request.kind, json, {
      policy: this.urlPolicy(provider),
      target: { ratio: ratioFromOrientation(request.orientation) },
      page: request.page,
      perPage: request.perPage,
    });
    const items = filterStockMediaItems(parsed.items, request);
    if (!items.length) {
      throw new StockMediaError('STOCK_MEDIA_NO_RESULTS', `${STOCK_MEDIA_PROVIDER_LABELS[provider]} 没有找到“${request.query}”的${request.kind === 'video' ? '视频' : '图片'}素材，请更换检索词或导入本地素材。`);
    }
    for (const item of items) this.remember(item);
    return { ...parsed, items };
  }

  async download(input: StockMediaDownloadRequest, signal?: AbortSignal): Promise<StockMediaDownloadResult> {
    const request = stockMediaDownloadRequestSchema.parse(input);
    const directory = resolve(this.options.managedDirectory());
    await mkdir(directory, { recursive: true });
    const stem = `${request.provider}-${request.kind}-${request.id}`;
    const manifestPath = join(directory, stem + MANIFEST_SUFFIX);
    const existing = await this.readManifest(manifestPath, directory, signal, true);
    if (existing) return { path: join(directory, existing.fileName), manifestPath, sha256: existing.sha256, sizeBytes: existing.sizeBytes, reused: 'provider-id', manifest: existing };

    const item = this.items.get(stockMediaFingerprint(request));
    if (!item) throw new StockMediaError('STOCK_MEDIA_ITEM_UNKNOWN', '该素材不在最近的检索结果中，请重新检索后再添加。');
    const ratio = parseAspectRatio(request.ratio) ?? (item.width > 0 && item.height > 0 ? item.width / item.height : 16 / 9);
    const rendition = selectBestRendition(item.renditions, { ratio }) ?? { url: item.downloadUrl, width: item.width, height: item.height };
    const temporary = join(directory, `.partial-${randomUUID()}`);
    try {
      const fetched = await this.fetchToTemporary(item, rendition.url, temporary, signal);
      signal?.throwIfAborted();
      const duplicate = await this.findByContent(directory, fetched.sha256, fetched.sizeBytes);
      let fileName = `${stem}.${fetched.container}`;
      let reused: StockMediaDownloadResult['reused'] = null;
      if (duplicate) {
        fileName = duplicate.fileName;
        reused = 'content';
      } else {
        await rename(temporary, join(directory, fileName));
      }
      const manifest: StockMediaSourceManifest = {
        schemaVersion: 1,
        provider: item.provider,
        kind: item.kind,
        id: item.id,
        author: item.author,
        authorUrl: item.authorUrl,
        sourceUrl: item.sourceUrl,
        license: item.license,
        downloadUrl: fetched.finalUrl,
        width: rendition.width || item.width,
        height: rendition.height || item.height,
        ...(item.durationSeconds !== undefined ? { durationSeconds: item.durationSeconds } : {}),
        downloadedAt: this.now().toISOString(),
        sha256: fetched.sha256,
        sizeBytes: fetched.sizeBytes,
        contentType: fetched.contentType,
        fileName,
      };
      const manifestTemporary = `${manifestPath}.${randomUUID()}.tmp`;
      try {
        await writeFile(manifestTemporary, JSON.stringify(manifest, null, 2), { encoding: 'utf8', flag: 'wx' });
        await rename(manifestTemporary, manifestPath);
      } finally {
        await rm(manifestTemporary, { force: true });
      }
      return { path: join(directory, fileName), manifestPath, sha256: fetched.sha256, sizeBytes: fetched.sizeBytes, reused, manifest };
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private remember(item: StockMediaItem): void {
    const key = stockMediaFingerprint(item);
    this.items.delete(key);
    this.items.set(key, item);
    while (this.items.size > ITEM_CACHE_LIMIT) {
      const oldest = this.items.keys().next().value;
      if (oldest === undefined) break;
      this.items.delete(oldest);
    }
  }

  private urlPolicy(provider: StockMediaProviderId): StockMediaUrlPolicy {
    return { hosts: this.options.downloadHosts?.[provider] ?? STOCK_MEDIA_DOWNLOAD_HOSTS[provider], allowLoopbackHttp: this.options.allowLoopbackHttp === true };
  }

  private buildSearchRequest(provider: StockMediaProviderId, request: ParsedStockMediaSearchRequest, apiKey: string): { url: URL; headers: Record<string, string> } {
    const base = (this.options.baseUrls?.[provider] ?? STOCK_MEDIA_DEFAULT_BASE_URLS[provider]).replace(/\/+$/u, '');
    if (provider === 'pexels') {
      const url = new URL(request.kind === 'video' ? `${base}/videos/search` : `${base}/v1/search`);
      url.searchParams.set('query', request.query);
      url.searchParams.set('orientation', request.orientation);
      url.searchParams.set('page', String(request.page));
      url.searchParams.set('per_page', String(Math.min(80, request.perPage)));
      return { url, headers: { Authorization: apiKey, Accept: 'application/json' } };
    }
    const url = new URL(request.kind === 'video' ? `${base}/api/videos/` : `${base}/api/`);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('q', request.query.slice(0, 100));
    url.searchParams.set('page', String(request.page));
    // Documented range 3..200.
    url.searchParams.set('per_page', String(Math.max(3, Math.min(200, request.perPage))));
    url.searchParams.set('safesearch', 'true');
    if (request.kind === 'photo') {
      url.searchParams.set('image_type', 'photo');
      url.searchParams.set('orientation', request.orientation === 'landscape' ? 'horizontal' : request.orientation === 'portrait' ? 'vertical' : 'all');
    }
    return { url, headers: { Accept: 'application/json' } };
  }

  /** One fetch with timeout/abort and secret-free error mapping. */
  private async request<T>(provider: StockMediaProviderId, url: URL, init: RequestInit, timeoutMs: number, signal: AbortSignal | undefined, handle: (response: Response) => Promise<T>): Promise<T> {
    signal?.throwIfAborted();
    const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, { ...init, signal: combined });
    } catch (error) {
      throw this.transportError(provider, error, signal);
    }
    return handle(response);
  }

  private transportError(provider: StockMediaProviderId, error: unknown, signal: AbortSignal | undefined): unknown {
    if (signal?.aborted) return signal.reason ?? error;
    if (error instanceof StockMediaError) return error;
    const label = STOCK_MEDIA_PROVIDER_LABELS[provider];
    if (isTimeout(error)) return new StockMediaError('STOCK_MEDIA_TIMEOUT', `${label} 请求超时，请检查网络后重试。`, true);
    if (isAbort(error)) return error;
    const failure = classifyProviderFailure({ error });
    return new StockMediaError('STOCK_MEDIA_NETWORK', `${label} 网络请求失败：${failure.label}`, failure.retry !== 'never');
  }

  private async fetchToTemporary(item: StockMediaItem, initialUrl: string, temporary: string, signal?: AbortSignal) {
    const provider = item.provider;
    const label = STOCK_MEDIA_PROVIDER_LABELS[provider];
    const policy = this.urlPolicy(provider);
    const maxBytes = this.options.maxBytes?.[item.kind] ?? DEFAULT_MAX_BYTES[item.kind];
    const maxRedirects = this.options.maxRedirects ?? 5;
    signal?.throwIfAborted();
    const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(this.options.downloadTimeoutMs ?? 300_000)]) : AbortSignal.timeout(this.options.downloadTimeoutMs ?? 300_000);
    let url: URL;
    try { url = new URL(initialUrl); } catch { throw new StockMediaError('STOCK_MEDIA_URL_REJECTED', `${label} 素材下载地址无效。`); }
    if (!isAllowedStockMediaUrl(url, policy)) throw new StockMediaError('STOCK_MEDIA_URL_REJECTED', `${label} 素材下载地址不是受信任的 https 域名，已拒绝。`);
    try {
      for (let hop = 0; ; hop += 1) {
        const response = await this.fetchImpl(url, { redirect: 'manual', signal: combined, headers: { Accept: item.kind === 'video' ? 'video/*' : 'image/*' } });
        if (REDIRECT_STATUSES.has(response.status)) {
          await response.body?.cancel().catch(() => undefined);
          const location = response.headers.get('location');
          if (!location || hop >= maxRedirects) throw new StockMediaError('STOCK_MEDIA_REDIRECT_REJECTED', `${label} 下载重定向异常，已拒绝。`);
          let next: URL;
          try { next = new URL(location, url); } catch { throw new StockMediaError('STOCK_MEDIA_REDIRECT_REJECTED', `${label} 下载重定向地址无效，已拒绝。`); }
          if (!isAllowedStockMediaUrl(next, policy)) throw new StockMediaError('STOCK_MEDIA_REDIRECT_REJECTED', `${label} 下载被重定向到非 https 或非预期域名，已拒绝。`);
          url = next;
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          throw classifyStockMediaHttpFailure({ provider, status: response.status, headers: response.headers, phase: 'download', now: this.now().getTime() });
        }
        const contentType = contentTypeOf(response);
        if (contentType && !ALLOWED_CONTENT_TYPES[item.kind].has(contentType)) {
          await response.body?.cancel().catch(() => undefined);
          throw new StockMediaError('STOCK_MEDIA_NOT_MEDIA', `${label} 返回的不是${item.kind === 'video' ? '视频' : '图片'}文件（${contentType}），已拒绝。`);
        }
        const declared = Number(response.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > maxBytes) {
          await response.body?.cancel().catch(() => undefined);
          throw new StockMediaError('STOCK_MEDIA_TOO_LARGE', `${label} 素材超过 ${Math.round(maxBytes / 1024 / 1024)} MB 上限，已拒绝。`);
        }
        if (!response.body) throw new StockMediaError('STOCK_MEDIA_INCOMPLETE', `${label} 素材下载内容为空。`);
        const written = await this.streamToFile(response.body, temporary, item.kind, maxBytes, label, combined);
        if (Number.isFinite(declared) && declared > 0 && written.sizeBytes !== declared) {
          throw new StockMediaError('STOCK_MEDIA_INCOMPLETE', `${label} 素材下载不完整，请重试。`, true);
        }
        return { ...written, contentType: contentType || 'application/octet-stream', finalUrl: url.toString() };
      }
    } catch (error) {
      throw this.transportError(provider, error, signal);
    }
  }

  private async streamToFile(body: ReadableStream<Uint8Array>, temporary: string, kind: StockMediaKind, maxBytes: number, label: string, signal?: AbortSignal) {
    const handle = await open(temporary, 'wx');
    const hash = createHash('sha256');
    const reader = body.getReader();
    let sizeBytes = 0;
    let head = Buffer.alloc(0);
    let container: StockMediaContainer | null = null;
    const verifyHead = (): StockMediaContainer => {
      const detected = detectStockMediaContainer(head);
      if (detected === 'html') throw new StockMediaError('STOCK_MEDIA_NOT_MEDIA', `${label} 返回的是网页或文本而不是${kind === 'video' ? '视频' : '图片'}，已拒绝。`);
      if (!detected || !CONTAINERS_BY_KIND[kind].includes(detected)) throw new StockMediaError('STOCK_MEDIA_NOT_MEDIA', `${label} 下载内容不是受支持的${kind === 'video' ? ' MP4/MOV/WebM 视频' : ' JPG/PNG 图片'}，已拒绝。`);
      return detected;
    };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        signal?.throwIfAborted();
        if (done) break;
        if (!value?.byteLength) continue;
        sizeBytes += value.byteLength;
        if (sizeBytes > maxBytes) throw new StockMediaError('STOCK_MEDIA_TOO_LARGE', `${label} 素材超过 ${Math.round(maxBytes / 1024 / 1024)} MB 上限，已拒绝。`);
        if (!container) {
          head = Buffer.concat([head, Buffer.from(value.buffer, value.byteOffset, value.byteLength)]).subarray(0, 64);
          if (head.length >= 16) container = verifyHead();
        }
        hash.update(value);
        await handle.write(value);
      }
      if (!sizeBytes) throw new StockMediaError('STOCK_MEDIA_INCOMPLETE', `${label} 素材下载内容为空。`);
      if (!container) container = verifyHead();
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      await handle.close();
    }
    if (!container) throw new StockMediaError('STOCK_MEDIA_NOT_MEDIA', `${label} 下载内容无法识别，已拒绝。`);
    return { sha256: hash.digest('hex'), sizeBytes, container };
  }

  /** Valid only when the referenced managed file still exists with the recorded size (and hash when `verifyHash`). */
  private async readManifest(path: string, directory: string, signal: AbortSignal | undefined, verifyHash: boolean): Promise<StockMediaSourceManifest | null> {
    let manifest: StockMediaSourceManifest;
    try {
      const parsed = manifestSchema.safeParse(JSON.parse(await readFile(path, 'utf8')));
      if (!parsed.success) return null;
      manifest = parsed.data as StockMediaSourceManifest;
    } catch {
      return null;
    }
    if (basename(manifest.fileName) !== manifest.fileName) return null;
    const file = join(directory, manifest.fileName);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile() || info.size !== manifest.sizeBytes) return null;
    if (verifyHash && await hashFile(file, signal) !== manifest.sha256) return null;
    return manifest;
  }

  private async findByContent(directory: string, sha256: string, sizeBytes: number): Promise<StockMediaSourceManifest | null> {
    const names = await readdir(directory).catch(() => [] as string[]);
    for (const name of names) {
      if (!name.endsWith(MANIFEST_SUFFIX)) continue;
      const manifest = await this.readManifest(join(directory, name), directory, undefined, false);
      if (!manifest || manifest.sha256 !== sha256 || manifest.sizeBytes !== sizeBytes) continue;
      // Only reuse bytes that still hash to the recorded value; a corrupted file is replaced, never trusted.
      if (await hashFile(join(directory, manifest.fileName)).catch(() => '') === sha256) return manifest;
    }
    return null;
  }
}

/** Production wiring: keys from the encrypted vault, files under the managed artifact directory. */
export function createStockMediaService(dependencies: {
  resolveSecret: (secretId: string) => Promise<string>;
  dataDirectory: () => string;
}): StockMediaService {
  return new StockMediaService({
    resolveApiKey: provider => dependencies.resolveSecret(STOCK_MEDIA_SECRET_IDS[provider]),
    managedDirectory: () => join(dependencies.dataDirectory(), STOCK_MEDIA_DIRECTORY_NAME),
  });
}
