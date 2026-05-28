import type { JsonLlm } from './llm-provider';
import type { AiSourceContext, AiSourceSection, AppConfig, ResearchCopyComposeInput, ResearchCopyComposeResult, Task } from './types';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
type SearchResultItem = Omit<AiSourceSection, 'source'>;

export type AiSourceResearcher = (task: Task) => Promise<AiSourceContext>;

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
      if (config.ima.apiKey && (config.ima.kbId || config.ima.kbName)) {
        context.sections.push({
          source: 'ima',
          title: config.ima.kbName || config.ima.kbId,
          content: `IMA knowledge base is configured. Use it as a preferred private reference for "${query}".`,
        });
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
  const searchItems: AiSourceSection[] = [];
  let searchError: unknown = null;
  try {
    searchItems.push(...await searchBingRss(query, fetchImpl));
  } catch (error) {
    searchError = error;
  }

  if (shouldSearchAdditionalChineseSources(query, searchItems)) {
    const extraResults = await searchAdditionalChineseSources(query, fetchImpl);
    for (const result of extraResults) {
      if (result.status === 'fulfilled') {
        searchItems.push(...result.value);
      } else {
        searchError ??= result.reason;
      }
    }
  }

  if (searchItems.length === 0 && searchError) {
    throw searchError instanceof Error ? searchError : new Error(String(searchError));
  }

  const rankedItems = rankSearchItems(query, searchItems);
  return Promise.all(rankedItems.slice(0, 10).map(async (item) => {
    let content = item.content;
    if (item.url) {
      const pageText = await fetchPageText(item.url, fetchImpl).catch(() => '');
      if (pageText) {
        content = pageText;
      }
    }
    return { ...item, snippet: item.content, content };
  }));
}

async function searchBingRss(query: string, fetchImpl: FetchLike): Promise<AiSourceSection[]> {
  const urls = [
    `https://cn.bing.com/search?q=${encodeURIComponent(query)}&format=rss`,
    `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss`,
  ];
  let lastError: unknown = null;
  for (const url of urls) {
    try {
      const response = await fetchWithTimeout(fetchImpl, url, 8000, 'application/rss+xml,text/xml,*/*');
      if (!response.ok) {
        lastError = new Error(`Bing RSS returned ${response.status}`);
        continue;
      }
      const xml = await response.text();
      return extractRssItems(xml).slice(0, 20).map((item) => ({ source: 'web', ...item }));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'Bing RSS request failed'));
}

async function searchSogouHtml(query: string, fetchImpl: FetchLike): Promise<AiSourceSection[]> {
  const url = `https://www.sogou.com/web?query=${encodeURIComponent(query)}`;
  const response = await fetchWithTimeout(fetchImpl, url, 8000, 'text/html,application/xhtml+xml,*/*');
  if (!response.ok) {
    throw new Error(`Sogou returned ${response.status}`);
  }
  const html = await response.text();
  return extractSogouItems(html).slice(0, 20).map((item) => ({ source: 'web', ...item }));
}

async function searchBaiduHtml(query: string, fetchImpl: FetchLike): Promise<AiSourceSection[]> {
  const url = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`;
  const response = await fetchWithTimeout(fetchImpl, url, 8000, 'text/html,application/xhtml+xml,*/*');
  if (!response.ok) {
    throw new Error(`Baidu returned ${response.status}`);
  }
  const html = await response.text();
  return extractBaiduItems(html).slice(0, 20).map((item) => ({ source: 'web', ...item }));
}

async function searchSo360Html(query: string, fetchImpl: FetchLike): Promise<AiSourceSection[]> {
  const url = `https://www.so.com/s?q=${encodeURIComponent(query)}`;
  const response = await fetchWithTimeout(fetchImpl, url, 8000, 'text/html,application/xhtml+xml,*/*');
  if (!response.ok) {
    throw new Error(`360 Search returned ${response.status}`);
  }
  const html = await response.text();
  return extractSo360Items(html).slice(0, 20).map((item) => ({ source: 'web', ...item }));
}

function searchAdditionalChineseSources(query: string, fetchImpl: FetchLike): Promise<Array<PromiseSettledResult<AiSourceSection[]>>> {
  const searches = [
    searchSogouHtml(query, fetchImpl),
    searchBaiduHtml(query, fetchImpl),
    searchSo360Html(query, fetchImpl),
    ...buildChineseSupplementalSourceQueries(query).map((supplementalQuery) => searchBaiduHtml(supplementalQuery, fetchImpl)),
  ];
  return Promise.allSettled(searches);
}

function buildChineseSupplementalSourceQueries(query: string): string[] {
  return [`${query} \u77e5\u4e4e`, `${query} \u767e\u5bb6\u53f7`, `${query} \u5934\u6761\u53f7`];
}

export async function composeCopyFromSources(runJson: JsonLlm, input: ResearchCopyComposeInput): Promise<ResearchCopyComposeResult> {
  const selectedSources = input.selectedSources.filter((source) => source.source === 'web').slice(0, 10);
  if (selectedSources.length === 0) {
    throw new Error('Please select at least one web source before generating copy.');
  }

  const sourceBlocks = selectedSources
    .map((source, index) => {
      const url = source.url ? `\nURL: ${source.url}` : '';
      const text = compactText(source.content || source.snippet || '').slice(0, 2600);
      return `${index + 1}. ${source.title}${url}\n${text}`;
    })
    .join('\n\n');

  const result = await runJson<{ title?: string; copy?: string; inputText?: string; materialText?: string }>({
    step: 0,
    name: 'research-copy',
    messages: [
      {
        role: 'system',
        content:
          'You are a short-video script researcher. Use only the selected web page material and the user requirements to write a concise Chinese source copy. Return strict JSON only.',
      },
      {
        role: 'user',
        content: [
          `Keyword: ${input.keyword}`,
          input.extraRequirements ? `Extra requirements: ${input.extraRequirements}` : '',
          'Selected web page material:',
          sourceBlocks,
          'Output JSON shape: {"title":"一个适合任务标题的短标题","copy":"一段可继续进入短视频流水线的中文文案素材，保留事实依据，避免编造网页中没有的信息。"}',
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    ],
  });

  const copy = (result.json.copy || result.json.inputText || result.json.materialText || '').trim();
  if (!copy) {
    throw new Error('LLM did not return copy text for selected sources.');
  }
  return { title: (result.json.title || '').trim(), copy, raw: result.raw, requestId: result.requestId };
}

async function fetchPageText(url: string, fetchImpl: FetchLike): Promise<string> {
  const response = await fetchWithTimeout(fetchImpl, url, 8000, 'text/html,application/xhtml+xml,text/plain,*/*');
  if (!response.ok) return '';
  const contentType = response.headers.get('content-type') ?? '';
  if (!/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) return '';
  const body = await response.text();
  const text = contentType.includes('text/plain') ? body : extractReadableText(body);
  return compactText(text).slice(0, 3000);
}

async function fetchWithTimeout(fetchImpl: FetchLike, url: string, timeoutMs: number, accept: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        Accept: accept,
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 StoryboundReplica/1.0',
      },
    });
  } finally {
    clearTimeout(timer);
  }
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

function extractSogouItems(html: string): SearchResultItem[] {
  return [...html.matchAll(/<div class="vrwrap"[\s\S]*?<!--\s*z\s*-->/gi)]
    .map(([block]) => {
      const titleHtml = block.match(/<h3\b[\s\S]*?<\/h3>/i)?.[0] ?? '';
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
  return [
    ...html.matchAll(/<div\b[^>]*class="[^"]*(?:result|c-container)[^"]*"[\s\S]*?(?=<div\b[^>]*class="[^"]*(?:result|c-container)[^"]*"|<div\b[^>]*id="page"|$)/gi),
  ]
    .map(([block]) => {
      const titleHtml = block.match(/<h3\b[\s\S]*?<\/h3>/i)?.[0] ?? '';
      const title = cleanXml(titleHtml);
      const url = normalizeSearchResultUrl(extractAttribute(block, 'mu') || extractBaiduDataToolsUrl(block) || extractAttribute(titleHtml, 'href'), 'https://www.baidu.com');
      const content = cleanSearchResultContent(block, title);
      return { title, url, content };
    })
    .filter((item) => item.title && item.content);
}

function extractSo360Items(html: string): SearchResultItem[] {
  return [...html.matchAll(/<(?:li|div)\b[^>]*class="[^"]*(?:res-list|result)[^"]*"[\s\S]*?(?=<(?:li|div)\b[^>]*class="[^"]*(?:res-list|result)[^"]*"|<\/(?:ol|ul)>|$)/gi)]
    .map(([block]) => {
      const titleHtml = block.match(/<h3\b[\s\S]*?<\/h3>/i)?.[0] ?? '';
      const title = cleanXml(titleHtml);
      const url = normalizeSearchResultUrl(extractAttribute(titleHtml, 'href'), 'https://www.so.com');
      const content = cleanSearchResultContent(block, title);
      return { title, url, content };
    })
    .filter((item) => item.title && item.content);
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
      const key = normalizeDedupeKey(item.url || item.title);
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
  return compactQuery.replace(chineseDeathIntentPattern(), '');
}

function hasChineseIntentSuffix(query: string): boolean {
  return chineseDeathIntentPattern().test(normalizeSearchText(query));
}

function chineseDeathIntentPattern(): RegExp {
  return /(?:\u4e4b\u6b7b|\u6b7b\u4ea1|\u6b7b\u56e0|\u4e3a\u4ec0\u4e48(?:\u4f1a)?\u6b7b|\u4e3a\u5565(?:\u4f1a)?\u6b7b|\u4e3a\u4f55(?:\u4f1a)?\u6b7b|\u600e\u4e48(?:\u4f1a)?\u6b7b\u7684?|\u5982\u4f55\u6b7b|\u6b7b\u4e86\u5417|\u6b7b\u6ca1\u6b7b|\u6700\u540e\u6b7b\u4e86\u6ca1|\u6700\u540e\u6d3b\u4e86\u5417|\u53bb\u4e16|\u9047\u5bb3|\u727a\u7272|\u7ed3\u5c40)$/u;
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

function extractBaiduDataToolsUrl(input: string): string {
  const raw = extractAttribute(input, 'data-tools');
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as { url?: unknown };
    return typeof parsed.url === 'string' ? parsed.url : '';
  } catch {
    return raw.match(/"url"\s*:\s*"([^"]+)"/i)?.[1] ?? '';
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

function cleanSearchResultContent(block: string, title: string): string {
  return compactText(cleanXml(stripNonContentHtml(block)).replace(title, ''))
    .replace(/(?:反馈|快照|百度快照)$/u, '')
    .replace(/["'}\]]+,?\s*"?(?:clamp|isSingleLine|summarySpan|isPc|consistencyUpgrade|pageStyleUpgrade|urlParams|poster|style|styles)\b[\s\S]*$/u, '')
    .trim();
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
  const article = stripped.match(/<article\b[\s\S]*?<\/article>/i)?.[0] ?? stripped.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ?? stripped;
  return cleanXml(article);
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
