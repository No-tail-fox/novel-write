import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('product shell ui', () => {
  it('defines the complete Storybound-style navigation shell', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    for (const view of ['new-task', 'queue', 'history', 'image-lab', 'prompt-templates', 'draft-templates', 'settings', 'account', 'activation']) {
      expect(main).toContain(view);
    }
    for (const text of ['新建任务', '任务队列', '历史任务', '画图实验室', '提示词模板', '草稿模板', '系统设置']) {
      expect(main).toContain(text);
    }
    expect(css).toContain('.app-shell');
    expect(css).toContain('--accent');
  });

  it('presents draft templates as a gallery before opening the editor', async () => {
    const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

    for (const text of ['默认竖屏', '竖屏4:3', '横屏16:9', '编辑', '复制', '新模板', '返回模板列表']) {
      expect(main).toContain(text);
    }

    expect(main).toContain('draft-template-gallery');
    expect(main).toContain('setEditingId');
    expect(css).toContain('.draft-template-gallery');
    expect(css).toContain('.draft-template-thumb');
  });
});
