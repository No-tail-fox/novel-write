import { benchmarkOpportunityTotal } from './benchmark-monitoring';
import type {
  BenchmarkSelectionScore,
  BookDiscoveryItem,
  BookDiscoveryRequest,
  BookDiscoveryResult,
} from './types';

const DANGDANG_SEARCH_URL = 'https://search.dangdang.com/';
const MAX_LIMIT = 36;

const previewCatalog = [
  { sourceId: 'preview-huangdi-neijing', name: '黄帝内经养生智慧', author: '曲黎敏', publisher: '长江文艺出版社', category: '健康·中医食疗', keyword: '黄帝内经 中医养生 生活习惯', sellPoint: '用通俗语言解释传统养生观念与日常生活方式', audience: '关注生活习惯与传统养生知识的中老年读者' },
  { sourceId: 'preview-food-truth', name: '中国居民膳食指南', author: '中国营养学会', publisher: '人民卫生出版社', category: '健康·饮食营养', keyword: '膳食指南 营养搭配 健康饮食', sellPoint: '权威膳食框架适合拆成家庭餐桌上的具体选择', audience: '关注家庭饮食与营养搭配的读者' },
  { sourceId: 'preview-exercise-brain', name: '运动改造大脑', author: '约翰·瑞迪', publisher: '浙江人民出版社', category: '认知思维·成长', keyword: '运动 大脑 情绪 管理', sellPoint: '把运动与专注、情绪和学习状态连接起来', audience: '关注自我成长、运动习惯与认知提升的读者' },
  { sourceId: 'preview-parenting', name: '正面管教', author: '简·尼尔森', publisher: '北京联合出版公司', category: '育儿·亲子', keyword: '正面管教 亲子沟通 家庭教育', sellPoint: '用可执行的沟通方法化解家庭教育中的常见冲突', audience: '希望改善亲子沟通的家长' },
  { sourceId: 'preview-finance', name: '小狗钱钱', author: '博多·舍费尔', publisher: '四川少年儿童出版社', category: '财商·理财', keyword: '财商 理财 金钱观 成长', sellPoint: '用故事降低财商知识门槛，适合亲子共同阅读', audience: '理财入门读者与希望培养孩子财商的家长' },
  { sourceId: 'preview-culture', name: '典籍里的中国', author: '有书', publisher: '天地出版社', category: '传统文化·国学', keyword: '传统文化 典籍 国学 历史', sellPoint: '从典籍故事切入传统文化，画面感和知识点兼具', audience: '喜欢历史故事与传统文化的读者' },
] as const;

interface OpportunityInput {
  rank: number;
  reviewCount?: number;
  price?: string;
  query: string;
  title: string;
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

function normalizeRequest(input: BookDiscoveryRequest): Required<BookDiscoveryRequest> {
  const query = input.query.trim();
  if (!query) throw new Error('请输入选书主题或书名。');
  return { query, track: input.track?.trim() || '全部图书', limit: Math.min(MAX_LIMIT, Math.max(1, Math.round(input.limit ?? 24))) };
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
