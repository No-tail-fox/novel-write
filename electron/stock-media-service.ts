import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { hashShortVideoMaterial, type ShortVideoMaterialProbe } from '../src/shared/short-video-material-runtime';
import { PEXELS_API_DOCUMENTATION_URL, PEXELS_LICENSE_URL, stockMediaCancelSchema, stockMediaImportSchema, stockMediaProvenanceSchema, stockMediaSearchSchema, type StockMediaImportInput, type StockMediaImportResult, type StockMediaItem, type StockMediaSearchInput, type StockMediaSearchResult, type StockMediaStatus } from '../src/shared/stock-media';

const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const MAX_API_BYTES = 2 * 1024 * 1024;
const API_ORIGIN = 'https://api.pexels.com';
const MEDIA_HOSTS = new Set(['videos.pexels.com']);
type Fetch = typeof fetch;
export interface StockMediaServiceOptions {
  directory: string;
  getApiKey: () => Promise<string>;
  probe: (path: string, signal?: AbortSignal) => Promise<ShortVideoMaterialProbe>;
  /** Transport injection for offline HTTP tests; production always uses fixed official hosts. */
  fetch?: Fetch;
  maxDownloadBytes?: number;
}
function error(code: string, message: string): Error { return new Error(`STOCK_MEDIA_${code}: ${message}`); }
function safeUrl(raw: unknown, hosts: Set<string>): string {
  if (typeof raw !== 'string' || raw.length > 8192) throw error('URL', '素材地址无效');
  const value = new URL(raw);
  if (value.protocol !== 'https:' || value.username || value.password || value.port || !hosts.has(value.hostname)) throw error('URL', '素材地址不是允许的官方来源');
  return value.href;
}
function positive(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw error('RESPONSE', '素材元数据无效');
  return value;
}
function id(value: unknown): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw error('RESPONSE', '素材编号无效');
  return String(value);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw error('RESPONSE', '素材服务返回格式无效');
  return value as Record<string, unknown>;
}
export function normalizePexelsVideo(value: unknown, now = new Date().toISOString()): StockMediaItem {
  const video = object(value), user = object(video.user);
  const variants = (Array.isArray(video.video_files) ? video.video_files : []).flatMap(raw => {
    try { const file = object(raw); if (file.file_type !== 'video/mp4') return [];
      return [{ id: id(file.id), width: positive(file.width), height: positive(file.height), mimeType: 'video/mp4' as const, downloadUrl: safeUrl(file.link, MEDIA_HOSTS) }];
    } catch { return []; }
  }).sort((left, right) => left.width * left.height - right.width * right.height);
  if (!variants.length) throw error('NO_VARIANT', '该视频没有可安全下载的 MP4 版本');
  if (typeof user.name !== 'string' || !user.name.trim()) throw error('RESPONSE', '素材缺少作者来源');
  return { provider: 'pexels', type: 'video', id: id(video.id), sourceUrl: safeUrl(video.url, new Set(['www.pexels.com'])),
    author: user.name.trim().slice(0, 300), authorUrl: safeUrl(user.url, new Set(['www.pexels.com'])),
    previewUrl: safeUrl(video.image, new Set(['images.pexels.com'])),
    width: positive(video.width), height: positive(video.height), durationMs: positive(video.duration) * 1000, variants,
    license: { name: 'Pexels License', url: PEXELS_LICENSE_URL, recordedAt: now } };
}
function assertProbe(probe: ShortVideoMaterialProbe): void {
  if (![probe.width, probe.height, probe.durationMs].every(n => Number.isFinite(n) && n > 0) || probe.width > 16384 || probe.height > 16384 || probe.durationMs > 86400000) throw error('MEDIA', '下载文件不是有效视频或尺寸、时长超出限制');
}
async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = path + '.' + randomUUID() + '.partial';
  try { await writeFile(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', flag: 'wx' }); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}
async function waitFor(promise: Promise<unknown>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolvePromise, reject) => {
    const abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true });
    void promise.then(() => resolvePromise(), () => resolvePromise()).finally(() => signal.removeEventListener('abort', abort));
  });
  signal.throwIfAborted();
}
export class StockMediaService {
  private readonly transport: Fetch;
  private readonly operations = new Map<string, AbortController>();
  private readonly imports = new Map<string, Promise<StockMediaImportResult>>();
  private commit: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: StockMediaServiceOptions) { this.transport = options.fetch ?? fetch; }
  async status(): Promise<StockMediaStatus> { return { provider: 'pexels', configured: Boolean((await this.options.getApiKey()).trim()) }; }
  cancel(input: { operationId: string }): void { this.operations.get(stockMediaCancelSchema.parse(input).operationId)?.abort(error('CANCELLED', '已取消素材操作')); }
  private async operation<T>(operationId: string, timeout: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.operations.has(operationId)) throw error('OPERATION', '素材操作编号正在使用');
    const controller = new AbortController(); this.operations.set(operationId, controller);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]);
    try { return await run(signal); }
    catch (cause) { if (signal.aborted) throw error('CANCELLED', controller.signal.aborted ? '已取消素材操作' : '素材操作超时，请重试'); throw cause; }
    finally { this.operations.delete(operationId); }
  }
  private async api(path: string, signal: AbortSignal): Promise<Record<string, unknown>> {
    const key = (await this.options.getApiKey()).trim();
    if (!key) throw error('NOT_CONFIGURED', '请先在系统设置的网络素材中保存 Pexels 专用 API Key；仍可使用本地素材');
    let response: Response;
    try { response = await this.transport(API_ORIGIN + path, { headers: { Authorization: key, Accept: 'application/json' }, redirect: 'error', signal }); }
    catch { signal.throwIfAborted(); throw error('NETWORK', '无法连接 Pexels，请检查网络后重试'); }
    if (response.status === 401 || response.status === 403) { await response.body?.cancel(); throw error('CREDENTIAL', 'Pexels 专用 API Key 无效或没有访问权限'); }
    if (response.status === 429) {
      const retry = response.headers.get('retry-after'); await response.body?.cancel();
      throw error('RATE_LIMIT', `Pexels 请求频率已达上限${retry && /^\d{1,6}$/.test(retry) ? `，请等待 ${retry} 秒` : '，请稍后重试'}`);
    }
    if (!response.ok) { await response.body?.cancel(); throw error('HTTP', `Pexels 请求失败（${response.status}）`); }
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json') || !response.body) { await response.body?.cancel(); throw error('RESPONSE', 'Pexels 未返回 JSON 数据'); }
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { signal.throwIfAborted(); const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_API_BYTES) throw error('RESPONSE', '素材服务返回数据过大'); chunks.push(value); }
      try { return object(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { throw error('RESPONSE', 'Pexels 返回了无效 JSON 数据'); }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }
  async search(input: StockMediaSearchInput): Promise<StockMediaSearchResult> {
    const request = stockMediaSearchSchema.parse(input);
    return this.operation(request.operationId, 30000, async signal => {
      const params = new URLSearchParams({ query: request.query, page: String(request.page), per_page: String(request.perPage) });
      if (request.orientation !== 'any') params.set('orientation', request.orientation);
      const data = await this.api('/videos/search?' + params, signal);
      if (!Array.isArray(data.videos) || typeof data.total_results !== 'number' || !Number.isSafeInteger(data.total_results) || data.total_results < 0) throw error('RESPONSE', 'Pexels 检索结果无效');
      const items = data.videos.flatMap(raw => {
        try { const item = normalizePexelsVideo(raw);
          return item.durationMs >= request.minDurationSec * 1000 && (request.maxDurationSec === undefined || item.durationMs <= request.maxDurationSec * 1000) ? [item] : [];
        } catch { return []; }
      });
      return { items, page: request.page, perPage: request.perPage, total: data.total_results, hasMore: request.page * request.perPage < data.total_results, durationFiltered: request.minDurationSec > 0 || request.maxDurationSec !== undefined };
    });
  }
  private async cached(input: StockMediaImportInput, signal: AbortSignal): Promise<StockMediaImportResult | undefined> {
    try {
      const receipt = object(JSON.parse(await readFile(this.receiptPath(input), 'utf8')));
      const provenance = stockMediaProvenanceSchema.parse(receipt.provenance);
      if (provenance.mediaId !== input.mediaId || provenance.variantId !== input.variantId) return undefined;
      const path = join(resolve(this.options.directory), 'objects', provenance.contentHash + '.mp4');
      if (receipt.path !== path || await hashShortVideoMaterial(path, signal) !== provenance.contentHash) return undefined;
      const probe = { width: positive(receipt.width), height: positive(receipt.height), durationMs: positive(receipt.durationMs) }; assertProbe(probe);
      const info = await stat(path); if (info.size !== receipt.bytes || info.size < 1 || info.size > (this.options.maxDownloadBytes ?? MAX_DOWNLOAD_BYTES)) return undefined;
      const sidecar = object(JSON.parse(await readFile(path + '.stock.json', 'utf8')));
      if (sidecar.contentHash !== provenance.contentHash || !Array.isArray(sidecar.sources) || !sidecar.sources.some(item => { const p = stockMediaProvenanceSchema.safeParse(item); return p.success && p.data.mediaId === provenance.mediaId && p.data.variantId === provenance.variantId; })) return undefined;
      return { ...probe, path, bytes: info.size, provenance, reused: true };
    } catch { signal.throwIfAborted(); return undefined; }
  }
  private receiptPath(input: StockMediaImportInput): string { return join(resolve(this.options.directory), 'receipts', `${input.mediaId}-${input.variantId}.json`); }
  async import(input: StockMediaImportInput): Promise<StockMediaImportResult> {
    const request = stockMediaImportSchema.parse(input);
    return this.operation(request.operationId, 180000, async signal => {
      const key = request.mediaId + '-' + request.variantId;
      while (this.imports.has(key)) await waitFor(this.imports.get(key)!, signal);
      const pending = (async () => {
        const existing = await this.cached(request, signal); if (existing) return existing;
        return this.download(request, signal);
      })();
      this.imports.set(key, pending);
      try { return await pending; } finally { if (this.imports.get(key) === pending) this.imports.delete(key); }
    });
  }
  private async fetchMedia(url: string, signal: AbortSignal): Promise<Response> {
    let target = safeUrl(url, MEDIA_HOSTS);
    for (let hop = 0; hop <= 3; hop++) {
      let response: Response;
      try { response = await this.transport(target, { redirect: 'manual', signal }); }
      catch { signal.throwIfAborted(); throw error('NETWORK', '素材下载连接失败，请重试'); }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location'); await response.body?.cancel();
        if (!location || hop === 3) throw error('REDIRECT', '素材重定向过多或缺少地址');
        target = safeUrl(new URL(location, target).href, MEDIA_HOSTS); continue;
      }
      return response;
    }
    throw error('REDIRECT', '素材下载地址无效');
  }
  private async download(input: StockMediaImportInput, signal: AbortSignal): Promise<StockMediaImportResult> {
    const directory = resolve(this.options.directory);
    await Promise.all(['objects', 'receipts', 'temporary'].map(part => mkdir(join(directory, part), { recursive: true })));
    const temporary = join(directory, 'temporary', randomUUID() + '.partial.mp4');
    try {
      let item = normalizePexelsVideo(await this.api('/videos/videos/' + input.mediaId, signal));
      if (item.id !== input.mediaId) throw error('RESPONSE', '素材编号与请求不符');
      const variantFor = () => { const selected = item.variants.find(v => v.id === input.variantId); if (!selected) throw error('VARIANT', '所选清晰度已不可用，请重新搜索并选择'); return selected; };
      let variant = variantFor(), response = await this.fetchMedia(variant.downloadUrl, signal);
      // A single metadata refresh can replace an expired signed URL; never replay downloads indefinitely.
      if ([401, 403, 404, 410].includes(response.status)) {
        await response.body?.cancel(); item = normalizePexelsVideo(await this.api('/videos/videos/' + input.mediaId, signal));
        if (item.id !== input.mediaId) throw error('RESPONSE', '素材编号与请求不符');
        variant = variantFor(); response = await this.fetchMedia(variant.downloadUrl, signal);
      }
      if (!response.ok) { await response.body?.cancel(); throw error('DOWNLOAD', `素材链接不可用（${response.status}），请重新检索`); }
      const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      const maximum = this.options.maxDownloadBytes ?? MAX_DOWNLOAD_BYTES;
      const declared = response.headers.get('content-length');
      if (mime !== 'video/mp4' || !response.body) { await response.body?.cancel(); throw error('MEDIA', '下载响应不是 MP4 视频'); }
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) < 1 || Number(declared) > maximum)) { await response.body.cancel(); throw error('SIZE', '素材为空或超过下载大小限制（默认 512 MB）'); }
      const file = await open(temporary, 'wx'); const reader = response.body.getReader();
      const digest = createHash('sha256'); let bytes = 0, header = Buffer.alloc(0);
      try { while (true) { signal.throwIfAborted(); const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength; if (bytes > maximum) throw error('SIZE', '素材超过下载大小限制');
        if (header.length < 12) header = Buffer.concat([header, value]).subarray(0, 12);
        digest.update(value); await file.writeFile(value);
      } } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); await file.close(); }
      signal.throwIfAborted();
      if (bytes < 12 || (declared !== null && bytes !== Number(declared)) || header.toString('ascii', 4, 8) !== 'ftyp') throw error('MEDIA', '下载文件不完整或不是 MP4 容器');
      const probe = await this.options.probe(temporary, signal); assertProbe(probe);
      if (probe.width !== variant.width || probe.height !== variant.height) throw error('MEDIA', '下载视频尺寸与所选清晰度不符');
      if (Math.abs(probe.durationMs - item.durationMs) > Math.max(2000, item.durationMs * .05)) throw error('MEDIA', '下载视频时长与来源元数据不符');
      const contentHash = digest.digest('hex'), path = join(directory, 'objects', contentHash + '.mp4');
      const provenance = stockMediaProvenanceSchema.parse({ provider: 'pexels', mediaId: item.id, variantId: variant.id, sourceUrl: item.sourceUrl, author: item.author, authorUrl: item.authorUrl, licenseName: item.license.name, licenseUrl: item.license.url, licenseRecordedAt: item.license.recordedAt, downloadedAt: new Date().toISOString(), contentHash, apiDocumentationUrl: PEXELS_API_DOCUMENTATION_URL });
      const result: StockMediaImportResult = { path, ...probe, bytes, provenance, reused: false };
      const previous = this.commit;
      const commit = (async () => {
        await waitFor(previous, signal); signal.throwIfAborted();
        let sources = [provenance];
        try { const current = object(JSON.parse(await readFile(path + '.stock.json', 'utf8')));
          if (current.contentHash === contentHash && Array.isArray(current.sources)) sources = current.sources.map(source => stockMediaProvenanceSchema.parse(source)).filter(source => source.mediaId !== provenance.mediaId || source.variantId !== provenance.variantId).concat(provenance);
        } catch { /* Rebuild a missing/corrupt receipt only after verifying the downloaded bytes. */ }
        let exists = false; try { exists = await hashShortVideoMaterial(path, signal) === contentHash; } catch { signal.throwIfAborted(); }
        signal.throwIfAborted(); if (!exists) await rename(temporary, path);
        await atomicJson(path + '.stock.json', { version: 1, contentHash, sources });
        await atomicJson(this.receiptPath(input), result);
        return result;
      })();
      this.commit = commit.catch(() => undefined);
      return await commit;
    } finally { await rm(temporary, { force: true }); }
  }
}
