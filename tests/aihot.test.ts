import { describe, expect, it } from 'vitest';
import { createAiHotQueryClient } from '../src/shared/aihot';

const FIXED_NOW = '2026-08-09T12:00:00.000Z';

describe('AIHOT query adapter', () => {
  it('queries selected items with fixed server-side scope and preserves API order', async () => {
    const requests: string[] = [];
    const client = createAiHotQueryClient(async (url) => {
      requests.push(url);
      return jsonResponse(itemsResponse([
        item({ id: 'first', title: '第一条', score: 61 }),
        item({ id: 'second', title: '第二条', score: 99 }),
      ]));
    }, fixedClock);

    const result = await client({ mode: 'selected', window: '24h' });

    expect(requests).toHaveLength(1);
    const requested = new URL(requests[0]);
    expect(requested.origin).toBe('https://aihot.virxact.com');
    expect(requested.pathname).toBe('/api/v1/items');
    expect(Object.fromEntries(requested.searchParams)).toMatchObject({
      mode: 'selected',
      window: '24h',
      by: 'timeline',
      limit: '50',
    });
    expect(result).toMatchObject({ kind: 'items', mode: 'selected', queryLabel: '过去 24 小时精选', count: 2 });
    if (result.kind !== 'items') return;
    expect(result.items.map((entry) => entry.title)).toEqual(['第一条', '第二条']);
    expect(result.items.map((entry) => entry.score)).toEqual([61, 99]);
  });

  it('falls back from the selected pool to all items only for a keyword search', async () => {
    const requestedModes: string[] = [];
    const client = createAiHotQueryClient(async (url) => {
      const mode = new URL(url).searchParams.get('mode') ?? '';
      requestedModes.push(mode);
      return jsonResponse(mode === 'selected'
        ? itemsResponse([])
        : itemsResponse([item({ id: 'all-only', title: '冷门产品更新', selected: false })]));
    }, fixedClock);

    const result = await client({ mode: 'search', query: '冷门产品', window: '7d' });

    expect(requestedModes).toEqual(['selected', 'all']);
    expect(result).toMatchObject({ kind: 'items', mode: 'search', count: 1, fallbackToAll: true });
    expect(result.warnings).toEqual([expect.stringContaining('全部公开动态')]);
    if (result.kind !== 'items') return;
    expect(result.items[0]).toMatchObject({ selected: false, title: '冷门产品更新' });
  });

  it('uses the AIHOT timeline rule when narrowing a two-to-six day request', async () => {
    const client = createAiHotQueryClient(async () => jsonResponse(itemsResponse([
      item({
        id: 'slow-source',
        title: '慢推信源今天收录',
        publishedAt: '2026-08-07T10:00:00.000Z',
        discoveredAt: '2026-08-09T11:00:00.000Z',
      }),
      item({
        id: 'historical-backfill',
        title: '历史回填不冒充最近',
        publishedAt: '2026-08-04T09:00:00.000Z',
        discoveredAt: '2026-08-09T11:00:00.000Z',
      }),
    ])), fixedClock);

    const result = await client({ mode: 'recent', days: 3 });

    expect(result).toMatchObject({ kind: 'items', queryLabel: '最近 3 天精选', count: 1 });
    if (result.kind !== 'items') return;
    expect(result.items.map((entry) => entry.id)).toEqual(['slow-source']);
  });

  it('falls back through the bounded daily index instead of guessing a date', async () => {
    const requests: string[] = [];
    const client = createAiHotQueryClient(async (url) => {
      const target = new URL(url);
      requests.push(`${target.pathname}${target.search}`);
      if (target.pathname.endsWith('/2026-05-06')) return new Response(null, { status: 404 });
      if (target.pathname === '/api/v1/dailies') {
        return jsonResponse({ schemaVersion: 1, count: 2, items: [{ date: '2026-05-05' }, { date: '2026-05-04' }] });
      }
      return jsonResponse(dailyResponse('2026-05-05'));
    }, fixedClock);

    const result = await client({ mode: 'daily', date: '2026-05-06' });

    expect(requests).toEqual([
      '/api/v1/dailies/2026-05-06',
      '/api/v1/dailies?limit=7',
      '/api/v1/dailies/2026-05-05',
    ]);
    expect(result).toMatchObject({ kind: 'daily', requestedDate: '2026-05-06', fallbackDate: '2026-05-05' });
    expect(result.warnings[0]).toContain('2026-05-05');
    if (result.kind !== 'daily') return;
    expect(result.report?.sections[0].items[0]).toMatchObject({ title: '模型发布', sourceName: '官方博客' });
  });

  it('reuses cached data when the same endpoint returns 304', async () => {
    let calls = 0;
    const seenHeaders: Headers[] = [];
    const client = createAiHotQueryClient(async (_url, init) => {
      calls += 1;
      seenHeaders.push(new Headers(init?.headers));
      if (calls === 2) return new Response(null, { status: 304 });
      return jsonResponse(itemsResponse([item({ id: 'cached', title: '缓存条目' })]), { ETag: 'W/"aihot-v1"' });
    }, fixedClock);

    const first = await client({ mode: 'selected', window: '24h' });
    const second = await client({ mode: 'selected', window: '24h' });

    expect(first.unchanged).toBe(false);
    expect(second).toMatchObject({ kind: 'items', unchanged: true, count: 1 });
    expect(seenHeaders[0].get('if-none-match')).toBeNull();
    expect(seenHeaders[1].get('if-none-match')).toBe('W/"aihot-v1"');
  });

  it('rejects invalid direct-call ranges before making a network request', async () => {
    let called = false;
    const client = createAiHotQueryClient(async () => {
      called = true;
      return jsonResponse(itemsResponse([]));
    }, fixedClock);

    await expect(client({ mode: 'recent', days: 8 })).rejects.toThrow(/1 到 7/u);
    await expect(client({ mode: 'search', query: 'A', window: '24h' })).rejects.toThrow(/搜索参数/u);
    expect(called).toBe(false);
  });
});

function fixedClock(): Date {
  return new Date(FIXED_NOW);
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function itemsResponse(items: unknown[]) {
  return {
    schemaVersion: 1,
    query: { mode: 'selected', category: null, q: null, window: '24h', by: 'timeline', ordering: 'timelineDesc' },
    items,
    page: { count: items.length, hasMore: false, nextCursor: null },
  };
}

function item(overrides: Record<string, unknown> = {}) {
  const id = typeof overrides.id === 'string' ? overrides.id : 'item-1';
  return {
    id,
    title: 'AI 动态',
    originalTitle: null,
    summary: '摘要',
    source: { name: '官方来源' },
    links: {
      aihot: `https://aihot.virxact.com/items/${id}`,
      original: `https://example.com/${id}`,
    },
    publishedAt: '2026-08-09T08:00:00.000Z',
    discoveredAt: '2026-08-09T09:00:00.000Z',
    category: 'ai-models',
    score: 72,
    selected: true,
    ...overrides,
  };
}

function dailyResponse(date: string) {
  return {
    schemaVersion: 1,
    report: {
      date,
      generatedAt: `${date}T01:00:00.000Z`,
      windowStart: '2026-05-04T00:00:00.000Z',
      windowEnd: '2026-05-05T00:00:00.000Z',
      links: { aihot: `https://aihot.virxact.com/daily/${date}` },
      lead: { title: '今日重点', leadParagraph: '重点摘要。' },
      sections: [{
        label: '模型发布',
        items: [{
          title: '模型发布',
          summary: '模型摘要',
          source: { name: '官方博客' },
          links: { aihot: 'https://aihot.virxact.com/items/model', original: 'https://example.com/model' },
        }],
      }],
      flashes: [],
    },
  };
}
