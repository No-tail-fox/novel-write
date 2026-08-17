import { describe, expect, it } from 'vitest';
import {
  buildBookDiscoveryFallback,
  parseDangdangSearchHtml,
  scoreBookOpportunity,
} from '../src/shared/book-discovery';

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
