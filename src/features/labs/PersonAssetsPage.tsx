import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Pencil, Plus, Trash2, Undo2, Upload } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { PersonAssetImage, PersonAssetSummary, RecycledPersonAsset } from '../../shared/person-assets';
import { useAsyncAction } from '../../ui/async-action';
import { Button, TextField } from '../../ui';
import '../../styles/features/local-labs.css';

async function loadPersonImagePreviews(api: StoryDreamApi, person: string): Promise<{ items: PersonAssetImage[]; urls: Record<string, string> }> {
  const items = await api.listPersonAssetImages(person);
  const entries = await Promise.all(
    items.map(async (image) => {
      try {
        return [image.path, await api.readAssetDataUrl(image.path)] as const;
      } catch {
        return [image.path, ''] as const;
      }
    }),
  );
  return { items, urls: Object.fromEntries(entries) };
}

export function PersonAssetsPage({ api, isBrowserPreview }: { api: StoryDreamApi; isBrowserPreview: boolean }) {
  const [people, setPeople] = useState<PersonAssetSummary[]>([]);
  const [selectedName, setSelectedName] = useState('');
  const [newPersonName, setNewPersonName] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [images, setImages] = useState<PersonAssetImage[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [pendingAction, setPendingAction] = useState<'create' | 'rename' | 'delete' | 'import' | 'open' | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ name: string; references: { taskId: string; title: string; status: string }[] } | null>(null);
  const [recycled, setRecycled] = useState<RecycledPersonAsset | null>(null);
  const previewRequest = useRef(0);
  const personAction = useAsyncAction();
  const controlsDisabled = isBrowserPreview || personAction.busy;
  const selectedAsset = people.find((person) => person.name === selectedName) ?? null;

  useEffect(() => {
    let active = true;
    api
      .listPersonAssets()
      .then((assets) => {
        if (!active) return;
        setPeople(assets);
        if (!selectedName && assets[0]) {
          setSelectedName(assets[0].name);
          setRenameValue(assets[0].name);
        }
      })
      .catch((error) => {
        if (active) personAction.reportError(error);
      });
    return () => {
      active = false;
    };
  }, [api, personAction.reportError, selectedName]);

  useEffect(() => {
    setRenameValue(selectedName);
  }, [selectedName]);

  useEffect(() => {
    let active = true;
    const request = ++previewRequest.current;
    if (!selectedName) {
      setImages([]);
      setImageUrls({});
      return undefined;
    }
    loadPersonImagePreviews(api, selectedName)
      .then((previews) => {
        if (!active || request !== previewRequest.current) return;
        setImages(previews.items);
        setImageUrls(previews.urls);
      })
      .catch((error) => {
        if (active) personAction.reportError(error);
      });
    return () => {
      active = false;
    };
  }, [api, personAction.reportError, selectedName]);

  const loadPeople = async (nextSelectedName = selectedName) => {
    const assets = await api.listPersonAssets();
    setPeople(assets);
    const selected = assets.find((asset) => asset.name === nextSelectedName) ?? assets[0] ?? null;
    setSelectedName(selected?.name ?? '');
  };

  async function createPerson() {
    if (controlsDisabled) return;
    const name = newPersonName.trim();
    if (!name) {
      setMessage('请先填写人物名称。');
      return;
    }
    await personAction.run(async () => {
      setPendingAction('create');
      try {
        await api.createPersonAsset(name);
        setNewPersonName('');
        await loadPeople(name);
        setMessage('已创建人物素材库。');
      } finally {
        setPendingAction(null);
      }
    }, { onError: (error) => setMessage(error.message) });
  }

  async function renamePerson() {
    if (controlsDisabled) return;
    const nextName = renameValue.trim();
    if (!selectedName || !nextName) return;
    await personAction.run(async () => {
      setPendingAction('rename');
      try {
        await api.renamePersonAsset(selectedName, nextName);
        await loadPeople(nextName);
        setMessage('已重命名人物素材库。');
      } finally {
        setPendingAction(null);
      }
    }, { onError: (error) => setMessage(error.message) });
  }

  async function deletePerson() {
    if (controlsDisabled || !selectedName) return;
    const name = selectedName;
    await personAction.run(async () => {
      setPendingAction('delete');
      try {
        const references = await api.getPersonAssetUsage(name);
        if (references.length > 0) {
          setDeleteConfirmation({ name, references });
          setMessage(`「${name}」仍被 ${references.length} 个任务引用，已阻止删除。`);
          return;
        }
        if (!deleteConfirmation || deleteConfirmation.name !== name) {
          setDeleteConfirmation({ name, references: [] });
          setMessage(`确认删除「${name}」？素材会移入回收区，可在本次操作后撤销。`);
          return;
        }
        const result = await api.deletePersonAsset(name);
        setRecycled(result);
        setDeleteConfirmation(null);
        await loadPeople('');
        setMessage('已删除人物素材库。');
      } finally {
        setPendingAction(null);
      }
    }, { onError: (error) => setMessage(error.message) });
  }

  async function undoDelete() {
    if (controlsDisabled || !recycled?.token) return;
    await personAction.run(async () => {
      setPendingAction('delete');
      try {
        await api.restorePersonAsset(recycled.token);
        setRecycled(null);
        await loadPeople(recycled.name);
        setMessage('已撤销删除，人物素材库已恢复。');
      } finally {
        setPendingAction(null);
      }
    }, { onError: (error) => setMessage(error.message) });
  }

  async function importImages() {
    if (controlsDisabled) return;
    if (!selectedName) {
      setMessage('请先选择人物。');
      return;
    }
    await personAction.run(async () => {
      setPendingAction('import');
      try {
        const count = await api.importPersonAssetImages(selectedName);
        await loadPeople(selectedName);
        const request = ++previewRequest.current;
        const previews = await loadPersonImagePreviews(api, selectedName);
        if (request !== previewRequest.current) return;
        setImages(previews.items);
        setImageUrls(previews.urls);
        setMessage(count > 0 ? `已导入 ${count} 张图片。` : '没有导入新图片。');
      } finally {
        setPendingAction(null);
      }
    }, { onError: (error) => setMessage(error.message) });
  }

  async function openSelectedAssetDir() {
    if (controlsDisabled || !selectedAsset?.dir) return;
    await personAction.run(async () => {
      setPendingAction('open');
      try {
        await api.openPersonAssetDirectory(selectedAsset.name);
      } finally {
        setPendingAction(null);
      }
    }, { onError: (error) => setMessage(error.message) });
  }

  return (
    <div className="local-lab-workbench person-assets-layout" data-local-lab-workbench="person-assets">
      <section className="local-lab-rail person-list-panel">
        <div className="panel-title-row">
          <div>
            <h2>人物素材库</h2>
            <span>本地真图素材用于分镜生图替代。</span>
          </div>
        </div>
        <div className="person-create-row">
          <TextField label="人物名称" value={newPersonName} onChange={(event) => setNewPersonName(event.target.value)} placeholder="人物名称" disabled={controlsDisabled} />
          <Button className="ghost-action compact-action" density="compact" icon={<Plus size={15} />} type="button" disabled={controlsDisabled || !newPersonName.trim()} onClick={createPerson}>
            {pendingAction === 'create' ? '创建中' : '创建'}
          </Button>
        </div>
        <div className="person-list">
          {people.length === 0 ? <EmptyState title="暂无人物素材" /> : null}
          {people.map((person) => (
            <Button key={person.name} variant="subtle" className={person.name === selectedName ? 'person-list-item active' : 'person-list-item'} type="button" aria-pressed={person.name === selectedName} disabled={controlsDisabled} onClick={() => { setSelectedName(person.name); setDeleteConfirmation(null); }}>
              <strong>{person.name}</strong>
              <span>{person.count} 张图片</span>
            </Button>
          ))}
        </div>
      </section>

      <section className="local-lab-main person-assets-panel">
        <div className="panel-title-row">
          <div>
            <h3>{selectedName || '选择人物'}</h3>
            {isBrowserPreview
              ? <span className="person-preview-notice" role="note">当前为浏览器预览，本地素材管理仅在桌面端可用。</span>
              : <span>{selectedAsset?.dir || '创建人物后可导入本地图片'}</span>}
          </div>
          <div className="button-row">
            {selectedAsset?.dir ? (
              <Button className="ghost-action compact-action" density="compact" icon={<FolderOpen size={15} />} type="button" disabled={controlsDisabled} onClick={openSelectedAssetDir}>
                打开目录
              </Button>
            ) : null}
            <Button className="primary-action slim" variant="primary" icon={<Upload size={15} />} type="button" disabled={!selectedName || controlsDisabled} onClick={importImages}>
              {pendingAction === 'import' ? '导入中' : '导入图片'}
            </Button>
          </div>
        </div>

        {selectedName ? (
          <div className="person-asset-tools">
            <TextField label="人物名称" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} disabled={controlsDisabled} />
            <div className="button-row person-asset-actions">
              <Button className="ghost-action compact-action" density="compact" icon={<Pencil size={15} />} type="button" disabled={!renameValue.trim() || renameValue.trim() === selectedName || controlsDisabled} onClick={renamePerson}>
                重命名
              </Button>
              <Button className="mini-button" density="compact" icon={<Trash2 size={15} />} type="button" disabled={controlsDisabled} onClick={deletePerson}>{deleteConfirmation?.name === selectedName ? '确认删除' : '删除'}</Button>
            </div>
            {deleteConfirmation?.name === selectedName ? <span className="local-note">{deleteConfirmation.references.length > 0 ? '该人物仍被任务引用，不能删除。' : '再次点击确认，素材将移入回收区。'}</span> : null}
          </div>
        ) : null}

        {message || personAction.feedback || recycled ? (
          <div className="person-asset-feedback">
            {message && !personAction.feedback ? <span className="local-note" role="status">{message}</span> : null}
            <InlineActionFeedback feedback={personAction.feedback} />
            {recycled ? <Button className="ghost-action compact-action" density="compact" icon={<Undo2 size={15} />} type="button" disabled={controlsDisabled} onClick={undoDelete}>撤销删除</Button> : null}
          </div>
        ) : null}

        <div className="person-image-grid">
          {images.length === 0 ? <EmptyState title={isBrowserPreview ? '本地图片不可用' : '暂无图片'} /> : null}
          {images.map((image) => (
            <article className="person-image-card" key={image.path}>
              {imageUrls[image.path]
                ? <img src={imageUrls[image.path]} alt={image.name} data-media-canvas="person-assets" />
                : <div className="person-image-placeholder" data-media-canvas="person-assets">{image.name}</div>}
              <span title={image.path}>{image.name}</span>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
