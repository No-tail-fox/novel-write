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

const BACKEND_LABELS: Record<WebSearchBackend, string> = {
  searxng: 'SearXNG',
  tavily: 'Tavily Keyless',
  legacy: '兼容搜索源',
};

const SEARXNG_ENGINE_MAP: Record<WebSearchProvider, string> = {
  bing: 'bing',
  baidu: 'baidu',
  sogou: 'sogou',
  toutiao: 'toutiao',
};

const SEARCH_MAX_BYTES = 2 * 1024 * 1024;

export async function searchConfiguredBackends(
  config: WebSearchConfig,
  query: string,
  providers: readonly WebSearchProvider[],
  fetchImpl: FetchLike,
  legacySearch: () => Promise<AiSourceSection[]>,
): Promise<WebSearchBackendResult> {
  const statuses: WebSearchBackendStatus[] = [];
  const warnings: string[] = [];

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
      statuses.push({ backend: 'tavily', label: BACKEND_LABELS.tavily, state: 'failed', count: 0, message });
      warnings.push(`Tavily Keyless 搜索失败：${message}`);
    }
  } else {
    statuses.push({ backend: 'tavily', label: BACKEND_LABELS.tavily, state: 'disabled', count: 0, message: '已关闭备用搜索' });
  }

  if (config.legacyFallbackEnabled) {
    try {
      const items = await legacySearch();
      statuses.push({ backend: 'legacy', label: BACKEND_LABELS.legacy, state: items.length ? 'ready' : 'empty', count: items.length });
      return { items, statuses, warnings };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      statuses.push({ backend: 'legacy', label: BACKEND_LABELS.legacy, state: 'failed', count: 0, message });
      warnings.push(`兼容搜索源失败：${message}`);
    }
  } else {
    statuses.push({ backend: 'legacy', label: BACKEND_LABELS.legacy, state: 'disabled', count: 0, message: '已关闭兼容降级' });
  }

  return { items: [], statuses, warnings };
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
  if (!response.ok) throw new Error(`Tavily returned ${response.status}`);
  const payload = response.json as unknown;
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { results?: unknown }).results)) {
    throw new Error('Tavily 返回格式无效。');
  }
  return (payload as { results: unknown[] }).results
    .map((entry, index) => normalizeTavilyResult(entry, index))
    .filter((item): item is AiSourceSection => Boolean(item))
    .slice(0, 10);
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
