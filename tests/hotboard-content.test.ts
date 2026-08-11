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
    expect(result.excerpt.length).toBeGreaterThan(40);
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
