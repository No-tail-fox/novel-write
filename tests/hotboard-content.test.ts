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
