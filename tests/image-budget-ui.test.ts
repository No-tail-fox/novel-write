import { createElement } from 'react';
import { readFile } from 'node:fs/promises';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ImageBudgetField } from '../src/features/tasks/ImageBudgetField';
import { StoryDreamProvider } from '../src/ui';

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function render(props: Partial<Parameters<typeof ImageBudgetField>[0]> = {}) {
  return renderToStaticMarkup(createElement(StoryDreamProvider, {
    theme: 'light',
    children: createElement(ImageBudgetField, { mode: 'standard', maxImages: '', onModeChange: vi.fn(), onMaxImagesChange: vi.fn(), ...props }),
  }));
}

describe('H-5 follow-up 生图张数 control', () => {
  it('renders the three modes, the optional cap and the live estimate', () => {
    const html = render({ mode: 'economy', maxImages: '8', estimate: '预计生图 8 张（约 ¥1.60）' });
    expect(html).toContain('data-image-budget-field="economy"');
    expect(html).toContain('生图张数');
    for (const label of ['标准', '省图', '极省']) expect(html).toContain(label);
    expect(html).toContain('最多 N 张');
    expect(html).toContain('type="number"');
    expect(html).toContain('min="1"');
    expect(html).toContain('max="100"');
    expect(html).toContain('value="8"');
    expect(html).toContain('placeholder="不限"');
    expect(html).toContain('data-image-budget-estimate=""');
    expect(html).toContain('预计生图 8 张（约 ¥1.60）');
  });

  it('omits the estimate when unknown and honours disabled', () => {
    const html = render({ disabled: true });
    expect(html).toContain('data-image-budget-field="standard"');
    expect(html).not.toContain('data-image-budget-estimate');
    expect(html).toMatch(/disabled/u);
  });

  it('is placed on the new-task page and in both HTML studio forms', async () => {
    const [newTask, html] = await Promise.all([
      source('src/features/tasks/NewTaskPage.tsx'),
      source('src/features/html-video/HtmlVideoPage.tsx'),
    ]);
    expect(newTask).toContain('<ImageBudgetField');
    expect(newTask).toContain('imageBudget: showImageBudget ? imageBudgetFromControl(imageBudgetMode, imageBudgetMaxImages) : undefined');
    expect(html).toContain('data-html-video-create-field="imageBudget"');
    expect(html).toContain('data-html-video-edit-field="imageBudget"');
    expect(html).toContain("field: 'imageBudget'");
  });
});
