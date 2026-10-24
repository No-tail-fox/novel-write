import { useEffect, useRef, useState } from 'react';
import { FileText, Image as ImageIcon, Loader2, RefreshCw, Star } from 'lucide-react';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { LibraryAssetSummary, LibraryKind, LibraryPage } from '../../shared/asset-library';
import { Button, IconButton, SegmentedControl, SelectField, TextField } from '../../ui';
import './asset-library.css';

export function LibraryImage({ api, path, title }: { api: StoryDreamApi; path: string; title: string }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    setUrl(''); setFailed(false);
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void api.readAssetDataUrl(path).then((value) => { if (active) setUrl(value); }).catch(() => { if (active) setFailed(true); });
    });
    if (element.current) observer.observe(element.current);
    return () => { active = false; observer.disconnect(); };
  }, [api, path, retry]);
  return <div ref={element} className="library-image">{url ? <img src={url} alt={title} onError={() => { setUrl(''); setFailed(true); }} /> : failed ? <IconButton label="重试图片预览" variant="subtle" icon={<RefreshCw size={18} />} onClick={(event) => { event.stopPropagation(); setRetry((value) => value + 1); }} /> : <ImageIcon size={24} />}</div>;
}

export function LibraryBrowser({ api, kind, deleted = false, favorite = false, selectedId, onSelect, refresh = 0, disabled = false, requestChange = (action) => action() }: { api: StoryDreamApi; kind?: LibraryKind; deleted?: boolean; favorite?: boolean; selectedId: string; onSelect: (asset: LibraryAssetSummary | null) => void; refresh?: number; disabled?: boolean; requestChange?: (action: () => void) => void }) {
  const [query, setQuery] = useState('');
  const [filterKind, setFilterKind] = useState('all');
  const [collection, setCollection] = useState('all');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<LibraryPage>({ items: [], total: 0, collections: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const selectRef = useRef(onSelect);
  const selectedRef = useRef(selectedId);
  selectRef.current = onSelect; selectedRef.current = selectedId;
  useEffect(() => { setOffset(0); }, [query, filterKind, collection, deleted, favorite]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const timer = window.setTimeout(() => {
      void api.listLibraryAssets({ query, kind: kind ?? (filterKind === 'all' ? undefined : filterKind as LibraryKind), deleted, favorite, collection: collection === 'all' ? undefined : collection, offset, limit: 24 }).then((result) => {
        if (!active) return;
        if (offset > 0 && !result.items.length) { setOffset(Math.max(0, Math.floor((result.total - 1) / 24) * 24)); return; }
        setPage(result);
        if (!result.items.some((asset) => asset.id === selectedRef.current)) selectRef.current(null);
      }).catch((reason) => { if (active) { setPage({ items: [], total: 0, collections: [] }); setError(reason instanceof Error ? reason.message : String(reason)); } }).finally(() => { if (active) setLoading(false); });
    }, 150);
    return () => { active = false; window.clearTimeout(timer); };
  }, [api, query, kind, filterKind, deleted, favorite, collection, offset, refresh, retry]);
  return <section className="library-browser" aria-label="素材列表">
    <div className="library-filters">
      <TextField label="搜索素材" placeholder="名称、标签或内容" value={query} maxLength={240} disabled={disabled} onChange={(_, data) => requestChange(() => setQuery(data.value))} />
      {!kind ? <SegmentedControl label="素材类型" value={filterKind} onChange={(value) => requestChange(() => setFilterKind(value))} disabled={disabled} options={[{ value: 'all', label: '全部' }, { value: 'image', label: '图片' }, { value: 'text', label: '文本' }]} /> : null}
      <SelectField label="分类筛选" value={collection} disabled={disabled} options={[{ value: 'all', label: '全部分类' }, ...page.collections.map((value) => ({ value, label: value }))]} onChange={(_, data) => requestChange(() => setCollection(data.value))} />
      <IconButton label="刷新素材" icon={<RefreshCw size={16} />} disabled={disabled || loading} onClick={() => setRetry((value) => value + 1)} />
    </div>
    <div className="library-grid" aria-busy={loading}>
      {loading ? <p className="library-empty" role="status"><Loader2 size={18} className="spin" />正在读取素材…</p> : error ? <div className="library-empty" role="alert"><p>{error}</p><Button onClick={() => setRetry((value) => value + 1)}>重试</Button></div> : !page.items.length ? <p className="library-empty">{deleted ? '回收站为空' : query || collection !== 'all' ? '没有匹配的素材' : '暂无素材'}</p> : page.items.map((asset) => <article className="library-card" data-selected={asset.id === selectedId} key={asset.id}>
        {asset.kind === 'image' && asset.imagePath ? <LibraryImage api={api} path={asset.imagePath} title={asset.title} /> : <div className="library-text-preview"><FileText size={20} /><p>{asset.preview}</p></div>}
        <Button variant="subtle" className="library-card-select" disabled={disabled} aria-pressed={asset.id === selectedId} onClick={() => onSelect(asset)}><strong>{asset.title}</strong><span>{asset.favorite ? <Star size={12} /> : null}{asset.kind === 'image' ? '图片' : '文本'}{asset.collection ? ` · ${asset.collection}` : ''}</span></Button>
      </article>)}
    </div>
    <div className="library-pagination"><span>{page.total} 项</span><Button density="compact" disabled={disabled || loading || offset === 0} onClick={() => requestChange(() => setOffset((value) => Math.max(0, value - 24)))}>上一页</Button><span>{Math.floor(offset / 24) + 1} / {Math.max(1, Math.ceil(page.total / 24))}</span><Button density="compact" disabled={disabled || loading || offset + 24 >= page.total} onClick={() => requestChange(() => setOffset((value) => value + 24))}>下一页</Button></div>
  </section>;
}
