import { createHash } from 'node:crypto';
import { fetchWithNetworkPolicy, readJsonBounded, readTextBounded } from '../src/shared/network-policy';
import { classifyBenchmarkUrl, normalizeBenchmarkSourceUrl } from '../src/shared/benchmark-monitoring';
import type {
  BenchmarkAccount,
  BenchmarkMetrics,
  BenchmarkPostInput,
  BenchmarkSyncState,
} from '../src/shared/types';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
type ConnectorSyncState = Exclude<BenchmarkSyncState, 'manual-only'>;

export interface BenchmarkConnectorResult {
  syncState: ConnectorSyncState;
  displayName: string;
  message: string;
  syncedAt: number | null;
  posts: BenchmarkPostInput[];
}

const BENCHMARK_PAGE_MAX_BYTES = 2 * 1024 * 1024;
const BENCHMARK_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const BILIBILI_MIXIN_KEY_TABLE = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
] as const;

export async function collectBenchmarkAccount(
  account: BenchmarkAccount,
  fetchImpl: FetchLike = fetch,
): Promise<BenchmarkConnectorResult> {
  if (account.platform === 'bilibili') return collectBilibiliAccount(account, fetchImpl);
  return collectEmbeddedAccount(account, fetchImpl);
}

async function collectBilibiliAccount(account: BenchmarkAccount, fetchImpl: FetchLike): Promise<BenchmarkConnectorResult> {
  const capturedAt = Date.now();
  const mid = account.url.match(/space\.bilibili\.com\/(\d+)/iu)?.[1] ?? '';
  if (!mid) return limitedResult(account, 'B站账号链接缺少可识别的用户 ID。');
  try {
    const nav = await fetchJson('https://api.bilibili.com/x/web-interface/nav', fetchImpl);
    const signedUrl = buildBilibiliArchiveUrl(mid, nav);
    const archive = await fetchJson(signedUrl, fetchImpl);
    const archiveCode = finiteNumber(recordValue(archive, ['code']));
    if (archiveCode !== 0) throw new Error(`B站账号作品接口返回 ${archiveCode ?? '未知状态'}。`);
    const bvids = bilibiliArchiveRows(archive).map((row) => textValue(row.bvid)).filter(Boolean).slice(0, 20);
    const details = new Map<string, Record<string, unknown>>();
    await runLimited(bvids, 5, async (bvid) => {
      try {
        const detail = await fetchJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, fetchImpl);
        if (finiteNumber(recordValue(detail, ['code'])) === 0 && isRecord(detail) && isRecord(detail.data)) details.set(bvid, detail.data);
      } catch {
        // The archive row remains usable when a per-video detail request is throttled.
      }
    });
    const posts = parseBilibiliArchivePayload(account, archive, details, capturedAt);
    if (posts.length === 0) return limitedResult(account, 'B站主页可访问，但没有取得公开作品；可能触发了平台限流。');
    const displayName = posts[0]?.author || account.displayName || '';
    return {
      syncState: 'ready',
      displayName,
      message: `已读取 ${posts.length} 条 B站公开作品。`,
      syncedAt: capturedAt,
      posts,
    };
  } catch (apiError) {
    const pageResult = await collectEmbeddedAccount(account, fetchImpl);
    if (pageResult.posts.length > 0) return pageResult;
    const detail = apiError instanceof Error ? apiError.message : String(apiError);
    return { ...pageResult, syncState: 'limited', message: `${detail} ${pageResult.message}`.trim() };
  }
}

async function collectEmbeddedAccount(account: BenchmarkAccount, fetchImpl: FetchLike): Promise<BenchmarkConnectorResult> {
  const capturedAt = Date.now();
  let response: Response;
  try {
    response = await fetchWithNetworkPolicy(account.url, {
      purpose: 'public-research',
      fetchImpl,
      credentials: 'include',
      timeoutMs: 20_000,
      maxBytes: BENCHMARK_PAGE_MAX_BYTES,
      headers: {
        Accept: 'text/html,application/xhtml+xml,*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'User-Agent': BENCHMARK_USER_AGENT,
      },
    });
  } catch (error) {
    return {
      syncState: 'error',
      displayName: account.displayName ?? '',
      message: `账号主页读取失败：${error instanceof Error ? error.message : String(error)}`,
      syncedAt: null,
      posts: [],
    };
  }
  if (response.status === 401 || response.status === 403) {
    return requiresLoginResult(account, `平台返回 ${response.status}，请登录后重试。`);
  }
  if (!response.ok) return limitedResult(account, `账号主页返回 HTTP ${response.status}。`);
  const html = await readTextBounded(response, BENCHMARK_PAGE_MAX_BYTES);
  const posts = parseEmbeddedBenchmarkPosts(account, html, capturedAt);
  if (posts.length > 0) {
    return {
      syncState: 'ready',
      displayName: posts[0]?.author || account.displayName || '',
      message: `已读取 ${posts.length} 条${platformName(account)}公开作品。`,
      syncedAt: capturedAt,
      posts,
    };
  }
  if (looksLikeLoginPage(html, response.url)) {
    return requiresLoginResult(account, '账号主页要求登录或安全验证，请登录后重试。');
  }
  return limitedResult(account, `${platformName(account)}主页已打开，但页面没有公开可解析的作品列表。`);
}

export function parseBilibiliArchivePayload(
  account: BenchmarkAccount,
  payload: unknown,
  details: ReadonlyMap<string, Record<string, unknown>>,
  capturedAt: number,
): BenchmarkPostInput[] {
  return bilibiliArchiveRows(payload).slice(0, 20).flatMap((row): BenchmarkPostInput[] => {
    const bvid = textValue(row.bvid);
    const title = compactText(row.title);
    if (!bvid || !title) return [];
    const detail = details.get(bvid) ?? {};
    const stat = isRecord(detail.stat) ? detail.stat : {};
    const metrics = metricsWithReasons('bilibili', {
      plays: metricNumber(stat.view ?? row.play),
      likes: metricNumber(stat.like),
      comments: metricNumber(stat.reply ?? row.comment),
      favorites: metricNumber(stat.favorite),
      shares: metricNumber(stat.share),
      coins: metricNumber(stat.coin),
      danmaku: metricNumber(stat.danmaku ?? row.video_review),
    });
    return [{
      groupId: accountGroupId(account),
      platform: 'bilibili',
      sourceUrl: `https://www.bilibili.com/video/${bvid}`,
      title,
      author: compactText(row.author) || account.displayName,
      accountUrl: account.url,
      coverUrl: normalizeMediaUrl(textValue(row.pic)),
      publishedAt: timestampMs(row.created),
      durationSeconds: durationSeconds(row.length),
      metrics,
      metricCapturedAt: capturedAt,
    }];
  });
}

export function parseEmbeddedBenchmarkPosts(
  account: BenchmarkAccount,
  html: string,
  capturedAt: number,
): BenchmarkPostInput[] {
  const posts = new Map<string, BenchmarkPostInput>();
  for (const payload of extractEmbeddedJson(html)) {
    walkRecords(payload, (record) => {
      const post = embeddedRecordToPost(account, record, capturedAt);
      if (post) posts.set(post.sourceUrl, post);
    });
  }
  for (const post of extractAnchorPosts(account, html, capturedAt)) {
    if (!posts.has(post.sourceUrl)) posts.set(post.sourceUrl, post);
  }
  return [...posts.values()].slice(0, 30);
}

function embeddedRecordToPost(
  account: BenchmarkAccount,
  record: Record<string, unknown>,
  capturedAt: number,
): BenchmarkPostInput | null {
  const sourceUrl = sourceUrlForRecord(account, record);
  if (!sourceUrl) return null;
  const title = firstPathText(record, [
    ['desc'], ['title'], ['description'], ['objectDesc', 'description'], ['object_desc', 'description'], ['name'],
  ]);
  if (!title) return null;
  const statistics = firstPathRecord(record, [['statistics'], ['stats'], ['stat']]) ?? {};
  const author = firstPathText(record, [
    ['author', 'nickname'], ['author', 'name'], ['owner', 'name'], ['nickname'], ['authorName'], ['author_name'],
  ]) || account.displayName;
  const coverUrl = normalizeMediaUrl(firstPathText(record, [
    ['video', 'cover', 'url_list', '0'], ['video', 'origin_cover', 'url_list', '0'], ['cover', 'url_list', '0'],
    ['coverUrl'], ['cover_url'], ['pic'], ['thumbUrl'], ['thumb_url'],
  ]));
  const metrics = metricsWithReasons(account.platform, {
    plays: metricNumber(statistics.play_count ?? statistics.playCount ?? statistics.view ?? statistics.readCount),
    likes: metricNumber(statistics.digg_count ?? statistics.diggCount ?? statistics.like_count ?? statistics.likeCount ?? statistics.like),
    comments: metricNumber(statistics.comment_count ?? statistics.commentCount ?? statistics.reply),
    favorites: metricNumber(statistics.collect_count ?? statistics.collectCount ?? statistics.favorite_count ?? statistics.favorite),
    shares: metricNumber(statistics.share_count ?? statistics.shareCount ?? statistics.share),
    coins: metricNumber(statistics.coin),
    danmaku: metricNumber(statistics.danmaku ?? statistics.video_review),
  });
  return {
    groupId: accountGroupId(account),
    platform: account.platform,
    sourceUrl,
    title,
    author,
    accountUrl: account.url,
    coverUrl,
    publishedAt: timestampMs(firstPathValue(record, [['create_time'], ['createTime'], ['created'], ['publish_time'], ['publishTime']])),
    durationSeconds: durationSeconds(firstPathValue(record, [['video', 'duration'], ['duration'], ['durationSeconds']])),
    metrics,
    metricCapturedAt: capturedAt,
  };
}

function sourceUrlForRecord(account: BenchmarkAccount, record: Record<string, unknown>): string {
  const direct = firstPathText(record, [['share_url'], ['shareUrl'], ['url'], ['jump_url'], ['jumpUrl']]);
  if (direct) {
    try {
      const normalized = normalizeBenchmarkSourceUrl(direct.startsWith('//') ? `https:${direct}` : direct);
      const classification = classifyBenchmarkUrl(normalized);
      if (classification.platform === account.platform && classification.kind === 'post') return normalized;
    } catch {
      // Continue with platform identifiers.
    }
  }
  if (account.platform === 'douyin') {
    const id = firstPathText(record, [['aweme_id'], ['awemeId'], ['item_id'], ['itemId']]);
    return /^\d{8,}$/u.test(id) ? `https://www.douyin.com/video/${id}` : '';
  }
  if (account.platform === 'bilibili') {
    const bvid = firstPathText(record, [['bvid']]);
    return /^BV[\dA-Za-z]+$/u.test(bvid) ? `https://www.bilibili.com/video/${bvid}` : '';
  }
  return '';
}

function extractEmbeddedJson(html: string): unknown[] {
  const results: unknown[] = [];
  for (const match of html.matchAll(/<script\b[^>]*\bid=["']RENDER_DATA["'][^>]*>([\s\S]*?)<\/script>/giu)) {
    const decoded = safeDecodeURIComponent(match[1].trim());
    const parsed = parseJson(decoded);
    if (parsed !== null) results.push(parsed);
  }
  for (const match of html.matchAll(/<script\b[^>]*\btype=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/giu)) {
    const parsed = parseJson(decodeHtml(match[1].trim()));
    if (parsed !== null) results.push(parsed);
  }
  for (const marker of ['window.__INITIAL_STATE__=', 'window._SSR_HYDRATED_DATA=', 'window.__INITIAL_DATA__=']) {
    const objectText = extractBalancedObjectAfter(html, marker);
    const parsed = parseJson(objectText);
    if (parsed !== null) results.push(parsed);
  }
  return results;
}

function extractAnchorPosts(account: BenchmarkAccount, html: string, capturedAt: number): BenchmarkPostInput[] {
  const posts: BenchmarkPostInput[] = [];
  for (const match of html.matchAll(/<a\b([^>]*\bhref=["'][^"']+["'][^>]*)>([\s\S]*?)<\/a>/giu)) {
    const href = attributeValue(match[1], 'href');
    if (!href) continue;
    let sourceUrl = '';
    try {
      sourceUrl = normalizeBenchmarkSourceUrl(new URL(decodeHtml(href), account.url).toString());
    } catch {
      continue;
    }
    const classification = classifyBenchmarkUrl(sourceUrl);
    if (classification.platform !== account.platform || classification.kind !== 'post') continue;
    const title = compactText(attributeValue(match[1], 'title'))
      || compactText(attributeValue(match[2], 'alt'))
      || compactText(stripTags(match[2]));
    if (!title) continue;
    posts.push({
      groupId: accountGroupId(account),
      platform: account.platform,
      sourceUrl,
      title,
      author: account.displayName,
      accountUrl: account.url,
      coverUrl: normalizeMediaUrl(attributeValue(match[2], 'src')),
      metrics: metricsWithReasons(account.platform, {}),
      metricCapturedAt: capturedAt,
    });
  }
  return posts;
}

function metricsWithReasons(platform: BenchmarkAccount['platform'], values: Partial<Record<keyof BenchmarkMetrics, number | null>>): BenchmarkMetrics {
  const keys = platform === 'bilibili'
    ? ['plays', 'likes', 'comments', 'favorites', 'shares', 'coins', 'danmaku'] as const
    : platform === 'douyin'
      ? ['plays', 'likes', 'comments', 'favorites', 'shares'] as const
      : ['plays', 'likes', 'comments', 'shares'] as const;
  return Object.fromEntries(keys.map((key) => {
    const value = values[key];
    return [key, value === null || value === undefined
      ? { value: null, reason: '平台页面本次未公开该指标' }
      : { value }];
  })) as BenchmarkMetrics;
}

function buildBilibiliArchiveUrl(mid: string, nav: unknown): string {
  const imgUrl = firstPathText(isRecord(nav) ? nav : {}, [['data', 'wbi_img', 'img_url']]);
  const subUrl = firstPathText(isRecord(nav) ? nav : {}, [['data', 'wbi_img', 'sub_url']]);
  const imgKey = fileStem(imgUrl);
  const subKey = fileStem(subUrl);
  if (!imgKey || !subKey) throw new Error('B站未返回可用的 WBI 签名密钥。');
  const rawKey = `${imgKey}${subKey}`;
  const mixinKey = BILIBILI_MIXIN_KEY_TABLE.map((index) => rawKey[index] ?? '').join('').slice(0, 32);
  const params: Record<string, string> = {
    keyword: '',
    mid,
    order: 'pubdate',
    order_avoided: 'true',
    platform: 'web',
    pn: '1',
    ps: '20',
    tid: '0',
    web_location: '1550101',
    wts: String(Math.floor(Date.now() / 1000)),
  };
  const query = Object.keys(params).sort().map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key].replace(/[!'()*]/gu, ''))}`).join('&');
  const signature = createHash('md5').update(`${query}${mixinKey}`).digest('hex');
  return `https://api.bilibili.com/x/space/wbi/arc/search?${query}&w_rid=${signature}`;
}

async function fetchJson(url: string, fetchImpl: FetchLike): Promise<unknown> {
  const response = await fetchWithNetworkPolicy(url, {
    purpose: 'public-research',
    fetchImpl,
    credentials: 'include',
    timeoutMs: 15_000,
    maxBytes: BENCHMARK_PAGE_MAX_BYTES,
    headers: {
      Accept: 'application/json,text/plain,*/*',
      Referer: 'https://www.bilibili.com/',
      'User-Agent': BENCHMARK_USER_AGENT,
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return readJsonBounded(response, BENCHMARK_PAGE_MAX_BYTES);
}

function bilibiliArchiveRows(payload: unknown): Record<string, unknown>[] {
  const rows = firstPathValue(isRecord(payload) ? payload : {}, [['data', 'list', 'vlist']]);
  return Array.isArray(rows) ? rows.filter(isRecord) : [];
}

function requiresLoginResult(account: BenchmarkAccount, message: string): BenchmarkConnectorResult {
  return { syncState: 'requires-login', displayName: account.displayName ?? '', message, syncedAt: null, posts: [] };
}

function limitedResult(account: BenchmarkAccount, message: string): BenchmarkConnectorResult {
  return { syncState: 'limited', displayName: account.displayName ?? '', message, syncedAt: null, posts: [] };
}

function platformName(account: BenchmarkAccount): string {
  return account.platform === 'douyin' ? '抖音' : account.platform === 'wechat-channels' ? '视频号' : 'B站';
}

function accountGroupId(account: BenchmarkAccount): string {
  const suffix = `:${account.platform}`;
  return account.id.endsWith(suffix) ? account.id.slice(0, -suffix.length) : account.id;
}

function looksLikeLoginPage(html: string, finalUrl: string): boolean {
  const sample = `${finalUrl} ${stripTags(html).slice(0, 20_000)}`;
  return /(login|passport|captcha|verify|安全验证|扫码登录|登录后|请登录|访问验证)/iu.test(sample);
}

function walkRecords(value: unknown, visit: (record: Record<string, unknown>) => void): void {
  const queue: unknown[] = [value];
  const seen = new Set<object>();
  let visited = 0;
  while (queue.length > 0 && visited < 50_000) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    visited += 1;
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    const record = current as Record<string, unknown>;
    visit(record);
    queue.push(...Object.values(record));
  }
}

function firstPathValue(record: Record<string, unknown>, paths: readonly (readonly string[])[]): unknown {
  for (const path of paths) {
    let current: unknown = record;
    for (const key of path) {
      if (Array.isArray(current) && /^\d+$/u.test(key)) current = current[Number(key)];
      else if (isRecord(current)) current = current[key];
      else { current = undefined; break; }
    }
    if (current !== undefined && current !== null) return current;
  }
  return undefined;
}

function firstPathText(record: Record<string, unknown>, paths: readonly (readonly string[])[]): string {
  return compactText(firstPathValue(record, paths));
}

function firstPathRecord(record: Record<string, unknown>, paths: readonly (readonly string[])[]): Record<string, unknown> | null {
  const value = firstPathValue(record, paths);
  return isRecord(value) ? value : null;
}

function extractBalancedObjectAfter(input: string, marker: string): string {
  const markerIndex = input.indexOf(marker);
  if (markerIndex < 0) return '';
  const start = input.indexOf('{', markerIndex + marker.length);
  if (start < 0) return '';
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) return input.slice(start, index + 1);
  }
  return '';
}

function durationSeconds(value: unknown): number | null {
  if (typeof value === 'string' && /^\d{1,3}:\d{2}(?::\d{2})?$/u.test(value.trim())) {
    return value.trim().split(':').reduce((total, part) => total * 60 + Number(part), 0);
  }
  const numeric = finiteNumber(value);
  if (numeric === null || numeric < 0) return null;
  return numeric > 10_000 ? Math.round(numeric / 1000) : numeric;
}

function timestampMs(value: unknown): number | null {
  const numeric = finiteNumber(value);
  if (numeric === null || numeric < 0) return null;
  return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
}

function metricNumber(value: unknown): number | null {
  const numeric = finiteNumber(value);
  return numeric !== null && numeric >= 0 ? numeric : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function compactText(value: unknown): string {
  return typeof value === 'string' ? decodeHtml(value).replace(/\s+/gu, ' ').trim() : '';
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function recordValue(value: unknown, path: readonly string[]): unknown {
  return firstPathValue(isRecord(value) ? value : {}, [path]);
}

function normalizeMediaUrl(value: string): string {
  if (!value) return '';
  if (value.startsWith('//')) return `https:${value}`;
  if (value.startsWith('http://')) return `https://${value.slice('http://'.length)}`;
  return /^https?:\/\//iu.test(value) ? value : '';
}

function fileStem(value: string): string {
  return value.match(/\/([^/?#]+)\.[A-Za-z0-9]+(?:[?#]|$)/u)?.[1] ?? '';
}

function parseJson(value: string): unknown | null {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function safeDecodeURIComponent(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

function attributeValue(input: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return decodeHtml(input.match(new RegExp(`\\b${escaped}=["']([^"']*)["']`, 'iu'))?.[1] ?? '');
}

function stripTags(value: string): string {
  return decodeHtml(value.replace(/<script\b[\s\S]*?<\/script>/giu, ' ').replace(/<style\b[\s\S]*?<\/style>/giu, ' ').replace(/<[^>]+>/gu, ' ')).replace(/\s+/gu, ' ').trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

async function runLimited<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await task(item);
    }
  }));
}
