import { useEffect, useRef, useState } from 'react';
import { FilePlus2, Images, Loader2, Save, Star, Trash2, Undo2, Upload, Users } from 'lucide-react';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { LibraryAsset, LibraryAssetSummary } from '../../shared/asset-library';
import { useUnsavedChanges } from '../../app/workspace-navigation';
import { Button, CheckboxField, IconButton, TextField } from '../../ui';
import { PersonAssetsPage } from '../labs/PersonAssetsPage';
import { LibraryBrowser, LibraryImage } from './LibraryBrowser';
import { LibrarySaveDialog, type LibraryDraft } from './LibrarySaveDialog';

export function AssetLibraryPage({ api, isBrowserPreview }: { api: StoryDreamApi; isBrowserPreview: boolean }) {
  const [view, setView] = useState('all');
  const [selected, setSelected] = useState<LibraryAsset | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [title, setTitle] = useState('');
  const [collection, setCollection] = useState('');
  const [tags, setTags] = useState('');
  const [favorite, setFavorite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [draft, setDraft] = useState<LibraryDraft | null>(null);
  const pendingAction = useRef(false);
  const request = useRef(0);
  const dirty = Boolean(selected && !selected.deletedAt && (title !== selected.title || collection !== selected.collection || tags !== selected.tags.join(', ') || favorite !== selected.favorite));
  const { requestLeave } = useUnsavedChanges({ id: 'global-asset-library', label: '素材详情', dirty, busy, onSave: saveMetadata, onDiscard: () => { if (selected) adopt(selected); } });
  useEffect(() => () => { request.current += 1; }, []);
  function adopt(asset: LibraryAsset) {
    setSelected(asset); setSelectedId(asset.id);
    setTitle(asset.title); setCollection(asset.collection); setTags(asset.tags.join(', ')); setFavorite(asset.favorite);
  }
  function selectAsset(summary: LibraryAssetSummary | null) {
    if (pendingAction.current || summary?.id === selectedId) return;
    void requestLeave(async () => {
      const token = ++request.current;
      setSelected(null); setSelectedId(summary?.id || ''); setError('');
      if (!summary) { setLoading(false); return; }
      setLoading(true);
      try { const asset = await api.getLibraryAsset(summary.id); if (token === request.current) adopt(asset); }
      catch (reason) { if (token === request.current) setError(reason instanceof Error ? reason.message : String(reason)); }
      finally { if (token === request.current) setLoading(false); }
    });
  }
  async function saveMetadata() {
    if (!selected || pendingAction.current) return false;
    pendingAction.current = true; setBusy(true); setError('');
    try {
      const saved = await api.updateLibraryAsset({ id: selected.id, title, collection, tags: tags.split(/[,，]/u).map((tag) => tag.trim()).filter(Boolean), favorite });
      adopt(saved); setRefresh((value) => value + 1); setNotice('素材信息已保存。');
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); throw reason; }
    finally { pendingAction.current = false; setBusy(false); }
  }
  async function recycle() {
    if (!selected || pendingAction.current) return;
    await requestLeave(async () => {
      pendingAction.current = true; setBusy(true); setError('');
      try {
        await api.recycleLibraryAsset(selected.id);
        setSelected(null); setSelectedId(''); setRefresh((value) => value + 1); setNotice('已移入回收站。');
      } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
      finally { pendingAction.current = false; setBusy(false); }
    });
  }
  async function restore() {
    if (!selected || pendingAction.current) return;
    pendingAction.current = true; setBusy(true); setError('');
    try {
      await api.restoreLibraryAsset(selected.id);
      setSelected(null); setSelectedId(''); setRefresh((value) => value + 1); setNotice('素材已恢复。');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { pendingAction.current = false; setBusy(false); }
  }
  async function importImage() {
    if (pendingAction.current) return;
    pendingAction.current = true; setBusy(true); setError('');
    try {
      const imagePath = await api.selectLocalImage();
      if (imagePath) setDraft({ kind: 'image', imagePath, title: imagePath.split(/[\\/]/u).pop() || '导入图片', source: { kind: 'local' } });
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { pendingAction.current = false; setBusy(false); }
  }
  function changeView(next: string) {
    void requestLeave(() => { request.current += 1; setView(next); setSelected(null); setSelectedId(''); setLoading(false); setError(''); });
  }
  const filters = [
    { id: 'all', label: '全部素材', icon: Images }, { id: 'favorite', label: '收藏', icon: Star },
    { id: 'trash', label: '回收站', icon: Trash2 }, { id: 'people', label: '人物真图', icon: Users },
  ];
  return <div className="asset-library-page" data-asset-library>
    <header className="library-header"><div><h2>素材库</h2><span>图片与文本</span></div><div className="library-actions"><Button icon={<FilePlus2 size={15} />} disabled={busy} onClick={() => setDraft({ kind: 'text', text: '', title: '新建文本', source: { kind: 'local' } })}>新建文本</Button><Button variant="primary" icon={<Upload size={15} />} disabled={busy || isBrowserPreview} onClick={() => void importImage()}>导入图片</Button></div></header>
    <div className="library-workspace">
      <nav className="library-nav" aria-label="素材库视图">{filters.map(({ id, label, icon: Icon }) => <Button key={id} variant="subtle" icon={<Icon size={16} />} aria-pressed={id === view} disabled={busy} onClick={() => changeView(id)}>{label}</Button>)}</nav>
      {view === 'people' ? <div className="library-legacy"><PersonAssetsPage api={api} isBrowserPreview={isBrowserPreview} /></div> : <>
        <LibraryBrowser api={api} favorite={view === 'favorite'} deleted={view === 'trash'} selectedId={selectedId} onSelect={selectAsset} refresh={refresh} disabled={busy} requestChange={(action) => { void requestLeave(action); }} />
        <aside className="library-inspector" aria-label="素材详情">
          {loading ? <p role="status"><Loader2 size={18} className="spin" />正在读取详情…</p> : selected ? <>
            <div className="library-inspector-heading"><h3>{selected.kind === 'image' ? '图片素材' : '文本素材'}</h3>{selected.deletedAt ? <IconButton label="恢复素材" icon={<Undo2 size={16} />} disabled={busy} onClick={() => void restore()} /> : <IconButton label="移入回收站" icon={<Trash2 size={16} />} disabled={busy} onClick={() => void recycle()} />}</div>
            {selected.kind === 'image' && selected.imagePath ? <LibraryImage api={api} path={selected.imagePath} title={selected.title} /> : <div className="library-full-text">{selected.text}</div>}
            <TextField label="素材名称" value={title} maxLength={240} disabled={busy || Boolean(selected.deletedAt)} onChange={(_, data) => setTitle(data.value)} />
            <TextField label="分类" value={collection} maxLength={80} disabled={busy || Boolean(selected.deletedAt)} onChange={(_, data) => setCollection(data.value)} />
            <TextField label="标签" value={tags} disabled={busy || Boolean(selected.deletedAt)} onChange={(_, data) => setTags(data.value)} />
            <CheckboxField label="收藏" checked={favorite} disabled={busy || Boolean(selected.deletedAt)} onChange={(_, data) => setFavorite(Boolean(data.checked))} />
            <dl className="library-metadata"><dt>来源</dt><dd>{selected.source.label || ({ local: '本地导入', 'image-lab': '图片创作', 'copy-studio': '文案创作', conversation: '对话工作台', 'motion-comic': 'AI 漫剧' }[selected.source.kind])}</dd><dt>保存时间</dt><dd>{new Date(selected.createdAt).toLocaleString('zh-CN')}</dd></dl>
            {!selected.deletedAt ? <Button variant="primary" icon={busy ? <Loader2 size={15} className="spin" /> : <Save size={15} />} disabled={busy || !dirty || !title.trim()} onClick={() => void saveMetadata().catch(() => undefined)}>保存信息{dirty ? ' *' : ''}</Button> : null}
          </> : <p className="library-inspector-empty">选择素材查看详情</p>}
          {error ? <p role="alert">{error}</p> : null}
        </aside>
      </>}
    </div>
    {notice ? <div className="library-notice" role="status">{notice}</div> : null}
    {draft ? <LibrarySaveDialog api={api} draft={draft} onClose={() => setDraft(null)} onSaved={() => { setRefresh((value) => value + 1); setNotice('已存入素材库。'); }} /> : null}
  </div>;
}
