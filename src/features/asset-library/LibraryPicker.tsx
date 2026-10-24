import { useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { LibraryAssetSummary, LibraryKind, LibrarySource } from '../../shared/asset-library';
import type { ImageLabSummary } from '../../shared/types';
import { Button, Dialog, Tabs } from '../../ui';
import { LibraryBrowser, LibraryImage } from './LibraryBrowser';

export interface LibrarySelection {
  kind: LibraryKind;
  title: string;
  imagePath?: string;
  text?: string;
  prompt?: string;
  libraryId?: string;
  revision?: string;
  source: LibrarySource;
}
export function LibraryPicker({ api, kind, title, actionLabel, onClose, onChoose }: { api: StoryDreamApi; kind: LibraryKind; title: string; actionLabel: string; onClose: () => void; onChoose: (selection: LibrarySelection) => Promise<void> | void }) {
  const [tab, setTab] = useState('library');
  const [selected, setSelected] = useState<LibraryAssetSummary | null>(null);
  const [recent, setRecent] = useState<ImageLabSummary[]>([]);
  const [recentId, setRecentId] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const submitting = useRef(false);
  useEffect(() => {
    if (tab !== 'recent') return;
    let active = true;
    setLoading(true); setError('');
    void api.listImageLabRecords({ filter: 'active', status: 'generated', limit: 60 }).then((result) => { if (active) setRecent(result.items); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, tab, retry]);
  async function choose() {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      let selection: LibrarySelection;
      if (tab === 'recent') {
        const record = await api.getImageLabRecordDetail(recentId);
        if (!record || record.status !== 'generated' || !record.imagePath || record.archivedAt) throw new Error('这张生成图已不可用，请重新选择。');
        selection = { kind: 'image', title: record.prompt.slice(0, 80), imagePath: record.imagePath, prompt: record.prompt, source: { kind: 'image-lab', id: record.id } };
      } else {
        if (!selected) return;
        const asset = await api.getLibraryAsset(selected.id);
        if (asset.deletedAt || asset.kind !== kind) throw new Error('该素材已移入回收站或类型不匹配，请重新选择。');
        selection = { ...asset, libraryId: asset.id };
      }
      await onChoose(selection);
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <Dialog open title={title} onOpenChange={(open) => { if (!open && !submitting.current) onClose(); }} actions={<><Button disabled={busy} onClick={onClose}>取消</Button><Button variant="primary" icon={busy ? <Loader2 size={15} className="spin" /> : <Check size={15} />} disabled={busy || (tab === 'library' ? !selected : !recentId)} onClick={() => void choose()}>{busy ? '采用中' : actionLabel}</Button></>}>
    <div className="library-picker" data-library-picker>
      {kind === 'image' ? <Tabs label="图片来源" value={tab} onChange={(value) => { if (!busy) { setTab(value); setError(''); } }} items={[{ value: 'library', label: '素材库' }, { value: 'recent', label: '最近生成' }]} /> : null}
      {tab === 'library' ? <LibraryBrowser api={api} kind={kind} selectedId={selected?.id || ''} onSelect={setSelected} disabled={busy} /> : <div className="library-recent">
        {loading ? <p role="status">正在读取生成记录…</p> : !recent.length ? <p>暂无生成图片</p> : recent.map((record) => <article className="library-card" data-selected={record.id === recentId} key={record.id}><LibraryImage api={api} path={record.imagePath} title={record.promptPreview} /><Button className="library-card-select" variant="subtle" aria-pressed={record.id === recentId} disabled={busy} onClick={() => setRecentId(record.id)}><strong>{record.promptPreview}</strong></Button></article>)}
        {error ? <Button disabled={busy || loading} onClick={() => setRetry((value) => value + 1)}>重新读取</Button> : null}
      </div>}
      {selected && tab === 'library' ? <p className="library-selection-note">已选：{selected.title}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  </Dialog>;
}
