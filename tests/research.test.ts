import { describe, expect, it } from 'vitest';
import {
  buildStoryboundAiCreationSystemPrompt,
  buildStoryboundAiCreationUserPrompt,
  cleanStoryboundAiCreationOutput,
  composeCopyFromSources,
  createAiSourceResearcher,
  searchWebSources,
} from '@shared/research';
import { defaultConfig } from '@shared/config';
import type { ConfiguredTextLlm, LlmTextRequest, TextLlm } from '@shared/llm-provider';
import type { Task } from '@shared/types';

describe('AI source research', () => {
  it('builds the Storybound-style AI creation prompt for selected materials', () => {
    const system = buildStoryboundAiCreationSystemPrompt({
      trackName: '人物故事',
      trackTag: '纪实人物',
      useAiKnowledge: false,
      hasReferenceMaterials: true,
    });
    const user = buildStoryboundAiCreationUserPrompt(
      { keyword: '钱学森回国', extraRequirements: '500字左右，情绪递进' },
      [{ source: 'web', title: '资料 A', content: '1955年，钱学森终于回到中国。' }],
    );

    expect(system).toContain('你是一名资深短视频文案创作者');
    expect(system).toContain('【当前赛道】人物故事（纪实人物）');
    expect(system).toContain('必须是**原创口播文案**');
    expect(system).toContain('严格基于用户提供的参考素材进行创作');
    expect(system).toContain('不要标题、不要章节符号、不要 markdown');
    expect(user).toContain('【关键词】钱学森回国');
    expect(user).toContain('【用户额外要求】');
    expect(user).toContain('--- 素材 1：资料 A ---');
    expect(user).toContain('请基于以上素材，围绕关键词，创作一篇原创短视频口播文案');
  });

  it('builds a no-reference Storybound prompt that forbids uncertain details', () => {
    const system = buildStoryboundAiCreationSystemPrompt({
      trackName: '通用故事',
      trackTag: '通用写实',
      useAiKnowledge: true,
      hasReferenceMaterials: false,
    });
    const user = buildStoryboundAiCreationUserPrompt({ keyword: '张桂梅', extraRequirements: '' }, []);

    expect(system).toContain('请基于你对该人物/主题的已知知识进行创作');
    expect(system).toContain('本次无外部参考素材，请只输出确定的事实');
    expect(user).toContain('请基于你对「张桂梅」的了解');
    expect(user).not.toContain('【参考素材】');
  });

  it('cleans Storybound AI creation boilerplate from direct text output', () => {
    expect(cleanStoryboundAiCreationOutput('```markdown\n好的，以下是为你创作的文案：\n她第一次站上讲台时，并不知道自己会把一生都留在山里。\n```')).toBe(
      '她第一次站上讲台时，并不知道自己会把一生都留在山里。',
    );
  });

  it('uses the Storybound Bing HTML endpoint and extracts readable article paragraphs', async () => {
    const requests: string[] = [];

    const sections = await searchWebSources('钱学森 生平', async (url) => {
      const rawUrl = String(url);
      requests.push(rawUrl);
      if (rawUrl === 'https://cn.bing.com/search?q=%E9%92%B1%E5%AD%A6%E6%A3%AE') {
        return new Response(
          `<html><body><ol>
            <li class="b_algo"><h2><a href="https://example.test/qian">钱学森回国始末</a></h2><p>一篇可用资料。</p></li>
          </ol></body></html>`,
          { status: 200, headers: { 'Content-Type': 'text/html' } },
        );
      }
      if (rawUrl.includes('sogou.com/web')) {
        return new Response('<html><body></body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
      }
      if (rawUrl === 'https://example.test/qian') {
        return new Response(
          `<html><body><article>
            <p>版权声明：这段应该被过滤。</p>
            <p>1955年，钱学森冲破重重阻力回到中国，此后长期参与中国航天事业建设。</p>
            <p>这段补充了他从研究者到国家工程组织者的角色变化。</p>
          </article></body></html>`,
          { status: 200, headers: { 'Content-Type': 'text/html' } },
        );
      }
      throw new Error(`unexpected request: ${rawUrl}`);
    });

    expect(requests[0]).toBe('https://cn.bing.com/search?q=%E9%92%B1%E5%AD%A6%E6%A3%AE');
    expect(requests.some((url) => url.includes('format=rss'))).toBe(false);
    expect(sections[0]).toMatchObject({
      source: 'web',
      title: '钱学森回国始末',
      url: 'https://example.test/qian',
    });
    expect(sections[0].content).toContain('1955年，钱学森冲破重重阻力回到中国');
    expect(sections[0].content).not.toContain('版权声明');
  });

  it('returns the first 10 Bing results with readable page text', async () => {
    const requests: string[] = [];
    const rssItems = Array.from({ length: 12 }, (_, index) => {
      const n = index + 1;
      return `<item><title>Result ${n}</title><link>https://example.test/${n}</link><description>Snippet ${n}</description></item>`;
    }).join('');

    const sections = await searchWebSources('history topic', async (url) => {
      requests.push(String(url));
      if (String(url).includes('bing.com/search')) {
        return new Response(`<?xml version="1.0"?><rss><channel>${rssItems}</channel></rss>`, {
          status: 200,
          headers: { 'Content-Type': 'application/rss+xml' },
        });
      }
      const pageNumber = String(url).split('/').pop();
      return new Response(`<main><p>Readable page body ${pageNumber}.</p></main>`, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });

    expect(sections).toHaveLength(10);
    expect(sections.map((section) => section.title)).toEqual(['Result 1', 'Result 2', 'Result 3', 'Result 4', 'Result 5', 'Result 6', 'Result 7', 'Result 8', 'Result 9', 'Result 10']);
    expect(sections[9]).toMatchObject({ title: 'Result 10', url: 'https://example.test/10', snippet: 'Snippet 10' });
    expect(sections[9].content).toContain('Readable page body 10');
    expect(requests.filter((url) => url.startsWith('https://example.test/'))).toHaveLength(10);
    expect(requests).not.toContain('https://example.test/11');
  });

  it('falls back to the global Bing RSS endpoint when the CN endpoint is unavailable', async () => {
    const requests: string[] = [];

    const sections = await searchWebSources('fallback topic', async (url) => {
      requests.push(String(url));
      if (String(url).startsWith('https://cn.bing.com/')) {
        throw new TypeError('fetch failed');
      }
      if (String(url).startsWith('https://www.bing.com/')) {
        return new Response(
          '<?xml version="1.0"?><rss><channel><item><title>Fallback Result</title><link>https://example.test/fallback</link><description>Fallback snippet.</description></item></channel></rss>',
          { status: 200, headers: { 'Content-Type': 'application/rss+xml' } },
        );
      }
      return new Response('<main>Fallback page body.</main>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });

    expect(requests[0]).toContain('https://cn.bing.com/search');
    expect(requests.some((url) => url.includes('https://www.bing.com/search'))).toBe(true);
    expect(sections[0]).toMatchObject({ title: 'Fallback Result', content: 'Fallback page body.' });
  });

  it('uses Sogou when Bing drifts to low-relevance Chinese matches', async () => {
    const requests: string[] = [];

    const sections = await searchWebSources('七海千秋之死', async (url) => {
      requests.push(String(url));
      if (String(url).includes('bing.com/search')) {
        return new Response(
          `<?xml version="1.0"?><rss><channel>
            <item><title>七（汉语汉字）_百度百科</title><link>https://baike.baidu.com/item/%E4%B8%83/80825</link><description>由数词“七”引申出与此相关的一些义项。</description></item>
          </channel></rss>`,
          { status: 200, headers: { 'Content-Type': 'application/rss+xml' } },
        );
      }
      if (String(url).includes('sogou.com/web')) {
        return new Response(
          `<html><body>
            <div class="vrwrap">
              <style>.real-tag { color: #205aef; }</style>
              <h3 class="vr-title"><a href="/link?url=redirected">如何评价《弹丸论破3 绝望篇》<em>七海千秋的死亡</em>?_知乎</a></h3>
              <p><em>七海千秋</em>的<em>死亡</em>从一开始就是注定的。</p>
              <div data-url="https://www.zhihu.com/question/50680152/answer/122152115"></div>
            </div><!-- z -->
          </body></html>`,
          { status: 200, headers: { 'Content-Type': 'text/html' } },
        );
      }
      if (String(url).startsWith('https://www.zhihu.com/')) {
        return new Response('<main>七海千秋的死亡是绝望篇中的关键剧情。</main>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        });
      }
      return new Response('', { status: 404 });
    });

    expect(requests.some((url) => url.includes('sogou.com/web'))).toBe(true);
    expect(requests.some((url) => url.includes('baidu.com/s'))).toBe(false);
    expect(requests.some((url) => url.includes('so.com/s'))).toBe(false);
    expect(sections.map((section) => section.title)).toEqual(['如何评价《弹丸论破3 绝望篇》七海千秋的死亡?_知乎']);
    expect(sections[0]).toMatchObject({
      url: 'https://www.zhihu.com/question/50680152/answer/122152115',
      content: '七海千秋的死亡是绝望篇中的关键剧情。',
    });
    expect(sections[0].snippet).not.toContain('real-tag');
  });

  it('limits AI search fallback to Bing and Sogou while filtering video results', async () => {
    const requests: string[] = [];
    const query = '七海千秋之死';

    const sections = await searchWebSources(query, async (url) => {
      const rawUrl = String(url);
      requests.push(rawUrl);
      if (rawUrl.includes('bing.com/search')) {
        return new Response(
          `<?xml version="1.0"?><rss><channel>
            <item><title>七（汉语汉字）_百度百科</title><link>https://baike.baidu.com/item/%E4%B8%83/80825</link><description>数字七的解释。</description></item>
          </channel></rss>`,
          { status: 200, headers: { 'Content-Type': 'application/rss+xml' } },
        );
      }
      if (rawUrl.includes('sogou.com/web')) {
        return new Response(
          `<html><body>
            <div class="vrwrap">
              <h3><a href="https://www.douyin.com/video/123">七海千秋死亡片段 - 抖音</a></h3>
              <p>高清视频免费在线播放。</p>
            </div><!-- z -->
            <div class="vrwrap">
              <h3><a href="https://www.zhihu.com/question/50680152/answer/122152115">如何评价七海千秋之死？_知乎</a></h3>
              <p>七海千秋之死是绝望篇的重要剧情。</p>
            </div><!-- z -->
          </body></html>`,
          { status: 200, headers: { 'Content-Type': 'text/html' } },
        );
      }
      if (rawUrl.startsWith('https://www.zhihu.com/')) {
        return new Response('<main>七海千秋之死是绝望篇里的关键牺牲。</main>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        });
      }
      throw new Error(`unexpected search request: ${rawUrl}`);
    });

    expect(requests.some((url) => url.includes('sogou.com/web'))).toBe(true);
    expect(requests.some((url) => url.includes('baidu.com/s'))).toBe(false);
    expect(requests.some((url) => url.includes('so.com/s'))).toBe(false);
    expect(sections.map((section) => section.url)).toEqual(['https://www.zhihu.com/question/50680152/answer/122152115']);
  });

  it('keeps supplemental Chinese article sources without restoring video image or aggregate pages', async () => {
    const query = '\u4e03\u6d77\u5343\u79cb\u4e4b\u6b7b';
    const rssItems = [
      ['\u4e03\u6d77\u5343\u79cb_\u767e\u5ea6\u767e\u79d1', 'https://baike.baidu.com/item/%E4%B8%83%E6%B5%B7%E5%8D%83%E7%A7%8B/8788465', '\u7edd\u671b\u7bc7\u4e2d\u88ab\u5904\u5211\u3002'],
      ['\u4e03\u6d77\u5343\u79cb\u4e4b\u6b7b\u89e3\u6790 - \u767e\u5bb6\u53f7', 'https://baijiahao.baidu.com/s?id=1777777777777777777', '\u4ece\u5267\u60c5\u548c\u89d2\u8272\u5f27\u5149\u89e3\u6790\u4e03\u6d77\u5343\u79cb\u7684\u727a\u7272\u3002'],
      ['\u5982\u4f55\u8bc4\u4ef7\u4e03\u6d77\u5343\u79cb\u7684\u6b7b\u4ea1\uff1f_\u77e5\u4e4e', 'https://www.zhihu.com/question/50680152/answer/122152115', '\u4e03\u6d77\u5343\u79cb\u7684\u6b7b\u4ea1\u5bf9\u7edd\u671b\u7bc7\u7684\u60c5\u7eea\u63a8\u8fdb\u5f88\u91cd\u8981\u3002'],
      ['\u4e03\u6d77\u5343\u79cb\u4e3a\u4ec0\u4e48\u88ab\u5904\u5211 - \u4eca\u65e5\u5934\u6761', 'https://www.toutiao.com/article/7487785029423204403/', '\u6587\u7ae0\u68b3\u7406\u4e86\u4e03\u6d77\u5343\u79cb\u4e4b\u6b7b\u7684\u5267\u60c5\u4e0a\u4e0b\u6587\u3002'],
      ['15\u4f4d\u6b7b\u6cd5\u5f88\u60e8\u7684\u52a8\u6f2b\u89d2\u8272,\u54ea\u4e00\u4f4d\u6700\u8ba9\u4f60\u610f\u96be\u5e73', 'https://baijiahao.baidu.com/s?id=1764964839366065146', '\u4e03\u6d77\u5343\u79cb\u662f\u52a8\u6f2b\u89d2\u8272\u4e4b\u4e00\u3002'],
      ['\u4e03\u6d77\u5343\u79cb\u4e3a\u4ec0\u4e48\u5904\u5211\u4e86\u4e24\u6b21-\u4eca\u65e5\u5934\u6761', 'https://www.toutiao.com/topic/7487785029423204403/', '\u60a8\u5728\u67e5\u627e\u4e03\u6d77\u5343\u79cb\u5417\uff1f\u8fd9\u662f\u641c\u7d22\u7ed3\u679c\u805a\u5408\u3002'],
      ['\u4e03\u6d77\u5343\u79cb\u4e4b\u6b7b\u56fe\u7247', 'https://image.example.test/nanami', '\u56fe\u7247\u641c\u7d22\u7ed3\u679c\u3002'],
    ]
      .map(([title, link, description]) => `<item><title>${title}</title><link>${link}</link><description>${description}</description></item>`)
      .join('');

    const sections = await searchWebSources(query, async (url) => {
      if (String(url).includes('bing.com/search')) {
        return new Response(`<?xml version="1.0"?><rss><channel>${rssItems}</channel></rss>`, {
          status: 200,
          headers: { 'Content-Type': 'application/rss+xml' },
        });
      }
      if (String(url).includes('sogou.com/web') || String(url).includes('baidu.com/s') || String(url).includes('so.com/s')) {
        return new Response('<html><body></body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        });
      }
      return new Response(`<main>Reliable article body for ${String(url)}</main>`, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });

    const urls = sections.map((section) => section.url ?? '');
    expect(urls[0]).toBe('https://baike.baidu.com/item/%E4%B8%83%E6%B5%B7%E5%8D%83%E7%A7%8B/8788465');
    expect(urls).toEqual(expect.arrayContaining([
      'https://baijiahao.baidu.com/s?id=1777777777777777777',
      'https://www.zhihu.com/question/50680152/answer/122152115',
      'https://www.toutiao.com/article/7487785029423204403/',
    ]));
    expect(urls).not.toEqual(expect.arrayContaining([
      'https://baijiahao.baidu.com/s?id=1764964839366065146',
      'https://www.toutiao.com/topic/7487785029423204403/',
      'https://image.example.test/nanami',
    ]));
  });

  it('does not run source-hinted Baidu searches for Chinese fallback research', async () => {
    const requests: string[] = [];
    const query = '\u4e03\u6d77\u5343\u79cb\u4e4b\u6b7b';

    const sections = await searchWebSources(query, async (url) => {
      const rawUrl = String(url);
      const decodedUrl = decodeURIComponent(rawUrl);
      requests.push(decodedUrl);
      if (rawUrl.includes('bing.com/search')) {
        return new Response(
          `<?xml version="1.0"?><rss><channel>
            <item><title>\u4e03\u6d77\u5343\u79cb_\u767e\u5ea6\u767e\u79d1</title><link>https://baike.baidu.com/item/%E4%B8%83%E6%B5%B7%E5%8D%83%E7%A7%8B/8788465</link><description>\u7edd\u671b\u7bc7\u4e2d\u88ab\u5904\u5211\u3002</description></item>
          </channel></rss>`,
          { status: 200, headers: { 'Content-Type': 'application/rss+xml' } },
        );
      }
      if (rawUrl.includes('sogou.com/web') || rawUrl.includes('baidu.com/s') || rawUrl.includes('so.com/s')) {
        return new Response('<html><body></body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        });
      }
      return new Response(`<main>Readable body for ${rawUrl}</main>`, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });

    expect(requests.some((url) => url.includes('\u77e5\u4e4e'))).toBe(false);
    expect(requests.some((url) => url.includes('\u767e\u5bb6\u53f7'))).toBe(false);
    expect(requests.some((url) => url.includes('\u5934\u6761\u53f7'))).toBe(false);
    expect(requests.some((url) => url.includes('sogou.com/web'))).toBe(true);
    expect(requests.some((url) => url.includes('baidu.com/s'))).toBe(false);
    expect(requests.some((url) => url.includes('so.com/s'))).toBe(false);
    expect(sections.map((section) => section.url)).toEqual(['https://baike.baidu.com/item/%E4%B8%83%E6%B5%B7%E5%8D%83%E7%A7%8B/8788465']);
  });

  it('filters video image and low-quality Q&A pages from Chinese research results', async () => {
    const query = '\u4e03\u6d77\u5343\u79cb\u4e4b\u6b7b';
    const rssItems = [
      ['\u4e03\u6d77\u5343\u79cb\u6b7b\u4ea1\u7247\u6bb5\u65e0\u6c34\u5370 - \u6296\u97f3', 'https://www.douyin.com/search/nanami', '\u6d77\u91cf\u9ad8\u6e05\u89c6\u9891\u3001\u76f4\u64ad\u3001\u7528\u6237\uff0c\u6ee1\u8db3\u60a8\u7684\u5728\u7ebf\u89c2\u770b\u9700\u6c42\u3002'],
      ['\u4e03\u6d77\u5343\u79cb\u4e4b\u6b7b (\u7ea622\u4e2a\u76f8\u5173\u89c6\u9891) \u9ad8\u6e05\u5728\u7ebf\u89c2\u770b - 360\u89c6\u9891', 'https://www.so.com/link?m=video', '\u9ad8\u6e05\u89c6\u9891\u5728\u7ebf\u89c2\u770b\u3002'],
      ['\u4e03\u6d77\u5343\u79cb\u4e3a\u4ec0\u4e48\u6b7b?_360\u95ee\u7b54', 'https://wenda.so.com/q/1634886102217618', '\u6700\u4f73\u7b54\u6848\uff1a\u4e0d\u53ef\u9760\u7684\u95ee\u7b54\u6458\u8981\u3002'],
      ['\u4e03\u6d77\u5343\u79cb \u600e\u4e48\u6b7b\u7684 - \u767e\u5ea6\u77e5\u9053', 'https://zhidao.baidu.com/question/948391952307024332.html', '\u77e5\u9053\u95ee\u7b54\u9875\u9762\u6458\u8981\u3002'],
      ['15\u4f4d\u6b7b\u6cd5\u5f88\u60e8\u7684\u52a8\u6f2b\u89d2\u8272,\u54ea\u4e00\u4f4d\u6700\u8ba9\u4f60\u610f\u96be\u5e73', 'https://baijiahao.baidu.com/s?id=1764964839366065146', '\u4e03\u6d77\u5343\u79cb\u662f\u52a8\u6f2b\u300a\u5f39\u4e38\u8bba\u78343\uff1a\u7edd\u671b\u7bc7\u300b\u4e2d\u767b\u573a\u7684\u89d2\u8272\u3002'],
      ['\u8fd9\u4e9b\u52a8\u6f2b\u7684\u4e3b\u4eba\u516c\u6b7b\u6cd5,\u8ba9\u4eba\u5fcd\u4e0d\u4f4f\u6d41\u6cea,\u5979\u5c45\u7136\u88ab\u6d3b\u6d3b\u751f\u541e', 'https://baijiahao.baidu.com/s?id=1598779945765435989', '\u63d0\u5230\u4e03\u6d77\u5343\u79cb\u7684\u6b7b\u4ea1\u7247\u6bb5\u3002'],
      ['\u52a8\u6f2b\u91cc\u201c\u6b7b\u7684\u592a\u60e8\u201d\u7684\u840c\u59b9\u5b50,\u547d\u8fd0\u5b9e\u5728\u592a\u60b2\u60e8,\u60f3\u7ed9\u7f16\u5267\u5bc4\u5200\u7247', 'https://baijiahao.baidu.com/s?id=1614180942215473419', '\u5305\u542b\u4e03\u6d77\u5343\u79cb\u7684\u5267\u60c5\u63cf\u8ff0\u3002'],
      ['\u4e03\u6d77\u5343\u79cb\u4e3a\u4ec0\u4e48\u5904\u5211\u4e86\u4e24\u6b21-\u4eca\u65e5\u5934\u6761', 'https://www.toutiao.com/topic/7487785029423204403/', '\u60a8\u5728\u67e5\u627e\u4e03\u6d77\u5343\u79cb\u4e3a\u4ec0\u4e48\u5904\u5211\u4e86\u4e24\u6b21\u5417\uff1f\u4eca\u65e5\u5934\u6761\u63d0\u4f9b\u8be6\u5c3d\u7684\u641c\u7d22\u7ed3\u679c\u805a\u5408\u3002'],
      ['\u4e03\u6d77\u5343\u79cb \u53f0\u8bcd', 'https://www.yiyyy.com/article/post-1853444.html', '\u4e03\u6d77\u5343\u79cb\u786e\u5b9e\u6b7b\u4e86\uff0c\u6e38\u620f\u91cc\u662fai\u6280\u672f\u3002'],
      ['\u4e03\u6d77\u5343\u79cb_\u767e\u5ea6\u767e\u79d1', 'https://baike.baidu.com/item/%E4%B8%83%E6%B5%B7%E5%8D%83%E7%A7%8B/8788465', '\u52a8\u753b\u300a\u5f39\u4e38\u8bba\u78343\u300b\u7edd\u671b\u7bc7\u4e2d\u88ab\u6c5f\u4e4b\u5c9b\u76fe\u5b50\u5904\u5211\u3002'],
      ['\u4e03\u6d77\u5343\u79cb - \u840c\u5a18\u767e\u79d1 \u4e07\u7269\u7686\u53ef\u840c\u7684\u767e\u79d1\u5168\u4e66', 'https://mzh.moegirl.org.cn/%E4%B8%83%E6%B5%B7%E5%8D%83%E7%A7%8B', '\u89d2\u8272\u7ecf\u5386\u548c\u5267\u60c5\u8d44\u6599\u3002'],
      ['\u4e03\u6d77\u5343\u79cb - \u840c\u5a18\u767e\u79d1 \u4e07\u7269\u7686\u53ef\u840c\u7684\u767e\u79d1\u5168\u4e66', 'https://zh.moegirl.org.cn/%E4%B8%83%E6%B5%B7%E5%8D%83%E7%A7%8B', '\u540c\u4e00\u8bcd\u6761\u7684\u684c\u9762\u57df\u540d\u3002'],
      ['\u4e03\u6d77\u5343\u79cb (AI) - \u67aa\u5f39\u8fa9\u9a73|Danganronpa|\u5f39\u4e38\u8bba\u7834\u4e2d\u6587\u767e\u79d1/\u7ef4\u57fa', 'https://danganronpa.huijiwiki.com/wiki/%E4%B8%83%E6%B5%B7%E5%8D%83%E7%A7%8B(AI)', '\u5e0c\u671b\u4e4b\u5cf0\u5b66\u56ed\u7b2c77\u5c4a\u5b66\u751f\u8d44\u6599\u3002'],
    ]
      .map(([title, link, description]) => `<item><title>${title}</title><link>${link}</link><description>${description}</description></item>`)
      .join('');

    const sections = await searchWebSources(query, async (url) => {
      if (String(url).includes('bing.com/search')) {
        return new Response(`<?xml version="1.0"?><rss><channel>${rssItems}</channel></rss>`, {
          status: 200,
          headers: { 'Content-Type': 'application/rss+xml' },
        });
      }
      if (String(url).includes('sogou.com/web') || String(url).includes('baidu.com/s') || String(url).includes('so.com/s')) {
        return new Response('<html><body></body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        });
      }
      return new Response(`<main>Reliable body for ${String(url)}</main>`, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });

    const urls = sections.map((section) => section.url ?? '');
    expect(urls.some((url) => /douyin|wenda\.so|zhidao\.baidu|so\.com\/link/.test(url))).toBe(false);
    expect(sections.map((section) => section.title)).toEqual([
      '\u4e03\u6d77\u5343\u79cb_\u767e\u5ea6\u767e\u79d1',
      '\u4e03\u6d77\u5343\u79cb - \u840c\u5a18\u767e\u79d1 \u4e07\u7269\u7686\u53ef\u840c\u7684\u767e\u79d1\u5168\u4e66',
      '\u4e03\u6d77\u5343\u79cb (AI) - \u67aa\u5f39\u8fa9\u9a73|Danganronpa|\u5f39\u4e38\u8bba\u7834\u4e2d\u6587\u767e\u79d1/\u7ef4\u57fa',
    ]);
  });

  it('treats Chinese why-did-they-die questions as character death intent', async () => {
    const query = '\u4e03\u6d77\u5343\u79cb\u4e3a\u4ec0\u4e48\u6b7b';
    const rssItems = [
      ['\u4e03\uff08\u6c49\u8bed\u6c49\u5b57\uff09_\u767e\u5ea6\u767e\u79d1', 'https://baike.baidu.com/item/%E4%B8%83/80825', '\u6570\u5b57\u4e03\u7684\u89e3\u91ca\u3002'],
      ['\u4e03\u6d77\u5343\u79cb_\u767e\u5ea6\u767e\u79d1', 'https://baike.baidu.com/item/%E4%B8%83%E6%B5%B7%E5%8D%83%E7%A7%8B/8788465', '\u4e03\u6d77\u5343\u79cb\u5728\u7edd\u671b\u7bc7\u4e2d\u88ab\u5904\u5211\u3002'],
    ]
      .map(([title, link, description]) => `<item><title>${title}</title><link>${link}</link><description>${description}</description></item>`)
      .join('');

    const sections = await searchWebSources(query, async (url) => {
      if (String(url).includes('bing.com/search')) {
        return new Response(`<?xml version="1.0"?><rss><channel>${rssItems}</channel></rss>`, {
          status: 200,
          headers: { 'Content-Type': 'application/rss+xml' },
        });
      }
      if (String(url).includes('sogou.com/web') || String(url).includes('baidu.com/s') || String(url).includes('so.com/s')) {
        return new Response('<html><body></body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        });
      }
      return new Response('<main>\u4e03\u6d77\u5343\u79cb\u5728\u7edd\u671b\u7bc7\u4e2d\u88ab\u5904\u5211\u3002</main>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });

    expect(sections.map((section) => section.title)).toEqual(['\u4e03\u6d77\u5343\u79cb_\u767e\u5ea6\u767e\u79d1']);
  });

  it('composes an editable source copy from selected web pages through the Storybound text LLM flow', async () => {
    const requests: LlmTextRequest[] = [];
    const result = await composeCopyFromSources(
      mockConfiguredTextLlm(async (request) => {
        requests.push(request);
        return {
          text: '以下是为你创作的文案：\nGenerated source copy from selected research.',
          raw: '以下是为你创作的文案：\nGenerated source copy from selected research.',
          requestId: 'copy-1',
        };
      }),
      {
        keyword: 'Wu Zetian comeback',
        extraRequirements: 'Make it emotional and suitable for short video narration.',
        selectedSources: [
          { source: 'web', title: 'Article A', url: 'https://example.test/a', snippet: 'Snippet A', content: 'Article A facts.' },
          { source: 'web', title: 'Article B', url: 'https://example.test/b', content: 'Article B details.' },
        ],
        targetLength: 500,
      },
    );

    expect(result).toEqual({ title: 'Wu Zetian comeback', copy: 'Generated source copy from selected research.', raw: '以下是为你创作的文案：\nGenerated source copy from selected research.', requestId: 'copy-1' });
    expect(requests[0].name).toBe('research-copy');
    expect(requests[0]).toMatchObject({ temperature: 0.8, maxTokens: 32768, maxRetries: 2 });
    const systemPrompt = requests[0].messages[0].content;
    const userPrompt = requests[0].messages[1].content;
    expect(systemPrompt).toContain('资深短视频文案创作者');
    expect(systemPrompt).not.toContain('Return strict JSON only');
    expect(systemPrompt).toContain('【目标字数】500 字（区间 400-600 中文字符）。');
    expect(userPrompt).toContain('【关键词】Wu Zetian comeback');
    expect(userPrompt).toContain('Article A facts.');
    expect(userPrompt).toContain('Article B details.');
    expect(userPrompt).toContain('【目标字数】500 字（区间 400-600 中文字符）。');
    expect(userPrompt.indexOf('【目标字数】500 字（区间 400-600 中文字符）。')).toBeGreaterThan(userPrompt.indexOf('【关键词】Wu Zetian comeback'));
    expect(userPrompt.indexOf('【目标字数】500 字（区间 400-600 中文字符）。')).toBeLessThan(userPrompt.indexOf('【用户额外要求】'));
  });

  it('supports Storybound no-reference generation when no sources are selected', async () => {
    const requests: LlmTextRequest[] = [];
    const result = await composeCopyFromSources(
      mockConfiguredTextLlm(async (request) => {
        requests.push(request);
        return {
          text: 'Generated body.',
          raw: 'Generated body.',
          requestId: 'copy-title-1',
        };
      }),
      {
        keyword: 'Wu Zetian',
        extraRequirements: '',
        selectedSources: [],
      },
    );

    expect(result.title).toBe('Wu Zetian');
    expect(result.copy).toBe('Generated body.');
    expect(requests[0].messages[0].content).toContain('本次无外部参考素材');
    expect(requests[0].messages[1].content).toContain('请基于你对「Wu Zetian」的了解');
  });

  it('collects web RSS snippets and built-in knowledge for AI creation', async () => {
    const requests: string[] = [];
    const researcher = createAiSourceResearcher(defaultConfig, async (url) => {
      requests.push(String(url));
      return new Response(
        `<?xml version="1.0"?>
        <rss><channel>
          <item><title>Result A</title><link>https://example.test/a</link><description>First verified snippet.</description></item>
          <item><title>Result B</title><link>https://example.test/b</link><description>Second verified snippet.</description></item>
        </channel></rss>`,
        { status: 200, headers: { 'Content-Type': 'application/rss+xml' } },
      );
    });

    const context = await researcher(makeTask({ aiSources: ['web', 'builtin-knowledge'], aiKeyword: 'Wu Zetian comeback' }));

    expect(requests[0]).toContain('bing.com/search');
    expect(context.query).toBe('Wu Zetian comeback');
    expect(context.sections.map((section) => section.title)).toEqual(['Result A', 'Result B', '本地知识补全']);
    expect(context.sections[0]).toMatchObject({ source: 'web', url: 'https://example.test/a', content: 'First verified snippet.' });
    expect(context.warnings).toEqual([]);
  });

  it('keeps AI creation unblocked when web search fails', async () => {
    const researcher = createAiSourceResearcher(defaultConfig, async () => new Response('nope', { status: 503 }));

    const context = await researcher(makeTask({ aiSources: ['web'], aiKeyword: 'Wu Zetian comeback' }));

    expect(context.sections).toEqual([]);
    expect(context.warnings[0]).toContain('web search failed');
  });

  it('warns when web search returns no parseable results', async () => {
    const researcher = createAiSourceResearcher(defaultConfig, async () => new Response('<rss><channel /></rss>', { status: 200 }));

    const context = await researcher(makeTask({ aiSources: ['web'], aiKeyword: 'unknown query' }));

    expect(context.sections).toEqual([]);
    expect(context.warnings[0]).toContain('web search returned no usable results');
  });

  it('fetches linked web pages and uses page body text as source content', async () => {
    const fetched: string[] = [];
    const researcher = createAiSourceResearcher(defaultConfig, async (url) => {
      fetched.push(String(url));
      if (String(url).includes('bing.com/search')) {
        return new Response(
          `<?xml version="1.0"?>
          <rss><channel>
            <item><title>Article A</title><link>https://example.test/article-a</link><description>Short snippet only.</description></item>
          </channel></rss>`,
          { status: 200, headers: { 'Content-Type': 'application/rss+xml' } },
        );
      }
      return new Response(
        `<html><head><title>Article A</title></head><body><nav>menu</nav><article><p>Full article paragraph one about the comeback.</p><p>Full article paragraph two with useful details.</p></article><script>ignored()</script></body></html>`,
        { status: 200, headers: { 'Content-Type': 'text/html' } },
      );
    });

    const context = await researcher(makeTask({ aiSources: ['web'], aiKeyword: 'Wu Zetian comeback' }));

    expect(fetched).toEqual(expect.arrayContaining(['https://cn.bing.com/search?q=Wu%20Zetian%20comeback', 'https://example.test/article-a']));
    expect(context.sections[0]).toMatchObject({
      source: 'web',
      title: 'Article A',
      url: 'https://example.test/article-a',
      snippet: 'Short snippet only.',
    });
    expect(context.sections[0].content).toContain('Full article paragraph one');
    expect(context.sections[0].content).not.toContain('ignored()');
  });

  it('uses user-selected web sources without searching again during task execution', async () => {
    let called = false;
    const researcher = createAiSourceResearcher(defaultConfig, async () => {
      called = true;
      return new Response('');
    });

    const context = await researcher(
      makeTask({
        aiSources: ['web', 'builtin-knowledge'],
        selectedSources: [{ source: 'web', title: 'Chosen article', url: 'https://example.test/chosen', content: 'Selected body text for generation.' }],
      }),
    );

    expect(called).toBe(false);
    expect(context.sections[0]).toMatchObject({ title: 'Chosen article', content: 'Selected body text for generation.' });
    expect(context.sections.map((section) => section.source)).toEqual(['web', 'builtin-knowledge']);
  });
});

function makeTask(patch: Partial<Task>): Task {
  return {
    id: 'task-1',
    title: 'task',
    inputText: '',
    taskKind: 'story',
    processingMode: 'full-auto',
    publishMode: 'review-rewrite',
    status: 'pending',
    currentStep: 0,
    track: 'character-story',
    style: 'photo-real',
    speaker: 'voice',
    ratio: '9:16',
    templateId: 'default-portrait-9-16',
    bgmId: '__builtin__',
    pausePoints: [],
    outputDir: '',
    errorMessage: '',
    createdAt: new Date().toISOString(),
    completedAt: null,
    startedAt: null,
    lastHeartbeatAt: null,
    mode: 'ai',
    aiKeyword: 'Wu Zetian',
    aiSources: ['web'],
    selectedSources: [],
    extraRequirements: '',
    imagePromptReference: '',
    promptTemplateId: null,
    promptTemplateType: null,
    referenceImagePath: '',
    rewriteIntensity: 'standard',
    narrativePov: 'keep-original',
    keepPromotion: false,
    ttsProvider: 'mock',
    ttsSpeed: 1,
    storyboardSceneCount: 12,
    step3PromptSnapshot: '',
    musicMv: { rhythmMode: 'lyric-sync', captionStyle: 'karaoke', visualMotif: '', audioPath: '' },
    failedStep: null,
    retryFromStep: null,
    artifactStatePath: '',
    ...patch,
  };
}

function mockConfiguredTextLlm(run: TextLlm): ConfiguredTextLlm {
  return { protocol: 'anthropic', run };
}
