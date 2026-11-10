import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { StoryDreamProvider } from '../src/ui';
import { StockMediaSearchPanel } from '../src/features/tasks/StockMediaSearchPanel';
import { StockMediaKeyFields } from '../src/features/settings/StockMediaKeyFields';
import { rendererCommandInventory } from '../src/app/renderer-command-inventory';

function renderPanel(configuredProviders: Array<'pexels' | 'pixabay'>, ratio = '9:16') {
  const api = { searchStockMedia: vi.fn(), downloadStockMedia: vi.fn() };
  const html = renderToStaticMarkup(createElement(StoryDreamProvider, null, createElement(StockMediaSearchPanel, {
    api, ratio, configuredProviders, value: { files: [], fit: 'cover' }, onChange: vi.fn(),
  })));
  return { api, html };
}

describe('在线检索素材 panel (static render; not visual acceptance)', () => {
  it('shows 未配置素材站密钥 without a search control when no key is stored, and never calls the API', () => {
    const { api, html } = renderPanel([]);
    expect(html).toContain('在线检索素材');
    expect(html).toContain('未配置素材站密钥');
    expect(html).toContain('本地导入仍可使用');
    expect(html).toContain('不会改用付费生图');
    expect(html).not.toContain('检索素材</button>');
    expect(api.searchStockMedia).not.toHaveBeenCalled();
    expect(api.downloadStockMedia).not.toHaveBeenCalled();
  });

  it('offers 检索素材 with orientation derived from the task ratio once a key exists', () => {
    const { html } = renderPanel(['pixabay'], '9:16');
    expect(html).toContain('检索素材');
    expect(html).toContain('Pixabay');
    expect(html).toContain('竖屏');
    expect(html).not.toContain('未配置素材站密钥');
    expect(renderPanel(['pexels', 'pixabay'], '16:9').html).toContain('素材站');
  });

  it('is mounted next to the local material pool and registered in the command inventory', async () => {
    const [page, panel] = await Promise.all([
      readFile(new URL('../src/features/tasks/NewTaskPage.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/tasks/StockMediaSearchPanel.tsx', import.meta.url), 'utf8'),
    ]);
    expect(page).toContain("materialSource === 'video' ? <StockMediaSearchPanel");
    expect(page).toContain('configuredStockMediaProviders(state.secretStatus)');
    expect(panel).toContain('api.searchStockMedia(');
    expect(panel).toContain('api.downloadStockMedia(');
    expect(panel).toContain('appendShortVideoMaterialFiles(value, [downloaded.path])');
    expect(panel).not.toMatch(/generateImage|image-lab|createImage/iu);
    expect(rendererCommandInventory.searchStockMedia.control).toBe('检索素材');
    expect(rendererCommandInventory.downloadStockMedia.control).toBe('添加');
  });
});

describe('素材站密钥 settings fields', () => {
  it('renders two secret inputs backed by vault secret ids', () => {
    const secrets = { value: vi.fn(() => ''), configured: vi.fn((id: string) => id === 'stockMedia/pexels/apiKey'), reference: vi.fn(() => ({ value: '' })), change: vi.fn() };
    const html = renderToStaticMarkup(createElement(StoryDreamProvider, null, createElement(StockMediaKeyFields, { secrets })));
    expect(html).toContain('Pexels API Key');
    expect(html).toContain('Pixabay API Key');
    expect(html).toContain('已配置 Pexels');
    expect(secrets.configured).toHaveBeenCalledWith('stockMedia/pixabay/apiKey');
  });
});
