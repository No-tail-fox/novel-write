import { describe, expect, it } from 'vitest';
import { readPublicSourceContent } from '@shared/research';
import { createBrowserHotBoardPreviewArchive } from '../src/app/browser-fallback';

describe('hot board source content', () => {
  it('extracts readable page paragraphs for display and creation evidence', async () => {
    const result = await readPublicSourceContent({
      title: '热点标题',
      url: 'https://example.test/article/1',
      summary: '榜单摘要',
    }, async () => new Response(`
      <html><body><article>
        <h1>热点标题</h1>
        <p>这是页面正文的第一段，包含事件的起因、人物和发生时间，足够用于后续内容拆解。</p>
        <p>这是页面正文的第二段，补充事件转折、公开回应和可核验的结果信息。</p>
      </article></body></html>
    `, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }));

    expect(result.kind).toBe('page');
    expect(result.content).toContain('事件的起因');
    expect(result.content).toContain('公开回应');
    expect(result.content).toContain('\n\n');
    expect(result.excerpt.length).toBeGreaterThan(40);
  });

  it('reads structured article bodies without truncating them to the search snippet limit', async () => {
    const longBody = `第一段说明事件背景与公开事实。\n\n${'后续段落补充可核验信息。'.repeat(360)}`;
    const result = await readPublicSourceContent({
      title: '结构化新闻正文',
      url: 'https://example.test/article/structured',
    }, async () => new Response(`
      <html><head><script type="application/ld+json">${JSON.stringify({
        '@type': 'NewsArticle',
        headline: '结构化新闻正文',
        articleBody: longBody,
      })}</script></head><body><div id="app"></div></body></html>
    `, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }));

    expect(result.kind).toBe('page');
    expect(result.content.length).toBeGreaterThan(3_000);
    expect(result.content).toContain('第一段说明事件背景');
    expect(result.content).toContain('\n\n');
  });

  it('extracts Xiaohongshu note text and ordered imageList media from public hydration state', async () => {
    const initialState = {
      note: {
        noteDetailMap: {
          abc123: {
            note: {
              title: '周末做了一个小书房',
              desc: '把原来的储物间改成了小书房，记录了收纳、灯光和&quot;原木色&quot;桌面布置的完整过程。',
              imageList: [
                { urlDefault: 'https://sns-webpic-qc.xhscdn.com/note/01.webp', width: 1080, height: 1440 },
                { urlDefault: 'https://sns-webpic-qc.xhscdn.com/note/02.webp', width: 1080, height: 1440 },
                { urlDefault: 'https://sns-webpic-qc.xhscdn.com/note/01.webp', width: 1080, height: 1440 },
                { urlDefault: 'https://sns-avatar-qc.xhscdn.com/avatar/owner.webp', width: 96, height: 96 },
              ],
            },
          },
        },
      },
    };
    const result = await readPublicSourceContent({
      title: '周末做了一个小书房',
      url: 'https://www.xiaohongshu.com/explore/abc123',
    }, async () => new Response(`<html><body><div id="app"></div><script>window.__INITIAL_STATE__=${JSON.stringify(initialState)}</script></body></html>`, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }));

    expect(result.kind).toBe('page');
    expect(result.content).toContain('改成了小书房');
    expect(result.content).toContain('"原木色"');
    expect(result.media).toEqual([
      { type: 'image', url: 'https://sns-webpic-qc.xhscdn.com/note/01.webp', width: 1080, height: 1440 },
      { type: 'image', url: 'https://sns-webpic-qc.xhscdn.com/note/02.webp', width: 1080, height: 1440 },
    ]);
  });

  it('collects JSON-LD, Open Graph, and semantic article images without tracking assets', async () => {
    const result = await readPublicSourceContent({
      title: '图文新闻',
      url: 'https://news.example.test/posts/1',
    }, async () => new Response(`
      <html><head>
        <meta property="og:image" content="/images/lead.jpg">
        <script type="application/ld+json">${JSON.stringify({
          '@type': 'NewsArticle',
          articleBody: '这是一篇带现场图片的完整新闻正文，包含事件背景、过程、公开回应和后续影响，足够用于阅读。',
          image: [{ contentUrl: 'https://cdn.example.test/images/lead.jpg', width: 1200, height: 800 }, { url: 'javascript:alert(1)' }],
        })}</script>
      </head><body><article>
        <p>这是一篇带现场图片的完整新闻正文，包含事件背景、过程、公开回应和后续影响，足够用于阅读。</p>
        <img data-src="/images/detail.jpg" width="960" height="640" alt="现场图片">
        <img src="/pixel.gif" width="1" height="1">
      </article></body></html>
    `, { status: 200, headers: { 'content-type': 'text/html' } }));

    expect(result.kind).toBe('page');
    expect(result.media?.map((item) => item.url)).toEqual([
      'https://cdn.example.test/images/lead.jpg',
      'https://news.example.test/images/lead.jpg',
      'https://news.example.test/images/detail.jpg',
    ]);
    expect(result.media?.some((item) => item.url.includes('pixel'))).toBe(false);
  });

  it('decodes RENDER_DATA application state for picture posts', async () => {
    const renderData = encodeURIComponent(JSON.stringify({
      aweme: {
        detail: {
          desc: '图集记录了展览现场、展品细节和策展人的公开说明。',
          images: [
            { urlList: ['https://p3-sign.douyinpic.com/tos-cn-i/image-a.webp'], width: 1440, height: 1920 },
            { downloadUrlList: ['https://p3-sign.douyinpic.com/tos-cn-i/image-b.webp'], width: 1440, height: 1920 },
          ],
        },
      },
    }));
    const result = await readPublicSourceContent({
      title: '展览现场图集',
      url: 'https://www.douyin.com/note/123',
    }, async () => new Response(`<html><body><script id="RENDER_DATA" type="application/json">${renderData}</script></body></html>`, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }));

    expect(result.kind).toBe('page');
    expect(result.content).toContain('策展人的公开说明');
    expect(result.media).toHaveLength(2);
  });

  it('reads Weibo render data text and nested pic_infos images', async () => {
    const renderData = [{
      status: {
        text_raw: '现场发布的信息说明了事件背景、时间线、参与方回应和已经确认的后续安排。',
        pic_infos: {
          first: { large: { url: 'https://wx1.sinaimg.cn/large/first.jpg', width: 1280, height: 720 } },
          second: { original: { url: 'https://wx2.sinaimg.cn/large/second.jpg', width: 1280, height: 720 } },
        },
      },
    }];
    const result = await readPublicSourceContent({
      title: '微博现场发布',
      url: 'https://m.weibo.cn/status/123',
    }, async () => new Response(`<html><body><script>var $render_data = ${JSON.stringify(renderData)};</script></body></html>`, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }));

    expect(result.kind).toBe('page');
    expect(result.content).toContain('参与方回应');
    expect(result.media?.map((item) => item.url)).toEqual([
      'https://wx1.sinaimg.cn/large/first.jpg',
      'https://wx2.sinaimg.cn/large/second.jpg',
    ]);
  });

  it('reads Bilibili description and cover from initial state', async () => {
    const state = {
      videoData: {
        desc: '视频简介完整说明了选题背景、采访对象、主要结论以及资料来源。',
        pic: '//i0.hdslb.com/bfs/archive/cover.jpg',
      },
    };
    const result = await readPublicSourceContent({
      title: '结构化平台正文',
      url: 'https://www.bilibili.com/video/BV123',
    }, async () => new Response(`<html><body><script>window.__INITIAL_STATE__=${JSON.stringify(state)}</script></body></html>`, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }));

    expect(result.kind).toBe('page');
    expect(result.content).toContain('视频简介完整说明');
    expect(result.media?.map((item) => item.url)).toEqual(['https://i0.hdslb.com/bfs/archive/cover.jpg']);
  });

  it('collects images embedded inside Zhihu-style SSR HTML content', async () => {
    const nextData = {
      props: {
        pageProps: {
          answer: {
            content: '<p>回答正文补充了推理过程、事实依据和适用边界。</p><figure><img src="https://picx.zhimg.com/article/detail.jpg" width="1200" height="800"></figure>',
          },
        },
      },
    };
    const result = await readPublicSourceContent({
      title: '知乎结构化回答',
      url: 'https://www.zhihu.com/question/1/answer/2',
    }, async () => new Response(`<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></body></html>`, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }));

    expect(result.kind).toBe('page');
    expect(result.content).toContain('回答正文补充了推理过程');
    expect(result.media?.map((item) => item.url)).toEqual(['https://picx.zhimg.com/article/detail.jpg']);
  });

  it('keeps a media-only public page readable while using the archived summary as its text', async () => {
    const result = await readPublicSourceContent({
      title: '只有图片的公开帖子',
      url: 'https://example.test/picture-note',
      summary: '来源摘要说明了这组图片的背景。',
    }, async () => new Response(`
      <html><head><meta property="og:image" content="https://cdn.example.test/picture-note.webp"></head><body></body></html>
    `, { status: 200, headers: { 'content-type': 'text/html' } }));

    expect(result).toMatchObject({ kind: 'page', content: '来源摘要说明了这组图片的背景。' });
    expect(result.media).toHaveLength(1);
    expect(result.warning).toContain('页面图片');
  });

  it('uses full-page paragraphs when a generic content shell is not the article body', async () => {
    const result = await readPublicSourceContent({
      title: '复杂页面正文',
      url: 'https://example.test/article/complex',
    }, async () => new Response(`
      <html><body>
        <div class="content"><p>这里是页面工具栏，不是正文。</p></div>
        <section class="story-detail">
          <p>真正正文第一段包含事件起因、关键人物、发生时间以及已经公开确认的事实。</p>
          <p>真正正文第二段继续说明事件进展、各方回应、影响范围以及后续值得关注的节点。</p>
        </section>
      </body></html>
    `, { status: 200, headers: { 'content-type': 'text/html' } }));

    expect(result.kind).toBe('page');
    expect(result.content).toContain('真正正文第一段');
    expect(result.content).toContain('真正正文第二段');
    expect(result.content).not.toContain('页面工具栏');
  });

  it('keeps summary fallback explicit when the public page cannot be read', async () => {
    const result = await readPublicSourceContent({
      title: '热点标题',
      url: 'https://example.test/blocked',
      summary: '这是来源已经公开的摘要内容。',
    }, async () => new Response('blocked', { status: 403, headers: { 'content-type': 'text/html' } }));

    expect(result).toMatchObject({ kind: 'summary', content: '这是来源已经公开的摘要内容。' });
    expect(result.warning).toContain('未能读取页面正文');
  });

  it('provides clearly labelled browser preview summaries for the content handoff workflow', () => {
    const archive = createBrowserHotBoardPreviewArchive('2026-08-11');

    expect(archive).toMatchObject({ archiveDate: '2026-08-11', origin: 'cache' });
    expect(archive.snapshot?.items).toHaveLength(3);
    expect(archive.snapshot?.items.every((item) => item.sourceLabel === '本地预览归档' && Boolean(item.summary?.trim()))).toBe(true);
    expect(archive.snapshot?.warnings.join('')).toContain('不代表实时');
  });
});
