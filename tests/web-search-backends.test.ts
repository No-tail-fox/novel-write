import { describe, expect, it } from 'vitest';
import { searchConfiguredBackends, searchSearxng, searchTavilyKeyless } from '@shared/web-search-backends';
import type { AiSourceSection, WebSearchConfig } from '@shared/types';

const config: WebSearchConfig = {
  searxngBaseUrl: 'http://127.0.0.1:8080',
  tavilyKeylessEnabled: true,
  legacyFallbackEnabled: true,
};

describe('web search backends', () => {
  it('parses SearXNG JSON and maps the selected engine to the legacy provider label', async () => {
    let requestUrl = '';
    const items = await searchSearxng(`${config.searxngBaseUrl}/searxng`, 'OpenAI 发布', ['bing', 'sogou'], async (url) => {
      requestUrl = String(url);
      return new Response(JSON.stringify({ results: [{ title: 'OpenAI 发布新模型', url: 'https://example.test/openai', content: '官方发布信息。', engine: 'bing' }] }), { status: 200 });
    });
    expect(requestUrl).toContain('/searxng/search?format=json');
    expect(requestUrl).toContain('engines=bing%2Csogou');
    expect(items[0]).toMatchObject({ backend: 'searxng', provider: 'bing', title: 'OpenAI 发布新模型', snippet: '官方发布信息。' });
  });

  it('sends Tavily keyless headers and normalizes result content', async () => {
    let requestInit: RequestInit | undefined;
    const items = await searchTavilyKeyless('Sora', async (_url, init) => {
      requestInit = init;
      return new Response(JSON.stringify({ results: [{ title: 'Sora 动态', url: 'https://example.test/sora', content: 'Tavily 摘要。' }] }), { status: 200 });
    });
    const headers = new Headers(requestInit?.headers);
    expect(headers.get('x-tavily-access-mode')).toBe('keyless');
    expect(headers.get('x-client-source')).toBe('tavily-js-keyless');
    expect(items[0]).toMatchObject({ backend: 'tavily', title: 'Sora 动态', content: 'Tavily 摘要。' });
  });

  it('falls back from SearXNG to Tavily and then legacy without hydrating target pages', async () => {
    const calls: string[] = [];
    const legacy: AiSourceSection[] = [{ source: 'web', backend: 'legacy', provider: 'bing', title: '兼容结果', url: 'https://example.test/legacy', content: '兼容摘要' }];
    const result = await searchConfiguredBackends(config, 'fallback', ['bing'], async (url) => {
      calls.push(String(url));
      if (String(url).includes('127.0.0.1:8080')) return new Response(JSON.stringify({ results: [] }), { status: 200 });
      return new Response(JSON.stringify({ results: [{ title: 'Tavily 结果', url: 'https://example.test/tavily', content: 'Tavily 摘要' }] }), { status: 200 });
    }, async () => legacy);
    expect(calls).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ backend: 'tavily', title: 'Tavily 结果' });
    expect(result.statuses.map((status) => status.backend)).toEqual(['searxng', 'tavily']);
  });

  it('uses legacy only when both managed backends are unavailable', async () => {
    const result = await searchConfiguredBackends(config, 'legacy', ['bing'], async () => new Response('bad', { status: 500 }), async () => [{ source: 'web', backend: 'legacy', title: '旧源', content: '旧源摘要' }]);
    expect(result.items[0]).toMatchObject({ backend: 'legacy', title: '旧源' });
    expect(result.statuses.map((status) => status.state)).toEqual(['failed', 'failed', 'ready']);
  });
});
