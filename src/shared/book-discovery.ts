import { benchmarkOpportunityTotal } from './benchmark-monitoring';
import { fetchWithNetworkPolicy, type NetworkFetch, type NetworkLookup } from './network-policy';
import type {
  BenchmarkSelectionScore,
  BookDiscoveryItem,
  BookDiscoveryRequest,
  BookDiscoveryResult,
} from './types';

const DANGDANG_SEARCH_URL = 'https://search.dangdang.com/';
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 36;

interface BookDiscoveryRuntimeOptions {
  fetchImpl?: NetworkFetch;
  lookup?: NetworkLookup;
  now?: () => number;
}

interface OpportunityInput {
  rank: number;
  reviewCount?: number;
  price?: string;
  query: string;
  title: string;
}

interface ParsedElement {
  attributes: Record<string, string>;
  content: string;
}

const previewCatalog: Array<{
  sourceId: string;
  name: string;
  author: string;
  publisher: string;
  category: string;
  keyword: string;
  sellPoint: string;
  audience: string;
}> = [
  { sourceId: 'preview-huangdi-neijing', name: '黄帝内经养生智慧', author: '曲黎敏', publisher: '长江文艺出版社', category: '健康·中医食疗', keyword: '黄帝内经 中医养生 生活习惯', sellPoint: '用通俗语言解释传统养生观念与日常生活方式', audience: '关注生活习惯与传统养生知识的中老年读者' },
  { sourceId: 'preview-food-truth', name: '中国居民膳食指南', author: '中国营养学会', publisher: '人民卫生出版社', category: '健康·饮食营养', keyword: '膳食指南 营养搭配 健康饮食', sellPoint: '权威膳食框架适合拆成家庭餐桌上的具体选择', audience: '关注家庭饮食与营养搭配的读者' },
  { sourceId: 'preview-exercise-brain', name: '运动改造大脑', author: '约翰·瑞迪', publisher: '浙江人民出版社', category: '认知思维·成长', keyword: '运动 大脑 情绪 管理', sellPoint: '把运动与专注、情绪和学习状态连接起来', audience: '关注自我成长、运动习惯与认知提升的读者' },
  { sourceId: 'preview-parenting', name: '正面管教', author: '简·尼尔森', publisher: '北京联合出版公司', category: '育儿·亲子', keyword: '正面管教 亲子沟通 家庭教育', sellPoint: '用可执行的沟通方法化解家庭教育中的常见冲突', audience: '希望改善亲子沟通的家长' },
  { sourceId: 'preview-finance', name: '小狗钱钱', author: '博多·舍费尔', publisher: '四川少年儿童出版社', category: '财商·理财', keyword: '财商 理财 金钱观 成长', sellPoint: '用故事降低财商知识门槛，适合亲子共同阅读', audience: '理财入门读者与希望培养孩子财商的家长' },
  { sourceId: 'preview-culture', name: '典籍里的中国', author: '有书', publisher: '天地出版社', category: '传统文化·国学', keyword: '传统文化 典籍 国学 历史', sellPoint: '从典籍故事切入传统文化，画面感和知识点兼具', audience: '喜欢历史故事与传统文化的读者' },
];

export async function discoverDangdangBooks(
  rawRequest: BookDiscoveryRequest,
  options: BookDiscoveryRuntimeOptions = {},
): Promise<BookDiscoveryResult> {
  const request = normalizeRequest(rawRequest);
  const now = options.now ?? Date.now;
  try {
    const url = new URL(DANGDANG_SEARCH_URL);
    url.searchParams.set('key', request.query);
    url.searchParams.set('act', 'input');
    const response = await fetchWithNetworkPolicy(url, {
      purpose: 'public-research',
      fetchImpl: options.fetchImpl,
      lookup: options.lookup,
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'zh-CN,zh;q=0.9',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0 Safari/537.36',
      },
      maxBytes: 2 * 1024 * 1024,
      timeoutMs: 20_000,
    });
    if (!response.ok) throw new Error(`当当搜索返回 HTTP ${response.status}`);
    const html = await decodeDangdangHtml(response);
    const items = parseDangdangSearchHtml(html, request);
    if (items.length === 0) throw new Error('当当公开搜索页没有返回可识别的图书结果');
    return {
      query: request.query,
      track: request.track,
      source: 'dangdang',
      sourceState: 'live',
      sourceLabel: '真实公开数据',
      fetchedAt: now(),
      items,
      message: `已按当当公开搜索顺序整理 ${items.length} 本书。公开评论量不是销量，智能建议仅供选题参考。`,
    };
  } catch (error) {
    return buildBookDiscoveryFallback(request, error instanceof Error ? error.message : String(error), now());
  }
}

export function parseDangdangSearchHtml(html: string, rawRequest: BookDiscoveryRequest): BookDiscoveryItem[] {
  const request = normalizeRequest(rawRequest);
  const items: BookDiscoveryItem[] = [];
  const productPattern = /<li\b(?<attributes>[^>]*)\bid\s*=\s*["']p(?<id>\d+)["'][^>]*>(?<content>[\s\S]*?)<\/li>/giu;
  for (const match of html.matchAll(productPattern)) {
    if (items.length >= request.limit) break;
    const attributes = parseAttributes(match.groups?.attributes ?? '');
    const block = match.groups?.content ?? '';
    const sourceId = match.groups?.id ?? '';
    const titleElement = findElementByAttribute(block, 'a', 'name', 'itemlist-title');
    const pictureElement = findElementByClass(block, 'a', 'pic');
    const authorElement = findElementByAttribute(block, 'a', 'name', 'itemlist-author');
    const publisherElement = findElementByAttribute(block, 'a', 'name', 'P_cbs');
    const author = cleanText(authorElement?.content ?? authorElement?.attributes.title ?? '');
    const publisher = cleanText(publisherElement?.content ?? publisherElement?.attributes.title ?? '');
    const rawTitle = cleanText(titleElement?.content ?? titleElement?.attributes.title ?? pictureElement?.attributes.title ?? '');
    const name = cleanBookTitle(rawTitle, author, publisher);
    if (!sourceId || !name) continue;
    const rank = parsePositiveInteger(attributes['ddt-pit']) ?? items.length + 1;
    const price = elementTextByClass(block, 'span', 'search_now_price').replace(/^¥/u, '').trim() || undefined;
    const originalPrice = elementTextByClass(block, 'span', 'search_pre_price').replace(/^¥/u, '').trim() || undefined;
    const reviewElement = findElementByAttribute(block, 'a', 'name', 'itemlist-review')
      ?? findElementByClass(block, 'a', 'search_comment_num');
    const reviewCount = parseCount(cleanText(reviewElement?.content ?? ''));
    const publishDate = block.match(/\/\s*(\d{4}-\d{2}-\d{2})/u)?.[1];
    const image = findImage(block);
    const opportunityScore = scoreBookOpportunity({ rank, reviewCount, price, query: request.query, title: name });
    items.push({
      source: 'dangdang',
      sourceState: 'live',
      sourceId,
      sourceRank: rank,
      rankingLabel: `当当搜索第 ${rank} 位`,
      name,
      author: author || undefined,
      publisher: publisher || undefined,
      publishDate,
      category: request.track,
      keyword: buildKeywords(request.query, name),
      sellPoint: buildSellPoint(name, request.track),
      audience: audienceForTrack(request.track),
      price,
      originalPrice,
      reviewCount,
      url: `https://product.dangdang.com/${sourceId}.html`,
      coverUrl: normalizePublicUrl(image),
      selectionStatus: 'candidate',
      opportunityScore,
      evidence: [],
      note: `来源于当当公开搜索“${request.query}”，按页面顺序列为第 ${rank} 位。`,
      riskNote: riskForTrack(request.track),
    });
  }
  return items;
}

export function scoreBookOpportunity(input: OpportunityInput): BenchmarkSelectionScore {
  const rank = Math.max(1, Math.round(input.rank));
  const reviewSignal = input.reviewCount ? Math.min(18, Math.log10(input.reviewCount + 1) * 4) : 0;
  const numericPrice = Number.parseFloat(input.price ?? '');
  const demand = clampScore(94 - (rank - 1) * 2 + reviewSignal);
  const gap = clampScore(64 + Math.min(16, uniqueKeywordCount(`${input.query} ${input.title}`) * 2));
  const fit = clampScore(70 + (normalizedText(input.title).includes(normalizedText(input.query)) ? 14 : 4));
  const conversion = clampScore(Number.isFinite(numericPrice) && numericPrice >= 18 && numericPrice <= 88 ? 82 : 68);
  const executionEase = clampScore(88 - Math.max(0, input.title.length - 18));
  const total = benchmarkOpportunityTotal({ demand, gap, fit, conversion, executionEase });
  return { demand, gap, fit, conversion, executionEase, total, confidence: 'low', confirmed: false };
}

export function buildBookDiscoveryFallback(
  rawRequest: BookDiscoveryRequest,
  reason: string,
  fetchedAt = Date.now(),
): BookDiscoveryResult {
  const request = normalizeRequest(rawRequest);
  const query = normalizedText(`${request.query} ${request.track}`);
  const matched = previewCatalog.filter((item) => normalizedText(Object.values(item).join(' ')).includes(query)
    || query.split(/\s+/u).some((token) => token.length > 1 && normalizedText(Object.values(item).join(' ')).includes(token)));
  const selected = (matched.length ? matched : previewCatalog).slice(0, request.limit);
  const items = selected.map<BookDiscoveryItem>((item, index) => ({
    source: 'dangdang',
    sourceState: 'preview',
    sourceId: item.sourceId,
    sourceRank: index + 1,
    rankingLabel: '预览推荐',
    name: item.name,
    author: item.author,
    publisher: item.publisher,
    category: item.category,
    keyword: item.keyword,
    sellPoint: item.sellPoint,
    audience: item.audience,
    url: `${DANGDANG_SEARCH_URL}?key=${encodeURIComponent(item.name)}&act=input`,
    selectionStatus: 'candidate',
    opportunityScore: scoreBookOpportunity({ rank: index + 1, query: request.query, title: item.name }),
    evidence: [],
    note: '当前为内置预览推荐，请恢复联网后重新生成以获取当当公开结果。',
    riskNote: riskForTrack(item.category),
  }));
  return {
    query: request.query,
    track: request.track,
    source: 'dangdang',
    sourceState: 'preview',
    sourceLabel: '预览数据',
    fetchedAt,
    items,
    message: `当当暂时无法访问：${reason}。已显示明确标记的预览推荐，不代表实时榜单。`,
  };
}

async function decodeDangdangHtml(response: Response): Promise<string> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  const charset = contentType.match(/charset\s*=\s*([^;\s]+)/u)?.[1] ?? '';
  const encoding = /gbk|gb2312|gb18030/u.test(charset) ? 'gb18030' : 'utf-8';
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function normalizeRequest(input: BookDiscoveryRequest): Required<BookDiscoveryRequest> {
  const query = input.query.trim();
  if (!query) throw new Error('请输入选书主题或书名。');
  return {
    query,
    track: input.track?.trim() || '全部图书',
    limit: Math.min(MAX_LIMIT, Math.max(1, Math.round(input.limit ?? DEFAULT_LIMIT))),
  };
}

function findElementByAttribute(html: string, tag: string, name: string, value: string): ParsedElement | null {
  return findElements(html, tag).find((element) => element.attributes[name.toLowerCase()] === value) ?? null;
}

function findElementByClass(html: string, tag: string, className: string): ParsedElement | null {
  return findElements(html, tag).find((element) => element.attributes.class?.split(/\s+/u).includes(className)) ?? null;
}

function elementTextByClass(html: string, tag: string, className: string): string {
  return cleanText(findElementByClass(html, tag, className)?.content ?? '');
}

function findElements(html: string, tag: string): ParsedElement[] {
  const elements: ParsedElement[] = [];
  const pattern = new RegExp(`<${tag}\\b(?<attributes>[^>]*)>(?<content>[\\s\\S]*?)<\\/${tag}>`, 'giu');
  for (const match of html.matchAll(pattern)) {
    elements.push({ attributes: parseAttributes(match.groups?.attributes ?? ''), content: match.groups?.content ?? '' });
  }
  return elements;
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gu;
  for (const match of source.matchAll(pattern)) {
    attributes[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

function findImage(html: string): string | undefined {
  const pattern = /<img\b(?<attributes>[^>]*)>/giu;
  for (const match of html.matchAll(pattern)) {
    const attributes = parseAttributes(match.groups?.attributes ?? '');
    const candidate = attributes['data-original'] || attributes.src;
    if (candidate && !candidate.includes('url_none')) return candidate;
  }
  return undefined;
}

function normalizePublicUrl(value?: string): string | undefined {
  if (!value) return undefined;
  if (value.startsWith('//')) return `https:${value}`;
  if (/^https?:\/\//iu.test(value)) return value;
  return undefined;
}

function cleanBookTitle(value: string, author: string, publisher: string): string {
  let title = value.replace(/\s+/gu, ' ').trim();
  const commerceSuffix = /(?:正版|全新|旧书|二手|保证质量|电子发票|下单前|欢迎选购)[\s\S]*$/u;
  title = title.replace(commerceSuffix, '').trim();
  if (publisher && title.endsWith(publisher)) title = title.slice(0, -publisher.length).trim();
  if (author) title = title.replace(new RegExp(`\\s*${escapeRegExp(author)}\\s*(?:著|编著|编|译)?\\s*$`, 'u'), '').trim();
  return title || value.trim();
}

function cleanText(value: string): string {
  return decodeHtml(value.replace(/<script\b[\s\S]*?<\/script>/giu, ' ').replace(/<style\b[\s\S]*?<\/style>/giu, ' ').replace(/<br\s*\/?\s*>/giu, ' ').replace(/<[^>]+>/gu, ''))
    .replace(/\s+/gu, ' ')
    .trim();
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"', yen: '¥' };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/giu, (entity, token: string) => {
    if (token.startsWith('#x') || token.startsWith('#X')) return String.fromCodePoint(Number.parseInt(token.slice(2), 16));
    if (token.startsWith('#')) return String.fromCodePoint(Number.parseInt(token.slice(1), 10));
    return named[token.toLowerCase()] ?? entity;
  });
}

function parsePositiveInteger(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseCount(value: string): number | undefined {
  const normalized = value.replace(/,/gu, '').trim();
  const match = normalized.match(/([\d.]+)\s*(万|千)?/u);
  if (!match) return undefined;
  const multiplier = match[2] === '万' ? 10_000 : match[2] === '千' ? 1_000 : 1;
  const parsed = Number.parseFloat(match[1]) * multiplier;
  return Number.isFinite(parsed) ? Math.round(parsed) : undefined;
}

function buildKeywords(query: string, title: string): string {
  const values = [query, ...title.split(/[：:·，,《》\s]+/u)].map((item) => item.trim()).filter((item) => item.length > 1);
  return [...new Set(values)].slice(0, 5).join(' ');
}

function buildSellPoint(name: string, track: string): string {
  if (/健康|养生|中医|抗衰|饮食/u.test(track)) return `从《${name}》提炼可验证的生活知识，用日常场景讲清方法与边界`;
  if (/亲子|育儿|家庭/u.test(track)) return `围绕《${name}》中的家庭场景，提炼家长能立刻理解的沟通方法`;
  if (/财商|理财/u.test(track)) return `用《${name}》中的故事和案例降低理财知识门槛`;
  if (/文化|国学|历史/u.test(track)) return `从《${name}》提炼有出处的文化知识与人物故事`;
  return `围绕《${name}》的核心观点建立问题、证据与行动建议`;
}

function audienceForTrack(track: string): string {
  if (/健康|养生|中医|抗衰/u.test(track)) return '关注健康知识与生活习惯的中老年读者';
  if (/亲子|育儿/u.test(track)) return '关注家庭教育与亲子沟通的家长';
  if (/财商|理财/u.test(track)) return '希望建立基础财商与理财习惯的读者';
  return '希望通过短视频快速理解一本书核心价值的读者';
}

function riskForTrack(track: string): string {
  if (/健康|养生|中医|抗衰|饮食/u.test(track)) return '不得把书中观点改写为诊断、治疗或效果承诺；书名、作者和引用必须与来源一致。';
  return '书名、作者和引用必须与公开来源一致，不编造销量、评价、案例或权威背书。';
}

function uniqueKeywordCount(value: string): number {
  return new Set(value.split(/[\s·，,：:《》]+/u).map((item) => item.trim()).filter((item) => item.length > 1)).size;
}

function normalizedText(value: string): string {
  return value.toLowerCase().replace(/\s+/gu, ' ').trim();
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
