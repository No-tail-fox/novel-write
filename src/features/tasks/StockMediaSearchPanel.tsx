import { useEffect, useRef, useState } from 'react';
import { SegmentedControl } from '../../components/SegmentedControl';
import { formatAppErrorMessage, normalizeAppError } from '../../shared/app-error';
import { appendShortVideoMaterialFiles, type ShortVideoMaterials } from '../../shared/short-video-materials';
import {
  STOCK_MEDIA_DEFAULT_IMAGE_LIBRARY,
  STOCK_MEDIA_PROVIDER_LABELS,
  isStockMediaCancelled,
  orientationFromRatio,
  parseAspectRatio,
  type StockMediaItem,
  type StockMediaKind,
  type StockMediaProviderId,
} from '../../shared/stock-media';
import type { StoryDreamApi } from '../../shared/storydream-api';
import { Button, SelectField, TextField } from '../../ui';

const ORIENTATION_LABELS = { landscape: '横屏', portrait: '竖屏', square: '方形' } as const;
const KIND_LABELS: Record<StockMediaKind, string> = { video: '视频', photo: '图片' };

function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function itemKey(item: StockMediaItem): string {
  return item.fingerprint ?? `${item.provider}:${item.kind}:${item.id}`;
}

/** Presentational result grid (exported for static render tests of the downloading/cancel state). */
export function StockMediaResultList({ results, downloadingKey, cancelling, addedKeys, poolFull, onAdd, onCancel }: {
  results: readonly StockMediaItem[];
  downloadingKey: string;
  cancelling: boolean;
  addedKeys: readonly string[];
  poolFull: boolean;
  onAdd: (item: StockMediaItem) => void;
  onCancel: () => void;
}) {
  if (!results.length) return null;
  return <ul aria-label="素材检索结果" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8, listStyle: 'none', padding: 0 }}>
    {results.map(item => {
      const key = itemKey(item);
      const downloading = downloadingKey === key;
      const added = addedKeys.includes(key);
      const aspect = item.width > 0 && item.height > 0 ? `${item.width} / ${item.height}` : '16 / 9';
      return <li key={key} data-stock-media-state={downloading ? 'downloading' : added ? 'added' : 'idle'} style={{ display: 'grid', gap: 4 }}>
        {item.previewUrl ? <img src={item.previewUrl} alt={`${item.author} 的素材预览`} loading="lazy" referrerPolicy="no-referrer" style={{ width: '100%', aspectRatio: aspect, maxHeight: 220, objectFit: 'cover', borderRadius: 4 }} /> : null}
        <small>{item.kind === 'video' ? '视频' : '图片'} · {item.durationSeconds ? `${Math.round(item.durationSeconds)} 秒 · ` : ''}{item.width}×{item.height}</small>
        <small>作者：{item.author || '未知'}</small>
        <small>授权：{item.license.name}{item.license.attributionRequired ? '（需署名）' : ''}</small>
        <div style={{ display: 'flex', gap: 4 }}>
          <Button variant="subtle" disabled={Boolean(downloadingKey) || added || (item.kind === 'video' && poolFull)} onClick={() => onAdd(item)}>{downloading ? '正在下载…' : added ? '已添加' : '添加'}</Button>
          {downloading ? <Button variant="subtle" disabled={cancelling} onClick={() => onCancel()}>{cancelling ? '正在取消…' : '取消'}</Button> : null}
        </div>
      </li>;
    })}
  </ul>;
}

/**
 * S-1: search a stock-media site (视频 / 图片), download into the managed directory and hand the file to the task:
 * videos join the short-video material pool; images are copied into a local image library (本地人物素材) that
 * AI-free tasks use as scene images. Never falls back to paid image generation.
 */
export function StockMediaSearchPanel({ api, ratio, configuredProviders, value, onChange, defaultKind = 'video', imageLibrary = STOCK_MEDIA_DEFAULT_IMAGE_LIBRARY, onImagesAdded }: {
  api: Pick<StoryDreamApi, 'searchStockMedia' | 'downloadStockMedia' | 'cancelStockMedia'>;
  ratio: string;
  configuredProviders: StockMediaProviderId[];
  value: ShortVideoMaterials;
  onChange: (value: ShortVideoMaterials) => void;
  defaultKind?: StockMediaKind;
  /** Local image library (person-assets folder) that downloaded images are copied into. */
  imageLibrary?: string;
  onImagesAdded?: (library: string) => void;
}) {
  const [kind, setKind] = useState<StockMediaKind>(defaultKind);
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState<StockMediaProviderId | ''>('');
  const [results, setResults] = useState<StockMediaItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [addingId, setAddingId] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [addError, setAddError] = useState('');
  const [notice, setNotice] = useState('');
  const [addedIds, setAddedIds] = useState<string[]>([]);
  const mounted = useRef(true);
  const searchSeq = useRef(0);
  const searchRequestId = useRef('');
  const downloadRequestId = useRef('');
  const orientation = orientationFromRatio(ratio);
  const activeProvider = provider && configuredProviders.includes(provider) ? provider : configuredProviders[0];

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Leaving the page (or switching material source) aborts work nobody will consume; main removes temp files.
      for (const requestId of [downloadRequestId.current, searchRequestId.current]) {
        if (requestId) void api.cancelStockMedia({ requestId }).catch(() => undefined);
      }
      downloadRequestId.current = '';
      searchRequestId.current = '';
    };
  }, [api]);

  function switchKind(next: StockMediaKind) {
    if (next === kind || addingId) return;
    searchSeq.current += 1; // results of a search for the other kind are ignored when they arrive
    searchRequestId.current = '';
    setKind(next); setResults([]); setSearching(false); setSearchError(''); setAddError(''); setNotice('');
  }

  async function runSearch() {
    if (!activeProvider || !query.trim()) return;
    // A newer search supersedes the previous one: main aborts it and it resolves as cancelled (ignored here).
    const seq = ++searchSeq.current;
    const requestId = newRequestId();
    searchRequestId.current = requestId;
    setSearching(true); setSearchError(''); setAddError(''); setNotice('');
    try {
      const result = await api.searchStockMedia({ requestId, provider: activeProvider, query: query.trim(), orientation, kind, page: 1, perPage: 24 });
      if (!mounted.current || seq !== searchSeq.current || isStockMediaCancelled(result)) return;
      setResults(result.items);
    } catch (error) {
      if (!mounted.current || seq !== searchSeq.current) return;
      setResults([]);
      setSearchError(formatAppErrorMessage(normalizeAppError(error)));
    } finally {
      if (mounted.current && seq === searchSeq.current) { setSearching(false); searchRequestId.current = ''; }
    }
  }

  async function addItem(item: StockMediaItem) {
    if (addingId) return;
    const key = itemKey(item);
    const requestId = newRequestId();
    downloadRequestId.current = requestId;
    setAddingId(key); setCancelling(false); setAddError(''); setNotice('');
    try {
      const downloaded = await api.downloadStockMedia({
        requestId, provider: item.provider, kind: item.kind, id: item.id,
        ...(parseAspectRatio(ratio) ? { ratio } : {}),
        ...(item.kind === 'photo' ? { imageLibrary } : {}),
      });
      if (!mounted.current) return;
      if (isStockMediaCancelled(downloaded)) { setNotice(downloaded.message); return; }
      if (item.kind === 'video') onChange(appendShortVideoMaterialFiles(value, [downloaded.path]));
      else {
        const library = downloaded.library?.name ?? imageLibrary;
        onImagesAdded?.(library);
        setNotice(`已加入本地人物素材库「${library}」。`);
      }
      setAddedIds(current => [...new Set([...current, key])]);
    } catch (error) {
      if (mounted.current) setAddError(formatAppErrorMessage(normalizeAppError(error)));
    } finally {
      if (downloadRequestId.current === requestId) downloadRequestId.current = '';
      if (mounted.current) { setAddingId(''); setCancelling(false); }
    }
  }

  async function cancelDownload() {
    const requestId = downloadRequestId.current;
    if (!requestId || cancelling) return;
    setCancelling(true);
    try {
      // The pending download resolves as cancelled (temp file removed, nothing saved) and resets the card.
      await api.cancelStockMedia({ requestId });
    } catch (error) {
      if (mounted.current) { setCancelling(false); setAddError(formatAppErrorMessage(normalizeAppError(error))); }
    }
  }

  if (!activeProvider) {
    return <section aria-label="在线检索素材">
      <strong>在线检索素材</strong>
      <p role="status">未配置素材站密钥。可在“设置 → AI 创作 → 素材站密钥”填写 Pexels 或 Pixabay 密钥；本地导入仍可使用，不会改用付费生图。</p>
    </section>;
  }

  const target = kind === 'video'
    ? '添加后下载到本机托管目录并加入“素材混剪”素材池'
    : `添加后下载到本机托管目录并复制进本地人物素材库「${imageLibrary}」，在素材来源选“本地人物素材”时用作镜头图片（不调用生图模型）`;
  return <section aria-label="在线检索素材" data-stock-media-kind={kind}>
    <strong>在线检索素材</strong>
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <SegmentedControl label="素材类型" value={kind} options={['video', 'photo'] as const} labels={[KIND_LABELS.video, KIND_LABELS.photo]} disabled={Boolean(addingId)} onChange={switchKind} />
      {configuredProviders.length > 1 ? <SelectField label="素材站" value={activeProvider} options={configuredProviders.map(id => ({ value: id, label: STOCK_MEDIA_PROVIDER_LABELS[id] }))} onChange={event => setProvider(event.target.value as StockMediaProviderId)} /> : null}
      <TextField label="关键词" value={query} maxLength={100} placeholder="例如 city night" onChange={(_, data) => setQuery(data.value)} />
      <Button variant="primary" disabled={!query.trim() || Boolean(addingId)} onClick={() => void runSearch()}>{searching ? '重新检索' : '检索素材'}</Button>
    </div>
    <p>{STOCK_MEDIA_PROVIDER_LABELS[activeProvider]} · 按当前画幅检索{ORIENTATION_LABELS[orientation]}{KIND_LABELS[kind]}；{target}；记录作者与授权来源。</p>
    {searching ? <p role="status">正在检索…（再次检索会取消上一次）</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {searchError ? <p role="alert">{searchError}</p> : null}
    {addError ? <p role="alert">{addError}</p> : null}
    <StockMediaResultList results={results} downloadingKey={addingId} cancelling={cancelling} addedKeys={addedIds} poolFull={value.files.length >= 100} onAdd={item => void addItem(item)} onCancel={() => void cancelDownload()} />
  </section>;
}
