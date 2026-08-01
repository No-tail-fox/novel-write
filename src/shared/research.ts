import type { ConfiguredTextLlm } from './llm-provider';
import { targetWordCountRange } from './content-metrics';
import { fetchWithNetworkPolicy, readTextBounded, type NetworkPurpose } from './network-policy';
import type {
  AiSourceContext,
  AiSourceSection,
  AppConfig,
  ImaConfig,
  ResearchCopyComposeInput,
  ResearchCopyComposeResult,
  Task,
  WebSearchProvider,
  WebSearchProviderStatus,
  WebSearchRequest,
} from './types';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
type SearchResultItem = Omit<AiSourceSection, 'source' | 'provider'>;
type StoryboundReferenceMaterial = Pick<AiSourceSection, 'title' | 'content' | 'snippet' | 'url' | 'source'>;

interface SearchProviderOutcome {
  provider: WebSearchProvider;
  items: AiSourceSection[];
  error?: Error;
}

export interface StoryboundAiCreationSystemPromptInput {
  trackName: string;
  trackTag: string;
  useAiKnowledge: boolean;
  hasReferenceMaterials: boolean;
}

export interface StoryboundAiCreationUserPromptInput {
  keyword: string;
  extraRequirements?: string;
}

export interface StoryboundTrackInfo {
  trackName: string;
  trackTag: string;
}

export type AiSourceResearcher = (task: Task) => Promise<AiSourceContext>;

const STORYBOUND_AI_CREATION_MAX_TOKENS = 32768;
const STORYBOUND_AI_CREATION_TEMPERATURE = 0.8;
const STORYBOUND_AI_CREATION_MAX_RETRIES = 2;
const STORYBOUND_REFERENCE_TEXT_LIMIT = 3000;
const STORYBOUND_SEARCH_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const SEARCH_PAGE_MAX_BYTES = 2 * 1024 * 1024;
const ARTICLE_PAGE_MAX_BYTES = 4 * 1024 * 1024;
const IMA_API_MAX_BYTES = 2 * 1024 * 1024;
const IMA_DOCUMENT_MAX_BYTES = 8 * 1024 * 1024;
const SEARCH_RESULTS_LIMIT = 10;
const SEARCH_HYDRATION_CANDIDATE_LIMIT = 20;

export const DEFAULT_WEB_SEARCH_PROVIDERS: readonly WebSearchProvider[] = ['bing', 'sogou'];
export const ALL_WEB_SEARCH_PROVIDERS: readonly WebSearchProvider[] = ['bing', 'baidu', 'sogou', 'toutiao'];

export const WEB_SEARCH_PROVIDER_LABELS: Record<WebSearchProvider, string> = {
  bing: '必应',
  baidu: '百度',
  sogou: '搜狗',
  toutiao: '头条',
};

const storyboundTrackMap: Record<string, StoryboundTrackInfo> = {
  'character-story': { trackName: '人物故事', trackTag: '纪实人物' },
  'health-book': { trackName: '健康图书', trackTag: '养生书单' },
  'culture-knowledge': { trackName: '文化科普', trackTag: '华夏文化' },
  'picture-book': { trackName: '绘本故事', trackTag: '儿童绘本' },
  ecommerce: { trackName: '电商带货', trackTag: '种草带货' },
  inspirational: { trackName: '心灵鸡汤', trackTag: '情绪共鸣' },
  'folk-tale': { trackName: '民间故事', trackTag: '传奇叙事' },
  general: { trackName: '通用故事', trackTag: '通用写实' },
};

export function resolveStoryboundTrackInfo(track: string | null | undefined): StoryboundTrackInfo {
  const normalized = (track || '').trim();
  return storyboundTrackMap[normalized] ?? { trackName: normalized || '通用故事', trackTag: normalized ? '通用写实' : '通用写实' };
}

export function buildStoryboundAiCreationSystemPrompt(input: StoryboundAiCreationSystemPromptInput): string {
  const strategy = input.hasReferenceMaterials
    ? input.useAiKnowledge
      ? '主要参考用户提供的参考素材，可适当结合你已知的可靠信息补全细节，但补充内容必须是确定的事实'
      : '严格基于用户提供的参考素材进行创作，不要引入素材以外的信息，不要主观臆断或编造细节'
    : '请基于你对该人物/主题的已知知识进行创作';
  const noReferenceExtra = input.hasReferenceMaterials ? '' : ' - 本次无外部参考素材，请只输出确定的事实，对不确定的细节宁可省略也不要编造';
  return [
    '你是一名资深短视频文案创作者，擅长创作原创短视频口播稿。',
    '',
    `【当前赛道】${input.trackName}（${input.trackTag}）`,
    '',
    `【素材策略】${strategy}`,
    '',
    '【创作要求】',
    '1. 必须是**原创口播文案**：不要直接复述参考素材的句子，要重新组织视角、节奏、叙事',
    `2. 风格匹配赛道："${input.trackName}"——按这个赛道的典型表达方式来写`,
    '3. 结构紧凑：开头要钩子（3 秒内勾住注意力），中间有起伏，结尾留余味或转发动机',
    '4. 口语化：避免书面语、长难句、生僻词；适合用配音朗读',
    '5. 不要标题、不要章节符号、不要 markdown，直接输出正文段落',
    '6. 不要使用「以下是」「我为你创作」之类的开场白，直接给文案',
    '',
    '【硬约束】',
    '- 输出**仅文案正文**，不要任何解释、说明、问候语',
    '- 不要使用 emoji 表情符号',
    `- 不要出现"参考资料""根据上述""综合以上"等元描述${noReferenceExtra}`,
  ].join('\n');
}

export function buildStoryboundAiCreationUserPrompt(input: StoryboundAiCreationUserPromptInput, materials: StoryboundReferenceMaterial[]): string {
  const blocks = [`【关键词】${input.keyword.trim()}`];
  const extraRequirements = (input.extraRequirements ?? '').trim();
  if (extraRequirements) {
    blocks.push(`【用户额外要求】\n${extraRequirements}`);
  }
  const materialBlocks = materials
    .filter((material) => compactText(material.content || material.snippet || '').trim())
    .map((material, index) => {
      const title = material.title?.trim() || '(无标题)';
      const text = compactText(material.content || material.snippet || '').slice(0, STORYBOUND_REFERENCE_TEXT_LIMIT);
      return `--- 素材 ${index + 1}：${title} ---\n${text}`;
    });
  if (materialBlocks.length > 0) {
    blocks.push(`【参考素材】\n${materialBlocks.join('\n\n')}`);
    blocks.push('请基于以上素材，围绕关键词，创作一篇原创短视频口播文案（直接输出正文，不要任何额外说明）。');
  } else {
    blocks.push(`请基于你对「${input.keyword.trim()}」的了解，创作一篇原创短视频口播文案（直接输出正文，不要任何额外说明）。`);
  }
  return blocks.join('\n\n');
}

export function cleanStoryboundAiCreationOutput(text: string): string {
  let output = text.replace(/^\uFEFF/, '').trim();
  output = output.replace(/^```(?:markdown|md|text)?\s*/iu, '').replace(/\s*```$/u, '').trim();
  output = output
    .replace(/^(?:好的[，,。!！\s]*)?(?:以下是|这是)(?:我为你|为你)?(?:创作|撰写|生成)?(?:的)?(?:短视频)?(?:口播)?(?:文案)?[：:\s]*/u, '')
    .replace(/^为你(?:创作|撰写|生成)(?:的)?(?:短视频)?(?:口播)?(?:文案)?[：:\s]*/u, '')
    .trim();
  return output;
}

export function buildStoryboundReviewSystemPrompt(
  task: Pick<Task, 'track' | 'aiSources' | 'targetLength'>,
  hasReferenceMaterials: boolean,
): string {
  const track = resolveStoryboundTrackInfo(task.track);
  const useAiKnowledge = task.aiSources?.includes('builtin-knowledge') ?? false;
  const targetRange = targetWordCountRange(task.targetLength);
  const strategy = hasReferenceMaterials
    ? useAiKnowledge
      ? '主要参考原文素材和搜索资料，可适当结合确定的可靠常识补齐必要背景'
      : '严格基于原文素材和搜索资料整理，不要主观臆断或编造细节'
    : '请只基于原文素材和你确定的已知事实整理，对不确定细节宁可省略也不要编造';
  return [
    '你是一名资深短视频文案预审策划者，擅长把原文、搜索资料和用户要求整理成适合后续创作原创短视频口播稿的事实底稿。',
    '',
    `【当前赛道】${task.track || track.trackName}（${track.trackTag}）`,
    '',
    targetRange
      ? [
          `【目标字数参考】${targetRange.target} 字（区间 ${targetRange.min}-${targetRange.max}）`,
          '预审时优先保留足够事实密度，不要为了压缩长度删掉后续改写需要的关键细节。',
          '',
        ].join('\n')
      : '',
    `【素材策略】${strategy}`,
    '',
    '【预审要求】',
    '1. 清理重复、广告、无关口号、低价值引导语，保留事实顺序和关键因果',
    '2. 不要直接复述参考素材的句子，要压缩整理为可继续改写的事实底稿',
    '3. 保留人物、时间、地点、事件转折、结局和可验证细节，删除未经证实的猜测',
    '4. 口语化但不写成最终成片文案；后续 Writer 会再做原创口播稿',
    '5. 输出必须服务于原创短视频，不要出现“参考资料”“根据上述”“综合以上”等元描述',
    '',
    '【硬约束】',
    '- Return strict JSON only. Schema: {"reviewedText": string}.',
    '- reviewedText 必须是中文事实简稿，不要标题、不要 markdown、不要解释。',
  ].join('\n');
}

function storyboundAiCreationTimeoutMs(promptLength: number): number {
  const dynamic = 60_000 + Math.ceil(Math.max(0, promptLength) / 1000) * 15_000;
  return Math.min(300_000, Math.max(90_000, dynamic));
}

export function createAiSourceResearcher(config: AppConfig, fetchImpl: FetchLike = fetch): AiSourceResearcher {
  return async (task) => {
    const query = (task.aiKeyword || task.inputText || '').trim();
    const context: AiSourceContext = { query, sections: [], warnings: [] };
    if (task.mode !== 'ai' || task.aiSources.length === 0 || !query) {
      return context;
    }

    const sources = new Set(task.aiSources);
    if (sources.has('web')) {
      if (task.selectedSources.length > 0) {
        context.sections.push(...task.selectedSources.filter((section) => section.source === 'web'));
      } else {
        try {
          const webSections = await searchWebSources(query, fetchImpl);
          if (webSections.length === 0) {
            context.warnings.push('web search returned no usable results.');
          } else {
            context.sections.push(...webSections);
          }
        } catch (error) {
          context.warnings.push(`web search failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    if (sources.has('builtin-knowledge')) {
      context.sections.push(buildBuiltinKnowledgeSection(task));
    }
    if (sources.has('ima')) {
      if (config.ima.clientId && config.ima.apiKey && (config.ima.kbId || config.ima.kbName)) {
        try {
          context.sections.push(...await searchImaKnowledge(config.ima, query, fetchImpl));
        } catch (error) {
          context.warnings.push(`IMA knowledge search failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        context.warnings.push('IMA knowledge base is not configured; skipped.');
      }
    }

    return context;
  };
}

export function formatAiSourceContext(task: Pick<Task, 'aiKeyword' | 'aiSources' | 'extraRequirements'>, context: AiSourceContext): string {
  const lines = [
    `AI keyword: ${context.query || task.aiKeyword}`,
    task.extraRequirements ? `Extra requirements: ${task.extraRequirements}` : '',
    `Sources: ${task.aiSources.join(', ') || 'none'}`,
  ].filter(Boolean);

  if (context.sections.length > 0) {
    lines.push(
      'Reference materials:',
      ...context.sections.map((section, index) => {
        const url = section.url ? `\nURL: ${section.url}` : '';
        return `${index + 1}. [${section.source}] ${section.title}${url}\n${section.content}`;
      }),
    );
  }
  if (context.warnings.length > 0) {
    lines.push('Warnings:', ...context.warnings.map((warning) => `- ${warning}`));
  }
  return lines.join('\n\n');
}

export async function searchWebSources(query: string, fetchImpl: FetchLike = fetch): Promise<AiSourceSection[]> {
  const context = await searchWebSourcesDetailed(
    { query, providers: [...DEFAULT_WEB_SEARCH_PROVIDERS] },
    fetchImpl,
  );
  if (context.sections.length === 0 && context.providerStatuses?.every((status) => status.state === 'failed')) {
    throw new Error(context.warnings.join('; ') || 'All web search providers failed.');
  }
  return context.sections;
}

export async function searchWebSourcesDetailed(input: WebSearchRequest, fetchImpl: FetchLike = fetch): Promise<AiSourceContext> {
  const query = input.query.trim();
  const providers = normalizeWebSearchProviders(input.providers);
  if (!query) return { query, sections: [], warnings: [], providerStatuses: [] };

  const outcomes = await Promise.all(providers.map(async (provider): Promise<SearchProviderOutcome> => {
    try {
      return { provider, items: await searchProvider(provider, query, fetchImpl) };
    } catch (error) {
      return { provider, items: [], error: error instanceof Error ? error : new Error(String(error)) };
    }
  }));
  const searchItems = outcomes.flatMap((outcome) => outcome.items);
  const hydrationCandidates = selectHydrationCandidates(query, providers, searchItems);
  const hydrated = await runLimited(hydrationCandidates, 5, async (item) => hydratePreciseSearchItem(query, item, fetchImpl));
  const preciseItems = hydrated.filter((item): item is AiSourceSection => item !== null);
  const sections = diversifySearchProviders(query, providers, preciseItems).slice(0, SEARCH_RESULTS_LIMIT);
  const providerStatuses = buildProviderStatuses(providers, outcomes, preciseItems);
  const warnings = providerStatuses
    .filter((status) => status.state === 'failed')
    .map((status) => `${status.label}搜索失败：${status.message || '连接失败'}`);
  return { query, sections, warnings, providerStatuses };
}

function normalizeWebSearchProviders(providers: readonly WebSearchProvider[]): WebSearchProvider[] {
  const requested = providers.length > 0 ? providers : DEFAULT_WEB_SEARCH_PROVIDERS;
  return [...new Set(requested)].filter((provider): provider is WebSearchProvider => ALL_WEB_SEARCH_PROVIDERS.includes(provider));
}

async function searchProvider(provider: WebSearchProvider, query: string, fetchImpl: FetchLike): Promise<AiSourceSection[]> {
  switch (provider) {
    case 'bing': return searchBingHtml(query, fetchImpl);
    case 'baidu': return searchBaiduHtml(query, fetchImpl);
    case 'sogou': return searchSogouHtml(query, fetchImpl);
    case 'toutiao': return searchToutiaoHtml(query, fetchImpl);
  }
}

function selectHydrationCandidates(
  query: string,
  providers: readonly WebSearchProvider[],
  items: AiSourceSection[],
): AiSourceSection[] {
  const queues = providers.map((provider) => rankSearchItems(
    query,
    items.filter((item) => item.provider === provider),
  ).slice(0, SEARCH_RESULTS_LIMIT));
  const selected: AiSourceSection[] = [];
  for (let index = 0; selected.length < SEARCH_HYDRATION_CANDIDATE_LIMIT; index += 1) {
    let foundCandidate = false;
    for (const queue of queues) {
      const item = queue[index];
      if (!item) continue;
      selected.push(item);
      foundCandidate = true;
      if (selected.length >= SEARCH_HYDRATION_CANDIDATE_LIMIT) break;
    }
    if (!foundCandidate) break;
  }
  return rankSearchItems(query, selected);
}

async function hydratePreciseSearchItem(
  query: string,
  item: AiSourceSection,
  fetchImpl: FetchLike,
): Promise<AiSourceSection | null> {
  const snippet = item.content;
  const snapshot = item.url
    ? await fetchPageSnapshot(item.url, fetchImpl).catch(() => ({ url: item.url ?? '', content: '' }))
    : { url: '', content: '' };
  if (isSearchAccessInterstitial(snapshot.url)) return null;
  if (hasCjk(query) && !matchesStrongSearchTerm(query, item.title) && !matchesStrongSearchTerm(query, snapshot.content)) {
    return null;
  }
  return {
    ...item,
    url: snapshot.url || item.url,
    snippet,
    content: snapshot.content || item.content,
  };
}

function diversifySearchProviders(
  query: string,
  providers: readonly WebSearchProvider[],
  items: AiSourceSection[],
): AiSourceSection[] {
  const ranked = [...items].sort((a, b) => preciseSearchScore(query, b) - preciseSearchScore(query, a));
  const selected: AiSourceSection[] = [];
  const selectedKeys = new Set<string>();
  for (const provider of providers) {
    const item = ranked.find((candidate) => candidate.provider === provider && !selectedKeys.has(searchItemDedupeKey(candidate)));
    if (!item) continue;
    selected.push(item);
    selectedKeys.add(searchItemDedupeKey(item));
  }
  for (const item of ranked) {
    const key = searchItemDedupeKey(item);
    if (selectedKeys.has(key)) continue;
    selected.push(item);
    selectedKeys.add(key);
  }
  return selected;
}

function preciseSearchScore(query: string, item: AiSourceSection): number {
  const titleMatch = matchesStrongSearchTerm(query, item.title) ? 100 : 0;
  const contentMatch = matchesStrongSearchTerm(query, item.content) ? 30 : 0;
  return titleMatch + contentMatch + referenceTier(item) * 40 + referenceQualityScore(item);
}

function searchItemDedupeKey(item: AiSourceSection): string {
  return normalizeDedupeKey(item.url || item.title);
}

function isSearchAccessInterstitial(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    return (/(^|\.)sogou\.com$/u.test(host) && path.startsWith('/antispider'))
      || (/(^|\.)baidu\.com$/u.test(host) && /\/(?:wappass|captcha|verify)(?:\/|$)/u.test(path))
      || (/(^|\.)bing\.com$/u.test(host) && /\/(?:sorry|captcha)(?:\/|$)/u.test(path))
      || (/(^|\.)toutiao\.com$/u.test(host) && /\/(?:captcha|verify)(?:\/|$)/u.test(path));
  } catch {
    return false;
  }
}

function buildProviderStatuses(
  providers: readonly WebSearchProvider[],
  outcomes: readonly SearchProviderOutcome[],
  preciseItems: readonly AiSourceSection[],
): WebSearchProviderStatus[] {
  return providers.map((provider) => {
    const outcome = outcomes.find((item) => item.provider === provider);
    const count = preciseItems.filter((item) => item.provider === provider).length;
    if (outcome?.error) {
      return { provider, label: WEB_SEARCH_PROVIDER_LABELS[provider], state: 'failed', count: 0, message: outcome.error.message };
    }
    return { provider, label: WEB_SEARCH_PROVIDER_LABELS[provider], state: count > 0 ? 'ready' : 'empty', count };
  });
}

export function researchSearchErrorMessage(error: unknown): string {
  const chain: Error[] = [];
  let current: unknown = error;
  while (current instanceof Error && !chain.includes(current)) {
    chain.push(current);
    current = current.cause;
  }
  const coded = chain.find((item) => 'code' in item && typeof (item as NodeJS.ErrnoException).code === 'string') as NodeJS.ErrnoException | undefined;
  if (coded?.code === 'NETWORK_TIMEOUT') return '网页搜索超时，请检查网络或代理后重试。';
  if (coded?.code === 'NETWORK_ADDRESS_BLOCKED' && /198\.1[89]\./u.test(coded.message)) {
    return '检测到代理 Fake-IP，但当前版本未能通过安全校验。请重启软件后重试。';
  }
  const detail = chain.map((item) => item.message.trim()).find((message) => message && message !== 'fetch failed');
  if (detail) return `网页搜索失败：${detail}`;
  return '网页搜索连接失败，请检查网络或代理后重试。';
}

async function searchBingHtml(query: string, fetchImpl: FetchLike): Promise<AiSourceSection[]> {
  const searchQuery = normalizeStoryboundSearchQuery(query);
  const urls = [
    `https://cn.bing.com/search?q=${encodeURIComponent(searchQuery)}`,
    `https://www.bing.com/search?q=${encodeURIComponent(searchQuery)}`,
  ];
  let lastError: unknown = null;
  for (const url of urls) {
    try {
      const response = await fetchBounded(fetchImpl, url, {
        timeoutMs: 8000,
        maxBytes: SEARCH_PAGE_MAX_BYTES,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*',
      });
      if (!response.ok) {
        lastError = new Error(`Bing returned ${response.status}`);
        continue;
      }
      const html = await readTextBounded(response, SEARCH_PAGE_MAX_BYTES);
      const items = /<item\b/i.test(html) ? extractRssItems(html) : extractBingItems(html);
      if (items.length > 0) return items.slice(0, 15).map((item) => ({ source: 'web', provider: 'bing', ...item }));
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError instanceof Error ? lastError : new Error(String(lastError));
  return [];
}

async function searchSogouHtml(query: string, fetchImpl: FetchLike): Promise<AiSourceSection[]> {
  const url = `https://www.sogou.com/web?query=${encodeURIComponent(query)}`;
  const response = await fetchBounded(fetchImpl, url, {
    timeoutMs: 8000,
    maxBytes: SEARCH_PAGE_MAX_BYTES,
    accept: 'text/html,application/xhtml+xml,*/*',
  });
  if (!response.ok) {
    throw new Error(`Sogou returned ${response.status}`);
  }
  const html = await readTextBounded(response, SEARCH_PAGE_MAX_BYTES);
  const items = extractSogouItems(html).slice(0, 10);
  const resolvedItems = await Promise.all(items.map(async (item) => ({
    ...item,
    url: await resolveSogouResultUrl(item.url ?? '', fetchImpl).catch(() => item.url ?? ''),
  })));
  return resolvedItems.map((item) => ({ source: 'web', provider: 'sogou', ...item }));
}

async function searchBaiduHtml(query: string, fetchImpl: FetchLike): Promise<AiSourceSection[]> {
  const url = `https://www.baidu.com/s?wd=${encodeURIComponent(normalizeStoryboundSearchQuery(query))}`;
  const response = await fetchBounded(fetchImpl, url, {
    timeoutMs: 8000,
    maxBytes: SEARCH_PAGE_MAX_BYTES,
    accept: 'text/html,application/xhtml+xml,*/*',
  });
  if (!response.ok) throw new Error(`Baidu returned ${response.status}`);
  const html = await readTextBounded(response, SEARCH_PAGE_MAX_BYTES);
  return extractBaiduItems(html).slice(0, 15).map((item) => ({ source: 'web', provider: 'baidu', ...item }));
}

async function searchToutiaoHtml(query: string, fetchImpl: FetchLike): Promise<AiSourceSection[]> {
  const url = `https://so.toutiao.com/search?keyword=${encodeURIComponent(normalizeStoryboundSearchQuery(query))}&pd=information&source=input`;
  const response = await fetchBounded(fetchImpl, url, {
    timeoutMs: 8000,
    maxBytes: SEARCH_PAGE_MAX_BYTES,
    accept: 'text/html,application/xhtml+xml,*/*',
  });
  if (!response.ok) throw new Error(`Toutiao returned ${response.status}`);
  const html = await readTextBounded(response, SEARCH_PAGE_MAX_BYTES);
  return extractToutiaoItems(html).slice(0, 15).map((item) => ({ source: 'web', provider: 'toutiao', ...item }));
}

export async function composeCopyFromSources(llm: ConfiguredTextLlm, input: ResearchCopyComposeInput): Promise<ResearchCopyComposeResult> {
  const selectedSources = input.selectedSources.slice(0, 10);
  const hasReferenceMaterials = selectedSources.length > 0;
  const track = resolveStoryboundTrackInfo('general');
  const system = buildStoryboundAiCreationSystemPrompt({
    trackName: track.trackName,
    trackTag: track.trackTag,
    useAiKnowledge: false,
    hasReferenceMaterials,
  });
  const user = buildStoryboundAiCreationUserPrompt(
    {
      keyword: input.keyword,
      extraRequirements: input.extraRequirements,
    },
    selectedSources,
  );
  const result = await llm.run({
    step: 0,
    name: 'research-copy',
    temperature: STORYBOUND_AI_CREATION_TEMPERATURE,
    maxTokens: STORYBOUND_AI_CREATION_MAX_TOKENS,
    timeoutMs: storyboundAiCreationTimeoutMs(user.length),
    maxRetries: STORYBOUND_AI_CREATION_MAX_RETRIES,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  const copy = cleanStoryboundAiCreationOutput(result.text);
  if (!copy) {
    throw new Error('LLM did not return copy text for selected sources.');
  }
  return { title: input.keyword.trim(), copy, raw: result.raw, requestId: result.requestId };
}

async function searchImaKnowledge(config: ImaConfig, query: string, fetchImpl: FetchLike): Promise<AiSourceSection[]> {
  const kbId = config.kbId || config.kbName;
  const response = await requestImaApi('openapi/wiki/v1/search_knowledge', { query, cursor: '', knowledge_base_id: kbId }, config, fetchImpl, 20_000);
  const entries = extractImaEntries(response).slice(0, 5);
  const sections = await runLimited(entries, 3, async (entry, index) => expandImaEntry(entry, index, config, fetchImpl));
  return sections.filter((section): section is AiSourceSection => Boolean(section?.content));
}

async function expandImaEntry(entry: Record<string, unknown>, index: number, config: ImaConfig, fetchImpl: FetchLike): Promise<AiSourceSection | null> {
  const title = firstString(entry, ['title', 'name', 'doc_name', 'knowledge_name']) || `IMA 资料 ${index + 1}`;
  const directContent = firstString(entry, ['highlight_content', 'content', 'summary', 'description', 'text']);
  if (directContent.trim()) {
    return { source: 'ima', title, content: compactText(stripHtmlToText(directContent)).slice(0, 50_000), url: firstString(entry, ['url', 'doc_url']) || undefined };
  }

  const mediaId = firstString(entry, ['media_id', 'id', 'doc_id', 'target_id']);
  if (!mediaId) return null;

  const mediaInfo = await requestImaApi('openapi/wiki/v1/get_media_info', { media_id: mediaId }, config, fetchImpl, 20_000).catch(() => null);
  const mediaData = mediaInfo && typeof mediaInfo === 'object' ? (mediaInfo as Record<string, unknown>) : {};
  const urlInfo = objectValue(mediaData, ['url_info']) ?? objectValue(entry, ['url_info']);
  const url = urlInfo ? firstString(urlInfo, ['url']) : firstString(mediaData, ['url', 'doc_url']);
  if (url) {
    const headers = urlInfo ? objectStringMap(urlInfo, 'headers') : undefined;
    const response = await fetchBounded(fetchImpl, url, {
      timeoutMs: 20_000,
      maxBytes: IMA_DOCUMENT_MAX_BYTES,
      accept: 'text/html,application/xhtml+xml,text/plain,*/*',
      extraHeaders: headers,
      purpose: 'ima-document',
    }).catch(() => null);
    if (response?.ok) {
      const body = await readTextBounded(response, IMA_DOCUMENT_MAX_BYTES);
      const contentType = response.headers.get('content-type') ?? '';
      const content = contentType.includes('text/plain') ? body : extractReadableText(body);
      return { source: 'ima', title, url, content: compactText(content).slice(0, 50_000) };
    }
  }

  const noteContent = await requestImaApi(
    'openapi/note/v1/get_doc_content',
    { doc_id: mediaId, target_content_format: 0 },
    config,
    fetchImpl,
    20_000,
  ).catch(() => null);
  const noteText = noteContent && typeof noteContent === 'object'
    ? firstString(noteContent as Record<string, unknown>, ['content', 'text', 'markdown', 'doc_content'])
    : '';
  return noteText ? { source: 'ima', title, content: compactText(stripHtmlToText(noteText)).slice(0, 50_000), url: url || undefined } : null;
}

async function requestImaApi(path: string, body: Record<string, unknown>, config: ImaConfig, fetchImpl: FetchLike, timeoutMs: number): Promise<unknown> {
  const response = await fetchBounded(fetchImpl, `https://ima.qq.com/${path}`, {
    timeoutMs,
    maxBytes: IMA_API_MAX_BYTES,
    accept: 'application/json,*/*',
    extraHeaders: {
      'Content-Type': 'application/json',
      'ima-openapi-clientid': config.clientId,
      'ima-openapi-apikey': config.apiKey,
    },
    body: JSON.stringify(body),
    method: 'POST',
    purpose: 'ima-api',
  });
  const text = await readTextBounded(response, IMA_API_MAX_BYTES);
  if (!response.ok) {
    throw new Error(`IMA API ${path} returned ${response.status}: ${text.slice(0, 300)}`);
  }
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const code = Number(parsed.code ?? 0);
  if (code !== 0) {
    throw new Error(`IMA API ${path} returned code ${parsed.code}: ${String(parsed.msg ?? parsed.message ?? '').slice(0, 200)}`);
  }
  return parsed.data ?? parsed;
}

function extractImaEntries(input: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(input)) return input.filter(isRecord);
  if (!isRecord(input)) return [];
  for (const key of ['list', 'records', 'items', 'knowledge_list', 'knowledgeList', 'data', 'results']) {
    const value = input[key];
    const entries = extractImaEntries(value);
    if (entries.length > 0) return entries;
  }
  return [];
}

async function runLimited<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const output: R[] = new Array(items.length);
  let cursor = 0;
  async function runWorker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, runWorker));
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function objectValue(record: Record<string, unknown>, keys: string[]): Record<string, unknown> | null {
  for (const key of keys) {
    const value = record[key];
    if (isRecord(value)) return value;
  }
  return null;
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function objectStringMap(record: Record<string, unknown>, key: string): Record<string, string> | undefined {
  const value = record[key];
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function stripHtmlToText(input: string): string {
  return cleanXml(stripNonContentHtml(input));
}

async function fetchPageText(url: string, fetchImpl: FetchLike): Promise<string> {
  return (await fetchPageSnapshot(url, fetchImpl)).content;
}

async function fetchPageSnapshot(url: string, fetchImpl: FetchLike): Promise<{ url: string; content: string }> {
  const response = await fetchBounded(fetchImpl, url, {
    timeoutMs: 8000,
    maxBytes: ARTICLE_PAGE_MAX_BYTES,
    accept: 'text/html,application/xhtml+xml,text/plain,*/*',
  });
  if (!response.ok) return { url, content: '' };
  const contentType = response.headers.get('content-type') ?? '';
  if (!/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) return { url: response.url || url, content: '' };
  const body = await readTextBounded(response, ARTICLE_PAGE_MAX_BYTES);
  const text = contentType.includes('text/plain') ? body : extractReadableText(body);
  return { url: response.url || url, content: compactText(text).slice(0, STORYBOUND_REFERENCE_TEXT_LIMIT) };
}

async function fetchBounded(
  fetchImpl: FetchLike,
  url: string,
  options: {
    timeoutMs: number;
    maxBytes: number;
    accept: string;
    extraHeaders?: Record<string, string>;
    body?: BodyInit;
    method?: string;
    purpose?: NetworkPurpose;
  },
): Promise<Response> {
  return fetchWithNetworkPolicy(url, {
    purpose: options.purpose ?? 'public-research',
    fetchImpl,
    timeoutMs: options.timeoutMs,
    maxBytes: options.maxBytes,
    method: options.method ?? 'GET',
    headers: {
      Accept: options.accept,
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'User-Agent': STORYBOUND_SEARCH_USER_AGENT,
      ...options.extraHeaders,
    },
    body: options.body,
  });
}

function extractRssItems(xml: string): Array<Omit<AiSourceSection, 'source'>> {
  return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)]
    .map(([item]) => ({
      title: cleanXml(extractTag(item, 'title')),
      url: cleanXml(extractTag(item, 'link')),
      content: cleanXml(extractTag(item, 'description')),
    }))
    .filter((item) => item.title && item.content);
}

function normalizeStoryboundSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ');
}

function extractBingItems(html: string): SearchResultItem[] {
  return [...html.matchAll(/<li\b(?=[^>]*\bclass=(?:"[^"]*\bb_algo\b[^"]*"|'[^']*\bb_algo\b[^']*'))[^>]*>[\s\S]*?<\/li>/gi)]
    .map(([block]) => {
      const titleHtml = block.match(/<h2\b[\s\S]*?<\/h2>/i)?.[0] ?? block.match(/<a\b[\s\S]*?<\/a>/i)?.[0] ?? '';
      const href = extractAttribute(titleHtml, 'href');
      const url = normalizeSearchResultUrl(href, 'https://cn.bing.com');
      const title = cleanXml(titleHtml);
      const contentHtml = block.match(/<p\b[\s\S]*?<\/p>/i)?.[0] ?? block;
      const content = compactText(cleanXml(stripNonContentHtml(contentHtml)));
      return { title, url, content };
    })
    .filter((item) => item.title && item.url && item.content && !isBlockedBingResult(item));
}

function extractSogouItems(html: string): SearchResultItem[] {
  const blocks = [...html.matchAll(/<div\b(?=[^>]*\bclass=(?:"[^"]*\bvrwrap\b[^"]*"|'[^']*\bvrwrap\b[^']*'))[^>]*>[\s\S]*?(?:<!--\s*z\s*-->|<\/div>)/gi)].map(([block]) => block);
  const candidates = blocks.length ? blocks : [...html.matchAll(/<h3\b[\s\S]*?<\/h3>/gi)].map(([block]) => block);
  return candidates
    .map((block) => {
      const titleHtml = block.match(/<h3\b[\s\S]*?<\/h3>/i)?.[0] ?? block;
      const title = cleanXml(titleHtml);
      const dataUrl = extractAttribute(block, 'data-url');
      const href = extractAttribute(titleHtml, 'href');
      const url = normalizeSearchResultUrl(dataUrl || href, 'https://www.sogou.com');
      const content = compactText(cleanXml(stripNonContentHtml(block)).replace(title, '').replace(/推荐您搜索[\s\S]*$/u, ''));
      return { title, url, content };
    })
    .filter((item) => item.title && item.content);
}

function extractBaiduItems(html: string): SearchResultItem[] {
  const headings = [...html.matchAll(/<h3\b[\s\S]*?<\/h3>/gi)];
  return headings
    .map((match, index) => {
      const titleHtml = match[0];
      const href = extractAttribute(titleHtml, 'href');
      const url = normalizeSearchResultUrl(href, 'https://www.baidu.com');
      const title = cleanXml(titleHtml);
      const blockStart = (match.index ?? 0) + titleHtml.length;
      const blockEnd = headings[index + 1]?.index ?? Math.min(html.length, blockStart + 4000);
      const block = html.slice(blockStart, Math.min(blockEnd, blockStart + 4000));
      const content = compactText(cleanXml(stripNonContentHtml(block)).replace(title, '')).slice(0, 1200) || title;
      return { title, url, content };
    })
    .filter((item) => item.title && /^https?:\/\//i.test(item.url));
}

function extractToutiaoItems(html: string): SearchResultItem[] {
  return [...html.matchAll(/<script\b(?=[^>]*\bdata-for=(?:"ala-data"|'ala-data'))[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(([, script]) => parseToutiaoFlowData(script))
    .filter((data): data is Record<string, unknown> => data !== null)
    .map((data) => {
      const title = cleanXml(firstNestedString(data, [
        ['title'],
        ['display', 'title', 'text'],
        ['emphasized', 'title'],
        ['display', 'self_info', 'title'],
      ]));
      const content = cleanXml(firstNestedString(data, [
        ['abstract'],
        ['display', 'summary', 'text'],
        ['emphasized', 'summary'],
        ['data_ext', 'xigua_extra_info', 'summary_content'],
      ])) || title;
      const rawUrl = firstNestedString(data, [['article_url'], ['ttsearch_msite_url'], ['display', 'info', 'url']]);
      const url = normalizeSearchResultUrl(rawUrl, 'https://www.toutiao.com');
      return { title, url, content: compactText(content) };
    })
    .filter((item) => item.title && /^https?:\/\/(?:www\.)?toutiao\.com\/(?:article|group)\//i.test(item.url));
}

function parseToutiaoFlowData(script: string): Record<string, unknown> | null {
  const marker = /\bdata\s*:\s*/u.exec(script);
  if (!marker) return null;
  const json = extractBalancedJsonObject(script, marker.index + marker[0].length);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractBalancedJsonObject(input: string, fromIndex: number): string {
  const start = input.indexOf('{', fromIndex);
  if (start < 0) return '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < input.length; index += 1) {
    const char = input[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return input.slice(start, index + 1);
    }
  }
  return '';
}

function firstNestedString(input: Record<string, unknown>, paths: readonly (readonly string[])[]): string {
  for (const path of paths) {
    let current: unknown = input;
    for (const key of path) {
      if (!isRecord(current)) {
        current = undefined;
        break;
      }
      current = current[key];
    }
    if (typeof current === 'string' && current.trim()) return current.trim();
  }
  return '';
}

async function resolveSogouResultUrl(url: string, fetchImpl: FetchLike): Promise<string> {
  if (!/https?:\/\/(?:www\.)?sogou\.com\/link\?url=/i.test(url)) return url;
  const response = await fetchBounded(fetchImpl, url, {
    timeoutMs: 8000,
    maxBytes: SEARCH_PAGE_MAX_BYTES,
    accept: 'text/html,application/xhtml+xml,*/*',
  });
  const finalUrl = response.url || '';
  if (finalUrl && !/sogou\.com/i.test(new URL(finalUrl).hostname)) return finalUrl;
  const html = await readTextBounded(response, SEARCH_PAGE_MAX_BYTES).catch(() => '');
  return extractRedirectUrl(html, url) || decodeSogouUrlParam(url) || url;
}

function extractRedirectUrl(html: string, baseUrl: string): string {
  const patterns = [
    /location\.(?:href|replace)\s*(?:=|\()\s*["']([^"']+)["']/i,
    /<meta\b[^>]*http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"']+)["']/i,
    /<a\b[^>]*href=["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    const url = normalizeSearchResultUrl(decodeEntities(match[1]), baseUrl);
    if (/^https?:\/\//i.test(url) && !/sogou\.com/i.test(url)) return url;
  }
  return '';
}

function decodeSogouUrlParam(url: string): string {
  try {
    const value = new URL(url).searchParams.get('url') ?? '';
    return /^https?:\/\//i.test(value) ? decodeEntities(value) : '';
  } catch {
    return '';
  }
}

function isBlockedBingResult(item: Pick<AiSourceSection, 'url'>): boolean {
  try {
    const url = new URL(item.url ?? '');
    const host = url.hostname.toLowerCase();
    if (/(^|\.)bing\.com$|(^|\.)microsoft\.com$/.test(host)) return true;
    if (url.pathname.replace(/[^\p{L}\p{N}]+/gu, '').length < 2) return true;
    return false;
  } catch {
    return false;
  }
}

function shouldSearchAdditionalChineseSources(query: string, items: AiSourceSection[]): boolean {
  return hasCjk(query) && (hasChineseIntentSuffix(query) || items.length === 0 || !items.some((item) => relevanceScore(query, item) > 0));
}

function rankSearchItems(query: string, items: AiSourceSection[]): AiSourceSection[] {
  const scored = items
    .filter((item) => !isBlockedReferenceResult(item))
    .map((item, index) => {
      const relevance = relevanceScore(query, item);
      return { item, index, relevance, score: relevance + referenceQualityScore(item) };
  });
  const hasRelevantChineseResult = hasCjk(query) && scored.some((entry) => entry.relevance > 0);
  let filteredScored = scored.filter((entry) => !hasRelevantChineseResult || entry.relevance > 0);
  const preferReferenceTier = hasCjk(query) && hasChineseIntentSuffix(query) && filteredScored.some((entry) => isTrustedReferenceResult(entry.item));
  if (preferReferenceTier) {
    filteredScored = filteredScored.filter((entry) => isTrustedReferenceResult(entry.item) || isSupplementalTextReferenceResult(entry.item));
  }
  const seen = new Set<string>();
  return filteredScored
    .sort((a, b) => (preferReferenceTier ? referenceTier(b.item) - referenceTier(a.item) : 0) || b.score - a.score || a.index - b.index)
    .filter(({ item }) => {
      const key = normalizeDedupeKey(item.provider ? `${item.provider}:${item.title}` : item.url || item.title);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ item }) => item);
}

function relevanceScore(query: string, item: Pick<AiSourceSection, 'title' | 'url' | 'content' | 'snippet'>): number {
  if (!hasCjk(query)) return 1;
  const text = normalizeSearchText([item.title, item.url, item.content, item.snippet].filter(Boolean).join(' '));
  return buildStrongSearchTerms(query).reduce((score, term) => (text.includes(term) ? score + term.length : score), 0);
}

function isBlockedReferenceResult(item: Pick<AiSourceSection, 'title' | 'url' | 'content' | 'snippet'>): boolean {
  const url = (item.url ?? '').toLowerCase();
  const text = normalizeSearchText([item.title, item.url, item.content, item.snippet].filter(Boolean).join(' '));
  if (/(douyin\.com|ixigua\.com|kuaishou\.com|bilibili\.com|acfun\.cn|v\.qq\.com|youku\.com|iqiyi\.com|mgtv\.com|youtube\.com|youtu\.be)/i.test(url)) {
    return true;
  }
  if (/(wenda\.so\.com|zhidao\.baidu\.com)/i.test(url)) {
    return true;
  }
  if (/(toutiao\.com\/(?:topic|search)|douyin\.com\/search|zhihu\.com\/search)/i.test(url)) {
    return true;
  }
  if (/baijiahao\.baidu\.com/i.test(url) && !/baijiahao\.baidu\.com\/s\?id=/i.test(url)) {
    return true;
  }
  if (/(\u89c6\u9891|\u56fe\u7247|\u76f4\u64ad|\u9ad8\u6e05|\u5728\u7ebf\u89c2\u770b|\u65e0\u6c34\u5370|\u64ad\u653e|\u76f8\u5173\u89c6\u9891|360\u89c6\u9891)/u.test(text)) {
    return true;
  }
  if (!isSupplementalTextReferenceResult(item) && /(\u95ee\u7b54|\u767e\u5ea6\u77e5\u9053|360\u95ee\u7b54)/u.test(text)) {
    return true;
  }
  if (/(\d+[\u4e00-\u9fff]*(?:\u4f4d|\u5927).*(?:\u52a8\u6f2b|\u89d2\u8272|\u6b7b\u6cd5)|\u8fd9\u4e9b\u52a8\u6f2b|\u4e3b\u4eba\u516c\u6b7b\u6cd5|\u6b7b[\u7684\u5f97]\u592a\u60e8|\u547d\u8fd0.*\u592a\u60b2\u60e8|\u6d3b\u6d3b\u751f\u541e|\u840c\u59b9\u5b50|\u5bc4\u5200\u7247|\u54ea\u4e00\u4f4d|\u610f\u96be\u5e73|\u9ad8\u80fd\u9884\u8b66|\u76d8\u70b9|\u6392\u884c\u699c|\u60a8\u5728\u67e5\u627e|\u641c\u7d22\u7ed3\u679c\u805a\u5408)/u.test(text)) {
    return true;
  }
  return false;
}

function referenceQualityScore(item: Pick<AiSourceSection, 'title' | 'url' | 'content' | 'snippet'>): number {
  const url = (item.url ?? '').toLowerCase();
  const text = normalizeSearchText([item.title, item.url, item.content, item.snippet].filter(Boolean).join(' '));
  let score = 0;
  if (isTrustedReferenceResult(item)) score += 6;
  if (isSupplementalTextReferenceResult(item)) score += 4;
  if (/(\u767e\u79d1|\u7ef4\u57fa|\u8d44\u6599|\u8bcd\u6761)/u.test(text)) score += 3;
  if (/(\u77e5\u4e4e|\u4e13\u680f|\u56de\u7b54|\u767e\u5bb6\u53f7|\u5934\u6761\u53f7|\u4eca\u65e5\u5934\u6761|\u6587\u7ae0)/u.test(text)) score += 2;
  if (/(\u7f51\u9875\u8d44\u8baf|\u641c\u7d22|\u70b9\u51fb|\u767b\u5f55|\u6ce8\u518c|\u9996\u9875)/u.test(text)) score -= 5;
  return score;
}

function isTrustedReferenceResult(item: Pick<AiSourceSection, 'url'>): boolean {
  return /(baike\.baidu\.com|baike\.so\.com|moegirl\.org\.cn|huijiwiki\.com|wikipedia\.org|fandom\.com|wiki\.gg)/i.test(item.url ?? '');
}

function isSupplementalTextReferenceResult(item: Pick<AiSourceSection, 'url'>): boolean {
  const url = item.url ?? '';
  return /((?:www\.)?zhihu\.com\/question\/\d+|zhuanlan\.zhihu\.com\/p\/\d+|baijiahao\.baidu\.com\/s\?id=|(?:www\.|m\.)?toutiao\.com\/(?:article|group)\/)/i.test(url);
}

function referenceTier(item: Pick<AiSourceSection, 'url'>): number {
  if (isTrustedReferenceResult(item)) return 2;
  if (isSupplementalTextReferenceResult(item)) return 1;
  return 0;
}

function buildStrongSearchTerms(query: string): string[] {
  const compactQuery = normalizeSearchText(query);
  const terms = new Set<string>();
  if (compactQuery.length >= 2) {
    terms.add(compactQuery);
  }
  const subject = extractChineseIntentSubject(compactQuery);
  if (subject.length >= 2) {
    terms.add(subject);
  }
  return [...terms].sort((a, b) => b.length - a.length);
}

function extractChineseIntentSubject(compactQuery: string): string {
  return compactQuery.replace(chineseDeathIntentPattern(), '').replace(chineseGenericIntentPattern(), '');
}

function matchesStrongSearchTerm(query: string, input: string): boolean {
  const text = normalizeSearchText(input);
  return buildStrongSearchTerms(query).some((term) => text.includes(term));
}

function hasChineseIntentSuffix(query: string): boolean {
  return chineseDeathIntentPattern().test(normalizeSearchText(query));
}

function chineseDeathIntentPattern(): RegExp {
  return /(?:\u4e4b\u6b7b|\u6b7b\u4ea1|\u6b7b\u56e0|\u4e3a\u4ec0\u4e48(?:\u4f1a)?\u6b7b|\u4e3a\u5565(?:\u4f1a)?\u6b7b|\u4e3a\u4f55(?:\u4f1a)?\u6b7b|\u600e\u4e48(?:\u4f1a)?\u6b7b\u7684?|\u5982\u4f55\u6b7b|\u6b7b\u4e86\u5417|\u6b7b\u6ca1\u6b7b|\u6700\u540e\u6b7b\u4e86\u6ca1|\u6700\u540e\u6d3b\u4e86\u5417|\u53bb\u4e16|\u9047\u5bb3|\u727a\u7272|\u7ed3\u5c40)$/u;
}

function chineseGenericIntentPattern(): RegExp {
  return /(?:故事|生平|简介|资料|介绍|经历|传记|传奇|一生|事迹|信息)$/u;
}

function hasCjk(input: string): boolean {
  return /[\u3400-\u9fff]/u.test(input);
}

function normalizeSearchText(input: string): string {
  return decodeEntities(input).toLowerCase().replace(/\s+/g, '');
}

function normalizeDedupeKey(input: string): string {
  try {
    const url = new URL(input);
    if (url.hostname.toLowerCase() === 'mzh.moegirl.org.cn') {
      url.hostname = 'zh.moegirl.org.cn';
    }
    url.hash = '';
    return url.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return normalizeSearchText(input);
  }
}

function extractAttribute(input: string, name: string): string {
  const match = input.match(new RegExp(`${name}=(?:"([^"]*)"|'([^']*)')`, 'i'));
  return decodeEntities(match?.[1] ?? match?.[2] ?? '').trim();
}

function normalizeSearchResultUrl(url: string, baseUrl: string): string {
  if (!url) return '';
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return url;
  }
}

function stripNonContentHtml(input: string): string {
  return input
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ');
}

function extractTag(input: string, tag: string): string {
  const match = input.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match?.[1] ?? '';
}

function cleanXml(input: string): string {
  return decodeEntities(input.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')).trim();
}

function extractReadableText(html: string): string {
  const stripped = stripNonContentHtml(html)
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ');
  const container = extractPreferredContentContainer(stripped);
  const paragraphs = extractParagraphTexts(container).filter((paragraph) => paragraph.length >= 20 && !isBoilerplateParagraph(paragraph));
  if (paragraphs.length > 0) return paragraphs.join(' ');
  return cleanXml(container);
}

function extractPreferredContentContainer(html: string): string {
  const selectors = [
    /<article\b[\s\S]*?<\/article>/i,
    /<div\b(?=[^>]*\bclass=(?:"[^"]*\barticle-content\b[^"]*"|'[^']*\barticle-content\b[^']*'))[^>]*>[\s\S]*?<\/div>/i,
    /<div\b(?=[^>]*\bclass=(?:"[^"]*\barticle\b[^"]*"|'[^']*\barticle\b[^']*'))[^>]*>[\s\S]*?<\/div>/i,
    /<div\b(?=[^>]*\bclass=(?:"[^"]*\bcontent\b[^"]*"|'[^']*\bcontent\b[^']*'))[^>]*>[\s\S]*?<\/div>/i,
    /<div\b(?=[^>]*\bclass=(?:"[^"]*\bmain-content\b[^"]*"|'[^']*\bmain-content\b[^']*'))[^>]*>[\s\S]*?<\/div>/i,
    /<div\b(?=[^>]*\bid=(?:"js_content"|'js_content'))[^>]*>[\s\S]*?<\/div>/i,
    /<div\b(?=[^>]*\bclass=(?:"[^"]*\brich_media_content\b[^"]*"|'[^']*\brich_media_content\b[^']*'))[^>]*>[\s\S]*?<\/div>/i,
    /<div\b(?=[^>]*\bclass=(?:"[^"]*\bpost-content\b[^"]*"|'[^']*\bpost-content\b[^']*'))[^>]*>[\s\S]*?<\/div>/i,
    /<div\b(?=[^>]*\bclass=(?:"[^"]*\bentry-content\b[^"]*"|'[^']*\bentry-content\b[^']*'))[^>]*>[\s\S]*?<\/div>/i,
    /<main\b[\s\S]*?<\/main>/i,
    /<body\b[\s\S]*?<\/body>/i,
  ];
  for (const selector of selectors) {
    const match = html.match(selector)?.[0];
    if (match) return match;
  }
  return html;
}

function extractParagraphTexts(html: string): string[] {
  return [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => compactText(cleanXml(match[1])))
    .filter(Boolean);
}

function isBoilerplateParagraph(text: string): boolean {
  return /(版权所有|本文转载自|更多精彩内容|扫码关注|关注我们|点击关注|未经授权|责任编辑|声明[:：]|来源[:：]|原标题[:：])/u.test(text);
}

function compactText(input: string): string {
  return decodeEntities(input)
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function buildBuiltinKnowledgeSection(task: Task): AiSourceSection {
  const pov = task.narrativePov === 'first-person' ? 'first-person narration' : task.narrativePov === 'third-person' ? 'third-person narration' : 'the original narrative point of view';
  return {
    source: 'builtin-knowledge',
    title: '本地知识补全',
    content: [
      `Track: ${task.track}.`,
      `Style: ${task.style}; ratio: ${task.ratio}.`,
      `Rewrite intensity: ${task.rewriteIntensity}; use ${pov}.`,
      task.keepPromotion ? 'Keep product or promotion intent if present.' : 'Do not add promotion unless source material requires it.',
      task.extraRequirements ? `Creator requirements: ${task.extraRequirements}` : '',
    ].filter(Boolean).join(' '),
  };
}
