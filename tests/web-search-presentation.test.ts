import { describe, expect, it } from 'vitest';
import { formatWebSearchBackendStatus, formatWebSearchProviderStatus, formatWebSearchSourceLabel } from '../src/shared/web-search-presentation';

describe('web search presentation', () => {
  it('keeps the search backend and underlying engine visible in source labels', () => {
    expect(formatWebSearchSourceLabel({ source: 'web', backend: 'agent-search', provider: 'bing', url: 'https://example.test' }))
      .toBe('Agent Search · 必应');
    expect(formatWebSearchSourceLabel({ source: 'web', backend: 'agent-search', provider: 'wikipedia' }))
      .toBe('Agent Search · 维基百科');
    expect(formatWebSearchSourceLabel({ source: 'web', backend: 'agent-search' }))
      .toBe('Agent Search');
  });

  it('uses useful fallbacks for sources without backend metadata', () => {
    expect(formatWebSearchSourceLabel({ source: 'web', provider: 'duckduckgo' })).toBe('DuckDuckGo');
    expect(formatWebSearchSourceLabel({ source: 'web', url: 'https://www.example.com/article' })).toBe('example.com');
    expect(formatWebSearchSourceLabel({ source: 'internal-archive' })).toBe('internal-archive');
  });

  it('formats backend and provider states for compact status chips', () => {
    expect(formatWebSearchBackendStatus({ backend: 'agent-search', label: 'Agent Search', state: 'ready', count: 9 }))
      .toBe('Agent Search · 9 条');
    expect(formatWebSearchBackendStatus({ backend: 'tavily', label: 'Tavily', state: 'limited', count: 0 }))
      .toBe('Tavily · 受限');
    expect(formatWebSearchProviderStatus({ provider: 'bing', label: '必应', state: 'empty', count: 0 }))
      .toBe('必应 · 无精准结果');
  });
});
