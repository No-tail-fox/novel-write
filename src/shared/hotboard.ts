import { fetchWithNetworkPolicy, readTextBounded } from './network-policy';
import { HOT_BOARD_SOURCE_ASSESSMENTS } from './hotboard-catalog';
import type {
  HotBoardCategory,
  HotBoardItem,
  HotBoardPlatform,
  HotBoardPlatformStatus,
  HotBoardSnapshot,
} from './types';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface PlatformDefinition {
  id: HotBoardPlatform;
  label: string;
  category: HotBoardCategory;
  sourceId: 'uapi' | 'techmeme';
  sourceLabel: string;
}

interface UapiHotBoardEntry {
  index?: unknown;
  title?: unknown;
  url?: unknown;
  hot_value?: unknown;
  extra?: unknown;
}

interface UapiHotBoardResponse {
  update_time?: unknown;
  list?: unknown;
}

interface PlatformOutcome {
  status: HotBoardPlatformStatus;
  items: HotBoardItem[];
}

const HOT_BOARD_MAX_BYTES = 2 * 1024 * 1024;
const HOT_BOARD_ITEM_LIMIT = 20;
const HOT_BOARD_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 StoryDream/1.0';

const UAPI_PLATFORMS: readonly PlatformDefinition[] = [
  { id: 'weibo', label: '微博', category: 'social', sourceId: 'uapi', sourceLabel: 'UAPI' },
  { id: 'douyin', label: '抖音', category: 'video', sourceId: 'uapi', sourceLabel: 'UAPI' },
  { id: 'xiaohongshu', label: '小红书', category: 'social', sourceId: 'uapi', sourceLabel: 'UAPI' },
  { id: 'zhihu', label: '知乎', category: 'knowledge', sourceId: 'uapi', sourceLabel: 'UAPI' },
  { id: 'toutiao', label: '今日头条', category: 'news', sourceId: 'uapi', sourceLabel: 'UAPI' },
  { id: 'bilibili', label: 'B 站', category: 'video', sourceId: 'uapi', sourceLabel: 'UAPI' },
  { id: 'baidu', label: '百度', category: 'news', sourceId: 'uapi', sourceLabel: 'UAPI' },
  { id: 'thepaper', label: '澎湃新闻', category: 'news', sourceId: 'uapi', sourceLabel: 'UAPI' },
];

const TECHMEME_PLATFORM: PlatformDefinition = {
  id: 'techmeme',
  label: '科技 / AI',
  category: 'tech',
  sourceId: 'techmeme',
  sourceLabel: 'Techmeme',
};

export async function fetchHotBoardSnapshot(fetchImpl: FetchLike = fetchHotBoardUrl): Promise<HotBoardSnapshot> {
  const fetchedAt = new Date().toISOString();
  const outcomes = await Promise.all([
    ...UAPI_PLATFORMS.map((platform) => fetchUapiPlatform(platform, fetchImpl, fetchedAt)),
    fetchTechmemePlatform(fetchImpl, fetchedAt),
  ]);
  const items = outcomes.flatMap((outcome) => outcome.items).sort(compareHotBoardItems);
  const platformStatuses = outcomes.map((outcome) => outcome.status);
  const warnings = platformStatuses
    .filter((status) => status.state === 'failed')
    .map((status) => `${status.label}刷新失败：${status.message || '连接失败'}`);
  return {
    fetchedAt,
    items,
    platformStatuses,
    sourceAssessments: HOT_BOARD_SOURCE_ASSESSMENTS.map((source) => ({ ...source })),
    warnings,
  };
}

async function fetchUapiPlatform(
  platform: PlatformDefinition,
  fetchImpl: FetchLike,
  fetchedAt: string,
): Promise<PlatformOutcome> {
  try {
    const response = await fetchImpl(`https://uapis.cn/api/v1/misc/hotboard?type=${platform.id}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = JSON.parse(await readTextBounded(response, HOT_BOARD_MAX_BYTES)) as UapiHotBoardResponse;
    const updatedAt = asDateString(data.update_time) || fetchedAt;
    const entries = Array.isArray(data.list) ? data.list.slice(0, HOT_BOARD_ITEM_LIMIT) : [];
    const items = entries
      .map((entry, index) => normalizeUapiItem(platform, entry, index, updatedAt))
      .filter((item): item is HotBoardItem => item !== null);
    return {
      items,
      status: {
        platform: platform.id,
        label: platform.label,
        state: items.length > 0 ? 'ready' : 'empty',
        count: items.length,
        updatedAt,
      },
    };
  } catch (error) {
    return failedOutcome(platform, error);
  }
}

async function fetchTechmemePlatform(fetchImpl: FetchLike, fetchedAt: string): Promise<PlatformOutcome> {
  try {
    const response = await fetchImpl('https://www.techmeme.com/feed.xml', {
      headers: { Accept: 'application/rss+xml,application/xml,text/xml' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await readTextBounded(response, HOT_BOARD_MAX_BYTES);
    const channelUpdatedAt = asDateString(extractXmlTag(xml, 'pubDate')) || fetchedAt;
    const items = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/giu)]
      .slice(0, HOT_BOARD_ITEM_LIMIT)
      .map(([block], index) => normalizeTechmemeItem(block, index, channelUpdatedAt))
      .filter((item): item is HotBoardItem => item !== null);
    return {
      items,
      status: {
        platform: TECHMEME_PLATFORM.id,
        label: TECHMEME_PLATFORM.label,
        state: items.length > 0 ? 'ready' : 'empty',
        count: items.length,
        updatedAt: channelUpdatedAt,
      },
    };
  } catch (error) {
    return failedOutcome(TECHMEME_PLATFORM, error);
  }
}

function normalizeUapiItem(
  platform: PlatformDefinition,
  input: unknown,
  fallbackIndex: number,
  updatedAt: string,
): HotBoardItem | null {
  if (!isRecord(input)) return null;
  const entry = input as UapiHotBoardEntry;
  const title = compactText(entry.title);
  const url = publicHttpUrl(entry.url);
  if (!title || !url) return null;
  const rank = positiveInteger(entry.index) || fallbackIndex + 1;
  const extra = isRecord(entry.extra) ? entry.extra : {};
  const summary = compactText(extra.desc ?? extra.description).slice(0, 280) || undefined;
  const publishedAt = asDateString(extra.pubdate ?? extra.publish_time ?? extra.pub_time) || undefined;
  return {
    id: stableHotBoardItemId(platform.id, rank, url),
    platform: platform.id,
    platformLabel: platform.label,
    category: platform.category,
    rank,
    title,
    url,
    hotValue: compactText(entry.hot_value),
    summary,
    publishedAt,
    updatedAt,
    sourceId: platform.sourceId,
    sourceLabel: platform.sourceLabel,
  };
}

function normalizeTechmemeItem(block: string, index: number, fallbackUpdatedAt: string): HotBoardItem | null {
  const title = cleanXmlText(extractXmlTag(block, 'title'));
  const url = publicHttpUrl(cleanXmlText(extractXmlTag(block, 'link')));
  if (!title || !url) return null;
  const publishedAt = asDateString(cleanXmlText(extractXmlTag(block, 'pubDate'))) || undefined;
  const summary = cleanXmlText(extractXmlTag(block, 'description')).slice(0, 280) || undefined;
  return {
    id: stableHotBoardItemId(TECHMEME_PLATFORM.id, index + 1, url),
    platform: TECHMEME_PLATFORM.id,
    platformLabel: TECHMEME_PLATFORM.label,
    category: TECHMEME_PLATFORM.category,
    rank: index + 1,
    title,
    url,
    hotValue: '',
    summary,
    publishedAt,
    updatedAt: publishedAt || fallbackUpdatedAt,
    sourceId: TECHMEME_PLATFORM.sourceId,
    sourceLabel: TECHMEME_PLATFORM.sourceLabel,
  };
}

function failedOutcome(platform: PlatformDefinition, error: unknown): PlatformOutcome {
  return {
    items: [],
    status: {
      platform: platform.id,
      label: platform.label,
      state: 'failed',
      count: 0,
      message: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
    },
  };
}

function compareHotBoardItems(a: HotBoardItem, b: HotBoardItem): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  return platformOrder(a.platform) - platformOrder(b.platform);
}

function platformOrder(platform: HotBoardPlatform): number {
  const order: readonly HotBoardPlatform[] = ['weibo', 'douyin', 'xiaohongshu', 'zhihu', 'toutiao', 'bilibili', 'baidu', 'thepaper', 'techmeme'];
  return order.indexOf(platform);
}

function stableHotBoardItemId(platform: HotBoardPlatform, rank: number, url: string): string {
  let hash = 2166136261;
  for (let index = 0; index < url.length; index += 1) {
    hash ^= url.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${platform}-${rank}-${(hash >>> 0).toString(36)}`;
}

function extractXmlTag(input: string, tag: string): string {
  const match = input.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'iu'));
  return match?.[1] ?? '';
}

function cleanXmlText(input: string): string {
  return decodeEntities(input.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/giu, '$1').replace(/<[^>]+>/gu, ' '));
}

function decodeEntities(input: string): string {
  const named: Record<string, string> = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"' };
  return input
    .replace(/&#(\d+);/gu, (_match, value: string) => String.fromCodePoint(Number(value)))
    .replace(/&#x([0-9a-f]+);/giu, (_match, value: string) => String.fromCodePoint(Number.parseInt(value, 16)))
    .replace(/&([a-z]+);/giu, (match, value: string) => named[value.toLowerCase()] ?? match)
    .replace(/\s+/gu, ' ')
    .trim();
}

function compactText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/gu, ' ').trim()
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

function positiveInteger(value: unknown): number {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function asDateString(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function fetchHotBoardUrl(url: string, init?: RequestInit): Promise<Response> {
  return fetchWithNetworkPolicy(url, {
    purpose: 'public-research',
    timeoutMs: 12_000,
    maxBytes: HOT_BOARD_MAX_BYTES,
    ...init,
    headers: {
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'User-Agent': HOT_BOARD_USER_AGENT,
      ...Object.fromEntries(new Headers(init?.headers).entries()),
    },
  });
}
