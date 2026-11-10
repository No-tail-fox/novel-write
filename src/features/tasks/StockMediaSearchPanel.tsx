import { useState } from 'react';
import { formatAppErrorMessage, normalizeAppError } from '../../shared/app-error';
import { appendShortVideoMaterialFiles, type ShortVideoMaterials } from '../../shared/short-video-materials';
import { STOCK_MEDIA_PROVIDER_LABELS, orientationFromRatio, parseAspectRatio, type StockMediaItem, type StockMediaProviderId } from '../../shared/stock-media';
import type { StoryDreamApi } from '../../shared/storydream-api';
import { Button, SelectField, TextField } from '../../ui';

const ORIENTATION_LABELS = { landscape: '横屏', portrait: '竖屏', square: '方形' } as const;

/** S-1: search a stock-media site, download into the managed directory and append to the short-video pool. */
export function StockMediaSearchPanel({ api, ratio, configuredProviders, value, onChange }: {
  api: Pick<StoryDreamApi, 'searchStockMedia' | 'downloadStockMedia'>;
  ratio: string;
  configuredProviders: StockMediaProviderId[];
  value: ShortVideoMaterials;
  onChange: (value: ShortVideoMaterials) => void;
}) {
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState<StockMediaProviderId | ''>('');
  const [results, setResults] = useState<StockMediaItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [addingId, setAddingId] = useState('');
  const [addError, setAddError] = useState('');
  const [addedIds, setAddedIds] = useState<string[]>([]);
  const orientation = orientationFromRatio(ratio);
  const activeProvider = provider && configuredProviders.includes(provider) ? provider : configuredProviders[0];

  async function runSearch() {
    if (!activeProvider || searching || !query.trim()) return;
    setSearching(true); setSearchError(''); setAddError('');
    try {
      const result = await api.searchStockMedia({ provider: activeProvider, query: query.trim(), orientation, kind: 'video', page: 1, perPage: 24 });
      setResults(result.items);
    } catch (error) {
      setResults([]);
      setSearchError(formatAppErrorMessage(normalizeAppError(error)));
    } finally { setSearching(false); }
  }

  async function addItem(item: StockMediaItem) {
    if (addingId) return;
    const key = item.fingerprint ?? item.id;
    setAddingId(key); setAddError('');
    try {
      const downloaded = await api.downloadStockMedia({ provider: item.provider, kind: item.kind, id: item.id, ...(parseAspectRatio(ratio) ? { ratio } : {}) });
      onChange(appendShortVideoMaterialFiles(value, [downloaded.path]));
      setAddedIds(current => [...new Set([...current, key])]);
    } catch (error) {
      setAddError(formatAppErrorMessage(normalizeAppError(error)));
    } finally { setAddingId(''); }
  }

  if (!activeProvider) {
    return <section aria-label="在线检索素材">
      <strong>在线检索素材</strong>
      <p role="status">未配置素材站密钥。可在“设置 → AI 创作 → 素材站密钥”填写 Pexels 或 Pixabay 密钥；本地导入仍可使用，不会改用付费生图。</p>
    </section>;
  }

  return <section aria-label="在线检索素材">
    <strong>在线检索素材</strong>
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      {configuredProviders.length > 1 ? <SelectField label="素材站" value={activeProvider} options={configuredProviders.map(id => ({ value: id, label: STOCK_MEDIA_PROVIDER_LABELS[id] }))} onChange={event => setProvider(event.target.value as StockMediaProviderId)} /> : null}
      <TextField label="关键词" value={query} maxLength={100} placeholder="例如 city night" onChange={(_, data) => setQuery(data.value)} />
      <Button variant="primary" disabled={searching || !query.trim()} onClick={() => void runSearch()}>{searching ? '正在检索…' : '检索素材'}</Button>
    </div>
    <p>{STOCK_MEDIA_PROVIDER_LABELS[activeProvider]} · 按当前画幅检索{ORIENTATION_LABELS[orientation]}视频；添加后下载到本机托管目录并记录作者与授权来源。</p>
    {searchError ? <p role="alert">{searchError}</p> : null}
    {addError ? <p role="alert">{addError}</p> : null}
    {results.length ? <ul aria-label="素材检索结果" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8, listStyle: 'none', padding: 0 }}>
      {results.map(item => {
        const key = item.fingerprint ?? item.id;
        return <li key={key} style={{ display: 'grid', gap: 4 }}>
          {item.previewUrl ? <img src={item.previewUrl} alt={`${item.author} 的素材预览`} loading="lazy" referrerPolicy="no-referrer" style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: 4 }} /> : null}
          <small>{item.durationSeconds ? `${Math.round(item.durationSeconds)} 秒 · ` : ''}{item.width}×{item.height}</small>
          <small>作者：{item.author || '未知'}</small>
          <small>授权：{item.license.name}{item.license.attributionRequired ? '（需署名）' : ''}</small>
          <Button variant="subtle" disabled={Boolean(addingId) || addedIds.includes(key) || value.files.length >= 100} onClick={() => void addItem(item)}>{addingId === key ? '正在下载…' : addedIds.includes(key) ? '已添加' : '添加'}</Button>
        </li>;
      })}
    </ul> : null}
  </section>;
}
