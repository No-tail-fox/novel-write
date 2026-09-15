import { describe, expect, it } from 'vitest';
import {
  buildBookDiscoveryFallback,
  parseDangdangSearchHtml,
  scoreBookOpportunity,
  discoverBooks,
  parseWereadBooks,
  parseDoubanBooks,
} from '../src/shared/book-discovery';
import { bookSourceKey } from '../src/shared/book-sources';
import { ipcInputSchemas } from '../src/shared/ipc-contract';

const searchFixture = `
<!doctype html>
<html><head><meta charset="GB2312"></head><body>
  <ul class="bigimg" id="component_59">
    <li ddt-pit="1" class="line1" id="p29285459">
      <a class="pic" title="黄帝内经养生智慧 曲黎敏 著 长江文艺出版社" href="//product.dangdang.com/29285459.html">
        <img src="//img3m9.ddimg.cn/12/7/29285459-1_b_1.jpg" alt="黄帝内经养生智慧" />
      </a>
      <p class="name"><a name="itemlist-title" href="//product.dangdang.com/29285459.html">黄帝内经<b>养生</b>智慧</a></p>
      <p class="price"><span class="search_now_price">&yen;39.80</span><span class="search_pre_price">&yen;59.80</span></p>
      <p class="search_star_line"><a name="itemlist-review">12345条评论</a></p>
      <p class="search_book_author">
        <span><a name="itemlist-author" title="曲黎敏 著">曲黎敏</a> 著</span>
        <span>/2024-06-01</span>
        <span>/<a name="P_cbs" title="长江文艺出版社">长江文艺出版社</a></span>
      </p>
    </li>
    <li ddt-pit="2" class="line2" id="p29600123">
      <a class="pic" title="吃对才健康 于康 著 科学出版社" href="//product.dangdang.com/29600123.html">
        <img data-original="//img3m3.ddimg.cn/1/2/29600123-1_b_2.jpg" src="images/model/guan/url_none.png" alt="吃对才健康" />
      </a>
      <p class="name"><a name="itemlist-title">吃对才健康</a></p>
      <p class="price"><span class="search_now_price">&yen;28.50</span></p>
      <p class="search_book_author"><span><a name="itemlist-author">于康</a> 著</span><span>/2023-09-01</span><span>/<a name="P_cbs">科学出版社</a></span></p>
    </li>
  </ul>
</body></html>`;

describe('Dangdang book discovery', () => {
  it('parses ranked public search fields and normalizes protocol-relative assets', () => {
    const items = parseDangdangSearchHtml(searchFixture, { query: '健康养生', track: '健康·中医食疗', limit: 20 });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      source: 'dangdang',
      sourceId: '29285459',
      sourceRank: 1,
      name: '黄帝内经养生智慧',
      author: '曲黎敏',
      publisher: '长江文艺出版社',
      publishDate: '2024-06-01',
      price: '39.80',
      originalPrice: '59.80',
      reviewCount: 12345,
      url: 'https://product.dangdang.com/29285459.html',
      coverUrl: 'https://img3m9.ddimg.cn/12/7/29285459-1_b_1.jpg',
      category: '健康·中医食疗',
    });
    expect(items[1].coverUrl).toBe('https://img3m3.ddimg.cn/1/2/29600123-1_b_2.jpg');
    expect(items[0].opportunityScore?.confidence).toBe('low');
    expect(items[0].opportunityScore?.confirmed).toBe(false);
  });

  it('keeps heuristic opportunity scores bounded and labels them as unconfirmed suggestions', () => {
    const score = scoreBookOpportunity({ rank: 1, reviewCount: 150000, price: '42.00', query: '抗衰养生', title: '养生智慧' });
    expect(score.total).toBeGreaterThanOrEqual(0);
    expect(score.total).toBeLessThanOrEqual(100);
    expect(score.confidence).toBe('low');
    expect(score.confirmed).toBe(false);
  });

  it('provides an explicitly marked preview fallback instead of fabricating live results', () => {
    const result = buildBookDiscoveryFallback({ query: '家庭教育', track: '育儿·亲子', limit: 12 }, '当当暂时无法访问');
    expect(result.sourceState).toBe('preview');
    expect(result.message).toContain('当当暂时无法访问');
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((item) => item.sourceState === 'preview')).toBe(true);
  });
});

const wereadFixture = { books: [{ bookInfo: {
  bookId: '26087423', title: '经营：打造你的盈利系统', author: '高可为', publisher: '中国青年出版社',
  deepLink: 'https://weread.qq.com/book-detail?type=1&v=9e832dd0718e0fff9e8f6f2',
  cover: 'https://cdn.weread.qq.com/weread/cover/42/YueWen_26087423/s_YueWen_26087423.jpg',
  intro: '在过去的几十年里，中国企业走过了西方企业上百年走过的路。', type: 0, price: 79.2, newRatingCount: 184,
} }] };
const doubanFixture = [{ title: '经营未来', url: 'https://book.douban.com/subject/3020605/',
  pic: 'https://img9.doubanio.com/view/subject/s/public/s2987474.jpg', author_name: '李明博', year: '2008', type: 'b', id: '3020605' }];
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 as const }];

describe('multi-source book discovery', () => {
  it('parses verified book catalog fields without treating ebook prices or rating counts as paper commerce data', () => {
    const [weread] = parseWereadBooks(wereadFixture, { query: '经营' });
    expect(weread).toMatchObject({ source: 'weread', sourceId: 'weread:26087423', name: '经营：打造你的盈利系统', author: '高可为', publisher: '中国青年出版社' });
    expect(weread.price).toBeUndefined();
    expect(weread.reviewCount).toBeUndefined();
    expect(weread.note).toContain('纸书版本与售价需另行确认');
    expect(parseDoubanBooks(doubanFixture, { query: '经营' })[0]).toMatchObject({ source: 'douban', sourceId: 'douban:3020605', name: '经营未来', publishDate: '2008' });
    expect(parseDoubanBooks([...doubanFixture, { ...doubanFixture[0], type: 'm' }, { ...doubanFixture[0], url: 'javascript:alert(1)' }], { query: '经营' })).toHaveLength(1);
  });

  it('queries all selected providers and gives each source space while preserving its internal ordering', async () => {
    const calls: URL[] = [];
    const result = await discoverBooks({ query: '经营', limit: 3 }, { lookup: publicLookup, now: () => 123,
      fetchImpl: async (input) => {
        const url = new URL(input); calls.push(url);
        if (url.hostname === 'search.dangdang.com') return new Response(searchFixture);
        if (url.hostname === 'weread.qq.com') return Response.json(wereadFixture);
        return Response.json(doubanFixture);
      },
    });
    expect(calls).toHaveLength(3);
    expect(calls.map((url) => url.searchParams.get('key') || url.searchParams.get('keyword') || url.searchParams.get('q'))).toEqual(['经营', '经营', '经营']);
    expect(result.items.map((item) => item.source)).toEqual(['dangdang', 'weread', 'douban']);
    expect(result.sourceState).toBe('live');
    expect(result.fetchedAt).toBe(123);
    expect(result.sources?.every((source) => source.status === 'ok')).toBe(true);
  });

  it('keeps real results on partial failure and never substitutes preview books for failed or empty live searches', async () => {
    const result = await discoverBooks({ query: '经营' }, { lookup: publicLookup,
      fetchImpl: async (url) => url.includes('weread.qq.com') ? Response.json(wereadFixture) : new Response('unavailable', { status: 403 }),
    });
    expect(result.sourceState).toBe('live');
    expect(result.items).toHaveLength(1);
    expect(result.sources?.filter((source) => source.status === 'failed')).toHaveLength(2);
    const failed = await discoverBooks({ query: '经营', sources: ['douban'] }, { lookup: publicLookup, fetchImpl: async () => new Response('blocked', { status: 403 }) });
    expect(failed).toMatchObject({ sourceState: 'failed', items: [] });
    const empty = await discoverBooks({ query: '不存在的书', sources: ['douban'] }, { lookup: publicLookup, fetchImpl: async () => Response.json([]) });
    expect(empty).toMatchObject({ sourceState: 'empty', items: [] });
    const invalid = await discoverBooks({ query: '经营', sources: ['weread'] }, { lookup: publicLookup, fetchImpl: async () => Response.json({ errcode: -2012 }) });
    expect(invalid).toMatchObject({ sourceState: 'failed', items: [] });
  });

  it('requests only the selected source, removes duplicate provider IDs, and separates saved identities across catalogs', async () => {
    const calls: string[] = [];
    const result = await discoverBooks({ query: '经营', sources: ['douban'] }, { lookup: publicLookup, fetchImpl: async (url) => {
      calls.push(url); return Response.json([...doubanFixture, ...doubanFixture]);
    } });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('book.douban.com');
    expect(result.items).toHaveLength(1);
    expect(bookSourceKey({ source: 'douban', sourceId: '123' })).not.toBe(bookSourceKey({ source: 'dangdang', sourceId: '123' }));
    expect(bookSourceKey({ source: 'dangdang', sourceId: '29285459' })).toBe(bookSourceKey(parseDangdangSearchHtml(searchFixture, { query: '健康' })[0]));
  });

  it('validates selected sources and allows saving new-source books with their provenance', () => {
    for (const data of [...parseWereadBooks(wereadFixture, { query: '经营' }), ...parseDoubanBooks(doubanFixture, { query: '经营' })]) {
      expect(ipcInputSchemas['book-selection:save'].safeParse({ theme: '经营', bookId: data.sourceId, data }).success).toBe(true);
    }
    expect(ipcInputSchemas['book-selection:discover'].safeParse({ query: '经营', sources: ['weread', 'douban'] }).success).toBe(true);
    for (const sources of [[], ['unknown'], ['douban', 'douban']]) {
      expect(ipcInputSchemas['book-selection:discover'].safeParse({ query: '经营', sources }).success).toBe(false);
    }
  });
});
