import { useRef, useState } from 'react';
import { BookmarkPlus, Loader2 } from 'lucide-react';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { LibraryAsset, LibrarySaveInput } from '../../shared/asset-library';
import { Button, Dialog, TextAreaField, TextField } from '../../ui';
import './asset-library.css';

export type LibraryDraft = Omit<Extract<LibrarySaveInput, { kind: 'image' }>, 'collection' | 'tags' | 'favorite'> | Omit<Extract<LibrarySaveInput, { kind: 'text' }>, 'collection' | 'tags' | 'favorite'>;
export function LibrarySaveDialog({ api, draft, onClose, onSaved }: { api: StoryDreamApi; draft: LibraryDraft; onClose: () => void; onSaved?: (asset: LibraryAsset) => void }) {
  const [title, setTitle] = useState(draft.title.slice(0, 240));
  const [text, setText] = useState(draft.kind === 'text' ? draft.text : '');
  const [collection, setCollection] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  async function save() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true); setError('');
    try {
      const saved = await api.saveLibraryAsset({ ...draft, ...(draft.kind === 'text' ? { text } : {}), title, collection, tags: [...new Set(tags.split(/[,，]/u).map((tag) => tag.trim()).filter(Boolean))], favorite: false });
      onSaved?.(saved);
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <Dialog open title="存入素材库" onOpenChange={(open) => { if (!open && !submitting.current) onClose(); }} actions={<><Button disabled={busy} onClick={onClose}>取消</Button><Button variant="primary" disabled={busy || !title.trim() || (draft.kind === 'text' && !text.trim())} icon={busy ? <Loader2 size={15} className="spin" /> : <BookmarkPlus size={15} />} onClick={() => void save()}>{busy ? '保存中' : '保存素材'}</Button></>}>
    <div className="library-save-fields">
      <TextField label="素材名称" value={title} maxLength={240} disabled={busy} onChange={(_, data) => setTitle(data.value)} />
      <TextField label="分类" value={collection} maxLength={80} disabled={busy} onChange={(_, data) => setCollection(data.value)} />
      <TextField label="标签" placeholder="用逗号分隔" value={tags} disabled={busy} onChange={(_, data) => setTags(data.value)} />
      {draft.kind === 'text' ? <TextAreaField label="文本内容" rows={9} maxLength={65_536} value={text} disabled={busy} onChange={(_, data) => setText(data.value)} /> : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  </Dialog>;
}
