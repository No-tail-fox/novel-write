import type { AiSourceSection, WebSearchBackend, WebSearchBackendStatus, WebSearchProvider, WebSearchProviderStatus } from './types';

const WEB_SEARCH_BACKEND_LABELS: Record<WebSearchBackend, string> = {
  'agent-search': 'Agent Search',
  searxng: 'SearXNG',
  tavily: 'Tavily',
  legacy: '兼容搜索源',
};

const WEB_SEARCH_PROVIDER_LABELS: Record<WebSearchProvider, string> = {
  bing: '必应',
  baidu: '百度',
  sogou: '搜狗',
  toutiao: '头条',
  duckduckgo: 'DuckDuckGo',
  wikipedia: '维基百科',
};

export function formatWebSearchSourceLabel(
  source: Pick<AiSourceSection, 'backend' | 'provider' | 'source' | 'url'>,
): string {
  const backendLabel = source.backend ? WEB_SEARCH_BACKEND_LABELS[source.backend] : '';
  const providerLabel = source.provider ? WEB_SEARCH_PROVIDER_LABELS[source.provider] : '';
  if (backendLabel && providerLabel) return `${backendLabel} · ${providerLabel}`;
  if (backendLabel) return backendLabel;
  if (providerLabel) return providerLabel;

  try {
    const hostname = new URL(source.url ?? '').hostname.replace(/^www\./u, '');
    if (hostname) return hostname;
  } catch {
    // A result can omit its URL; use its normalized source name below.
  }

  const sourceName = source.source.trim();
  return sourceName && sourceName !== 'web' ? sourceName : '网页来源';
}

export function formatWebSearchBackendStatus(status: WebSearchBackendStatus): string {
  return `${status.label} · ${webSearchStatusSummary(status.state, status.count)}`;
}

export function formatWebSearchProviderStatus(status: WebSearchProviderStatus): string {
  return `${status.label} · ${webSearchStatusSummary(status.state, status.count, true)}`;
}

function webSearchStatusSummary(
  state: WebSearchBackendStatus['state'],
  count: number,
  preciseEmpty = false,
): string {
  if (state === 'ready') return `${count} 条`;
  if (state === 'empty') return preciseEmpty ? '无精准结果' : '无结果';
  if (state === 'disabled') return '未启用';
  if (state === 'limited') return '受限';
  return '失败';
}
