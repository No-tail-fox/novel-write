import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MotionComicSourcePanel } from '../src/features/motion-comic/MotionComicWorkflowPanels';
import { createMotionComicDraft, type MotionComicPipelineData } from '../src/shared/motion-comic';

const render = (originalText: string) => {
  const document = createMotionComicDraft({ id: 'source', title: '源文', premise: '', now: '2026-11-13T00:00:00Z' });
  document.sourceDocument = { kind: 'novel', adaptationMode: 'faithful-script', fileName: '长篇.txt', originalText, importedAt: '2026-11-13T00:00:00Z',
    episodes: [{ id: 's1', number: 1, title: '第一章', sourceText: '源文' }] } as MotionComicPipelineData['sourceDocument'];
  return renderToStaticMarkup(createElement(MotionComicSourcePanel, { document, onContinue: () => {} }));
};

describe('motion comic source reader', () => {
  it('shows text verbatim as paragraphs and turns separator rulers into dividers', () => {
    const html = render(`${'='.repeat(40)}\n更多精校小说尽在某站下载\n${'='.repeat(40)}\n\n内容简介：\n  这是故事。`);
    expect(html).toContain('<p>更多精校小说尽在某站下载</p>');
    expect(html).toContain('<p>这是故事。</p>');
    expect(html).not.toContain('====');
    expect(html.match(/<hr\/>/g)).toHaveLength(2);
    expect(html).not.toContain('<textarea');
  });

  it('pages very long sources instead of rendering every paragraph at once', () => {
    const html = render(Array.from({ length: 5000 }, (_, i) => `第 ${i + 1} 段`).join('\n'));
    expect(html.match(/<p>第 \d+ 段<\/p>/g)).toHaveLength(240);
    expect(html).toContain('已显示 240 / 5,000 段');
  });

  it('summarises import facts in labelled rows with the next step', () => {
    const html = render('正文');
    for (const label of ['计划集数', '分集方式', '成片画幅', '导入时间', '分集预览', '进入分集拆解']) expect(html).toContain(label);
  });
});
