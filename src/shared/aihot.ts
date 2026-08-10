import { fetchWithNetworkPolicy, readTextBounded } from './network-policy';
import type {
  AiHotCategory,
  AiHotDailyItem,
  AiHotDailyReport,
  AiHotDailyResult,
  AiHotItem,
  AiHotItemsResult,
  AiHotQueryRequest,
  AiHotQueryResult,
  AiHotWindow,
} from './types';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
type Clock = () => Date;

interface CachedResponse {
  etag: string;
  data: unknown;
}

interface JsonOutcome {
  data: unknown;
  unchanged: boolean;
  notFound: boolean;
}

interface RawItemsResponse {
  items?: unknown;
  page?: unknown;
}

const AIHOT_BASE_URL = 'https://aihot.virxact.com';
const AIHOT_MAX_BYTES = 2 * 1024 * 1024;
const AIHOT_ITEM_LIMIT = 50;
const AIHOT_USER_AGENT = 'aihot-skill/1.4.1 StoryDream/1.0 (+https://aihot.virxact.com/aihot-skill/)';
const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_BACKFILL_MS = 72 * 60 * 60 * 1000;

const CATEGORY_LABELS: Record<AiHotCategory, string> = {
  'ai-models': '模型',
  'ai-products': '产品',
  industry: '行业',
  paper: '论文',
  tip: '技巧',
};

export function createAiHotQueryClient(
  fetchImpl: FetchLike = fetchAiHotUrl,
  now: Clock = () => new Date(),
): (request: AiHotQueryRequest) => Promise<AiHotQueryResult> {
  const cache = new Map<string, CachedResponse>();
  return async (request) => executeAiHotQuery(validateRequest(request), fetchImpl, cache, now);
}

export const queryAiHot = createAiHotQueryClient();

async function executeAiHotQuery(
  request: AiHotQueryRequest,
  fetchImpl: FetchLike,
  cache: Map<string, CachedResponse>,
  now: Clock,
): Promise<AiHotQueryResult> {
  const requestedAt = now().toISOString();
  if (request.mode === 'daily') {
    return queryDaily(request, requestedAt, fetchImpl, cache, now);
  }
  return queryItems(request, requestedAt, fetchImpl, cache, now);
}

async function queryItems(
  request: Exclude<AiHotQueryRequest, { mode: 'daily' }>,
  requestedAt: string,
  fetchImpl: FetchLike,
  cache: Map<string, CachedResponse>,
  now: Clock,
): Promise<AiHotItemsResult> {
  const parameters = itemQueryParameters(request);
  const firstUrl = buildItemsUrl(parameters);
  let outcome = await requestJson(firstUrl, fetchImpl, cache);
  let response = asRecord(outcome.data) as RawItemsResponse;
  let items = normalizeItems(response.items);
  let fallbackToAll = false;
  const warnings: string[] = [];

  if (request.mode === 'search' && items.length === 0) {
    const fallbackUrl = buildItemsUrl({ ...parameters, mode: 'all' });
    outcome = await requestJson(fallbackUrl, fetchImpl, cache);
    response = asRecord(outcome.data) as RawItemsResponse;
    items = normalizeItems(response.items);
    fallbackToAll = items.length > 0;
    if (fallbackToAll) warnings.push('精选池未找到相关条目，以下结果来自全部公开动态，尚未进入精选。');
  }

  if (request.mode === 'recent' && request.days > 1 && request.days < 7) {
    const cutoff = now().getTime() - request.days * DAY_MS;
    items = items.filter((item) => timelineTimestamp(item) >= cutoff);
  }

  const page = asRecord(response.page);
  const nextCursor = compactText(page.nextCursor, 4096);
  return {
    kind: 'items',
    mode: request.mode,
    requestedAt,
    receivedAt: now().toISOString(),
    queryLabel: queryLabel(request),
    unchanged: outcome.unchanged,
    warnings,
    items,
    count: items.length,
    hasMore: page.hasMore === true,
    nextCursor: nextCursor || undefined,
    fallbackToAll,
  };
}

async function queryDaily(
  request: Extract<AiHotQueryRequest, { mode: 'daily' }>,
  requestedAt: string,
  fetchImpl: FetchLike,
  cache: Map<string, CachedResponse>,
  now: Clock,
): Promise<AiHotDailyResult> {
  const requestedDate = request.date;
  const requestedPath = requestedDate ? `/api/v1/dailies/${requestedDate}` : '/api/v1/dailies/latest';
  let outcome = await requestJson(new URL(requestedPath, AIHOT_BASE_URL), fetchImpl, cache, true);
  let fallbackDate: string | undefined;
  const warnings: string[] = [];

  if (outcome.notFound) {
    const indexUrl = new URL('/api/v1/dailies', AIHOT_BASE_URL);
    indexUrl.searchParams.set('limit', '7');
    const indexOutcome = await requestJson(indexUrl, fetchImpl, cache);
    const dates = normalizeDailyIndexDates(asRecord(indexOutcome.data).items);
    fallbackDate = dates[0];
    if (!fallbackDate) {
      return {
        kind: 'daily',
        mode: 'daily',
        requestedAt,
        receivedAt: now().toISOString(),
        requestedDate,
        queryLabel: requestedDate ? `${requestedDate} AI 日报` : '最新 AI 日报',
        unchanged: indexOutcome.unchanged,
        warnings: ['AIHOT 当前没有可用日报。'],
        report: null,
      };
    }
    outcome = await requestJson(new URL(`/api/v1/dailies/${fallbackDate}`, AIHOT_BASE_URL), fetchImpl, cache, true);
    if (outcome.notFound) {
      return {
        kind: 'daily',
        mode: 'daily',
        requestedAt,
        receivedAt: now().toISOString(),
        requestedDate,
        fallbackDate,
        queryLabel: `${fallbackDate} AI 日报`,
        unchanged: false,
        warnings: ['AIHOT 日报索引已更新，但对应日报暂不可用。'],
        report: null,
      };
    }
    warnings.push(`${requestedDate ?? '最新日报'}暂不可用，已显示最近可用的 ${fallbackDate} 日报。`);
  }

  const report = normalizeDailyReport(asRecord(outcome.data).report);
  if (!report) throw new Error('AIHOT 返回的日报结构无效。');
  return {
    kind: 'daily',
    mode: 'daily',
    requestedAt,
    receivedAt: now().toISOString(),
    requestedDate,
    fallbackDate,
    queryLabel: `${report.date} AI 日报`,
    unchanged: outcome.unchanged,
    warnings,
    report,
  };
}

function itemQueryParameters(request: Exclude<AiHotQueryRequest, { mode: 'daily' }>): {
  mode: 'selected' | 'all';
  window: AiHotWindow;
  category?: AiHotCategory;
  query?: string;
} {
  switch (request.mode) {
    case 'selected': return { mode: 'selected', window: request.window };
    case 'all': return { mode: 'all', window: request.window };
    case 'category': return { mode: 'selected', window: request.window, category: request.category };
    case 'recent': return { mode: 'selected', window: request.days === 1 ? '24h' : '7d' };
    case 'search': return { mode: 'selected', window: request.window, query: request.query };
  }
}

function buildItemsUrl(parameters: ReturnType<typeof itemQueryParameters>): URL {
  const url = new URL('/api/v1/items', AIHOT_BASE_URL);
  url.searchParams.set('mode', parameters.mode);
  url.searchParams.set('window', parameters.window);
  url.searchParams.set('by', 'timeline');
  url.searchParams.set('limit', String(AIHOT_ITEM_LIMIT));
  if (parameters.category) url.searchParams.set('category', parameters.category);
  if (parameters.query) url.searchParams.set('q', parameters.query);
  return url;
}

async function requestJson(
  url: URL,
  fetchImpl: FetchLike,
  cache: Map<string, CachedResponse>,
  allowNotFound = false,
): Promise<JsonOutcome> {
  const key = url.href;
  const cached = cache.get(key);
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchImpl(key, {
        headers: {
          Accept: 'application/json',
          ...(cached?.etag ? { 'If-None-Match': cached.etag } : {}),
        },
      });
      if (response.status === 304) {
        if (!cached) throw new Error('AIHOT 返回未修改状态，但本地没有可复用的数据。');
        return { data: cached.data, unchanged: true, notFound: false };
      }
      if (response.status === 404 && allowNotFound) {
        return { data: null, unchanged: false, notFound: true };
      }
      if (response.ok) {
        const data = parseJson(await readTextBounded(response, AIHOT_MAX_BYTES));
        const etag = response.headers.get('etag')?.trim();
        if (etag) cache.set(key, { etag, data });
        return { data, unchanged: false, notFound: false };
      }
      if (response.status >= 500 && attempt < 2) {
        await delay(250 * (2 ** attempt));
        continue;
      }
      throw await httpError(response);
    } catch (error) {
      lastError = error;
      if (attempt >= 2 || isNonRetryableError(error)) throw error;
      await delay(250 * (2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('AIHOT 请求失败。');
}

async function httpError(response: Response): Promise<Error> {
  const retryAfter = response.headers.get('retry-after')?.trim();
  const text = await readTextBounded(response, AIHOT_MAX_BYTES).catch(() => '');
  let code = '';
  let requestId = '';
  try {
    const problem = asRecord(parseJson(text));
    code = compactText(problem.code, 128);
    requestId = compactText(problem.requestId, 256);
  } catch {
    // The CDN can return a non-Problem response.
  }
  const suffix = requestId ? `（请求编号 ${requestId}）` : '';
  if (response.status === 429) {
    return new Error(`AIHOT 请求过于频繁${retryAfter ? `，请在 ${retryAfter} 秒后重试` : ''}${suffix}。`);
  }
  if (response.status === 400 || code === 'invalid_request') return new Error(`AIHOT 查询参数无效${suffix}。`);
  if (response.status === 404) return new Error(`AIHOT 未找到对应内容${suffix}。`);
  if (response.status >= 500) return new Error(`AIHOT 暂时不可用${suffix}。`);
  return new Error(`AIHOT 请求失败（HTTP ${response.status}）${suffix}。`);
}

function normalizeItems(value: unknown): AiHotItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, AIHOT_ITEM_LIMIT).map(normalizeItem).filter((item): item is AiHotItem => item !== null);
}

function normalizeItem(value: unknown): AiHotItem | null {
  const item = asRecord(value);
  const links = asRecord(item.links);
  const source = asRecord(item.source);
  const id = compactText(item.id, 256);
  const title = compactText(item.title, 500);
  const sourceName = compactText(source.name, 256);
  const aihotUrl = publicHttpUrl(links.aihot);
  const originalUrl = publicHttpUrl(links.original);
  const discoveredAt = dateString(item.discoveredAt);
  if (!id || !title || !sourceName || !aihotUrl || !originalUrl || !discoveredAt) return null;
  const publishedAt = dateString(item.publishedAt) || undefined;
  return {
    id,
    title,
    originalTitle: compactText(item.originalTitle, 500) || undefined,
    summary: compactText(item.summary, 2400) || undefined,
    sourceName,
    aihotUrl,
    originalUrl,
    publishedAt,
    discoveredAt,
    displayedAt: publishedAt || discoveredAt,
    displayedAtKind: publishedAt ? 'published' : 'discovered',
    category: compactText(item.category, 128) || null,
    score: boundedScore(item.score),
    selected: item.selected === true,
  };
}

function normalizeDailyReport(value: unknown): AiHotDailyReport | null {
  const report = asRecord(value);
  const links = asRecord(report.links);
  const date = isoDate(report.date);
  const generatedAt = dateString(report.generatedAt);
  const windowStart = dateString(report.windowStart);
  const windowEnd = dateString(report.windowEnd);
  const aihotUrl = publicHttpUrl(links.aihot);
  if (!date || !generatedAt || !windowStart || !windowEnd || !aihotUrl) return null;
  const leadValue = asRecord(report.lead);
  const leadTitle = compactText(leadValue.title, 500);
  const leadParagraph = compactText(leadValue.leadParagraph, 2400);
  const sections = Array.isArray(report.sections)
    ? report.sections.slice(0, 20).map((value) => {
      const section = asRecord(value);
      const label = compactText(section.label, 256);
      const items = Array.isArray(section.items)
        ? section.items.slice(0, 50).map(normalizeDailyItem).filter((item): item is AiHotDailyItem => item !== null)
        : [];
      return label && items.length ? { label, items } : null;
    }).filter((section): section is { label: string; items: AiHotDailyItem[] } => section !== null)
    : [];
  const flashes = Array.isArray(report.flashes)
    ? report.flashes.slice(0, 50).map(normalizeDailyItem).filter((item): item is AiHotDailyItem => item !== null)
    : [];
  return {
    date,
    generatedAt,
    windowStart,
    windowEnd,
    aihotUrl,
    lead: leadTitle && leadParagraph ? { title: leadTitle, paragraph: leadParagraph } : null,
    sections,
    flashes,
  };
}

function normalizeDailyItem(value: unknown): AiHotDailyItem | null {
  const item = asRecord(value);
  const source = asRecord(item.source);
  const links = asRecord(item.links);
  const title = compactText(item.title, 500);
  const sourceName = compactText(source.name, 256);
  const aihotUrl = publicHttpUrl(links.aihot) || undefined;
  const originalUrl = publicHttpUrl(links.original);
  if (!title || !sourceName || !originalUrl) return null;
  const key = aihotUrl || originalUrl;
  return {
    id: stableId(`${title}|${key}`),
    title,
    summary: compactText(item.summary, 2400) || undefined,
    sourceName,
    aihotUrl,
    originalUrl,
    publishedAt: dateString(item.publishedAt) || undefined,
  };
}

function normalizeDailyIndexDates(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => isoDate(asRecord(item).date)).filter(Boolean))].sort((a, b) => b.localeCompare(a));
}

function timelineTimestamp(item: AiHotItem): number {
  const discoveredAt = new Date(item.discoveredAt).getTime();
  if (!item.publishedAt) return discoveredAt;
  const publishedAt = new Date(item.publishedAt).getTime();
  return discoveredAt - publishedAt > HISTORY_BACKFILL_MS ? publishedAt : discoveredAt;
}

function queryLabel(request: Exclude<AiHotQueryRequest, { mode: 'daily' }>): string {
  const windowLabel = request.mode === 'recent'
    ? `最近 ${request.days} 天`
    : request.window === '24h' ? '过去 24 小时' : '最近 7 天';
  switch (request.mode) {
    case 'selected': return `${windowLabel}精选`;
    case 'all': return `${windowLabel}全部动态`;
    case 'category': return `${windowLabel} · ${CATEGORY_LABELS[request.category]}`;
    case 'recent': return `${windowLabel}精选`;
    case 'search': return `“${request.query}” · ${windowLabel}`;
  }
}

function validateRequest(request: AiHotQueryRequest): AiHotQueryRequest {
  if (!request || typeof request !== 'object') throw new Error('AIHOT 查询参数无效。');
  switch (request.mode) {
    case 'daily':
      if (request.date && !isoDate(request.date)) throw new Error('AIHOT 日报日期无效。');
      return request;
    case 'selected':
    case 'all':
      if (request.window !== '24h' && request.window !== '7d') throw new Error('AIHOT 时间窗口无效。');
      return request;
    case 'category':
      if (!(request.category in CATEGORY_LABELS) || (request.window !== '24h' && request.window !== '7d')) {
        throw new Error('AIHOT 分类查询参数无效。');
      }
      return request;
    case 'recent':
      if (!Number.isInteger(request.days) || request.days < 1 || request.days > 7) throw new Error('AIHOT 最近天数必须在 1 到 7 之间。');
      return request;
    case 'search': {
      const query = request.query.trim();
      if (query.length < 2 || query.length > 200 || (request.window !== '24h' && request.window !== '7d')) {
        throw new Error('AIHOT 搜索参数无效。');
      }
      return { ...request, query };
    }
    default:
      throw new Error('AIHOT 查询模式无效。');
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('AIHOT 返回了无法解析的数据。');
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function compactText(value: unknown, max: number): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/gu, ' ').trim().slice(0, max)
    : '';
}

function publicHttpUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

function dateString(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function isoDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return '';
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? '' : value;
}

function boundedScore(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

function stableId(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `aihot-${(hash >>> 0).toString(36)}`;
}

function isNonRetryableError(error: unknown): boolean {
  return error instanceof Error && /^AIHOT (?:查询参数无效|未找到|请求过于频繁)/u.test(error.message);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function fetchAiHotUrl(url: string, init?: RequestInit): Promise<Response> {
  return fetchWithNetworkPolicy(url, {
    purpose: 'public-research',
    timeoutMs: 15_000,
    maxBytes: AIHOT_MAX_BYTES,
    ...init,
    headers: {
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'User-Agent': AIHOT_USER_AGENT,
      ...Object.fromEntries(new Headers(init?.headers).entries()),
    },
  });
}
