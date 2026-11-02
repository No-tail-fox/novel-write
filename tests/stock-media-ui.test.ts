import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactNode } from 'react';
import { serializeAppErrorForBridge } from '../src/shared/app-error';
const hooks = vi.hoisted(() => ({ values: [] as any[], refs: [] as any[], effects: [] as any[], cursor: 0, refCursor: 0 }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: any) => { const i = hooks.cursor++; if (!(i in hooks.values)) hooks.values[i] = typeof initial === 'function' ? initial() : initial; return [hooks.values[i], (value: any) => { hooks.values[i] = typeof value === 'function' ? value(hooks.values[i]) : value; }]; },
  useRef: (initial: any) => hooks.refs[hooks.refCursor++] ??= { current: initial },
  useEffect: (effect: any) => hooks.effects.push(effect),
}));
vi.mock('../src/ui', () => ({ Button: 'Button', SelectField: 'SelectField', TextField: 'TextField' }));
import { StockMediaPicker } from '../src/features/tasks/StockMediaPicker';
type Props = Parameters<typeof StockMediaPicker>[0];
function nodes(node: ReactNode): any[] { if (Array.isArray(node)) return node.flatMap(nodes); return isValidElement<{ children?: ReactNode }>(node) ? [node, ...nodes(node.props.children)] : []; }
function text(node: ReactNode): string { if (Array.isArray(node)) return node.map(text).join(''); return isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
function render(props: Props) { hooks.cursor = 0; hooks.refCursor = 0; hooks.effects = []; return nodes(StockMediaPicker(props)); }
function button(tree: any[], label: string) { const node = tree.find(n => n.type === 'Button' && text(n.props.children) === label); expect(node, label).toBeTruthy(); return node; }
function deferred<T = any>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const settle = async () => { for (let n = 0; n < 10; n++) await Promise.resolve(); };
const item = { id: '42', author: '作者', authorUrl: 'https://www.pexels.com/@author/', sourceUrl: 'https://www.pexels.com/video/42/', previewUrl: 'https://images.pexels.com/preview.jpeg', width: 320, height: 180, durationMs: 2000, variants: [{ id: '88', width: 320, height: 180 }] };
function fixture() {
  const api = { getStockMediaStatus: vi.fn(async () => ({ provider: 'pexels', configured: true })), searchStockMedia: vi.fn(async (_input: Parameters<Props['api']['searchStockMedia']>[0]) => ({ items: [item], page: 1, perPage: 12, total: 1, hasMore: false, durationFiltered: false })), importStockMedia: vi.fn(async (_input: Parameters<Props['api']['importStockMedia']>[0]) => ({ path: 'D:/managed/42.mp4', provenance: { author: '作者' }, reused: false })), cancelStockMedia: vi.fn(async (_input: Parameters<Props['api']['cancelStockMedia']>[0]) => {}) };
  return { api, props: { api: api as any, onAdd: vi.fn(), remaining: 100 } satisfies Props };
}
async function ready(props: Props) { render(props); const cleanup = hooks.effects[0](); await settle(); const tree = render(props); tree.find(n => n.type === 'TextField' && n.props.label === '检索词').props.onChange({}, { value: '城市 夜景' }); return cleanup; }
async function select(props: Props) { await button(render(props), '搜索 Pexels 视频').props.onClick(); await settle(); button(render(props), '选择视频 42').props.onClick(); }
beforeEach(() => { hooks.values = []; hooks.refs = []; hooks.effects = []; hooks.cursor = 0; hooks.refCursor = 0; });
describe('stock material renderer workflow and lifecycle', () => {
  it('calls getStockMediaStatus on mount, blocks no-key search and refreshes explicitly', async () => {
    const { api, props } = fixture(); api.getStockMediaStatus.mockResolvedValue({ provider: 'pexels', configured: false });
    await ready(props); expect(api.getStockMediaStatus).toHaveBeenCalledTimes(1); expect(button(render(props), '搜索 Pexels 视频').props.disabled).toBe(true);
    expect(render(props).some(n => n.props.role === 'status' && text(n.props.children).includes('尚未配置'))).toBe(true);
    api.getStockMediaStatus.mockResolvedValue({ provider: 'pexels', configured: true }); await button(render(props), '刷新凭据状态').props.onClick();
    expect(button(render(props), '搜索 Pexels 视频').props.disabled).toBe(false);
  });
  it('searchStockMedia locks double submission before rerender, preserves the query and decodes safe IPC errors', async () => {
    const { api, props } = fixture(); await ready(props); const pending = deferred(); api.searchStockMedia.mockImplementation(() => pending.promise);
    const click = button(render(props), '搜索 Pexels 视频').props.onClick; click(); click(); expect(api.searchStockMedia).toHaveBeenCalledTimes(1);
    expect(api.searchStockMedia.mock.calls[0][0]).toMatchObject({ query: '城市 夜景', provider: 'pexels', type: 'video', page: 1 });
    expect(button(render(props), '正在检索…').props.disabled).toBe(true);
    pending.reject(new Error(serializeAppErrorForBridge(new Error('STOCK_MEDIA_RATE_LIMIT: 请稍后再试')))); await settle();
    const message = render(props).find(n => n.props.role === 'alert'); expect(text(message.props.children)).toContain('请稍后再试'); expect(text(message.props.children)).not.toContain('__STORYDREAM');
    expect(render(props).find(n => n.type === 'TextField' && n.props.label === '检索词').props.value).toBe('城市 夜景');
  });
  it('importStockMedia sends selected IDs only and appends the managed path to the latest callback', async () => {
    const { api, props } = fixture(); await ready(props); await select(props); const pending = deferred(); api.importStockMedia.mockImplementation(() => pending.promise);
    const click = button(render(props), '下载并加入素材池').props.onClick; const run = click(); click(); expect(api.importStockMedia).toHaveBeenCalledTimes(1);
    expect(api.importStockMedia.mock.calls[0][0]).toMatchObject({ provider: 'pexels', mediaId: '42', variantId: '88' });
    expect(api.importStockMedia.mock.calls[0][0]).not.toHaveProperty('downloadUrl');
    const next = { ...props, onAdd: vi.fn() }; render(next); pending.resolve({ path: 'D:/managed/42.mp4', provenance: { author: '作者' }, reused: true }); await run;
    expect(props.onAdd).not.toHaveBeenCalled(); expect(next.onAdd).toHaveBeenCalledExactlyOnceWith('D:/managed/42.mp4');
  });
  it('cancelStockMedia exposes a visible cancel action, cancels on cleanup and suppresses stale imported output', async () => {
    const { api, props } = fixture(); const cleanup = await ready(props); await select(props); const pending = deferred(); api.importStockMedia.mockImplementation(() => pending.promise);
    const run = button(render(props), '下载并加入素材池').props.onClick(); await button(render(props), '取消下载').props.onClick();
    const requestId = api.importStockMedia.mock.calls[0][0].operationId; expect(api.cancelStockMedia).toHaveBeenCalledWith({ operationId: requestId });
    cleanup(); expect(api.cancelStockMedia).toHaveBeenCalledTimes(2); pending.resolve({ path: 'D:/managed/42.mp4', provenance: { author: '作者' } }); await run; expect(props.onAdd).not.toHaveBeenCalled();
  });
  it('blocks imports when the material pool fills while a download is pending', async () => {
    const { api, props } = fixture(); await ready(props); await select(props); const pending = deferred(); api.importStockMedia.mockImplementation(() => pending.promise);
    const run = button(render(props), '下载并加入素材池').props.onClick(); render({ ...props, remaining: 0 }); pending.resolve({ path: 'D:/managed/42.mp4', provenance: { author: '作者' } }); await run;
    expect(props.onAdd).not.toHaveBeenCalled(); expect(render(props).some(n => n.props.role === 'alert' && text(n.props.children).includes('素材池已满'))).toBe(true);
  });
});
