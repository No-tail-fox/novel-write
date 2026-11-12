import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { CreationPageHeader } from '../src/components/CreationPageHeader';

describe('shared creation-page chrome', () => {
  it('renders a consistent heading and description while preserving action controls', () => {
    const html = renderToStaticMarkup(createElement(CreationPageHeader, {
      title: '新建项目', description: '路线自己的说明',
      icon: createElement('svg'), actions: createElement('button', { disabled: true }, '创建'),
    }));
    expect(html).toContain('class="creation-page-header"');
    expect(html).toContain('<h2>新建项目</h2><p>路线自己的说明</p>');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('class="creation-page-header-actions"');
    expect(html).toContain('disabled=""');
  });

  it('does not create an empty actions column or pretend to own step behavior', () => {
    const html = renderToStaticMarkup(createElement(CreationPageHeader, { title: '标题', description: '说明' }));
    expect(html).not.toContain('creation-page-header-actions');
    expect(html).not.toContain('<nav');
    expect(html).not.toContain('<button');
  });

  it('all five production entrypoints use the shared header without legacy header classes', async () => {
    const files = ['director-desk/DirectorProjectStart', 'motion-comic/MotionComicCreateFlow', 'html-video/HtmlVideoPage', 'music-mv/MusicMvPage'];
    for (const file of files) {
      const source = await readFile(new URL(`../src/features/${file}.tsx`, import.meta.url), 'utf8');
      expect(source).toContain('<CreationPageHeader');
      expect(source).not.toMatch(/className="(?:director-create-header|motion-comic-create__header|hv-create-header)"/);
    }
    const css = await readFile(new URL('../src/components/creation-page.css', import.meta.url), 'utf8');
    expect(css).toContain('border-bottom: 1px solid var(--shell-border)');
    expect(css).toContain('.music-mv-layout > .creation-page-header { grid-column: 1 / -1; }');
  });
});
