import { fetchWithNetworkPolicy, readJsonBounded, type NetworkPurpose } from './network-policy';
import type {
  AiSourceSection,
  WebSearchBackend,
  WebSearchBackendStatus,
  WebSearchConfig,
  WebSearchProvider,
} from './types';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface WebSearchBackendResult {
  items: AiSourceSection[];
  statuses: WebSearchBackendStatus[];
  warnings: string[];
}

export interface AgentSearchRequest {
  query: string;
  engines: string[];
  count: number;
}

export type AgentSearchExecutor = (request: AgentSearchRequest) => Promise<unknown>;

export interface ParsedAgentSearchResponse {
  items: AiSourceSection[];
  warnings: string[];
  message?: string;
}

const BACKEND_LABELS: Record<WebSearchBackend, string> = {
  'agent-search': 'Agent Search',
  searxng: 'SearXNG',
  tavily: 'Tavily Keyless',
  legacy: '兼容搜索源',
};

const AGENT_SEARCH_ENGINE_MAP: Partial<Record<WebSearchProvider, string>> = {
  bing: 'bing',
  baidu: 'baidu',
  sogou: 'sogou',
  duckduckgo: 'duckduckgo',
  wikipedia: 'wikipedia',
};

const SEARXNG_ENGINE_MAP: Record<WebSearchProvider, string> = {
  bing: 'bing',
  baidu: 'baidu',
  sogou: 'sogou',
  toutiao: 'toutiao',
  duckduckgo: 'duckduckgo',
  wikipedia: 'wikipedia',
};

const SEARCH_MAX_BYTES = 2 * 1024 * 1024;

class SearchBackendLimitedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchBackendLimitedError';
  }
}

export async function searchConfiguredBackends(
  config: WebSearchConfig,
  query: string,
  providers: readonly WebSearchProvider[],
  fetchImpl: FetchLike,
  legacySearch: () => Promise<AiSourceSection[]>,
  agentSearch?: AgentSearchExecutor,
): Promise<WebSearchBackendResult> {
  const statuses: WebSearchBackendStatus[] = [];
  const warnings: string[] = [];
  const deferredWarnings: string[] = [];

  if (config.agentSearchEnabled) {
    const engines = Array.from(new Set(providers.map((provider) => AGENT_SEARCH_ENGINE_MAP[provider]).filter((engine): engine is string => Boolean(engine))));
    if (engines.length === 0) {
      statuses.push({ backend: 'agent-search', label: BACKEND_LABELS['agent-search'], state: 'disabled', count: 0, message: '当前选择的来源没有可用适配器' });
    } else if (!agentSearch) {
      const message = '当前运行环境未提供 Agent Search 执行器';
      statuses.push({ backend: 'agent-search', label: BACKEND_LABELS['agent-search'], state: 'failed', count: 0, message });
      warnings.push(`Agent Search 搜索失败：${message}`);
    } else {
      try {
        const parsed = parseAgentSearchResponse(await agentSearch({ query, engines, count: 12 }));
        statuses.push({
          backend: 'agent-search',
          label: BACKEND_LABELS['agent-search'],
          state: parsed.items.length ? 'ready' : 'empty',
          count: parsed.items.length,
          ...(parsed.message ? { message: parsed.message } : {}),
        });
        warnings.push(...parsed.warnings);
        if (parsed.items.length > 0) return { items: parsed.items, statuses, warnings };
        warnings.push('Agent Search 没有返回结果，正在尝试备用搜索源。');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        statuses.push({ backend: 'agent-search', label: BACKEND_LABELS['agent-search'], state: 'failed', count: 0, message });
        warnings.push(`Agent Search 搜索失败：${message}`);
      }
    }
  } else {
    statuses.push({ backend: 'agent-search', label: BACKEND_LABELS['agent-search'], state: 'disabled', count: 0, message: '已关闭聚合搜索' });
  }

  if (config.searxngBaseUrl.trim()) {
    try {
      const items = await searchSearxng(config.searxngBaseUrl, query, providers, fetchImpl);
      statuses.push({ backend: 'searxng', label: BACKEND_LABELS.searxng, state: items.length ? 'ready' : 'empty', count: items.length });
      if (items.length > 0) return { items, statuses, warnings };
      warnings.push('SearXNG 没有返回结果，正在尝试备用搜索源。');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      statuses.push({ backend: 'searxng', label: BACKEND_LABELS.searxng, state: 'failed', count: 0, message });
      warnings.push(`SearXNG 搜索失败：${message}`);
    }
  } else {
    statuses.push({ backend: 'searxng', label: BACKEND_LABELS.searxng, state: 'disabled', count: 0, message: '未配置服务地址' });
  }

  if (config.tavilyKeylessEnabled) {
    try {
      const items = await searchTavilyKeyless(query, fetchImpl);
      statuses.push({ backend: 'tavily', label: BACKEND_LABELS.tavily, state: items.length ? 'ready' : 'empty', count: items.length });
      if (items.length > 0) return { items, statuses, warnings };
      warnings.push('Tavily Keyless 没有返回结果，正在尝试兼容搜索源。');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof SearchBackendLimitedError) {
        statuses.push({ backend: 'tavily', label: BACKEND_LABELS.tavily, state: 'limited', count: 0, message });
        deferredWarnings.push(`Tavily Keyless 暂不可用：${message}`);
      } else {
        statuses.push({ backend: 'tavily', label: BACKEND_LABELS.tavily, state: 'failed', count: 0, message });
        warnings.push(`Tavily Keyless 搜索失败：${message}`);
      }
    }
  } else {
    statuses.push({ backend: 'tavily', label: BACKEND_LABELS.tavily, state: 'disabled', count: 0, message: '已关闭备用搜索' });
  }

  if (config.legacyFallbackEnabled) {
    try {
      const items = await legacySearch();
      statuses.push({ backend: 'legacy', label: BACKEND_LABELS.legacy, state: items.length ? 'ready' : 'empty', count: items.length });
      return { items, statuses, warnings: items.length ? warnings : [...warnings, ...deferredWarnings] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      statuses.push({ backend: 'legacy', label: BACKEND_LABELS.legacy, state: 'failed', count: 0, message });
      warnings.push(`兼容搜索源失败：${message}`);
    }
  } else {
    statuses.push({ backend: 'legacy', label: BACKEND_LABELS.legacy, state: 'disabled', count: 0, message: '已关闭兼容降级' });
  }

  return { items: [], statuses, warnings: [...warnings, ...deferredWarnings] };
}

export function parseAgentSearchResponse(payload: unknown): ParsedAgentSearchResponse {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { results?: unknown }).results)) {
    throw new Error('Agent Search 返回格式无效。');
  }
  const value = payload as Record<string, unknown>;
  const items: AiSourceSection[] = [];
  const seenUrls = new Set<string>();
  let rejectedInjectionCount = 0;
  for (const [index, entry] of (value.results as unknown[]).entries()) {
    if (isAgentSearchInjectionResult(entry)) {
      rejectedInjectionCount += 1;
      continue;
    }
    const item = normalizeAgentSearchResult(entry, index);
    if (!item?.url) continue;
    const key = item.url.toLowerCase();
    if (seenUrls.has(key)) continue;
    seenUrls.add(key);
    items.push(item);
    if (items.length >= 15) break;
  }

  const warnings = normalizeAgentSearchFailures(value.partialFailures);
  if (rejectedInjectionCount > 0) {
    warnings.unshift(`Agent Search 已过滤 ${rejectedInjectionCount} 条疑似提示注入结果。`);
  }
  const meta = value.meta && typeof value.meta === 'object' ? value.meta as Record<string, unknown> : undefined;
  const execution = meta?.execution && typeof meta.execution === 'object' ? meta.execution as Record<string, unknown> : undefined;
  const searchedEngines = Array.isArray(execution?.searched_engines)
    ? execution.searched_engines.map((engine) => String(engine).trim()).filter(Boolean)
    : [];
  const stopReason = String(execution?.stop_reason ?? '').trim();
  const budgetExhausted = stopReason === 'budget_exhausted';
  if (budgetExhausted) warnings.push('Agent Search 已达到本次检索预算，结果可能不完整。');
  const messageParts = [
    searchedEngines.length > 0 ? `已检索 ${searchedEngines.map(agentSearchEngineLabel).join('、')}` : '',
    stopReason ? agentSearchStopReasonLabel(stopReason) : '',
  ].filter(Boolean);
  return {
    items,
    warnings,
    ...(messageParts.length > 0 ? { message: messageParts.join('；') } : {}),
  };
}

export async function searchSearxng(
  baseUrl: string,
  query: string,
  providers: readonly WebSearchProvider[],
  fetchImpl: FetchLike = fetch,
): Promise<AiSourceSection[]> {
  const normalizedBaseUrl = `${baseUrl.trim().replace(/\/+$/u, '')}/`;
  const url = new URL('search', normalizedBaseUrl);
  url.searchParams.set('format', 'json');
  url.searchParams.set('q', query.trim());
  url.searchParams.set('language', 'zh-CN');
  url.searchParams.set('safesearch', '0');
  const engines = providers.map((provider) => SEARXNG_ENGINE_MAP[provider]).filter(Boolean);
  if (engines.length > 0) url.searchParams.set('engines', engines.join(','));
  const response = await fetchSearchJson(fetchImpl, url.href, { method: 'GET' });
  if (!response.ok) throw new Error(`SearXNG returned ${response.status}`);
  const payload = response.json as unknown;
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { results?: unknown }).results)) {
    throw new Error('SearXNG 返回格式无效。');
  }
  return (payload as { results: unknown[] }).results
    .map((entry, index) => normalizeSearxngResult(entry, index, providers))
    .filter((item): item is AiSourceSection => Boolean(item))
    .slice(0, 15);
}

export async function searchTavilyKeyless(query: string, fetchImpl: FetchLike = fetch): Promise<AiSourceSection[]> {
  const response = await fetchSearchJson(fetchImpl, 'https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: query.trim(),
      search_depth: 'advanced',
      topic: 'general',
      max_results: 10,
      include_answer: false,
      include_raw_content: false,
    }),
    extraHeaders: {
      'X-Tavily-Access-Mode': 'keyless',
      'X-Client-Source': 'tavily-js-keyless',
    },
  });
  if (!response.ok) throw tavilyResponseError(response.status, response.json);
  const payload = response.json as unknown;
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { results?: unknown }).results)) {
    throw new Error('Tavily 返回格式无效。');
  }
  return (payload as { results: unknown[] }).results
    .map((entry, index) => normalizeTavilyResult(entry, index))
    .filter((item): item is AiSourceSection => Boolean(item))
    .slice(0, 10);
}

function tavilyResponseError(status: number, payload: unknown): Error {
  const errorPayload = payload && typeof payload === 'object'
    ? (payload as { error?: unknown }).error
    : undefined;
  const details = errorPayload && typeof errorPayload === 'object'
    ? errorPayload as { code?: unknown; message?: unknown }
    : undefined;
  const code = String(details?.code ?? '').trim().toLowerCase();
  if (status === 429 && (code.includes('cap_reached') || code.includes('rate_limit'))) {
    return new SearchBackendLimitedError('免费额度已用完，已自动改用其他搜索源。');
  }
  const message = String(details?.message ?? '').trim();
  return new Error(message ? `Tavily 返回 ${status}：${message}` : `Tavily 返回 ${status}`);
}

async function fetchSearchJson(
  fetchImpl: FetchLike,
  url: string,
  options: { method: string; headers?: Record<string, string>; extraHeaders?: Record<string, string>; body?: string },
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const response = await fetchWithNetworkPolicy(url, {
    purpose: 'provider-api' satisfies NetworkPurpose,
    fetchImpl,
    timeoutMs: 12_000,
    maxBytes: SEARCH_MAX_BYTES,
    method: options.method,
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'User-Agent': 'StoryDream/1.0',
      ...options.headers,
      ...options.extraHeaders,
    },
    body: options.body,
  });
  const json = await readJsonBounded(response, SEARCH_MAX_BYTES);
  return { ok: response.ok, status: response.status, json };
}

function normalizeSearxngResult(entry: unknown, index: number, providers: readonly WebSearchProvider[]): AiSourceSection | null {
  if (!entry || typeof entry !== 'object') return null;
  const value = entry as Record<string, unknown>;
  const title = String(value.title ?? '').trim();
  const url = String(value.url ?? '').trim();
  const content = String(value.content ?? value.snippet ?? '').trim();
  if (!title || !url) return null;
  const engine = String(value.engine ?? '').toLowerCase();
  const provider = providers.find((candidate) => engine.includes(SEARXNG_ENGINE_MAP[candidate])) ?? undefined;
  return {
    source: 'web',
    backend: 'searxng',
    ...(provider ? { provider } : {}),
    title,
    url,
    snippet: content,
    content: content || `SearXNG 搜索结果 ${index + 1}`,
  };
}

function normalizeAgentSearchResult(entry: unknown, index: number): AiSourceSection | null {
  if (!entry || typeof entry !== 'object') return null;
  const value = entry as Record<string, unknown>;
  const security = value.security && typeof value.security === 'object' ? value.security as Record<string, unknown> : undefined;
  if (security?.url_safe === false) return null;
  const title = cleanAgentSearchTitle(String(value.title ?? ''));
  const url = normalizePublicResultUrl(value.url);
  const snippet = String(value.snippet ?? '').trim();
  if (!title || !url) return null;
  const provider = agentSearchResultProvider(value.sources);
  return {
    source: 'web',
    backend: 'agent-search',
    ...(provider ? { provider } : {}),
    title,
    url,
    snippet,
    content: snippet || `Agent Search 搜索结果 ${index + 1}`,
  };
}

function cleanAgentSearchTitle(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  const duplicatedUrl = /^[a-z0-9.-]+\.[a-z]{2,}(https?:\/\/.*)$/iu.exec(normalized)?.[1];
  if (!duplicatedUrl) return normalized;
  return duplicatedUrl
    .replace(/^https?:\/\/(?:www\.)?/iu, '')
    .replace(/\s*›\s*/gu, ' › ')
    .trim();
}

function isAgentSearchInjectionResult(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const value = entry as Record<string, unknown>;
  const security = value.security && typeof value.security === 'object' ? value.security as Record<string, unknown> : undefined;
  if (security?.injection_detected === true) return true;
  return [value.title, value.snippet].some((text) => /\[[^\]]*SUSPICIOUS CONTENT[^\]]*\]/iu.test(String(text ?? '')));
}

function normalizePublicResultUrl(input: unknown): string {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}

function agentSearchResultProvider(input: unknown): WebSearchProvider | undefined {
  const sources = Array.isArray(input) ? input.map((source) => String(source).toLowerCase()) : [];
  const providers: WebSearchProvider[] = ['bing', 'baidu', 'sogou', 'duckduckgo', 'wikipedia'];
  return providers.find((provider) => sources.some((source) => source === provider || source.startsWith(`${provider}-`)));
}

function normalizeAgentSearchFailures(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0) return [];
  const failures = input
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
    .slice(0, 4)
    .map((entry) => {
      const engine = agentSearchEngineLabel(String(entry.engine ?? '').trim() || '未知引擎');
      const type = agentSearchFailureLabel(String(entry.type ?? '').trim());
      return `${engine}（${type}）`;
    });
  if (failures.length === 0) return [];
  const remaining = Math.max(0, input.length - failures.length);
  return [`Agent Search 部分引擎不可用：${failures.join('、')}${remaining > 0 ? `，另有 ${remaining} 个` : ''}。`];
}

function agentSearchEngineLabel(engine: string): string {
  const labels: Record<string, string> = {
    bing: 'Bing',
    baidu: '百度',
    sogou: '搜狗',
    duckduckgo: 'DuckDuckGo',
    wikipedia: 'Wikipedia',
    startpage: 'Startpage',
    yandex: 'Yandex',
    mojeek: 'Mojeek',
    wiby: 'Wiby',
    request_budget: '检索预算',
  };
  return labels[engine.toLowerCase()] ?? engine;
}

function agentSearchFailureLabel(type: string): string {
  const labels: Record<string, string> = {
    timeout: '超时',
    rate_limited: '请求受限',
    bot_challenge: '站点验证',
    budget_exhausted: '预算已用完',
    permission_denied: '不可用',
    parse_error: '解析失败',
    validation_error: '请求无效',
    upstream_4xx: '上游拒绝',
    upstream_5xx: '上游故障',
    unknown: '未知错误',
  };
  return (labels[type] ?? type) || '未知错误';
}

function agentSearchStopReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    quality_gate_satisfied: '结果质量已达标',
    phases_exhausted: '已完成可用引擎',
    budget_exhausted: '已达到检索预算',
  };
  return labels[reason] ?? reason;
}

function normalizeTavilyResult(entry: unknown, index: number): AiSourceSection | null {
  if (!entry || typeof entry !== 'object') return null;
  const value = entry as Record<string, unknown>;
  const title = String(value.title ?? '').trim();
  const url = String(value.url ?? '').trim();
  const content = String(value.content ?? value.raw_content ?? '').trim();
  if (!title || !url) return null;
  return {
    source: 'web',
    backend: 'tavily',
    title,
    url,
    snippet: content,
    content: content || `Tavily 搜索结果 ${index + 1}`,
  };
}
