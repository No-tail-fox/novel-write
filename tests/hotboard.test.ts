import { describe, expect, it } from 'vitest';
import { fetchHotBoardSnapshot } from '../src/shared/hotboard';

describe('hot board aggregation', () => {
  it('keeps successful platforms when another platform fails', async () => {
    const requested: string[] = [];
    const snapshot = await fetchHotBoardSnapshot(async (url) => {
      requested.push(url);
      if (url.includes('type=baidu')) return new Response('unavailable', { status: 503 });
      if (url.endsWith('/feed.xml')) {
        return new Response(`<?xml version="1.0"?><rss><channel><pubDate>Sun, 09 Aug 2026 07:01:03 -0400</pubDate><item><title><![CDATA[OpenAI &amp; Example launch a model]]></title><link>https://example.com/model</link><description><![CDATA[<p>Launch details</p>]]></description><pubDate>Sun, 09 Aug 2026 06:55:00 -0400</pubDate></item></channel></rss>`, {
          status: 200,
          headers: { 'content-type': 'application/rss+xml' },
        });
      }
      const type = new URL(url).searchParams.get('type') ?? 'unknown';
      return Response.json({
        type,
        update_time: '2026-08-09T13:00:00.000Z',
        list: [
          { index: 1, title: `${type} 热点`, url: `https://example.com/${type}/1`, hot_value: '123456', extra: { desc: `${type} 摘要` } },
          { index: 2, title: '', url: 'javascript:alert(1)', hot_value: '1', extra: {} },
        ],
      });
    });

    expect(requested).toHaveLength(9);
    expect(snapshot.items).toHaveLength(8);
    expect(snapshot.items[0]).toMatchObject({ rank: 1, platform: 'weibo', title: 'weibo 热点', hotValue: '123456' });
    expect(snapshot.items.at(-1)).toMatchObject({ platform: 'techmeme', title: 'OpenAI & Example launch a model' });
    expect(snapshot.platformStatuses).toHaveLength(9);
    expect(snapshot.platformStatuses.find((status) => status.platform === 'baidu')).toMatchObject({ state: 'failed', count: 0 });
    expect(snapshot.platformStatuses.find((status) => status.platform === 'techmeme')).toMatchObject({ state: 'ready', count: 1 });
    expect(snapshot.warnings).toEqual([expect.stringContaining('百度刷新失败')]);
    expect(snapshot.sourceAssessments).toHaveLength(10);
    expect(snapshot.sourceAssessments.filter((source) => source.suitability === 'connected').map((source) => source.id)).toEqual(['uapi', 'techmeme']);
  });

  it('returns a complete failed snapshot instead of rejecting the page refresh', async () => {
    const snapshot = await fetchHotBoardSnapshot(async () => {
      throw new Error('offline');
    });

    expect(snapshot.items).toEqual([]);
    expect(snapshot.platformStatuses.every((status) => status.state === 'failed')).toBe(true);
    expect(snapshot.warnings).toHaveLength(9);
    expect(snapshot.sourceAssessments.map((source) => source.label)).toEqual([
      '全网热榜（UAPI）',
      'Techmeme',
      'AnyKnew',
      '今日热榜',
      'NewsNow',
      '全站热榜',
      '即时热点',
      'SoPilot',
      'TL1',
      '糖果梦热榜',
    ]);
  });
});
