/**
 * S-1 / 工作包 A：素材站（Pexels / Pixabay）统一检索协议，渲染端与主进程共用（不得引入 node: 模块）。
 *
 * 响应结构按两家官方 API 文档整理：
 *  - Pexels  https://www.pexels.com/api/documentation/  （GET /videos/search、GET /v1/search，Authorization 头携带密钥）
 *  - Pixabay https://pixabay.com/api/docs/               （GET /api/videos/、GET /api/，key 作为查询参数）
 * 【未核实】以上字段尚未用真实密钥对照线上接口验证；因此外层结构严格校验，单条结果/单个清晰度损坏时只跳过该条，
 * 不让整页失败。授权条款（Pexels License、Pixabay Content License）同样仅按文档摘录，【未核实】，以接入时官方条款为准。
 */
import { z } from 'zod';
import { AppError } from './app-error';
import { classifyHttpStatus, parseRetryAfterMs } from './provider-failure';

export const STOCK_MEDIA_PROVIDERS = ['pexels', 'pixabay'] as const;
export type StockMediaProviderId = (typeof STOCK_MEDIA_PROVIDERS)[number];
export const STOCK_MEDIA_KINDS = ['video', 'photo'] as const;
export type StockMediaKind = (typeof STOCK_MEDIA_KINDS)[number];
export const STOCK_MEDIA_ORIENTATIONS = ['landscape', 'portrait', 'square'] as const;
export type StockMediaOrientation = (typeof STOCK_MEDIA_ORIENTATIONS)[number];

/** Secrets stay in the encrypted credential vault, never in config.json. */
export const STOCK_MEDIA_SECRET_IDS = {
  pexels: 'stockMedia/pexels/apiKey',
  pixabay: 'stockMedia/pixabay/apiKey',
} as const satisfies Record<StockMediaProviderId, string>;
export const STOCK_MEDIA_PROVIDER_LABELS: Record<StockMediaProviderId, string> = { pexels: 'Pexels', pixabay: 'Pixabay' };
export const STOCK_MEDIA_DEFAULT_BASE_URLS: Record<StockMediaProviderId, string> = {
  pexels: 'https://api.pexels.com',
  pixabay: 'https://pixabay.com',
};
/**
 * Download/preview host suffixes. 【未核实】Pexels 文档示例直链为 videos.pexels.com / images.pexels.com，
 * Pixabay 为 cdn.pixabay.com；若线上改用第三方 CDN 或重定向到其它域名，下载会被明确拒绝而不是放行。
 */
export const STOCK_MEDIA_DOWNLOAD_HOSTS: Record<StockMediaProviderId, readonly string[]> = {
  pexels: ['pexels.com'],
  pixabay: ['pixabay.com'],
};
export const STOCK_MEDIA_DIRECTORY_NAME = 'stock-media';

export interface StockMediaLicense { name: string; url: string; attributionRequired: boolean }
/** 【未核实】摘自文档：两家均称无需署名即可免费使用，但仍保留作者与来源以便追溯。 */
export const STOCK_MEDIA_LICENSES: Record<StockMediaProviderId, StockMediaLicense> = {
  pexels: { name: 'Pexels License', url: 'https://www.pexels.com/license/', attributionRequired: false },
  pixabay: { name: 'Pixabay Content License', url: 'https://pixabay.com/service/license-summary/', attributionRequired: false },
};

export interface StockMediaRendition {
  url: string;
  width: number;
  height: number;
  quality?: string;
  fileType?: string;
  sizeBytes?: number;
}

export interface StockMediaItem {
  id: string;
  provider: StockMediaProviderId;
  kind: StockMediaKind;
  author: string;
  authorUrl: string;
  sourceUrl: string;
  previewUrl: string;
  downloadUrl: string;
  width: number;
  height: number;
  durationSeconds?: number;
  license: StockMediaLicense;
  fingerprint?: string;
  renditions: StockMediaRendition[];
}

export interface StockMediaSearchResult {
  provider: StockMediaProviderId;
  kind: StockMediaKind;
  page: number;
  perPage: number;
  totalResults: number;
  hasMore: boolean;
  items: StockMediaItem[];
}

export interface StockMediaSourceManifest {
  schemaVersion: 1;
  provider: StockMediaProviderId;
  kind: StockMediaKind;
  id: string;
  author: string;
  authorUrl: string;
  sourceUrl: string;
  license: StockMediaLicense;
  /** Rendition actually downloaded; informational only (provider links can expire). */
  downloadUrl: string;
  width: number;
  height: number;
  durationSeconds?: number;
  downloadedAt: string;
  sha256: string;
  sizeBytes: number;
  contentType: string;
  /** File name inside the managed stock-media directory. */
  fileName: string;
}

export interface StockMediaDownloadResult {
  path: string;
  manifestPath: string;
  sha256: string;
  sizeBytes: number;
  /** `provider-id`: already downloaded; `content`: same bytes already managed under another id. */
  reused: 'provider-id' | 'content' | null;
  manifest: StockMediaSourceManifest;
}

export const stockMediaSearchRequestSchema = z.object({
  provider: z.enum(STOCK_MEDIA_PROVIDERS).optional(),
  query: z.string().trim().min(1).max(100),
  orientation: z.enum(STOCK_MEDIA_ORIENTATIONS),
  kind: z.enum(STOCK_MEDIA_KINDS),
  minDurationSeconds: z.number().int().min(0).max(3600).optional(),
  maxDurationSeconds: z.number().int().min(1).max(3600).optional(),
  page: z.number().int().min(1).max(1000).default(1),
  perPage: z.number().int().min(1).max(80).default(20),
}).strict().refine(
  value => value.minDurationSeconds === undefined || value.maxDurationSeconds === undefined || value.minDurationSeconds <= value.maxDurationSeconds,
  { message: '最短时长不能大于最长时长' },
);
export type StockMediaSearchRequest = z.input<typeof stockMediaSearchRequestSchema>;
export type ParsedStockMediaSearchRequest = z.output<typeof stockMediaSearchRequestSchema>;

export const stockMediaDownloadRequestSchema = z.object({
  provider: z.enum(STOCK_MEDIA_PROVIDERS),
  kind: z.enum(STOCK_MEDIA_KINDS),
  id: z.string().regex(/^[0-9A-Za-z_-]{1,64}$/u),
  ratio: z.string().regex(/^\d{1,2}:\d{1,2}$/u).optional(),
}).strict();
export type StockMediaDownloadRequest = z.infer<typeof stockMediaDownloadRequestSchema>;

export type StockMediaErrorCode =
  | 'STOCK_MEDIA_KEY_MISSING'
  | 'STOCK_MEDIA_KEY_INVALID'
  | 'STOCK_MEDIA_RATE_LIMITED'
  | 'STOCK_MEDIA_NO_RESULTS'
  | 'STOCK_MEDIA_RESPONSE_INVALID'
  | 'STOCK_MEDIA_REQUEST_FAILED'
  | 'STOCK_MEDIA_NETWORK'
  | 'STOCK_MEDIA_TIMEOUT'
  | 'STOCK_MEDIA_ITEM_UNKNOWN'
  | 'STOCK_MEDIA_LINK_EXPIRED'
  | 'STOCK_MEDIA_REDIRECT_REJECTED'
  | 'STOCK_MEDIA_URL_REJECTED'
  | 'STOCK_MEDIA_NOT_MEDIA'
  | 'STOCK_MEDIA_TOO_LARGE'
  | 'STOCK_MEDIA_INCOMPLETE';

export class StockMediaError extends AppError {
  constructor(
    code: StockMediaErrorCode,
    message: string,
    retryable = false,
    readonly retryAfterMs?: number,
    readonly status?: number,
  ) {
    super(code, message, retryable);
  }
}

export function stockMediaFingerprint(item: Pick<StockMediaItem, 'provider' | 'kind' | 'id'>): string {
  return `${item.provider}:${item.kind}:${item.id}`;
}

/** Providers whose key is stored in the vault, derived from the public `secretStatus` (never the key itself). */
export function configuredStockMediaProviders(secretStatus: Partial<Record<string, boolean>> | undefined): StockMediaProviderId[] {
  return STOCK_MEDIA_PROVIDERS.filter(provider => secretStatus?.[STOCK_MEDIA_SECRET_IDS[provider]] === true);
}

export function stockMediaKeyMissingMessage(provider?: StockMediaProviderId): string {
  return `未配置素材站密钥${provider ? `（${STOCK_MEDIA_PROVIDER_LABELS[provider]}）` : ''}：请在“设置 → AI 创作 → 素材站密钥”中填写，或继续导入本地素材。不会改用付费生图。`;
}

// ---------------------------------------------------------------------------
// URL policy

export interface StockMediaUrlPolicy {
  hosts: readonly string[];
  /** Test-only: allow plain http to 127.0.0.1/localhost (mock relay). Never enabled in production. */
  allowLoopbackHttp?: boolean;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function isAllowedStockMediaUrl(value: string | URL, policy: StockMediaUrlPolicy): boolean {
  let url: URL;
  try { url = typeof value === 'string' ? new URL(value) : value; } catch { return false; }
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (policy.allowLoopbackHttp && LOOPBACK_HOSTS.has(host)) return url.protocol === 'http:' || url.protocol === 'https:';
  if (url.protocol !== 'https:') return false;
  return policy.hosts.some(suffix => host === suffix || host.endsWith(`.${suffix}`));
}

export function defaultStockMediaUrlPolicy(provider: StockMediaProviderId): StockMediaUrlPolicy {
  return { hosts: STOCK_MEDIA_DOWNLOAD_HOSTS[provider] };
}

// ---------------------------------------------------------------------------
// Ratio / orientation / rendition selection

export function parseAspectRatio(ratio: string | undefined): number | undefined {
  const match = ratio?.match(/^(\d{1,2}):(\d{1,2})$/u);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : undefined;
}

export function orientationFromRatio(ratio: string | undefined): StockMediaOrientation {
  const value = parseAspectRatio(ratio) ?? 16 / 9;
  if (value > 1.05) return 'landscape';
  if (value < 0.95) return 'portrait';
  return 'square';
}

export function ratioFromOrientation(orientation: StockMediaOrientation): number {
  return orientation === 'landscape' ? 16 / 9 : orientation === 'portrait' ? 9 / 16 : 1;
}

export function matchesStockMediaOrientation(width: number, height: number, orientation: StockMediaOrientation): boolean {
  if (!(width > 0 && height > 0)) return false;
  const aspect = width / height;
  if (orientation === 'landscape') return aspect > 1.05;
  if (orientation === 'portrait') return aspect < 0.95;
  return aspect >= 0.8 && aspect <= 1.25;
}

export interface StockMediaTarget {
  /** width / height of the target canvas. */
  ratio: number;
  /** Desired short side in pixels (default 1080). */
  shortSide?: number;
  /** Renditions whose long side exceeds this are only used when nothing smaller exists (default 3840). */
  maxLongSide?: number;
}

function renditionScore(rendition: StockMediaRendition, target: Required<StockMediaTarget>): number {
  const aspect = rendition.width / rendition.height;
  const aspectPenalty = Math.abs(Math.log(aspect / target.ratio)) * 4;
  const short = Math.min(rendition.width, rendition.height);
  const resolutionPenalty = short >= target.shortSide
    ? ((short - target.shortSide) / target.shortSide) * 0.5
    : ((target.shortSide - short) / target.shortSide) * 2;
  return aspectPenalty + resolutionPenalty;
}

/** Deterministic best rendition: matching aspect first, then closest to the target resolution (undersize costs more). */
export function selectBestRendition(renditions: readonly StockMediaRendition[], target: StockMediaTarget): StockMediaRendition | undefined {
  const resolved: Required<StockMediaTarget> = {
    ratio: target.ratio > 0 && Number.isFinite(target.ratio) ? target.ratio : 16 / 9,
    shortSide: target.shortSide ?? 1080,
    maxLongSide: target.maxLongSide ?? 3840,
  };
  let candidates = renditions.filter(item => item.width > 0 && item.height > 0 && item.url);
  const mp4 = candidates.filter(item => item.fileType === 'video/mp4');
  if (mp4.length) candidates = mp4;
  const bounded = candidates.filter(item => Math.max(item.width, item.height) <= resolved.maxLongSide);
  if (bounded.length) candidates = bounded;
  return [...candidates].sort((left, right) =>
    renditionScore(left, resolved) - renditionScore(right, resolved)
    || (left.sizeBytes ?? Number.MAX_SAFE_INTEGER) - (right.sizeBytes ?? Number.MAX_SAFE_INTEGER)
    || left.url.localeCompare(right.url))[0];
}

export function filterStockMediaItems(items: readonly StockMediaItem[], request: Pick<ParsedStockMediaSearchRequest, 'orientation' | 'minDurationSeconds' | 'maxDurationSeconds'>): StockMediaItem[] {
  return items.filter((item) => {
    if (!matchesStockMediaOrientation(item.width, item.height, request.orientation)) return false;
    if (item.kind !== 'video') return true;
    const duration = item.durationSeconds ?? 0;
    if (request.minDurationSeconds !== undefined && duration < request.minDurationSeconds) return false;
    if (request.maxDurationSeconds !== undefined && duration > request.maxDurationSeconds) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Response parsers (shapes from documentation — 【未核实】against the live API)

export interface StockMediaParseOptions {
  target?: StockMediaTarget;
  policy?: StockMediaUrlPolicy;
}

const dimension = z.number().finite().nonnegative();
const pageNumber = z.number().int().nonnegative();

/** Pexels GET /videos/search — documented `Video` and `VideoFile` objects. */
const pexelsVideoFileSchema = z.object({
  id: z.number().optional(),
  quality: z.string().nullable().optional(),
  file_type: z.string().nullable().optional(),
  width: dimension.nullable().optional(),
  height: dimension.nullable().optional(),
  fps: z.number().nullable().optional(),
  link: z.string(),
  size: z.number().nonnegative().optional(),
});
const pexelsVideoSchema = z.object({
  id: z.number().int().positive(),
  width: dimension,
  height: dimension,
  url: z.string(),
  image: z.string(),
  duration: z.number().nonnegative(),
  user: z.object({ id: z.number().optional(), name: z.string(), url: z.string() }),
  video_files: z.array(z.unknown()),
});
export const pexelsVideoSearchResponseSchema = z.object({
  page: pageNumber,
  per_page: pageNumber,
  total_results: pageNumber,
  next_page: z.string().nullable().optional(),
  videos: z.array(z.unknown()),
});

/** Pexels GET /v1/search — documented `Photo` object. */
const pexelsPhotoSchema = z.object({
  id: z.number().int().positive(),
  width: dimension,
  height: dimension,
  url: z.string(),
  photographer: z.string(),
  photographer_url: z.string(),
  alt: z.string().nullable().optional(),
  src: z.object({
    original: z.string(),
    large2x: z.string().optional(),
    large: z.string().optional(),
    medium: z.string().optional(),
    small: z.string().optional(),
    portrait: z.string().optional(),
    landscape: z.string().optional(),
    tiny: z.string().optional(),
  }),
});
export const pexelsPhotoSearchResponseSchema = z.object({
  page: pageNumber,
  per_page: pageNumber,
  total_results: pageNumber,
  next_page: z.string().nullable().optional(),
  photos: z.array(z.unknown()),
});

/** Pixabay GET /api/videos/ — `videos.{large,medium,small,tiny}`; unavailable sizes may be empty strings / zero. */
const pixabayVideoRenditionSchema = z.object({
  url: z.string(),
  width: dimension,
  height: dimension,
  size: z.number().nonnegative().optional(),
  thumbnail: z.string().optional(),
});
const pixabayVideoHitSchema = z.object({
  id: z.number().int().positive(),
  pageURL: z.string(),
  duration: z.number().nonnegative(),
  videos: z.object({
    large: z.unknown().optional(),
    medium: z.unknown().optional(),
    small: z.unknown().optional(),
    tiny: z.unknown().optional(),
  }),
  user_id: z.number().int().optional(),
  user: z.string(),
});
/** Pixabay GET /api/ — `fullHDURL` / `imageURL` only exist with full API access. */
const pixabayImageHitSchema = z.object({
  id: z.number().int().positive(),
  pageURL: z.string(),
  previewURL: z.string().optional(),
  webformatURL: z.string(),
  webformatWidth: dimension,
  webformatHeight: dimension,
  largeImageURL: z.string(),
  imageWidth: dimension,
  imageHeight: dimension,
  imageSize: z.number().nonnegative().optional(),
  fullHDURL: z.string().optional(),
  imageURL: z.string().optional(),
  user_id: z.number().int().optional(),
  user: z.string(),
});
export const pixabaySearchResponseSchema = z.object({
  total: pageNumber,
  totalHits: pageNumber,
  hits: z.array(z.unknown()),
});

function invalidResponse(provider: StockMediaProviderId): StockMediaError {
  return new StockMediaError('STOCK_MEDIA_RESPONSE_INVALID', `${STOCK_MEDIA_PROVIDER_LABELS[provider]} 返回的数据结构无法识别，接口可能已变更。`);
}

function parseOuter<T>(schema: z.ZodType<T>, provider: StockMediaProviderId, json: unknown): T {
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw invalidResponse(provider);
  return parsed.data;
}

function safeLink(value: string | undefined, policy: StockMediaUrlPolicy): string {
  return value && isAllowedStockMediaUrl(value, policy) ? value : '';
}

function finishItem(item: Omit<StockMediaItem, 'downloadUrl' | 'fingerprint'>, target: StockMediaTarget): StockMediaItem | null {
  const best = selectBestRendition(item.renditions, target);
  if (!best) return null;
  const width = item.width || best.width;
  const height = item.height || best.height;
  if (!(width > 0 && height > 0)) return null;
  return { ...item, width, height, downloadUrl: best.url, fingerprint: stockMediaFingerprint(item) };
}

function resolveOptions(provider: StockMediaProviderId, options: StockMediaParseOptions) {
  return { policy: options.policy ?? defaultStockMediaUrlPolicy(provider), target: options.target ?? { ratio: 16 / 9 } };
}

export function parsePexelsVideoSearch(json: unknown, options: StockMediaParseOptions = {}): StockMediaSearchResult {
  const { policy, target } = resolveOptions('pexels', options);
  const outer = parseOuter(pexelsVideoSearchResponseSchema, 'pexels', json);
  const items: StockMediaItem[] = [];
  for (const raw of outer.videos) {
    const video = pexelsVideoSchema.safeParse(raw);
    if (!video.success) continue;
    const renditions: StockMediaRendition[] = [];
    for (const rawFile of video.data.video_files) {
      const file = pexelsVideoFileSchema.safeParse(rawFile);
      if (!file.success) continue;
      const url = safeLink(file.data.link, policy);
      const width = file.data.width ?? 0;
      const height = file.data.height ?? 0;
      if (!url || !(width > 0 && height > 0)) continue;
      renditions.push({ url, width, height, ...(file.data.quality ? { quality: file.data.quality } : {}), ...(file.data.file_type ? { fileType: file.data.file_type } : {}), ...(file.data.size ? { sizeBytes: file.data.size } : {}) });
    }
    const item = finishItem({
      id: String(video.data.id), provider: 'pexels', kind: 'video',
      author: video.data.user.name, authorUrl: safeLink(video.data.user.url, policy), sourceUrl: safeLink(video.data.url, policy),
      previewUrl: safeLink(video.data.image, policy), width: video.data.width, height: video.data.height,
      durationSeconds: video.data.duration, license: STOCK_MEDIA_LICENSES.pexels, renditions,
    }, target);
    if (item) items.push(item);
  }
  return { provider: 'pexels', kind: 'video', page: outer.page, perPage: outer.per_page, totalResults: outer.total_results, hasMore: Boolean(outer.next_page), items };
}

function fitWithin(width: number, height: number, maxLong: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxLong || long <= 0) return { width, height };
  const scale = maxLong / long;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function parsePexelsPhotoSearch(json: unknown, options: StockMediaParseOptions = {}): StockMediaSearchResult {
  const { policy, target } = resolveOptions('pexels', options);
  const outer = parseOuter(pexelsPhotoSearchResponseSchema, 'pexels', json);
  const items: StockMediaItem[] = [];
  for (const raw of outer.photos) {
    const photo = pexelsPhotoSchema.safeParse(raw);
    if (!photo.success) continue;
    const { src, width, height } = photo.data;
    // Documented sizes: original (as uploaded), portrait 800x1200 and landscape 1200x627 (cropped).
    const renditions: StockMediaRendition[] = [
      { url: safeLink(src.original, policy), width, height, quality: 'original' },
      { url: safeLink(src.portrait, policy), width: 800, height: 1200, quality: 'portrait' },
      { url: safeLink(src.landscape, policy), width: 1200, height: 627, quality: 'landscape' },
    ].filter(item => item.url);
    const item = finishItem({
      id: String(photo.data.id), provider: 'pexels', kind: 'photo',
      author: photo.data.photographer, authorUrl: safeLink(photo.data.photographer_url, policy), sourceUrl: safeLink(photo.data.url, policy),
      previewUrl: safeLink(src.medium ?? src.small ?? src.tiny ?? src.original, policy), width, height,
      license: STOCK_MEDIA_LICENSES.pexels, renditions,
    }, target);
    if (item) items.push(item);
  }
  return { provider: 'pexels', kind: 'photo', page: outer.page, perPage: outer.per_page, totalResults: outer.total_results, hasMore: Boolean(outer.next_page), items };
}

function pixabayAuthorUrl(user: string, userId: number | undefined, policy: StockMediaUrlPolicy): string {
  // 【未核实】Documented profile URL pattern: https://pixabay.com/users/{USERNAME}-{ID}/
  if (userId === undefined) return '';
  return safeLink(`https://pixabay.com/users/${encodeURIComponent(user)}-${userId}/`, policy);
}

function pixabayPage(page: number, perPage: number, totalHits: number) {
  return { page, perPage, totalResults: totalHits, hasMore: page * perPage < totalHits };
}

export function parsePixabayVideoSearch(json: unknown, options: StockMediaParseOptions & { page?: number; perPage?: number } = {}): StockMediaSearchResult {
  const { policy, target } = resolveOptions('pixabay', options);
  const outer = parseOuter(pixabaySearchResponseSchema, 'pixabay', json);
  const items: StockMediaItem[] = [];
  for (const raw of outer.hits) {
    const hit = pixabayVideoHitSchema.safeParse(raw);
    if (!hit.success) continue;
    const renditions: StockMediaRendition[] = [];
    let previewUrl = '';
    for (const quality of ['large', 'medium', 'small', 'tiny'] as const) {
      const parsed = pixabayVideoRenditionSchema.safeParse(hit.data.videos[quality]);
      if (!parsed.success) continue;
      if (!previewUrl && quality !== 'large') previewUrl = safeLink(parsed.data.thumbnail, policy);
      const url = safeLink(parsed.data.url, policy);
      if (!url || !(parsed.data.width > 0 && parsed.data.height > 0)) continue;
      renditions.push({ url, width: parsed.data.width, height: parsed.data.height, quality, fileType: 'video/mp4', ...(parsed.data.size ? { sizeBytes: parsed.data.size } : {}) });
    }
    const largest = [...renditions].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const item = finishItem({
      id: String(hit.data.id), provider: 'pixabay', kind: 'video',
      author: hit.data.user, authorUrl: pixabayAuthorUrl(hit.data.user, hit.data.user_id, policy), sourceUrl: safeLink(hit.data.pageURL, policy),
      previewUrl, width: largest?.width ?? 0, height: largest?.height ?? 0,
      durationSeconds: hit.data.duration, license: STOCK_MEDIA_LICENSES.pixabay, renditions,
    }, target);
    if (item) items.push(item);
  }
  return { provider: 'pixabay', kind: 'video', ...pixabayPage(options.page ?? 1, options.perPage ?? outer.hits.length, outer.totalHits), items };
}

export function parsePixabayImageSearch(json: unknown, options: StockMediaParseOptions & { page?: number; perPage?: number } = {}): StockMediaSearchResult {
  const { policy, target } = resolveOptions('pixabay', options);
  const outer = parseOuter(pixabaySearchResponseSchema, 'pixabay', json);
  const items: StockMediaItem[] = [];
  for (const raw of outer.hits) {
    const hit = pixabayImageHitSchema.safeParse(raw);
    if (!hit.success) continue;
    const { imageWidth, imageHeight } = hit.data;
    // Documented: largeImageURL max 1280px, webformatURL max 640px, fullHDURL max 1920px, imageURL original.
    const candidates: Array<StockMediaRendition | null> = [
      hit.data.imageURL ? { url: safeLink(hit.data.imageURL, policy), width: imageWidth, height: imageHeight, quality: 'original', ...(hit.data.imageSize ? { sizeBytes: hit.data.imageSize } : {}) } : null,
      hit.data.fullHDURL ? { url: safeLink(hit.data.fullHDURL, policy), ...fitWithin(imageWidth, imageHeight, 1920), quality: 'fullhd' } : null,
      { url: safeLink(hit.data.largeImageURL, policy), ...fitWithin(imageWidth, imageHeight, 1280), quality: 'large' },
      { url: safeLink(hit.data.webformatURL, policy), width: hit.data.webformatWidth, height: hit.data.webformatHeight, quality: 'webformat' },
    ];
    const renditions = candidates.filter((item): item is StockMediaRendition => Boolean(item?.url));
    const item = finishItem({
      id: String(hit.data.id), provider: 'pixabay', kind: 'photo',
      author: hit.data.user, authorUrl: pixabayAuthorUrl(hit.data.user, hit.data.user_id, policy), sourceUrl: safeLink(hit.data.pageURL, policy),
      previewUrl: safeLink(hit.data.webformatURL ?? hit.data.previewURL, policy), width: imageWidth, height: imageHeight,
      license: STOCK_MEDIA_LICENSES.pixabay, renditions,
    }, target);
    if (item) items.push(item);
  }
  return { provider: 'pixabay', kind: 'photo', ...pixabayPage(options.page ?? 1, options.perPage ?? outer.hits.length, outer.totalHits), items };
}

export function parseStockMediaSearch(provider: StockMediaProviderId, kind: StockMediaKind, json: unknown, options: StockMediaParseOptions & { page?: number; perPage?: number } = {}): StockMediaSearchResult {
  if (provider === 'pexels') return kind === 'video' ? parsePexelsVideoSearch(json, options) : parsePexelsPhotoSearch(json, options);
  return kind === 'video' ? parsePixabayVideoSearch(json, options) : parsePixabayImageSearch(json, options);
}

// ---------------------------------------------------------------------------
// Error classification

type HeaderSource = Headers | Record<string, string | null | undefined> | undefined;

function readHeader(headers: HeaderSource, name: string): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name) ?? undefined;
  const record = headers as Record<string, string | null | undefined>;
  const key = Object.keys(record).find(candidate => candidate.toLowerCase() === name.toLowerCase());
  return key ? record[key] ?? undefined : undefined;
}

const MAX_RESET_MS = 24 * 60 * 60 * 1000;

/**
 * Retry-After first; otherwise the documented X-Ratelimit-Reset header:
 * Pexels = UNIX timestamp (seconds) of the reset, Pixabay = seconds until reset. 【未核实】
 */
export function stockMediaRetryAfterMs(provider: StockMediaProviderId, headers: HeaderSource, now = Date.now()): number | undefined {
  const retryAfter = parseRetryAfterMs(readHeader(headers, 'retry-after'), now);
  if (retryAfter !== undefined) return retryAfter;
  const reset = Number(readHeader(headers, 'x-ratelimit-reset'));
  if (!Number.isFinite(reset) || reset < 0) return undefined;
  const ms = provider === 'pexels' && reset > 1_000_000_000 ? reset * 1000 - now : reset * 1000;
  return ms >= 0 ? Math.min(MAX_RESET_MS, Math.round(ms)) : undefined;
}

export interface StockMediaHttpFailureInput {
  provider: StockMediaProviderId;
  status: number;
  /** Response body; used only for classification, never copied into the message. */
  body?: string;
  headers?: HeaderSource;
  /** `download` maps auth/not-found answers on a CDN link to an expired link, not to a bad key. */
  phase?: 'search' | 'download';
  now?: number;
}

export function classifyStockMediaHttpFailure(input: StockMediaHttpFailureInput): StockMediaError {
  const label = STOCK_MEDIA_PROVIDER_LABELS[input.provider];
  const body = (input.body ?? '').slice(0, 2000);
  const { status } = input;
  if (status === 429) {
    const retryAfterMs = stockMediaRetryAfterMs(input.provider, input.headers, input.now);
    const wait = retryAfterMs !== undefined ? `，请约 ${Math.max(1, Math.ceil(retryAfterMs / 1000))} 秒后重试` : '，请稍后重试';
    return new StockMediaError('STOCK_MEDIA_RATE_LIMITED', `${label} 请求过于频繁（429）${wait}。`, true, retryAfterMs, status);
  }
  if (input.phase === 'download') {
    if (status === 401 || status === 403 || status === 404 || status === 410) {
      return new StockMediaError('STOCK_MEDIA_LINK_EXPIRED', `${label} 素材下载链接已失效（${status}），请重新检索后再添加。`, false, undefined, status);
    }
  } else if (status === 401 || status === 403 || (input.provider === 'pixabay' && status === 400 && /\bkey\b/iu.test(body))) {
    return new StockMediaError('STOCK_MEDIA_KEY_INVALID', `${label} 密钥无效或无权限（${status}），请在设置中检查素材站密钥。`, false, undefined, status);
  }
  const failure = classifyHttpStatus(status, body);
  return new StockMediaError('STOCK_MEDIA_REQUEST_FAILED', `${label} ${failure.label}`, failure.retry !== 'never', failure.retryAfterMs, status);
}
