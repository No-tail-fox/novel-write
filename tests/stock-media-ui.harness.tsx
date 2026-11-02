import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, StoryDreamProvider } from '../src/ui';
import { ShortVideoMaterialFields } from '../src/features/tasks/ShortVideoMaterialFields';
import type { ShortVideoMaterials } from '../src/shared/short-video-materials';
import { PEXELS_API_DOCUMENTATION_URL, PEXELS_LICENSE_URL, type StockMediaApi } from '../src/shared/stock-media';
import '../src/styles.css';
const control = { configured: false, empty: false, fail: false, hold: false, cancel: undefined as (() => void) | undefined, requests: [] as string[] };
const preview = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#23465a"/><path d="M0 130L80 60L120 100L220 40L320 130V180H0Z" fill="#698d7e"/><circle cx="265" cy="35" r="18" fill="#efc180"/></svg>');
const api: StockMediaApi = {
  async getStockMediaStatus() { return { provider: 'pexels', configured: control.configured }; },
  async searchStockMedia(input) { control.requests.push('search:' + input.query); if (control.fail) throw new Error('STOCK_MEDIA_RATE_LIMIT: Pexels 请求频率已达上限，请稍后重试');
    return { items: control.empty ? [] : [1, 2, 3, 4, 5, 6].map(id => ({ provider: 'pexels', type: 'video', id: String(id), sourceUrl: 'https://www.pexels.com/video/' + id + '/', author: '城市影像作者 ' + id, authorUrl: 'https://www.pexels.com/@fixture/', previewUrl: preview, width: 1920, height: 1080, durationMs: id * 2000 + 8000, variants: [{ id: '88', width: 1280, height: 720, mimeType: 'video/mp4', downloadUrl: 'https://videos.pexels.com/fixture.mp4' }, { id: '89', width: 1920, height: 1080, mimeType: 'video/mp4', downloadUrl: 'https://videos.pexels.com/fixture.mp4' }], license: { name: 'Pexels License', url: PEXELS_LICENSE_URL, recordedAt: '2026-11-02T00:00:00.000Z' } })), page: input.page ?? 1, perPage: 12, total: 24, hasMore: (input.page ?? 1) === 1, durationFiltered: Boolean(input.minDurationSec || input.maxDurationSec) };
  },
  async importStockMedia(input) { control.requests.push('import:' + input.mediaId);
    if (control.hold) await new Promise<void>((_resolve, reject) => { control.cancel = () => reject(new Error('STOCK_MEDIA_CANCELLED: 已取消素材操作')); });
    return { path: 'D:/test-only/stock-media/' + input.mediaId + '.mp4', width: 1920, height: 1080, durationMs: 12000, bytes: 10000, reused: false, provenance: { provider: 'pexels', mediaId: input.mediaId, variantId: input.variantId, sourceUrl: 'https://www.pexels.com/video/' + input.mediaId + '/', author: '城市影像作者 ' + input.mediaId, authorUrl: 'https://www.pexels.com/@fixture/', licenseName: 'Pexels License', licenseUrl: PEXELS_LICENSE_URL, licenseRecordedAt: '2026-11-02T00:00:00.000Z', downloadedAt: '2026-11-02T00:00:00.000Z', contentHash: 'a'.repeat(64), apiDocumentationUrl: PEXELS_API_DOCUMENTATION_URL } };
  },
  async cancelStockMedia() { control.cancel?.(); control.cancel = undefined; },
};
function App() {
  const [value, setValue] = useState<ShortVideoMaterials>({ files: [], fit: 'cover' });
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  useEffect(() => { document.documentElement.dataset.theme = theme; document.documentElement.dataset.themeReady = 'true'; }, [theme]);
  return <StoryDreamProvider theme={theme}><main style={{ padding: 24, minHeight: '100vh', background: 'var(--shell-bg)', color: 'var(--shell-text)' }}>
    <div style={{ display: 'flex', gap: 12 }}><Button onClick={() => { control.configured = true; }}>配置测试凭据</Button><Button onClick={() => { control.empty = true; control.fail = false; }}>空结果</Button><Button onClick={() => { control.empty = false; control.fail = false; }}>正常结果</Button><Button onClick={() => { control.fail = true; }}>限流</Button><Button onClick={() => { control.hold = true; }}>暂停下载</Button><Button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>切换主题</Button></div>
    <h1>素材混剪 · 网络素材验收</h1><p>离线 UI fixture，无真实 API 请求或付费生成。</p>
    <ShortVideoMaterialFields value={value} onChange={setValue} onAdd={async () => setValue(current => ({ ...current, files: [...current.files, 'D:/test-only/local.mp4'] }))} api={api} />
  </main></StoryDreamProvider>;
}
createRoot(document.getElementById('root')!).render(<App />);
