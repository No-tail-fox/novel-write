import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { StoryDreamProvider } from '../src/ui';
import { StockMediaResultList, StockMediaSearchPanel } from '../src/features/tasks/StockMediaSearchPanel';
import { StockMediaKeyFields } from '../src/features/settings/StockMediaKeyFields';
import { rendererCommandInventory, rendererLifecycleCommands } from '../src/app/renderer-command-inventory';
import type { StockMediaItem } from '../src/shared/stock-media';

function renderPanel(configuredProviders: Array<'pexels' | 'pixabay'>, ratio = '9:16', extra: Record<string, unknown> = {}) {
  const api = { searchStockMedia: vi.fn(), downloadStockMedia: vi.fn(), cancelStockMedia: vi.fn() };
  const html = renderToStaticMarkup(createElement(StoryDreamProvider, null, createElement(StockMediaSearchPanel, {
    api, ratio, configuredProviders, value: { files: [], fit: 'cover' }, onChange: vi.fn(), ...extra,
  })));
  return { api, html };
}

function item(id: string, kind: 'video' | 'photo' = 'video'): StockMediaItem {
  return {
    id, provider: 'pexels', kind, author: `Author ${id}`, authorUrl: '', sourceUrl: '', previewUrl: '', downloadUrl: 'https://videos.pexels.com/x',
    width: 1080, height: 1920, ...(kind === 'video' ? { durationSeconds: 8 } : {}),
    license: { name: 'Pexels License', url: '', attributionRequired: false }, fingerprint: `pexels:${kind}:${id}`, renditions: [],
  };
}

function renderResults(props: Partial<Parameters<typeof StockMediaResultList>[0]> = {}) {
  const onAdd = vi.fn(); const onCancel = vi.fn();
  const html = renderToStaticMarkup(createElement(StoryDreamProvider, null, createElement(StockMediaResultList, {
    results: [item('1'), item('2')], downloadingKey: '', cancelling: false, addedKeys: [], poolFull: false, onAdd, onCancel, ...props,
  })));
  return { html, onAdd, onCancel };
}

describe('在线检索素材 panel (static render; not visual acceptance)', () => {
  it('shows 未配置素材站密钥 without a search control when no key is stored, and never calls the API', () => {
    for (const defaultKind of ['video', 'photo'] as const) {
      const { api, html } = renderPanel([], '9:16', { defaultKind });
      expect(html).toContain('在线检索素材');
      expect(html).toContain('未配置素材站密钥');
      expect(html).toContain('本地导入仍可使用');
      expect(html).toContain('不会改用付费生图');
      expect(html).not.toContain('检索素材</button>');
      expect(api.searchStockMedia).not.toHaveBeenCalled();
      expect(api.downloadStockMedia).not.toHaveBeenCalled();
      expect(api.cancelStockMedia).not.toHaveBeenCalled();
    }
  });

  it('offers 检索素材 with orientation derived from the task ratio once a key exists', () => {
    const { html } = renderPanel(['pixabay'], '9:16');
    expect(html).toContain('检索素材');
    expect(html).toContain('Pixabay');
    expect(html).toContain('竖屏视频');
    expect(html).toContain('图片');
    expect(html).toContain('data-stock-media-kind="video"');
    expect(html).toContain('“素材混剪”素材池');
    expect(html).not.toContain('未配置素材站密钥');
    expect(renderPanel(['pexels', 'pixabay'], '16:9').html).toContain('素材站');
  });

  it('image mode targets the local image library (本地人物素材) and never mentions paid generation as a fallback', () => {
    const { html, api } = renderPanel(['pexels'], '16:9', { defaultKind: 'photo', imageLibrary: '人物甲' });
    expect(html).toContain('data-stock-media-kind="photo"');
    expect(html).toContain('横屏图片');
    expect(html).toContain('本地人物素材库「人物甲」');
    expect(html).toContain('不调用生图模型');
    expect(api.searchStockMedia).not.toHaveBeenCalled();
    expect(renderPanel(['pexels'], '1:1', { defaultKind: 'photo' }).html).toContain('「素材站图片」');
  });

  it('renders the downloading item with a 取消 button and keeps other items locked; cancelling shows 正在取消…', () => {
    const idle = renderResults();
    expect(idle.html).not.toContain('取消');
    expect(idle.html.match(/>添加</gu)).toHaveLength(2);

    const downloading = renderResults({ downloadingKey: 'pexels:video:2' });
    expect(downloading.html).toContain('data-stock-media-state="downloading"');
    expect(downloading.html).toContain('正在下载…');
    expect(downloading.html.match(/>取消</gu)).toHaveLength(1);
    // Only one download at a time: the other item's 添加 button is disabled too.
    expect(downloading.html.match(/<button[^>]*disabled=""><span[^>]*>添加</gu)).toHaveLength(1);

    const cancelling = renderResults({ downloadingKey: 'pexels:video:2', cancelling: true });
    expect(cancelling.html).toContain('正在取消…');
    expect(cancelling.html).toMatch(/<button[^>]*disabled=""><span[^>]*>正在取消…</u);

    const photos = renderResults({ results: [item('7', 'photo')], addedKeys: ['pexels:photo:7'], poolFull: true });
    expect(photos.html).toContain('图片 · 1080×1920');
    expect(photos.html).toContain('已添加');
  });

  it('is mounted for 素材混剪 and 本地人物素材, wires cancel + unmount cleanup and is registered in the command inventory', async () => {
    const [page, panel] = await Promise.all([
      readFile(new URL('../src/features/tasks/NewTaskPage.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/tasks/StockMediaSearchPanel.tsx', import.meta.url), 'utf8'),
    ]);
    expect(page).toContain("materialSource === 'video' || (materialSource === 'local' && !pixelleSkipsImages) ? <StockMediaSearchPanel");
    expect(page).toContain("defaultKind={materialSource === 'local' ? 'photo' : 'video'}");
    expect(page).toContain('onImagesAdded={refreshPersonAssetsAfterStockImage}');
    expect(page).toContain('configuredStockMediaProviders(state.secretStatus)');
    expect(panel).toContain('api.searchStockMedia(');
    expect(panel).toContain('api.downloadStockMedia(');
    expect(panel).toContain('api.cancelStockMedia({ requestId })');
    expect(panel).toContain('appendShortVideoMaterialFiles(value, [downloaded.path])');
    expect(panel).toContain("...(item.kind === 'photo' ? { imageLibrary } : {})");
    expect(panel).toContain('isStockMediaCancelled(downloaded)');
    expect(panel).not.toMatch(/generateImage|image-lab|createImage/iu);
    expect(rendererCommandInventory.searchStockMedia.control).toBe('检索素材');
    expect(rendererCommandInventory.downloadStockMedia.control).toBe('添加');
    expect(rendererCommandInventory.cancelStockMedia.control).toBe('取消');
    expect(rendererLifecycleCommands.some(entry => entry.method === 'cancelStockMedia' && entry.lifecycle === 'cleanup')).toBe(true);
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
