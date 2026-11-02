import { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Search, X } from 'lucide-react';
import { Button, SelectField, TextField } from '../../ui';
import { formatAppErrorMessage, normalizeAppError } from '../../shared/app-error';
import { PEXELS_LICENSE_URL, type StockMediaApi, type StockMediaItem, type StockMediaSearchInput, type StockMediaSearchResult } from '../../shared/stock-media';
import './stock-media.css';
const errorMessage = (error: unknown) => formatAppErrorMessage(normalizeAppError(error));

export function StockMediaPicker({ api, onAdd, remaining }: { api: StockMediaApi; onAdd: (path: string) => void; remaining: number }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [query, setQuery] = useState('');
  const [orientation, setOrientation] = useState<NonNullable<StockMediaSearchInput['orientation']>>('any');
  const [minimum, setMinimum] = useState('');
  const [maximum, setMaximum] = useState('');
  const [result, setResult] = useState<StockMediaSearchResult | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [busy, setBusy] = useState<'search' | 'download' | null>(null);
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');
  const active = useRef<string | null>(null);
  const alive = useRef(true);
  const lastRequest = useRef<StockMediaSearchInput | null>(null);
  const latest = useRef({ onAdd, remaining }); latest.current = { onAdd, remaining };
  const selected = result?.items.find(item => item.id === selectedId);
  useEffect(() => {
    alive.current = true;
    void api.getStockMediaStatus().then(status => { if (alive.current) setConfigured(status.configured); }).catch(error => { if (alive.current) setFailure(errorMessage(error)); });
    return () => { alive.current = false; if (active.current) void api.cancelStockMedia({ operationId: active.current }).catch(() => undefined); };
  }, [api]);
  async function refreshStatus() {
    setFailure('');
    try { setConfigured((await api.getStockMediaStatus()).configured); } catch (error) { setFailure(errorMessage(error)); }
  }
  function select(item: StockMediaItem) {
    setSelectedId(item.id);
    setVariantId(item.variants.filter(variant => Math.max(variant.width, variant.height) <= 1920).at(-1)?.id ?? item.variants[0].id);
  }
  async function search(page?: number) {
    if (active.current) return;
    const operationId = crypto.randomUUID();
    const input: StockMediaSearchInput = page !== undefined && lastRequest.current
      ? { ...lastRequest.current, operationId, page }
      : { operationId, provider: 'pexels', type: 'video', query: query.trim(), orientation, minDurationSec: minimum ? Number(minimum) : 0, ...(maximum ? { maxDurationSec: Number(maximum) } : {}), page: 1, perPage: 12 };
    active.current = operationId; setBusy('search'); setFailure(''); setNotice('');
    try {
      const next = await api.searchStockMedia(input);
      if (!alive.current || active.current !== operationId) return;
      lastRequest.current = input; setResult(next); setSelectedId(''); setVariantId('');
      if (!next.items.length) setNotice('本页没有符合条件的素材。请调整检索词或时长、继续翻页，或添加本地视频。');
    } catch (error) { if (alive.current) setFailure(errorMessage(error)); }
    finally { if (active.current === operationId) active.current = null; if (alive.current) setBusy(null); }
  }
  async function download() {
    if (!selected || !variantId || active.current || latest.current.remaining < 1) return;
    const operationId = crypto.randomUUID(); active.current = operationId; setBusy('download'); setFailure(''); setNotice('');
    try {
      const imported = await api.importStockMedia({ operationId, provider: 'pexels', mediaId: selected.id, variantId });
      if (!alive.current || active.current !== operationId) return;
      if (latest.current.remaining < 1) throw new Error('STOCK_MEDIA_LIMIT: 素材池已满。已下载素材保留在本地，移除素材后可再次添加。');
      latest.current.onAdd(imported.path);
      setNotice((imported.reused ? '已复用本地素材' : '已下载并托管') + '：' + imported.provenance.author + ' / Pexels。来源与许可随任务保存。');
    } catch (error) { if (alive.current) setFailure(errorMessage(error)); }
    finally { if (active.current === operationId) active.current = null; if (alive.current) setBusy(null); }
  }
  async function cancel() {
    if (!active.current) return;
    try { await api.cancelStockMedia({ operationId: active.current }); setNotice('正在取消素材操作…'); } catch (error) { setFailure(errorMessage(error)); }
  }
  return <section className="stock-media-picker" aria-label="Pexels 网络视频素材">
    <div className="stock-media-header"><div><h3>网络视频素材</h3><p>视频由 <a href="https://www.pexels.com/" target="_blank" rel="noreferrer">Pexels</a> 提供。选择后下载到本地素材池。</p></div>
      <Button variant="subtle" disabled={Boolean(busy)} onClick={refreshStatus}>刷新凭据状态</Button></div>
    {configured === false ? <p role="status">尚未配置 Pexels 专用 API Key。请到「系统设置 → 网络素材」保存密钥；当前仍可添加本地视频。</p> : configured === null ? <p role="status">正在检查素材服务配置…</p> : null}
    <div className="stock-media-filters">
      <TextField label="检索词" value={query} disabled={Boolean(busy)} placeholder="例如：城市夜景、海边、森林" onChange={(_, data) => setQuery(data.value)} />
      <SelectField label="画面方向" value={orientation} disabled={Boolean(busy)} options={[{ value: 'any', label: '不限' }, { value: 'landscape', label: '横屏' }, { value: 'portrait', label: '竖屏' }, { value: 'square', label: '方形' }]} onChange={event => setOrientation(event.target.value as typeof orientation)} />
      <TextField label="最短时长（秒）" type="number" min={0} max={600} value={minimum} disabled={Boolean(busy)} onChange={(_, data) => setMinimum(data.value)} />
      <TextField label="最长时长（秒）" type="number" min={1} max={600} value={maximum} disabled={Boolean(busy)} onChange={(_, data) => setMaximum(data.value)} />
    </div>
    <div className="stock-media-actions">
      <Button icon={busy === 'search' ? <Loader2 size={16} className="spin" /> : <Search size={16} />} disabled={!configured || Boolean(busy) || !query.trim()} onClick={() => void search()}>{busy === 'search' ? '正在检索…' : '搜索 Pexels 视频'}</Button>
      {busy ? <Button icon={<X size={16} />} disabled={!active.current} onClick={cancel}>取消{busy === 'download' ? '下载' : '检索'}</Button> : null}
      {result ? <span>第 {result.page} 页 · {result.items.length} 项{result.durationFiltered ? ' · 时长筛选仅作用于本页' : ''}</span> : null}
    </div>
    {failure ? <p role="alert" className="stock-media-error">{failure}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {result?.items.length ? <div className="stock-media-workspace">
      <ul className="stock-media-results" aria-label="Pexels 搜索结果">{result.items.map(item => <li key={item.id} data-selected={selectedId === item.id}>
        <img src={item.previewUrl} alt={item.author + ' 的视频预览'} loading="lazy" referrerPolicy="no-referrer" />
        <div><Button variant="subtle" aria-pressed={selectedId === item.id} disabled={Boolean(busy)} onClick={() => select(item)}>选择视频 {item.id}</Button>
          <span>{item.width} × {item.height} · {(item.durationMs / 1000).toFixed(1)} 秒</span>
          <a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.author} / Pexels</a></div>
      </li>)}</ul>
      <aside className="stock-media-inspector" aria-label="所选素材详情">{selected ? <>
        <h4>视频 {selected.id}</h4><p><a href={selected.authorUrl} target="_blank" rel="noreferrer">{selected.author}</a> / Pexels</p>
        <p><a href={selected.sourceUrl} target="_blank" rel="noreferrer">查看原始素材与作者信息</a></p>
        <SelectField label="下载清晰度" value={variantId} disabled={Boolean(busy)} options={selected.variants.map(variant => ({ value: variant.id, label: variant.width + ' × ' + variant.height + ' · MP4' }))} onChange={event => setVariantId(event.target.value)} />
        <p>下载前重新取得有效地址；校验 MP4、大小及真实时长，保留作者、来源、许可和内容哈希。</p>
        <Button variant="primary" disabled={Boolean(busy) || remaining < 1 || !variantId} onClick={download} icon={busy === 'download' ? <Loader2 size={16} className="spin" /> : <Download size={16} />}>{busy === 'download' ? '正在下载并校验…' : '下载并加入素材池'}</Button>
        {remaining < 1 ? <p role="status">素材池已达到 100 项上限。</p> : null}
      </> : <p>选择一项素材，查看清晰度与来源。</p>}</aside>
    </div> : null}
    {result ? <div className="stock-media-actions"><Button disabled={Boolean(busy) || result.page <= 1} onClick={() => void search(result.page - 1)}>上一页</Button><Button disabled={Boolean(busy) || !result.hasMore} onClick={() => void search(result.page + 1)}>下一页</Button></div> : null}
    <p className="stock-media-license">素材适用 <a href={PEXELS_LICENSE_URL} target="_blank" rel="noreferrer">Pexels License</a>，具体使用须遵守官方限制与第三方权利。此处展示 Pexels 与作者署名满足检索流程的来源标识；许可不等同于人物、商标等权利的额外授权。</p>
  </section>;
}
